/**
 * Sidebar Module - Page tree, navigation, and workspace management
 */

const Sidebar = (function() {
    let sidebarEl = null;
    let pageTreeEl = null;
    let expandedPages = new Set();
    
    /**
     * Initialize sidebar
     */
    async function init() {
        sidebarEl = document.getElementById('sidebar');
        pageTreeEl = document.getElementById('page-tree');
        
        setupEventListeners();
        refreshPageTree();
        
        // Restore sidebar state
        const isCollapsed = localStorage.getItem('notes_notion_sidebar_collapsed') === 'true';
        if (isCollapsed) {
            sidebarEl.classList.add('collapsed');
        }
        
        // Setup mobile toggle
        setupMobileToggle();
        
        // Load models from backend
        await populateModelDropdown();
    }
    
    /**
     * Fetch models from backend and populate dropdown
     */
    async function populateModelDropdown() {
        const dropdown = document.getElementById('page-model-dropdown');
        if (!dropdown) return;
        
        // Clear existing options
        dropdown.innerHTML = '';
        
        // Add default option
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = 'Loading models...';
        dropdown.appendChild(defaultOption);
        
        try {
            const models = await API.getModels();
            
            // Clear loading option
            dropdown.innerHTML = '';
            
            if (models.length === 0) {
                // No models from backend - add custom input option
                const customOption = document.createElement('option');
                customOption.value = '';
                customOption.textContent = 'Enter custom model...';
                dropdown.appendChild(customOption);
                
                // Add input field for custom model
                addCustomModelInput();
            } else {
                // Add default option
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Use Global Default';
                dropdown.appendChild(defaultOpt);
                
                // Add models from backend
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    dropdown.appendChild(option);
                });
                
                // Add custom option at end
                const customOpt = document.createElement('option');
                customOpt.value = 'custom';
                customOpt.textContent = 'Other (enter manually)...';
                dropdown.appendChild(customOpt);
            }
            
            console.log(`Loaded ${models.length} models from backend`);
        } catch (error) {
            console.error('Failed to load models:', error);
            dropdown.innerHTML = '';
            
            const errorOption = document.createElement('option');
            errorOption.value = '';
            errorOption.textContent = 'Error loading models - enter manually';
            dropdown.appendChild(errorOption);
            
            addCustomModelInput();
        }
    }
    
    /**
     * Add custom model input field
     */
    function addCustomModelInput() {
        const container = document.querySelector('.model-selector-wrapper');
        if (!container || container.querySelector('.custom-model-input')) return;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'custom-model-input';
        input.placeholder = 'e.g., kimi-for-coding';
        input.style.cssText = 'margin-top: 8px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; width: 100%;';
        
        input.addEventListener('change', () => {
            const page = window.Editor?.getCurrentPage?.();
            if (page && input.value) {
                page.defaultModel = input.value;
                window.Editor?.savePage?.();
                showToast(`Model set to: ${input.value}`, 'success');
            }
        });
        
        container.appendChild(input);
    }
    
    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // New page button
        const newPageBtn = document.getElementById('new-page-btn');
        if (newPageBtn) {
            newPageBtn.addEventListener('click', () => {
                showTemplateModal();
            });
        }
        
        // Search functionality - Ctrl/Cmd + Shift + F
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
                e.preventDefault();
                showSearchModal();
            }
        });
        
        // Sidebar toggle
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', toggleSidebar);
        }
        
        // Theme toggle
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', toggleTheme);
        }
        
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', openSettings);
        }
        
        // Trash button
        const trashBtn = document.getElementById('trash-btn');
        if (trashBtn) {
            trashBtn.addEventListener('click', showTrash);
        }
        
        // Cover buttons
        const addCoverBtn = document.getElementById('add-cover-btn');
        if (addCoverBtn) {
            addCoverBtn.addEventListener('click', showCoverPicker);
        }
        
        const changeCoverBtn = document.getElementById('cover-change-btn');
        if (changeCoverBtn) {
            changeCoverBtn.addEventListener('click', showCoverPicker);
        }
        
        const removeCoverBtn = document.getElementById('cover-remove-btn');
        if (removeCoverBtn) {
            removeCoverBtn.addEventListener('click', removeCover);
        }
        
        // Page icon button
        const pageIconBtn = document.getElementById('page-icon-btn');
        if (pageIconBtn) {
            pageIconBtn.addEventListener('click', (e) => {
                showEmojiPicker(e.currentTarget);
            });
        }
        
        // Page title input
        const pageTitleInput = document.getElementById('page-title');
        if (pageTitleInput) {
            pageTitleInput.addEventListener('input', debounce(() => {
                if (window.Editor) {
                    window.Editor.savePage();
                }
            }, 500));
        }
        
        // Page model selector
        const pageModelDropdown = document.getElementById('page-model-dropdown');
        if (pageModelDropdown) {
            pageModelDropdown.addEventListener('change', () => {
                const page = window.Editor?.getCurrentPage?.();
                if (page) {
                    page.defaultModel = pageModelDropdown.value || null;
                    window.Editor?.savePage?.();
                    showToast(`Default model updated for this page`, 'success');
                }
            });
        }
    }
    
    /**
     * Setup mobile menu toggle
     */
    function setupMobileToggle() {
        // Create mobile toggle button if on mobile
        if (window.innerWidth <= 768) {
            let mobileToggle = document.querySelector('.mobile-menu-toggle');
            if (!mobileToggle) {
                mobileToggle = document.createElement('button');
                mobileToggle.className = 'mobile-menu-toggle';
                mobileToggle.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                `;
                mobileToggle.addEventListener('click', () => {
                    sidebarEl.classList.toggle('open');
                    
                    // Create/remove backdrop
                    let backdrop = document.querySelector('.sidebar-backdrop');
                    if (sidebarEl.classList.contains('open')) {
                        if (!backdrop) {
                            backdrop = document.createElement('div');
                            backdrop.className = 'sidebar-backdrop';
                            backdrop.addEventListener('click', () => {
                                sidebarEl.classList.remove('open');
                                backdrop.remove();
                            });
                            document.body.appendChild(backdrop);
                        }
                    } else if (backdrop) {
                        backdrop.remove();
                    }
                });
                document.body.appendChild(mobileToggle);
            }
        }
    }
    
    /**
     * Show template modal for new pages
     */
    function showTemplateModal() {
        const templates = [
            { id: 'blank', name: 'Blank Page', icon: '📄', desc: 'Start from scratch' },
            { id: 'todo', name: 'To-do List', icon: '☑️', desc: 'Track tasks' },
            { id: 'notes', name: 'Meeting Notes', icon: '📝', desc: 'Meeting agenda & notes' },
            { id: 'doc', name: 'Documentation', icon: '📚', desc: 'Product documentation' },
            { id: 'journal', name: 'Daily Journal', icon: '📔', desc: 'Daily reflections' },
            { id: 'project', name: 'Project Plan', icon: '🎯', desc: 'Project planning' }
        ];
        
        const modal = document.createElement('div');
        modal.className = 'template-modal';
        modal.innerHTML = `
            <div class="template-modal-content">
                <div class="template-modal-header">
                    <span class="template-modal-title">Choose a template</span>
                    <button class="template-modal-close">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="template-grid">
                    ${templates.map(t => `
                        <div class="template-card" data-template="${t.id}">
                            <div class="template-card-icon">${t.icon}</div>
                            <div class="template-card-title">${t.name}</div>
                            <div class="template-card-desc">${t.desc}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        // Handle template selection
        modal.querySelectorAll('.template-card').forEach(card => {
            card.addEventListener('click', () => {
                const templateId = card.dataset.template;
                createNewPageWithTemplate(templateId);
                modal.remove();
            });
        });
        
        // Close handlers
        modal.querySelector('.template-modal-close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Create new page with template
     */
    function createNewPageWithTemplate(templateId) {
        const templateBlocks = {
            blank: [
                { type: 'text', content: '' }
            ],
            todo: [
                { type: 'heading_1', content: 'To-do List' },
                { type: 'text', content: 'Here are the tasks to complete:' },
                { type: 'todo', content: { text: 'Task 1', checked: false } },
                { type: 'todo', content: { text: 'Task 2', checked: false } },
                { type: 'todo', content: { text: 'Task 3', checked: false } }
            ],
            notes: [
                { type: 'heading_1', content: 'Meeting Notes' },
                { type: 'text', content: 'Date: ' + new Date().toLocaleDateString() },
                { type: 'divider', content: '' },
                { type: 'heading_2', content: 'Attendees' },
                { type: 'bulleted_list', content: 'Person 1' },
                { type: 'heading_2', content: 'Agenda' },
                { type: 'numbered_list', content: 'Item 1' },
                { type: 'heading_2', content: 'Notes' },
                { type: 'text', content: '' },
                { type: 'heading_2', content: 'Action Items' },
                { type: 'todo', content: { text: 'Action item', checked: false } }
            ],
            doc: [
                { type: 'heading_1', content: 'Documentation' },
                { type: 'text', content: 'Overview' },
                { type: 'heading_2', content: 'Getting Started' },
                { type: 'text', content: '' },
                { type: 'heading_2', content: 'Features' },
                { type: 'bulleted_list', content: 'Feature 1' },
                { type: 'heading_2', content: 'API Reference' },
                { type: 'code', content: { language: 'javascript', text: '// Example code' } }
            ],
            journal: [
                { type: 'heading_1', content: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) },
                { type: 'text', content: 'Today I...' },
                { type: 'heading_2', content: '🌟 Highlights' },
                { type: 'text', content: '' },
                { type: 'heading_2', content: '🤔 Reflections' },
                { type: 'text', content: '' },
                { type: 'heading_2', content: '🎯 Goals for Tomorrow' },
                { type: 'todo', content: { text: '', checked: false } }
            ],
            project: [
                { type: 'heading_1', content: 'Project Plan' },
                { type: 'callout', content: 'Project overview and key details', icon: '💡' },
                { type: 'heading_2', content: 'Goals' },
                { type: 'todo', content: { text: 'Define project goals', checked: false } },
                { type: 'heading_2', content: 'Timeline' },
                { type: 'text', content: '' },
                { type: 'heading_2', content: 'Resources' },
                { type: 'bulleted_list', content: 'Resource 1' },
                { type: 'heading_2', content: 'Notes' },
                { type: 'text', content: '' }
            ]
        };
        
        const blocks = templateBlocks[templateId] || templateBlocks.blank;
        
        const page = Storage.createPage();
        page.blocks = blocks.map(b => Blocks.createBlock(b.type, b.content));
        Storage.updatePage(page.id, page);
        
        refreshPageTree();
        loadPage(page.id);
        
        showToast(`Created from template`, 'success');
    }
    
    /**
     * Refresh the page tree
     */
    function refreshPageTree() {
        if (!pageTreeEl) return;
        
        const pages = Storage.getPages();
        pageTreeEl.innerHTML = '';
        
        // Build tree structure
        const pageMap = new Map();
        const rootPages = [];
        
        pages.forEach(page => {
            pageMap.set(page.id, { ...page, children: [] });
        });
        
        pages.forEach(page => {
            const node = pageMap.get(page.id);
            if (page.parentId && pageMap.has(page.parentId)) {
                pageMap.get(page.parentId).children.push(node);
            } else {
                rootPages.push(node);
            }
        });
        
        // Render tree
        rootPages.forEach(page => {
            renderPageNode(page, pageTreeEl, 0);
        });
        
        // Highlight current page
        const currentId = Storage.getCurrentPageId();
        if (currentId) {
            const currentEl = pageTreeEl.querySelector(`[data-page-id="${currentId}"]`);
            if (currentEl) {
                currentEl.classList.add('active');
            }
        }
    }
    
    /**
     * Render a page node
     */
    function renderPageNode(page, container, depth) {
        const pageEl = document.createElement('div');
        pageEl.className = 'page-tree-item';
        pageEl.dataset.pageId = page.id;
        pageEl.style.paddingLeft = `${14 + depth * 12}px`;
        
        // Expand button
        const hasChildren = page.children && page.children.length > 0;
        const isExpanded = expandedPages.has(page.id);
        
        const expandBtn = document.createElement('span');
        expandBtn.className = `expand-btn ${hasChildren ? '' : 'hidden'} ${isExpanded ? 'expanded' : ''}`;
        expandBtn.innerHTML = '▶';
        
        if (hasChildren) {
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePageExpand(page.id);
            });
        }
        
        pageEl.appendChild(expandBtn);
        
        // Icon
        const icon = document.createElement('span');
        icon.className = 'page-icon';
        icon.textContent = page.icon || (page.title ? '📄' : '📄');
        pageEl.appendChild(icon);
        
        // Title
        const title = document.createElement('span');
        title.className = 'page-title-text';
        title.textContent = page.title || 'Untitled';
        pageEl.appendChild(title);
        
        // Click to load page
        pageEl.addEventListener('click', () => loadPage(page.id));
        
        // Right-click menu
        pageEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showPageContextMenu(page.id, e);
        });
        
        container.appendChild(pageEl);
        
        // Render children if expanded
        if (hasChildren && isExpanded) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'page-tree-children';
            page.children.forEach(child => {
                renderPageNode(child, childrenContainer, depth + 1);
            });
            container.appendChild(childrenContainer);
        }
    }
    
    /**
     * Toggle page expand/collapse
     */
    function togglePageExpand(pageId) {
        if (expandedPages.has(pageId)) {
            expandedPages.delete(pageId);
        } else {
            expandedPages.add(pageId);
        }
        refreshPageTree();
    }
    
    /**
     * Load a page
     */
    function loadPage(pageId) {
        const page = Storage.getPage(pageId);
        if (!page) return;
        
        Storage.setCurrentPageId(pageId);
        
        // Update UI
        updatePageHeader(page);
        
        // Load into editor
        if (window.Editor) {
            window.Editor.loadPage(page);
        }
        
        // Update active state in sidebar
        document.querySelectorAll('.page-tree-item').forEach(el => {
            el.classList.remove('active');
        });
        const activeEl = document.querySelector(`.page-tree-item[data-page-id="${pageId}"]`);
        if (activeEl) {
            activeEl.classList.add('active');
        }
        
        // On mobile, close sidebar
        if (window.innerWidth < 768) {
            sidebarEl.classList.remove('open');
            const backdrop = document.querySelector('.sidebar-backdrop');
            if (backdrop) backdrop.remove();
        }
    }
    
    /**
     * Create a new page (blank)
     */
    function createNewPage() {
        showTemplateModal();
    }
    
    /**
     * Update page header UI
     */
    function updatePageHeader(page) {
        // Title
        const titleInput = document.getElementById('page-title');
        if (titleInput) {
            titleInput.value = page.title || '';
        }
        
        // Icon
        const iconEl = document.getElementById('page-icon');
        const addIconHint = document.querySelector('.add-icon-hint');
        if (iconEl) {
            iconEl.textContent = page.icon || '';
            if (page.icon) {
                iconEl.style.display = 'inline';
                if (addIconHint) addIconHint.style.display = 'none';
            } else {
                iconEl.style.display = 'none';
                if (addIconHint) addIconHint.style.display = 'inline';
            }
        }
        
        // Cover
        const coverArea = document.getElementById('cover-area');
        const coverImage = document.getElementById('cover-image');
        const addCoverBtn = document.getElementById('add-cover-btn');
        
        if (page.cover) {
            coverArea.style.display = 'block';
            coverImage.style.backgroundImage = `url(${page.cover})`;
            if (addCoverBtn) addCoverBtn.style.display = 'none';
        } else {
            coverArea.style.display = 'none';
            coverImage.style.backgroundImage = '';
            if (addCoverBtn) addCoverBtn.style.display = 'flex';
        }
        
        // Properties
        const propertiesArea = document.getElementById('properties-area');
        if (propertiesArea) {
            propertiesArea.innerHTML = '';
            page.properties?.forEach(prop => {
                addPropertyRow(prop.key, prop.value);
            });
        }
        
        // Model selector
        const pageModelDropdown = document.getElementById('page-model-dropdown');
        if (pageModelDropdown) {
            pageModelDropdown.value = page.defaultModel || '';
        }
        
        // Update document title
        document.title = page.title ? `${page.title} - Notes` : 'Notes - Notion Style';
    }
    
    /**
     * Add a property row
     */
    function addPropertyRow(key = '', value = '') {
        const propertiesArea = document.getElementById('properties-area');
        if (!propertiesArea) return;
        
        const row = document.createElement('div');
        row.className = 'property-row';
        
        const keyInput = document.createElement('input');
        keyInput.className = 'property-key';
        keyInput.placeholder = 'Property';
        keyInput.value = key;
        
        const valueInput = document.createElement('input');
        valueInput.className = 'property-value';
        valueInput.placeholder = 'Value';
        valueInput.value = value;
        
        row.appendChild(keyInput);
        row.appendChild(valueInput);
        
        propertiesArea.appendChild(row);
    }
    
    /**
     * Toggle sidebar collapse
     */
    function toggleSidebar() {
        sidebarEl.classList.toggle('collapsed');
        localStorage.setItem('notes_notion_sidebar_collapsed', sidebarEl.classList.contains('collapsed'));
    }
    
    /**
     * Toggle theme
     */
    function toggleTheme() {
        const currentTheme = Storage.getTheme();
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        Storage.setTheme(newTheme);
        
        // Update button text
        const themeText = document.querySelector('.theme-text');
        if (themeText) {
            themeText.textContent = newTheme === 'light' ? 'Dark mode' : 'Light mode';
        }
    }
    
    /**
     * Show emoji picker
     */
    function showEmojiPicker(target) {
        const picker = document.getElementById('emoji-picker');
        if (!picker) return;
        
        const rect = target.getBoundingClientRect();
        picker.style.left = `${rect.left}px`;
        picker.style.top = `${rect.bottom + 8}px`;
        picker.style.display = 'block';
        
        // Render emojis
        renderEmojiGrid('recent');
        
        // Close on outside click
        const closePicker = (e) => {
            if (!picker.contains(e.target) && e.target !== target) {
                picker.style.display = 'none';
                document.removeEventListener('click', closePicker);
            }
        };
        
        setTimeout(() => {
            document.addEventListener('click', closePicker);
        }, 0);
    }
    
    /**
     * Render emoji grid
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
                selectEmoji(emoji);
                document.getElementById('emoji-picker').style.display = 'none';
            });
            grid.appendChild(span);
        });
    }
    
    /**
     * Select emoji for page
     */
    function selectEmoji(emoji) {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) return;
        
        page.icon = emoji;
        
        const iconEl = document.getElementById('page-icon');
        const addIconHint = document.querySelector('.add-icon-hint');
        if (iconEl) {
            iconEl.textContent = emoji;
            iconEl.style.display = 'inline';
            if (addIconHint) addIconHint.style.display = 'none';
        }
        
        window.Editor?.savePage?.();
        refreshPageTree();
    }
    
    /**
     * Show cover picker
     */
    function showCoverPicker() {
        // Predefined gradients and colors
        const covers = [
            'linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)',
            'linear-gradient(120deg, #fccb90 0%, #d57eeb 100%)',
            'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
            'linear-gradient(120deg, #f093fb 0%, #f5576c 100%)',
            'linear-gradient(120deg, #4facfe 0%, #00f2fe 100%)',
            'linear-gradient(120deg, #43e97b 0%, #38f9d7 100%)',
            'linear-gradient(120deg, #fa709a 0%, #fee140 100%)',
            'linear-gradient(120deg, #30cfd0 0%, #330867 100%)'
        ];
        
        // For simplicity, use first gradient or allow URL input
        const url = prompt('Enter cover image URL (or leave empty for random gradient):');
        
        const page = window.Editor?.getCurrentPage?.();
        if (!page) return;
        
        if (url) {
            page.cover = url;
        } else {
            page.cover = covers[Math.floor(Math.random() * covers.length)];
        }
        
        updatePageHeader(page);
        window.Editor?.savePage?.();
    }
    
    /**
     * Remove cover
     */
    function removeCover() {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) return;
        
        page.cover = null;
        updatePageHeader(page);
        window.Editor?.savePage?.();
    }
    
    /**
     * Show page context menu
     */
    function showPageContextMenu(pageId, e) {
        const menu = document.createElement('div');
        menu.className = 'block-context-menu';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.innerHTML = `
            <div class="context-menu-item" data-action="duplicate">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Duplicate
            </div>
            <div class="context-menu-item" data-action="delete" style="color: #ef4444;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Delete
            </div>
        `;
        
        document.body.appendChild(menu);
        
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                if (action === 'delete') {
                    Storage.deletePage(pageId);
                    refreshPageTree();
                    
                    const pages = Storage.getPages();
                    if (pages.length > 0) {
                        loadPage(pages[0].id);
                    } else {
                        createNewPage();
                    }
                } else if (action === 'duplicate') {
                    const page = Storage.getPage(pageId);
                    if (page) {
                        const newPage = Storage.createPage(page.title + ' (Copy)');
                        newPage.blocks = JSON.parse(JSON.stringify(page.blocks));
                        newPage.icon = page.icon;
                        Storage.updatePage(newPage.id, newPage);
                        refreshPageTree();
                        loadPage(newPage.id);
                    }
                }
                menu.remove();
            });
        });
        
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(ev) {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 0);
    }
    
    /**
     * Show trash
     */
    function showTrash() {
        const trash = Storage.getTrash();
        if (trash.length === 0) {
            showToast('Trash is empty', 'info');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 400px;">
                <div class="ai-modal-header">
                    <span>🗑️</span>
                    <span>Trash</span>
                </div>
                <div style="padding: 20px;">
                    ${trash.map(p => `
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                            <span>${p.icon || '📄'} ${p.title || 'Untitled'}</span>
                            <button class="restore-btn" data-id="${p.id}" style="background: var(--bg-secondary); border: 1px solid var(--border-color); padding: 4px 12px; border-radius: var(--radius-sm); cursor: pointer;">Restore</button>
                        </div>
                    `).join('')}
                </div>
                <div style="padding: 0 20px 20px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="ai-btn empty-trash">Empty Trash</button>
                    <button class="ai-btn primary close-modal">Close</button>
                </div>
            </div>
        `;
        
        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelectorAll('.restore-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                Storage.restorePage(btn.dataset.id);
                refreshPageTree();
                modal.remove();
                showToast('Page restored', 'success');
            });
        });
        
        modal.querySelector('.empty-trash').addEventListener('click', () => {
            if (confirm('Empty trash permanently? This cannot be undone.')) {
                trash.forEach(p => Storage.permanentDeletePage(p.id));
                modal.remove();
                showToast('Trash emptied', 'success');
            }
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Open settings
     */
    function openSettings() {
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 400px;">
                <div class="ai-modal-header">
                    <span>⚙️</span>
                    <span>Settings</span>
                    <button class="settings-close" style="margin-left: auto; background: transparent; border: none; color: white; cursor: pointer; font-size: 18px;">✕</button>
                </div>
                <div style="padding: 20px; display: flex; flex-direction: column; gap: 12px;">
                    <button class="settings-btn" data-action="export-md">
                        <span>📝</span> Export current page as Markdown
                    </button>
                    <button class="settings-btn" data-action="export-all-md">
                        <span>📚</span> Export all pages as Markdown
                    </button>
                    <button class="settings-btn" data-action="export-pdf">
                        <span>📄</span> Export current page as PDF
                    </button>
                    <button class="settings-btn" data-action="import-md">
                        <span>📥</span> Import from Markdown
                    </button>
                    <button class="settings-btn" data-action="backup">
                        <span>💾</span> Backup all data
                    </button>
                    <div style="border-top: 1px solid var(--border-color); margin: 8px 0;"></div>
                    <button class="settings-btn" data-action="storage-info">
                        <span>💿</span> Storage info
                    </button>
                    <button class="settings-btn danger" data-action="clear-all" style="color: #ef4444;">
                        <span>🗑️</span> Clear all data
                    </button>
                </div>
            </div>
        `;
        
        // Style the buttons
        modal.querySelectorAll('.settings-btn').forEach(btn => {
            btn.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                background: var(--bg-secondary);
                border: 1px solid var(--border-color);
                border-radius: var(--radius-md);
                font-size: 14px;
                color: var(--text-primary);
                cursor: pointer;
                transition: all 0.15s;
                text-align: left;
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'var(--bg-hover)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'var(--bg-secondary)';
            });
        });
        
        // Handle actions
        modal.querySelector('.settings-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelectorAll('.settings-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                handleSettingsAction(action);
                modal.remove();
            });
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Handle settings actions
     */
    function handleSettingsAction(action) {
        switch (action) {
            case 'export-md':
                const markdown = window.Editor?.exportToMarkdown?.();
                if (markdown) {
                    downloadFile(markdown, `${window.Editor.getCurrentPage()?.title || 'page'}.md`, 'text/markdown');
                    showToast('Exported to Markdown', 'success');
                }
                break;
                
            case 'export-all-md':
                const allPages = Storage.getPages();
                let allMarkdown = '';
                allPages.forEach((page, index) => {
                    allMarkdown += Storage.exportToMarkdown(page.id);
                    if (index < allPages.length - 1) {
                        allMarkdown += '\n\n---\n\n';
                    }
                });
                downloadFile(allMarkdown, 'all-pages.md', 'text/markdown');
                showToast('Exported all pages', 'success');
                break;
                
            case 'export-pdf':
                exportToPDF();
                break;
                
            case 'import-md':
                importFromMarkdown();
                break;
                
            case 'backup':
                Storage.exportToFile();
                showToast('Backup downloaded', 'success');
                break;
                
            case 'storage-info':
                showStorageInfo();
                break;
                
            case 'clear-all':
                if (confirm('Clear ALL data? This cannot be undone!')) {
                    Storage.clearAll();
                    location.reload();
                }
                break;
        }
    }
    
    /**
     * Export current page to PDF
     */
    function exportToPDF() {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) return;
        
        // Create a print-friendly version
        const printWindow = window.open('', '_blank');
        const markdown = window.Editor.exportToMarkdown();
        
        // Simple HTML conversion (could be enhanced with marked.js)
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>${page.title || 'Untitled'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        h1, h2, h3 { margin-top: 1.5em; }
        pre {
            background: #f5f5f5;
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }
        code {
            font-family: "SFMono-Regular", Consolas, monospace;
            font-size: 0.9em;
        }
        blockquote {
            border-left: 4px solid #2383e2;
            margin: 0;
            padding-left: 16px;
            color: #666;
        }
        ul, ol { padding-left: 24px; }
        @media print {
            body { margin: 0; }
        }
    </style>
</head>
<body>
    <pre style="background: none; padding: 0; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(markdown)}</pre>
    <hr>
    <p style="color: #999; font-size: 12px;">Exported from Notes - ${new Date().toLocaleString()}</p>
    <script>
        // Auto-print
        setTimeout(() => print(), 500);
    <\/script>
</body>
</html>`;
        
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        showToast('PDF export window opened', 'success');
    }
    
    /**
     * Show storage information
     */
    function showStorageInfo() {
        const status = Storage.getStorageStatus();
        
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 400px;">
                <div class="ai-modal-header">
                    <span>💿</span>
                    <span>Storage Information</span>
                    <button class="close-btn" style="margin-left: auto; background: transparent; border: none; color: white; cursor: pointer; font-size: 18px;">✕</button>
                </div>
                <div style="padding: 20px;">
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Storage Status</div>
                        <div style="font-size: 16px; color: ${status.available ? '#22c55e' : '#ef4444'};">
                            ${status.available ? '✅ Available' : '⚠️ Using Memory Fallback'}
                        </div>
                    </div>
                    ${status.error ? `
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Error</div>
                        <div style="font-size: 13px; color: #ef4444;">${status.error.message}</div>
                    </div>
                    ` : ''}
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Memory Fallback</div>
                        <div style="font-size: 14px;">${status.memoryFallback ? 'Active' : 'Not needed'}</div>
                    </div>
                    ${status.usage ? `
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Storage Usage</div>
                        <div style="font-size: 14px;">${(status.usage / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    ` : ''}
                    ${status.quota ? `
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Storage Quota</div>
                        <div style="font-size: 14px;">${(status.quota / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    ` : ''}
                    <div style="font-size: 13px; color: var(--text-muted); margin-top: 20px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md);">
                        💡 Tip: If localStorage is unavailable (due to Tracking Prevention), your data is saved in memory. Use "Backup all data" to save your work.
                    </div>
                </div>
            </div>
        `;
        
        modal.querySelector('.close-btn').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Import from Markdown
     */
    function importFromMarkdown() {
        const input = document.createElement('textarea');
        input.placeholder = 'Paste Markdown here...';
        input.style.cssText = 'width: 100%; height: 200px; padding: 12px; font-family: inherit;';
        
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 500px;">
                <div class="ai-modal-header">
                    <span>📥</span>
                    <span>Import from Markdown</span>
                </div>
                <div style="padding: 20px;">
                    <textarea id="import-text" style="width: 100%; height: 200px; padding: 12px; font-family: inherit; border: 1px solid var(--border-color); border-radius: var(--radius-md); resize: vertical;"></textarea>
                </div>
                <div style="padding: 0 20px 20px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="ai-btn cancel">Cancel</button>
                    <button class="ai-btn primary import">Import</button>
                </div>
            </div>
        `;
        
        modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
        modal.querySelector('.import').addEventListener('click', () => {
            const text = modal.querySelector('#import-text').value;
            if (text.trim()) {
                const page = parseMarkdownToPage(text);
                Storage.updatePage(page.id, page);
                refreshPageTree();
                loadPage(page.id);
                modal.remove();
                showToast('Imported successfully', 'success');
            }
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Parse Markdown to page
     */
    function parseMarkdownToPage(markdown) {
        const page = Storage.createPage();
        const lines = markdown.split('\n');
        const blocks = [];
        let codeBlock = null;
        
        lines.forEach(line => {
            if (codeBlock) {
                if (line.startsWith('```')) {
                    codeBlock = null;
                } else {
                    codeBlock.content.text += (codeBlock.content.text ? '\n' : '') + line;
                }
                return;
            }
            
            if (line.startsWith('```')) {
                const lang = line.slice(3).trim();
                codeBlock = Blocks.createBlock('code', { language: lang || 'plain', text: '' });
                blocks.push(codeBlock);
                return;
            }
            
            if (line.startsWith('# ')) {
                blocks.push(Blocks.createBlock('heading_1', line.slice(2)));
            } else if (line.startsWith('## ')) {
                blocks.push(Blocks.createBlock('heading_2', line.slice(3)));
            } else if (line.startsWith('### ')) {
                blocks.push(Blocks.createBlock('heading_3', line.slice(4)));
            } else if (line.startsWith('- [ ] ')) {
                blocks.push(Blocks.createBlock('todo', { text: line.slice(6), checked: false }));
            } else if (line.startsWith('- [x] ')) {
                blocks.push(Blocks.createBlock('todo', { text: line.slice(6), checked: true }));
            } else if (line.startsWith('- ')) {
                blocks.push(Blocks.createBlock('bulleted_list', line.slice(2)));
            } else if (line.match(/^\d+\. /)) {
                blocks.push(Blocks.createBlock('numbered_list', line.replace(/^\d+\. /, '')));
            } else if (line.startsWith('> ')) {
                blocks.push(Blocks.createBlock('quote', line.slice(2)));
            } else if (line === '---') {
                blocks.push(Blocks.createBlock('divider', ''));
            } else if (line.trim()) {
                blocks.push(Blocks.createBlock('text', line));
            }
        });
        
        // Extract title from first heading or use default
        const firstHeading = blocks.find(b => b.type === 'heading_1');
        if (firstHeading) {
            page.title = firstHeading.content;
            blocks.splice(blocks.indexOf(firstHeading), 1);
        }
        
        page.blocks = blocks.length > 0 ? blocks : [Blocks.createBlock('text', '')];
        return page;
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
     * Show toast notification
     */
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
    
    /**
     * Show search modal for finding content across pages
     */
    function showSearchModal() {
        const pages = Storage.getPages();
        
        const modal = document.createElement('div');
        modal.className = 'ai-modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="ai-modal-content" style="max-width: 500px; max-height: 70vh; display: flex; flex-direction: column;">
                <div class="ai-modal-header">
                    <span>🔍</span>
                    <span>Search Pages</span>
                    <button class="search-close" style="margin-left: auto; background: transparent; border: none; color: white; cursor: pointer; font-size: 18px;">✕</button>
                </div>
                <div style="padding: 16px; border-bottom: 1px solid var(--border-color);">
                    <input type="text" id="search-input" placeholder="Search page titles and content..." 
                        style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 14px; outline: none;"
                        autocomplete="off">
                </div>
                <div id="search-results" style="overflow-y: auto; flex: 1; padding: 8px 0;">
                    <div style="padding: 24px; text-align: center; color: var(--text-muted);">
                        Type to search across all pages...
                    </div>
                </div>
                <div style="padding: 12px 16px; border-top: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted);">
                    Press Enter to open selected page • Esc to close
                </div>
            </div>
        `;
        
        const searchInput = modal.querySelector('#search-input');
        const searchResults = modal.querySelector('#search-results');
        
        // Close handlers
        modal.querySelector('.search-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // Search functionality
        let selectedIndex = -1;
        let currentResults = [];
        
        const performSearch = (query) => {
            if (!query.trim()) {
                searchResults.innerHTML = `
                    <div style="padding: 24px; text-align: center; color: var(--text-muted);">
                        Type to search across all pages...
                    </div>
                `;
                currentResults = [];
                selectedIndex = -1;
                return;
            }
            
            const lowerQuery = query.toLowerCase();
            const results = [];
            
            pages.forEach(page => {
                // Search in title
                if (page.title?.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        page,
                        type: 'title',
                        preview: page.title
                    });
                }
                
                // Search in blocks
                if (page.blocks) {
                    page.blocks.forEach((block, index) => {
                        const content = typeof block.content === 'object' 
                            ? block.content.text || block.content.prompt || JSON.stringify(block.content)
                            : block.content;
                        
                        if (content?.toLowerCase().includes(lowerQuery)) {
                            const preview = content.substring(0, 100) + (content.length > 100 ? '...' : '');
                            results.push({
                                page,
                                type: 'content',
                                blockIndex: index,
                                preview,
                                blockType: block.type
                            });
                        }
                    });
                }
            });
            
            currentResults = results;
            selectedIndex = results.length > 0 ? 0 : -1;
            
            if (results.length === 0) {
                searchResults.innerHTML = `
                    <div style="padding: 24px; text-align: center; color: var(--text-muted);">
                        No results found for "${escapeHtml(query)}"
                    </div>
                `;
            } else {
                renderResults();
            }
        };
        
        const renderResults = () => {
            searchResults.innerHTML = currentResults.map((result, index) => `
                <div class="search-result-item ${index === selectedIndex ? 'selected' : ''}" data-index="${index}" style="
                    padding: 12px 16px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border-color);
                    background: ${index === selectedIndex ? 'var(--bg-hover)' : 'transparent'};
                    transition: background 0.15s;
                ">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                        <span style="font-size: 16px;">${result.page.icon || '📄'}</span>
                        <span style="font-weight: 500; color: var(--text-primary);">${escapeHtml(result.page.title || 'Untitled')}</span>
                        ${result.type === 'content' ? `<span style="font-size: 12px; color: var(--text-muted); text-transform: capitalize;">${result.blockType}</span>` : ''}
                    </div>
                    <div style="font-size: 13px; color: var(--text-secondary); margin-left: 26px;">
                        ${escapeHtml(result.preview)}
                    </div>
                </div>
            `).join('');
            
            // Add click handlers
            searchResults.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const index = parseInt(item.dataset.index);
                    openResult(currentResults[index]);
                    modal.remove();
                });
                
                item.addEventListener('mouseenter', () => {
                    selectedIndex = parseInt(item.dataset.index);
                    renderResults();
                });
            });
            
            // Scroll selected into view
            const selected = searchResults.querySelector('.search-result-item.selected');
            if (selected) {
                selected.scrollIntoView({ block: 'nearest' });
            }
        };
        
        const openResult = (result) => {
            loadPage(result.page.id);
            showToast(`Opened: ${result.page.title || 'Untitled'}`, 'success');
        };
        
        // Input handler with debounce
        let debounceTimer;
        searchInput.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => performSearch(searchInput.value), 200);
        });
        
        // Keyboard navigation
        searchInput.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    if (currentResults.length > 0) {
                        selectedIndex = (selectedIndex + 1) % currentResults.length;
                        renderResults();
                    }
                    break;
                    
                case 'ArrowUp':
                    e.preventDefault();
                    if (currentResults.length > 0) {
                        selectedIndex = (selectedIndex - 1 + currentResults.length) % currentResults.length;
                        renderResults();
                    }
                    break;
                    
                case 'Enter':
                    e.preventDefault();
                    if (selectedIndex >= 0 && currentResults[selectedIndex]) {
                        openResult(currentResults[selectedIndex]);
                        modal.remove();
                    }
                    break;
                    
                case 'Escape':
                    e.preventDefault();
                    modal.remove();
                    break;
            }
        });
        
        document.body.appendChild(modal);
        searchInput.focus();
    }
    
    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
    
    // Expose to window
    window.Sidebar = {
        init,
        refreshPageTree,
        loadPage,
        createNewPage,
        showTemplateModal,
        showToast,
        showSearchModal
    };
    
    return window.Sidebar;
})();
