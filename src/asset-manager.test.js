const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AssetManager, hasAssetReferenceIntent } = require('./asset-manager');

describe('AssetManager', () => {
    test('indexes workspace documents and images during search refresh', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-assets-workspace-'));
        const docsDir = path.join(tempDir, 'docs');
        const imagesDir = path.join(tempDir, 'images');
        await fs.mkdir(docsDir, { recursive: true });
        await fs.mkdir(imagesDir, { recursive: true });
        await fs.writeFile(
            path.join(docsDir, 'pricing-brief.md'),
            '# Pricing Brief\n\nAtlantic package starts at $799 with flights from Halifax at $214.',
            'utf8',
        );
        await fs.writeFile(path.join(imagesDir, 'hero-shot.png'), 'png-bytes', 'utf8');

        const manager = new AssetManager({
            projectRoot: tempDir,
            stateDir: path.join(tempDir, '.state'),
            indexFilePath: path.join(tempDir, 'asset-index.json'),
            workspaceRoots: [tempDir],
            artifactStore: {
                listAllWithSessions: jest.fn(async () => []),
            },
            postgres: {
                enabled: false,
            },
        });

        const documentResults = await manager.searchAssets({
            query: 'pricing halifax',
            kind: 'document',
            includeContent: true,
            refresh: true,
        });
        const imageResults = await manager.searchAssets({
            query: 'hero shot',
            kind: 'image',
        });

        expect(documentResults.count).toBe(1);
        expect(documentResults.results[0]).toEqual(expect.objectContaining({
            sourceType: 'workspace',
            filename: 'pricing-brief.md',
            contentPreview: expect.stringContaining('Atlantic package starts at $799'),
        }));
        expect(imageResults.results[0]).toEqual(expect.objectContaining({
            sourceType: 'workspace',
            filename: 'hero-shot.png',
            kind: 'image',
        }));
    });

    test('stores artifact entries with owner scoping and removes them cleanly', async () => {
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kimibuilt-assets-artifacts-'));
        const manager = new AssetManager({
            projectRoot: tempDir,
            stateDir: path.join(tempDir, '.state'),
            indexFilePath: path.join(tempDir, 'asset-index.json'),
            workspaceRoots: [tempDir],
            artifactStore: {
                listAllWithSessions: jest.fn(async () => []),
            },
            postgres: {
                enabled: true,
            },
        });

        await manager.upsertArtifact({
            id: 'artifact-1',
            sessionId: 'session-1',
            filename: 'vendor-pricing.pdf',
            extension: 'pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1200,
            extractedText: 'Vendor pricing confirmed for the Halifax rollout.',
            metadata: {
                tags: ['pricing', 'vendor'],
            },
            createdAt: '2026-04-06T10:00:00.000Z',
            updatedAt: '2026-04-06T10:05:00.000Z',
        }, {
            ownerId: 'phill',
        });

        const ownerResults = await manager.searchAssets({
            query: 'vendor pricing',
            kind: 'document',
        }, {
            ownerId: 'phill',
        });
        const otherOwnerResults = await manager.searchAssets({
            query: 'vendor pricing',
            kind: 'document',
        }, {
            ownerId: 'someone-else',
        });

        expect(ownerResults.count).toBe(1);
        expect(ownerResults.results[0]).toEqual(expect.objectContaining({
            sourceType: 'artifact',
            artifactId: 'artifact-1',
            downloadUrl: '/api/artifacts/artifact-1/download',
        }));
        expect(otherOwnerResults.count).toBe(0);

        await manager.removeArtifact('artifact-1');
        const removedResults = await manager.searchAssets({
            query: 'vendor pricing',
            kind: 'document',
        }, {
            ownerId: 'phill',
        });

        expect(removedResults.count).toBe(0);
    });

    test('recognizes prompts that should trigger the indexed asset catalog', () => {
        expect(hasAssetReferenceIntent('Use the PDF we worked on earlier and the same image from before.')).toBe(true);
        expect(hasAssetReferenceIntent('Build a brand new landing page from scratch.')).toBe(false);
    });
});
