/**
 * AI Integration Module - AI features for the editor
 */

const AIIntegration = (function() {
    let isGenerating = false;
    let selectionToolbar = null;
    let availableModels = [];
    let currentModel = null;
    
    /**
     * Initialize AI integration
     */
    async function init() {
        setupSelectionToolbar();
        setupAIModal();
        
        // Load available models
        try {
            availableModels = await API.getModels();
            currentModel = availableModels[0]?.id || 'gpt-4o';
        } catch (err) {
            console.warn('Failed to load models:', err);
            availableModels = [
                { id: 'gpt-4o', name: 'GPT-4o' },
                { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
                { id: 'claude-3-opus', name: 'Claude 3 Opus' },
                { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet' }
            ];
            currentModel = 'gpt-4o';
        }
        
        // Load page default model if available
        const page = window.Editor?.getCurrentPage?.();
        if (page?.defaultModel) {
            currentModel = page.defaultModel;
        }
    }
    
    /**
     * Setup selection toolbar (Ask AI on text select)
     */
    function setupSelectionToolbar() {
        document.addEventListener('selectionchange', debounce(() => {
            handleSelectionChange();
        }, 100));
        
        // Also handle mouseup for immediate response
        document.addEventListener('mouseup', () => {
            setTimeout(handleSelectionChange, 10);
        });
    }
    
    /**
     * Handle text selection change
     */
    function handleSelectionChange() {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        
        if (text.length > 0 && text.split(' ').length >= 2) {
            showSelectionToolbar(selection);
        } else {
            hideSelectionToolbar();
        }
    }
    
    /**
     * Show selection toolbar
     */
    function showSelectionToolbar(selection) {
        hideSelectionToolbar();
        
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        // Get current model (from page or global)
        const page = window.Editor?.getCurrentPage?.();
        const model = page?.defaultModel || currentModel || 'gpt-4o';
        const modelName = availableModels.find(m => m.id === model)?.name || model;
        
        const toolbar = document.createElement('div');
        toolbar.className = 'selection-toolbar';
        toolbar.innerHTML = `
            <button class="toolbar-btn" data-action="improve" title="Improve writing">Improve</button>
            <button class="toolbar-btn" data-action="shorten" title="Make shorter">Shorten</button>
            <button class="toolbar-btn" data-action="lengthen" title="Make longer">Lengthen</button>
            <button class="toolbar-btn" data-action="professional" title="Professional tone">Professional</button>
            <button class="toolbar-btn" data-action="casual" title="Casual tone">Casual</button>
            <div class="toolbar-divider"></div>
            <div class="toolbar-model-selector">
                <span class="toolbar-model-label">with</span>
                <select class="toolbar-model-dropdown" title="Select AI model">
                    ${availableModels.map(m => `<option value="${m.id}" ${m.id === model ? 'selected' : ''}>${m.name}</option>`).join('')}
                </select>
            </div>
            <button class="toolbar-btn primary" data-action="ask" title="Ask AI">Ask AI ✨</button>
        `;
        
        // Calculate position
        const toolbarWidth = 450;
        let left = rect.left + (rect.width / 2) - (toolbarWidth / 2);
        let top = rect.bottom + 8;
        
        // Keep on screen
        if (left < 10) left = 10;
        if (left + toolbarWidth > window.innerWidth - 10) {
            left = window.innerWidth - toolbarWidth - 10;
        }
        if (top + 50 > window.innerHeight) {
            top = rect.top - 50;
        }
        
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
        
        // Handle model selection
        const modelDropdown = toolbar.querySelector('.toolbar-model-dropdown');
        modelDropdown.addEventListener('change', (e) => {
            const selectedModel = e.target.value;
            currentModel = selectedModel;
            
            // Update page default model
            const page = window.Editor?.getCurrentPage?.();
            if (page) {
                page.defaultModel = selectedModel;
                window.Editor?.savePage?.();
            }
        });
        
        toolbar.addEventListener('click', (e) => {
            const btn = e.target.closest('.toolbar-btn');
            if (!btn) return;
            
            const action = btn.dataset.action;
            const selectedText = selection.toString();
            const selectedModel = toolbar.querySelector('.toolbar-model-dropdown').value;
            
            hideSelectionToolbar();
            
            if (action === 'ask') {
                showAIModal(selectedText, selectedModel);
            } else {
                applyAIAction(action, selectedText, selection, selectedModel);
            }
        });
        
        document.body.appendChild(toolbar);
        selectionToolbar = toolbar;
        
        // Close on click outside
        const closeToolbar = (e) => {
            if (!toolbar.contains(e.target)) {
                hideSelectionToolbar();
                document.removeEventListener('click', closeToolbar);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closeToolbar);
        }, 0);
    }
    
    /**
     * Hide selection toolbar
     */
    function hideSelectionToolbar() {
        if (selectionToolbar) {
            selectionToolbar.remove();
            selectionToolbar = null;
        }
    }
    
    /**
     * Apply AI action to selected text
     */
    async function applyAIAction(action, text, selection, model = null) {
        if (isGenerating) return;
        
        isGenerating = true;
        showLoading('Generating...');
        
        try {
            // Build prompt based on action
            const actionPrompts = {
                improve: `Improve the following text to make it clearer and more engaging:\n\n${text}`,
                shorten: `Make the following text shorter and more concise:\n\n${text}`,
                lengthen: `Expand the following text with more detail:\n\n${text}`,
                professional: `Rewrite the following text in a professional tone:\n\n${text}`,
                casual: `Rewrite the following text in a casual, friendly tone:\n\n${text}`,
            };
            
            const prompt = actionPrompts[action] || `${action}: ${text}`;
            const result = await API.generate(prompt, model);
            // Extract string response - handle various response formats
            let responseText = result;
            if (result && typeof result === 'object') {
                responseText = result.response || result.text || result.content || JSON.stringify(result);
            }
            responseText = String(responseText || '');
            
            // Replace selected text
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(responseText));
            
            // Trigger input event for save
            const block = range.commonAncestorContainer.closest?.('.block');
            if (block) {
                const input = block.querySelector('.block-input');
                if (input) {
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            
            // Show model info in toast
            const modelName = model || 'default';
            showToast(`AI transformation complete (${modelName})`, 'success');
        } catch (error) {
            showToast('AI generation failed: ' + error.message, 'error');
        } finally {
            isGenerating = false;
            hideLoading();
        }
    }
    
    /**
     * Setup AI modal
     */
    function setupAIModal() {
        const modal = document.getElementById('ai-modal');
        if (!modal) return;
        
        // Generate button
        const generateBtn = document.getElementById('ai-generate');
        if (generateBtn) {
            generateBtn.addEventListener('click', handleAIGenerate);
        }
        
        // Cancel button
        const cancelBtn = document.getElementById('ai-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideAIModal);
        }
        
        // Suggestion buttons - improved with more options
        const suggestions = [
            { text: 'Summarize', prompt: 'Summarize this concisely' },
            { text: 'Improve writing', prompt: 'Improve the writing of this' },
            { text: 'Fix grammar', prompt: 'Fix spelling and grammar' },
            { text: 'Make shorter', prompt: 'Make this shorter and more concise' },
            { text: 'Make longer', prompt: 'Expand on this with more detail' },
            { text: 'Professional', prompt: 'Rewrite in a professional tone' },
            { text: 'Casual', prompt: 'Rewrite in a casual, friendly tone' },
            { text: 'Bullet points', prompt: 'Convert to bullet points' },
            { text: 'Brainstorm', prompt: 'Brainstorm ideas about' }
        ];
        
        const suggestionsContainer = modal.querySelector('.ai-suggestions');
        if (suggestionsContainer) {
            suggestionsContainer.innerHTML = suggestions.map(s => `
                <div class="ai-suggestion" data-prompt="${s.prompt}">${s.text}</div>
            `).join('');
            
            suggestionsContainer.querySelectorAll('.ai-suggestion').forEach(btn => {
                btn.addEventListener('click', () => {
                    const prompt = btn.dataset.prompt;
                    const promptInput = document.getElementById('ai-prompt');
                    if (promptInput) {
                        const selectedText = promptInput.dataset.selectedText || '';
                        if (selectedText) {
                            promptInput.value = `${prompt}: "${selectedText}"`;
                        } else {
                            promptInput.value = prompt;
                        }
                        promptInput.focus();
                    }
                });
            });
        }
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideAIModal();
            }
        });
        
        // Enter to submit
        const promptInput = document.getElementById('ai-prompt');
        if (promptInput) {
            promptInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleAIGenerate();
                }
            });
        }
    }
    
    /**
     * Show AI modal
     */
    function showAIModal(selectedText = '', model = null) {
        const modal = document.getElementById('ai-modal');
        const promptInput = document.getElementById('ai-prompt');
        
        if (!modal || !promptInput) return;
        
        promptInput.value = '';
        promptInput.dataset.selectedText = selectedText;
        promptInput.dataset.selectedModel = model || '';
        
        if (selectedText) {
            promptInput.placeholder = 'What would you like to do with the selected text?';
        } else {
            promptInput.placeholder = 'Ask AI to write something... (e.g., "Write a project proposal", "Explain quantum computing", "Create a to-do list")';
        }
        
        modal.style.display = 'flex';
        promptInput.focus();
    }
    
    /**
     * Hide AI modal
     */
    function hideAIModal() {
        const modal = document.getElementById('ai-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
    
    /**
     * Handle AI generate button
     */
    async function handleAIGenerate() {
        const promptInput = document.getElementById('ai-prompt');
        const prompt = promptInput?.value?.trim();
        const selectedModel = promptInput?.dataset?.selectedModel;
        
        if (!prompt || isGenerating) return;
        
        isGenerating = true;
        
        // Get model from page default, selection, or current
        const page = window.Editor?.getCurrentPage?.();
        const model = selectedModel || page?.defaultModel || currentModel;
        
        // Show loading state
        const generateBtn = document.getElementById('ai-generate');
        const originalText = generateBtn?.textContent;
        if (generateBtn) {
            generateBtn.textContent = 'Generating...';
            generateBtn.disabled = true;
        }
        
        try {
            const result = await API.generate(prompt, model);
            const generatedText = typeof result === 'string'
                ? result
                : (result?.response || result?.text || result?.content || '');
              
            // Insert result as new block
            const page = window.Editor?.getCurrentPage?.();
            if (page && page.blocks.length > 0) {
                const lastBlock = page.blocks[page.blocks.length - 1];
                window.Editor?.insertBlockAfter?.(lastBlock.id, 'text', generatedText);
            }
            
            hideAIModal();
            showToast(`Content generated (${model || 'default'})`, 'success');
        } catch (error) {
            showToast('Generation failed: ' + error.message, 'error');
        } finally {
            isGenerating = false;
            if (generateBtn) {
                generateBtn.textContent = originalText;
                generateBtn.disabled = false;
            }
        }
    }
    
    /**
     * Generate content from prompt (for AI blocks)
     */
    async function generateContent(prompt, onProgress, model = null) {
        if (isGenerating) return null;
        
        isGenerating = true;
        
        // Get model from page default or current
        const page = window.Editor?.getCurrentPage?.();
        const useModel = model || page?.defaultModel || currentModel;
        
        try {
            // Try streaming first
            if (onProgress) {
                let fullText = '';
                for await (const chunk of API.streamChat(prompt, null, [], useModel)) {
                    if (chunk.type === 'delta' && chunk.content) {
                        fullText += chunk.content;
                        onProgress(fullText);
                    }
                }
                return { text: fullText, model: useModel };
            } else {
                const result = await API.generate(prompt, useModel);
                return { text: result, model: useModel };
            }
        } catch (error) {
            console.error('Generation error:', error);
            throw error;
        } finally {
            isGenerating = false;
        }
    }
    
    /**
     * Continue writing from context
     */
    async function continueWriting(context, onProgress, model = null) {
        const prompt = `Continue writing from here:\n\n${context}`;
        return generateContent(prompt, onProgress, model);
    }
    
    /**
     * Summarize content
     */
    async function summarize(content, model = null) {
        return API.generate(`Summarize the following content:\n\n${content}`, model);
    }
    
    /**
     * Extract action items
     */
    async function extractActionItems(content, model = null) {
        const prompt = `Extract action items from the following text as a todo list:\n\n${content}`;
        return API.generate(prompt, model);
    }
    
    /**
     * Get available models
     */
    function getAvailableModels() {
        return availableModels;
    }
    
    /**
     * Get current model
     */
    function getCurrentModel() {
        return currentModel;
    }
    
    /**
     * Set current model
     */
    function setCurrentModel(model) {
        currentModel = model;
    }
    
    /**
     * Show loading overlay
     */
    function showLoading(message = 'Loading...') {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }
    
    /**
     * Hide loading overlay
     */
    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    /**
     * Show toast notification
     */
    function showToast(message, type = 'info') {
        if (window.Sidebar?.showToast) {
            window.Sidebar.showToast(message, type);
        }
    }
    
    /**
     * Debounce utility
     */
    function debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }
    
    return {
        init,
        showAIModal,
        hideAIModal,
        generateContent,
        continueWriting,
        summarize,
        extractActionItems,
        getAvailableModels,
        getCurrentModel,
        setCurrentModel
    };
})();
