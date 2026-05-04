Use this skill when the user wants a playable browser game, game prototype, simulation, multi-step interactive web app, Vite-style sandbox preview, or richer sandbox frontend than a single static HTML page.

Planner guidance:
- Treat this as a build-preview-iterate workflow. Do not answer with only code or a static mockup when `code-sandbox` project mode is available.
- Use `code-sandbox` with `mode:"project"` and `language:"vite"` for direct builds. Include `index.html`, `styles.css`, one or more JS modules, data fixtures, and assets as separate files.
- Keep the KimiBuilt preview immediately browser-runnable. Use relative module imports and local `/api/sandbox-libraries/` routes or browser-compatible CDN fallbacks instead of unresolved bare package imports.
- Include repo-ready Vite handoff files when useful: `package.json`, `vite.config.js`, and `src/` modules. The sandbox entry still needs to run from the saved preview without npm install.
- For games, build an actual game loop: input handling, update, render, win/lose or score state, pause/restart, responsive sizing, and a clear fallback/error state.
- For multi-step apps, model the workflow states explicitly: start, in progress, validation/error, completed, reset, and empty/loading where applicable.
- Prefer proven browser libraries for core mechanics: Three.js for 3D, Matter.js for physics, p5.js for sketch/game prototypes, GSAP for animation, Chart.js/D3/ECharts for data-heavy interactions.
- Keep controls visible and usable: keyboard and pointer/touch support, focus states, reduced-motion fallback, mobile-safe hit targets, and readable HUD/status text.

Verification standard:
- Open the preview and verify it is nonblank, interactive, and not only a screenshot-like shell.
- Test the primary controls, restart/reset, and at least one failure or edge state.
- For canvas/WebGL games, verify the canvas has stable dimensions, renders pixels, resizes correctly, and shows an in-page error if the renderer fails.
- Capture desktop and mobile screenshots with `web-scrape` when a preview URL exists. Console errors, auth walls, blank canvases, horizontal overflow, low contrast, or broken assets require a repair pass.
- Stop or unload old inline previews in web-chat when they are not active; keep the saved preview/artifact link so a past build can be started again later.

Handoff:
- Report the preview URL, bundle/artifact ID when available, source entry file, controls, tested states, and any remaining assumptions.
