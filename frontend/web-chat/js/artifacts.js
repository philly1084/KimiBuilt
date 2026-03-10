/**
 * Artifacts Module - Simplified version that works with FileManager
 * Handles file upload toolbar and generated file display
 */

(function() {
    const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
    const API_BASE = LOCAL_HOSTNAMES.has(window.location.hostname)
        ? 'http://localhost:3000'
        : `${window.location.protocol}//${window.location.host}`;
    const V1_BASE = `${API_BASE}/v1`;

    const state = {
        artifacts: [],
        selectedArtifactIds: [],
        outputFormat: '',
        lastDone: null,
    };

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Compact artifact toolbar - replaces the growing box */
            .artifact-toolbar-compact {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 12px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                border-radius: 10px;
                margin-top: 8px;
            }
            
            .artifact-toolbar-compact .toolbar-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border: 1px solid var(--border);
                background: var(--bg-secondary);
                color: var(--text-secondary);
                font-size: 13px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
            }
            
            .artifact-toolbar-compact .toolbar-btn:hover {
                border-color: var(--accent);
                color: var(--text-primary);
            }
            
            .artifact-toolbar-compact .toolbar-btn.primary {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }
            
            .artifact-toolbar-compact .toolbar-btn.primary:hover {
                opacity: 0.9;
            }
            
            .artifact-toolbar-compact .toolbar-divider {
                width: 1px;
                height: 24px;
                background: var(--border);
                margin: 0 4px;
            }
            
            .artifact-toolbar-compact .selected-count {
                font-size: 12px;
                color: var(--text-tertiary);
                padding: 0 4px;
            }
            
            /* Selected files indicator */
            .artifact-selected-chips {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
                margin-top: 8px;
                max-height: 80px;
                overflow-y: auto;
            }
            
            .artifact-selected-chip {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 10px;
                background: rgba(56, 189, 248, 0.15);
                border: 1px solid rgba(56, 189, 248, 0.3);
                border-radius: 16px;
                font-size: 12px;
                color: var(--text-primary);
            }
            
            .artifact-selected-chip button {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                border: none;
                background: transparent;
                color: var(--text-secondary);
                cursor: pointer;
                border-radius: 50%;
                margin-left: 2px;
            }
            
            .artifact-selected-chip button:hover {
                background: rgba(255, 255, 255, 0.1);
                color: var(--text-primary);
            }
            
            /* Generated artifact card in chat */
            .artifact-generated-card {
                border: 1px solid rgba(56, 189, 248, 0.3);
                border-radius: 12px;
                padding: 16px;
                margin-top: 12px;
                background: rgba(56, 189, 248, 0.05);
            }
            
            .artifact-generated-card .file-icon {
                width: 40px;
                height: 40px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 12px;
            }
            
            .artifact-generated-card .file-icon.docx { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
            .artifact-generated-card .file-icon.pdf { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
            .artifact-generated-card .file-icon.html { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
            .artifact-generated-card .file-icon.image { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
            .artifact-generated-card .file-icon.code { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
            
            .artifact-generated-card h4 {
                font-weight: 600;
                margin-bottom: 4px;
            }
            
            .artifact-generated-card .file-meta {
                font-size: 13px;
                color: var(--text-secondary);
                margin-bottom: 12px;
            }
            
            .artifact-generated-card .file-actions {
                display: flex;
                gap: 8px;
            }
            
            .artifact-generated-card .file-actions button {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 14px;
                border: 1px solid var(--border);
                background: var(--bg-secondary);
                color: var(--text-primary);
                font-size: 13px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .artifact-generated-card .file-actions button:hover {
                border-color: var(--accent);
            }
            
            .artifact-generated-card .file-actions button.primary {
                background: var(--accent);
                color: white;
                border-color: var(--accent);
            }
            
            @media (max-width: 640px) {
                .artifact-toolbar-compact {
                    flex-wrap: wrap;
                }
                
                .artifact-toolbar-compact .toolbar-btn span {
                    display: none;
                }
                
                .artifact-toolbar-compact .toolbar-btn {
                    padding: 6px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    async function ensureSession() {
        if (window.sessionManager?.currentSessionId) {
            return window.sessionManager.currentSessionId;
        }
        if (window.chatApp?.createNewSession) {
            await window.chatApp.createNewSession();
            return window.sessionManager.currentSessionId;
        }
        return null;
    }

    async function fetchArtifacts() {
        const sessionId = window.sessionManager?.currentSessionId || window.apiClient?.getSessionId?.();
        if (!sessionId) {
            state.artifacts = [];
            renderSelectedChips();
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/artifacts`);
            if (!response.ok) return;
            const data = await response.json();
            state.artifacts = data.artifacts || [];
            
            // Sync with file manager if available
            if (window.fileManager) {
                state.artifacts.forEach(artifact => {
                    window.fileManager.addFile(artifact);
                });
            }
            
            renderSelectedChips();
        } catch (error) {
            console.error('[Artifacts] Failed to fetch:', error);
        }
    }

    function inferRequestedOutputFormat(messages = []) {
        const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user' && message?.content);
        const text = String(lastUserMessage?.content || '').toLowerCase();
        if (!text) return '';

        const checks = [
            ['power-query', /\b(power\s*query|\.(pq|m)\b)/],
            ['xlsx', /\b(xlsx|spreadsheet|excel|workbook)\b/],
            ['pdf', /\bpdf\b/],
            ['docx', /\b(docx|word document)\b/],
            ['xml', /\bxml\b/],
            ['mermaid', /\bmermaid\b/],
            ['html', /\bhtml\b/],
        ];

        return checks.find(([, pattern]) => pattern.test(text))?.[0] || '';
    }

    async function uploadArtifact(file) {
        const sessionId = await ensureSession();
        const formData = new FormData();
        formData.append('sessionId', sessionId);
        formData.append('mode', 'chat');
        formData.append('file', file);

        const response = await fetch(`${API_BASE}/api/artifacts/upload`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `Upload failed (${response.status})`);
        }

        await fetchArtifacts();
    }

    function renderSelectedChips() {
        const container = document.getElementById('artifact-selected-chips');
        if (!container) return;

        if (state.selectedArtifactIds.length === 0) {
            container.innerHTML = '';
            updateSelectedCount();
            return;
        }

        container.innerHTML = state.selectedArtifactIds.map(id => {
            const artifact = state.artifacts.find(a => a.id === id);
            if (!artifact) return '';
            return `
                <div class="artifact-selected-chip">
                    <span>${escapeHtml(artifact.filename)}</span>
                    <button onclick="artifactManager.deselectArtifact('${id}')" title="Remove">
                        <i data-lucide="x" class="w-3 h-3"></i>
                    </button>
                </div>
            `;
        }).join('');

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        updateSelectedCount();
    }

    function updateSelectedCount() {
        const countEl = document.getElementById('artifact-selected-count');
        if (countEl) {
            countEl.textContent = `${state.selectedArtifactIds.length} selected`;
        }
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getFileIconClass(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const docExts = ['doc', 'docx'];
        const pdfExts = ['pdf'];
        const htmlExts = ['html', 'htm'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
        
        if (docExts.includes(ext)) return 'docx';
        if (pdfExts.includes(ext)) return 'pdf';
        if (htmlExts.includes(ext)) return 'html';
        if (imageExts.includes(ext)) return 'image';
        return 'code';
    }

    function getFileIcon(filename) {
        const ext = filename.split('.').pop()?.toLowerCase();
        const icons = {
            pdf: 'file-text',
            doc: 'file-type',
            docx: 'file-type',
            html: 'globe',
            htm: 'globe',
            jpg: 'image',
            jpeg: 'image',
            png: 'image',
            gif: 'image',
        };
        return icons[ext] || 'file';
    }

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return 'Unknown size';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
    }

    function renderGeneratedArtifacts(artifacts) {
        if (!Array.isArray(artifacts) || artifacts.length === 0) return;
        const container = document.getElementById('messages-container');
        if (!container) return;

        artifacts.forEach(artifact => {
            const card = document.createElement('div');
            const iconClass = getFileIconClass(artifact.filename);
            const iconName = getFileIcon(artifact.filename);
            
            card.className = 'artifact-generated-card';
            card.innerHTML = `
                <div class="file-icon ${iconClass}">
                    <i data-lucide="${iconName}" class="w-5 h-5"></i>
                </div>
                <h4>${escapeHtml(artifact.filename)}</h4>
                <div class="file-meta">
                    ${artifact.format?.toUpperCase() || 'FILE'} • ${formatFileSize(artifact.sizeBytes)}
                </div>
                <div class="file-actions">
                    <button class="primary" onclick="artifactManager.downloadArtifact('${artifact.id}', '${escapeHtml(artifact.filename)}')">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        Download
                    </button>
                    <button onclick="artifactManager.addToContext('${artifact.id}')">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        Add to Context
                    </button>
                </div>
            `;
            container.appendChild(card);
            
            // Also add to file manager
            if (window.fileManager) {
                window.fileManager.addFile(artifact);
            }
        });
        
        container.scrollTop = container.scrollHeight;
        
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    function injectToolbar() {
        const inputArea = document.querySelector('.input-area .max-w-4xl');
        if (!inputArea || document.getElementById('artifact-toolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'artifact-toolbar';
        toolbar.className = 'artifact-toolbar-compact';
        toolbar.innerHTML = `
            <button class="toolbar-btn" onclick="document.getElementById('artifact-file-input').click()">
                <i data-lucide="upload" class="w-4 h-4"></i>
                <span>Upload</span>
            </button>
            <button class="toolbar-btn primary" onclick="fileManager.open()">
                <i data-lucide="folder-open" class="w-4 h-4"></i>
                <span>Files</span>
            </button>
            <span class="toolbar-divider"></span>
            <span id="artifact-selected-count" class="selected-count">0 selected</span>
            <input id="artifact-file-input" type="file" hidden multiple>
        `;
        
        inputArea.appendChild(toolbar);

        // Selected chips container
        const chipsContainer = document.createElement('div');
        chipsContainer.id = 'artifact-selected-chips';
        chipsContainer.className = 'artifact-selected-chips';
        inputArea.appendChild(chipsContainer);

        // Setup file input
        document.getElementById('artifact-file-input').addEventListener('change', async (event) => {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;
            
            // Show loading toast
            if (window.uiHelpers?.showToast) {
                uiHelpers.showToast(`Uploading ${files.length} file(s)...`, 'info');
            }
            
            for (const file of files) {
                try {
                    await uploadArtifact(file);
                    if (window.uiHelpers?.showToast) {
                        uiHelpers.showToast(`Uploaded ${file.name}`, 'success');
                    }
                } catch (error) {
                    if (window.uiHelpers?.showToast) {
                        uiHelpers.showToast(error.message, 'error');
                    }
                }
            }
            
            event.target.value = '';
        });

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    function overrideApiClient() {
        if (!window.apiClient) return;

        window.apiClient.uploadArtifact = uploadArtifact;
        window.apiClient.listArtifacts = fetchArtifacts;

        window.apiClient.streamChat = async function*(messages, model = 'gpt-4o', signal = null) {
            const params = {
                model,
                messages,
                stream: true,
            };
            if (this.currentSessionId && !String(this.currentSessionId).startsWith('local_')) {
                params.session_id = this.currentSessionId;
            }
            if (state.selectedArtifactIds.length > 0) {
                params.artifact_ids = state.selectedArtifactIds;
            }
            const inferredOutputFormat = state.outputFormat || inferRequestedOutputFormat(messages);
            if (inferredOutputFormat) {
                params.output_format = inferredOutputFormat;
            }

            // Use a longer timeout for generation requests
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
            
            // Combine with external signal if provided
            if (signal) {
                signal.addEventListener('abort', () => controller.abort());
            }

            try {
                const response = await fetch(`${V1_BASE}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                    body: JSON.stringify(params),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    yield { type: 'error', error: `HTTP ${response.status}: ${errorText}`, status: response.status };
                    return;
                }

                const responseSessionId = response.headers.get('X-Session-Id');
                if (responseSessionId) {
                    this.currentSessionId = responseSessionId;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let lastActivity = Date.now();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    lastActivity = Date.now();
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const payload = line.slice(6);
                        if (payload === '[DONE]') continue;
                        
                        try {
                            const parsed = JSON.parse(payload);
                            const content = parsed.choices?.[0]?.delta?.content || '';
                            if (parsed.session_id) {
                                this.currentSessionId = parsed.session_id;
                            }
                            if (content) {
                                yield { type: 'delta', content };
                            }
                            if (parsed.choices?.[0]?.finish_reason) {
                                state.lastDone = { sessionId: this.currentSessionId, artifacts: parsed.artifacts || [] };
                                yield { type: 'done', sessionId: this.currentSessionId, artifacts: parsed.artifacts || [] };
                            }
                        } catch {
                            // ignore malformed chunks
                        }
                    }
                }
            } catch (error) {
                if (error.name === 'AbortError') {
                    yield { type: 'error', error: 'Request timed out. The server may be busy or the connection was interrupted.', status: 408 };
                } else {
                    yield { type: 'error', error: error.message, status: 0 };
                }
            } finally {
                clearTimeout(timeoutId);
            }
        };
    }

    function patchApp() {
        if (!window.chatApp) return;
        
        const originalHandleDone = window.chatApp.handleDone?.bind(window.chatApp);
        window.chatApp.handleDone = function() {
            if (originalHandleDone) originalHandleDone();
            if (state.lastDone?.artifacts?.length) {
                renderGeneratedArtifacts(state.lastDone.artifacts);
                state.artifacts = [...state.lastDone.artifacts, ...state.artifacts.filter((artifact) => !state.lastDone.artifacts.find((next) => next.id === artifact.id))];
                state.selectedArtifactIds = [];
                renderSelectedChips();
                state.lastDone = null;
            } else {
                fetchArtifacts();
            }
        };
        
        // Handle errors better - don't immediately show red error on disconnect
        const originalHandleError = window.chatApp.handleError?.bind(window.chatApp);
        window.chatApp.handleError = function(error) {
            // Check if it's a network/connection error
            if (error?.message?.includes('fetch') || 
                error?.message?.includes('network') ||
                error?.message?.includes('Failed to fetch') ||
                error?.status === 0) {
                // Show a more user-friendly message
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Connection interrupted. Retrying...', 'warning');
                }
                // Don't clear the chat or show red error
                return;
            }
            
            if (originalHandleError) {
                originalHandleError(error);
            }
        };
    }

    function hookSessionEvents() {
        if (!window.sessionManager) return;
        
        window.sessionManager.addEventListener('sessionCreated', () => {
            state.selectedArtifactIds = [];
            state.artifacts = [];
            renderSelectedChips();
            fetchArtifacts();
        });
        
        window.sessionManager.addEventListener('sessionSwitched', () => {
            state.selectedArtifactIds = [];
            renderSelectedChips();
            fetchArtifacts();
        });
        
        window.sessionManager.addEventListener('sessionDeleted', () => {
            state.selectedArtifactIds = [];
            state.artifacts = [];
            renderSelectedChips();
        });
    }

    // Create global artifact manager for external access
    window.artifactManager = {
        deselectArtifact: (id) => {
            state.selectedArtifactIds = state.selectedArtifactIds.filter(artifactId => artifactId !== id);
            renderSelectedChips();
        },
        
        selectArtifact: (id) => {
            if (!state.selectedArtifactIds.includes(id)) {
                state.selectedArtifactIds.push(id);
                renderSelectedChips();
            }
        },
        
        downloadArtifact: async (id, filename) => {
            // Use file manager if available
            if (window.fileManager) {
                await window.fileManager.downloadFile(id);
                return;
            }
            
            // Fallback download
            try {
                const response = await fetch(`${API_BASE}/api/artifacts/${id}/download`);
                if (!response.ok) throw new Error('Download failed');
                
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename || 'download';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Download failed: ' + error.message, 'error');
                }
            }
        },
        
        addToContext: (id) => {
            if (!state.selectedArtifactIds.includes(id)) {
                state.selectedArtifactIds.push(id);
                renderSelectedChips();
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('File added to context', 'success');
                }
            }
        },
        
        uploadFile: uploadArtifact,
        refresh: fetchArtifacts,
        getSelectedIds: () => [...state.selectedArtifactIds],
        clearSelection: () => {
            state.selectedArtifactIds = [];
            renderSelectedChips();
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        injectStyles();
        injectToolbar();
        overrideApiClient();
        
        setTimeout(() => {
            patchApp();
            hookSessionEvents();
            fetchArtifacts();
        }, 100);
    });
})();
