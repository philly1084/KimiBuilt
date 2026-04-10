const DEFAULT_TTS_CACHE_LIMIT = 24;
const DEFAULT_BROWSER_VOICE_ID = 'browser:default';

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
        this.diagnostics = {
            status: 'unavailable',
            binaryReachable: false,
            voicesLoaded: false,
            message: 'Voice playback is unavailable.',
        };
        this.selectedVoiceId = this.storageGet(this.storageKeys.voiceId) || '';
        this.autoPlay = this.parseBoolean(this.storageGet(this.storageKeys.autoPlay), false);
        this.loadingMessageId = '';
        this.currentMessageId = '';
        this.currentAudio = null;
        this.currentUtterance = null;
        this.cachedAudioUrls = new Map();
        this.pendingConfigPromise = null;
        this.browserSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
        this.handleBrowserVoicesChanged = this.handleBrowserVoicesChanged.bind(this);

        if (this.browserSpeechSupported && typeof window.speechSynthesis?.addEventListener === 'function') {
            window.speechSynthesis.addEventListener('voiceschanged', this.handleBrowserVoicesChanged);
        }
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
        if (window.__webChatStorageAvailable === false) {
            return null;
        }

        try {
            return localStorage.getItem(key);
        } catch (_error) {
            window.__webChatStorageAvailable = false;
            return null;
        }
    }

    storageSet(key, value) {
        if (window.sessionManager?.safeStorageSet) {
            return window.sessionManager.safeStorageSet(key, value);
        }
        if (window.__webChatStorageAvailable === false) {
            return false;
        }

        try {
            localStorage.setItem(key, value);
            return true;
        } catch (_error) {
            window.__webChatStorageAvailable = false;
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
            diagnostics: this.getDiagnostics(),
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

    getDiagnostics() {
        return {
            ...this.diagnostics,
        };
    }

    getProvider() {
        return String(this.provider || 'piper').trim() || 'piper';
    }

    getProviderLabel() {
        const provider = this.getProvider();
        if (provider === 'browser') {
            return 'Browser voice';
        }
        if (provider === 'openai') {
            return 'OpenAI';
        }
        if (provider === 'piper') {
            return 'Piper';
        }
        return 'Voice';
    }

    getStatus() {
        return String(this.diagnostics?.status || '').trim() || (this.isAvailable() ? 'ready' : 'unavailable');
    }

    isAvailable() {
        if (this.provider === 'browser') {
            return this.available === true;
        }

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
        const fallbackVoiceId = this.provider === 'browser'
            ? (this.voices[0]?.id || DEFAULT_BROWSER_VOICE_ID)
            : (this.voices[0]?.id || '');
        const nextVoiceId = matchingVoice?.id || fallbackVoiceId;

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
            return this.provider === 'browser' ? DEFAULT_BROWSER_VOICE_ID : '';
        }

        const requestedId = String(this.selectedVoiceId || '').trim();
        const matchingVoice = this.voices.find((voice) => voice.id === requestedId);
        return matchingVoice?.id || this.voices[0].id || (this.provider === 'browser' ? DEFAULT_BROWSER_VOICE_ID : '');
    }

    getSelectedVoice() {
        const voiceId = this.getSelectedVoiceId();
        return this.voices.find((voice) => voice.id === voiceId) || null;
    }

    getVoiceLabel() {
        if (this.getSelectedVoice()?.label) {
            return this.getSelectedVoice().label;
        }

        if (this.provider === 'browser') {
            return 'System voice';
        }

        if (this.provider === 'openai') {
            return 'OpenAI voice';
        }

        return 'Piper voice';
    }

    isLoadingMessage(messageId = '') {
        return Boolean(messageId) && this.loadingMessageId === String(messageId);
    }

    isPlayingMessage(messageId = '') {
        return Boolean(messageId) && this.currentMessageId === String(messageId);
    }

    getBrowserVoices() {
        if (!this.browserSpeechSupported || typeof window.speechSynthesis?.getVoices !== 'function') {
            return [{
                id: DEFAULT_BROWSER_VOICE_ID,
                label: 'System voice',
                description: 'Default browser speech synthesis voice.',
                provider: 'browser',
                voiceURI: '',
            }];
        }

        const voices = window.speechSynthesis.getVoices();
        if (!Array.isArray(voices) || voices.length === 0) {
            return [{
                id: DEFAULT_BROWSER_VOICE_ID,
                label: 'System voice',
                description: 'Default browser speech synthesis voice.',
                provider: 'browser',
                voiceURI: '',
            }];
        }

        return voices.map((voice) => ({
            id: `browser:${String(voice.voiceURI || voice.name || 'default').trim() || 'default'}`,
            label: String(voice.name || voice.voiceURI || 'System voice').trim() || 'System voice',
            description: [voice.lang, voice.default ? 'Default' : ''].filter(Boolean).join(' | '),
            provider: 'browser',
            voiceURI: String(voice.voiceURI || '').trim(),
        }));
    }

    resolveBrowserVoice(voiceId = '') {
        if (!this.browserSpeechSupported || typeof window.speechSynthesis?.getVoices !== 'function') {
            return null;
        }

        const normalizedVoiceId = String(voiceId || '').trim();
        const selectedVoice = this.voices.find((voice) => voice.id === normalizedVoiceId) || null;
        const selectedVoiceUri = String(selectedVoice?.voiceURI || '').trim();
        const voices = window.speechSynthesis.getVoices();

        if (!Array.isArray(voices) || voices.length === 0) {
            return null;
        }

        if (selectedVoiceUri) {
            return voices.find((voice) => String(voice.voiceURI || '').trim() === selectedVoiceUri) || null;
        }

        return voices.find((voice) => voice.default) || voices[0] || null;
    }

    useBrowserFallback(message = 'Browser speech synthesis is ready.') {
        this.provider = 'browser';
        this.available = this.browserSpeechSupported;
        this.voices = this.getBrowserVoices();
        this.diagnostics = {
            status: this.available ? 'ready' : 'unavailable',
            binaryReachable: this.available,
            voicesLoaded: this.voices.length > 0,
            message: this.available ? message : 'Browser speech synthesis is unavailable.',
        };

        const fallbackVoiceId = this.voices[0]?.id || DEFAULT_BROWSER_VOICE_ID;
        const requestedVoiceId = String(
            this.storageGet(this.storageKeys.voiceId)
            || this.selectedVoiceId
            || fallbackVoiceId,
        ).trim();
        const matchingVoice = this.voices.find((voice) => voice.id === requestedVoiceId);
        this.selectedVoiceId = matchingVoice?.id || fallbackVoiceId;
        this.storageSet(this.storageKeys.voiceId, this.selectedVoiceId);
    }

    handleBrowserVoicesChanged() {
        if (!this.browserSpeechSupported) {
            return;
        }

        if (this.provider !== 'browser') {
            return;
        }

        this.useBrowserFallback('Browser speech synthesis is ready.');
        this.emitStateChange('configchange');
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
            const manifestConfigured = manifest?.configured === true;
            const manifestVoices = Array.isArray(manifest?.voices) ? manifest.voices : [];
            const manifestProvider = String(manifest?.provider || 'piper').trim() || 'piper';
            const manifestProviderLabel = manifestProvider === 'openai'
                ? 'OpenAI'
                : (manifestProvider === 'browser' ? 'Browser voice' : 'Piper');
            const manifestUnavailableMessage = manifestProvider === 'openai'
                ? 'OpenAI voice playback is unavailable.'
                : 'Piper voice playback is unavailable.';
            const manifestDiagnostics = manifest?.diagnostics && typeof manifest.diagnostics === 'object'
                ? {
                    status: String(manifest.diagnostics.status || '').trim() || (manifestConfigured ? 'ready' : 'unavailable'),
                    binaryReachable: manifest.diagnostics.binaryReachable === true,
                    voicesLoaded: manifest.diagnostics.voicesLoaded === true,
                    message: String(manifest.diagnostics.message || '').trim()
                        || (manifestConfigured
                            ? `${manifestProviderLabel} is ready.`
                            : manifestUnavailableMessage),
                }
                : {
                    status: manifestConfigured ? 'ready' : 'unavailable',
                    binaryReachable: manifestConfigured,
                    voicesLoaded: manifestVoices.length > 0,
                    message: manifestConfigured
                        ? `${manifestProviderLabel} is ready.`
                        : manifestUnavailableMessage,
                };

            if (manifestConfigured && manifestVoices.length > 0) {
                this.available = true;
                this.provider = manifest?.provider || 'piper';
                this.voices = manifestVoices;
                this.diagnostics = manifestDiagnostics;

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
            } else if (this.browserSpeechSupported) {
                this.useBrowserFallback(
                    manifestDiagnostics.status === 'misconfigured'
                        ? `${manifestDiagnostics.message} Using browser speech synthesis instead.`
                        : 'Browser speech synthesis is ready.',
                );
            } else {
                this.available = false;
                this.provider = manifest?.provider || 'piper';
                this.voices = manifestVoices;
                this.diagnostics = manifestDiagnostics;
            }

            if (!this.isAvailable() && options.quiet !== true) {
                this.stop();
            }
        } catch (_error) {
            if (this.browserSpeechSupported) {
                this.useBrowserFallback('Browser speech synthesis is ready.');
            } else {
                this.available = false;
                this.provider = 'piper';
                this.voices = [];
                this.selectedVoiceId = '';
                this.diagnostics = {
                    status: 'unavailable',
                    binaryReachable: false,
                    voicesLoaded: false,
                    message: 'Voice playback is unavailable.',
                };
                this.stop();
            }
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

        if (this.browserSpeechSupported && window.speechSynthesis) {
            try {
                window.speechSynthesis.cancel();
            } catch (_error) {
                // Ignore synthesis cancellation errors.
            }
        }

        this.currentAudio = null;
        this.currentUtterance = null;
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

    cleanupUtterance(utterance) {
        if (this.currentUtterance === utterance) {
            this.currentUtterance = null;
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
            this.getProvider(),
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
            throw new Error('No audio was returned for playback.');
        }

        if (this.currentAudio || this.currentUtterance) {
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

    speakWithBrowserVoice({ messageId = '', text = '' } = {}) {
        if (!this.browserSpeechSupported || typeof window.SpeechSynthesisUtterance !== 'function') {
            throw new Error('Browser speech synthesis is unavailable.');
        }

        const normalizedText = String(text || '').trim();
        if (!normalizedText) {
            throw new Error('No text is available to read aloud.');
        }

        if (this.currentAudio || this.currentUtterance) {
            this.stop();
        }

        const utterance = new window.SpeechSynthesisUtterance(normalizedText);
        const browserVoice = this.resolveBrowserVoice(this.getSelectedVoiceId());
        if (browserVoice) {
            utterance.voice = browserVoice;
            if (browserVoice.lang) {
                utterance.lang = browserVoice.lang;
            }
        }

        utterance.onend = () => this.cleanupUtterance(utterance);
        utterance.onerror = () => this.cleanupUtterance(utterance);

        this.currentUtterance = utterance;
        this.currentMessageId = String(messageId || '').trim();
        this.loadingMessageId = '';
        this.emitStateChange();

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return true;
    }

    async speakMessage({ messageId = '', text = '' } = {}) {
        const normalizedText = String(text || '').trim();
        if (!normalizedText) {
            throw new Error('No text is available to read aloud.');
        }

        await this.ensureConfigLoaded({ quiet: true });
        if (!this.isAvailable()) {
            throw new Error('Voice playback is not available right now.');
        }

        const normalizedMessageId = String(messageId || '').trim();
        if (this.provider === 'browser') {
            return this.speakWithBrowserVoice({
                messageId: normalizedMessageId,
                text: normalizedText,
            });
        }

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
            if (this.browserSpeechSupported) {
                return this.speakWithBrowserVoice({
                    messageId: normalizedMessageId,
                    text: normalizedText,
                });
            }

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
