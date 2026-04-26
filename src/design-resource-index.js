const SAFE_RESOURCE_SOURCES = Object.freeze([
  {
    id: 'google-fonts',
    name: 'Google Fonts',
    category: 'fonts',
    provider: 'Google',
    domains: ['fonts.googleapis.com', 'fonts.gstatic.com', 'developers.google.com'],
    surfaces: ['website', 'document', 'presentation', 'canvas'],
    formats: ['css', 'font-metadata', 'webfont'],
    description: 'Large hosted webfont library with CSS embeds and an official metadata API.',
    bestFor: ['font pairing', 'headings', 'body text', 'brand typography', 'multilingual typography'],
    docsUrl: 'https://developers.google.com/fonts/docs/getting_started',
    apiUrl: 'https://developers.google.com/fonts/docs/developer_api',
    fetchUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    fetchInstructions: 'Use the CSS API URL for known families. Use the Developer API for complete family metadata when GOOGLE_FONTS_API_KEY is configured.',
    env: ['GOOGLE_FONTS_API_KEY optional for metadata API'],
    attribution: 'Follow Google Fonts and font license terms for each family.',
    license: 'Open font licenses vary by family.',
    safetyNotes: ['Official Google domain.', 'No scraping required for CSS embeds.'],
    tags: ['fonts', 'typography', 'webfont', 'css', 'google', 'heading', 'body'],
  },
  {
    id: 'unsplash',
    name: 'Unsplash API',
    category: 'backgrounds',
    provider: 'Unsplash',
    domains: ['unsplash.com', 'api.unsplash.com', 'images.unsplash.com'],
    surfaces: ['website', 'document', 'presentation', 'canvas'],
    formats: ['photo', 'json', 'image-url'],
    description: 'Curated photography API for website hero images, backgrounds, editorial imagery, and design mockups.',
    bestFor: ['hero backgrounds', 'article images', 'product context shots', 'presentation imagery'],
    docsUrl: 'https://unsplash.com/documentation',
    apiUrl: 'https://api.unsplash.com/search/photos',
    fetchUrl: 'https://api.unsplash.com/search/photos?query=modern%20workspace&per_page=6&content_filter=high',
    fetchMethod: 'GET',
    fetchRequiresAuth: true,
    authHeader: 'Authorization: Client-ID ${UNSPLASH_ACCESS_KEY}',
    env: ['UNSPLASH_ACCESS_KEY'],
    attribution: 'Attribute Unsplash and the photographer, and trigger the download endpoint when a user selects an image.',
    license: 'Unsplash API terms and guidelines.',
    safetyNotes: ['Official API only.', 'Use content_filter=high for safer media selection.', 'Use returned hotlinked URLs as required by Unsplash.'],
    tags: ['background', 'photo', 'hero', 'stock', 'image', 'safe search', 'unsplash'],
  },
  {
    id: 'pexels',
    name: 'Pexels API',
    category: 'backgrounds',
    provider: 'Pexels',
    domains: ['pexels.com', 'api.pexels.com', 'images.pexels.com', 'videos.pexels.com'],
    surfaces: ['website', 'document', 'presentation', 'canvas'],
    formats: ['photo', 'video', 'json', 'image-url'],
    description: 'Free photo and video API with curated searchable media for backgrounds and presentation visuals.',
    bestFor: ['background photos', 'video backgrounds', 'presentation imagery', 'social graphics'],
    docsUrl: 'https://www.pexels.com/api/documentation/',
    apiUrl: 'https://api.pexels.com/v1/search',
    fetchUrl: 'https://api.pexels.com/v1/search?query=clean%20dashboard&per_page=6',
    fetchMethod: 'GET',
    fetchRequiresAuth: true,
    authHeader: 'Authorization: ${PEXELS_API_KEY}',
    env: ['PEXELS_API_KEY'],
    attribution: 'Show a prominent Pexels link and credit photographers when possible.',
    license: 'Pexels license and API terms.',
    safetyNotes: ['Official API only.', 'Curated media library.', 'Avoid scraping public search pages.'],
    tags: ['background', 'photo', 'video', 'hero', 'image', 'safe source', 'pexels'],
  },
  {
    id: 'wikimedia-commons',
    name: 'Wikimedia Commons MediaWiki API',
    category: 'backgrounds',
    provider: 'Wikimedia Foundation',
    domains: ['commons.wikimedia.org', 'upload.wikimedia.org'],
    surfaces: ['website', 'document', 'presentation'],
    formats: ['image', 'svg', 'metadata', 'json'],
    description: 'Free-use media repository with rich metadata and explicit licenses, useful for historical, educational, scientific, and public-domain visuals.',
    bestFor: ['document illustrations', 'public-domain media', 'maps', 'historic imagery', 'educational diagrams'],
    docsUrl: 'https://commons.wikimedia.org/wiki/Commons:API/MediaWiki',
    apiUrl: 'https://commons.wikimedia.org/w/api.php',
    fetchUrl: 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=architecture%20diagram&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url%7Cextmetadata&format=json&origin=*',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'Respect each file license. Use extmetadata for author, license, and attribution text.',
    license: 'Varies by file, commonly public domain or Creative Commons.',
    safetyNotes: ['Official Wikimedia API.', 'Fetch license metadata before reuse.'],
    tags: ['commons', 'wikimedia', 'public domain', 'creative commons', 'image', 'svg', 'document'],
  },
  {
    id: 'mdn-css-gradients',
    name: 'MDN CSS Gradients',
    category: 'backgrounds',
    provider: 'Mozilla',
    domains: ['developer.mozilla.org'],
    surfaces: ['website', 'document', 'canvas'],
    formats: ['css', 'reference', 'examples'],
    description: 'Authoritative CSS reference for linear, radial, conic, and repeating gradients that can replace external raster backgrounds.',
    bestFor: ['CSS backgrounds', 'gradient systems', 'lightweight hero backgrounds', 'print-safe design accents'],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_images/Using_CSS_gradients',
    fetchUrl: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_images/Using_CSS_gradients',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'MDN content is available under MDN licensing; cite when copying examples or reference text.',
    license: 'MDN Web Docs license.',
    safetyNotes: ['Official MDN documentation.', 'No third-party assets required.'],
    tags: ['css', 'gradient', 'background', 'linear-gradient', 'radial-gradient', 'conic-gradient'],
  },
  {
    id: 'mdn-css-custom-properties',
    name: 'MDN CSS Custom Properties',
    category: 'styling',
    provider: 'Mozilla',
    domains: ['developer.mozilla.org'],
    surfaces: ['website', 'document', 'canvas'],
    formats: ['css', 'reference', 'design-tokens'],
    description: 'Authoritative CSS variables reference for reusable color, spacing, typography, and theme tokens.',
    bestFor: ['design tokens', 'theme systems', 'dark mode', 'CSS architecture'],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/--%2A',
    fetchUrl: 'https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/--%2A',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'MDN content is available under MDN licensing; cite when copying examples or reference text.',
    license: 'MDN Web Docs license.',
    safetyNotes: ['Official MDN documentation.', 'Reference-only source.'],
    tags: ['css', 'variables', 'custom properties', 'tokens', 'theme', 'styling'],
  },
  {
    id: 'tailwind-css',
    name: 'Tailwind CSS Docs',
    category: 'styling',
    provider: 'Tailwind Labs',
    domains: ['tailwindcss.com'],
    surfaces: ['website', 'canvas'],
    formats: ['css', 'utility-classes', 'reference'],
    description: 'Utility-first CSS framework documentation for responsive layouts, spacing, typography, colors, and component composition.',
    bestFor: ['rapid website styling', 'responsive layout', 'utility classes', 'design systems'],
    docsUrl: 'https://tailwindcss.com/docs/utility-first',
    fetchUrl: 'https://tailwindcss.com/docs/utility-first',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'Follow Tailwind CSS documentation and package license terms.',
    license: 'Tailwind CSS package license.',
    safetyNotes: ['Official Tailwind domain.', 'Use docs as reference; install package through normal dependency workflow when needed.'],
    tags: ['tailwind', 'css', 'utility', 'responsive', 'layout', 'styling'],
  },
  {
    id: 'bootstrap',
    name: 'Bootstrap Docs',
    category: 'styling',
    provider: 'Bootstrap',
    domains: ['getbootstrap.com', 'cdn.jsdelivr.net'],
    surfaces: ['website', 'canvas'],
    formats: ['css', 'components', 'javascript'],
    description: 'Official responsive frontend toolkit documentation with grid, utilities, forms, and common components.',
    bestFor: ['component styling', 'admin pages', 'forms', 'responsive grids', 'fast prototypes'],
    docsUrl: 'https://getbootstrap.com/docs/5.3/getting-started/introduction/',
    fetchUrl: 'https://getbootstrap.com/docs/5.3/getting-started/introduction/',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'Follow Bootstrap license and documentation terms.',
    license: 'Bootstrap package license.',
    safetyNotes: ['Official Bootstrap documentation.', 'CDN domain listed only for documented assets.'],
    tags: ['bootstrap', 'css', 'components', 'grid', 'forms', 'styling'],
  },
  {
    id: 'lucide',
    name: 'Lucide Icons',
    category: 'icons',
    provider: 'Lucide',
    domains: ['lucide.dev', 'github.com'],
    surfaces: ['website', 'document', 'presentation', 'canvas'],
    formats: ['svg', 'icons', 'package'],
    description: 'Open-source SVG icon toolkit with consistent line icons and official packages for major frontend frameworks.',
    bestFor: ['interface icons', 'toolbar buttons', 'feature lists', 'document diagrams'],
    docsUrl: 'https://lucide.dev/',
    apiUrl: 'https://github.com/lucide-icons/lucide',
    fetchUrl: 'https://lucide.dev/',
    fetchMethod: 'GET',
    fetchRequiresAuth: false,
    attribution: 'Lucide is ISC licensed; keep license notices when bundling package assets.',
    license: 'ISC.',
    safetyNotes: ['Official site and GitHub organization.', 'Avoid unofficial icon mirrors.'],
    tags: ['lucide', 'icons', 'svg', 'interface', 'ui', 'toolbar'],
  },
]);

const CATEGORY_ALIASES = Object.freeze({
  background: 'backgrounds',
  backgrounds: 'backgrounds',
  image: 'backgrounds',
  images: 'backgrounds',
  photo: 'backgrounds',
  photos: 'backgrounds',
  font: 'fonts',
  fonts: 'fonts',
  typography: 'fonts',
  style: 'styling',
  styling: 'styling',
  css: 'styling',
  html: 'styling',
  component: 'styling',
  components: 'styling',
  icon: 'icons',
  icons: 'icons',
});

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeList(values = []) {
  const input = Array.isArray(values) ? values : String(values || '').split(',');
  return input
    .map((value) => normalizeText(value))
    .filter(Boolean);
}

function tokenize(value = '') {
  return Array.from(new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  ));
}

function normalizeCategory(value = '') {
  const normalized = normalizeText(value);
  return CATEGORY_ALIASES[normalized] || normalized;
}

function buildSearchText(source = {}) {
  return [
    source.id,
    source.name,
    source.category,
    source.provider,
    source.description,
    ...(source.bestFor || []),
    ...(source.surfaces || []),
    ...(source.formats || []),
    ...(source.tags || []),
  ].map((entry) => normalizeText(entry)).join(' ');
}

function scoreSource(source = {}, query = '') {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return 1;
  }

  const searchText = buildSearchText(source);
  const id = normalizeText(source.id);
  const name = normalizeText(source.name);
  let score = 0;

  tokens.forEach((token) => {
    if (id === token || name === token) {
      score += 20;
    } else if (id.includes(token) || name.includes(token)) {
      score += 12;
    }

    if (normalizeText(source.category) === normalizeCategory(token)) {
      score += 10;
    }

    if ((source.tags || []).some((tag) => normalizeText(tag).includes(token))) {
      score += 8;
    }

    if ((source.bestFor || []).some((item) => normalizeText(item).includes(token))) {
      score += 6;
    }

    if (searchText.includes(token)) {
      score += 3;
    }
  });

  return score;
}

function simplifySource(source = {}, { includeFetchPlan = true } = {}) {
  const simplified = {
    id: source.id,
    name: source.name,
    category: source.category,
    provider: source.provider,
    description: source.description,
    bestFor: source.bestFor || [],
    surfaces: source.surfaces || [],
    formats: source.formats || [],
    docsUrl: source.docsUrl,
    apiUrl: source.apiUrl || null,
    domains: source.domains || [],
    fetchRequiresAuth: Boolean(source.fetchRequiresAuth),
    env: source.env || [],
    attribution: source.attribution,
    license: source.license,
    safetyNotes: source.safetyNotes || [],
    tags: source.tags || [],
  };

  if (includeFetchPlan) {
    simplified.fetchPlan = buildFetchPlan(source);
  }

  return simplified;
}

function buildFetchPlan(source = {}, overrides = {}) {
  const url = String(overrides.url || source.fetchUrl || source.apiUrl || source.docsUrl || '').trim();
  const headers = {};
  if (source.authHeader) {
    const [name, ...valueParts] = source.authHeader.split(':');
    headers[name.trim()] = valueParts.join(':').trim();
  }

  return {
    resourceId: source.id,
    tool: 'web-fetch',
    approvedDomains: source.domains || [],
    params: {
      url,
      method: source.fetchMethod || 'GET',
      headers,
      cache: true,
      timeout: 30000,
    },
    requiresAuth: Boolean(source.fetchRequiresAuth),
    env: source.env || [],
    instructions: source.fetchInstructions || 'Fetch this official source URL directly. Respect attribution and license metadata before reuse.',
    attribution: source.attribution,
    safetyNotes: source.safetyNotes || [],
  };
}

class DesignResourceIndex {
  constructor(sources = SAFE_RESOURCE_SOURCES) {
    this.sources = sources.map((source) => ({ ...source }));
  }

  listSources(filters = {}) {
    return this.search({ ...filters, query: '' });
  }

  getSource(id = '') {
    const normalizedId = normalizeText(id);
    if (!normalizedId) {
      return null;
    }
    return this.sources.find((source) => source.id === normalizedId) || null;
  }

  search({
    query = '',
    category = '',
    surface = '',
    format = '',
    limit = 10,
  } = {}) {
    const normalizedCategory = normalizeCategory(category);
    const normalizedSurface = normalizeText(surface);
    const normalizedFormat = normalizeText(format);
    const maxResults = Math.max(1, Math.min(Number(limit) || 10, 50));

    const results = this.sources
      .filter((source) => {
        if (normalizedCategory && source.category !== normalizedCategory) {
          return false;
        }
        if (normalizedSurface && !(source.surfaces || []).includes(normalizedSurface)) {
          return false;
        }
        if (normalizedFormat && !(source.formats || []).includes(normalizedFormat)) {
          return false;
        }
        return true;
      })
      .map((source) => ({
        source,
        score: scoreSource(source, query),
      }))
      .filter((entry) => !query || entry.score > 0)
      .sort((a, b) => b.score - a.score || a.source.name.localeCompare(b.source.name))
      .slice(0, maxResults)
      .map((entry) => ({
        ...simplifySource(entry.source),
        score: entry.score,
      }));

    return {
      query: String(query || ''),
      filters: {
        category: normalizedCategory || null,
        surface: normalizedSurface || null,
        format: normalizedFormat || null,
      },
      count: results.length,
      approvedDomains: this.getApprovedDomains(results.map((result) => result.id)),
      results,
    };
  }

  getFetchPlan(id = '', overrides = {}) {
    const source = this.getSource(id);
    if (!source) {
      return null;
    }

    return {
      source: simplifySource(source, { includeFetchPlan: false }),
      fetchPlan: buildFetchPlan(source, overrides),
    };
  }

  getApprovedDomains(ids = []) {
    const sourceIds = new Set(normalizeList(ids));
    const sources = sourceIds.size > 0
      ? this.sources.filter((source) => sourceIds.has(source.id))
      : this.sources;

    return Array.from(new Set(
      sources
        .flatMap((source) => source.domains || [])
        .map((domain) => normalizeText(domain))
        .filter(Boolean),
    )).sort();
  }

  getCategories() {
    return Array.from(new Set(this.sources.map((source) => source.category))).sort();
  }
}

const designResourceIndex = new DesignResourceIndex();

module.exports = {
  DesignResourceIndex,
  SAFE_RESOURCE_SOURCES,
  designResourceIndex,
  normalizeCategory,
};
