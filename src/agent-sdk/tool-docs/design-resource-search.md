# Design Resource Search

Searches a curated whitelist of reputable design-resource sources for website,
document, presentation, and canvas creation work.

Use this before `web-fetch` when an agent needs safe sources for:

- backgrounds and imagery
- fonts and typography
- HTML/CSS styling references
- icons and SVG assets
- design-token and CSS reference material

## Actions

- `search`: find matching sources.
- `get`: return one source by `resourceId`.
- `fetch_plan`: return one source plus `web-fetch` parameters.
- `categories`: list indexed categories.
- `approved_domains`: list all whitelisted source domains.

## Example

```json
{
  "action": "search",
  "query": "dashboard css icons",
  "surface": "website",
  "limit": 5
}
```

Then pass a returned `fetchPlan.params` object to `web-fetch`.

## Safety

The index is intentionally small and curated. It favors official docs and APIs:
Google Fonts, Unsplash, Pexels, Wikimedia Commons, MDN, Tailwind CSS,
Bootstrap, and Lucide.
