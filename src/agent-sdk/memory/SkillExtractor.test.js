const { SkillExtractor } = require('./SkillExtractor');

describe('SkillExtractor', () => {
  test('extracts remote operations verbs and k3s keywords as trigger patterns', () => {
    const extractor = new SkillExtractor({
      embed: jest.fn(async () => [0.1, 0.2, 0.3]),
    });

    const patterns = extractor.extractTriggerPatterns({
      objective: 'Troubleshoot kubectl rollout on the k3s cluster via ssh and inspect ingress logs',
    });

    expect(patterns).toEqual(expect.arrayContaining([
      'troubleshoot',
      'inspect',
      'ssh',
      'k3s',
      'kubectl',
      'ingress',
      'rollout',
      'logs',
    ]));
  });
});
