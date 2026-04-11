const BASE_SOUND_CUES = {
    'thinking-start': {
        id: 'thinking-start',
        group: 'assistant',
        cooldown: 420,
        previewGain: 1.04,
        notes: [
            {
                frequency: 420,
                slideTo: 472,
                duration: 0.068,
                volume: 0.04,
                pan: -0.08,
                type: 'triangle',
                attack: 0.01,
                decay: 0.03,
                sustain: 0.48,
                cutoff: 1640,
                cutoffTo: 1220,
            },
            {
                delay: 0.05,
                frequency: 612,
                slideTo: 660,
                duration: 0.082,
                volume: 0.032,
                pan: 0.1,
                type: 'sine',
                attack: 0.012,
                decay: 0.036,
                sustain: 0.4,
                cutoff: 2100,
                cutoffTo: 1560,
                shimmer: true,
            },
        ],
    },
    ack: {
        id: 'ack',
        group: 'assistant',
        cooldown: 120,
        previewGain: 1.08,
        notes: [
            {
                frequency: 604,
                slideTo: 676,
                duration: 0.074,
                volume: 0.068,
                pan: -0.15,
                type: 'triangle',
                attack: 0.012,
                decay: 0.04,
                sustain: 0.56,
                cutoff: 1800,
                cutoffTo: 1260,
                vibratoRate: 5.1,
                vibratoDepth: 7,
                detuneJitter: 3,
            },
            {
                delay: 0.034,
                frequency: 912,
                slideTo: 1018,
                duration: 0.056,
                volume: 0.03,
                pan: 0.12,
                type: 'sine',
                attack: 0.01,
                decay: 0.03,
                sustain: 0.48,
                cutoff: 2500,
                cutoffTo: 1760,
                shimmer: true,
                detuneJitter: 5,
            },
            {
                delay: 0.008,
                frequency: 302,
                slideTo: 288,
                duration: 0.08,
                volume: 0.017,
                pan: 0.02,
                type: 'sine',
                attack: 0.012,
                decay: 0.04,
                sustain: 0.52,
                cutoff: 920,
                cutoffTo: 700,
            },
        ],
    },
    response: {
        id: 'response',
        group: 'assistant',
        cooldown: 900,
        previewGain: 1.05,
        notes: [
            {
                frequency: 492,
                slideTo: 548,
                duration: 0.095,
                volume: 0.066,
                pan: -0.14,
                type: 'triangle',
                attack: 0.016,
                decay: 0.05,
                sustain: 0.68,
                cutoff: 1580,
                cutoffTo: 1100,
                vibratoRate: 4.8,
                vibratoDepth: 5,
                detuneJitter: 2,
            },
            {
                delay: 0.078,
                frequency: 738,
                slideTo: 842,
                duration: 0.124,
                volume: 0.078,
                pan: 0.12,
                type: 'triangle',
                attack: 0.016,
                decay: 0.058,
                sustain: 0.72,
                cutoff: 2080,
                cutoffTo: 1440,
                shimmer: true,
                detuneJitter: 4,
            },
            {
                delay: 0.142,
                frequency: 1108,
                slideTo: 1180,
                duration: 0.11,
                volume: 0.022,
                pan: 0.18,
                type: 'sine',
                attack: 0.012,
                decay: 0.04,
                sustain: 0.48,
                cutoff: 2860,
                cutoffTo: 1900,
            },
        ],
    },
    survey: {
        id: 'survey',
        group: 'assistant',
        cooldown: 1200,
        previewGain: 1.04,
        notes: [
            {
                frequency: 452,
                slideTo: 486,
                duration: 0.09,
                volume: 0.052,
                pan: -0.2,
                type: 'triangle',
                attack: 0.013,
                decay: 0.044,
                sustain: 0.58,
                cutoff: 1450,
                cutoffTo: 1080,
            },
            {
                delay: 0.092,
                frequency: 624,
                slideTo: 704,
                duration: 0.102,
                volume: 0.06,
                pan: 0.02,
                type: 'triangle',
                attack: 0.014,
                decay: 0.046,
                sustain: 0.62,
                cutoff: 1820,
                cutoffTo: 1320,
                detuneJitter: 3,
            },
            {
                delay: 0.184,
                frequency: 828,
                slideTo: 948,
                duration: 0.136,
                volume: 0.08,
                pan: 0.18,
                type: 'triangle',
                attack: 0.016,
                decay: 0.058,
                sustain: 0.74,
                cutoff: 2200,
                cutoffTo: 1520,
                shimmer: true,
                vibratoRate: 5.6,
                vibratoDepth: 6,
                detuneJitter: 4,
            },
            {
                delay: 0.228,
                frequency: 414,
                slideTo: 394,
                duration: 0.142,
                volume: 0.014,
                pan: -0.04,
                type: 'sine',
                attack: 0.01,
                decay: 0.05,
                sustain: 0.44,
                cutoff: 760,
                cutoffTo: 620,
            },
        ],
    },
    'menu-open': {
        id: 'menu-open',
        group: 'menu',
        cooldown: 120,
        previewGain: 1.1,
        notes: [
            {
                frequency: 398,
                slideTo: 516,
                duration: 0.06,
                volume: 0.036,
                pan: -0.1,
                type: 'triangle',
                attack: 0.01,
                decay: 0.032,
                sustain: 0.46,
                cutoff: 1620,
                cutoffTo: 1180,
            },
            {
                delay: 0.034,
                frequency: 604,
                slideTo: 724,
                duration: 0.048,
                volume: 0.028,
                pan: 0.08,
                type: 'sine',
                attack: 0.009,
                decay: 0.026,
                sustain: 0.42,
                cutoff: 2140,
                cutoffTo: 1580,
                shimmer: true,
            },
        ],
    },
    'menu-close': {
        id: 'menu-close',
        group: 'menu',
        cooldown: 120,
        previewGain: 1.1,
        notes: [
            {
                frequency: 618,
                slideTo: 520,
                duration: 0.056,
                volume: 0.034,
                pan: 0.1,
                type: 'triangle',
                attack: 0.009,
                decay: 0.03,
                sustain: 0.42,
                cutoff: 1680,
                cutoffTo: 1240,
            },
            {
                delay: 0.026,
                frequency: 506,
                slideTo: 412,
                duration: 0.05,
                volume: 0.024,
                pan: -0.08,
                type: 'sine',
                attack: 0.009,
                decay: 0.024,
                sustain: 0.38,
                cutoff: 1500,
                cutoffTo: 980,
            },
        ],
    },
    'menu-select': {
        id: 'menu-select',
        group: 'menu',
        cooldown: 72,
        previewGain: 1.12,
        notes: [
            {
                frequency: 568,
                slideTo: 644,
                duration: 0.046,
                volume: 0.028,
                pan: 0.04,
                type: 'triangle',
                attack: 0.008,
                decay: 0.022,
                sustain: 0.36,
                cutoff: 1880,
                cutoffTo: 1440,
                shimmer: true,
                detuneJitter: 2,
            },
            {
                delay: 0.01,
                frequency: 286,
                slideTo: 278,
                duration: 0.048,
                volume: 0.012,
                pan: -0.02,
                type: 'sine',
                attack: 0.008,
                decay: 0.024,
                sustain: 0.34,
                cutoff: 820,
                cutoffTo: 660,
            },
        ],
    },
};

const SOUND_THEMES = {
    orbit: {
        id: 'orbit',
        label: 'Orbit',
        description: 'Clean synth pulses with a crisp sci-fi edge.',
        assistantSemitones: 0,
        menuSemitones: 0,
        assistantPrimaryType: 'triangle',
        menuPrimaryType: 'triangle',
        assistantAccentType: 'sine',
        menuAccentType: 'sine',
        shimmerType: 'sine',
        noteGain: 1,
        outputGain: 1,
        previewGainMultiplier: 1,
        durationMultiplier: 1,
        menuDurationMultiplier: 0.98,
        attackMultiplier: 1,
        decayMultiplier: 1,
        sustainMultiplier: 1,
        cutoffMultiplier: 1,
        vibratoMultiplier: 1,
        panMultiplier: 1,
        detuneJitter: 0,
        brightness: -4,
        brightnessFrequency: 2400,
        compressorThreshold: -28,
        compressorRatio: 3,
        compressorRelease: 0.16,
    },
    bloom: {
        id: 'bloom',
        label: 'Bloom',
        description: 'Softer rounded chimes that feel calmer and warmer.',
        assistantSemitones: -3,
        menuSemitones: -2,
        assistantPrimaryType: 'sine',
        menuPrimaryType: 'sine',
        assistantAccentType: 'triangle',
        menuAccentType: 'triangle',
        shimmerType: 'triangle',
        noteGain: 0.92,
        outputGain: 0.94,
        previewGainMultiplier: 1.03,
        durationMultiplier: 1.12,
        menuDurationMultiplier: 1.08,
        attackMultiplier: 1.2,
        decayMultiplier: 1.14,
        sustainMultiplier: 1.08,
        cutoffMultiplier: 0.84,
        vibratoMultiplier: 0.55,
        panMultiplier: 0.78,
        detuneJitter: 1,
        brightness: -6,
        brightnessFrequency: 2200,
        compressorThreshold: -30,
        compressorRatio: 2.6,
        compressorRelease: 0.2,
    },
    quartz: {
        id: 'quartz',
        label: 'Quartz',
        description: 'Brighter glass-like taps with sharper articulation.',
        assistantSemitones: 2,
        menuSemitones: 4,
        assistantPrimaryType: 'triangle',
        menuPrimaryType: 'sine',
        assistantAccentType: 'sine',
        menuAccentType: 'sine',
        shimmerType: 'sine',
        noteGain: 0.94,
        outputGain: 1,
        previewGainMultiplier: 1.06,
        durationMultiplier: 0.94,
        menuDurationMultiplier: 0.92,
        attackMultiplier: 0.86,
        decayMultiplier: 0.9,
        sustainMultiplier: 0.9,
        cutoffMultiplier: 1.24,
        vibratoMultiplier: 0.72,
        panMultiplier: 1.08,
        detuneJitter: 2,
        brightness: -1.5,
        brightnessFrequency: 2600,
        compressorThreshold: -27,
        compressorRatio: 2.8,
        compressorRelease: 0.14,
    },
    arcade: {
        id: 'arcade',
        label: 'Arcade',
        description: 'Punchier retro bleeps with a more playful chip feel.',
        assistantSemitones: 5,
        menuSemitones: 7,
        assistantPrimaryType: 'square',
        menuPrimaryType: 'square',
        assistantAccentType: 'triangle',
        menuAccentType: 'triangle',
        shimmerType: 'triangle',
        noteGain: 0.74,
        outputGain: 0.9,
        previewGainMultiplier: 0.98,
        durationMultiplier: 0.82,
        menuDurationMultiplier: 0.8,
        attackMultiplier: 0.66,
        decayMultiplier: 0.76,
        sustainMultiplier: 0.82,
        cutoffMultiplier: 0.8,
        vibratoMultiplier: 0.35,
        panMultiplier: 0.72,
        detuneJitter: 4,
        brightness: -5,
        brightnessFrequency: 2100,
        compressorThreshold: -31,
        compressorRatio: 4.1,
        compressorRelease: 0.12,
    },
    sonar: {
        id: 'sonar',
        label: 'Sonar',
        description: 'Deeper tactical pings with a steadier low-end body.',
        assistantSemitones: -5,
        menuSemitones: -7,
        assistantPrimaryType: 'triangle',
        menuPrimaryType: 'triangle',
        assistantAccentType: 'sine',
        menuAccentType: 'sine',
        shimmerType: 'sine',
        noteGain: 1.02,
        outputGain: 1.04,
        previewGainMultiplier: 1,
        durationMultiplier: 1.08,
        menuDurationMultiplier: 1.02,
        attackMultiplier: 1.06,
        decayMultiplier: 1.08,
        sustainMultiplier: 1.04,
        cutoffMultiplier: 0.78,
        vibratoMultiplier: 0.42,
        panMultiplier: 0.66,
        detuneJitter: 1,
        brightness: -7,
        brightnessFrequency: 2000,
        compressorThreshold: -29,
        compressorRatio: 3.5,
        compressorRelease: 0.18,
    },
};

const DEFAULT_SOUND_PROFILE_ID = 'orbit';
const DEFAULT_SOUND_VOLUME = 0.68;
const SOUND_MASTER_GAIN_SCALE = 1;
const SOUND_MASTER_GAIN_MAX = 1;
const SOUND_MASTER_GAIN_MIN = 0;

class WebChatSoundManager {
    constructor() {
        this.storageKeys = {
            enabled: 'kimibuilt_sound_cues_enabled',
            menuEnabled: 'kimibuilt_menu_sounds_enabled',
            profile: 'kimibuilt_sound_profile',
            volume: 'kimibuilt_sound_volume',
        };
        this.audioContext = null;
        this.masterInput = null;
        this.masterGain = null;
        this.masterToneFilter = null;
        this.masterCompressor = null;
        this.lastPlayedAt = new Map();
        this.activeVoices = new Map();
        this.unlockListenersInstalled = false;
        this.idleSuspendTimer = null;
        this.boundUnlock = () => {
            void this.unlock();
        };
        this.enabled = this.parseBoolean(this.storageGet(this.storageKeys.enabled), false);
        this.menuEnabled = this.parseBoolean(this.storageGet(this.storageKeys.menuEnabled), false);
        this.soundProfileId = this.normalizeSoundProfileId(
            this.storageGet(this.storageKeys.profile),
            DEFAULT_SOUND_PROFILE_ID,
        );
        this.volume = this.normalizeVolume(
            this.storageGet(this.storageKeys.volume),
            DEFAULT_SOUND_VOLUME,
        );

        this.syncUnlockListeners();
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

    clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value || 0)));
    }

    normalizeSoundProfileId(value, fallback = DEFAULT_SOUND_PROFILE_ID) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized && SOUND_THEMES[normalized]) {
            return normalized;
        }

        return fallback;
    }

    normalizeVolume(value, fallback = DEFAULT_SOUND_VOLUME) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }

        if (parsed > 1) {
            return this.clamp(parsed / 100, 0, 1);
        }

        return this.clamp(parsed, 0, 1);
    }

    transposeFrequency(frequency, semitones = 0) {
        return Number(frequency || 440) * Math.pow(2, Number(semitones || 0) / 12);
    }

    hasActivePreferences() {
        return this.enabled === true || this.menuEnabled === true;
    }

    getSoundProfiles() {
        return Object.values(SOUND_THEMES).map((profile) => ({
            id: profile.id,
            label: profile.label,
            description: profile.description,
        }));
    }

    getSoundProfileId() {
        return this.soundProfileId;
    }

    getSoundProfile() {
        return SOUND_THEMES[this.soundProfileId] || SOUND_THEMES[DEFAULT_SOUND_PROFILE_ID];
    }

    setSoundProfile(value) {
        this.soundProfileId = this.normalizeSoundProfileId(value);
        this.storageSet(this.storageKeys.profile, this.soundProfileId);
        this.applyMasteringProfile();
    }

    getVolume() {
        return this.volume;
    }

    setVolume(value) {
        this.volume = this.normalizeVolume(value, this.volume);
        this.storageSet(this.storageKeys.volume, this.volume.toFixed(2));
        this.applyMasteringProfile();
    }

    refreshFromStorage() {
        this.enabled = this.parseBoolean(this.storageGet(this.storageKeys.enabled), false);
        this.menuEnabled = this.parseBoolean(this.storageGet(this.storageKeys.menuEnabled), false);
        this.soundProfileId = this.normalizeSoundProfileId(
            this.storageGet(this.storageKeys.profile),
            DEFAULT_SOUND_PROFILE_ID,
        );
        this.volume = this.normalizeVolume(
            this.storageGet(this.storageKeys.volume),
            DEFAULT_SOUND_VOLUME,
        );
        this.syncUnlockListeners();
        this.applyMasteringProfile();
    }

    syncUnlockListeners() {
        if (this.hasActivePreferences()) {
            this.installUnlockListeners();
            return;
        }

        this.removeUnlockListeners();
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

    applyMasteringProfile() {
        if (!this.masterGain || !this.masterToneFilter || !this.masterCompressor) {
            return;
        }

        const profile = this.getSoundProfile();
        this.masterToneFilter.type = 'highshelf';
        this.masterToneFilter.frequency.value = Number(profile.brightnessFrequency || 2400);
        this.masterToneFilter.gain.value = Number(profile.brightness || -4);

        this.masterCompressor.threshold.value = Number(profile.compressorThreshold || -28);
        this.masterCompressor.knee.value = 18;
        this.masterCompressor.ratio.value = Number(profile.compressorRatio || 3);
        this.masterCompressor.attack.value = 0.004;
        this.masterCompressor.release.value = Number(profile.compressorRelease || 0.16);

        const requestedGain = Number(profile.outputGain || 1) * this.volume * SOUND_MASTER_GAIN_SCALE;
        this.masterGain.gain.value = this.clamp(
            Number.isFinite(requestedGain) ? requestedGain : 0.2,
            SOUND_MASTER_GAIN_MIN,
            SOUND_MASTER_GAIN_MAX,
        );
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
            const masterInput = context.createGain();
            const toneFilter = context.createBiquadFilter();
            const compressor = context.createDynamicsCompressor();
            const masterGain = context.createGain();

            masterInput.gain.value = 1;
            masterInput.connect(toneFilter);
            toneFilter.connect(compressor);
            compressor.connect(masterGain);
            masterGain.connect(context.destination);

            this.audioContext = context;
            this.masterInput = masterInput;
            this.masterGain = masterGain;
            this.masterToneFilter = toneFilter;
            this.masterCompressor = compressor;
            this.applyMasteringProfile();
            return context;
        } catch (_error) {
            return null;
        }
    }

    cancelIdleSuspend() {
        if (!this.idleSuspendTimer) {
            return;
        }

        clearTimeout(this.idleSuspendTimer);
        this.idleSuspendTimer = null;
    }

    countActiveVoices() {
        let count = 0;
        this.activeVoices.forEach((voices) => {
            count += voices.size;
        });
        return count;
    }

    queueIdleSuspend(delayMs = 280) {
        if (!this.audioContext || this.hasActivePreferences()) {
            return;
        }

        this.cancelIdleSuspend();
        this.idleSuspendTimer = window.setTimeout(() => {
            if (!this.audioContext || this.hasActivePreferences()) {
                return;
            }

            if (this.countActiveVoices() > 0) {
                this.queueIdleSuspend(delayMs);
                return;
            }

            if (this.audioContext.state === 'running') {
                void this.audioContext.suspend().catch(() => null);
            }
        }, delayMs);
    }

    async unlock() {
        const context = this.ensureAudioContext();
        if (!context) {
            return null;
        }

        this.cancelIdleSuspend();

        if (context.state === 'suspended') {
            try {
                await context.resume();
            } catch (_error) {
                if (this.hasActivePreferences()) {
                    this.installUnlockListeners();
                }
                return null;
            }
        }

        if (context.state === 'running') {
            this.removeUnlockListeners();
            return context;
        }

        if (this.hasActivePreferences()) {
            this.installUnlockListeners();
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
        this.syncUnlockListeners();

        if (this.enabled) {
            void this.unlock();
            return;
        }

        this.queueIdleSuspend();
    }

    setMenuEnabled(value) {
        this.menuEnabled = value === true;
        this.storageSet(this.storageKeys.menuEnabled, this.menuEnabled ? 'true' : 'false');
        this.syncUnlockListeners();

        if (this.menuEnabled) {
            void this.unlock();
            return;
        }

        this.queueIdleSuspend();
    }

    getThemedWaveType(note, group, theme) {
        const noteType = String(note?.type || 'triangle');
        const sourceFrequency = Number(note?.frequency || 0);
        const isAccent = noteType === 'sine' && sourceFrequency >= 480;

        if (group === 'menu') {
            if (isAccent && theme.menuAccentType) {
                return theme.menuAccentType;
            }

            if (noteType === 'triangle' && theme.menuPrimaryType) {
                return theme.menuPrimaryType;
            }

            return noteType;
        }

        if (isAccent && theme.assistantAccentType) {
            return theme.assistantAccentType;
        }

        if (noteType === 'triangle' && theme.assistantPrimaryType) {
            return theme.assistantPrimaryType;
        }

        return noteType;
    }

    buildThemedNote(note, group, theme) {
        const semitones = group === 'menu'
            ? Number(theme.menuSemitones || 0)
            : Number(theme.assistantSemitones || 0);
        const durationMultiplier = group === 'menu'
            ? Number(theme.menuDurationMultiplier || theme.durationMultiplier || 1)
            : Number(theme.durationMultiplier || 1);

        return {
            ...note,
            type: this.getThemedWaveType(note, group, theme),
            shimmerType: theme.shimmerType || 'sine',
            shimmerGainMultiplier: Number(theme.shimmerGainMultiplier || 1),
            frequency: this.transposeFrequency(note.frequency || 440, semitones),
            slideTo: this.transposeFrequency(note.slideTo || note.frequency || 440, semitones),
            volume: Number(note.volume || 0.05) * Number(theme.noteGain || 1),
            duration: Number(note.duration || 0.06) * durationMultiplier,
            attack: Number(note.attack || 0.014) * Number(theme.attackMultiplier || 1),
            decay: Number(note.decay || 0.04) * Number(theme.decayMultiplier || 1),
            sustain: this.clamp(
                Number(note.sustain || 0.56) * Number(theme.sustainMultiplier || 1),
                0.2,
                0.95,
            ),
            cutoff: Number(note.cutoff || 1700) * Number(theme.cutoffMultiplier || 1),
            cutoffTo: Number(note.cutoffTo || note.cutoff || 1400) * Number(theme.cutoffMultiplier || 1),
            vibratoDepth: Number(note.vibratoDepth || 0) * Number(theme.vibratoMultiplier || 1),
            pan: Number(note.pan || 0) * Number(theme.panMultiplier || 1),
            detuneJitter: Number(note.detuneJitter || 0) + Number(theme.detuneJitter || 0),
        };
    }

    getCueConfig(kind = '') {
        const key = String(kind || '').trim().toLowerCase();
        const baseCue = BASE_SOUND_CUES[key] || BASE_SOUND_CUES['menu-select'];
        const theme = this.getSoundProfile();

        return {
            ...baseCue,
            previewGain: Number(baseCue.previewGain || 1) * Number(theme.previewGainMultiplier || 1),
            notes: baseCue.notes.map((note) => this.buildThemedNote(note, baseCue.group, theme)),
        };
    }

    isCueAllowed(cue, preview = false) {
        if (!cue) {
            return false;
        }

        if (!preview) {
            if (cue.group === 'menu') {
                if (!this.isMenuEnabled()) {
                    return false;
                }
            } else if (!this.isEnabled()) {
                return false;
            }
        }

        const now = Date.now();
        const lastPlayedAt = this.lastPlayedAt.get(cue.id) || 0;
        const cooldown = preview ? 0 : Number(cue.cooldown || 180);
        if (!preview && now - lastPlayedAt < cooldown) {
            return false;
        }

        this.lastPlayedAt.set(cue.id, now);
        return true;
    }

    registerVoice(group, voiceRef) {
        if (!group || !voiceRef?.oscillator) {
            return;
        }

        const voices = this.activeVoices.get(group) || new Set();
        voices.add(voiceRef);
        this.activeVoices.set(group, voices);

        voiceRef.oscillator.onended = () => {
            voices.delete(voiceRef);
            if (!voices.size) {
                this.activeVoices.delete(group);
            }

            if (!this.hasActivePreferences()) {
                this.queueIdleSuspend();
            }
        };
    }

    fadeOutGroup(context, group, atTime, fadeDuration = 0.04) {
        const voices = this.activeVoices.get(group);
        if (!voices?.size) {
            return;
        }

        voices.forEach((voiceRef) => {
            if (!voiceRef || voiceRef.isStopping) {
                return;
            }

            voiceRef.isStopping = true;
            const fadeStart = Math.max(context.currentTime, atTime);
            const fadeEnd = fadeStart + fadeDuration;
            const stopAt = Math.max(fadeEnd + 0.02, Number(voiceRef.startAt || fadeStart) + 0.02);

            if (voiceRef.gainNode?.gain) {
                if (typeof voiceRef.gainNode.gain.cancelAndHoldAtTime === 'function') {
                    voiceRef.gainNode.gain.cancelAndHoldAtTime(fadeStart);
                } else {
                    voiceRef.gainNode.gain.cancelScheduledValues(fadeStart);
                    voiceRef.gainNode.gain.setValueAtTime(
                        Math.max(0.0001, Number(voiceRef.peakVolume || 0.02) * 0.42),
                        fadeStart,
                    );
                }
                voiceRef.gainNode.gain.exponentialRampToValueAtTime(0.0001, fadeEnd);
            }

            try {
                voiceRef.oscillator.stop(stopAt);
            } catch (_error) {
                // Ignore repeated stop calls.
            }

            (voiceRef.modulators || []).forEach((oscillator) => {
                try {
                    oscillator.stop(stopAt);
                } catch (_error) {
                    // Ignore repeated stop calls.
                }
            });
        });
    }

    async play(kind = '', options = {}) {
        const cue = this.getCueConfig(kind);
        const preview = options?.preview === true;
        if (!this.isCueAllowed(cue, preview)) {
            return false;
        }

        const context = await this.unlock();
        if (!context || !this.masterInput) {
            return false;
        }

        const baseTime = context.currentTime + 0.012;
        this.fadeOutGroup(context, cue.group, baseTime);

        const gainScale = preview
            ? Number(cue.previewGain || 1.05)
            : 1;

        cue.notes.forEach((note) => {
            this.scheduleNote(context, baseTime, note, {
                gainScale,
                group: cue.group,
            });
        });

        return true;
    }

    scheduleNote(context, baseTime, note = {}, options = {}) {
        const startAt = baseTime + Number(note.delay || 0);
        const duration = Math.max(0.035, Number(note.duration || 0.06));
        const endAt = startAt + duration;
        const detuneJitter = Number(note.detuneJitter || 0);
        const detune = Number(note.detune || 0) + (
            detuneJitter
                ? (Math.random() * 2 - 1) * detuneJitter
                : 0
        );

        this.scheduleVoice(context, startAt, endAt, {
            type: note.type || 'triangle',
            frequency: Number(note.frequency || 440),
            slideTo: Number(note.slideTo || note.frequency || 440),
            volume: Number(note.volume || 0.05) * Number(options.gainScale || 1),
            pan: Number(note.pan || 0),
            cutoff: Number(note.cutoff || 1700),
            cutoffTo: Number(note.cutoffTo || note.cutoff || 1400),
            attack: Number(note.attack || 0.014),
            decay: Number(note.decay || 0.04),
            sustain: Number(note.sustain || 0.56),
            vibratoRate: Number(note.vibratoRate || 0),
            vibratoDepth: Number(note.vibratoDepth || 0),
            detune,
            group: options.group,
        });

        if (note.shimmer) {
            this.scheduleVoice(context, startAt + 0.004, endAt, {
                type: note.shimmerType || 'sine',
                frequency: Number(note.frequency || 440) * 2,
                slideTo: Number(note.slideTo || note.frequency || 440) * 2.01,
                volume: Number(note.volume || 0.05)
                    * Number(options.gainScale || 1)
                    * 0.26
                    * Number(note.shimmerGainMultiplier || 1),
                pan: Number(note.pan || 0) * -0.5,
                cutoff: Number(note.cutoff || 1700) + 920,
                cutoffTo: Number(note.cutoffTo || note.cutoff || 1400) + 620,
                attack: Number(note.attack || 0.014) * 0.78,
                decay: Number(note.decay || 0.04) * 0.78,
                sustain: this.clamp(Number(note.sustain || 0.56) * 0.72, 0.2, 0.9),
                detune: detune + 8,
                group: options.group,
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
        const safeEnd = Math.max(safeStart + 0.024, endAt);
        const duration = safeEnd - safeStart;
        const peakVolume = Math.max(0.0001, Number(voice.volume || 0.04));
        const targetFrequency = Math.max(40, Number(voice.frequency || 440));
        const slideTarget = Math.max(40, Number(voice.slideTo || targetFrequency));
        const attackEnd = Math.min(
            safeEnd - 0.012,
            safeStart + Math.min(duration * 0.34, Number(voice.attack || 0.014)),
        );
        const decayEnd = Math.min(
            safeEnd - 0.01,
            attackEnd + Math.min(duration * 0.38, Number(voice.decay || 0.04)),
        );
        const sustainLevel = peakVolume * this.clamp(Number(voice.sustain || 0.56), 0.22, 0.95);
        const modulators = [];

        oscillator.type = voice.type || 'triangle';
        oscillator.frequency.setValueAtTime(targetFrequency, safeStart);
        oscillator.frequency.exponentialRampToValueAtTime(slideTarget, safeEnd);
        oscillator.detune.setValueAtTime(Number(voice.detune || 0), safeStart);

        if (Number(voice.vibratoDepth || 0) > 0 && Number(voice.vibratoRate || 0) > 0) {
            const vibratoOscillator = context.createOscillator();
            const vibratoGain = context.createGain();

            vibratoOscillator.type = 'sine';
            vibratoOscillator.frequency.setValueAtTime(Number(voice.vibratoRate || 5), safeStart);
            vibratoGain.gain.setValueAtTime(Number(voice.vibratoDepth || 0), safeStart);

            vibratoOscillator.connect(vibratoGain);
            vibratoGain.connect(oscillator.detune);
            vibratoOscillator.start(safeStart);
            vibratoOscillator.stop(safeEnd + 0.04);
            modulators.push(vibratoOscillator);
        }

        filter.type = 'lowpass';
        filter.Q.value = 0.86;
        filter.frequency.setValueAtTime(Math.max(480, Number(voice.cutoff || 1800)), safeStart);
        filter.frequency.exponentialRampToValueAtTime(
            Math.max(420, Number(voice.cutoffTo || voice.cutoff || 1400)),
            safeEnd,
        );

        gain.gain.setValueAtTime(0.0001, safeStart);
        gain.gain.exponentialRampToValueAtTime(peakVolume, Math.max(safeStart + 0.008, attackEnd));

        if (decayEnd > attackEnd + 0.004) {
            gain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
        }

        gain.gain.exponentialRampToValueAtTime(0.0001, safeEnd);

        oscillator.connect(filter);
        filter.connect(gain);

        if (panNode) {
            panNode.pan.setValueAtTime(this.clamp(Number(voice.pan || 0), -0.85, 0.85), safeStart);
            gain.connect(panNode);
            panNode.connect(this.masterInput);
        } else {
            gain.connect(this.masterInput);
        }

        const voiceRef = {
            oscillator,
            gainNode: gain,
            peakVolume,
            startAt: safeStart,
            modulators,
        };

        this.registerVoice(String(voice.group || ''), voiceRef);

        oscillator.start(safeStart);
        oscillator.stop(safeEnd + 0.03);
    }
}

window.WebChatSoundManager = WebChatSoundManager;
