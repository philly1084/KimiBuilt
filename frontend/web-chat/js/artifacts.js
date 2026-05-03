/**
 * Artifacts Module - Simplified version that works with FileManager
 * Handles file upload toolbar and generated file display
 */

(function() {
    const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
    const API_BASE = LOCAL_HOSTNAMES.has(window.location.hostname)
        ? 'http://localhost:3000'
        : `${window.location.protocol}//${window.location.host}`;
    const gatewayStreamHelpers = window.KimiBuiltGatewaySSE || {};
    const DEFAULT_CHAT_MODEL = gatewayStreamHelpers.DEFAULT_CODEX_MODEL_ID || 'gpt-5.4-mini';
    const REMOTE_BUILD_AUTONOMY_STORAGE_KEY = 'kimibuilt_remote_build_autonomy';

    function isRemoteBuildAutonomyApproved() {
        try {
            const stored = window.sessionManager?.safeStorageGet?.(REMOTE_BUILD_AUTONOMY_STORAGE_KEY)
                ?? '';
            const normalized = String(stored || '').trim().toLowerCase();
            if (!normalized) {
                return true;
            }
            if (['0', 'false', 'no', 'off'].includes(normalized)) {
                return false;
            }
            return ['1', 'true', 'yes', 'on'].includes(normalized);
        } catch (_error) {
            return true;
        }
    }

    const state = {
        artifacts: [],
        selectedArtifactIds: [],
        selectedArtifactIdsBySession: new Map(),
        outputFormat: '',
        lastDone: null,
    };

    function getCurrentSessionId() {
        return String(window.sessionManager?.currentSessionId || window.apiClient?.getSessionId?.() || '').trim();
    }

    function resolveApiUrl(urlPath = '', { absolute = false } = {}) {
        const normalized = String(urlPath || '').trim();
        if (!normalized) return '';
        if (/^https?:\/\//i.test(normalized) || normalized.startsWith('blob:') || normalized.startsWith('data:')) {
            return normalized;
        }

        const relativePath = normalized.startsWith('/') ? normalized : `/${normalized}`;
        return absolute ? `${API_BASE}${relativePath}` : relativePath;
    }

    function isCurrentSessionId(sessionId = '') {
        const normalizedSessionId = String(sessionId || '').trim();
        return Boolean(normalizedSessionId) && normalizedSessionId === getCurrentSessionId();
    }

    function getSelectionScopeKey(sessionId = getCurrentSessionId()) {
        const normalizedSessionId = String(sessionId || '').trim();
        return normalizedSessionId || '__no-session__';
    }

    function getSelectedArtifactIds(sessionId = getCurrentSessionId()) {
        const key = getSelectionScopeKey(sessionId);
        const selected = state.selectedArtifactIdsBySession.get(key);
        if (!Array.isArray(selected)) {
            return [];
        }
        return [...new Set(selected.map((entry) => String(entry || '').trim()).filter(Boolean))];
    }

    function setSelectedArtifactIds(nextIds = [], sessionId = getCurrentSessionId()) {
        const key = getSelectionScopeKey(sessionId);
        const normalized = [...new Set((Array.isArray(nextIds) ? nextIds : [])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean))];
        if (normalized.length > 0) {
            state.selectedArtifactIdsBySession.set(key, normalized);
        } else {
            state.selectedArtifactIdsBySession.delete(key);
        }
        state.selectedArtifactIds = getSelectedArtifactIds();
        return state.selectedArtifactIds;
    }

    function addSelectedArtifactId(id, sessionId = getCurrentSessionId()) {
        const normalizedId = String(id || '').trim();
        if (!normalizedId) return getSelectedArtifactIds(sessionId);
        const next = getSelectedArtifactIds(sessionId);
        if (!next.includes(normalizedId)) {
            next.push(normalizedId);
        }
        return setSelectedArtifactIds(next, sessionId);
    }

    function removeSelectedArtifactId(id, sessionId = getCurrentSessionId()) {
        const normalizedId = String(id || '').trim();
        if (!normalizedId) return getSelectedArtifactIds(sessionId);
        const next = getSelectedArtifactIds(sessionId).filter((entry) => entry !== normalizedId);
        return setSelectedArtifactIds(next, sessionId);
    }

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

            body.layout-minimal .artifact-toolbar-compact {
                width: max-content;
                max-width: 100%;
                margin: 8px auto 0;
                padding: 0;
                gap: 6px;
                border: 0;
                background: transparent;
            }

            body.layout-minimal .artifact-toolbar-compact .toolbar-btn {
                width: 36px;
                height: 36px;
                justify-content: center;
                padding: 0;
                border-radius: 10px;
                background: color-mix(in srgb, var(--bg-tertiary) 78%, transparent);
            }

            body.layout-minimal .artifact-toolbar-compact .toolbar-btn span,
            body.layout-minimal .artifact-toolbar-compact .toolbar-divider,
            body.layout-minimal .artifact-toolbar-compact .selected-count {
                display: none;
            }

            body.layout-minimal .artifact-selected-chips:empty {
                display: none;
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
            .artifact-generated-card .file-icon.pptx { background: rgba(234, 88, 12, 0.15); color: #ea580c; }
            .artifact-generated-card .file-icon.html { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
            .artifact-generated-card .file-icon.image { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
            .artifact-generated-card .file-icon.code { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
            .artifact-generated-card .file-icon.mermaid { background: rgba(255, 193, 7, 0.15); color: #ffc107; }
            .artifact-generated-card .file-icon.svg { background: rgba(0, 188, 212, 0.15); color: #00bcd4; }
            
            .artifact-generated-card h4 {
                font-weight: 600;
                margin-bottom: 4px;
            }
            
            .artifact-generated-card .file-meta {
                font-size: 13px;
                color: var(--text-secondary);
                margin-bottom: 12px;
            }

            .artifact-generated-card .artifact-mermaid-preview {
                margin-bottom: 12px;
            }

            .artifact-generated-card .artifact-mermaid-preview .mermaid-render-surface {
                min-height: 220px;
            }

            .artifact-generated-card .artifact-html-preview {
                margin-bottom: 12px;
                border: 1px solid rgba(245, 158, 11, 0.22);
                border-radius: 12px;
                overflow: hidden;
                background: rgba(15, 23, 42, 0.06);
            }

            .artifact-generated-card .artifact-html-preview iframe {
                display: block;
                width: 100%;
                height: 320px;
                border: none;
                background: #ffffff;
            }

            .site-preview-modal {
                position: fixed;
                inset: 0;
                z-index: 1000;
                display: grid;
                grid-template-rows: 52px minmax(0, 1fr);
                background: #0b1020;
            }

            .site-preview-modal[hidden] {
                display: none;
            }

            .site-preview-toolbar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                border-bottom: 1px solid rgba(148, 163, 184, 0.26);
                background: rgba(15, 23, 42, 0.96);
                color: #e5e7eb;
            }

            .site-preview-toolbar button {
                width: 36px;
                height: 36px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid rgba(148, 163, 184, 0.32);
                border-radius: 8px;
                background: rgba(30, 41, 59, 0.86);
                color: #e5e7eb;
                cursor: pointer;
            }

            .site-preview-toolbar button:hover {
                border-color: rgba(56, 189, 248, 0.7);
                color: #ffffff;
            }

            .site-preview-title {
                min-width: 0;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-size: 13px;
                font-weight: 650;
            }

            .site-preview-modal iframe {
                display: block;
                width: 100%;
                height: 100%;
                border: 0;
                background: #ffffff;
            }
            
            .artifact-generated-card .file-actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
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
        const sessionId = getCurrentSessionId();
        if (!sessionId || window.sessionManager?.isLocalSession?.(sessionId)) {
            state.artifacts = [];
            setSelectedArtifactIds([]);
            renderSelectedChips();
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/artifacts`);
            if (response.status === 404 || response.status === 503) {
                if (!isCurrentSessionId(sessionId)) {
                    return;
                }
                state.artifacts = [];
                renderSelectedChips();
                return;
            }
            if (!response.ok) return;
            const data = await response.json();
            if (!isCurrentSessionId(sessionId)) {
                return;
            }
            state.artifacts = data.artifacts || [];
            const availableIds = new Set(state.artifacts.map((artifact) => String(artifact?.id || '').trim()).filter(Boolean));
            const filteredSelection = getSelectedArtifactIds(sessionId).filter((id) => availableIds.has(id));
            setSelectedArtifactIds(filteredSelection, sessionId);

            // Sync with file manager if available
            if (window.fileManager) {
                state.artifacts.forEach(artifact => {
                    window.fileManager.addFile(artifact, { sessionId });
                });
            }
            
            renderSelectedChips();
        } catch (error) {
            console.error('[Artifacts] Failed to fetch:', error);
        }
    }

    function hasExplicitArtifactIntent(text = '') {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return false;

        return /\b(export|download|save|convert|turn\b[\s\S]{0,20}\binto|turn\b[\s\S]{0,20}\bas|format\b[\s\S]{0,20}\bas)\b/i.test(normalized)
            || /\b(create|make|generate|build|produce|render|prepare|draft)\b[\s\S]{0,60}\b(file|artifact|document|page|report|brief|pdf|html|docx|xml|spreadsheet|excel|workbook|mermaid|diagram|flowchart|sequence diagram|erd|class diagram|state diagram)\b/i.test(normalized)
            || /\b(as|into|in)\s+(?:an?\s+)?(?:pdf|html|docx|xml|spreadsheet|excel workbook|workbook|mermaid|mmd)\b/i.test(normalized)
            || /\b(pdf|html|docx|xml|spreadsheet|excel|workbook)\s+(?:file|document|artifact|export)\b/i.test(normalized);
    }

    function hasExplicitMermaidIntent(text = '') {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return false;

        if (/\b(mermaid|\.mmd\b)\b/i.test(normalized)) {
            return hasExplicitArtifactIntent(normalized)
                || /\b(mermaid|mmd)\s+(?:file|artifact|diagram|chart|export)\b/i.test(normalized);
        }

        return /\b(create|make|generate|build|produce|render|export|draw)\b[\s\S]{0,60}\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\b/i.test(normalized)
            || /\b(diagram|flowchart|sequence diagram|erd|entity relationship|class diagram|state diagram)\s+(?:file|artifact|export)\b/i.test(normalized);
    }

    function hasExplicitHtmlArtifactIntent(text = '') {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return false;

        return /\b(standalone html|html file|downloadable html|shareable html|html artifact|html export)\b/.test(normalized)
            || (/\bhtml\b/.test(normalized) && /\b(export|download|save|artifact|file|link|share|attachment)\b/.test(normalized));
    }

    function isInteractiveDocumentRequest(text = '') {
        const normalized = String(text || '')
            .trim()
            .toLowerCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
        if (!normalized || /\b(text only|text-only|plain text|no html|without html|no website|not a website|no interactive|without interaction|static only)\b/.test(normalized)) {
            return false;
        }

        const hasResearchCue = /\b(research|sources?|citations?|latest|recent|current|news|headline|headlines|coverage|fact check|fact-check|verify|look up|web search|online|evidence)\b/.test(normalized);
        const hasDocumentCue = /\b(document|doc|report|brief|guide|research|case study|whitepaper|dossier|analysis|article|memo|note)\b/.test(normalized);
        const hasInteractiveCue = /\b(interactive|clickable|explorable|sortable|filterable|drill down|drilldown|animated|animation|motion|web native|browser native|website grade|website feel|site like|living document|rich document|evidence explorer|source explorer|source map)\b/.test(normalized);

        return /\binteractive\s+(?:document|doc|report|brief|research|guide|dossier|whitepaper|article|page)\b/.test(normalized)
            || /\b(?:document|doc|report|brief|research|guide|dossier|whitepaper|article|analysis)\b.{0,60}\b(?:interactive|clickable|explorable|animated|animation|motion|web native|browser native|website grade|website feel|site like|rich)\b/.test(normalized)
            || (/\b(?:website grade|website feel|web native|browser native|living document|rich document|interactive article|interactive essay)\b/.test(normalized) && hasDocumentCue)
            || (hasResearchCue && /\b(research dashboard|evidence explorer|source explorer|source map|visual report|microsite|web page|webpage|html page|browser page)\b/.test(normalized))
            || (hasResearchCue && hasDocumentCue && hasInteractiveCue);
    }

    function inferRequestedOutputFormat(messages = []) {
        const lastUserMessage = [...messages].reverse().find((message) => message?.role === 'user' && message?.content);
        const text = String(lastUserMessage?.content || '').toLowerCase();
        if (!text) return '';

        const hasArtifactIntent = hasExplicitArtifactIntent(text);
        const hasBuildIntent = /\b(create|make|generate|build|produce|render|prepare|draft)\b/.test(text);
        const hasWebsiteArtifactSubject = /\b(website|web page|webpage|landing page|homepage|microsite|marketing site|frontend demo|front-end demo|site mockup|site prototype)\b/.test(text);
        const hasSandboxPreviewCue = /\b(sandbox|preview|browser preview|live preview|full screen preview|fullscreen preview)\b/.test(text);

        if ((/\b(power\s*query|\.(pq|m)\b)/.test(text) && hasArtifactIntent)
            || /\b(power\s*query)\s+(?:file|script|artifact|export)\b/.test(text)) {
            return 'power-query';
        }

        if ((/\b(xlsx|spreadsheet|excel|workbook)\b/.test(text) && hasArtifactIntent)
            || /\b(excel|spreadsheet|workbook)\s+(?:file|artifact|export)\b/.test(text)) {
            return 'xlsx';
        }

        if (isInteractiveDocumentRequest(text)) return 'html';
        if (/\bpdf\b/.test(text) && hasArtifactIntent) return 'pdf';
        if (/\b(docx|word document)\b/.test(text) && hasArtifactIntent) return 'html';
        if (/\bxml\b/.test(text) && hasArtifactIntent) return 'xml';
        if (hasExplicitMermaidIntent(text)) return 'mermaid';
        if (hasExplicitHtmlArtifactIntent(text)) return 'html';
        if (hasWebsiteArtifactSubject && hasBuildIntent && hasSandboxPreviewCue) return 'html';

        return '';
    }

    async function uploadArtifact(file) {
        const sessionId = await ensureSession();
        const formData = new FormData();
        formData.append('sessionId', sessionId);
        formData.append('mode', 'chat');
        formData.append('file', file);

        const response = await fetch(resolveApiUrl('/api/artifacts/upload', { absolute: true }), {
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
        state.selectedArtifactIds = getSelectedArtifactIds();

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

    function escapeHtmlAttr(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function getArtifactBaseName(filename = 'diagram') {
        return String(filename || 'diagram').replace(/\.[a-z0-9]+$/i, '');
    }

    function getMermaidSourceFromArtifact(artifact) {
        if (!artifact) return '';

        if (artifact.preview?.type === 'text') {
            return String(artifact.preview.content || '').trim();
        }

        if (artifact.preview?.type === 'html') {
            const div = document.createElement('div');
            div.innerHTML = artifact.preview.content || '';
            return String(div.textContent || '').trim();
        }

        if (typeof artifact.contentPreview === 'string' && artifact.contentPreview.trim()) {
            return String(artifact.contentPreview).trim();
        }

        if (typeof artifact.metadata?.mermaidSource === 'string' && artifact.metadata.mermaidSource.trim()) {
            return String(artifact.metadata.mermaidSource).trim();
        }

        return '';
    }

    function isMermaidArtifact(artifact = null) {
        const format = String(artifact?.format || '').toLowerCase();
        const filename = String(artifact?.filename || '').toLowerCase();
        return format === 'mermaid'
            || filename.endsWith('.mmd')
            || filename.endsWith('.mermaid');
    }

    function getFileIconClass(filename, artifact = null) {
        if (artifact?.previewUrl && artifact?.bundleDownloadUrl) {
            return 'html';
        }

        const ext = filename.split('.').pop()?.toLowerCase();
        const docExts = ['doc', 'docx'];
        const pdfExts = ['pdf'];
        const slideExts = ['ppt', 'pptx'];
        const htmlExts = ['html', 'htm'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];
        const diagramExts = ['mmd', 'mermaid'];
        
        if (docExts.includes(ext)) return 'docx';
        if (pdfExts.includes(ext)) return 'pdf';
        if (slideExts.includes(ext)) return 'pptx';
        if (htmlExts.includes(ext)) return 'html';
        if (imageExts.includes(ext)) return 'image';
        if (diagramExts.includes(ext)) return 'mermaid';
        return 'code';
    }

    function getFileIcon(filename, artifact = null) {
        if (artifact?.previewUrl && artifact?.bundleDownloadUrl) {
            return 'globe';
        }

        const ext = filename.split('.').pop()?.toLowerCase();
        const icons = {
            pdf: 'file-text',
            doc: 'file-type',
            docx: 'file-type',
            ppt: 'presentation',
            pptx: 'presentation',
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

    function shouldCollapseArtifactTranscript(artifact) {
        if (artifact?.previewUrl) {
            return true;
        }

        const format = String(artifact?.format || '').toLowerCase();
        const filename = String(artifact?.filename || '').toLowerCase();
        const collapsibleFormats = new Set(['pdf', 'docx', 'xlsx', 'xml', 'html', 'mermaid', 'power-query', 'ppt', 'pptx']);
        const collapsibleExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xml', '.html', '.htm', '.mmd', '.mermaid', '.pq', '.m', '.ppt', '.pptx'];
        return collapsibleFormats.has(format) || collapsibleExtensions.some((ext) => filename.endsWith(ext));
    }

    function buildArtifactSummary(artifacts) {
        const files = (artifacts || []).filter(shouldCollapseArtifactTranscript);
        if (files.length === 0) {
            return '';
        }

        const hasHtml = files.some((artifact) => {
            const format = String(artifact?.format || '').toLowerCase();
            const filename = String(artifact?.filename || '').toLowerCase();
            return Boolean(artifact?.previewUrl)
                || isMermaidArtifact(artifact)
                || format === 'html'
                || filename.endsWith('.html')
                || filename.endsWith('.htm');
        });
        const actionLabel = hasHtml ? 'Preview and Download below.' : 'Use Download below.';

        if (files.length === 1) {
            return `Created ${files[0].filename}. ${actionLabel}`;
        }

        return `Created ${files.length} files. ${actionLabel}`;
    }

    function getArtifactPreviewUrl(artifact, options = {}) {
        const absolute = options && options.absolute === true;
        const preferSandbox = options && options.sandbox === true;

        if (preferSandbox && artifact?.sandboxUrl) {
            return resolveApiUrl(artifact.sandboxUrl, { absolute });
        }

        if (artifact?.previewUrl) {
            return resolveApiUrl(artifact.previewUrl, { absolute });
        }

        const format = String(artifact?.format || '').toLowerCase();
        const filename = String(artifact?.filename || '').toLowerCase();
        const isHtmlLike = format === 'html' || filename.endsWith('.html') || filename.endsWith('.htm');
        if (!isHtmlLike) {
            return '';
        }

        if (!artifact?.downloadUrl) {
            return '';
        }

        const inlinePath = `${artifact.downloadUrl}?inline=1`;
        return resolveApiUrl(inlinePath, { absolute });
    }

    function shouldRenderInlineArtifactPreview(artifact) {
        if (!getArtifactPreviewUrl(artifact)) {
            return false;
        }

        if (artifact?.bundleDownloadUrl || artifact?.preview?.type === 'site') {
            return false;
        }

        return true;
    }

    function buildArtifactCardMarkup(artifact) {
        const iconClass = getFileIconClass(artifact.filename, artifact);
        const iconName = getFileIcon(artifact.filename, artifact);
        const mermaidArtifact = isMermaidArtifact(artifact);
        const mermaidSource = mermaidArtifact ? getMermaidSourceFromArtifact(artifact) : '';
        const mermaidBaseName = getArtifactBaseName(artifact.filename);
        const mermaidDownloadUrl = mermaidArtifact && artifact?.downloadUrl
            ? resolveApiUrl(artifact.downloadUrl, { absolute: true })
            : '';
        const htmlPreviewUrl = getArtifactPreviewUrl(artifact);
        const inlineHtmlPreview = shouldRenderInlineArtifactPreview(artifact);
        const mermaidPreview = mermaidArtifact
            ? `
                <div class="artifact-mermaid-preview">
                    <div
                        class="mermaid-render-surface"
                        data-mermaid-source="${escapeHtmlAttr(mermaidSource)}"
                        data-mermaid-filename="${escapeHtmlAttr(mermaidBaseName)}"
                        data-mermaid-url="${escapeHtmlAttr(mermaidDownloadUrl)}"
                    >
                        <div class="mermaid-placeholder">Rendering diagram...</div>
                    </div>
                </div>
            `
            : '';
        const htmlPreview = inlineHtmlPreview
            ? `
                <div class="artifact-html-preview">
                    <iframe
                        src="${escapeHtmlAttr(htmlPreviewUrl)}"
                        title="${escapeHtmlAttr(artifact.filename || 'Artifact preview')}"
                        loading="lazy"
                        referrerpolicy="no-referrer"
                        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                    ></iframe>
                </div>
            `
            : '';
        const mermaidActions = mermaidArtifact
            ? `
                <button
                    onclick="uiHelpers.downloadMermaidPdf(this)"
                    data-code="${escapeHtmlAttr(mermaidSource)}"
                    data-mermaid-url="${escapeHtmlAttr(mermaidDownloadUrl)}"
                    data-filename="${escapeHtmlAttr(mermaidBaseName)}.pdf"
                >
                    <i data-lucide="download" class="w-4 h-4"></i>
                    PDF
                </button>
            `
            : '';
        const htmlActions = htmlPreviewUrl
            ? `
                <button onclick="artifactManager.openArtifactPreview('${artifact.id}')">
                    <i data-lucide="external-link" class="w-4 h-4"></i>
                    ${artifact?.bundleDownloadUrl ? 'Open Site' : 'Preview'}
                </button>
            `
            : '';
        const deployActions = artifact?.bundleDownloadUrl
            ? `
                <button onclick="artifactManager.exportSiteToManagedApp('${artifact.id}')">
                    <i data-lucide="rocket" class="w-4 h-4"></i>
                    Push to Web
                </button>
            `
            : '';
        const downloadLabel = artifact?.bundleDownloadUrl ? 'Bundle Zip' : 'Download';

        return `
            <div class="artifact-generated-card">
                <div class="file-icon ${iconClass}">
                    <i data-lucide="${iconName}" class="w-5 h-5"></i>
                </div>
                <h4>${escapeHtml(artifact.filename)}</h4>
                <div class="file-meta">
                    ${artifact.format?.toUpperCase() || 'FILE'} | ${formatFileSize(artifact.sizeBytes)}
                </div>
                ${mermaidPreview}
                ${htmlPreview}
                <div class="file-actions">
                    <button class="primary" onclick="artifactManager.downloadArtifact('${artifact.id}', '${escapeHtml(artifact.filename)}')">
                        <i data-lucide="download" class="w-4 h-4"></i>
                        ${downloadLabel}
                    </button>
                    ${mermaidActions}
                    ${htmlActions}
                    ${deployActions}
                    <button onclick="artifactManager.addToContext('${artifact.id}')">
                        <i data-lucide="plus" class="w-4 h-4"></i>
                        Add to Context
                    </button>
                </div>
            </div>
        `;
    }

    function buildArtifactGalleryMarkup(artifacts = []) {
        return (Array.isArray(artifacts) ? artifacts : [])
            .map((artifact) => buildArtifactCardMarkup(artifact))
            .join('');
    }

    function buildArtifactGalleryMessage(artifacts = [], parentMessageId = '') {
        const files = (Array.isArray(artifacts) ? artifacts : []).filter((artifact) => artifact?.id);
        if (files.length === 0) {
            return null;
        }

        return {
            id: parentMessageId ? `${parentMessageId}-artifacts` : uiHelpers.generateMessageId(),
            parentMessageId: parentMessageId || '',
            role: 'assistant',
            type: 'artifact-gallery',
            content: buildArtifactSummary(files) || `Generated ${files.length} file${files.length === 1 ? '' : 's'}.`,
            artifacts: files,
            excludeFromTranscript: true,
            timestamp: new Date().toISOString(),
        };
    }

    function looksLikeRawGeneratedArtifactText(value = '') {
        const source = String(value || '').trim();
        return /^\s*(?:```(?:html)?\s*)?(?:html\s+)?(?:<!doctype\s+html\b|<html\b)/i.test(source)
            || /```html\b[\s\S]*?(?:<!doctype\s+html\b|<html\b)[\s\S]*?```/i.test(source)
            || /\b(?:save|saved|saving|download|open)\b[\s\S]{0,80}?\b[a-z0-9][a-z0-9._ -]{1,100}\.html?\b/i.test(source);
    }

    function renderGeneratedArtifacts(artifacts) {
        const container = document.getElementById('messages-container');
        if (!container) return;

        (Array.isArray(artifacts) ? artifacts : []).forEach((artifact) => {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = buildArtifactCardMarkup(artifact);
            const card = wrapper.firstElementChild;
            if (!card) {
                return;
            }

            container.appendChild(card);

            if (window.fileManager) {
                window.fileManager.addFile(artifact, { sessionId: getCurrentSessionId() });
            }

            window.uiHelpers?.renderMermaidDiagrams?.(card);
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
            <button class="toolbar-btn" type="button" title="Upload file" aria-label="Upload file" onclick="document.getElementById('artifact-file-input').click()">
                <i data-lucide="upload" class="w-4 h-4"></i>
                <span>Upload</span>
            </button>
            <button class="toolbar-btn primary" type="button" title="Open files" aria-label="Open files" onclick="fileManager.open()">
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
        if (window.apiClient.__artifactStreamingPatched) return;

        window.apiClient.uploadArtifact = uploadArtifact;
        window.apiClient.listArtifacts = fetchArtifacts;
        const originalStreamChat = typeof window.apiClient.streamChat === 'function'
            ? window.apiClient.streamChat.bind(window.apiClient)
            : null;

        if (!originalStreamChat) {
            return;
        }

        window.apiClient.streamChat = async function*(messages, model = DEFAULT_CHAT_MODEL, signal = null, reasoningEffort = '', requestOptions = {}) {
            const nextRequestOptions = {
                ...(requestOptions && typeof requestOptions === 'object' ? requestOptions : {}),
            };

            if (isRemoteBuildAutonomyApproved()) {
                nextRequestOptions.metadata = {
                    ...(nextRequestOptions.metadata && typeof nextRequestOptions.metadata === 'object'
                        ? nextRequestOptions.metadata
                        : {}),
                    remoteBuildAutonomyApproved: true,
                };
            }

            if (state.selectedArtifactIds.length > 0) {
                nextRequestOptions.artifactIds = [...getSelectedArtifactIds()];
            }

            const explicitOutputFormat = String(state.outputFormat || '').trim();
            if (explicitOutputFormat) {
                nextRequestOptions.outputFormat = explicitOutputFormat;
            }

            for await (const chunk of originalStreamChat(messages, model, signal, reasoningEffort, nextRequestOptions)) {
                if (chunk.type === 'done') {
                    state.lastDone = {
                        sessionId: chunk.sessionId || window.apiClient.currentSessionId || null,
                        artifacts: Array.isArray(chunk.artifacts) ? chunk.artifacts : [],
                    };
                }

                yield chunk;
            }
        };

        window.apiClient.__artifactStreamingPatched = true;
    }

    function patchApp() {
        if (!window.chatApp) return;

        const originalHandleDone = window.chatApp.handleDone?.bind(window.chatApp);
        window.chatApp.handleDone = function(...args) {
            if (originalHandleDone) originalHandleDone(...args);
            if (state.lastDone?.artifacts?.length) {
                const completedArtifactState = state.lastDone;
                const sessionId = String(completedArtifactState.sessionId || getCurrentSessionId()).trim();
                const isCurrentSession = isCurrentSessionId(sessionId);
                if (sessionId) {
                    const messages = window.sessionManager.getMessages(sessionId) || [];
                    const lastMessage = [...messages].reverse().find((message) => (
                        message
                        && message.role === 'assistant'
                        && message.syntheticUserCheckpoint !== true
                    ));
                    if (lastMessage && lastMessage.role === 'assistant') {
                        const artifactSummary = buildArtifactSummary(state.lastDone.artifacts);
                        const existingDisplayContent = String(lastMessage.displayContent || lastMessage.content || '');
                        const hasSurveyDisplay = typeof window.chatApp?.extractSurveyDefinition === 'function'
                            && Boolean(window.chatApp.extractSurveyDefinition(existingDisplayContent));
                        const hasAssistantText = Boolean(String(lastMessage.content || '').trim());
                        const hasRawArtifactText = looksLikeRawGeneratedArtifactText(lastMessage.content || '');
                        const shouldUseArtifactSummary = Boolean(artifactSummary && !hasSurveyDisplay && (!hasAssistantText || hasRawArtifactText));

                        if (shouldUseArtifactSummary) {
                            lastMessage.displayContent = artifactSummary;
                            if (hasRawArtifactText) {
                                lastMessage.content = artifactSummary;
                            }
                        } else if (!hasSurveyDisplay && String(lastMessage.displayContent || '').trim() === artifactSummary) {
                            delete lastMessage.displayContent;
                        }
                        lastMessage.artifacts = state.lastDone.artifacts
                            .filter((artifact) => artifact?.id && artifact?.downloadUrl);
                        const nextMetadata = {
                            ...(lastMessage.metadata && typeof lastMessage.metadata === 'object' ? lastMessage.metadata : {}),
                            ...(lastMessage.artifacts.length > 0 ? { artifacts: lastMessage.artifacts } : {}),
                        };
                        if (shouldUseArtifactSummary) {
                            nextMetadata.displayContent = artifactSummary;
                        } else if (!hasSurveyDisplay && String(nextMetadata.displayContent || '').trim() === artifactSummary) {
                            delete nextMetadata.displayContent;
                        }
                        lastMessage.metadata = nextMetadata;
                        window.sessionManager.saveToStorage?.();
                        if (isCurrentSession && lastMessage.id && window.chatApp?.renderOrReplaceMessage) {
                            window.chatApp.renderOrReplaceMessage(lastMessage);
                        }
                    }
                }
                if (isCurrentSession) {
                    state.artifacts = [
                        ...completedArtifactState.artifacts,
                        ...state.artifacts.filter((artifact) => !completedArtifactState.artifacts.find((next) => next.id === artifact.id)),
                    ];
                    completedArtifactState.artifacts.forEach((artifact) => {
                        window.fileManager?.addFile?.(artifact, { sessionId });
                    });
                    setSelectedArtifactIds([]);
                    renderSelectedChips();
                }
                state.lastDone = null;
            } else {
                fetchArtifacts();
            }
        };
        
        // Handle errors better - don't immediately show red error on disconnect
        const originalHandleError = window.chatApp.handleError?.bind(window.chatApp);
        window.chatApp.handleError = function(error, status = null) {
            const normalizedMessage = String(error || '').toLowerCase();

            // Check if it's a network/connection error
            if (normalizedMessage.includes('fetch') ||
                normalizedMessage.includes('network') ||
                normalizedMessage.includes('failed to fetch') ||
                status === 0) {
                // Show a more user-friendly message
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Connection interrupted. Retrying...', 'warning');
                }
                // Don't clear the chat or show red error
                return;
            }
            
            if (originalHandleError) {
                originalHandleError(error, status);
            }
        };
    }

    function hookSessionEvents() {
        if (!window.sessionManager) return;
        
        window.sessionManager.addEventListener('sessionCreated', () => {
            state.artifacts = [];
            setSelectedArtifactIds([]);
            renderSelectedChips();
            fetchArtifacts();
        });
        
        window.sessionManager.addEventListener('sessionSwitched', () => {
            setSelectedArtifactIds(getSelectedArtifactIds());
            renderSelectedChips();
            fetchArtifacts();
        });

        window.sessionManager.addEventListener('sessionPromoted', () => {
            fetchArtifacts();
        });
        
        window.sessionManager.addEventListener('sessionDeleted', () => {
            state.artifacts = [];
            setSelectedArtifactIds([]);
            renderSelectedChips();
        });
    }

    /**
     * Generate a diagram file (Mermaid)
     */
    async function generateDiagram(description, type = 'flowchart') {
        const sessionId = await ensureSession();
        
        try {
            const response = await fetch(`${API_BASE}/api/documents/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateId: 'mermaid-diagram',
                    variables: {
                        description: description,
                        diagramType: type
                    },
                    format: 'mmd',
                    options: {
                        includePageNumbers: false
                    }
                })
            });
            
            if (!response.ok) {
                // Fallback: create a simple diagram
                const diagramCode = generateMermaidCode(description, type);
                downloadFile(diagramCode, `diagram-${Date.now()}.mmd`, 'text/plain');
                return;
            }
            
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `diagram-${Date.now()}.mmd`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            if (window.uiHelpers?.showToast) {
                uiHelpers.showToast('Diagram generated successfully', 'success');
            }
        } catch (error) {
            console.error('[Artifacts] Diagram generation failed:', error);
            // Fallback: generate locally
            const diagramCode = generateMermaidCode(description, type);
            downloadFile(diagramCode, `diagram-${Date.now()}.mmd`, 'text/plain');
        }
    }
    
    /**
     * Generate Mermaid code locally as fallback
     */
    function generateMermaidCode(description, type) {
        const templates = {
            flowchart: `graph TD
    A[Start] --> B{${description}}
    B -->|Yes| C[Process]
    B -->|No| D[End]
    C --> D`,
            sequence: `sequenceDiagram
    participant User
    participant System
    User->>System: ${description}
    System-->>User: Response`,
            class: `classDiagram
    class Subject {
        +String name
        +action()
    }
    note for Subject "${description}"`,
            er: `erDiagram
    ENTITY ||--o{ RELATED : has
    ENTITY {
        string name
        string description
    }`,
            mindmap: `mindmap
  root((${description}))
    Topic 1
    Topic 2
    Topic 3`
        };
        
        return templates[type] || templates.flowchart;
    }
    
    /**
     * Download file helper
     */
    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 60 * 1000);
    }

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 60 * 1000);
    }

    function ensureSitePreviewModal() {
        let modal = document.getElementById('site-preview-modal');
        if (modal) {
            return modal;
        }

        modal = document.createElement('div');
        modal.id = 'site-preview-modal';
        modal.className = 'site-preview-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="site-preview-toolbar">
                <button type="button" data-action="close" title="Back to chat" aria-label="Back to chat">
                    <i data-lucide="arrow-left" class="w-4 h-4"></i>
                </button>
                <button type="button" data-action="back" title="Back" aria-label="Back">
                    <i data-lucide="chevron-left" class="w-4 h-4"></i>
                </button>
                <button type="button" data-action="forward" title="Forward" aria-label="Forward">
                    <i data-lucide="chevron-right" class="w-4 h-4"></i>
                </button>
                <button type="button" data-action="refresh" title="Refresh" aria-label="Refresh">
                    <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                </button>
                <div class="site-preview-title"></div>
                <button type="button" data-action="external" title="Open in new tab" aria-label="Open in new tab">
                    <i data-lucide="external-link" class="w-4 h-4"></i>
                </button>
            </div>
            <iframe
                title="Website artifact preview"
                loading="eager"
                referrerpolicy="no-referrer"
                sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
            ></iframe>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            const iframe = modal.querySelector('iframe');
            const src = iframe?.dataset.previewSrc || iframe?.src || '';

            if (action === 'close') {
                modal.hidden = true;
                document.body.classList.remove('site-preview-open');
                return;
            }
            if (action === 'external' && src) {
                window.open(src, '_blank', 'noopener');
                return;
            }
            try {
                if (action === 'back') iframe.contentWindow.history.back();
                if (action === 'forward') iframe.contentWindow.history.forward();
                if (action === 'refresh') iframe.contentWindow.location.reload();
            } catch (_error) {
                if (action === 'refresh' && src) {
                    iframe.src = src;
                }
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !modal.hidden) {
                modal.hidden = true;
                document.body.classList.remove('site-preview-open');
            }
        });
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
        return modal;
    }

    function openSitePreviewModal(artifact, previewUrl) {
        const modal = ensureSitePreviewModal();
        const iframe = modal.querySelector('iframe');
        const title = modal.querySelector('.site-preview-title');
        const absolutePreviewUrl = resolveApiUrl(previewUrl, { absolute: true });
        title.textContent = artifact?.filename || 'Website preview';
        iframe.dataset.previewSrc = absolutePreviewUrl;
        iframe.src = absolutePreviewUrl;
        modal.hidden = false;
        document.body.classList.add('site-preview-open');
    }
    
    // Create global artifact manager for external access
    window.artifactManager = {
        deselectArtifact: (id) => {
            removeSelectedArtifactId(id);
            renderSelectedChips();
        },
        
        selectArtifact: (id) => {
            addSelectedArtifactId(id);
            renderSelectedChips();
        },
        
        downloadArtifact: async (id, filename) => {
            const artifact = state.artifacts.find((entry) => entry.id === id) || state.lastDone?.artifacts?.find((entry) => entry.id === id);
            // Use file manager if available
            if (window.fileManager && !artifact?.bundleDownloadUrl && window.fileManager.files?.some?.((file) => file.id === id)) {
                await window.fileManager.downloadFile(id);
                return;
            }
            
            // Fallback download
            try {
                const downloadPath = artifact?.bundleDownloadUrl || artifact?.downloadUrl || `/api/artifacts/${encodeURIComponent(id)}/download`;
                const response = await fetch(resolveApiUrl(downloadPath, { absolute: true }));
                if (!response.ok) throw new Error('Download failed');
                
                const blob = await response.blob();
                const downloadFilename = artifact?.bundleDownloadUrl
                    ? `${getArtifactBaseName(filename || artifact?.filename || 'site')}.zip`
                    : (filename || 'download');
                triggerBlobDownload(blob, downloadFilename);
            } catch (error) {
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Download failed: ' + error.message, 'error');
                }
            }
        },

        openArtifactPreview: (id) => {
            const artifact = state.artifacts.find((entry) => entry.id === id) || state.lastDone?.artifacts?.find((entry) => entry.id === id);
            const previewUrl = getArtifactPreviewUrl(artifact, { sandbox: true });
            if (!previewUrl) {
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Preview is not available for this file yet.', 'warning');
                }
                return;
            }

            openSitePreviewModal(artifact, previewUrl);
        },

        exportSiteToManagedApp: async (id) => {
            const artifact = state.artifacts.find((entry) => entry.id === id) || state.lastDone?.artifacts?.find((entry) => entry.id === id);
            if (!artifact?.bundleDownloadUrl) {
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Only website bundle artifacts can be pushed to the web build lane.', 'warning');
                }
                return;
            }

            try {
                await ensureSession();
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('Sending site bundle to the remote build lane...', 'info');
                }
                const response = await fetch(resolveApiUrl(`/api/artifacts/${encodeURIComponent(id)}/managed-app`, { absolute: true }), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sessionId: getCurrentSessionId(),
                        requestedAction: 'deploy',
                        deployRequested: true,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error?.message || `Remote build export failed (${response.status})`);
                }
                if (window.uiHelpers?.showToast) {
                    const appName = data.app?.appName || data.app?.slug || 'site';
                    uiHelpers.showToast(`Queued ${appName} for remote build.`, 'success');
                }
            } catch (error) {
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast(error.message, 'error');
                }
            }
        },
        
        addToContext: (id) => {
            const before = getSelectedArtifactIds().length;
            addSelectedArtifactId(id);
            if (getSelectedArtifactIds().length > before) {
                renderSelectedChips();
                if (window.uiHelpers?.showToast) {
                    uiHelpers.showToast('File added to context', 'success');
                }
            }
        },
        
        uploadFile: uploadArtifact,
        persistGeneratedFile: async (content, filename, mimeType = 'application/octet-stream') => {
            await ensureSession();
            const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
            const file = new File([blob], filename, { type: mimeType || blob.type || 'application/octet-stream' });
            await uploadArtifact(file);
        },
        buildArtifactSummary,
        buildGalleryMarkup: buildArtifactGalleryMarkup,
        buildGalleryMessage: buildArtifactGalleryMessage,
        refresh: fetchArtifacts,
        getSelectedIds: () => [...getSelectedArtifactIds()],
        clearSelection: () => {
            setSelectedArtifactIds([]);
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

