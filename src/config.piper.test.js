const path = require('path');

const ORIGINAL_ENV = process.env;

describe('config bundled Piper defaults', () => {
    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...ORIGINAL_ENV,
        };

        delete process.env.PIPER_TTS_BINARY_PATH;
        delete process.env.PIPER_TTS_VOICES_PATH;
        delete process.env.PIPER_TTS_VOICES_JSON;
        delete process.env.PIPER_TTS_MODEL_PATH;
        delete process.env.PIPER_TTS_CONFIG_PATH;
        delete process.env.PIPER_TTS_DEFAULT_VOICE_ID;
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    test('loads the bundled Piper voice manifest and chooses the rich default voice when explicit env overrides are absent', () => {
        const { config } = require('./config');

        expect(config.tts.provider).toBe('piper');
        expect(
            config.tts.piper.binaryPath === 'piper'
            || config.tts.piper.binaryPath.includes(path.join('data', 'piper', 'runtime', 'piper')),
        ).toBe(true);
        expect(config.tts.piper.voicesPath).toContain(path.join('data', 'piper', 'voices', 'manifest.json'));
        expect(config.tts.piper.voices).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'amy-medium' }),
            expect.objectContaining({ id: 'amy-broadcast' }),
            expect.objectContaining({ id: 'hfc-female-rich' }),
        ]));
        expect(config.tts.piper.defaultVoiceId).toBe('hfc-female-rich');
    });
});
