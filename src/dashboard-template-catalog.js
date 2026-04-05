const DEFAULT_DASHBOARD_TEMPLATE_IDS = [
  'executive-command-center',
  'saas-analytics-workspace',
  'operations-control-tower',
];

const DASHBOARD_TEMPLATE_CATALOG = [
  {
    id: 'executive-command-center',
    label: 'Executive Command Center',
    summary: 'Leadership dashboard with KPI rails, strategic initiative tracking, risk watch, and decision-oriented summaries.',
    bestFor: 'executive teams, board reviews, company scorecards, leadership snapshots',
    layout: 'Hero summary band, compact KPI rail, strategy grid, risk and decision panels.',
    visualDirection: 'Refined editorial layout, light surfaces, crisp status accents, and dense signal blocks.',
    modules: ['KPI rail', 'initiative tracker', 'risk watchlist', 'decision queue', 'milestone timeline'],
    keywords: ['executive', 'leadership', 'board', 'ceo', 'coo', 'strategy', 'scorecard', 'okr', 'quarterly'],
  },
  {
    id: 'admin-control-room',
    label: 'Admin Control Room',
    summary: 'Product admin dashboard with system health, user management, permissions, workflow controls, and audit visibility.',
    bestFor: 'admin panels, internal tools, user operations, settings-heavy products',
    layout: 'Top utility bar, control sidebar, alert strip, operational cards, and dense data tables.',
    visualDirection: 'Sharp utility styling, modular cards, elevated forms, and precise management views.',
    modules: ['system health', 'user table', 'roles and permissions', 'workflow toggles', 'audit log'],
    keywords: ['admin', 'internal tool', 'back office', 'permissions', 'roles', 'settings', 'users', 'audit', 'moderation'],
  },
  {
    id: 'saas-analytics-workspace',
    label: 'SaaS Analytics Workspace',
    summary: 'Product metrics dashboard centered on growth, retention, subscriptions, funnels, and feature adoption.',
    bestFor: 'SaaS products, product analytics, subscription businesses, growth teams',
    layout: 'Metric hero, chart-led middle band, funnel and cohort panels, insight sidebar.',
    visualDirection: 'Clean analytics canvas, bright data contrast, spacious chart regions, and polished filters.',
    modules: ['ARR and MRR cards', 'retention chart', 'activation funnel', 'cohort table', 'feature adoption matrix'],
    keywords: ['saas', 'analytics', 'product', 'subscription', 'arr', 'mrr', 'retention', 'cohort', 'funnel', 'adoption'],
  },
  {
    id: 'operations-control-tower',
    label: 'Operations Control Tower',
    summary: 'Operations dashboard for throughput, incidents, queues, SLAs, logistics, and live operational status.',
    bestFor: 'operations teams, logistics, fulfillment, fleet monitoring, incident response',
    layout: 'Status header, live queue band, SLA grid, map or timeline panel, incident feed.',
    visualDirection: 'Command-center pacing with strong contrast, stacked signal cards, and alert-aware modules.',
    modules: ['live status board', 'incident feed', 'queue depth', 'SLA tracker', 'regional map'],
    keywords: ['operations', 'ops', 'logistics', 'fulfillment', 'fleet', 'incident', 'queue', 'throughput', 'uptime', 'sla'],
  },
  {
    id: 'finance-performance-board',
    label: 'Finance Performance Board',
    summary: 'Financial dashboard focused on revenue, margin, cost structure, budget variance, and forward-looking forecast.',
    bestFor: 'finance teams, FP&A, revenue reviews, budget tracking, forecast dashboards',
    layout: 'Financial headline cards, trend comparisons, variance tables, forecast narrative, scenario panel.',
    visualDirection: 'Structured boardroom style with muted palette, premium typography, and precise comparison blocks.',
    modules: ['revenue summary', 'margin trend', 'budget variance', 'forecast model', 'cash and runway'],
    keywords: ['finance', 'financial', 'budget', 'forecast', 'revenue', 'margin', 'cash', 'runway', 'fp&a', 'variance'],
  },
  {
    id: 'sales-pipeline-radar',
    label: 'Sales Pipeline Radar',
    summary: 'CRM-style dashboard for leads, pipeline velocity, rep performance, quota attainment, and deal risk.',
    bestFor: 'sales teams, CRM dashboards, pipeline reviews, revenue operations',
    layout: 'Quota header, pipeline stage lane, rep leaderboard, deal table, forecast sidebar.',
    visualDirection: 'Energetic revenue-ops feel with strong pipeline color coding and compact comparative modules.',
    modules: ['quota attainment', 'pipeline stages', 'rep leaderboard', 'deal risk heatmap', 'forecast snapshot'],
    keywords: ['sales', 'crm', 'pipeline', 'deal', 'leads', 'quota', 'rep', 'forecast', 'revenue ops'],
  },
  {
    id: 'ecommerce-revenue-studio',
    label: 'Ecommerce Revenue Studio',
    summary: 'Commerce dashboard for orders, conversion, AOV, inventory pressure, returns, and campaign performance.',
    bestFor: 'ecommerce brands, retail operators, DTC storefronts, merchandising teams',
    layout: 'Revenue strip, order and conversion cards, merchandising grid, campaign breakdown, returns panel.',
    visualDirection: 'Merchandising-led dashboard with sharp product thumbnails, conversion charts, and retail signal cues.',
    modules: ['GMV cards', 'conversion trend', 'top products', 'inventory alerts', 'returns analysis'],
    keywords: ['ecommerce', 'commerce', 'store', 'shop', 'orders', 'inventory', 'merchandising', 'conversion', 'aov', 'returns'],
  },
  {
    id: 'support-service-desk',
    label: 'Support Service Desk',
    summary: 'Customer support dashboard for ticket flow, SLA compliance, queue ownership, CSAT, and escalation visibility.',
    bestFor: 'support teams, customer success operations, service desks, help centers',
    layout: 'Queue summary, ownership columns, SLA timers, satisfaction panel, escalation stream.',
    visualDirection: 'Service-ops styling with urgency cues, queue grouping, and clear ownership states.',
    modules: ['ticket queue', 'SLA timers', 'CSAT panel', 'escalation feed', 'agent workload board'],
    keywords: ['support', 'service desk', 'tickets', 'help desk', 'csat', 'escalation', 'customer success', 'queue'],
  },
];

function normalizeHaystack(prompt = '', existingContent = '') {
  return `${String(prompt || '')}\n${String(existingContent || '')}`
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDashboardRequest(prompt = '', existingContent = '') {
  const haystack = normalizeHaystack(prompt, existingContent);
  if (!haystack) {
    return false;
  }

  return /\b(dashboard|admin panel|admin console|control room|control tower|command center|analytics workspace|metrics board|scorecard|operations center|monitoring panel)\b/.test(haystack);
}

function scoreDashboardTemplate(template = {}, haystack = '') {
  if (!haystack) {
    return 0;
  }

  let score = 1;
  const keywords = Array.isArray(template.keywords) ? template.keywords : [];
  keywords.forEach((keyword) => {
    if (haystack.includes(String(keyword || '').toLowerCase())) {
      score += 4;
    }
  });

  const moduleText = Array.isArray(template.modules)
    ? template.modules.join(' ').toLowerCase()
    : '';
  const summaryText = [
    template.summary,
    template.bestFor,
    template.layout,
    template.visualDirection,
    moduleText,
  ].join(' ').toLowerCase();

  haystack.split(/[^a-z0-9]+/).forEach((token) => {
    if (token.length >= 4 && summaryText.includes(token)) {
      score += 1;
    }
  });

  if (/\bdashboard\b/.test(haystack)) {
    score += 2;
  }

  if (/\b(html|web|website|frontend|ui)\b/.test(haystack)) {
    score += 1;
  }

  return score;
}

function getTemplateById(templateId = '') {
  const normalizedId = String(templateId || '').trim().toLowerCase();
  return DASHBOARD_TEMPLATE_CATALOG.find((template) => template.id === normalizedId) || null;
}

function selectDashboardTemplates({ prompt = '', existingContent = '', limit = 3 } = {}) {
  const haystack = normalizeHaystack(prompt, existingContent);
  if (!isDashboardRequest(prompt, existingContent)) {
    return [];
  }

  const desiredLimit = Math.max(1, Math.min(Number(limit) || 3, 5));
  const scoredTemplates = DASHBOARD_TEMPLATE_CATALOG
    .map((template) => ({
      ...template,
      score: scoreDashboardTemplate(template, haystack),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const fallbackTemplates = DEFAULT_DASHBOARD_TEMPLATE_IDS
    .map((templateId) => getTemplateById(templateId))
    .filter(Boolean);
  const selected = [];
  const seen = new Set();

  scoredTemplates.forEach((template) => {
    if (selected.length >= desiredLimit || seen.has(template.id)) {
      return;
    }
    seen.add(template.id);
    selected.push(template);
  });

  fallbackTemplates.forEach((template) => {
    if (selected.length >= desiredLimit || seen.has(template.id)) {
      return;
    }
    seen.add(template.id);
    selected.push({ ...template, score: 0 });
  });

  return selected;
}

function buildDashboardTemplatePromptContext({ prompt = '', existingContent = '', limit = 3 } = {}) {
  const templates = selectDashboardTemplates({ prompt, existingContent, limit });
  if (templates.length === 0) {
    return '';
  }

  return [
    '[Dashboard template catalog]',
    'The request is dashboard-oriented. Choose one primary dashboard template and execute it decisively instead of blending all options together.',
    'You may borrow one or two supporting module ideas from a secondary option only when the request explicitly mixes domains.',
    ...templates.map((template, index) => (
      `- Option ${index + 1}: ${template.label} [${template.id}] | Best for: ${template.bestFor}. | Layout: ${template.layout}. | Visual direction: ${template.visualDirection}. | Modules: ${template.modules.join(', ')}.`
    )),
  ].join('\n');
}

module.exports = {
  DASHBOARD_TEMPLATE_CATALOG,
  isDashboardRequest,
  selectDashboardTemplates,
  buildDashboardTemplatePromptContext,
};
