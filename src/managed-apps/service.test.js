'use strict';

jest.mock('../realtime-hub', () => ({
    broadcastToAdmins: jest.fn(),
    broadcastToSession: jest.fn(),
}));

jest.mock('../session-store', () => ({
    sessionStore: {
        upsertMessage: jest.fn(async () => null),
    },
}));

const settingsController = require('../routes/admin/settings.controller');
const { ManagedAppService } = require('./service');

describe('ManagedAppService', () => {
    test('buildBuildEventsUrl strips a trailing /v1 from the configured API base URL', () => {
        const service = new ManagedAppService();
        const previousBaseUrl = settingsController.settings.api.baseURL;

        settingsController.settings.api.baseURL = 'https://kimibuilt.example.test/v1';
        service.getEffectiveManagedAppsConfig = () => ({
            webhookEndpointPath: '/api/integrations/gitea/build-events',
        });

        try {
            expect(service.buildBuildEventsUrl()).toBe('https://kimibuilt.example.test/api/integrations/gitea/build-events');
        } finally {
            settingsController.settings.api.baseURL = previousBaseUrl;
        }
    });

    test('buildBuildEventsUrl strips trailing /api and /v1 segments before appending the webhook path', () => {
        const service = new ManagedAppService();
        const previousBaseUrl = settingsController.settings.api.baseURL;

        settingsController.settings.api.baseURL = 'https://kimibuilt.example.test/control-plane/api/v1';
        service.getEffectiveManagedAppsConfig = () => ({
            webhookEndpointPath: '/api/integrations/gitea/build-events',
        });

        try {
            expect(service.buildBuildEventsUrl()).toBe('https://kimibuilt.example.test/control-plane/api/integrations/gitea/build-events');
        } finally {
            settingsController.settings.api.baseURL = previousBaseUrl;
        }
    });

    test('remote-build blueprints default managed app deployment target to ssh', () => {
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
            prompt: 'Create and deploy a managed app called hello-stack.',
        }, 'user-1', 'session-1', {
            executionProfile: 'remote-build',
        });

        expect(blueprint.metadata.deploymentTarget).toBe('ssh');
    });

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

    test('derives a clean repo name from the prompt subject instead of the opening phrasing', () => {
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
            prompt: 'Can you make me an expense tracker app for our server?',
        }, 'user-1', 'session-1');

        expect(blueprint.slug).toBe('expense-tracker');
        expect(blueprint.appName).toBe('Expense Tracker');
        expect(blueprint.repoName).toBe('expense-tracker');
    });

    test('falls back to a generic managed app name when the prompt has no usable subject', () => {
        const service = new ManagedAppService();
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1713571200000);

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

        try {
            const blueprint = service.buildAppBlueprint({
                prompt: 'Can you use on our server?',
            }, 'user-1', 'session-1');

            expect(blueprint.slug).toBe('managed-app-1713571200000');
            expect(blueprint.appName).toBe('Managed App 1713571200000');
            expect(blueprint.repoName).toBe('managed-app-1713571200000');
        } finally {
            nowSpy.mockRestore();
        }
    });

    test('prefers ssh for new managed app blueprints when the remote deploy lane is available', () => {
        const service = new ManagedAppService({
            kubernetesClient: {
                isSshConfigured: jest.fn(() => true),
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            deployTarget: 'in-cluster',
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });

        const blueprint = service.buildAppBlueprint({
            prompt: 'Create and deploy a managed app called remote-first.',
        }, 'user-1', 'session-1');

        expect(blueprint.metadata.deploymentTarget).toBe('ssh');
    });

    test('always uses ssh for new managed app blueprints even when legacy config says in-cluster', () => {
        const service = new ManagedAppService({
            kubernetesClient: {
                isSshConfigured: jest.fn(() => false),
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            deployTarget: 'in-cluster',
            appBaseDomain: 'demoserver2.buzz',
            namespacePrefix: 'app-',
            defaultBranch: 'main',
            defaultContainerPort: 80,
        });

        const blueprint = service.buildAppBlueprint({
            prompt: 'Create and deploy a managed app called remote-only.',
        }, 'user-1', 'session-1');

        expect(blueprint.metadata.deploymentTarget).toBe('ssh');
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

    test('generates app source files from the managed-app prompt before seeding the repo', async () => {
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppBySlug: jest.fn(async () => null),
            getAppByRepo: jest.fn(async () => null),
            createApp: jest.fn(async (input) => ({
                id: 'app-llm-1',
                ownerId: 'user-1',
                sessionId: 'session-1',
                ...input,
            })),
            updateApp: jest.fn(async (_id, _ownerId, updates) => ({
                id: 'app-llm-1',
                ownerId: 'user-1',
                sessionId: 'session-1',
                slug: 'launch-site',
                appName: 'Launch Site',
                repoOwner: 'agent-apps',
                repoName: 'launch-site',
                repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/launch-site.git',
                repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/launch-site.git',
                repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/launch-site.git',
                defaultBranch: 'main',
                imageRepo: 'gitea.demoserver2.buzz/agent-apps/launch-site',
                namespace: 'app-launch-site',
                publicHost: 'launch-site.demoserver2.buzz',
                sourcePrompt: 'Create and deploy a launch page.',
                metadata: {},
                ...updates,
            })),
            createBuildRun: jest.fn(async () => ({
                id: 'run-llm-1',
                buildStatus: 'queued',
                deployStatus: 'not_requested',
                verificationStatus: 'pending',
                imageTag: 'sha-abcdef123456',
            })),
        };
        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/launch-site',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/launch-site.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/launch-site.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['public/index.html', 'public/styles.css', 'public/app.js'],
            })),
        };
        const llmClient = {
            complete: jest.fn(async () => JSON.stringify({
                files: [
                    {
                        path: 'public/index.html',
                        content: '<!DOCTYPE html><html><body><main><h1>Launch Site</h1></main><script src="./app.js"></script></body></html>',
                    },
                    {
                        path: 'public/styles.css',
                        content: 'body{margin:0;background:#111;color:#fff;}main{padding:48px;}',
                    },
                    {
                        path: 'public/app.js',
                        content: 'document.body.dataset.ready = "true";',
                    },
                ],
            })),
        };
        const service = new ManagedAppService({
            store,
            giteaClient,
            kubernetesClient: {
                isConfigured: () => true,
            },
            llmClient,
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

        await service.createApp({
            prompt: 'Create and deploy a managed app called launch-site with a sharp launch page and a CTA.',
        }, 'user-1', {
            sessionId: 'session-1',
            model: 'gpt-5.4-mini',
        });

        expect(llmClient.complete).toHaveBeenCalledTimes(1);
        expect(giteaClient.upsertFiles).toHaveBeenCalledWith(expect.objectContaining({
            owner: 'agent-apps',
            repo: 'launch-site',
            files: expect.arrayContaining([
                expect.objectContaining({
                    path: 'public/index.html',
                    content: expect.stringContaining('<h1>Launch Site</h1>'),
                }),
                expect.objectContaining({
                    path: 'public/styles.css',
                    content: expect.stringContaining('background:#111'),
                }),
                expect.objectContaining({
                    path: 'public/app.js',
                    content: 'document.body.dataset.ready = "true";',
                }),
                expect.objectContaining({
                    path: '.gitea/workflows/build-and-publish.yml',
                }),
            ]),
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

    test('resolveApp accepts owner and repo references', async () => {
        const getAppByRepo = jest.fn(async () => ({
            id: 'app-1',
            slug: 'demo',
            repoOwner: 'agent-apps',
            repoName: 'demo',
        }));
        const service = new ManagedAppService({
            store: {
                isAvailable: () => true,
                getAppByRepo,
                getAppById: jest.fn(async () => null),
                getAppBySlug: jest.fn(async () => null),
            },
        });

        await expect(service.resolveApp('agent-apps/demo', 'user-1')).resolves.toEqual(expect.objectContaining({
            id: 'app-1',
            slug: 'demo',
        }));
        expect(getAppByRepo).toHaveBeenCalledWith('agent-apps', 'demo');
    });

    test('createApp reuses an existing app by public host and keeps repo identity stable', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            sourcePrompt: '',
            status: 'live',
            metadata: {},
        };
        const updatedApp = {
            ...existingApp,
            metadata: {
                project: {
                    summary: 'Demo App was resumed without repository changes.',
                },
            },
        };
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppBySlug: jest.fn(async () => null),
            getAppByRepo: jest.fn(async () => null),
            listApps: jest.fn(async () => ([existingApp])),
            updateApp: jest.fn()
                .mockResolvedValueOnce(updatedApp)
                .mockResolvedValueOnce(updatedApp),
            createApp: jest.fn(),
        };
        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['public/index.html'],
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
            registryPullSecretName: 'gitea-registry-credentials',
        });

        const result = await service.createApp({
            appName: 'Completely New Name',
            publicHost: 'demo-app.demoserver2.buzz',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(result.reusedExistingApp).toBe(true);
        expect(result.app.id).toBe('app-1');
        expect(result.app.repoName).toBe('demo-app');
        expect(result.app.namespace).toBe('app-demo-app');
        expect(store.createApp).not.toHaveBeenCalled();
        expect(giteaClient.upsertFiles).not.toHaveBeenCalled();
        expect(result.message).toContain('Resumed Demo App');
    });

    test('createApp reuses the session-linked managed app for unnamed follow-up prompts', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            sourcePrompt: 'Build the first version.',
            status: 'live',
            metadata: {},
        };
        const buildRun = {
            id: 'build-1',
            appId: 'app-1',
            buildStatus: 'queued',
            deployRequested: false,
        };
        const updatedApp = {
            ...existingApp,
            metadata: {
                project: {
                    summary: 'Demo App was resumed and updated in agent-apps/demo-app. Build and deploy are queued.',
                },
            },
        };
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppById: jest.fn(async (id) => (id === 'app-1' ? existingApp : null)),
            getAppBySlug: jest.fn(async (slug) => (slug === 'demo-app' ? existingApp : null)),
            getAppByRepo: jest.fn(async () => null),
            listApps: jest.fn(async () => ([existingApp])),
            updateApp: jest.fn()
                .mockResolvedValueOnce(updatedApp)
                .mockResolvedValueOnce(updatedApp)
                .mockResolvedValueOnce(updatedApp),
            createApp: jest.fn(),
            createBuildRun: jest.fn(async () => buildRun),
        };
        const sessionStore = {
            listMessages: jest.fn(async () => ([
                {
                    id: 'msg-1',
                    role: 'assistant',
                    content: 'Demo App is live.',
                    timestamp: '2026-04-21T00:00:00.000Z',
                    metadata: {
                        managedAppLifecycle: true,
                        managedAppId: 'app-1',
                        managedAppSlug: 'demo-app',
                    },
                },
            ])),
            upsertMessage: jest.fn(async () => null),
            update: jest.fn(async () => null),
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                metadata: {},
            })),
        };
        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['public/index.html'],
            })),
        };
        const service = new ManagedAppService({
            store,
            giteaClient,
            sessionStore,
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
            registryPullSecretName: 'gitea-registry-credentials',
        });

        const result = await service.createApp({
            prompt: 'Make the hero section sharper and update the CTA copy.',
            sessionId: 'session-1',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(result.reusedExistingApp).toBe(true);
        expect(result.app.slug).toBe('demo-app');
        expect(store.createApp).not.toHaveBeenCalled();
        expect(giteaClient.ensureRepository).toHaveBeenCalledWith(expect.objectContaining({
            owner: 'agent-apps',
            name: 'demo-app',
        }));
        expect(giteaClient.upsertFiles).toHaveBeenCalled();
        expect(result.message).toContain('Resumed Demo App');
    });

    test('resolveRecentSessionManagedApp reuses the session active project before transcript history', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            status: 'live',
            metadata: {},
        };
        const sessionStore = {
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                metadata: {
                    activeProject: {
                        type: 'managed-app',
                        appId: 'app-1',
                        appSlug: 'demo-app',
                    },
                },
            })),
        };
        const store = {
            getAppById: jest.fn(async (id) => (id === 'app-1' ? existingApp : null)),
            getAppBySlug: jest.fn(async (slug) => (slug === 'demo-app' ? existingApp : null)),
            getAppByRepo: jest.fn(async () => null),
        };
        const service = new ManagedAppService({
            store,
            sessionStore,
        });

        const result = await service.resolveRecentSessionManagedApp('session-1', 'user-1');

        expect(result?.id).toBe('app-1');
        expect(sessionStore.getOwned).toHaveBeenCalledWith('session-1', 'user-1');
        expect(store.getAppById).toHaveBeenCalledWith('app-1', 'user-1');
    });

    test('broadcastLifecycleEvent persists the active project snapshot into the session metadata', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            status: 'live',
            metadata: {
                project: {
                    nextStep: '',
                    openItems: [],
                    decisions: [],
                    lastUserIntent: 'Continue the demo app.',
                },
                desiredDeploy: {
                    deploymentTarget: 'ssh',
                    namespace: 'app-demo-app',
                    publicHost: 'demo-app.demoserver2.buzz',
                    defaultBranch: 'main',
                },
                liveDeploy: {
                    lastVerifiedAt: '2026-04-22T12:00:00.000Z',
                },
            },
        };
        const buildRun = {
            id: 'build-1',
            buildStatus: 'success',
            deployStatus: 'succeeded',
            verificationStatus: 'live',
        };
        const sessionStore = {
            upsertMessage: jest.fn(async () => null),
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                metadata: {
                    title: 'New Chat',
                },
            })),
            update: jest.fn(async () => null),
        };
        const service = new ManagedAppService({
            sessionStore,
        });

        await service.broadcastLifecycleEvent(app, buildRun, 'live');

        expect(sessionStore.upsertMessage).toHaveBeenCalledWith('session-1', expect.objectContaining({
            metadata: expect.objectContaining({
                managedAppProgressState: expect.objectContaining({
                    phase: 'live',
                    phaseLabel: 'Live',
                    totalSteps: 4,
                    completedSteps: 4,
                }),
            }),
        }));
        expect(sessionStore.update).toHaveBeenCalledWith('session-1', expect.objectContaining({
            metadata: expect.objectContaining({
                title: 'Demo App',
                activeProject: expect.objectContaining({
                    type: 'managed-app',
                    key: 'managed-app:app-1',
                    title: 'Demo App',
                    phase: 'live',
                    progress: expect.objectContaining({
                        phase: 'live',
                        phaseLabel: 'Live',
                        nextStep: '',
                        totalSteps: 4,
                        completedSteps: 4,
                    }),
                    appId: 'app-1',
                    appSlug: 'demo-app',
                    publicHost: 'demo-app.demoserver2.buzz',
                }),
            }),
        }));
    });

    test('createApp still creates a separate repo when the prompt explicitly asks for a new app', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            sourcePrompt: 'Build the first version.',
            status: 'live',
            metadata: {},
        };
        const createdApp = {
            id: 'app-2',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'expense-tracker',
            appName: 'Expense Tracker',
            repoOwner: 'agent-apps',
            repoName: 'expense-tracker',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/expense-tracker.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/expense-tracker.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/expense-tracker.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/expense-tracker',
            namespace: 'app-expense-tracker',
            publicHost: 'expense-tracker.demoserver2.buzz',
            sourcePrompt: 'Create a brand new expense tracker app from scratch.',
            status: 'provisioning',
            metadata: {},
        };
        const updatedApp = {
            ...createdApp,
            status: 'building',
            metadata: {
                project: {
                    summary: 'Expense Tracker was created in agent-apps/expense-tracker. Build and deploy are queued.',
                },
            },
        };
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppById: jest.fn(async (id) => (id === 'app-1' ? existingApp : null)),
            getAppBySlug: jest.fn(async (slug) => {
                if (slug === 'demo-app') {
                    return existingApp;
                }
                return null;
            }),
            getAppByRepo: jest.fn(async () => null),
            listApps: jest.fn(async () => ([existingApp])),
            createApp: jest.fn()
                .mockResolvedValueOnce(createdApp)
                .mockResolvedValueOnce(createdApp),
            updateApp: jest.fn()
                .mockResolvedValueOnce(updatedApp)
                .mockResolvedValueOnce(updatedApp),
            createBuildRun: jest.fn(async () => ({
                id: 'build-2',
                appId: 'app-2',
                buildStatus: 'queued',
                deployRequested: false,
            })),
        };
        const sessionStore = {
            listMessages: jest.fn(async () => ([
                {
                    id: 'msg-1',
                    role: 'assistant',
                    content: 'Demo App is live.',
                    timestamp: '2026-04-21T00:00:00.000Z',
                    metadata: {
                        managedAppLifecycle: true,
                        managedAppId: 'app-1',
                        managedAppSlug: 'demo-app',
                    },
                },
            ])),
            upsertMessage: jest.fn(async () => null),
            update: jest.fn(async () => null),
            getOwned: jest.fn(async () => ({
                id: 'session-1',
                metadata: {},
            })),
        };
        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/expense-tracker',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/expense-tracker.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/expense-tracker.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'fedcba0987654321',
                committedPaths: ['public/index.html'],
            })),
        };
        const service = new ManagedAppService({
            store,
            giteaClient,
            sessionStore,
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
            registryPullSecretName: 'gitea-registry-credentials',
        });

        const result = await service.createApp({
            prompt: 'Create a brand new expense tracker app from scratch.',
            sessionId: 'session-1',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(result.reusedExistingApp).toBe(false);
        expect(result.app.slug).toBe('expense-tracker');
        expect(store.createApp).toHaveBeenCalled();
        expect(giteaClient.ensureRepository).toHaveBeenCalledWith(expect.objectContaining({
            owner: 'agent-apps',
            name: 'expense-tracker',
        }));
    });

    test('updateApp preserves repo coordinates and deployment identity unless explicitly overridden', async () => {
        const existingApp = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo-app',
            appName: 'Demo App',
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            repoSshUrl: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
            defaultBranch: 'main',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
            sourcePrompt: 'Original prompt',
            status: 'live',
            metadata: {},
        };
        const store = {
            ensureAvailable: jest.fn(async () => {}),
            isAvailable: jest.fn(() => true),
            getAppById: jest.fn(async () => existingApp),
            getAppBySlug: jest.fn(async () => existingApp),
            getAppByRepo: jest.fn(async () => existingApp),
            createBuildRun: jest.fn(async () => ({
                id: 'build-1',
                appId: 'app-1',
                status: 'pending',
            })),
            updateApp: jest.fn()
                .mockResolvedValueOnce(existingApp)
                .mockResolvedValueOnce({
                    ...existingApp,
                    metadata: {
                        project: {
                            summary: 'Demo App was resumed without repository changes.',
                        },
                    },
                }),
        };
        const giteaClient = {
            isConfigured: jest.fn(() => true),
            ensureOrganization: jest.fn(async () => ({ created: false })),
            ensureRepository: jest.fn(async () => ({
                repository: {
                    html_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app',
                    clone_url: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
                    ssh_url: 'ssh://git@gitea.demoserver2.buzz/agent-apps/demo-app.git',
                },
            })),
            upsertFiles: jest.fn(async () => ({
                commitSha: 'abcdef1234567890',
                committedPaths: ['public/index.html'],
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
            registryPullSecretName: 'gitea-registry-credentials',
        });

        await service.updateApp('app-1', {
            prompt: 'Refresh the copy and polish the page.',
        }, 'user-1', {
            sessionId: 'session-1',
        });

        expect(store.updateApp).toHaveBeenNthCalledWith(1, 'app-1', 'user-1', expect.objectContaining({
            repoOwner: 'agent-apps',
            repoName: 'demo-app',
            repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
            namespace: 'app-demo-app',
            publicHost: 'demo-app.demoserver2.buzz',
        }));
    });

    test('inspectApp returns normalized lifecycle metadata and a summary', async () => {
        const service = new ManagedAppService({
            store: {
                getAppById: jest.fn(async () => null),
                getAppBySlug: jest.fn(async () => ({
                    id: 'app-1',
                    ownerId: 'user-1',
                    slug: 'demo-app',
                    appName: 'Demo App',
                    repoOwner: 'agent-apps',
                    repoName: 'demo-app',
                    repoUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
                    repoCloneUrl: 'https://gitea.demoserver2.buzz/agent-apps/demo-app.git',
                    repoSshUrl: '',
                    defaultBranch: 'main',
                    imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo-app',
                    namespace: 'app-demo-app',
                    publicHost: 'demo-app.demoserver2.buzz',
                    status: 'live',
                    sourcePrompt: 'Ship the demo app.',
                    metadata: {
                        project: {
                            summary: 'Demo App is live.',
                            nextStep: '',
                        },
                    },
                })),
                listBuildRunsForApp: jest.fn(async () => ([{
                    id: 'run-1',
                    buildStatus: 'success',
                    deployStatus: 'succeeded',
                    verificationStatus: 'live',
                }])),
            },
        });

        service.getEffectiveDeployConfig = () => ({
            ingressClassName: 'traefik',
            tlsClusterIssuer: 'letsencrypt-prod',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            defaultBranch: 'main',
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });

        const result = await service.inspectApp('demo-app', 'user-1');

        expect(result.summary).toBe('Demo App is live.');
        expect(result.app.metadata.project.summary).toBe('Demo App is live.');
        expect(result.app.metadata.desiredDeploy.namespace).toBe('app-demo-app');
        expect(result.app.metadata.liveDeploy.https).toBe(false);
    });

    test('doctorPlatform summarizes the remote Gitea runner stack through the SSH kubernetes client', async () => {
        const inspectManagedAppPlatform = jest.fn(async () => ({
            deploymentTarget: 'ssh',
            platformNamespace: 'agent-platform',
            namespaceExists: true,
            executionHost: 'deploy.example:22',
            deployments: {
                gitea: {
                    name: 'gitea',
                    present: true,
                    desiredReplicas: 1,
                    readyReplicas: 1,
                    availableReplicas: 1,
                    updatedReplicas: 1,
                    ready: true,
                },
                buildkitd: {
                    name: 'buildkitd',
                    present: true,
                    desiredReplicas: 1,
                    readyReplicas: 1,
                    availableReplicas: 1,
                    updatedReplicas: 1,
                    ready: true,
                },
                'act-runner': {
                    name: 'act-runner',
                    present: true,
                    desiredReplicas: 0,
                    readyReplicas: 0,
                    availableReplicas: 0,
                    updatedReplicas: 0,
                    ready: false,
                },
            },
            runnerTokenState: 'placeholder',
            runnerLabels: 'ubuntu-latest:host',
            giteaInstanceUrl: 'https://gitea.demoserver2.buzz',
            runnerLogExcerpt: ['registration token invalid'],
            raw: {
                stdout: '',
                stderr: '',
                exitCode: 0,
            },
        }));
        const service = new ManagedAppService({
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                inspectManagedAppPlatform,
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            platformNamespace: 'agent-platform',
        });

        const result = await service.doctorPlatform({}, 'user-1', {
            executionProfile: 'remote-build',
        });

        expect(inspectManagedAppPlatform).toHaveBeenCalledWith({
            platformNamespace: 'agent-platform',
            deploymentTarget: 'ssh',
        });
        expect(result.healthy).toBe(false);
        expect(result.platform.expected.giteaBaseURL).toBe('https://gitea.demoserver2.buzz');
        expect(result.suggestions).toEqual(expect.arrayContaining([
            expect.stringContaining('`act-runner` is scaled to `0`'),
            expect.stringContaining('placeholder value'),
        ]));
        expect(result.message).toContain('deploy.example:22');
        expect(result.message).toContain('platform needs attention');
    });

    test('reconcilePlatform repairs the remote runner stack through Gitea and SSH', async () => {
        const inspectManagedAppPlatform = jest.fn()
            .mockResolvedValueOnce({
                deploymentTarget: 'ssh',
                platformNamespace: 'agent-platform',
                namespaceExists: true,
                executionHost: 'deploy.example:22',
                deployments: {
                    gitea: {
                        name: 'gitea',
                        present: true,
                        desiredReplicas: 1,
                        readyReplicas: 1,
                        availableReplicas: 1,
                        updatedReplicas: 1,
                        ready: true,
                    },
                    buildkitd: {
                        name: 'buildkitd',
                        present: true,
                        desiredReplicas: 1,
                        readyReplicas: 1,
                        availableReplicas: 1,
                        updatedReplicas: 1,
                        ready: true,
                    },
                    'act-runner': {
                        name: 'act-runner',
                        present: true,
                        desiredReplicas: 0,
                        readyReplicas: 0,
                        availableReplicas: 0,
                        updatedReplicas: 0,
                        ready: false,
                    },
                },
                runnerTokenState: 'placeholder',
                runnerLabels: 'ubuntu-latest:host',
                giteaInstanceUrl: 'https://gitea.demoserver2.buzz',
                runnerLogExcerpt: ['registration token invalid'],
                raw: {
                    stdout: '',
                    stderr: '',
                    exitCode: 0,
                },
            })
            .mockResolvedValueOnce({
                deploymentTarget: 'ssh',
                platformNamespace: 'agent-platform',
                namespaceExists: true,
                executionHost: 'deploy.example:22',
                deployments: {
                    gitea: {
                        name: 'gitea',
                        present: true,
                        desiredReplicas: 1,
                        readyReplicas: 1,
                        availableReplicas: 1,
                        updatedReplicas: 1,
                        ready: true,
                    },
                    buildkitd: {
                        name: 'buildkitd',
                        present: true,
                        desiredReplicas: 1,
                        readyReplicas: 1,
                        availableReplicas: 1,
                        updatedReplicas: 1,
                        ready: true,
                    },
                    'act-runner': {
                        name: 'act-runner',
                        present: true,
                        desiredReplicas: 1,
                        readyReplicas: 1,
                        availableReplicas: 1,
                        updatedReplicas: 1,
                        ready: true,
                    },
                },
                runnerTokenState: 'present',
                runnerLabels: 'ubuntu-latest:host',
                giteaInstanceUrl: 'https://gitea.demoserver2.buzz',
                runnerLogExcerpt: [],
                raw: {
                    stdout: '',
                    stderr: '',
                    exitCode: 0,
                },
            });
        const reconcileManagedAppPlatform = jest.fn(async () => ({
            deploymentTarget: 'ssh',
            platformNamespace: 'agent-platform',
            executionHost: 'deploy.example:22',
            actions: [
                'gitea-actions-secret-applied',
                'act-runner-scaled-1',
                'act-runner-restarted',
            ],
            raw: {
                stdout: '',
                stderr: '',
                exitCode: 0,
            },
        }));
        const getRunnerRegistrationToken = jest.fn(async () => ({
            scope: 'org',
            token: 'runner-token-123',
            rotated: true,
        }));
        const listActionsRunners = jest.fn(async () => ({
            scope: 'org',
            totalCount: 1,
            runners: [{
                id: 7,
                name: 'agent-platform-runner',
                status: 'online',
                disabled: false,
                busy: false,
                labels: [{ name: 'ubuntu-latest:host' }],
            }],
        }));

        const service = new ManagedAppService({
            giteaClient: {
                isConfigured: jest.fn(() => true),
                getRunnerRegistrationToken,
                listActionsRunners,
            },
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                inspectManagedAppPlatform,
                reconcileManagedAppPlatform,
            },
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            platformNamespace: 'agent-platform',
        });

        const result = await service.reconcilePlatform({}, 'user-1', {
            executionProfile: 'remote-build',
        });

        expect(getRunnerRegistrationToken).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'org',
            org: 'agent-apps',
            rotate: true,
        }));
        expect(reconcileManagedAppPlatform).toHaveBeenCalledWith(expect.objectContaining({
            platformNamespace: 'agent-platform',
            deploymentTarget: 'ssh',
            runnerRegistrationToken: 'runner-token-123',
            runnerLabels: 'ubuntu-latest:host',
            giteaInstanceUrl: 'https://gitea.demoserver2.buzz',
        }));
        expect(listActionsRunners).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'org',
            org: 'agent-apps',
        }));
        expect(result.healthy).toBe(true);
        expect(result.giteaRunners.onlineCount).toBe(1);
        expect(result.runnerToken.rotated).toBe(true);
        expect(result.message).toContain('act-runner-restarted');
    });

    test('deployApp routes managed apps with ssh deployment targets through the remote kubernetes client', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            status: 'built',
            metadata: {
                deploymentTarget: 'ssh',
                requestedContainerPort: 80,
            },
        };
        const buildRun = {
            id: 'run-1',
            buildStatus: 'success',
            deployStatus: 'pending',
            imageTag: 'sha-abcdef123456',
            metadata: {},
        };
        const deployManagedApp = jest.fn(async () => ({
            namespace: 'app-demo',
            deployment: 'demo',
            verification: {
                rollout: true,
                tls: false,
                https: true,
            },
            rollout: {
                ok: true,
            },
        }));

        const store = {
            isAvailable: () => true,
            listBuildRunsForApp: jest.fn(async () => ([buildRun])),
            updateApp: jest.fn(async (_id, _ownerId, updates) => ({
                ...app,
                ...updates,
                metadata: updates.metadata,
            })),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
        };

        const service = new ManagedAppService({
            store,
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                deployManagedApp,
            },
        });

        service.resolveApp = jest.fn(async () => app);
        service.getEffectiveGiteaConfig = () => ({
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });
        service.recordClusterDeployment = jest.fn();
        service.broadcastLifecycleEvent = jest.fn();

        const result = await service.deployApp('demo', {}, 'user-1', {
            executionProfile: 'remote-build',
            sessionId: 'session-1',
        });

        expect(deployManagedApp).toHaveBeenCalledWith(expect.objectContaining({
            slug: 'demo',
            deploymentTarget: 'ssh',
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
        }));
        expect(result.message).toContain('HTTPS is responding');
        expect(result.desiredDeploy).toEqual(expect.objectContaining({
            namespace: 'app-demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
        }));
        expect(result.liveDeploy).toEqual(expect.objectContaining({
            lastImage: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
            https: true,
        }));
    });

    test('deployApp heals a missing image repo from current Gitea settings before deployment', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: '',
            repoOwner: 'agent-apps',
            repoName: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            status: 'built',
            metadata: {
                deploymentTarget: 'ssh',
                requestedContainerPort: 80,
            },
        };
        const buildRun = {
            id: 'run-1',
            buildStatus: 'success',
            deployStatus: 'pending',
            imageTag: 'sha-abcdef123456',
            metadata: {},
        };
        const healedApp = {
            ...app,
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
        };
        const deployManagedApp = jest.fn(async () => ({
            namespace: 'app-demo',
            deployment: 'demo',
            verification: {
                rollout: true,
                tls: false,
                https: true,
            },
            rollout: {
                ok: true,
            },
        }));

        const store = {
            isAvailable: () => true,
            listBuildRunsForApp: jest.fn(async () => ([buildRun])),
            updateApp: jest.fn()
                .mockResolvedValueOnce({
                    ...healedApp,
                    metadata: {
                        ...healedApp.metadata,
                        deploymentTarget: 'ssh',
                    },
                })
                .mockResolvedValueOnce({
                    ...healedApp,
                    status: 'live',
                    metadata: {
                        ...healedApp.metadata,
                        deploymentTarget: 'ssh',
                        lastImage: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
                    },
                }),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
        };

        const service = new ManagedAppService({
            store,
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                deployManagedApp,
            },
        });

        service.resolveApp = jest.fn(async () => app);
        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });
        service.recordClusterDeployment = jest.fn();
        service.broadcastLifecycleEvent = jest.fn();

        const result = await service.deployApp('demo', {}, 'user-1', {
            executionProfile: 'remote-build',
            sessionId: 'session-1',
        });

        expect(store.updateApp).toHaveBeenNthCalledWith(1, 'app-1', 'user-1', expect.objectContaining({
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
        }));
        expect(deployManagedApp).toHaveBeenCalledWith(expect.objectContaining({
            image: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
        }));
        expect(result.app.imageRepo).toBe('gitea.demoserver2.buzz/agent-apps/demo');
    });

    test('handleBuildEvent stores the resolved image repo from the webhook payload', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: '',
            repoOwner: 'agent-apps',
            repoName: 'demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            status: 'building',
            metadata: {
                deploymentTarget: 'ssh',
            },
        };
        const buildRun = {
            id: 'run-1',
            appId: 'app-1',
            buildStatus: 'queued',
            deployRequested: false,
            deployStatus: 'not_requested',
            verificationStatus: 'pending',
            metadata: {},
        };
        const updatedApp = {
            ...app,
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            status: 'built',
            metadata: {
                deploymentTarget: 'ssh',
                lastSuccessfulBuild: {
                    commitSha: 'abcdef1234567890',
                    imageTag: 'sha-abcdef123456',
                    imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
                    platforms: 'linux/amd64,linux/arm64',
                },
            },
        };

        const store = {
            ensureAvailable: jest.fn(async () => {}),
            getAppByRepo: jest.fn(async () => app),
            getAppBySlug: jest.fn(async () => app),
            getBuildRunByExternalRunId: jest.fn(async () => buildRun),
            getBuildRunByCommitSha: jest.fn(async () => buildRun),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
            updateApp: jest.fn(async () => updatedApp),
        };

        const service = new ManagedAppService({
            store,
        });

        service.getEffectiveGiteaConfig = () => ({
            baseURL: 'https://gitea.demoserver2.buzz',
            org: 'agent-apps',
            registryHost: 'gitea.demoserver2.buzz',
        });
        service.broadcastLifecycleEvent = jest.fn();

        const result = await service.handleBuildEvent({
            repoOwner: 'agent-apps',
            repoName: 'demo',
            slug: 'demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            platforms: 'linux/amd64,linux/arm64',
            commitSha: 'abcdef1234567890',
            imageTag: 'sha-abcdef123456',
            buildStatus: 'success',
            runId: 'run-1',
        });

        expect(store.updateApp).toHaveBeenCalledWith('app-1', 'user-1', expect.objectContaining({
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            metadata: expect.objectContaining({
                lastSuccessfulBuild: expect.objectContaining({
                    imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
                    platforms: 'linux/amd64,linux/arm64',
                }),
            }),
        }));
        expect(result.app.imageRepo).toBe('gitea.demoserver2.buzz/agent-apps/demo');
    });

    test('deployApp lets remote-build override legacy in-cluster metadata', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            status: 'built',
            metadata: {
                deploymentTarget: 'in-cluster',
                requestedContainerPort: 80,
            },
        };
        const buildRun = {
            id: 'run-1',
            buildStatus: 'success',
            deployStatus: 'pending',
            imageTag: 'sha-abcdef123456',
            metadata: {},
        };
        const deployManagedApp = jest.fn(async () => ({
            namespace: 'app-demo',
            deployment: 'demo',
            verification: {
                rollout: true,
                tls: false,
                https: true,
            },
            rollout: {
                ok: true,
            },
        }));

        const store = {
            isAvailable: () => true,
            listBuildRunsForApp: jest.fn(async () => ([buildRun])),
            updateApp: jest.fn(async (_id, _ownerId, updates) => ({
                ...app,
                ...updates,
                metadata: updates.metadata,
            })),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
        };

        const service = new ManagedAppService({
            store,
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                deployManagedApp,
            },
        });

        service.resolveApp = jest.fn(async () => app);
        service.getEffectiveGiteaConfig = () => ({
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });
        service.recordClusterDeployment = jest.fn();
        service.broadcastLifecycleEvent = jest.fn();

        const result = await service.deployApp('demo', {}, 'user-1', {
            executionProfile: 'remote-build',
            sessionId: 'session-1',
        });

        expect(deployManagedApp).toHaveBeenCalledWith(expect.objectContaining({
            deploymentTarget: 'ssh',
        }));
        expect(result.message).toContain('HTTPS is responding');
    });

    test('deployApp uses the configured ssh lane for legacy in-cluster managed apps', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            namespace: 'app-demo',
            publicHost: 'demo.demoserver2.buzz',
            status: 'built',
            metadata: {
                deploymentTarget: 'in-cluster',
                requestedContainerPort: 80,
            },
        };
        const buildRun = {
            id: 'run-1',
            buildStatus: 'success',
            deployStatus: 'pending',
            imageTag: 'sha-abcdef123456',
            metadata: {},
        };
        const deployManagedApp = jest.fn(async () => ({
            namespace: 'app-demo',
            deployment: 'demo',
            verification: {
                rollout: true,
                tls: false,
                https: true,
            },
            rollout: {
                ok: true,
            },
        }));

        const store = {
            isAvailable: () => true,
            listBuildRunsForApp: jest.fn(async () => ([buildRun])),
            updateApp: jest.fn(async (_id, _ownerId, updates) => ({
                ...app,
                ...updates,
                metadata: updates.metadata,
            })),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
        };

        const service = new ManagedAppService({
            store,
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                deployManagedApp,
            },
        });

        service.resolveApp = jest.fn(async () => app);
        service.getEffectiveGiteaConfig = () => ({
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            deployTarget: 'ssh',
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });
        service.recordClusterDeployment = jest.fn();
        service.broadcastLifecycleEvent = jest.fn();

        await service.deployApp('demo', {}, 'user-1', {
            sessionId: 'session-1',
        });

        expect(deployManagedApp).toHaveBeenCalledWith(expect.objectContaining({
            deploymentTarget: 'ssh',
        }));
    });

    test('deployApp heals legacy managed app namespaces before deployment', async () => {
        const app = {
            id: 'app-1',
            ownerId: 'user-1',
            sessionId: 'session-1',
            slug: 'demo',
            appName: 'Demo',
            imageRepo: 'gitea.demoserver2.buzz/agent-apps/demo',
            namespace: 'managed-app',
            publicHost: 'demo.demoserver2.buzz',
            status: 'built',
            metadata: {
                deploymentTarget: 'ssh',
                requestedContainerPort: 80,
            },
        };
        const healedApp = {
            ...app,
            namespace: 'app-demo',
        };
        const buildRun = {
            id: 'run-1',
            buildStatus: 'success',
            deployStatus: 'pending',
            imageTag: 'sha-abcdef123456',
            metadata: {},
        };
        const deployManagedApp = jest.fn(async () => ({
            namespace: 'app-demo',
            deployment: 'demo',
            verification: {
                rollout: true,
                tls: false,
                https: true,
            },
            rollout: {
                ok: true,
            },
        }));

        const store = {
            isAvailable: () => true,
            listBuildRunsForApp: jest.fn(async () => ([buildRun])),
            updateApp: jest.fn()
                .mockResolvedValueOnce({
                    ...healedApp,
                    metadata: {
                        ...healedApp.metadata,
                        deploymentTarget: 'ssh',
                    },
                })
                .mockResolvedValueOnce({
                    ...healedApp,
                    status: 'live',
                    metadata: {
                        ...healedApp.metadata,
                        deploymentTarget: 'ssh',
                        lastImage: 'gitea.demoserver2.buzz/agent-apps/demo:sha-abcdef123456',
                    },
                }),
            updateBuildRun: jest.fn(async (_id, updates) => ({
                ...buildRun,
                ...updates,
            })),
        };

        const service = new ManagedAppService({
            store,
            kubernetesClient: {
                isConfigured: jest.fn((target) => target === 'ssh'),
                deployManagedApp,
            },
        });

        service.resolveApp = jest.fn(async () => app);
        service.getEffectiveGiteaConfig = () => ({
            registryHost: 'gitea.demoserver2.buzz',
            registryUsername: 'builder',
            registryPassword: 'secret',
        });
        service.getEffectiveManagedAppsConfig = () => ({
            namespacePrefix: 'app-',
            defaultContainerPort: 80,
            registryPullSecretName: 'gitea-registry-credentials',
        });
        service.recordClusterDeployment = jest.fn();
        service.broadcastLifecycleEvent = jest.fn();

        const result = await service.deployApp('demo', {}, 'user-1', {
            executionProfile: 'remote-build',
            sessionId: 'session-1',
        });

        expect(store.updateApp).toHaveBeenNthCalledWith(1, 'app-1', 'user-1', expect.objectContaining({
            namespace: 'app-demo',
        }));
        expect(deployManagedApp).toHaveBeenCalledWith(expect.objectContaining({
            namespace: 'app-demo',
            deploymentTarget: 'ssh',
        }));
        expect(result.app.namespace).toBe('app-demo');
    });
});
