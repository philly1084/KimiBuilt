/**
 * History Module - Undo/redo stack
 */

class HistoryManager {
    constructor(maxSize = 50) {
        this.stack = [];
        this.currentIndex = -1;
        this.maxSize = maxSize;
        this.isUndoing = false;
    }
    
    pushState(elements) {
        // Remove any future states if we're not at the end
        if (this.currentIndex < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.currentIndex + 1);
        }
        
        // Deep clone elements
        const clonedElements = this.cloneElements(elements);
        
        // Add to stack
        this.stack.push(clonedElements);
        this.currentIndex++;
        
        // Limit stack size
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
            this.currentIndex--;
        }
    }
    
    undo() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.isUndoing = true;
            const state = this.cloneElements(this.stack[this.currentIndex]);
            window.infiniteCanvas.elements = state;
            window.infiniteCanvas.deselectAll();
            window.infiniteCanvas.render();
            this.isUndoing = false;
            return true;
        }
        return false;
    }
    
    redo() {
        if (this.currentIndex < this.stack.length - 1) {
            this.currentIndex++;
            this.isUndoing = true;
            const state = this.cloneElements(this.stack[this.currentIndex]);
            window.infiniteCanvas.elements = state;
            window.infiniteCanvas.deselectAll();
            window.infiniteCanvas.render();
            this.isUndoing = false;
            return true;
        }
        return false;
    }
    
    cloneElements(elements) {
        return elements.map(el => ({
            ...el,
            points: el.points ? el.points.map(p => ({ ...p })) : undefined
        }));
    }
    
    canUndo() {
        return this.currentIndex > 0;
    }
    
    canRedo() {
        return this.currentIndex < this.stack.length - 1;
    }
    
    clear() {
        this.stack = [];
        this.currentIndex = -1;
    }
    
    // Get current state as JSON
    toJSON() {
        if (this.currentIndex >= 0) {
            return JSON.stringify(this.stack[this.currentIndex]);
        }
        return '[]';
    }
}

// Create global instance
window.historyManager = new HistoryManager();
