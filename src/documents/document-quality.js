const DOCUMENT_QUALITY_STANDARD_VERSION = 'document-quality-2026-05-context-interaction';

const QUALITY_AGENT_PASSES = [
  {
    id: 'strategy-architect',
    label: 'Strategy Architect',
    focus: 'Confirms the artifact has the right document type, audience fit, argument order, and decision path.',
  },
  {
    id: 'background-art-director',
    label: 'Background Art Director',
    focus: 'Creates an intentional background system with readable page, panel, band, chart, and image-overlay surfaces.',
  },
  {
    id: 'evidence-editor',
    label: 'Evidence Editor',
    focus: 'Keeps claims grounded, turns facts into implications, and avoids invented precision.',
  },
  {
    id: 'accessibility-reviewer',
    label: 'Accessibility Reviewer',
    focus: 'Checks contrast, mobile/print readability, table clarity, clipped labels, and overlapping text risk.',
  },
  {
    id: 'final-polish-editor',
    label: 'Final Polish Editor',
    focus: 'Removes template residue, generic headings, repeated phrasing, placeholders, and process notes.',
  },
];

const FORMAT_FOCUS = {
  html: [
    'Design the first screen as a composed reading surface with a clear background/page/panel relationship.',
    'Use section rhythm, cards, callouts, tables, charts, and verified images only where they improve comprehension.',
    'Assume responsive browser QA will check contrast, overflow, broken images, and page errors.',
  ],
  pdf: [
    'Use browser-renderable HTML discipline first, then print-safe surfaces with dark text on light pages unless a dark panel is explicit.',
    'Keep page density balanced: no tiny tables, clipped labels, or decorative backgrounds that print poorly.',
    'Use executive summary, evidence blocks, and references/caveats where the document type calls for them.',
  ],
  pptx: [
    'Build a slide story with one dominant idea per slide and visible scene-to-scene pacing.',
    'Use image prompts, chart slides, and section resets as design primitives rather than decoration.',
    'Keep slide copy short enough to present, not a memo pasted into slide boxes.',
  ],
  xlsx: [
    'Treat workbook tabs as a designed information product: overview first, then data, tables, charts, and notes.',
    'Make sheets scannable with clear labels, useful chart data, and interpretation beside the numbers.',
  ],
  md: [
    'Optimize for portable reading: clear headings, concise prose, useful lists, and preserved evidence boundaries.',
    'Use markdown tables and callouts only when they remain readable as plain text.',
  ],
};

function normalizeFormat(format = 'html') {
  const normalized = String(format || 'html').trim().toLowerCase();
  if (normalized === 'markdown') {
    return 'md';
  }
  return normalized || 'html';
}

function normalizeDocumentTypeLabel(documentType = 'document') {
  return String(documentType || 'document').trim().toLowerCase() || 'document';
}

function buildDocumentQualityPlan({
  documentType = 'document',
  format = 'html',
  designPlan = null,
} = {}) {
  const normalizedFormat = normalizeFormat(format);
  const selectedLayout = designPlan?.selectedDesignOption || designPlan?.layoutChoice || null;

  return {
    version: DOCUMENT_QUALITY_STANDARD_VERSION,
    passName: 'lets create context by interaction with the user to avoid slop',
    standard: 'publication-ready',
    documentType: normalizeDocumentTypeLabel(documentType),
    format: normalizedFormat,
    modelDefaults: [
      'Use the strongest configured generation model unless the caller explicitly supplies a model.',
      'Spend reasoning on document architecture, visual composition, evidence boundaries, and final polish before emitting JSON.',
      'Prefer specific, edited content over broad "professional" filler.',
    ],
    interactionBrief: {
      stateMachine: [
        'brief_scan: extract known format, audience, purpose, source material, constraints, and acceptance checks.',
        'missing_context: decide whether gaps are blockers or safe defaults.',
        'question_or_default: ask one or two concise questions only for blockers; otherwise continue with assumptions in metadata or handoff notes.',
        'architecture: choose the document structure, reader jobs, and evidence path before drafting.',
        'quality_pass: reconcile strategy, design, evidence, accessibility, and final polish into the generated artifact.',
        'medium_check: verify the target medium requirements before calling the document complete.',
      ],
      fields: [
        'format',
        'audience',
        'purpose',
        'required sections',
        'source material',
        'tone',
        'length',
        'visual/data assets',
        'constraints',
        'acceptance checks',
      ],
      rules: [
        'Infer conservative professional defaults from the request, session context, selected template, and source artifacts before asking the user for more information.',
        'Ask one or two concise follow-up questions only when missing details would materially change the document or block a credible draft.',
        'If the user wants speed or the missing detail is not a blocker, continue with explicit assumptions in metadata or handoff notes rather than visible process chatter.',
        'For document requests, never ship a generic filler draft just because the prompt is short; use the brief to choose structure, evidence needs, and reader jobs.',
      ],
    },
    backgroundDirection: {
      label: selectedLayout?.label
        ? `${selectedLayout.label} background system`
        : 'Document background system',
      rules: [
        'Treat background creation as part of the document, not decoration added after writing.',
        'Define a readable hierarchy for canvas background, page surface, panels, dark bands, image overlays, tables, charts, captions, and muted text.',
        'Use subtle texture, grid, editorial bands, or section washes only when they help orientation; never let background treatment compete with body copy.',
        'For text over imagery, require a solid or strongly translucent overlay and explicit color/background pairing.',
        'For print/PDF, preserve a light readable page surface unless a dark printed panel has its own high-contrast text color.',
      ],
    },
    agentPasses: QUALITY_AGENT_PASSES.map((entry) => ({ ...entry })),
    formatFocus: FORMAT_FOCUS[normalizedFormat] || FORMAT_FOCUS.html,
    completionGate: [
      'The artifact must look intentional before it reads clever.',
      'No white-on-white, dark-on-dark, placeholder sections, generic numbered scaffolds, or visible process notes.',
      'Short or underspecified prompts still need a real document brief, safe assumptions, and request-specific structure.',
      'Every section should justify its presence through a reader job: decide, understand, compare, execute, or remember.',
      'Tables, charts, stats, and callouts need labels and interpretation, not just raw values.',
      'If sources are incomplete, state limits as document content without exposing tool workflow details.',
    ],
  };
}

function renderDocumentQualityPromptContext(planOrOptions = null) {
  const qualityPlan = planOrOptions?.version
    ? planOrOptions
    : buildDocumentQualityPlan(planOrOptions || {});

  const lines = [
    `<quality_standard version="${qualityPlan.version}">`,
    `Pass: ${qualityPlan.passName}`,
    'Apply this standard automatically. The user should not need to ask for better design prompts, background direction, or a quality review pass.',
    '<model_quality_defaults>',
    ...qualityPlan.modelDefaults.map((entry) => `- ${entry}`),
    '</model_quality_defaults>',
    '<document_intake>',
    'State machine:',
    ...qualityPlan.interactionBrief.stateMachine.map((entry) => `- ${entry}`),
    `Brief fields: ${qualityPlan.interactionBrief.fields.join(', ')}`,
    ...qualityPlan.interactionBrief.rules.map((entry) => `- ${entry}`),
    '</document_intake>',
    '<background_creation>',
    `Direction: ${qualityPlan.backgroundDirection.label}`,
    ...qualityPlan.backgroundDirection.rules.map((entry) => `- ${entry}`),
    '</background_creation>',
    '<multi_agent_design_pass>',
    'Before final output, internally run these specialist passes and reconcile them into one coherent artifact. Do not mention the pass names in visible document copy.',
    ...qualityPlan.agentPasses.map((entry) => `- ${entry.label} [${entry.id}]: ${entry.focus}`),
    '</multi_agent_design_pass>',
    '<format_quality_focus>',
    ...qualityPlan.formatFocus.map((entry) => `- ${entry}`),
    '</format_quality_focus>',
    '<completion_gate>',
    ...qualityPlan.completionGate.map((entry) => `- ${entry}`),
    '</completion_gate>',
    '</quality_standard>',
  ];

  return lines.join('\n');
}

function summarizeDocumentQualityPlan(planOrOptions = null) {
  const qualityPlan = planOrOptions?.version
    ? planOrOptions
    : buildDocumentQualityPlan(planOrOptions || {});

  return {
    version: qualityPlan.version,
    passName: qualityPlan.passName,
    standard: qualityPlan.standard,
    format: qualityPlan.format,
    agentPasses: qualityPlan.agentPasses.map((entry) => entry.id),
    backgroundDirection: qualityPlan.backgroundDirection.label,
    completionGate: qualityPlan.completionGate.slice(0, 3),
  };
}

module.exports = {
  DOCUMENT_QUALITY_STANDARD_VERSION,
  QUALITY_AGENT_PASSES,
  buildDocumentQualityPlan,
  renderDocumentQualityPromptContext,
  summarizeDocumentQualityPlan,
};
