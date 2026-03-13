/**
 * AgentUI - UI Controller for the AI Agent system
 * Handles all UI interactions and connects to the Agent module
 */
const AgentUI = (function() {
    // DOM element references
    let elements = {};

    /**
     * Cache DOM elements
     */
    function cacheElements() {
        elements = {
            // Widget
            widgetBtn: document.getElementById('agent-widget-btn'),
            
            // Modal
            modal: document.getElementById('agent-chat-modal'),
            modalContent: document.querySelector('.agent-modal-content'),
            closeBtn: document.getElementById('agent-close-btn'),
            
            // Header
            modelDisplay: document.getElementById('agent-model-display'),
            modelDropdown: document.getElementById('agent-model-dropdown'),
            
            // Messages
            messagesContainer: document.getElementById('agent-messages'),
            
            // Input
            input: document.getElementById('agent-chat-input'),
            sendBtn: document.getElementById('agent-send-btn'),
            
            // Quick actions
            quickActions: document.querySelectorAll('.agent-quick-action'),
            
            // Clear button
            clearBtn: document.getElementById('agent-clear-btn'),
            
            // Model selector
            modelSelectorDropdown: document.getElementById('model-selector-dropdown'),
            modelSelectorBtn: document.getElementById('model-selector-btn'),
            currentModelLabel: document.getElementById('current-model-label'),
            modelList: document.getElementById('model-list')
        };
    }

    /**
     * Initialize the UI
     */
    function init() {
        // Cache DOM elements
        cacheElements();
        
        // Check if elements exist before setting up
        if (!elements.modal) {
            console.warn('AgentUI: Modal not found, skipping initialization');
            return;
        }
        
        // Setup event listeners
        setupEventListeners();
        
        // Load saved agent model
        loadSavedModel();
        
        // Render initial messages if any
        renderMessages();
        
        // Initialize model UI
        updateModelUI();
        
        console.log('AgentUI initialized');
    }

    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Widget button - open chat
        if (elements.widgetBtn) {
            elements.widgetBtn.addEventListener('click', openChat);
        }
        
        // Close button
        if (elements.closeBtn) {
            elements.closeBtn.addEventListener('click', closeChat);
        }
        
        // Close on overlay click
        if (elements.modal) {
            elements.modal.addEventListener('click', (e) => {
                if (e.target === elements.modal) {
                    closeChat();
                }
            });
        }
        
        // Send button
        if (elements.sendBtn) {
            elements.sendBtn.addEventListener('click', sendMessage);
        }
        
        // Input enter key (Enter to send, Shift+Enter for new line)
        if (elements.input) {
            elements.input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
            
            // Auto-resize textarea
            elements.input.addEventListener('input', () => {
                elements.input.style.height = 'auto';
                elements.input.style.height = Math.min(elements.input.scrollHeight, 120) + 'px';
            });
        }
        
        // Quick action buttons
        if (elements.quickActions) {
            elements.quickActions.forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.action;
                    if (action) {
                        quickAction(action);
                    }
                });
            });
        }
        
        // Clear button
        if (elements.clearBtn) {
            elements.clearBtn.addEventListener('click', clearChat);
        }
        
        // Keyboard shortcut: Ctrl/Cmd + Shift + A to toggle chat
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
                e.preventDefault();
                toggleChat();
            }
        });
    }

    /**
     * Load saved model from localStorage
     */
    function loadSavedModel() {
        if (!window.Agent) return;
        
        updateModelUI();
    }

    /**
     * Open the chat modal
     */
    function openChat() {
        if (!elements.modal) return;
        
        // Show modal
        elements.modal.style.display = 'flex';
        
        // Trigger animation
        requestAnimationFrame(() => {
            elements.modal.classList.add('active');
            if (elements.modalContent) {
                elements.modalContent.style.opacity = '1';
                elements.modalContent.style.transform = 'scale(1)';
            }
        });
        
        // Focus input
        if (elements.input) {
            setTimeout(() => elements.input.focus(), 100);
        }
        
        // Render existing messages
        renderMessages();
    }

    /**
     * Close the chat modal
     */
    function closeChat() {
        if (!elements.modal) return;
        
        // Animate out
        elements.modal.classList.remove('active');
        if (elements.modalContent) {
            elements.modalContent.style.opacity = '0';
            elements.modalContent.style.transform = 'scale(0.95)';
        }
        
        // Hide after animation
        setTimeout(() => {
            elements.modal.style.display = 'none';
        }, 200);
    }

    /**
     * Toggle chat open/closed
     */
    function toggleChat() {
        if (!elements.modal) return;
        
        const isOpen = elements.modal.style.display === 'flex' || 
                       elements.modal.classList.contains('active');
        
        if (isOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    /**
     * Send a message
     */
    function sendMessage() {
        if (!window.Agent || !elements.input) return;
        
        const text = elements.input.value.trim();
        if (!text) return;
        
        // Add user message to chat
        window.Agent.addMessage('user', text);
        
        // Clear input and reset height
        elements.input.value = '';
        elements.input.style.height = 'auto';
        
        // Render messages
        renderMessages();
        
        // Show typing indicator
        showTypingIndicator();
        
        // Scroll to bottom
        scrollToBottom();
        
        // Call Agent.ask with callbacks
        window.Agent.ask(text, {
            onChunk: (chunk) => {
                // Optional: update message in real-time for streaming responses
                // This would require the Agent module to support streaming
            },
            onComplete: (response) => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', response);
                renderMessages();
                scrollToBottom();
            },
            onError: (error) => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', `**Error:** ${error.message || 'Something went wrong. Please try again.'}`);
                renderMessages();
                scrollToBottom();
            }
        });
    }

    /**
     * Handle quick action buttons
     * @param {string} action - The action to perform
     */
    function quickAction(action) {
        if (!window.Agent) return;
        
        let promptText = '';
        
        switch (action) {
            case 'summarize':
                promptText = 'Summarize this page';
                break;
            case 'continue':
                promptText = 'Continue writing';
                break;
            case 'outline':
                const topic = prompt('What topic would you like an outline for?');
                if (!topic) return;
                
                // Add user message
                window.Agent.addMessage('user', `Create an outline for: ${topic}`);
                renderMessages();
                showTypingIndicator();
                scrollToBottom();
                
                // Call generateOutline
                window.Agent.generateOutline(topic).then(response => {
                    hideTypingIndicator();
                    window.Agent.addMessage('agent', response);
                    renderMessages();
                    scrollToBottom();
                }).catch(error => {
                    hideTypingIndicator();
                    window.Agent.addMessage('agent', `**Error:** ${error.message || 'Failed to generate outline.'}`);
                    renderMessages();
                    scrollToBottom();
                });
                return;
            
            case 'improve':
                promptText = 'Improve this writing';
                break;
            case 'explain':
                promptText = 'Explain this';
                break;
            default:
                return;
        }
        
        // For summarize and continue actions
        if (action === 'summarize') {
            window.Agent.addMessage('user', promptText);
            renderMessages();
            showTypingIndicator();
            scrollToBottom();
            
            window.Agent.summarize().then(response => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', response);
                renderMessages();
                scrollToBottom();
            }).catch(error => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', `**Error:** ${error.message || 'Failed to summarize.'}`);
                renderMessages();
                scrollToBottom();
            });
        } else if (action === 'continue') {
            window.Agent.addMessage('user', promptText);
            renderMessages();
            showTypingIndicator();
            scrollToBottom();
            
            window.Agent.continueWriting().then(response => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', response);
                renderMessages();
                scrollToBottom();
            }).catch(error => {
                hideTypingIndicator();
                window.Agent.addMessage('agent', `**Error:** ${error.message || 'Failed to continue writing.'}`);
                renderMessages();
                scrollToBottom();
            });
        } else {
            // For improve and explain, treat as regular ask
            window.Agent.addMessage('user', promptText);
            renderMessages();
            showTypingIndicator();
            scrollToBottom();
            
            window.Agent.ask(promptText, {
                onComplete: (response) => {
                    hideTypingIndicator();
                    window.Agent.addMessage('agent', response);
                    renderMessages();
                    scrollToBottom();
                },
                onError: (error) => {
                    hideTypingIndicator();
                    window.Agent.addMessage('agent', `**Error:** ${error.message || 'Something went wrong.'}`);
                    renderMessages();
                    scrollToBottom();
                }
            });
        }
    }

    /**
     * Render all messages
     */
    function renderMessages() {
        if (!elements.messagesContainer || !window.Agent) return;
        
        const messages = window.Agent.getMessages();
        
        // Clear container
        elements.messagesContainer.innerHTML = '';
        
        if (messages.length === 0) {
            // Show empty state
            elements.messagesContainer.innerHTML = `
                <div class="agent-empty-state">
                    <div class="agent-empty-icon">✨</div>
                    <p>Ask me anything about your notes</p>
                    <p class="agent-empty-hint">I can summarize, continue writing, or help brainstorm ideas</p>
                </div>
            `;
            return;
        }
        
        // Render each message
        messages.forEach(message => {
            const messageEl = renderMessage(message);
            elements.messagesContainer.appendChild(messageEl);
        });
        
        scrollToBottom();
    }

    /**
     * Render a single message
     * @param {Object} message - The message object
     * @returns {HTMLElement} The message element
     */
    function renderMessage(message) {
        const isUser = message.role === 'user';
        const div = document.createElement('div');
        div.className = `agent-message agent-message-${isUser ? 'user' : 'agent'}`;
        
        const avatar = isUser ? '👤' : '✨';
        const content = markdownToHtml(message.content);
        
        let timestamp = '';
        if (message.timestamp) {
            const date = new Date(message.timestamp);
            timestamp = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        div.innerHTML = `
            <div class="agent-message-avatar">${avatar}</div>
            <div class="agent-message-content">
                <div class="agent-message-text">${content}</div>
                ${timestamp ? `<div class="agent-message-time">${timestamp}</div>` : ''}
            </div>
        `;
        
        // Add action buttons if provided
        if (message.actions && message.actions.length > 0) {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'agent-message-actions';
            message.actions.forEach(action => {
                const btn = document.createElement('button');
                btn.className = 'agent-action-btn';
                btn.textContent = action.label;
                btn.addEventListener('click', action.handler);
                actionsDiv.appendChild(btn);
            });
            div.querySelector('.agent-message-content').appendChild(actionsDiv);
        }
        
        return div;
    }

    /**
     * Scroll messages to bottom
     */
    function scrollToBottom() {
        if (!elements.messagesContainer) return;
        
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }

    /**
     * Show typing indicator
     */
    function showTypingIndicator() {
        if (!elements.messagesContainer) return;
        
        // Remove existing indicator
        hideTypingIndicator();
        
        const indicator = document.createElement('div');
        indicator.className = 'agent-message agent-message-agent agent-typing-indicator';
        indicator.id = 'agent-typing-indicator';
        indicator.innerHTML = `
            <div class="agent-message-avatar">✨</div>
            <div class="agent-message-content">
                <div class="agent-typing">
                    <div class="agent-typing-dot"></div>
                    <div class="agent-typing-dot"></div>
                    <div class="agent-typing-dot"></div>
                </div>
            </div>
        `;
        
        elements.messagesContainer.appendChild(indicator);
        scrollToBottom();
    }

    /**
     * Hide typing indicator
     */
    function hideTypingIndicator() {
        const indicator = document.getElementById('agent-typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * Clear chat history
     */
    function clearChat() {
        if (!window.Agent) return;
        
        window.Agent.clearConversation();
        renderMessages();
        
        // Show toast notification
        showToast('Chat history cleared');
    }

    /**
     * Update the model display in header
     */
    function updateModelDisplay() {
        if (!window.Agent || !elements.modelDisplay) return;
        
        const modelId = window.Agent.getSelectedModel();
        const modelNames = {
            'gpt-4o': 'GPT-4o',
            'gpt-4o-mini': 'GPT-4o Mini',
            'o1-preview': 'o1 Preview',
            'o1-mini': 'o1 Mini'
        };
        
        elements.modelDisplay.textContent = modelNames[modelId] || modelId;
        
        // Update dropdown to match
        if (elements.modelDropdown) {
            elements.modelDropdown.value = modelId;
        }
    }

    // ============================================
    // Model Selector
    // ============================================

    function toggleModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        const btn = document.getElementById('model-selector-btn');
        if (dropdown.style.display === 'none') {
            openModelSelector();
        } else {
            closeModelSelector();
        }
    }

    function openModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        const btn = document.getElementById('model-selector-btn');
        dropdown.style.display = 'flex';
        if (btn) btn.classList.add('active');
        renderModelList();
    }

    function closeModelSelector() {
        const dropdown = document.getElementById('model-selector-dropdown');
        const btn = document.getElementById('model-selector-btn');
        dropdown.style.display = 'none';
        if (btn) btn.classList.remove('active');
    }

    function renderModelList() {
        const listContainer = document.getElementById('model-list');
        const currentModel = Agent.getSelectedModel();
        const grouped = Agent.getModelsByProvider();
        
        const providerNames = {
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'kimi': 'Kimi',
            'google': 'Google',
            'meta': 'Meta'
        };
        
        const providerIcons = {
            'openai': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><circle cx="12" cy="12" r="8"></circle><line x1="12" y1="4" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="20"></line><line x1="4" y1="12" x2="2" y2="12"></line><line x1="22" y1="12" x2="20" y2="12"></line></svg>',
            'anthropic': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>',
            'kimi': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>',
            'google': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
            'meta': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>'
        };
        
        listContainer.innerHTML = Object.entries(grouped).map(([provider, models]) => `
            <div class="model-group">
                <div class="model-group-title">${providerNames[provider] || provider}</div>
                ${models.map(model => `
                    <div class="model-item ${model.id === currentModel ? 'active' : ''}" data-model-id="${model.id}">
                        <div class="model-item-icon ${provider}">
                            ${providerIcons[provider] || '🤖'}
                        </div>
                        <div class="model-item-info">
                            <div class="model-item-name">${model.name}</div>
                            <div class="model-item-desc">${model.description}</div>
                        </div>
                        <div class="model-item-check">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
        
        // Attach click handlers
        listContainer.querySelectorAll('.model-item').forEach(item => {
            item.addEventListener('click', () => {
                const modelId = item.dataset.modelId;
                selectModel(modelId);
            });
        });
    }

    function selectModel(modelId) {
        Agent.setSelectedModel(modelId);
        updateModelUI();
        closeModelSelector();
        showToast(`Model changed to ${Agent.getModel(modelId).name}`, 'success');
    }

    function updateModelUI() {
        const label = document.getElementById('current-model-label');
        const model = Agent.getModel(Agent.getSelectedModel());
        if (label) {
            label.textContent = model.name;
        }
    }

    /**
     * Show a toast notification
     * @param {string} message - The message to show
     */
    function showToast(message) {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = 'agent-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 100px;
            right: 30px;
            background: var(--surface-color, #2d2d2d);
            color: var(--text-primary, #e0e0e0);
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10002;
            font-size: 14px;
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        // Animate in
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        
        // Remove after delay
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    /**
     * Convert basic markdown to HTML
     * @param {string} text - Markdown text
     * @returns {string} HTML text
     */
    function markdownToHtml(text) {
        if (!text) return '';
        
        return text
            // Escape HTML entities
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // Code blocks (must be before inline code)
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Bold
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // Headers
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Lists - unordered
            .replace(/^(\s*)- (.+)$/gm, '$1<li>$2</li>')
            // Lists - ordered
            .replace(/^(\s*)\d+\. (.+)$/gm, '$1<li>$2</li>')
            // Blockquotes
            .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
            // Line breaks
            .replace(/\n/g, '<br>')
            // Wrap consecutive li elements in ul
            .replace(/(<li>.*<\/li>)(<br>\s*)*(<li>)/g, '$1$3')
            // Fix multiple breaks
            .replace(/(<br>){3,}/g, '<br><br>');
    }

    // Public API
    return {
        init,
        openChat,
        closeChat,
        toggleChat,
        sendMessage,
        quickAction,
        clearChat,
        renderMessages,
        renderMessage,
        scrollToBottom,
        showTypingIndicator,
        hideTypingIndicator,
        // Model selector
        toggleModelSelector,
        openModelSelector,
        closeModelSelector,
        selectModel,
        updateModelUI
    };
})();

// Expose to window
window.AgentUI = {
    init: AgentUI.init,
    openChat: AgentUI.openChat,
    closeChat: AgentUI.closeChat,
    toggleChat: AgentUI.toggleChat,
    sendMessage: AgentUI.sendMessage,
    quickAction: AgentUI.quickAction,
    clearChat: AgentUI.clearChat,
    // Model selector
    toggleModelSelector: AgentUI.toggleModelSelector,
    openModelSelector: AgentUI.openModelSelector,
    closeModelSelector: AgentUI.closeModelSelector,
    selectModel: AgentUI.selectModel,
    updateModelUI: AgentUI.updateModelUI
};

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', AgentUI.init);
} else {
    // DOM already loaded
    AgentUI.init();
}
