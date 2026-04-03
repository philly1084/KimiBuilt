const { normalizeWhitespace, stripHtml } = require('../utils/text');
const {
  normalizeDocumentType,
  resolveDocumentBlueprint,
} = require('./document-design-blueprints');

const CREATIVE_DIRECTIONS = {
  'editorial-feature': {
    id: 'editorial-feature',
    label: 'Editorial Feature',
    preferredTheme: 'editorial',
    rationale: 'Use a magazine-like story arc with contrast between bold framing and quieter evidence sections.',
    voice: [
      'Open with a point of view instead of a generic scene-setter.',
      'Vary sentence length so the prose does not feel machine-even.',
      'Write like an experienced human editor, not a placeholder generator.',
    ],
    layout: [
      'Use a strong hero band and numbered section rhythm.',
      'Alternate denser evidence blocks with lighter narrative spacing.',
      'Let captions, callouts, or side notes break the page cadence intentionally.',
    ],
    humanFeel: [
      'Allow one or two sharply observed lines that feel written for this exact request.',
      'Avoid identical section shapes and repeated transitions.',
      'Use specific nouns and verbs instead of safe corporate abstractions.',
    ],
  },
  'boardroom-brief': {
    id: 'boardroom-brief',
    label: 'Boardroom Brief',
    preferredTheme: 'executive',
    rationale: 'Keep the document decisive, skimmable, and visibly optimized for fast leadership reading.',
    voice: [
      'Lead with the answer before the background.',
      'Prefer crisp declarative language over rhetorical buildup.',
      'Keep the prose controlled without sounding sterile.',
    ],
    layout: [
      'Use signal cards, compact sections, and visible recommendations.',
      'Treat metrics and callouts as first-class design elements.',
      'Make the closing action or decision impossible to miss.',
    ],
    humanFeel: [
      'Use sentence fragments sparingly for emphasis where a busy executive would appreciate them.',
      'Remove boilerplate transitions and generic throat-clearing.',
      'Let recommendation language feel accountable and owned.',
    ],
  },
  'studio-casefile': {
    id: 'studio-casefile',
    label: 'Studio Casefile',
    preferredTheme: 'product',
    rationale: 'Treat the document like a crafted case study with process, texture, and visible creative judgment.',
    voice: [
      'Sound confident, tactile, and close to the work.',
      'Use concrete descriptions instead of abstract praise.',
      'Balance polished explanation with maker-level specificity.',
    ],
    layout: [
      'Use reveal-style sections with evidence, details, and contrast blocks.',
      'Make visuals or proof feel embedded in the story rather than appended.',
      'Use section intros that feel like scene changes, not template labels.',
    ],
    humanFeel: [
      'Let the document acknowledge tradeoffs and tension where useful.',
      'Use memorable phrasing in headers and subheads.',
      'Avoid the tone of a default SaaS brochure.',
    ],
  },
  'field-guide': {
    id: 'field-guide',
    label: 'Field Guide',
    preferredTheme: 'editorial',
    rationale: 'Turn the document into a practical guide with clear wayfinding, grounded advice, and deliberate structure.',
    voice: [
      'Sound knowledgeable and grounded, not promotional.',
      'Keep instructions precise and humane.',
      'Use short contextual pivots so each section feels hand-led.',
    ],
    layout: [
      'Use guideposts, checkpoints, and scan-friendly section framing.',
      'Keep the flow practical, with occasional decision callouts.',
      'Favor clarity and trust over decorative excess.',
    ],
    humanFeel: [
      'Write as if you have seen real teams use the advice.',
      'Use direct phrases that acknowledge real constraints.',
      'Do not let every section resolve into the same paragraph shape.',
    ],
  },
  'signal-journal': {
    id: 'signal-journal',
    label: 'Signal Journal',
    preferredTheme: 'executive',
    rationale: 'Shape the document like a thoughtful analysis journal with visible insights, patterns, and implications.',
    voice: [
      'Interpret the evidence instead of merely listing it.',
      'Use clean analytical language with occasional sharp takeaways.',
      'Keep the writing smart and composed, not dry.',
    ],
    layout: [
      'Use takeaway-led sections with evidence underneath.',
      'Let charts, tables, and metrics feel integrated into the narrative.',
      'Use summary pullouts to create rhythm between heavier sections.',
    ],
    humanFeel: [
      'Translate numbers into implications a person would actually say out loud.',
      'Avoid robotic repetition of metric labels or transition phrases.',
      'Let the analysis show judgment, not just formatting.',
    ],
  },
  'launch-manifesto': {
    id: 'launch-manifesto',
    label: 'Launch Manifesto',
    preferredTheme: 'bold',
    rationale: 'Give the document a high-conviction launch tone with strong pacing, contrast, and memorable section turns.',
    voice: [
      'Use direct, elevated language with confident momentum.',
      'Keep the copy tight and image-aware.',
      'Sound deliberate and composed rather than hype-driven.',
    ],
    layout: [
      'Open with a strong thesis section and keep the visual hierarchy assertive.',
      'Use shorter paragraphs, section resets, and bold closeouts.',
      'Favor contrast and clear reveal moments over uniform blocks.',
    ],
    humanFeel: [
      'Allow selective flourish without losing substance.',
      'Avoid stock launch adjectives and generic inspiration talk.',
      'Make the closing feel chosen, not auto-generated.',
    ],
  },
};

const BLUEPRINT_DIRECTION_MAP = {
  document: ['editorial-feature', 'field-guide', 'studio-casefile'],
  report: ['signal-journal', 'boardroom-brief', 'editorial-feature'],
  proposal: ['studio-casefile', 'editorial-feature', 'boardroom-brief'],
  memo: ['boardroom-brief', 'field-guide'],
  letter: ['editorial-feature', 'field-guide'],
  'executive-brief': ['boardroom-brief', 'signal-journal'],
  'data-story': ['signal-journal', 'editorial-feature'],
  presentation: ['launch-manifesto', 'studio-casefile', 'editorial-feature'],
  'pitch-deck': ['launch-manifesto', 'studio-casefile'],
  'website-slides': ['launch-manifesto', 'editorial-feature', 'studio-casefile'],
};

const GENERIC_ANCHORS = new Set([
  'overview',
  'introduction',
  'details',
  'summary',
  'conclusion',
  'next steps',
  'recommendation',
  'recommendations',
  'implementation',
  'analysis',
  'background',
  'purpose',
]);

function hashString(value = '') {
  let hash = 2166136261;
  const normalized = String(value || '');
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function toPlainText(value = '') {
  const source = String(value || '');
  if (!source.trim()) {
    return '';
  }

  const plain = /<[a-z][\s\S]*>/i.test(source)
    ? stripHtml(source)
    : source;

  return normalizeWhitespace(plain).replace(/\s+/g, ' ').trim();
}

function summarizeLine(value = '', limit = 160) {
  const normalized = toPlainText(value);
  if (!normalized) {
    return '';
  }
  return normalized.length > limit
    ? `${normalized.slice(0, limit - 3)}...`
    : normalized;
}

function extractTemplateAnchors(existingContent = '') {
  const raw = String(existingContent || '');
  if (!raw.trim()) {
    return [];
  }

  const anchors = [];
  const seen = new Set();
  const pushAnchor = (value) => {
    const normalized = summarizeLine(value, 60)
      .replace(/^[-*#\d.\s]+/, '')
      .trim();
    const key = normalized.toLowerCase();
    if (!normalized || normalized.length < 3 || seen.has(key)) {
      return;
    }
    seen.add(key);
    anchors.push(normalized);
  };

  for (const match of raw.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    pushAnchor(stripHtml(match[1]));
  }

  for (const match of raw.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gm)) {
    pushAnchor(match[1]);
  }

  for (const match of raw.matchAll(/^\s*([A-Z][A-Za-z0-9/&,\- ]{2,50}):\s*$/gm)) {
    pushAnchor(match[1]);
  }

  const plain = toPlainText(raw);
  plain.split(/\s{2,}|\.\s+/).slice(0, 10).forEach((chunk) => {
    if (/^[A-Z][A-Za-z0-9/&,\- ]{2,40}$/.test(chunk)) {
      pushAnchor(chunk);
    }
  });

  return anchors.slice(0, 8);
}

function analyzeTemplateSignals(existingContent = '') {
  const raw = String(existingContent || '');
  const plain = toPlainText(raw);
  const anchors = extractTemplateAnchors(raw);
  const placeholders = Array.from(new Set(
    (raw.match(/\{\{[^}]+\}\}/g) || [])
      .map((entry) => entry.replace(/[{}]/g, '').trim())
      .filter(Boolean),
  )).slice(0, 8);
  const genericAnchors = anchors.filter((anchor) => GENERIC_ANCHORS.has(anchor.toLowerCase()));
  const cueCount = [
    /\blorem ipsum\b/i,
    /\bplaceholder\b/i,
    /\byour company\b/i,
    /\byour name\b/i,
    /\bexample\b/i,
    /\bsample\b/i,
    /\btemplate\b/i,
    /\bcompany name\b/i,
  ].reduce((count, pattern) => count + (pattern.test(raw) ? 1 : 0), 0);

  const hasTemplateScaffold = placeholders.length > 0
    || cueCount > 0
    || genericAnchors.length >= 2
    || (/\"placeholder\"\s*:/i.test(raw))
    || (/\"default\"\s*:/i.test(raw))
    || (/itemFields/i.test(raw));

  const guidance = hasTemplateScaffold
    ? [
      'Treat the provided template, defaults, and sample text as scaffolding, not final copy.',
      anchors.length > 0 ? `Do not simply recycle the sample section labels: ${anchors.join(', ')}.` : 'Replace generic sample section names with request-specific language.',
      placeholders.length > 0 ? `Do not echo placeholder tokens such as ${placeholders.join(', ')} into the final output.` : 'Do not preserve placeholder language or tutorial-style instructions.',
      'Keep the useful structure, but write fresh content shaped by the current request and continuity context.',
    ]
    : [
      'Use any existing content as context, but still give the document a fresh point of view and structure.',
    ];

  return {
    hasTemplateScaffold,
    anchors,
    placeholders,
    genericAnchors,
    samplePreview: summarizeLine(plain, 180),
    guidance,
  };
}

function resolveCreativeDirectionId(direction = '') {
  const normalized = String(direction || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (CREATIVE_DIRECTIONS[normalized]) {
    return normalized;
  }

  const match = Object.values(CREATIVE_DIRECTIONS).find((entry) => (
    entry.id === normalized || entry.label.toLowerCase() === normalized
  ));

  return match?.id || '';
}

function summarizeContinuity(session = null) {
  const memory = session?.metadata?.projectMemory || {};
  const recentArtifactEntries = Array.isArray(memory.artifacts)
    ? memory.artifacts.slice(-4)
    : [];
  const recentTasks = Array.isArray(memory.tasks)
    ? memory.tasks.slice(-4).map((task) => summarizeLine(task.summary || '', 140)).filter(Boolean)
    : [];
  const recentArtifacts = recentArtifactEntries
    .map((artifact) => {
      const filename = summarizeLine(artifact.filename || artifact.id || '', 72);
      const format = summarizeLine(artifact.format || '', 20);
      const direction = summarizeLine(artifact.creativeDirection || '', 40);
      const theme = summarizeLine(artifact.themeSuggestion || '', 24);
      const qualifiers = [format, direction, theme].filter(Boolean).join(', ');
      return filename ? `${filename}${qualifiers ? ` (${qualifiers})` : ''}` : '';
    })
    .filter(Boolean);
  const recentDirections = recentArtifactEntries
    .map((artifact) => {
      const directionId = resolveCreativeDirectionId(
        artifact.creativeDirectionId || artifact.creativeDirection || '',
      );
      if (!directionId) {
        return null;
      }

      const direction = CREATIVE_DIRECTIONS[directionId];
      return {
        id: directionId,
        label: direction?.label || summarizeLine(artifact.creativeDirection || directionId, 40),
        theme: summarizeLine(artifact.themeSuggestion || direction?.preferredTheme || '', 24),
      };
    })
    .filter(Boolean);
  const recentMessages = Array.isArray(session?.metadata?.recentMessages)
    ? session.metadata.recentMessages
      .slice(-6)
      .map((entry) => {
        const role = entry?.role === 'assistant' ? 'Assistant' : 'User';
        const content = summarizeLine(entry?.content || '', 150);
        return content ? `${role}: ${content}` : '';
      })
      .filter(Boolean)
    : [];

  return {
    recentTasks,
    recentArtifacts,
    recentDirections,
    recentDirectionIds: Array.from(new Set(recentDirections.map((entry) => entry.id).filter(Boolean))),
    recentMessages,
  };
}

function resolveDirectionCandidates(blueprintId = 'document', format = 'html') {
  const normalizedFormat = String(format || '').trim().toLowerCase();
  if (normalizedFormat === 'pptx') {
    return ['launch-manifesto', 'studio-casefile', 'editorial-feature'];
  }

  return BLUEPRINT_DIRECTION_MAP[blueprintId] || BLUEPRINT_DIRECTION_MAP.document;
}

function inferDocumentTypeFromPrompt(prompt = '') {
  const normalized = String(prompt || '').trim().toLowerCase();
  if (!normalized) {
    return 'document';
  }

  if (/\bwebsite\b[\s\S]{0,30}\b(slides|deck|storyboard|narrative)\b/.test(normalized)
    || /\b(slides|storyboard)\b[\s\S]{0,30}\bwebsite\b/.test(normalized)) {
    return 'website-slides';
  }

  if (/\b(pitch deck|investor deck|fundraising deck)\b/.test(normalized)) {
    return 'pitch-deck';
  }

  if (/\b(executive brief|board brief|board update)\b/.test(normalized)) {
    return 'executive-brief';
  }

  if (/\b(data story|analytics report|insight report)\b/.test(normalized)) {
    return 'data-story';
  }

  if (/\breport\b/.test(normalized)) {
    return 'report';
  }

  if (/\bproposal\b/.test(normalized)) {
    return 'proposal';
  }

  if (/\bmemo\b/.test(normalized)) {
    return 'memo';
  }

  if (/\bletter\b/.test(normalized)) {
    return 'letter';
  }

  if (/\b(presentation|slides|deck)\b/.test(normalized)) {
    return 'presentation';
  }

  return normalizeDocumentType(normalized);
}

function pickCreativeDirection({ prompt = '', documentType = 'document', format = 'html', existingContent = '', session = null } = {}) {
  const blueprint = resolveDocumentBlueprint(documentType);
  const sampleSignals = analyzeTemplateSignals(existingContent);
  const continuity = summarizeContinuity(session);
  const candidateIds = resolveDirectionCandidates(blueprint.id, format);
  const seed = [
    blueprint.id,
    format,
    prompt,
    sampleSignals.anchors.join('|'),
    continuity.recentTasks.join('|'),
  ].join('::');
  let selectedId = candidateIds[hashString(seed) % candidateIds.length];
  const mostRecentDirectionId = continuity.recentDirectionIds[continuity.recentDirectionIds.length - 1];

  if (candidateIds.length > 1 && mostRecentDirectionId && selectedId === mostRecentDirectionId) {
    const alternatives = candidateIds.filter((candidateId) => candidateId !== mostRecentDirectionId);
    if (alternatives.length > 0) {
      selectedId = alternatives[hashString(`${seed}::fresh-angle`) % alternatives.length];
    }
  }

  return CREATIVE_DIRECTIONS[selectedId] || CREATIVE_DIRECTIONS['editorial-feature'];
}

function buildDocumentCreativityPacket({
  prompt = '',
  documentType = 'document',
  format = 'html',
  existingContent = '',
  session = null,
} = {}) {
  const blueprint = resolveDocumentBlueprint(documentType || inferDocumentTypeFromPrompt(prompt));
  const sampleSignals = analyzeTemplateSignals(existingContent);
  const continuity = summarizeContinuity(session);
  const direction = pickCreativeDirection({
    prompt,
    documentType: blueprint.id,
    format,
    existingContent,
    session,
  });

  return {
    blueprint: {
      id: blueprint.id,
      label: blueprint.label,
      narrative: blueprint.narrative,
      goal: blueprint.goal,
    },
    direction,
    themeSuggestion: direction.preferredTheme,
    sampleSignals,
    continuity,
    humanizationNotes: direction.humanFeel.slice(0, 3),
  };
}

function renderCreativityPromptContext(packet = null) {
  if (!packet || typeof packet !== 'object') {
    return '';
  }

  const lines = [
    '<creative_direction>',
    `Blueprint: ${packet.blueprint?.label || 'document'}`,
    `Direction: ${packet.direction?.label || 'Editorial Feature'}`,
    packet.direction?.rationale ? `Rationale: ${packet.direction.rationale}` : null,
    'Voice cues:',
    ...(Array.isArray(packet.direction?.voice) ? packet.direction.voice.map((entry) => `- ${entry}`) : []),
    'Layout cues:',
    ...(Array.isArray(packet.direction?.layout) ? packet.direction.layout.map((entry) => `- ${entry}`) : []),
    'Human feel cues:',
    ...(Array.isArray(packet.humanizationNotes) ? packet.humanizationNotes.map((entry) => `- ${entry}`) : []),
    packet.themeSuggestion ? `Preferred theme: ${packet.themeSuggestion}` : null,
    '</creative_direction>',
  ].filter(Boolean);

  if (packet.sampleSignals?.hasTemplateScaffold) {
    lines.push('<sample_handling>');
    packet.sampleSignals.guidance.forEach((entry) => lines.push(`- ${entry}`));
    if (packet.sampleSignals.samplePreview) {
      lines.push(`- Sample preview: ${packet.sampleSignals.samplePreview}`);
    }
    lines.push('</sample_handling>');
  }

  const continuityLines = [
    ...(packet.continuity?.recentTasks?.length ? ['Recent related tasks:', ...packet.continuity.recentTasks.map((entry) => `- ${entry}`)] : []),
    ...(packet.continuity?.recentArtifacts?.length ? ['Recent related artifacts:', ...packet.continuity.recentArtifacts.map((entry) => `- ${entry}`)] : []),
    ...(packet.continuity?.recentDirections?.length
      ? [
        'Recent creative directions:',
        ...packet.continuity.recentDirections.map((entry) => `- ${entry.label}${entry.theme ? ` (${entry.theme})` : ''}`),
      ]
      : []),
    ...(packet.continuity?.recentMessages?.length ? ['Recent dialog context:', ...packet.continuity.recentMessages.map((entry) => `- ${entry}`)] : []),
  ];

  if (continuityLines.length > 0) {
    lines.push('<continuity>');
    lines.push('Use prior work for continuity and context, but do not clone the most recent document structure or section naming unless the request explicitly calls for it.');
    continuityLines.forEach((entry) => lines.push(entry));
    lines.push('</continuity>');
  }

  return lines.join('\n');
}

module.exports = {
  CREATIVE_DIRECTIONS,
  analyzeTemplateSignals,
  buildDocumentCreativityPacket,
  inferDocumentTypeFromPrompt,
  pickCreativeDirection,
  renderCreativityPromptContext,
};
