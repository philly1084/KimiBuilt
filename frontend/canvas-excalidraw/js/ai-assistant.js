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
        this.conversation = document.getElementById('aiConversation');
        this.conversationEmpty = document.getElementById('aiConversationEmpty');
        this.isGenerating = false;
        
        // Mode: 'chat' | 'diagram' | 'image'
        this.mode = 'chat';
        
        // Available models
        this.models = [];
        this.imageModels = [];
        
        // Image generation settings
        this.imageSettings = {
            model: '',
            size: '1024x1024',
            quality: null,
            style: null
        };
        
        // Image click position for placing generated images
        this.pendingImagePosition = null;

        this.chatHistory = [];
        
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
        this.setMode('chat');
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
        const selectedModel = window.apiManager.getSelectedModel();
        const resolvedModel = this.models.find((model) => model.id === selectedModel)?.id || this.models[0]?.id || selectedModel;

        if (resolvedModel !== selectedModel) {
            window.apiManager.setSelectedModel(resolvedModel);
        }

        // Update diagram model selector
        const diagramModelSelect = document.getElementById('diagramModelSelect');
        if (diagramModelSelect) {
            diagramModelSelect.innerHTML = this.models.map(m => 
                `<option value="${m.id}" ${m.id === resolvedModel ? 'selected' : ''}>${m.name}</option>`
            ).join('');
        }

        const topModelSelect = document.getElementById('topModelSelect');
        if (topModelSelect) {
            topModelSelect.innerHTML = this.models.map(m =>
                `<option value="${m.id}" ${m.id === resolvedModel ? 'selected' : ''}>${m.name}</option>`
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

    showPanel() {
        if (!this.panel?.classList.contains('active')) {
            this.panel?.classList.add('active');
        }
        this.input?.focus();
    }
    
    hidePanel() {
        this.panel?.classList.remove('active');
    }
    
    setMode(mode) {
        this.mode = mode;
        
        // Update UI
        const diagramModeBtn = document.getElementById('diagramModeBtn');
        const chatModeBtn = document.getElementById('chatModeBtn');
        const imageModeBtn = document.getElementById('imageModeBtn');
        const diagramOptions = document.getElementById('diagramOptions');
        const imageOptions = document.getElementById('imageOptions');
        const aiDescription = document.querySelector('.ai-description');
        
        if (mode === 'chat') {
            chatModeBtn?.classList.add('active');
            diagramModeBtn?.classList.remove('active');
            imageModeBtn?.classList.remove('active');
            diagramOptions?.classList.remove('hidden');
            imageOptions?.classList.add('hidden');
            if (aiDescription) {
                aiDescription.textContent = 'Chat with the canvas agent about the current board, then ask it to make changes.';
            }
            if (this.input) {
                this.input.placeholder = "e.g., 'What is missing from this flow?' or 'Suggest a cleaner layout for these boxes'";
            }
            if (this.generateBtn) {
                this.generateBtn.lastChild.textContent = 'Send';
            }
        } else if (mode === 'diagram') {
            chatModeBtn?.classList.remove('active');
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
            if (this.generateBtn) {
                this.generateBtn.lastChild.textContent = 'Generate';
            }
        } else {
            chatModeBtn?.classList.remove('active');
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
            if (this.generateBtn) {
                this.generateBtn.lastChild.textContent = 'Generate';
            }
        }
    }
    
    async generate() {
        const prompt = this.input?.value.trim();
        if (!prompt || this.isGenerating) return;
        
        if (this.mode === 'chat') {
            await this.sendAgentMessage(prompt);
        } else if (this.mode === 'diagram') {
            await this.generateDiagram(prompt);
        } else {
            await this.generateImage(prompt);
        }
    }

    async sendAgentMessage(prompt) {
        this.isGenerating = true;
        this.showStatus('Thinking...', 'loading');
        this.generateBtn.disabled = true;
        window.app?.showLoading('AI is thinking...');

        this.chatHistory.push({ role: 'user', content: prompt });
        this.trimChatHistory();
        this.addConversationMessage('user', prompt);

        try {
            const messages = this.buildChatMessages();
            const response = await window.apiManager.chat(messages);
            const content = response.content || 'No response received.';
            this.chatHistory.push({ role: 'assistant', content });
            this.trimChatHistory();
            this.addConversationMessage('assistant', content);
            this.showStatus('Agent response ready.', 'success');
            this.input.value = '';
        } catch (error) {
            console.error('Agent chat error:', error);
            this.addConversationMessage('assistant', `Error: ${error.message}`);
            this.showStatus('Error talking to agent.', 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
            window.app?.hideLoading();
        }
    }
    
    async generateDiagram(prompt) {
        this.isGenerating = true;
        this.showStatus('Generating diagram...', 'loading');
        this.generateBtn.disabled = true;
        window.app?.showLoading('Generating diagram...');
        
        try {
            // Get current canvas state for context
            const existingContent = JSON.stringify(window.infiniteCanvas.elements);
            this.addConversationMessage('user', prompt);
            
            // Use OpenAI SDK via apiManager
            const response = await window.apiManager.generateDiagram(prompt, existingContent);
            
            if (response.content) {
                this.processGeneratedContent(response);
                this.addConversationMessage('assistant', 'Applied a new diagram to the canvas.');
                this.showStatus('Diagram generated successfully!', 'success');
                this.input.value = '';
            } else {
                this.showStatus('No diagram generated. Try a different prompt.', 'error');
            }
        } catch (error) {
            console.error('Generation error:', error);
            this.showStatus('Error generating diagram. Please try again.', 'error');
        } finally {
            this.isGenerating = false;
            this.generateBtn.disabled = false;
            window.app?.hideLoading();
        }
    }
    
    async generateImage(prompt) {
        this.isGenerating = true;
        this.showStatus('Generating image...', 'loading');
        this.generateBtn.disabled = true;
        window.app?.showLoading('Generating image...');
        
        try {
            this.addConversationMessage('user', prompt);
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
                this.addConversationMessage('assistant', 'Generated an image and placed it on the canvas.');
                this.showStatus('Image generated successfully!', 'success');
                this.input.value = '';
                
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
            window.app?.hideLoading();
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
        let content = response.content || '';
        
        // Try to extract JSON from markdown code blocks
        const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonBlockMatch) {
            content = jsonBlockMatch[1].trim();
        }
        
        try {
            // Try to parse as JSON
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                elements = parsed;
            } else if (parsed.elements && Array.isArray(parsed.elements)) {
                elements = parsed.elements;
            } else if (parsed.type && parsed.x !== undefined) {
                // Single element object
                elements = [parsed];
            } else {
                // Unknown format, treat as description
                elements = this.parseDiagramDescription(response.content);
            }
        } catch (e) {
            // Not valid JSON, treat as diagram description
            elements = this.parseDiagramDescription(response.content);
        }
        
        // Validate and filter elements
        elements = elements.filter(el => el && typeof el === 'object' && el.type);
        
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
            let hasValidCoords = false;
            
            for (const el of elements) {
                if (el.x === undefined || el.y === undefined) continue;
                hasValidCoords = true;
                const hw = (el.width || 100) / 2;
                const hh = (el.height || 100) / 2;
                minX = Math.min(minX, el.x - hw);
                minY = Math.min(minY, el.y - hh);
                maxX = Math.max(maxX, el.x + hw);
                maxY = Math.max(maxY, el.y + hh);
            }
            
            let offsetX = 0, offsetY = 0;
            if (hasValidCoords) {
                const elementsCenterX = (minX + maxX) / 2;
                const elementsCenterY = (minY + maxY) / 2;
                offsetX = center.x - elementsCenterX;
                offsetY = center.y - elementsCenterY;
            } else {
                // Elements without coordinates, arrange them
                offsetX = center.x - 200;
                offsetY = center.y - (elements.length * 60);
            }
            
            // Add elements with offset
            let addedCount = 0;
            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                
                // Skip invalid elements
                if (!el.type) continue;
                
                // Set default coordinates if missing
                if (el.x === undefined) el.x = 200;
                if (el.y === undefined) el.y = 100 + i * 120;
                
                const newElement = {
                    ...el,
                    id: window.toolManager.generateId(),
                    x: el.x + offsetX,
                    y: el.y + offsetY,
                    // Apply default properties if not specified
                    strokeColor: el.strokeColor || window.toolManager.defaultProperties.strokeColor,
                    backgroundColor: el.backgroundColor || window.toolManager.defaultProperties.backgroundColor,
                    strokeWidth: el.strokeWidth || window.toolManager.defaultProperties.strokeWidth,
                    strokeStyle: el.strokeStyle || window.toolManager.defaultProperties.strokeStyle,
                    roughness: el.roughness ?? window.toolManager.defaultProperties.roughness,
                    opacity: el.opacity ?? window.toolManager.defaultProperties.opacity,
                };
                
                // Offset points for lines/arrows
                if (el.points && Array.isArray(el.points)) {
                    newElement.points = el.points.map(p => ({
                        x: (p.x || 0) + offsetX,
                        y: (p.y || 0) + offsetY
                    }));
                }
                
                // Ensure valid dimensions
                if (!newElement.width) newElement.width = 100;
                if (!newElement.height) newElement.height = 100;
                
                canvas.addElement(newElement);
                canvas.selectElement(newElement, true);
                addedCount++;
            }
            
            if (addedCount > 0) {
                window.historyManager?.pushState(canvas.elements);
                this.showStatus(`Added ${addedCount} elements to canvas`, 'success');
            }
        } else {
            console.warn('No valid elements found in AI response');
        }
    }
    
    parseDiagramDescription(description) {
        // Enhanced parser for diagram descriptions and markdown-like formats
        const elements = [];
        const lines = description.split('\n').filter(l => l.trim());
        
        let y = 100;
        let x = 400;
        const rowHeight = 120;
        const colWidth = 250;
        let currentCol = 0;
        let maxCols = 3;
        
        // Track nodes for connection
        const nodes = [];
        let lastNode = null;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines and markdown separators
            if (!line || line.match(/^[-=]{3,}$/)) continue;
            
            // Detect flowchart syntax (like "A --> B" or "A -> B")
            const flowMatch = line.match(/(.+?)\s*(?:-->?|→|=>)\s*(.+)/);
            if (flowMatch) {
                const fromText = flowMatch[1].trim();
                const toText = flowMatch[2].trim();
                
                // Find or create source node
                let fromNode = nodes.find(n => n.text === fromText);
                if (!fromNode) {
                    fromNode = this.createNode(fromText, x + currentCol * colWidth, y, elements);
                    nodes.push(fromNode);
                    currentCol = (currentCol + 1) % maxCols;
                    if (currentCol === 0) y += rowHeight;
                }
                
                // Find or create target node
                let toNode = nodes.find(n => n.text === toText);
                if (!toNode) {
                    toNode = this.createNode(toText, x + currentCol * colWidth, y, elements);
                    nodes.push(toNode);
                    currentCol = (currentCol + 1) % maxCols;
                    if (currentCol === 0) y += rowHeight;
                }
                
                // Create arrow between nodes
                elements.push({
                    type: 'arrow',
                    points: [
                        { x: fromNode.x, y: fromNode.y + 40 },
                        { x: toNode.x, y: toNode.y - 40 }
                    ],
                    strokeColor: '#666666',
                    strokeWidth: 2
                });
                
                lastNode = toNode;
                continue;
            }
            
            // Parse markdown headers as sections
            const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
            if (headerMatch) {
                elements.push({
                    type: 'text',
                    x: x,
                    y: y,
                    text: headerMatch[2],
                    width: 300,
                    height: 40,
                    fontSize: headerMatch[1].length === 1 ? 28 : headerMatch[1].length === 2 ? 24 : 20,
                    strokeColor: '#1971c2'
                });
                y += rowHeight;
                currentCol = 0;
                continue;
            }
            
            // Parse list items
            const listMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
            if (listMatch) {
                elements.push({
                    type: 'text',
                    x: x + 20,
                    y: y,
                    text: '• ' + listMatch[1],
                    width: 250,
                    height: 30,
                    fontSize: 16
                });
                y += 50;
                continue;
            }
            
            // Check for different diagram elements based on keywords
            const lowerLine = line.toLowerCase();
            let element = null;
            
            if (lowerLine.includes('start') || lowerLine.includes('begin') || lowerLine.includes('end')) {
                element = {
                    type: 'ellipse',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 140,
                    height: 80,
                    text: this.extractText(line),
                    backgroundColor: '#e7f5ff',
                    strokeColor: '#1971c2'
                };
            } else if (lowerLine.includes('decision') || lowerLine.includes('if ') || lowerLine.includes('?')) {
                element = {
                    type: 'diamond',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 160,
                    height: 120,
                    text: this.extractText(line),
                    backgroundColor: '#fff9db',
                    strokeColor: '#f08c00'
                };
            } else if (lowerLine.includes('process') || lowerLine.includes('action') || lowerLine.includes('step')) {
                element = {
                    type: 'rectangle',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 180,
                    height: 100,
                    text: this.extractText(line),
                    backgroundColor: '#e6fcf5',
                    strokeColor: '#2f9e44'
                };
            } else if (lowerLine.includes('box') || lowerLine.includes('rect')) {
                element = {
                    type: 'rectangle',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 180,
                    height: 100,
                    text: this.extractText(line),
                    backgroundColor: '#f3f0ff',
                    strokeColor: '#7048e8'
                };
            } else if (lowerLine.includes('database') || lowerLine.includes('db') || lowerLine.includes('store')) {
                element = {
                    type: 'rectangle',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 180,
                    height: 100,
                    text: this.extractText(line),
                    backgroundColor: '#fff5f5',
                    strokeColor: '#e03131',
                    edgeType: 'round'
                };
            } else if (lowerLine.includes('input') || lowerLine.includes('output')) {
                element = {
                    type: 'diamond',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 160,
                    height: 100,
                    text: this.extractText(line),
                    backgroundColor: '#e7f5ff',
                    strokeColor: '#1971c2'
                };
            } else if (lowerLine.includes('circle') || lowerLine.includes('oval')) {
                element = {
                    type: 'ellipse',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 140,
                    height: 100,
                    text: this.extractText(line)
                };
            } else if (lowerLine.includes('note') || lowerLine.includes('sticky')) {
                element = {
                    type: 'sticky',
                    x: x + currentCol * colWidth,
                    y: y,
                    width: 200,
                    height: 150,
                    text: this.extractText(line),
                    backgroundColor: '#ffec99',
                    strokeColor: '#e6b800'
                };
            } else if (lowerLine.includes('arrow') || lowerLine.includes('connect') || lowerLine.includes('→')) {
                if (lastNode) {
                    elements.push({
                        type: 'arrow',
                        points: [
                            { x: lastNode.x, y: lastNode.y + 40 },
                            { x: lastNode.x, y: y - 20 }
                        ],
                        strokeColor: '#666666',
                        strokeWidth: 2
                    });
                }
                continue;
            } else {
                // Default to text
                element = {
                    type: 'text',
                    x: x + currentCol * colWidth,
                    y: y,
                    text: this.extractText(line),
                    width: 200,
                    height: 40
                };
            }
            
            if (element) {
                elements.push(element);
                lastNode = { x: element.x, y: element.y, text: element.text };
                
                currentCol++;
                if (currentCol >= maxCols) {
                    currentCol = 0;
                    y += rowHeight;
                }
            }
        }
        
        return elements;
    }
    
    createNode(text, x, y, elements) {
        const element = {
            type: 'rectangle',
            x: x,
            y: y,
            width: 180,
            height: 80,
            text: text,
            backgroundColor: '#f8f9fa',
            strokeColor: '#495057'
        };
        elements.push(element);
        return { x, y, text };
    }
    
    extractText(line) {
        // Extract text between quotes, after colons, or clean up keywords
        let cleaned = line
            .replace(/^(box|rect|rectangle|diamond|circle|oval|ellipse|arrow|connect|text|note|sticky|process|action|step|decision|start|end|input|output|database|db)\s*[:\-]?\s*/i, '')
            .trim();
        
        const match = cleaned.match(/["'](.+?)["']|:\s*(.+)/);
        return match ? (match[1] || match[2] || cleaned) : cleaned;
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

    buildChatMessages(prompt) {
        const canvasContext = JSON.stringify(
            window.infiniteCanvas?.elements?.slice(-30).map((element) => ({
                id: element.id,
                type: element.type,
                text: element.text || '',
                name: element.name || '',
                x: element.x,
                y: element.y,
                width: element.width,
                height: element.height,
            })) || []
        );

        return [
            {
                role: 'system',
                content: 'You are a canvas agent helping the user reason about and improve a visual whiteboard. Be concise, concrete, and reference the current canvas state when useful. If the user asks you to change the canvas, explain what you would change so they can then switch to diagram or image generation.',
            },
            {
                role: 'system',
                content: `Current canvas snapshot: ${canvasContext}`,
            },
            ...this.chatHistory,
        ];
    }

    trimChatHistory() {
        if (this.chatHistory.length > 12) {
            this.chatHistory = this.chatHistory.slice(-12);
        }
    }

    addConversationMessage(role, content) {
        if (!this.conversation) return;

        if (this.conversationEmpty) {
            this.conversationEmpty.style.display = 'none';
        }

        const message = document.createElement('div');
        message.className = `ai-message ${role}`;
        message.innerHTML = `
            <div class="ai-message-role">${role === 'user' ? 'You' : 'Agent'}</div>
            <div class="ai-message-bubble"></div>
        `;
        message.querySelector('.ai-message-bubble').textContent = content;
        this.conversation.appendChild(message);
        this.conversation.scrollTop = this.conversation.scrollHeight;
    }
}

// Create global instance
window.aiAssistant = new AIAssistant();




