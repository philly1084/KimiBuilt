Use this skill when the user asks to build, redesign, polish, modernize, or deploy a rich frontend website, landing page, dashboard, product page, app UI, interactive web experience, or visual prototype.

Planner guidance:
- Treat this as a workflow skill, not a single tool. Pick the smallest concrete chain from the available tools.
- Prefer the repo's existing frontend framework and styling patterns.
- Build the actual usable experience first. Do not substitute a marketing placeholder unless the user explicitly asks for a landing page.
- Use real controls and states where the workflow implies them: navigation, buttons, tabs, filters, forms, empty/loading/error/disabled states, menus, dialogs, popovers, tooltips, and responsive navigation.
- For games or multi-step interactive apps, include a real state machine or game loop, visible HUD/status, pause/restart/reset, keyboard plus pointer/touch input when relevant, and an in-page fallback if canvas/WebGL/module loading fails.
- For website/dashboard/front-end artifacts, prefer `document-workflow generate-suite` with `buildMode:"sandbox"` or `useSandbox:true` when available, then run visual QA.
- Use `code-sandbox` with `mode:"project"` for direct sandbox/frontend project builds or repairs. Use `language:"vite"` for multi-file apps, browser games, simulations, and richer interactive previews. Avoid execute mode for website builds.
- Use `design-resource-search` before design-sensitive websites, dashboards, documents, or page artifacts unless design context is already available.
- Use `image-generate` for site-specific bitmap artwork, hero/product scenes, textures, thumbnails, or interface-supporting visuals when user-provided assets are missing. Treat it as a build step: wait for completion, verify at least one reusable artifact/markdown image URL, then wire the saved asset into the page.
- Use `web-search`/`web-fetch` for current product, venue, competitor, domain, or reference research when visual language or facts may have changed.
- Use `web-scrape` with `browser:true` and `captureScreenshot:true` for desktop/mobile visual QA and important opened states. Omit `selectors` unless extracting fields.
- Use `remote-cli-agent` for git-backed remote frontend implementation, deployment, and verification loops. Use `k3s-deploy` for standard cluster rollout or manifest verification.

Design standard:
- Make the first viewport communicate the product, workflow, place, or offer immediately.
- Use relevant imagery that reveals the actual subject, state, product, audience, or workflow. Avoid generic gradients, decorative blobs, vague stock-like backgrounds, and purely atmospheric art.
- Keep hierarchy, density, color, spacing, borders, radii, shadows, and typography domain-appropriate. Operational tools should be calm and scannable; editorial and brand sites may be more expressive.
- Avoid one-note palettes, oversized rounded cards, nested cards, clipped labels, text overflow, and incoherent overlap.
- Give fixed-format UI stable dimensions with grids, aspect ratios, min/max constraints, and predictable control sizing.
- Check text/background contrast in normal and opened states, especially dropdowns, native selects, menus, popovers, dialogs, tooltips, disabled items, selected items, hover states, and focus states.
- Use icons from the existing icon set or lucide when available for common UI actions.

Verification standard:
- Run the app or preview when needed.
- If generated images are part of the build, confirm the returned artifact or hosted image URL renders in the page before moving on to broader QA.
- Capture desktop and mobile screenshots for non-trivial frontend work.
- For game/canvas/WebGL work, verify the preview is nonblank, actively renders pixels, and primary controls plus restart/reset work before finalizing.
- Inspect interactive controls before QA: search for select, option, menu, aria-haspopup, aria-expanded, popover, dialog, dropdown, submenu, tooltip, and related component imports.
- Open dropdowns, menus, popovers, submenus, dialogs, and tooltips where possible and verify readable contrast. For native select popups, verify option foreground/background CSS directly.
- Look for broken assets, console errors, blank canvases, overflow, overlaps, cramped controls, unreadable popup text, and states that only work at one viewport.
- Make at least one refinement pass after the first working screenshot for non-trivial sites.
