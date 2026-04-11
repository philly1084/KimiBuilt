# web-search

Purpose: find relevant pages before answering or scraping.

Use when:
- the user asks for current information
- the user asks for researched synthesis with current sources
- you need a page to inspect but do not have the URL yet

Key params:
- `query`
- `engine`
- `researchMode`
- `limit`
- `safeSearch`
- `region`
- `domains`
- `languageFilter`
- `timeRange`
- `publishedAfter` / `publishedBefore`
- `updatedAfter` / `updatedBefore`
- `maxTokens`
- `maxTokensPerPage`
- `userLocation`
- `maxSteps`
- `instructions`

Notes:
- `perplexity` is the working engine in this backend.
- Requires `PERPLEXITY_API_KEY` in the backend environment.
- `researchMode: "search"` uses Perplexity's raw `/search` endpoint for ranked results.
- `researchMode: "fast-search" | "pro-search" | "deep-research" | "advanced-deep-research"` uses Perplexity's `/v1/agent` presets for researched answers plus source results.
- Use `pro-search` for ordinary research requests and `deep-research` for explicit deep or comprehensive research.
- Use `domains` to bias Perplexity toward official docs, publishers, or an approved source family.
- Use `web-fetch` first on a result URL for direct verification.
- Use `web-scrape` only when deeper rendered or structured extraction is needed.
