const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { config } = require('../config');
const { normalizeWhitespace, stripHtml, stripNullCharacters } = require('../utils/text');

const DEFAULT_VOICE_ID = 'piper-female-natural';
const DEFAULT_VOICE_LABEL = 'Female natural';
const DEFAULT_VOICE_DESCRIPTION = 'A Piper voice tuned for clear, natural female speech.';

function createServiceError(statusCode, message, code = 'tts_error') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function normalizeSpeechSentence(line = '') {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
        return '';
    }

    if (/[.!?]$/.test(trimmed)) {
        return trimmed;
    }

    if (/[:;]$/.test(trimmed)) {
        return `${trimmed.slice(0, -1)}.`;
    }

    return `${trimmed}.`;
}

function stripMarkdownForSpeech(input = '') {
    const markdown = String(input || '')
        .replace(/\r\n?/g, '\n')
        .replace(/```[\s\S]*?```/g, '\nCode example omitted.\n')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*[-*+]\s+/gm, '')
        .replace(/^\s*\d+\.\s+/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/\|/g, ' ')
        .replace(/^\s*[-=]{3,}\s*$/gm, '')
        .replace(/\n{3,}/g, '\n\n');

    return stripHtml(markdown);
}

function clampSpeechText(text = '', maxTextChars = 2400) {
    if (!text || text.length <= maxTextChars) {
        return text;
    }

    const truncated = text.slice(0, maxTextChars);
    const lastSentenceBoundary = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('! '),
        truncated.lastIndexOf('? '),
    );
    const lastWhitespace = truncated.lastIndexOf(' ');
    const safeCutoff = Math.max(lastSentenceBoundary, lastWhitespace);

    return `${(safeCutoff > 200 ? truncated.slice(0, safeCutoff) : truncated).trim()}...`;
}

function normalizeTextForSpeech(input = '', maxTextChars = 2400) {
    const stripped = stripMarkdownForSpeech(stripNullCharacters(input || ''));
    const normalized = normalizeWhitespace(stripped)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(normalizeSpeechSentence)
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    const clamped = clampSpeechText(normalized, maxTextChars);
    if (!clamped) {
        throw createServiceError(400, 'No speakable text was provided.', 'empty_text');
    }

    return clamped;
}

class PiperTtsService {
    constructor(ttsConfig = config.tts?.piper || {}) {
        this.ttsConfig = {
            ...ttsConfig,
        };
    }

    isConfigured() {
        return this.ttsConfig.enabled !== false
            && Boolean(String(this.ttsConfig.binaryPath || '').trim())
            && Boolean(String(this.ttsConfig.modelPath || '').trim());
    }

    getVoiceProfile() {
        return {
            id: String(this.ttsConfig.voiceId || DEFAULT_VOICE_ID).trim() || DEFAULT_VOICE_ID,
            label: String(this.ttsConfig.voiceLabel || DEFAULT_VOICE_LABEL).trim() || DEFAULT_VOICE_LABEL,
            description: String(this.ttsConfig.voiceDescription || DEFAULT_VOICE_DESCRIPTION).trim() || DEFAULT_VOICE_DESCRIPTION,
            provider: 'piper',
        };
    }

    getPublicConfig() {
        const configured = this.isConfigured();
        return {
            configured,
            provider: 'piper',
            maxTextChars: Math.max(200, Number(this.ttsConfig.maxTextChars) || 2400),
            defaultVoiceId: configured ? this.getVoiceProfile().id : null,
            voices: configured ? [this.getVoiceProfile()] : [],
        };
    }

    assertConfigured() {
        if (this.isConfigured()) {
            return;
        }

        throw createServiceError(
            503,
            'Piper TTS is not configured. Set PIPER_TTS_MODEL_PATH and optionally PIPER_TTS_BINARY_PATH.',
            'tts_unavailable',
        );
    }

    buildArgs(outputFile) {
        const args = [
            '--model',
            String(this.ttsConfig.modelPath || '').trim(),
            '--output_file',
            outputFile,
            '--length_scale',
            String(Number(this.ttsConfig.lengthScale) || 1.02),
            '--noise_scale',
            String(Number(this.ttsConfig.noiseScale) || 0.55),
            '--noise_w',
            String(Number(this.ttsConfig.noiseW) || 0.8),
            '--sentence_silence',
            String(Number(this.ttsConfig.sentenceSilence) || 0.24),
        ];

        const configPath = String(this.ttsConfig.configPath || '').trim();
        if (configPath) {
            args.push('--config', configPath);
        }

        if (Number.isInteger(this.ttsConfig.speakerId)) {
            args.push('--speaker', String(this.ttsConfig.speakerId));
        }

        return args;
    }

    async synthesize({ text = '', voiceId = '' } = {}) {
        this.assertConfigured();

        const selectedVoice = this.getVoiceProfile();
        if (voiceId && voiceId !== selectedVoice.id) {
            throw createServiceError(400, `Unknown Piper voice "${voiceId}".`, 'unknown_voice');
        }

        const speakableText = normalizeTextForSpeech(
            text,
            Math.max(200, Number(this.ttsConfig.maxTextChars) || 2400),
        );
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-piper-'));
        const outputFile = path.join(tempDir, 'speech.wav');
        const timeoutMs = Math.max(1000, Number(this.ttsConfig.timeoutMs) || 45000);
        const stderrChunks = [];
        let didTimeout = false;

        try {
            const args = this.buildArgs(outputFile);
            const child = spawn(String(this.ttsConfig.binaryPath || 'piper'), args, {
                windowsHide: true,
                stdio: ['pipe', 'ignore', 'pipe'],
            });

            const stderrLimit = 16000;
            child.stderr.on('data', (chunk) => {
                const nextChunk = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
                if ((stderrChunks.join('').length + nextChunk.length) <= stderrLimit) {
                    stderrChunks.push(nextChunk);
                }
            });

            const closeCode = await new Promise((resolve, reject) => {
                const timeoutId = setTimeout(() => {
                    didTimeout = true;
                    child.kill();
                }, timeoutMs);

                child.on('error', (error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });

                child.on('close', (code) => {
                    clearTimeout(timeoutId);
                    resolve(code);
                });

                child.stdin.write(`${speakableText}\n`);
                child.stdin.end();
            });

            if (didTimeout) {
                throw createServiceError(504, 'Piper TTS timed out before audio generation completed.', 'tts_timeout');
            }

            if (closeCode !== 0) {
                const stderrText = stderrChunks.join('').trim();
                throw createServiceError(
                    502,
                    stderrText ? `Piper TTS failed: ${stderrText}` : 'Piper TTS failed to generate audio.',
                    'tts_failed',
                );
            }

            const audioBuffer = await fs.readFile(outputFile);
            if (!audioBuffer?.length) {
                throw createServiceError(502, 'Piper TTS returned an empty audio file.', 'tts_empty_audio');
            }

            return {
                audioBuffer,
                contentType: 'audio/wav',
                text: speakableText,
                voice: selectedVoice,
            };
        } catch (error) {
            if (error?.code === 'ENOENT') {
                throw createServiceError(
                    503,
                    `Piper binary was not found at "${this.ttsConfig.binaryPath}".`,
                    'tts_binary_missing',
                );
            }

            if (error?.statusCode) {
                throw error;
            }

            throw createServiceError(502, error.message || 'Piper TTS failed.', 'tts_failed');
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
        }
    }
}

const piperTtsService = new PiperTtsService();

module.exports = {
    DEFAULT_VOICE_DESCRIPTION,
    DEFAULT_VOICE_ID,
    DEFAULT_VOICE_LABEL,
    PiperTtsService,
    createServiceError,
    normalizeTextForSpeech,
    piperTtsService,
    stripMarkdownForSpeech,
};
