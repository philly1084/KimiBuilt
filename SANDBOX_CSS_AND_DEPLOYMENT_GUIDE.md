# Sandbox-Safe Web App & Document Creation Guide

This guide helps when:
- generated documents/pages look unstyled,
- CSS appears partially missing,
- sandboxed output “escapes” expected layout,
- you want to build cool prototypes first, then decide when/how to deploy.

---

## 1) Core rule: separate **build** from **deploy**

Use a 2-stage workflow every time:

1. **Build stage (local/sandbox)**
   - Create content, components, styling, and assets.
   - Validate output with predictable local paths and a repeatable build command.
2. **Deploy stage (optional, later)**
   - Only deploy once the build output is complete and verified.

This keeps experimentation fast and avoids accidental early deployment.

---

## 2) Why CSS looks broken in sandbox environments

Most styling issues come from one of these:

1. **Wrong asset path base**
   - CSS links that work in dev server (`/styles.css`) can fail in file/sandbox contexts.
   - Prefer relative paths from the generated HTML (for static output).

2. **Missing build step**
   - Tailwind/PostCSS/Sass not compiled before opening the result.
   - You see raw class names but no generated utility CSS.

3. **CSP/restrictions in sandbox viewer**
   - Inline styles/scripts or remote CDNs may be blocked.
   - Move to bundled local assets.

4. **Race conditions in dynamic injection**
   - JS inserts HTML before style bundle loads.
   - Ensure CSS is linked in `<head>` and available before render-critical content.

5. **Purge/minify over-removal**
   - Utility frameworks can strip dynamic class names.
   - Safelist generated class patterns.

---

## 3) “No-surprise” project structure

Use a simple structure in prototypes:

```text
project/
  src/
    index.html
    app.js
    styles.css
  dist/
    index.html
    app.js
    styles.css
  assets/
```

Rules:
- `src/` is editable source.
- `dist/` is deployable output only.
- Do not hand-edit `dist/`.
- Validate by opening/serving `dist/index.html`.

---

## 4) Reliable CSS checklist (quick triage)

When styling is incomplete, check in this order:

1. **Link tag points to real file**
   - `href` path is correct from output HTML location.
2. **Built CSS actually exists and is non-empty**
   - verify file size and timestamp.
3. **Network panel / console has no 404 for CSS**
   - if 404 exists, fix path first.
4. **Framework compile ran successfully**
   - no silent Tailwind/PostCSS/Sass errors.
5. **Dynamic classes preserved**
   - safelist generated classes in framework config.

---

## 5) Suggested build-first workflow for “cool things”

1. Start with local prototype scope:
   - one page/app,
   - one interaction loop,
   - one visual theme.

2. Add a repeatable build command:
   - example: `npm run build` writes to `dist/`.

3. Add a preview command:
   - example: `npm run preview` serves `dist/`.

4. Freeze “v1 candidate”:
   - if CSS/layout/functionality are stable, tag as candidate.

5. Decide deployment target **after** quality check:
   - static host (simple sites),
   - container/platform (dynamic apps),
   - full cloud (APIs + DB + auth).

---

## 6) Deployment decision matrix (simple)

- **Static site hosting** (fastest)
  - best for docs, portfolios, landing pages, SPA frontends.
- **App platform / PaaS**
  - best for full-stack prototypes needing server logic.
- **Container/Kubernetes**
  - best when you need infra control and scaling patterns.

If your priority is rapid experimentation, choose static or PaaS first.

---

## 7) Guardrails to prevent “escaping” output

- Keep generated files inside one output root (`dist/`).
- Never rely on absolute filesystem paths.
- Avoid remote runtime dependencies for critical CSS.
- Pin dependency versions for reproducible output.
- Add a pre-deploy validation script that fails on missing CSS/JS assets.

---

## 8) Minimal pre-deploy validation template

Run these checks before deploying:

1. Build succeeds with zero errors.
2. `dist/index.html` exists.
3. Required CSS files exist and are non-zero size.
4. Required JS bundle exists.
5. Basic smoke render passes in preview.

If any check fails: fix build, do not deploy.

---

## 9) Practical next step for this repo

If you want, the next iteration can add:
1. A concrete `npm run build` + `npm run preview` flow,
2. a tiny validation script for CSS/asset completeness,
3. optional deployment presets (static vs app platform) so you can choose at release time.

