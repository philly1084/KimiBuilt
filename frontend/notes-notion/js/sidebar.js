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
    }
    
    /**
     * Add custom model input field (placeholder for future use)
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
        
        // Import button
        const importBtn = document.getElementById('import-btn');
        if (importBtn) {
            importBtn.addEventListener('click', showImportModal);
        }
        
        // Export button
        setupExportButton();
        
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
                // Update breadcrumbs
                const breadcrumbCurrent = document.getElementById('breadcrumb-current');
                if (breadcrumbCurrent) {
                    breadcrumbCurrent.textContent = pageTitleInput.value || 'Untitled';
                }
                // Update page title in sidebar tree
                updatePageTitleInTree(window.Editor?.getCurrentPage?.()?.id, pageTitleInput.value);
            }, 100));
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
            createMobileToggleButton();
        }
        
        // Listen for resize to add/remove mobile toggle
        window.addEventListener('resize', debounce(() => {
            if (window.innerWidth <= 768) {
                createMobileToggleButton();
            } else {
                removeMobileToggleButton();
            }
        }, 100));
    }
    
    /**
     * Create mobile toggle button
     */
    function createMobileToggleButton() {
        let mobileToggle = document.querySelector('.mobile-menu-toggle');
        if (mobileToggle) return;
        
        mobileToggle = document.createElement('button');
        mobileToggle.className = 'mobile-menu-toggle';
        mobileToggle.setAttribute('aria-label', 'Toggle menu');
        mobileToggle.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
        `;
        mobileToggle.addEventListener('click', toggleMobileSidebar);
        document.body.appendChild(mobileToggle);
    }
    
    /**
     * Remove mobile toggle button
     */
    function removeMobileToggleButton() {
        const mobileToggle = document.querySelector('.mobile-menu-toggle');
        if (mobileToggle) {
            mobileToggle.remove();
        }
        // Also close sidebar and remove backdrop
        if (sidebarEl) {
            sidebarEl.classList.remove('open');
        }
        const backdrop = document.querySelector('.sidebar-backdrop');
        if (backdrop) {
            backdrop.remove();
        }
    }
    
    /**
     * Toggle mobile sidebar with backdrop
     */
    function toggleMobileSidebar() {
        if (!sidebarEl) return;
        
        const isOpen = sidebarEl.classList.toggle('open');
        
        // Create/remove backdrop
        let backdrop = document.querySelector('.sidebar-backdrop');
        if (isOpen) {
            if (!backdrop) {
                backdrop = document.createElement('div');
                backdrop.className = 'sidebar-backdrop';
                backdrop.setAttribute('role', 'button');
                backdrop.setAttribute('aria-label', 'Close sidebar');
                backdrop.addEventListener('click', () => {
                    sidebarEl.classList.remove('open');
                    backdrop.classList.remove('active');
                    setTimeout(() => backdrop.remove(), 300);
                });
                document.body.appendChild(backdrop);
                // Trigger animation
                requestAnimationFrame(() => {
                    backdrop.classList.add('active');
                });
            }
        } else if (backdrop) {
            backdrop.classList.remove('active');
            setTimeout(() => backdrop.remove(), 300);
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
        
        // Breadcrumbs
        const breadcrumbCurrent = document.getElementById('breadcrumb-current');
        if (breadcrumbCurrent) {
            breadcrumbCurrent.textContent = page.title || 'Untitled';
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
     * Update page title in the sidebar tree
     */
    function updatePageTitleInTree(pageId, title) {
        if (!pageId) return;
        const pageEl = document.querySelector(`.page-tree-item[data-page-id="${pageId}"]`);
        if (pageEl) {
            const titleEl = pageEl.querySelector('.page-title-text');
            if (titleEl) {
                titleEl.textContent = title || 'Untitled';
            }
        }
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
            <div class="ai-modal-content" style="max-width: 450px; max-height: 80vh; overflow-y: auto;">
                <div class="ai-modal-header">
                    <span>⚙️</span>
                    <span>Settings</span>
                    <button class="settings-close" style="margin-left: auto; background: transparent; border: none; color: white; cursor: pointer; font-size: 18px;">✕</button>
                </div>
                <div style="padding: 20px; display: flex; flex-direction: column; gap: 4px;">
                    
                    <!-- Export Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">📤 Export Current Page</div>
                        <div class="settings-btn-group">
                            <button class="settings-btn" data-action="export-docx">
                                <span>📄</span>
                                <div>
                                    <div>Word Document (.docx)</div>
                                    <div class="settings-btn-subtitle">Microsoft Word format with formatting</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="export-pdf">
                                <span>📑</span>
                                <div>
                                    <div>PDF Document (.pdf)</div>
                                    <div class="settings-btn-subtitle">Print-ready PDF with page breaks</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="export-html">
                                <span>🌐</span>
                                <div>
                                    <div>HTML Document (.html)</div>
                                    <div class="settings-btn-subtitle">Web-ready HTML with styling</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="export-md">
                                <span>📝</span>
                                <div>
                                    <div>Markdown (.md)</div>
                                    <div class="settings-btn-subtitle">Plain text with formatting</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="export-json">
                                <span>📋</span>
                                <div>
                                    <div>Notion JSON (.json)</div>
                                    <div class="settings-btn-subtitle">Notion-compatible format</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="export-txt">
                                <span>📃</span>
                                <div>
                                    <div>Plain Text (.txt)</div>
                                    <div class="settings-btn-subtitle">Simple text without formatting</div>
                                </div>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Export All Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">📦 Export All Pages</div>
                        <div class="settings-btn-group">
                            <button class="settings-btn" data-action="export-all-md">
                                <span>📚</span>
                                <div>
                                    <div>Export All as Markdown</div>
                                    <div class="settings-btn-subtitle">Single file with all pages</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="backup">
                                <span>💾</span>
                                <div>
                                    <div>Full Backup (.json)</div>
                                    <div class="settings-btn-subtitle">Complete data backup with metadata</div>
                                </div>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Import Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">📥 Import</div>
                        <div class="settings-btn-group">
                            <button class="settings-btn" data-action="import-file">
                                <span>📂</span>
                                <div>
                                    <div>Import from File</div>
                                    <div class="settings-btn-subtitle">DOCX, PDF, HTML, MD, JSON, TXT</div>
                                </div>
                            </button>
                            <button class="settings-btn" data-action="import-md">
                                <span>📝</span>
                                <div>
                                    <div>Paste Markdown</div>
                                    <div class="settings-btn-subtitle">Copy & paste Markdown text</div>
                                </div>
                            </button>
                        </div>
                    </div>
                    
                    <!-- Data Management Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">💿 Data Management</div>
                        <div class="settings-btn-group">
                            <button class="settings-btn" data-action="storage-info">
                                <span>💿</span>
                                <div>
                                    <div>Storage Information</div>
                                    <div class="settings-btn-subtitle">Check storage usage and status</div>
                                </div>
                            </button>
                            <button class="settings-btn danger" data-action="clear-all" style="color: #ef4444;">
                                <span>🗑️</span>
                                <div>
                                    <div>Clear All Data</div>
                                    <div class="settings-btn-subtitle">⚠️ This cannot be undone!</div>
                                </div>
                            </button>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;
        
        // Style the buttons
        modal.querySelectorAll('.settings-btn').forEach(btn => {
            btn.style.cssText = `
                display: flex;
                align-items: flex-start;
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
                width: 100%;
            `;
            btn.addEventListener('mouseenter', () => {
                btn.style.background = 'var(--bg-hover)';
                btn.style.borderColor = 'var(--border-hover)';
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.background = 'var(--bg-secondary)';
                btn.style.borderColor = 'var(--border-color)';
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
            // Export current page - various formats
            case 'export-docx':
                exportCurrentPage('docx');
                break;
            case 'export-pdf':
                exportCurrentPage('pdf');
                break;
            case 'export-html':
                exportCurrentPage('html');
                break;
            case 'export-md':
                exportCurrentPage('md');
                break;
            case 'export-json':
                exportCurrentPage('json');
                break;
            case 'export-txt':
                exportCurrentPage('txt');
                break;
                
            // Export all pages
            case 'export-all-md':
                showExportAllModal();
                break;
                
            // Import
            case 'import-file':
                showImportModal();
                break;
            case 'import-md':
                importFromMarkdown();
                break;
                
            // Backup
            case 'backup':
                Storage.exportToFile();
                showToast('Backup downloaded', 'success');
                break;
                
            // Data management
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
     * Export current page to specific format
     */
    async function exportCurrentPage(format) {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) {
            showToast('No page to export', 'error');
            return;
        }
        
        try {
            showToast(`Exporting to ${format.toUpperCase()}...`, 'info');
            const result = await ImportExport.exportPage(page, format);
            const formats = ImportExport.getFormats().export;
            const formatInfo = formats[format];
            const filename = `${page.title || 'page'}.${formatInfo.ext}`;
            
            ImportExport.download(result, filename, formatInfo.mime);
            showToast(`Exported as ${formatInfo.name}`, 'success');
        } catch (error) {
            console.error('Export error:', error);
            showToast(`Export failed: ${error.message}`, 'error');
        }
    }
    
    /**
     * Setup export button dropdown
     */
    function setupExportButton() {
        const exportBtn = document.getElementById('export-btn');
        const exportMenu = document.getElementById('export-menu');
        
        if (!exportBtn || !exportMenu) return;
        
        exportBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = exportMenu.style.display === 'block';
            exportMenu.style.display = isVisible ? 'none' : 'block';
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', () => {
            exportMenu.style.display = 'none';
        });
        
        // Handle export format selection
        exportMenu.querySelectorAll('.export-item').forEach(item => {
            item.addEventListener('click', async (e) => {
                e.stopPropagation();
                const format = item.dataset.format;
                exportMenu.style.display = 'none';
                await exportCurrentPage(format);
            });
        });
    }
    
    /**
     * Show import modal
     */
    function showImportModal() {
        const formats = ImportExport.getFormats().import;
        
        const modal = document.createElement('div');
        modal.className = 'import-modal';
        modal.innerHTML = `
            <div class="import-modal-content">
                <div class="import-modal-header">
                    <span class="import-modal-title">📥 Import Page</span>
                    <button class="import-modal-close">&times;</button>
                </div>
                <div class="import-modal-body">
                    <div class="file-drop-zone" id="file-drop-zone">
                        <div class="file-drop-zone-icon">📁</div>
                        <div class="file-drop-zone-text">Drop a file here or click to browse</div>
                        <div class="file-drop-zone-hint">Supports DOCX, PDF, HTML, Markdown, Notion JSON, and TXT</div>
                        <input type="file" class="file-input" id="file-input" accept=".docx,.pdf,.html,.md,.json,.txt">
                    </div>
                    
                    <div class="import-formats">
                        <div class="import-formats-title">Supported Formats</div>
                        <div class="import-format-grid">
                            <div class="import-format-item" data-format="docx">
                                <span class="import-format-icon">📄</span>
                                <span class="import-format-name">Word</span>
                            </div>
                            <div class="import-format-item" data-format="pdf">
                                <span class="import-format-icon">📑</span>
                                <span class="import-format-name">PDF</span>
                            </div>
                            <div class="import-format-item" data-format="html">
                                <span class="import-format-icon">🌐</span>
                                <span class="import-format-name">HTML</span>
                            </div>
                            <div class="import-format-item" data-format="md">
                                <span class="import-format-icon">📝</span>
                                <span class="import-format-name">Markdown</span>
                            </div>
                            <div class="import-format-item" data-format="json">
                                <span class="import-format-icon">📋</span>
                                <span class="import-format-name">Notion</span>
                            </div>
                            <div class="import-format-item" data-format="txt">
                                <span class="import-format-icon">📃</span>
                                <span class="import-format-name">Text</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Close handlers
        modal.querySelector('.import-modal-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        // File drop zone handlers
        const dropZone = modal.querySelector('#file-drop-zone');
        const fileInput = modal.querySelector('#file-input');
        
        dropZone.addEventListener('click', () => fileInput.click());
        
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileImport(e.target.files[0], modal);
            }
        });
        
        // Drag and drop handlers
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handleFileImport(e.dataTransfer.files[0], modal);
            }
        });
        
        // Format item click handlers
        modal.querySelectorAll('.import-format-item').forEach(item => {
            item.addEventListener('click', () => {
                fileInput.click();
            });
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Handle file import with enhanced PDF support
     */
    async function handleFileImport(file, modal) {
        const body = modal.querySelector('.import-modal-body');
        const isPDF = file.name.toLowerCase().endsWith('.pdf');
        
        // For PDFs, show enhanced import UI with preview and options
        if (isPDF && typeof PDFImport !== 'undefined') {
            await handlePDFImport(file, modal);
            return;
        }
        
        // Standard import for other formats
        body.innerHTML = `
            <div class="import-progress">
                <div class="import-progress-spinner"></div>
                <div class="import-progress-text">Importing ${file.name}...</div>
            </div>
        `;
        
        try {
            const page = await ImportExport.importFile(file);
            
            // Save the imported page
            const newPage = Storage.createPage(page.title || 'Imported Page');
            newPage.icon = page.icon || '📄';
            newPage.blocks = page.blocks.map(b => ({
                ...b,
                id: Storage.generateBlockId(),
                createdAt: Date.now()
            }));
            
            Storage.updatePage(newPage.id, newPage);
            refreshPageTree();
            loadPage(newPage.id);
            
            modal.remove();
            showToast(`Imported "${newPage.title}" successfully!`, 'success');
        } catch (error) {
            console.error('Import error:', error);
            showImportError(body, error, modal);
        }
    }
    
    /**
     * Handle PDF import with preview and options
     */
    async function handlePDFImport(file, modal) {
        const body = modal.querySelector('.import-modal-body');
        
        // Show loading state
        body.innerHTML = `
            <div class="import-progress">
                <div class="import-progress-spinner"></div>
                <div class="import-progress-text">Analyzing PDF...</div>
            </div>
        `;
        
        try {
            // Read file
            const arrayBuffer = await file.arrayBuffer();
            
            // Initialize PDF.js
            if (!PDFImport.initialize || !PDFImport.initialize()) {
                await PDFImport.loadPDFJS();
            }
            
            // Get preview
            const preview = await PDFImport.previewPDF(arrayBuffer, { maxPages: 3 });
            
            // Check if scanned
            const scanInfo = await PDFImport.detectScannedPDF(arrayBuffer);
            
            // Show PDF import options UI
            body.innerHTML = `
                <div class="pdf-import-options">
                    <div class="pdf-preview-section">
                        <div class="pdf-preview-header">
                            <span class="pdf-preview-title">📄 ${file.name}</span>
                            <span class="pdf-preview-pages">${preview.totalPages} pages</span>
                        </div>
                        ${scanInfo.isScanned ? `
                        <div class="pdf-scanned-warning">
                            <span>⚠️</span>
                            <span>This appears to be a scanned/image-based PDF. Import may include page images.</span>
                        </div>
                        ` : ''}
                        <div class="pdf-preview-thumbnails">
                            ${preview.previews.map(p => `
                                <div class="pdf-preview-thumb">
                                    <img src="${p.thumbnail}" alt="Page ${p.pageNum}">
                                    <span class="pdf-preview-page-num">${p.pageNum}</span>
                                    ${!p.hasText ? '<span class="pdf-preview-no-text">Image</span>' : ''}
                                </div>
                            `).join('')}
                            ${preview.hasMore ? '<div class="pdf-preview-more">...</div>' : ''}
                        </div>
                    </div>
                    
                    <div class="pdf-import-settings">
                        <div class="pdf-setting-row">
                            <label class="pdf-setting-label">
                                <span>Pages to import</span>
                                <span class="pdf-setting-hint">Leave empty for all pages</span>
                            </label>
                            <input type="text" id="pdf-page-range" class="pdf-setting-input" 
                                placeholder="e.g., 1-5, 8, 10-12" 
                                title="Enter page numbers or ranges separated by commas">
                        </div>
                        
                        <div class="pdf-setting-row">
                            <label class="pdf-setting-label">
                                <span>Image quality</span>
                                <span class="pdf-setting-hint">For scanned pages</span>
                            </label>
                            <select id="pdf-image-quality" class="pdf-setting-select">
                                <option value="0.7">Standard (faster)</option>
                                <option value="0.92" selected>High (recommended)</option>
                                <option value="1.0">Maximum (slower)</option>
                            </select>
                        </div>
                        
                        <div class="pdf-setting-row checkbox">
                            <label class="pdf-setting-checkbox">
                                <input type="checkbox" id="pdf-extract-images" checked>
                                <span>Extract images from PDF</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="pdf-import-actions">
                        <button class="ai-btn cancel" id="pdf-cancel">Cancel</button>
                        <button class="ai-btn primary" id="pdf-import">
                            <span>Import PDF</span>
                            <span class="pdf-import-hint">${preview.totalPages} pages</span>
                        </button>
                    </div>
                </div>
            `;
            
            // Add styles for PDF import UI
            addPDFImportStyles();
            
            // Event handlers
            body.querySelector('#pdf-cancel').addEventListener('click', () => modal.remove());
            
            body.querySelector('#pdf-import').addEventListener('click', async () => {
                const pageRange = body.querySelector('#pdf-page-range').value.trim();
                const imageQuality = parseFloat(body.querySelector('#pdf-image-quality').value);
                const extractImages = body.querySelector('#pdf-extract-images').checked;
                
                // Show progress
                body.innerHTML = `
                    <div class="pdf-import-progress-container">
                        <div class="pdf-import-progress-header">Importing PDF...</div>
                        <div class="pdf-import-progress-bar">
                            <div class="pdf-import-progress-fill" id="pdf-progress-fill"></div>
                        </div>
                        <div class="pdf-import-progress-status" id="pdf-progress-status">Preparing...</div>
                        <div class="pdf-import-progress-detail" id="pdf-progress-detail"></div>
                    </div>
                `;
                
                const updateProgress = (progress) => {
                    const fill = document.getElementById('pdf-progress-fill');
                    const status = document.getElementById('pdf-progress-status');
                    const detail = document.getElementById('pdf-progress-detail');
                    
                    if (fill) {
                        fill.style.width = `${(progress.progress * 100).toFixed(0)}%`;
                    }
                    if (status) {
                        status.textContent = progress.message;
                    }
                    if (detail && progress.currentPage) {
                        detail.textContent = `Page ${progress.currentPage} of ${progress.totalPages}`;
                    }
                };
                
                try {
                    const options = {
                        title: file.name.replace(/\.pdf$/i, ''),
                        pageRange: pageRange || null,
                        imageQuality,
                        extractImages,
                        showProgress: true
                    };
                    
                    const page = await ImportExport.importFromPDF(arrayBuffer, options, updateProgress);
                    
                    // Save the imported page
                    const newPage = Storage.createPage(page.title || 'Imported PDF');
                    newPage.icon = '📄';
                    newPage.blocks = page.blocks.map(b => ({
                        ...b,
                        id: Storage.generateBlockId(),
                        createdAt: Date.now()
                    }));
                    
                    Storage.updatePage(newPage.id, newPage);
                    refreshPageTree();
                    loadPage(newPage.id);
                    
                    modal.remove();
                    showToast(`Imported "${newPage.title}" successfully!`, 'success');
                } catch (error) {
                    console.error('PDF import error:', error);
                    showImportError(body, error, modal);
                }
            });
            
        } catch (error) {
            console.error('PDF preview error:', error);
            showImportError(body, error, modal);
        }
    }
    
    /**
     * Show import error with fallback option
     */
    function showImportError(body, error, modal) {
        body.innerHTML = `
            <div class="import-message error">
                <span>❌</span>
                <span>Import failed: ${error.message}</span>
            </div>
            <div class="import-error-actions">
                <button class="ai-btn" id="import-retry">Try Again</button>
                <button class="ai-btn secondary" id="import-help">Get Help</button>
            </div>
            <div class="import-error-hint" style="margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: var(--radius-md); font-size: 13px; color: var(--text-muted);">
                <strong>Tips:</strong>
                <ul style="margin: 8px 0 0 16px; padding: 0;">
                    <li>For scanned PDFs, consider using OCR tools first</li>
                    <li>Try converting to a different format (e.g., DOCX)</li>
                    <li>Check that the file isn't corrupted or password-protected</li>
                </ul>
            </div>
        `;
        
        body.querySelector('#import-retry').addEventListener('click', () => {
            showImportModal();
            modal.remove();
        });
        
        body.querySelector('#import-help').addEventListener('click', () => {
            alert('PDF Import Help:\n\n' +
                '• Text-based PDFs: Content is extracted as editable text\n' +
                '• Scanned PDFs: Pages are imported as images\n' +
                '• Mixed PDFs: Text and images are both extracted\n\n' +
                'For best results with scanned documents, use OCR software ' +
                '(like Adobe Acrobat, online OCR tools) before importing.');
        });
    }
    
    /**
     * Add PDF import UI styles
     */
    function addPDFImportStyles() {
        if (document.getElementById('pdf-import-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'pdf-import-styles';
        style.textContent = `
            .pdf-import-options {
                padding: 16px;
            }
            
            .pdf-preview-section {
                margin-bottom: 20px;
            }
            
            .pdf-preview-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }
            
            .pdf-preview-title {
                font-weight: 500;
                font-size: 14px;
                color: var(--text-primary);
            }
            
            .pdf-preview-pages {
                font-size: 12px;
                color: var(--text-muted);
                background: var(--bg-secondary);
                padding: 4px 8px;
                border-radius: var(--radius-sm);
            }
            
            .pdf-scanned-warning {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 10px 12px;
                background: #fff8e1;
                border: 1px solid #ffe082;
                border-radius: var(--radius-md);
                margin-bottom: 12px;
                font-size: 13px;
                color: #f57c00;
            }
            
            .pdf-preview-thumbnails {
                display: flex;
                gap: 8px;
                overflow-x: auto;
                padding: 8px 0;
            }
            
            .pdf-preview-thumb {
                position: relative;
                flex-shrink: 0;
                width: 80px;
                height: 100px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-sm);
                overflow: hidden;
                background: var(--bg-secondary);
            }
            
            .pdf-preview-thumb img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
            
            .pdf-preview-page-num {
                position: absolute;
                bottom: 4px;
                right: 4px;
                font-size: 10px;
                background: rgba(0,0,0,0.7);
                color: white;
                padding: 2px 4px;
                border-radius: 2px;
            }
            
            .pdf-preview-no-text {
                position: absolute;
                top: 4px;
                left: 4px;
                font-size: 9px;
                background: #ff9800;
                color: white;
                padding: 2px 4px;
                border-radius: 2px;
            }
            
            .pdf-preview-more {
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
                width: 40px;
                height: 100px;
                font-size: 20px;
                color: var(--text-muted);
            }
            
            .pdf-import-settings {
                background: var(--bg-secondary);
                border-radius: var(--radius-md);
                padding: 16px;
                margin-bottom: 16px;
            }
            
            .pdf-setting-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 12px;
            }
            
            .pdf-setting-row:last-child {
                margin-bottom: 0;
            }
            
            .pdf-setting-row.checkbox {
                justify-content: flex-start;
                gap: 8px;
            }
            
            .pdf-setting-label {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            
            .pdf-setting-label span:first-child {
                font-size: 13px;
                font-weight: 500;
                color: var(--text-primary);
            }
            
            .pdf-setting-hint {
                font-size: 11px;
                color: var(--text-muted);
            }
            
            .pdf-setting-input,
            .pdf-setting-select {
                padding: 6px 10px;
                border: 1px solid var(--border-color);
                border-radius: var(--radius-sm);
                font-size: 13px;
                background: var(--bg-primary);
                color: var(--text-primary);
                min-width: 140px;
            }
            
            .pdf-setting-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                cursor: pointer;
            }
            
            .pdf-setting-checkbox input[type="checkbox"] {
                width: 16px;
                height: 16px;
            }
            
            .pdf-import-actions {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            
            .pdf-import-hint {
                font-size: 11px;
                opacity: 0.8;
                margin-left: 6px;
            }
            
            .pdf-import-progress-container {
                padding: 32px;
                text-align: center;
            }
            
            .pdf-import-progress-header {
                font-size: 16px;
                font-weight: 500;
                margin-bottom: 20px;
                color: var(--text-primary);
            }
            
            .pdf-import-progress-bar {
                width: 100%;
                height: 8px;
                background: var(--bg-secondary);
                border-radius: 4px;
                overflow: hidden;
                margin-bottom: 16px;
            }
            
            .pdf-import-progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #2383e2, #4facfe);
                border-radius: 4px;
                transition: width 0.3s ease;
                width: 0%;
            }
            
            .pdf-import-progress-status {
                font-size: 14px;
                color: var(--text-primary);
                margin-bottom: 4px;
            }
            
            .pdf-import-progress-detail {
                font-size: 12px;
                color: var(--text-muted);
            }
            
            .import-error-actions {
                display: flex;
                gap: 10px;
                margin-top: 12px;
            }
            
            .ai-btn.secondary {
                background: var(--bg-secondary);
                color: var(--text-primary);
            }
            
            @keyframes pdf-pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            
            .pdf-import-progress-fill.indeterminate {
                animation: pdf-pulse 1.5s ease-in-out infinite;
                background: linear-gradient(90deg, #2383e2, #4facfe, #2383e2);
                background-size: 200% 100%;
            }
        `;
        
        document.head.appendChild(style);
    }
    
    /**
     * Show export all modal
     */
    function showExportAllModal() {
        const modal = document.createElement('div');
        modal.className = 'export-all-modal';
        modal.innerHTML = `
            <div class="export-all-content">
                <div class="export-all-header">
                    <h3 style="margin: 0; font-size: 18px;">📤 Export All Pages</h3>
                </div>
                <div class="export-all-body">
                    <div class="export-all-options">
                        <div class="export-all-option" data-format="md">
                            <span class="export-all-option-icon">📝</span>
                            <div class="export-all-option-info">
                                <div class="export-all-option-title">Markdown</div>
                                <div class="export-all-option-desc">Export all pages as a single Markdown file</div>
                            </div>
                        </div>
                        <div class="export-all-option" data-format="json">
                            <span class="export-all-option-icon">📋</span>
                            <div class="export-all-option-info">
                                <div class="export-all-option-title">JSON Backup</div>
                                <div class="export-all-option-desc">Export all data as JSON (includes metadata)</div>
                            </div>
                        </div>
                        <div class="export-all-option" data-format="html">
                            <span class="export-all-option-icon">🌐</span>
                            <div class="export-all-option-info">
                                <div class="export-all-option-title">HTML</div>
                                <div class="export-all-option-desc">Export all pages as a single HTML document</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="export-all-footer">
                    <button class="ai-btn" id="export-all-cancel">Cancel</button>
                </div>
            </div>
        `;
        
        modal.querySelector('#export-all-cancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelectorAll('.export-all-option').forEach(option => {
            option.addEventListener('click', async () => {
                const format = option.dataset.format;
                await exportAllPages(format);
                modal.remove();
            });
        });
        
        document.body.appendChild(modal);
    }
    
    /**
     * Export all pages in a format
     */
    async function exportAllPages(format) {
        const allPages = Storage.getPages();
        
        try {
            showToast(`Exporting ${allPages.length} pages...`, 'info');
            
            if (format === 'json') {
                // Use storage backup
                Storage.exportToFile();
                showToast('Exported all pages as JSON', 'success');
                return;
            }
            
            if (format === 'md') {
                let allMarkdown = '';
                allPages.forEach((page, index) => {
                    allMarkdown += ImportExport.exportToMarkdown(page);
                    if (index < allPages.length - 1) {
                        allMarkdown += '\n\n---\n\n';
                    }
                });
                downloadFile(allMarkdown, 'all-pages.md', 'text/markdown');
                showToast('Exported all pages as Markdown', 'success');
                return;
            }
            
            if (format === 'html') {
                let allHTML = `<!DOCTYPE html>
<html>
<head>
    <title>All Pages Export</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; }
        .page { margin-bottom: 60px; padding-bottom: 40px; border-bottom: 2px solid #eee; }
        h1 { font-size: 32px; margin-bottom: 8px; }
        .page-icon { font-size: 48px; }
    </style>
</head>
<body>`;
                
                for (const page of allPages) {
                    allHTML += `
    <div class="page">
        ${page.icon ? `<div class="page-icon">${page.icon}</div>` : ''}
        <h1>${escapeHtml(page.title || 'Untitled')}</h1>
        ${page.blocks.map(b => ImportExport.exportToHTML ? '' : `<p>${escapeHtml(typeof b.content === 'string' ? b.content : '')}</p>`).join('')}
    </div>`;
                }
                
                allHTML += '</body></html>';
                downloadFile(allHTML, 'all-pages.html', 'text/html');
                showToast('Exported all pages as HTML', 'success');
            }
        } catch (error) {
            console.error('Export all error:', error);
            showToast(`Export failed: ${error.message}`, 'error');
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
    
    // Toast management
    const toastQueue = [];
    const MAX_TOASTS = 3;
    const TOAST_DURATION = 5000;
    
    /**
     * Show toast notification with stacking and auto-dismiss
     */
    function showToast(message, type = 'info', options = {}) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const { 
            duration = TOAST_DURATION, 
            action = null,  // { label: string, callback: function }
            onClose = null 
        } = options;
        
        // Remove oldest toast if at max
        if (toastQueue.length >= MAX_TOASTS) {
            const oldest = toastQueue.shift();
            if (oldest && oldest.element) {
                oldest.element.remove();
            }
        }
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        
        // Build toast content
        let content = `<span>${escapeHtml(message)}</span>`;
        
        if (action) {
            content += `<button class="toast-action" style="margin-left: auto; background: transparent; border: none; color: var(--accent-color); cursor: pointer; font-weight: 500; padding: 4px 8px; border-radius: var(--radius-sm);">${escapeHtml(action.label)}</button>`;
        }
        
        content += `<button class="toast-close" aria-label="Close notification" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; margin-left: ${action ? '8px' : 'auto'}; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;">✕</button>`;
        
        toast.innerHTML = content;
        
        // Add close button handler
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.addEventListener('click', () => {
            removeToast(toastItem);
            if (onClose) onClose();
        });
        
        // Add action button handler
        if (action) {
            const actionBtn = toast.querySelector('.toast-action');
            actionBtn.addEventListener('click', () => {
                action.callback();
                removeToast(toastItem);
            });
        }
        
        container.appendChild(toast);
        
        const toastItem = {
            element: toast,
            timeout: setTimeout(() => {
                removeToast(toastItem);
                if (onClose) onClose();
            }, duration)
        };
        
        toastQueue.push(toastItem);
        
        // Animate in
        requestAnimationFrame(() => {
            toast.style.animation = 'slideIn 0.3s ease';
        });
    }
    
    /**
     * Remove a toast from the queue and DOM
     */
    function removeToast(toastItem) {
        const index = toastQueue.indexOf(toastItem);
        if (index > -1) {
            toastQueue.splice(index, 1);
        }
        
        if (toastItem.element) {
            toastItem.element.style.opacity = '0';
            toastItem.element.style.transform = 'translateX(100%)';
            toastItem.element.style.transition = 'all 0.3s ease';
            setTimeout(() => {
                toastItem.element.remove();
            }, 300);
        }
        
        if (toastItem.timeout) {
            clearTimeout(toastItem.timeout);
        }
    }
    
    /**
     * Show undo toast for block deletion
     */
    function showUndoToast(message, undoCallback) {
        let undoPerformed = false;
        
        showToast(message, 'info', {
            duration: 5000,
            action: {
                label: 'Undo',
                callback: () => {
                    undoPerformed = true;
                    undoCallback();
                }
            },
            onClose: () => {
                // Toast closed without undo - finalize deletion
                if (!undoPerformed) {
                    // Optional: perform permanent cleanup
                }
            }
        });
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
    
    /**
     * Global PDF import progress callback
     */
    window.showPDFImportProgress = function(progress) {
        // This is handled within the modal, but can be customized here
        console.log('PDF Import Progress:', progress);
    };
    
    // Expose to window
    window.Sidebar = {
        init,
        refreshPageTree,
        loadPage,
        createNewPage,
        showTemplateModal,
        showToast,
        showUndoToast,
        showSearchModal,
        showImportModal,
        exportCurrentPage,
        showExportAllModal,
        toggle: toggleSidebar
    };
    
    return window.Sidebar;
})();
