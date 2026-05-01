# code-sandbox

Purpose: execute code in an isolated Docker container, or persist previewable frontend project files.

Requirements:
- Docker engine access from the backend runtime
- language image pull/run capability
- For `mode: "project"`, an active session is recommended so the tool can save a previewable artifact.

Use when:
- the user explicitly asks to run code
- a contained execution result is needed
- the user asks for a local HTML/Vite-style frontend creation that should be previewed or downloaded from the CLI

Notes:
- `mode: "execute"` is operationally heavier than analysis-only tools and requires Docker.
- `mode: "project"` writes files under `output/sandboxes`, returns authenticated workspace preview URLs, and packages them as a frontend bundle artifact when persistence is available.
- Execution languages include JavaScript, Python, Java, Bash, Ruby, Go, and Rust. `dependencies` are installed before execution for JavaScript with npm and Python with pip; set `network: true` when packages must be downloaded.
- Java execution expects a `public class Main` entry point because sandbox code is saved as `Main.java`.
- Previewable site projects should use `mode: "project"` with `language: "html"`, `"vite"`, `"react"`, or `"tailwind"`.
- Project previews are static browser previews, so generated sites should prefer browser imports that run directly in the iframe. Good defaults: React + ReactDOM via ESM CDN or UMD scripts, Tailwind via the browser CDN script, and graph/data visualization through the local sandbox library routes below or matching CDN fallbacks.
- Installed sandbox browser libraries are exposed from `/api/sandbox-libraries/` when the backend image has the npm packages installed. Use `/api/sandbox-libraries/catalog.json` to inspect availability.
- Good graph/chart defaults:
  - Chart.js: `<script src="/api/sandbox-libraries/chartjs/chart.umd.js"></script>`
  - D3: `<script src="/api/sandbox-libraries/d3/d3.min.js"></script>`
  - Mermaid: use `<script src="/api/sandbox-libraries/mermaid/mermaid.min.js"></script>` only when `/api/sandbox-libraries/catalog.json` reports it available; otherwise use the jsDelivr CDN fallback.
  - Cytoscape: `<script src="/api/sandbox-libraries/cytoscape/cytoscape.min.js"></script>`
  - Plotly: `<script src="/api/sandbox-libraries/plotly/plotly.min.js"></script>`
  - ECharts: `<script src="/api/sandbox-libraries/echarts/echarts.min.js"></script>`
  - vis-network: `<script src="/api/sandbox-libraries/vis-network/vis-network.min.js"></script>`
  - Force Graph: `<script src="/api/sandbox-libraries/force-graph/force-graph.min.js"></script>`
  - 3D Force Graph: `<script src="/api/sandbox-libraries/force-graph-3d/3d-force-graph.min.js"></script>`
- Good 3D/animation/design defaults:
  - Three.js: add `<script type="importmap">{"imports":{"three":"/api/sandbox-libraries/three/three.module.js","three/addons/":"/api/sandbox-libraries/three/addons/"}}</script>`, then use `import * as THREE from "three"` in a module script.
  - GSAP: `<script src="/api/sandbox-libraries/gsap/gsap.min.js"></script>`
  - Matter.js: `<script src="/api/sandbox-libraries/matter/matter.min.js"></script>`
  - p5.js: `<script src="/api/sandbox-libraries/p5/p5.min.js"></script>`
  - Rough.js: `<script src="/api/sandbox-libraries/rough/rough.js"></script>`
- Use FastAPI in Python execution for API behavior checks, or produce a small static frontend that calls a documented API shape. A long-running FastAPI server is better handled by a managed app or remote build/deploy workflow rather than `mode: "execute"`.
