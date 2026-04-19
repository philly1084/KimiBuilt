'use strict';

jest.mock('../realtime-hub', () => ({
    broadcastToAdmins: jest.fn(),
    broadcastToSession: jest.fn(),
}));

const { ManagedAppService } = require('./service');

describe('ManagedAppService', () => {
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
                .mockResolvedValueOnce({
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
                }),
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
            updateApp: jest.fn(async () => null),
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
});
