---
name: interface-quality-architecture
description: Improve, build, or audit a visual interface using grounded design research, explicit backend contracts, stable stateful UI patterns, accessibility checks, responsive layout constraints, and browser screenshot verification. Use when the user asks for better UI, UX, interface polish, backend hook wiring, design-system alignment, visual QA, or fixes for layout drift, mishape, contrast, overlap, broken states, or fake/demo-only UI.
---

# Interface Quality Architecture

Use this skill when the interface must feel designed, wired, and durable. The goal is not cosmetic polish; it is a grounded UI system that matches the product domain, calls the right backend surfaces, and survives real content, errors, loading, resizing, and repeated use.

## Operating Principles

- Ground visual decisions in the interface type: dashboard, chat, editor, canvas, workflow builder, report, ecommerce, portfolio, admin tool, game, or public website.
- Prefer the repo's existing frontend framework, routes, API client helpers, token names, component conventions, and test setup.
- Do not invent a fake backend when a real endpoint, schema, socket, SDK, or service adapter exists. If the backend is incomplete, create a narrow contract layer with explicit TODOs and safe loading/error behavior.
- Treat accessibility and layout stability as release requirements: readable color pairs, no horizontal overflow, no clipped labels, no text overlap, predictable focus states, and usable mobile behavior.
- Use cards only for repeated items, tools, and modals. Do not nest cards or build a landing page when the user needs an app surface.
- Keep typography proportional to context. Use compact headings in panels, tables, sidebars, and dashboards; reserve hero-scale type for actual heroes.
- Build every expected state: empty, loading, success, partial, error, disabled, long content, narrow screen, and disconnected/offline when the transport can fail.

## Inputs

Collect only what is missing:

- Target UI path, route, file, public URL, screenshot, or feature name.
- Intended user and job-to-be-done.
- Backend source: endpoint, WebSocket event, server action, SDK method, mock contract, or known unavailable state.
- Required platform conventions, such as KimiBuilt web chat, canvas, notation helper, admin dashboard, SaaS workflow, document/report output, or game.
- Visual direction only if the user already has one. Otherwise infer from the product domain and existing app.

If the user only says "make this UI better", inspect the local interface first and choose a conservative direction that fits the repo.

## Workflow

1. Baseline the current surface:
   - Read repo instructions, package metadata, frontend routes, current components, CSS/theme files, and API helpers.
   - Run or inspect the current UI when possible.
   - Capture the existing state with screenshots if a browser target is available.

2. Research the interface pattern:
   - Use current web research when the domain, product category, platform convention, accessibility rule, or component behavior could benefit from outside grounding.
   - Prefer official platform design guidance, mature design-system docs, accessibility references, and high-quality product examples.
   - For KimiBuilt routine public web research, start with Perplexity-backed `web-search` when available, then verify selected pages with `web-fetch`.
   - Summarize only the principles that directly affect the implementation. Do not pad the answer with generic design theory.

3. Map the backend contract:
   - Identify request/response shapes, auth, stream/SSE or WebSocket events, error formats, retry behavior, and timeout surfaces.
   - Build or reuse one small adapter/hook layer between UI and backend.
   - The adapter must expose clear UI state: `idle`, `loading`, `streaming` or `pending` when relevant, `success`, `empty`, and `error`.
   - Preserve a working baseline when only one transport path is broken.

4. Design the UI system:
   - Define explicit tokens for page, surface, panel, text, muted text, border, accent, danger, success, warning, focus, and overlay.
   - Define component dimensions with grid tracks, `minmax()`, `aspect-ratio`, min/max widths, and stable controls so hover, loading text, and long labels cannot resize the layout unexpectedly.
   - Pair every surface with readable foreground colors. Target WCAG AA: 4.5:1 for normal text and 3:1 for large or bold display text.
   - Use familiar controls: icon buttons for tools, segmented controls for modes, switches or checkboxes for binary settings, sliders/inputs for numeric values, menus for option sets, tabs for views.
   - Include focus rings, keyboard-friendly buttons/inputs, aria labels for icon-only controls, and readable error messages.

5. Implement:
   - Keep changes scoped to the target UI, shared tokens, and necessary backend adapter.
   - Use existing dependencies first. Add a dependency only when it is clearly justified by the interaction complexity.
   - For generated HTML or sandbox previews, prefer local `/api/sandbox-libraries/` routes when available and fall back to jsDelivr only when needed.
   - Avoid one-note palettes, decorative orbs/blobs, invisible overlays, tiny contrast, negative letter spacing, and viewport-width font scaling.

6. Verify:
   - Run the relevant automated test, typecheck, lint, or build command.
   - Open the UI in a browser when possible and verify desktop and mobile viewports.
   - For KimiBuilt generated HTML previews, run `node bin/kimibuilt-ui-check.js <url-or-file-url> --out ui-checks/<name>`.
   - Treat these as blockers: page errors, broken images, empty body text, low contrast, horizontal overflow, clipped labels, overlapping text, detached sticky UI, blank canvases, or controls that do not call the backend path.
   - Capture screenshots or UI-check output paths as evidence.

## Backend Hook Pattern

Use the local framework's naming conventions. When no convention exists, create a thin adapter with this shape:

```js
async function callFeature(input, { signal } = {}) {
  const response = await fetch('/api/feature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with ${response.status}`);
  }
  return payload;
}
```

The UI layer should own cancellation, disabled controls, retry affordances, and optimistic or staged updates. The adapter should own serialization, endpoint choice, auth headers already used by the repo, and error normalization.

## KimiBuilt-Specific Notes

- Web chat uses `/api/chat` and `/ws`; canvas uses `/api/canvas`; notation uses `/api/notation`.
- Canvas and notation interfaces should support exact text-range edits and visibly staged updates when content moves or changes.
- If sandbox/artifact URLs are involved, inspect existing internal URL helpers before changing storage or hard-coding hostnames.
- Keep backend hostnames environment-specific and verify them from config or the user before claiming they are canonical.

## Final Report

Use this compact format:

```markdown
**Interface Pass**
Changed: <what changed>
Backend: <real endpoint/hook/contract wired>
Research: <sources used or "not needed">
Verified: <tests/checks/screenshots>
Risks: <remaining risk or "none found">
```
