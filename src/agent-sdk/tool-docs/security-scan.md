# security-scan

Purpose: scan source text for secrets and common security issues.

Use when:
- code is present in the prompt
- the user asks for a security audit or secret detection

Key params:
- `source`
- `language`
- `checks`
- `severity`

Notes:
- This is pattern-based analysis, not a full SAST engine.
- Good first-pass triage before deeper manual review.
