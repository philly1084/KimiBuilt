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
});
