jest.mock('fs', () => ({
  constants: {
    F_OK: 0,
    W_OK: 2,
  },
  accessSync: jest.fn(() => undefined),
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    writeFile: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  },
}));

jest.mock('../../config', () => ({
  config: {
    auth: {
      username: '',
      password: '',
      jwtSecret: '',
    },
  },
}));

jest.mock('../../agent-soul', () => ({
  getEffectiveSoulConfig: jest.fn((settings = {}) => ({
    enabled: settings.enabled !== false,
    displayName: settings.displayName || 'Agent Soul',
    content: '# Soul\n',
    defaultContent: '# Default Soul\n',
    filePath: 'soul.md',
    absoluteFilePath: 'C:/Users/phill/KimiBuilt/soul.md',
    updatedAt: '2026-04-04T00:00:00.000Z',
    source: 'file',
  })),
  writeSoulFile: jest.fn(),
  resetSoulFile: jest.fn(),
}));

describe('settings.controller personality support', () => {
  let controller;
  let fsPromises;
  let soulHelpers;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    fsPromises = require('fs').promises;
    soulHelpers = require('../../agent-soul');
    controller = require('./settings.controller');
    controller.settings = controller.getDefaultSettings();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('update writes soul.md content and merges personality metadata', async () => {
    const req = {
      body: {
        personality: {
          enabled: false,
          displayName: 'Quiet Soul',
          content: '# Quiet soul\n',
        },
      },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await controller.update(req, res);

    expect(soulHelpers.writeSoulFile).toHaveBeenCalledWith('# Quiet soul\n');
    expect(controller.settings.personality).toEqual({
      enabled: false,
      displayName: 'Quiet Soul',
    });
    expect(fsPromises.writeFile).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        personality: expect.objectContaining({
          enabled: false,
          displayName: 'Quiet Soul',
          content: '# Soul\n',
          filePath: 'soul.md',
        }),
      }),
    }));
  });

  test('getPublicSettings exposes effective personality metadata and strips ssh password', () => {
    controller.settings.integrations.ssh.password = 'super-secret';

    const publicSettings = controller.getPublicSettings();

    expect(soulHelpers.getEffectiveSoulConfig).toHaveBeenCalledWith(controller.settings.personality);
    expect(publicSettings.personality).toEqual(expect.objectContaining({
      enabled: true,
      displayName: 'Agent Soul',
      content: '# Soul\n',
      filePath: 'soul.md',
    }));
    expect(publicSettings.integrations.ssh.password).toBeUndefined();
  });

  test('resetting the personality restores default settings and soul file content', async () => {
    controller.settings.personality = {
      enabled: false,
      displayName: 'Custom Soul',
    };

    const req = {
      body: {
        section: 'personality',
      },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    await controller.reset(req, res);

    expect(soulHelpers.resetSoulFile).toHaveBeenCalled();
    expect(controller.settings.personality).toEqual({
      enabled: true,
      displayName: 'Agent Soul',
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      message: 'personality settings reset',
    }));
  });
});
