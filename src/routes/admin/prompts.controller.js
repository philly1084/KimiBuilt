/**
 * Prompts Controller
 * The legacy runtime prompt registry is deprecated and no longer drives execution.
 * Keep the endpoints for dashboard compatibility, but expose them as read-only no-op APIs.
 */

const DEPRECATION_MESSAGE = 'Runtime prompt editing is deprecated. Conversation/tool orchestration is now handled in application code instead of editable runtime prompt slots.';

const LEGACY_PROMPT_SURFACE = [
  {
    id: 'conversation-runtime',
    name: 'Conversation Runtime',
    description: 'Legacy prompt slot retained only for dashboard compatibility.',
    assignment: 'deprecated',
    category: 'deprecated',
    live: false,
    editable: false,
    variables: [],
    content: DEPRECATION_MESSAGE,
    deprecated: true,
  },
];

class PromptsController {
  async getAll(req, res) {
    const { category, search } = req.query;
    let prompts = [...LEGACY_PROMPT_SURFACE];

    if (category && category !== 'all') {
      prompts = prompts.filter((prompt) => prompt.category === category);
    }

    if (search) {
      const searchLower = String(search).toLowerCase();
      prompts = prompts.filter((prompt) =>
        prompt.name.toLowerCase().includes(searchLower) ||
        prompt.description.toLowerCase().includes(searchLower) ||
        prompt.assignment.toLowerCase().includes(searchLower) ||
        prompt.content.toLowerCase().includes(searchLower),
      );
    }

    res.json({
      success: true,
      data: prompts,
      deprecated: true,
      message: DEPRECATION_MESSAGE,
    });
  }

  async getById(req, res) {
    const prompt = LEGACY_PROMPT_SURFACE.find((entry) => entry.id === req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt slot not found' });
    }

    res.json({
      success: true,
      data: prompt,
      deprecated: true,
      message: DEPRECATION_MESSAGE,
    });
  }

  async create(req, res) {
    res.status(410).json({
      success: false,
      error: DEPRECATION_MESSAGE,
      deprecated: true,
    });
  }

  async update(req, res) {
    res.status(410).json({
      success: false,
      error: DEPRECATION_MESSAGE,
      deprecated: true,
    });
  }

  async remove(req, res) {
    res.status(410).json({
      success: false,
      error: DEPRECATION_MESSAGE,
      deprecated: true,
    });
  }

  async test(req, res) {
    const prompt = LEGACY_PROMPT_SURFACE.find((entry) => entry.id === req.params.id);

    if (!prompt) {
      return res.status(404).json({ success: false, error: 'Prompt slot not found' });
    }

    res.json({
      success: true,
      deprecated: true,
      message: DEPRECATION_MESSAGE,
      data: {
        original: prompt.content,
        rendered: prompt.content,
        variables: [],
        provided: req.body?.variables || {},
        missing: [],
        assignment: prompt.assignment,
        stats: {
          characters: prompt.content.length,
          tokens: Math.ceil(prompt.content.length / 4),
          lines: prompt.content.split('\n').length,
        },
      },
    });
  }
}

module.exports = new PromptsController();
