const {
  IMPRESSIVE_FRONTEND_QUALITY_BAR,
  hasWebsiteBuildIntent,
  inferAgentRolePipeline,
} = require('./agent-roles');

describe('agent role frontend sandbox detection', () => {
  test('treats browser games and Vite previews as sandbox frontend builds', () => {
    expect(hasWebsiteBuildIntent('Build a playable browser game with a Vite preview')).toBe(true);
    expect(hasWebsiteBuildIntent('Make a multi-step frontend sandbox for onboarding')).toBe(true);

    const pipeline = inferAgentRolePipeline({
      objective: 'Build a web game in the sandbox with restart controls',
    });

    expect(pipeline.requiresSandbox).toBe(true);
    expect(pipeline.sandboxPolicy).toEqual(expect.objectContaining({
      required: true,
      mode: 'project',
    }));
    expect(IMPRESSIVE_FRONTEND_QUALITY_BAR.appliesTo).toEqual(expect.arrayContaining([
      'browser-game',
      'vite-preview',
    ]));
  });
});
