/**
 * AI Assistant Module - AI diagram generation panel
 * Enhanced: Uses OpenAI SDK for diagram and image generation
 */

class AIAssistant {
    constructor() {
        this.panel = document.getElementById('aiPanel');
        this.input = document.getElementById('aiInput');
        this.generateBtn = document.getElementById('aiGenerateBtn');
        this.status = document.getElementById('aiStatus');
        this.isGenerating = false;
        
        // Mode: 'diagram' or 'image'
        this.mode = 'diagram';
        
        // Available models
        this.models = [];
        this.imageModels = [];
        
        // Image generation settings
        this.imageSettings = {
            model: 'dall-e-3',
            size: '1024x1024',
            quality: 'standard',
            style: 'vivid'
        };
        
        // Image click position for placing generated images
        this.pendingImagePosition = null;
        
        this.init();
    }
    
    init() {
        // Toggle panel
        document.getElementById('aiAssistantBtn')?.addEventListener('click', () => {
            this.togglePanel();
        });
        
        // Close panel
        document.getElementById('closeAiPanel')?.addEventListener('click', () => {
            this.hidePanel();
        });
        
        // Generate button
        this.generateBtn?.addEventListener('click', () => {
            this.generate();
        });
        
        // Enter key in textarea (Ctrl+Enter to submit)
        this.input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.generate();
            }
        });
        
        // Suggestion buttons
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.input.value = btn.dataset.prompt;
                this.generate();
            });
        });
        
        // Fetch models on init
        this.fetchModels();
    }
    
    async fetchModels() {
        // Fetch chat models using OpenAI SDK
        this.models = await window.apiManager.getModels();
        
        // Fetch image models
        this.imageModels = await window.apiManager.getImageModels();
        
        // Update UI with models
        this.updateModelSelectors();
    }
    
    updateModelSelectors() {
        // Update diagram model selector
        const diagramModelSelect = document.getElementById('diagramModelSelect');
        if (diagramModelSelect) {
            diagramModelSelect.innerHTML = this.models.map(m => 
                `<option value="${m.id}" ${m.id === window.apiManager.getSelectedModel() ? 'selected' : ''}>${m.name}</option>`
            ).join('');
        }
        
        // Update image model selector
        const imageModelSelect = document.getElementById('imageModelSelect');
        if (imageModelSelect) {
            imageModelSelect.innerHTML = this.imageModels.map(m => 
                `<option value="${m.id}" ${m.id === this.imageSettings.model ? 'selected' : ''}>${m.name}</option>`
            ).join('');
        }
    }
    
    togglePanel() {
        this.panel?.classList.toggle('active');
        if (this.panel?.classList.contains('active')) {
            this.input?.focus();
        }
    }
    
    hidePanel() {
        this.panel?.classList.remove('active');
    }
    
    setMode(mode) {
        this.mode = mode;
        
        // Update UI
        const diagramModeBtn = document.getElementById('diagramModeBtn');
        const imageModeBtn = document.getElementById('imageModeBtn');
        const diagramOptions = document.getElementById('diagramOptions');
        const imageOptions = document.getElementById('imageOptions');
        const aiDescription = document.querySelector('.ai-description');
        
        if (mode === 'diagram') {
            diagramModeBtn?.classList.add('active');
            imageModeBtn?.classList.remove('active');
            diagramOptions?.classList.remove('hidden');
            imageOptions?.classList.add('hidden');
            if (aiDescription) {
                aiDescription.textContent = "Describe what you'd like me to draw, and I'll generate a diagram for you.";
            }
            if (this.input) {
                this.input.placeholder = "e.g., 'Create a flowchart showing user authentication process' or 'Draw a mind map about machine learning'";
            }
        } else {
            diagramModeBtn?.classList.remove('active');
            imageModeBtn?.classList.add('active');
            diagramOptions?.classList.add('hidden');
            imageOptions?.classList.remove('hidden');
            if (aiDescription) {
                aiDescription.textContent = "Describe the image you want to generate, and I'll create it for you.";
            }
            if (this.input) {
                this.input.placeholder = "e.g., 'A cute robot illustration, flat design' or 'Abstract geometric pattern in blue tones'";
            }
        }
    }
    
    async generate() {
        const prompt = this.input?.value.trim();
        if (!prompt || this.isGenerating) return;
        
        if (this.mode === 'diagram') {
            await this.generateDiagram(prompt);
        } else {
            await this.generateImage(prompt);
        }
    }
    
    async generateDiagram(prompt) {
        this.isGenerating = true;
        this.showStatus('Generating diagram...', 'loading');
        this.generateBtn.disabled = true;
        
        try {
            // Get current canvas state for context
            const existingContent = JSON.stringify(window.infiniteCanvas.elements);
            
            // Use OpenAI SDK via apiManager
            const response = await window.apiManager.generateDiagram(prompt, existingContent);
            
            if (response.content) {
                this.processGeneratedContent(response);
                this.showStatus('Diagram generated successfully!', 'success');
            } else {
                this.showStatus('No diagram generated. Try a different prompt.', 'error');
            }
        } catch (error) {
            console.error('Generation error:', error);
            this.showStatus('Error generating diagram. Please try again.', 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
        }
    }
    
    async generateImage(prompt) {
        this.isGenerating = true;
        this.showStatus('Generating image...', 'loading');
        this.generateBtn.disabled = true;
        
        try {
            // Use OpenAI SDK via apiManager
            const response = await window.apiManager.generateImage({
                prompt: prompt,
                model: this.imageSettings.model,
                size: this.imageSettings.size,
                quality: this.imageSettings.quality,
                style: this.imageSettings.style
            });
            
            if (response.data && response.data.length > 0) {
                await this.addImageToCanvas(response.data[0]);
                this.showStatus('Image generated successfully!', 'success');
                
                // Show revised prompt if available
                if (response.data[0].revised_prompt) {
                    console.log('Revised prompt:', response.data[0].revised_prompt);
                }
            } else {
                this.showStatus('No image generated. Try a different prompt.', 'error');
            }
        } catch (error) {
            console.error('Image generation error:', error);
            this.showStatus(`Error: ${error.message}`, 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
        }
    }
    
    async addImageToCanvas(imageData) {
        const canvas = window.infiniteCanvas;
        
        // Create image element
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        return new Promise((resolve, reject) => {
            img.onload = () => {
                // Calculate position
                let x, y;
                
                if (this.pendingImagePosition) {
                    // Use the position where user clicked with AI Image tool
                    x = this.pendingImagePosition.x;
                    y = this.pendingImagePosition.y;
                    this.pendingImagePosition = null;
                } else {
                    // Use center of current view
                    const center = canvas.screenToWorld(
                        canvas.canvas.width / 2,
                        canvas.canvas.height / 2
                    );
                    x = center.x;
                    y = center.y;
                }
                
                // Parse size for aspect ratio
                const [widthStr, heightStr] = this.imageSettings.size.split('x');
                const aspectRatio = parseInt(widthStr) / parseInt(heightStr);
                
                // Default size
                let width = 400;
                let height = width / aspectRatio;
                
                // Create element
                const element = {
                    id: window.toolManager.generateId(),
                    type: 'image',
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    imageElement: img,
                    // Store metadata
                    aiGenerated: true,
                    originalPrompt: this.input?.value.trim(),
                    revisedPrompt: imageData.revised_prompt,
                    imageModel: this.imageSettings.model,
                    imageUrl: imageData.url,
                    ...window.toolManager.defaultProperties
                };
                
                canvas.addElement(element);
                canvas.selectElement(element);
                window.historyManager?.pushState(canvas.elements);
                
                resolve(element);
            };
            
            img.onerror = () => {
                reject(new Error('Failed to load generated image'));
            };
            
            img.src = imageData.url;
        });
    }
    
    setImagePosition(pos) {
        this.pendingImagePosition = pos;
    }
    
    updateImageSettings(setting, value) {
        this.imageSettings[setting] = value;
        
        // Update available sizes based on model
        if (setting === 'model') {
            this.updateImageSizeOptions(value);
        }
    }
    
    updateImageSizeOptions(model) {
        const sizeSelect = document.getElementById('imageSizeSelect');
        if (!sizeSelect) return;
        
        let sizes = [];
        if (model === 'dall-e-3') {
            sizes = [
                { value: '1024x1024', label: '1024x1024 (Square)' },
                { value: '1024x1792', label: '1024x1792 (Portrait)' },
                { value: '1792x1024', label: '1792x1024 (Landscape)' }
            ];
        } else if (model === 'dall-e-2') {
            sizes = [
                { value: '256x256', label: '256x256' },
                { value: '512x512', label: '512x512' },
                { value: '1024x1024', label: '1024x1024' }
            ];
        }
        
        sizeSelect.innerHTML = sizes.map(s => 
            `<option value="${s.value}" ${s.value === this.imageSettings.size ? 'selected' : ''}>${s.label}</option>`
        ).join('');
    }
    
    processGeneratedContent(response) {
        const canvas = window.infiniteCanvas;
        
        // Parse the response content
        let elements = [];
        
        try {
            // Try to parse as JSON if it's Excalidraw format
            const parsed = JSON.parse(response.content);
            if (Array.isArray(parsed)) {
                elements = parsed;
            } else if (parsed.elements) {
                elements = parsed.elements;
            }
        } catch (e) {
            // Not JSON, treat as diagram description
            elements = this.parseDiagramDescription(response.content);
        }
        
        // Add elements to canvas
        if (elements.length > 0) {
            // Clear current selection
            canvas.deselectAll();
            
            // Center elements on current view
            const center = canvas.screenToWorld(
                canvas.canvas.width / 2,
                canvas.canvas.height / 2
            );
            
            // Calculate bounding box of new elements
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const el of elements) {
                const hw = (el.width || 0) / 2;
                const hh = (el.height || 0) / 2;
                minX = Math.min(minX, (el.x || 0) - hw);
                minY = Math.min(minY, (el.y || 0) - hh);
                maxX = Math.max(maxX, (el.x || 0) + hw);
                maxY = Math.max(maxY, (el.y || 0) + hh);
            }
            
            const elementsCenterX = (minX + maxX) / 2;
            const elementsCenterY = (minY + maxY) / 2;
            
            const offsetX = center.x - elementsCenterX;
            const offsetY = center.y - elementsCenterY;
            
            // Add elements with offset
            for (const el of elements) {
                const newElement = {
                    ...el,
                    id: window.toolManager.generateId(),
                    x: (el.x || 0) + offsetX,
                    y: (el.y || 0) + offsetY,
                    // Apply default properties if not specified
                    strokeColor: el.strokeColor || window.toolManager.defaultProperties.strokeColor,
                    backgroundColor: el.backgroundColor || window.toolManager.defaultProperties.backgroundColor,
                    strokeWidth: el.strokeWidth || window.toolManager.defaultProperties.strokeWidth,
                    strokeStyle: el.strokeStyle || window.toolManager.defaultProperties.strokeStyle,
                    roughness: el.roughness ?? window.toolManager.defaultProperties.roughness,
                    opacity: el.opacity ?? window.toolManager.defaultProperties.opacity,
                };
                
                // Offset points for lines/arrows
                if (el.points) {
                    newElement.points = el.points.map(p => ({
                        x: p.x + offsetX,
                        y: p.y + offsetY
                    }));
                }
                
                canvas.addElement(newElement);
                canvas.selectElement(newElement, true);
            }
            
            window.historyManager?.pushState(canvas.elements);
        }
    }
    
    parseDiagramDescription(description) {
        // Parse a text description and create basic elements
        // This is a simple parser - in production, you'd want more sophisticated parsing
        
        const elements = [];
        const lines = description.split('\n').filter(l => l.trim());
        
        let y = 100;
        const x = 400;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Check for different diagram elements based on keywords
            if (line.toLowerCase().includes('box') || line.toLowerCase().includes('rect')) {
                elements.push({
                    type: 'rectangle',
                    x: x,
                    y: y,
                    width: 200,
                    height: 80,
                    text: this.extractText(line)
                });
            } else if (line.toLowerCase().includes('diamond') || line.toLowerCase().includes('decision')) {
                elements.push({
                    type: 'diamond',
                    x: x,
                    y: y,
                    width: 160,
                    height: 120,
                    text: this.extractText(line)
                });
            } else if (line.toLowerCase().includes('circle') || line.toLowerCase().includes('oval')) {
                elements.push({
                    type: 'ellipse',
                    x: x,
                    y: y,
                    width: 140,
                    height: 100,
                    text: this.extractText(line)
                });
            } else if (line.toLowerCase().includes('arrow') || line.toLowerCase().includes('connect')) {
                if (i > 0) {
                    elements.push({
                        type: 'arrow',
                        points: [
                            { x: x, y: y - 60 },
                            { x: x, y: y + 20 }
                        ]
                    });
                }
            } else {
                // Default to text
                elements.push({
                    type: 'text',
                    x: x,
                    y: y,
                    text: line,
                    width: 200,
                    height: 40
                });
            }
            
            y += 120;
        }
        
        return elements;
    }
    
    extractText(line) {
        // Extract text between quotes or after colons
        const match = line.match(/["'](.+?)["']|:\s*(.+)/);
        return match ? (match[1] || match[2] || line) : line;
    }
    
    showStatus(message, type) {
        if (!this.status) return;
        
        this.status.textContent = message;
        this.status.className = 'ai-status ' + type;
        
        // Add spinner for loading state
        if (type === 'loading') {
            this.status.innerHTML = `<span class="spinner" style="display: inline-block; margin-right: 8px;"></span>${message}`;
        }
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                this.status.className = 'ai-status';
            }, 3000);
        }
    }
}

// Create global instance
window.aiAssistant = new AIAssistant();
