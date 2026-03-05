/**
 * Storage Module - LocalStorage persistence for Notion-style notes
 */

const Storage = (function() {
    const STORAGE_KEY = 'notes_notion_data';
    const CURRENT_PAGE_KEY = 'notes_notion_current_page';
    const THEME_KEY = 'notes_notion_theme';
    const GLOBAL_MODEL_KEY = 'notes_notion_global_model';
    
    // Default data structure
    const defaultData = {
        pages: [
            {
                id: 'welcome',
                title: 'Welcome to Notes',
                icon: '👋',
                cover: null,
                defaultModel: null,
                properties: [],
                blocks: [
                    {
                        id: 'block-1',
                        type: 'heading_1',
                        content: 'Welcome to your new notes app!',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-2',
                        type: 'text',
                        content: 'This is a Notion-style block-based editor with AI support. Here\'s what you can do:',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-3',
                        type: 'bulleted_list',
                        content: 'Type "/" to see available block types including AI Image generation',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-4',
                        type: 'bulleted_list',
                        content: 'Use markdown shortcuts like #, ##, ### for headings',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-5',
                        type: 'bulleted_list',
                        content: 'Drag blocks using the ⋮⋮ handle to reorder',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-6',
                        type: 'bulleted_list',
                        content: 'Try the AI Assistant by typing "/ai" or selecting text',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-7',
                        type: 'bulleted_list',
                        content: 'Generate images with "/image" AI Image block',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-8',
                        type: 'divider',
                        content: '',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    },
                    {
                        id: 'block-9',
                        type: 'callout',
                        content: '💡 Tip: Select text and use the AI toolbar to transform it with different models. Each page can have its own default AI model!',
                        children: [],
                        formatting: {},
                        color: null,
                        createdAt: Date.now()
                    }
                ],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }
        ],
        trash: []
    };
    
    /**
     * Generate a unique ID
     */
    function generateId() {
        return 'page-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * Generate a unique block ID
     */
    function generateBlockId() {
        return 'block-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
    
    /**
     * Load all data from localStorage
     */
    function loadAll() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                const parsed = JSON.parse(data);
                // Ensure all pages have defaultModel property
                if (parsed.pages) {
                    parsed.pages.forEach(page => {
                        if (!('defaultModel' in page)) {
                            page.defaultModel = null;
                        }
                    });
                }
                return parsed;
            }
            // Initialize with default data
            saveAll(defaultData);
            return defaultData;
        } catch (e) {
            console.error('Error loading from localStorage:', e);
            return defaultData;
        }
    }
    
    /**
     * Save all data to localStorage
     */
    function saveAll(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Error saving to localStorage:', e);
            return false;
        }
    }
    
    /**
     * Get global default model
     */
    function getGlobalDefaultModel() {
        return localStorage.getItem(GLOBAL_MODEL_KEY) || 'gpt-4o';
    }
    
    /**
     * Set global default model
     */
    function setGlobalDefaultModel(model) {
        localStorage.setItem(GLOBAL_MODEL_KEY, model);
    }
    
    /**
     * Get all pages
     */
    function getPages() {
        const data = loadAll();
        return data.pages || [];
    }
    
    /**
     * Get a specific page by ID
     */
    function getPage(pageId) {
        const data = loadAll();
        return data.pages.find(p => p.id === pageId) || null;
    }
    
    /**
     * Create a new page
     */
    function createPage(title = 'Untitled', parentId = null) {
        const data = loadAll();
        const newPage = {
            id: generateId(),
            title: title,
            icon: '',
            cover: null,
            defaultModel: null, // Use global default
            properties: [],
            blocks: [
                {
                    id: generateBlockId(),
                    type: 'text',
                    content: '',
                    children: [],
                    formatting: {},
                    color: null,
                    createdAt: Date.now()
                }
            ],
            parentId: parentId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        data.pages.push(newPage);
        saveAll(data);
        
        return newPage;
    }
    
    /**
     * Update a page
     */
    function updatePage(pageId, updates) {
        const data = loadAll();
        const pageIndex = data.pages.findIndex(p => p.id === pageId);
        
        if (pageIndex === -1) return null;
        
        data.pages[pageIndex] = {
            ...data.pages[pageIndex],
            ...updates,
            updatedAt: Date.now()
        };
        
        saveAll(data);
        return data.pages[pageIndex];
    }
    
    /**
     * Delete a page (move to trash)
     */
    function deletePage(pageId) {
        const data = loadAll();
        const pageIndex = data.pages.findIndex(p => p.id === pageId);
        
        if (pageIndex === -1) return false;
        
        const page = data.pages[pageIndex];
        page.deletedAt = Date.now();
        
        data.trash.push(page);
        data.pages.splice(pageIndex, 1);
        
        saveAll(data);
        return true;
    }
    
    /**
     * Permanently delete a page from trash
     */
    function permanentDeletePage(pageId) {
        const data = loadAll();
        data.trash = data.trash.filter(p => p.id !== pageId);
        saveAll(data);
        return true;
    }
    
    /**
     * Restore a page from trash
     */
    function restorePage(pageId) {
        const data = loadAll();
        const trashIndex = data.trash.findIndex(p => p.id === pageId);
        
        if (trashIndex === -1) return null;
        
        const page = data.trash[trashIndex];
        delete page.deletedAt;
        
        data.pages.push(page);
        data.trash.splice(trashIndex, 1);
        
        saveAll(data);
        return page;
    }
    
    /**
     * Get all pages in trash
     */
    function getTrash() {
        const data = loadAll();
        return data.trash || [];
    }
    
    /**
     * Get current page ID
     */
    function getCurrentPageId() {
        return localStorage.getItem(CURRENT_PAGE_KEY) || null;
    }
    
    /**
     * Set current page ID
     */
    function setCurrentPageId(pageId) {
        localStorage.setItem(CURRENT_PAGE_KEY, pageId);
    }
    
    /**
     * Get theme preference
     */
    function getTheme() {
        return localStorage.getItem(THEME_KEY) || 'light';
    }
    
    /**
     * Set theme preference
     */
    function setTheme(theme) {
        localStorage.setItem(THEME_KEY, theme);
        document.documentElement.setAttribute('data-theme', theme);
    }
    
    /**
     * Export page to Markdown
     */
    function exportToMarkdown(pageId) {
        const page = getPage(pageId);
        if (!page) return null;
        
        let markdown = '';
        
        if (page.icon) {
            markdown += `${page.icon} `;
        }
        markdown += `# ${page.title || 'Untitled'}\n\n`;
        
        function blocksToMarkdown(blocks, depth = 0) {
            let md = '';
            let listCounter = {};
            
            for (const block of blocks) {
                const indent = '  '.repeat(depth);
                
                switch (block.type) {
                    case 'heading_1':
                        md += `${indent}# ${block.content}\n\n`;
                        break;
                    case 'heading_2':
                        md += `${indent}## ${block.content}\n\n`;
                        break;
                    case 'heading_3':
                        md += `${indent}### ${block.content}\n\n`;
                        break;
                    case 'text':
                        md += `${indent}${block.content}\n\n`;
                        break;
                    case 'bulleted_list':
                        md += `${indent}- ${block.content}\n`;
                        break;
                    case 'numbered_list':
                        md += `${indent}1. ${block.content}\n`;
                        break;
                    case 'todo':
                        const checkbox = block.content.checked ? '[x]' : '[ ]';
                        md += `${indent}- ${checkbox} ${block.content.text || block.content}\n`;
                        break;
                    case 'quote':
                        md += `${indent}> ${block.content}\n\n`;
                        break;
                    case 'code':
                        md += `${indent}\`\`\`${block.content.language || ''}\n${block.content.text || block.content}\n\`\`\`\n\n`;
                        break;
                    case 'divider':
                        md += `${indent}---\n\n`;
                        break;
                    case 'callout':
                        md += `${indent}> 💡 ${block.content}\n\n`;
                        break;
                    case 'ai_image':
                        md += `${indent}![AI Image: ${block.content.prompt || ''}](${block.content.imageUrl || ''})\n\n`;
                        break;
                }
                
                // Handle nested children
                if (block.children && block.children.length > 0) {
                    md += blocksToMarkdown(block.children, depth + 1);
                }
            }
            
            return md;
        }
        
        markdown += blocksToMarkdown(page.blocks);
        return markdown;
    }
    
    /**
     * Clear all data (use with caution)
     */
    function clearAll() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(CURRENT_PAGE_KEY);
        localStorage.removeItem(GLOBAL_MODEL_KEY);
    }
    
    // Initialize theme on load
    const savedTheme = getTheme();
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    return {
        generateId,
        generateBlockId,
        loadAll,
        saveAll,
        getPages,
        getPage,
        createPage,
        updatePage,
        deletePage,
        permanentDeletePage,
        restorePage,
        getTrash,
        getCurrentPageId,
        setCurrentPageId,
        getTheme,
        setTheme,
        getGlobalDefaultModel,
        setGlobalDefaultModel,
        exportToMarkdown,
        clearAll
    };
})();
