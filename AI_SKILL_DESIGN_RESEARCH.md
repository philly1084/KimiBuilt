# AI Skill Design Research

This note captures the design guidance used for the latest skill, tool-call, and document-generation improvements in KimiBuilt.

## Source Basis

- OpenAI Structured Outputs guide:
  [https://platform.openai.com/docs/guides/structured-outputs](https://platform.openai.com/docs/guides/structured-outputs)
- Anthropic prompt-engineering guidance on XML tags:
  [https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags)
- Model Context Protocol tool concepts:
  [https://modelcontextprotocol.io/docs/concepts/tools](https://modelcontextprotocol.io/docs/concepts/tools)
- Codex skill-creator guidance used locally:
  [C:/Users/phill/.codex/skills/.system/skill-creator/SKILL.md](C:/Users/phill/.codex/skills/.system/skill-creator/SKILL.md)

## Stable Principles

1. Keep metadata short and discriminative.
   Tool and skill names, descriptions, and trigger phrases should be concise, high-signal, and specific enough to trigger the right behavior without dragging extra context into every request.

2. Front-load the contract.
   The most important instructions should appear before examples or long context. The model should see role, task, output contract, and hard constraints immediately.

3. Delimit prompt sections clearly.
   Structured prompt sections reduce confusion across models. XML-like tags or strongly named sections are especially useful when prompts combine role, constraints, schemas, and examples.

4. Use strict schemas for structured output.
   Tool and JSON output contracts should minimize ambiguity. For object schemas, named properties should default to `additionalProperties: false` unless free-form maps are intentional.

5. Keep humans in the loop for state changes.
   Tool systems should make it obvious when a model is about to change files, remote systems, deployments, or persistent state. Confirmation boundaries should be explicit in both the runtime and the prompt.

6. Prefer reusable blueprints over generic “good writing” prompts.
   High-quality outputs come from task-specific design patterns. A report, executive brief, pitch deck, and website-slide deck each need different narrative structure, visual rhythm, and evidence strategy.

7. Pair narrative with evidence.
   For graphing and analytical documents, numbers alone are not enough. Every metric block or chart should carry an interpretation and implication, not just data.

8. Treat evals as part of the skill design.
   A skill or prompt design is not complete until the expected behavior is captured in regression tests or stable validation cases.

## Mapping To KimiBuilt

- Tool skills:
  Normalize trigger phrases, infer confirmation requirements from side effects, and make the model-facing tool descriptions carry the same safety hints the admin UI exposes.

- Tool schemas:
  Default object schemas with named properties to `additionalProperties: false` so strict tool-calling works more reliably across providers.

- Document production:
  Use blueprint-driven prompts instead of one generic writer prompt. Different document types need different required sections, pacing, and structured evidence rules.

- Graphing:
  Only ask the model for charts when it can provide explicit series values. Every chart should also include a takeaway sentence.

- Website slides:
  Treat them as narrative scenes, not memo pages. Each slide should have one dominant idea, short copy, strong visual direction, and visible pacing.

## Implemented In This Pass

- Shared document blueprints for:
  - `document`
  - `report`
  - `proposal`
  - `memo`
  - `letter`
  - `executive-brief`
  - `data-story`
  - `presentation`
  - `pitch-deck`
  - `website-slides`

- New built-in template designs for:
  - Executive Brief
  - Pitch Deck Story
  - Data Story Report
  - Website Slides Storyboard

- Template auto-discovery so the design catalog no longer depends on a hardcoded file list.

## Next Moves

1. Add model-behavior eval prompts for OSS, Gemini, Kimi, and OpenAI using the same blueprint contract.
2. Add chart-rich PDF and PPTX fixture tests so visual regressions are caught earlier.
3. Extend prompt blueprints into notes-page generation and artifact composition, not just document creation.
