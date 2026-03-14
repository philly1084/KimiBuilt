# code-sandbox

Purpose: execute code in an isolated Docker container.

Requirements:
- Docker engine access from the backend runtime
- language image pull/run capability

Use when:
- the user explicitly asks to run code
- a contained execution result is needed

Notes:
- This is operationally heavier than analysis-only tools.
