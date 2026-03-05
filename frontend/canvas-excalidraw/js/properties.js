/**
 * Properties Module - Right panel property controls
 * Enhanced: Added alignment tools, grid snapping toggle
 */

class PropertiesManager {
    constructor() {
        this.selectedElement = null;
        this.init();
    }
    
    init() {
        // Stroke color picker
        document.querySelectorAll('#strokeColorPicker .color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setStrokeColor(btn.dataset.color);
                this.updateColorUI(btn, '#strokeColorPicker');
            });
        });
        
        // Background color picker
        document.querySelectorAll('#backgroundColorPicker .color-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setBackgroundColor(btn.dataset.color);
                this.updateColorUI(btn, '#backgroundColorPicker');
            });
        });
        
        // Stroke width picker
        document.querySelectorAll('#strokeWidthPicker .stroke-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setStrokeWidth(parseInt(btn.dataset.width));
                this.updateStrokeWidthUI(btn);
            });
        });
        
        // Stroke style picker
        document.querySelectorAll('#strokeStylePicker .stroke-style-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setStrokeStyle(btn.dataset.style);
                this.updateStrokeStyleUI(btn);
            });
        });
        
        // Roughness picker
        document.querySelectorAll('#roughnessPicker .roughness-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setRoughness(parseInt(btn.dataset.roughness));
                this.updateRoughnessUI(btn);
            });
        });
        
        // Edges picker
        document.querySelectorAll('#edgesPicker .edge-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setEdgeType(btn.dataset.edge);
                this.updateEdgesUI(btn);
            });
        });
        
        // Opacity slider
        const opacitySlider = document.getElementById('opacitySlider');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                this.setOpacity(parseInt(e.target.value) / 100);
                document.getElementById('opacityValue').textContent = e.target.value + '%';
            });
        }
        
        // Font size picker
        document.querySelectorAll('#fontSizePicker .font-size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setFontSize(parseInt(btn.dataset.size));
                this.updateFontSizeUI(btn);
            });
        });
        
        // Font family select
        const fontSelect = document.getElementById('fontFamilySelect');
        if (fontSelect) {
            fontSelect.addEventListener('change', (e) => {
                this.setFontFamily(e.target.value);
            });
        }
        
        // Layer actions
        document.getElementById('deleteBtn')?.addEventListener('click', () => {
            this.deleteSelection();
        });
        
        document.getElementById('duplicateBtn')?.addEventListener('click', () => {
            window.selectionManager?.duplicateSelection();
        });
        
        document.getElementById('bringToFrontBtn')?.addEventListener('click', () => {
            window.selectionManager?.bringToFront();
        });
        
        document.getElementById('sendToBackBtn')?.addEventListener('click', () => {
            window.selectionManager?.sendToBack();
        });
        
        // Alignment buttons
        document.getElementById('alignLeftBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignLeft();
        });
        
        document.getElementById('alignCenterBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignCenter();
        });
        
        document.getElementById('alignRightBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignRight();
        });
        
        document.getElementById('alignTopBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignTop();
        });
        
        document.getElementById('alignMiddleBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignMiddle();
        });
        
        document.getElementById('alignBottomBtn')?.addEventListener('click', () => {
            window.selectionManager?.alignBottom();
        });
        
        // Distribution buttons
        document.getElementById('distributeHBtn')?.addEventListener('click', () => {
            window.selectionManager?.distributeHorizontal();
        });
        
        document.getElementById('distributeVBtn')?.addEventListener('click', () => {
            window.selectionManager?.distributeVertical();
        });
        
        // Grid snap toggle
        document.getElementById('snapToGridBtn')?.addEventListener('click', () => {
            const canvas = window.infiniteCanvas;
            const enabled = canvas.toggleSnapToGrid();
            const btn = document.getElementById('snapToGridBtn');
            if (btn) {
                btn.classList.toggle('active', enabled);
            }
        });
    }
    
    updateForSelection() {
        const canvas = window.infiniteCanvas;
        const elements = canvas.selectedElements;
        
        if (elements.length === 0) {
            this.selectedElement = null;
            this.disableControls(true);
            return;
        }
        
        if (elements.length === 1) {
            this.selectedElement = elements[0];
            this.disableControls(false);
            this.syncUItoElement(this.selectedElement);
        } else {
            // Multiple selection - disable specific controls
            this.selectedElement = null;
            this.disableControls(false);
            document.getElementById('fontSizeGroup')?.classList.add('disabled');
            document.getElementById('fontFamilyGroup')?.classList.add('disabled');
        }
        
        // Update alignment button visibility
        this.updateAlignmentVisibility(elements.length);
        
        // Update AI image properties visibility
        this.updateAIImageProperties(elements);
    }
    
    updateAlignmentVisibility(selectionCount) {
        const alignmentGroup = document.getElementById('alignmentGroup');
        if (alignmentGroup) {
            alignmentGroup.style.display = selectionCount >= 2 ? 'block' : 'none';
        }
    }
    
    disableControls(disabled) {
        const panel = document.getElementById('propertiesPanel');
        if (disabled) {
            panel?.classList.add('no-selection');
        } else {
            panel?.classList.remove('no-selection');
        }
    }
    
    syncUItoElement(element) {
        // Update stroke color
        const strokeBtn = document.querySelector(`#strokeColorPicker .color-btn[data-color="${element.strokeColor}"]`);
        if (strokeBtn) this.updateColorUI(strokeBtn, '#strokeColorPicker');
        
        // Update background color
        const bgBtn = document.querySelector(`#backgroundColorPicker .color-btn[data-color="${element.backgroundColor}"]`);
        if (bgBtn) this.updateColorUI(bgBtn, '#backgroundColorPicker');
        
        // Update stroke width
        const widthBtn = document.querySelector(`#strokeWidthPicker .stroke-btn[data-width="${element.strokeWidth}"]`);
        if (widthBtn) this.updateStrokeWidthUI(widthBtn);
        
        // Update stroke style
        const styleBtn = document.querySelector(`#strokeStylePicker .stroke-style-btn[data-style="${element.strokeStyle}"]`);
        if (styleBtn) this.updateStrokeStyleUI(styleBtn);
        
        // Update roughness
        const roughnessBtn = document.querySelector(`#roughnessPicker .roughness-btn[data-roughness="${element.roughness}"]`);
        if (roughnessBtn) this.updateRoughnessUI(roughnessBtn);
        
        // Update edge type
        const edgeBtn = document.querySelector(`#edgesPicker .edge-btn[data-edge="${element.edgeType}"]`);
        if (edgeBtn) this.updateEdgesUI(edgeBtn);
        
        // Update opacity
        const opacitySlider = document.getElementById('opacitySlider');
        if (opacitySlider) {
            opacitySlider.value = (element.opacity ?? 1) * 100;
            document.getElementById('opacityValue').textContent = Math.round((element.opacity ?? 1) * 100) + '%';
        }
        
        // Update font size (for text)
        if (element.type === 'text' || element.type === 'sticky') {
            const fontSizeBtn = document.querySelector(`#fontSizePicker .font-size-btn[data-size="${element.fontSize}"]`);
            if (fontSizeBtn) this.updateFontSizeUI(fontSizeBtn);
            
            const fontSelect = document.getElementById('fontFamilySelect');
            if (fontSelect) fontSelect.value = element.fontFamily || 'Virgil, cursive';
        }
        
        // Update AI image properties
        if (element.type === 'image' && element.aiGenerated) {
            this.updateAIImageInfo(element);
        }
    }
    
    updateAIImageProperties(elements) {
        const imagePropertiesGroup = document.getElementById('imagePropertiesGroup');
        if (!imagePropertiesGroup) return;
        
        if (elements.length === 1 && elements[0].type === 'image' && elements[0].aiGenerated) {
            imagePropertiesGroup.style.display = 'block';
            this.updateAIImageInfo(elements[0]);
        } else {
            imagePropertiesGroup.style.display = 'none';
        }
    }
    
    updateAIImageInfo(element) {
        const promptEl = document.getElementById('aiImagePrompt');
        if (promptEl) {
            const prompt = element.originalPrompt || 'AI Generated Image';
            promptEl.textContent = prompt;
            promptEl.title = element.revisedPrompt || prompt;
        }
    }
    
    // Property setters
    setStrokeColor(color) {
        window.toolManager.updateDefaultProperties({ strokeColor: color });
        this.updateSelectedElements('strokeColor', color);
    }
    
    setBackgroundColor(color) {
        window.toolManager.updateDefaultProperties({ backgroundColor: color });
        this.updateSelectedElements('backgroundColor', color);
    }
    
    setStrokeWidth(width) {
        window.toolManager.updateDefaultProperties({ strokeWidth: width });
        this.updateSelectedElements('strokeWidth', width);
    }
    
    setStrokeStyle(style) {
        window.toolManager.updateDefaultProperties({ strokeStyle: style });
        this.updateSelectedElements('strokeStyle', style);
    }
    
    setRoughness(roughness) {
        window.toolManager.updateDefaultProperties({ roughness: roughness });
        this.updateSelectedElements('roughness', roughness);
    }
    
    setEdgeType(edge) {
        window.toolManager.updateDefaultProperties({ edgeType: edge });
        this.updateSelectedElements('edgeType', edge);
    }
    
    setOpacity(opacity) {
        window.toolManager.updateDefaultProperties({ opacity: opacity });
        this.updateSelectedElements('opacity', opacity);
    }
    
    setFontSize(size) {
        window.toolManager.updateDefaultProperties({ fontSize: size });
        this.updateSelectedElements('fontSize', size);
    }
    
    setFontFamily(family) {
        window.toolManager.updateDefaultProperties({ fontFamily: family });
        this.updateSelectedElements('fontFamily', family);
    }
    
    updateSelectedElements(property, value) {
        const canvas = window.infiniteCanvas;
        let changed = false;
        
        for (const el of canvas.selectedElements) {
            if (el[property] !== value) {
                el[property] = value;
                changed = true;
            }
        }
        
        if (changed) {
            canvas.render();
            window.historyManager?.pushState(canvas.elements);
        }
    }
    
    deleteSelection() {
        const canvas = window.infiniteCanvas;
        for (const el of canvas.selectedElements) {
            canvas.removeElement(el.id);
        }
        canvas.deselectAll();
        window.historyManager?.pushState(canvas.elements);
    }
    
    // UI update helpers
    updateColorUI(activeBtn, container) {
        document.querySelectorAll(`${container} .color-btn`).forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
    
    updateStrokeWidthUI(activeBtn) {
        document.querySelectorAll('#strokeWidthPicker .stroke-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
    
    updateStrokeStyleUI(activeBtn) {
        document.querySelectorAll('#strokeStylePicker .stroke-style-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
    
    updateRoughnessUI(activeBtn) {
        document.querySelectorAll('#roughnessPicker .roughness-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
    
    updateEdgesUI(activeBtn) {
        document.querySelectorAll('#edgesPicker .edge-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
    
    updateFontSizeUI(activeBtn) {
        document.querySelectorAll('#fontSizePicker .font-size-btn').forEach(btn => btn.classList.remove('active'));
        activeBtn.classList.add('active');
    }
}

// Create global instance
window.propertiesManager = new PropertiesManager();
