const DOCUMENT_LAYOUT_CATALOG = {
  'editorial-rhythm': {
    id: 'editorial-rhythm',
    label: 'Editorial Rhythm',
    summary: 'Narrative-first hero, insight strip, and paced sections with visible chapter rhythm.',
    bestFor: 'Polished explainers, narrative reports, and feature-style briefs.',
    layout: 'Split hero, insight cards, compact flow map, and stacked story sections.',
    defaultTheme: 'editorial',
    showOutline: true,
    navigationLabel: 'Flow',
    navigationTitle: 'Story structure',
    minorIdeas: [
      'Open with one decisive thesis line instead of a generic subtitle.',
      'Use one proof-heavy section early to earn trust before deeper explanation.',
      'Let the closing section feel calmer and more conclusive than the opener.',
    ],
    guardrails: [
      'Do not turn every section into the same card pattern.',
      'Keep numbered chrome supportive, not louder than the content.',
      'Use spacing and hierarchy instead of decorative clutter.',
    ],
  },
  'briefing-grid': {
    id: 'briefing-grid',
    label: 'Briefing Grid',
    summary: 'Decision-oriented summary shell with crisp tiles and high scan speed.',
    bestFor: 'Executive briefs, memos, operating updates, and recommendation-heavy documents.',
    layout: 'Compact summary hero, KPI strip, and responsive section grid without chapter numbering.',
    defaultTheme: 'executive',
    showOutline: false,
    navigationLabel: 'Briefing',
    navigationTitle: 'Key sections',
    minorIdeas: [
      'Keep the strongest recommendation visible above the fold.',
      'Use short section intros and let evidence blocks do the heavy lifting.',
      'Promote metrics, risks, and next steps into distinct panels.',
    ],
    guardrails: [
      'Avoid dashboard-card overload; only tile content that benefits from scanning.',
      'Do not reintroduce giant 01/02/03 section chrome in this layout.',
      'Keep section headings functional and direct.',
    ],
  },
  'chapter-bands': {
    id: 'chapter-bands',
    label: 'Chapter Bands',
    summary: 'Wide chapter transitions with calmer reading surfaces and a more cinematic pace.',
    bestFor: 'Narrative proposals, launch stories, and long-form explainers that need stronger pacing.',
    layout: 'Full-width hero, chapter headers as visual resets, and content panels underneath each band.',
    defaultTheme: 'bold',
    showOutline: false,
    navigationLabel: 'Chapters',
    navigationTitle: 'Story arc',
    minorIdeas: [
      'Use section headers like scene changes rather than generic labels.',
      'Alternate denser proof sections with quieter explanatory sections.',
      'Reserve the strongest contrast for key chapter transitions.',
    ],
    guardrails: [
      'Do not use chapter bands for every small subsection.',
      'Keep the decorative contrast controlled and purposeful.',
      'Avoid verbose intros that waste the visual reset.',
    ],
  },
  'field-guide-rail': {
    id: 'field-guide-rail',
    label: 'Field Guide Rail',
    summary: 'Guide-style document with a persistent rail for wayfinding, checkpoints, and practical framing.',
    bestFor: 'Guides, playbooks, how-to documents, and operational rollouts.',
    layout: 'Single-column hero, side rail for orientation, and practical sections with restrained chrome.',
    defaultTheme: 'editorial',
    showOutline: true,
    navigationLabel: 'Guide map',
    navigationTitle: 'Wayfinding',
    minorIdeas: [
      'Use the rail to reinforce sequence and reduce repeated setup text.',
      'Highlight checkpoints, warnings, and decisions as utility notes.',
      'Write like a human operator who has seen the work in practice.',
    ],
    guardrails: [
      'Do not make the rail a second content column full of duplicate text.',
      'Keep instructions concrete and avoid motivational filler.',
      'Prefer checklists and callouts over decorative panels.',
    ],
  },
  'casefile-panels': {
    id: 'casefile-panels',
    label: 'Casefile Panels',
    summary: 'Proof-first case-study shell with stronger contrast between evidence and explanation.',
    bestFor: 'Case studies, analytical reports, and narrative data stories with visible proof.',
    layout: 'Hero with evidence lens, alternating proof panels, and content surfaces with reduced ornament.',
    defaultTheme: 'product',
    showOutline: false,
    navigationLabel: 'Casefile',
    navigationTitle: 'Evidence trail',
    minorIdeas: [
      'Let measured outcomes and concrete evidence carry the visual weight.',
      'Use section labels that imply progression, not template filler.',
      'Alternate explanation blocks with stats, tables, or chart-led proof.',
    ],
    guardrails: [
      'Do not bury the proof below long paragraphs.',
      'Avoid decorative case-study tropes that do not improve clarity.',
      'Keep each panel focused on one analytical job.',
    ],
  },
  'dashboard-kpi-grid': {
    id: 'dashboard-kpi-grid',
    label: 'Dashboard KPI Grid',
    summary: 'Metric cards, compact trend bars, and quick status blocks designed for scan-first operations.',
    bestFor: 'KPI tracking, health monitors, weekly performance briefs, and operational visibility.',
    layout: 'Metrics-first dashboard shell with dense but readable status cards, trend strips, and alert list.',
    defaultTheme: 'executive',
    showOutline: false,
    navigationLabel: 'Overview',
    navigationTitle: 'Dashboard sections',
    minorIdeas: [
      'Keep top KPI cards visually dominant and sort by business priority.',
      'Pair every alert block with an owner and due date field.',
      'Reserve dense tables for drill-down only after card-level summary.',
    ],
    guardrails: [
      'Do not overpack cards; keep each card readable on mobile.',
      'Avoid mixing narrative paragraphs with card-first sections.',
      'Keep status language consistent (good, warning, critical).',
    ],
  },
  'dashboard-funnel': {
    id: 'dashboard-funnel',
    label: 'Funnel Flow',
    summary: 'Stage-based workflow with conversion lanes, drop-off summaries, and action calls.',
    bestFor: 'Funnel and conversion dashboards, onboarding flow analysis, and growth pipelines.',
    layout: 'Ordered stage track with percentage/value pairing, exception rows, and flow notes.',
    defaultTheme: 'bold',
    showOutline: false,
    navigationLabel: 'Funnel',
    navigationTitle: 'Flow stages',
    minorIdeas: [
      'Name each stage explicitly in the section header.',
      'Show both percent and count for each stage.',
      'Call out the biggest drop-off next to an action suggestion.',
    ],
    guardrails: [
      'Do not hide denominator changes; show sample size changes at each stage.',
      'Avoid decorative arrows unless they improve flow clarity.',
      'Do not use funnel language if your stages are not conversion-related.',
    ],
  },
};

const { resolveDocumentBlueprint } = require('./document-design-blueprints');

const DEFAULT_LAYOUT_ORDER = [
  'editorial-rhythm',
  'briefing-grid',
  'chapter-bands',
  'field-guide-rail',
  'casefile-panels',
  'dashboard-kpi-grid',
  'dashboard-funnel',
];

const BLUEPRINT_LAYOUT_MAP = {
  document: ['editorial-rhythm', 'chapter-bands', 'field-guide-rail'],
  report: ['casefile-panels', 'briefing-grid', 'editorial-rhythm'],
  proposal: ['chapter-bands', 'editorial-rhythm', 'casefile-panels'],
  memo: ['briefing-grid', 'field-guide-rail', 'editorial-rhythm'],
  letter: ['editorial-rhythm', 'field-guide-rail'],
  'executive-brief': ['briefing-grid', 'casefile-panels', 'field-guide-rail'],
  'data-story': ['casefile-panels', 'briefing-grid', 'editorial-rhythm'],
  'research-note': ['briefing-grid', 'casefile-panels', 'editorial-rhythm'],
  'research-methodology': ['field-guide-rail', 'briefing-grid', 'chapter-bands'],
  'research-literature': ['casefile-panels', 'briefing-grid', 'editorial-rhythm'],
  'research-brief': ['briefing-grid', 'editorial-rhythm'],
  'html-dashboard-kpi': ['dashboard-kpi-grid', 'briefing-grid', 'field-guide-rail'],
  'html-dashboard-operational': ['dashboard-kpi-grid', 'field-guide-rail', 'chapter-bands'],
  'html-dashboard-funnel': ['dashboard-funnel', 'dashboard-kpi-grid', 'briefing-grid'],
  'html-article': ['editorial-rhythm', 'chapter-bands', 'field-guide-rail'],
  'html-product-page': ['chapter-bands', 'editorial-rhythm', 'casefile-panels'],
  'html-technical-spec': ['field-guide-rail', 'casefile-panels', 'briefing-grid'],
  'pdf-whitepaper': ['casefile-panels', 'editorial-rhythm', 'briefing-grid'],
  'pdf-audit-report': ['briefing-grid', 'field-guide-rail', 'casefile-panels'],
  'pdf-executive-brief': ['briefing-grid', 'chapter-bands', 'field-guide-rail'],
};

const DIRECTION_LAYOUT_MAP = {
  'editorial-feature': ['editorial-rhythm', 'chapter-bands'],
  'boardroom-brief': ['briefing-grid', 'field-guide-rail'],
  'studio-casefile': ['casefile-panels', 'chapter-bands'],
  'field-guide': ['field-guide-rail', 'editorial-rhythm'],
  'signal-journal': ['casefile-panels', 'briefing-grid'],
  'launch-manifesto': ['chapter-bands', 'editorial-rhythm'],
  'analyst-briefing': ['briefing-grid', 'casefile-panels'],
  'immersive-storyboard': ['chapter-bands', 'editorial-rhythm'],
  'systems-minimal': ['briefing-grid', 'field-guide-rail'],
  'campaign-sprint': ['chapter-bands', 'casefile-panels'],
};

function findDocumentLayout(layoutId = '') {
  const normalizedId = String(layoutId || '').trim().toLowerCase();
  if (!normalizedId) {
    return null;
  }

  return DOCUMENT_LAYOUT_CATALOG[normalizedId] || null;
}

function buildLayoutScoreMap(order = [], baseScore = 0) {
  const scoreMap = new Map();
  order.forEach((layoutId, index) => {
    scoreMap.set(layoutId, baseScore + (order.length - index));
  });
  return scoreMap;
}

function mergeScores(...maps) {
  const merged = new Map();
  maps.forEach((map) => {
    map.forEach((value, key) => {
      merged.set(key, (merged.get(key) || 0) + value);
    });
  });
  return merged;
}

function getDocumentLayoutOptions({
  blueprintId = 'document',
  directionId = '',
  format = 'html',
  selectedId = '',
  limit = 3,
} = {}) {
  const normalizedBlueprintId = String(blueprintId || 'document').trim().toLowerCase() || 'document';
  const normalizedDirectionId = String(directionId || '').trim().toLowerCase();
  const normalizedFormat = String(format || 'html').trim().toLowerCase();
  const normalizedSelectedId = String(selectedId || '').trim().toLowerCase();
  const cappedLimit = Math.max(1, Math.min(5, Number(limit) || 3));

  if (normalizedBlueprintId === 'presentation'
    || normalizedBlueprintId === 'pitch-deck'
    || normalizedBlueprintId === 'website-slides') {
    return [];
  }

  const defaultScores = buildLayoutScoreMap(DEFAULT_LAYOUT_ORDER, 0);
  const blueprintScores = buildLayoutScoreMap(
    BLUEPRINT_LAYOUT_MAP[normalizedBlueprintId] || DEFAULT_LAYOUT_ORDER,
    10,
  );
  const blueprint = resolveDocumentBlueprint(normalizedBlueprintId);
  const preferredLayouts = Array.isArray(blueprint?.preferredLayouts) ? blueprint.preferredLayouts : [];
  const preferredLayoutScores = buildLayoutScoreMap(
    preferredLayouts.filter((layoutId) => DOCUMENT_LAYOUT_CATALOG[layoutId]),
    18,
  );
  const directionScores = buildLayoutScoreMap(
    DIRECTION_LAYOUT_MAP[normalizedDirectionId] || [],
    16,
  );
  const selectedScores = normalizedSelectedId
    ? new Map([[normalizedSelectedId, 100]])
    : new Map();
  const formatScores = normalizedFormat === 'pdf'
    ? new Map([
      ['briefing-grid', 2],
      ['field-guide-rail', -2],
    ])
    : new Map();

  const scores = mergeScores(defaultScores, blueprintScores, directionScores, selectedScores, formatScores);

  return Object.values(DOCUMENT_LAYOUT_CATALOG)
    .map((layout) => ({
      ...layout,
      score: scores.get(layout.id) || 0,
      recommended: layout.id === normalizedSelectedId,
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, cappedLimit)
    .map((layout, index) => ({
      ...layout,
      recommended: layout.id === normalizedSelectedId || (!normalizedSelectedId && index === 0),
    }));
}

function renderDocumentLayoutPromptContext(designPlan = null, format = '') {
  const designOptions = Array.isArray(designPlan?.designOptions) ? designPlan.designOptions : [];
  const selectedDesignOption = designPlan?.selectedDesignOption || designPlan?.layoutChoice || designOptions[0] || null;
  if (!selectedDesignOption && designOptions.length === 0) {
    return '';
  }

  const normalizedFormat = String(format || '').trim().toLowerCase();
  const lines = [
    '<approved_layouts>',
    'Use only these approved layout directions as composition guidance. Do not invent arbitrary UI patterns outside them.',
    normalizedFormat === 'html' || normalizedFormat === 'pdf'
      ? 'For HTML and browser-rendered PDF outputs, the renderer will choose from these curated shells.'
      : 'Treat these options as content-shaping guidance rather than a literal HTML layout request.',
    ...designOptions.map((layout) => (
      `- ${layout.label} [${layout.id}] :: best for ${layout.bestFor} :: layout ${layout.layout} :: default theme ${layout.defaultTheme}`
    )),
  ];

  if (selectedDesignOption) {
    lines.push(`Selected layout: ${selectedDesignOption.label} [${selectedDesignOption.id}]`);

    if (Array.isArray(selectedDesignOption.minorIdeas) && selectedDesignOption.minorIdeas.length > 0) {
      lines.push('Minor design ideas to borrow:');
      selectedDesignOption.minorIdeas.forEach((entry) => lines.push(`- ${entry}`));
    }

    if (Array.isArray(selectedDesignOption.guardrails) && selectedDesignOption.guardrails.length > 0) {
      lines.push('UI guardrails:');
      selectedDesignOption.guardrails.forEach((entry) => lines.push(`- ${entry}`));
    }
  }

  lines.push('</approved_layouts>');
  return lines.join('\n');
}

module.exports = {
  DOCUMENT_LAYOUT_CATALOG,
  findDocumentLayout,
  getDocumentLayoutOptions,
  renderDocumentLayoutPromptContext,
};
