'use strict';

const {
    buildDefaultScaffoldFiles,
    normalizeGeneratedManagedAppSourceFiles,
} = require('./scaffold');

describe('managed app scaffold', () => {
    test('generates a BuildKit-based Gitea workflow for the external control plane', () => {
        const files = buildDefaultScaffoldFiles({
            appName: 'Arcade Demo',
            slug: 'arcade-demo',
            publicHost: 'arcade-demo.demoserver2.buzz',
            namespace: 'app-arcade-demo',
            sourcePrompt: 'Build an arcade demo.',
            giteaOrg: 'agent-apps',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/arcade-demo',
            registryHost: 'gitea.demoserver2.buzz',
            buildEventsUrl: 'https://kimibuilt.demoserver2.buzz/api/integrations/gitea/build-events',
        });

        const workflow = files.find((entry) => entry.path === '.gitea/workflows/build-and-publish.yml');

        expect(workflow).toBeTruthy();
        expect(workflow.content).toContain('BUILDKIT_HOST');
        expect(workflow.content).toContain('TARGET_PLATFORMS');
        expect(workflow.content).toContain('linux/amd64,linux/arm64');
        expect(workflow.content).toContain('buildctl --addr "$BUILDKIT_HOST" build');
        expect(workflow.content).toContain('--opt platform="$TARGET_PLATFORMS"');
        expect(workflow.content).toContain('--import-cache "type=registry,ref=$IMAGE_REPO:latest"');
        expect(workflow.content).toContain('KIMIBUILT_BUILD_EVENTS_SECRET');
        expect(workflow.content).toContain('PAYLOAD="$(cat <<EOF');
        expect(workflow.content).toContain('"imageRepo":"$IMAGE_REPO"');
        expect(workflow.content).toContain('"platforms":"$TARGET_PLATFORMS"');
        expect(workflow.content).not.toContain('secrets.GITEA_REGISTRY_USERNAME');
    });

    test('normalizes generated source files down to the supported public bundle', () => {
        const files = normalizeGeneratedManagedAppSourceFiles([
            {
                path: 'public/index.html',
                content: '<!DOCTYPE html><html><body>Hello</body></html>',
            },
            {
                path: 'public/styles.css',
                content: 'body{margin:0;}',
            },
            {
                path: 'README.md',
                content: '# ignored',
            },
            {
                path: 'public/app.js',
                content: 'console.log("ok");',
            },
        ]);

        expect(files).toEqual([
            {
                path: 'public/index.html',
                content: '<!DOCTYPE html><html><body>Hello</body></html>',
            },
            {
                path: 'public/styles.css',
                content: 'body{margin:0;}',
            },
            {
                path: 'public/app.js',
                content: 'console.log("ok");',
            },
        ]);
    });
});
