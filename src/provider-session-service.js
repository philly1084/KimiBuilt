'use strict';

const crypto = require('crypto');
const fsSync = require('fs');
const fs = fsSync.promises;
const path = require('path');
const EventEmitter = require('events');
const { spawn } = require('child_process');

const { config } = require('./config');
const settingsController = require('./routes/admin/settings.controller');

const MAX_SESSION_EVENTS = 2000;
const PROVIDER_STREAM_ROUTE_PREFIX = '/admin/provider-sessions';
const SUPPORTED_SIGNALS = new Set(['SIGINT', 'SIGTERM', 'SIGKILL']);

class ProviderSessionService {
    constructor({
        spawnProcess = spawn,
        resolveCommandBinary = defaultResolveCommandBinary,
    } = {}) {
        this.spawnProcess = spawnProcess;
        this.resolveCommandBinary = resolveCommandBinary;
        this.sessions = new Map();
    }

    async listCapabilities() {
        const definitions = this.getProviderDefinitions();
        const capabilities = await Promise.all(definitions.map(async (definition) => {
            const resolved = await this.resolveProviderBinary(definition);
            const supportsSessions = Boolean(resolved.binaryPath);

            return {
                providerId: definition.providerId,
                label: definition.label,
                description: definition.description,
                supportsSessions,
                supportsResize: false,
                supportsModelSelection: false,
                status: supportsSessions ? 'ready' : 'unavailable',
                unavailableReason: supportsSessions ? null : `Command "${definition.command}" was not found on the backend PATH.`,
            };
        }));

        return capabilities;
    }

    async createSession({
        providerId = '',
        cwd = '',
        cols = 120,
        rows = 40,
        model = null,
    } = {}, ownerId = null) {
        const definition = this.getProviderDefinition(providerId);
        if (!definition) {
            const error = new Error(`Unknown provider "${providerId}"`);
            error.statusCode = 404;
            throw error;
        }

        const resolved = await this.resolveProviderBinary(definition);
        if (!resolved.binaryPath) {
            const error = new Error(`Provider "${definition.providerId}" is not installed on the backend host`);
            error.statusCode = 503;
            throw error;
        }

        const resolvedCwd = await this.resolveWorkingDirectory(cwd);
        const session = {
            id: crypto.randomUUID(),
            ownerId: normalizeOwnerId(ownerId),
            providerId: definition.providerId,
            label: definition.label,
            cwd: resolvedCwd,
            cols: normalizeTerminalSize(cols, 120),
            rows: normalizeTerminalSize(rows, 40),
            model: normalizeOptionalString(model),
            status: 'starting',
            supportsResize: false,
            supportsModelSelection: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            binaryPath: resolved.binaryPath,
            command: definition.command,
            args: [...definition.args],
            streamToken: crypto.randomBytes(24).toString('hex'),
            nextCursor: 1,
            events: [],
            bus: new EventEmitter(),
            process: null,
        };

        const env = this.buildProviderEnvironment(definition);
        const child = this.spawnProcess(resolved.binaryPath, definition.args, {
            cwd: resolvedCwd,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: needsShellExecution(resolved.binaryPath),
        });
        session.process = child;
        this.sessions.set(session.id, session);

        child.on('spawn', () => {
            session.status = 'running';
            session.updatedAt = new Date().toISOString();
            this.recordEvent(session, 'status', {
                status: 'running',
                message: `${definition.label} session started in ${resolvedCwd}`,
            });
        });

        child.stdout?.on('data', (chunk) => {
            const data = chunkToText(chunk);
            if (!data) {
                return;
            }
            this.recordEvent(session, 'output', { data });
        });

        child.stderr?.on('data', (chunk) => {
            const data = chunkToText(chunk);
            if (!data) {
                return;
            }
            this.recordEvent(session, 'output', { data });
        });

        child.on('error', (error) => {
            session.status = 'error';
            session.updatedAt = new Date().toISOString();
            this.recordEvent(session, 'status', {
                status: 'error',
                message: error.message,
            });
        });

        child.on('close', (exitCode, signal) => {
            session.status = 'exited';
            session.updatedAt = new Date().toISOString();
            this.recordEvent(session, 'exit', {
                exitCode: Number.isFinite(exitCode) ? exitCode : null,
                signal: normalizeOptionalString(signal),
            });
        });

        return {
            session: this.toPublicSession(session),
            streamUrl: `${PROVIDER_STREAM_ROUTE_PREFIX}/${encodeURIComponent(session.id)}/stream?token=${session.streamToken}`,
        };
    }

    getSession(sessionId = '', ownerId = null) {
        const session = this.sessions.get(String(sessionId || '').trim());
        if (!session) {
            return null;
        }

        if (!this.isOwnerAllowed(session, ownerId)) {
            return null;
        }

        return session;
    }

    getPublicSession(sessionId = '', ownerId = null) {
        const session = this.getSession(sessionId, ownerId);
        return session ? this.toPublicSession(session) : null;
    }

    listSessionEvents(sessionId = '', ownerId = null, afterCursor = 0) {
        const session = this.getSession(sessionId, ownerId);
        if (!session) {
            return null;
        }

        const after = normalizeCursor(afterCursor);
        return session.events
            .filter((event) => event.cursor > after)
            .map((event) => ({ ...event }));
    }

    subscribeToSession(sessionId = '', ownerId = null, handler = () => {}) {
        const session = this.getSession(sessionId, ownerId);
        if (!session) {
            return null;
        }

        const listener = (event) => {
            handler({ ...event });
        };
        session.bus.on('event', listener);

        return () => {
            session.bus.off('event', listener);
        };
    }

    validateStreamToken(sessionId = '', ownerId = null, token = '') {
        const session = this.getSession(sessionId, ownerId);
        if (!session) {
            return false;
        }

        return safeEqual(session.streamToken, String(token || '').trim());
    }

    async sendInput(sessionId = '', ownerId = null, data = '') {
        const session = this.requireSession(sessionId, ownerId);
        if (!session.process?.stdin || session.process.killed) {
            const error = new Error('Provider session stdin is unavailable');
            error.statusCode = 409;
            throw error;
        }

        await new Promise((resolve, reject) => {
            session.process.stdin.write(String(data || ''), (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        session.updatedAt = new Date().toISOString();

        return {
            success: true,
            session: this.toPublicSession(session),
        };
    }

    async sendSignal(sessionId = '', ownerId = null, signalName = 'SIGINT') {
        const session = this.requireSession(sessionId, ownerId);
        const signal = String(signalName || 'SIGINT').trim().toUpperCase();
        if (!SUPPORTED_SIGNALS.has(signal)) {
            const error = new Error(`Unsupported signal "${signalName}"`);
            error.statusCode = 400;
            throw error;
        }

        const applied = session.process?.kill(signal) === true;
        session.updatedAt = new Date().toISOString();
        this.recordEvent(session, 'status', {
            status: 'signalled',
            message: `${signal} sent`,
        });

        return {
            success: applied,
            signal,
            session: this.toPublicSession(session),
        };
    }

    async resizeSession(sessionId = '', ownerId = null, cols = 120, rows = 40) {
        const session = this.requireSession(sessionId, ownerId);
        session.cols = normalizeTerminalSize(cols, session.cols || 120);
        session.rows = normalizeTerminalSize(rows, session.rows || 40);
        session.updatedAt = new Date().toISOString();

        return {
            applied: false,
            session: this.toPublicSession(session),
        };
    }

    async deleteSession(sessionId = '', ownerId = null) {
        const session = this.requireSession(sessionId, ownerId);
        if (session.process && !session.process.killed) {
            session.process.kill('SIGTERM');
        }
        session.bus.removeAllListeners();
        this.sessions.delete(session.id);
        return {
            success: true,
            sessionId: session.id,
        };
    }

    requireSession(sessionId = '', ownerId = null) {
        const session = this.getSession(sessionId, ownerId);
        if (!session) {
            const error = new Error('Provider session not found');
            error.statusCode = 404;
            throw error;
        }
        return session;
    }

    getProviderDefinitions() {
        const builtInDefinitions = [
            {
                providerId: 'codex-cli',
                label: 'Codex CLI',
                description: 'OpenAI Codex terminal client running on the backend host.',
                command: resolveCommandOverride([
                    process.env.KIMIBUILT_CODEX_CLI_COMMAND,
                    process.env.CODEX_CLI_COMMAND,
                    process.env.KIMIBUILT_CODEX_CLI_PATH,
                    process.env.CODEX_CLI_PATH,
                ], 'codex'),
                args: resolveCommandArgs(process.env.KIMIBUILT_CODEX_CLI_ARGS || process.env.CODEX_CLI_ARGS || ''),
                sessionCommand: resolveCommandOverride([
                    process.env.KIMIBUILT_CODEX_CLI_SESSION_COMMAND,
                    process.env.CODEX_CLI_SESSION_COMMAND,
                    process.env.KIMIBUILT_CODEX_CLI_COMMAND,
                    process.env.CODEX_CLI_COMMAND,
                    process.env.KIMIBUILT_CODEX_CLI_PATH,
                    process.env.CODEX_CLI_PATH,
                ], 'codex'),
                prepareEnv: buildCodexEnvironment,
            },
            {
                providerId: 'gemini-cli',
                label: 'Gemini CLI',
                description: 'Google Gemini terminal client running on the backend host.',
                command: resolveCommandOverride([
                    process.env.KIMIBUILT_GEMINI_CLI_COMMAND,
                    process.env.GEMINI_CLI_COMMAND,
                    process.env.KIMIBUILT_GEMINI_CLI_PATH,
                    process.env.GEMINI_CLI_PATH,
                ], 'gemini'),
                args: resolveCommandArgs(process.env.KIMIBUILT_GEMINI_CLI_ARGS || process.env.GEMINI_CLI_ARGS || ''),
                sessionCommand: resolveCommandOverride([
                    process.env.KIMIBUILT_GEMINI_CLI_SESSION_COMMAND,
                    process.env.GEMINI_CLI_SESSION_COMMAND,
                    process.env.KIMIBUILT_GEMINI_CLI_COMMAND,
                    process.env.GEMINI_CLI_COMMAND,
                    process.env.KIMIBUILT_GEMINI_CLI_PATH,
                    process.env.GEMINI_CLI_PATH,
                ], 'gemini'),
                prepareEnv: (env) => env,
            },
            {
                providerId: 'kimi-cli',
                label: 'Kimi CLI',
                description: 'Moonshot Kimi terminal client running on the backend host.',
                command: resolveCommandOverride([
                    process.env.KIMIBUILT_KIMI_CLI_COMMAND,
                    process.env.KIMI_CLI_COMMAND,
                    process.env.KIMIBUILT_KIMI_CLI_PATH,
                    process.env.KIMI_CLI_PATH,
                ], 'kimi'),
                args: resolveCommandArgs(process.env.KIMIBUILT_KIMI_CLI_ARGS || process.env.KIMI_CLI_ARGS || ''),
                sessionCommand: resolveCommandOverride([
                    process.env.KIMIBUILT_KIMI_CLI_SESSION_COMMAND,
                    process.env.KIMI_CLI_SESSION_COMMAND,
                    process.env.KIMIBUILT_KIMI_CLI_COMMAND,
                    process.env.KIMI_CLI_COMMAND,
                    process.env.KIMIBUILT_KIMI_CLI_PATH,
                    process.env.KIMI_CLI_PATH,
                ], 'kimi'),
                prepareEnv: buildKimiEnvironment,
            },
        ];
        const configuredDefinitions = loadConfiguredProviderDefinitions();
        const merged = new Map();

        builtInDefinitions.forEach((definition) => {
            merged.set(definition.providerId, definition);
        });
        configuredDefinitions.forEach((definition) => {
            const existing = merged.get(definition.providerId) || {};
            merged.set(definition.providerId, {
                ...existing,
                ...definition,
                prepareEnv: existing.prepareEnv || ((env) => env),
            });
        });

        return Array.from(merged.values());
    }

    getProviderDefinition(providerId = '') {
        const normalized = String(providerId || '').trim().toLowerCase();
        return this.getProviderDefinitions().find((definition) => definition.providerId === normalized) || null;
    }

    async resolveProviderBinary(definition = {}) {
        const binaryPath = await this.resolveCommandBinary(String(definition.command || '').trim());
        return {
            ...definition,
            binaryPath,
        };
    }

    buildProviderEnvironment(definition = {}) {
        const baseEnv = {
            ...process.env,
            TERM: process.env.TERM || 'xterm-256color',
            COLORTERM: process.env.COLORTERM || 'truecolor',
        };

        if (typeof definition.prepareEnv === 'function') {
            return definition.prepareEnv(baseEnv);
        }

        return baseEnv;
    }

    async resolveWorkingDirectory(requestedCwd = '') {
        const allowedRoots = this.getAllowedWorkspaceRoots();
        const requested = normalizeOptionalString(requestedCwd);
        const candidate = path.resolve(
            requested
                || allowedRoots.find(Boolean)
                || config.deploy.defaultTargetDirectory
                || config.deploy.defaultRepositoryPath
                || process.cwd(),
        );

        let stat;
        try {
            stat = await fs.stat(candidate);
        } catch (_error) {
            const error = new Error(`Working directory "${candidate}" does not exist on the backend host`);
            error.statusCode = 400;
            throw error;
        }

        if (!stat.isDirectory()) {
            const error = new Error(`Working directory "${candidate}" is not a directory`);
            error.statusCode = 400;
            throw error;
        }

        if (allowedRoots.length > 0 && !allowedRoots.some((root) => isPathInside(candidate, root))) {
            const error = new Error(`Working directory must be inside one of: ${allowedRoots.join(', ')}`);
            error.statusCode = 400;
            throw error;
        }

        return candidate;
    }

    getAllowedWorkspaceRoots() {
        const effective = typeof settingsController.getEffectiveOpencodeConfig === 'function'
            ? settingsController.getEffectiveOpencodeConfig()
            : {};
        const roots = [
            ...(Array.isArray(effective.allowedWorkspaceRoots) ? effective.allowedWorkspaceRoots : []),
            config.deploy.defaultTargetDirectory,
            config.deploy.defaultRepositoryPath,
            process.cwd(),
        ]
            .map((entry) => normalizeOptionalString(entry))
            .filter(Boolean)
            .map((entry) => path.resolve(entry));

        return Array.from(new Set(roots));
    }

    isOwnerAllowed(session = {}, ownerId = null) {
        const normalizedOwnerId = normalizeOwnerId(ownerId);
        return normalizeOwnerId(session.ownerId) === normalizedOwnerId;
    }

    recordEvent(session = {}, eventType = 'status', payload = {}) {
        const event = {
            cursor: session.nextCursor,
            timestamp: new Date().toISOString(),
            ...payload,
        };
        session.nextCursor += 1;
        session.events.push({
            type: eventType,
            ...event,
        });
        session.updatedAt = event.timestamp;

        if (session.events.length > MAX_SESSION_EVENTS) {
            session.events.splice(0, session.events.length - MAX_SESSION_EVENTS);
        }

        session.bus.emit('event', {
            type: eventType,
            ...event,
        });
    }

    toPublicSession(session = {}) {
        return {
            id: session.id,
            providerId: session.providerId,
            label: session.label,
            cwd: session.cwd,
            status: session.status,
            model: session.model,
            cols: session.cols,
            rows: session.rows,
            supportsResize: session.supportsResize === true,
            supportsModelSelection: session.supportsModelSelection === true,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
        };
    }
}

function resolveCommandOverride(candidates = [], fallback = '') {
    for (const candidate of candidates) {
        const normalized = normalizeOptionalString(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return String(fallback || '').trim();
}

function resolveCommandArgs(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) {
        return [];
    }

    return normalized.match(/(?:[^\s"]+|"[^"]*")+/g)
        ?.map((entry) => entry.replace(/^"(.*)"$/s, '$1'))
        .filter(Boolean) || [];
}

function buildCodexEnvironment(env = {}) {
    const nextEnv = { ...env };

    if (process.env.CODEX_OPENAI_API_KEY) {
        nextEnv.OPENAI_API_KEY = process.env.CODEX_OPENAI_API_KEY;
    }
    if (process.env.CODEX_OPENAI_BASE_URL) {
        nextEnv.OPENAI_BASE_URL = process.env.CODEX_OPENAI_BASE_URL;
    } else {
        delete nextEnv.OPENAI_BASE_URL;
    }
    if (process.env.CODEX_HOME) {
        nextEnv.CODEX_HOME = process.env.CODEX_HOME;
    }

    return nextEnv;
}

function buildKimiEnvironment(env = {}) {
    const nextEnv = { ...env };

    if (process.env.KIMI_API_KEY && !nextEnv.MOONSHOT_API_KEY) {
        nextEnv.MOONSHOT_API_KEY = process.env.KIMI_API_KEY;
    }
    if (process.env.KIMI_BASE_URL && !nextEnv.MOONSHOT_BASE_URL) {
        nextEnv.MOONSHOT_BASE_URL = process.env.KIMI_BASE_URL;
    }

    return nextEnv;
}

function loadConfiguredProviderDefinitions() {
    const jsonDefinitions = parseProviderDefinitionsJson(
        process.env.KIMIBUILT_CLI_PROVIDERS_JSON || process.env.CLI_PROVIDERS_JSON || '',
    );
    if (jsonDefinitions.length > 0) {
        return jsonDefinitions;
    }

    const configPath = String(
        process.env.PROVIDERS_CONFIG_PATH
        || process.env.KIMIBUILT_PROVIDERS_CONFIG_PATH
        || path.resolve(process.cwd(), 'providers.yaml')
        || '',
    ).trim();
    if (!configPath || !fsSync.existsSync(configPath)) {
        return [];
    }

    try {
        return parseProviderDefinitionsYaml(fsSync.readFileSync(configPath, 'utf8'));
    } catch (error) {
        console.warn(`[ProviderSession] Failed to read providers config "${configPath}": ${error.message}`);
        return [];
    }
}

function parseProviderDefinitionsJson(rawValue = '') {
    const normalized = String(rawValue || '').trim();
    if (!normalized) {
        return [];
    }

    try {
        const parsed = JSON.parse(normalized);
        const list = Array.isArray(parsed) ? parsed : parsed.providers;
        return Array.isArray(list) ? list.map(normalizeProviderDefinition).filter(Boolean) : [];
    } catch (error) {
        console.warn(`[ProviderSession] Failed to parse CLI providers JSON: ${error.message}`);
        return [];
    }
}

function parseProviderDefinitionsYaml(contents = '') {
    const lines = String(contents || '').split(/\r?\n/);
    const providers = [];
    let inProviders = false;
    let current = null;

    for (const rawLine of lines) {
        const withoutComment = rawLine.replace(/\s+#.*$/, '');
        if (!withoutComment.trim()) {
            continue;
        }

        const indent = withoutComment.match(/^\s*/)?.[0].length || 0;
        const trimmed = withoutComment.trim();
        if (indent === 0) {
            inProviders = trimmed === 'providers:';
            continue;
        }
        if (!inProviders) {
            continue;
        }

        if (trimmed.startsWith('- ')) {
            if (current) {
                providers.push(current);
            }
            current = {};
            assignProviderYamlKeyValue(current, trimmed.slice(2).trim());
            continue;
        }

        if (!current) {
            continue;
        }
        assignProviderYamlKeyValue(current, trimmed);
    }

    if (current) {
        providers.push(current);
    }

    return providers.map(normalizeProviderDefinition).filter(Boolean);
}

function assignProviderYamlKeyValue(target, line = '') {
    const separator = line.indexOf(':');
    if (separator === -1) {
        return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    target[key] = String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function normalizeProviderDefinition(definition = {}) {
    if (!definition || typeof definition !== 'object') {
        return null;
    }

    const providerId = normalizeOptionalString(definition.providerId || definition.id);
    const sessionCommand = normalizeOptionalString(definition.sessionCommand || definition.command);
    if (!providerId || !sessionCommand) {
        return null;
    }

    const sessionParts = resolveCommandArgs(sessionCommand);
    const explicitArgs = Array.isArray(definition.args)
        ? definition.args.map((arg) => String(arg)).filter(Boolean)
        : resolveCommandArgs(definition.sessionArgs || definition.args || '');

    return {
        providerId: providerId.toLowerCase(),
        label: normalizeOptionalString(definition.label) || providerId,
        description: normalizeOptionalString(definition.description) || `${providerId} terminal client running on the backend host.`,
        command: sessionParts[0] || sessionCommand,
        args: [
            ...sessionParts.slice(1),
            ...explicitArgs,
        ],
        sessionCommand,
        prepareEnv: (env) => env,
    };
}

function chunkToText(chunk) {
    if (chunk == null) {
        return '';
    }

    if (Buffer.isBuffer(chunk)) {
        return chunk.toString('utf8');
    }

    return String(chunk);
}

function normalizeCursor(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeTerminalSize(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeOptionalString(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function normalizeOwnerId(ownerId = null) {
    return String(ownerId || 'anonymous').trim() || 'anonymous';
}

async function defaultResolveCommandBinary(command = '') {
    const normalized = String(command || '').trim();
    if (!normalized) {
        return null;
    }

    if (normalized.includes(path.sep) || path.isAbsolute(normalized)) {
        try {
            const stat = await fs.stat(normalized);
            return stat.isFile() ? normalized : null;
        } catch (_error) {
            return null;
        }
    }

    const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const args = process.platform === 'win32' ? [normalized] : [normalized];

    return new Promise((resolve) => {
        const child = spawn(lookupCommand, args, {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        let stdout = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunkToText(chunk);
        });

        child.on('error', () => resolve(null));
        child.on('close', (exitCode) => {
            if (exitCode !== 0) {
                resolve(null);
                return;
            }

            const firstLine = stdout
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find(Boolean);
            resolve(firstLine || null);
        });
    });
}

function isPathInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function needsShellExecution(binaryPath = '') {
    return process.platform === 'win32' && /\.(cmd|bat)$/i.test(String(binaryPath || '').trim());
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
    ProviderSessionService,
};
