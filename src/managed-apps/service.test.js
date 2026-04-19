'use strict';

jest.mock('../realtime-hub', () => ({
    broadcastToAdmins: jest.fn(),
    broadcastToSession: jest.fn(),
}));

const { ManagedAppService } = require('./service');

describe('ManagedAppService', () => {
    test('builds a managed app blueprint from the explicit app name in the prompt', () => {
        const service = new ManagedAppService();

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });

        const blueprint = service.buildAppBlueprint({
            prompt: 'Create and deploy a managed app called hello-stack. Make it a simple one-page site that says the pipeline is working.',
        }, 'user-1', 'session-1');

        expect(blueprint.slug).toBe('hello-stack');
        expect(blueprint.appName).toBe('Hello Stack');
        expect(blueprint.repoName).toBe('hello-stack');
        expect(blueprint.namespace).toBe('app-hello-stack');
        expect(blueprint.publicHost).toBe('hello-stack.demoserver2.buzz');
    });

    test('caps long prompt-derived managed app names before repository creation', () => {
        const service = new ManagedAppService();

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });

        const blueprint = service.buildAppBlueprint({
            prompt: 'Create and deploy a managed app called this is a very long managed application name that should be shortened before repository creation because Gitea rejects overly long repository names and Kubernetes resource names also need to stay bounded.',
        }, 'user-1', 'session-1');

        expect(blueprint.slug.length).toBeLessThanOrEqual(63);
        expect(blueprint.repoName).toBe(blueprint.slug);
        expect(blueprint.namespace.length).toBeLessThanOrEqual(63);
        expect(blueprint.publicHost).toBe(`${blueprint.slug}.demoserver2.buzz`);
    });

    test('heals missing repo coordinates on existing apps before creating the repository', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'hello-stack',
            appName: 'Hello Stack',
            repoOwner: '',
            repoName: '',
            repoUrl: '',
            repoCloneUrl: '',
            repoSshUrl: '',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/hello-stack',
            namespace: 'app-hello-stack',
            publicHost: 'hello-stack.demoserver2.buzz',
            sourcePrompt: 'Create and deploy a managed app called hello-stack.',
            metadata: {},
            status: 'draft',
        };

        const updatedExistingApp = {
            ...existingApp,
            repoOwner: 'agent-apps',
            repoName: 'hello-stack',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
            status: 'provisioning',
        };

        const finalApp = {
            ...updatedExistingApp,
            status: 'building',
            metadata: {
                lastSeededPaths: ['index.html'],
            },
        };

        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppBySlug: jest.fn(async () => existingApp),
            updateApp: jest.fn()
                .mockResolvedValueOnce(updatedExistingApp)
                .mockResolvedValueOnce(finalApp),
            createApp: jest.fn(),
            createBuildRun: jest.fn(async () => ({
                id: 'run-1',
                buildStatus: 'queued',
                deployStatus: 'pending',
                verificationStatus: 'pending',
                imageTag: 'sha-abcdef123456',
            })),
        };

        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['index.html'],
            })),
        };

        const service = new ManagedAppService({
            store,
            giteaClient,
            kubernetesClient: {
                isConfigured: () => true,
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });
        service.buildBuildEventsUrl = () => 'https://kimibuilt.demoserver2.buzz/api/integrations/gitea/build-events';

        const result = await service.createApp({
            slug: 'hello-stack',
            requestedAction: 'deploy',
            prompt: 'Create and deploy a managed app called hello-stack. Make it a simple one-page site.',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(store.updateApp).toHaveBeenNthCalledWith(1, 'app-1', 'user-1', expect.objectContaining({
            repoOwner: 'agent-apps',
            repoName: 'hello-stack',
            status: 'provisioning',
        }));
        expect(giteaClient.ensureRepository).toHaveBeenCalledWith(expect.objectContaining({
            owner: 'agent-apps',
            name: 'hello-stack',
        }));
        expect(store.updateApp).toHaveBeenNthCalledWith(2, 'app-1', 'user-1', expect.objectContaining({
            repoOwner: 'agent-apps',
            repoName: 'hello-stack',
            status: 'building',
        }));
        expect(store.createBuildRun).toHaveBeenCalledWith(expect.objectContaining({
            appId: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
        }));
        expect(result.repository).toEqual(expect.objectContaining({
            owner: 'agent-apps',
            name: 'hello-stack',
        }));
    });

    test('recovers the persisted app from the store before creating the build run', async () => {
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppBySlug: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null),
            createApp: jest.fn(async () => ({
                appName: 'Hello Stack',
                slug: 'hello-stack',
                repoOwner: 'agent-apps',
                repoName: 'hello-stack',
                repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoSshUrl: '',
                defaultBranch: 'main',
                imageRepo: 'gitea.demoserver2.buzz/agent-apps/hello-stack',
                namespace: 'app-hello-stack',
                publicHost: 'hello-stack.demoserver2.buzz',
                ownerId: 'user-1',
                sessionId: 'session-1',
                metadata: {},
            })),
            updateApp: jest.fn(async () => ({
                appName: 'Hello Stack',
                slug: 'hello-stack',
                repoOwner: 'agent-apps',
                repoName: 'hello-stack',
                repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoSshUrl: '',
                defaultBranch: 'main',
                imageRepo: 'gitea.demoserver2.buzz/agent-apps/hello-stack',
                namespace: 'app-hello-stack',
                publicHost: 'hello-stack.demoserver2.buzz',
                ownerId: 'user-1',
                sessionId: 'session-1',
                metadata: {},
            })),
            getAppByRepo: jest.fn(async () => ({
                id: 'app-1',
                ownerId: 'user-1',
                sessionId: 'session-1',
                slug: 'hello-stack',
                appName: 'Hello Stack',
                repoOwner: 'agent-apps',
                repoName: 'hello-stack',
                repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                repoSshUrl: '',
                defaultBranch: 'main',
                imageRepo: 'gitea.demoserver2.buzz/agent-apps/hello-stack',
                namespace: 'app-hello-stack',
                publicHost: 'hello-stack.demoserver2.buzz',
                status: 'building',
                sourcePrompt: '',
                metadata: {},
            })),
            createBuildRun: jest.fn(async () => ({
                id: 'run-1',
                appId: 'app-1',
                buildStatus: 'queued',
            })),
        };

        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/hello-stack.git',
                    ssh_url: '',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['index.html'],
            })),
        };

        const service = new ManagedAppService({
            store,
            giteaClient,
            kubernetesClient: {
                isConfigured: () => true,
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });
        service.buildBuildEventsUrl = () => 'https://kimibuilt.demoserver2.buzz/api/integrations/gitea/build-events';

        const result = await service.createApp({
            slug: 'hello-stack',
            requestedAction: 'deploy',
            prompt: 'Create and deploy a managed app called hello-stack.',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(store.getAppByRepo).toHaveBeenCalledWith('agent-apps', 'hello-stack');
        expect(store.createBuildRun).toHaveBeenCalledWith(expect.objectContaining({
            appId: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
        }));
        expect(result.app.id).toBe('app-1');
    });

    test('recreates the app record before repository seeding when the first persistence attempt returns no id', async () => {
        const firstCreate = {
            appName: 'First Demo',
            slug: 'first-demo',
            repoOwner: 'agent-apps',
            repoName: 'first-demo',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/first-demo.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/first-demo.git',
            repoSshUrl: '',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/first-demo',
            namespace: 'app-first-demo',
            publicHost: 'first-demo.demoserver2.buzz',
            ownerId: 'user-1',
            sessionId: 'session-1',
            metadata: {},
        };
        const recoveredApp = {
            ...firstCreate,
            id: 'app-1',
            status: 'provisioning',
        };
        const finalApp = {
            ...recoveredApp,
            status: 'building',
            metadata: {
                lastSeededPaths: ['index.html'],
            },
        };

        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppBySlug: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null),
            getAppByRepo: jest.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null),
            createApp: jest.fn()
                .mockResolvedValueOnce(firstCreate)
                .mockResolvedValueOnce(recoveredApp),
            updateApp: jest.fn(async () => finalApp),
            createBuildRun: jest.fn(async () => ({
                id: 'run-1',
                appId: 'app-1',
                buildStatus: 'queued',
            })),
        };

        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/first-demo',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/first-demo.git',
                    ssh_url: '',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['index.html'],
            })),
        };

        const service = new ManagedAppService({
            store,
            giteaClient,
            kubernetesClient: {
                isConfigured: () => true,
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });
        service.buildBuildEventsUrl = () => 'https://kimibuilt.demoserver2.buzz/api/integrations/gitea/build-events';

        const result = await service.createApp({
            slug: 'first-demo',
            requestedAction: 'deploy',
            prompt: 'Create and deploy a managed app called first-demo.',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(store.createApp).toHaveBeenCalledTimes(2);
        expect(store.updateApp).toHaveBeenCalledWith('app-1', 'user-1', expect.objectContaining({
            repoOwner: 'agent-apps',
            repoName: 'first-demo',
            status: 'building',
        }));
        expect(store.createBuildRun).toHaveBeenCalledWith(expect.objectContaining({
            appId: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
        }));
        expect(result.app.id).toBe('app-1');
    });

    test('buildPromptSummary nudges the runtime to create the first managed app when the catalog is empty', async () => {
        const service = new ManagedAppService({
            store: {
                isAvailable: () => true,
                listApps: jest.fn(async () => ([])),
            },
        });

        await expect(service.buildPromptSummary({
            ownerId: 'user-1',
            maxApps: 4,
        })).resolves.toContain('create the first one directly');
    });
});
