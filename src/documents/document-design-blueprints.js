const BLUEPRINTS = {
  document: {
    id: 'document',
    label: 'high-signal document',
    goal: 'Turn the request into a polished document with a clear beginning, middle, and end.',
    narrative: 'Orient the reader quickly, develop the core material with real substance, then close with the decision, takeaway, or next move.',
    requiredElements: [
      'Strong title and optional subtitle',
      'Scannable section hierarchy with concrete headings',
      'Substantive prose rather than placeholders or meta-commentary',
    ],
    structurePatterns: [
      'Use paragraphs for explanation and bullets only for scan speed',
      'Use callouts for decisions, warnings, or standout insights',
      'Use stats, tables, and charts only when they materially improve comprehension',
    ],
    avoid: [
      'generic filler',
      'placeholder text',
      'repeating the prompt back to the user',
    ],
  },
  report: {
    id: 'report',
    label: 'evidence-led report',
    goal: 'Produce an executive-readable report that balances narrative explanation with visible evidence.',
    narrative: 'Lead with the takeaway, show the supporting evidence, then end with recommendations and next steps.',
    requiredElements: [
      'Executive summary',
      'Current state or findings section',
      'Evidence section using metrics, tables, or chart data when available',
      'Recommendations and next steps',
    ],
    structurePatterns: [
      'Front-load the most decision-relevant insight',
      'Use tables for comparisons and charts for explicit numeric trends',
      'Keep each section focused on one analytical question',
    ],
    avoid: [
      'burying the conclusion at the end',
      'invented metrics',
      'dense walls of text without visual relief',
    ],
  },
  proposal: {
    id: 'proposal',
    label: 'persuasive proposal',
    goal: 'Make the recommendation feel credible, concrete, and easy to approve.',
    narrative: 'Frame the problem, explain the proposed approach, show the value, then make the ask explicit.',
    requiredElements: [
      'Problem or opportunity framing',
      'Recommended approach',
      'Expected value or outcomes',
      'Timeline, scope, or next-step ask',
    ],
    structurePatterns: [
      'Use clear outcome language instead of vague aspiration',
      'Present tradeoffs and risks without weakening the recommendation',
      'Make the final call to action explicit',
    ],
    avoid: [
      'sales fluff',
      'unbounded scope',
      'unclear ownership',
    ],
  },
  memo: {
    id: 'memo',
    label: 'decision memo',
    goal: 'Deliver a short, crisp internal memo that lets a busy reader understand the issue immediately.',
    narrative: 'Open with the purpose, summarize the facts, and close with the decision or requested action.',
    requiredElements: [
      'Purpose',
      'Key facts',
      'Decision, recommendation, or ask',
    ],
    structurePatterns: [
      'Prefer tight sections and short paragraphs',
      'Use bullets for discrete facts or action items',
      'Keep tone direct and operational',
    ],
    avoid: [
      'ornamental intros',
      'unnecessary background',
      'marketing-style language',
    ],
  },
  letter: {
    id: 'letter',
    label: 'formal letter',
    goal: 'Produce polished correspondence that sounds human, specific, and complete.',
    narrative: 'Open courteously, make the purpose clear, provide the needed detail, and close with a clear tone.',
    requiredElements: [
      'Clear opening purpose',
      'Specific supporting details',
      'Professional closing',
    ],
    structurePatterns: [
      'Keep paragraphs compact and purposeful',
      'Use plain language over legalistic filler unless the context demands formality',
      'Match the requested tone without losing clarity',
    ],
    avoid: [
      'stiff boilerplate',
      'vague requests',
      'generic courtesy padding',
    ],
  },
  'executive-brief': {
    id: 'executive-brief',
    label: 'executive brief',
    goal: 'Package a complex situation into a fast, board-ready brief with obvious decisions and implications.',
    narrative: 'Start with the headline, quantify the situation, clarify the recommendation, and surface the risks.',
    requiredElements: [
      'Headline summary',
      'Key metrics or signals',
      'Recommendation',
      'Risks and next steps',
    ],
    structurePatterns: [
      'Make every section skimmable in under 20 seconds',
      'Use stats and callouts heavily where they sharpen the story',
      'Write for senior readers who need signal more than background',
    ],
    avoid: [
      'long narrative warmups',
      'technical digressions',
      'ambiguous recommendations',
    ],
  },
  'data-story': {
    id: 'data-story',
    label: 'data story',
    goal: 'Turn raw numbers into a narrative with clear trends, comparisons, and implications.',
    narrative: 'Show what changed, why it matters, what is driving it, and what should happen next.',
    requiredElements: [
      'Topline insight',
      'Chart-ready trend or comparison section with explicit series values',
      'Interpretation of the numbers',
      'Recommended action',
    ],
    structurePatterns: [
      'Use charts only with concrete numeric series',
      'Give every chart a takeaway sentence',
      'Pair numbers with interpretation instead of listing metrics without context',
    ],
    avoid: [
      'metrics without interpretation',
      'charts with missing values',
      'fake precision',
    ],
  },
  presentation: {
    id: 'presentation',
    label: 'narrative presentation',
    goal: 'Create a presentation that moves slide by slide with visible pacing and a clear story arc.',
    narrative: 'Hook the audience, build understanding, provide proof, and land on the decision or takeaway.',
    requiredElements: [
      'Title slide',
      'Logical story progression',
      'One dominant idea per slide',
      'Strong final takeaway or next step',
    ],
    structurePatterns: [
      'Use title, section, content, image, two-column, and chart layouts intentionally',
      'Keep bullets short and slide-ready',
      'Prefer visual rhythm over memo-like text density',
    ],
    avoid: [
      'memo paragraphs broken into slides',
      'more than one core message per slide',
      'charts without interpretation',
    ],
  },
  'pitch-deck': {
    id: 'pitch-deck',
    label: 'fundable pitch deck',
    goal: 'Build an investor-style story that feels sharp, credible, and momentum-driven.',
    narrative: 'Move from problem to solution to proof to growth path to ask.',
    requiredElements: [
      'Problem or market tension',
      'Solution and product view',
      'Proof, traction, or validation',
      'Business model or go-to-market',
      'Roadmap, team, or explicit ask',
    ],
    structurePatterns: [
      'Use section slides to reset the story at major turns',
      'Use stats and charts for traction, market, and economics',
      'Make every slide investor-readable in a glance',
    ],
    avoid: [
      'feature dumping',
      'weak proof',
      'ending without an ask',
    ],
  },
  'website-slides': {
    id: 'website-slides',
    label: 'website slide deck',
    goal: 'Create cinematic web-style slides that feel like a premium landing page broken into narrative scenes.',
    narrative: 'Open with a striking promise, introduce tension, show proof, reveal the product or concept, then close with a strong CTA.',
    requiredElements: [
      'Hero slide with a bold opening claim',
      'Proof or credibility section',
      'Product, feature, or concept reveal',
      'Closing call to action or takeaway',
    ],
    structurePatterns: [
      'Each slide should behave like a strong website section with one dominant visual idea',
      'Use shorter copy, stronger contrast, and more image or stat support than a standard deck',
      'Favor image, section, chart, and two-column layouts over text-heavy slides',
    ],
    avoid: [
      'document-style paragraphs',
      'generic stock-marketing copy',
      'slides with no visual point of view',
    ],
  },
  'research-note': {
    id: 'research-note',
    label: 'research note',
    goal: 'Summarize findings quickly with clear evidence boundaries and actionable interpretation.',
    narrative: 'State the question, collect evidence, show interpretation, and close with a practical next step.',
    outputIntent: 'research',
    requiredElements: [
      'Question or problem framing',
      'Evidence source list or data origin',
      'Findings and interpretation',
      'Assumptions and caveats',
      'Citations or source references',
    ],
    sectionArchetypes: ['question', 'evidence', 'analysis', 'assumptions', 'action'],
    structurePatterns: [
      'Open with one clear research question and what success looks like',
      'Show findings before recommendations so claims are traceable',
      'Use source-backed bullet points and an explicit caveats block',
      'Close with a short action list and ownership',
    ],
    styleConstraints: {
      minSpacingScale: 1.15,
      tableDensity: 'compact',
      citationStyle: 'inline-bullets',
      enforceAssumptionsBlock: true,
    },
    preferredLayouts: ['briefing-grid', 'casefile-panels', 'editorial-rhythm'],
    suitableCreativeProfiles: ['signal-journal', 'editorial-feature'],
    avoid: [
      'claiming without evidence',
      'vague source references',
      'equivocal recommendations with no follow-up',
    ],
  },
  'research-methodology': {
    id: 'research-methodology',
    label: 'research methodology',
    goal: 'Create a method-driven research artifact with explicit design choices and reproducible steps.',
    narrative: 'Anchor on hypothesis, methods, data, analysis logic, and reproducibility constraints.',
    outputIntent: 'research',
    requiredElements: [
      'Research objective and hypothesis',
      'Method design and inclusion criteria',
      'Data collection or review protocol',
      'Analysis approach',
      'Risks, limits, and validation notes',
    ],
    sectionArchetypes: ['scope', 'method', 'sampling', 'analysis', 'validation', 'next-iteration'],
    structurePatterns: [
      'Define scope first to reduce false precision',
      'Describe methods before presenting outcomes',
      'Use numbered methodological steps for reproducibility',
      'Use assumptions and validation sections as first-class content',
    ],
    styleConstraints: {
      minSpacingScale: 1.1,
      headingLadder: ['Level 1', 'Level 2', 'Level 3'],
      enforceCitations: true,
    },
    preferredLayouts: ['field-guide-rail', 'editorial-rhythm', 'briefing-grid'],
    suitableCreativeProfiles: ['field-guide', 'signal-journal'],
    avoid: [
      'method claims not grounded in the protocol',
      'statistics without calculation context',
      'jumping to recommendations before documenting limits',
    ],
  },
  'research-literature': {
    id: 'research-literature',
    label: 'research literature brief',
    goal: 'Synthesize prior work with a clear distinction between what is known, uncertain, and promising.',
    narrative: 'Build evidence hierarchy, compare positions, and surface implications for action.',
    outputIntent: 'research',
    requiredElements: [
      'Question framing and inclusion criteria',
      'Literature map or theme clusters',
      'Comparison of viewpoints and methods',
      'Gaps and uncertainty',
      'Practical recommendations',
    ],
    sectionArchetypes: ['search-scope', 'evidence-map', 'comparison', 'gaps', 'recommendations'],
    structurePatterns: [
      'Map source families before comparing claims',
      'Prefer contradiction and convergence notes over flat summaries',
      'Separate established findings from hypotheses',
      'End with direct implications and next reading tasks',
    ],
    styleConstraints: {
      minSpacingScale: 1.2,
      citationStyle: 'annotated-blocks',
      enforceCitations: true,
      tableDensity: 'spacious',
    },
    preferredLayouts: ['casefile-panels', 'briefing-grid', 'editorial-rhythm'],
    suitableCreativeProfiles: ['studio-casefile', 'signal-journal'],
    avoid: [
      'bibliography without interpretation',
      'undifferentiated source lists',
      'equating weak findings with established ones',
    ],
  },
  'research-brief': {
    id: 'research-brief',
    label: 'research brief',
    goal: 'Deliver a concise research summary that is immediately usable by execution teams.',
    narrative: 'Condense key research takeaways, supporting evidence, and the likely risks of acting on them.',
    outputIntent: 'research',
    requiredElements: [
      'Audience and objective',
      'Top 3 findings with evidence',
      'Impact estimate',
      'Risk and assumption block',
      'Decision recommendation',
    ],
    sectionArchetypes: ['audience', 'findings', 'impact', 'risks', 'recommendation'],
    structurePatterns: [
      'Use the shortest possible synthesis path',
      'Lead with what changed and why',
      'Show evidence quality per finding',
      'Convert findings into clear decision language',
    ],
    styleConstraints: {
      minSpacingScale: 1.08,
      headingLadder: ['Summary', 'Evidence', 'Implication', 'Recommendation'],
      enforceCitations: true,
      kpiCards: true,
    },
    preferredLayouts: ['briefing-grid', 'editorial-rhythm'],
    suitableCreativeProfiles: ['boardroom-brief', 'signal-journal'],
    avoid: [
      'overlong narrative',
      'low-confidence claims presented as certain',
      'missing ownership or next-step clarity',
    ],
  },
  'html-dashboard-kpi': {
    id: 'html-dashboard-kpi',
    label: 'HTML KPI dashboard',
    goal: 'Create a scannable KPI-style HTML document with high signal density and quick comparison patterns.',
    narrative: 'Prioritize top metrics, trend signals, and immediate actions in a responsive block structure.',
    outputIntent: 'dashboard',
    requiredElements: [
      'Key metric cards with current and trend labels',
      'Comparative baselines',
      'Status highlights',
      'Short operational callouts',
      'Action queue',
    ],
    sectionArchetypes: ['hero', 'kpi-overview', 'trend-strip', 'alerts', 'action-queue'],
    structurePatterns: [
      'Lead with most critical KPI panel',
      'Use compact cards and readable spacing',
      'Separate stable values from exceptions',
      'Keep trend notes beside source tables',
    ],
    styleConstraints: {
      spacingScale: 1.05,
      kpiCardStyle: 'compact',
      tableDensity: 'compact',
      responsiveContainer: true,
    },
    preferredLayouts: ['dashboard-kpi-grid', 'briefing-grid', 'field-guide-rail'],
    suitableCreativeProfiles: ['systems-minimal', 'campaign-sprint'],
    avoid: [
      'non-metric copy dominating critical status',
      'unlabeled charts',
      'dense paragraph blocks instead of cards',
    ],
  },
  'html-dashboard-operational': {
    id: 'html-dashboard-operational',
    label: 'HTML operational dashboard',
    goal: 'Build an operational dashboard layout for runbooks, queue health, and team actions.',
    narrative: 'Surface operations, risks, and owners in a web-friendly structure with clear visual hierarchy.',
    outputIntent: 'dashboard',
    requiredElements: [
      'Service or team status',
      'Task or queue health',
      'Incident or blocker callouts',
      'Owners and next checks',
      'SLA visibility metrics',
    ],
    sectionArchetypes: ['operations-summary', 'queue-status', 'issues', 'team-actions', 'follow-up'],
    structurePatterns: [
      'Use status sections in priority order',
      'Pair each blocker with owner and remediation window',
      'Use tables only where they reduce cognitive load',
      'Keep callouts short and time-bound',
    ],
    styleConstraints: {
      spacingScale: 1.08,
      tableDensity: 'compact',
      kpiCardStyle: 'operational',
      responsiveContainer: true,
    },
    preferredLayouts: ['dashboard-kpi-grid', 'field-guide-rail', 'chapter-bands'],
    suitableCreativeProfiles: ['systems-minimal', 'editorial-feature'],
    avoid: [
      'wall-of-text incident logs',
      'unclear ownership labeling',
      'undated action items',
    ],
  },
  'html-dashboard-funnel': {
    id: 'html-dashboard-funnel',
    label: 'HTML funnel dashboard',
    goal: 'Visualize conversion stages and conversion loss points with readable flow summaries.',
    narrative: 'Walk through stage counts, drop-off factors, and prioritized experiment ideas.',
    outputIntent: 'dashboard',
    requiredElements: [
      'Stage definitions and sample size',
      'Step-level funnel counts and rates',
      'Drop-off analysis',
      'Best-effort explanations',
      'Prioritized optimization actions',
    ],
    sectionArchetypes: ['overview', 'funnel-flow', 'dropoffs', 'interpretation', 'next-actions'],
    structurePatterns: [
      'Use stage ordering as layout spine',
      'Keep percentage and volume together',
      'Call out highest leverage drop points first',
      'Attach actions directly to data points',
    ],
    styleConstraints: {
      spacingScale: 1.07,
      tableDensity: 'compact',
      chartDensity: 'high',
      kpiCardStyle: 'flow',
      responsiveContainer: true,
    },
    preferredLayouts: ['dashboard-funnel', 'dashboard-kpi-grid', 'briefing-grid'],
    suitableCreativeProfiles: ['analyst-briefing', 'editorial-feature'],
    avoid: [
      'chart labels without units',
      'stage names without definitions',
      'action lists detached from metrics',
    ],
  },
  'html-article': {
    id: 'html-article',
    label: 'HTML article',
    goal: 'Produce a polished web-first article with strong opening, readable sections, and visual support.',
    narrative: 'Move from hook to analysis to takeaway with web-optimized paragraph pacing.',
    outputIntent: 'html',
    requiredElements: [
      'Compelling headline and sub-headline',
      'Sectioned body copy with transitions',
      'Illustrative cards, callouts, or tables',
      'Conclusion and follow-up call-to-action',
    ],
    sectionArchetypes: ['headline', 'thesis', 'support', 'visual-block', 'takeaway'],
    structurePatterns: [
      'Write for scanning with short section headers',
      'Place key claims near evidence blocks',
      'Use visual rhythm to break long narratives',
      'Close with crisp next step or contact signal',
    ],
    styleConstraints: {
      spacingScale: 1.2,
      headingLadder: ['H1', 'H2', 'H3'],
      paragraphSpacing: 'generous',
      responsiveContainer: true,
    },
    preferredLayouts: ['editorial-rhythm', 'chapter-bands', 'field-guide-rail'],
    suitableCreativeProfiles: ['editorial-feature', 'launch-manifesto'],
    avoid: [
      'SEO-like keyword stuffing',
      'flat copy with weak section separation',
      'copy-heavy pages with no visual rhythm',
    ],
  },
  'html-product-page': {
    id: 'html-product-page',
    label: 'HTML product page',
    goal: 'Create conversion-oriented product content with clear value blocks and trust signals.',
    narrative: 'Lead with proposition, then proof and outcomes with short persuasive hierarchy.',
    outputIntent: 'html',
    requiredElements: [
      'Value proposition',
      'Feature or benefit blocks',
      'Proof artifacts (metrics, quotes, case snippets)',
      'FAQ or objections section',
      'Primary CTA and supporting steps',
    ],
    sectionArchetypes: ['hero', 'value-proposition', 'proof', 'features', 'social-proof', 'cta'],
    structurePatterns: [
      'Lead with audience-specific benefit statement',
      'Use card-based blocks for feature proof',
      'Keep CTA visible and repeated at key transitions',
      'Use short copy that reads quickly on mobile',
    ],
    styleConstraints: {
      spacingScale: 1.1,
      kpiCardStyle: 'feature',
      responsiveContainer: true,
      tableDensity: 'moderate',
    },
    preferredLayouts: ['chapter-bands', 'editorial-rhythm', 'casefile-panels'],
    suitableCreativeProfiles: ['studio-casefile', 'campaign-sprint'],
    avoid: [
      'generic feature catalog without proof',
      'unclear target audience',
      'CTA buried beneath explanation blocks',
    ],
  },
  'html-technical-spec': {
    id: 'html-technical-spec',
    label: 'HTML technical specification',
    goal: 'Publish a technical spec document that remains highly navigable and implementation-ready.',
    narrative: 'State interfaces, constraints, data assumptions, and risks in a browser-rendered format.',
    outputIntent: 'html',
    requiredElements: [
      'Purpose and scope',
      'Requirements and constraints',
      'API or interface section',
      'Data model or behavior tables',
      'Risks and validation plan',
    ],
    sectionArchetypes: ['scope', 'requirements', 'interfaces', 'behavior', 'risks', 'validation'],
    structurePatterns: [
      'Treat technical facts as primary, narrative as secondary',
      'Use tables for interfaces and behavior matrices',
      'Show dependencies and edge cases explicitly',
      'End with verification and acceptance criteria',
    ],
    styleConstraints: {
      spacingScale: 1.0,
      headingLadder: ['H1', 'H2', 'H3', 'H4'],
      tableDensity: 'dense',
      paragraphSpacing: 'compact',
      responsiveContainer: true,
    },
    preferredLayouts: ['field-guide-rail', 'casefile-panels', 'briefing-grid'],
    suitableCreativeProfiles: ['field-guide', 'systems-minimal'],
    avoid: [
      'implicit assumptions',
      'untyped requirements',
      'missing validation acceptance criteria',
    ],
  },
  'pdf-whitepaper': {
    id: 'pdf-whitepaper',
    label: 'PDF whitepaper',
    goal: 'Create a publication-grade PDF whitepaper with argument arc, evidence, and executive summary.',
    narrative: 'Lead with thesis, support with rigorous evidence sections, and end with clear implications.',
    outputIntent: 'pdf',
    requiredElements: [
      'Executive summary',
      'Research and industry context',
      'Method and evidence sections',
      'Implications and recommendations',
      'Appendix-style references',
    ],
    sectionArchetypes: ['executive-summary', 'context', 'evidence', 'analysis', 'recommendations', 'appendix'],
    structurePatterns: [
      'Follow an argument arc with checkpoints',
      'Separate claim, evidence, and implication',
      'Use callouts for key claims and assumptions',
      'Finish with print-safe references and next actions',
    ],
    styleConstraints: {
      spacingScale: 1.25,
      headingLadder: ['H1', 'H2', 'H3', 'H4'],
      tableDensity: 'spacious',
      printFriendly: true,
      pageDensity: 'balanced',
    },
    preferredLayouts: ['casefile-panels', 'briefing-grid', 'editorial-rhythm'],
    suitableCreativeProfiles: ['boardroom-brief', 'signal-journal'],
    avoid: [
      'lightweight note style unsuitable for publication',
      'missing reference trail',
      'unjustified recommendations',
    ],
  },
  'pdf-audit-report': {
    id: 'pdf-audit-report',
    label: 'PDF audit report',
    goal: 'Produce a control-focused audit artifact with explicit findings, evidence, and remediation.',
    narrative: 'Findings first, severity ladder, evidence attachments, and practical remediation plan.',
    outputIntent: 'pdf',
    requiredElements: [
      'Executive summary',
      'Scope and criteria',
      'Finding list with severity',
      'Evidence evidence table',
      'Remediation owners and timeline',
    ],
    sectionArchetypes: ['summary', 'scope', 'method', 'findings', 'risk', 'remediation'],
    structurePatterns: [
      'Open with risk severity and materiality',
      'Use tables for findings and proof',
      'Pair each finding with owner and target date',
      'Separate observations from recommendations',
    ],
    styleConstraints: {
      spacingScale: 1.18,
      tableDensity: 'dense',
      headingLadder: ['H1', 'H2', 'H3'],
      printFriendly: true,
    },
    preferredLayouts: ['briefing-grid', 'casefile-panels', 'field-guide-rail'],
    suitableCreativeProfiles: ['boardroom-brief', 'analyst-briefing'],
    avoid: [
      'soft recommendations without evidence',
      'missing severity tags',
      'unowned remediation recommendations',
    ],
  },
  'pdf-executive-brief': {
    id: 'pdf-executive-brief',
    label: 'PDF executive brief',
    goal: 'Deliver a decision-ready executive PDF with concise context and clear action request.',
    narrative: 'Use board-level brevity to compress complexity into explicit recommendations and tradeoffs.',
    outputIntent: 'pdf',
    requiredElements: [
      'Decision statement',
      'Top risks and constraints',
      'Supporting signals and evidence',
      'Alternative paths',
      'Recommendation and owner',
    ],
    sectionArchetypes: ['decision', 'key-metrics', 'risks', 'alternatives', 'decision-request'],
    structurePatterns: [
      'Put recommendation at top',
      'Use compact evidence blocks for each claim',
      'Keep alternative options constrained and comparable',
      'End with explicit decision owner and deadline',
    ],
    styleConstraints: {
      spacingScale: 1.16,
      headingLadder: ['H1', 'H2', 'H3'],
      printFriendly: true,
      tableDensity: 'moderate',
    },
    preferredLayouts: ['briefing-grid', 'editorial-rhythm', 'chapter-bands'],
    suitableCreativeProfiles: ['boardroom-brief', 'signal-journal'],
    avoid: [
      'open-ended exploratory prose',
      'missing tradeoff comparison',
      'vague owner assignments',
    ],
  },
};

const TYPE_ALIASES = {
  brief: 'executive-brief',
  'executive brief': 'executive-brief',
  'board brief': 'executive-brief',
  'board update': 'executive-brief',
  'data story': 'data-story',
  'data-story-report': 'data-story',
  'analytics report': 'data-story',
  'pitch deck': 'pitch-deck',
  pitch: 'pitch-deck',
  deck: 'presentation',
  slides: 'presentation',
  'website slides': 'website-slides',
  'web slides': 'website-slides',
  'slide deck': 'presentation',
  research: 'research-note',
  'research note': 'research-note',
  'research-note': 'research-note',
  'research methodology': 'research-methodology',
  'research-methodology': 'research-methodology',
  methodology: 'research-methodology',
  'research literature': 'research-literature',
  'literature review': 'research-literature',
  'research brief': 'research-brief',
  'html dashboard': 'html-dashboard-kpi',
  'kpi dashboard': 'html-dashboard-kpi',
  'operational dashboard': 'html-dashboard-operational',
  'funnel dashboard': 'html-dashboard-funnel',
  dashboard: 'html-dashboard-kpi',
  'html article': 'html-article',
  article: 'html-article',
  'product page': 'html-product-page',
  'html product page': 'html-product-page',
  'technical spec': 'html-technical-spec',
  'technical specification': 'html-technical-spec',
  whitepaper: 'pdf-whitepaper',
  'pdf whitepaper': 'pdf-whitepaper',
  'audit report': 'pdf-audit-report',
  'pdf audit': 'pdf-audit-report',
  'pdf executive brief': 'pdf-executive-brief',
  'executive pdf brief': 'pdf-executive-brief',
};

function normalizeDocumentType(documentType = '') {
  const normalized = String(documentType || '').trim().toLowerCase().replace(/[_]+/g, '-');
  if (!normalized) {
    return 'document';
  }

  if (BLUEPRINTS[normalized]) {
    return normalized;
  }

  if (TYPE_ALIASES[normalized]) {
    return TYPE_ALIASES[normalized];
  }

  if (/(website|landing)/.test(normalized) && /(slides|deck|presentation)/.test(normalized)) {
    return 'website-slides';
  }

  if (/(pitch|investor)/.test(normalized) && /(deck|slides|presentation)/.test(normalized)) {
    return 'pitch-deck';
  }

  if (/(report|analysis|analytics|insight)/.test(normalized)) {
    return 'report';
  }

  if (/(presentation|slides|deck)/.test(normalized)) {
    return 'presentation';
  }

  return normalized;
}

function resolveDocumentBlueprint(documentType = '') {
  const normalizedType = normalizeDocumentType(documentType);
  return BLUEPRINTS[normalizedType] || BLUEPRINTS.document;
}

function renderBlueprintPrompt(blueprint = BLUEPRINTS.document) {
  const lines = [
    `<design_blueprint id="${blueprint.id}">`,
    `  <goal>${blueprint.goal}</goal>`,
    `  <narrative_arc>${blueprint.narrative}</narrative_arc>`,
    '  <required_elements>',
    ...blueprint.requiredElements.map((entry) => `    - ${entry}`),
    '  </required_elements>',
    '  <structure_patterns>',
    ...blueprint.structurePatterns.map((entry) => `    - ${entry}`),
    '  </structure_patterns>',
    '  <avoid>',
    ...blueprint.avoid.map((entry) => `    - ${entry}`),
    '  </avoid>',
    '</design_blueprint>',
  ];

  return lines.join('\n');
}

module.exports = {
  BLUEPRINTS,
  normalizeDocumentType,
  resolveDocumentBlueprint,
  renderBlueprintPrompt,
};
