/**
 * Editor Module - Core block-based editor
 * Enhanced with undo/redo, improved drag-and-drop, and better features
 */

const Editor = (function() {
    let currentPage = null;
    let editorContainer = null;
    let isComposing = false;
    let saveTimeout = null;
    let inlineToolbar = null;
    let mentionPopup = null;
    
    // Page history for undo/redo
    const history = {
        stack: [],
        index: -1,
        maxSize: 50,
        isUndoing: false
    };
    
    /**
     * Initialize the editor
     */
    function init() {
        editorContainer = document.getElementById('editor');
        if (!editorContainer) return;
        
        setupEventListeners();
        setupInlineToolbar();
        setupMentions();
        setupUndoRedo();
    }
    
    /**
     * Setup undo/redo keyboard shortcuts
     */
    function setupUndoRedo() {
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            
            if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
        });
    }
    
    /**
     * Save current state to history
     */
    function saveToHistory() {
        if (history.isUndoing || !currentPage) return;
        
        const state = JSON.stringify(currentPage);
        
        // Don't save if same as last state
        if (history.index >= 0 && history.stack[history.index] === state) {
            return;
        }
        
        // Remove any redo states
        history.stack = history.stack.slice(0, history.index + 1);
        
        // Add new state
        history.stack.push(state);
        
        // Limit history size
        if (history.stack.length > history.maxSize) {
            history.stack.shift();
        } else {
            history.index++;
        }
    }
    
    /**
     * Undo last change
     */
    function undo() {
        if (history.index <= 0) {
            showToast('Nothing to undo', 'info');
            return;
        }
        
        history.isUndoing = true;
        history.index--;
        
        const state = JSON.parse(history.stack[history.index]);
        currentPage = state;
        
        // Update storage without triggering history
        Storage.updatePage(currentPage.id, currentPage);
        
        // Refresh editor
        refreshEditor();
        
        showToast('Undo', 'info');
        history.isUndoing = false;
    }
    
    /**
     * Redo last undone change
     */
    function redo() {
        if (history.index >= history.stack.length - 1) {
            showToast('Nothing to redo', 'info');
            return;
        }
        
        history.isUndoing = true;
        history.index++;
        
        const state = JSON.parse(history.stack[history.index]);
        currentPage = state;
        
        // Update storage without triggering history
        Storage.updatePage(currentPage.id, currentPage);
        
        // Refresh editor
        refreshEditor();
        
        showToast('Redo', 'info');
        history.isUndoing = false;
    }
    
    /**
     * Setup global event listeners
     */
    function setupEventListeners() {
        // Handle slash commands
        document.addEventListener('slash-command', (e) => {
            const { type, blockId } = e.detail;
            saveToHistory();
            convertBlockType(blockId, type);
        });
        
        // Handle paste
        editorContainer.addEventListener('paste', handlePaste);
        
        // Handle composition (for IME input)
        editorContainer.addEventListener('compositionstart', () => {
            isComposing = true;
        });
        
        editorContainer.addEventListener('compositionend', () => {
            isComposing = false;
        });
        
        // Global click to hide inline toolbar
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.inline-toolbar') && !e.target.closest('.block-input')) {
                hideInlineToolbar();
            }
            if (!e.target.closest('.mention-popup')) {
                hideMentionPopup();
            }
        });
    }
    
    /**
     * Setup inline formatting toolbar
     */
    function setupInlineToolbar() {
        // Toolbar is created dynamically when text is selected
    }
    
    /**
     * Show inline formatting toolbar
     */
    function showInlineToolbar(range) {
        hideInlineToolbar();
        
        const rect = range.getBoundingClientRect();
        const toolbar = document.createElement('div');
        toolbar.className = 'inline-toolbar';
        toolbar.innerHTML = `
            <button class="inline-toolbar-btn" data-cmd="bold" title="Bold (Ctrl+B)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
                    <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>
                </svg>
            </button>
            <button class="inline-toolbar-btn" data-cmd="italic" title="Italic (Ctrl+I)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="19" y1="4" x2="10" y2="4"></line>
                    <line x1="14" y1="20" x2="5" y2="20"></line>
                    <line x1="15" y1="4" x2="9" y2="20"></line>
                </svg>
            </button>
            <button class="inline-toolbar-btn" data-cmd="underline" title="Underline (Ctrl+U)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"></path>
                    <line x1="4" y1="21" x2="20" y2="21"></line>
                </svg>
            </button>
            <button class="inline-toolbar-btn" data-cmd="strikethrough" title="Strikethrough">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.3 4.9c-2.3-.6-4.4-1-6.2-.9-2.7.1-5.3.8-5.3 3.2 0 1.5 1.1 2.4 3 3.1"></path>
                    <path d="M12 21c3.4 0 6-1.2 6-3.5 0-1.6-.8-2.6-2.4-3.3"></path>
                    <line x1="4" y1="11" x2="20" y2="11"></line>
                </svg>
            </button>
            <div class="inline-toolbar-divider"></div>
            <button class="inline-toolbar-btn" data-cmd="createLink" title="Link (Ctrl+K)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
            </button>
            <button class="inline-toolbar-btn" data-cmd="removeFormat" title="Clear Formatting">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 7v4a1 1 0 0 0 1 1h3"></path>
                    <path d="M7 7v10"></path>
                    <path d="M10 8v8a1 1 0 0 0 1 1h2"></path>
                    <path d="M14 8v8"></path>
                    <path d="M17 7v4a1 1 0 0 0 1 1h3"></path>
                    <path d="M21 7v10"></path>
                    <line x1="3" y1="21" x2="21" y2="3"></line>
                </svg>
            </button>
        `;
        
        // Position toolbar above selection
        const toolbarHeight = 40;
        const toolbarWidth = 220;
        let left = rect.left + (rect.width / 2) - (toolbarWidth / 2);
        let top = rect.top - toolbarHeight - 8;
        
        // Keep on screen
        if (left < 10) left = 10;
        if (left + toolbarWidth > window.innerWidth - 10) {
            left = window.innerWidth - toolbarWidth - 10;
        }
        if (top < 10) {
            top = rect.bottom + 8;
        }
        
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${top}px`;
        
        // Handle button clicks
        toolbar.querySelectorAll('.inline-toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const cmd = btn.dataset.cmd;
                applyInlineFormat(cmd);
            });
        });
        
        document.body.appendChild(toolbar);
        inlineToolbar = toolbar;
    }
    
    /**
     * Hide inline toolbar
     */
    function hideInlineToolbar() {
        if (inlineToolbar) {
            inlineToolbar.remove();
            inlineToolbar = null;
        }
    }
    
    /**
     * Apply inline formatting
     */
    function applyInlineFormat(cmd) {
        document.execCommand(cmd, false, null);
        
        // Update button states
        if (inlineToolbar) {
            inlineToolbar.querySelectorAll('.inline-toolbar-btn').forEach(btn => {
                const command = btn.dataset.cmd;
                if (command !== 'createLink' && command !== 'removeFormat') {
                    btn.classList.toggle('active', document.queryCommandState(command));
                }
            });
        }
        
        // Trigger save
        autoSave();
    }
    
    /**
     * Setup @ mentions
     */
    function setupMentions() {
        // Handled in block input keyup
    }
    
    /**
     * Show mention popup
     */
    function showMentionPopup(query, x, y, blockId) {
        hideMentionPopup();
        
        const popup = document.createElement('div');
        popup.className = 'mention-popup';
        
        // Get pages and users as mention targets
        const pages = Storage.getPages().slice(0, 5);
        const mentions = [
            { type: 'date', name: 'Today', icon: '📅', hint: new Date().toLocaleDateString() },
            { type: 'date', name: 'Tomorrow', icon: '📅', hint: new Date(Date.now() + 86400000).toLocaleDateString() },
            ...pages.map(p => ({ type: 'page', name: p.title || 'Untitled', icon: p.icon || '📄', hint: 'Page', id: p.id }))
        ];
        
        // Filter by query
        const filtered = query 
            ? mentions.filter(m => m.name.toLowerCase().includes(query.toLowerCase()))
            : mentions;
        
        if (filtered.length === 0) {
            popup.innerHTML = `
                <div class="mention-popup-header">No results</div>
                <div style="padding: 12px; color: var(--text-muted); font-size: 14px;">
                    Try typing a page name
                </div>
            `;
        } else {
            popup.innerHTML = `
                <div class="mention-popup-header">Mention</div>
                ${filtered.map((m, i) => `
                    <div class="mention-item ${i === 0 ? 'selected' : ''}" data-type="${m.type}" data-id="${m.id || ''}" data-name="${m.name}">
                        <div class="mention-item-icon">${m.icon}</div>
                        <div class="mention-item-info">
                            <div class="mention-item-name">${m.name}</div>
                            <div class="mention-item-hint">${m.hint}</div>
                        </div>
                    </div>
                `).join('')}
            `;
        }
        
        // Position popup
        popup.style.left = `${Math.max(10, x)}px`;
        popup.style.top = `${Math.min(window.innerHeight - 200, y + 20)}px`;
        
        document.body.appendChild(popup);
        mentionPopup = popup;
        
        // Handle selection
        popup.querySelectorAll('.mention-item').forEach(item => {
            item.addEventListener('click', () => {
                insertMention(item.dataset.name, item.dataset.type, item.dataset.id);
            });
        });
    }
    
    /**
     * Hide mention popup
     */
    function hideMentionPopup() {
        if (mentionPopup) {
            mentionPopup.remove();
            mentionPopup = null;
        }
    }
    
    /**
     * Insert mention at cursor
     */
    function insertMention(name, type, id) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        
        const range = sel.getRangeAt(0);
        const textNode = range.startContainer;
        
        if (textNode.nodeType === Node.TEXT_NODE) {
            const text = textNode.textContent;
            const beforeAt = text.lastIndexOf('@', range.startOffset);
            
            if (beforeAt !== -1) {
                const before = text.substring(0, beforeAt);
                const after = text.substring(range.startOffset);
                
                textNode.textContent = before;
                
                const mentionSpan = document.createElement('span');
                mentionSpan.className = 'mention-highlight';
                mentionSpan.textContent = `@${name}`;
                mentionSpan.dataset.type = type;
                if (id) mentionSpan.dataset.id = id;
                mentionSpan.contentEditable = 'false';
                
                const afterNode = document.createTextNode(after + ' ');
                
                const parent = textNode.parentNode;
                parent.insertBefore(mentionSpan, textNode.nextSibling);
                parent.insertBefore(afterNode, mentionSpan.nextSibling);
                
                // Place cursor after mention
                range.setStart(afterNode, 1);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }
        
        hideMentionPopup();
        autoSave();
    }
    
    /**
     * Load a page into the editor
     */
    function loadPage(page) {
        currentPage = page;
        editorContainer.innerHTML = '';
        
        // Save initial state to history
        history.stack = [JSON.stringify(page)];
        history.index = 0;
        
        if (!page.blocks || page.blocks.length === 0) {
            // Create initial block
            const block = Blocks.createBlock('text', '');
            page.blocks = [block];
        }
        
        page.blocks.forEach((block, index) => {
            renderBlock(block, index);
        });
        
        // Update empty state visibility
        updateEmptyState();
        
        // Scroll to top
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.scrollTop = 0;
        }
    }
    
    /**
     * Render a single block
     */
    function renderBlock(block, index) {
        const blockEl = document.createElement('div');
        blockEl.className = 'block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.blockType = block.type;
        blockEl.draggable = true;
        
        if (block.color) {
            blockEl.classList.add(`color-${block.color}`);
        }
        
        // Add block button (+) on row - Click to add below
        const rowAddBtn = document.createElement('button');
        rowAddBtn.className = 'block-add-btn';
        rowAddBtn.innerHTML = '+';
        rowAddBtn.title = 'Add block below (click) / Drag to move';
        rowAddBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            insertBlockAfter(block.id, 'text');
            // Focus the new block
            setTimeout(() => {
                const newBlockEl = editorContainer.querySelector(`[data-block-id="${block.id}"]`)?.nextElementSibling;
                if (newBlockEl && newBlockEl.classList.contains('block')) {
                    const input = newBlockEl.querySelector('.block-input');
                    if (input) input.focus();
                }
            }, 50);
        });
        blockEl.appendChild(rowAddBtn);
        
        // Drag handle
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.title = 'Drag to move, click for menu';
        blockEl.appendChild(handle);
        
        // Block content based on type
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'block-content-wrapper';
        
        const renderFn = Blocks.render[block.type] || Blocks.render.text;
        const content = renderFn(block, true);
        
        contentWrapper.appendChild(content);
        blockEl.appendChild(contentWrapper);
        
        // Toggle children container
        if (block.type === 'toggle' && block.children && block.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'toggle-children';
            if (block.expanded === false) {
                childrenContainer.classList.add('collapsed');
            }
            
            block.children.forEach((child, childIndex) => {
                const childEl = renderBlockElement(child);
                childrenContainer.appendChild(childEl);
            });
            
            blockEl.appendChild(childrenContainer);
        }
        
        // Add block button (between blocks)
        const addBtn = document.createElement('div');
        addBtn.className = 'add-block-btn';
        addBtn.innerHTML = '+';
        addBtn.title = 'Add block';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            SlashMenu.show(e.clientX, e.clientY, block.id);
            SlashMenu.setCallback((type) => {
                insertBlockAfter(block.id, type);
            });
        });
        
        // Insert after this block in DOM
        editorContainer.appendChild(blockEl);
        editorContainer.appendChild(addBtn);
        
        // Setup block interactions
        setupBlockInteractions(blockEl, block);
        
        return blockEl;
    }
    
    /**
     * Render block element for reuse
     */
    function renderBlockElement(block) {
        const blockEl = document.createElement('div');
        blockEl.className = 'block';
        blockEl.dataset.blockId = block.id;
        blockEl.dataset.blockType = block.type;
        
        if (block.color) {
            blockEl.classList.add(`color-${block.color}`);
        }
        
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        blockEl.appendChild(handle);
        
        const renderFn = Blocks.render[block.type] || Blocks.render.text;
        const content = renderFn(block, true);
        blockEl.appendChild(content);
        
        setupBlockInteractions(blockEl, block);
        
        return blockEl;
    }
    
    /**
     * Setup interactions for a block
     */
    function setupBlockInteractions(blockEl, block) {
        const input = blockEl.querySelector('.block-input, [contenteditable="true"]');
        if (!input) return;
        
        // Set placeholder
        const blockType = Blocks.getBlockTypes()[block.type];
        if (blockType && blockType.placeholder && !block.content) {
            input.dataset.placeholder = blockType.placeholder;
        }
        
        // Focus - select block
        input.addEventListener('focus', () => {
            Selection.selectBlock(block.id, false);
            hideInlineToolbar();
        });
        
        // Blur - save content
        input.addEventListener('blur', () => {
            updateBlockContent(block.id, input);
            // Don't hide toolbar immediately to allow clicking it
            setTimeout(() => {
                if (!document.activeElement?.closest('.inline-toolbar')) {
                    hideInlineToolbar();
                }
            }, 200);
        });
        
        // Input - auto-save and update placeholder visibility
        input.addEventListener('input', () => {
            autoSave();
            
            // Update placeholder visibility
            if (input.textContent.trim()) {
                input.classList.add('has-content');
            } else {
                input.classList.remove('has-content');
            }
            
            // Hide inline toolbar on input
            hideInlineToolbar();
        });
        
        // Selection change - show inline toolbar
        const showToolbarOnSelection = () => {
            setTimeout(() => {
                const sel = window.getSelection();
                const text = sel.toString().trim();
                if (text.length > 0) {
                    // Don't show toolbar for AI placeholder text
                    if (!text.startsWith('?? ')) {
                        showInlineToolbar(sel.getRangeAt(0));
                    }
                } else {
                    hideInlineToolbar();
                }
            }, 10);
        };
        
        input.addEventListener('mouseup', showToolbarOnSelection);
        input.addEventListener('keyup', (e) => {
            // Show toolbar on selection keys (Shift+Arrow, Ctrl+A, etc.)
            if (e.shiftKey || e.key === 'Select' || e.ctrlKey || e.metaKey) {
                showToolbarOnSelection();
            }
        });
        
        // Keydown - navigation and shortcuts
        input.addEventListener('keydown', (e) => {
            if (isComposing) return;
            
            // Handle inline formatting shortcuts
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
                switch (e.key.toLowerCase()) {
                    case 'b':
                        e.preventDefault();
                        document.execCommand('bold', false, null);
                        return;
                    case 'i':
                        e.preventDefault();
                        document.execCommand('italic', false, null);
                        return;
                    case 'u':
                        e.preventDefault();
                        document.execCommand('underline', false, null);
                        return;
                    case 'k':
                        e.preventDefault();
                        const url = prompt('Enter link URL:');
                        if (url) {
                            document.execCommand('createLink', false, url);
                        }
                        return;
                }
            }
            
            handleBlockKeydown(e, block, input);
        });
        
        // Keyup - slash and mention detection
        input.addEventListener('keyup', (e) => {
            if (isComposing) return;
            handleBlockKeyup(e, block, input);
        });
        
        // Setup drag and drop
        Selection.setupDragAndDrop(blockEl, block.id);
        
        // Click to select
        blockEl.addEventListener('click', (e) => {
            if (e.target === blockEl || e.target.classList.contains('block-handle')) {
                Selection.selectBlock(block.id);
            }
        });
    }
    
    /**
     * Handle keydown events in a block
     */
    function handleBlockKeydown(e, block, input) {
        const sel = window.getSelection();
        const range = sel.getRangeAt(0);
        
        switch (e.key) {
            case 'Enter':
                if (!e.shiftKey) {
                    e.preventDefault();
                    saveToHistory();
                    
                    // Split content at cursor
                    let beforeText, afterText;
                    
                    if (range.startContainer.nodeType === Node.TEXT_NODE) {
                        const text = range.startContainer.textContent;
                        beforeText = text.substring(0, range.startOffset);
                        afterText = text.substring(range.startOffset);
                    } else {
                        beforeText = input.textContent;
                        afterText = '';
                    }
                    
                    // Check for markdown conversion on current block
                    const markdownMatch = Blocks.parseMarkdown(beforeText);
                    if (markdownMatch && block.type === 'text') {
                        // Convert current block
                        convertBlockType(block.id, markdownMatch.type, markdownMatch.content);
                        
                        // Create new block with remaining text
                        if (afterText.trim()) {
                            setTimeout(() => {
                                const newBlock = insertBlockAfter(block.id, 'text', afterText);
                                focusBlock(newBlock.id);
                            }, 0);
                        }
                    } else {
                        // Update current block
                        input.textContent = beforeText;
                        updateBlockContent(block.id, input);
                        
                        // Create new block
                        const newBlockType = (block.type === 'heading_1' || 
                            block.type === 'heading_2' || block.type === 'heading_3') ? 'text' : block.type;
                        const newBlock = insertBlockAfter(block.id, newBlockType, afterText);
                        focusBlock(newBlock.id);
                    }
                }
                break;
                
            case 'Backspace':
                // Check if at start of empty block
                if (input.textContent === '' || (range.startOffset === 0 && 
                    (!range.startContainer.previousSibling || 
                     (range.startContainer === input && !input.textContent)))) {
                    e.preventDefault();
                    saveToHistory();
                    mergeWithPrevious(block.id);
                }
                break;
                
            case 'Tab':
                e.preventDefault();
                saveToHistory();
                if (e.shiftKey) {
                    unindentBlock(block.id);
                } else {
                    indentBlock(block.id);
                }
                break;
                
            case 'ArrowUp':
                if (isAtStart(range, input)) {
                    e.preventDefault();
                    const prevBlock = getPreviousBlock(block.id);
                    if (prevBlock) {
                        focusBlock(prevBlock.id, 'end');
                    }
                }
                break;
                
            case 'ArrowDown':
                if (isAtEnd(range, input)) {
                    e.preventDefault();
                    const nextBlock = getNextBlock(block.id);
                    if (nextBlock) {
                        focusBlock(nextBlock.id, 'start');
                    }
                }
                break;
                
            case 'Escape':
                hideInlineToolbar();
                hideMentionPopup();
                input.blur();
                break;
        }
    }
    
    /**
     * Handle keyup events (for slash command and mention detection)
     */
    function handleBlockKeyup(e, block, input) {
        const text = input.textContent;
        const sel = window.getSelection();
        const range = sel.getRangeAt(0);
        
        // Check for slash at start
        if (text === '/' && !SlashMenu.isOpen()) {
            const rect = input.getBoundingClientRect();
            SlashMenu.show(rect.left, rect.bottom, block.id);
            SlashMenu.setCallback((type) => {
                convertBlockType(block.id, type);
            });
        }
        
        // Check for @ mention
        const cursorPos = range.startOffset;
        const beforeCursor = text.substring(0, cursorPos);
        const atMatch = beforeCursor.match(/@([\w]*)$/);
        
        if (atMatch && !mentionPopup) {
            const rect = range.getBoundingClientRect();
            showMentionPopup(atMatch[1], rect.left, rect.bottom, block.id);
        } else if (!atMatch && mentionPopup) {
            hideMentionPopup();
        }
    }
    
    /**
     * Check if cursor is at start
     */
    function isAtStart(range, element) {
        if (range.startOffset !== 0) return false;
        
        let node = range.startContainer;
        while (node && node !== element) {
            if (node.previousSibling) return false;
            node = node.parentNode;
        }
        return true;
    }
    
    /**
     * Check if cursor is at end
     */
    function isAtEnd(range, element) {
        if (range.startContainer.nodeType === Node.TEXT_NODE) {
            const text = range.startContainer.textContent;
            if (range.startOffset < text.length) return false;
        }
        
        let node = range.startContainer;
        while (node && node !== element) {
            if (node.nextSibling) return false;
            node = node.parentNode;
        }
        return true;
    }
    
    /**
     * Insert a new block after specified block
     */
    function insertBlockAfter(blockId, type = 'text', content = '') {
        if (!currentPage) return null;
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index === -1) return null;
        
        const newBlock = Blocks.createBlock(type, content);
        currentPage.blocks.splice(index + 1, 0, newBlock);
        
        // Re-render from this point
        refreshEditor();
        
        autoSave();
        
        return newBlock;
    }
    
    /**
     * Insert a block before specified block
     */
    function insertBlockBefore(blockId, type = 'text', content = '') {
        if (!currentPage) return null;
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index === -1) return null;
        
        const newBlock = Blocks.createBlock(type, content);
        currentPage.blocks.splice(index, 0, newBlock);
        
        refreshEditor();
        autoSave();
        
        return newBlock;
    }
    
    /**
     * Insert a block at specific index
     */
    function insertBlockAtIndex(index, type = 'text', content = '') {
        if (!currentPage) return null;
        
        saveToHistory();
        
        const newBlock = Blocks.createBlock(type, content);
        
        // Ensure index is valid
        if (index < 0) index = 0;
        if (index > currentPage.blocks.length) index = currentPage.blocks.length;
        
        currentPage.blocks.splice(index, 0, newBlock);
        
        refreshEditor();
        autoSave();
        
        return newBlock;
    }
    
    /**
     * Delete a block
     */
    function deleteBlock(blockId) {
        if (!currentPage) return;
        
        saveToHistory();
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index === -1) return;
        
        // Don't delete the last block, convert to empty text instead
        if (currentPage.blocks.length === 1) {
            currentPage.blocks[0] = Blocks.createBlock('text', '');
        } else {
            currentPage.blocks.splice(index, 1);
        }
        
        refreshEditor();
        autoSave();
        
        // Focus previous or next block
        const blocks = currentPage.blocks;
        const focusIndex = Math.min(index, blocks.length - 1);
        if (blocks[focusIndex]) {
            focusBlock(blocks[focusIndex].id);
        }
    }
    
    /**
     * Duplicate a block
     */
    function duplicateBlock(blockId) {
        if (!currentPage) return;
        
        saveToHistory();
        
        const block = currentPage.blocks.find(b => b.id === blockId);
        if (!block) return;
        
        const index = currentPage.blocks.indexOf(block);
        const newBlock = {
            ...JSON.parse(JSON.stringify(block)),
            id: Storage.generateBlockId(),
            createdAt: Date.now()
        };
        
        currentPage.blocks.splice(index + 1, 0, newBlock);
        
        refreshEditor();
        autoSave();
        
        focusBlock(newBlock.id);
    }
    
    /**
     * Convert block to different type
     */
    function convertBlockType(blockId, newType, newContent = null) {
        if (!currentPage) return;
        
        const block = currentPage.blocks.find(b => b.id === blockId);
        if (!block) return;
        
        // Handle content conversion
        if (newContent !== null) {
            block.content = newContent;
        }
        
        // Special handling for certain types
        if (newType === 'todo' && typeof block.content === 'string') {
            block.content = { text: block.content, checked: false };
        } else if (block.type === 'todo' && newType !== 'todo' && typeof block.content === 'object') {
            block.content = block.content.text || '';
        }
        
        block.type = newType;
        
        refreshEditor();
        autoSave();
        
        focusBlock(blockId);
    }
    
    /**
     * Update block content from DOM
     */
    function updateBlockContent(blockId, input) {
        if (!currentPage) return;
        
        const block = currentPage.blocks.find(b => b.id === blockId);
        if (!block) return;
        
        const text = input.textContent || '';
        
        if (block.type === 'todo' && typeof block.content === 'object') {
            block.content.text = text;
        } else if (block.type === 'code' && typeof block.content === 'object') {
            block.content.text = text;
        } else {
            block.content = text;
        }
        
        autoSave();
    }
    
    /**
     * Indent a block (make child of previous)
     */
    function indentBlock(blockId) {
        // Simplified - in full implementation, this would create nested structure
        console.log('Indent:', blockId);
    }
    
    /**
     * Unindent a block (move out of parent)
     */
    function unindentBlock(blockId) {
        console.log('Unindent:', blockId);
    }
    
    /**
     * Merge block with previous
     */
    function mergeWithPrevious(blockId) {
        if (!currentPage) return;
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index <= 0) return;
        
        const current = currentPage.blocks[index];
        const previous = currentPage.blocks[index - 1];
        
        // Get content
        let currentText = typeof current.content === 'object' ? current.content.text : current.content;
        let prevText = typeof previous.content === 'object' ? previous.content.text : previous.content;
        
        // Merge
        const mergedText = prevText + currentText;
        
        if (typeof previous.content === 'object') {
            previous.content.text = mergedText;
        } else {
            previous.content = mergedText;
        }
        
        // Remove current
        currentPage.blocks.splice(index, 1);
        
        refreshEditor();
        autoSave();
        
        // Focus previous at merged position
        focusBlock(previous.id, 'end');
    }
    
    /**
     * Get previous block
     */
    function getPreviousBlock(blockId) {
        if (!currentPage) return null;
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index <= 0) return null;
        
        return currentPage.blocks[index - 1];
    }
    
    /**
     * Get next block
     */
    function getNextBlock(blockId) {
        if (!currentPage) return null;
        
        const index = currentPage.blocks.findIndex(b => b.id === blockId);
        if (index === -1 || index >= currentPage.blocks.length - 1) return null;
        
        return currentPage.blocks[index + 1];
    }
    
    /**
     * Focus a block
     */
    function focusBlock(blockId, position = 'end') {
        const blockEl = document.querySelector(`.block[data-block-id="${blockId}"]`);
        if (!blockEl) return;
        
        const input = blockEl.querySelector('.block-input, [contenteditable="true"]');
        if (!input) return;
        
        input.focus();
        
        // Set cursor position
        const range = document.createRange();
        const sel = window.getSelection();
        
        if (position === 'start') {
            range.selectNodeContents(input);
            range.collapse(true);
        } else {
            range.selectNodeContents(input);
            range.collapse(false);
        }
        
        sel.removeAllRanges();
        sel.addRange(range);
    }
    
    /**
     * Refresh the entire editor
     */
    function refreshEditor() {
        if (!currentPage) return;
        
        // Remember focused block
        const focusedBlockId = document.activeElement?.closest('.block')?.dataset.blockId;
        
        editorContainer.innerHTML = '';
        currentPage.blocks.forEach((block, index) => {
            renderBlock(block, index);
        });
        
        // Restore focus
        if (focusedBlockId) {
            focusBlock(focusedBlockId);
        }
        
        updateEmptyState();
    }
    
    /**
     * Handle paste
     */
    function handlePaste(e) {
        e.preventDefault();
        
        const text = e.clipboardData.getData('text/plain');
        const html = e.clipboardData.getData('text/html');
        
        // Simple paste - insert as text
        document.execCommand('insertText', false, text);
    }
    
    /**
     * Auto-save page
     */
    function autoSave() {
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }
        
        saveTimeout = setTimeout(() => {
            savePage();
        }, 1000);
    }
    
    /**
     * Save current page
     */
    function savePage() {
        if (!currentPage) return;
        
        // Update page title from input
        const titleInput = document.getElementById('page-title');
        if (titleInput) {
            currentPage.title = titleInput.value;
        }
        
        // Update icon
        const iconEl = document.getElementById('page-icon');
        if (iconEl) {
            currentPage.icon = iconEl.textContent;
        }
        
        currentPage.updatedAt = Date.now();
        
        Storage.updatePage(currentPage.id, currentPage);
        
        // Update sidebar
        if (window.Sidebar) {
            window.Sidebar.refreshPageTree();
        }
    }
    
    /**
     * Update empty state visibility
     */
    function updateEmptyState() {
        const emptyState = document.getElementById('empty-state');
        if (!emptyState) return;
        
        if (!currentPage?.blocks?.length || 
            (currentPage.blocks.length === 1 && !currentPage.blocks[0].content)) {
            emptyState.style.display = 'block';
        } else {
            emptyState.style.display = 'none';
        }
    }
    
    /**
     * Change block color
     */
    function setBlockColor(blockId, color) {
        if (!currentPage) return;
        
        saveToHistory();
        
        const block = currentPage.blocks.find(b => b.id === blockId);
        if (!block) return;
        
        block.color = color;
        
        const blockEl = document.querySelector(`.block[data-block-id="${blockId}"]`);
        if (blockEl) {
            // Remove existing color classes
            blockEl.classList.forEach(cls => {
                if (cls.startsWith('color-')) {
                    blockEl.classList.remove(cls);
                }
            });
            
            if (color) {
                blockEl.classList.add(`color-${color}`);
            }
        }
        
        autoSave();
    }
    
    /**
     * Reorder blocks (drag and drop)
     */
    function reorderBlocks(draggedId, targetId) {
        if (!currentPage || draggedId === targetId) return;
        
        saveToHistory();
        
        const draggedIndex = currentPage.blocks.findIndex(b => b.id === draggedId);
        const targetIndex = currentPage.blocks.findIndex(b => b.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        // Remove dragged block
        const [draggedBlock] = currentPage.blocks.splice(draggedIndex, 1);
        
        // Insert at target position
        const newIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
        currentPage.blocks.splice(newIndex + 1, 0, draggedBlock);
        
        refreshEditor();
        autoSave();
    }
    
    /**
     * Get current page
     */
    function getCurrentPage() {
        return currentPage;
    }
    
    /**
     * Export current page as markdown
     */
    function exportToMarkdown() {
        if (!currentPage) return '';
        return ImportExport.exportToMarkdown(currentPage);
    }
    
    /**
     * Export current page as HTML
     */
    function exportToHTML() {
        if (!currentPage) return '';
        return ImportExport.exportToHTML(currentPage);
    }
    
    /**
     * Export current page as JSON
     */
    function exportToJSON() {
        if (!currentPage) return '';
        return ImportExport.exportToJSON(currentPage);
    }
    
    /**
     * Import blocks to current page
     */
    function importBlocks(blocks, options = {}) {
        if (!currentPage) return;
        
        saveToHistory();
        
        if (options.replace) {
            currentPage.blocks = blocks.map(b => ({
                ...b,
                id: Storage.generateBlockId(),
                createdAt: Date.now()
            }));
        } else {
            currentPage.blocks.push(...blocks.map(b => ({
                ...b,
                id: Storage.generateBlockId(),
                createdAt: Date.now()
            })));
        }
        
        refreshEditor();
        autoSave();
    }
    
    /**
     * Insert a database block
     */
    function insertDatabaseBlock(blockId) {
        return insertBlockAfter(blockId, 'database', {
            columns: ['Name', 'Status', 'Due Date'],
            rows: [
                ['Task 1', 'In Progress', 'Today'],
                ['Task 2', 'Not Started', 'Tomorrow']
            ],
            sortColumn: null,
            sortDirection: 'asc'
        });
    }
    
    /**
     * Show toast notification helper
     */
    function showToast(message, type = 'info') {
        if (window.Sidebar?.showToast) {
            window.Sidebar.showToast(message, type);
        }
    }
    
    /**
     * Add a block at the end of the document
     */
    function addBlockAtEnd(type = 'text', content = '') {
        if (!currentPage) return null;
        
        saveToHistory();
        
        const newBlock = Blocks.createBlock(type, content);
        currentPage.blocks.push(newBlock);
        
        // Re-render
        const blockEl = renderBlockElement(newBlock);
        editorContainer.appendChild(blockEl);
        
        // Update empty state (will show hint again since we have blocks)
        updateEmptyState();
        
        // Focus the new block
        setTimeout(() => focusBlock(newBlock.id), 0);
        
        // Auto-save
        savePage();
        
        return newBlock;
    }
    
    /**
     * Get the current model for AI operations
     */
    function getCurrentModel() {
        return currentPage?.model || Blocks.getDefaultModel?.() || 'gpt-4o';
    }
    
    /**
     * Update empty state visibility
     */
    function updateEmptyState() {
        const emptyState = document.getElementById('empty-state');
        
        const isEmpty = !currentPage?.blocks?.length || 
            (currentPage.blocks.length === 1 && !currentPage.blocks[0].content);
        
        if (emptyState) {
            emptyState.style.display = isEmpty ? 'block' : 'none';
        }
        
        // Note: add-block-hint disabled - users can use the + button on blocks instead
    }
    
    // Expose to window for access from other modules
    window.Editor = {
        init,
        loadPage,
        insertBlockAfter,
        insertBlockBefore,
        insertBlockAtIndex,
        deleteBlock,
        duplicateBlock,
        convertBlockType,
        setBlockColor,
        reorderBlocks,
        focusBlock,
        savePage,
        undo,
        redo,
        getCurrentPage,
        exportToMarkdown,
        exportToHTML,
        exportToJSON,
        importBlocks,
        insertDatabaseBlock,
        showInlineToolbar,
        hideInlineToolbar,
        updateBlockContent,
        addBlockAtEnd,
        getCurrentModel
    };
    
    return window.Editor;
})();
