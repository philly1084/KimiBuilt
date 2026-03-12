/**
 * Stickers & Icons Module - Emoji and icon library with drag-and-drop
 * Categories: emoji, arrows, shapes, tech, nature
 */

class StickersManager {
    constructor() {
        this.stickers = this.defineStickers();
        this.currentCategory = 'emoji';
        this.searchQuery = '';
        this.isDragging = false;
        this.draggedSticker = null;
        this.dragPreview = null;
        
        this.init();
    }
    
    init() {
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
            this.renderStickers();
        });
    }
    
    setupEventListeners() {
        // Category buttons
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentCategory = btn.dataset.category;
                this.renderStickers();
            });
        });
        
        // Search input
        const searchInput = document.getElementById('stickerSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderStickers();
            });
        }
        
        // Canvas drag and drop
        const canvas = document.getElementById('canvasContainer');
        if (canvas) {
            canvas.addEventListener('dragover', (e) => this.handleDragOver(e));
            canvas.addEventListener('drop', (e) => this.handleDrop(e));
            canvas.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        }
        
        // Global mouse events for drag preview
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }
    
    defineStickers() {
        return {
            emoji: [
                // Faces
                '😀', '😂', '🤣', '😁', '😃', '😄', '😅',
                '😆', '😉', '😊', '😋', '😎', '🤓', '🥰',
                '😍', '🤩', '😘', '😗', '☺️', '😚', '😙',
                '😌', '😜', '😝', '🤔', '🤭', '🤫', '🤥',
                '😐', '😑', '😶', '🙄', '😏', '😣', '😤',
                '😮', '🤐', '😯', '😦', '😧', '😬', '😰',
                '😱', '😨', '😳', '🥵', '🥶', '😖', '😡',
                '😠', '🤬', '😈', '👿', '💀', '☠️', '👻',
                // Gestures
                '👍', '👎', '👌', '✌️', '🤞', '🤘', '🤙',
                '👈', '👉', '👆', '👇', '👋', '👏', '🙌',
                '🤲', '🙏', '✊', '👊', '👏', '👐', '🤝',
                // People
                '👤', '👥', '👦', '👧', '🧑', '👨', '👩',
                '🧑‍🦰', '👨‍🦰', '👩‍🦰', '🧑‍🦳',
                '👨‍🦳', '👩‍🦳', '👱', '👲', '👳',
                // Activities
                '🚶', '🏃', '💃', '🕺', '👯', '🕴️', '🧖',
                '🧗', '🏌️', '🏄', '🏊', '🏋️', '🚴', '🚵',
                // Symbols
                '❤️', '💛', '💚', '💙', '💜', '🤎', '🤍',
                '♥️', '🖤', '💋', '💯', '💟', '✨', '⭐',
                '💫', '🔴', '🟡', '🟢', '🔵', '⚫', '⚪'
            ],
            
            arrows: [
                '←', '↑', '→', '↓', '↔', '↕', '↖', '↗', '↘', '↙',
                '⬅', '⬆', '⬇', '➡', '⮕', '⬌', '⬍', '⭕', '⏪', '⏩',
                '⏴', '⏵', '⏶', '⏷', '⤴', '⤵', '⮈', '⮉', '⮊', '⮋',
                '⟵', '⟶', '⟷', '⟸', '⟹', '⟺', '⟼', '⟽', '⟾', '⟿',
                '⇐', '⇑', '⇒', '⇓', '⇔', '⇕', '⇖', '⇗', '⇘', '⇙',
                '⇦', '⇧', '⇨', '⇩', '⇱', '⇲', '⇳', '⇴', '⇵', '⇶',
                '⭠', '⭡', '⭢', '⭣', '⭤', '⭥', '⭦', '⭧', '⭨', '⭩',
                '↩', '↪', '↢', '↣', '↰', '↱', '↲', '↳', '↶', '↷',
                '⤶', '⤷', '⤸', '⤹', '⤺', '⤻', '⤼', '⤽', '⤾', '⤿',
                '⥀', '⥁', '⇄', '⇅', '⇆', '⇇', '⇈', '⇉', '⇊', '⇋'
            ],
            
            shapes: [
                '■', '□', '▢', '▣', '▤', '▥', '▦', '▧', '▨', '▩',
                '▪', '▫', '▬', '▭', '▮', '▯', '▰', '▱', '▲', '△',
                '▴', '▵', '▶', '▷', '▸', '▹', '►', '▻', '▼', '▽',
                '▾', '▿', '◀', '◁', '◂', '◃', '◄', '◅', '◆', '◇',
                '◈', '◉', '◊', '○', '◌', '◍', '◎', '●', '◐', '◑',
                '◒', '◓', '◔', '◕', '◖', '◗', '◘', '◙', '◚', '◛',
                '◜', '◝', '◞', '◟', '◠', '◡', '◢', '◣', '◤', '◥',
                '◦', '◧', '◨', '◩', '◪', '◫', '◬', '◭', '◮', '◯',
                '★', '☆', '✦', '✧', '✪', '✫', '✬', '✭', '✮', '✯',
                '✰', '⭐', '⭑', '⭒', '⚠', '⚡', '✓', '✔', '✕', '✖'
            ],
            
            tech: [
                // Computers & Devices
                '💻', '🖥', '🖨', '⌨', '🖱', '🖲', '📡', '📱',
                '📲', '☎', '📞', '📟', '🧮', '📠', '📺', '📻',
                '🎥', '📷', '📸', '📹', '📼', '🔊', '🔋', '🔌',
                // Storage
                '💽', '💾', '💿', '📀', '📧', '📨', '📩', '📤',
                '📥', '📦', '📫', '📪', '📬', '📭', '📮', '🗳',
                // Media
                '📙', '📕', '📘', '📗', '📚', '📓', '📔', '📒',
                '📑', '📖', '📁', '📂', '📃', '📄', '📅', '📆',
                // Symbols
                '⚙', '⚛', '⚜', '⚠', '⚡', '⚪', '⚫', '⚽', '⚾', '⛄',
                '⛅', '⛈', '⛎', '⛏', '⛑', '⛓', '⛔', '⛩', '⛪', '⛰',
                // Locks & Security
                '🔐', '🔑', '🔒', '🔓', '❌', '⭕', '✅', '☑', '✔', '✖',
                // Internet
                '🌐', '🔗', '📝', '📐', '🔍', '🔎', '🔰', '♻',
                '♾', '♿', '⚒', '⚓', '⚔', '⚕', '⚖', '⚗',
                // Math/Science
                '∞', '√', '∑', '∫', '≈', '≠', '≡', '≤', '≥', '◇',
                '⊕', '⊖', '⊗', '⊘', '⊙', '⊚', '⊛', '⊜', '⊝', '⊞'
            ],
            
            nature: [
                // Weather
                '☀', '☁', '⛅', '⛈', '☂', '☔', '⚡', '⛄', '❄', '☃',
                '⛇', '☄', '★', '☆', '✦', '☇', '☈', '☉', '☊', '☋',
                // Plants
                '🌱', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘',
                '🍀', '🍁', '🍂', '🍃', '🍄', '🌰', '🌼',
                // Flowers
                '🌷', '🌸', '🌹', '🌺', '🌻', '🌽', '💐', '💞',
                '🏵', '💚', '💛', '💜', '💝', '🌊', '🌋',
                // Animals
                '🐵', '🐶', '🐷', '🐸', '🐹', '🐺', '🐻', '🐼',
                '🐽', '🐾', '🐿', '👀', '👁', '👂', '👃',
                '👄', '👅', '👆', '👇', '👈', '👉', '👊', '👋',
                '🦁', '🦂', '🐅', '🐆', '🐇', '🐈', '🐉', '🐐',
                // Birds
                '🐦', '🐧', '🐨', '🐩', '🐪', '🐫', '🐬', '🐭',
                '🐮', '🐯', '🐰', '🐱', '🐲', '🐳', '🐴',
                // Water
                '💦', '💧', '💨', '💩', '💪', '💫', '💬', '💭',
                '💮', '💯', '🌊', '🌋', '🌌', '🌍', '🌎', '🌏',
                // Elements
                '🔥', '💧', '💨', '💛', '💜', '💝', '💞', '💟',
                '💠', '💡', '💢', '💣', '💤', '💥', '✨', '⭐'
            ]
        };
    }
    
    showStickersPanel() {
        const panel = document.getElementById('stickersPanel');
        if (panel) {
            panel.style.display = 'flex';
            panel.classList.add('active');
        }
    }
    
    hideStickersPanel() {
        const panel = document.getElementById('stickersPanel');
        if (panel) {
            panel.style.display = 'none';
            panel.classList.remove('active');
        }
    }
    
    toggleStickersPanel() {
        const panel = document.getElementById('stickersPanel');
        if (panel?.classList.contains('active')) {
            this.hideStickersPanel();
        } else {
            this.showStickersPanel();
        }
    }
    
    renderStickers() {
        const grid = document.getElementById('stickersGrid');
        if (!grid) return;
        
        grid.innerHTML = '';
        
        let stickers = [];
        
        if (this.searchQuery) {
            // Search across all categories
            Object.values(this.stickers).forEach(category => {
                stickers = stickers.concat(category);
            });
            stickers = [...new Set(stickers)]; // Remove duplicates
        } else {
            stickers = this.stickers[this.currentCategory] || [];
        }
        
        // Filter by search if applicable
        if (this.searchQuery) {
            // Note: Emoji search is limited since we can't easily get names
            // In a real app, you'd have a mapping of emoji to keywords
            stickers = stickers.filter(s => s.includes(this.searchQuery));
        }
        
        stickers.forEach(sticker => {
            const item = document.createElement('div');
            item.className = 'sticker-item';
            item.textContent = sticker;
            item.draggable = true;
            item.dataset.sticker = sticker;
            
            // Click to add at center
            item.addEventListener('click', () => {
                this.addStickerToCanvas(sticker);
            });
            
            // Drag start
            item.addEventListener('mousedown', (e) => {
                this.startDrag(e, sticker);
            });
            
            // Touch support
            item.addEventListener('touchstart', (e) => {
                this.startDrag(e.touches[0], sticker);
            });
            
            grid.appendChild(item);
        });
    }
    
    startDrag(e, sticker) {
        this.isDragging = true;
        this.draggedSticker = sticker;
        
        // Create drag preview
        this.dragPreview = document.createElement('div');
        this.dragPreview.className = 'sticker-drag-preview';
        this.dragPreview.textContent = sticker;
        this.dragPreview.style.left = e.clientX + 'px';
        this.dragPreview.style.top = e.clientY + 'px';
        document.body.appendChild(this.dragPreview);
    }
    
    handleMouseMove(e) {
        if (!this.isDragging || !this.dragPreview) return;
        
        this.dragPreview.style.left = e.clientX + 'px';
        this.dragPreview.style.top = e.clientY + 'px';
    }
    
    handleMouseUp(e) {
        if (!this.isDragging) return;
        
        // Check if dropped on canvas
        const canvas = document.getElementById('canvasContainer');
        const rect = canvas.getBoundingClientRect();
        
        if (e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top && e.clientY <= rect.bottom) {
            
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            this.addStickerToCanvas(this.draggedSticker, x, y);
        }
        
        // Clean up
        this.isDragging = false;
        this.draggedSticker = null;
        if (this.dragPreview) {
            this.dragPreview.remove();
            this.dragPreview = null;
        }
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
    
    handleDrop(e) {
        e.preventDefault();
        const sticker = e.dataTransfer.getData('text/plain');
        if (sticker) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.addStickerToCanvas(sticker, x, y);
        }
    }
    
    handleDragLeave(e) {
        // Optional: visual feedback when leaving canvas
    }
    
    addStickerToCanvas(sticker, screenX, screenY) {
        const canvas = window.infiniteCanvas;
        if (!canvas) return;
        
        // Convert screen position to world position
        let worldPos;
        if (screenX !== undefined && screenY !== undefined) {
            worldPos = canvas.screenToWorld(screenX, screenY);
        } else {
            // Add at center of view
            const rect = canvas.container.getBoundingClientRect();
            worldPos = canvas.screenToWorld(rect.width / 2, rect.height / 2);
        }
        
        // Create text element with emoji
        const element = {
            id: window.toolManager.generateId(),
            type: 'text',
            x: worldPos.x,
            y: worldPos.y,
            text: sticker,
            width: 60,
            height: 60,
            fontSize: 40,
            fontFamily: 'system-ui, sans-serif',
            strokeColor: '#000000',
            backgroundColor: 'transparent',
            strokeWidth: 0,
            roughness: 0,
            opacity: 1
        };
        
        canvas.addElement(element);
        window.historyManager?.pushState(canvas.elements);
        
        // Select the new element
        canvas.selectElement(element);
    }
}

// Create global instance
window.stickersManager = new StickersManager();
