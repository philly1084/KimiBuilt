/**
 * Document Creator Module for CLI
 * Adds /create, /templates, and /generate commands
 */

const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs').promises;
const path = require('path');

class DocumentCreator {
  constructor(api, config) {
    this.api = api;
    this.config = config;
    this.templates = [];
    this.categories = [];
  }

  /**
   * Initialize and load templates
   */
  async init() {
    await this.loadTemplates();
  }

  /**
   * Load templates from API
   */
  async loadTemplates() {
    try {
      const response = await this.api.request('/api/documents/templates');
      this.templates = response.templates;
      this.categories = response.categories;
    } catch (error) {
      console.log(chalk.yellow('⚠ Could not load templates from API, using defaults'));
      this.templates = this.getDefaultTemplates();
      this.categories = ['business', 'personal', 'creative', 'technical'];
    }
  }

  /**
   * Get default templates
   */
  getDefaultTemplates() {
    return [
      { id: 'business-letter', name: 'Business Letter', category: 'business', description: 'Formal business correspondence' },
      { id: 'resume-modern', name: 'Modern Resume', category: 'personal', description: 'Professional resume/CV' },
      { id: 'meeting-notes', name: 'Meeting Notes', category: 'business', description: 'Meeting minutes template' },
      { id: 'project-proposal', name: 'Project Proposal', category: 'business', description: 'Complete project proposal' },
      { id: 'invoice', name: 'Invoice', category: 'business', description: 'Professional invoice' },
      { id: 'cover-letter', name: 'Cover Letter', category: 'personal', description: 'Job application cover letter' }
    ];
  }

  normalizeCreationFormat(format = 'html') {
    const normalized = String(format || 'html').trim().toLowerCase();
    if (!normalized || normalized === 'docx' || normalized === 'doc' || normalized === 'word') {
      return 'html';
    }
    if (normalized === 'markdown') {
      return 'md';
    }
    return normalized;
  }

  /**
   * Handle /templates command
   */
  async listTemplates(category = null) {
    console.log(chalk.cyan.bold('\n┌─ Available Templates ─────────────────┐'));
    
    const templates = category 
      ? this.templates.filter(t => t.category === category)
      : this.templates;

    if (templates.length === 0) {
      console.log(chalk.yellow('  No templates found'));
    } else {
      // Group by category
      const grouped = {};
      templates.forEach(t => {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category].push(t);
      });

      for (const [cat, items] of Object.entries(grouped)) {
        console.log(chalk.gray(`\n  ${cat.toUpperCase()}:`));
        items.forEach((t, i) => {
          console.log(chalk.gray(`    ${i + 1}. ${chalk.white(t.name.padEnd(20))} ${chalk.gray(t.description)}`));
        });
      }
    }

    console.log(chalk.gray('\n  Use /create <template-id> to create a document'));
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  }

  /**
   * Handle /create command
   */
  async create(templateIdOrArgs) {
    // If no args, show interactive template selection
    if (!templateIdOrArgs) {
      return this.interactiveCreate();
    }

    // Parse args: template-id [--format fmt] [--output path]
    const parts = templateIdOrArgs.split(' ');
    const templateId = parts[0];
    
    let format = 'html';
    let outputPath = null;

    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === '--format' || parts[i] === '-f') {
        format = this.normalizeCreationFormat(parts[++i]);
      } else if (parts[i] === '--output' || parts[i] === '-o') {
        outputPath = parts[++i];
      }
    }

    const template = this.templates.find(t => t.id === templateId);
    if (!template) {
      console.error(chalk.red(`❌ Template not found: ${templateId}`));
      console.log(chalk.gray('  Use /templates to list available templates'));
      return;
    }

    // Get template details
    let templateDetails;
    try {
      const response = await this.api.request(`/api/documents/templates/${templateId}`);
      templateDetails = response.template;
    } catch (error) {
      console.error(chalk.red('❌ Failed to load template details'));
      return;
    }

    // Collect variables interactively
    const variables = await this.collectVariables(templateDetails.variables);

    // Generate document
    await this.generateDocument(templateId, variables, format, outputPath);
  }

  /**
   * Interactive document creation
   */
  async interactiveCreate() {
    const inquirer = await import('inquirer');
    const { default: Inquirer } = inquirer;

    // Step 1: Select category
    const categoryAnswer = await Inquirer.prompt([{
      type: 'list',
      name: 'category',
      message: 'Select a category:',
      choices: [
        { name: 'Business Documents', value: 'business' },
        { name: 'Personal Documents', value: 'personal' },
        { name: 'Creative Documents', value: 'creative' },
        { name: 'Technical Documents', value: 'technical' }
      ]
    }]);

    const category = categoryAnswer.category;
    const templates = this.templates.filter(t => t.category === category);

    // Step 2: Select template
    const templateAnswer = await Inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Select a template:',
      choices: templates.map(t => ({
        name: `${t.name} - ${t.description}`,
        value: t.id
      }))
    }]);

    // Step 3: Select format
    const formatAnswer = await Inquirer.prompt([{
      type: 'list',
      name: 'format',
      message: 'Select output format:',
      choices: [
        { name: 'HTML Document', value: 'html' },
        { name: 'PDF Document', value: 'pdf' },
        { name: 'Markdown', value: 'md' }
      ]
    }]);

    // Get template details
    const templateDetails = await this.api.request(`/api/documents/templates/${templateAnswer.template}`)
      .then(r => r.template)
      .catch(() => null);

    if (!templateDetails) {
      console.error(chalk.red('❌ Failed to load template details'));
      return;
    }

    // Step 4: Collect variables
    console.log(chalk.cyan('\n┌─ Template Variables ──────────────────┐'));
    const variables = await this.collectVariablesInteractive(templateDetails.variables);
    console.log(chalk.cyan('└───────────────────────────────────────┘'));

    // Step 5: Generate
    await this.generateDocument(
      templateAnswer.template,
      variables,
      formatAnswer.format
    );
  }

  /**
   * Collect template variables (simple mode)
   */
  async collectVariables(variables) {
    const result = {};
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (prompt) => new Promise(resolve => {
      readline.question(prompt, resolve);
    });

    for (const variable of variables) {
      const label = `${variable.label}${variable.required ? ' *' : ''}`;
      const defaultValue = variable.default || '';
      
      if (variable.type === 'textarea' || variable.type === 'richtext') {
        console.log(chalk.cyan(`\n${label}:`));
        console.log(chalk.gray('(Enter your text. Press Ctrl+D when done)'));
        
        const lines = [];
        // Simple multi-line input
        console.log(chalk.gray('Enter multi-line input (empty line to finish):'));
        while (true) {
          const line = await question('> ');
          if (line === '') break;
          lines.push(line);
        }
        result[variable.id] = lines.join('\n');
      } else if (variable.type === 'select') {
        const options = variable.options.map((opt, i) => {
          const value = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label;
          return `${i + 1}. ${label}`;
        }).join('\n  ');
        
        console.log(chalk.cyan(`\n${label}:`));
        console.log(chalk.gray(`  ${options}`));
        
        const answer = await question('Select (number): ');
        const index = parseInt(answer) - 1;
        const selected = variable.options[index];
        result[variable.id] = typeof selected === 'string' ? selected : selected.value;
      } else {
        const prompt = chalk.cyan(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `);
        const answer = await question(prompt);
        result[variable.id] = answer || defaultValue;
      }
    }

    readline.close();
    return result;
  }

  /**
   * Collect variables interactively using inquirer
   */
  async collectVariablesInteractive(variables) {
    const inquirer = await import('inquirer');
    const { default: Inquirer } = inquirer;

    const questions = variables.map(v => {
      const base = {
        name: v.id,
        message: v.label,
        default: v.default
      };

      switch (v.type) {
        case 'select':
          return {
            ...base,
            type: 'list',
            choices: v.options.map(opt => 
              typeof opt === 'string' ? opt : { name: opt.label, value: opt.value }
            )
          };
        case 'textarea':
        case 'richtext':
          return {
            ...base,
            type: 'editor',
            message: `${v.label} (will open editor)`
          };
        case 'date':
          return {
            ...base,
            type: 'input',
            default: new Date().toISOString().split('T')[0]
          };
        default:
          return {
            ...base,
            type: 'input'
          };
      }
    });

    const answers = await Inquirer.prompt(questions);
    return answers;
  }

  /**
   * Generate document from template
   */
  async generateDocument(templateId, variables, format, outputPath = null) {
    const spinner = ora({
      text: chalk.yellow('Generating document...'),
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      const response = await this.api.request('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId,
          variables,
          format,
          options: {
            includePageNumbers: true
          }
        })
      }, true); // true = expect binary response

      // Determine output filename
      const defaultDir = this.config.get('documentOutputDir', './documents');
      await fs.mkdir(defaultDir, { recursive: true });
      
      const filename = outputPath || path.join(defaultDir, `document-${Date.now()}.${format}`);
      
      // Save file
      await fs.writeFile(filename, Buffer.from(response));
      
      spinner.succeed(chalk.green(`Document created: ${filename}`));
      
      // Try to open file (optional)
      console.log(chalk.gray(`  Format: ${format.toUpperCase()}`));
      console.log(chalk.gray(`  Size: ${(response.byteLength / 1024).toFixed(1)} KB`));
      
    } catch (error) {
      spinner.fail(chalk.red(`Failed to generate document: ${error.message}`));
    }
  }

  /**
   * Handle /generate command (AI document generation)
   */
  async generateWithAI(args) {
    if (!args.trim()) {
      console.log(chalk.yellow('⚠ Usage: /generate "<prompt>" [--format fmt] [--type type]'));
      console.log(chalk.gray('  Example: /generate "Project proposal for carbon tracking app" --format pdf'));
      return;
    }

    // Parse arguments
    let prompt = args;
    let format = 'html';
    let documentType = '';
    let tone = 'professional';
    let length = 'medium';

    const formatMatch = args.match(/--format\s+(\w+)/);
    if (formatMatch) {
      format = this.normalizeCreationFormat(formatMatch[1]);
      prompt = prompt.replace(formatMatch[0], '');
    }

    const typeMatch = args.match(/--type\s+(\w+)/);
    if (typeMatch) {
      documentType = typeMatch[1];
      prompt = prompt.replace(typeMatch[0], '');
    }

    prompt = prompt.trim();

    const spinner = ora({
      text: chalk.yellow('AI is generating your document...'),
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      const response = await this.api.request('/api/documents/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          documentType,
          tone,
          length,
          format: this.normalizeCreationFormat(format)
        })
      });

      if (response.success) {
        // Download the document
        const docResponse = await this.api.request(response.downloadUrl, {}, true);
        
        const defaultDir = this.config.get('documentOutputDir', './documents');
        await fs.mkdir(defaultDir, { recursive: true });
        
        const filename = path.join(defaultDir, response.document.filename);
        await fs.writeFile(filename, Buffer.from(docResponse));
        
        spinner.succeed(chalk.green(`Document created: ${filename}`));
        console.log(chalk.gray(`  Title: ${response.document.metadata.title || 'Untitled'}`));
        console.log(chalk.gray(`  Sections: ${response.document.metadata.sections || 'N/A'}`));
        console.log(chalk.gray(`  Estimated pages: ${response.document.metadata.estimatedPages || 'N/A'}`));
        
        // Show preview if available
        if (response.preview) {
          console.log(chalk.cyan('\n  Preview:'));
          response.preview.slice(0, 3).forEach(section => {
            console.log(chalk.gray(`    • ${section.heading}`));
          });
        }
      }
    } catch (error) {
      spinner.fail(chalk.red(`AI generation failed: ${error.message}`));
    }
  }

  /**
   * Handle /generate-from command (data-driven generation)
   */
  async generateFromData(dataFile, templateId, options = {}) {
    const spinner = ora({
      text: chalk.yellow('Loading data...'),
      spinner: 'dots',
      color: 'cyan'
    }).start();

    try {
      // Read data file
      const dataContent = await fs.readFile(dataFile, 'utf-8');
      const data = JSON.parse(dataContent);

      spinner.text = 'Generating document...';

      const response = await this.api.request('/api/documents/generate-from-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          templateId,
          format: this.normalizeCreationFormat(options.format || 'html')
        })
      }, true);

      const defaultDir = this.config.get('documentOutputDir', './documents');
      await fs.mkdir(defaultDir, { recursive: true });
      
      const outputFormat = this.normalizeCreationFormat(options.format || 'html');
      const filename = path.join(defaultDir, `generated-${Date.now()}.${outputFormat}`);
      await fs.writeFile(filename, Buffer.from(response));

      spinner.succeed(chalk.green(`Document created: ${filename}`));
    } catch (error) {
      spinner.fail(chalk.red(`Failed to generate from data: ${error.message}`));
    }
  }

  /**
   * Print help for document commands
   */
  printHelp() {
    console.log(chalk.cyan.bold('\n┌─ Document Commands ───────────────────┐'));
    console.log(chalk.gray(`  ${chalk.cyan('/templates'.padEnd(20))} List available templates`));
    console.log(chalk.gray(`  ${chalk.cyan('/templates <category>'.padEnd(20))} List templates by category`));
    console.log(chalk.gray(`  ${chalk.cyan('/create'.padEnd(20))} Interactive document creation`));
    console.log(chalk.gray(`  ${chalk.cyan('/create <template>'.padEnd(20))} Create from template`));
    console.log(chalk.gray(`  ${chalk.cyan('/generate <prompt>'.padEnd(20))} AI document generation`));
    console.log(chalk.gray(`  ${chalk.cyan('/generate-from <file>'.padEnd(20))} Generate from data file`));
    console.log(chalk.gray('\n  Examples:'));
    console.log(chalk.gray('    /create business-letter --format pdf'));
    console.log(chalk.gray('    /generate "Project proposal for mobile app" --type proposal'));
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  }
}

module.exports = { DocumentCreator };
