/**
 * AI Document Generator - Uses OpenAI to generate document content
 */

const {
  normalizeDocumentType,
  resolveDocumentBlueprint,
  renderBlueprintPrompt,
} = require('./document-design-blueprints');

class AIDocumentGenerator {
  constructor(openaiClient) {
    this.openai = openaiClient;
  }

  extractText(response) {
    if (Array.isArray(response?.output)) {
      return response.output
        .filter((item) => item?.type === 'message')
        .map((item) => (Array.isArray(item.content) ? item.content : [])
          .map((content) => content?.text || '')
          .join(''))
        .join('\n')
        .trim();
    }

    return String(response?.choices?.[0]?.message?.content || '').trim();
  }

  async requestResponse({ messages, model, reasoningEffort = null, stream = false }) {
    if (typeof this.openai?.createResponse === 'function') {
      return this.openai.createResponse({
        input: messages,
        stream,
        model: model || null,
        reasoningEffort: reasoningEffort || null,
      });
    }

    if (typeof this.openai?.chat?.completions?.create === 'function') {
      return this.openai.chat.completions.create({
        model: model || 'gpt-4o',
        messages,
        stream,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      });
    }

    if (typeof this.openai?.responses?.create === 'function') {
      return this.openai.responses.create({
        model: model || 'gpt-4o',
        input: messages,
        stream,
        ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      });
    }

    throw new Error('No compatible response client is configured');
  }

  async requestJson({ messages, model, reasoningEffort = null }) {
    const response = await this.requestResponse({ messages, model, reasoningEffort, stream: false });
    const text = this.extractText(response);
    return this.parseJsonResponseText(text);
  }

  async requestText({ messages, model, reasoningEffort = null }) {
    const response = await this.requestResponse({ messages, model, reasoningEffort, stream: false });
    return this.extractText(response);
  }

  /**
   * Generate document content using AI
   * @param {string} prompt - User prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated content structure
   */
  async generate(prompt, options = {}) {
    const systemPrompt = this.buildSystemPrompt(options);
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    try {
      const content = await this.requestJson({
        messages,
        model: options.model || 'gpt-4o',
        reasoningEffort: options.reasoningEffort || null,
      });
      
      // Validate and normalize response
      return this.normalizeDocumentStructure(content);
    } catch (error) {
      console.error('[AIDocumentGenerator] Generation failed:', error);
      if (error?.responseText) {
        return this.normalizeDocumentStructure(
          this.buildFallbackDocumentFromText(error.responseText, prompt, options),
        );
      }
      throw new Error(`AI generation failed: ${error.message}`);
    }
  }

  /**
   * Expand an outline into full document content
   * @param {Array} outline - Document outline
   * @param {Object} options - Expansion options
   * @returns {Promise<Array>} Expanded outline
   */
  async expandOutline(outline, options = {}) {
    const expanded = [];

    for (const item of outline) {
      const expandedItem = await this.expandOutlineItem(item, options);
      expanded.push(expandedItem);
    }

    return expanded;
  }

  /**
   * Expand a single outline item
   * @param {Object} item - Outline item
   * @param {Object} options - Expansion options
   * @returns {Promise<Object>} Expanded item
   */
  async expandOutlineItem(item, options) {
    const prompt = `Expand the following section into detailed content:

Title: ${item.title || item.heading}
Level: ${item.level || 1}
Notes: ${item.notes || 'None'}

Requirements:
- Length: ${options.length || 'medium'} (short: 100-200 words, medium: 300-500 words, long: 600-1000 words)
- Tone: ${options.tone || 'professional'}
- Write comprehensive, well-structured content
- Include specific details and examples where appropriate
- Use professional formatting with paragraphs and lists as needed

Output JSON:
{
  "content": "The expanded content...",
  "keyPoints": ["point 1", "point 2"]
}`;

    try {
      const result = await this.requestJson({
        messages: [{ role: 'user', content: prompt }],
        model: options.model || 'gpt-4o',
        reasoningEffort: options.reasoningEffort || null,
      });

      return {
        ...item,
        content: result.content,
        keyPoints: result.keyPoints || [],
        subsections: item.children ? 
          await this.expandOutline(item.children, options) : []
      };
    } catch (error) {
      console.error('[AIDocumentGenerator] Outline expansion failed:', error);
      return {
        ...item,
        content: `Error expanding section: ${item.title}`,
        error: error.message
      };
    }
  }

  /**
   * Generate a document from structured data
   * @param {Object} data - Structured data
   * @param {string} documentType - Type of document
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Generated content
   */
  async generateFromData(data, documentType, options = {}) {
    const prompt = `Generate a ${documentType} from the following data:

${JSON.stringify(data, null, 2)}

Create a professional document that presents this data effectively.`;

    return this.generate(prompt, { ...options, documentType });
  }

  /**
   * Improve existing content
   * @param {string} content - Content to improve
   * @param {string} improvement - Type of improvement
   * @param {Object} options - Options
   * @returns {Promise<string>} Improved content
   */
  async improveContent(content, improvement = 'general', options = {}) {
    const improvementPrompts = {
      'general': 'Improve the following text to make it more professional and engaging',
      'grammar': 'Fix any grammar and spelling errors in the following text',
      'clarity': 'Rewrite the following text for better clarity and conciseness',
      'professional': 'Rewrite in a more professional, business-appropriate tone',
      'casual': 'Rewrite in a more casual, conversational tone',
      'technical': 'Rewrite using more technical terminology and precision',
      'simplify': 'Simplify the following text for a general audience',
      'expand': 'Expand the following text with more detail and examples',
      'shorten': 'Make the following text more concise while keeping key points'
    };

    const instruction = improvementPrompts[improvement] || improvementPrompts.general;

    const prompt = `${instruction}:

${content}

Return only the improved text, no explanations.`;

    try {
      return await this.requestText({
        messages: [{ role: 'user', content: prompt }],
        model: options.model || 'gpt-4o',
        reasoningEffort: options.reasoningEffort || null,
      });
    } catch (error) {
      console.error('[AIDocumentGenerator] Improvement failed:', error);
      return content; // Return original on failure
    }
  }

  /**
   * Generate document metadata
   * @param {string} content - Document content
   * @returns {Promise<Object>} Metadata
   */
  async generateMetadata(content) {
    const prompt = `Analyze the following document and generate metadata:

${content.substring(0, 2000)}...

Return JSON:
{
  "title": "Suggested document title",
  "summary": "Brief summary of content",
  "keywords": ["keyword1", "keyword2"],
  "category": "business|technical|creative|academic",
  "wordCount": 1234,
  "estimatedPages": 5,
  "suggestedTags": ["tag1", "tag2"]
}`;

    try {
      return await this.requestJson({
        messages: [{ role: 'user', content: prompt }],
        model: 'gpt-4o-mini',
      });
    } catch (error) {
      console.error('[AIDocumentGenerator] Metadata generation failed:', error);
      return {
        title: 'Untitled Document',
        summary: '',
        keywords: [],
        category: 'general'
      };
    }
  }

  /**
   * Build system prompt for document generation
   * @param {Object} options - Generation options
   * @returns {string} System prompt
   */
  buildSystemPrompt(options = {}) {
    const normalizedDocumentType = normalizeDocumentType(options.documentType || 'document');
    const documentType = normalizedDocumentType || 'document';
    const tone = options.tone || 'professional';
    const length = options.length || 'medium';
    const language = options.language || 'en';
    const blueprint = resolveDocumentBlueprint(documentType);
    const planPrompt = this.renderDesignPlanPrompt(options.designPlan);

    const lengthGuidance = {
      short: 'Keep content concise (100-200 words per section)',
      medium: 'Provide moderate detail (300-500 words per section)',
      long: 'Be comprehensive (600-1000 words per section)',
      detailed: 'Provide extensive detail with examples (1000+ words per section)'
    };

    const toneGuidance = {
      professional: 'Use formal, business-appropriate language',
      casual: 'Use conversational, friendly language',
      technical: 'Use precise technical terminology and structured explanations',
      academic: 'Use scholarly language with proper citations and formal structure',
      persuasive: 'Use compelling language to convince the reader',
      informative: 'Focus on clear, factual presentation of information'
    };

    return [
      `<role>You are an expert document writer specializing in ${blueprint.label} outputs.</role>`,
      '<writing_style>',
      `- Tone: ${toneGuidance[tone] || toneGuidance.professional}`,
      `- Length: ${lengthGuidance[length] || lengthGuidance.medium}`,
      language !== 'en' ? `- Language: Write in ${language}` : null,
      '</writing_style>',
      options.templateContext || null,
      renderBlueprintPrompt(blueprint),
      planPrompt,
      '<output_contract>',
      'Return a JSON object with this exact structure:',
      '{',
      '  "title": "Document Title",',
      '  "subtitle": "Optional subtitle",',
      '  "theme": "editorial|executive|product|bold",',
      '  "sections": [',
      '    {',
      '      "heading": "Section Heading",',
      '      "content": "Section content with proper paragraphs...",',
      '      "level": 1,',
      '      "bullets": ["Optional concise bullet", "Optional concise bullet"],',
      '      "callout": {',
      '        "title": "Optional callout heading",',
      '        "body": "Optional high-signal note or warning",',
      '        "tone": "note|highlight|warning"',
      '      },',
      '      "stats": [',
      '        { "label": "Metric", "value": "Value", "detail": "Optional context" }',
      '      ],',
      '      "table": {',
      '        "caption": "Optional table caption",',
      '        "headers": ["Column A", "Column B"],',
      '        "rows": [["Value 1", "Value 2"]]',
      '      },',
      '      "chart": {',
      '        "title": "Optional chart title",',
      '        "type": "bar|line|comparison",',
      '        "summary": "Optional chart takeaway",',
      '        "series": [',
      '          { "label": "Series label", "value": 42 }',
      '        ]',
      '      }',
      '    }',
      '  ],',
      '  "metadata": {',
      '    "wordCount": 1234,',
      '    "estimatedPages": 5,',
      '    "keywords": ["keyword1", "keyword2"]',
      '  }',
      '}',
      '</output_contract>',
      '<rules>',
      '- Write the actual content, not placeholders.',
      '- Create comprehensive, well-structured content with concrete detail.',
      '- Use paragraphs for explanation and structured fields for scan speed.',
      '- When a section benefits from metrics, tables, or a chart, populate the matching structured field instead of burying everything in prose.',
      '- Only include bullets, stats, tables, charts, or callouts when they strengthen the document.',
      '- Do not output markdown fences, commentary, or any text outside the JSON object.',
      '</rules>',
    ].filter(Boolean).join('\n');
  }

  renderDesignPlanPrompt(designPlan = null) {
    if (!designPlan || typeof designPlan !== 'object') {
      return '';
    }

    const outline = Array.isArray(designPlan.outline) ? designPlan.outline : [];
    const lines = [
      '<production_plan>',
      designPlan.titleSuggestion ? `Title suggestion: ${designPlan.titleSuggestion}` : null,
      designPlan.outlineType ? `Outline type: ${designPlan.outlineType}` : null,
      designPlan.themeSuggestion ? `Theme suggestion: ${designPlan.themeSuggestion}` : null,
      designPlan.creativeDirection?.label ? `Creative direction: ${designPlan.creativeDirection.label}` : null,
      designPlan.creativeDirection?.rationale ? `Creative rationale: ${designPlan.creativeDirection.rationale}` : null,
      Array.isArray(designPlan.humanizationNotes) && designPlan.humanizationNotes.length > 0 ? 'Humanization notes:' : null,
      ...(Array.isArray(designPlan.humanizationNotes)
        ? designPlan.humanizationNotes.map((entry) => `- ${entry}`)
        : []),
      Array.isArray(designPlan.sampleHandling) && designPlan.sampleHandling.length > 0 ? 'Sample handling:' : null,
      ...(Array.isArray(designPlan.sampleHandling)
        ? designPlan.sampleHandling.map((entry) => `- ${entry}`)
        : []),
      outline.length > 0 ? 'Planned structure:' : null,
      ...outline.map((item) => {
        const label = item.title || item.heading || `Section ${item.index || ''}`.trim();
        const detail = [
          item.purpose,
          item.layout,
          item.suggestedBlocks ? `blocks=${item.suggestedBlocks.join(',')}` : '',
        ].filter(Boolean).join(' :: ');
        return `- ${label}${detail ? ` :: ${detail}` : ''}`;
      }),
      '</production_plan>',
    ];

    return lines.filter(Boolean).join('\n');
  }

  parseJsonResponseText(text = '') {
    const rawText = String(text || '').trim();
    const candidates = [
      rawText,
      this.unwrapCodeFence(rawText),
      this.extractFirstJsonBlock(rawText),
    ].filter((candidate, index, list) => candidate && list.indexOf(candidate) === index);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (_error) {
        // Try the next candidate.
      }
    }

    const error = new SyntaxError(
      `Unexpected token in AI response: ${rawText.slice(0, 80) || '[empty response]'}`,
    );
    error.responseText = rawText;
    throw error;
  }

  unwrapCodeFence(text = '') {
    const trimmed = String(text || '').trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
  }

  extractFirstJsonBlock(text = '') {
    const source = this.unwrapCodeFence(text);
    const objectStart = source.indexOf('{');
    const arrayStart = source.indexOf('[');
    const hasObject = objectStart !== -1;
    const hasArray = arrayStart !== -1;

    if (!hasObject && !hasArray) {
      return '';
    }

    const start = hasObject && hasArray
      ? Math.min(objectStart, arrayStart)
      : (hasObject ? objectStart : arrayStart);
    const openChar = source[start];
    const closeChar = openChar === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, index + 1);
        }
      }
    }

    return '';
  }

  buildFallbackDocumentFromText(text = '', prompt = '', options = {}) {
    const rawText = String(text || '').trim();
    const theme = options.designPlan?.themeSuggestion || options.theme || options.style || 'editorial';
    const title = options.designPlan?.titleSuggestion
      || this.deriveTitleFromPrompt(prompt)
      || 'Generated Document';
    const heading = options.designPlan?.outline?.[0]?.heading || 'Overview';

    return {
      title,
      subtitle: '',
      theme,
      sections: [
        {
          heading,
          content: rawText,
          level: 1,
        },
      ],
      metadata: {
        parseRecovery: 'plain-text-fallback',
      },
    };
  }

  deriveTitleFromPrompt(prompt = '') {
    const normalized = String(prompt || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      return '';
    }

    return normalized
      .replace(/^(create|make|generate|build|produce|draft|prepare)\s+/i, '')
      .replace(/[.?!].*$/, '')
      .trim()
      .slice(0, 80);
  }

  /**
   * Normalize document structure
   * @param {Object} content - Raw AI response
   * @returns {Object} Normalized structure
   */
  normalizeDocumentStructure(content) {
    // Ensure required fields exist
    const normalized = {
      title: content.title || 'Untitled Document',
      subtitle: content.subtitle || '',
      theme: content.theme || 'editorial',
      sections: [],
      metadata: {
        wordCount: 0,
        estimatedPages: 0,
        keywords: [],
        ...content.metadata
      }
    };

    // Normalize sections
    if (Array.isArray(content.sections)) {
      normalized.sections = content.sections.map((section, index) => this.normalizeDocumentSection(section, index));
    } else if (content.content) {
      // Single content block
      normalized.sections = [{
        heading: 'Content',
        content: content.content,
        level: 1,
        bullets: [],
        stats: [],
      }];
    }

    // Calculate word count if not provided
    if (!normalized.metadata.wordCount) {
      normalized.metadata.wordCount = normalized.sections.reduce(
        (count, section) => count + (section.content?.split(/\s+/).length || 0),
        0
      );
    }

    // Estimate pages
    if (!normalized.metadata.estimatedPages) {
      normalized.metadata.estimatedPages = Math.ceil(normalized.metadata.wordCount / 250);
    }

    return normalized;
  }

  normalizeDocumentSection(section = {}, index = 0) {
    const normalizedTable = this.normalizeTable(section.table);
    const normalizedChart = this.normalizeChart(section.chart);

    return {
      heading: section.heading || section.title || `Section ${index + 1}`,
      content: typeof section.content === 'string'
        ? section.content
        : Array.isArray(section.content)
          ? section.content.filter(Boolean).join('\n')
          : '',
      level: Number(section.level) || 1,
      bullets: this.normalizeStringList(section.bullets || section.points || section.keyPoints),
      callout: this.normalizeCallout(section.callout || section.highlight || section.note),
      stats: this.normalizeStats(section.stats || section.metrics || section.highlights),
      table: normalizedTable,
      chart: normalizedChart,
    };
  }

  /**
   * Generate presentation content from a topic or outline
   * @param {string} topic - Presentation topic
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Presentation content structure
   */
  async generatePresentationContent(topic, options = {}) {
    const slideCount = options.slideCount || 6;
    const tone = options.tone || 'professional';
    const audience = options.audience || 'general audience';
    const theme = options.theme || options.style || 'editorial';
    const includeImages = options.includeImages !== false;
    const includeCharts = options.includeCharts !== false;
    const blueprint = resolveDocumentBlueprint(options.documentType || 'presentation');

    const prompt = [
      `<task>Create a ${blueprint.label} about: ${topic}</task>`,
      '<requirements>',
      `- Create exactly ${slideCount} slides.`,
      `- Tone: ${tone}.`,
      `- Audience: ${audience}.`,
      `- Theme/style: ${theme}.`,
      '- Include a compelling title slide.',
      '- Maintain visible narrative progression from slide to slide.',
      '- Keep each slide focused on one dominant idea.',
      '- Use 3-5 concise bullets only when bullets improve scanning.',
      includeImages ? '- For visual or high-emotion slides, add a strong imagePrompt.' : null,
      includeCharts ? '- Use chart slides when comparison or trend data helps the story, and provide explicit chart series values.' : null,
      '</requirements>',
      options.templateContext || null,
      renderBlueprintPrompt(blueprint),
      '<output_contract>',
      'Return JSON with this structure:',
      '{',
      '  "title": "Presentation Title",',
      '  "subtitle": "Subtitle or tagline",',
      '  "theme": "editorial|executive|product|bold",',
      '  "slides": [',
      '    {',
      '      "layout": "title|content|section|image|two-column|chart",',
      '      "kicker": "Optional slide eyebrow",',
      '      "title": "Slide Title",',
      '      "subtitle": "Optional supporting line",',
      '      "content": "Main content text (for content slides)",',
      '      "bullets": ["Point 1", "Point 2", "Point 3"],',
      '      "stats": [',
      '        { "label": "Metric", "value": "42%", "detail": "Optional context" }',
      '      ],',
      '      "columns": [',
      '        {',
      '          "heading": "Optional column heading",',
      '          "content": "Optional column content",',
      '          "bullets": ["Optional", "Column bullets"]',
      '        }',
      '      ],',
      '      "chart": {',
      '        "title": "Optional chart title",',
      '        "type": "bar|line|comparison",',
      '        "summary": "Takeaway from the chart",',
      '        "series": [',
      '          { "label": "Label", "value": 42 }',
      '        ]',
      '      },',
      '      "imagePrompt": "Description for AI image generation (optional, for visual slides)",',
      '      "imageUrl": "Optional direct image URL when a verified source image is already available",',
      '      "imageAlt": "Optional alt text for the image",',
      '      "imageSource": "Optional image attribution or source label"',
      '    }',
      '  ]',
      '}',
      '</output_contract>',
      '<rules>',
      '- First slide must use the "title" layout.',
      '- Use "section" layout for major narrative pivots.',
      '- Use "image" layout for slides that benefit from visuals.',
      '- Use "content" layout for explanation slides and "two-column" for comparisons or parallel tracks.',
      '- Use "chart" only when you can provide explicit series data.',
      '- Keep bullet points concise, roughly 10-15 words max.',
      '- Image prompts should be vivid, specific, and visually directive.',
      '- Slides should feel presentation-ready, not like a memo split into pages.',
      '- Do not output markdown fences, prose commentary, or anything outside the JSON object.',
      '</rules>',
    ].filter(Boolean).join('\n');

    try {
      const result = await this.requestJson({
        messages: [{ role: 'user', content: prompt }],
        model: options.model || 'gpt-4o',
        reasoningEffort: options.reasoningEffort || null,
      });

      return this.normalizePresentationStructure(result, {
        ...options,
        defaultTitle: topic,
        includeImages,
      });
    } catch (error) {
      console.error('[AIDocumentGenerator] Presentation generation failed:', error);
      // Return a basic structure on failure
      return this.normalizePresentationStructure({
        title: topic,
        subtitle: '',
        slides: [
          { layout: 'title', title: topic, subtitle: '' },
          { layout: 'content', title: 'Introduction', bullets: ['Overview of the topic'] }
        ]
      }, {
        ...options,
        defaultTitle: topic,
        includeImages,
      });
    }
  }

  normalizePresentationStructure(content = {}, options = {}) {
    const includeImages = options.includeImages !== false;
    const slides = Array.isArray(content.slides) ? content.slides : [];

    return {
      title: content.title || options.defaultTitle || 'Presentation',
      subtitle: content.subtitle || '',
      theme: content.theme || options.theme || options.style || 'editorial',
      slides: slides.map((slide, index) => ({
        layout: slide.layout || (index === 0 ? 'title' : 'content'),
        kicker: slide.kicker || '',
        title: slide.title || `Slide ${index + 1}`,
        subtitle: slide.subtitle || '',
        content: typeof slide.content === 'string' ? slide.content : '',
        bullets: this.normalizeStringList(slide.bullets || slide.points),
        stats: this.normalizeStats(slide.stats || slide.metrics),
        columns: this.normalizeColumns(slide.columns),
        chart: this.normalizeChart(slide.chart),
        imagePrompt: slide.imagePrompt || '',
        imageUrl: slide.imageUrl || '',
        imageAlt: slide.imageAlt || '',
        imageSource: slide.imageSource || '',
        generateImage: !!slide.imagePrompt && includeImages,
      })),
    };
  }

  normalizeColumns(columns = []) {
    if (!Array.isArray(columns)) {
      return [];
    }

    return columns
      .filter((column) => column && typeof column === 'object')
      .map((column) => ({
        heading: column.heading || '',
        content: typeof column.content === 'string' ? column.content : '',
        bullets: this.normalizeStringList(column.bullets || column.points),
      }))
      .filter((column) => column.heading || column.content || column.bullets.length > 0);
  }

  normalizeStringList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    }

    if (typeof value === 'string') {
      return value
        .split('\n')
        .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
    }

    return [];
  }

  normalizeStats(stats = []) {
    if (!Array.isArray(stats)) {
      return [];
    }

    return stats
      .map((stat) => {
        if (stat == null) {
          return null;
        }

        if (typeof stat === 'string') {
          return { label: stat, value: '', detail: '' };
        }

        return {
          label: stat.label || stat.name || 'Metric',
          value: stat.value != null ? String(stat.value) : '',
          detail: stat.detail || stat.context || '',
        };
      })
      .filter((stat) => stat && (stat.label || stat.value || stat.detail));
  }

  normalizeCallout(callout) {
    if (!callout) {
      return null;
    }

    if (typeof callout === 'string') {
      return {
        title: '',
        body: callout,
        tone: 'note',
      };
    }

    return {
      title: callout.title || '',
      body: callout.body || callout.content || callout.text || '',
      tone: callout.tone || 'note',
    };
  }

  normalizeTable(table) {
    if (!table || typeof table !== 'object') {
      return null;
    }

    const headers = Array.isArray(table.headers) ? table.headers.map((entry) => String(entry || '')) : [];
    const rows = Array.isArray(table.rows)
      ? table.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [])
      : [];

    if (headers.length === 0 && rows.length === 0) {
      return null;
    }

    return {
      caption: table.caption || '',
      headers,
      rows,
    };
  }

  normalizeChart(chart) {
    if (!chart || typeof chart !== 'object') {
      return null;
    }

    const series = Array.isArray(chart.series)
      ? chart.series
        .map((point) => {
          if (!point || typeof point !== 'object') {
            return null;
          }

          return {
            label: point.label || point.name || '',
            value: point.value != null ? point.value : '',
          };
        })
        .filter((point) => point && point.label)
      : [];

    if (series.length === 0) {
      return null;
    }

    return {
      title: chart.title || '',
      type: chart.type || 'bar',
      summary: chart.summary || '',
      series,
    };
  }

  /**
   * Generate suggestions for document improvement
   * @param {Object} document - Document structure
   * @returns {Promise<Array>} Suggestions
   */
  async generateSuggestions(document) {
    const prompt = `Review the following document outline and suggest improvements:

Title: ${document.title}
Sections:
${document.sections.map(s => `- ${s.heading}`).join('\n')}

Return JSON array of suggestions:
[
  {
    "type": "add|remove|modify|reorder",
    "target": "section name or 'general'",
    "suggestion": "Description of the change",
    "reason": "Why this change would improve the document"
  }
]`;

    try {
      const result = await this.requestJson({
        messages: [{ role: 'user', content: prompt }],
        model: 'gpt-4o-mini',
      });

      return Array.isArray(result) ? result : (result.suggestions || []);
    } catch (error) {
      return [];
    }
  }
}

module.exports = { AIDocumentGenerator };
