'use strict';

jest.mock('../routes/admin/settings.controller', () => ({
    getEffectiveGiteaConfig: jest.fn(() => ({
        enabled: true,
        baseURL: 'https://gitea.example.com',
        token: 'gitea-token',
        org: 'agent-apps',
    })),
}));

const { GiteaClient } = require('./gitea-client');

describe('GiteaClient', () => {
    let originalFetch;

    beforeEach(() => {
        originalFetch = global.fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('creates the managed app organization when it does not exist', async () => {
        global.fetch = jest.fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 404,
                text: async () => '',
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 201,
                text: async () => JSON.stringify({
                    username: 'agent-apps',
                    full_name: 'KimiBuilt Managed Apps',
                }),
            });

        const client = new GiteaClient();
        const result = await client.ensureOrganization({
            name: 'agent-apps',
            fullName: 'KimiBuilt Managed Apps',
        });

        expect(result.created).toBe(true);
        expect(result.organization).toEqual(expect.objectContaining({
            username: 'agent-apps',
        }));
        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/orgs/agent-apps',
            }),
            expect.objectContaining({
                method: 'GET',
            }),
        );
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/orgs',
            }),
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"username":"agent-apps"'),
            }),
        );
    });

    test('fetches the current organization runner registration token', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                token: 'runner-token-123',
            }),
        });

        const client = new GiteaClient();
        const result = await client.getRunnerRegistrationToken({
            scope: 'org',
            org: 'agent-apps',
        });

        expect(result).toEqual({
            scope: 'org',
            token: 'runner-token-123',
            rotated: false,
        });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/orgs/agent-apps/actions/runners/registration-token',
            }),
            expect.objectContaining({
                method: 'GET',
            }),
        );
    });

    test('rotates the organization runner registration token on request', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                token: 'runner-token-rotated',
            }),
        });

        const client = new GiteaClient();
        const result = await client.getRunnerRegistrationToken({
            scope: 'org',
            org: 'agent-apps',
            rotate: true,
        });

        expect(result).toEqual({
            scope: 'org',
            token: 'runner-token-rotated',
            rotated: true,
        });
        expect(global.fetch).toHaveBeenCalledWith(
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/orgs/agent-apps/actions/runners/registration-token',
            }),
            expect.objectContaining({
                method: 'POST',
            }),
        );
    });

    test('lists organization runners for health checks', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                total_count: 1,
                runners: [{
                    id: 7,
                    name: 'agent-platform-runner',
                    status: 'online',
                }],
            }),
        });

        const client = new GiteaClient();
        const result = await client.listActionsRunners({
            scope: 'org',
            org: 'agent-apps',
        });

        expect(result.totalCount).toBe(1);
        expect(result.runners).toEqual([expect.objectContaining({
            id: 7,
            status: 'online',
        })]);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/orgs/agent-apps/actions/runners',
            }),
            expect.objectContaining({
                method: 'GET',
            }),
        );
    });

    test('lists repository workflow runs filtered by head sha', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                total_count: 1,
                workflow_runs: [{
                    id: 42,
                    head_sha: 'abcdef1234567890',
                    status: 'completed',
                    conclusion: 'success',
                }],
            }),
        });

        const client = new GiteaClient();
        const result = await client.listRepositoryWorkflowRuns({
            owner: 'agent-apps',
            repo: 'demo-app',
            headSha: 'abcdef1234567890',
            limit: 5,
        });

        expect(result.totalCount).toBe(1);
        expect(result.workflowRuns).toEqual([expect.objectContaining({
            id: 42,
            conclusion: 'success',
        })]);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.objectContaining({
                href: 'https://gitea.example.com/api/v1/repos/agent-apps/demo-app/actions/runs?head_sha=abcdef1234567890&page=1&limit=5',
            }),
            expect.objectContaining({
                method: 'GET',
            }),
        );
    });
});
