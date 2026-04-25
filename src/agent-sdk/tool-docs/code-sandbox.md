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
