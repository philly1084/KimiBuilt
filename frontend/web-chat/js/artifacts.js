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
            .artifact-composer { margin-top: 8px; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 10px; background: rgba(15,23,42,0.35); }
            .artifact-composer .artifact-toolbar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
            .artifact-composer .artifact-list { display: flex; flex-wrap: wrap; gap: 8px; }
            .artifact-chip { border: 1px solid rgba(255,255,255,0.1); border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
            .artifact-chip.active { border-color: #38bdf8; color: #38bdf8; }
            .artifact-thread-card { border: 1px solid rgba(56,189,248,0.3); border-radius: 12px; padding: 12px; margin-top: 12px; background: rgba(56,189,248,0.08); }
            .artifact-thread-card a { color: #38bdf8; }
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
            renderArtifacts();
            return;
        }

        const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/artifacts`);
        if (!response.ok) return;
        const data = await response.json();
        state.artifacts = data.artifacts || [];
        renderArtifacts();
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

    function renderArtifacts() {
        const list = document.getElementById('chat-artifact-list');
        if (!list) return;
        list.innerHTML = '';

        state.artifacts.forEach((artifact) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `artifact-chip${state.selectedArtifactIds.includes(artifact.id) ? ' active' : ''}`;
            chip.textContent = artifact.filename;
            chip.addEventListener('click', () => {
                if (state.selectedArtifactIds.includes(artifact.id)) {
                    state.selectedArtifactIds = state.selectedArtifactIds.filter((id) => id !== artifact.id);
                } else {
                    state.selectedArtifactIds = [...state.selectedArtifactIds, artifact.id];
                }
                renderArtifacts();
            });
            list.appendChild(chip);
        });
    }

    function renderGeneratedArtifacts(artifacts) {
        if (!Array.isArray(artifacts) || artifacts.length === 0) return;
        const container = document.getElementById('messages-container');
        if (!container) return;

        artifacts.forEach((artifact) => {
            const card = document.createElement('div');
            card.className = 'artifact-thread-card';
            card.innerHTML = `
                <div><strong>Generated file:</strong> ${artifact.filename}</div>
                <div style="margin-top:6px; font-size:12px; opacity:0.8;">${artifact.format} • ${artifact.sizeBytes} bytes</div>
                <div style="margin-top:8px;"><a href="${artifact.downloadUrl}" target="_blank" rel="noopener">Download</a></div>
            `;
            container.appendChild(card);
        });
        container.scrollTop = container.scrollHeight;
    }

    function injectComposer() {
        const inputArea = document.querySelector('.input-area .max-w-4xl');
        if (!inputArea) return;

        const panel = document.createElement('div');
        panel.className = 'artifact-composer';
        panel.innerHTML = `
            <div class="artifact-toolbar">
                <button id="chat-artifact-upload-btn" class="btn-secondary py-2 px-3 rounded-lg text-sm" type="button">Upload File</button>
                <select id="chat-artifact-format" class="btn-secondary py-2 px-3 rounded-lg text-sm">
                    <option value="">No file output</option>
                    <option value="html">HTML</option>
                    <option value="pdf">PDF</option>
                    <option value="docx">DOCX</option>
                    <option value="xml">XML</option>
                    <option value="mermaid">Mermaid</option>
                    <option value="xlsx">XLSX</option>
                    <option value="power-query">Power Query</option>
                </select>
                <input id="chat-artifact-file-input" type="file" hidden>
            </div>
            <div id="chat-artifact-list" class="artifact-list"></div>
        `;
        inputArea.appendChild(panel);

        document.getElementById('chat-artifact-upload-btn').addEventListener('click', () => {
            document.getElementById('chat-artifact-file-input').click();
        });
        document.getElementById('chat-artifact-file-input').addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                await uploadArtifact(file);
                window.uiHelpers?.showToast?.(`Uploaded ${file.name}`, 'success');
            } catch (error) {
                window.uiHelpers?.showToast?.(error.message, 'error');
            }
            event.target.value = '';
        });
        document.getElementById('chat-artifact-format').addEventListener('change', (event) => {
            state.outputFormat = event.target.value;
        });
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

            const response = await fetch(`${V1_BASE}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                body: JSON.stringify(params),
                signal,
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

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);
                    if (payload === '[DONE]') {
                        continue;
                    }
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
        };
    }

    function patchApp() {
        if (!window.chatApp) return;
        const originalHandleDone = window.chatApp.handleDone.bind(window.chatApp);
        window.chatApp.handleDone = function() {
            originalHandleDone();
            if (state.lastDone?.artifacts?.length) {
                renderGeneratedArtifacts(state.lastDone.artifacts);
                state.artifacts = [...state.lastDone.artifacts, ...state.artifacts.filter((artifact) => !state.lastDone.artifacts.find((next) => next.id === artifact.id))];
                renderArtifacts();
                state.lastDone = null;
            } else {
                fetchArtifacts();
            }
        };
    }

    function hookSessionEvents() {
        if (!window.sessionManager) return;
        window.sessionManager.addEventListener('sessionCreated', () => {
            state.selectedArtifactIds = [];
            fetchArtifacts();
        });
        window.sessionManager.addEventListener('sessionSwitched', () => {
            state.selectedArtifactIds = [];
            fetchArtifacts();
        });
        window.sessionManager.addEventListener('sessionDeleted', () => {
            state.selectedArtifactIds = [];
            fetchArtifacts();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        injectStyles();
        injectComposer();
        overrideApiClient();
        setTimeout(() => {
            patchApp();
            hookSessionEvents();
            fetchArtifacts();
        }, 50);
    });
})();


