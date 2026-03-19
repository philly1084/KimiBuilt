const { WorkingMemory } = require('./WorkingMemory');

describe('WorkingMemory', () => {
    test('resolves intermediate and nested values using dot-notation', () => {
        const memory = new WorkingMemory('session-1');

        memory.setCurrentTask({
            objective: 'Review the repo',
            input: {
                content: 'Inspect the agent stack',
            },
        });
        memory.setIntermediateResult('analysis.summary', 'split-brain architecture');
        memory.setIntermediateResult('analysis', {
            summary: 'split-brain architecture',
        });
        memory.updatePreference('responseStyle', 'detailed');

        expect(memory.get('currentTask.objective')).toBe('Review the repo');
        expect(memory.get('analysis.summary')).toBe('split-brain architecture');
        expect(memory.get('responseStyle')).toBe('detailed');
    });
});
