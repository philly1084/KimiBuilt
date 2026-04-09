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
const VALID_DELIVERY_MODES = new Set([
    'gitops',
    'remote-workspace',
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
const VALID_TASK_STATUSES = new Set([
    'planned',
    'in_progress',
    'blocked',
    'completed',
    'skipped',
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

function hasStructuredCheckpointResponse(text = '') {
    const normalized = normalizeText(text);
    if (!normalized) {
        return false;
    }

    return /^Survey response \([^)]+\):\s*[\s\S]+$/i.test(normalized);
}

function hasLikelyDecisionReplyIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) {
        return false;
    }

    return [
        /^(yes|yeah|yep|no|nope|not yet|skip|continue|resume|go ahead|proceed)\b/,
        /^\d{4}-\d{2}-\d{2}\b/,
        /^(today|tomorrow|tonight|later|later today|this (?:morning|afternoon|evening)|next (?:week|month|sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/,
        /^(?:in|after)\s+\d+\s*(?:minutes?|mins?|hours?|hrs?)(?:\s+from\s+now)?\b/,
        /^(?:1[0-2]|0?\d)(?::[0-5]\d)?\s*(?:am|pm)\b/,
        /^(?:[01]?\d|2[0-3]):[0-5]\d\b/,
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

function hasOpencodeUsageIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized || !/\bopencode\b/.test(normalized)) {
        return false;
    }

    return [
        /\b(command|commands|syntax|usage|help|docs?|documentation|example|examples|flags?|arguments?|parameters?)\b[\s\S]{0,32}\bopencode\b/,
        /\b(how|what)\b[\s\S]{0,20}\b(use|run|invoke|call)\b[\s\S]{0,20}\bopencode\b/,
        /\bgive\b[\s\S]{0,20}\b(command|commands|example|examples)\b[\s\S]{0,20}\bopencode\b/,
        /\bopencode\b[\s\S]{0,24}\b(command|commands|syntax|usage|help|docs?|documentation|example|examples)\b/,
    ].some((pattern) => pattern.test(normalized));
}

function hasRepoImplementationIntent(text = '') {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized || hasDiscoveryPlanningIntent(normalized) || hasOpencodeUsageIntent(normalized)) {
        return false;
    }

    const repoContext = /\b(repo|repository|code|codebase|workspace|project|app|application|frontend|backend|service|component)\b/.test(normalized)
        || /\bopencode\b/.test(normalized);
    const changeIntent = /\b(fix|implement|build|create|generate|make|update|change|refactor|add|remove|edit|patch|write|test|compile|ship)\b/.test(normalized);

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
        || /\b(sync and apply|sync-and-apply|apply manifests|rollout status)\b/.test(normalized)
        || /\b(add|install|put)\b[\s\S]{0,40}\b(to|on|into|in)\b[\s\S]{0,20}\b(k3s|k8s|kubernetes|cluster)\b/.test(normalized);
    const deployArtifact = /\b(git|github|branch|image|manifest|manifests|helm|repo|repository|tag|release|latest)\b/.test(normalized);
    const infrastructureDeployIntent = /\b(traefik|ingress|acme|let'?s encrypt|cert-manager|tls|certificate)\b/.test(normalized)
        && (
            /\b(k3s|k8s|kubernetes|cluster|server|host|deploy|live|production)\b/.test(normalized)
            || /\b[a-z0-9-]+(?:\.[a-z0-9-]+){1,}\b/.test(normalized)
        );

    return [
        deployAction && deployArtifact,
        /\b(sync and apply|sync-and-apply|apply manifests|rollout status)\b/.test(normalized),
        /\b(add|install|put)\b[\s\S]{0,40}\b(to|on|into|in)\b[\s\S]{0,20}\b(k3s|k8s|kubernetes|cluster)\b/.test(normalized),
        infrastructureDeployIntent,
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

function buildWorkflowTaskTemplates({ lane = '', deliveryMode = 'gitops', requiresVerification = true } = {}) {
    switch (lane) {
    case 'repo-only':
        return [
            {
                id: 'implement-repository',
                title: 'Implement repository changes',
            },
        ];
    case 'deploy-only':
        return [
            {
                id: 'deploy-release',
                title: 'Deploy requested release',
            },
            ...(requiresVerification
                ? [{
                    id: 'verify-release',
                    title: 'Verify deployed result',
                }]
                : []),
        ];
    case 'repo-then-deploy':
        if (deliveryMode === 'remote-workspace') {
            return [
                {
                    id: 'implement-repository',
                    title: 'Implement repository changes',
                },
                {
                    id: 'build-and-deploy-remote-workspace',
                    title: 'Build and deploy remote workspace',
                },
                ...(requiresVerification
                    ? [{
                        id: 'verify-release',
                        title: 'Verify deployed result',
                    }]
                    : []),
            ];
        }

        return [
            {
                id: 'implement-repository',
                title: 'Implement repository changes',
            },
            {
                id: 'save-and-push-repository',
                title: 'Inspect, save, and push repository changes',
            },
            {
                id: 'deploy-release',
                title: 'Deploy requested release',
            },
            ...(requiresVerification
                ? [{
                    id: 'verify-release',
                    title: 'Verify deployed result',
                }]
                : []),
        ];
    case 'inspect-only':
        return [
            {
                id: 'inspect-remote-state',
                title: 'Inspect remote state',
            },
        ];
    default:
        return [];
    }
}

function resolveTaskStatus({ completed = false, active = false, blocked = false, skipped = false } = {}) {
    if (completed) {
        return 'completed';
    }

    if (skipped) {
        return 'skipped';
    }

    if (blocked) {
        return 'blocked';
    }

    return active ? 'in_progress' : 'planned';
}

function buildWorkflowTaskList(workflow = null) {
    const currentWorkflow = workflow && typeof workflow === 'object' ? workflow : {};
    const blocked = currentWorkflow.status === BLOCKED_WORKFLOW_STATUS;
    const stage = normalizeText(currentWorkflow.stage).toLowerCase();
    const templates = buildWorkflowTaskTemplates({
        lane: currentWorkflow.lane,
        deliveryMode: currentWorkflow.deliveryMode,
        requiresVerification: currentWorkflow.requiresVerification !== false,
    });
    const existingTasks = Array.isArray(currentWorkflow.taskList)
        ? currentWorkflow.taskList
        : [];

    return templates.map((template, index) => {
        const existing = existingTasks.find((entry) => normalizeText(entry?.id) === template.id) || {};
        let status = 'planned';

        if (template.id === 'implement-repository') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.implemented === true,
                active: ['implementing'].includes(stage),
                blocked: blocked && currentWorkflow.progress?.implemented !== true,
            });
        } else if (template.id === 'save-and-push-repository') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.saved === true,
                active: ['saving', 'deploying', 'verifying', 'completed'].includes(stage)
                    && currentWorkflow.progress?.implemented === true
                    && currentWorkflow.progress?.saved !== true,
                blocked: blocked
                    && currentWorkflow.progress?.implemented === true
                    && currentWorkflow.progress?.saved !== true,
            });
        } else if (template.id === 'build-and-deploy-remote-workspace') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.deployed === true,
                active: ['saving', 'deploying', 'verifying', 'completed'].includes(stage)
                    && currentWorkflow.progress?.implemented === true
                    && currentWorkflow.progress?.deployed !== true,
                blocked: blocked
                    && currentWorkflow.progress?.implemented === true
                    && currentWorkflow.progress?.deployed !== true,
            });
        } else if (template.id === 'deploy-release') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.deployed === true,
                active: ['deploying', 'verifying', 'completed'].includes(stage)
                    && currentWorkflow.progress?.deployed !== true
                    && (
                        currentWorkflow.lane === 'deploy-only'
                        || currentWorkflow.deliveryMode === 'remote-workspace'
                        || currentWorkflow.progress?.saved === true
                    ),
                blocked: blocked
                    && currentWorkflow.progress?.deployed !== true
                    && (
                        currentWorkflow.lane === 'deploy-only'
                        || currentWorkflow.deliveryMode === 'remote-workspace'
                        || currentWorkflow.progress?.saved === true
                    ),
            });
        } else if (template.id === 'verify-release') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.verified === true,
                active: ['verifying', 'completed'].includes(stage)
                    && currentWorkflow.progress?.verified !== true,
                blocked: blocked
                    && currentWorkflow.progress?.verified !== true
                    && currentWorkflow.requiresVerification !== false,
                skipped: currentWorkflow.requiresVerification === false,
            });
        } else if (template.id === 'inspect-remote-state') {
            status = resolveTaskStatus({
                completed: currentWorkflow.progress?.verified === true,
                active: ['verifying', 'completed'].includes(stage)
                    && currentWorkflow.progress?.verified !== true,
                blocked: blocked && currentWorkflow.progress?.verified !== true,
            });
        }

        return {
            id: normalizeText(existing.id || template.id) || template.id,
            title: normalizeText(existing.title || template.title) || template.title,
            status,
            notes: normalizeText(existing.notes || ''),
            order: Number.isFinite(Number(existing.order))
                ? Number(existing.order)
                : index + 1,
        };
    });
}

function shouldResumeStoredWorkflow({
    objective = '',
    storedWorkflow = null,
} = {}) {
    const normalized = normalizeText(objective);
    if (!storedWorkflow || storedWorkflow.status === COMPLETED_WORKFLOW_STATUS || !normalized) {
        return false;
    }

    if (hasContinuationIntent(normalized) || hasStructuredCheckpointResponse(normalized)) {
        return true;
    }

    if (hasDiscoveryPlanningIntent(normalized) || hasOpencodeUsageIntent(normalized)) {
        return false;
    }

    return hasLikelyDecisionReplyIntent(normalized);
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

function inferDeliveryMode({ lane = '', opencodeTarget = 'local' } = {}) {
    if (lane === 'repo-then-deploy' && normalizeText(opencodeTarget) === 'remote-default') {
        return 'remote-workspace';
    }

    return 'gitops';
}

function isRemoteWorkspaceDeployWorkflow(workflow = null) {
    return Boolean(workflow)
        && workflow.lane === 'repo-then-deploy'
        && inferDeliveryMode({
            lane: workflow.lane,
            opencodeTarget: workflow.opencodeTarget,
        }) === 'remote-workspace';
}

function buildCompletionCriteria({ lane = '', deliveryMode = 'gitops' } = {}) {
    switch (lane) {
    case 'repo-only':
        return ['Repository implementation completed'];
    case 'deploy-only':
        return ['Deployment applied', 'Deployment verified'];
    case 'repo-then-deploy':
        if (deliveryMode === 'remote-workspace') {
            return ['Repository implementation completed', 'Remote workspace built and deployed', 'Deployment verified'];
        }
        return ['Repository implementation completed', 'Changes pushed', 'Deployment applied', 'Deployment verified'];
    case 'inspect-only':
        return ['Inspection completed'];
    default:
        return [];
    }
}

function buildVerificationCriteria({ lane = '', deliveryMode = 'gitops' } = {}) {
    if (lane === 'repo-only') {
        return [];
    }

    if (lane === 'inspect-only') {
        return ['Captured a verified remote inspection result'];
    }

    if (lane === 'repo-then-deploy' && deliveryMode === 'remote-workspace') {
        return ['Remote workspace build completed', 'Kubernetes apply completed', 'Post-deploy remote verification captured'];
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
    const deliveryMode = VALID_DELIVERY_MODES.has(String(workflow.deliveryMode || '').trim())
        ? String(workflow.deliveryMode).trim()
        : inferDeliveryMode({
            lane: workflow.lane,
            opencodeTarget: workflow.opencodeTarget,
        });

    const normalized = {
        kind: END_TO_END_WORKFLOW_KIND,
        version: Number(workflow.version) || 1,
        objective: normalizeText(workflow.objective),
        lane: workflow.lane,
        stage,
        status,
        workspacePath: normalizeText(workflow.workspacePath) || null,
        repositoryPath: normalizeText(workflow.repositoryPath) || null,
        opencodeTarget: normalizeText(workflow.opencodeTarget) || 'local',
        deliveryMode,
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
            : buildCompletionCriteria({
                lane: workflow.lane,
                deliveryMode,
            }),
        verificationCriteria: Array.isArray(workflow.verificationCriteria)
            ? workflow.verificationCriteria.map((entry) => normalizeText(entry)).filter(Boolean)
            : buildVerificationCriteria({
                lane: workflow.lane,
                deliveryMode,
            }),
        lastMeaningfulProgressAt: normalizeText(workflow.lastMeaningfulProgressAt) || null,
        lastError: normalizeText(workflow.lastError) || null,
        source: normalizeText(workflow.source) || null,
    };

    normalized.taskList = buildWorkflowTaskList(normalized);
    return normalized;
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
    if (storedWorkflow && shouldResumeStoredWorkflow({
        objective,
        storedWorkflow,
    })) {
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
        completionCriteria: buildCompletionCriteria({
            lane,
            deliveryMode: inferDeliveryMode({ lane, opencodeTarget }),
        }),
        verificationCriteria: buildVerificationCriteria({
            lane,
            deliveryMode: inferDeliveryMode({ lane, opencodeTarget }),
        }),
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

function getToolEventWorkflowAction(event = {}) {
    const args = parseToolArguments(event?.toolCall?.function?.arguments || '{}');
    return normalizeText(args.workflowAction || args.workflow_action).toLowerCase();
}

function buildImplementationPrompt(workflow = null) {
    const objective = normalizeText(workflow?.objective);
    return [
        'Implement the requested repository changes in the workspace.',
        workflow?.lane === 'repo-then-deploy'
            ? (isRemoteWorkspaceDeployWorkflow(workflow)
                ? 'Keep the changes ready for a later remote build and k3s deployment step on the same server. Do not perform kubectl or deployment actions from inside OpenCode.'
                : 'Keep the changes ready for a later git-safe save/push and k3s deploy step. Do not perform git pushes or remote deployment from inside OpenCode.')
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

function quoteShellArg(value = '') {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
}

function resolveRemoteWorkspaceManifestsPath(workflow = null) {
    const workspacePath = normalizeText(workflow?.workspacePath);
    const manifestsPath = normalizeText(workflow?.deploy?.manifestsPath || config.deploy.defaultManifestsPath);
    if (!manifestsPath) {
        return workspacePath || null;
    }

    if (manifestsPath.startsWith('/')) {
        return manifestsPath;
    }

    if (!workspacePath) {
        return manifestsPath;
    }

    return `${workspacePath.replace(/\/+$/, '')}/${manifestsPath.replace(/^\/+/, '')}`;
}

function buildRemoteWorkspaceDeployCommand(workflow = null) {
    const workspacePath = normalizeText(workflow?.workspacePath);
    const manifestsPath = resolveRemoteWorkspaceManifestsPath(workflow);
    const namespace = normalizeText(workflow?.deploy?.namespace) || 'kimibuilt';
    const deployment = normalizeText(workflow?.deploy?.deployment) || 'backend';
    const manifestTarget = manifestsPath || workspacePath;

    return [
        'set -e',
        'workspace_dir="$(pwd)"',
        'app_dir="$workspace_dir"',
        'if [ ! -f "$app_dir/package.json" ] && [ -f "$workspace_dir/app/package.json" ]; then',
        '  app_dir="$workspace_dir/app"',
        'fi',
        'if [ -f "$app_dir/package.json" ]; then',
        '  cd -- "$app_dir"',
        '  if ! command -v node >/dev/null 2>&1; then echo "node is required to build the remote workspace" >&2; exit 1; fi',
        '  if [ -f pnpm-lock.yaml ]; then',
        '    if ! command -v pnpm >/dev/null 2>&1; then echo "pnpm is required to build this workspace" >&2; exit 1; fi',
        '    pnpm install --frozen-lockfile || pnpm install',
        '    if node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then pnpm run build; fi',
        '  elif [ -f yarn.lock ]; then',
        '    if ! command -v yarn >/dev/null 2>&1; then echo "yarn is required to build this workspace" >&2; exit 1; fi',
        '    yarn install --frozen-lockfile || yarn install',
        '    if node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then yarn build; fi',
        '  else',
        '    if ! command -v npm >/dev/null 2>&1; then echo "npm is required to build this workspace" >&2; exit 1; fi',
        '    if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi',
        '    if node -e "const p=require(\'./package.json\'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then npm run build; fi',
        '  fi',
        '  cd -- "$workspace_dir"',
        'fi',
        'if ! command -v kubectl >/dev/null 2>&1; then echo "kubectl is required on the remote host" >&2; exit 1; fi',
        `if [ ! -e ${quoteShellArg(manifestTarget)} ]; then echo "manifests path not found: ${manifestTarget}" >&2; exit 1; fi`,
        `kubectl apply -f ${quoteShellArg(manifestTarget)}`,
        deployment
            ? `kubectl rollout status deployment/${deployment} -n ${quoteShellArg(namespace)} --timeout=180s`
            : `kubectl get all -n ${quoteShellArg(namespace)}`,
        deployment
            ? `kubectl get deployment/${deployment} -n ${quoteShellArg(namespace)} -o wide`
            : '',
    ].filter(Boolean).join('\n');
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
    const usesRemoteWorkspaceDeploy = isRemoteWorkspaceDeployWorkflow(currentWorkflow);

    if ((currentWorkflow.lane === 'repo-only' || currentWorkflow.lane === 'repo-then-deploy')
        && !currentWorkflow.progress.implemented
        && !candidateToolIds.has('opencode-run')) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            'Repository implementation is required before this workflow can continue, but `opencode-run` is not ready for the selected execution target.',
        );
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && usesRemoteWorkspaceDeploy
        && currentWorkflow.progress.implemented
        && !currentWorkflow.progress.deployed
        && !candidateToolIds.has(remoteTool)) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            `The workflow needs \`${remoteTool}\` to build and deploy the remote workspace on the target server.`,
        );
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && !usesRemoteWorkspaceDeploy
        && currentWorkflow.progress.implemented
        && (!currentWorkflow.progress.repoStatusChecked || !currentWorkflow.progress.saved)
        && !candidateToolIds.has('git-safe')) {
        return buildBlockedWorkflowState(
            currentWorkflow,
            'The workflow needs `git-safe` to inspect, save, and push the repository changes before deployment.',
        );
    }

    if ((currentWorkflow.lane === 'deploy-only' || (currentWorkflow.lane === 'repo-then-deploy' && !usesRemoteWorkspaceDeploy))
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
    const usesRemoteWorkspaceDeploy = isRemoteWorkspaceDeployWorkflow(currentWorkflow);

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
        && usesRemoteWorkspaceDeploy
        && !currentWorkflow.progress.deployed
        && candidateToolIds.has(remoteTool)) {
        return [{
            tool: remoteTool,
            reason: 'Build the remote workspace on the target server, apply the k3s manifests, and verify the rollout.',
            params: {
                ...(currentWorkflow.remoteTarget?.host ? { host: currentWorkflow.remoteTarget.host } : {}),
                ...(currentWorkflow.remoteTarget?.username ? { username: currentWorkflow.remoteTarget.username } : {}),
                ...(currentWorkflow.remoteTarget?.port ? { port: currentWorkflow.remoteTarget.port } : {}),
                ...(currentWorkflow.workspacePath ? { workingDirectory: currentWorkflow.workspacePath } : {}),
                workflowAction: 'build-and-deploy-remote-workspace',
                command: buildRemoteWorkspaceDeployCommand(currentWorkflow),
            },
        }];
    }

    if (currentWorkflow.lane === 'repo-then-deploy'
        && !usesRemoteWorkspaceDeploy
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
        && !usesRemoteWorkspaceDeploy
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

    if ((currentWorkflow.lane === 'deploy-only' || (currentWorkflow.lane === 'repo-then-deploy' && !usesRemoteWorkspaceDeploy))
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
        const workflowAction = getToolEventWorkflowAction(event);

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
            if (workflowAction === 'build-and-deploy-remote-workspace') {
                currentWorkflow = markMeaningfulProgress({
                    ...currentWorkflow,
                    progress: {
                        ...currentWorkflow.progress,
                        deployed: true,
                        verified: true,
                    },
                    stage: 'completed',
                    status: COMPLETED_WORKFLOW_STATUS,
                });
                continue;
            }

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
