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
- `waitForSelector`

Patterns:
- Static page: use selectors only.
- Dynamic page: set `browser: true` or `javascript: true`.
- Cert/TLS problems: browser mode is the preferred fallback.

Selector format:
- `selector`
- `attribute`
- `multiple`
- `transform`

Notes:
- Selector support is intentionally basic.
- Good for tags, ids, classes, and repeated simple fields.
