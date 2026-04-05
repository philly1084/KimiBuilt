class WebChatSoundManager {
    constructor() {
        this.storageKeys = {
            enabled: 'kimibuilt_sound_cues_enabled',
            menuEnabled: 'kimibuilt_menu_sounds_enabled',
        };
        this.audioContext = null;
        this.masterGain = null;
        this.lastPlayedAt = new Map();
        this.unlockListenersInstalled = false;
        this.boundUnlock = () => {
            void this.unlock();
        };
        this.enabled = this.parseBoolean(this.storageGet(this.storageKeys.enabled), false);
        this.menuEnabled = this.parseBoolean(this.storageGet(this.storageKeys.menuEnabled), false);

        this.installUnlockListeners();
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

    installUnlockListeners() {
        if (this.unlockListenersInstalled) {
            return;
        }

        this.unlockListenersInstalled = true;
        ['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
            window.addEventListener(eventName, this.boundUnlock, { passive: true, capture: true });
        });
    }

    removeUnlockListeners() {
        if (!this.unlockListenersInstalled) {
            return;
        }

        this.unlockListenersInstalled = false;
        ['pointerdown', 'touchstart', 'keydown'].forEach((eventName) => {
            window.removeEventListener(eventName, this.boundUnlock, { capture: true });
        });
    }

    ensureAudioContext() {
        if (this.audioContext) {
            return this.audioContext;
        }

        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) {
            return null;
        }

        try {
            const context = new AudioContextCtor();
            const masterGain = context.createGain();
            masterGain.gain.value = 0.17;
            masterGain.connect(context.destination);

            this.audioContext = context;
            this.masterGain = masterGain;
            return context;
        } catch (_error) {
            return null;
        }
    }

    async unlock() {
        const context = this.ensureAudioContext();
        if (!context) {
            return null;
        }

        if (context.state === 'suspended') {
            try {
                await context.resume();
            } catch (_error) {
                return null;
            }
        }

        if (context.state === 'running') {
            this.removeUnlockListeners();
            return context;
        }

        return null;
    }

    isEnabled() {
        return this.enabled === true;
    }

    isMenuEnabled() {
        return this.menuEnabled === true;
    }

    setEnabled(value) {
        this.enabled = value === true;
        this.storageSet(this.storageKeys.enabled, this.enabled ? 'true' : 'false');
    }

    setMenuEnabled(value) {
        this.menuEnabled = value === true;
        this.storageSet(this.storageKeys.menuEnabled, this.menuEnabled ? 'true' : 'false');
    }

    getCooldown(kind = '') {
        const key = String(kind || '').trim().toLowerCase();
        switch (key) {
            case 'ack':
                return 120;
            case 'response':
                return 900;
            case 'survey':
                return 1200;
            case 'menu-open':
            case 'menu-close':
                return 110;
            case 'menu-select':
                return 80;
            default:
                return 180;
        }
    }

    isCueAllowed(kind = '', preview = false) {
        const key = String(kind || '').trim().toLowerCase();

        if (!preview) {
            if (!this.isEnabled()) {
                return false;
            }

            if (key.startsWith('menu') && !this.isMenuEnabled()) {
                return false;
            }
        }

        const now = Date.now();
        const lastPlayedAt = this.lastPlayedAt.get(key) || 0;
        const cooldown = preview ? 0 : this.getCooldown(key);
        if (!preview && now - lastPlayedAt < cooldown) {
            return false;
        }

        this.lastPlayedAt.set(key, now);
        return true;
    }

    getPattern(kind = '') {
        const key = String(kind || '').trim().toLowerCase();

        switch (key) {
            case 'ack':
                return [
                    { frequency: 612, slideTo: 684, duration: 0.065, volume: 0.085, pan: -0.08 },
                    { delay: 0.045, frequency: 918, slideTo: 964, duration: 0.05, volume: 0.045, pan: 0.1, shimmer: true },
                ];
            case 'response':
                return [
                    { frequency: 524, slideTo: 608, duration: 0.09, volume: 0.09, pan: -0.12 },
                    { delay: 0.085, frequency: 698, slideTo: 820, duration: 0.11, volume: 0.082, pan: 0.14, shimmer: true },
                ];
            case 'survey':
                return [
                    { frequency: 466, slideTo: 520, duration: 0.085, volume: 0.085, pan: -0.18 },
                    { delay: 0.095, frequency: 698, slideTo: 740, duration: 0.1, volume: 0.09, pan: 0.06, shimmer: true },
                    { delay: 0.205, frequency: 932, slideTo: 1048, duration: 0.13, volume: 0.1, pan: 0.18, shimmer: true },
                ];
            case 'menu-open':
                return [
                    { frequency: 420, slideTo: 520, duration: 0.055, volume: 0.05, pan: -0.1 },
                    { delay: 0.045, frequency: 612, slideTo: 700, duration: 0.05, volume: 0.04, pan: 0.08, shimmer: true },
                ];
            case 'menu-close':
                return [
                    { frequency: 620, slideTo: 520, duration: 0.055, volume: 0.05, pan: 0.1 },
                    { delay: 0.042, frequency: 508, slideTo: 420, duration: 0.05, volume: 0.038, pan: -0.08 },
                ];
            case 'menu-select':
            default:
                return [
                    { frequency: 560, slideTo: 640, duration: 0.05, volume: 0.046, pan: 0.02, shimmer: true },
                ];
        }
    }

    async play(kind = '', options = {}) {
        const preview = options?.preview === true;
        if (!this.isCueAllowed(kind, preview)) {
            return false;
        }

        const context = await this.unlock();
        if (!context || !this.masterGain) {
            return false;
        }

        const baseTime = context.currentTime + 0.01;
        const pattern = this.getPattern(kind);
        pattern.forEach((note) => {
            this.scheduleNote(context, baseTime, note);
        });

        return true;
    }

    scheduleNote(context, baseTime, note = {}) {
        const startAt = baseTime + Number(note.delay || 0);
        const duration = Math.max(0.035, Number(note.duration || 0.06));
        const endAt = startAt + duration;

        this.scheduleVoice(context, startAt, endAt, {
            type: note.type || 'triangle',
            frequency: Number(note.frequency || 440),
            slideTo: Number(note.slideTo || note.frequency || 440),
            volume: Number(note.volume || 0.05),
            pan: Number(note.pan || 0),
            cutoff: Number(note.cutoff || 1700),
        });

        if (note.shimmer) {
            this.scheduleVoice(context, startAt + 0.005, endAt, {
                type: 'sine',
                frequency: Number(note.frequency || 440) * 2,
                slideTo: Number(note.slideTo || note.frequency || 440) * 2.02,
                volume: Number(note.volume || 0.05) * 0.32,
                pan: Number(note.pan || 0) * -0.55,
                cutoff: Number(note.cutoff || 1700) + 900,
            });
        }
    }

    scheduleVoice(context, startAt, endAt, voice = {}) {
        const oscillator = context.createOscillator();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();
        const panNode = typeof context.createStereoPanner === 'function'
            ? context.createStereoPanner()
            : null;
        const safeStart = Math.max(context.currentTime, startAt);
        const safeEnd = Math.max(safeStart + 0.02, endAt);
        const peakVolume = Math.max(0.0001, Number(voice.volume || 0.04));
        const targetFrequency = Math.max(40, Number(voice.frequency || 440));
        const slideTarget = Math.max(40, Number(voice.slideTo || targetFrequency));

        oscillator.type = voice.type || 'triangle';
        oscillator.frequency.setValueAtTime(targetFrequency, safeStart);
        oscillator.frequency.exponentialRampToValueAtTime(slideTarget, safeEnd);

        filter.type = 'lowpass';
        filter.Q.value = 0.8;
        filter.frequency.setValueAtTime(Math.max(500, Number(voice.cutoff || 1800)), safeStart);

        gain.gain.setValueAtTime(0.0001, safeStart);
        gain.gain.exponentialRampToValueAtTime(peakVolume, safeStart + 0.016);
        gain.gain.exponentialRampToValueAtTime(0.0001, safeEnd);

        oscillator.connect(filter);
        filter.connect(gain);

        if (panNode) {
            panNode.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, Number(voice.pan || 0))), safeStart);
            gain.connect(panNode);
            panNode.connect(this.masterGain);
        } else {
            gain.connect(this.masterGain);
        }

        oscillator.start(safeStart);
        oscillator.stop(safeEnd + 0.02);
    }
}

window.WebChatSoundManager = WebChatSoundManager;
