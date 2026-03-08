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
