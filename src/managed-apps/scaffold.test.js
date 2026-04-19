'use strict';

const { buildDefaultScaffoldFiles } = require('./scaffold');

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
        expect(workflow.content).toContain('buildctl --addr "$BUILDKIT_HOST" build');
        expect(workflow.content).toContain('KIMIBUILT_BUILD_EVENTS_SECRET');
        expect(workflow.content).not.toContain('secrets.GITEA_REGISTRY_USERNAME');
    });
});
