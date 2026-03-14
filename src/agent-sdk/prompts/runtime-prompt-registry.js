const fs = require('fs').promises;
const path = require('path');

const DEFAULT_PROMPTS = [
  {
    id: 'agent-sdk-planner-analysis',
    name: 'Planner Task Analysis',
    description: 'Live prompt used by Planner.analyzeTask() before building an execution plan.',
    assignment: 'agent-sdk.execution.Planner.analyzeTask',
    category: 'agent-sdk',
    live: true,
    editable: true,
    variables: ['objective', 'type', 'input', 'availableTools'],
    content: `Analyze this task and provide a JSON response with:
1. complexity: "low", "medium", or "high"
2. requiredTools: array of tool names needed
3. estimatedSteps: estimated number of execution steps (number)
4. challenges: array of anticipated challenges

Task: {{objective}}
Type: {{type}}
Input: {{input}}
Available Tools: {{availableTools}}

Respond with valid JSON only.`,
  },
  {
    id: 'agent-sdk-executor-llm-step',
    name: 'Executor LLM Step',
    description: 'Live prompt used by Executor.constructPrompt() for generic LLM execution steps.',
    assignment: 'agent-sdk.execution.Executor.constructPrompt',
    category: 'agent-sdk',
    live: true,
    editable: true,
    variables: ['taskObjective', 'stepDescription', 'stepType', 'taskInputBlock', 'stepParamsBlock', 'skillContextBlock'],
    content: `You are executing one step in an agent workflow.

Task: {{taskObjective}}
Step: {{stepDescription}}
Type: {{stepType}}
{{skillContextBlock}}
{{taskInputBlock}}
{{stepParamsBlock}}`,
  },
];

class RuntimePromptRegistry {
  constructor() {
    this.filePath = path.join(__dirname, '../../../config/agent-runtime-prompts.json');
    this.prompts = new Map();
    this.seedDefaults();
    this.ready = this.loadFromDisk();
  }

  seedDefaults() {
    const now = new Date().toISOString();
    DEFAULT_PROMPTS.forEach((prompt, index) => {
      this.prompts.set(prompt.id, {
        ...prompt,
        order: index,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async loadFromDisk() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const storedPrompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];

      storedPrompts.forEach((storedPrompt) => {
        const current = this.prompts.get(storedPrompt.id);
        if (!current) {
          return;
        }

        this.prompts.set(storedPrompt.id, {
          ...current,
          name: storedPrompt.name || current.name,
          description: storedPrompt.description || current.description,
          content: storedPrompt.content || current.content,
          updatedAt: storedPrompt.updatedAt || current.updatedAt,
        });
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[RuntimePromptRegistry] Failed to load prompts:', error);
      }
    }
  }

  async persist() {
    const payload = {
      version: 1,
      prompts: this.list().map((prompt) => ({
        id: prompt.id,
        name: prompt.name,
        description: prompt.description,
        content: prompt.content,
        updatedAt: prompt.updatedAt,
      })),
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  list() {
    return Array.from(this.prompts.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  get(id) {
    return this.prompts.get(id) || null;
  }

  async update(id, updates = {}) {
    await this.ready;

    const prompt = this.get(id);
    if (!prompt) {
      throw new Error('Prompt slot not found');
    }

    const updated = {
      ...prompt,
      name: updates.name || prompt.name,
      description: updates.description || prompt.description,
      content: updates.content || prompt.content,
      updatedAt: new Date().toISOString(),
    };

    this.prompts.set(id, updated);
    await this.persist();
    return updated;
  }

  render(id, variables = {}) {
    const prompt = this.get(id);
    if (!prompt) {
      throw new Error(`Prompt slot not found: ${id}`);
    }

    return String(prompt.content).replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = variables[key];
      return value == null ? '' : String(value);
    });
  }
}

module.exports = new RuntimePromptRegistry();
