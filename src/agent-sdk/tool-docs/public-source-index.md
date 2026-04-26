# public-source-index

Purpose: durable catalog of public APIs, dashboards, news feeds, RSS feeds, open-data portals, downloads, and public information endpoints that agents can reuse.

Use when:
- the user asks what public sources, dashboards, feeds, or APIs are available
- a task needs a known source of public data before doing live web research
- you discover a reusable public endpoint that should be saved for future agents
- you need to verify whether a saved source still responds

Tools:
- `public-source-list`: list indexed sources by `kind`, `domain`, `status`, `topics`, `tags`, and `limit`.
- `public-source-search`: text search over source name, URL, domain, topics, tags, formats, examples, and notes.
- `public-source-get`: read one source entry by `id`.
- `public-source-add`: create or update a structured source entry.
- `public-source-refresh`: perform a lightweight URL probe and update status, HTTP status, content type, and inferred formats.

Entry guidance:
- Prefer stable official endpoints and documentation pages over scraped dashboard pages.
- Record auth requirements honestly: `none`, `api_key`, `oauth`, `token`, `session`, or `unknown`.
- Include freshness and rate-limit notes when known.
- Use `sourceUrls` for pages that justified the entry, and `docsUrl` for official documentation.
- Mark unverified discoveries as `candidate`; use `public-source-refresh` after adding if live verification is useful.

Kinds:
- `public_api`
- `dashboard`
- `news_feed`
- `rss_feed`
- `data_portal`
- `open_data`
- `download`
- `web_page`

Suggested workflow:
1. Search or list the index first.
2. If no match exists, use `web-search` to discover candidates and `web-fetch` to verify official pages.
3. Add durable entries with `public-source-add`.
4. Refresh entries only when live status matters.
