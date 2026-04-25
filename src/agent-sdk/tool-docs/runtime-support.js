const { spawn } = require('child_process');
const settingsController = require('../../routes/admin/settings.controller');
const { remoteRunnerService } = require('../../remote-runner/service');
const { remoteCliAgentsSdkRunner } = require('../../remote-cli/agents-sdk-runner');

const CACHE_TTL_MS = 15000;

let cachedSnapshot = null;
let cachedAt = 0;
let pendingSnapshot = null;

function appendNote(notes, message) {
    if (!message) return;
    if (!notes.includes(message)) {
        notes.push(message);
    }
}

function probeCommand(command, args = [], options = {}) {
    const timeout = options.timeout || 5000;

    return new Promise((resolve) => {
        const child = spawn(command, args, {
            env: options.env || process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill('SIGTERM');
            resolve({
                ok: false,
                code: 'ETIMEDOUT',
                stdout,
                stderr,
                message: `${command} timed out after ${timeout}ms`,
            });
        }, timeout);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                ok: false,
                code: error.code || 'ERROR',
                stdout,
                stderr,
                message: error.message,
            });
        });

        child.on('close', (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({
                ok: code === 0,
                code,
                stdout,
                stderr,
                message: (stderr || stdout || '').trim(),
            });
        });
    });
}

async function buildRuntimeSnapshot() {
    const [dockerProbe, sshProbe, gitProbe] = await Promise.all([
        probeCommand('docker', ['info'], { timeout: 8000 }),
        probeCommand('ssh', ['-V'], { timeout: 5000 }),
        probeCommand('git', ['--version'], { timeout: 5000 }),
    ]);

    const sshConfig = settingsController.getEffectiveSshConfig();
    const sshNotes = [];
    const dockerNotes = [];
    const gitNotes = [];

    if (!sshProbe.ok) {
        appendNote(sshNotes, `SSH client is unavailable in the backend runtime: ${sshProbe.message || 'unknown error'}`);
    }

    if (sshConfig.enabled === false) {
        appendNote(sshNotes, 'SSH defaults are disabled in Admin Settings.');
    }
    if (!sshConfig.host) {
        appendNote(sshNotes, 'Missing SSH host.');
    }
    if (!sshConfig.username) {
        appendNote(sshNotes, 'Missing SSH username.');
    }
    if (!sshConfig.password && !sshConfig.privateKeyPath) {
        appendNote(sshNotes, 'Missing SSH password or private key path.');
    }

    const sshReady = sshProbe.ok
        && sshConfig.enabled !== false
        && Boolean(sshConfig.host)
        && Boolean(sshConfig.username)
        && Boolean(sshConfig.password || sshConfig.privateKeyPath);

    if (sshReady) {
        appendNote(sshNotes, `SSH is configured for ${sshConfig.username}@${sshConfig.host}:${sshConfig.port || 22}.`);
    }

    if (!dockerProbe.ok) {
        appendNote(dockerNotes, `Docker runtime is unavailable: ${dockerProbe.message || 'unknown error'}`);
        appendNote(dockerNotes, 'Ensure the backend container has Docker CLI access and a reachable Docker daemon or socket.');
    } else {
        appendNote(dockerNotes, 'Docker CLI and daemon are reachable from the backend runtime.');
    }

    const dockerReady = dockerProbe.ok;

    if (!gitProbe.ok) {
        appendNote(gitNotes, `Git CLI is unavailable in the backend runtime: ${gitProbe.message || 'unknown error'}`);
    } else {
        appendNote(gitNotes, 'Git CLI is available in the backend runtime.');
    }

    const gitReady = gitProbe.ok;

    return {
        checkedAt: new Date().toISOString(),
        docker: {
            ready: dockerReady,
            notes: dockerNotes,
        },
        git: {
            ready: gitReady,
            notes: gitNotes,
        },
        ssh: {
            ready: sshReady,
            notes: sshNotes,
        },
    };
}

async function getRuntimeSnapshot() {
    const now = Date.now();
    if (cachedSnapshot && now - cachedAt < CACHE_TTL_MS) {
        return cachedSnapshot;
    }

    if (!pendingSnapshot) {
        pendingSnapshot = buildRuntimeSnapshot()
            .then((snapshot) => {
                cachedSnapshot = snapshot;
                cachedAt = Date.now();
                return snapshot;
            })
            .finally(() => {
                pendingSnapshot = null;
            });
    }

    return pendingSnapshot;
}

async function getRuntimeSupport(toolId) {
    const snapshot = await getRuntimeSnapshot();
    const giteaConfig = typeof settingsController.getEffectiveGiteaConfig === 'function'
        ? settingsController.getEffectiveGiteaConfig()
        : {};
    const managedAppsConfig = typeof settingsController.getEffectiveManagedAppsConfig === 'function'
        ? settingsController.getEffectiveManagedAppsConfig()
        : {};

    if (toolId === 'ssh-execute' || toolId === 'remote-command') {
        const runner = remoteRunnerService.getHealthyRunner();
        const runnerWorkspace = runner?.metadata?.defaultCwd || runner?.metadata?.workspace || '';
        return {
            status: (runner || snapshot.ssh.ready) ? 'stable' : 'requires_setup',
            notes: runner
                ? [`Remote runner ${runner.runnerId} is online${runnerWorkspace ? ` with workspace ${runnerWorkspace}` : ''}.`, ...snapshot.ssh.notes]
                : snapshot.ssh.notes,
            runtime: {
                ...snapshot.ssh,
                ready: Boolean(runner || snapshot.ssh.ready),
                runnerReady: Boolean(runner),
                runnerId: runner?.runnerId || '',
                runnerWorkspace,
                runnerShell: runner?.metadata?.shell || '',
                runnerCapabilities: runner?.capabilities || [],
            },
        };
    }

    if (toolId === 'k3s-deploy') {
        const runner = remoteRunnerService.getHealthyRunner('', { requiredProfile: 'deploy' });
        const runnerWorkspace = runner?.metadata?.defaultCwd || runner?.metadata?.workspace || '';
        return {
            status: (runner || snapshot.ssh.ready) ? 'stable' : 'requires_setup',
            notes: runner
                ? [`Remote runner ${runner.runnerId} is online for deploy operations${runnerWorkspace ? ` with workspace ${runnerWorkspace}` : ''}.`, ...snapshot.ssh.notes]
                : snapshot.ssh.notes,
            runtime: {
                ...snapshot.ssh,
                ready: Boolean(runner || snapshot.ssh.ready),
                runnerReady: Boolean(runner),
                runnerId: runner?.runnerId || '',
                runnerWorkspace,
                runnerShell: runner?.metadata?.shell || '',
                runnerCapabilities: runner?.capabilities || [],
            },
        };
    }

    if (toolId === 'remote-cli-agent') {
        const publicConfig = remoteCliAgentsSdkRunner.getPublicConfig();
        const ready = publicConfig.enabled !== false && publicConfig.configured;
        return {
            status: ready ? 'stable' : 'requires_setup',
            notes: ready
                ? [
                    `Remote CLI MCP server ${publicConfig.name} is configured at ${publicConfig.url}.`,
                    `Default target is ${publicConfig.defaultTargetId}${publicConfig.defaultCwd ? ` with cwd ${publicConfig.defaultCwd}` : ''}.`,
                ]
                : [
                    'Remote CLI MCP needs REMOTE_CLI_MCP_URL or GATEWAY_URL.',
                    'Remote CLI MCP needs REMOTE_CLI_MCP_BEARER_TOKEN or N8N_API_KEY in the backend environment.',
                ],
            runtime: {
                ready,
                ...publicConfig,
            },
        };
    }

    if (toolId === 'git-safe') {
        return {
            status: snapshot.git.ready ? 'stable' : 'requires_setup',
            notes: snapshot.git.notes,
            runtime: snapshot.git,
        };
    }

    if (toolId === 'docker-exec' || toolId === 'code-sandbox') {
        return {
            status: snapshot.docker.ready ? 'stable' : 'requires_setup',
            notes: snapshot.docker.notes,
            runtime: snapshot.docker,
        };
    }

    if (toolId === 'managed-app') {
        const ready = Boolean(
            giteaConfig.enabled !== false
            && giteaConfig.baseURL
            && giteaConfig.token
            && managedAppsConfig.enabled !== false,
        );

        return {
            status: ready ? 'stable' : 'requires_setup',
            notes: ready
                ? [
                    `External Gitea configured at ${giteaConfig.baseURL}.`,
                    `Managed app base domain is ${managedAppsConfig.appBaseDomain || 'demoserver2.buzz'}.`,
                ]
                : [
                    'Managed app control plane needs integrations.gitea baseURL and token.',
                    'Managed app control plane also needs integrations.managedApps defaults.',
                ],
            runtime: {
                ready,
                baseURL: giteaConfig.baseURL || '',
                org: giteaConfig.org || '',
                appBaseDomain: managedAppsConfig.appBaseDomain || '',
            },
        };
    }

    return null;
}

module.exports = {
    getRuntimeSupport,
    getRuntimeSnapshot,
};
