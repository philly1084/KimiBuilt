/**
 * Document Creator Module for Web-Chat
 * Adds /create command and document generation UI
 */

class DocumentCreator {
  constructor(apiClient) {
    this.api = apiClient;
    this.templates = [];
    this.categories = [];
    this.currentTemplate = null;
    this.modalElement = null;
    this.planRefreshTimer = null;
    
    this.init();
  }

  getActiveSessionId() {
    const sessionId = window.sessionManager?.currentSessionId
      || this.api?.getSessionId?.()
      || '';
    const normalized = String(sessionId || '').trim();
    return normalized && !normalized.startsWith('local_')
      ? normalized
      : '';
  }

  async refreshArtifactInventory() {
    try {
      await window.artifactManager?.refresh?.();
      if (window.fileManager?.isOpen) {
        await window.fileManager.refreshFiles();
      }
    } catch (error) {
      console.warn('[DocumentCreator] Failed to refresh artifact inventory:', error);
    }
  }

  async init() {
    // Load templates on init
    await this.loadTemplates();
    
    // Create modal UI
    this.createModal();
    
    // Add event listeners for slash command
    this.setupSlashCommand();
  }

  /**
   * Load available templates from API
   */
  async loadTemplates() {
    try {
      const response = await fetch('/api/documents/templates');
      const data = await response.json();
      this.templates = data.templates;
      this.categories = data.categories;
    } catch (error) {
      console.error('[DocumentCreator] Failed to load templates:', error);
      this.templates = this.getDefaultTemplates();
    }
  }

  /**
   * Get default templates if API fails
   */
  getDefaultTemplates() {
    return [
      { id: 'business-letter', name: 'Business Letter', category: 'business', icon: '📄', formats: ['docx', 'pdf'] },
      { id: 'resume-modern', name: 'Resume', category: 'personal', icon: '👤', formats: ['docx', 'pdf'] },
      { id: 'meeting-notes', name: 'Meeting Notes', category: 'business', icon: '📋', formats: ['docx', 'pdf', 'md'] },
      { id: 'project-proposal', name: 'Project Proposal', category: 'business', icon: '📊', formats: ['docx', 'pdf'] }
    ];
  }

  /**
   * Create the modal UI for document creation
   */
  createModal() {
    // Check if modal already exists
    if (document.getElementById('document-creator-modal')) {
      return;
    }

    const modal = document.createElement('div');
    modal.id = 'document-creator-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="documentCreator.closeModal()"></div>
      <div class="modal-content document-creator-content">
        <div class="modal-header">
          <h3 id="doc-creator-title">
            <span id="doc-creator-icon">📄</span>
            Create Document
          </h3>
          <button class="btn-icon" onclick="documentCreator.closeModal()" aria-label="Close">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>
        
        <div class="document-creator-body">
          <!-- Step 1: Template Selection -->
          <div id="doc-step-1" class="doc-step">
            <div class="doc-search">
              <i data-lucide="search" class="w-4 h-4"></i>
              <input type="text" id="doc-template-search" 
                     placeholder="Search templates..." 
                     oninput="documentCreator.filterTemplates(this.value)">
            </div>
            
            <div class="doc-categories">
              <button class="doc-category-btn active" data-category="all" onclick="documentCreator.selectCategory('all')">
                All
              </button>
              <button class="doc-category-btn" data-category="business" onclick="documentCreator.selectCategory('business')">
                Business
              </button>
              <button class="doc-category-btn" data-category="personal" onclick="documentCreator.selectCategory('personal')">
                Personal
              </button>
              <button class="doc-category-btn" data-category="creative" onclick="documentCreator.selectCategory('creative')">
                Creative
              </button>
              <button class="doc-category-btn" data-category="technical" onclick="documentCreator.selectCategory('technical')">
                Technical
              </button>
            </div>
            
            <div id="doc-templates-grid" class="doc-templates-grid">
              <!-- Templates rendered here -->
            </div>
          </div>
          
          <!-- Step 2: Variable Input -->
          <div id="doc-step-2" class="doc-step hidden">
            <button class="doc-back-btn" onclick="documentCreator.goToStep(1)">
              <i data-lucide="arrow-left" class="w-4 h-4"></i>
              Back to templates
            </button>
            
            <h4 id="doc-selected-template-name">Template Name</h4>
            <p id="doc-selected-template-desc" class="doc-template-desc"></p>
            
            <form id="doc-variables-form" class="doc-variables-form">
              <!-- Variable inputs rendered here -->
            </form>
            
            <div class="doc-format-selector">
              <label>Output Format:</label>
              <div id="doc-format-options" class="doc-format-options">
                <!-- Format options rendered here -->
              </div>
            </div>
          </div>
          
          <!-- Step 3: AI Generation -->
          <div id="doc-step-3" class="doc-step hidden">
            <button class="doc-back-btn" onclick="documentCreator.goToStep(1)">
              <i data-lucide="arrow-left" class="w-4 h-4"></i>
              Back
            </button>
            
            <h4>✨ AI Document Generation</h4>
            <p class="doc-template-desc">Describe the document you want to create</p>
            
            <div class="doc-ai-prompt-area">
              <textarea id="doc-ai-prompt" 
                        placeholder="Example: Create a project proposal for a mobile app that helps people track their carbon footprint. Budget: $50,000. Timeline: 6 months."
                        rows="6"></textarea>
            </div>
            
            <div class="doc-ai-options">
              <div class="doc-option-group">
                <label>Document Type:</label>
                <select id="doc-ai-type">
                  <option value="">Auto-detect</option>
                  <option value="proposal">Proposal</option>
                  <option value="report">Report</option>
                  <option value="executive-brief">Executive Brief</option>
                  <option value="data-story">Data Story</option>
                  <option value="letter">Letter</option>
                  <option value="memo">Memo</option>
                  <option value="presentation">Presentation</option>
                  <option value="pitch-deck">Pitch Deck</option>
                  <option value="website-slides">Website Slides</option>
                </select>
              </div>
              
              <div class="doc-option-group">
                <label>Tone:</label>
                <select id="doc-ai-tone">
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="technical">Technical</option>
                  <option value="academic">Academic</option>
                </select>
              </div>
              
              <div class="doc-option-group">
                <label>Length:</label>
                <select id="doc-ai-length">
                  <option value="short">Short</option>
                  <option value="medium" selected>Medium</option>
                  <option value="long">Long</option>
                  <option value="detailed">Detailed</option>
                </select>
              </div>

              <div class="doc-option-group">
                <label>Visual Style:</label>
                <select id="doc-ai-style">
                  <option value="editorial">Editorial</option>
                  <option value="executive">Executive</option>
                  <option value="product">Product</option>
                  <option value="bold">Bold</option>
                </select>
              </div>
              
              <div class="doc-option-group">
                <label>Format:</label>
                <select id="doc-ai-format">
                  <option value="docx">Word (DOCX)</option>
                  <option value="pdf">PDF</option>
                  <option value="html">HTML / Website</option>
                  <option value="pptx">Slides (PPTX)</option>
                </select>
              </div>
            </div>

            <div id="doc-ai-recommendation" class="doc-ai-recommendation hidden"></div>
          </div>
          
          <!-- Progress/Loading -->
          <div id="doc-step-loading" class="doc-step hidden">
            <div class="doc-loading">
              <div class="doc-loading-spinner"></div>
              <p id="doc-loading-text">Generating document...</p>
              <div class="doc-progress-bar">
                <div class="doc-progress-fill" id="doc-progress-fill"></div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer" id="doc-modal-footer">
          <button class="btn-secondary" onclick="documentCreator.closeModal()">Cancel</button>
          <button class="btn-primary" id="doc-action-btn" onclick="documentCreator.executeAction()">
            Create Document
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalElement = modal;
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
    
    // Render initial templates
    this.renderTemplates();
    this.setupAIGenerationAssist();
  }

  /**
   * Setup slash command handling
   */
  setupSlashCommand() {
    // Hook into existing slash command system in app.js
    const originalExecuteSlashCommand = window.app?.executeSlashCommand;
    
    window.executeSlashCommand = (command) => {
      const parts = command.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');
      
      if (cmd === 'create') {
        this.openModal(args);
        return true;
      }
      
      // Call original handler if exists
      if (originalExecuteSlashCommand) {
        return originalExecuteSlashCommand(command);
      }
      
      return false;
    };
  }

  /**
   * Open the document creator modal
   */
  openModal(templateHint = '') {
    if (!this.modalElement) {
      this.createModal();
    }
    
    this.modalElement.classList.remove('hidden');
    this.clearProductionPlan();
    
    // If a template hint was provided, try to find and select it
    if (templateHint) {
      const template = this.templates.find(t => 
        t.id === templateHint || 
        t.name.toLowerCase().includes(templateHint.toLowerCase())
      );
      if (template) {
        this.selectTemplate(template.id);
        return;
      }
    }
    
    this.goToStep(1);
  }

  /**
   * Close the modal
   */
  closeModal() {
    if (this.modalElement) {
      this.modalElement.classList.add('hidden');
    }
    clearTimeout(this.planRefreshTimer);
    this.clearProductionPlan();
  }

  /**
   * Navigate to a specific step
   */
  goToStep(step) {
    document.querySelectorAll('.doc-step').forEach(el => el.classList.add('hidden'));
    document.getElementById(`doc-step-${step}`)?.classList.remove('hidden');
    
    // Update action button
    const actionBtn = document.getElementById('doc-action-btn');
    if (step === 1) {
      actionBtn.textContent = 'Use AI Instead ✨';
      actionBtn.onclick = () => this.goToStep(3);
    } else if (step === 2) {
      actionBtn.textContent = 'Generate Document';
      actionBtn.onclick = () => this.generateFromTemplate();
    } else if (step === 3) {
      actionBtn.textContent = 'Generate with AI';
      actionBtn.onclick = () => this.generateWithAI();
      this.refreshProductionPlan(true);
    }
  }

  setupAIGenerationAssist() {
    const promptInput = document.getElementById('doc-ai-prompt');
    const typeSelect = document.getElementById('doc-ai-type');
    const formatSelect = document.getElementById('doc-ai-format');
    const toneSelect = document.getElementById('doc-ai-tone');
    const lengthSelect = document.getElementById('doc-ai-length');

    if (promptInput) {
      promptInput.addEventListener('input', () => this.scheduleProductionPlanRefresh());
    }

    [typeSelect, formatSelect, toneSelect, lengthSelect].forEach((element) => {
      if (element) {
        element.addEventListener('change', () => this.scheduleProductionPlanRefresh());
      }
    });
  }

  scheduleProductionPlanRefresh() {
    clearTimeout(this.planRefreshTimer);
    this.planRefreshTimer = setTimeout(() => {
      this.refreshProductionPlan();
    }, 250);
  }

  async refreshProductionPlan(force = false) {
    const panel = document.getElementById('doc-ai-recommendation');
    const step = document.getElementById('doc-step-3');
    if (!panel || !step || step.classList.contains('hidden')) {
      return;
    }

    const prompt = document.getElementById('doc-ai-prompt')?.value?.trim() || '';
    const documentType = document.getElementById('doc-ai-type')?.value || '';
    const format = document.getElementById('doc-ai-format')?.value || '';
    const tone = document.getElementById('doc-ai-tone')?.value || 'professional';
    const length = document.getElementById('doc-ai-length')?.value || 'medium';

    if (!force && !prompt && !documentType) {
      this.clearProductionPlan();
      return;
    }

    try {
      const response = await fetch('/api/documents/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          documentType,
          format,
          tone,
          length,
          limit: 3,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to build document plan');
      }

      const data = await response.json();
      this.renderProductionPlan(data.plan || null);
    } catch (error) {
      console.error('[DocumentCreator] Failed to build production plan:', error);
      this.clearProductionPlan();
    }
  }

  renderProductionPlan(plan) {
    const panel = document.getElementById('doc-ai-recommendation');
    if (!panel || !plan) {
      this.clearProductionPlan();
      return;
    }

    const recommendedTemplates = Array.isArray(plan.recommendedTemplates) ? plan.recommendedTemplates : [];
    const outline = Array.isArray(plan.outline) ? plan.outline : [];
    const outlineMarkup = outline.slice(0, 4).map((item) => {
      const label = item.title || item.heading || `Step ${item.index || ''}`.trim();
      const detail = item.purpose || '';
      return `
        <div class="doc-plan-outline-item">
          <strong>${label}</strong>
          <span>${detail}</span>
        </div>
      `;
    }).join('');
    const templateMarkup = recommendedTemplates.map((template) => `
      <button type="button" class="doc-plan-template-chip" onclick="documentCreator.useRecommendedTemplate('${template.id}')">
        ${template.icon || '📄'} ${template.name}
      </button>
    `).join('');
    const formatButtons = (plan.recommendedFormats || []).map((entry) => `
      <button type="button" class="doc-plan-format-chip${entry === plan.recommendedFormat ? ' is-active' : ''}" onclick="documentCreator.applyRecommendedFormat('${entry}')">
        ${entry.toUpperCase()}
      </button>
    `).join('');

    panel.innerHTML = `
      <div class="doc-plan-header">
        <div>
          <div class="doc-plan-eyebrow">Production Plan</div>
          <h5>${plan.titleSuggestion || 'Suggested plan'}</h5>
        </div>
        <span class="doc-plan-pipeline">${plan.pipeline || 'document'}</span>
      </div>
      <p class="doc-plan-summary">${plan.blueprint?.goal || ''}</p>
      <div class="doc-plan-meta">
        <span><strong>Blueprint:</strong> ${plan.blueprint?.label || plan.inferredType || 'document'}</span>
        <span><strong>Suggested format:</strong> ${String(plan.recommendedFormat || '').toUpperCase()}</span>
      </div>
      <div class="doc-plan-format-row">${formatButtons}</div>
      <div class="doc-plan-outline">${outlineMarkup}</div>
      ${templateMarkup ? `<div class="doc-plan-templates"><span>Start from template:</span>${templateMarkup}</div>` : ''}
    `;
    panel.classList.remove('hidden');
  }

  clearProductionPlan() {
    clearTimeout(this.planRefreshTimer);
    const panel = document.getElementById('doc-ai-recommendation');
    if (!panel) {
      return;
    }

    panel.classList.add('hidden');
    panel.innerHTML = '';
  }

  applyRecommendedFormat(format) {
    const formatSelect = document.getElementById('doc-ai-format');
    if (formatSelect) {
      formatSelect.value = format;
      this.scheduleProductionPlanRefresh();
    }
  }

  useRecommendedTemplate(templateId) {
    if (!templateId) {
      return;
    }

    this.selectTemplate(templateId);
  }

  /**
   * Render templates grid
   */
  renderTemplates(category = 'all') {
    const grid = document.getElementById('doc-templates-grid');
    if (!grid) return;
    
    const filtered = category === 'all' 
      ? this.templates 
      : this.templates.filter(t => t.category === category);
    
    grid.innerHTML = filtered.map(template => `
      <div class="doc-template-card" onclick="documentCreator.selectTemplate('${template.id}')">
        <div class="doc-template-icon">${template.icon || '📄'}</div>
        <div class="doc-template-name">${template.name}</div>
        <div class="doc-template-desc-small">${template.description || ''}</div>
        <div class="doc-template-formats">
          ${template.formats.map(f => `<span class="doc-format-badge">${f.toUpperCase()}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }

  /**
   * Filter templates by search query
   */
  filterTemplates(query) {
    const cards = document.querySelectorAll('.doc-template-card');
    const lowerQuery = query.toLowerCase();
    
    cards.forEach(card => {
      const name = card.querySelector('.doc-template-name')?.textContent.toLowerCase() || '';
      const desc = card.querySelector('.doc-template-desc-small')?.textContent.toLowerCase() || '';
      
      if (name.includes(lowerQuery) || desc.includes(lowerQuery)) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  /**
   * Select a category
   */
  selectCategory(category) {
    document.querySelectorAll('.doc-category-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.category === category) {
        btn.classList.add('active');
      }
    });
    
    this.renderTemplates(category);
  }

  /**
   * Select a template
   */
  async selectTemplate(templateId) {
    // Fetch template details
    try {
      const response = await fetch(`/api/documents/templates/${templateId}`);
      const data = await response.json();
      this.currentTemplate = data.template;
    } catch (error) {
      // Use cached template
      this.currentTemplate = this.templates.find(t => t.id === templateId);
    }
    
    if (!this.currentTemplate) return;
    
    // Update UI
    document.getElementById('doc-selected-template-name').textContent = this.currentTemplate.name;
    document.getElementById('doc-selected-template-desc').textContent = this.currentTemplate.description || '';
    document.getElementById('doc-creator-icon').textContent = this.currentTemplate.icon || '📄';
    
    // Render variable inputs
    this.renderVariableInputs();
    
    // Render format options
    this.renderFormatOptions();
    
    // Go to step 2
    this.goToStep(2);
  }

  /**
   * Render variable input form
   */
  renderVariableInputs() {
    const form = document.getElementById('doc-variables-form');
    if (!form || !this.currentTemplate) return;
    
    const variables = this.getTemplateVariables();
    
    form.innerHTML = variables.map(variable => {
      const inputId = `var-${variable.id}`;
      const defaultValue = variable.type === 'array' && Array.isArray(variable.default)
        ? JSON.stringify(variable.default, null, 2)
        : (variable.default || '');
      
      switch (variable.type) {
        case 'textarea':
        case 'richtext':
          return `
            <div class="doc-form-group">
              <label for="${inputId}">${variable.label}${variable.required ? ' *' : ''}</label>
              <textarea id="${inputId}" 
                        name="${variable.id}"
                        rows="${variable.rows || 4}"
                        ${variable.required ? 'required' : ''}
                        placeholder="${variable.placeholder || ''}">${defaultValue}</textarea>
              ${variable.hint ? `<span class="doc-input-hint">${variable.hint}</span>` : ''}
            </div>
          `;
          
        case 'array':
          return `
            <div class="doc-form-group">
              <label for="${inputId}">${variable.label}${variable.required ? ' *' : ''}</label>
              <textarea id="${inputId}"
                        name="${variable.id}"
                        rows="${variable.rows || 8}"
                        ${variable.required ? 'required' : ''}
                        placeholder="${this.buildArrayPlaceholder(variable)}">${defaultValue}</textarea>
              <span class="doc-input-hint">Enter valid JSON for repeatable items such as slides.</span>
            </div>
          `;

        case 'boolean':
          return `
            <div class="doc-form-group">
              <label class="doc-checkbox-label" for="${inputId}">
                <input type="checkbox" id="${inputId}"
                       name="${variable.id}"
                       ${variable.default ? 'checked' : ''}>
                <span>${variable.label}</span>
              </label>
              ${variable.description ? `<span class="doc-input-hint">${variable.description}</span>` : ''}
            </div>
          `;

        case 'select':
          return `
            <div class="doc-form-group">
              <label for="${inputId}">${variable.label}${variable.required ? ' *' : ''}</label>
              <select id="${inputId}" name="${variable.id}" ${variable.required ? 'required' : ''}>
                ${(variable.options || []).map(opt => {
                  const value = typeof opt === 'string' ? opt : opt.value;
                  const label = typeof opt === 'string' ? opt : opt.label;
                  return `<option value="${value}" ${value === variable.default ? 'selected' : ''}>${label}</option>`;
                }).join('')}
              </select>
            </div>
          `;
          
        case 'date':
          const today = new Date().toISOString().split('T')[0];
          return `
            <div class="doc-form-group">
              <label for="${inputId}">${variable.label}${variable.required ? ' *' : ''}</label>
              <input type="date" id="${inputId}" 
                     name="${variable.id}"
                     value="${today}"
                     ${variable.required ? 'required' : ''}>
            </div>
          `;
          
        default: // text, email, tel, url
          return `
            <div class="doc-form-group">
              <label for="${inputId}">${variable.label}${variable.required ? ' *' : ''}</label>
              <input type="${variable.type || 'text'}" id="${inputId}" 
                     name="${variable.id}"
                     value="${defaultValue}"
                     placeholder="${variable.placeholder || ''}"
                     ${variable.required ? 'required' : ''}>
              ${variable.hint ? `<span class="doc-input-hint">${variable.hint}</span>` : ''}
            </div>
          `;
      }
    }).join('');
  }

  /**
   * Render format selection options
   */
  renderFormatOptions() {
    const container = document.getElementById('doc-format-options');
    if (!container || !this.currentTemplate) return;
    
    const formats = Array.from(new Set([
      ...(Array.isArray(this.currentTemplate.formats) ? this.currentTemplate.formats : []),
      ...(Array.isArray(this.currentTemplate.recommendedFormats) ? this.currentTemplate.recommendedFormats : []),
    ]));
    const formatLabels = { docx: 'Word', pdf: 'PDF', html: 'HTML', md: 'Markdown', pptx: 'PowerPoint' };
    const availableFormats = formats.length > 0 ? formats : ['docx'];
    
    container.innerHTML = availableFormats.map((format, index) => `
      <label class="doc-format-option">
        <input type="radio" name="doc-format" value="${format}" ${index === 0 ? 'checked' : ''}>
        <span class="doc-format-label">${formatLabels[format] || format.toUpperCase()}</span>
      </label>
    `).join('');
  }

  /**
   * Generate document from template
   */
  async generateFromTemplate() {
    if (!this.currentTemplate) return;
    
    // Collect variables
    const form = document.getElementById('doc-variables-form');
    const formData = new FormData(form);
    const variables = {};
    const variableDefs = this.getTemplateVariables();
    
    try {
      for (const variable of variableDefs) {
        if (!variable?.id) {
          continue;
        }

        if (variable.type === 'boolean') {
          variables[variable.id] = formData.get(variable.id) === 'on';
          continue;
        }

        if (variable.type === 'array') {
          variables[variable.id] = this.parseArrayInput(formData.get(variable.id), variable);
          continue;
        }

        variables[variable.id] = formData.get(variable.id) || '';
      }
    } catch (error) {
      this.showError(error.message || 'Invalid template input.');
      return;
    }
    
    // Get selected format
    const format = document.querySelector('input[name="doc-format"]:checked')?.value || 'docx';
    const sessionId = this.getActiveSessionId();
    
    // Show loading
    this.showLoading('Generating document...');
    
    try {
      const response = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          templateId: this.currentTemplate.id,
          variables,
          format,
          options: {
            includePageNumbers: true,
            includeHeaders: true
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to generate document');
      }
      
      // Get filename from header
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch
        ? filenameMatch[1]
        : (window.uiHelpers?.createUniqueFilename?.(this.currentTemplate?.name || 'document', format, 'document') || `document.${format}`);
      
      // Download the file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Show success and close
      await this.refreshArtifactInventory();
      this.showSuccess(`Document created: ${filename}`);
      setTimeout(() => this.closeModal(), 1500);
      
    } catch (error) {
      console.error('[DocumentCreator] Generation failed:', error);
      this.showError('Failed to generate document. Please try again.');
    }
  }

  /**
   * Generate document with AI
   */
  async generateWithAI() {
    const prompt = document.getElementById('doc-ai-prompt').value.trim();
    if (!prompt) {
      this.showError('Please enter a description of the document you want to create.');
      return;
    }
    
    const documentType = document.getElementById('doc-ai-type').value;
    const tone = document.getElementById('doc-ai-tone').value;
    const length = document.getElementById('doc-ai-length').value;
    const style = document.getElementById('doc-ai-style').value;
    const format = document.getElementById('doc-ai-format').value;
    const sessionId = this.getActiveSessionId();
    
    this.showLoading('AI is generating your document...');
    
    try {
      const response = await fetch('/api/documents/ai-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId || undefined,
          prompt,
          documentType,
          tone,
          length,
          format,
          options: {
            includePageNumbers: true,
            includeTableOfContents: true,
            theme: style,
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('AI generation failed');
      }
      
      const data = await response.json();
      
      if (data.success) {
        // Fetch and download the document
        const docResponse = await fetch(data.downloadUrl);
        const blob = await docResponse.blob();
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.document.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        await this.refreshArtifactInventory();
        this.showSuccess(`Document created: ${data.document.filename}`);
        setTimeout(() => this.closeModal(), 1500);
      }
      
    } catch (error) {
      console.error('[DocumentCreator] AI generation failed:', error);
      this.showError('Failed to generate document with AI. Please try again.');
    }
  }

  getTemplateVariables() {
    const rawVariables = this.currentTemplate?.variables || [];
    if (Array.isArray(rawVariables)) {
      return rawVariables;
    }

    if (rawVariables && typeof rawVariables === 'object') {
      return Object.entries(rawVariables).map(([id, variable]) => ({
        id,
        ...(variable || {}),
      }));
    }

    return [];
  }

  buildArrayPlaceholder(variable = {}) {
    if (variable?.itemFields && typeof variable.itemFields === 'object') {
      const fieldEntries = Object.entries(variable.itemFields);
      const example = {};
      fieldEntries.forEach(([fieldId, fieldDef]) => {
        if (fieldDef?.type === 'textarea') {
          example[fieldId] = fieldId === 'bullets'
            ? ['Point one', 'Point two']
            : `${fieldDef.label || fieldId} text`;
        } else if (fieldDef?.type === 'select' && Array.isArray(fieldDef.options) && fieldDef.options.length > 0) {
          const firstOption = fieldDef.options[0];
          example[fieldId] = typeof firstOption === 'string' ? firstOption : firstOption.value;
        } else {
          example[fieldId] = fieldDef?.placeholder || fieldDef?.label || fieldId;
        }
      });
      return JSON.stringify([example], null, 2);
    }

    return '[\n  {\n    "title": "Slide title",\n    "bullets": ["Point one", "Point two"]\n  }\n]';
  }

  parseArrayInput(rawValue, variable = {}) {
    const text = String(rawValue || '').trim();
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error();
      }
      return parsed;
    } catch (_error) {
      throw new Error(`"${variable.label || variable.id}" must be valid JSON array input.`);
    }
  }

  /**
   * Show loading state
   */
  showLoading(message) {
    document.querySelectorAll('.doc-step').forEach(el => el.classList.add('hidden'));
    document.getElementById('doc-step-loading').classList.remove('hidden');
    document.getElementById('doc-loading-text').textContent = message;
    document.getElementById('doc-modal-footer').style.display = 'none';
  }

  /**
   * Show success message
   */
  showSuccess(message) {
    document.getElementById('doc-step-loading').innerHTML = `
      <div class="doc-success">
        <i data-lucide="check-circle" class="w-12 h-12 text-green-500"></i>
        <p>${message}</p>
      </div>
    `;
    lucide.createIcons();
  }

  /**
   * Show error message
   */
  showError(message) {
    // Could use toast notification
    if (window.uiHelpers?.showToast) {
      uiHelpers.showToast(message, 'error');
    } else {
      alert(message);
    }
  }

  /**
   * Export chat conversation as formatted document
   */
  async exportChatAsDocument(format = 'docx') {
    const messages = window.sessionManager?.getMessages?.(window.sessionManager.currentSessionId) || [];
    const session = window.sessionManager?.getCurrentSession?.();
    
    if (messages.length === 0) {
      this.showError('No messages to export');
      return;
    }
    
    this.showLoading('Creating document from conversation...');
    
    try {
      // Use the chat export API with document format
      const response = await fetch('/api/documents/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sources: [{
            type: 'chat-session',
            sessionId: session?.id,
            messages: messages
          }],
          format,
          options: {
            title: session?.title || 'Conversation',
            includeTimestamps: true,
            includeTOC: messages.length > 10
          }
        })
      });
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = window.uiHelpers?.createUniqueFilename?.(session?.title || 'conversation', format, 'conversation')
        || `conversation.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      this.showSuccess('Conversation exported successfully!');
      setTimeout(() => this.closeModal(), 1500);
      
    } catch (error) {
      console.error('[DocumentCreator] Export failed:', error);
      this.showError('Failed to export conversation');
    }
  }
}

// CSS styles for document creator
const documentCreatorStyles = `
<style>
.document-creator-content {
  max-width: 700px;
  max-height: 85vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.document-creator-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.doc-step {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.doc-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 16px;
}

.doc-search input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
}

.doc-search input:focus {
  outline: none;
}

.doc-categories {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.doc-category-btn {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.doc-category-btn:hover,
.doc-category-btn.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.doc-templates-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}

.doc-template-card {
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.doc-template-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.doc-template-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.doc-template-name {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 4px;
}

.doc-template-desc-small {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.3;
}

.doc-template-formats {
  display: flex;
  gap: 4px;
  justify-content: center;
  margin-top: 8px;
}

.doc-format-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.doc-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 16px;
  padding: 0;
}

.doc-back-btn:hover {
  text-decoration: underline;
}

.doc-variables-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 16px 0;
}

.doc-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.doc-form-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.doc-form-group input,
.doc-form-group textarea,
.doc-form-group select {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 14px;
}

.doc-form-group input:focus,
.doc-form-group textarea:focus,
.doc-form-group select:focus {
  outline: none;
  border-color: var(--accent);
}

.doc-input-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.doc-format-selector {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
}

.doc-format-selector label {
  font-size: 13px;
  font-weight: 500;
  display: block;
  margin-bottom: 10px;
}

.doc-format-options {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.doc-format-option {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.doc-format-option:hover {
  border-color: var(--accent);
}

.doc-format-option input[type="radio"] {
  display: none;
}

.doc-format-option:has(input:checked) {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.doc-ai-prompt-area textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 14px;
  resize: vertical;
}

.doc-ai-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 16px;
}

.doc-option-group label {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  margin-bottom: 4px;
}

.doc-option-group select {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.doc-ai-recommendation {
  margin-top: 18px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
}

.doc-plan-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.doc-plan-eyebrow {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.doc-plan-header h5 {
  margin: 0;
  font-size: 15px;
}

.doc-plan-pipeline {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  padding: 4px 8px;
  border-radius: 999px;
}

.doc-plan-summary {
  margin: 10px 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.doc-plan-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-secondary);
}

.doc-plan-format-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.doc-plan-format-chip,
.doc-plan-template-chip {
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.doc-plan-format-chip:hover,
.doc-plan-template-chip:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.doc-plan-format-chip.is-active {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.doc-plan-outline {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}

.doc-plan-outline-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg-secondary);
}

.doc-plan-outline-item strong {
  font-size: 13px;
}

.doc-plan-outline-item span {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.doc-plan-templates {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 14px;
}

.doc-plan-templates span {
  font-size: 12px;
  color: var(--text-secondary);
}

.doc-loading {
  text-align: center;
  padding: 40px;
}

.doc-loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.doc-progress-bar {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 20px;
}

.doc-progress-fill {
  height: 100%;
  background: var(--accent);
  width: 0%;
  animation: progress 2s ease-in-out infinite;
}

@keyframes progress {
  0% { width: 0%; }
  50% { width: 70%; }
  100% { width: 100%; }
}

.doc-success {
  text-align: center;
  padding: 40px;
}

.doc-success svg {
  margin-bottom: 16px;
}
</style>
`;

// Inject styles
document.head.insertAdjacentHTML('beforeend', documentCreatorStyles);

// Initialize document creator
let documentCreator;
document.addEventListener('DOMContentLoaded', () => {
  documentCreator = new DocumentCreator(window.apiClient);
  window.documentCreator = documentCreator;
});
