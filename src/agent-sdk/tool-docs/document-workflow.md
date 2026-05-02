# Document Workflow

`document-workflow` recommends, plans, generates, assembles, and bundles document outputs.

Core actions:

- `recommend`: infer document type, format, templates, layout, and next action.
- `plan`: build a deterministic production plan before generation.
- `generate`: create one document or presentation.
- `assemble`: combine source material into one document.
- `generate-suite`: create a multi-format package such as PDF + HTML + PPTX + XLSX, with optional graph assets and a Vite/static preview bundle.

Quality defaults:

- Every AI-backed generation request receives the built-in document quality standard: strategy architecture, background art direction, evidence editing, accessibility review, and final polish.
- Treat design-sensitive documents and sandbox websites as a Symphony-style build loop: plan the surface, generate the artifact, review rendered output, then iterate before final delivery when the review exposes template sameness, broken layout, auth walls, low contrast, missing assets, or thin content.
- Background creation is automatic. The workflow should define readable canvas, page, panel, dark band, table, chart, caption, and image-overlay surfaces without making the user ask for visual prompt details.
- Pass `qualityPass:false` only for explicit cost or latency-sensitive calls where the caller accepts lower polish.

Training and Manuals:

- Use `documentType: "training-manual"` for manuals, learner guides, facilitator guides, job aids, workbooks, SOP training, curriculum plans, and training packages.
- Prefer `plan` before generation when the request is broad or design-sensitive.
- Prefer `generate-suite` when the user asks for a package across PDF, XLSX, HTML, or markdown.
- Pass `graphs`/`diagrams` when the deliverable needs charts, network diagrams, flowcharts, timelines, architecture visuals, or other custom document graphics; the workflow will call `graph-diagram` and feed the generated visual assets into the document suite.
- Use `buildMode: "sandbox"` or `useSandbox: true` for previewable HTML/Vite document bundles rather than a bare template export.
- For website, web app, dashboard, landing-page, and UI mockup requests, build through the richer HTML artifact/frontend path and preserve the generated bundle as the preview entry. Do not wrap a single website mockup in a generic document-suite index unless the user asked for a multi-file document package.
- Sandbox builds include an `AGENT_SANDBOX_BUILD.md` handoff prompt for the next agent. Keep that prompt capability-oriented: describe the sandbox constraints, available local browser libraries, relative-path rules, accessibility/readability checks, and preview expectations. Do not bake in a fixed visual style, palette, layout trope, or tool-orchestration chain.
- Treat sandbox build mode as a delivery switch, not permission to invent nested tool workflows. The build agent should use the files and tools already available in the sandbox project and choose design ideas from the user task, audience, and content.
- For interactive HTML documents, dashboards, graph explorers, and 3D explainers, prefer local sandbox browser library routes from `/api/sandbox-libraries/` before external CDNs. Common choices include Three.js, Chart.js, D3, Mermaid, Cytoscape, Plotly, ECharts, vis-network, GSAP, Matter.js, p5.js, Rough.js, Force Graph, and 3D Force Graph.
- Ask concise design questions when audience, delivery mode, duration, format mix, research depth, assessment style, or visual direction is unclear.
- Ground subject-specific training in vector context and verified web research when the user asks for current facts, standards, procedures, or domain-specific instruction.

Podcast and video podcast training:

- Use `document-workflow` for planning briefs, scripts, worksheets, and supporting documents.
- Use `podcast` for actual audio and MP4 generation.
- For large packages, split work by surface: manual, workbook, HTML page, podcast script, video-podcast storyboard, research, and QA.
