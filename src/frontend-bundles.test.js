const {
    buildFrontendBundleArtifact,
    readFrontendBundleArchive,
} = require('./frontend-bundles');

describe('frontend bundle styling safety net', () => {
    test('adds a stylesheet file and links unstyled html pages', () => {
        const artifact = buildFrontendBundleArtifact({
            entry: 'index.html',
            files: [
                {
                    path: 'index.html',
                    language: 'html',
                    content: '<!DOCTYPE html><html><head><title>Ops</title></head><body><main data-dashboard-zone="hero"><h1>Ops</h1></main></body></html>',
                },
                {
                    path: 'reports/index.html',
                    language: 'html',
                    content: '<!DOCTYPE html><html><head><title>Reports</title></head><body><main><h1>Reports</h1></main></body></html>',
                },
            ],
        }, 'Ops Dashboard');

        const entries = readFrontendBundleArchive(artifact.buffer);
        const indexHtml = entries.get('index.html').toString('utf8');
        const reportsHtml = entries.get('reports/index.html').toString('utf8');
        const css = entries.get('styles.css').toString('utf8');

        expect(indexHtml).toContain('href="./styles.css"');
        expect(reportsHtml).toContain('href="../styles.css"');
        expect(css).toContain('kimibuilt bundle style safety net');
        expect(css).toContain('[data-dashboard-zone]');
    });

    test('fills an existing missing local stylesheet reference with fallback css', () => {
        const artifact = buildFrontendBundleArtifact({
            entry: 'index.html',
            files: [
                {
                    path: 'index.html',
                    language: 'html',
                    content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="assets/site.css"></head><body><main><h1>Ops</h1></main></body></html>',
                },
            ],
        }, 'Linked Stylesheet');

        const entries = readFrontendBundleArchive(artifact.buffer);
        const indexHtml = entries.get('index.html').toString('utf8');
        const css = entries.get('assets/site.css').toString('utf8');

        expect(indexHtml).toContain('href="assets/site.css"');
        expect(css).toContain('kimibuilt bundle style safety net');
    });
});
