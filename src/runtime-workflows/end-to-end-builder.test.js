const {
    END_TO_END_WORKFLOW_KIND,
    advanceEndToEndBuilderWorkflow,
    buildEndToEndWorkflowPlan,
    evaluateEndToEndBuilderWorkflow,
    inferEndToEndBuilderWorkflow,
} = require('./end-to-end-builder');

function buildToolEvent(tool, params = {}, result = {}) {
    return {
        toolCall: {
            function: {
                name: tool,
                arguments: JSON.stringify(params),
            },
        },
        result: {
            success: true,
            toolId: tool,
            data: {},
            ...result,
        },
    };
}

describe('end-to-end builder workflow', () => {
    test('classifies repo-to-deploy requests into a repo-then-deploy lane', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Fix the landing page in the repo, push it to GitHub, deploy it to k3s, and verify the rollout.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'local',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        expect(workflow).toEqual(expect.objectContaining({
            kind: END_TO_END_WORKFLOW_KIND,
            lane: 'repo-then-deploy',
            stage: 'implementing',
            status: 'active',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'local',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        }));
    });

    test('classifies explicit opencode create-and-deploy requests into a repo-then-deploy lane', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Use opencode to create a tiny smoke-test app and add it to the k3s cluster.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'local',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        expect(workflow).toEqual(expect.objectContaining({
            kind: END_TO_END_WORKFLOW_KIND,
            lane: 'repo-then-deploy',
            stage: 'implementing',
            status: 'active',
        }));
    });

    test('emits deterministic repo-then-deploy steps in order', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Fix the build in the repo, push it to GitHub, deploy it to k3s, and verify the rollout.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'local',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });
        const toolPolicy = {
            candidateToolIds: ['opencode-run', 'git-safe', 'k3s-deploy', 'remote-command'],
        };

        const implementationPlan = buildEndToEndWorkflowPlan({
            workflow,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(implementationPlan).toEqual([
            expect.objectContaining({
                tool: 'opencode-run',
                params: expect.objectContaining({
                    target: 'local',
                    workspacePath: '/workspace/app',
                }),
            }),
        ]);

        const afterImplementation = advanceEndToEndBuilderWorkflow({
            workflow,
            toolEvents: [
                buildToolEvent('opencode-run', {}, {
                    data: {
                        workspacePath: '/workspace/app',
                        summary: 'Build fixed.',
                    },
                }),
            ],
        });
        expect(afterImplementation).toEqual(expect.objectContaining({
            stage: 'saving',
            progress: expect.objectContaining({
                implemented: true,
            }),
        }));

        const remoteInfoPlan = buildEndToEndWorkflowPlan({
            workflow: afterImplementation,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(remoteInfoPlan).toEqual([
            expect.objectContaining({
                tool: 'git-safe',
                params: expect.objectContaining({
                    action: 'remote-info',
                    repositoryPath: '/workspace/app',
                }),
            }),
        ]);

        const afterRemoteInfo = advanceEndToEndBuilderWorkflow({
            workflow: afterImplementation,
            toolEvents: [
                buildToolEvent('git-safe', { action: 'remote-info' }, {
                    data: {
                        action: 'remote-info',
                        stdout: 'branch: main',
                    },
                }),
            ],
        });
        const saveAndPushPlan = buildEndToEndWorkflowPlan({
            workflow: afterRemoteInfo,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(saveAndPushPlan).toEqual([
            expect.objectContaining({
                tool: 'git-safe',
                params: expect.objectContaining({
                    action: 'save-and-push',
                    repositoryPath: '/workspace/app',
                }),
            }),
        ]);

        const afterSaveAndPush = advanceEndToEndBuilderWorkflow({
            workflow: afterRemoteInfo,
            toolEvents: [
                buildToolEvent('git-safe', { action: 'save-and-push' }, {
                    data: {
                        action: 'save-and-push',
                        branch: 'main',
                    },
                }),
            ],
        });
        const deployPlan = buildEndToEndWorkflowPlan({
            workflow: afterSaveAndPush,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(deployPlan).toEqual([
            expect.objectContaining({
                tool: 'k3s-deploy',
                params: expect.objectContaining({
                    action: 'sync-and-apply',
                }),
            }),
        ]);

        const afterDeploy = advanceEndToEndBuilderWorkflow({
            workflow: afterSaveAndPush,
            toolEvents: [
                buildToolEvent('k3s-deploy', { action: 'sync-and-apply' }, {
                    data: {
                        action: 'sync-and-apply',
                        stdout: 'deployment applied',
                    },
                }),
            ],
        });
        const verifyPlan = buildEndToEndWorkflowPlan({
            workflow: afterDeploy,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(verifyPlan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                params: expect.objectContaining({
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    command: expect.stringContaining('kubectl rollout status deployment/'),
                }),
            }),
        ]);

        const completedWorkflow = advanceEndToEndBuilderWorkflow({
            workflow: afterDeploy,
            toolEvents: [
                buildToolEvent('remote-command', {}, {
                    data: {
                        stdout: 'deployment "backend" successfully rolled out',
                    },
                }),
            ],
        });
        expect(completedWorkflow).toEqual(expect.objectContaining({
            stage: 'completed',
            status: 'completed',
            progress: expect.objectContaining({
                verified: true,
            }),
        }));
        expect(buildEndToEndWorkflowPlan({
            workflow: completedWorkflow,
            toolPolicy,
            remoteToolId: 'remote-command',
        })).toEqual([]);
    });

    test('uses remote-command to build and deploy a remote workspace after OpenCode implementation', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Fix the app in the remote repo, deploy it to k3s on the same server, and verify the rollout.',
            workspacePath: '/var/www/test.demoserver2.buzz',
            repositoryPath: '/workspace/local-clone',
            opencodeTarget: 'remote-default',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });
        const toolPolicy = {
            candidateToolIds: ['opencode-run', 'remote-command'],
            preferredRemoteToolId: 'remote-command',
        };

        expect(workflow).toEqual(expect.objectContaining({
            lane: 'repo-then-deploy',
            deliveryMode: 'remote-workspace',
            completionCriteria: expect.arrayContaining([
                'Remote workspace built and deployed',
            ]),
        }));

        const implementationPlan = buildEndToEndWorkflowPlan({
            workflow,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(implementationPlan).toEqual([
            expect.objectContaining({
                tool: 'opencode-run',
                params: expect.objectContaining({
                    target: 'remote-default',
                    workspacePath: '/var/www/test.demoserver2.buzz',
                }),
            }),
        ]);

        const afterImplementation = advanceEndToEndBuilderWorkflow({
            workflow,
            toolEvents: [
                buildToolEvent('opencode-run', {}, {
                    data: {
                        workspacePath: '/var/www/test.demoserver2.buzz',
                        summary: 'Remote repo updated.',
                    },
                }),
            ],
        });
        expect(afterImplementation).toEqual(expect.objectContaining({
            stage: 'saving',
            progress: expect.objectContaining({
                implemented: true,
            }),
        }));

        const deployPlan = buildEndToEndWorkflowPlan({
            workflow: afterImplementation,
            toolPolicy,
            remoteToolId: 'remote-command',
        });
        expect(deployPlan).toEqual([
            expect.objectContaining({
                tool: 'remote-command',
                reason: expect.stringContaining('Build the remote workspace'),
                params: expect.objectContaining({
                    host: '10.0.0.5',
                    username: 'ubuntu',
                    port: 22,
                    workingDirectory: '/var/www/test.demoserver2.buzz',
                    workflowAction: 'build-and-deploy-remote-workspace',
                    command: expect.stringContaining('kubectl apply -f'),
                }),
            }),
        ]);
        expect(deployPlan[0].params.command).toContain('app/package.json');

        const completedWorkflow = advanceEndToEndBuilderWorkflow({
            workflow: afterImplementation,
            toolEvents: [
                buildToolEvent('remote-command', {
                    workflowAction: 'build-and-deploy-remote-workspace',
                }, {
                    data: {
                        stdout: 'deployment "backend" successfully rolled out',
                    },
                }),
            ],
        });
        expect(completedWorkflow).toEqual(expect.objectContaining({
            stage: 'completed',
            status: 'completed',
            progress: expect.objectContaining({
                deployed: true,
                verified: true,
            }),
        }));
    });

    test('reuses an active stored workflow on continuation prompts', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'continue',
            session: {
                metadata: {
                    controlState: {
                        workflow: {
                            kind: END_TO_END_WORKFLOW_KIND,
                            version: 1,
                            objective: 'Fix the repo, push it, and deploy it.',
                            lane: 'repo-then-deploy',
                            stage: 'saving',
                            status: 'active',
                            workspacePath: '/workspace/app',
                            repositoryPath: '/workspace/app',
                            opencodeTarget: 'local',
                            progress: {
                                implemented: true,
                            },
                        },
                    },
                },
            },
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
        });

        expect(workflow).toEqual(expect.objectContaining({
            lane: 'repo-then-deploy',
            stage: 'saving',
            progress: expect.objectContaining({
                implemented: true,
            }),
            source: 'stored',
        }));
    });

    test('does not classify discovery-first server planning prompts as implementation workflows', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'I want to build on the server, let\'s start with a couple questionnaires to figure out what we should work on. Some kind of web app we can run on our VPS server with demoserver2.buzz DNS. Can you do some research on the server and then provide those questions.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'remote-default',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        expect(workflow).toBeNull();
    });

    test('does not classify opencode command-help prompts as implementation workflows', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Use remote build to give a command to opencode.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'remote-default',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        expect(workflow).toBeNull();
    });

    test('blocks a repo-then-deploy workflow when repository implementation is required but opencode is unavailable', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Fix the auth service in the repo, push it to GitHub, deploy it to k3s, and verify the rollout.',
            workspacePath: '/workspace/app',
            repositoryPath: '/workspace/app',
            opencodeTarget: 'remote-default',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        const blockedWorkflow = evaluateEndToEndBuilderWorkflow({
            workflow,
            toolPolicy: {
                candidateToolIds: ['remote-command', 'git-safe', 'k3s-deploy'],
                preferredRemoteToolId: 'remote-command',
            },
        });

        expect(blockedWorkflow).toEqual(expect.objectContaining({
            lane: 'repo-then-deploy',
            stage: 'blocked',
            status: 'blocked',
            lastError: expect.stringContaining('`opencode-run` is not ready'),
        }));
    });

    test('does not require git-safe or k3s-deploy for a remote workspace deploy flow', () => {
        const workflow = inferEndToEndBuilderWorkflow({
            objective: 'Fix the app in the remote repo, deploy it to k3s on the same server, and verify the rollout.',
            workspacePath: '/var/www/test.demoserver2.buzz',
            repositoryPath: '/workspace/local-clone',
            opencodeTarget: 'remote-default',
            remoteTarget: {
                host: '10.0.0.5',
                username: 'ubuntu',
                port: 22,
            },
        });

        const afterImplementation = advanceEndToEndBuilderWorkflow({
            workflow,
            toolEvents: [
                buildToolEvent('opencode-run', {}, {
                    data: {
                        workspacePath: '/var/www/test.demoserver2.buzz',
                    },
                }),
            ],
        });

        const evaluated = evaluateEndToEndBuilderWorkflow({
            workflow: afterImplementation,
            toolPolicy: {
                candidateToolIds: ['remote-command'],
                preferredRemoteToolId: 'remote-command',
            },
        });

        expect(evaluated).toEqual(expect.objectContaining({
            stage: 'saving',
            status: 'active',
            lastError: null,
        }));
    });
});
