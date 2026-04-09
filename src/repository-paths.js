'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function pathExists(targetPath = '') {
    try {
        fs.accessSync(targetPath, fs.constants.F_OK);
        return true;
    } catch (_error) {
        return false;
    }
}

function hasGitMetadata(targetPath = '') {
    const normalized = path.resolve(String(targetPath || '.'));
    return pathExists(path.join(normalized, '.git'));
}

function buildRepositoryWorkspaceSlug(repositoryUrl = '') {
    const normalized = String(repositoryUrl || '').trim().toLowerCase();
    if (!normalized) {
        return 'default-repository';
    }

    const stripped = normalized
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/^git@github\.com:/, '')
        .replace(/\.git$/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const digest = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
    const base = stripped || 'repository';
    return `${base}-${digest}`;
}

function resolveManagedRepositoryPath({
    dataDir = '',
    repositoryUrl = '',
} = {}) {
    const baseDir = path.resolve(String(dataDir || path.join(process.cwd(), 'data')));
    return path.join(baseDir, 'workspaces', buildRepositoryWorkspaceSlug(repositoryUrl));
}

function resolveDefaultRepositoryPath({
    explicitPath = '',
    currentWorkingDirectory = process.cwd(),
    dataDir = '',
    repositoryUrl = '',
} = {}) {
    const explicit = String(explicitPath || '').trim();
    if (explicit) {
        return path.resolve(explicit);
    }

    const cwd = path.resolve(String(currentWorkingDirectory || process.cwd()));
    if (hasGitMetadata(cwd)) {
        return cwd;
    }

    return resolveManagedRepositoryPath({
        dataDir,
        repositoryUrl,
    });
}

module.exports = {
    buildRepositoryWorkspaceSlug,
    hasGitMetadata,
    resolveDefaultRepositoryPath,
    resolveManagedRepositoryPath,
};
