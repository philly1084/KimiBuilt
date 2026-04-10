# web-search

Purpose: find relevant pages before answering or scraping.

Use when:
- the user asks for current information
- you need a page to inspect but do not have the URL yet

Key params:
- `query`
- `engine`
- `limit`
- `safeSearch`
- `region`
- `domains`

Notes:
- `perplexity` is the working engine in this backend.
- Requires `PERPLEXITY_API_KEY` in the backend environment.
- Use `domains` to bias Perplexity toward official docs, publishers, or an approved source family.
- Use `web-fetch` or `web-scrape` on a result URL if deeper inspection is needed.
