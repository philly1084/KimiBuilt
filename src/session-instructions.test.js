jest.mock('./agent-soul', () => ({
  buildSoulInstructions: jest.fn(() => '[Agent soul]\nSoul content'),
}));

jest.mock('./agent-notes', () => ({
  buildAgentNotesInstructions: jest.fn(() => '[Carryover notes memory]\nNotes content'),
}));

jest.mock('./business-agent', () => ({
  isDefaultBusinessAgentProfile: jest.fn(() => false),
}));

jest.mock('./project-memory', () => ({
  buildProjectMemoryInstructions: jest.fn(() => ''),
}));

jest.mock('./routes/admin/settings.controller', () => ({
  settings: {
    personality: {
      enabled: true,
      displayName: 'Agent Soul',
    },
    agentNotes: {
      enabled: true,
      displayName: 'Carryover Notes',
    },
  },
}));

jest.mock('./runtime-control-state', () => ({
  getSessionControlState: jest.fn(() => ({})),
}));

const { buildSoulInstructions } = require('./agent-soul');
const { buildAgentNotesInstructions } = require('./agent-notes');
const { buildSessionInstructions } = require('./session-instructions');

describe('buildSessionInstructions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    buildSoulInstructions.mockReturnValue('[Agent soul]\nSoul content');
    buildAgentNotesInstructions.mockReturnValue('[Carryover notes memory]\nNotes content');
  });

  test('injects the shared soul and carryover notes between base instructions and saved agent metadata', () => {
    const result = buildSessionInstructions({
      metadata: {
        agent: {
          instructions: 'Stay sharp.',
          name: 'Kimi',
          tools: ['remote-command', 'git-safe'],
        },
      },
    }, 'Base instructions');

    expect(buildSoulInstructions).toHaveBeenCalledWith({
      enabled: true,
      displayName: 'Agent Soul',
    });
    expect(buildAgentNotesInstructions).toHaveBeenCalledWith({
      enabled: true,
      displayName: 'Carryover Notes',
    });
    expect(result).toContain('Base instructions');
    expect(result).toContain('[Agent soul]\nSoul content');
    expect(result).toContain('[Carryover notes memory]\nNotes content');
    expect(result).toContain('Saved agent profile: Stay sharp.');
    expect(result).toContain('Agent name: Kimi');
    expect(result).toContain('Preferred workflow tools: remote-command, git-safe.');
    expect(result.indexOf('[Agent soul]')).toBeGreaterThan(result.indexOf('Base instructions'));
    expect(result.indexOf('[Carryover notes memory]')).toBeGreaterThan(result.indexOf('[Agent soul]'));
    expect(result.indexOf('Saved agent profile: Stay sharp.')).toBeGreaterThan(result.indexOf('[Carryover notes memory]'));
  });

  test('omits the soul and notes blocks when neither is active', () => {
    buildSoulInstructions.mockReturnValueOnce('');
    buildAgentNotesInstructions.mockReturnValueOnce('');

    const result = buildSessionInstructions({
      metadata: {},
    }, 'Base instructions');

    expect(result).toBe('Base instructions');
  });
});
