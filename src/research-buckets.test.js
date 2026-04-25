const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { ResearchBucketService } = require('./research-buckets');

describe('ResearchBucketService', () => {
    let tempDir;
    let service;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-research-bucket-'));
        service = new ResearchBucketService({
            rootPath: path.join(tempDir, 'research-buckets', 'shared'),
        });
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    test('creates default folder structure and manifest', async () => {
        const initialized = await service.ensureInitialized();
        const entries = await fs.readdir(initialized.rootPath);

        expect(entries).toEqual(expect.arrayContaining([
            'images',
            'data',
            'graphs',
            'code',
            'audio',
            'docs',
            'notes',
            'refs',
            'bucket.json',
        ]));

        const manifest = JSON.parse(await fs.readFile(initialized.manifestPath, 'utf8'));
        expect(manifest).toEqual(expect.objectContaining({
            version: 1,
            categories: expect.arrayContaining(['images', 'data', 'graphs', 'code']),
            entries: [],
        }));
    });

    test('rejects unsafe paths and traversal attempts', async () => {
        expect(() => service.resolveSafePath('../secret.txt')).toThrow('traversal');
        expect(() => service.resolveSafePath(path.join(tempDir, 'secret.txt'))).toThrow('relative');
        expect(() => service.resolveSafePath('refs/.git/config')).toThrow('.git');
        expect(() => service.resolveSafePath('code/node_modules/pkg/index.js')).toThrow('node_modules');
    });

    test('writes and reads UTF-8 text content', async () => {
        const written = await service.write({
            path: 'brief.md',
            category: 'docs',
            content: '# Design Brief\n\nUse a dense, operational dashboard layout.',
            tags: ['design', 'dashboard'],
            description: 'Dashboard design notes',
        });

        expect(written.path).toBe('docs/brief.md');
        expect(written.entry).toEqual(expect.objectContaining({
            category: 'docs',
            mimeType: 'text/markdown',
            tags: ['design', 'dashboard'],
            description: 'Dashboard design notes',
            preview: expect.stringContaining('operational dashboard'),
        }));

        const preview = await service.read({
            path: 'docs/brief.md',
            mode: 'preview',
        });
        const content = await service.read({
            path: 'docs/brief.md',
            mode: 'content',
        });

        expect(preview.content).toContain('Design Brief');
        expect(content.content).toContain('dense, operational dashboard layout');
    });

    test('writes and reads base64 binary content', async () => {
        const payload = Buffer.from('RIFF fake wav bytes', 'utf8').toString('base64');
        const written = await service.write({
            path: 'intro.wav',
            category: 'audio',
            content: payload,
            encoding: 'base64',
            mimeType: 'audio/wav',
            tags: 'voiceover,intro',
        });

        expect(written.path).toBe('audio/intro.wav');
        expect(written.entry).toEqual(expect.objectContaining({
            category: 'audio',
            mimeType: 'audio/wav',
            tags: ['voiceover', 'intro'],
        }));

        const metadataOnly = await service.read({
            path: 'audio/intro.wav',
            mode: 'preview',
        });
        const base64 = await service.read({
            path: 'audio/intro.wav',
            mode: 'base64',
        });

        expect(metadataOnly).not.toHaveProperty('content');
        expect(Buffer.from(base64.content, 'base64').toString('utf8')).toBe('RIFF fake wav bytes');
    });

    test('lists by category and tags', async () => {
        await service.write({
            path: 'brief.md',
            category: 'docs',
            content: 'Dashboard notes',
            tags: ['dashboard'],
        });
        await service.write({
            path: 'palette.json',
            category: 'data',
            content: '{"primary":"#0f766e"}',
            tags: ['design'],
        });

        const docs = await service.list({ category: 'docs' });
        const design = await service.list({ tags: ['design'] });

        expect(docs.results.map((entry) => entry.path)).toEqual(['docs/brief.md']);
        expect(design.results.map((entry) => entry.path)).toEqual(['data/palette.json']);
    });

    test('searches text files with snippets and limits', async () => {
        await service.write({
            path: 'docs/research.md',
            content: 'The pricing table should compare starter, growth, and enterprise plans.',
            tags: ['pricing'],
        });
        await service.write({
            path: 'docs/other.md',
            content: 'Unrelated notes',
        });

        const results = await service.search({
            query: 'enterprise plans',
            glob: 'docs/**/*.md',
            limit: 1,
            includeSnippets: true,
        });

        expect(results.count).toBe(1);
        expect(results.results[0]).toEqual(expect.objectContaining({
            path: 'docs/research.md',
            snippet: expect.stringContaining('enterprise plans'),
        }));
    });
});
