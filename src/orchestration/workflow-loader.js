const fs = require('fs/promises');
const path = require('path');
const { buildServiceConfig, parseWorkflowMarkdown, validateDispatchConfig } = require('./symphony');

function normalizeWorkflowPath(workflowPath = '', cwd = process.cwd()) {
  const requested = String(workflowPath || '').trim() || 'WORKFLOW.md';
  return path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(cwd, requested);
}

class WorkflowLoader {
  constructor({
    workflowPath = '',
    cwd = process.cwd(),
    env = process.env,
    logger = console,
    fsImpl = fs,
  } = {}) {
    this.workflowPath = normalizeWorkflowPath(workflowPath, cwd);
    this.env = env;
    this.logger = logger;
    this.fs = fsImpl;
    this.lastGood = null;
    this.lastError = null;
    this.watcher = null;
  }

  async load() {
    let contents = '';
    try {
      contents = await this.fs.readFile(this.workflowPath, 'utf8');
    } catch (error) {
      const wrapped = new Error(`missing_workflow_file: ${this.workflowPath}`);
      wrapped.code = 'missing_workflow_file';
      wrapped.cause = error;
      this.lastError = wrapped;
      throw wrapped;
    }

    try {
      const definition = parseWorkflowMarkdown(contents);
      const serviceConfig = buildServiceConfig(definition.config, this.env);
      const validation = validateDispatchConfig(serviceConfig);
      const loaded = {
        workflowPath: this.workflowPath,
        definition,
        serviceConfig,
        validation,
        loadedAt: new Date().toISOString(),
      };
      if (validation.ok) {
        this.lastGood = loaded;
        this.lastError = null;
      }
      return loaded;
    } catch (error) {
      if (!error.code) {
        error.code = String(error.message || '').startsWith('workflow_front_matter_not_a_map')
          ? 'workflow_front_matter_not_a_map'
          : 'workflow_parse_error';
      }
      this.lastError = error;
      throw error;
    }
  }

  async loadLastGoodOrThrow() {
    try {
      return await this.load();
    } catch (error) {
      if (this.lastGood) {
        this.logger.warn?.(`[Symphony] workflow_reload_failed using_last_good=true error=${error.message}`);
        return this.lastGood;
      }
      throw error;
    }
  }

  watch(onReload = () => {}) {
    if (this.watcher) {
      return this.watcher;
    }
    const nativeFs = require('fs');
    this.watcher = nativeFs.watch(this.workflowPath, { persistent: false }, async () => {
      try {
        const loaded = await this.load();
        onReload(null, loaded);
      } catch (error) {
        this.logger.error?.(`[Symphony] workflow_reload_failed path=${this.workflowPath} error=${error.message}`);
        onReload(error, this.lastGood);
      }
    });
    return this.watcher;
  }

  close() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = {
  WorkflowLoader,
  normalizeWorkflowPath,
};
