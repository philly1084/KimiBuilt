const DEFAULT_TTS_CACHE_LIMIT = 24;

class WebChatTtsManager extends EventTarget {
    constructor() {
        super();
        this.storageKeys = {
            autoPlay: 'kimibuilt_tts_autoplay',
            voiceId: 'kimibuilt_tts_voice_id',
        };
        this.available = false;
        this.provider = 'piper';
        this.voices = [];
        this.selectedVoiceId = this.storageGet(this.storageKeys.voiceId) || '';
        this.autoPlay = this.parseBoolean(this.storageGet(this.storageKeys.autoPlay), false);
        this.loadingMessageId = '';
        this.currentMessageId = '';
        this.currentAudio = null;
        this.cachedAudioUrls = new Map();
        this.pendingConfigPromise = null;
    }

    parseBoolean(value, fallback = false) {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (!normalized) {
            return fallback;
        }

        if (['1', 'true', 'yes', 'on'].includes(normalized)) {
            return true;
        }

        if (['0', 'false', 'no', 'off'].includes(normalized)) {
            return false;
        }

        return fallback;
    }

    storageGet(key) {
        if (window.sessionManager?.safeStorageGet) {
            return window.sessionManager.safeStorageGet(key);
        }

        try {
            return localStorage.getItem(key);
        } catch (_error) {
            return null;
        }
    }

    storageSet(key, value) {
        if (window.sessionManager?.safeStorageSet) {
            return window.sessionManager.safeStorageSet(key, value);
        }

        try {
            localStorage.setItem(key, value);
            return true;
        } catch (_error) {
            return false;
        }
    }

    emitStateChange(eventName = 'statechange') {
        this.dispatchEvent(new CustomEvent(eventName, {
            detail: this.getState(),
        }));
    }

    getState() {
        return {
            available: this.available,
            provider: this.provider,
            voices: this.getVoices(),
            selectedVoiceId: this.getSelectedVoiceId(),
            autoPlay: this.isAutoPlayEnabled(),
            loadingMessageId: this.loadingMessageId,
            currentMessageId: this.currentMessageId,
        };
    }

    getVoices() {
        return Array.isArray(this.voices)
            ? this.voices.map((voice) => ({ ...voice }))
            : [];
    }

    isAvailable() {
        return this.available === true && this.voices.length > 0;
    }

    isAutoPlayEnabled() {
        return this.autoPlay === true;
    }

    setAutoPlayEnabled(value) {
        this.autoPlay = value === true;
        this.storageSet(this.storageKeys.autoPlay, this.autoPlay ? 'true' : 'false');
        this.emitStateChange('configchange');
    }

    setSelectedVoiceId(voiceId = '') {
        const requestedVoiceId = String(voiceId || '').trim();
        const matchingVoice = this.voices.find((voice) => voice.id === requestedVoiceId);
        const nextVoiceId = matchingVoice?.id || this.voices[0]?.id || '';

        if (this.selectedVoiceId === nextVoiceId) {
            return;
        }

        this.selectedVoiceId = nextVoiceId;
        if (this.selectedVoiceId) {
            this.storageSet(this.storageKeys.voiceId, this.selectedVoiceId);
        }
        this.stop();
        this.emitStateChange('configchange');
    }

    getSelectedVoiceId() {
        if (!this.voices.length) {
            return '';
        }

        const requestedId = String(this.selectedVoiceId || '').trim();
        const matchingVoice = this.voices.find((voice) => voice.id === requestedId);
        return matchingVoice?.id || this.voices[0].id;
    }

    getSelectedVoice() {
        const voiceId = this.getSelectedVoiceId();
        return this.voices.find((voice) => voice.id === voiceId) || null;
    }

    getVoiceLabel() {
        return this.getSelectedVoice()?.label || 'Piper voice';
    }

    isLoadingMessage(messageId = '') {
        return Boolean(messageId) && this.loadingMessageId === String(messageId);
    }

    isPlayingMessage(messageId = '') {
        return Boolean(messageId) && this.currentMessageId === String(messageId);
    }

    async ensureConfigLoaded(options = {}) {
        if (this.pendingConfigPromise && options.force !== true) {
            return this.pendingConfigPromise;
        }

        this.pendingConfigPromise = this.loadConfig(options)
            .finally(() => {
                this.pendingConfigPromise = null;
            });

        return this.pendingConfigPromise;
    }

    async loadConfig(options = {}) {
        try {
            const manifest = await window.apiClient?.getTtsVoices?.();
            this.available = manifest?.configured === true;
            this.provider = manifest?.provider || 'piper';
            this.voices = Array.isArray(manifest?.voices) ? manifest.voices : [];

            const fallbackVoiceId = String(manifest?.defaultVoiceId || this.voices[0]?.id || '').trim();
            const requestedVoiceId = String(
                this.storageGet(this.storageKeys.voiceId)
                || this.selectedVoiceId
                || fallbackVoiceId,
            ).trim();
            const matchingVoice = this.voices.find((voice) => voice.id === requestedVoiceId);
            this.selectedVoiceId = matchingVoice?.id || fallbackVoiceId;

            if (this.selectedVoiceId) {
                this.storageSet(this.storageKeys.voiceId, this.selectedVoiceId);
            }

            if (!this.isAvailable() && options.quiet !== true) {
                this.stop();
            }
        } catch (_error) {
            this.available = false;
            this.voices = [];
            this.selectedVoiceId = '';
            this.stop();
        }

        this.emitStateChange('configchange');
        return this.getState();
    }

    stop() {
        if (this.currentAudio) {
            try {
                this.currentAudio.pause();
                this.currentAudio.currentTime = 0;
            } catch (_error) {
                // Ignore media cleanup errors.
            }
        }

        this.currentAudio = null;
        this.currentMessageId = '';
        this.loadingMessageId = '';
        this.emitStateChange();
    }

    cleanupAudio(audio) {
        if (this.currentAudio === audio) {
            this.currentAudio = null;
            this.currentMessageId = '';
        }

        this.loadingMessageId = '';
        this.emitStateChange();
    }

    hashText(value = '') {
        let hash = 0;
        const source = String(value || '');
        for (let index = 0; index < source.length; index += 1) {
            hash = ((hash << 5) - hash) + source.charCodeAt(index);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    buildCacheKey(messageId = '', text = '') {
        return [
            this.getSelectedVoiceId(),
            String(messageId || '').trim() || this.hashText(text),
            this.hashText(text),
        ].join(':');
    }

    trimCache() {
        while (this.cachedAudioUrls.size > DEFAULT_TTS_CACHE_LIMIT) {
            const oldest = this.cachedAudioUrls.keys().next().value;
            const objectUrl = this.cachedAudioUrls.get(oldest);
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
            this.cachedAudioUrls.delete(oldest);
        }
    }

    async playAudioUrl(audioUrl, messageId = '') {
        if (!audioUrl) {
            throw new Error('No audio was returned by Piper.');
        }

        if (this.currentAudio) {
            this.stop();
        }

        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        audio.onended = () => this.cleanupAudio(audio);
        audio.onerror = () => this.cleanupAudio(audio);
        this.currentAudio = audio;
        this.currentMessageId = String(messageId || '').trim();
        this.loadingMessageId = '';
        this.emitStateChange();

        try {
            await audio.play();
            return true;
        } catch (error) {
            this.cleanupAudio(audio);
            throw error;
        }
    }

    async speakMessage({ messageId = '', text = '' } = {}) {
        const normalizedText = String(text || '').trim();
        if (!normalizedText) {
            throw new Error('No text is available to read aloud.');
        }

        await this.ensureConfigLoaded({ quiet: true });
        if (!this.isAvailable()) {
            throw new Error('Piper voice playback is not configured on the server.');
        }

        const normalizedMessageId = String(messageId || '').trim();
        const cacheKey = this.buildCacheKey(normalizedMessageId, normalizedText);
        const cachedAudioUrl = this.cachedAudioUrls.get(cacheKey);
        if (cachedAudioUrl) {
            return this.playAudioUrl(cachedAudioUrl, normalizedMessageId);
        }

        this.loadingMessageId = normalizedMessageId;
        this.currentMessageId = '';
        this.emitStateChange();

        try {
            const result = await window.apiClient?.synthesizeSpeech?.(normalizedText, {
                voiceId: this.getSelectedVoiceId(),
            });
            const audioUrl = URL.createObjectURL(result.blob);
            this.cachedAudioUrls.set(cacheKey, audioUrl);
            this.trimCache();
            return this.playAudioUrl(audioUrl, normalizedMessageId);
        } catch (error) {
            this.loadingMessageId = '';
            this.currentMessageId = '';
            this.emitStateChange();
            throw error;
        }
    }

    async toggleMessagePlayback({ messageId = '', text = '' } = {}) {
        const normalizedMessageId = String(messageId || '').trim();
        if (this.isLoadingMessage(normalizedMessageId)) {
            return false;
        }

        if (this.isPlayingMessage(normalizedMessageId)) {
            this.stop();
            return false;
        }

        return this.speakMessage({
            messageId: normalizedMessageId,
            text,
        });
    }
}

window.WebChatTtsManager = WebChatTtsManager;
