'use strict';

const { normalizeTimezone, parseCronExpression } = require('./cron-utils');

const VALID_MILESTONE_STATUSES = new Set([
    'planned',
    'in_progress',
    'blocked',
    'completed',
    'skipped',
]);

const VALID_CHANGE_REASON_TYPES = new Set([
    'technical_requirement',
    'manual_review',
    'operator_override',
    'status_update',
]);

function sanitizeText(value = '') {
    return String(value || '').trim();
}

function sanitizeList(values = [], limit = 12) {
    const source = Array.isArray(values) ? values : [values];
    const unique = [];
    const seen = new Set();

    source.forEach((entry) => {
        const normalized = sanitizeText(entry);
        if (!normalized) {
            return;
        }

        const key = normalized.toLowerCase();
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        unique.push(normalized);
    });

    return unique.slice(0, limit);
}

function slugify(value = '', fallback = 'item') {
    const normalized = sanitizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || fallback;
}

function normalizeTimestamp(value = null) {
    if (!value) {
        return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString();
}

function truncateText(value = '', limit = 280) {
    const normalized = sanitizeText(value);
    if (normalized.length <= limit) {
        return normalized;
    }

    return `${normalized.slice(0, limit - 3)}...`;
}

function normalizeDecision(decision = {}, index = 0) {
    const summary = sanitizeText(
        decision.summary
        || decision.title
        || decision.decision
        || `Decision ${index + 1}`,
    );

    return {
        id: sanitizeText(decision.id || '') || slugify(summary, `decision-${index + 1}`),
        summary,
        rationale: sanitizeText(decision.rationale || ''),
        locked: decision.locked !== false,
    };
}

function normalizeMilestone(milestone = {}, index = 0) {
    const title = sanitizeText(
        milestone.title
        || milestone.summary
        || milestone.objective
        || `Milestone ${index + 1}`,
    );
    const status = sanitizeText(milestone.status || 'planned').toLowerCase() || 'planned';

    return {
        id: sanitizeText(milestone.id || '') || slugify(title, `milestone-${index + 1}`),
        title,
        objective: sanitizeText(milestone.objective || ''),
        status: VALID_MILESTONE_STATUSES.has(status) ? status : 'planned',
        acceptanceCriteria: sanitizeList(milestone.acceptanceCriteria || milestone.acceptance_criteria || [], 16),
        deliverables: sanitizeList(milestone.deliverables || [], 16),
        dependencies: sanitizeList(milestone.dependencies || [], 16),
        notes: sanitizeText(milestone.notes || ''),
        lastReviewedAt: normalizeTimestamp(milestone.lastReviewedAt || milestone.last_reviewed_at || null),
    };
}

function inferActiveMilestoneId(milestones = [], preferredId = '') {
    const preferred = sanitizeText(preferredId || '');
    if (preferred && milestones.some((entry) => entry.id === preferred)) {
        return preferred;
    }

    const firstIncomplete = milestones.find((entry) => !['completed', 'skipped'].includes(entry.status));
    return firstIncomplete?.id || milestones[0]?.id || null;
}

function normalizeGovernance(governance = {}) {
    const modificationPolicy = sanitizeText(
        governance.modificationPolicy
        || governance.modification_policy
        || 'technical_requirements_only',
    ).toLowerCase() || 'technical_requirements_only';

    return {
        lockedPlan: governance.lockedPlan !== false && governance.locked_plan !== false,
        modificationPolicy: [
            'technical_requirements_only',
            'manual_review',
            'flexible',
        ].includes(modificationPolicy)
            ? modificationPolicy
            : 'technical_requirements_only',
    };
}

function normalizeCadence(cadence = {}) {
    const reviewCron = sanitizeText(cadence.reviewCron || cadence.review_cron || '');
    if (!reviewCron) {
        return {
            reviewCron: null,
            timezone: null,
        };
    }

    parseCronExpression(reviewCron);
    return {
        reviewCron,
        timezone: normalizeTimezone(cadence.timezone || 'UTC'),
    };
}

function normalizeReviewEntry(entry = {}, index = 0) {
    return {
        id: sanitizeText(entry.id || '') || `review-${index + 1}`,
        runId: sanitizeText(entry.runId || entry.run_id || ''),
        reviewedAt: normalizeTimestamp(entry.reviewedAt || entry.reviewed_at || null) || new Date().toISOString(),
        milestoneId: sanitizeText(entry.milestoneId || entry.milestone_id || '') || null,
        status: sanitizeText(entry.status || ''),
        summary: truncateText(entry.summary || '', 320),
        stageIndex: Number.isFinite(Number(entry.stageIndex))
            ? Number(entry.stageIndex)
            : -1,
        artifactIds: sanitizeList(entry.artifactIds || entry.artifact_ids || [], 12),
    };
}

function normalizeChangeReason(changeReason = null) {
    if (!changeReason || typeof changeReason !== 'object' || Array.isArray(changeReason)) {
        return null;
    }

    const type = sanitizeText(changeReason.type || '');
    const summary = sanitizeText(changeReason.summary || changeReason.reason || '');
    if (!type && !summary) {
        return null;
    }

    return {
        type: VALID_CHANGE_REASON_TYPES.has(type) ? type : 'manual_review',
        summary: summary || 'Plan updated.',
        requestedBy: sanitizeText(changeReason.requestedBy || changeReason.requested_by || ''),
        at: normalizeTimestamp(changeReason.at || null) || new Date().toISOString(),
    };
}

function normalizeProjectPlan(project = {}, defaults = {}) {
    const title = sanitizeText(project.title || defaults.title || 'Long-running project');
    const objective = sanitizeText(project.objective || project.goal || defaults.prompt || '');
    const summary = sanitizeText(project.summary || project.background || '');
    const milestones = Array.isArray(project.milestones) && project.milestones.length > 0
        ? project.milestones.map((entry, index) => normalizeMilestone(entry, index))
        : [normalizeMilestone({
            id: 'milestone-1',
            title: 'Initial delivery milestone',
            objective: objective || 'Refine the delivery plan and begin execution.',
            acceptanceCriteria: project.successDefinition || project.success_definition || [],
        }, 0)];
    const reviewHistory = Array.isArray(project.reviewHistory || project.review_history)
        ? (project.reviewHistory || project.review_history)
            .map((entry, index) => normalizeReviewEntry(entry, index))
            .slice(-20)
        : [];
    const changeLog = Array.isArray(project.changeLog || project.change_log)
        ? (project.changeLog || project.change_log)
            .map((entry) => normalizeChangeReason(entry))
            .filter(Boolean)
            .slice(-20)
        : [];

    return {
        title,
        objective,
        summary,
        constraints: sanitizeList(project.constraints || [], 16),
        successDefinition: sanitizeList(project.successDefinition || project.success_definition || [], 16),
        decisions: Array.isArray(project.decisions)
            ? project.decisions.map((entry, index) => normalizeDecision(entry, index)).slice(0, 16)
            : [],
        milestones,
        activeMilestoneId: inferActiveMilestoneId(milestones, project.activeMilestoneId || project.active_milestone_id || ''),
        governance: normalizeGovernance(project.governance || {}),
        cadence: normalizeCadence(project.cadence || {}),
        reviewHistory,
        changeLog,
        lastReviewedAt: normalizeTimestamp(project.lastReviewedAt || project.last_reviewed_at || null),
        lastRunId: sanitizeText(project.lastRunId || project.last_run_id || '') || null,
    };
}

function extractProjectPlan(source = null, defaults = {}) {
    const metadata = source?.metadata && typeof source.metadata === 'object'
        ? source.metadata
        : {};
    const project = source?.project || metadata.project || null;
    const projectMode = source?.mode === 'project' || metadata.projectMode === true;

    if (!project && !projectMode) {
        return null;
    }

    return normalizeProjectPlan(project || {}, {
        title: defaults.title || source?.title || '',
        prompt: defaults.prompt || source?.prompt || '',
    });
}

function createStructuralSnapshot(project = {}) {
    const normalized = normalizeProjectPlan(project);
    return JSON.stringify({
        title: normalized.title,
        objective: normalized.objective,
        summary: normalized.summary,
        constraints: normalized.constraints,
        successDefinition: normalized.successDefinition,
        governance: normalized.governance,
        cadence: normalized.cadence,
        decisions: normalized.decisions.map((entry) => ({
            id: entry.id,
            summary: entry.summary,
            rationale: entry.rationale,
            locked: entry.locked,
        })),
        milestones: normalized.milestones.map((entry) => ({
            id: entry.id,
            title: entry.title,
            objective: entry.objective,
            acceptanceCriteria: entry.acceptanceCriteria,
            deliverables: entry.deliverables,
            dependencies: entry.dependencies,
        })),
    });
}

function createChangeTrackingSnapshot(project = {}) {
    const normalized = normalizeProjectPlan(project);
    return JSON.stringify({
        activeMilestoneId: normalized.activeMilestoneId,
        milestones: normalized.milestones.map((entry) => ({
            id: entry.id,
            status: entry.status,
            notes: entry.notes,
            lastReviewedAt: entry.lastReviewedAt,
        })),
        lastReviewedAt: normalized.lastReviewedAt,
        lastRunId: normalized.lastRunId,
        structural: createStructuralSnapshot(normalized),
    });
}

function mergeProjectPatch(currentProject = {}, patch = {}) {
    const current = normalizeProjectPlan(currentProject);
    const merged = {
        ...current,
        ...patch,
        governance: {
            ...(current.governance || {}),
            ...((patch && typeof patch.governance === 'object' && !Array.isArray(patch.governance)) ? patch.governance : {}),
        },
        cadence: {
            ...(current.cadence || {}),
            ...((patch && typeof patch.cadence === 'object' && !Array.isArray(patch.cadence)) ? patch.cadence : {}),
        },
    };

    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'reviewHistory')) {
        merged.reviewHistory = current.reviewHistory;
    }
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'changeLog')) {
        merged.changeLog = current.changeLog;
    }

    return merged;
}

function applyProjectPlanPatch(currentProject = {}, patch = {}, options = {}) {
    const current = normalizeProjectPlan(currentProject, options.defaults || {});
    const merged = mergeProjectPatch(current, patch || {});
    const next = normalizeProjectPlan(merged, options.defaults || {});
    const changeReason = normalizeChangeReason(options.changeReason);
    const structuralChange = createStructuralSnapshot(current) !== createStructuralSnapshot(next);
    const meaningfulChange = createChangeTrackingSnapshot(current) !== createChangeTrackingSnapshot(next);

    if (
        structuralChange
        && current.governance.modificationPolicy === 'technical_requirements_only'
        && changeReason?.type !== 'technical_requirement'
    ) {
        throw new Error('Project plan structure is locked and can only be modified for a technical requirement.');
    }

    if (meaningfulChange && changeReason) {
        next.changeLog = [
            ...(current.changeLog || []),
            changeReason,
        ].slice(-20);
    } else if (!Object.prototype.hasOwnProperty.call(patch || {}, 'changeLog')) {
        next.changeLog = current.changeLog || [];
    }

    return next;
}

function recordProjectReview(project = {}, review = {}) {
    const normalized = normalizeProjectPlan(project);
    const reviewedAt = normalizeTimestamp(review.reviewedAt || review.reviewed_at || null) || new Date().toISOString();
    const milestoneId = sanitizeText(review.milestoneId || review.milestone_id || '') || normalized.activeMilestoneId || null;
    const artifacts = Array.isArray(review.artifacts)
        ? review.artifacts
            .map((artifact) => sanitizeText(artifact?.id || artifact?.filename || ''))
            .filter(Boolean)
        : [];

    const nextMilestones = normalized.milestones.map((milestone) => (
        milestone.id === milestoneId
            ? {
                ...milestone,
                lastReviewedAt: reviewedAt,
            }
            : milestone
    ));

    const entry = normalizeReviewEntry({
        runId: review.runId || '',
        reviewedAt,
        milestoneId,
        status: review.status || '',
        summary: review.summary || '',
        stageIndex: review.stageIndex,
        artifactIds: artifacts,
    }, normalized.reviewHistory.length);

    return {
        ...normalized,
        milestones: nextMilestones,
        activeMilestoneId: inferActiveMilestoneId(nextMilestones, normalized.activeMilestoneId),
        lastReviewedAt: reviewedAt,
        lastRunId: sanitizeText(review.runId || '') || normalized.lastRunId || null,
        reviewHistory: [
            ...(normalized.reviewHistory || []),
            entry,
        ].slice(-20),
    };
}

function formatProjectExecutionContext(project = null) {
    if (!project) {
        return '';
    }

    const activeMilestone = project.milestones.find((entry) => entry.id === project.activeMilestoneId) || null;
    const lines = [
        '<project_mode>',
        `Project: ${project.title}`,
        project.objective ? `Objective: ${project.objective}` : null,
        project.summary ? `Summary: ${project.summary}` : null,
        `Plan lock: ${project.governance.lockedPlan ? 'locked' : 'open'}`,
        `Modification policy: ${project.governance.modificationPolicy}`,
        project.constraints.length > 0 ? 'Constraints:' : null,
        ...project.constraints.map((entry) => `- ${entry}`),
        project.successDefinition.length > 0 ? 'Success definition:' : null,
        ...project.successDefinition.map((entry) => `- ${entry}`),
        activeMilestone ? `Active milestone: ${activeMilestone.title} [${activeMilestone.status}]` : null,
        'Milestones:',
        ...project.milestones.map((entry, index) => {
            const criteria = entry.acceptanceCriteria.length > 0
                ? ` :: criteria=${entry.acceptanceCriteria.join(' | ')}`
                : '';
            return `${index + 1}. ${entry.title} [${entry.status}]${criteria}`;
        }),
    ].filter(Boolean);

    if (project.decisions.length > 0) {
        lines.push('Locked decisions:');
        project.decisions.forEach((entry) => {
            lines.push(`- ${entry.summary}${entry.rationale ? ` :: ${entry.rationale}` : ''}`);
        });
    }

    if (project.reviewHistory.length > 0) {
        lines.push('Recent reviews:');
        project.reviewHistory.slice(-3).forEach((entry) => {
            const milestoneLabel = entry.milestoneId ? ` (${entry.milestoneId})` : '';
            lines.push(`- ${entry.reviewedAt}: ${entry.status || 'reviewed'}${milestoneLabel} :: ${entry.summary}`);
        });
    }

    lines.push('Execution rules:');
    lines.push('- Work against the active milestone and its acceptance criteria before starting new scope.');
    lines.push('- Compare each run against the milestone definition and call out what is complete, incomplete, or blocked.');
    lines.push('- Do not silently reorder milestones, rewrite scope, or replace the plan structure.');
    lines.push('- If a plan change is required for technical reasons, say so explicitly and explain the requirement before proposing the change.');
    lines.push('</project_mode>');

    return lines.join('\n');
}

module.exports = {
    VALID_CHANGE_REASON_TYPES,
    VALID_MILESTONE_STATUSES,
    applyProjectPlanPatch,
    extractProjectPlan,
    formatProjectExecutionContext,
    normalizeProjectPlan,
    recordProjectReview,
};
