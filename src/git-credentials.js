const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function resolveGitHubCredentialToken(env = process.env) {
    return String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
}

function resolveGitCredentialToken(env = process.env) {
    return String(
        env.KIMIBUILT_GIT_PASSWORD
        || env.GH_TOKEN
        || env.GITHUB_TOKEN
        || env.GITEA_TOKEN
        || '',
    ).trim();
}

function buildGitCredentialEnvironment(env = process.env, overrides = {}) {
    const mergedEnv = {
        ...env,
        ...overrides,
    };
    const token = resolveGitCredentialToken(env);
    const explicitToken = resolveGitCredentialToken(mergedEnv);
    const credentialToken = explicitToken || token;
    if (!credentialToken) {
        return {};
    }

    return {
        GITHUB_TOKEN: String(mergedEnv.GITHUB_TOKEN || '').trim(),
        GH_TOKEN: String(mergedEnv.GH_TOKEN || '').trim(),
        GITEA_TOKEN: String(mergedEnv.GITEA_TOKEN || '').trim(),
        KIMIBUILT_GIT_USERNAME: String(mergedEnv.KIMIBUILT_GIT_USERNAME || 'x-access-token').trim() || 'x-access-token',
        KIMIBUILT_GIT_PASSWORD: credentialToken,
    };
}

function normalizeGitHubRepositoryUrlForToken(repositoryUrl = '', env = process.env) {
    const normalized = String(repositoryUrl || '').trim();
    const token = resolveGitHubCredentialToken(env);
    if (!token) {
        return normalized;
    }

    const match = normalized.match(/^git@github\.com:([^/\s]+\/[^/\s]+?)(?:\.git)?$/i);
    if (!match) {
        return normalized;
    }

    return `https://github.com/${match[1]}.git`;
}

async function createGitCredentialSession(env = process.env) {
    const token = resolveGitCredentialToken(env);
    if (!token) {
        return {
            env: {
                ...env,
            },
            cleanup: async () => {},
        };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-git-'));
    const scriptPath = path.join(
        tempDir,
        process.platform === 'win32' ? 'askpass.cmd' : 'askpass.sh',
    );

    const scriptBody = process.platform === 'win32'
        ? [
            '@echo off',
            'set PROMPT=%*',
            'echo %PROMPT% | findstr /I "Username" >nul',
            'if %errorlevel%==0 (',
            '  <nul set /p =%KIMIBUILT_GIT_USERNAME%',
            ') else (',
            '  <nul set /p =%KIMIBUILT_GIT_PASSWORD%',
            ')',
            '',
        ].join('\r\n')
        : [
            '#!/bin/sh',
            'prompt="$1"',
            'case "$prompt" in',
            '  *Username*|*username*)',
            '    printf "%s" "${KIMIBUILT_GIT_USERNAME:-x-access-token}"',
            '    ;;',
            '  *)',
            '    printf "%s" "${KIMIBUILT_GIT_PASSWORD:-}"',
            '    ;;',
            'esac',
            '',
        ].join('\n');

    await fs.writeFile(scriptPath, scriptBody, 'utf8');
    if (process.platform !== 'win32') {
        await fs.chmod(scriptPath, 0o700);
    }

    return {
        env: {
            ...env,
            GIT_ASKPASS: scriptPath,
            GIT_TERMINAL_PROMPT: '0',
            GCM_INTERACTIVE: 'Never',
            KIMIBUILT_GIT_USERNAME: String(env.KIMIBUILT_GIT_USERNAME || 'x-access-token').trim() || 'x-access-token',
            KIMIBUILT_GIT_PASSWORD: token,
        },
        cleanup: async () => {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        },
    };
}

module.exports = {
    buildGitCredentialEnvironment,
    createGitCredentialSession,
    normalizeGitHubRepositoryUrlForToken,
    resolveGitHubCredentialToken,
    resolveGitCredentialToken,
};
