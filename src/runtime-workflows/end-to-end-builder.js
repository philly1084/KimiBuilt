const { config } = require('../config');
const { getSessionControlState } = require('../runtime-control-state');

const END_TO_END_WORKFLOW_KIND = 'end-to-end-builder';
const ACTIVE_WORKFLOW_STATUS = 'active';
const COMPLETED_WORKFLOW_STATUS = 'completed';
const BLOCKED_WORKFLOW_STATUS = 'blocked';
const VALID_LANES = new Set([
    'repo-only',
    'deploy-only',
    'repo-then-deploy',
    'inspect-only',
]);
const VALID_STAGES = new Set([
    'planned',
    'implementing',
    'saving',
    'deploying',
    'verifying',
    'completed',
    'blocked',
]);

function normalizeText(value = '') {
    return String(value || '').trim();
}

function truncateText(value = '', limit = 96) {
    const normalized = normalizeText(value);
    if (!normalized || normalized.length <= limit) {
        return normalized;
    }

    return `${normalized.slice(0, limit - 1).trim()}…`;
}

function isEndToEndBuilderWorkflow(value = null) {
    return Boolean(value)
        && typeof value === 'object'
        && value.kind === END_TO_END_WORKFLOW_KIND
        && VALID_LANES.has(String(value.lane || '').trim());
}

function hasContinuationIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /^(continue|keep going|go ahead|next step|next steps|finish|resume|proceed)\b/,
        /^(do it|do that|ship it|deploy it|verify it|push it)\b/,
        /\b(obvious next step|obvious next steps|from there|from this point)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasDiscoveryPlanningIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\b(questionnaire|questionnaires|survey|surveys|intake|discovery questions?|discovery session)\b/,
        /\b(ask me (?:a few|some|a couple of)? questions?|provide (?:some|a couple of)? questions?|start with (?:questions?|a questionnaire|questionnaires))\b/,
        /\b(figure out|work out|narrow down|brainstorm|explore|talk through|discuss|decide|choose|direction|options?)\b[\s\S]{0,40}\b(what to work on|what we should work on|what to build|what we should build|what to make|scope|approach)\b/,
        /\b(before|first)\b[\s\S]{0,30}\b(questionnaire|questions?|research|planning|brainstorm|options?)\b/,
        /\blet'?s start with\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasRepoImplementationIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized || hasDiscoveryPlanningIntent(normalized)) {
        return false;
    }

    const repoContext = /\b(repo|repository|code|codebase|workspace|project|app|application|frontend|backend|service|component)\b/.test(normalized);
    const changeIntent = /\b(fix|implement|build|create|update|change|refactor|add|remove|edit|patch|write|test|compile|ship)\b/.test(normalized);

    return repoContext && changeIntent;
}

function hasGitSaveIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(git|github)\b[\s\S]{0,80}\b(commit|push|save and push|save-and-push|stage)\b/.test(normalized)
        || /\b(commit|push|save and push|save-and-push)\b[\s\S]{0,40}\b(github|git)\b/.test(normalized);
}

function hasDeployIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    const deployAction = /\b(deploy|redeploy|rollout|release|publish|ship live|put live|push live|apply|sync)\b/.test(normalized)
        || /\b(sync and apply|sync-and-apply|apply manifests|rollout status)\b/.test(normalized);
    const deployArtifact = /\b(git|github|branch|image|manifest|manifests|helm|repo|repository|tag|release|latest)\b/.test(normalized);

    return [
        deployAction && deployArtifact,
        /\b(sync and apply|sync-and-apply|apply manifests|rollout status)\b/.test(normalized),
    ].some(Boolean);
}

function hasVerificationIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /\b(verify|verification|confirm|check|inspect|health|healthy|status|working|works|rollout|smoke test)\b/,
        /\b(make sure|ensure)\b[\s\S]{0,30}\b(live|healthy|running|working)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasInspectOnlyIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    const remoteContext = /\b(remote|server|host|cluster|k3s|k8s|kubernetes|kubectl|deployment|service|ingress|pod|logs?)\b/.test(normalized);
    const inspectIntent = /\b(check|inspect|look at|show|status|health|verify|logs?|diagnose|debug)\b/.test(normalized);
    return remoteContext && inspectIntent && !hasRepoImplementationIntent(normalized) && !hasDeployIntent(normalized);
}

function inferWorkflowLane(objective = '') {
    const normalized = normalizeText(objective);
    if (!normalized) {
        return null;
    }

    if (hasDiscoveryPlanningIntent(normalized)) {
        return null;
    }

    const repoImplementationIntent = hasRepoImplementationIntent(normalized);
    const deployIntent = hasDeployIntent(normalized);
    const inspectOnlyIntent = hasInspectOnlyIntent(normalized);

    if (repoImplementationIntent && deployIntent) {
        return 'repo-then-deploy';
    }

    if (repoImplementationIntent) {
        return 'repo-only';
    }

    if (deployIntent || hasGitSaveIntent(normalized)) {
        return 'deploy-only';
    }

    return null;
}

function buildDeployState(seed = {}) {
    return {
        repositoryUrl: normalizeText(seed.repositoryUrl || config.deploy.defaultRepositoryUrl) || null,
        ref: normalizeText(seed.ref || config.deploy.defaultBranch) || null,
        targetDirectory: normalizeText(seed.targetDirectory || config.deploy.defaultTargetDirectory) || null,
        manifestsPath: normalizeText(seed.manifestsPath || config.deploy.defaultManifestsPath) || null,
        namespace: normalizeText(seed.namespace || config.deploy.defaultNamespace) || 'kimibuilt',
        deployment: normalizeText(seed.deployment || config.deploy.defaultDeployment) || null,
        container: normalizeText(seed.container || config.deploy.defaultContainer) || null,
    };
}

function buildInitialStage(lane = '') {
    if (lane === 'repo-only' || lane === 'repo-then-deploy') {
        return 'implementing';
    }
    if (lane === 'deploy-only') {
        return 'deploying';
    }
    if (lane === 'inspect-only') {
        return 'verifying';
    }
    return 'planned';
}

function buildCompletionCriteria(lane = '') {
    switch (lane) {
    case 'repo-only':
        return ['Repository implementation completed'];
    case 'deploy-only':
        return ['Deployment applied', 'Deployment verified'];
    case 'repo-then-deploy':
        return ['Repository implementation completed', 'Changes pushed', 'Deployment applied', 'Deployment verified'];
    case 'inspect-only':
        return ['Inspection completed'];
    default:
        return [];
    }
}

function buildVerificationCriteria(lane = '') {
    if (lane === 'repo-only') {
        return [];
    }

    if (lane === 'inspect-only') {
        return ['Captured a verified remote inspection result'];
    }

    return ['Rollout status confirmed', 'Post-deploy remote verification captured'];
}

function normalizeProgress(progress = {}) {
    const source = progress && typeof progress === 'object' ? progress : {};
    return {
        implemented: source.implemented === true,
        repoStatusChecked: source.repoStatusChecked === true,
        saved: source.saved === true,
        deployed: source.deployed === true,
        verified: source.verified === true,
    };
}

function normalizeWorkflowState(workflow = null) {
    if (!isEndToEndBuilderWorkflow(workflow)) {
        return null;
    }

    const stage = VALID_STAGES.has(String(workflow.stage || '').trim())
        ? String(workflow.stage).trim()
        : buildInitialStage(workflow.lane);
    const status = [ACTIVE_WORKFLOW_STATUS, COMPLETED_WORKFLOW_STATUS, BLOCKED_WORKFLOW_STATUS].includes(String(workflow.status || '').trim())
        ? String(workflow.status).trim()
        : ACTIVE_WORKFLOW_STATUS;
    const deploy = buildDeployState(workflow.deploy || {});
    const progress = normalizeProgress(workflow.progress);

    return {
        kind: END_TO_END_WORKFLOW_KIND,
        version: Number(workflow.version) || 1,
        objective: normalizeText(workflow.objective),
        lane: workflow.lane,
        stage,
        status,
        workspacePath: normalizeText(workflow.workspacePath) || null,
        repositoryPath: normalizeText(workflow.repositoryPath) || null,
        opencodeTarget: normalizeText(workflow.opencodeTarget) || 'local',
        remoteTarget: workflow.remoteTarget && typeof workflow.remoteTarget === 'object'
            ? {
                ...(normalizeText(workflow.remoteTarget.host) ? { host: normalizeText(workflow.remoteTarget.host) } : {}),
                ...(normalizeText(workflow.remoteTarget.username) ? { username: normalizeText(workflow.remoteTarget.username) } : {}),
                ...(Number.isFinite(Number(workflow.remoteTarget.port)) ? { port: Number(workflow.remoteTarget.port) } : {}),
            }
            : null,
        deploy,
        progress,
        requiresVerification: workflow.requiresVerification !== false,
        completionCriteria: Array.isArray(workflow.completionCriteria)
            ? workflow.completionCriteria.map((entry) => normalizeText(entry)).filter(Boolean)
            : buildCompletionCriteria(workflow.lane),
        verificationCriteria: Array.isArray(workflow.verificationCriteria)
            ? workflow.verificationCriteria.map((entry) => normalizeText(entry)).filter(Boolean)
            : buildVerificationCriteria(workflow.lane),
        lastMeaningfulProgressAt: normalizeText(workflow.lastMeaningfulProgressAt) || null,
        lastError: normalizeText(workflow.lastError) || null,
        source: normalizeText(workflow.source) || null,
    };
}

function inferEndToEndBuilderWorkflow({
    objective = '',
    session = null,
    workspacePath = '',
    repositoryPath = '',
    opencodeTarget = 'local',
    remoteTarget = null,
} = {}) {
    const storedWorkflow = normalizeWorkflowState(getSessionControlState(session).workflow);
    if (storedWorkflow && storedWorkflow.status !== COMPLETED_WORKFLOW_STATUS && hasContinuationIntent(objective)) {
        return normalizeWorkflowState({
            ...storedWorkflow,
            objective: storedWorkflow.objective || normalizeText(objective),
            workspacePath: normalizeText(workspacePath) || storedWorkflow.workspacePath,
            repositoryPath: normalizeText(repositoryPath) || storedWorkflow.repositoryPath,
            opencodeTarget: normalizeText(opencodeTarget) || storedWorkflow.opencodeTarget,
            remoteTarget: remoteTarget || storedWorkflow.remoteTarget,
            source: 'stored',
        });
    }

    const lane = inferWorkflowLane(objective);
    if (!lane) {
        return null;
    }

    return normalizeWorkflowState({
        kind: END_TO_END_WORKFLOW_KIND,
        version: 1,
        objective: normalizeText(objective),
        lane,
        stage: buildInitialStage(lane),
        status: ACTIVE_WORKFLOW_STATUS,
        workspacePath: normalizeText(workspacePath) || null,
        repositoryPath: normalizeText(repositoryPath) || null,
        opencodeTarget: normalizeText(opencodeTarget) || 'local',
        remoteTarget,
        deploy: buildDeployState(),
        progress: normalizeProgress(),
        requiresVerification: lane !== 'repo-only' || hasVerificationIntent(objective),
        completionCriteria: buildCompletionCriteria(lane),
        verificationCriteria: buildVerificationCriteria(lane),
        lastMeaningfulProgressAt: null,
        lastError: null,
        source: 'objective',
    });
}

function parseToolArguments(rawArguments = '{}') {
    try {
        return JSON.parse(rawArguments || '{}') || {};
    } catch (_error) {
        return {};
    }
}

function getToolEventToolId(event = {}) {
    return normalizeText(event?.toolCall?.function?.name || event?.result?.toolId).toLowerCase();
}

function getToolEventAction(event = {}) {
    const args = parseToolArguments(event?.toolCall?.function?.arguments || '{}');
    return normalizeText(event?.result?.data?.action || args.action).toLowerCase();
}

function buildImplementationPrompt(workflow = null) {
    const objective = normalizeText(workflow?.objective);
    return [
        'Implement the requested repository changes in the workspace.',
        workflow?.lane === 'repo-then-deploy'
            ? 'Keep the changes ready for a later git-safe save/push and k3s deploy step. Do not perform git pushes or remote deployment from inside OpenCode.'
            : 'Focus on the code or content changes and summarize any relevant build or test results.',
        '',
        'User objective:',
        objective || '(empty)',
    ].join('\n');
}

function buildGitCommitMessage(workflow = null) {
    const objective = truncateText(workflow?.objective || 'update deployment workflow', 72);
    return `KimiBuilt: ${objective || 'update deployment workflow'}`;
}

function buildVerificationCommand(workflow = null) {
    const deploy = workflow?.deploy || {};
    const namespace = normalizeText(deploy.namespace) || 'kimibuilt';
    const deployment = normalizeText(deploy.deployment) || 'backend';

    return [
        'set -e',
        `kubectl rollout status deployment/${deployment} -n '${namespace}' --timeout=180s`,
        `kubectl get deployment/${deployment} -n '${namespace}' -o wide`,
        `kubectl get pods -n '${namespace}' -o wide`,
    ].join('\n');
}

function buildInspectCommand(workflow = null) {
    const deploy = workflow?.deploy || {};
    const namespace = normalizeText(deploy.namespace) || 'kimibuilt';
    const deployment = normalizeText(deploy.deployment) || 'backend';

    return [
        'set -e',
        `kubectl get deployment/${deployment} -n '${namespace}' -o wide`,
        `kubectl get pods -n '${namespace}' -o wide`,
        `kubectl get svc,ingress -n '${namespace}'`,
    ].join('\n');
}

function buildBlockedWorkflowState(workflow = null, error = '') {
    return normalizeWorkflowState({
        ...workflow,
        status: BLOCKED_WORKFLOW_STATUS,
        stage: 'blocked',
        lastError: normalizeText(error) || 'The end-to-end builder workflow is blocked.',
    });
}

function evaluateEndToEndBuilderWorkflow({
    workflow = null,
    toolPolicy = {},
    remoteToolId = 'remote-command',
} = {}) {
    const currentWorkflow = normalizeWorkflowState(workflow);
    if (!currentWorkflow || currentWorkflow.status !== ACTIVE_WORKFLOW_STATUS) {
        return currentWorkflow;
    }

    const candidateToolIds = new Set(Array.isArray(toolPolicy?.candidateToolIds) ? toolPolicy.candidateToolIds : []);
    const remoteTool = normalizeText(remoteToolId || toolPolicy?.preferredRemoteToolId || 'remote-command') || 'remote-command';

    if ((currentWorkflow.lane === 'repo-only' || currentWorkflow.lane === 'repo-then-deploy')
        && !currentWorkflow.progress.implemented
        && !candidateToolIds.has('opencode-run')) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            'Repository implementation is required before this workflow can continue, but `opencode-run` is not ready for the selected execution target.',
        );
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && currentWorkflow.progress.implemented
        && (!currentWorkflow.progress.repoStatusChecked || !currentWorkflow.progress.saved)
        && !candidateToolIds.has('git-safe')) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            'The workflow needs `git-safe` to inspect, save, and push the repository changes before deployment.',
        );
    }

    if ((currentWorkflow.lane === 'deploy-only' || currentWorkflow.lane === 'repo-then-deploy')
        && !currentWorkflow.progress.deployed
        && !candidateToolIds.has('k3s-deploy')) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            'The workflow needs `k3s-deploy` to perform the requested deployment step.',
        );
    }

    if (currentWorkflow.requiresVerification
        && !currentWorkflow.progress.verified
        && !candidateToolIds.has(remoteTool)
        && !(candidateToolIds.has('k3s-deploy') && currentWorkflow.deploy.deployment)) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            `The workflow needs \`${remoteTool}\` or rollout-status access to verify the remote result.`,
        );
    }

    return currentWorkflow;
}

function buildEndToEndWorkflowPlan({
    workflow = null,
    toolPolicy = {},
    remoteToolId = 'remote-command',
} = {}) {
    const currentWorkflow = normalizeWorkflowState(workflow);
    if (!currentWorkflow || currentWorkflow.status === COMPLETED_WORKFLOW_STATUS || currentWorkflow.status === BLOCKED_WORKFLOW_STATUS) {
        return [];
    }

    const candidateToolIds = new Set(Array.isArray(toolPolicy?.candidateToolIds) ? toolPolicy.candidateToolIds : []);
    const remoteTool = normalizeText(remoteToolId || toolPolicy?.preferredRemoteToolId || 'remote-command') || 'remote-command';
    const repositoryPath = currentWorkflow.repositoryPath || config.deploy.defaultRepositoryPath || '';

    if ((currentWorkflow.lane === 'repo-only' || currentWorkflow.lane === 'repo-then-deploy')
        && !currentWorkflow.progress.implemented
        && candidateToolIds.has('opencode-run')) {
        return [{
            tool: 'opencode-run',
            reason: currentWorkflow.lane === 'repo-then-deploy'
                ? 'Implement the repository changes before saving, deploying, and verifying.'
                : 'Implement the requested repository changes before summarizing the result.',
            params: {
                prompt: buildImplementationPrompt(currentWorkflow),
                target: currentWorkflow.opencodeTarget || 'local',
                ...(currentWorkflow.workspacePath ? { workspacePath: currentWorkflow.workspacePath } : {}),
            },
        }];
    }

    if (currentWorkflow.lane === 'repo-only') {
        return [];
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && !currentWorkflow.progress.repoStatusChecked
        && candidateToolIds.has('git-safe')) {
        return [{
            tool: 'git-safe',
            reason: 'Inspect the local repository branch and upstream before saving and pushing the deployable change.',
            params: {
                action: 'remote-info',
                ...(repositoryPath ? { repositoryPath } : {}),
            },
        }];
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && !currentWorkflow.progress.saved
        && candidateToolIds.has('git-safe')) {
        return [{
            tool: 'git-safe',
            reason: 'Save and push the verified repository changes before deployment.',
            params: {
                action: 'save-and-push',
                ...(repositoryPath ? { repositoryPath } : {}),
                message: buildGitCommitMessage(currentWorkflow),
            },
        }];
    }

    if ((currentWorkflow.lane === 'deploy-only' || currentWorkflow.lane === 'repo-then-deploy')
        && !currentWorkflow.progress.deployed
        && candidateToolIds.has('k3s-deploy')) {
        return [{
            tool: 'k3s-deploy',
            reason: currentWorkflow.lane === 'repo-then-deploy'
                ? 'Deploy the pushed repository changes to the remote k3s cluster.'
                : 'Run the standard k3s deployment flow for this request.',
            params: {
                action: 'sync-and-apply',
                ...(currentWorkflow.deploy.repositoryUrl ? { repositoryUrl: currentWorkflow.deploy.repositoryUrl } : {}),
                ...(currentWorkflow.deploy.ref ? { ref: currentWorkflow.deploy.ref } : {}),
                ...(currentWorkflow.deploy.targetDirectory ? { targetDirectory: currentWorkflow.deploy.targetDirectory } : {}),
                ...(currentWorkflow.deploy.manifestsPath ? { manifestsPath: currentWorkflow.deploy.manifestsPath } : {}),
                ...(currentWorkflow.deploy.namespace ? { namespace: currentWorkflow.deploy.namespace } : {}),
                ...(currentWorkflow.deploy.deployment ? { deployment: currentWorkflow.deploy.deployment } : {}),
            },
        }];
    }

    if (currentWorkflow.requiresVerification && !currentWorkflow.progress.verified) {
        if (candidateToolIds.has(remoteTool)) {
            return [{
                tool: remoteTool,
                reason: currentWorkflow.lane === 'inspect-only'
                    ? 'Inspect the remote deployment and capture a verification snapshot.'
                    : 'Verify the rollout and post-deploy runtime health.',
                params: {
                    ...(currentWorkflow.remoteTarget?.host ? { host: currentWorkflow.remoteTarget.host } : {}),
                    ...(currentWorkflow.remoteTarget?.username ? { username: currentWorkflow.remoteTarget.username } : {}),
                    ...(currentWorkflow.remoteTarget?.port ? { port: currentWorkflow.remoteTarget.port } : {}),
                    command: currentWorkflow.lane === 'inspect-only'
                        ? buildInspectCommand(currentWorkflow)
                        : buildVerificationCommand(currentWorkflow),
                },
            }];
        }

        if (candidateToolIds.has('k3s-deploy') && currentWorkflow.deploy.deployment) {
            return [{
                tool: 'k3s-deploy',
                reason: 'Verify the deployment rollout status.',
                params: {
                    action: 'rollout-status',
                    deployment: currentWorkflow.deploy.deployment,
                    ...(currentWorkflow.deploy.namespace ? { namespace: currentWorkflow.deploy.namespace } : {}),
                },
            }];
        }
    }

    return [];
}

function markMeaningfulProgress(workflow = null) {
    return normalizeWorkflowState({
        ...workflow,
        lastMeaningfulProgressAt: new Date().toISOString(),
        lastError: null,
    });
}

function advanceEndToEndBuilderWorkflow({
    workflow = null,
    toolEvents = [],
} = {}) {
    let currentWorkflow = normalizeWorkflowState(workflow);
    if (!currentWorkflow) {
        return null;
    }

    const events = Array.isArray(toolEvents) ? toolEvents : [];
    for (const event of events) {
        const toolId = getToolEventToolId(event);
        const success = event?.result?.success !== false;
        const action = getToolEventAction(event);

        if (!success) {
            currentWorkflow = normalizeWorkflowState({
                ...currentWorkflow,
                status: BLOCKED_WORKFLOW_STATUS,
                stage: 'blocked',
                lastError: normalizeText(event?.result?.error) || `Workflow step failed via ${toolId}.`,
            });
            return currentWorkflow;
        }

        if (toolId === 'opencode-run') {
            currentWorkflow = markMeaningfulProgress({
                ...currentWorkflow,
                progress: {
                    ...currentWorkflow.progress,
                    implemented: true,
                },
                workspacePath: normalizeText(event?.result?.data?.workspacePath) || currentWorkflow.workspacePath,
                stage: currentWorkflow.lane === 'repo-only' ? 'completed' : 'saving',
                status: currentWorkflow.lane === 'repo-only' ? COMPLETED_WORKFLOW_STATUS : ACTIVE_WORKFLOW_STATUS,
            });
            continue;
        }

        if (toolId === 'git-safe') {
            if (action === 'remote-info') {
                currentWorkflow = markMeaningfulProgress({
                    ...currentWorkflow,
                    progress: {
                        ...currentWorkflow.progress,
                        repoStatusChecked: true,
                    },
                    stage: 'saving',
                });
                continue;
            }

            if (action === 'save-and-push' || action === 'push') {
                currentWorkflow = markMeaningfulProgress({
                    ...currentWorkflow,
                    progress: {
                        ...currentWorkflow.progress,
                        repoStatusChecked: true,
                        saved: true,
                    },
                    stage: currentWorkflow.lane === 'repo-then-deploy' ? 'deploying' : 'completed',
                    status: currentWorkflow.lane === 'repo-then-deploy' ? ACTIVE_WORKFLOW_STATUS : COMPLETED_WORKFLOW_STATUS,
                });
                continue;
            }
        }

        if (toolId === 'k3s-deploy') {
            currentWorkflow = markMeaningfulProgress({
                ...currentWorkflow,
                progress: {
                    ...currentWorkflow.progress,
                    deployed: true,
                    ...(action === 'rollout-status' ? { verified: true } : {}),
                },
                stage: action === 'rollout-status'
                    ? 'completed'
                    : (currentWorkflow.requiresVerification ? 'verifying' : 'completed'),
                status: action === 'rollout-status' || !currentWorkflow.requiresVerification
                    ? COMPLETED_WORKFLOW_STATUS
                    : ACTIVE_WORKFLOW_STATUS,
            });
            continue;
        }

        if (toolId === 'remote-command' || toolId === 'ssh-execute') {
            currentWorkflow = markMeaningfulProgress({
                ...currentWorkflow,
                progress: {
                    ...currentWorkflow.progress,
                    verified: true,
                },
                stage: 'completed',
                status: COMPLETED_WORKFLOW_STATUS,
            });
        }
    }

    return currentWorkflow;
}

module.exports = {
    END_TO_END_WORKFLOW_KIND,
    advanceEndToEndBuilderWorkflow,
    buildEndToEndWorkflowPlan,
    evaluateEndToEndBuilderWorkflow,
    inferEndToEndBuilderWorkflow,
    inferWorkflowLane,
    isEndToEndBuilderWorkflow,
};
