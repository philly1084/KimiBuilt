const { Planner } = require('./Planner');

describe('Planner', () => {
  test('conversation synthesis prompt includes the skill context placeholder', () => {
    const planner = new Planner(null, null);

    expect(planner.buildConversationSynthesisPrompt()).toContain('{{skillContext}}');
  });
});
