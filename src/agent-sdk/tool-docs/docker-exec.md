# docker-exec

Purpose: run commands inside an existing Docker container.

Requirements:
- Docker CLI available in the backend runtime
- target container accessible from the backend host

Use when:
- the user explicitly asks to inspect or run something in a container

Notes:
- This is a high-risk tool and should require explicit user intent.
