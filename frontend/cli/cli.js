#!/usr/bin/env node

const readline = require('readline');
const { marked } = require('marked');
const MarkedTerminal = require('marked-terminal');
const chalk = require('chalk');
const ora = require('ora');
const figlet = require('figlet');
const gradient = require('gradient-string');
const boxen = require('cli-boxes');
const minimist = require('minimist');
const fs = require('fs');
const path = require('path');

const TerminalRenderer = MarkedTerminal.default || MarkedTerminal;
const config = require('./lib/config');
const session = require('./lib/session');
const api = require('./lib/api');

// CLI metadata
const CLI_VERSION = '2.2.0';
const CLI_NAME = 'LillyBuilt CLI';

// Gradient presets
const titleGradient = gradient(['#FF6B6B', '#4ECDC4', '#45B7D1']);
const aiGradient = gradient(['#667eea', '#764ba2']);

// State
let currentMode = config.getDefaultMode();
let currentSessionId = session.getCurrent();
let currentModel = null;
let isProcessing = false;
let accumulatedResponse = '';
let shouldShowTimestamps = config.get('showTimestamps', false);
let commandHistory = [];
let historyIndex = -1;
let availableModels = [];
let availableImageModels = [];
let lastImageUrls = [];
let providerCapabilities = [];
let activeProviderSession = null;
let providerStreamAbortController = null;
let providerStreamTask = null;
let readlineInterface = null;

// Command definitions for auto-completion
const COMMANDS = [
  '/new', '/mode', '/history', '/sessions', '/clear', '/help', '/quit', '/exit',
  '/url', '/config', '/theme', '/export', '/import', '/rename', '/delete',
  '/copy', '/paste', '/undo', '/redo', '/search', '/settings', '/download-image',
  '/models', '/model', '/image', '/img', '/imgmodels', '/providers', '/attach',
  '/provider-status', '/.help', '/.status', '/.interrupt', '/.detach'
];

const MODES = ['chat', 'canvas', 'notation'];
const THEMES = ['default', 'minimal', 'colorful', 'dark'];
const DEFAULT_PROMPT = chalk.green.bold('You> ');
const PROVIDER_LOCAL_COMMAND_PREFIX = '/.';
const PROVIDER_ALIASES = {
  codex: 'codex-cli',
  gemini: 'gemini-cli',
  kimi: 'kimi-cli',
};

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.cyan,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    hr: chalk.reset,
    listitem: chalk.reset,
    table: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.cyan,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
    ref: chalk.gray,
  }),
  gfm: true,
  breaks: true,
});

/**
 * Print a fancy ASCII banner.
 */
function printBanner() {
  try {
    const asciiTitle = figlet.textSync('LillyBuilt', {
      font: 'Small',
      horizontalLayout: 'default',
    });
    console.log(titleGradient(asciiTitle));
  } catch {
    // Fallback if figlet fails
    console.log(chalk.magenta.bold('\n╔════════════════════════════════════════╗'));
    console.log(chalk.magenta.bold('║         LillyBuilt CLI v2.2.0        ║'));
    console.log(chalk.magenta.bold('╚════════════════════════════════════════╝'));
  }
  
  console.log(chalk.gray(`  Version: ${CLI_VERSION}`));
  console.log(chalk.gray(`  API: ${config.getApiBaseUrl()}`));
  console.log(chalk.gray(`  Mode: ${chalk.cyan(currentMode)}`));
  if (currentModel) {
    console.log(chalk.gray(`  Model: ${chalk.cyan(currentModel)}`));
  }
  console.log(chalk.gray(`  Session: ${currentSessionId ? chalk.green(currentSessionId.slice(0, 16) + '...') : chalk.yellow('none (will auto-create)')}`));
  console.log(chalk.gray('\n  Type /help for available commands\n'));
}

/**
 * Print the help message with formatting.
 */
function printHelp() {
  const boxStyle = {
    topLeft: '╔', topRight: '╗', bottomLeft: '╚', bottomRight: '╝',
    horizontal: '═', vertical: '║',
  };
  
  console.log(chalk.cyan.bold('\n┌─ Available Commands ──────────────────┐'));
  
  const commands = [
    ['Command', 'Description'],
    ['/new', 'Create a new session'],
    ['/mode <type>', 'Switch mode (chat|canvas|notation)'],
    ['/models', 'List available chat models'],
    ['/model <id>', 'Set default model'],
    ['/image <prompt>', 'Generate an image'],
    ['/download-image <url|index> [file]', 'Download an image from URL or last response'],
    ['/imgmodels', 'List image generation models'],
    ['/upload <file>', 'Upload an artifact to the current session'],
    ['/artifacts', 'List session artifacts'],
    ['/download-artifact <id> [file]', 'Download an artifact by ID'],
    ['/makefile <format> <prompt>', 'Generate a file artifact from a prompt'],
    ['/history', 'Show current session ID'],
    ['/sessions', 'List all sessions'],
    ['/clear', 'Clear the screen'],
    ['/url <url>', 'Set API base URL'],
    ['/config', 'Show current configuration'],
    ['/providers', 'List session-capable backend CLI providers'],
    ['/attach <provider> [cwd]', 'Attach to codex-cli, gemini-cli, or kimi-cli'],
    ['/provider-status', 'Show the active backend CLI session'],
    ['/theme <name>', 'Set theme (default|minimal|colorful|dark)'],
    ['/export <file>', 'Export current session to file'],
    ['/import <file>', 'Import session from file'],
    ['/rename <name>', 'Rename current session'],
    ['/delete <id>', 'Delete a session'],
    ['/copy', 'Copy last AI response to clipboard'],
    ['/settings', 'Interactive settings editor'],
    ['/help', 'Show this help message'],
    ['/quit, /exit', 'Exit the CLI'],
  ];
  
  commands.forEach(([cmd, desc], i) => {
    if (i === 0) {
      console.log(chalk.yellow.bold(`  ${cmd.padEnd(20)} ${desc}`));
      console.log(chalk.gray('  ' + '─'.repeat(37)));
    } else {
      console.log(chalk.gray(`  ${chalk.cyan(cmd.padEnd(20))} ${desc}`));
    }
  });
  
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  console.log(chalk.gray('Attached backend CLI sessions pass input through verbatim.'));
  console.log(chalk.gray('Use /.help for local escape commands while attached.\n'));
}

/**
 * Print current configuration.
 */
function printConfig() {
  const cfg = config.list();
  console.log(chalk.cyan.bold('\n┌─ Configuration ───────────────────────┐'));
  Object.entries(cfg).forEach(([key, value]) => {
    const normalizedValue = key.toLowerCase().includes('key') && value
      ? `${String(value).slice(0, 4)}••••${String(value).slice(-2)}`
      : value;
    const displayValue = typeof value === 'boolean' 
      ? (value ? chalk.green('true') : chalk.red('false'))
      : chalk.yellow(String(normalizedValue));
    console.log(chalk.gray(`  ${key.padEnd(20)}: ${displayValue}`));
  });
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
}

function getPromptValue() {
  return activeProviderSession ? '' : DEFAULT_PROMPT;
}

function updatePrompt() {
  if (!readlineInterface) {
    return;
  }

  readlineInterface.setPrompt(getPromptValue());
}

function redrawPrompt() {
  if (!readlineInterface) {
    return;
  }

  readlineInterface.prompt(true);
}

function writeAsyncOutput(text) {
  const content = String(text || '');
  if (!content) {
    return;
  }

  if (!readlineInterface) {
    process.stdout.write(content);
    return;
  }

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(content);
  redrawPrompt();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProviderId(providerId) {
  const normalized = String(providerId || '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] || normalized;
}

/**
 * Print a spinner message for async operations.
 * @param {string} message - Message to display
 * @returns {Object} Ora spinner instance
 */
function createSpinner(message) {
  return ora({
    text: chalk.yellow(message),
    spinner: 'dots',
    color: 'cyan',
  });
}

/**
 * Fetch available models on startup.
 */
async function fetchModels() {
  try {
    availableModels = await api.getModels();
    if (availableModels.length > 0) {
      console.log(chalk.gray(`[Model] Loaded ${availableModels.length} models from API`));
    }
  } catch (err) {
    // Use defaults silently
    availableModels = config.DEFAULT_MODELS.map(m => ({
      id: m.id,
      object: 'model',
      created: Date.now(),
      owned_by: m.provider,
    }));
  }
  
  // Load default model from config
  const savedModel = config.getDefaultModel();
  if (savedModel && availableModels.some((model) => model.id === savedModel)) {
    currentModel = savedModel;
  } else {
    currentModel = availableModels[0]?.id || config.DEFAULT_MODELS[0]?.id || currentModel;
    if (currentModel) {
      config.setDefaultModel(currentModel);
    }
  }
}

/**
 * Fetch available image models.
 */
async function fetchImageModels() {
  try {
    availableImageModels = await api.getImageModels();
  } catch (err) {
    // Use defaults
    availableImageModels = [
      {
        id: 'dall-e-3',
        name: 'DALL-E 3',
        description: 'High-quality image generation',
        sizes: ['1024x1024', '1024x1792', '1792x1024'],
        qualities: ['standard', 'hd'],
        styles: ['vivid', 'natural'],
        maxImages: 1,
      },
      {
        id: 'dall-e-2',
        name: 'DALL-E 2',
        description: 'Fast image generation',
        sizes: ['256x256', '512x512', '1024x1024'],
        qualities: ['standard'],
        styles: ['natural'],
        maxImages: 5,
      },
    ];
  }
}

/**
 * Handle the /new command.
 */
async function handleNew() {
  const spinner = createSpinner('Creating new session...');
  spinner.start();
  
  try {
    const newSession = await api.createSession({ mode: currentMode, model: currentModel });
    currentSessionId = newSession.id;
    session.setCurrent(currentSessionId, { mode: currentMode, name: `Session ${new Date().toLocaleDateString()}`, model: currentModel });
    spinner.succeed(chalk.green(`Created new session: ${currentSessionId.slice(0, 16)}...`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to create session: ${err.message}`));
  }
}

/**
 * Handle the /mode command.
 * @param {string} mode - Mode to switch to
 */
function handleMode(mode) {
  const validModes = config.VALID_MODES;
  if (!validModes.includes(mode)) {
    console.error(chalk.red(`❌ Invalid mode: ${mode}. Use: ${validModes.join(', ')}`));
    return;
  }
  currentMode = mode;
  config.setDefaultMode(mode);
  console.log(chalk.green(`✓ Switched to ${chalk.bold(mode)} mode`));
}

/**
 * Handle the /theme command.
 * @param {string} themeName - Theme to set
 */
function handleTheme(themeName) {
  const validThemes = config.VALID_THEMES;
  if (!themeName) {
    console.log(chalk.cyan(`Current theme: ${chalk.bold(config.getTheme())}`));
    console.log(chalk.gray(`Available: ${validThemes.join(', ')}`));
    return;
  }
  
  if (!validThemes.includes(themeName)) {
    console.error(chalk.red(`❌ Invalid theme: ${themeName}. Use: ${validThemes.join(', ')}`));
    return;
  }
  
  config.setTheme(themeName);
  console.log(chalk.green(`✓ Theme set to ${chalk.bold(themeName)}`));
}

/**
 * Handle the /history command.
 */
function handleHistory() {
  if (currentSessionId) {
    console.log(chalk.cyan('\n┌─ Session Information ─────────────────┐'));
    console.log(chalk.gray(`  ID:        ${chalk.white(currentSessionId)}`));
    console.log(chalk.gray(`  Mode:      ${chalk.cyan(currentMode)}`));
    if (currentModel) {
      console.log(chalk.gray(`  Model:     ${chalk.cyan(currentModel)}`));
    }
    console.log(chalk.gray(`  Short ID:  ${chalk.white(currentSessionId.slice(0, 8))}`));
    console.log(chalk.cyan('└───────────────────────────────────────┘\n'));
  } else {
    console.log(chalk.yellow('⚠ No active session'));
  }
}

/**
 * Handle the /sessions command.
 */
async function handleSessions() {
  const spinner = createSpinner('Loading sessions...');
  spinner.start();
  
  try {
    const history = session.getHistory();
    spinner.stop();
    
    if (history.length === 0) {
      console.log(chalk.yellow('\nNo sessions found. Create one with /new\n'));
      return;
    }
    
    console.log(chalk.cyan.bold('\n┌─ Session History ─────────────────────┐'));
    history.slice(0, 10).forEach((s, i) => {
      const isCurrent = s.id === currentSessionId;
      const prefix = isCurrent ? chalk.green('●') : chalk.gray('○');
      const name = s.name || `Session ${s.id.slice(0, 8)}`;
      const mode = chalk.gray(`[${s.mode || 'chat'}]`);
      const model = s.model ? chalk.gray(`(${s.model})`) : '';
      const date = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : 'unknown';
      console.log(chalk.gray(`  ${prefix} ${name.padEnd(20)} ${mode} ${model} ${chalk.gray(date)}`));
      if (isCurrent) {
        console.log(chalk.gray(`    ${chalk.dim(s.id)}`));
      }
    });
    
    if (history.length > 10) {
      console.log(chalk.gray(`  ... and ${history.length - 10} more`));
    }
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load sessions: ${err.message}`));
  }
}

/**
 * Handle the /clear command.
 */
function handleClear() {
  console.clear();
  printBanner();
}

/**
 * Handle the /url command.
 * @param {string} url - New API URL
 */
function handleUrl(url) {
  if (!url) {
    console.log(chalk.cyan(`Current API URL: ${chalk.bold(config.getApiBaseUrl())}`));
    console.log(chalk.gray('Set with: /url <url>'));
    return;
  }
  
  config.setApiBaseUrl(url);
  console.log(chalk.green(`✓ API URL set to: ${chalk.bold(url)}`));
}

/**
 * Handle the /models command.
 */
function handleModels() {
  if (availableModels.length === 0) {
    console.log(chalk.yellow('⚠ No models available'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n┌─ Available Models ────────────────────┐'));
  availableModels.forEach((model, i) => {
    const isCurrent = currentModel === model.id;
    const prefix = isCurrent ? chalk.green('●') : chalk.gray(`${i + 1}.`);
    const name = chalk.white(model.id);
    const provider = model.owned_by ? chalk.gray(`(${model.owned_by})`) : '';
    console.log(chalk.gray(`  ${prefix} ${name} ${provider}`));
  });
  console.log(chalk.gray('\n  Use /model <id> to select a model'));
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
}

/**
 * Handle the /model command.
 * @param {string} modelId - Model ID to set
 */
function handleModel(modelId) {
  if (!modelId) {
    if (currentModel) {
      console.log(chalk.cyan(`Current model: ${chalk.bold(currentModel)}`));
    } else {
      console.log(chalk.yellow('⚠ No model selected. Using server default.'));
    }
    console.log(chalk.gray('Use /models to list available models'));
    return;
  }
  
  // Validate model exists
  const modelExists = availableModels.some(m => m.id === modelId);
  if (!modelExists && availableModels.length > 0) {
    console.error(chalk.red(`❌ Unknown model: ${modelId}`));
    console.log(chalk.gray('Use /models to list available models'));
    return;
  }
  
  currentModel = modelId;
  config.setDefaultModel(modelId);
  console.log(chalk.green(`✓ Model set to: ${chalk.bold(modelId)}`));
}

/**
 * Handle the /imgmodels command.
 */
function handleImgModels() {
  if (availableImageModels.length === 0) {
    console.log(chalk.yellow('⚠ No image models available'));
    return;
  }
  
  console.log(chalk.cyan.bold('\n┌─ Image Generation Models ─────────────┐'));
  availableImageModels.forEach((model, i) => {
    const name = chalk.white(model.name || model.id);
    const description = model.description ? chalk.gray(`- ${model.description}`) : '';
    console.log(chalk.gray(`  ${i + 1}. ${name} ${description}`));
    if (model.sizes) {
      console.log(chalk.gray(`     Sizes: ${model.sizes.join(', ')}`));
    }
    if (model.qualities) {
      console.log(chalk.gray(`     Qualities: ${model.qualities.join(', ')}`));
    }
    if (model.styles) {
      console.log(chalk.gray(`     Styles: ${model.styles.join(', ')}`));
    }
  });
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
}

/**
 * Parse image generation options from arguments.
 * @param {string[]} args - Command arguments
 * @returns {Object} Parsed options
 */
function parseImageOptions(args) {
  const options = {
    model: null,
    size: '1024x1024',
    quality: 'standard',
    style: 'vivid',
    n: 1,
    output: null,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--model':
      case '-m':
        options.model = args[++i];
        break;
      case '--size':
      case '-s':
        options.size = args[++i];
        break;
      case '--quality':
      case '-q':
        options.quality = args[++i];
        break;
      case '--style':
        options.style = args[++i];
        break;
      case '--n':
      case '-n':
        options.n = parseInt(args[++i], 10) || 1;
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
    }
  }
  
  return options;
}
function parseImageUrlsFromText(text) {
  const source = String(text || '');
  const urls = new Set();
  const patterns = [
    /<img[^>]+src="([^"]+)"/gi,
    /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi,
    /\bhttps?:\/\/[^\s<>"')]+/gi,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const value = match[1] || match[0];
      if (!value) continue;
      if (/^https?:\/\//i.test(value) && /(?:images\.unsplash\.com|plus\.unsplash\.com|images\.openai\.com|blob\.core\.windows\.net|\.(?:png|jpe?g|webp|gif)(?:\?|$))/i.test(value)) {
        urls.add(value);
      }
    }
  });

  return Array.from(urls);
}

function inferImageExtension(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return '.jpg';
    if (pathname.endsWith('.webp')) return '.webp';
    if (pathname.endsWith('.gif')) return '.gif';
    return '.png';
  } catch {
    return '.png';
  }
}

async function handleDownloadImageCommand(args) {
  const parts = args.split(' ').filter(Boolean);
  const target = parts[0];
  const explicitPath = parts[1];

  if (!target) {
    console.log(chalk.yellow('Usage: /download-image <url|index> [output-file]'));
    return true;
  }

  const combinedCandidates = [...lastImageUrls, ...parseImageUrlsFromText(accumulatedResponse)]
    .filter((value, index, array) => value && array.indexOf(value) === index);

  let imageUrl = target;
  if (/^\d+$/.test(target)) {
    imageUrl = combinedCandidates[Number(target) - 1];
    if (!imageUrl) {
      console.log(chalk.yellow(`No image URL found for index ${target}.`));
      return true;
    }
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    console.log(chalk.yellow('Please provide a direct image URL or an index from the last image response.'));
    return true;
  }

  const outputPath = explicitPath || `image-${Date.now()}${inferImageExtension(imageUrl)}`;
  const spinner = createSpinner('Downloading image...');
  spinner.start();
  try {
    await api.downloadImage(imageUrl, outputPath);
    spinner.succeed(chalk.green(`Saved to ${outputPath}`));
  } catch (err) {
    spinner.fail(chalk.red(`Image download failed: ${err.message}`));
  }
  return true;
}

/**
 * Handle the /image command.
 * @param {string} args - Command arguments
 */
async function handleImage(args) {
  if (!args.trim()) {
    console.log(chalk.yellow('⚠ Usage: /image <prompt> [--model model-id] [--size 1024x1024] [--quality hd] [--style vivid]'));
    return;
  }
  
  // Extract prompt and options
  const parts = args.split(' ');
  let prompt = '';
  const options = [];
  
  // Simple parsing - look for quoted prompt or treat everything before first -- as prompt
  if (args.startsWith('"')) {
    const endQuote = args.indexOf('"', 1);
    if (endQuote > 0) {
      prompt = args.slice(1, endQuote);
      const remaining = args.slice(endQuote + 1).trim();
      if (remaining) {
        options.push(...remaining.split(' '));
      }
    } else {
      prompt = args;
    }
  } else {
    // Find first option starting with --
    const firstOption = parts.findIndex(p => p.startsWith('--'));
    if (firstOption >= 0) {
      prompt = parts.slice(0, firstOption).join(' ');
      options.push(...parts.slice(firstOption));
    } else {
      prompt = args;
    }
  }
  
  if (!prompt.trim()) {
    console.log(chalk.yellow('⚠ Please provide a prompt for image generation'));
    return;
  }
  
  const imageOptions = parseImageOptions(options);
  
  const spinner = createSpinner('Generating image...');
  spinner.start();
  
  try {
    const result = await api.generateImage(prompt, {
      ...imageOptions,
      sessionId: currentSessionId,
    });
    
    spinner.stop();
    
    // Update session if returned
    if (result.sessionId && result.sessionId !== currentSessionId) {
      currentSessionId = result.sessionId;
      session.setCurrent(currentSessionId);
    }
    
    console.log(chalk.cyan.bold('\n┌─ Image Generated ─────────────────────┐'));
    console.log(chalk.gray(`  Model: ${chalk.cyan(result.model || imageOptions.model)}`));
    console.log(chalk.gray(`  Size: ${chalk.cyan(result.size || imageOptions.size)}`));
    console.log(chalk.gray(`  Quality: ${chalk.cyan(result.quality || imageOptions.quality)}`));
    console.log(chalk.gray(`  Style: ${chalk.cyan(result.style || imageOptions.style)}`));
    
    if (result.data && result.data.length > 0) {
      lastImageUrls = [];
      for (let i = 0; i < result.data.length; i++) {
        const img = result.data[i];
        console.log(chalk.cyan.bold(`\n  Image ${i + 1}:`));
        
        if (img.revised_prompt) {
          console.log(chalk.gray(`  Revised prompt: ${img.revised_prompt}`));
        }
        
        // Save image if URL or base64 is provided
        if (img.url || img.b64_json) {
          const outputDir = config.getImageOutputDir();
          
          // Ensure output directory exists
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          
          const filename = imageOptions.output || `img_${Date.now()}_${i + 1}.png`;
          const outputPath = path.resolve(outputDir, filename);
          
          if (img.b64_json) {
            // Save base64 image
            const buffer = Buffer.from(img.b64_json, 'base64');
            fs.writeFileSync(outputPath, buffer);
            console.log(chalk.green(`  ✓ Saved to: ${outputPath}`));
          }
          
          if (img.url) {
            lastImageUrls.push(img.url);
            console.log(chalk.gray(`  URL: ${chalk.blue.underline(img.url)}`));
          }
        }
      }
    }
    
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  } catch (err) {
    spinner.fail(chalk.red(`Image generation failed: ${err.message}`));
  }
}

/**
 * Handle the /export command.
 * @param {string} filename - Output filename
 */
async function handleExport(filename) {
  if (!currentSessionId) {
    console.log(chalk.yellow('⚠ No active session to export'));
    return;
  }
  
  const outputPath = filename || `session-${currentSessionId.slice(0, 8)}.json`;
  const spinner = createSpinner('Exporting session...');
  spinner.start();
  
  try {
    const success = session.export(currentSessionId, outputPath);
    if (success) {
      spinner.succeed(chalk.green(`Exported to: ${outputPath}`));
    } else {
      spinner.fail(chalk.red('Export failed'));
    }
  } catch (err) {
    spinner.fail(chalk.red(`Export error: ${err.message}`));
  }
}

/**
 * Handle the /import command.
 * @param {string} filename - Input filename
 */
async function handleImport(filename) {
  if (!filename) {
    console.log(chalk.yellow('⚠ Usage: /import <filename>'));
    return;
  }
  
  const spinner = createSpinner('Importing session...');
  spinner.start();
  
  try {
    const imported = session.import(filename);
    if (imported) {
      currentSessionId = imported.id;
      session.setCurrent(currentSessionId, imported);
      if (imported.model) {
        currentModel = imported.model;
      }
      spinner.succeed(chalk.green(`Imported session: ${imported.name || imported.id.slice(0, 16)}`));
    } else {
      spinner.fail(chalk.red('Import failed. Check file format.'));
    }
  } catch (err) {
    spinner.fail(chalk.red(`Import error: ${err.message}`));
  }
}

/**
 * Handle the /rename command.
 * @param {string} name - New session name
 */
function handleRename(name) {
  if (!currentSessionId) {
    console.log(chalk.yellow('⚠ No active session to rename'));
    return;
  }
  
  if (!name) {
    console.log(chalk.yellow('⚠ Usage: /rename <new-name>'));
    return;
  }
  
  const success = session.rename(currentSessionId, name);
  if (success) {
    console.log(chalk.green(`✓ Renamed session to: ${chalk.bold(name)}`));
  } else {
    console.log(chalk.red('❌ Rename failed'));
  }
}

/**
 * Handle the /delete command.
 * @param {string} sessionId - Session ID to delete
 */
async function handleDelete(sessionId) {
  const targetId = sessionId || currentSessionId;
  
  if (!targetId) {
    console.log(chalk.yellow('⚠ No session specified'));
    return;
  }
  
  const spinner = createSpinner('Deleting session...');
  spinner.start();
  
  try {
    const success = session.remove(targetId);
    if (success) {
      if (targetId === currentSessionId) {
        currentSessionId = null;
      }
      spinner.succeed(chalk.green('Session deleted'));
    } else {
      spinner.fail(chalk.red('Delete failed'));
    }
  } catch (err) {
    spinner.fail(chalk.red(`Delete error: ${err.message}`));
  }
}

async function getSessionCapableProviders(forceReload = false) {
  if (!forceReload && providerCapabilities.length > 0) {
    return providerCapabilities.filter((provider) => provider.supportsSessions === true);
  }

  providerCapabilities = await api.getProviderCapabilities();
  return providerCapabilities.filter((provider) => provider.supportsSessions === true);
}

function printAttachedProviderHelp() {
  console.log(chalk.cyan.bold('\n┌─ Attached Provider Session ───────────┐'));
  console.log(chalk.gray(`  ${chalk.cyan('/.status'.padEnd(16))} Show session details`));
  console.log(chalk.gray(`  ${chalk.cyan('/.interrupt'.padEnd(16))} Send SIGINT to the backend CLI`));
  console.log(chalk.gray(`  ${chalk.cyan('/.detach'.padEnd(16))} Close the backend CLI session`));
  console.log(chalk.gray(`  ${chalk.cyan('/.help'.padEnd(16))} Show these local escape commands`));
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
}

function printProviderSessionStatus() {
  if (!activeProviderSession) {
    console.log(chalk.yellow('⚠ No backend CLI session is attached'));
    return;
  }

  console.log(chalk.cyan.bold('\n┌─ Backend CLI Session ─────────────────┐'));
  console.log(chalk.gray(`  Provider:  ${chalk.cyan(activeProviderSession.providerId)}`));
  console.log(chalk.gray(`  Status:    ${chalk.cyan(activeProviderSession.status || 'unknown')}`));
  console.log(chalk.gray(`  CWD:       ${chalk.white(activeProviderSession.cwd || process.cwd())}`));
  console.log(chalk.gray(`  Session:   ${chalk.white(activeProviderSession.id)}`));
  console.log(chalk.gray(`  Cursor:    ${chalk.white(String(activeProviderSession.lastCursor || 0))}`));
  console.log(chalk.gray(`  Resize:    ${activeProviderSession.supportsResize ? chalk.green('supported') : chalk.yellow('not wired')}`));
  console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
}

async function handleProviders() {
  const spinner = createSpinner('Loading provider capabilities...');
  spinner.start();

  try {
    const providers = await getSessionCapableProviders(true);
    spinner.stop();

    if (providers.length === 0) {
      console.log(chalk.yellow('\nNo session-capable backend CLI providers are available.\n'));
      return;
    }

    console.log(chalk.cyan.bold('\n┌─ Backend CLI Providers ───────────────┐'));
    providers.forEach((provider, index) => {
      const providerId = provider.providerId || provider.id || `provider-${index + 1}`;
      const resizeLabel = provider.supportsResize ? 'resize' : 'fixed-size';
      const modelLabel = provider.supportsModelSelection ? 'model-selectable' : 'default-model';
      console.log(chalk.gray(`  ${index + 1}. ${chalk.cyan(providerId)} ${chalk.gray(`(${resizeLabel}, ${modelLabel})`)}`));
    });
    console.log(chalk.gray('\n  Use /attach <providerId> [cwd] to open a backend CLI session.'));
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load provider capabilities: ${err.message}`));
  }
}

async function detachProviderSession(options = {}) {
  const existingSession = activeProviderSession;
  if (!existingSession) {
    if (!options.silent) {
      console.log(chalk.yellow('⚠ No backend CLI session is attached'));
    }
    return;
  }

  activeProviderSession = null;
  const abortController = providerStreamAbortController;
  providerStreamAbortController = null;
  providerStreamTask = null;
  if (abortController) {
    abortController.abort();
  }
  updatePrompt();

  if (options.deleteRemote !== false) {
    try {
      await api.deleteProviderSession(existingSession.id);
    } catch (err) {
      if (!options.silent) {
        console.log(chalk.yellow(`⚠ Backend session cleanup returned: ${err.message}`));
      }
    }
  }

  if (!options.silent) {
    console.log(chalk.green(`Detached from ${existingSession.providerId}`));
  }
  redrawPrompt();
}

function startProviderSessionStream(sessionRecord) {
  const streamAbortController = new AbortController();
  providerStreamAbortController = streamAbortController;

  providerStreamTask = (async () => {
    let reconnectAttempts = 0;

    while (
      activeProviderSession
      && activeProviderSession.id === sessionRecord.id
      && !streamAbortController.signal.aborted
    ) {
      try {
        const afterCursor = activeProviderSession.lastCursor || undefined;

        for await (const event of api.streamProviderSession(sessionRecord.streamUrl, {
          after: afterCursor,
          signal: streamAbortController.signal,
        })) {
          if (
            !activeProviderSession
            || activeProviderSession.id !== sessionRecord.id
            || streamAbortController.signal.aborted
          ) {
            return;
          }

          if (Number.isFinite(Number(event.cursor))) {
            activeProviderSession.lastCursor = Number(event.cursor);
          }

          if (event.type === 'output' && typeof event.data === 'string') {
            writeAsyncOutput(event.data);
            reconnectAttempts = 0;
            continue;
          }

          if (event.type === 'status') {
            activeProviderSession.status = event.status || activeProviderSession.status;
            if (event.message || event.status) {
              writeAsyncOutput(chalk.gray(`\n[${activeProviderSession.providerId}] ${event.status || 'status'}${event.message ? `: ${event.message}` : ''}\n`));
            }
            reconnectAttempts = 0;
            continue;
          }

          if (event.type === 'exit') {
            activeProviderSession.status = 'exited';
            writeAsyncOutput(chalk.yellow(`\n[${activeProviderSession.providerId}] exited with code ${event.exitCode ?? 'unknown'}\n`));
            await detachProviderSession({ deleteRemote: false, silent: true });
            return;
          }
        }

        if (!activeProviderSession || activeProviderSession.id !== sessionRecord.id || streamAbortController.signal.aborted) {
          return;
        }

        reconnectAttempts += 1;
        if (reconnectAttempts > 3) {
          writeAsyncOutput(chalk.red(`\n[${sessionRecord.providerId}] stream disconnected and could not be resumed.\n`));
          await detachProviderSession({ deleteRemote: false, silent: true });
          return;
        }

        writeAsyncOutput(chalk.gray(`\n[${sessionRecord.providerId}] reconnecting from cursor ${activeProviderSession.lastCursor || 0}...\n`));
        await delay(Math.min(1000 * reconnectAttempts, 3000));
      } catch (err) {
        if (streamAbortController.signal.aborted) {
          return;
        }

        reconnectAttempts += 1;
        if (reconnectAttempts > 3) {
          writeAsyncOutput(chalk.red(`\n[${sessionRecord.providerId}] stream failed: ${err.message}\n`));
          await detachProviderSession({ deleteRemote: false, silent: true });
          return;
        }

        writeAsyncOutput(chalk.gray(`\n[${sessionRecord.providerId}] stream error: ${err.message}. Reconnecting...\n`));
        await delay(Math.min(1000 * reconnectAttempts, 3000));
      }
    }
  })();

  providerStreamTask.catch((err) => {
    if (!streamAbortController.signal.aborted) {
      writeAsyncOutput(chalk.red(`\n[${sessionRecord.providerId}] unexpected stream failure: ${err.message}\n`));
    }
  });
}

async function handleAttach(argString) {
  if (activeProviderSession) {
    console.log(chalk.yellow(`⚠ Already attached to ${activeProviderSession.providerId}. Use /.detach first.`));
    return;
  }

  const match = String(argString || '').trim().match(/^(\S+)(?:\s+(.+))?$/);
  if (!match) {
    console.log(chalk.yellow('Usage: /attach <providerId> [cwd]'));
    console.log(chalk.gray('Examples: /attach codex-cli'));
    console.log(chalk.gray('          /attach gemini-cli C:\\repos\\my-app'));
    return;
  }

  const requestedProviderId = normalizeProviderId(match[1]);
  const requestedCwd = String(match[2] || process.cwd()).trim();
  const spinner = createSpinner(`Opening ${requestedProviderId} session...`);
  spinner.start();

  try {
    const providers = await getSessionCapableProviders(providerCapabilities.length === 0);
    const selectedProvider = providers.find((provider) => normalizeProviderId(provider.providerId || provider.id) === requestedProviderId);
    if (!selectedProvider) {
      throw new Error(`Provider "${requestedProviderId}" is not available for provider sessions`);
    }

    const created = await api.createProviderSession({
      providerId: selectedProvider.providerId || requestedProviderId,
      cwd: requestedCwd,
      cols: process.stdout.columns || 120,
      rows: process.stdout.rows || 40,
    });
    if (!created?.session?.id || !created?.streamUrl) {
      throw new Error('The gateway did not return a provider session id and stream URL');
    }

    activeProviderSession = {
      ...(created.session || {}),
      id: created.session?.id,
      providerId: created.session?.providerId || selectedProvider.providerId || requestedProviderId,
      cwd: created.session?.cwd || requestedCwd,
      status: created.session?.status || 'starting',
      streamUrl: created.streamUrl,
      lastCursor: 0,
      supportsResize: created.session?.supportsResize === true,
    };

    updatePrompt();
    spinner.succeed(chalk.green(`Attached to ${activeProviderSession.providerId} in ${activeProviderSession.cwd}`));
    console.log(chalk.gray('Backend CLI input is now passthrough. Use /.help for local escape commands.\n'));
    startProviderSessionStream(activeProviderSession);
  } catch (err) {
    spinner.fail(chalk.red(`Failed to attach provider session: ${err.message}`));
  }
}

async function handleProviderSignal(signalName = 'SIGINT') {
  if (!activeProviderSession) {
    console.log(chalk.yellow('⚠ No backend CLI session is attached'));
    return;
  }

  try {
    await api.sendProviderSessionSignal(activeProviderSession.id, signalName);
    console.log(chalk.gray(`[${activeProviderSession.providerId}] sent ${signalName}`));
  } catch (err) {
    console.log(chalk.red(`Failed to send ${signalName}: ${err.message}`));
  }
}

async function handleAttachedProviderCommand(input) {
  const trimmed = String(input || '').trim().toLowerCase();

  switch (trimmed) {
    case '/.help':
      printAttachedProviderHelp();
      return true;
    case '/.status':
      printProviderSessionStatus();
      return true;
    case '/.interrupt':
      await handleProviderSignal('SIGINT');
      return true;
    case '/.detach':
      await detachProviderSession();
      return true;
    default:
      console.log(chalk.yellow(`Unknown local provider command: ${input}`));
      console.log(chalk.gray('Use /.help to list local escape commands.'));
      return true;
  }
}

async function sendInputToProviderSession(input) {
  if (!activeProviderSession) {
    return;
  }

  try {
    await api.sendProviderSessionInput(activeProviderSession.id, `${input}\n`);
  } catch (err) {
    console.log(chalk.red(`Failed to send provider input: ${err.message}`));
  }
}

/**
 * Send a message in chat mode.
 * @param {string} message - Message to send
 */
function inferRequestedOutputFormat(message) {
  const text = String(message || '').toLowerCase();
  const checks = [
    ['power-query', /\b(power\s*query|\.(pq|m)\b)/],
    ['xlsx', /\b(xlsx|spreadsheet|excel|workbook)\b/],
    ['pdf', /\bpdf\b/],
    ['docx', /\b(docx|word document)\b/],
    ['xml', /\bxml\b/],
    ['mermaid', /\bmermaid\b/],
    ['html', /\bhtml\b/],
  ];

  return checks.find(([, pattern]) => pattern.test(text))?.[0] || null;
}
async function sendChatMessage(message) {
  if (isProcessing) {
    console.log(chalk.yellow('⚠ Please wait for the current response...'));
    return;
  }
  
  isProcessing = true;
  accumulatedResponse = '';
  
  const timestamp = shouldShowTimestamps 
    ? chalk.gray(`[${new Date().toLocaleTimeString()}] `) 
    : '';
  
  try {
    let hasStarted = false;
    let hasReasoning = false;
    const startTime = Date.now();
    const ensureAnswerPrefix = () => {
      if (hasStarted) {
        return;
      }

      process.stdout.write('\n' + timestamp + aiGradient.bold('\nAI: '));
      hasStarted = true;
    };
    const appendReasoning = (delta) => {
      const content = String(delta || '');
      if (!content) {
        return;
      }

      if (!hasReasoning) {
        process.stdout.write(chalk.gray('\n\nReasoning: '));
        hasReasoning = true;
      }

      process.stdout.write(chalk.gray(content));
    };
    
    const outputFormat = inferRequestedOutputFormat(message);
    const result = await api.chat(
      message,
      currentSessionId,
      (delta) => {
        ensureAnswerPrefix();
        accumulatedResponse += delta;
        process.stdout.write(delta);
      },
      (done) => {
        if (done.sessionId && done.sessionId !== currentSessionId) {
          currentSessionId = done.sessionId;
          session.setCurrent(currentSessionId);
        }
        if (Array.isArray(done.artifacts) && done.artifacts.length > 0) {
          done.artifacts.forEach((artifact) => {
            console.log(chalk.cyan(`\n   File: ${artifact.filename}`));
            console.log(chalk.gray(`   Download: ${artifact.downloadUrl}`));
          });
        }
      },
      currentModel,
      outputFormat,
      appendReasoning
    );
    
    if (result.sessionId && result.sessionId !== currentSessionId) {
      currentSessionId = result.sessionId;
      session.setCurrent(currentSessionId);
    }
    
    const duration = Date.now() - startTime;
    console.log(chalk.gray(`\n\n  (${duration}ms)`));
    console.log('');
  } catch (err) {
    console.error(chalk.red(`\n\n❌ Error: ${err.message}`));
    if (err.statusCode) {
      console.error(chalk.gray(`   Status: ${err.statusCode}`));
    }
  } finally {
    isProcessing = false;
  }
}

/**
 * Send a message in canvas mode.
 * @param {string} message - Message to send
 */
async function sendCanvasMessage(message) {
  if (isProcessing) {
    console.log(chalk.yellow('⚠ Please wait for the current response...'));
    return;
  }
  
  isProcessing = true;
  const spinner = createSpinner('Generating canvas content...');
  spinner.start();
  
  const startTime = Date.now();
  
  try {
    const result = await api.canvas(message, currentSessionId, 'document', '', currentModel);
    spinner.stop();
    
    if (result.sessionId && result.sessionId !== currentSessionId) {
      currentSessionId = result.sessionId;
      session.setCurrent(currentSessionId);
    }
    
    const duration = Date.now() - startTime;
    
    console.log(chalk.cyan.bold('\n┌─ Canvas Result ───────────────────────┐'));
    console.log(chalk.gray(`  Type: ${chalk.cyan(result.canvasType || 'document')}`));
    console.log(chalk.gray(`  Time: ${duration}ms`));
    if (result.metadata) {
      console.log(chalk.gray(`  Meta: ${JSON.stringify(result.metadata)}`));
    }
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
    
    // Render the content as markdown
    if (result.content) {
      console.log(marked(result.content));
    }
    
    if (result.suggestions && result.suggestions.length > 0) {
      console.log(chalk.yellow.bold('\n💡 Suggestions:'));
      result.suggestions.forEach((s, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${s}`));
      });
    }
    console.log('');
  } catch (err) {
    spinner.fail(chalk.red(`Canvas error: ${err.message}`));
  } finally {
    isProcessing = false;
  }
}

/**
 * Send a notation in notation mode.
 * @param {string} notationText - Notation to process
 */
async function sendNotation(notationText) {
  if (isProcessing) {
    console.log(chalk.yellow('⚠ Please wait for the current response...'));
    return;
  }
  
  isProcessing = true;
  const spinner = createSpinner('Processing notation...');
  spinner.start();
  
  const startTime = Date.now();
  
  try {
    const result = await api.notation(notationText, currentSessionId, 'expand', '', currentModel);
    spinner.stop();
    
    if (result.sessionId && result.sessionId !== currentSessionId) {
      currentSessionId = result.sessionId;
      session.setCurrent(currentSessionId);
    }
    
    const duration = Date.now() - startTime;
    
    console.log(chalk.cyan.bold('\n┌─ Notation Result ─────────────────────┐'));
    console.log(chalk.gray(`  Mode: ${chalk.cyan(result.helperMode || 'expand')}`));
    console.log(chalk.gray(`  Time: ${duration}ms`));
    console.log(chalk.cyan.bold('└───────────────────────────────────────┘\n'));
    
    // Render the result as markdown
    if (result.result) {
      console.log(marked(result.result));
    }
    
    if (result.annotations && result.annotations.length > 0) {
      console.log(chalk.yellow.bold('\n📝 Annotations:'));
      result.annotations.forEach((a) => {
        console.log(chalk.gray(`  Line ${chalk.cyan(a.line)}: ${a.note}`));
      });
    }
    
    if (result.suggestions && result.suggestions.length > 0) {
      console.log(chalk.yellow.bold('\n💡 Suggestions:'));
      result.suggestions.forEach((s, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${s}`));
      });
    }
    console.log('');
  } catch (err) {
    spinner.fail(chalk.red(`Notation error: ${err.message}`));
  } finally {
    isProcessing = false;
  }
}

/**
 * Auto-complete a command.
 * @param {string} line - Current input line
 * @returns {Array} [completions, original]
 */
function completer(line) {
  const hits = COMMANDS.filter((c) => c.startsWith(line));
  return [hits.length ? hits : COMMANDS, line];
}

/**
 * Print version information.
 */
function printVersion() {
  console.log(`${CLI_NAME} v${CLI_VERSION}`);
}

/**
 * Process user input.
 * @param {string} input - User input
 * @returns {boolean} Whether to continue
 */
async function processInput(input) {
  const rawInput = String(input || '');
  const trimmed = rawInput.trim();

  if (activeProviderSession) {
    if (trimmed.startsWith(PROVIDER_LOCAL_COMMAND_PREFIX)) {
      return handleAttachedProviderCommand(trimmed);
    }

    await sendInputToProviderSession(rawInput);
    return true;
  }

  if (!trimmed) {
    return true;
  }

  if (trimmed && !commandHistory.includes(trimmed)) {
    commandHistory.push(trimmed);
    if (commandHistory.length > 100) {
      commandHistory.shift();
    }
  }
  
  // Handle commands
  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');
    
    switch (command) {
      case 'new':
        await handleNew();
        return true;
      case 'mode':
        if (!args) {
          console.log(chalk.cyan(`Current mode: ${chalk.bold(currentMode)}`));
        } else {
          handleMode(args.trim());
        }
        return true;
      case 'theme':
        handleTheme(args.trim() || null);
        return true;
      case 'history':
        handleHistory();
        return true;
      case 'sessions':
        await handleSessions();
        return true;
      case 'clear':
        handleClear();
        return true;
      case 'config':
        printConfig();
        return true;
      case 'providers':
        await handleProviders();
        return true;
      case 'attach':
        await handleAttach(args.trim());
        return true;
      case 'provider-status':
        printProviderSessionStatus();
        return true;
      case 'export':
        await handleExport(args.trim() || null);
        return true;
      case 'import':
        await handleImport(args.trim());
        return true;
      case 'rename':
        handleRename(args.trim());
        return true;
      case 'delete':
        await handleDelete(args.trim() || null);
        return true;
      case 'url':
        handleUrl(args.trim() || null);
        return true;
      case 'models':
        handleModels();
        return true;
      case 'model':
        handleModel(args.trim() || null);
        return true;
      case 'imgmodels':
        handleImgModels();
        return true;
      case 'image':
      case 'img':
        await handleImage(args);
        return true;
      case 'download-image':
        await handleDownloadImageCommand(args);
        return true;
      case 'help':
      case '?':
        printHelp();
        return true;
      case 'version':
      case 'v':
        printVersion();
        return true;
      case 'quit':
      case 'exit':
      case 'q':
        console.log(chalk.green('\n👋 Goodbye!\n'));
        return false;
      default:
        console.error(chalk.red(`❌ Unknown command: /${command}. Type /help for available commands.`));
        return true;
    }
  }
  
  // Handle messages based on mode
  switch (currentMode) {
    case 'chat':
      await sendChatMessage(trimmed);
      break;
    case 'canvas':
      await sendCanvasMessage(trimmed);
      break;
    case 'notation':
      await sendNotation(trimmed);
      break;
    default:
      console.error(chalk.red(`❌ Unknown mode: ${currentMode}`));
  }
  
  return true;
}

/**
 * Start the interactive REPL.
 */
function startREPL() {
  printBanner();
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: getPromptValue(),
    completer: completer,
    history: commandHistory,
    historySize: 100,
  });
  readlineInterface = rl;
  updatePrompt();
  
  // Custom key handling for better UX
  rl.input.on('keypress', (char, key) => {
    if (key && key.ctrl && key.name === 'c') {
      if (activeProviderSession) {
        void handleProviderSignal('SIGINT');
        redrawPrompt();
        return;
      }

      if (isProcessing) {
        console.log(chalk.yellow('\n\n⚠ Cancelling... (press Ctrl+C again to exit)'));
        isProcessing = false;
        redrawPrompt();
      } else {
        console.log(chalk.green('\n👋 Goodbye!\n'));
        process.exit(0);
      }
    }
    if (key && key.ctrl && key.name === 'l') {
      handleClear();
      redrawPrompt();
    }
  });
  
  rl.prompt();
  
  rl.on('line', async (input) => {
    const shouldContinue = await processInput(input);
    if (shouldContinue) {
      redrawPrompt();
    } else {
      rl.close();
      process.exit(0);
    }
  });
  
  rl.on('close', () => {
    if (activeProviderSession) {
      void detachProviderSession({ silent: true });
    }
    console.log(chalk.green('\n👋 Goodbye!\n'));
    process.exit(0);
  });
  
  // Handle resize
  process.stdout.on('resize', () => {
    if (!activeProviderSession) {
      return;
    }

    void api.resizeProviderSession(
      activeProviderSession.id,
      process.stdout.columns || 120,
      process.stdout.rows || 40,
    ).catch(() => {
      // The backend reports whether resize actually applied; ignore unsupported responses.
    });
  });
}

/**
 * Handle piped input.
 * @param {string} input - Piped input
 */
async function handlePipedInput(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    console.error(chalk.red('❌ No input provided'));
    process.exit(1);
  }
  
  try {
    const result = await api.chatNonStreaming(trimmed, currentSessionId, currentModel);
    
    if (result.sessionId) {
      session.setCurrent(result.sessionId);
    }
    
    // Render as markdown
    console.log(marked(result.message || result.content || ''));
  } catch (err) {
    console.error(chalk.red(`❌ Error: ${err.message}`));
    process.exit(1);
  }
}

/**
 * Print usage information.
 */
function printUsage() {
  console.log(`
${CLI_NAME} v${CLI_VERSION}

Usage:
  kimibuilt [options]           Start interactive mode
  echo "text" | kimibuilt       Pipe mode (non-interactive)
  kimibuilt [options] < file    Read from file

Options:
  -v, --version                 Show version
  -h, --help                    Show this help
  --api-url <url>               Set API base URL
  --mode <mode>                 Set mode (chat|canvas|notation)
  --model <model>               Set model ID
  --no-stream                   Disable streaming responses
  --theme <theme>               Set theme (default|minimal|colorful|dark)

Environment Variables:
  KIMIBUILT_API_URL             Override API base URL
  KIMIBUILT_FRONTEND_API_KEY    Auth for /admin/provider-sessions gateway calls
  FRONTEND_API_KEY              Alternate auth env var for provider sessions

Provider Session Commands:
  /providers                    List codex-cli, gemini-cli, kimi-cli when enabled
  /attach <provider> [cwd]      Open a backend CLI session in the chosen cwd
  /.help                        Local escape commands while attached

Examples:
  kimibuilt
  kimibuilt --api-url http://localhost:3000
  kimibuilt --model gpt-5.4-mini
  echo "Hello AI" | kimibuilt
  /attach codex-cli
`);
}

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
  const argv = minimist(process.argv.slice(2), {
    alias: {
      v: 'version',
      h: 'help',
    },
    boolean: ['version', 'help', 'stream'],
    default: {
      stream: true,
    },
  });
  return argv;
}

/**
 * Main entry point.
 */
async function main() {
  const argv = parseArgs();
  
  // Handle --version
  if (argv.version) {
    printVersion();
    return;
  }
  
  // Handle --help
  if (argv.help) {
    printUsage();
    return;
  }
  
  // Handle --api-url
  if (argv['api-url']) {
    config.setApiBaseUrl(argv['api-url']);
    currentMode = config.getDefaultMode();
  }
  
  // Handle --mode
  if (argv.mode) {
    if (config.VALID_MODES.includes(argv.mode)) {
      currentMode = argv.mode;
    } else {
      console.error(chalk.red(`❌ Invalid mode: ${argv.mode}`));
      process.exit(1);
    }
  }
  
  // Handle --model
  if (argv.model) {
    currentModel = argv.model;
    config.setDefaultModel(currentModel);
  } else {
    currentModel = config.getDefaultModel();
  }
  
  // Handle --theme
  if (argv.theme) {
    if (config.VALID_THEMES.includes(argv.theme)) {
      config.setTheme(argv.theme);
    } else {
      console.error(chalk.red(`❌ Invalid theme: ${argv.theme}`));
      process.exit(1);
    }
  }
  
  // Check for piped input
  if (!process.stdin.isTTY) {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', async () => {
      await handlePipedInput(data);
    });
    return;
  }
  
  // Check API health before starting
  const spinner = createSpinner('Connecting to API...');
  spinner.start();
  
  try {
    const isHealthy = await api.healthCheck();
    spinner.stop();
    
    if (!isHealthy) {
      console.log(chalk.yellow('\n⚠ Warning: Could not connect to API at ' + config.getApiBaseUrl()));
      console.log(chalk.gray('   The CLI will still start, but commands may fail.\n'));
    }
  } catch {
    spinner.stop();
    console.log(chalk.yellow('\n⚠ Warning: API health check failed'));
    console.log(chalk.gray('   The CLI will still start, but commands may fail.\n'));
  }
  
  // Fetch available models
  await fetchModels();
  await fetchImageModels();
  
  // Start interactive REPL
  startREPL();
}

COMMANDS.push('/upload', '/artifacts', '/download-artifact', '/download-image', '/makefile');

async function handleArtifactUploadCommand(filePath) {
  if (!filePath) {
    console.log(chalk.yellow('Usage: /upload <file-path>'));
    return true;
  }
  if (!currentSessionId) {
    await handleNew();
  }
  const spinner = createSpinner('Uploading artifact...');
  spinner.start();
  try {
    const artifact = await api.uploadArtifact(filePath, currentSessionId, currentMode);
    spinner.succeed(chalk.green(`Uploaded: ${artifact.filename}`));
  } catch (err) {
    spinner.fail(chalk.red(`Upload failed: ${err.message}`));
  }
  return true;
}

async function handleArtifactListCommand() {
  if (!currentSessionId) {
    console.log(chalk.yellow('No active session'));
    return true;
  }
  const spinner = createSpinner('Loading artifacts...');
  spinner.start();
  try {
    const result = await api.listArtifacts(currentSessionId);
    spinner.stop();
    const artifacts = result.artifacts || [];
    if (artifacts.length === 0) {
      console.log(chalk.yellow('\nNo artifacts for this session\n'));
      return true;
    }
    console.log(chalk.cyan.bold('\nArtifacts:'));
    artifacts.forEach((artifact) => {
      console.log(chalk.gray(`  ${artifact.id.slice(0, 8)}  ${artifact.filename}  [${artifact.format}]`));
    });
    console.log('');
  } catch (err) {
    spinner.fail(chalk.red(`Failed to list artifacts: ${err.message}`));
  }
  return true;
}

async function handleArtifactDownloadCommand(args) {
  const [artifactId, outputPath] = args.split(' ').filter(Boolean);
  if (!artifactId) {
    console.log(chalk.yellow('Usage: /download-artifact <artifact-id> [output-file]'));
    return true;
  }
  const spinner = createSpinner('Downloading artifact...');
  spinner.start();
  try {
    const target = outputPath || `artifact-${artifactId.slice(0, 8)}`;
    await api.downloadArtifact(artifactId, target);
    spinner.succeed(chalk.green(`Saved to ${target}`));
  } catch (err) {
    spinner.fail(chalk.red(`Download failed: ${err.message}`));
  }
  return true;
}

async function handleMakeFileCommand(args) {
  const [format, ...promptParts] = args.split(' ');
  const prompt = promptParts.join(' ').trim();
  if (!format || !prompt) {
    console.log(chalk.yellow('Usage: /makefile <format> <prompt>'));
    return true;
  }
  if (!currentSessionId) {
    await handleNew();
  }
  const spinner = createSpinner(`Generating ${format} artifact...`);
  spinner.start();
  try {
    const result = await api.generateArtifact({
      sessionId: currentSessionId,
      mode: currentMode,
      prompt,
      format,
    });
    spinner.succeed(chalk.green(`Generated: ${result.artifact.filename}`));
    console.log(chalk.gray(`Download: ${result.artifact.downloadUrl}`));
  } catch (err) {
    spinner.fail(chalk.red(`Artifact generation failed: ${err.message}`));
  }
  return true;
}

const originalProcessInput = processInput;
processInput = async function(input) {
  const trimmed = String(input || '').trim();
  if (activeProviderSession) {
    return originalProcessInput(input);
  }
  if (trimmed.startsWith('/upload')) {
    return handleArtifactUploadCommand(trimmed.replace('/upload', '').trim());
  }
  if (trimmed === '/artifacts') {
    return handleArtifactListCommand();
  }
  if (trimmed.startsWith('/download-artifact')) {
    return handleArtifactDownloadCommand(trimmed.replace('/download-artifact', '').trim());
  }
  if (trimmed.startsWith('/download-image')) {
    return handleDownloadImageCommand(trimmed.replace('/download-image', '').trim());
  }
  if (trimmed.startsWith('/makefile')) {
    return handleMakeFileCommand(trimmed.replace('/makefile', '').trim());
  }
  return originalProcessInput(input);
};

// Run main
main().catch((err) => {
  console.error(chalk.red(`❌ Fatal error: ${err.message}`));
  process.exit(1);
});














