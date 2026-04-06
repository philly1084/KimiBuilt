# End-To-End Builder Plan

## Goal

Build a reliable agent flow that can:

1. understand a build request,
2. plan the work,
3. choose the correct execution lane,
4. implement code in a repo,
5. save and push the change,
6. deploy or update the remote target,
7. verify the result, and
8. stop when the goal is actually complete.

This plan is grounded in the current KimiBuilt runtime, not a greenfield rewrite.

## Current Building Blocks

The repo already has the main primitives:

- `conversation-orchestrator` for planning, tool execution, and synthesis
- `opencode-run` for repo-level implementation/build/test work
- `git-safe` for constrained local git status/add/commit/push
- `remote-command` / `ssh-execute` for host and cluster operations
- `k3s-deploy` for restricted deploy flows over SSH
- workload persistence and execution profiles

The main problem is control flow. The runtime can do the pieces, but it does not yet manage them as one bounded end-to-end workflow.

## Target Workflow

The target flow should behave like this:

1. Classify the request:
   - planning-only
   - repo implementation
   - infrastructure/deploy
   - mixed end-to-end build
2. Build a workflow state:
   - objective
   - source repo/workspace
   - target lane: local repo, remote repo, deploy-only, or inspect-only
   - completion criteria
   - verification criteria
3. Execute the next best step:
   - `opencode-run` for code changes, build, tests, refactors
   - `git-safe` for remote-info, commit, push
   - `k3s-deploy` for sync/apply/rollout flows
   - `remote-command` for inspection, logs, restarts, DNS, TLS, kubectl, ad hoc fixes
4. After each step, evaluate:
   - did the goal advance?
   - is there a deterministic next step?
   - is the workflow complete?
   - is there a real blocker?
5. Stop only when:
   - completion criteria are satisfied,
   - a blocking dependency is missing,
   - the task needs a product decision,
   - or the autonomy budget is exhausted without progress.

## Design Rules

1. Repo work and infra work are different lanes.
   Repo work should prefer `opencode-run` and `git-safe`.
   Infra work should prefer `k3s-deploy` and `remote-command`.

2. Deterministic follow-ups outrank planner guesses.
   If a remote result clearly implies the next action, use that action directly instead of asking the model to improvise.

3. Completion must be explicit.
   “A command succeeded” is not the same as “the task is done”.

4. Tool eligibility must be real, not cosmetic.
   A tool should not be offered as ready unless its hard prerequisites are satisfied.

5. The live server is not the source of truth by default.
   Prefer local authoring -> push -> deploy -> verify unless the user explicitly wants server-local repo work.

## Phase Plan

### Phase 1: Stabilize the remote-build loop

**Purpose**

Stop the agent from doing extra rounds and extra commands after it has already reached a reasonable next boundary.

**Files**

- `src/conversation-orchestrator.js`
- `src/conversation-orchestrator.test.js`

**Changes**

1. Add explicit completion evaluation after each round.
2. Split “continue” conditions into:
   - deterministic next step exists
   - planner next step exists
   - workflow is complete
   - workflow is blocked
3. Stop autonomous looping when:
   - a verification step succeeded and no stronger follow-up is implied,
   - a deploy flow reached rollout success and verification success,
   - or the last successful step already satisfied the requested objective.
4. Make recovery/replan happen only when it is justified by failure classification or an incomplete workflow state.

**Acceptance criteria**

- The current remote-build over-execution tests pass.
- A successful verify/deploy round does not trigger an unnecessary extra remote command.
- The runtime still continues after recoverable failures when a deterministic fix exists.

### Phase 2: Promote deterministic workflow control above planner output

**Purpose**

Move obvious next actions out of LLM guesswork and into workflow policy.

**Files**

- `src/conversation-orchestrator.js`
- new module: `src/runtime-workflows/end-to-end-builder.js`
- new tests: `src/runtime-workflows/end-to-end-builder.test.js`

**Changes**

1. Extract deterministic follow-up logic into a dedicated workflow module.
2. Teach the workflow module to emit next-step decisions for:
   - generic baseline -> website source inspection
   - website resource-type confusion -> workload inspection
   - title-only verification -> body/content verification
   - init container failure -> `kubectl logs`
   - local artifact missing -> inspect remote source instead
   - local artifact fetched successfully -> apply content remotely
3. Make the orchestrator consult this module before planner output when the signal is strong.
4. Keep the planner only for ambiguous transitions.

**Acceptance criteria**

- Known recovery paths no longer depend on the planner returning the right tool.
- The failing tests around website follow-up and init-container logs pass.
- The execution trace clearly shows when a deterministic policy selected the next step.

### Phase 3: Introduce an explicit end-to-end workflow state

**Purpose**

Represent end-to-end build work as a small state machine instead of a loose series of rounds.

**Files**

- new module: `src/runtime-workflows/end-to-end-builder.js`
- `src/conversation-orchestrator.js`
- `src/runtime-control-state.js`
- `src/conversation-run-service.js`

**Workflow state shape**

- `type`
- `objective`
- `lane`
- `workspacePath`
- `remoteTarget`
- `repoStatus`
- `deployStatus`
- `verificationStatus`
- `completionCriteria`
- `lastMeaningfulProgressAt`

**Lane types**

- `repo-only`
- `deploy-only`
- `repo-then-deploy`
- `inspect-only`

**State transitions**

1. `planned`
2. `implementing`
3. `saving`
4. `deploying`
5. `verifying`
6. `completed`
7. `blocked`

**Acceptance criteria**

- The orchestrator can say which lane it is in.
- The runtime knows whether it still needs implementation, push, deploy, or verify.
- The loop stop condition depends on workflow state, not only round count.

### Phase 4: Make tool readiness and lane selection honest

**Purpose**

Do not plan with tools that cannot actually run.

**Files**

- `src/routes/tools.js`
- `src/agent-sdk/tool-docs/runtime-support.js`
- `src/opencode/service.js`
- `src/runtime-tool-manager.js`

**Changes**

1. For `opencode-run`, require:
   - integration enabled
   - Postgres persistence available
   - valid workspace root
   - for remote runs: SSH configured and non-loopback API base URL
2. Report runtime readiness as:
   - ready
   - degraded
   - unavailable
3. Feed that readiness into tool selection so the planner does not choose impossible lanes.
4. Surface the reason in admin/runtime diagnostics.

**Acceptance criteria**

- `opencode-run` is not presented as usable when persistence or remote prerequisites are missing.
- Remote-build plans downgrade cleanly to safer lanes instead of failing late.

### Phase 5: Implement remote OpenCode bootstrap or remove the false promise

**Purpose**

Make remote repo work usable on a fresh host.

**Files**

- `src/opencode/service.js`
- `src/opencode/service.test.js`
- `src/routes/admin/settings.controller.js`
- `src/config.js`

**Changes**

Choose one of these paths:

1. Preferred: implement `remoteAutoInstall`
   - detect missing `opencode`
   - verify architecture via `uname -m`
   - install the correct binary on the remote host
   - retry startup

2. Fallback: remove or hide `remoteAutoInstall`
   - if we do not want install automation, stop advertising it

**Acceptance criteria**

- A remote run on a clean host either bootstraps successfully or fails with an accurate, product-level capability message.
- There is no dead config that claims a feature exists when it does not.

### Phase 6: Add a first-class repo-to-deploy workflow

**Purpose**

Turn “implement, push, deploy, verify” into an explicit path instead of four loosely related tools.

**Files**

- new module: `src/runtime-workflows/end-to-end-builder.js`
- `src/conversation-orchestrator.js`
- `src/agent-sdk/tools/categories/system/GitLocalTool.js`
- `src/agent-sdk/tools/categories/ssh/K3sDeployTool.js`
- tests in `src/conversation-orchestrator.test.js`

**Flow**

1. Use `opencode-run` to modify/build/test the repo.
2. Use `git-safe remote-info` to inspect branch/upstream state.
3. Use `git-safe save-and-push` to commit and push.
4. Use `k3s-deploy sync-and-apply` or the narrower action set.
5. Use `remote-command` for rollout verification, content verification, or post-deploy diagnostics.

**Rules**

- Prefer immutable delivery over server-local Git editing.
- Keep `remote-command` for exceptions, not the primary authoring lane.
- Only switch to remote repo work when the user explicitly wants it or the workflow state requires it.

**Acceptance criteria**

- A mixed request can be routed through repo implementation and deploy without manual intervention between each stage.
- The trace shows a coherent sequence instead of unrelated tool calls.

### Phase 7: Build end-to-end tests that match the product promise

**Purpose**

Protect the new workflow from regression.

**Files**

- `src/conversation-orchestrator.test.js`
- `src/conversation-run-service.test.js`
- new tests for workflow module

**Test scenarios**

1. Repo-only:
   - user asks for code fix
   - runtime chooses `opencode-run`
   - runtime stops after implementation summary when no deploy is requested

2. Repo then deploy:
   - user asks to fix app and push live
   - runtime chooses `opencode-run` -> `git-safe` -> `k3s-deploy` -> verification
   - runtime stops after verification success

3. Deploy-only:
   - user asks to redeploy latest branch
   - runtime skips code lane and uses `k3s-deploy`

4. Remote website replacement:
   - runtime inspects deployed source
   - applies new content
   - verifies body content instead of only title

5. Kubernetes failure recovery:
   - `kubectl describe` shows init container failure
   - runtime follows with `kubectl logs`

6. Tool readiness downgrade:
   - remote OpenCode not ready
   - runtime does not choose impossible remote repo lane

**Acceptance criteria**

- The test suite exercises the advertised end-to-end builder path.
- The planner no longer over-executes once completion criteria are satisfied.

## Recommended Implementation Order

1. Phase 1
2. Phase 2
3. Phase 4
4. Phase 3
5. Phase 5
6. Phase 6
7. Phase 7

This order is deliberate:

- first stop the bad loop behavior,
- then harden deterministic next-step selection,
- then make tool availability honest,
- then add workflow state,
- then finish remote bootstrap,
- then wire the full repo-to-deploy path,
- then lock it down with end-to-end tests.

## First Implementation Slice

The best first slice is:

1. add a completion gate in `conversation-orchestrator`,
2. make deterministic remote follow-ups outrank planner output for known patterns,
3. update the failing orchestrator tests until they pass.

That gives immediate value and reduces the risk of building a new workflow layer on top of unstable loop behavior.

## Definition Of Done

The system is “end-to-end builder ready” when all of the following are true:

- it can classify repo work vs deploy work vs mixed work,
- it can run the right lane without claiming tools are available when they are not,
- it can continue through obvious next steps without user babysitting,
- it stops when the build/deploy/verify objective is actually satisfied,
- and the behavior is covered by workflow-level tests rather than only unit tests for individual tools.
