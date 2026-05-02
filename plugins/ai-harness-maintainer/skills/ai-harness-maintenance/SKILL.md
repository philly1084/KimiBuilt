---
name: ai-harness-maintenance
description: Maintain a specific AI harness codebase through recurring research, scoped implementation, tests, and screenshot or browser verification. Use when the user asks to automate ongoing AI harness development, keep a repo updated, apply regular improvements, verify progress visually, or produce recurring maintenance reports.
---

# AI Harness Maintenance

Use this skill to run a disciplined maintenance loop against one explicit codebase. The goal is to improve AI harness reliability and capability over time without requiring the user to micromanage each pass.

## Inputs

Collect only what is missing and necessary:

- Target repository or workspace path.
- Maintenance cadence, if the user wants a recurring automation.
- Harness goals, such as model routing, tool calling, evals, UI workflows, memory, prompts, cost controls, observability, deployment, or test coverage.
- Allowed change scope, such as backend only, frontend only, tests only, docs, or deploy manifests.
- Verification target, such as a local URL, public URL, command, test suite, CLI flow, or screenshot path.

If the user does not provide a cadence, perform a one-time pass and recommend a cadence only at the end.

## Maintenance Loop

1. Establish baseline:
   - Read repo instructions, package metadata, test commands, and existing harness architecture.
   - Check git status before edits.
   - Identify current entrypoints, API routes, prompt/model code, tool adapters, evals, and UI verification surfaces.

2. Research:
   - Use current documentation and public research only when the task depends on changing or recent AI platform behavior.
   - Prefer primary sources for SDK, model, framework, and API behavior.
   - Record the exact source URLs and the date of the maintenance pass in the final report.

3. Plan a small patch:
   - Choose changes that are directly tied to the harness goals.
   - Avoid broad rewrites unless the user explicitly asks for a redesign.
   - Prefer one coherent improvement per pass, plus tests and verification evidence.

4. Implement:
   - Follow the repository's coding style.
   - Keep user changes intact.
   - Add or update tests when behavior changes.
   - Update docs or examples when operator behavior changes.

5. Verify:
   - Run the most relevant automated checks.
   - For frontend, canvas, CLI demo pages, dashboards, or visual harnesses, open the target in a browser and capture screenshots.
   - For generated HTML, dashboards, or reports in KimiBuilt, run `node bin/kimibuilt-ui-check.js <url-or-file-url> --out ui-checks/<name>` when a browser is available.
   - Treat page errors, broken images, empty body text, low contrast, horizontal overflow, and overlapping text as blockers.

6. Report:
   - Summarize what changed, why, and what evidence proves it.
   - Include tests run, screenshots captured, unresolved risks, and recommended next pass.
   - For recurring work, keep the report compact enough to scan after every run.

## Recurring Automation Pattern

When the user asks for regular automated maintenance, create a recurring automation instead of relying on memory. The automation prompt should include:

- Target workspace path.
- Harness goals and allowed scope.
- Research constraints and preferred sources.
- Required checks and screenshot/browser verification.
- Final report format.

Do not promise unattended production deploys unless deployment credentials, target, rollback expectations, and approval boundaries are explicit.

## Screenshot Verification

Use screenshots as evidence, not decoration:

- Capture before/after screenshots when UI behavior changes.
- Capture mobile and desktop viewports when responsive behavior matters.
- Save outputs under a predictable folder such as `ui-checks/<maintenance-name>/`.
- Mention screenshot paths in the final report.

## Final Report Format

Use this structure:

```markdown
**Maintenance Pass**
Changed: <short summary>
Verified: <tests/checks/screenshots>
Research: <source URLs or "not needed">
Risks: <remaining risk or "none found">
Next: <recommended next pass>
```
