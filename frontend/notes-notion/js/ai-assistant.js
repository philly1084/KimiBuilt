/**
 * AI Assistant Widget Module - Bottom Right Version
 * Provides contextual AI assistance with smart context selection
 */

// API Base URL
const AI_BASE_URL = (function() {
    const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
    const currentHost = window.location.hostname;
    const currentOrigin = `${window.location.protocol}//${window.location.host}`;
    return localHostnames.has(currentHost) ? 'http://localhost:3000' : currentOrigin;
})();

const AIAssistant = (function() {
    let isCollapsed = false;
    let isMinimized = false;
    let contextMenuOpen = false;
    let references = []; // Current context references
    let lastResponse = '';
    let selectedText = null; // Currently highlighted text
    
    // DOM Elements
    let widget = null;
    let toggle = null;
    let contextMenu = null;
    let contextRefs = null;
    let input = null;
    let responseArea = null;
    let processingArea = null;
    
    /**
     * Initialize the AI Assistant
     */
    function init() {
        widget = document.getElementById('ai-assistant-widget');
        toggle = document.getElementById('ai-assistant-toggle');
        contextMenu = document.getElementById('ai-context-menu');
        contextRefs = document.getElementById('ai-context-references');
        input = document.getElementById('ai-assistant-input');
        responseArea = document.getElementById('ai-response-area');
        processingArea = document.getElementById('ai-processing');
        
        if (!widget) return;
        
        setupEventListeners();
        loadState();
        updateReferencesDisplay();
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
        
        // Text selection tracking
        document.addEventListener('mouseup', handleTextSelection);
        document.addEventListener('keyup', handleTextSelection);
        
        // Close context menu when clicking outside
        document.addEventListener('click', (e) => {
            if (contextMenu && !contextMenu.contains(e.target) && !e.target.closest('.ai-add-context-btn')) {
                hideContextMenu();
            }
        });
        
        // Keyboard shortcut to open AI assistant (Ctrl+Shift+A)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'A') {
                e.preventDefault();
                restore();
            }
        });
    }
    
    /**
     * Handle text selection
     */
    function handleTextSelection() {
        const selection = window.getSelection();
        const text = selection.toString().trim();
        
        if (text && text.length > 10) {
            selectedText = {
                text: text,
                preview: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                source: getCurrentPageTitle()
            };
            
            // Auto-add as a highlight reference if not already present
            const exists = references.some(ref => 
                ref.type === 'highlight' && ref.text === text
            );
            
            if (!exists) {
                addReference({
                    type: 'highlight',
                    id: 'highlight-' + Date.now(),
                    text: text,
                    preview: selectedText.preview,
                    source: selectedText.source
                });
            }
        }
    }
    
    /**
     * Get current page title
     */
    function getCurrentPageTitle() {
        const titleInput = document.getElementById('page-title');
        return titleInput ? titleInput.value || 'Untitled' : 'Current Page';
    }
    
    /**
     * Toggle widget collapsed state (compact view)
     */
    function toggleCollapse() {
        isCollapsed = !isCollapsed;
        
        if (isCollapsed) {
            widget.classList.add('collapsed');
        } else {
            widget.classList.remove('collapsed');
        }
        
        saveState();
    }
    
    /**
     * Minimize to just the floating button
     */
    function minimize() {
        isMinimized = true;
        widget.classList.add('minimized');
        toggle.style.display = 'flex';
        hideContextMenu();
        saveState();
    }
    
    /**
     * Restore from minimized state
     */
    function restore() {
        isMinimized = false;
        widget.classList.remove('minimized');
        widget.classList.remove('collapsed');
        toggle.style.display = 'none';
        
        if (input) {
            setTimeout(() => input.focus(), 100);
        }
        
        saveState();
    }
    
    /**
     * Show context selector menu
     */
    function showContextMenu() {
        if (!contextMenu) return;
        
        contextMenu.style.display = 'block';
        contextMenuOpen = true;
        
        // Populate pages and sections
        populateContextMenu();
    }
    
    /**
     * Hide context selector menu
     */
    function hideContextMenu() {
        if (!contextMenu) return;
        contextMenu.style.display = 'none';
        contextMenuOpen = false;
    }
    
    /**
     * Populate context menu with available pages and sections
     */
    function populateContextMenu() {
        const pagesSection = document.getElementById('ai-context-pages-section');
        const sectionsSection = document.getElementById('ai-context-sections-section');
        
        // Get all pages from sidebar
        const pages = getAllPages();
        if (pagesSection && pages.length > 0) {
            const pagesList = pages.filter(p => !p.isCurrent).map(page => {
                const isSelected = references.some(ref => ref.type === 'page' && ref.id === page.id);
                return `
                    <div class="ai-context-menu-item ${isSelected ? 'selected' : ''}" 
                         onclick="AIAssistant.togglePageReference('${page.id}', '${escapeJs(page.title)}')">
                        <span class="icon">📄</span>
                        <span>${escapeHtml(page.title)}</span>
                        <span class="check">✓</span>
                    </div>
                `;
            }).join('');
            
            pagesSection.innerHTML = pagesList ? 
                '<div class="ai-context-menu-header" style="font-size: 11px; padding: 8px 16px;">Other Pages</div>' + pagesList : '';
        }
        
        // Get sections from current page
        const sections = getPageSections();
        if (sectionsSection) {
            const sectionsList = sections.map(section => {
                const isSelected = references.some(ref => ref.type === 'section' && ref.id === section.id);
                return `
                    <div class="ai-context-menu-item ${isSelected ? 'selected' : ''}" 
                         onclick="AIAssistant.toggleSectionReference('${section.id}', '${escapeJs(section.title)}', '${section.type}')">
                        <span class="icon">${getBlockIcon(section.type)}</span>
                        <span>${escapeHtml(section.preview)}</span>
                        <span class="check">✓</span>
                    </div>
                `;
            }).join('');
            
            sectionsSection.innerHTML = sectionsList ? 
                '<div class="ai-context-menu-header" style="font-size: 11px; padding: 8px 16px;">Sections</div>' + sectionsList : '';
        }
    }
    
    /**
     * Get all pages from the sidebar/storage
     */
    function getAllPages() {
        const pages = [];
        const currentPageId = window.Editor?.getCurrentPage?.()?.id;
        
        // Try to get from Storage if available
        if (window.Storage) {
            const allPages = window.Storage.getAllPages?.() || [];
            allPages.forEach(page => {
                pages.push({
                    id: page.id,
                    title: page.title || 'Untitled',
                    isCurrent: page.id === currentPageId
                });
            });
        }
        
        // Fallback: get from sidebar page tree
        if (pages.length === 0) {
            const pageTree = document.getElementById('page-tree');
            if (pageTree) {
                pageTree.querySelectorAll('.page-tree-item').forEach(item => {
                    const pageId = item.dataset.pageId;
                    const titleEl = item.querySelector('.page-title-text');
                    if (pageId && titleEl) {
                        pages.push({
                            id: pageId,
                            title: titleEl.textContent || 'Untitled',
                            isCurrent: pageId === currentPageId
                        });
                    }
                });
            }
        }
        
        return pages;
    }
    
    /**
     * Get sections from current page
     */
    function getPageSections() {
        const sections = [];
        const editor = document.getElementById('editor');
        
        if (editor) {
            editor.querySelectorAll('.block').forEach((block, index) => {
                const type = block.dataset.blockType;
                const blockId = block.dataset.blockId;
                const input = block.querySelector('.block-input');
                const content = input ? input.textContent : '';
                
                // Only include headings and substantial blocks
                if (type && (type.startsWith('heading') || content.length > 20)) {
                    sections.push({
                        id: blockId,
                        type: type,
                        title: content.substring(0, 50),
                        preview: content.substring(0, 60) + (content.length > 60 ? '...' : '')
                    });
                }
            });
        }
        
        return sections;
    }
    
    /**
     * Add current page as context
     */
    function addCurrentPageContext() {
        const currentPage = window.Editor?.getCurrentPage?.();
        if (currentPage) {
            const pageRef = {
                type: 'page',
                id: currentPage.id,
                title: currentPage.title || 'Untitled',
                preview: 'Full page content'
            };
            
            // Toggle
            const existing = references.findIndex(ref => ref.type === 'page' && ref.id === currentPage.id);
            if (existing >= 0) {
                references.splice(existing, 1);
            } else {
                addReference(pageRef);
            }
            
            populateContextMenu(); // Refresh
        }
    }
    
    /**
     * Toggle page reference
     */
    function togglePageReference(pageId, pageTitle) {
        const existing = references.findIndex(ref => ref.type === 'page' && ref.id === pageId);
        
        if (existing >= 0) {
            references.splice(existing, 1);
        } else {
            addReference({
                type: 'page',
                id: pageId,
                title: pageTitle,
                preview: 'Full page'
            });
        }
        
        populateContextMenu(); // Refresh
    }
    
    /**
     * Toggle section reference
     */
    function toggleSectionReference(blockId, preview, blockType) {
        const existing = references.findIndex(ref => ref.id === blockId);
        
        if (existing >= 0) {
            references.splice(existing, 1);
        } else {
            addReference({
                type: 'section',
                id: blockId,
                blockType: blockType,
                preview: preview
            });
        }
        
        populateContextMenu(); // Refresh
    }
    
    /**
     * Add a reference to context
     */
    function addReference(ref) {
        references.push(ref);
        updateReferencesDisplay();
        
        // Expand widget if minimized
        if (isMinimized) {
            restore();
        }
    }
    
    /**
     * Remove a reference from context
     */
    function removeReference(refId) {
        references = references.filter(ref => ref.id !== refId);
        updateReferencesDisplay();
    }
    
    /**
     * Update the references display bar
     */
    function updateReferencesDisplay() {
        if (!contextRefs) return;
        
        if (references.length === 0) {
            contextRefs.style.display = 'none';
            return;
        }
        
        contextRefs.style.display = 'flex';
        contextRefs.innerHTML = references.map(ref => `
            <div class="ai-context-ref ${ref.type}">
                <span class="ref-type">${getRefLabel(ref)}</span>
                <span class="ref-preview">${escapeHtml(ref.preview)}</span>
                <span class="remove" onclick="AIAssistant.removeReference('${ref.id}')">×</span>
            </div>
        `).join('');
    }
    
    /**
     * Get label for reference type
     */
    function getRefLabel(ref) {
        const labels = {
            page: '📄',
            section: '§',
            highlight: '"'
        };
        return labels[ref.type] || '•';
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
     * Clear all references
     */
    function clearReferences() {
        references = [];
        selectedText = null;
        updateReferencesDisplay();
    }
    
    /**
     * Send request to AI
     */
    async function send() {
        const prompt = input.value.trim();
        if (!prompt) return;
        
        // Build context from references
        const context = await buildContext();
        
        showProcessing('Thinking...');
        hideResponse();
        hideContextMenu();
        
        try {
            const fullPrompt = buildPrompt(prompt, context);
            
            const response = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: window.Editor?.getCurrentModel?.() || 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are an AI assistant helping edit notes. You understand note section types like headings, lists, code blocks, etc. 
Respond with the modified content only. When given context references, use them to inform your response.`
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
                        } catch (e) {}
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
     * Build context from references
     */
    async function buildContext() {
        const contextParts = [];
        
        for (const ref of references) {
            switch (ref.type) {
                case 'page':
                    const pageContent = await getPageContent(ref.id);
                    contextParts.push(`[PAGE: ${ref.title}]\n${pageContent}`);
                    break;
                    
                case 'section':
                    const sectionContent = getSectionContent(ref.id);
                    contextParts.push(`[SECTION: ${ref.blockType}]\n${sectionContent}`);
                    break;
                    
                case 'highlight':
                    contextParts.push(`[HIGHLIGHTED TEXT]\n"${ref.text}"`);
                    break;
            }
        }
        
        return contextParts.join('\n\n---\n\n');
    }
    
    /**
     * Get page content
     */
    async function getPageContent(pageId) {
        // Try to get from Storage
        if (window.Storage) {
            const page = window.Storage.getPage?.(pageId);
            if (page && page.blocks) {
                return page.blocks.map(b => extractBlockContent(b)).join('\n\n');
            }
        }
        return '[Page content unavailable]';
    }
    
    /**
     * Get section content by block ID
     */
    function getSectionContent(blockId) {
        const block = document.querySelector(`.block[data-block-id="${blockId}"]`);
        if (block) {
            const input = block.querySelector('.block-input');
            return input ? input.textContent : '';
        }
        return '[Section unavailable]';
    }
    
    /**
     * Extract content from block object
     */
    function extractBlockContent(block) {
        if (typeof block.content === 'object') {
            return block.content.text || '';
        }
        return block.content || '';
    }
    
    /**
     * Build full prompt with context
     */
    function buildPrompt(prompt, context) {
        let fullPrompt = '';
        
        if (context) {
            fullPrompt += `Context:\n${context}\n\n`;
        }
        
        fullPrompt += `Request: ${prompt}\n\n`;
        fullPrompt += `Provide the response in appropriate format for the content type.`;
        
        return fullPrompt;
    }
    
    /**
     * Quick action buttons
     */
    function quickAction(action) {
        const prompts = {
            improve: 'Improve this content while keeping the same structure:',
            expand: 'Expand with more details and examples:',
            summarize: 'Summarize concisely:',
            fix: 'Fix grammar, spelling, and clarity issues:'
        };
        
        if (references.length === 0 && selectedText) {
            // Use selected text if no references
            addReference({
                type: 'highlight',
                id: 'highlight-' + Date.now(),
                text: selectedText.text,
                preview: selectedText.preview,
                source: selectedText.source
            });
        }
        
        input.value = prompts[action] || '';
        input.focus();
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    }
    
    /**
     * Insert response below current position or references
     */
    function insertBelow() {
        if (!lastResponse || !window.Editor) return;
        
        // Find insertion point - after last referenced block or at end
        let targetId = null;
        const sectionRefs = references.filter(r => r.type === 'section');
        if (sectionRefs.length > 0) {
            targetId = sectionRefs[sectionRefs.length - 1].id;
        }
        
        const blocks = parseResponseToBlocks(lastResponse);
        
        if (targetId) {
            let lastId = targetId;
            blocks.forEach(block => {
                const newBlock = window.Editor.insertBlockAfter?.(lastId, block.type, block.content);
                if (newBlock) lastId = newBlock.id;
            });
        } else {
            // Add at end
            blocks.forEach(block => {
                window.Editor.addBlockAtEnd?.(block.type, block.content);
            });
        }
        
        clearResponse();
    }
    
    /**
     * Replace referenced content with response
     */
    function replaceSelected() {
        if (!lastResponse || !window.Editor) return;
        
        // Find first referenced section
        const sectionRef = references.find(r => r.type === 'section');
        const highlightRef = references.find(r => r.type === 'highlight');
        
        const targetId = sectionRef?.id;
        
        if (targetId) {
            const blocks = parseResponseToBlocks(lastResponse);
            
            if (blocks.length > 0) {
                window.Editor.updateBlockContent?.(targetId, blocks[0].content);
                
                let lastId = targetId;
                blocks.slice(1).forEach(block => {
                    const newBlock = window.Editor.insertBlockAfter?.(lastId, block.type, block.content);
                    if (newBlock) lastId = newBlock.id;
                });
            }
        } else if (highlightRef) {
            // For highlighted text, we'd need to find and replace in the block
            // This is simplified - in practice would need more precise text replacement
            showResponse('Replace text: Please manually replace the highlighted text with the response above.');
            return;
        }
        
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
    
    function parseTextBlock(text) {
        const paragraphs = text.split('\n\n').filter(p => p.trim());
        return paragraphs.map(p => ({ type: 'text', content: p.trim() }));
    }
    
    // UI Helpers
    function showProcessing(text) {
        if (processingArea) {
            document.getElementById('ai-processing-text').textContent = text;
            processingArea.style.display = 'flex';
        }
    }
    
    function hideProcessing() {
        if (processingArea) processingArea.style.display = 'none';
    }
    
    function updateResponse(text, streaming = false) {
        const responseEl = document.getElementById('ai-response');
        if (responseEl) {
            responseEl.textContent = text;
            responseEl.classList.toggle('streaming', streaming);
        }
    }
    
    function showResponse(text) {
        updateResponse(text, false);
        if (responseArea) responseArea.style.display = 'block';
    }
    
    function hideResponse() {
        if (responseArea) responseArea.style.display = 'none';
    }
    
    function clearResponse() {
        lastResponse = '';
        hideResponse();
        updateResponse('');
    }
    
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function escapeJs(text) {
        return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
    }
    
    function saveState() {
        localStorage.setItem('ai-assistant-minimized', isMinimized);
        localStorage.setItem('ai-assistant-collapsed', isCollapsed);
    }
    
    function loadState() {
        isMinimized = localStorage.getItem('ai-assistant-minimized') === 'true';
        isCollapsed = localStorage.getItem('ai-assistant-collapsed') === 'true';
        
        if (isMinimized) {
            widget.classList.add('minimized');
            toggle.style.display = 'flex';
        } else if (isCollapsed) {
            widget.classList.add('collapsed');
        }
    }
    
    // Initialize on DOM ready
    document.addEventListener('DOMContentLoaded', init);
    
    // Public API
    return {
        toggleCollapse,
        minimize,
        restore,
        showContextMenu,
        hideContextMenu,
        addCurrentPageContext,
        togglePageReference,
        toggleSectionReference,
        addReference,
        removeReference,
        clearReferences,
        send,
        quickAction,
        insertBelow,
        replaceSelected
    };
})();
