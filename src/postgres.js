const { Pool } = require('pg');
const { config } = require('./config');

class PostgresManager {
    constructor() {
        this.pool = null;
        this.enabled = Boolean(config.postgres.url || config.postgres.password);
    }

    getConnectionConfig() {
        if (config.postgres.url) {
            return {
                connectionString: config.postgres.url,
                ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
            };
        }

        return {
            host: config.postgres.host,
            port: config.postgres.port,
            database: config.postgres.database,
            user: config.postgres.user,
            password: config.postgres.password,
            ssl: config.postgres.ssl ? { rejectUnauthorized: false } : false,
        };
    }

    getPool() {
        if (!this.enabled) {
            return null;
        }

        if (!this.pool) {
            this.pool = new Pool(this.getConnectionConfig());
            this.pool.on('error', (err) => {
                console.error('[Postgres] Pool error:', err.message);
            });
        }

        return this.pool;
    }

    async query(text, params = []) {
        const pool = this.getPool();
        if (!pool) {
            throw new Error('Postgres is not configured');
        }

        return pool.query(text, params);
    }

    async initialize() {
        if (!this.enabled) {
            return false;
        }

        await this.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                previous_response_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                message_count INTEGER NOT NULL DEFAULT 0,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb
            )
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS user_session_state (
                owner_id TEXT PRIMARY KEY,
                active_session_id TEXT NULL REFERENCES sessions(id) ON DELETE SET NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query(`
            ALTER TABLE user_session_state
            ADD COLUMN IF NOT EXISTS scoped_active_session_ids JSONB NOT NULL DEFAULT '{}'::jsonb
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS session_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query(`
            ALTER TABLE session_messages
            ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS session_runtime_state (
                session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
                state JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                parent_artifact_id TEXT NULL REFERENCES artifacts(id) ON DELETE SET NULL,
                direction TEXT NOT NULL,
                source_mode TEXT NOT NULL,
                filename TEXT NOT NULL,
                extension TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                content_bytea BYTEA NOT NULL,
                extracted_text TEXT NOT NULL DEFAULT '',
                preview_html TEXT NOT NULL DEFAULT '',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                vectorized_at TIMESTAMPTZ NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query('CREATE INDEX IF NOT EXISTS idx_artifacts_session_id ON artifacts(session_id)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_artifacts_direction ON artifacts(direction)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_artifacts_mime_type ON artifacts(mime_type)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts(created_at DESC)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_session_messages_session_id_created_at ON session_messages(session_id, created_at DESC)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_session_runtime_state_updated_at ON session_runtime_state(updated_at DESC)');

        await this.query(`
            CREATE TABLE IF NOT EXISTS agent_workloads (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'chat',
                prompt TEXT NOT NULL,
                execution JSONB NOT NULL DEFAULT '{}'::jsonb,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                callable_slug TEXT NULL,
                trigger JSONB NOT NULL DEFAULT '{}'::jsonb,
                policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                stages JSONB NOT NULL DEFAULT '[]'::jsonb,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query(`
            ALTER TABLE agent_workloads
            ADD COLUMN IF NOT EXISTS execution JSONB NOT NULL DEFAULT '{}'::jsonb
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS agent_runs (
                id TEXT PRIMARY KEY,
                workload_id TEXT NOT NULL REFERENCES agent_workloads(id) ON DELETE CASCADE,
                owner_id TEXT NOT NULL,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                status TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT 'manual',
                scheduled_for TIMESTAMPTZ NOT NULL,
                started_at TIMESTAMPTZ NULL,
                finished_at TIMESTAMPTZ NULL,
                claim_owner TEXT NULL,
                claim_expires_at TIMESTAMPTZ NULL,
                parent_run_id TEXT NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
                stage_index INTEGER NOT NULL DEFAULT 0,
                attempt INTEGER NOT NULL DEFAULT 0,
                response_id TEXT NULL,
                idempotency_key TEXT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                trace JSONB NOT NULL DEFAULT '{}'::jsonb,
                error JSONB NOT NULL DEFAULT '{}'::jsonb,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query(`
            CREATE TABLE IF NOT EXISTS agent_run_events (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await this.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_workloads_callable_slug ON agent_workloads(callable_slug) WHERE callable_slug IS NOT NULL');
        await this.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_idempotency_key ON agent_runs(idempotency_key) WHERE idempotency_key IS NOT NULL');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_workloads_session_id ON agent_workloads(session_id)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_workloads_owner_id ON agent_workloads(owner_id)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_workloads_updated_at ON agent_workloads(updated_at DESC)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_workload_id ON agent_runs(workload_id)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_session_id ON agent_runs(session_id)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_status_scheduled_for ON agent_runs(status, scheduled_for)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_runs_claim_expires_at ON agent_runs(claim_expires_at)');
        await this.query('CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_id_created_at ON agent_run_events(run_id, created_at DESC)');

        return true;
    }

    async healthCheck() {
        if (!this.enabled) {
            return false;
        }

        try {
            await this.query('SELECT 1');
            return true;
        } catch {
            return false;
        }
    }
}

const postgres = new PostgresManager();

module.exports = { postgres, PostgresManager };
