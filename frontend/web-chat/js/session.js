/**
 * Session Management for LillyBuilt AI Chat
 * Handles session state, local storage, and session operations with enhanced persistence
 * Now works client-side only with OpenAI SDK backend
 */

class SessionManager extends EventTarget {
    constructor() {
        super();
        this.sessions = [];
        this.currentSessionId = null;
        this.sessionMessages = new Map(); // sessionId -> messages array
        this.apiBaseUrl = window.location.hostname === 'localhost'
            ? 'http://localhost:3000/api'
            : `${window.location.protocol}//${window.location.host}/api`;
        this.storageKey = 'kimibuilt_sessions_v3';
        this.currentSessionKey = 'kimibuilt_current_session';
        this.version = '3.0';
        this.storageAvailable = this.checkStorageAvailability();
        
        this.loadFromStorage();
        this.migrateIfNeeded();
    }

    /**
     * Check if localStorage is available and not blocked by Tracking Prevention
     */
    checkStorageAvailability() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (e) {
            // Tracking Prevention can block storage in some browsers; continue without persistence.
            return false;
        }
    }

    /**
     * Safely get item from localStorage
     */
    safeStorageGet(key) {
        if (!this.storageAvailable) return null;
        try {
            return localStorage.getItem(key);
        } catch (e) {
            this.storageAvailable = false;
            return null;
        }
    }

    /**
     * Safely set item in localStorage
     */
    safeStorageSet(key, value) {
        if (!this.storageAvailable) return false;
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                this.cleanupOldSessions();
                try {
                    localStorage.setItem(key, value);
                    return true;
                } catch (e2) {
                    this.storageAvailable = false;
                }
            } else {
                this.storageAvailable = false;
            }
            return false;
        }
    }

    /**
     * Safely remove item from localStorage
     */
    safeStorageRemove(key) {
        if (!this.storageAvailable) return false;
        try {
            localStorage.removeItem(key);
            return true;
        } catch (e) {
            console.warn(`Failed to remove ${key} from localStorage:`, e);
            return false;
        }
    }

    // ============================================
    // Session Operations
    // ============================================

    async loadSessions() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/sessions`);
            if (response.ok) {
                const data = await response.json();
                const storedSessions = new Map(this.sessions.map((session) => [session.id, session]));

                this.sessions = (data.sessions || []).map((session) => {
                    const stored = storedSessions.get(session.id);
                    let model;
                    
                    // Safely get default model
                    try {
                        model = stored?.model || this.safeStorageGet('kimibuilt_default_model') || 'gpt-4o';
                    } catch (e) {
                        model = stored?.model || 'gpt-4o';
                    }
                    
                    return {
                        id: session.id,
                        mode: session.metadata?.mode || stored?.mode || 'chat',
                        model: model,
                        title: stored?.title || 'New Chat',
                        createdAt: session.createdAt,
                        updatedAt: session.updatedAt,
                        isLocal: false,
                        version: this.version,
                    };
                });

                for (const sessionId of Array.from(this.sessionMessages.keys())) {
                    if (!this.sessions.find((session) => session.id === sessionId)) {
                        this.sessionMessages.delete(sessionId);
                    }
                }

                if (!this.sessions.find((session) => session.id === this.currentSessionId)) {
                    this.currentSessionId = this.sessions[0]?.id || null;
                }

                await this.pruneBlankSessions();
                this.saveToStorage();
            }
        } catch (error) {
            console.warn('Failed to load backend sessions, using local cache:', error);
        }

        this.dispatchEvent(new CustomEvent('sessionsChanged', { 
            detail: { sessions: this.sessions } 
        }));
        return this.sessions;
    }

    async pruneBlankSessions() {
        const sessionsToRemove = this.sessions.filter((session) => this.isBlankSession(session));

        if (sessionsToRemove.length === 0) {
            return;
        }

        for (const session of sessionsToRemove) {
            if (!this.isLocalSession(session.id)) {
                try {
                    await fetch(this.apiBaseUrl + '/sessions/' + session.id, {
                        method: 'DELETE',
                    });
                } catch (error) {
                    console.warn('Failed to delete blank backend session:', error);
                }
            }

            this.sessionMessages.delete(session.id);
        }

        const removedIds = new Set(sessionsToRemove.map((session) => session.id));
        this.sessions = this.sessions.filter((session) => !removedIds.has(session.id));

        if (removedIds.has(this.currentSessionId)) {
            this.currentSessionId = this.sessions[0]?.id || null;
        }
    }

    isBlankSession(session) {
        if (!session) {
            return false;
        }

        const messages = this.sessionMessages.get(session.id) || [];
        const hasMessages = messages.some((message) => {
            if (message.type === 'image' && (message.imageUrl || message.isLoading)) {
                return true;
            }

            return Boolean(String(message.content || message.prompt || '').trim());
        });

        const normalizedTitle = String(session.title || '').trim();
        const isDefaultTitle = !normalizedTitle || normalizedTitle === 'New Chat';

        return !hasMessages && isDefaultTitle;
    }
    async createSession(mode = 'chat', options = {}) {
        let defaultModel;
        try {
            defaultModel = this.safeStorageGet('kimibuilt_default_model') || 'gpt-4o';
        } catch (e) {
            defaultModel = 'gpt-4o';
        }
        
        let sessionId = this.generateLocalId();
        let createdAt = new Date().toISOString();
        let updatedAt = createdAt;
        let isLocal = true;

        try {
            const response = await fetch(`${this.apiBaseUrl}/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    metadata: {
                        mode,
                    },
                }),
            });

            if (response.ok) {
                const backendSession = await response.json();
                sessionId = backendSession.id;
                createdAt = backendSession.createdAt || createdAt;
                updatedAt = backendSession.updatedAt || updatedAt;
                isLocal = false;
            }
        } catch (error) {
            console.warn('Failed to create backend session, using local session:', error);
        }

        const localSession = {
            id: sessionId,
            mode,
            model: options.model || defaultModel,
            title: 'New Chat',
            createdAt,
            updatedAt,
            isLocal,
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

    async deleteSession(sessionId) {
        if (!this.isLocalSession(sessionId)) {
            try {
                await fetch(`${this.apiBaseUrl}/sessions/${sessionId}`, {
                    method: 'DELETE',
                });
            } catch (error) {
                console.warn('Failed to delete backend session:', error);
            }
        }

        // Remove from local state
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
        this.safeStorageSet(this.currentSessionKey, sessionId);
        
        const messages = this.sessionMessages.get(sessionId) || [];
        this.dispatchEvent(new CustomEvent('sessionSwitched', { 
            detail: { sessionId, messages } 
        }));
        
        return true;
    }

    promoteSessionId(oldSessionId, newSessionId) {
        const previousSessionId = oldSessionId || this.currentSessionId;

        if (!newSessionId) {
            return previousSessionId;
        }

        if (previousSessionId === newSessionId) {
            const session = this.sessions.find((entry) => entry.id === newSessionId);
            if (session) {
                session.isLocal = false;
            }
            this.currentSessionId = newSessionId;
            this.saveToStorage();
            return newSessionId;
        }

        const previousMessages = this.sessionMessages.get(previousSessionId) || [];
        const existingMessages = this.sessionMessages.get(newSessionId) || [];
        const mergedMessages = [...existingMessages];

        previousMessages.forEach((message) => {
            const duplicate = mergedMessages.some((candidate) =>
                candidate.id === message.id
                || (
                    candidate.role === message.role
                    && candidate.content === message.content
                    && candidate.timestamp === message.timestamp
                ));

            if (!duplicate) {
                mergedMessages.push(message);
            }
        });

        const previousSession = this.sessions.find((entry) => entry.id === previousSessionId);
        const existingSession = this.sessions.find((entry) => entry.id === newSessionId);

        if (previousSession) {
            if (existingSession && existingSession !== previousSession) {
                existingSession.title = existingSession.title === 'New Chat' ? previousSession.title : existingSession.title;
                existingSession.model = existingSession.model || previousSession.model;
                existingSession.mode = existingSession.mode || previousSession.mode;
                existingSession.isLocal = false;
                this.sessions = this.sessions.filter((entry) => entry.id !== previousSessionId);
            } else {
                previousSession.id = newSessionId;
                previousSession.isLocal = false;
            }
        } else if (!existingSession) {
            this.sessions.unshift({
                id: newSessionId,
                mode: 'chat',
                model: 'gpt-4o',
                title: 'New Chat',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isLocal: false,
                version: this.version,
            });
        }

        if (previousSessionId && previousSessionId !== newSessionId) {
            this.sessionMessages.delete(previousSessionId);
        }
        this.sessionMessages.set(newSessionId, mergedMessages);

        if (this.currentSessionId === previousSessionId || !this.currentSessionId) {
            this.currentSessionId = newSessionId;
        }

        this.saveToStorage();
        this.dispatchEvent(new CustomEvent('sessionPromoted', {
            detail: {
                previousSessionId,
                sessionId: newSessionId,
                messages: mergedMessages,
            },
        }));
        this.dispatchEvent(new CustomEvent('sessionsChanged', {
            detail: { sessions: this.sessions },
        }));

        return newSessionId;
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

    upsertMessage(sessionId, message) {
        if (!message || !sessionId) {
            return null;
        }

        if (!this.sessionMessages.has(sessionId)) {
            this.sessionMessages.set(sessionId, []);
        }

        const messages = this.sessionMessages.get(sessionId);
        const messageId = message.id || null;
        const index = messageId
            ? messages.findIndex((entry) => entry.id === messageId)
            : -1;

        if (index === -1) {
            return this.addMessage(sessionId, message);
        }

        const mergedMessage = {
            ...messages[index],
            ...message,
            id: messages[index].id,
            timestamp: message.timestamp || messages[index].timestamp || new Date().toISOString(),
        };

        messages[index] = mergedMessage;

        const session = this.sessions.find((entry) => entry.id === sessionId);
        if (session) {
            session.updatedAt = new Date().toISOString();
        }

        this.saveToStorage();
        return mergedMessage;
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

    getMessage(sessionId, messageId) {
        return this.getMessages(sessionId).find((message) => message.id === messageId) || null;
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
            
            this.safeStorageSet(this.storageKey, serialized);
            this.safeStorageSet(this.currentSessionKey, this.currentSessionId || '');
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
            const data = this.safeStorageGet(this.storageKey);
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
            
            const currentId = this.safeStorageGet(this.currentSessionKey);
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
        this.safeStorageRemove(this.storageKey);
        this.safeStorageRemove(this.currentSessionKey);
        this.sessions = [];
        this.sessionMessages.clear();
        this.currentSessionId = null;
    }

    migrateIfNeeded() {
        // Migration from v1/v2 to v3
        const oldKeys = ['kimibuilt_sessions_v2', 'kimibuilt_sessions'];
        
        for (const oldKey of oldKeys) {
            const oldData = this.safeStorageGet(oldKey);
            const currentData = this.safeStorageGet(this.storageKey);
            
            if (oldData && !currentData) {
                try {
                    const parsed = JSON.parse(oldData);
                    this.sessions = parsed.sessions || [];
                    this.sessionMessages = new Map(parsed.messages || []);
                    
                    // Add model field to sessions that don't have it
                    this.sessions.forEach(s => {
                        if (!s.model) {
                            try {
                                s.model = this.safeStorageGet('kimibuilt_default_model') || 'gpt-4o';
                            } catch (e) {
                                s.model = 'gpt-4o';
                            }
                        }
                        if (!s.version) {
                            s.version = this.version;
                        }
                    });
                    
                    this.saveToStorage();
                    this.safeStorageRemove(oldKey);
                    console.log(`Migrated sessions from ${oldKey} to v3`);
                    return;
                } catch (e) {
                    console.error('Migration failed:', e);
                }
            }
        }
    }

    // ============================================
    // Import/Export
    // ============================================

    /**
     * Export all sessions and messages
     */
    exportAll() {
        const data = {
            version: this.version,
            exportedAt: new Date().toISOString(),
            sessions: this.sessions,
            messages: Array.from(this.sessionMessages.entries())
        };
        return JSON.stringify(data, null, 2);
    }

    /**
     * Import sessions and messages from JSON
     */
    importAll(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            // Validate structure
            if (!data.sessions || !Array.isArray(data.sessions)) {
                throw new Error('Invalid import data: sessions array missing');
            }
            if (!data.messages || !Array.isArray(data.messages)) {
                throw new Error('Invalid import data: messages array missing');
            }
            
            // Merge with existing sessions (avoid duplicates by ID)
            const existingIds = new Set(this.sessions.map(s => s.id));
            
            let importedCount = 0;
            data.sessions.forEach(session => {
                // Generate new ID if duplicate
                if (existingIds.has(session.id)) {
                    const oldId = session.id;
                    session.id = this.generateLocalId();
                    session.isLocal = true; // Mark as local since it's a copy
                    
                    // Update messages to point to new ID
                    const sessionMessages = data.messages.find(([id]) => id === oldId);
                    if (sessionMessages) {
                        sessionMessages[0] = session.id;
                    }
                }
                
                // Ensure version
                if (!session.version) {
                    session.version = this.version;
                }
                
                this.sessions.push(session);
                existingIds.add(session.id);
                importedCount++;
            });
            
            // Import messages
            data.messages.forEach(([sessionId, messages]) => {
                if (!this.sessionMessages.has(sessionId)) {
                    this.sessionMessages.set(sessionId, messages);
                }
            });
            
            this.saveToStorage();
            
            this.dispatchEvent(new CustomEvent('sessionsChanged', { 
                detail: { sessions: this.sessions } 
            }));
            
            return { success: true, importedCount };
        } catch (error) {
            console.error('Import failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate import data without importing
     */
    validateImport(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            
            if (!data.sessions || !Array.isArray(data.sessions)) {
                return { valid: false, error: 'Missing sessions array' };
            }
            if (!data.messages || !Array.isArray(data.messages)) {
                return { valid: false, error: 'Missing messages array' };
            }
            
            const sessionCount = data.sessions.length;
            const messageCount = data.messages.reduce((acc, [, msgs]) => acc + (msgs?.length || 0), 0);
            
            return { 
                valid: true, 
                sessionCount, 
                messageCount,
                version: data.version || 'unknown',
                exportedAt: data.exportedAt || 'unknown'
            };
        } catch (error) {
            return { valid: false, error: error.message };
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
            if (!this.storageAvailable) {
                return { 
                    available: false,
                    size: 0, 
                    sizeFormatted: 'N/A',
                    sessionCount: this.sessions.length,
                    messageCount: Array.from(this.sessionMessages.values())
                        .reduce((acc, msgs) => acc + msgs.length, 0),
                    percentUsed: 0
                };
            }
            
            const data = this.safeStorageGet(this.storageKey);
            const size = data ? new Blob([data]).size : 0;
            const sessionCount = this.sessions.length;
            const messageCount = Array.from(this.sessionMessages.values())
                .reduce((acc, msgs) => acc + msgs.length, 0);
            
            return {
                available: true,
                size,
                sizeFormatted: this.formatBytes(size),
                sessionCount,
                messageCount,
                percentUsed: (size / (5 * 1024 * 1024)) * 100
            };
        } catch (e) {
            return { available: false, error: 'Failed to get stats' };
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
window.sessionManager = sessionManager;

