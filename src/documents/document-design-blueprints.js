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
