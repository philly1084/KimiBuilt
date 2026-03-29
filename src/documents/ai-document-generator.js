/**
 * AI Document Generator - Uses OpenAI to generate document content
 */

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
    return JSON.parse(text);
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
    const documentType = options.documentType || 'document';
    const tone = options.tone || 'professional';
    const length = options.length || 'medium';
    const language = options.language || 'en';

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

    return `You are an expert document writer specializing in ${documentType}s.

WRITING STYLE:
- Tone: ${toneGuidance[tone] || toneGuidance.professional}
- Length: ${lengthGuidance[length] || lengthGuidance.medium}
${language !== 'en' ? `- Language: Write in ${language}` : ''}

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "title": "Document Title",
  "sections": [
    {
      "heading": "Section Heading",
      "content": "Section content with proper paragraphs...",
      "level": 1
    }
  ],
  "metadata": {
    "wordCount": 1234,
    "estimatedPages": 5,
    "keywords": ["keyword1", "keyword2"]
  }
}

GUIDELINES:
- Create comprehensive, well-structured content
- Use appropriate formatting (paragraphs, lists, emphasis)
- Include specific details and examples
- Maintain consistency throughout
- Ensure professional quality suitable for business use
- Write the actual content, not placeholders
- For sections that would have tables, describe the table structure in the content`;
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
      normalized.sections = content.sections.map((section, index) => ({
        heading: section.heading || section.title || `Section ${index + 1}`,
        content: section.content || '',
        level: section.level || 1
      }));
    } else if (content.content) {
      // Single content block
      normalized.sections = [{
        heading: 'Content',
        content: content.content,
        level: 1
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

  /**
   * Generate presentation content from a topic or outline
   * @param {string} topic - Presentation topic
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Presentation content structure
   */
  async generatePresentationContent(topic, options = {}) {
    const slideCount = options.slideCount || 6;
    const tone = options.tone || 'professional';
    const includeImages = options.includeImages !== false;

    const prompt = `Create a presentation about: ${topic}

Requirements:
- Create exactly ${slideCount} slides
- Tone: ${tone}
- Include a compelling title slide
- Structure content logically with clear progression
- Each slide should have a clear title and key bullet points (3-5 bullets)
${includeImages ? '- For key slides, suggest an image description that would enhance the visual impact' : ''}

Return JSON with this structure:
{
  "title": "Presentation Title",
  "subtitle": "Subtitle or tagline",
  "slides": [
    {
      "layout": "title|content|section|image|two-column|chart",
      "title": "Slide Title",
      "content": "Main content text (for content slides)",
      "bullets": ["Point 1", "Point 2", "Point 3"],
      "imagePrompt": "Description for AI image generation (optional, for visual slides)"
    }
  ]
}

Guidelines:
- First slide should always have "title" layout
- Use "section" layout for major topic dividers
- Use "image" layout for slides that benefit from visuals
- Use "content" or "bullets" layout for information slides
- Keep bullet points concise (10-15 words max)
- Image prompts should be detailed and descriptive for DALL-E generation`;

    try {
      const result = await this.requestJson({
        messages: [{ role: 'user', content: prompt }],
        model: options.model || 'gpt-4o',
        reasoningEffort: options.reasoningEffort || null,
      });
      
      // Ensure proper structure
      return {
        title: result.title || topic,
        subtitle: result.subtitle || '',
        slides: (result.slides || []).map((slide, index) => ({
          layout: slide.layout || (index === 0 ? 'title' : 'content'),
          title: slide.title || `Slide ${index + 1}`,
          content: slide.content || '',
          bullets: slide.bullets || [],
          imagePrompt: slide.imagePrompt,
          generateImage: !!slide.imagePrompt && includeImages
        }))
      };
    } catch (error) {
      console.error('[AIDocumentGenerator] Presentation generation failed:', error);
      // Return a basic structure on failure
      return {
        title: topic,
        subtitle: '',
        slides: [
          { layout: 'title', title: topic, subtitle: '' },
          { layout: 'content', title: 'Introduction', bullets: ['Overview of the topic'] }
        ]
      };
    }
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
