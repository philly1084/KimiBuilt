const {
    isDashboardRequest,
    selectDashboardTemplates,
    buildDashboardTemplatePromptContext,
} = require('./dashboard-template-catalog');

describe('dashboard-template-catalog', () => {
    test('detects dashboard-oriented prompts beyond the literal word dashboard', () => {
        expect(isDashboardRequest('Build an admin panel for user permissions')).toBe(true);
        expect(isDashboardRequest('Create a control tower for logistics operations')).toBe(true);
        expect(isDashboardRequest('Write a project proposal')).toBe(false);
    });

    test('selectDashboardTemplates prioritizes domain-relevant templates', () => {
        const salesTemplates = selectDashboardTemplates({
            prompt: 'Create a sales dashboard for pipeline health and quota attainment',
            limit: 2,
        });

        expect(salesTemplates).toHaveLength(2);
        expect(salesTemplates[0]).toEqual(expect.objectContaining({
            id: 'sales-pipeline-radar',
        }));
    });

    test('buildDashboardTemplatePromptContext returns a compact template catalog block', () => {
        const context = buildDashboardTemplatePromptContext({
            prompt: 'Create an ecommerce dashboard for orders and returns',
            limit: 2,
        });

        expect(context).toContain('[Dashboard template catalog]');
        expect(context).toContain('Option 1: Ecommerce Revenue Studio');
        expect(context).toContain('Option 2:');
    });
});
