'use strict';

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const { config } = require('./config');
const {
    createGitCredentialSession,
    normalizeGitHubRepositoryUrlForToken,
} = require('./git-credentials');
const { hasGitMetadata } = require('./repository-paths');

async function pathExists(targetPath = '') {
    try {
        await fs.access(targetPath);
        return true;
    } catch (_error) {
        return false;
    }
}

async function isDirectoryEmpty(targetPath = '') {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
}

async function ensureRepositoryWorkspace({
    repositoryPath = '',
    repositoryUrl = '',
    ref = '',
    timeoutMs = 60000,
    env = process.env,
} = {}) {
    const targetPath = path.resolve(String(repositoryPath || config.deploy.defaultRepositoryPath || process.cwd()));
    const targetUrl = String(repositoryUrl || config.deploy.defaultRepositoryUrl || '').trim();
    const targetRef = String(ref || config.deploy.defaultBranch || 'master').trim() || 'master';

    if (hasGitMetadata(targetPath)) {
        return {
            repositoryPath: targetPath,
            bootstrapped: false,
        };
    }

    if (!targetUrl) {
        const error = new Error(`Repository workspace ${targetPath} is not a git repository and no repository URL is configured for bootstrap.`);
        error.code = 'REPOSITORY_URL_REQUIRED';
        throw error;
    }

    const exists = await pathExists(targetPath);
    if (exists && !(await isDirectoryEmpty(targetPath))) {
        const error = new Error(`Repository workspace ${targetPath} exists but is not a git repository.`);
        error.code = 'REPOSITORY_WORKSPACE_CONFLICT';
        throw error;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    if (!exists) {
        await fs.mkdir(targetPath, { recursive: true });
    }

    const gitSession = await createGitCredentialSession(env);
    try {
        await spawnGit(
            [
                'clone',
                '--branch',
                targetRef,
                '--single-branch',
                normalizeGitHubRepositoryUrlForToken(targetUrl, gitSession.env),
                targetPath,
            ],
            {
                cwd: path.dirname(targetPath),
                env: gitSession.env,
                timeout: timeoutMs,
            },
        );
    } finally {
        await gitSession.cleanup();
    }

    return {
        repositoryPath: targetPath,
        bootstrapped: true,
    };
}

async function spawnGit(args = [], options = {}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const child = spawn('git', args, {
            cwd: options.cwd,
            env: options.env || process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            child.kill('SIGTERM');
            reject(new Error(`git ${args[0]} timed out after ${options.timeout}ms`));
        }, options.timeout || 60000);

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (exitCode) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            if (exitCode !== 0) {
                const error = new Error((stderr || stdout || `git exited with code ${exitCode}`).trim());
                error.exitCode = exitCode;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
                return;
            }

            resolve({
                exitCode: exitCode || 0,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                duration: Date.now() - startedAt,
            });
        });
    });
}

module.exports = {
    ensureRepositoryWorkspace,
};
