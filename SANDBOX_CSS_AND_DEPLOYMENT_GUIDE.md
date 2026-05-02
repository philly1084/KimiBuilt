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

## 3) Document-specific sandbox rules

Sandbox HTML is excellent for fast document drafts, visual systems, reports, and dashboard-like PDFs, but it is usually a source/preview layer rather than the final artifact.

Use this workflow:

1. **Brief**
   - Capture format, audience, purpose, tone, length, required sections, data/assets, and acceptance checks.
2. **Preview source**
   - Build static-safe HTML with explicit design tokens, relative assets, semantic headings, figure/table captions, and print CSS.
3. **Export**
   - Convert through the real document path for PDF/PPTX/XLSX/Markdown. Use a separate verified conversion path for DOCX. Do not rename HTML to an office format.
4. **Verify**
   - Render or open the exported artifact and inspect page breaks, contrast, tables, captions, headers/footers, and image quality.
5. **Handoff**
   - Keep the source, final artifact, and QA notes together so another agent can continue cleanly.

For PDF-oriented HTML:
- Add `@page` margins and print-safe colors.
- Avoid fixed overlays, nested scroll regions, viewport-only sections, and animation-dependent content.
- Keep headings with nearby content where practical.
- Prevent table rows, figures, and callouts from splitting awkwardly.

For DOCX-oriented source:
- Favor simple semantic structure over elaborate CSS.
- Use headings, paragraphs, lists, tables, page breaks, figures, captions, and alt text.
- Use static image assets for charts and diagrams instead of interactive browser-only widgets.
- Keep reusable section IDs or comments around major blocks so follow-up edits can target exact regions.

KimiBuilt checks and routing:
- Run `node bin/kimibuilt-ui-check.js <url-or-file-url> --out ui-checks/<name>` for generated HTML previews when a browser is available.
- Check `/api/sandbox-libraries/catalog.json` before using local sandbox library routes.
- Treat relative preview/artifact URLs as intentional. Resolve them through the current backend/artifact URL handling instead of hard-coding `localhost`.
- Current native document outputs are HTML, PDF, PPTX, XLSX, and Markdown. DOCX/Word requests currently need a separate conversion path; sandbox HTML alone is not DOCX.

---

## 4) “No-surprise” project structure

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

## 5) Reliable CSS checklist (quick triage)

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

## 6) Suggested build-first workflow for “cool things”

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

## 7) Deployment decision matrix (simple)

- **Static site hosting** (fastest)
  - best for docs, portfolios, landing pages, SPA frontends.
- **App platform / PaaS**
  - best for full-stack prototypes needing server logic.
- **Container/Kubernetes**
  - best when you need infra control and scaling patterns.

If your priority is rapid experimentation, choose static or PaaS first.

---

## 8) Guardrails to prevent “escaping” output

- Keep generated files inside one output root (`dist/`).
- Never rely on absolute filesystem paths.
- Avoid remote runtime dependencies for critical CSS.
- Pin dependency versions for reproducible output.
- Add a pre-deploy validation script that fails on missing CSS/JS assets.

---

## 9) Minimal pre-deploy validation template

Run these checks before deploying:

1. Build succeeds with zero errors.
2. `dist/index.html` exists.
3. Required CSS files exist and are non-zero size.
4. Required JS bundle exists.
5. Basic smoke render passes in preview.

If any check fails: fix build, do not deploy.

---

## 10) Practical next step for this repo

If you want, the next iteration can add:
1. A concrete `npm run build` + `npm run preview` flow,
2. a tiny validation script for CSS/asset completeness,
3. optional deployment presets (static vs app platform) so you can choose at release time.
