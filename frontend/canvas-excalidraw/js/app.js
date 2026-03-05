/**
 * Main App Controller - Event coordination and app initialization
 * Enhanced: Uses OpenAI SDK for API communication
 */

class App {
    constructor() {
        this.currentTool = 'selection';
        this.init();
    }
    
    init() {
        // Wait for all modules to load
        document.addEventListener('DOMContentLoaded', () => {
            this.setupEventListeners();
            this.setupImageUpload();
            this.setupTheme();
            this.setupExport();
            this.setupKeyboardShortcuts();
            
            // Note: WebSocket not used with OpenAI SDK mode
            console.log('OpenAI SDK mode: WebSocket not used');
            
            // Initial render
            window.infiniteCanvas?.render();
            
            // Push initial state for undo
            window.historyManager?.pushState([]);
            
            // Setup model selector
            this.setupModelSelector();
            
            // Setup AI panel mode toggles
            this.setupAIModeToggles();
            
            console.log('Kimi Canvas initialized with OpenAI SDK');
        });
    }
    
    setupEventListeners() {
        // Zoom controls
        document.getElementById('zoomInBtn')?.addEventListener('click', () => {
            window.infiniteCanvas?.zoomIn();
        });
        
        document.getElementById('zoomOutBtn')?.addEventListener('click', () => {
            window.infiniteCanvas?.zoomOut();
        });
        
        document.getElementById('resetZoomBtn')?.addEventListener('click', () => {
            window.infiniteCanvas?.resetZoom();
        });
        
        // Theme toggle
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            this.toggleTheme();
        });
        
        // Export button
        document.getElementById('exportBtn')?.addEventListener('click', () => {
            this.showExportModal();
        });
        
        // Import button
        document.getElementById('importBtn')?.addEventListener('click', () => {
            this.importJSON();
        });
        
        // Help button
        document.getElementById('helpBtn')?.addEventListener('click', () => {
            this.showHelpModal();
        });
        
        // Share button
        document.getElementById('shareBtn')?.addEventListener('click', () => {
            this.shareCanvas();
        });
        
        // Clear canvas button
        document.getElementById('clearBtn')?.addEventListener('click', () => {
            this.clearCanvas();
        });
        
        // Export modal
        document.getElementById('closeExportModal')?.addEventListener('click', () => {
            this.hideExportModal();
        });
        
        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.exportCanvas(btn.dataset.format);
            });
        });
        
        // Help modal
        document.getElementById('closeHelpModal')?.addEventListener('click', () => {
            this.hideHelpModal();
        });
        
        // Close modals on backdrop click
        document.getElementById('exportModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideExportModal();
        });
        
        document.getElementById('helpModal')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.hideHelpModal();
        });
        
        // Drag and drop for files
        document.addEventListener('dragover', (e) => {
            e.preventDefault();
            document.body.classList.add('drag-over');
        });
        
        document.addEventListener('dragleave', (e) => {
            e.preventDefault();
            document.body.classList.remove('drag-over');
        });
        
        document.addEventListener('drop', (e) => {
            e.preventDefault();
            document.body.classList.remove('drag-over');
            this.handleFileDrop(e);
        });
        
        // Prevent leaving page with unsaved changes
        window.addEventListener('beforeunload', (e) => {
            const canvas = window.infiniteCanvas;
            if (canvas && canvas.elements.length > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }
    
    setupKeyboardShortcuts() {
        // Global keyboard shortcuts handled in individual modules
        // Additional app-level shortcuts:
        document.addEventListener('keydown', (e) => {
            // Help shortcut
            if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                this.showHelpModal();
            }
            
            // Escape to close modals and deselect
            if (e.key === 'Escape') {
                this.hideExportModal();
                this.hideHelpModal();
                window.aiAssistant?.hidePanel();
                window.infiniteCanvas?.deselectAll();
            }
            
            // Ctrl/Cmd shortcuts
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'z':
                        e.preventDefault();
                        if (e.shiftKey) {
                            window.historyManager?.redo();
                        } else {
                            window.historyManager?.undo();
                        }
                        break;
                    case 'y':
                        e.preventDefault();
                        window.historyManager?.redo();
                        break;
                    case 'd':
                        e.preventDefault();
                        window.selectionManager?.duplicateSelection();
                        break;
                    case 'g':
                        e.preventDefault();
                        if (e.shiftKey) {
                            window.selectionManager?.ungroupSelection();
                        } else {
                            window.selectionManager?.groupSelection();
                        }
                        break;
                    case 's':
                        e.preventDefault();
                        this.exportCanvas('json');
                        break;
                    case 'o':
                        e.preventDefault();
                        this.importJSON();
                        break;
                    case 'a':
                        e.preventDefault();
                        // Select all
                        const canvas = window.infiniteCanvas;
                        canvas.selectElements(canvas.elements);
                        break;
                }
            }
        });
    }
    
    setupImageUpload() {
        const input = document.getElementById('imageInput');
        if (!input) return;
        
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            this.loadImage(file, {
                x: parseFloat(input.dataset.posX) || 0,
                y: parseFloat(input.dataset.posY) || 0
            });
            
            // Reset input
            input.value = '';
        });
    }
    
    loadImage(file, pos) {
        const canvas = window.infiniteCanvas;
        const reader = new FileReader();
        
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Calculate size while maintaining aspect ratio
                const maxWidth = 400;
                const maxHeight = 300;
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
                
                // If no position specified, use center of view
                const x = pos?.x || canvas.screenToWorld(canvas.canvas.width / 2, canvas.canvas.height / 2).x;
                const y = pos?.y || canvas.screenToWorld(canvas.canvas.width / 2, canvas.canvas.height / 2).y;
                
                const element = {
                    id: window.toolManager.generateId(),
                    type: 'image',
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    imageElement: img,
                    ...window.toolManager.defaultProperties
                };
                
                canvas.addElement(element);
                window.historyManager?.pushState(canvas.elements);
                
                // Reset tool to selection
                window.toolManager.setTool('selection');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    handleFileDrop(e) {
        const files = e.dataTransfer.files;
        const canvas = window.infiniteCanvas;
        const rect = canvas.container.getBoundingClientRect();
        
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                // Get drop position
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const worldPos = canvas.screenToWorld(x, y);
                
                this.loadImage(file, worldPos);
            } else if (file.name.endsWith('.json')) {
                this.importJSONFile(file);
            }
        }
    }
    
    setupTheme() {
        // Check for saved theme preference
        const savedTheme = localStorage.getItem('kimi-canvas-theme');
        if (savedTheme) {
            document.documentElement.setAttribute('data-theme', savedTheme);
        } else {
            // Check system preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                document.documentElement.setAttribute('data-theme', 'dark');
            }
        }
    }
    
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('kimi-canvas-theme', newTheme);
        window.infiniteCanvas?.render();
    }
    
    setupExport() {
        // Already handled in setupEventListeners
    }
    
    onSelectionChange() {
        const canvas = window.infiniteCanvas;
        
        // Update properties panel
        window.propertiesManager?.updateForSelection();
        
        // Update selection box
        if (canvas.selectedElements.length === 1) {
            window.renderer?.updateSelectionBox(canvas.selectedElements[0]);
        } else {
            window.renderer?.hideSelectionBox();
        }
    }
    
    showExportModal() {
        document.getElementById('exportModal')?.classList.add('active');
    }
    
    hideExportModal() {
        document.getElementById('exportModal')?.classList.remove('active');
    }
    
    showHelpModal() {
        document.getElementById('helpModal')?.classList.add('active');
    }
    
    hideHelpModal() {
        document.getElementById('helpModal')?.classList.remove('active');
    }
    
    setupModelSelector() {
        const topModelSelect = document.getElementById('topModelSelect');
        if (topModelSelect) {
            // Set initial value from localStorage via apiManager
            topModelSelect.value = window.apiManager.getSelectedModel();
            
            // Handle model change
            topModelSelect.addEventListener('change', (e) => {
                window.apiManager.setSelectedModel(e.target.value);
                
                // Also update AI panel model selector if it exists
                const diagramModelSelect = document.getElementById('diagramModelSelect');
                if (diagramModelSelect) {
                    diagramModelSelect.value = e.target.value;
                }
            });
        }
    }
    
    setupAIModeToggles() {
        // Mode toggle buttons
        const diagramModeBtn = document.getElementById('diagramModeBtn');
        const imageModeBtn = document.getElementById('imageModeBtn');
        
        if (diagramModeBtn) {
            diagramModeBtn.addEventListener('click', () => {
                window.aiAssistant?.setMode('diagram');
            });
        }
        
        if (imageModeBtn) {
            imageModeBtn.addEventListener('click', () => {
                window.aiAssistant?.setMode('image');
            });
        }
        
        // Diagram model selector
        const diagramModelSelect = document.getElementById('diagramModelSelect');
        if (diagramModelSelect) {
            diagramModelSelect.value = window.apiManager.getSelectedModel();
            diagramModelSelect.addEventListener('change', (e) => {
                window.apiManager.setSelectedModel(e.target.value);
                
                // Also update top bar selector
                const topModelSelect = document.getElementById('topModelSelect');
                if (topModelSelect) {
                    topModelSelect.value = e.target.value;
                }
            });
        }
        
        // Image model selector
        const imageModelSelect = document.getElementById('imageModelSelect');
        if (imageModelSelect) {
            imageModelSelect.addEventListener('change', (e) => {
                window.aiAssistant?.updateImageSettings('model', e.target.value);
                window.aiAssistant?.updateImageSizeOptions(e.target.value);
            });
        }
        
        // Image size selector
        const imageSizeSelect = document.getElementById('imageSizeSelect');
        if (imageSizeSelect) {
            imageSizeSelect.addEventListener('change', (e) => {
                window.aiAssistant?.updateImageSettings('size', e.target.value);
            });
        }
        
        // Image quality selector
        const imageQualitySelect = document.getElementById('imageQualitySelect');
        if (imageQualitySelect) {
            imageQualitySelect.addEventListener('change', (e) => {
                window.aiAssistant?.updateImageSettings('quality', e.target.value);
            });
        }
        
        // Image style selector
        const imageStyleSelect = document.getElementById('imageStyleSelect');
        if (imageStyleSelect) {
            imageStyleSelect.addEventListener('change', (e) => {
                window.aiAssistant?.updateImageSettings('style', e.target.value);
            });
        }
        
        // Download image button
        const downloadImageBtn = document.getElementById('downloadImageBtn');
        if (downloadImageBtn) {
            downloadImageBtn.addEventListener('click', () => {
                this.downloadSelectedImage();
            });
        }
    }
    
    downloadSelectedImage() {
        const canvas = window.infiniteCanvas;
        if (canvas.selectedElements.length === 1) {
            const el = canvas.selectedElements[0];
            if (el.type === 'image' && el.imageUrl) {
                const a = document.createElement('a');
                a.href = el.imageUrl;
                a.download = `ai-image-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        }
    }
    
    clearCanvas() {
        if (confirm('Are you sure you want to clear the canvas? This cannot be undone.')) {
            const canvas = window.infiniteCanvas;
            canvas.elements = [];
            canvas.selectedElements = [];
            window.historyManager?.clear();
            window.historyManager?.pushState([]);
            canvas.render();
            this.onSelectionChange();
        }
    }
    
    async exportCanvas(format) {
        this.hideExportModal();
        
        const canvas = window.infiniteCanvas;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        switch (format) {
            case 'png':
                const dataURL = canvas.exportToDataURL('image/png');
                this.downloadFile(dataURL, `canvas-${timestamp}.png`);
                break;
                
            case 'svg':
                const svgData = this.exportToSVG();
                this.downloadFile('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgData), `canvas-${timestamp}.svg`);
                break;
                
            case 'json':
                const jsonData = JSON.stringify(canvas.elements, null, 2);
                const blob = new Blob([jsonData], { type: 'application/json' });
                this.downloadFile(URL.createObjectURL(blob), `canvas-${timestamp}.json`);
                break;
        }
    }
    
    exportToSVG() {
        const canvas = window.infiniteCanvas;
        
        // Calculate bounds
        const bounds = canvas.getBounds();
        const padding = 20;
        
        const width = bounds.width + padding * 2;
        const height = bounds.height + padding * 2;
        const offsetX = -bounds.x + padding;
        const offsetY = -bounds.y + padding;
        
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const bgColor = isDark ? '#1e1e1e' : '#ffffff';
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>`;
        svg += `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
        svg += `<rect width="100%" height="100%" fill="${bgColor}"/>`;
        
        // Export each element
        for (const el of canvas.elements) {
            svg += this.elementToSVG(el, offsetX, offsetY);
        }
        
        svg += '</svg>';
        return svg;
    }
    
    elementToSVG(el, offsetX, offsetY) {
        const x = (el.x || 0) + offsetX;
        const y = (el.y || 0) + offsetY;
        const hw = (el.width || 0) / 2;
        const hh = (el.height || 0) / 2;
        const stroke = el.strokeColor || '#000000';
        const fill = el.backgroundColor || 'none';
        const strokeWidth = el.strokeWidth || 2;
        const opacity = el.opacity ?? 1;
        
        let svg = '';
        
        switch (el.type) {
            case 'rectangle':
                svg = `<rect x="${x - hw}" y="${y - hh}" width="${el.width}" height="${el.height}"`;
                svg += ` fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"`;
                if (el.edgeType === 'round') {
                    const r = Math.min(el.width, el.height) * 0.1;
                    svg += ` rx="${r}" ry="${r}"`;
                }
                svg += '/>';
                break;
                
            case 'diamond':
                const points = `${x},${y - hh} ${x + hw},${y} ${x},${y + hh} ${x - hw},${y}`;
                svg = `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
                break;
                
            case 'ellipse':
                svg = `<ellipse cx="${x}" cy="${y}" rx="${hw}" ry="${hh}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
                break;
                
            case 'text':
                if (el.text) {
                    const lines = el.text.split('\n');
                    const lineHeight = (el.fontSize || 20) * 1.4;
                    const startY = y - (lines.length - 1) * lineHeight / 2;
                    
                    svg += `<g opacity="${opacity}">`;
                    lines.forEach((line, i) => {
                        const lineY = startY + i * lineHeight;
                        svg += `<text x="${x}" y="${lineY}" text-anchor="middle" dominant-baseline="middle" fill="${stroke}" font-size="${el.fontSize || 20}" font-family="${this.escapeXml(el.fontFamily || 'sans-serif')}">${this.escapeXml(line)}</text>`;
                    });
                    svg += '</g>';
                }
                break;
                
            case 'sticky':
                svg = `<rect x="${x - hw}" y="${y - hh}" width="${el.width}" height="${el.height}"`;
                svg += ` fill="${el.backgroundColor || '#ffec99'}" stroke="${el.strokeColor || '#e6b800'}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
                
                if (el.text) {
                    svg += `<text x="${x - hw + 12}" y="${y - hh + 24}" fill="${el.strokeColor || '#5c4b00'}" font-size="16" font-family="${this.escapeXml(el.fontFamily || 'Virgil, cursive')}">${this.escapeXml(el.text)}</text>`;
                }
                break;
                
            case 'line':
            case 'arrow':
                if (el.points && el.points.length >= 2) {
                    const p1 = el.points[0];
                    const p2 = el.points[1];
                    svg = `<line x1="${p1.x + offsetX}" y1="${p1.y + offsetY}" x2="${p2.x + offsetX}" y2="${p2.y + offsetY}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}"/>`;
                    
                    if (el.type === 'arrow') {
                        // Simple arrowhead
                        const arrowSize = Math.max(10, strokeWidth * 4);
                        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                        const arrowAngle1 = angle + Math.PI * 0.85;
                        const arrowAngle2 = angle - Math.PI * 0.85;
                        
                        const ax1 = p2.x + Math.cos(arrowAngle1) * arrowSize;
                        const ay1 = p2.y + Math.sin(arrowAngle1) * arrowSize;
                        const ax2 = p2.x + Math.cos(arrowAngle2) * arrowSize;
                        const ay2 = p2.y + Math.sin(arrowAngle2) * arrowSize;
                        
                        svg += `<polygon points="${p2.x + offsetX},${p2.y + offsetY} ${ax1 + offsetX},${ay1 + offsetY} ${ax2 + offsetX},${ay2 + offsetY}" fill="${stroke}" opacity="${opacity}"/>`;
                    }
                }
                break;
                
            case 'freedraw':
                if (el.points && el.points.length >= 2) {
                    let path = `M ${el.points[0].x + offsetX} ${el.points[0].y + offsetY}`;
                    for (let i = 1; i < el.points.length; i++) {
                        path += ` L ${el.points[i].x + offsetX} ${el.points[i].y + offsetY}`;
                    }
                    svg = `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
                }
                break;
        }
        
        return svg;
    }
    
    escapeXml(text) {
        return text.replace(/[<>&'"]/g, c => ({
            '<': '&lt;',
            '>': '&gt;',
            '&': '&amp;',
            "'": '&apos;',
            '"': '&quot;'
        })[c]);
    }
    
    downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    importJSON() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this.importJSONFile(file);
        };
        input.click();
    }
    
    importJSONFile(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const elements = JSON.parse(event.target.result);
                this.importElements(elements);
            } catch (error) {
                console.error('Import error:', error);
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    }
    
    importElements(elements) {
        if (!Array.isArray(elements)) {
            // Try to handle Excalidraw format
            if (elements.elements && Array.isArray(elements.elements)) {
                elements = elements.elements;
            } else {
                alert('Invalid format: expected array of elements');
                return;
            }
        }
        
        const canvas = window.infiniteCanvas;
        
        // Generate new IDs for imported elements
        const newElements = elements.map(el => ({
            ...el,
            id: window.toolManager.generateId(),
            imageElement: undefined // Can't serialize image elements
        }));
        
        // Add to canvas
        for (const el of newElements) {
            canvas.addElement(el);
        }
        
        // Select imported elements
        canvas.deselectAll();
        for (const el of newElements) {
            canvas.selectElement(el, true);
        }
        
        window.historyManager?.pushState(canvas.elements);
    }
    
    async shareCanvas() {
        const canvas = window.infiniteCanvas;
        const json = JSON.stringify(canvas.elements);
        
        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(json);
                this.showToast('Canvas data copied to clipboard!');
            } else {
                throw new Error('Clipboard API not available');
            }
        } catch (error) {
            console.error('Share error:', error);
            alert('Could not copy to clipboard');
        }
    }
    
    showToast(message, duration = 3000) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--bg-secondary);
            color: var(--text-primary);
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: var(--shadow-md);
            z-index: 10000;
            animation: fadeIn 0.2s ease;
        `;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.2s ease';
            setTimeout(() => toast.remove(), 200);
        }, duration);
    }
    
    handleAIGeneratedDiagram(payload) {
        window.aiAssistant?.processGeneratedContent({ content: payload });
    }
}

// Create global app instance
window.app = new App();
