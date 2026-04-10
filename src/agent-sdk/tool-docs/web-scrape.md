# web-scrape

Purpose: extract named fields from a web page.

Use when:
- the user asks to pull headings, prices, links, labels, or repeated items
- you need structured extraction rather than raw HTML

Key params:
- `url`
- `selectors`
- `browser`
- `javascript`
- `researchSafe`
- `approvedDomains`
- `respectRobotsTxt`
- `waitForSelector`
- `actions`
- `captureScreenshot`

Patterns:
- Static page: use selectors only.
- Dynamic page: set `browser: true` or `javascript: true`.
- Cert/TLS problems: browser mode is the preferred fallback.
- Interactive page: use `browser: true` plus `actions` like `click`, `fill`, `type`, `press`, `wait_for_selector`, `wait_for_timeout`, `hover`, `scroll`, or `select_option`.
- Visual review: add `captureScreenshot: true` in browser mode to persist a screenshot artifact.

Selector format:
- `selector`
- `attribute`
- `multiple`
- `transform`

Notes:
- Selector support is intentionally basic.
- Good for tags, ids, classes, and repeated simple fields.
- For search-follow-up research, use `researchSafe: true` and `approvedDomains` so the backend can skip pages that are outside the approved source set or explicitly disallow bots in `robots.txt`.
