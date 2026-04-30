'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const MAX_TASK_EVENTS = 4000;
const REMOTE_AGENT_STREAM_ROUTE_PREFIX = '/admin/remote-agent-tasks';
const PROGRESS_MARKERS = Object.freeze([
    'REMOTE_AGENT_PLAN',
    'REMOTE_AGENT_PROGRESS',
    'REMOTE_AGENT_RESULT',
]);

class RemoteAgentTaskService {
    constructor({
        providerSessionService,
        remoteCliTargets = null,
        providerConfigPath = process.env.PROVIDERS_CONFIG_PATH
            || process.env.KIMIBUILT_PROVIDERS_CONFIG_PATH
            || path.resolve(process.cwd(), 'providers.yaml'),
    } = {}) {
        if (!providerSessionService) {
            throw new Error('RemoteAgentTaskService requires a providerSessionService');
        }

        this.providerSessionService = providerSessionService;
        this.remoteCliTargets = remoteCliTargets;
        this.providerConfigPath = providerConfigPath;
        this.tasks = new Map();
    }

    async createTask(payload = {}, ownerId = null) {
        const providerId = normalizeRequiredString(payload.providerId, 'providerId').toLowerCase();
        const targetId = normalizeRequiredString(payload.targetId, 'targetId');
        const taskText = normalizeRequiredString(payload.task, 'task');
        const model = normalizeOptionalString(payload.model);

        const provider = this.providerSessionService.getProviderDefinition(providerId);
        if (!provider) {
            const error = new Error(`Unknown provider "${providerId}"`);
            error.statusCode = 404;
            throw error;
        }
        if (!normalizeOptionalString(provider.sessionCommand || provider.command)) {
            const error = new Error(`Provider "${providerId}" does not define a sessionCommand`);
            error.statusCode = 400;
            throw error;
        }

        const target = this.getRemoteCliTarget(targetId);
        if (!target) {
            const error = new Error(`Unknown remote CLI target "${targetId}"`);
            error.statusCode = 404;
            throw error;
        }

        const cwd = this.resolveRemoteCwd(payload.cwd, target);
        const sshCommand = buildSshCommand(target);
        const taskId = `ragent_${crypto.randomUUID()}`;
        const streamToken = crypto.randomBytes(24).toString('hex');
        const createdAt = new Date().toISOString();

        const createdSession = await this.providerSessionService.createSession({
            providerId,
            model,
        }, ownerId);

        const task = {
            id: taskId,
            ownerId: normalizeOwnerId(ownerId),
            sessionId: createdSession.session.id,
            providerId,
            targetId: target.targetId,
            cwd,
            task: taskText,
            model,
            status: 'running',
            createdAt,
            updatedAt: createdAt,
            streamToken,
            nextCursor: 1,
            events: [],
            transcript: [],
            bus: new EventEmitter(),
            unsubscribe: null,
            reasoning: buildReasoning({
                providerId,
                target,
                cwd,
                sshCommand,
                summary: `Starting ${providerId} on ${target.targetId} via ${sshCommand}.`,
            }),
        };

        this.tasks.set(task.id, task);
        this.recordEvent(task, 'reasoning', task.reasoning);
        this.recordEvent(task, 'status', {
            status: task.status,
            message: `Remote agent task started with provider session ${task.sessionId}`,
        });

        task.unsubscribe = this.providerSessionService.subscribeToSession(task.sessionId, ownerId, (event) => {
            this.mirrorProviderSessionEvent(task, event);
        });

        await this.providerSessionService.sendInput(
            task.sessionId,
            ownerId,
            `${buildRemoteAgentPrompt({
                task: taskText,
                target,
                cwd,
                sshCommand,
                model,
            })}\n`,
        );

        return {
            task: this.toPublicTask(task),
            streamUrl: `${REMOTE_AGENT_STREAM_ROUTE_PREFIX}/${encodeURIComponent(task.id)}/stream?token=${task.streamToken}`,
        };
    }

    getPublicTask(taskId = '', ownerId = null) {
        const task = this.getTask(taskId, ownerId);
        return task ? this.toPublicTask(task) : null;
    }

    getTranscript(taskId = '', ownerId = null) {
        const task = this.getTask(taskId, ownerId);
        if (!task) {
            return null;
        }

        return {
            task: this.toPublicTask(task),
            transcript: task.transcript.map((entry) => ({ ...entry })),
        };
    }

    listTaskEvents(taskId = '', ownerId = null, afterCursor = 0) {
        const task = this.getTask(taskId, ownerId);
        if (!task) {
            return null;
        }

        const after = normalizeCursor(afterCursor);
        return task.events
            .filter((event) => event.cursor > after)
            .map((event) => ({ ...event }));
    }

    subscribeToTask(taskId = '', ownerId = null, handler = () => {}) {
        const task = this.getTask(taskId, ownerId);
        if (!task) {
            return null;
        }

        const listener = (event) => handler({ ...event });
        task.bus.on('event', listener);

        return () => {
            task.bus.off('event', listener);
        };
    }

    validateStreamToken(taskId = '', ownerId = null, token = '') {
        const task = this.getTask(taskId, ownerId);
        if (!task) {
            return false;
        }

        return safeEqual(task.streamToken, String(token || '').trim());
    }

    async cancelTask(taskId = '', ownerId = null) {
        const task = this.requireTask(taskId, ownerId);
        await this.providerSessionService.sendSignal(task.sessionId, ownerId, 'SIGTERM');
        task.status = 'cancelled';
        task.updatedAt = new Date().toISOString();
        this.recordEvent(task, 'status', {
            status: task.status,
            message: 'Remote agent task cancellation requested',
        });

        return {
            success: true,
            task: this.toPublicTask(task),
        };
    }

    getTask(taskId = '', ownerId = null) {
        const task = this.tasks.get(String(taskId || '').trim());
        if (!task) {
            return null;
        }

        if (normalizeOwnerId(task.ownerId) !== normalizeOwnerId(ownerId)) {
            return null;
        }

        return task;
    }

    requireTask(taskId = '', ownerId = null) {
        const task = this.getTask(taskId, ownerId);
        if (!task) {
            const error = new Error('Remote agent task not found');
            error.statusCode = 404;
            throw error;
        }
        return task;
    }

    getRemoteCliTargets() {
        if (Array.isArray(this.remoteCliTargets)) {
            return this.remoteCliTargets
                .map(normalizeRemoteCliTarget)
                .filter(Boolean);
        }

        return loadRemoteCliTargets(this.providerConfigPath);
    }

    getRemoteCliTarget(targetId = '') {
        const normalized = String(targetId || '').trim();
        return this.getRemoteCliTargets().find((target) => target.targetId === normalized) || null;
    }

    resolveRemoteCwd(requestedCwd = '', target = {}) {
        const cwd = normalizeRemotePath(requestedCwd) || normalizeRemotePath(target.defaultCwd);
        if (!cwd) {
            const error = new Error(`Remote target "${target.targetId}" does not define a defaultCwd and no cwd was provided`);
            error.statusCode = 400;
            throw error;
        }

        const allowedCwds = Array.isArray(target.allowedCwds)
            ? target.allowedCwds.map(normalizeRemotePath).filter(Boolean)
            : [];
        if (allowedCwds.length > 0 && !allowedCwds.some((allowed) => isRemotePathInside(cwd, allowed))) {
            const error = new Error(`cwd must be inside one of the target allowedCwds: ${allowedCwds.join(', ')}`);
            error.statusCode = 400;
            throw error;
        }

        return cwd;
    }

    mirrorProviderSessionEvent(task = {}, event = {}) {
        if (event.type === 'output') {
            const data = String(event.data || '');
            this.recordEvent(task, 'output', {
                data,
                sessionCursor: event.cursor,
            });
            task.transcript.push({
                cursor: event.cursor,
                timestamp: event.timestamp,
                type: 'output',
                data,
            });
            return;
        }

        if (event.type === 'status') {
            this.recordEvent(task, 'status', {
                status: event.status || task.status,
                message: event.message || '',
                sessionCursor: event.cursor,
            });
            return;
        }

        if (event.type === 'exit') {
            task.status = event.exitCode === 0 ? 'completed' : 'failed';
            if (task.unsubscribe) {
                task.unsubscribe();
                task.unsubscribe = null;
            }
            this.recordEvent(task, 'exit', {
                exitCode: event.exitCode,
                signal: event.signal || null,
                sessionCursor: event.cursor,
            });
            this.recordEvent(task, 'status', {
                status: task.status,
                message: task.status === 'completed'
                    ? 'Remote agent task completed'
                    : 'Remote agent task exited with a non-zero status',
            });
        }
    }

    recordEvent(task = {}, eventType = 'status', payload = {}) {
        const event = {
            cursor: task.nextCursor,
            type: eventType,
            timestamp: new Date().toISOString(),
            ...payload,
        };
        task.nextCursor += 1;
        task.events.push(event);
        task.updatedAt = event.timestamp;

        if (task.events.length > MAX_TASK_EVENTS) {
            task.events.splice(0, task.events.length - MAX_TASK_EVENTS);
        }

        task.bus.emit('event', { ...event });
    }

    toPublicTask(task = {}) {
        return {
            id: task.id,
            sessionId: task.sessionId,
            status: task.status,
            providerId: task.providerId,
            targetId: task.targetId,
            cwd: task.cwd,
            model: task.model,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            reasoning: task.reasoning,
        };
    }
}

function buildReasoning({ providerId, target, cwd, sshCommand, summary }) {
    return {
        summary,
        data: {
            providerId,
            targetId: target.targetId,
            cwd,
            sshCommand,
            progressMarkers: [...PROGRESS_MARKERS],
        },
    };
}

function buildRemoteAgentPrompt({ task, target, cwd, sshCommand, model }) {
    const modelLine = model ? `Preferred model: ${model}` : 'Preferred model: provider default';
    return [
        'You are a remote cluster CLI agent launched by KimiBuilt.',
        '',
        'Use SSH to work on the configured remote target. Keep commands small and purposeful.',
        `Remote target: ${target.targetId} (${target.description || target.host})`,
        `SSH command: ${sshCommand}`,
        `Remote working directory: ${cwd}`,
        modelLine,
        '',
        'Admin/deployment policy:',
        '- For real app/site/service deployment work, you may use the configured non-interactive admin, sudo, kubectl, and runner capabilities that are already available on the target.',
        '- Keep privileged actions scoped to the requested workspace, namespace, domain, and deployment path.',
        '- Do not mutate Kubernetes Secrets, wipe data, force-push, perform broad package upgrades, or change unrelated host services unless the user explicitly approved that exact action.',
        '- If a command is blocked by policy, sudo, credentials, or missing capability, do not retry the same blocked command. Switch strategy or report the exact blocker.',
        '- If the same command shape or root error fails twice without a materially different fix, stop that loop and print USER_INPUT_REQUIRED with the next decision or permission needed.',
        '',
        'Progress protocol:',
        '- Start by printing REMOTE_AGENT_PLAN with a concise plan.',
        '- Print REMOTE_AGENT_PROGRESS for meaningful state changes.',
        '- Finish by printing REMOTE_AGENT_RESULT with the outcome, verification, and public URL when applicable.',
        '',
        'Task:',
        task,
    ].join('\n');
}

function loadRemoteCliTargets(providerConfigPath = '') {
    const fromJson = parseRemoteTargetsJson(process.env.KIMIBUILT_REMOTE_CLI_TARGETS_JSON || process.env.REMOTE_CLI_TARGETS_JSON || '');
    if (fromJson.length > 0) {
        return fromJson;
    }

    const configPath = String(providerConfigPath || '').trim();
    if (!configPath || !fs.existsSync(configPath)) {
        return [];
    }

    try {
        return parseRemoteTargetsYaml(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.warn(`[RemoteAgentTask] Failed to read providers config "${configPath}": ${error.message}`);
        return [];
    }
}

function parseRemoteTargetsJson(rawValue = '') {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
        return [];
    }

    try {
        const parsed = JSON.parse(normalized);
        const list = Array.isArray(parsed) ? parsed : parsed.remoteCliTargets;
        return Array.isArray(list) ? list.map(normalizeRemoteCliTarget).filter(Boolean) : [];
    } catch (error) {
        console.warn(`[RemoteAgentTask] Failed to parse remote target JSON: ${error.message}`);
        return [];
    }
}

function parseRemoteTargetsYaml(contents = '') {
    const lines = String(contents || '').split(/\r?\n/);
    const targets = [];
    let inTargets = false;
    let current = null;
    let listKey = null;
    let listIndent = 0;

    for (const rawLine of lines) {
        const withoutComment = rawLine.replace(/\s+#.*$/, '');
        if (!withoutComment.trim()) {
            continue;
        }

        const indent = withoutComment.match(/^\s*/)?.[0].length || 0;
        const trimmed = withoutComment.trim();
        if (indent === 0) {
            inTargets = trimmed === 'remoteCliTargets:';
            listKey = null;
            continue;
        }
        if (!inTargets) {
            continue;
        }

        if (trimmed.startsWith('- ')) {
            const rest = trimmed.slice(2).trim();
            if (rest.includes(':')) {
                if (listKey && current && indent > listIndent) {
                    current[listKey] = current[listKey] || [];
                    current[listKey].push(unquoteYaml(rest));
                    continue;
                }
                if (current) {
                    targets.push(current);
                }
                current = {};
                assignYamlKeyValue(current, rest);
                listKey = null;
            } else if (listKey && current) {
                current[listKey] = current[listKey] || [];
                current[listKey].push(unquoteYaml(rest));
            }
            continue;
        }

        if (!current) {
            continue;
        }

        const separator = trimmed.indexOf(':');
        if (separator === -1) {
            continue;
        }
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (!value) {
            current[key] = current[key] || [];
            listKey = key;
            listIndent = indent;
            continue;
        }

        current[key] = unquoteYaml(value);
        listKey = null;
    }

    if (current) {
        targets.push(current);
    }

    return targets.map(normalizeRemoteCliTarget).filter(Boolean);
}

function assignYamlKeyValue(target, line = '') {
    const separator = line.indexOf(':');
    if (separator === -1) {
        return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    target[key] = unquoteYaml(value);
}

function unquoteYaml(value = '') {
    return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeRemoteCliTarget(target = {}) {
    if (!target || typeof target !== 'object') {
        return null;
    }

    const targetId = normalizeOptionalString(target.targetId || target.id);
    const host = normalizeOptionalString(target.host);
    const user = normalizeOptionalString(target.user);
    if (!targetId || !host || !user) {
        return null;
    }

    const port = Number.parseInt(target.port, 10);
    return {
        targetId,
        description: normalizeOptionalString(target.description) || '',
        host,
        user,
        port: Number.isFinite(port) && port > 0 ? port : 22,
        allowedCwds: Array.isArray(target.allowedCwds)
            ? target.allowedCwds.map(normalizeRemotePath).filter(Boolean)
            : [],
        defaultCwd: normalizeRemotePath(target.defaultCwd),
    };
}

function buildSshCommand(target = {}) {
    const destination = `${target.user}@${target.host}`;
    return Number(target.port) && Number(target.port) !== 22
        ? `ssh -p ${target.port} ${destination}`
        : `ssh ${destination}`;
}

function normalizeRequiredString(value, fieldName) {
    const normalized = normalizeOptionalString(value);
    if (!normalized) {
        const error = new Error(`${fieldName} is required`);
        error.statusCode = 400;
        throw error;
    }
    return normalized;
}

function normalizeOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeOwnerId(ownerId = null) {
    return String(ownerId || 'anonymous').trim() || 'anonymous';
}

function normalizeCursor(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRemotePath(value = '') {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
    if (!normalized) {
        return null;
    }
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function isRemotePathInside(candidate = '', root = '') {
    const normalizedCandidate = normalizeRemotePath(candidate);
    const normalizedRoot = normalizeRemotePath(root);
    return normalizedCandidate === normalizedRoot
        || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

function safeEqual(left = '', right = '') {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));

    if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
    RemoteAgentTaskService,
    parseRemoteTargetsYaml,
};
