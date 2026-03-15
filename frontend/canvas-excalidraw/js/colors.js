/**
 * Colors Module - Comprehensive Color Management System
 * Features: Extended color palette, gradients, patterns, color history
 */

const ColorSystem = {
    // Comprehensive color palette (~40 colors)
    palette: {
        // Grays (10 colors)
        grays: [
            { name: 'White', value: '#ffffff' },
            { name: 'Gray 50', value: '#f8f9fa' },
            { name: 'Gray 100', value: '#f1f3f5' },
            { name: 'Gray 200', value: '#e9ecef' },
            { name: 'Gray 300', value: '#dee2e6' },
            { name: 'Gray 400', value: '#ced4da' },
            { name: 'Gray 500', value: '#adb5bd' },
            { name: 'Gray 600', value: '#868e96' },
            { name: 'Gray 700', value: '#495057' },
            { name: 'Gray 800', value: '#343a40' },
            { name: 'Gray 900', value: '#212529' },
            { name: 'Black', value: '#000000' }
        ],
        
        // Brand/Vibrant colors
        brand: [
            { name: 'Red', value: '#e03131' },
            { name: 'Pink', value: '#c2255c' },
            { name: 'Grape', value: '#9c36b5' },
            { name: 'Violet', value: '#6741d9' },
            { name: 'Indigo', value: '#4c6ef5' },
            { name: 'Blue', value: '#1971c2' },
            { name: 'Cyan', value: '#0c8599' },
            { name: 'Teal', value: '#099268' },
            { name: 'Green', value: '#2f9e44' },
            { name: 'Lime', value: '#66a80f' },
            { name: 'Yellow', value: '#f08c00' },
            { name: 'Orange', value: '#e8590c' }
        ],
        
        // Pastel colors
        pastels: [
            { name: 'Pink Pastel', value: '#ffc9c9' },
            { name: 'Grape Pastel', value: '#eebefa' },
            { name: 'Violet Pastel', value: '#d0bfff' },
            { name: 'Indigo Pastel', value: '#bac8ff' },
            { name: 'Blue Pastel', value: '#a5d8ff' },
            { name: 'Cyan Pastel', value: '#99e9f2' },
            { name: 'Teal Pastel', value: '#96f2d7' },
            { name: 'Green Pastel', value: '#b2f2bb' },
            { name: 'Lime Pastel', value: '#d8f5a2' },
            { name: 'Yellow Pastel', value: '#ffec99' },
            { name: 'Orange Pastel', value: '#ffd8a8' },
            { name: 'Red Pastel', value: '#ffa8a8' }
        ],
        
        // Lilly-specific colors
        excalidraw: [
            { name: 'Lilly Red', value: '#ff6b6b' },
            { name: 'Lilly Pink', value: '#ff9ff3' },
            { name: 'Lilly Purple', value: '#a29bfe' },
            { name: 'Lilly Blue', value: '#74b9ff' },
            { name: 'Lilly Cyan', value: '#81ecec' },
            { name: 'Lilly Teal', value: '#00b894' },
            { name: 'Lilly Green', value: '#55efc4' },
            { name: 'Lilly Yellow', value: '#ffeaa7' },
            { name: 'Lilly Orange', value: '#fdcb6e' },
            { name: 'Lilly Coral', value: '#e17055' },
            { name: 'Lilly Brown', value: '#d63031' },
            { name: 'Lilly Gray', value: '#636e72' }
        ]
    },
    
    // Gradient presets
    gradients: {
        // Linear gradients
        linear: {
            sunset: {
                name: 'Sunset',
                type: 'linear',
                direction: '135deg',
                stops: ['#ff6b6b', '#feca57']
            },
            ocean: {
                name: 'Ocean',
                type: 'linear',
                direction: '135deg',
                stops: ['#48dbfb', '#0abde3']
            },
            forest: {
                name: 'Forest',
                type: 'linear',
                direction: '135deg',
                stops: ['#1dd1a1', '#10ac84']
            },
            fire: {
                name: 'Fire',
                type: 'linear',
                direction: '135deg',
                stops: ['#ff9f43', '#ee5253']
            },
            twilight: {
                name: 'Twilight',
                type: 'linear',
                direction: '135deg',
                stops: ['#a29bfe', '#6c5ce7']
            },
            berry: {
                name: 'Berry',
                type: 'linear',
                direction: '135deg',
                stops: ['#fd79a8', '#e84393']
            },
            sky: {
                name: 'Sky',
                type: 'linear',
                direction: '180deg',
                stops: ['#74b9ff', '#0984e3']
            },
            mint: {
                name: 'Mint',
                type: 'linear',
                direction: '135deg',
                stops: ['#55efc4', '#00b894']
            },
            peach: {
                name: 'Peach',
                type: 'linear',
                direction: '135deg',
                stops: ['#fab1a0', '#e17055']
            },
            lavender: {
                name: 'Lavender',
                type: 'linear',
                direction: '135deg',
                stops: ['#dfe6e9', '#b2bec3']
            }
        },
        
        // Radial gradients
        radial: {
            sunrise: {
                name: 'Sunrise',
                type: 'radial',
                stops: ['#ffecd2', '#fcb69f']
            },
            bubblegum: {
                name: 'Bubblegum',
                type: 'radial',
                stops: ['#ff9a9e', '#fecfef']
            },
            midnight: {
                name: 'Midnight',
                type: 'radial',
                stops: ['#667eea', '#764ba2']
            },
            spring: {
                name: 'Spring',
                type: 'radial',
                stops: ['#a8edea', '#fed6e3']
            },
            warmth: {
                name: 'Warmth',
                type: 'radial',
                stops: ['#ffecd2', '#fcb69f']
            }
        }
    },
    
    // Pattern definitions
    patterns: {
        dots: {
            name: 'Dots',
            css: `radial-gradient(circle, var(--pattern-color, #000) 1.5px, transparent 1.5px)`,
            size: '10px 10px'
        },
        dotsSmall: {
            name: 'Small Dots',
            css: `radial-gradient(circle, var(--pattern-color, #000) 1px, transparent 1px)`,
            size: '6px 6px'
        },
        lines: {
            name: 'Lines',
            css: `repeating-linear-gradient(90deg, var(--pattern-color, #000) 0px, var(--pattern-color, #000) 1px, transparent 1px, transparent 8px)`,
            size: '8px 8px'
        },
        linesDiagonal: {
            name: 'Diagonal Lines',
            css: `repeating-linear-gradient(45deg, var(--pattern-color, #000) 0px, var(--pattern-color, #000) 1px, transparent 1px, transparent 8px)`,
            size: '8px 8px'
        },
        crosshatch: {
            name: 'Crosshatch',
            css: `repeating-linear-gradient(45deg, transparent, transparent 4px, var(--pattern-color, #000) 4px, var(--pattern-color, #000) 5px, transparent 5px, transparent 10px),
                  repeating-linear-gradient(-45deg, transparent, transparent 4px, var(--pattern-color, #000) 4px, var(--pattern-color, #000) 5px, transparent 5px, transparent 10px)`,
            size: '14px 14px'
        },
        waves: {
            name: 'Waves',
            css: `repeating-linear-gradient(90deg, var(--pattern-color, #000) 0px, var(--pattern-color, #000) 1px, transparent 1px, transparent 6px),
                  repeating-linear-gradient(0deg, var(--pattern-color, #000) 0px, var(--pattern-color, #000) 1px, transparent 1px, transparent 6px)`,
            size: '6px 6px'
        },
        grid: {
            name: 'Grid',
            css: `linear-gradient(var(--pattern-color, #000) 1px, transparent 1px),
                  linear-gradient(90deg, var(--pattern-color, #000) 1px, transparent 1px)`,
            size: '10px 10px'
        },
        checkerboard: {
            name: 'Checkerboard',
            css: `conic-gradient(var(--pattern-color, #000) 90deg, transparent 90deg, transparent 180deg, var(--pattern-color, #000) 180deg, var(--pattern-color, #000) 270deg, transparent 270deg)`,
            size: '12px 12px'
        }
    },
    
    // Color history (last 10 used colors)
    history: [],
    maxHistory: 10,
    
    // Initialize color system
    init() {
        this.loadHistory();
        this.setupEventListeners();
    },
    
    // Setup event listeners for color pickers
    setupEventListeners() {
        // Custom color input
        const customColorInput = document.getElementById('customColorInput');
        if (customColorInput) {
            customColorInput.addEventListener('change', (e) => {
                this.applyColor(e.target.value, customColorInput.dataset.target);
            });
        }
        
        // Extended color buttons
        document.querySelectorAll('.color-picker-extended .color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                const target = btn.closest('.color-section').dataset.target;
                this.applyColor(color, target);
                this.addToHistory(color);
            });
        });
        
        // Gradient buttons
        document.querySelectorAll('.gradient-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const gradientKey = btn.dataset.gradient;
                const type = btn.dataset.gradientType || 'linear';
                const gradient = this.gradients[type]?.[gradientKey];
                if (gradient) {
                    this.applyGradient(gradient);
                }
            });
        });
        
        // Pattern buttons
        document.querySelectorAll('.pattern-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const patternKey = btn.dataset.pattern;
                const pattern = this.patterns[patternKey];
                if (pattern) {
                    this.applyPattern(pattern, patternKey);
                }
            });
        });
        
        // History buttons
        document.querySelectorAll('.color-history .color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.dataset.color;
                const target = document.querySelector('.color-section.active')?.dataset.target || 'background';
                this.applyColor(color, target);
            });
        });
        
        // Color picker tabs
        document.querySelectorAll('.color-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchColorTab(tab);
            });
        });
    },
    
    // Apply color to selected elements
    applyColor(color, target = 'background') {
        if (window.propertiesManager) {
            if (target === 'stroke') {
                window.propertiesManager.setStrokeColor(color);
            } else {
                window.propertiesManager.setBackgroundColor(color);
            }
        }
        this.addToHistory(color);
    },
    
    // Apply gradient to selected elements
    applyGradient(gradient) {
        const canvas = window.infiniteCanvas;
        if (!canvas) return;
        
        let changed = false;
        for (const el of canvas.selectedElements) {
            el.fillType = 'gradient';
            el.gradient = { ...gradient };
            el.backgroundColor = null;
            el.pattern = null;
            changed = true;
        }
        
        if (changed) {
            canvas.render();
            window.historyManager?.pushState(canvas.elements);
        }
    },
    
    // Apply pattern to selected elements
    applyPattern(pattern, patternKey) {
        const canvas = window.infiniteCanvas;
        if (!canvas) return;
        
        let changed = false;
        for (const el of canvas.selectedElements) {
            el.fillType = 'pattern';
            el.pattern = { ...pattern, key: patternKey };
            el.backgroundColor = null;
            el.gradient = null;
            changed = true;
        }
        
        if (changed) {
            canvas.render();
            window.historyManager?.pushState(canvas.elements);
        }
    },
    
    // Add color to history
    addToHistory(color) {
        if (!color || color === 'transparent') return;
        
        // Remove if already exists
        this.history = this.history.filter(c => c !== color);
        
        // Add to front
        this.history.unshift(color);
        
        // Limit size
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(0, this.maxHistory);
        }
        
        this.saveHistory();
        this.updateHistoryUI();
    },
    
    // Load history from localStorage
    loadHistory() {
        try {
            const saved = localStorage.getItem('kimiCanvas_colorHistory');
            if (saved) {
                this.history = JSON.parse(saved);
            }
        } catch (e) {
            console.warn('Could not load color history:', e);
        }
    },
    
    // Save history to localStorage
    saveHistory() {
        try {
            localStorage.setItem('kimiCanvas_colorHistory', JSON.stringify(this.history));
        } catch (e) {
            console.warn('Could not save color history:', e);
        }
    },
    
    // Update history UI
    updateHistoryUI() {
        const container = document.querySelector('.color-history .color-picker-row');
        if (!container) return;
        
        container.innerHTML = this.history.map(color => `
            <button class="color-btn" data-color="${color}" style="background: ${color};" title="${color}"></button>
        `).join('');
        
        // Re-attach listeners
        container.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.querySelector('.color-section.active')?.dataset.target || 'background';
                this.applyColor(btn.dataset.color, target);
            });
        });
    },
    
    // Switch color tab
    switchColorTab(tab) {
        // Update tab buttons
        document.querySelectorAll('.color-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        
        // Update tab content
        document.querySelectorAll('.color-tab-content').forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tab);
        });
    },
    
    // Utility: Convert hex to rgb
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },
    
    // Utility: Convert rgb to hex
    rgbToHex(r, g, b) {
        return '#' + [r, g, b].map(x => {
            const hex = Math.round(x).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        }).join('');
    },
    
    // Utility: Lighten color
    lightenColor(hex, percent) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        
        return this.rgbToHex(
            Math.min(255, rgb.r + (255 - rgb.r) * percent / 100),
            Math.min(255, rgb.g + (255 - rgb.g) * percent / 100),
            Math.min(255, rgb.b + (255 - rgb.b) * percent / 100)
        );
    },
    
    // Utility: Darken color
    darkenColor(hex, percent) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return hex;
        
        return this.rgbToHex(
            Math.max(0, rgb.r * (100 - percent) / 100),
            Math.max(0, rgb.g * (100 - percent) / 100),
            Math.max(0, rgb.b * (100 - percent) / 100)
        );
    },
    
    // Utility: Get contrast color (black or white) for text on background
    getContrastColor(hex) {
        const rgb = this.hexToRgb(hex);
        if (!rgb) return '#000000';
        
        // Calculate luminance
        const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        return luminance > 0.5 ? '#000000' : '#ffffff';
    },
    
    // Generate gradient CSS string
    getGradientCSS(gradient) {
        if (gradient.type === 'linear') {
            return `linear-gradient(${gradient.direction}, ${gradient.stops.join(', ')})`;
        } else if (gradient.type === 'radial') {
            return `radial-gradient(circle, ${gradient.stops.join(', ')})`;
        }
        return '';
    },
    
    // Generate pattern CSS string
    getPatternCSS(pattern, color = '#000000') {
        return pattern.css.replace(/var\(--pattern-color, #[0-9a-fA-F]{3,6}\)/g, color);
    }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    ColorSystem.init();
});

// Export for use in other modules
window.ColorSystem = ColorSystem;
