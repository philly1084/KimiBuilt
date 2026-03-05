/**
 * History Manager - Undo/Redo Stack Management
 * Provides version history with at least 10 steps
 */

class HistoryManager {
    constructor(maxSteps = 50) {
        this.stack = [];
        this.currentIndex = -1;
        this.maxSteps = maxSteps;
        this.listeners = [];
    }

    /**
     * Add a new state to the history stack
     * @param {Object} state - The state to save
     * @param {string} state.content - Editor content
     * @param {string} state.canvasType - Current canvas type
     * @param {Object} state.metadata - Additional metadata
     */
    push(state) {
        // Remove any future states if we're not at the end
        if (this.currentIndex < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.currentIndex + 1);
        }

        // Add new state
        this.stack.push({
            content: state.content,
            canvasType: state.canvasType,
            metadata: { ...state.metadata },
            timestamp: Date.now()
        });

        // Limit stack size
        if (this.stack.length > this.maxSteps) {
            this.stack.shift();
        } else {
            this.currentIndex++;
        }

        this._notifyListeners();
    }

    /**
     * Undo - go back one step
     * @returns {Object|null} The previous state or null if can't undo
     */
    undo() {
        if (this.canUndo()) {
            this.currentIndex--;
            this._notifyListeners();
            return this.getCurrentState();
        }
        return null;
    }

    /**
     * Redo - go forward one step
     * @returns {Object|null} The next state or null if can't redo
     */
    redo() {
        if (this.canRedo()) {
            this.currentIndex++;
            this._notifyListeners();
            return this.getCurrentState();
        }
        return null;
    }

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
        return this.currentIndex > 0;
    }

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
        return this.currentIndex < this.stack.length - 1;
    }

    /**
     * Get the current state
     * @returns {Object|null}
     */
    getCurrentState() {
        if (this.currentIndex >= 0 && this.currentIndex < this.stack.length) {
            return this.stack[this.currentIndex];
        }
        return null;
    }

    /**
     * Get all states for history display
     * @returns {Array}
     */
    getAllStates() {
        return this.stack.map((state, index) => ({
            ...state,
            index,
            isCurrent: index === this.currentIndex
        }));
    }

    /**
     * Clear all history
     */
    clear() {
        this.stack = [];
        this.currentIndex = -1;
        this._notifyListeners();
    }

    /**
     * Jump to a specific history index
     * @param {number} index 
     * @returns {Object|null}
     */
    jumpTo(index) {
        if (index >= 0 && index < this.stack.length) {
            this.currentIndex = index;
            this._notifyListeners();
            return this.getCurrentState();
        }
        return null;
    }

    /**
     * Get history statistics
     * @returns {Object}
     */
    getStats() {
        return {
            total: this.stack.length,
            current: this.currentIndex + 1,
            canUndo: this.canUndo(),
            canRedo: this.canRedo()
        };
    }

    /**
     * Subscribe to history changes
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    onChange(callback) {
        this.listeners.push(callback);
        return () => {
            const index = this.listeners.indexOf(callback);
            if (index > -1) {
                this.listeners.splice(index, 1);
            }
        };
    }

    /**
     * Notify all listeners of state change
     */
    _notifyListeners() {
        const stats = this.getStats();
        this.listeners.forEach(callback => {
            try {
                callback(stats);
            } catch (error) {
                console.error('History listener error:', error);
            }
        });
    }

    /**
     * Serialize history for localStorage
     * @returns {string}
     */
    serialize() {
        return JSON.stringify({
            stack: this.stack,
            currentIndex: this.currentIndex
        });
    }

    /**
     * Deserialize history from localStorage
     * @param {string} data 
     */
    deserialize(data) {
        try {
            const parsed = JSON.parse(data);
            if (parsed.stack && Array.isArray(parsed.stack)) {
                this.stack = parsed.stack.slice(-this.maxSteps);
                this.currentIndex = Math.min(
                    parsed.currentIndex || 0,
                    this.stack.length - 1
                );
                this._notifyListeners();
            }
        } catch (error) {
            console.error('Failed to deserialize history:', error);
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HistoryManager;
}
