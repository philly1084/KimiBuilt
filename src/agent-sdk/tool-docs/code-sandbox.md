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
- Project previews are static browser previews, so generated sites should prefer browser/CDN imports that run directly in the iframe. Good defaults: React + ReactDOM via ESM CDN or UMD scripts, Tailwind via the browser CDN script, and graph/data visualization through Chart.js, D3, Mermaid, Cytoscape, Plotly, or ECharts CDN builds.
- Use FastAPI in Python execution for API behavior checks, or produce a small static frontend that calls a documented API shape. A long-running FastAPI server is better handled by a managed app or remote build/deploy workflow rather than `mode: "execute"`.
