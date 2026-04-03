'use strict';

const {
    applyProjectPlanPatch,
    extractProjectPlan,
    formatProjectExecutionContext,
    normalizeProjectPlan,
    recordProjectReview,
} = require('./project-plans');

describe('workload project plans', () => {
    test('normalizes project mode plans with defaults and an active milestone', () => {
        const project = normalizeProjectPlan({
            title: 'Ship remote build mode',
            objective: 'Build and deploy the remote build workflow.',
            milestones: [{
                title: 'Plan the rollout',
                acceptanceCriteria: ['Review approved'],
            }, {
                title: 'Deploy the workflow',
                status: 'planned',
            }],
        });

        expect(project.governance).toEqual({
            lockedPlan: true,
            modificationPolicy: 'technical_requirements_only',
        });
        expect(project.activeMilestoneId).toBe('plan-the-rollout');
        expect(project.milestones[0]).toEqual(expect.objectContaining({
            status: 'planned',
            acceptanceCriteria: ['Review approved'],
        }));
    });

    test('extracts a project plan from workload metadata and renders execution guidance', () => {
        const project = extractProjectPlan({
            mode: 'project',
            title: 'Ship remote build mode',
            prompt: 'Implement and deploy the workflow.',
            metadata: {
                project: {
                    milestones: [{
                        id: 'm1',
                        title: 'Plan the rollout',
                        status: 'in_progress',
                        acceptanceCriteria: ['Review approved'],
                    }],
                },
            },
        });

        const context = formatProjectExecutionContext(project);
        expect(context).toContain('<project_mode>');
        expect(context).toContain('Modification policy: technical_requirements_only');
        expect(context).toContain('Plan the rollout [in_progress]');
        expect(context).toContain('Do not silently reorder milestones');
    });

    test('rejects structural plan changes unless they are technical requirements', () => {
        const current = normalizeProjectPlan({
            title: 'Ship remote build mode',
            objective: 'Build and deploy the workflow.',
            milestones: [{
                id: 'm1',
                title: 'Plan the rollout',
                acceptanceCriteria: ['Review approved'],
            }],
        });

        expect(() => applyProjectPlanPatch(current, {
            milestones: [{
                id: 'm1',
                title: 'Replace the rollout plan',
                acceptanceCriteria: ['Review approved'],
            }],
        })).toThrow('technical requirement');
    });

    test('allows technical plan changes and records them in the change log', () => {
        const current = normalizeProjectPlan({
            title: 'Ship remote build mode',
            objective: 'Build and deploy the workflow.',
            milestones: [{
                id: 'm1',
                title: 'Plan the rollout',
                acceptanceCriteria: ['Review approved'],
            }],
        });

        const updated = applyProjectPlanPatch(current, {
            milestones: [{
                id: 'm1',
                title: 'Refine the rollout after schema changes',
                acceptanceCriteria: ['Review approved', 'Schema updated'],
            }],
        }, {
            changeReason: {
                type: 'technical_requirement',
                summary: 'The schema changed and the milestone must expand.',
            },
        });

        expect(updated.milestones[0]).toEqual(expect.objectContaining({
            title: 'Refine the rollout after schema changes',
        }));
        expect(updated.changeLog).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'technical_requirement',
            }),
        ]));
    });

    test('records review history without rewriting the milestone plan', () => {
        const current = normalizeProjectPlan({
            title: 'Ship remote build mode',
            objective: 'Build and deploy the workflow.',
            milestones: [{
                id: 'm1',
                title: 'Plan the rollout',
                status: 'in_progress',
            }],
        });

        const reviewed = recordProjectReview(current, {
            runId: 'run-1',
            milestoneId: 'm1',
            status: 'completed',
            summary: 'Reviewed the milestone and confirmed the rollout plan.',
        });

        expect(reviewed.reviewHistory).toEqual(expect.arrayContaining([
            expect.objectContaining({
                runId: 'run-1',
                milestoneId: 'm1',
            }),
        ]));
        expect(reviewed.milestones[0].title).toBe('Plan the rollout');
        expect(reviewed.milestones[0].lastReviewedAt).toEqual(expect.any(String));
    });
});
