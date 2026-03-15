const { spawn } = require('child_process');
const settingsController = require('../../routes/admin/settings.controller');

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
    const [dockerProbe, sshProbe] = await Promise.all([
        probeCommand('docker', ['info'], { timeout: 8000 }),
        probeCommand('ssh', ['-V'], { timeout: 5000 }),
    ]);

    const sshConfig = settingsController.getEffectiveSshConfig();
    const sshNotes = [];
    const dockerNotes = [];

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

    return {
        checkedAt: new Date().toISOString(),
        docker: {
            ready: dockerReady,
            notes: dockerNotes,
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

    if (toolId === 'ssh-execute') {
        return {
            status: snapshot.ssh.ready ? 'stable' : 'requires_setup',
            notes: snapshot.ssh.notes,
            runtime: snapshot.ssh,
        };
    }

    if (toolId === 'docker-exec' || toolId === 'code-sandbox') {
        return {
            status: snapshot.docker.ready ? 'stable' : 'requires_setup',
            notes: snapshot.docker.notes,
            runtime: snapshot.docker,
        };
    }

    return null;
}

module.exports = {
    getRuntimeSupport,
    getRuntimeSnapshot,
};
