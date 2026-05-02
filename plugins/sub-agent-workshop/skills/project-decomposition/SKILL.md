---
name: project-decomposition
description: Decide whether a requested project fits clean sub-agent decomposition, then create separate sub-agent work lanes with tailored personality, direction, ownership, and completion criteria. Use when the user asks to break a project into sub-agents, delegate work across agents, assign agent personas, or give agents their own chat windows.
---

# Project Decomposition

Use this skill when a user wants a project broken into sub-agents with separate chat windows. The lead agent must protect the user from bad decomposition: do not agree to split a job until the work is proven to fit.

## Fit Gate

Before spawning or proposing sub-agents, classify the work:

- `clean split`: independent workstreams with disjoint files, outputs, domains, or research questions.
- `split with lead integration`: lanes can proceed independently, but one lead agent must do final assembly, conflict resolution, release notes, or verification.
- `single-agent`: the task depends on one evolving design, one shared file, a fragile global refactor, a unified narrative voice, or constant cross-lane alignment.

Only open sub-agent lanes for `clean split` or `split with lead integration`. If the job is `single-agent`, say why in one short paragraph and handle it as the lead.

## Fit Checklist

The work fits sub-agents only when all relevant items are true:

- Each lane has a concrete deliverable and clear done condition.
- Each lane can proceed without waiting on another lane's unfinished decisions.
- File or system ownership is disjoint, or research outputs are independent.
- Shared interfaces, contracts, schemas, naming, and style rules are known before work starts.
- The merge point is small enough for one lead agent to review or finish.
- No lane requires another lane's private chat context to make progress.

If any item is false, either reshape the work into a smaller independent lane set or keep the coupled part with the lead agent.

## Agent Roster

For every accepted sub-agent, define:

- `name`: short human-readable label.
- `personality`: one or two sentences describing working style, communication tone, and bias.
- `mission`: the exact result this agent owns.
- `write scope`: files, folders, modules, or artifact sections this agent may edit.
- `read scope`: context it should inspect before acting.
- `constraints`: things it must preserve, avoid, or coordinate around.
- `done signal`: what it must report back.

Do not create overlapping write scopes unless one lane is explicitly read-only. Tell each worker that other agents may be active and that it must not revert work it did not make.

## Chat Windows

When the host environment supports sub-agents, open one separate sub-agent chat per accepted lane. Prefer worker agents for implementation and explorer agents for bounded research. Each chat prompt must include the roster entry, relevant shared context, and a reminder that the agent owns only its assigned lane.

If the environment cannot open actual sub-agent chats, create a "chat window plan" instead: one titled section per lane with the exact prompt the user can paste into a new chat.

## Lead-Agent Duties

The lead agent owns:

- Running the fit gate.
- Keeping coupled work local.
- Defining shared contracts before delegation.
- Reviewing sub-agent results.
- Integrating only the pieces that need a single final pass.
- Running final verification.

The lead agent should not delegate immediate blockers that it needs before doing anything else.

## Prompt Template

Use this shape for each sub-agent prompt:

```text
You are not alone in this codebase. Other agents may be working in parallel, so do not revert or rewrite work outside your lane.

Personality:
<personality>

Mission:
<mission>

Ownership:
- Write scope: <files/folders/artifact sections>
- Read scope: <context to inspect>

Constraints:
<constraints>

Done signal:
Return a concise report with files changed, tests or checks run, unresolved risks, and anything the lead agent must integrate.
```

## Refusal Shape

If the requested decomposition does not fit, be direct:

```text
I would keep this with one lead agent for now. The work needs <reason>, so parallel sub-agent chats would spend most of their time aligning instead of finishing cleanly. I can still split out <safe independent part> if you want parallel help there.
```

Do not call a bad split "parallel" just because it is large.
