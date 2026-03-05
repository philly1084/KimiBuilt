/**
 * Notation Helper - History Module
 * Manages local storage of notation sessions
 */

const NotationHistory = {
    // Storage key
    STORAGE_KEY: 'notation_helper_history',
    MAX_ITEMS: 50,

    /**
     * Get all history items
     * @returns {Array} History items sorted by most recent
     */
    getAll() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Error loading history:', e);
            return [];
        }
    },

    /**
     * Add a new history item
     * @param {Object} item - History item to add
     * @param {string} item.notation - The notation input
     * @param {string} item.result - The processed result
     * @param {string} item.mode - The helper mode used
     * @param {string} item.context - Optional context
     * @param {Array} item.annotations - Annotations from response
     * @returns {Object} The saved item with generated ID and timestamp
     */
    add(item) {
        const history = this.getAll();
        
        // Create history entry
        const entry = {
            id: this._generateId(),
            notation: item.notation || '',
            result: item.result || '',
            mode: item.mode || 'expand',
            context: item.context || '',
            annotations: item.annotations || [],
            suggestions: item.suggestions || [],
            timestamp: Date.now(),
            sessionId: item.sessionId || null
        };

        // Add to beginning
        history.unshift(entry);

        // Limit to max items
        if (history.length > this.MAX_ITEMS) {
            history.splice(this.MAX_ITEMS);
        }

        // Save
        this._save(history);

        return entry;
    },

    /**
     * Get a single history item by ID
     * @param {string} id - History item ID
     * @returns {Object|null} History item or null
     */
    getById(id) {
        const history = this.getAll();
        return history.find(h => h.id === id) || null;
    },

    /**
     * Delete a history item by ID
     * @param {string} id - History item ID
     * @returns {boolean} Success status
     */
    delete(id) {
        const history = this.getAll();
        const index = history.findIndex(h => h.id === id);
        
        if (index === -1) return false;
        
        history.splice(index, 1);
        this._save(history);
        return true;
    },

    /**
     * Clear all history
     */
    clear() {
        localStorage.removeItem(this.STORAGE_KEY);
    },

    /**
     * Search history
     * @param {string} query - Search query
     * @returns {Array} Matching history items
     */
    search(query) {
        const history = this.getAll();
        const lowerQuery = query.toLowerCase();
        
        return history.filter(h => 
            h.notation.toLowerCase().includes(lowerQuery) ||
            h.result.toLowerCase().includes(lowerQuery) ||
            h.mode.toLowerCase().includes(lowerQuery)
        );
    },

    /**
     * Get recent items
     * @param {number} count - Number of items to return
     * @returns {Array} Recent history items
     */
    getRecent(count = 10) {
        return this.getAll().slice(0, count);
    },

    /**
     * Export history to JSON
     * @returns {string} JSON string
     */
    exportToJSON() {
        return JSON.stringify(this.getAll(), null, 2);
    },

    /**
     * Import history from JSON
     * @param {string} json - JSON string
     * @returns {boolean} Success status
     */
    importFromJSON(json) {
        try {
            const items = JSON.parse(json);
            if (!Array.isArray(items)) return false;
            
            // Validate items
            const validItems = items.filter(item => 
                item && 
                typeof item.notation === 'string' &&
                typeof item.mode === 'string'
            );
            
            this._save(validItems.slice(0, this.MAX_ITEMS));
            return true;
        } catch (e) {
            console.error('Error importing history:', e);
            return false;
        }
    },

    /**
     * Get statistics about history
     * @returns {Object} Statistics
     */
    getStats() {
        const history = this.getAll();
        const modes = {};
        const categories = {};
        
        history.forEach(h => {
            // Count modes
            modes[h.mode] = (modes[h.mode] || 0) + 1;
            
            // Try to detect category from notation
            const category = this._detectCategory(h.notation);
            categories[category] = (categories[category] || 0) + 1;
        });
        
        return {
            total: history.length,
            modes,
            categories,
            oldest: history.length > 0 ? history[history.length - 1].timestamp : null,
            newest: history.length > 0 ? history[0].timestamp : null
        };
    },

    /**
     * Get formatted date string for display
     * @param {number} timestamp - Unix timestamp
     * @returns {string} Formatted date
     */
    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Less than a minute
        if (diff < 60000) {
            return 'Just now';
        }
        
        // Less than an hour
        if (diff < 3600000) {
            const mins = Math.floor(diff / 60000);
            return `${mins}m ago`;
        }
        
        // Less than a day
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        }
        
        // Less than a week
        if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return `${days}d ago`;
        }
        
        // Format as date
        return date.toLocaleDateString();
    },

    /**
     * Get preview text for display
     * @param {string} notation - Notation text
     * @param {number} maxLength - Maximum length
     * @returns {string} Truncated text
     */
    getPreview(notation, maxLength = 50) {
        if (!notation) return '';
        
        // Remove newlines for preview
        const singleLine = notation.replace(/\n/g, ' ').trim();
        
        if (singleLine.length <= maxLength) {
            return singleLine;
        }
        
        return singleLine.substring(0, maxLength) + '...';
    },

    // Private methods

    /**
     * Save history to localStorage
     * @param {Array} history - History array
     * @private
     */
    _save(history) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
        } catch (e) {
            console.error('Error saving history:', e);
            // Handle quota exceeded
            if (e.name === 'QuotaExceededError') {
                // Remove oldest items and try again
                if (history.length > 10) {
                    history.splice(Math.floor(history.length / 2));
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(history));
                }
            }
        }
    },

    /**
     * Generate unique ID
     * @returns {string} Unique ID
     * @private
     */
    _generateId() {
        return 'hist_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Detect category from notation content
     * @param {string} notation - Notation text
     * @returns {string} Category name
     * @private
     */
    _detectCategory(notation) {
        const lower = notation.toLowerCase();
        
        if (lower.includes('get ') || lower.includes('post ') || 
            lower.includes('put ') || lower.includes('delete ') ||
            lower.includes('/api/')) {
            return 'api';
        }
        
        if (lower.includes('{') && lower.includes('}') && 
            (lower.includes('--') || lower.includes('has-many') || 
             lower.includes('belongs-to'))) {
            return 'data';
        }
        
        if (lower.includes('->') && lower.includes('[') && lower.includes(']')) {
            return 'flowchart';
        }
        
        if (lower.includes('->') && (lower.includes('svc') || 
            lower.includes('service') || lower.includes('db') ||
            lower.includes('cache') || lower.includes('lb-'))) {
            return 'system';
        }
        
        return 'other';
    }
};

// Export for module systems or make available globally
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotationHistory;
}
