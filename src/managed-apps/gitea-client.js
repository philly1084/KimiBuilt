'use strict';

const settingsController = require('../routes/admin/settings.controller');

function normalizeText(value = '') {
    return String(value || '').trim();
}

function normalizeApiBaseUrl(value = '') {
    const normalized = normalizeText(value).replace(/\/+$/, '');
    return normalized;
}

function safePath(value = '') {
    const normalized = normalizeText(value).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
        throw new Error(`Invalid repository file path: ${value}`);
    }
    return normalized;
}

function encodeBase64(value = '') {
    return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function normalizeRunnerScope(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (['global', 'instance', 'admin'].includes(normalized)) {
        return 'instance';
    }
    if (['repo', 'repository'].includes(normalized)) {
        return 'repo';
    }
    return 'org';
}

function extractRunnerRegistrationToken(payload = {}) {
    return normalizeText(
        payload?.token
        || payload?.registration_token
        || payload?.value
        || payload?.raw,
    );
}

class GiteaClient {
    getConfig() {
        return typeof settingsController.getEffectiveGiteaConfig === 'function'
            ? settingsController.getEffectiveGiteaConfig()
            : {};
    }

    isConfigured() {
        const config = this.getConfig();
        return Boolean(config.enabled !== false && config.baseURL && config.token && config.org);
    }

    buildApiUrl(pathname = '', query = null) {
        const config = this.getConfig();
        const baseURL = normalizeApiBaseUrl(config.baseURL);
        if (!baseURL) {
            throw new Error('Managed app repository operations require integrations.gitea.baseURL.');
        }

        const url = new URL(`/api/v1${pathname.startsWith('/') ? pathname : `/${pathname}`}`, `${baseURL}/`);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([key, value]) => {
                if (value === undefined || value === null || value === '') {
                    return;
                }
                url.searchParams.set(key, String(value));
            });
        }
        return url;
    }

    async request(method, pathname, { query = null, body = null, headers = {}, allowNotFound = false } = {}) {
        const config = this.getConfig();
        if (!this.isConfigured()) {
            throw new Error('Managed app repository operations require a configured external Gitea control plane.');
        }

        const response = await fetch(this.buildApiUrl(pathname, query), {
            method,
            headers: {
                Authorization: `token ${config.token}`,
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
                ...headers,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });

        if (allowNotFound && response.status === 404) {
            return null;
        }

        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(`Gitea API ${method} ${pathname} failed: HTTP ${response.status}${errorText ? ` ${errorText}` : ''}`);
            error.statusCode = response.status;
            throw error;
        }

        const text = await response.text();
        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch (_error) {
            return { raw: text };
        }
    }

    async getRepository(owner = '', repo = '') {
        return this.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
            allowNotFound: true,
        });
    }

    buildRunnerScopePath({ scope = 'org', org = '', owner = '', repo = '' } = {}) {
        const normalizedScope = normalizeRunnerScope(scope);
        if (normalizedScope === 'instance') {
            return '/admin/actions/runners';
        }

        if (normalizedScope === 'repo') {
            const repoOwner = normalizeText(owner);
            const repoName = normalizeText(repo);
            if (!repoOwner || !repoName) {
                throw new Error('Repository runner operations require an owner and repository name.');
            }
            return `/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/actions/runners`;
        }

        const orgName = normalizeText(org) || normalizeText(this.getConfig().org);
        if (!orgName) {
            throw new Error('Organization runner operations require a Gitea organization name.');
        }
        return `/orgs/${encodeURIComponent(orgName)}/actions/runners`;
    }

    async listActionsRunners({ scope = 'org', org = '', owner = '', repo = '' } = {}) {
        const normalizedScope = normalizeRunnerScope(scope);
        const payload = await this.request('GET', this.buildRunnerScopePath({
            scope: normalizedScope,
            org,
            owner,
            repo,
        }));
        const runners = Array.isArray(payload?.runners)
            ? payload.runners
            : (Array.isArray(payload) ? payload : []);

        return {
            scope: normalizedScope,
            runners,
            totalCount: Number(payload?.total_count || runners.length || 0),
        };
    }

    async getRunnerRegistrationToken({
        scope = 'org',
        org = '',
        owner = '',
        repo = '',
        rotate = false,
    } = {}) {
        const normalizedScope = normalizeRunnerScope(scope);
        const payload = await this.request(
            rotate ? 'POST' : 'GET',
            `${this.buildRunnerScopePath({
                scope: normalizedScope,
                org,
                owner,
                repo,
            })}/registration-token`,
        );
        const token = extractRunnerRegistrationToken(payload);
        if (!token) {
            throw new Error(`Gitea did not return a runner registration token for the ${normalizedScope} scope.`);
        }

        return {
            scope: normalizedScope,
            token,
            rotated: rotate === true,
        };
    }

    async getOrganization(name = '') {
        const orgName = normalizeText(name);
        if (!orgName) {
            return null;
        }

        return this.request('GET', `/orgs/${encodeURIComponent(orgName)}`, {
            allowNotFound: true,
        });
    }

    async ensureOrganization({
        name = '',
        fullName = '',
        description = '',
    } = {}) {
        const orgName = normalizeText(name) || this.getConfig().org;
        if (!orgName) {
            throw new Error('Managed app repository creation requires a Gitea organization name.');
        }

        const existing = await this.getOrganization(orgName);
        if (existing) {
            return {
                organization: existing,
                created: false,
            };
        }

        const created = await this.request('POST', '/orgs', {
            body: {
                username: orgName,
                full_name: normalizeText(fullName) || orgName,
                description: normalizeText(description) || 'Managed applications provisioned by KimiBuilt.',
                visibility: 'private',
            },
        });

        return {
            organization: created,
            created: true,
        };
    }

    async ensureRepository({
        owner = '',
        name = '',
        description = '',
        privateRepo = true,
        defaultBranch = 'main',
    } = {}) {
        const repoOwner = normalizeText(owner) || this.getConfig().org;
        const repoName = normalizeText(name);
        if (!repoOwner || !repoName) {
            throw new Error('Managed app repository creation requires an owner and repo name.');
        }

        const existing = await this.getRepository(repoOwner, repoName);
        if (existing) {
            return {
                repository: existing,
                created: false,
            };
        }

        const created = await this.request('POST', `/orgs/${encodeURIComponent(repoOwner)}/repos`, {
            body: {
                name: repoName,
                description: normalizeText(description),
                private: privateRepo !== false,
                auto_init: false,
                default_branch: normalizeText(defaultBranch) || 'main',
            },
        });

        return {
            repository: created,
            created: true,
        };
    }

    async getContentMetadata({ owner = '', repo = '', filePath = '', ref = 'main' } = {}) {
        return this.request('GET', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath(filePath)}`, {
            query: { ref },
            allowNotFound: true,
        });
    }

    async upsertFile({
        owner = '',
        repo = '',
        branch = 'main',
        filePath = '',
        content = '',
        message = '',
    } = {}) {
        const normalizedPath = safePath(filePath);
        const existing = await this.getContentMetadata({
            owner,
            repo,
            filePath: normalizedPath,
            ref: branch,
        });
        const body = {
            branch: normalizeText(branch) || 'main',
            content: encodeBase64(content),
            message: normalizeText(message) || `Update ${normalizedPath}`,
        };

        if (existing?.sha) {
            body.sha = existing.sha;
            return this.request('PUT', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${normalizedPath}`, {
                body,
            });
        }

        return this.request('POST', `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${normalizedPath}`, {
            body,
        });
    }

    async upsertFiles({
        owner = '',
        repo = '',
        branch = 'main',
        files = [],
        commitMessagePrefix = 'Seed managed app repository',
    } = {}) {
        const normalizedFiles = (Array.isArray(files) ? files : [])
            .filter((entry) => entry && typeof entry === 'object' && normalizeText(entry.path))
            .map((entry) => ({
                path: safePath(entry.path),
                content: String(entry.content || ''),
            }))
            .sort((left, right) => {
                const leftWorkflow = left.path.startsWith('.gitea/workflows/');
                const rightWorkflow = right.path.startsWith('.gitea/workflows/');
                if (leftWorkflow === rightWorkflow) {
                    return left.path.localeCompare(right.path);
                }
                return leftWorkflow ? 1 : -1;
            });

        let lastCommitSha = '';
        const committedPaths = [];

        for (let index = 0; index < normalizedFiles.length; index += 1) {
            const file = normalizedFiles[index];
            const isLast = index === normalizedFiles.length - 1;
            const response = await this.upsertFile({
                owner,
                repo,
                branch,
                filePath: file.path,
                content: file.content,
                message: `${commitMessagePrefix}: ${file.path}${isLast ? '' : ' [skip ci]'}`,
            });
            lastCommitSha = normalizeText(
                response?.commit?.sha
                || response?.commit?.id
                || response?.content?.sha
                || lastCommitSha,
            );
            committedPaths.push(file.path);
        }

        return {
            commitSha: lastCommitSha,
            committedPaths,
        };
    }
}

module.exports = {
    GiteaClient,
};
