/**
 * Session Management for KimiBuilt AI Chat
 * Handles session state, local storage, and session operations with enhanced persistence
 */

class SessionManager extends EventTarget {
    constructor() {
        super();
        this.sessions = [];
        this.currentSessionId = null;
        this.sessionMessages = new Map(); // sessionId -> messages array
        this.storageKey = 'kimibuilt_sessions_v3';
        this.currentSessionKey = 'kimibuilt_current_session';
        this.version = '3.0';
        
        this.loadFromStorage();
        this.migrateIfNeeded();
    }

    // ============================================
    // Session Operations
    // ============================================

    async loadSessions() {
        try {
            const sessions = await apiClient.getSessions();
            this.sessions = sessions.map(s => ({
                ...s,
                title: s.title || this.generateTitle(s),
                updatedAt: s.updatedAt || new Date().toISOString(),
                mode: s.mode || 'chat',
                model: s.model || localStorage.getItem('kimibuilt_default_model') || 'gpt-4o'
            }));
            this.saveToStorage();
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
            return this.sessions;
        } catch (error) {
            console.error('Failed to load sessions:', error);
            // Use cached sessions if available
            if (this.sessions.length > 0) {
                this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                    detail: { sessions: this.sessions } 
                }));
                return this.sessions;
            }
            throw error;
        }
    }

    async createSession(mode = 'chat', options = {}) {
        try {
            const session = await apiClient.createSession(mode);
            const defaultModel = localStorage.getItem('kimibuilt_default_model') || 'gpt-4o';
            
            const sessionWithMeta = {
                ...session,
                mode,
                model: options.model || defaultModel,
                title: 'New Chat',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: this.version
            };
            
            this.sessions.unshift(sessionWithMeta);
            this.sessionMessages.set(session.id, []);
            this.currentSessionId = session.id;
            
            this.saveToStorage();
            this.dispatchEvent(new CustomEvent('sessionCreated', { 
                detail: { session: sessionWithMeta } 
            }));
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
            
            return sessionWithMeta;
        } catch (error) {
            console.error('Failed to create session:', error);
            
            // Create local session as fallback
            const defaultModel = localStorage.getItem('kimibuilt_default_model') || 'gpt-4o';
            
            const localSession = {
                id: this.generateLocalId(),
                mode,
                model: options.model || defaultModel,
                title: 'New Chat',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isLocal: true,
                version: this.version
            };
            
            this.sessions.unshift(localSession);
            this.sessionMessages.set(localSession.id, []);
            this.currentSessionId = localSession.id;
            
            this.saveToStorage();
            this.dispatchEvent(new CustomEvent('sessionCreated', { 
                detail: { session: localSession, isLocal: true } 
            }));
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
            
            return localSession;
        }
    }

    async deleteSession(sessionId) {
        try {
            // Try to delete from server
            if (!this.isLocalSession(sessionId)) {
                await apiClient.deleteSession(sessionId);
            }
        } catch (error) {
            console.error('Failed to delete session from server:', error);
        }

        // Remove from local state regardless
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        this.sessionMessages.delete(sessionId);
        
        if (this.currentSessionId === sessionId) {
            this.currentSessionId = this.sessions.length > 0 ? this.sessions[0].id : null;
        }
        
        this.saveToStorage();
        this.dispatchEvent(new CustomEvent('sessionDeleted', { 
            detail: { sessionId, newCurrentSessionId: this.currentSessionId } 
        }));
        this.dispatchEvent(new CustomEvent('sessionsChanged', { 
            detail: { sessions: this.sessions } 
        }));
        
        return true;
    }

    switchSession(sessionId) {
        if (!this.sessions.find(s => s.id === sessionId)) {
            console.error('Session not found:', sessionId);
            return false;
        }
        
        this.currentSessionId = sessionId;
        localStorage.setItem(this.currentSessionKey, sessionId);
        
        const messages = this.sessionMessages.get(sessionId) || [];
        this.dispatchEvent(new CustomEvent('sessionSwitched', { 
            detail: { sessionId, messages } 
        }));
        
        return true;
    }

    setSessionModel(sessionId, model) {
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
            session.model = model;
            this.saveToStorage();
        }
    }

    // ============================================
    // Message Operations
    // ============================================

    addMessage(sessionId, message) {
        if (!this.sessionMessages.has(sessionId)) {
            this.sessionMessages.set(sessionId, []);
        }
        
        const messages = this.sessionMessages.get(sessionId);
        
        // Check for duplicate messages (by content and timestamp within 1 second)
        const isDuplicate = messages.some(m => 
            m.role === message.role && 
            m.content === message.content &&
            Math.abs(new Date(m.timestamp) - new Date(message.timestamp)) < 1000
        );
        
        if (isDuplicate) {
            return messages[messages.length - 1];
        }
        
        const messageWithMeta = {
            ...message,
            id: message.id || this.generateLocalId(),
            timestamp: message.timestamp || new Date().toISOString()
        };
        
        messages.push(messageWithMeta);
        
        // Update session title from first user message if it's still default
        const session = this.sessions.find(s => s.id === sessionId);
        if (session && (session.title === 'New Chat' || !session.title) && message.role === 'user') {
            session.title = this.generateTitleFromMessage(message.content);
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
        }
        
        // Update session timestamp
        if (session) {
            session.updatedAt = new Date().toISOString();
        }
        
        this.saveToStorage();
        return messageWithMeta;
    }

    updateLastMessage(sessionId, content) {
        if (!this.sessionMessages.has(sessionId)) {
            return false;
        }
        
        const messages = this.sessionMessages.get(sessionId);
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.content = content;
            lastMessage.isStreaming = true;
            this.saveToStorage();
            return true;
        }
        
        return false;
    }

    finalizeLastMessage(sessionId) {
        if (!this.sessionMessages.has(sessionId)) {
            return false;
        }
        
        const messages = this.sessionMessages.get(sessionId);
        const lastMessage = messages[messages.length - 1];
        
        if (lastMessage && lastMessage.role === 'assistant') {
            lastMessage.isStreaming = false;
            lastMessage.timestamp = new Date().toISOString();
            this.saveToStorage();
            return true;
        }
        
        return false;
    }

    clearSessionMessages(sessionId) {
        if (this.sessionMessages.has(sessionId)) {
            this.sessionMessages.set(sessionId, []);
            
            // Reset session title
            const session = this.sessions.find(s => s.id === sessionId);
            if (session) {
                session.title = 'New Chat';
                session.updatedAt = new Date().toISOString();
            }
            
            this.saveToStorage();
            this.dispatchEvent(new CustomEvent('messagesCleared', { 
                detail: { sessionId } 
            }));
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
            return true;
        }
        return false;
    }

    getMessages(sessionId) {
        return this.sessionMessages.get(sessionId) || [];
    }

    getCurrentSession() {
        return this.sessions.find(s => s.id === this.currentSessionId);
    }

    getCurrentMessages() {
        return this.currentSessionId ? this.getMessages(this.currentSessionId) : [];
    }

    // ============================================
    // Storage
    // ============================================

    saveToStorage() {
        try {
            const data = {
                version: this.version,
                lastSaved: new Date().toISOString(),
                sessions: this.sessions,
                messages: Array.from(this.sessionMessages.entries())
            };
            
            const serialized = JSON.stringify(data);
            
            // Check size limit (5MB is typical for localStorage)
            if (serialized.length > 4.5 * 1024 * 1024) {
                console.warn('Session storage approaching limit, consider cleanup');
                // Could implement LRU cleanup here
            }
            
            localStorage.setItem(this.storageKey, serialized);
            localStorage.setItem(this.currentSessionKey, this.currentSessionId || '');
        } catch (error) {
            if (error.name === 'QuotaExceededError') {
                console.error('Storage quota exceeded, cleaning up old sessions');
                this.cleanupOldSessions();
            } else {
                console.error('Failed to save to localStorage:', error);
            }
        }
    }

    loadFromStorage() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const parsed = JSON.parse(data);
                
                // Handle version migration if needed
                if (parsed.version) {
                    this.sessions = parsed.sessions || [];
                    this.sessionMessages = new Map(parsed.messages || []);
                } else {
                    // Legacy format
                    this.sessions = parsed.sessions || [];
                    this.sessionMessages = new Map(parsed.messages || []);
                }
            }
            
            const currentId = localStorage.getItem(this.currentSessionKey);
            if (currentId && this.sessions.find(s => s.id === currentId)) {
                this.currentSessionId = currentId;
            } else if (this.sessions.length > 0) {
                this.currentSessionId = this.sessions[0].id;
            }
        } catch (error) {
            console.error('Failed to load from localStorage:', error);
            // Reset to clean state on error
            this.sessions = [];
            this.sessionMessages = new Map();
            this.currentSessionId = null;
        }
    }

    cleanupOldSessions() {
        // Keep only the 20 most recent sessions
        if (this.sessions.length > 20) {
            const sessionsToRemove = this.sessions.slice(20);
            sessionsToRemove.forEach(s => {
                this.sessionMessages.delete(s.id);
            });
            this.sessions = this.sessions.slice(0, 20);
            this.saveToStorage();
        }
    }

    clearStorage() {
        localStorage.removeItem(this.storageKey);
        localStorage.removeItem(this.currentSessionKey);
        this.sessions = [];
        this.sessionMessages.clear();
        this.currentSessionId = null;
    }

    migrateIfNeeded() {
        // Migration from v1/v2 to v3
        const oldKeys = ['kimibuilt_sessions_v2', 'kimibuilt_sessions'];
        
        for (const oldKey of oldKeys) {
            const oldData = localStorage.getItem(oldKey);
            if (oldData && !localStorage.getItem(this.storageKey)) {
                try {
                    const parsed = JSON.parse(oldData);
                    this.sessions = parsed.sessions || [];
                    this.sessionMessages = new Map(parsed.messages || []);
                    
                    // Add model field to sessions that don't have it
                    this.sessions.forEach(s => {
                        if (!s.model) {
                            s.model = localStorage.getItem('kimibuilt_default_model') || 'gpt-4o';
                        }
                        if (!s.version) {
                            s.version = this.version;
                        }
                    });
                    
                    this.saveToStorage();
                    localStorage.removeItem(oldKey);
                    console.log(`Migrated sessions from ${oldKey} to v3`);
                    return;
                } catch (e) {
                    console.error('Migration failed:', e);
                }
            }
        }
    }

    // ============================================
    // Utilities
    // ============================================

    generateLocalId() {
        return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    isLocalSession(sessionId) {
        const session = this.sessions.find(s => s.id === sessionId);
        return session?.isLocal || String(sessionId).startsWith('local_');
    }

    generateTitle(session) {
        if (session.title) return session.title;
        if (session.name) return session.name;
        return 'Chat';
    }

    generateTitleFromMessage(content) {
        // Extract first sentence or first 50 characters
        const clean = content.trim();
        
        // Remove common prefixes and commands
        const prefixes = ['please', 'can you', 'could you', 'would you', 'help me', 'i need', 'how do', 'how to', 'what is', 'explain'];
        let processed = clean.toLowerCase();
        for (const prefix of prefixes) {
            if (processed.startsWith(prefix)) {
                processed = clean.slice(prefix.length).trim();
                break;
            }
        }
        
        // Handle image generation command
        if (processed.startsWith('/image') || processed.startsWith('generate image') || processed.startsWith('create image')) {
            return 'Image Generation';
        }
        
        const firstSentence = processed.split(/[.!?\n]/)[0];
        const title = firstSentence.length > 50 
            ? firstSentence.substring(0, 50) + '...' 
            : firstSentence;
        return title || 'New Chat';
    }

    getSessionModeIcon(mode) {
        switch (mode) {
            case 'code':
                return 'code-2';
            case 'agent':
                return 'bot';
            case 'image':
                return 'image';
            case 'chat':
            default:
                return 'message-square';
        }
    }

    getSessionModeLabel(mode) {
        switch (mode) {
            case 'code':
                return 'Code';
            case 'agent':
                return 'Agent';
            case 'image':
                return 'Image';
            case 'chat':
            default:
                return 'Chat';
        }
    }

    formatTimestamp(isoString) {
        if (!isoString) return '';
        
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffSecs < 10) return 'Just now';
        if (diffMins < 1) return `${diffSecs}s ago`;
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        
        return date.toLocaleDateString(undefined, { 
            month: 'short', 
            day: 'numeric' 
        });
    }

    getStorageStats() {
        try {
            const data = localStorage.getItem(this.storageKey);
            const size = data ? new Blob([data]).size : 0;
            const sessionCount = this.sessions.length;
            const messageCount = Array.from(this.sessionMessages.values())
                .reduce((acc, msgs) => acc + msgs.length, 0);
            
            return {
                size,
                sizeFormatted: this.formatBytes(size),
                sessionCount,
                messageCount,
                percentUsed: (size / (5 * 1024 * 1024)) * 100
            };
        } catch (e) {
            return { error: 'Failed to get stats' };
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Create global session manager instance
const sessionManager = new SessionManager();
