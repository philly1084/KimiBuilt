const {
  parseGitLog,
  summarizeCommits,
} = require('./lilly-history');

describe('lilly-history', () => {
  test('parses git log lines into categorized Lilly pulls', () => {
    const commits = parseGitLog([
      'aaa1111\t2026-03-05\tAdd Web CLI interface',
      'bbb2222\t2026-03-14\tFix admin dashboard API errors',
      'ccc3333\t2026-05-02\tDeploy Kokoro TTS service with backend',
    ].join('\n'));

    expect(commits).toHaveLength(3);
    expect(commits[0]).toMatchObject({
      shortHash: 'aaa1111',
      phase: 'ignition',
      primaryTag: 'growth',
    });
    expect(commits[1].tags).toContain('repair');
    expect(commits[2].tags).toContain('ops');
    expect(commits[2].tags).toContain('media');
  });

  test('summarizes phases, categories, and all tile dots', () => {
    const commits = parseGitLog([
      'aaa1111\t2026-03-05\tAdd Web CLI interface',
      'bbb2222\t2026-03-14\tFix admin dashboard API errors',
      'ccc3333\t2026-05-02\tMerge pull request #12 from philly1084/codex/example',
    ].join('\n'));

    const summary = summarizeCommits(commits);

    expect(summary.totalPulls).toBe(3);
    expect(summary.mergedPullRequests).toBe(1);
    expect(summary.tiles).toHaveLength(3);
    expect(summary.phases.map((phase) => phase.id)).toEqual([
      'ignition',
      'notes-admin',
      'live-learning',
    ]);
  });
});
