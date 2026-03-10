/**
 * App Module - Main application controller
 */

(function() {
    'use strict';
    
    // App state
    const state = {
        initialized: false,
        backendConnected: false,
        currentView: 'editor' // editor, trash, settings
    };
    
    /**
     * Initialize the application
     */
    async function init() {
        if (state.initialized) return;
        
        console.log('🚀 Initializing Notes - Notion Style');
        
        // Initialize connection status UI
        updateConnectionStatus('checking');
        
        // Check backend connection
        const health = await API.checkHealth();
        state.backendConnected = health.connected;
        console.log(state.backendConnected ? '✅ Backend connected' : '⚠️ Backend offline - using local mode');
        
        // Update connection status UI
        updateConnectionStatus(state.backendConnected ? 'connected' : 'disconnected');
        
        // Start periodic health checks
        startHealthCheckInterval();
        
        // Initialize modules
        initModules();
        
        // Load initial page
        loadInitialPage();
        
        // Setup global shortcuts
        setupGlobalShortcuts();
        
        state.initialized = true;
        
        // Show welcome toast
        setTimeout(() => {
            const mode = state.backendConnected ? 'connected' : 'offline';
            Sidebar.showToast(`Welcome! (${mode} mode) Press "/" for commands`, 'info');
        }, 1000);
    }
    
    /**
     * Update connection status UI
     */
    function updateConnectionStatus(status) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        
        if (!indicator || !text) return;
        
        indicator.className = 'connection-indicator';
        
        switch (status) {
            case 'connected':
                indicator.classList.add('connected');
                text.textContent = 'AI Connected';
                break;
            case 'disconnected':
                indicator.classList.add('disconnected');
                text.textContent = 'Offline Mode';
                break;
            case 'checking':
            default:
                indicator.classList.add('checking');
                text.textContent = 'Connecting...';
                break;
        }
    }
    
    /**
     * Start periodic health check
     */
    function startHealthCheckInterval() {
        // Check every 30 seconds
        setInterval(async () => {
            const health = await API.checkHealth();
            const wasConnected = state.backendConnected;
            state.backendConnected = health.connected;
            
            // Update UI
            updateConnectionStatus(health.connected ? 'connected' : 'disconnected');
            
            // Show toast if status changed
            if (wasConnected !== health.connected) {
                if (health.connected) {
                    Sidebar.showToast('Backend connected!', 'success');
                } else {
                    Sidebar.showToast('Backend disconnected - using offline mode', 'warning');
                }
            }
        }, 30000);
    }
    
    /**
     * Initialize all modules
     */
    function initModules() {
        // Initialize blocks
        console.log('📦 Initializing blocks...');
        
        // Initialize Mermaid
        if (typeof mermaid !== 'undefined') {
            mermaid.initialize({
                startOnLoad: false,
                theme: document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'default',
                securityLevel: 'loose'
            });
            console.log('📊 Mermaid diagrams ready');
        }
        
        // Initialize storage
        console.log('💾 Storage ready');
        
        // Initialize selection
        console.log('🎯 Initializing selection...');
        Selection.init({
            onSelect: (blockId) => {
                // Block selected
            },
            onDeselect: (blockId) => {
                // Block deselected
            },
            onDelete: (blockId) => {
                Editor.deleteBlock(blockId);
            },
            onDuplicate: (blockId) => {
                Editor.duplicateBlock(blockId);
            },
            onDrop: (draggedId, targetId) => {
                Editor.reorderBlocks(draggedId, targetId);
            },
            onColorChange: (blockId, color) => {
                Editor.setBlockColor(blockId, color);
            },
            onTurnInto: (blockId, type) => {
                Editor.convertBlockType(blockId, type);
            }
        });
        
        // Initialize slash menu
        console.log('⚡ Initializing slash menu...');
        SlashMenu.init();
        
        // Initialize editor
        console.log('📝 Initializing editor...');
        Editor.init();
        
        // Initialize sidebar
        console.log('📁 Initializing sidebar...');
        Sidebar.init();
        
        // Initialize AI integration
        console.log('🤖 Initializing AI...');
        AIIntegration.init();
        
        // Initialize page AI button
        setupPageAIButton();
    }
    
    /**
     * Setup page AI button and dropdown
     */
    function setupPageAIButton() {
        const pageAIBtn = document.getElementById('page-ai-btn');
        const pageAIDropdown = document.getElementById('page-ai-dropdown');
        
        if (!pageAIBtn || !pageAIDropdown) return;
        
        // Toggle dropdown
        pageAIBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = pageAIDropdown.style.display === 'block';
            pageAIDropdown.style.display = isVisible ? 'none' : 'block';
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!pageAIDropdown.contains(e.target) && e.target !== pageAIBtn) {
                pageAIDropdown.style.display = 'none';
            }
        });
        
        // Handle dropdown actions
        pageAIDropdown.querySelectorAll('.ai-dropdown-item').forEach(item => {
            item.addEventListener('click', async () => {
                const action = item.dataset.action;
                pageAIDropdown.style.display = 'none';
                await handlePageAIAction(action);
            });
        });
    }
    
    /**
     * Handle page-level AI actions
     */
    async function handlePageAIAction(action) {
        const page = Editor.getCurrentPage();
        if (!page) return;
        
        // Get all text content from the page
        const pageContent = page.blocks.map(b => {
            if (typeof b.content === 'string') return b.content;
            if (b.content && b.content.text) return b.content.text;
            return '';
        }).filter(Boolean).join('\n\n');
        
        if (!pageContent.trim()) {
            Sidebar.showToast('Page is empty - add some content first!', 'warning');
            return;
        }
        
        const pageTitle = page.title || 'Untitled';
        let prompt = '';
        
        switch (action) {
            case 'improve-page':
                prompt = `Improve the following page content. Make it clearer, more engaging, and better organized. Keep the same general structure but enhance the writing:\n\nTitle: ${pageTitle}\n\n${pageContent}`;
                break;
            case 'summarize':
                prompt = `Summarize the following page content into key points:\n\nTitle: ${pageTitle}\n\n${pageContent}`;
                break;
            case 'expand':
                prompt = `Expand the following page content with more detail, examples, and depth:\n\nTitle: ${pageTitle}\n\n${pageContent}`;
                break;
            case 'rewrite':
                prompt = `Rewrite the following page content in a professional, formal tone:\n\nTitle: ${pageTitle}\n\n${pageContent}`;
                break;
            case 'generate-toc':
                prompt = `Generate a table of contents for the following page. Return it as a bulleted list:\n\nTitle: ${pageTitle}\n\n${pageContent}`;
                break;
            case 'custom':
                const customPrompt = prompt('What would you like the AI to do with this page?');
                if (!customPrompt) return;
                prompt = `${customPrompt}\n\nPage Title: ${pageTitle}\n\nPage Content:\n${pageContent}`;
                break;
            default:
                return;
        }
        
        Sidebar.showToast('AI is processing the page...', 'info');
        
        try {
            const response = await API.generate(prompt, page.defaultModel);
            const responseText = extractResponseText(response);
            
            if (responseText) {
                // Show result in a modal
                showPageAIResultModal(action, responseText, page);
            } else {
                Sidebar.showToast('AI returned empty response', 'error');
            }
        } catch (error) {
            console.error('Page AI error:', error);
            Sidebar.showToast('AI processing failed: ' + error.message, 'error');
        }
    }
    
    /**
     * Extract text from various response formats
     */
    function extractResponseText(response) {
        if (!response) return '';
        if (typeof response === 'string') return response;
        if (response.response) return response.response;
        if (response.text) return response.text;
        if (response.content) return response.content;
        return JSON.stringify(response);
    }
    
    /**
     * Show page AI result modal
     */
    function showPageAIResultModal(action, result, page) {
        const actionNames = {
            'improve-page': 'Improved Content',
            'summarize': 'Summary',
            'expand': 'Expanded Content',
            'rewrite': 'Professional Version',
            'generate-toc': 'Table of Contents',
            'custom': 'AI Result'
        };
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000; padding: 20px;';
        
        modal.innerHTML = `
            <div class="modal-content" style="background: var(--bg-primary); border-radius: var(--radius-lg); max-width: 800px; width: 100%; max-height: 80vh; display: flex; flex-direction: column; box-shadow: var(--shadow-xl);">
                <div class="modal-header" style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600;">${actionNames[action] || 'AI Result'}</h3>
                    <button class="modal-close" style="background: none; border: none; cursor: pointer; padding: 4px; border-radius: var(--radius-sm);">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="modal-body" style="padding: 20px; overflow-y: auto; flex: 1;">
                    <div class="ai-result-content" style="white-space: pre-wrap; line-height: 1.6; font-size: 14px;">${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>
                <div class="modal-footer" style="padding: 16px 20px; border-top: 1px solid var(--border-color); display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="btn-secondary modal-copy">Copy</button>
                    <button class="btn-secondary modal-insert-top">Insert at Top</button>
                    <button class="btn-primary modal-insert-bottom">Insert at Bottom</button>
                    <button class="btn-primary modal-replace" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">Replace Page Content</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close handlers
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Action handlers
        modal.querySelector('.modal-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(result);
            Sidebar.showToast('Copied to clipboard', 'success');
        });
        
        modal.querySelector('.modal-insert-top').addEventListener('click', () => {
            Editor.insertBlockAtIndex(0, 'text', result);
            modal.remove();
            Sidebar.showToast('Inserted at top', 'success');
        });
        
        modal.querySelector('.modal-insert-bottom').addEventListener('click', () => {
            const newBlock = Editor.insertBlockAfter(null, 'text', result);
            if (newBlock) {
                Editor.focusBlock(newBlock.id);
            }
            modal.remove();
            Sidebar.showToast('Inserted at bottom', 'success');
        });
        
        modal.querySelector('.modal-replace').addEventListener('click', () => {
            if (confirm('This will replace all content on the page. Are you sure?')) {
                // Clear all blocks except the first one, update first with result
                if (page.blocks.length > 0) {
                    // Update first block
                    Editor.updateBlockContent(page.blocks[0].id, result);
                    // Remove other blocks
                    for (let i = page.blocks.length - 1; i > 0; i--) {
                        Editor.deleteBlock(page.blocks[i].id);
                    }
                }
                modal.remove();
                Sidebar.showToast('Page content replaced', 'success');
            }
        });
    }
    
    /**
     * Load initial page
     */
    function loadInitialPage() {
        const currentId = Storage.getCurrentPageId();
        
        if (currentId) {
            const page = Storage.getPage(currentId);
            if (page) {
                Sidebar.loadPage(currentId);
                return;
            }
        }
        
        // Load first page or create new
        const pages = Storage.getPages();
        if (pages.length > 0) {
            Sidebar.loadPage(pages[0].id);
        } else {
            Sidebar.createNewPage();
        }
    }
    
    /**
     * Setup global keyboard shortcuts
     */
    function setupGlobalShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Cmd/Ctrl + P: New page
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault();
                Sidebar.createNewPage();
            }
            
            // Cmd/Ctrl + S: Save
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                Editor.savePage();
                Sidebar.showToast('Page saved', 'success');
            }
            
            // Cmd/Ctrl + E: Export
            if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
                e.preventDefault();
                const markdown = Editor.exportToMarkdown();
                const page = Editor.getCurrentPage();
                downloadFile(markdown, `${page?.title || 'page'}.md`, 'text/markdown');
                Sidebar.showToast('Exported to Markdown', 'success');
            }
            
            // Cmd/Ctrl + B: Toggle sidebar
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
                e.preventDefault();
                document.getElementById('sidebar-toggle')?.click();
            }
            
            // Cmd/Ctrl + K: AI Assistant
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                AIIntegration.showAIModal();
            }
            
            // Cmd/Ctrl + /: Help
            if ((e.metaKey || e.ctrlKey) && e.key === '/') {
                e.preventDefault();
                showHelp();
            }
        });
    }
    
    /**
     * Show help modal
     */
    function showHelp() {
        const helpContent = `
# Keyboard Shortcuts

## General
- **Cmd/Ctrl + P** - New page
- **Cmd/Ctrl + S** - Save page
- **Cmd/Ctrl + E** - Export to Markdown
- **Cmd/Ctrl + B** - Toggle sidebar
- **Cmd/Ctrl + K** - AI Assistant
- **Cmd/Ctrl + /** - This help

## Editor
- **/** - Show slash menu
- **Enter** - New block
- **Shift + Enter** - New line in same block
- **Tab** - Indent block
- **Shift + Tab** - Unindent block
- **Backspace** on empty block - Delete block

## Markdown Shortcuts
- **# ** - Heading 1
- **## ** - Heading 2
- **### ** - Heading 3
- **- ** - Bulleted list
- **1. ** - Numbered list
- **[] ** - To-do
- **> ** - Quote
- **---** - Divider
- **\`\`\`** - Code block

## Selection
- Select text to see "Ask AI" toolbar
- Drag ⋮⋮ handle to reorder blocks
- Click ⋮⋮ handle for block menu
        `;
        
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
                <div class="ai-modal-header">
                    <span>⌨️</span>
                    <span>Keyboard Shortcuts</span>
                    <button class="icon-btn" style="margin-left: auto; background: transparent; border: none; color: white; cursor: pointer;">✕</button>
                </div>
                <div style="padding: 20px; white-space: pre-wrap; font-family: var(--font-mono); font-size: 14px; line-height: 1.6;">
                    ${helpContent}
                </div>
            </div>
        `;
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.closest('.icon-btn')) {
                modal.remove();
            }
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Download a file
     */
    function downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    /**
     * Show emoji categories in picker
     */
    function setupEmojiPicker() {
        const picker = document.getElementById('emoji-picker');
        if (!picker) return;
        
        const categories = picker.querySelectorAll('.emoji-category');
        categories.forEach(cat => {
            cat.addEventListener('click', () => {
                categories.forEach(c => c.classList.remove('active'));
                cat.classList.add('active');
                renderEmojiGrid(cat.dataset.category);
            });
        });
        
        // Search
        const searchInput = document.getElementById('emoji-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const query = searchInput.value.toLowerCase();
                filterEmojis(query);
            });
        }
    }
    
    /**
     * Render emoji grid for category
     */
    function renderEmojiGrid(category) {
        const grid = document.getElementById('emoji-grid');
        if (!grid) return;
        
        const emojis = Blocks.getEmojis(category);
        grid.innerHTML = '';
        
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.addEventListener('click', () => {
                // Handle emoji selection
                const picker = document.getElementById('emoji-picker');
                if (picker) {
                    picker.style.display = 'none';
                }
            });
            grid.appendChild(span);
        });
    }
    
    /**
     * Filter emojis by search
     */
    function filterEmojis(query) {
        const grid = document.getElementById('emoji-grid');
        if (!grid) return;
        
        if (!query) {
            renderEmojiGrid('recent');
            return;
        }
        
        // Search all categories
        const allCategories = Blocks.getEmojiCategories();
        const results = [];
        
        // This is a simple search - in production you'd want proper emoji metadata
        allCategories.forEach(cat => {
            const emojis = Blocks.getEmojis(cat);
            results.push(...emojis);
        });
        
        // Remove duplicates and limit
        const unique = [...new Set(results)].slice(0, 64);
        
        grid.innerHTML = '';
        unique.forEach(emoji => {
            const span = document.createElement('span');
            span.textContent = emoji;
            grid.appendChild(span);
        });
    }
    
    /**
     * Handle window resize
     */
    function handleResize() {
        // Close slash menu if open
        if (SlashMenu.isOpen()) {
            SlashMenu.hide();
        }
    }
    
    /**
     * Handle before unload
     */
    function handleBeforeUnload(e) {
        // Save any pending changes
        Editor.savePage();
    }
    
    // Event listeners
    window.addEventListener('DOMContentLoaded', init);
    window.addEventListener('resize', debounce(handleResize, 100));
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Handle visibility change (tab switch)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            Editor.savePage();
        }
    });
    
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
    
    // Expose app to window
    window.NotesApp = {
        state,
        showHelp,
        downloadFile
    };
    
})();
