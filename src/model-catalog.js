function normalizeModelId(modelId = '') {
    return String(modelId || '').trim();
}

const NON_CHAT_MODEL_TOKENS = [
    'embed',
    'embedding',
    'text-embedding',
    'image',
    'image-gen',
    'image_generation',
    'image-generation',
    'gpt-image',
    'dall-e',
    'dalle',
    'recraft',
    'ideogram',
    'imagen',
    'flux',
    'sdxl',
    'stable-diffusion',
    'diffusion',
    'tts',
    'speech',
    'audio',
    'transcribe',
    'whisper',
    'realtime',
    'moderation',
    'omni-moderation',
    'vision-preview',
    'preview-tools',
    '-tools',
];

function isPublicChatModel(modelId = '') {
    const normalizedId = normalizeModelId(modelId).toLowerCase();
    if (!normalizedId) {
        return false;
    }

    return !NON_CHAT_MODEL_TOKENS.some((token) => normalizedId.includes(token));
}

function toPublicModelRecord(model = {}) {
    return {
        id: model.id,
        object: model.object || 'model',
        created: model.created || Math.floor(Date.now() / 1000),
        owned_by: model.owned_by || 'unknown',
    };
}

function toPublicChatModelList(models = []) {
    const seen = new Set();

    return models
        .filter((model) => isPublicChatModel(model?.id))
        .filter((model) => {
            const normalizedId = normalizeModelId(model?.id);
            if (!normalizedId || seen.has(normalizedId)) {
                return false;
            }

            seen.add(normalizedId);
            return true;
        })
        .map((model) => toPublicModelRecord(model));
}

module.exports = {
    NON_CHAT_MODEL_TOKENS,
    isPublicChatModel,
    toPublicChatModelList,
    toPublicModelRecord,
};
