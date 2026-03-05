/**
 * Tools Module - Tool definitions and behaviors
 * Fixed: Proper resize handles, move logic, double-click text editing, multi-select, copy/paste
 */

class ToolManager {
    constructor() {
        this.currentTool = 'selection';
        this.isDrawing = false;
        this.isMoving = false;
        this.isResizing = false;
        this.resizeHandle = null;
        this.startPos = null;
        this.currentElement = null;
        this.lastElementId = 0;
        
        // Clipboard for copy/paste
        this.clipboard = [];
        this.clipboardOffset = 0;
        
        // Default properties
        this.defaultProperties = {
            strokeColor: '#000000',
            backgroundColor: 'transparent',
            strokeWidth: 2,
            strokeStyle: 'solid',
            roughness: 1,
            edgeType: 'sharp',
            opacity: 1,
            fontSize: 20,
            fontFamily: 'Virgil, cursive'
        };
        
        this.init();
    }
    
    init() {
        // Tool button clicks
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setTool(btn.dataset.tool);
            });
        });
        
        // Canvas interactions
        const canvas = document.getElementById('canvasContainer');
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Double-click for text editing
        canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        
        // Space key for panning
        this.spacePressed = false;
        
        // Paste handler
        document.addEventListener('paste', (e) => this.handlePaste(e));
        
        // Initialize resize handles
        this.initResizeHandles();
    }
    
    initResizeHandles() {
        const selectionBox = document.getElementById('selectionBox');
        if (selectionBox) {
            selectionBox.querySelectorAll('.resize-handle').forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    this.startResize(e, handle);
                });
            });
        }
    }
    
    setTool(toolName) {
        this.currentTool = toolName;
        
        // Update UI
        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.classList.remove('active');
        });
        const btn = document.querySelector(`.tool-btn[data-tool="${toolName}"]`);
        if (btn) btn.classList.add('active');
        
        // Update cursor
        const container = document.getElementById('canvasContainer');
        container.className = 'canvas-container';
        
        switch (toolName) {
            case 'selection':
                container.style.cursor = 'default';
                break;
            case 'text':
                container.classList.add('texting');
                break;
            case 'freedraw':
            case 'eraser':
                container.classList.add('drawing');
                break;
            case 'ai-image':
                container.style.cursor = 'crosshair';
                // Show tooltip
                const tooltip = document.getElementById('aiImageTooltip');
                if (tooltip) tooltip.style.display = 'block';
                break;
            default:
                container.classList.add('drawing');
                break;
        }
        
        // Hide AI image tooltip when switching to other tools
        if (toolName !== 'ai-image') {
            const tooltip = document.getElementById('aiImageTooltip');
            if (tooltip) tooltip.style.display = 'none';
        }
        
        // Deselect if switching away from selection
        if (toolName !== 'selection') {
            window.infiniteCanvas.deselectAll();
        }
    }
    
    generateId() {
        return `el-${Date.now()}-${++this.lastElementId}`;
    }
    
    getElementProperties() {
        return { ...this.defaultProperties };
    }
    
    updateDefaultProperties(props) {
        this.defaultProperties = { ...this.defaultProperties, ...props };
    }
    
    handleMouseDown(e) {
        if (e.button !== 0) return; // Only left click
        
        // Space+drag for panning - handled by canvas.js
        if (this.spacePressed) return;
        
        const canvas = window.infiniteCanvas;
        const rect = canvas.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = canvas.screenToWorld(x, y);
        
        // Snap to grid if enabled
        if (canvas.snapToGrid) {
            worldPos.x = canvas.snapToGridValue(worldPos.x);
            worldPos.y = canvas.snapToGridValue(worldPos.y);
        }
        
        this.startPos = worldPos;
        
        switch (this.currentTool) {
            case 'selection':
                this.handleSelectionStart(e, worldPos);
                break;
            case 'rectangle':
                this.startShape('rectangle', worldPos);
                break;
            case 'diamond':
                this.startShape('diamond', worldPos);
                break;
            case 'ellipse':
                this.startShape('ellipse', worldPos);
                break;
            case 'line':
                this.startLine('line', worldPos);
                break;
            case 'arrow':
                this.startLine('arrow', worldPos);
                break;
            case 'freedraw':
                this.startFreedraw(worldPos);
                break;
            case 'text':
                this.createText(worldPos);
                break;
            case 'eraser':
                this.eraseAt(worldPos);
                break;
            case 'image':
                this.handleImageTool(worldPos);
                break;
            case 'sticky':
                this.createSticky(worldPos);
                break;
            case 'frame':
                this.startFrame(worldPos);
                break;
            case 'ai-image':
                this.handleAIImageTool(worldPos);
                break;
        }
    }
    
    handleMouseMove(e) {
        const canvas = window.infiniteCanvas;
        const rect = canvas.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = canvas.screenToWorld(x, y);
        
        // Snap to grid if enabled
        if (canvas.snapToGrid && (this.isDrawing || this.isResizing)) {
            worldPos.x = canvas.snapToGridValue(worldPos.x);
            worldPos.y = canvas.snapToGridValue(worldPos.y);
        }
        
        // Update cursor based on what we're hovering
        this.updateCursor(worldPos);
        
        if (this.isDrawing && this.currentElement) {
            this.updateElement(worldPos, e.shiftKey);
            canvas.render();
        } else if (this.isMoving && canvas.selectedElements.length > 0) {
            this.moveElements(worldPos);
        } else if (this.isResizing && canvas.selectedElements.length > 0) {
            this.resizeElement(worldPos, e.shiftKey);
        } else if (canvas.isSelecting) {
            canvas.updateSelectionBox(worldPos.x, worldPos.y);
        }
    }
    
    handleMouseUp(e) {
        const canvas = window.infiniteCanvas;
        
        if (this.isDrawing && this.currentElement) {
            // Finalize element
            const el = this.currentElement;
            const minSize = 5;
            
            const tooSmall = (el.type !== 'freedraw' && el.type !== 'line' && el.type !== 'arrow' && 
                             el.width < minSize && el.height < minSize) ||
                            (el.type === 'freedraw' && (!el.points || el.points.length < 2));
            
            if (tooSmall) {
                // Too small, remove it
                canvas.elements = canvas.elements.filter(
                    el => el.id !== this.currentElement.id
                );
            } else {
                // Save to history
                window.historyManager?.pushState(canvas.elements);
            }
            
            this.isDrawing = false;
            this.currentElement = null;
            canvas.render();
        }
        
        if (this.isMoving) {
            if (this.hasMoved) {
                window.historyManager?.pushState(canvas.elements);
            }
            this.isMoving = false;
            this.moveStartPositions = null;
            this.hasMoved = false;
        }
        
        if (this.isResizing) {
            window.historyManager?.pushState(canvas.elements);
            this.isResizing = false;
            this.resizeHandle = null;
            this.resizeStartElement = null;
        }
        
        if (canvas.isSelecting) {
            canvas.endSelectionBox();
        }
    }
    
    updateCursor(worldPos) {
        const canvas = window.infiniteCanvas;
        const container = document.getElementById('canvasContainer');
        
        if (this.currentTool !== 'selection') return;
        
        // Check for resize handles first
        if (canvas.selectedElements.length === 1) {
            const handle = this.getResizeHandleAt(worldPos);
            if (handle) {
                container.style.cursor = handle.cursor;
                return;
            }
        }
        
        // Check for element hover
        const element = canvas.getElementAt(worldPos.x, worldPos.y);
        if (element) {
            container.style.cursor = 'move';
        } else {
            container.style.cursor = 'default';
        }
    }
    
    handleSelectionStart(e, worldPos) {
        const canvas = window.infiniteCanvas;
        const clickedElement = canvas.getElementAt(worldPos.x, worldPos.y);
        
        // Check resize handles first
        if (canvas.selectedElements.length === 1) {
            const handle = this.getResizeHandleAt(worldPos);
            if (handle) {
                this.isResizing = true;
                this.resizeHandle = handle.position;
                this.resizeStartElement = JSON.parse(JSON.stringify(canvas.selectedElements[0]));
                return;
            }
        }
        
        if (clickedElement) {
            if (e.shiftKey) {
                // Add to/remove from selection
                if (canvas.selectedElements.includes(clickedElement)) {
                    canvas.selectedElements = canvas.selectedElements.filter(el => el !== clickedElement);
                } else {
                    canvas.selectedElements.push(clickedElement);
                }
                canvas.selectElements(canvas.selectedElements);
            } else if (!canvas.selectedElements.includes(clickedElement)) {
                // Select single
                canvas.selectElement(clickedElement);
            }
            
            // Start moving
            this.isMoving = true;
            this.hasMoved = false;
            this.moveStartPos = worldPos;
            this.moveStartPositions = canvas.selectedElements.map(el => ({
                id: el.id,
                x: el.x,
                y: el.y,
                points: el.points ? JSON.parse(JSON.stringify(el.points)) : null
            }));
        } else {
            // Start selection box
            if (!e.shiftKey) {
                canvas.deselectAll();
            }
            canvas.startSelectionBox(worldPos.x, worldPos.y);
        }
    }
    
    getResizeHandleAt(pos) {
        const canvas = window.infiniteCanvas;
        if (canvas.selectedElements.length !== 1) return null;
        
        const el = canvas.selectedElements[0];
        const handleSize = 10 / canvas.scale;
        const padding = 4;
        
        // Get element bounds
        let bounds;
        if (el.type === 'line' || el.type === 'arrow') {
            if (!el.points || el.points.length < 2) return null;
            const p1 = el.points[0];
            const p2 = el.points[1];
            bounds = {
                x: Math.min(p1.x, p2.x) - padding,
                y: Math.min(p1.y, p2.y) - padding,
                width: Math.abs(p2.x - p1.x) + padding * 2,
                height: Math.abs(p2.y - p1.y) + padding * 2
            };
        } else if (el.type === 'freedraw') {
            if (!el.points || el.points.length === 0) return null;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const p of el.points) {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            }
            bounds = {
                x: minX - padding,
                y: minY - padding,
                width: maxX - minX + padding * 2,
                height: maxY - minY + padding * 2
            };
        } else {
            bounds = {
                x: el.x - el.width / 2 - padding,
                y: el.y - el.height / 2 - padding,
                width: el.width + padding * 2,
                height: el.height + padding * 2
            };
        }
        
        // Define handle positions
        const handles = [
            { pos: 'nw', x: bounds.x, y: bounds.y, cursor: 'nw-resize' },
            { pos: 'n', x: bounds.x + bounds.width / 2, y: bounds.y, cursor: 'n-resize' },
            { pos: 'ne', x: bounds.x + bounds.width, y: bounds.y, cursor: 'ne-resize' },
            { pos: 'e', x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2, cursor: 'e-resize' },
            { pos: 'se', x: bounds.x + bounds.width, y: bounds.y + bounds.height, cursor: 'se-resize' },
            { pos: 's', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height, cursor: 's-resize' },
            { pos: 'sw', x: bounds.x, y: bounds.y + bounds.height, cursor: 'sw-resize' },
            { pos: 'w', x: bounds.x, y: bounds.y + bounds.height / 2, cursor: 'w-resize' }
        ];
        
        for (const handle of handles) {
            const dx = pos.x - handle.x;
            const dy = pos.y - handle.y;
            if (Math.abs(dx) <= handleSize && Math.abs(dy) <= handleSize) {
                return handle;
            }
        }
        
        return null;
    }
    
    startResize(e, handle) {
        this.isResizing = true;
        this.resizeHandle = handle.classList.contains('nw') ? 'nw' :
                            handle.classList.contains('n') ? 'n' :
                            handle.classList.contains('ne') ? 'ne' :
                            handle.classList.contains('e') ? 'e' :
                            handle.classList.contains('se') ? 'se' :
                            handle.classList.contains('s') ? 's' :
                            handle.classList.contains('sw') ? 'sw' :
                            handle.classList.contains('w') ? 'w' : 'se';
        this.resizeStartElement = JSON.parse(JSON.stringify(window.infiniteCanvas.selectedElements[0]));
    }
    
    moveElements(worldPos) {
        const canvas = window.infiniteCanvas;
        const dx = worldPos.x - this.moveStartPos.x;
        const dy = worldPos.y - this.moveStartPos.y;
        
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            this.hasMoved = true;
        }
        
        for (const el of canvas.selectedElements) {
            const startPos = this.moveStartPositions.find(p => p.id === el.id);
            if (startPos) {
                el.x = startPos.x + dx;
                el.y = startPos.y + dy;
                
                // For lines/arrows/freedraw, update points directly from saved positions
                if (el.points && startPos.points) {
                    el.points = startPos.points.map(p => ({
                        x: p.x + dx,
                        y: p.y + dy
                    }));
                }
            }
        }
        
        canvas.render();
        window.renderer?.updateSelectionBox(canvas.selectedElements[0]);
    }
    
    resizeElement(worldPos, constrain) {
        const canvas = window.infiniteCanvas;
        const el = canvas.selectedElements[0];
        const start = this.resizeStartElement;
        
        if (!start) return;
        
        // Calculate deltas based on resize handle
        let dx = 0, dy = 0;
        
        switch (this.resizeHandle) {
            case 'se':
                dx = worldPos.x - (start.x + start.width / 2);
                dy = worldPos.y - (start.y + start.height / 2);
                break;
            case 'nw':
                dx = (start.x - start.width / 2) - worldPos.x;
                dy = (start.y - start.height / 2) - worldPos.y;
                break;
            case 'ne':
                dx = worldPos.x - (start.x + start.width / 2);
                dy = (start.y - start.height / 2) - worldPos.y;
                break;
            case 'sw':
                dx = (start.x - start.width / 2) - worldPos.x;
                dy = worldPos.y - (start.y + start.height / 2);
                break;
            case 'n':
                dy = (start.y - start.height / 2) - worldPos.y;
                break;
            case 's':
                dy = worldPos.y - (start.y + start.height / 2);
                break;
            case 'w':
                dx = (start.x - start.width / 2) - worldPos.x;
                break;
            case 'e':
                dx = worldPos.x - (start.x + start.width / 2);
                break;
        }
        
        let newWidth = Math.max(10, start.width + dx * (this.resizeHandle.includes('w') ? 2 : this.resizeHandle.includes('e') ? 2 : 0));
        let newHeight = Math.max(10, start.height + dy * (this.resizeHandle.includes('n') ? 2 : this.resizeHandle.includes('s') ? 2 : 0));
        
        // Constrain proportions with shift
        if (constrain && el.type !== 'line' && el.type !== 'arrow') {
            const aspectRatio = start.width / start.height;
            if (newWidth / newHeight > aspectRatio) {
                newWidth = newHeight * aspectRatio;
            } else {
                newHeight = newWidth / aspectRatio;
            }
        }
        
        // Apply changes based on element type
        if (el.type === 'line' || el.type === 'arrow') {
            if (start.points && start.points.length >= 2) {
                const scaleX = newWidth / start.width;
                const scaleY = newHeight / start.height;
                
                // Update based on which handle is being dragged
                if (this.resizeHandle === 'se' || this.resizeHandle === 'e' || this.resizeHandle === 's') {
                    el.points[1] = {
                        x: start.points[0].x + (start.points[1].x - start.points[0].x) * scaleX,
                        y: start.points[0].y + (start.points[1].y - start.points[0].y) * scaleY
                    };
                } else if (this.resizeHandle === 'nw' || this.resizeHandle === 'w' || this.resizeHandle === 'n') {
                    el.points[0] = {
                        x: start.points[1].x - (start.points[1].x - start.points[0].x) * scaleX,
                        y: start.points[1].y - (start.points[1].y - start.points[0].y) * scaleY
                    };
                }
                
                el.x = (el.points[0].x + el.points[1].x) / 2;
                el.y = (el.points[0].y + el.points[1].y) / 2;
                el.width = Math.abs(el.points[1].x - el.points[0].x);
                el.height = Math.abs(el.points[1].y - el.points[0].y);
            }
        } else {
            // Calculate new position based on handle
            if (this.resizeHandle === 'se') {
                // Bottom-right: center stays same
                el.width = newWidth;
                el.height = newHeight;
            } else if (this.resizeHandle === 'nw') {
                // Top-left: move center
                el.x = start.x - (newWidth - start.width) / 2;
                el.y = start.y - (newHeight - start.height) / 2;
                el.width = newWidth;
                el.height = newHeight;
            } else if (this.resizeHandle === 'ne') {
                el.x = start.x + (newWidth - start.width) / 2;
                el.y = start.y - (newHeight - start.height) / 2;
                el.width = newWidth;
                el.height = newHeight;
            } else if (this.resizeHandle === 'sw') {
                el.x = start.x - (newWidth - start.width) / 2;
                el.y = start.y + (newHeight - start.height) / 2;
                el.width = newWidth;
                el.height = newHeight;
            } else if (this.resizeHandle === 'n') {
                el.y = start.y - (newHeight - start.height) / 2;
                el.height = newHeight;
            } else if (this.resizeHandle === 's') {
                el.y = start.y + (newHeight - start.height) / 2;
                el.height = newHeight;
            } else if (this.resizeHandle === 'w') {
                el.x = start.x - (newWidth - start.width) / 2;
                el.width = newWidth;
            } else if (this.resizeHandle === 'e') {
                el.x = start.x + (newWidth - start.width) / 2;
                el.width = newWidth;
            }
        }
        
        canvas.render();
        window.renderer?.updateSelectionBox(el);
    }
    
    startShape(type, pos) {
        this.isDrawing = true;
        this.currentElement = {
            id: this.generateId(),
            type: type,
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            ...this.getElementProperties()
        };
        window.infiniteCanvas.elements.push(this.currentElement);
    }
    
    startLine(type, pos) {
        this.isDrawing = true;
        this.currentElement = {
            id: this.generateId(),
            type: type,
            x: pos.x,
            y: pos.y,
            points: [{ x: pos.x, y: pos.y }, { x: pos.x, y: pos.y }],
            width: 0,
            height: 0,
            ...this.getElementProperties()
        };
        window.infiniteCanvas.elements.push(this.currentElement);
    }
    
    startFreedraw(pos) {
        this.isDrawing = true;
        this.currentElement = {
            id: this.generateId(),
            type: 'freedraw',
            x: pos.x,
            y: pos.y,
            points: [{ x: pos.x, y: pos.y }],
            width: 0,
            height: 0,
            ...this.getElementProperties()
        };
        window.infiniteCanvas.elements.push(this.currentElement);
    }
    
    startFrame(pos) {
        this.isDrawing = true;
        this.currentElement = {
            id: this.generateId(),
            type: 'frame',
            x: pos.x,
            y: pos.y,
            width: 0,
            height: 0,
            name: 'Frame',
            ...this.getElementProperties()
        };
        window.infiniteCanvas.elements.push(this.currentElement);
    }
    
    updateElement(pos, constrain) {
        if (!this.currentElement) return;
        
        const el = this.currentElement;
        const canvas = window.infiniteCanvas;
        
        // Snap to grid if enabled
        let snappedPos = { ...pos };
        if (canvas.snapToGrid) {
            snappedPos.x = canvas.snapToGridValue(pos.x);
            snappedPos.y = canvas.snapToGridValue(pos.y);
        }
        
        switch (el.type) {
            case 'rectangle':
            case 'diamond':
            case 'ellipse':
            case 'frame':
            case 'sticky':
                let width = snappedPos.x - this.startPos.x;
                let height = snappedPos.y - this.startPos.y;
                
                if (constrain) {
                    const size = Math.max(Math.abs(width), Math.abs(height));
                    width = width < 0 ? -size : size;
                    height = height < 0 ? -size : size;
                }
                
                el.x = this.startPos.x + width / 2;
                el.y = this.startPos.y + height / 2;
                el.width = Math.abs(width);
                el.height = Math.abs(height);
                
                // Default size for sticky note
                if (el.type === 'sticky' && el.width < 100 && el.height < 100) {
                    el.width = Math.max(el.width, 200);
                    el.height = Math.max(el.height, 200);
                }
                break;
                
            case 'line':
            case 'arrow':
                el.points[1] = { x: snappedPos.x, y: snappedPos.y };
                el.x = (el.points[0].x + snappedPos.x) / 2;
                el.y = (el.points[0].y + snappedPos.y) / 2;
                el.width = Math.abs(el.points[1].x - el.points[0].x);
                el.height = Math.abs(el.points[1].y - el.points[0].y);
                
                // Constrain to 45-degree angles with shift
                if (constrain && el.points.length >= 2) {
                    const dx = el.points[1].x - el.points[0].x;
                    const dy = el.points[1].y - el.points[0].y;
                    const angle = Math.atan2(dy, dx);
                    const constrainedAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    el.points[1] = {
                        x: el.points[0].x + Math.cos(constrainedAngle) * distance,
                        y: el.points[0].y + Math.sin(constrainedAngle) * distance
                    };
                    el.x = (el.points[0].x + el.points[1].x) / 2;
                    el.y = (el.points[0].y + el.points[1].y) / 2;
                }
                break;
                
            case 'freedraw':
                // Don't snap freedraw points for smoother lines
                el.points.push({ x: pos.x, y: pos.y });
                // Update bounding box
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of el.points) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                }
                el.x = (minX + maxX) / 2;
                el.y = (minY + maxY) / 2;
                el.width = maxX - minX;
                el.height = maxY - minY;
                break;
        }
    }
    
    createText(pos) {
        const textEditor = document.getElementById('textEditor');
        const canvas = window.infiniteCanvas;
        const screenPos = canvas.worldToScreen(pos.x, pos.y);
        
        // Position text editor
        textEditor.style.display = 'block';
        textEditor.style.left = screenPos.x + 'px';
        textEditor.style.top = (screenPos.y - 40) + 'px';
        textEditor.style.width = '200px';
        textEditor.style.height = '80px';
        textEditor.style.transform = 'translate(-50%, 0)';
        textEditor.value = '';
        textEditor.focus();
        
        // Store position for element creation
        textEditor.dataset.posX = pos.x;
        textEditor.dataset.posY = pos.y;
        
        // Handle text completion
        const finishEditing = () => {
            const text = textEditor.value.trim();
            if (text) {
                const element = {
                    id: this.generateId(),
                    type: 'text',
                    x: parseFloat(textEditor.dataset.posX),
                    y: parseFloat(textEditor.dataset.posY),
                    text: text,
                    width: 200,
                    height: 40,
                    ...this.getElementProperties()
                };
                canvas.addElement(element);
                window.historyManager?.pushState(canvas.elements);
            }
            textEditor.style.display = 'none';
            textEditor.removeEventListener('blur', finishEditing);
        };
        
        textEditor.addEventListener('blur', finishEditing);
    }
    
    createSticky(pos) {
        const canvas = window.infiniteCanvas;
        const element = {
            id: this.generateId(),
            type: 'sticky',
            x: pos.x,
            y: pos.y,
            width: 200,
            height: 200,
            text: '',
            backgroundColor: '#ffec99',
            strokeColor: '#e6b800',
            roughness: 0,
            strokeWidth: 1
        };
        canvas.addElement(element);
        window.historyManager?.pushState(canvas.elements);
        
        // Immediately start editing
        setTimeout(() => {
            canvas.selectElement(element);
            this.editStickyText(element);
        }, 50);
    }
    
    editStickyText(element) {
        const textEditor = document.getElementById('textEditor');
        const canvas = window.infiniteCanvas;
        const screenPos = canvas.worldToScreen(element.x, element.y);
        const screenSize = {
            width: element.width * canvas.scale,
            height: element.height * canvas.scale
        };
        
        textEditor.style.display = 'block';
        textEditor.style.left = screenPos.x + 'px';
        textEditor.style.top = screenPos.y + 'px';
        textEditor.style.width = (screenSize.width - 20) + 'px';
        textEditor.style.height = (screenSize.height - 20) + 'px';
        textEditor.style.transform = 'translate(-50%, -50%)';
        textEditor.style.background = 'transparent';
        textEditor.value = element.text || '';
        textEditor.focus();
        
        const finishEditing = () => {
            const text = textEditor.value.trim();
            element.text = text;
            canvas.render();
            window.historyManager?.pushState(canvas.elements);
            textEditor.style.display = 'none';
            textEditor.style.background = 'transparent';
            textEditor.removeEventListener('blur', finishEditing);
        };
        
        textEditor.addEventListener('blur', finishEditing);
    }
    
    eraseAt(pos) {
        const canvas = window.infiniteCanvas;
        const element = canvas.getElementAt(pos.x, pos.y);
        if (element) {
            canvas.removeElement(element.id);
            window.historyManager?.pushState(canvas.elements);
        }
    }
    
    handleImageTool(pos) {
        const input = document.getElementById('imageInput');
        input.dataset.posX = pos.x;
        input.dataset.posY = pos.y;
        input.click();
    }
    
    handleAIImageTool(pos) {
        // Set the position for the image to be placed
        window.aiAssistant?.setImagePosition(pos);
        
        // Switch to image generation mode
        window.aiAssistant?.setMode('image');
        
        // Open AI panel
        window.aiAssistant?.togglePanel();
        
        // Reset tool to selection
        this.setTool('selection');
    }
    
    handleDoubleClick(e) {
        if (this.currentTool !== 'selection') return;
        
        const canvas = window.infiniteCanvas;
        const rect = canvas.container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = canvas.screenToWorld(x, y);
        
        const element = canvas.getElementAt(worldPos.x, worldPos.y);
        
        if (element && element.type === 'text') {
            this.editText(element);
        } else if (element && element.type === 'sticky') {
            this.editStickyText(element);
        }
    }
    
    editText(element) {
        const textEditor = document.getElementById('textEditor');
        const canvas = window.infiniteCanvas;
        const screenPos = canvas.worldToScreen(element.x, element.y);
        
        textEditor.style.display = 'block';
        textEditor.style.left = screenPos.x + 'px';
        textEditor.style.top = (screenPos.y - 40) + 'px';
        textEditor.style.width = '200px';
        textEditor.style.height = '80px';
        textEditor.style.transform = 'translate(-50%, 0)';
        textEditor.value = element.text;
        textEditor.focus();
        
        const finishEditing = () => {
            const text = textEditor.value.trim();
            if (text) {
                element.text = text;
                canvas.render();
                window.historyManager?.pushState(canvas.elements);
            }
            textEditor.style.display = 'none';
            textEditor.removeEventListener('blur', finishEditing);
        };
        
        textEditor.addEventListener('blur', finishEditing);
    }
    
    // Copy selected elements
    copySelection() {
        const canvas = window.infiniteCanvas;
        if (canvas.selectedElements.length === 0) return;
        
        // Deep copy elements
        this.clipboard = canvas.selectedElements.map(el => ({
            ...el,
            points: el.points ? JSON.parse(JSON.stringify(el.points)) : undefined,
            imageElement: undefined // Can't copy image elements directly
        }));
        this.clipboardOffset = 0;
    }
    
    // Cut selected elements
    cutSelection() {
        this.copySelection();
        const canvas = window.infiniteCanvas;
        for (const el of canvas.selectedElements) {
            canvas.removeElement(el.id);
        }
        canvas.deselectAll();
        window.historyManager?.pushState(canvas.elements);
    }
    
    // Paste elements
    paste() {
        if (this.clipboard.length === 0) return;
        
        const canvas = window.infiniteCanvas;
        this.clipboardOffset += 20;
        
        const newElements = this.clipboard.map(el => {
            const newEl = {
                ...el,
                id: this.generateId(),
                x: el.x + this.clipboardOffset,
                y: el.y + this.clipboardOffset
            };
            
            // Offset points
            if (el.points) {
                newEl.points = el.points.map(p => ({
                    x: p.x + this.clipboardOffset,
                    y: p.y + this.clipboardOffset
                }));
            }
            
            return newEl;
        });
        
        // Add to canvas
        for (const el of newElements) {
            canvas.elements.push(el);
        }
        
        // Select new elements
        canvas.deselectAll();
        for (const el of newElements) {
            canvas.selectElement(el, true);
        }
        
        window.historyManager?.pushState(canvas.elements);
        canvas.render();
    }
    
    handlePaste(e) {
        // Handle external paste (images)
        if (e.clipboardData && e.clipboardData.items) {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    this.loadImageFromFile(blob);
                    e.preventDefault();
                    return;
                }
            }
        }
    }
    
    loadImageFromFile(file) {
        const canvas = window.infiniteCanvas;
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Get center of current view
                const center = canvas.screenToWorld(
                    canvas.canvas.width / 2,
                    canvas.canvas.height / 2
                );
                
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
                
                const element = {
                    id: this.generateId(),
                    type: 'image',
                    x: center.x,
                    y: center.y,
                    width: width,
                    height: height,
                    imageElement: img,
                    ...this.getElementProperties()
                };
                
                canvas.addElement(element);
                window.historyManager?.pushState(canvas.elements);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
    
    handleKeyDown(e) {
        // Space key for panning
        if (e.code === 'Space' && !e.repeat && !this.spacePressed) {
            this.spacePressed = true;
            if (!this.isDrawing) {
                document.getElementById('canvasContainer').classList.add('panning');
            }
        }
        
        // Copy/Paste shortcuts
        if ((e.ctrlKey || e.metaKey)) {
            if (e.key.toLowerCase() === 'c') {
                e.preventDefault();
                this.copySelection();
            } else if (e.key.toLowerCase() === 'x') {
                e.preventDefault();
                this.cutSelection();
            } else if (e.key.toLowerCase() === 'v') {
                e.preventDefault();
                this.paste();
            }
        }
        
        // Tool shortcuts (only when not in text input)
        if (!e.ctrlKey && !e.metaKey && !e.altKey && 
            document.activeElement.tagName !== 'TEXTAREA' && 
            document.activeElement.tagName !== 'INPUT') {
            switch (e.key.toLowerCase()) {
                case 'v':
                case '1':
                    this.setTool('selection');
                    break;
                case 'r':
                case '2':
                    this.setTool('rectangle');
                    break;
                case 'd':
                case '3':
                    this.setTool('diamond');
                    break;
                case 'o':
                case '4':
                    this.setTool('ellipse');
                    break;
                case 'a':
                case '5':
                    this.setTool('arrow');
                    break;
                case 'l':
                case '6':
                    this.setTool('line');
                    break;
                case 'p':
                case '7':
                    this.setTool('freedraw');
                    break;
                case 't':
                case '8':
                    this.setTool('text');
                    break;
                case 'e':
                case '9':
                    this.setTool('eraser');
                    break;
                case 'i':
                case '0':
                    this.setTool('image');
                    break;
                case 's':
                    this.setTool('sticky');
                    break;
                case 'f':
                    this.setTool('frame');
                    break;
                case 'g':
                    this.setTool('ai-image');
                    break;
            }
        }
        
        // Delete key
        if ((e.key === 'Delete' || e.key === 'Backspace') && 
            document.activeElement.tagName !== 'TEXTAREA' && 
            document.activeElement.tagName !== 'INPUT') {
            const canvas = window.infiniteCanvas;
            if (canvas.selectedElements.length > 0) {
                for (const el of canvas.selectedElements) {
                    canvas.removeElement(el.id);
                }
                canvas.deselectAll();
                window.historyManager?.pushState(canvas.elements);
            }
        }
    }
    
    handleKeyUp(e) {
        if (e.code === 'Space') {
            this.spacePressed = false;
            document.getElementById('canvasContainer').classList.remove('panning');
        }
    }
}

// Create global instance
window.toolManager = new ToolManager();
