/**
 * Prompts Controller
 * Exposes the live Agent SDK runtime prompt slots.
 */

const runtimePromptRegistry = require('../../agent-sdk/prompts/runtime-prompt-registry');

class PromptsController {
  /**
   * Get all live prompt slots.
   */
  async getAll(req, res) {
    try {
      await runtimePromptRegistry.ready;
      const { category, search } = req.query;

      let prompts = runtimePromptRegistry.list();

      if (category && category !== 'all') {
        prompts = prompts.filter((prompt) => prompt.category === category);
      }

      if (search) {
        const searchLower = search.toLowerCase();
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
      });
    } catch (error) {
      console.error('Error getting prompts:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get a single live prompt slot.
   */
  async getById(req, res) {
    try {
      await runtimePromptRegistry.ready;
      const prompt = runtimePromptRegistry.get(req.params.id);

      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt slot not found' });
      }

      res.json({ success: true, data: prompt });
    } catch (error) {
      console.error('Error getting prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Runtime slots are fixed; only updates are allowed.
   */
  async create(req, res) {
    res.status(405).json({
      success: false,
      error: 'Runtime prompt slots are fixed. Update an existing live slot instead.',
    });
  }

  /**
   * Update a live prompt slot.
   */
  async update(req, res) {
    try {
      const { name, description, content } = req.body || {};
      if (!content && !name && !description) {
        return res.status(400).json({
          success: false,
          error: 'At least one of name, description, or content is required',
        });
      }

      const updated = await runtimePromptRegistry.update(req.params.id, {
        name,
        description,
        content,
      });

      res.json({ success: true, data: updated });
    } catch (error) {
      const status = error.message === 'Prompt slot not found' ? 404 : 500;
      console.error('Error updating prompt:', error);
      res.status(status).json({ success: false, error: error.message });
    }
  }

  /**
   * Runtime slots cannot be deleted.
   */
  async remove(req, res) {
    res.status(405).json({
      success: false,
      error: 'Runtime prompt slots cannot be deleted',
    });
  }

  /**
   * Render a live prompt slot with provided variables.
   */
  async test(req, res) {
    try {
      await runtimePromptRegistry.ready;
      const prompt = runtimePromptRegistry.get(req.params.id);
      if (!prompt) {
        return res.status(404).json({ success: false, error: 'Prompt slot not found' });
      }

      const variables = req.body?.variables || {};
      const rendered = runtimePromptRegistry.render(req.params.id, variables);

      res.json({
        success: true,
        data: {
          original: prompt.content,
          rendered,
          variables: prompt.variables,
          provided: variables,
          missing: prompt.variables.filter((variable) => variables[variable] == null),
          assignment: prompt.assignment,
          stats: {
            characters: rendered.length,
            tokens: Math.ceil(rendered.length / 4),
            lines: rendered.split('\n').length,
          },
        },
      });
    } catch (error) {
      console.error('Error testing prompt:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new PromptsController();
