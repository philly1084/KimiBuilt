const { Router } = require('express');
const { sessionStore } = require('../session-store');

const router = Router();
const NOTES_NAMESPACE = 'notes';
const MAX_NOTES_PAYLOAD_BYTES = 20 * 1024 * 1024;

function getRequestOwnerId(req) {
    return String(req.user?.username || '').trim() || null;
}

function parseJsonPreference(value = '', fallback = null) {
    if (typeof value !== 'string' || !value.trim()) {
        return fallback;
    }

    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function normalizeString(value = null, fallback = null) {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

function normalizeNotesData(input = null) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return null;
    }

    return {
        ...input,
        pages: Array.isArray(input.pages) ? input.pages : [],
        trash: Array.isArray(input.trash) ? input.trash : [],
        spaces: Array.isArray(input.spaces)
            ? input.spaces
            : [{ id: 'private', name: 'Private', createdAt: Date.now(), updatedAt: Date.now() }],
        currentSpaceId: normalizeString(input.currentSpaceId, 'private'),
        updatedAt: input.updatedAt || new Date().toISOString(),
    };
}

function serializeNotesData(data) {
    const normalized = normalizeNotesData(data);
    if (!normalized) {
        return null;
    }

    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_NOTES_PAYLOAD_BYTES) {
        const error = new Error('Notes payload is too large');
        error.statusCode = 413;
        throw error;
    }

    return serialized;
}

async function loadNotesPreferences(ownerId) {
    return sessionStore.getUserPreferences(ownerId, NOTES_NAMESPACE);
}

router.get('/', async (req, res, next) => {
    try {
        const preferences = await loadNotesPreferences(getRequestOwnerId(req));
        const data = normalizeNotesData(parseJsonPreference(preferences.data, null));

        res.json({
            data,
            currentPageId: normalizeString(preferences.currentPageId, null),
            globalModel: normalizeString(preferences.globalModel, null),
            updatedAt: normalizeString(preferences.updatedAt, null),
            synced: Boolean(data),
        });
    } catch (err) {
        next(err);
    }
});

router.put('/', async (req, res, next) => {
    try {
        const patch = {
            updatedAt: new Date().toISOString(),
        };

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'data')) {
            patch.data = serializeNotesData(req.body.data);
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'currentPageId')) {
            patch.currentPageId = normalizeString(req.body.currentPageId, '') || null;
        }

        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'globalModel')) {
            patch.globalModel = normalizeString(req.body.globalModel, 'gpt-4o');
        }

        const preferences = await sessionStore.patchUserPreferences(
            getRequestOwnerId(req),
            NOTES_NAMESPACE,
            patch,
        );

        res.json({
            data: normalizeNotesData(parseJsonPreference(preferences.data, null)),
            currentPageId: normalizeString(preferences.currentPageId, null),
            globalModel: normalizeString(preferences.globalModel, null),
            updatedAt: normalizeString(preferences.updatedAt, null),
            synced: true,
        });
    } catch (err) {
        next(err);
    }
});

router.delete('/', async (req, res, next) => {
    try {
        await sessionStore.patchUserPreferences(
            getRequestOwnerId(req),
            NOTES_NAMESPACE,
            {
                data: null,
                currentPageId: null,
                globalModel: null,
                updatedAt: null,
            },
        );

        res.status(204).end();
    } catch (err) {
        next(err);
    }
});

module.exports = router;
module.exports._private = {
    normalizeNotesData,
    serializeNotesData,
};
