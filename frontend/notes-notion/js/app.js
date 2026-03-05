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
        
        // Check backend connection
        state.backendConnected = await API.checkHealth();
        console.log(state.backendConnected ? '✅ Backend connected' : '⚠️ Backend offline - using local mode');
        
        // Initialize modules
        initModules();
        
        // Load initial page
        loadInitialPage();
        
        // Setup global shortcuts
        setupGlobalShortcuts();
        
        state.initialized = true;
        
        // Show welcome toast
        setTimeout(() => {
            Sidebar.showToast('Welcome! Press "/" for commands', 'info');
        }, 1000);
    }
    
    /**
     * Initialize all modules
     */
    function initModules() {
        // Initialize blocks
        console.log('📦 Initializing blocks...');
        
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
