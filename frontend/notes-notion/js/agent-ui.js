/**
 * AgentUI - UI controller for the notes AI assistant
 * Keeps the corner agent and model selector in sync with the Agent module.
 */
const AgentUI = (function() {
    let elements = {};
    let initialized = false;
    let streamState = {
        active: false,
        content: '',
        error: null
    };

    function cacheElements() {
        elements = {
            widgetBtn: document.getElementById('agent-widget-btn'),
            modal: document.getElementById('agent-chat-modal'),
            modalContent: document.querySelector('.agent-chat-container'),
            closeBtn: document.querySelector('.agent-chat-close'),
            messagesContainer: document.getElementById('agent-chat-messages'),
            input: document.getElementById('agent-chat-input'),
            sendBtn: document.getElementById('agent-chat-send'),
            modelSelectorDropdown: document.getElementById('model-selector-dropdown'),
            modelSelectorBtn: document.getElementById('model-selector-btn'),
            currentModelLabel: document.getElementById('current-model-label'),
            modelList: document.getElementById('model-list'),
            chatModelName: document.getElementById('agent-chat-model-name'),
            contextIndicator: document.querySelector('.context-indicator')
        };
    }

    function init() {
        if (initialized) return;

        cacheElements();

        if (!elements.modal || !elements.messagesContainer) {
            console.warn('AgentUI: required chat elements not found, skipping initialization');
            return;
        }

        setupEventListeners();
        updateModelUI();
        updateContextIndicator();
        renderMessages();
        initialized = true;
        console.log('AgentUI initialized');
    }

    function setupEventListeners() {
        if (elements.widgetBtn) {
            elements.widgetBtn.addEventListener('click', openChat);
        }

        if (elements.closeBtn) {
            elements.closeBtn.addEventListener('click', closeChat);
        }

        if (elements.modal) {
            elements.modal.addEventListener('click', (event) => {
                if (event.target === elements.modal) {
                    closeChat();
                }
            });
        }

        if (elements.sendBtn) {
            elements.sendBtn.addEventListener('click', sendMessage);
        }

        if (elements.input) {
            elements.input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                }
            });

            elements.input.addEventListener('input', autoResizeInput);
        }

        document.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'a') {
                event.preventDefault();
                toggleChat();
            }

            if (event.key === 'Escape') {
                closeModelSelector();
            }
        });

        document.addEventListener('click', (event) => {
            if (!elements.modelSelectorDropdown || !elements.modelSelectorBtn) return;

            const clickedInsideDropdown = elements.modelSelectorDropdown.contains(event.target);
            const clickedOnButton = elements.modelSelectorBtn.contains(event.target);

            if (!clickedInsideDropdown && !clickedOnButton) {
                closeModelSelector();
            }
        });

        window.addEventListener('modelChanged', updateModelUI);
        document.addEventListener('click', scheduleContextRefresh, true);
        document.addEventListener('keyup', scheduleContextRefresh, true);
    }

    function autoResizeInput() {
        if (!elements.input) return;

        elements.input.style.height = 'auto';
        elements.input.style.height = `${Math.min(elements.input.scrollHeight, 140)}px`;
    }

    function openChat() {
        if (!elements.modal) return;

        elements.modal.style.display = 'flex';

        requestAnimationFrame(() => {
            elements.modal.classList.add('active');
            if (elements.modalContent) {
                elements.modalContent.style.opacity = '1';
                elements.modalContent.style.transform = 'scale(1)';
            }
        });

        updateContextIndicator();
        renderMessages();

        if (elements.input) {
            setTimeout(() => elements.input.focus(), 50);
        }
    }

    function closeChat() {
        if (!elements.modal) return;

        elements.modal.classList.remove('active');
        if (elements.modalContent) {
            elements.modalContent.style.opacity = '0';
            elements.modalContent.style.transform = 'scale(0.98)';
        }

        setTimeout(() => {
            if (elements.modal) {
                elements.modal.style.display = 'none';
            }
        }, 180);
    }

    function toggleChat() {
        if (!elements.modal) return;

        const isOpen = elements.modal.style.display === 'flex' || elements.modal.classList.contains('active');
        if (isOpen) {
            closeChat();
        } else {
            openChat();
        }
    }

    async function sendMessage() {
        if (!window.Agent || !elements.input || streamState.active) return;

        const text = elements.input.value.trim();
        if (!text) return;

        elements.input.value = '';
        elements.input.style.height = 'auto';

        await runPrompt(text);
    }

    async function quickAction(action) {
        if (!window.Agent || streamState.active) return;

        const prompts = {
            summarize: 'Summarize this page.',
            continue: 'Continue writing from the current page content.',
            improve: 'Improve the current writing.',
            explain: 'Explain the current page content.'
        };

        if (action === 'outline') {
            const topic = prompt('What topic should the outline cover?');
            if (!topic) return;
            await runPrompt(`Create an outline for: ${topic}`);
            return;
        }

        const promptText = prompts[action];
        if (!promptText) return;

        await runPrompt(promptText);
    }

    async function runPrompt(promptText) {
        if (!window.Agent) return;

        setStreamState({ active: true, content: '', error: null });

        try {
            const request = window.Agent.ask(promptText, {
                onChunk: (chunk, fullResponse) => {
                    const nextContent = fullResponse || `${streamState.content}${chunk || ''}`;
                    setStreamState({ active: true, content: nextContent, error: null });
                    renderMessages();
                    scrollToBottom();
                },
                onComplete: () => {
                    setStreamState({ active: false, content: '', error: null });
                    renderMessages();
                    scrollToBottom();
                },
                onError: (error) => {
                    console.error('AgentUI request failed:', error);
                    setStreamState({
                        active: false,
                        content: '',
                        error: error?.message || 'Something went wrong. Please try again.'
                    });
                    renderMessages();
                    scrollToBottom();
                }
            });

            renderMessages();
            scrollToBottom();
            await request;
        } catch (error) {
            console.error('AgentUI sendMessage error:', error);
            setStreamState({
                active: false,
                content: '',
                error: error?.message || 'Something went wrong. Please try again.'
            });
            renderMessages();
        }
    }

    async function openWithPrompt(promptText, options = {}) {
        const { send = false } = options;

        openChat();
        if (!elements.input) return;

        elements.input.value = promptText || '';
        autoResizeInput();

        if (send && promptText) {
            await sendMessage();
            return;
        }

        setTimeout(() => {
            elements.input?.focus();
        }, 0);
    }

    function scheduleContextRefresh() {
        window.requestAnimationFrame(updateContextIndicator);
    }

    function updateContextIndicator() {
        if (!elements.contextIndicator || !window.Agent?.getPageContext) return;

        const pageContext = window.Agent.getPageContext();
        if (!pageContext) {
            elements.contextIndicator.textContent = 'No page loaded';
            return;
        }

        const selectedBlockId = window.Selection?.getSelectedBlockId?.();
        const selectedLabel = selectedBlockId ? `, selected ${selectedBlockId}` : '';
        elements.contextIndicator.textContent = `${pageContext.title || 'Untitled'} - ${pageContext.blockCount} blocks${selectedLabel}`;
    }

    function setStreamState(nextState) {
        streamState = {
            ...streamState,
            ...nextState
        };
    }

    function renderMessages() {
        if (!elements.messagesContainer || !window.Agent) return;

        const messages = window.Agent.getMessages();
        elements.messagesContainer.innerHTML = '';

        if (messages.length === 0 && !streamState.active && !streamState.error) {
            elements.messagesContainer.innerHTML = `
                <div class="agent-empty-state">
                    <div class="agent-empty-icon">AI</div>
                    <p>Ask me anything about your notes</p>
                    <p class="agent-empty-hint">I can summarize, continue writing, or help restructure the page.</p>
                </div>
            `;
            return;
        }

        messages.forEach((message) => {
            elements.messagesContainer.appendChild(renderMessage(message));
        });

        if (streamState.active) {
            elements.messagesContainer.appendChild(renderStreamingMessage(streamState.content));
        }

        if (streamState.error) {
            elements.messagesContainer.appendChild(renderMessage({
                role: 'assistant',
                content: `**Error:** ${streamState.error}`,
                timestamp: Date.now(),
                transient: true
            }));
        }

        scrollToBottom();
    }

    function renderStreamingMessage(content) {
        const message = renderMessage({
            role: 'assistant',
            content: content || '...',
            timestamp: Date.now()
        });

        message.classList.add('agent-message-streaming');
        return message;
    }

    function renderMessage(message) {
        const isUser = message.role === 'user';
        const div = document.createElement('div');
        div.className = `agent-message agent-message-${isUser ? 'user' : 'agent'}`;

        const avatar = isUser ? 'You' : 'AI';
        const timestamp = message.timestamp
            ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';

        div.innerHTML = `
            <div class="agent-message-avatar">${avatar}</div>
            <div class="agent-message-content">
                <div class="agent-message-text">${markdownToHtml(message.content)}</div>
                ${timestamp ? `<div class="agent-message-time">${timestamp}</div>` : ''}
            </div>
        `;

        return div;
    }

    function scrollToBottom() {
        if (!elements.messagesContainer) return;
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }

    function showTypingIndicator() {
        setStreamState({ active: true, content: '', error: null });
        renderMessages();
    }

    function hideTypingIndicator() {
        setStreamState({ active: false, content: '', error: null });
        renderMessages();
    }

    function clearChat() {
        if (!window.Agent) return;

        setStreamState({ active: false, content: '', error: null });
        window.Agent.clearConversation();
        renderMessages();
        showToast('Chat history cleared', 'success');
    }

    async function toggleModelSelector() {
        if (!elements.modelSelectorDropdown) return;

        if (elements.modelSelectorDropdown.style.display === 'flex') {
            closeModelSelector();
            return;
        }

        await openModelSelector();
    }

    async function openModelSelector() {
        if (!elements.modelSelectorDropdown) return;

        elements.modelSelectorDropdown.style.display = 'flex';
        elements.modelSelectorBtn?.classList.add('active');

        try {
            await window.Agent?.getModelsAsync?.();
        } catch (error) {
            console.warn('AgentUI: failed to refresh models from API:', error);
        }

        renderModelList();
    }

    function closeModelSelector() {
        if (!elements.modelSelectorDropdown) return;

        elements.modelSelectorDropdown.style.display = 'none';
        elements.modelSelectorBtn?.classList.remove('active');
    }

    function renderModelList() {
        if (!elements.modelList || !window.Agent) return;

        const models = window.Agent.getModels();
        if (!models.length) {
            elements.modelList.innerHTML = `
                <div class="model-group">
                    <div class="model-group-title">Loading...</div>
                </div>
            `;
            return;
        }

        const grouped = groupModelsByProvider(models);
        elements.modelList.innerHTML = Object.entries(grouped).map(([provider, providerModels]) => `
            <div class="model-group">
                <div class="model-group-title">${provider}</div>
                ${providerModels.map((model) => renderModelItem(model)).join('')}
            </div>
        `).join('');

        elements.modelList.querySelectorAll('.model-item').forEach((item) => {
            item.addEventListener('click', () => {
                selectModel(item.dataset.modelId);
            });
        });
    }

    function renderModelItem(model) {
        const isActive = model.id === window.Agent.getSelectedModel();
        const provider = getModelProvider(model);
        const displayName = getModelDisplayName(model);
        const description = getModelDescription(model);

        return `
            <div class="model-item ${isActive ? 'active' : ''}" data-model-id="${escapeHtmlAttr(model.id)}" role="option" aria-selected="${isActive}">
                <div class="model-item-icon ${provider}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                        <rect x="9" y="9" width="6" height="6"></rect>
                    </svg>
                </div>
                <div class="model-item-info">
                    <div class="model-item-name">${escapeHtml(displayName)}</div>
                    <div class="model-item-desc">${escapeHtml(description)}</div>
                </div>
                <div class="model-item-check" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
            </div>
        `;
    }

    function groupModelsByProvider(models) {
        return models.reduce((grouped, model) => {
            const providerName = getModelProviderName(model);
            if (!grouped[providerName]) {
                grouped[providerName] = [];
            }
            grouped[providerName].push(model);
            return grouped;
        }, {});
    }

    function getModelProvider(model) {
        const provider = String(model.provider || '').toLowerCase();
        if (provider) return provider;

        const id = String(model.id || '').toLowerCase();
        if (id.includes('claude')) return 'anthropic';
        if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4')) return 'openai';
        if (id.includes('kimi')) return 'kimi';
        if (id.includes('gemini') || id.includes('palm')) return 'google';
        if (id.includes('llama') || id.includes('meta')) return 'meta';
        if (id.includes('mistral')) return 'mistral';
        return 'other';
    }

    function getModelProviderName(model) {
        const provider = getModelProvider(model);
        const names = {
            anthropic: 'Anthropic',
            google: 'Google',
            kimi: 'Kimi',
            meta: 'Meta',
            mistral: 'Mistral',
            openai: 'OpenAI',
            other: 'Other'
        };

        return names[provider] || 'Other';
    }

    function getModelDisplayName(model) {
        return model.name || model.id;
    }

    function getModelDescription(model) {
        return model.description || model.owned_by || 'AI model';
    }

    function selectModel(modelId) {
        if (!window.Agent?.setSelectedModel(modelId)) {
            showToast('Failed to change model', 'error');
            return;
        }

        updateModelUI();
        closeModelSelector();
        showToast(`Model changed to ${getModelDisplayName(window.Agent.getModel(modelId))}`, 'success');
        window.dispatchEvent(new CustomEvent('modelChanged', { detail: { modelId } }));
    }

    function updateModelUI() {
        if (!window.Agent) return;

        const model = window.Agent.getModel(window.Agent.getSelectedModel());
        const displayName = getModelDisplayName(model);

        if (elements.currentModelLabel) {
            elements.currentModelLabel.textContent = displayName;
        }

        if (elements.chatModelName) {
            elements.chatModelName.textContent = `AI Assistant - ${displayName}`;
        }
    }

    function showToast(message, type = 'info') {
        if (window.Sidebar?.showToast) {
            window.Sidebar.showToast(message, type);
            return;
        }

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
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }

    function markdownToHtml(text) {
        if (!text) return '';

        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            .replace(/^(\s*)- (.+)$/gm, '$1<li>$2</li>')
            .replace(/^(\s*)\d+\. (.+)$/gm, '$1<li>$2</li>')
            .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\n/g, '<br>')
            .replace(/(<li>.*<\/li>)(<br>\s*)*(<li>)/g, '$1$3')
            .replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>')
            .replace(/(<\/ul>)<ul>/g, '')
            .replace(/(<br>){3,}/g, '<br><br>');
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function escapeHtmlAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

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
        toggleModelSelector,
        openModelSelector,
        closeModelSelector,
        selectModel,
        updateModelUI,
        openWithPrompt
    };
})();

window.AgentUI = {
    init: AgentUI.init,
    openChat: AgentUI.openChat,
    closeChat: AgentUI.closeChat,
    toggleChat: AgentUI.toggleChat,
    sendMessage: AgentUI.sendMessage,
    quickAction: AgentUI.quickAction,
    clearChat: AgentUI.clearChat,
    openWithPrompt: AgentUI.openWithPrompt,
    toggleModelSelector: AgentUI.toggleModelSelector,
    openModelSelector: AgentUI.openModelSelector,
    closeModelSelector: AgentUI.closeModelSelector,
    selectModel: AgentUI.selectModel,
    updateModelUI: AgentUI.updateModelUI
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', AgentUI.init);
} else {
    AgentUI.init();
}
