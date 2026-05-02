'use strict';

const express = require('express');
const cors = require('cors');
const request = require('supertest');

const { buildCorsOptions, createRateLimit } = require('./security');

describe('security middleware', () => {
    test('allows configured CORS origins and same-origin requests', async () => {
        const app = express();
        app.use(cors(buildCorsOptions({
            allowedOrigins: ['https://kimibuilt.example'],
        })));
        app.get('/ok', (_req, res) => res.json({ ok: true }));

        const allowed = await request(app)
            .get('/ok')
            .set('Origin', 'https://kimibuilt.example')
            .expect(200);
        expect(allowed.headers['access-control-allow-origin']).toBe('https://kimibuilt.example');

        await request(app)
            .get('/ok')
            .expect(200);
    });

    test('rejects unlisted CORS origins', async () => {
        const app = express();
        app.use(cors(buildCorsOptions({
            allowedOrigins: ['https://kimibuilt.example'],
        })));
        app.get('/ok', (_req, res) => res.json({ ok: true }));
        app.use((err, _req, res, _next) => {
            res.status(err.statusCode || 500).json({ code: err.code });
        });

        const response = await request(app)
            .get('/ok')
            .set('Origin', 'https://evil.example')
            .expect(403);

        expect(response.body.code).toBe('cors_origin_denied');
    });

    test('rate limits repeated login attempts', async () => {
        const app = express();
        app.post('/api/auth/login', createRateLimit({
            name: 'login-test',
            max: 1,
            windowMs: 60000,
        }), (_req, res) => res.json({ ok: true }));

        await request(app).post('/api/auth/login').expect(200);
        const response = await request(app).post('/api/auth/login').expect(429);
        expect(response.body.error.code).toBe('rate_limited');
    });

    test('rate limits tool invocation paths independently', async () => {
        const app = express();
        app.post('/api/tools/invoke/:id?', createRateLimit({
            name: 'tool-test',
            max: 1,
            windowMs: 60000,
        }), (_req, res) => res.json({ ok: true }));

        await request(app).post('/api/tools/invoke/web-fetch').expect(200);
        const response = await request(app).post('/api/tools/invoke/web-fetch').expect(429);
        expect(response.body.error.code).toBe('rate_limited');
    });
});
