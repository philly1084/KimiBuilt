const {
  buildDirectPodcastParams,
} = require('./direct-podcast-chat');

describe('direct podcast chat intent', () => {
  test('preserves the full creative brief and infers a solo host request', () => {
    const request = [
      'Please make a one-speaker podcast.',
      'Title: NASA After Dark: Real Space Facts for a Sci-Fi Night.',
      'Use real NASA facts as launch points: Voyager, the ISS, Mars rovers, Deep Space Network, Parker Solar Probe, JWST, and Apollo moon dust.',
      'Keep it cinematic but grounded.',
    ].join(' ');

    const params = buildDirectPodcastParams({ text: request });

    expect(params).toEqual(expect.objectContaining({
      hostCount: 1,
      requestBrief: request,
    }));
    expect(params.topic).toContain('Title: NASA After Dark');
    expect(params.requestBrief).toContain('one-speaker podcast');
    expect(params.requestBrief).toContain('Voyager');
    expect(params.requestBrief).toContain('cinematic but grounded');
  });
});
