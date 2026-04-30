const {
  resolveDocumentBlueprint,
} = require('./document-design-blueprints');
const {
  getDocumentLayoutOptions,
} = require('./document-layout-catalog');

const DOCUMENT_THEMES = {
  editorial: {
    id: 'editorial',
    label: 'Editorial',
    background: '#f3efe8',
    page: '#fffdf9',
    panel: '#fffaf4',
    panelAlt: '#f6eee5',
    text: '#172033',
    muted: '#5c677a',
    accent: '#b6463a',
    accentSoft: '#f1d6d1',
    border: '#decfbe',
    success: '#1f6b52',
    warning: '#b26c18',
    chartStart: '#b6463a',
    chartEnd: '#f48b43',
  },
  executive: {
    id: 'executive',
    label: 'Executive',
    background: '#edf3fb',
    page: '#ffffff',
    panel: '#f8fbff',
    panelAlt: '#edf4fd',
    text: '#0f1b2f',
    muted: '#516175',
    accent: '#1e5ab6',
    accentSoft: '#dbe8ff',
    border: '#d3dfef',
    success: '#156f5b',
    warning: '#a66c12',
    chartStart: '#1e5ab6',
    chartEnd: '#37a6ff',
  },
  product: {
    id: 'product',
    label: 'Product',
    background: '#0d1728',
    page: '#122033',
    panel: '#17283f',
    panelAlt: '#1d3250',
    text: '#eef6ff',
    muted: '#c1d0df',
    accent: '#30c67c',
    accentSoft: '#183d31',
    border: '#274764',
    success: '#30c67c',
    warning: '#f3b74d',
    chartStart: '#30c67c',
    chartEnd: '#69e7a6',
  },
  bold: {
    id: 'bold',
    label: 'Bold',
    background: '#16181f',
    page: '#1f2430',
    panel: '#262d3d',
    panelAlt: '#2d3550',
    text: '#f6f7fb',
    muted: '#d2d6e2',
    accent: '#f2a01f',
    accentSoft: '#4d3510',
    border: '#444d63',
    success: '#7bd88f',
    warning: '#f2a01f',
    chartStart: '#f2a01f',
    chartEnd: '#ffd16b',
  },
};

function resolveDocumentTheme(theme = 'editorial') {
  const normalized = String(theme || '').trim().toLowerCase();
  return DOCUMENT_THEMES[normalized] || DOCUMENT_THEMES.editorial;
}

function parseHexColor(value = '') {
  const normalized = String(value || '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) {
    return null;
  }

  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function toHexChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0');
}

function mixHexColor(color, mixWith, weight = 0.5) {
  const source = parseHexColor(color);
  const target = parseHexColor(mixWith);
  if (!source || !target) {
    return color || mixWith || '#ffffff';
  }

  const clampedWeight = Math.max(0, Math.min(1, Number(weight)));
  const mixed = {
    r: source.r * (1 - clampedWeight) + target.r * clampedWeight,
    g: source.g * (1 - clampedWeight) + target.g * clampedWeight,
    b: source.b * (1 - clampedWeight) + target.b * clampedWeight,
  };

  return `#${toHexChannel(mixed.r)}${toHexChannel(mixed.g)}${toHexChannel(mixed.b)}`;
}

function alphaColor(color, alpha = 1) {
  const parsed = parseHexColor(color);
  if (!parsed) {
    return color || 'transparent';
  }

  const clampedAlpha = Math.max(0, Math.min(1, Number(alpha)));
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${clampedAlpha})`;
}

function colorLuminance(color) {
  const parsed = parseHexColor(color);
  if (!parsed) {
    return 1;
  }

  const normalize = (channel) => {
    const value = channel / 255;
    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };

  return (0.2126 * normalize(parsed.r)) + (0.7152 * normalize(parsed.g)) + (0.0722 * normalize(parsed.b));
}

function isDarkColor(color) {
  return colorLuminance(color) < 0.35;
}

function buildDocumentBackgroundSpec({
  theme = DOCUMENT_THEMES.editorial,
  layoutChoice = null,
  blueprint = null,
  format = 'html',
} = {}) {
  const resolvedTheme = theme?.id ? theme : resolveDocumentTheme(theme);
  const dark = isDarkColor(resolvedTheme.background);
  const layoutId = layoutChoice?.id || 'document';
  const accent = resolvedTheme.accent || resolvedTheme.chartStart || '#2563eb';
  const soft = resolvedTheme.accentSoft || resolvedTheme.panelAlt || resolvedTheme.panel;

  return {
    id: `${resolvedTheme.id}-${layoutId}-background`,
    label: `${resolvedTheme.label || resolvedTheme.id} ${layoutChoice?.label || blueprint?.label || 'document'} background`,
    format,
    canvas: resolvedTheme.background,
    canvasEnd: dark
      ? mixHexColor(resolvedTheme.background, '#000000', 0.22)
      : mixHexColor(resolvedTheme.background, '#ffffff', 0.28),
    pageSurface: resolvedTheme.page,
    panelSurface: resolvedTheme.panel,
    wash: alphaColor(accent, dark ? 0.18 : 0.13),
    washSoft: alphaColor(soft, dark ? 0.2 : 0.55),
    gridLine: dark ? 'rgba(255, 255, 255, 0.045)' : 'rgba(15, 23, 42, 0.042)',
    textureLine: dark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(15, 23, 42, 0.028)',
    shadow: dark ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.12)',
    print: {
      background: '#ffffff',
      pageSurface: '#ffffff',
      text: '#111827',
      muted: '#374151',
      border: '#d1d5db',
    },
  };
}

function normalizeSections(sections = []) {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections
    .filter((section) => section && typeof section === 'object')
    .map((section, index) => ({
      ...section,
      heading: section.heading || section.title || `Section ${index + 1}`,
      content: typeof section.content === 'string' ? section.content : '',
      level: Number(section.level) || 1,
      bullets: Array.isArray(section.bullets) ? section.bullets.filter(Boolean) : [],
      stats: Array.isArray(section.stats) ? section.stats.filter(Boolean) : [],
      table: section.table || null,
      chart: section.chart || null,
      callout: section.callout || null,
    }));
}

function estimateReadingMinutes(content = {}) {
  const sections = normalizeSections(content.sections);
  const text = [
    content.title,
    content.subtitle,
    ...sections.map((section) => [
      section.heading,
      section.content,
      section.bullets.join(' '),
      section.stats.map((stat) => `${stat.label || ''} ${stat.value || ''} ${stat.detail || ''}`).join(' '),
    ].join(' ')),
  ].join(' ');

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Math.max(1, Math.ceil(words / 220));
}

function determineSectionLayout(section = {}, index = 0) {
  if (section.chart?.series?.length) {
    return 'chart';
  }
  if (section.table?.rows?.length) {
    return 'evidence';
  }
  if (section.stats?.length >= 3) {
    return 'metrics';
  }
  if (section.callout) {
    return 'callout';
  }
  if (section.bullets?.length >= 4) {
    return 'briefing';
  }
  return index === 0 ? 'lead' : 'narrative';
}

function buildInsightCards({ blueprint, sections, tone, length, format, content }) {
  const cards = [
    {
      label: 'Blueprint',
      value: blueprint.label,
      detail: blueprint.goal,
    },
    {
      label: 'Sections',
      value: String(sections.length || 1),
      detail: `${estimateReadingMinutes(content)} min read`,
    },
    {
      label: 'Tone',
      value: tone || 'professional',
      detail: `Built for ${format.toUpperCase()}`,
    },
  ];

  if (length) {
    cards.push({
      label: 'Depth',
      value: String(length),
      detail: blueprint.narrative,
    });
  }

  return cards;
}

function buildOutlineItems(sections = []) {
  return sections.map((section, index) => ({
    index: index + 1,
    number: String(index + 1).padStart(2, '0'),
    heading: section.heading || `Section ${index + 1}`,
    layout: determineSectionLayout(section, index),
    level: Number(section.level) || 1,
  }));
}

function buildDocumentDesignPlan({
  content = {},
  format = 'html',
  tone = 'professional',
  length = 'medium',
  documentType = 'document',
  requestedPlan = null,
  theme: requestedTheme = '',
} = {}) {
  const blueprint = resolveDocumentBlueprint(documentType || requestedPlan?.inferredType || content.documentType);
  const requestedLayoutId = requestedPlan?.selectedDesignOption?.id
    || requestedPlan?.layoutChoice?.id
    || requestedPlan?.designOptionId
    || '';
  const layoutOptions = getDocumentLayoutOptions({
    blueprintId: blueprint.id,
    directionId: requestedPlan?.creativeDirection?.id || '',
    format,
    selectedId: requestedLayoutId,
    limit: 4,
  });
  const layoutChoice = layoutOptions[0] || null;
  const theme = resolveDocumentTheme(
    requestedTheme
    || content.theme
    || requestedPlan?.themeSuggestion
    || layoutChoice?.defaultTheme
    || 'editorial',
  );
  const background = buildDocumentBackgroundSpec({
    theme,
    layoutChoice,
    blueprint,
    format,
  });
  const sections = normalizeSections(content.sections);
  const outline = buildOutlineItems(sections);
  const insightCards = buildInsightCards({
    blueprint,
    sections,
    tone,
    length,
    format,
    content,
  });

  return {
    blueprint: {
      id: blueprint.id,
      label: blueprint.label,
      goal: blueprint.goal,
      narrative: blueprint.narrative,
    },
    theme,
    background,
    format,
    tone,
    length,
    title: content.title || requestedPlan?.titleSuggestion || 'Document',
    subtitle: content.subtitle || '',
    hero: {
      eyebrow: blueprint.label,
      narrative: blueprint.narrative,
      summary: `${sections.length || 1} section${sections.length === 1 ? '' : 's'} shaped for ${format.toUpperCase()} output.`,
    },
    insightCards,
    outline: outline.length >= 3 ? outline : [],
    designOptions: layoutOptions,
    layoutChoice,
    sections: sections.map((section, index) => ({
      ...section,
      number: String(index + 1).padStart(2, '0'),
      layout: determineSectionLayout(section, index),
      anchor: `section-${index + 1}`,
    })),
    pdf: {
      pageMargins: theme.id === 'product' || theme.id === 'bold'
        ? [42, 52, 42, 46]
        : [46, 56, 46, 50],
      showOutline: outline.length >= 3,
      showInsightCards: true,
    },
  };
}

module.exports = {
  DOCUMENT_THEMES,
  buildDocumentBackgroundSpec,
  buildDocumentDesignPlan,
  resolveDocumentTheme,
};
