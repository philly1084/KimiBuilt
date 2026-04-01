'use strict';

const WebSocket = require('ws');

const sessionConnections = new Map();
const adminConnections = new Set();

function registerSessionConnection(ws, sessionId) {
    if (!ws || !sessionId) {
        return;
    }

    const key = String(sessionId);
    if (!sessionConnections.has(key)) {
        sessionConnections.set(key, new Set());
    }

    sessionConnections.get(key).add(ws);
    ws.__sessionSubscriptions = ws.__sessionSubscriptions || new Set();
    ws.__sessionSubscriptions.add(key);
}

function unregisterSessionConnection(ws, sessionId = null) {
    if (!ws) {
        return;
    }

    const targets = sessionId
        ? [String(sessionId)]
        : Array.from(ws.__sessionSubscriptions || []);

    targets.forEach((key) => {
        const bucket = sessionConnections.get(key);
        if (!bucket) {
            return;
        }
        bucket.delete(ws);
        if (bucket.size === 0) {
            sessionConnections.delete(key);
        }
    });

    if (!sessionId) {
        ws.__sessionSubscriptions = new Set();
    } else if (ws.__sessionSubscriptions) {
        ws.__sessionSubscriptions.delete(String(sessionId));
    }
}

function registerAdminConnection(ws) {
    if (ws) {
        adminConnections.add(ws);
    }
}

function unregisterAdminConnection(ws) {
    if (ws) {
        adminConnections.delete(ws);
    }
}

function broadcastToSession(sessionId, payload = {}) {
    const message = JSON.stringify(payload);
    const bucket = sessionConnections.get(String(sessionId || ''));
    if (!bucket) {
        return 0;
    }

    let sent = 0;
    bucket.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
            sent += 1;
        }
    });
    return sent;
}

function broadcastToAdmins(payload = {}) {
    const message = JSON.stringify(payload);
    let sent = 0;
    adminConnections.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
            sent += 1;
        }
    });
    return sent;
}

module.exports = {
    broadcastToAdmins,
    broadcastToSession,
    registerAdminConnection,
    registerSessionConnection,
    unregisterAdminConnection,
    unregisterSessionConnection,
};
