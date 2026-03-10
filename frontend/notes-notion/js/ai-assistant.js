/**
 * AI Assistant Widget Module
 * Provides contextual AI assistance for notes
 */

// API Base URL
const API_BASE = (function() {
    const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
    const currentHost = window.location.hostname;
    const currentOrigin = `${window.location.protocol}//${window.location.host}`;
    return localHostnames.has(currentHost)
        ? 'http://localhost:3000'
        : currentOrigin;
})();

const AIAssistant = (function() {
    let isCollapsed = false;
    let isContextMode = false;
    let selectedBlocks = [];
    let lastResponse = '';
    let widget = null;
    let toggle = null;
    let contextBlocks = null;
    let input = null;
    let responseArea = null;
    let processingArea = null;
    
    /**
     * Initialize the AI Assistant
     */
    function init() {
        widget = document.getElementById('ai-assistant-widget');
        toggle = document.getElementById('ai-assistant-toggle');
        contextBlocks = document.getElementById('ai-context-blocks');
        input = document.getElementById('ai-assistant-input');
        responseArea = document.getElementById('ai-response-area');
        processingArea = document.getElementById('ai-processing');
        
        if (!widget) return;
        
        setupEventListeners();
        loadState();
        updateContextDisplay();
    }
    
    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Input textarea auto-resize
        if (input) {
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 100) + 'px';
            });
            
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                }
            });
        }
        
        // Listen for block selection from editor
        document.addEventListener('blockSelected', (e) => {
            if (isContextMode) {
                toggleBlockSelection(e.detail.blockId, e.detail.blockType, e.detail.preview);
            }
        });
        
        // Listen for text selection
        document.addEventListener('selectionchange', () => {
            const selection = window.getSelection();
            if (selection.toString().trim() && !isContextMode) {
                // Could auto-add text selection as context
            }
        });
    }
    
    /**
     * Toggle widget collapse state
     */
    function toggleCollapse() {
        isCollapsed = !isCollapsed;
        
        if (isCollapsed) {
            widget.classList.add('collapsed');
            toggle.style.display = 'flex';
        } else {
            widget.classList.remove('collapsed');
            toggle.style.display = 'none';
        }
        
        saveState();
    }
    
    /**
     * Enter context selection mode
     */
    function enterContextMode() {
        isContextMode = true;
        document.body.classList.add('block-context-mode');
        document.getElementById('context-mode-indicator').style.display = 'flex';
        
        // Show checkboxes on blocks
        const blocks = document.querySelectorAll('.block');
        blocks.forEach(block => {
            addSelectionCheckbox(block);
        });
    }
    
    /**
     * Exit context selection mode
     */
    function exitContextMode() {
        isContextMode = false;
        document.body.classList.remove('block-context-mode');
        document.getElementById('context-mode-indicator').style.display = 'none';
        
        // Remove checkboxes
        document.querySelectorAll('.block-select-checkbox').forEach(cb => cb.remove());
    }
    
    /**
     * Add selection checkbox to a block
     */
    function addSelectionCheckbox(blockEl) {
        if (blockEl.querySelector('.block-select-checkbox')) return;
        
        const checkbox = document.createElement('div');
        checkbox.className = 'block-select-checkbox';
        checkbox.onclick = (e) => {
            e.stopPropagation();
            const blockId = blockEl.dataset.blockId;
            const blockType = blockEl.dataset.blockType;
            const preview = blockEl.textContent.substring(0, 50) + '...';
            toggleBlockSelection(blockId, blockType, preview);
            blockEl.classList.toggle('selected');
        };
        
        blockEl.appendChild(checkbox);
    }
    
    /**
     * Toggle block selection
     */
    function toggleBlockSelection(blockId, blockType, preview) {
        const index = selectedBlocks.findIndex(b => b.id === blockId);
        
        if (index >= 0) {
            selectedBlocks.splice(index, 1);
        } else {
            selectedBlocks.push({
                id: blockId,
                type: blockType,
                preview: preview || 'Block content'
            });
        }
        
        updateContextDisplay();
    }
    
    /**
     * Update the context display in the widget
     */
    function updateContextDisplay() {
        if (!contextBlocks) return;
        
        if (selectedBlocks.length === 0) {
            contextBlocks.innerHTML = '<div class="ai-context-empty">Select blocks or text for context</div>';
            return;
        }
        
        contextBlocks.innerHTML = selectedBlocks.map(block => `
            <div class="ai-context-block" data-block-id="${block.id}">
                <span class="block-type-icon">${getBlockIcon(block.type)}</span>
                <span class="block-preview">${escapeHtml(block.preview)}</span>
                <button class="remove-context" onclick="AIAssistant.removeFromContext('${block.id}')" title="Remove">×</button>
            </div>
        `).join('');
    }
    
    /**
     * Remove block from context
     */
    function removeFromContext(blockId) {
        selectedBlocks = selectedBlocks.filter(b => b.id !== blockId);
        
        // Update block UI
        const blockEl = document.querySelector(`.block[data-block-id="${blockId}"]`);
        if (blockEl) {
            blockEl.classList.remove('selected');
        }
        
        updateContextDisplay();
    }
    
    /**
     * Get icon for block type
     */
    function getBlockIcon(type) {
        const icons = {
            text: '📝',
            heading_1: 'H1',
            heading_2: 'H2',
            heading_3: 'H3',
            bulleted_list: '•',
            numbered_list: '1.',
            todo: '☐',
            toggle: '▶',
            quote: '"',
            code: '</>',
            callout: '💡',
            image: '🖼',
            math: '∑',
            bookmark: '🔗',
            database: '📊'
        };
        return icons[type] || '📝';
    }
    
    /**
     * Send request to AI
     */
    async function send() {
        const prompt = input.value.trim();
        if (!prompt) return;
        
        // Get context content
        const context = await buildContext();
        
        showProcessing('Thinking...');
        hideResponse();
        
        try {
            const fullPrompt = buildPrompt(prompt, context);
            
            const response = await fetch(`${API_BASE}/v1/chat/completions` || '/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: window.Editor?.getCurrentModel?.() || 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an AI assistant helping edit a document. You understand note section types like headings, lists, code blocks, etc. Respond with the modified content only, no explanations unless asked.`
                        },
                        { role: 'user', content: fullPrompt }
                    ],
                    stream: true
                })
            });
            
            if (!response.ok) throw new Error('Request failed');
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let result = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(data);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                result += content;
                                updateResponse(result, true);
                            }
                        } catch (e) {
                            // Ignore parse errors
                        }
                    }
                }
            }
            
            lastResponse = result;
            hideProcessing();
            showResponse(result);
            
        } catch (error) {
            hideProcessing();
            showResponse('Error: ' + error.message);
        }
    }
    
    /**
     * Build context from selected blocks
     */
    async function buildContext() {
        if (selectedBlocks.length === 0) return '';
        
        const contextParts = [];
        
        for (const block of selectedBlocks) {
            const blockEl = document.querySelector(`.block[data-block-id="${block.id}"]`);
            if (blockEl) {
                const content = getBlockContent(blockEl);
                contextParts.push(`[${block.type}]\n${content}`);
            }
        }
        
        return contextParts.join('\n\n---\n\n');
    }
    
    /**
     * Get content from a block element
     */
    function getBlockContent(blockEl) {
        const input = blockEl.querySelector('.block-input');
        if (input) {
            return input.innerText || input.textContent;
        }
        return blockEl.textContent || '';
    }
    
    /**
     * Build full prompt with context
     */
    function buildPrompt(prompt, context) {
        let fullPrompt = '';
        
        if (context) {
            fullPrompt += `Context from the document:\n\n${context}\n\n`;
        }
        
        fullPrompt += `Request: ${prompt}\n\n`;
        fullPrompt += `Provide the response in the appropriate format for the content type.`;
        
        return fullPrompt;
    }
    
    /**
     * Quick action buttons
     */
    function quickAction(action) {
        const prompts = {
            improve: 'Improve this content while keeping the same format and structure:',
            expand: 'Expand this content with more details and examples:',
            summarize: 'Summarize this content concisely:',
            fix: 'Fix any grammar, spelling, or clarity issues in this content:'
        };
        
        input.value = prompts[action] || '';
        input.focus();
        
        // Auto-resize
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    }
    
    /**
     * Insert response below selected blocks
     */
    function insertBelow() {
        if (!lastResponse || !window.Editor) return;
        
        const targetBlock = selectedBlocks[selectedBlocks.length - 1];
        if (targetBlock) {
            // Parse response and create appropriate blocks
            const blocks = parseResponseToBlocks(lastResponse);
            
            let lastId = targetBlock.id;
            blocks.forEach(block => {
                const newBlock = window.Editor.insertBlockAfter(lastId, block.type, block.content);
                if (newBlock) lastId = newBlock.id;
            });
        }
        
        clearResponse();
    }
    
    /**
     * Replace selected blocks with response
     */
    function replaceSelected() {
        if (!lastResponse || !window.Editor || selectedBlocks.length === 0) return;
        
        const firstBlock = selectedBlocks[0];
        const blocks = parseResponseToBlocks(lastResponse);
        
        // Replace first block
        if (blocks.length > 0) {
            window.Editor.updateBlockContent(firstBlock.id, blocks[0].content);
            
            // Insert remaining blocks after
            let lastId = firstBlock.id;
            blocks.slice(1).forEach(block => {
                const newBlock = window.Editor.insertBlockAfter(lastId, block.type, block.content);
                if (newBlock) lastId = newBlock.id;
            });
        }
        
        // Remove other selected blocks
        selectedBlocks.slice(1).forEach(block => {
            window.Editor.deleteBlock(block.id);
        });
        
        clearResponse();
    }
    
    /**
     * Parse AI response into blocks
     */
    function parseResponseToBlocks(text) {
        const blocks = [];
        const lines = text.split('\n');
        let currentCode = null;
        let currentText = [];
        
        for (const line of lines) {
            // Code block detection
            if (line.startsWith('```')) {
                if (currentCode) {
                    blocks.push({
                        type: 'code',
                        content: { language: currentCode.lang, text: currentCode.lines.join('\n') }
                    });
                    currentCode = null;
                } else {
                    if (currentText.length) {
                        blocks.push(...parseTextBlock(currentText.join('\n')));
                        currentText = [];
                    }
                    currentCode = { lang: line.slice(3).trim() || 'plain', lines: [] };
                }
                continue;
            }
            
            if (currentCode) {
                currentCode.lines.push(line);
                continue;
            }
            
            // Heading detection
            if (line.startsWith('# ')) {
                if (currentText.length) {
                    blocks.push(...parseTextBlock(currentText.join('\n')));
                    currentText = [];
                }
                blocks.push({ type: 'heading_1', content: line.slice(2) });
            } else if (line.startsWith('## ')) {
                if (currentText.length) {
                    blocks.push(...parseTextBlock(currentText.join('\n')));
                    currentText = [];
                }
                blocks.push({ type: 'heading_2', content: line.slice(3) });
            } else if (line.startsWith('### ')) {
                if (currentText.length) {
                    blocks.push(...parseTextBlock(currentText.join('\n')));
                    currentText = [];
                }
                blocks.push({ type: 'heading_3', content: line.slice(4) });
            } else {
                currentText.push(line);
            }
        }
        
        // Remaining text
        if (currentText.length) {
            blocks.push(...parseTextBlock(currentText.join('\n')));
        }
        
        if (currentCode) {
            blocks.push({
                type: 'code',
                content: { language: currentCode.lang, text: currentCode.lines.join('\n') }
            });
        }
        
        return blocks.length ? blocks : [{ type: 'text', content: text }];
    }
    
    /**
     * Parse text into paragraphs
     */
    function parseTextBlock(text) {
        const paragraphs = text.split('\n\n').filter(p => p.trim());
        return paragraphs.map(p => ({ type: 'text', content: p.trim() }));
    }
    
    /**
     * Show processing state
     */
    function showProcessing(text) {
        if (processingArea) {
            document.getElementById('ai-processing-text').textContent = text;
            processingArea.style.display = 'flex';
        }
    }
    
    /**
     * Hide processing state
     */
    function hideProcessing() {
        if (processingArea) {
            processingArea.style.display = 'none';
        }
    }
    
    /**
     * Update streaming response
     */
    function updateResponse(text, streaming = false) {
        const responseEl = document.getElementById('ai-response');
        if (responseEl) {
            responseEl.textContent = text;
            responseEl.classList.toggle('streaming', streaming);
        }
    }
    
    /**
     * Show final response
     */
    function showResponse(text) {
        updateResponse(text, false);
        if (responseArea) {
            responseArea.style.display = 'block';
        }
    }
    
    /**
     * Hide response area
     */
    function hideResponse() {
        if (responseArea) {
            responseArea.style.display = 'none';
        }
    }
    
    /**
     * Clear response
     */
    function clearResponse() {
        lastResponse = '';
        hideResponse();
        updateResponse('');
    }
    
    /**
     * Escape HTML
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Save state to localStorage
     */
    function saveState() {
        localStorage.setItem('ai-assistant-collapsed', isCollapsed);
    }
    
    /**
     * Load state from localStorage
     */
    function loadState() {
        isCollapsed = localStorage.getItem('ai-assistant-collapsed') === 'true';
        if (isCollapsed) {
            widget.classList.add('collapsed');
            toggle.style.display = 'flex';
        }
    }
    
    /**
     * Add a block to context
     */
    function addToContext(blockId, blockType, preview) {
        if (!selectedBlocks.find(b => b.id === blockId)) {
            selectedBlocks.push({ id: blockId, type: blockType, preview });
            updateContextDisplay();
        }
    }
    
    /**
     * Clear all context
     */
    function clearContext() {
        selectedBlocks = [];
        document.querySelectorAll('.block.selected').forEach(el => el.classList.remove('selected'));
        updateContextDisplay();
    }
    
    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);
    
    // Public API
    return {
        toggleCollapse,
        enterContextMode,
        exitContextMode,
        toggleBlockSelection,
        removeFromContext,
        send,
        quickAction,
        insertBelow,
        replaceSelected,
        addToContext,
        clearContext
    };
})();
