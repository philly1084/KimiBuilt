const fs = require('fs');
const os = require('os');
const path = require('path');

describe('agent notes helpers', () => {
  const originalEnv = process.env;
  let tempDir;
  let notesPath;
  let agentNotes;

  beforeEach(() => {
    jest.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimibuilt-agent-notes-'));
    notesPath = path.join(tempDir, 'agent-notes.md');
    process.env = {
      ...originalEnv,
      KIMIBUILT_AGENT_NOTES_PATH: notesPath,
    };
    agentNotes = require('./agent-notes');
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('writes normalized notes content and exposes effective metadata', () => {
    const saved = agentNotes.writeAgentNotesFile('# Carryover Notes\r\n- Phil likes concise updates.\r\n');

    expect(saved.filePath).toBe(notesPath);
    expect(saved.characterLimit).toBe(agentNotes.AGENT_NOTES_CHAR_LIMIT);
    expect(fs.readFileSync(notesPath, 'utf8')).toBe('# Carryover Notes\n- Phil likes concise updates.\n');
  });

  test('rejects notes content above the hard character limit', () => {
    expect(() => {
      agentNotes.writeAgentNotesFile(`A${'x'.repeat(agentNotes.AGENT_NOTES_CHAR_LIMIT)}`);
    }).toThrow(`agent-notes.md cannot exceed ${agentNotes.AGENT_NOTES_CHAR_LIMIT} characters`);
  });

  test('builds carryover instructions that include the file path and current notes', () => {
    agentNotes.writeAgentNotesFile('# Carryover Notes\n- Remember the roadmap naming.\n');

    const instructions = agentNotes.buildAgentNotesInstructions({
      enabled: true,
      displayName: 'Carryover Notes',
    });

    expect(instructions).toContain('[Carryover notes memory]');
    expect(instructions).toContain(`The notes file lives at ${notesPath}`);
    expect(instructions).toContain('facts about working with Phil');
    expect(instructions).toContain('- Remember the roadmap naming.');
  });
});
