/**
 * AI Agent Module - Intelligent assistant for the notes-notion app
 * Provides contextual AI capabilities, chat interface, and page manipulation
 */

const Agent = (function() {
    const SHARED_MODEL_STORAGE_KEY = 'kimibuilt_default_model';
    const LEGACY_MODEL_STORAGE_KEY = 'notes_agent_model';
    const LEGACY_MESSAGES_STORAGE_KEY = 'notes_agent_messages';
    const PAGE_MESSAGES_STORAGE_PREFIX = 'notes_agent_messages:';
    const NOTES_COLOR_OPTIONS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
    let initPromise = null;

    // ============================================
    // API Client Integration
    // ============================================
    
    // Get or create API client
    function getAPIClient() {
        if (window.notesAPIClient) return window.notesAPIClient;
        
        // Create new client if not exists
        if (typeof NotesAPIClient !== 'undefined') {
            window.notesAPIClient = new NotesAPIClient();
            return window.notesAPIClient;
        }
        
        return null;
    }

    function getCurrentPageSessionId() {
        return window.Editor?.getCurrentPage?.()?.id || null;
    }

    function syncAPIClientSession(apiClient, pageContext = null) {
        if (!apiClient?.setSessionId) {
            return null;
        }

        const sessionId = pageContext?.pageId || getCurrentPageSessionId();
        if (sessionId) {
            apiClient.setSessionId(sessionId);
        }

        return sessionId;
    }

    function getMessagesStorageKey(pageId) {
        return pageId ? `${PAGE_MESSAGES_STORAGE_PREFIX}${pageId}` : LEGACY_MESSAGES_STORAGE_KEY;
    }

    function readStoredMessages(pageId = null) {
        const key = getMessagesStorageKey(pageId);

        try {
            const savedMessages = localStorage.getItem(key);
            if (savedMessages) {
                const parsed = JSON.parse(savedMessages);
                return Array.isArray(parsed) ? parsed : [];
            }

            if (pageId) {
                const legacyMessages = localStorage.getItem(LEGACY_MESSAGES_STORAGE_KEY);
                if (legacyMessages) {
                    const parsedLegacy = JSON.parse(legacyMessages);
                    return Array.isArray(parsedLegacy) ? parsedLegacy : [];
                }
            }
        } catch (error) {
            console.warn('Failed to read saved messages:', error);
        }

        return [];
    }

    function saveMessagesForPage(pageId, messages) {
        try {
            localStorage.setItem(getMessagesStorageKey(pageId), JSON.stringify(messages));
            if (pageId) {
                localStorage.removeItem(LEGACY_MESSAGES_STORAGE_KEY);
            }
        } catch (error) {
            console.warn('Failed to save messages:', error);
        }
    }
    
    // Check if backend is available
    async function isBackendAvailable() {
        const apiClient = getAPIClient();
        if (!apiClient) return false;

        syncAPIClientSession(apiClient);
        
        try {
            if (typeof apiClient.checkHealth === 'function') {
                const health = await apiClient.checkHealth();
                return Boolean(health?.connected);
            }

            await apiClient.getModels(true);
            return true;
        } catch (error) {
            console.log('Backend not available:', error.message);
            return false;
        }
    }
    
    function truncateText(text, maxLength = 240) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return '';
        if (normalized.length <= maxLength) return normalized;
        return `${normalized.slice(0, maxLength - 3)}...`;
    }

    function formatTimestamp(timestamp) {
        if (!timestamp) return 'unknown';
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return 'unknown';
        return date.toISOString();
    }

    function coerceTextValue(value) {
        if (typeof value === 'string') {
            return value;
        }

        if (value == null) {
            return '';
        }

        const extracted = window.Blocks?.extractResponseText?.(value);
        if (typeof extracted === 'string' && extracted) {
            return extracted;
        }

        if (typeof value === 'object') {
            if (typeof value.text === 'string') return value.text;
            if (typeof value.content === 'string') return value.content;
            if (typeof value.message === 'string') return value.message;
            if (typeof value.prompt === 'string') return value.prompt;
        }

        return String(value);
    }

    function extractBlockTextValue(block) {
        if (!block) return '';

        const content = block.content;
        if (typeof content === 'string') {
            return content;
        }

        if (!content || typeof content !== 'object') {
            return '';
        }

        switch (block.type) {
            case 'todo': {
                const checked = content.checked ? '[x]' : '[ ]';
                return `${checked} ${content.text || ''}`.trim();
            }
            case 'callout':
                return `${content.icon || block.icon || '!'} ${content.text || ''}`.trim();
            case 'code':
                return content.text || '';
            case 'mermaid':
                return content.text ? `Mermaid ${content.diagramType || 'diagram'}: ${content.text}` : '';
            case 'ai': {
                const parts = [];
                if (content.prompt) parts.push(`Prompt: ${content.prompt}`);
                if (content.result) parts.push(`Result: ${content.result}`);
                return parts.join('\n');
            }
            case 'image':
                return content.caption || content.alt || content.url || 'Image block';
            case 'ai_image': {
                const source = content.source === 'unsplash' ? 'Unsplash' : 'AI image';
                const details = [
                    content.prompt || '',
                    content.unsplashPhotographer ? `photo by ${content.unsplashPhotographer}` : '',
                    content.imageUrl || ''
                ].filter(Boolean);
                return details.length ? `${source}: ${details.join(' | ')}` : source;
            }
            case 'bookmark':
                return content.title || content.description || content.url || 'Bookmark block';
            case 'database': {
                const columns = Array.isArray(content.columns) ? content.columns.length : 0;
                const rows = Array.isArray(content.rows) ? content.rows.length : 0;
                const columnList = Array.isArray(content.columns) ? content.columns.join(', ') : '';
                return columnList
                    ? `Database with ${columns} columns (${columnList}) and ${rows} rows`
                    : `Database with ${columns} columns and ${rows} rows`;
            }
            case 'math':
                return content.text || content.latex || '';
            default:
                return content.text ||
                    content.prompt ||
                    content.result ||
                    content.url ||
                    content.caption ||
                    '';
        }
    }

    function buildPageContentSnapshot(pageContext) {
        if (!pageContext?.blocks?.length) {
            return '(page is empty)';
        }

        return pageContext.blocks.map((block) => {
            const indent = '  '.repeat(block.depth);
            const styleParts = [];
            if (block.color) styleParts.push(`bg:${block.color}`);
            if (block.textColor) styleParts.push(`text:${block.textColor}`);
            const styleSuffix = styleParts.length ? ` {${styleParts.join(', ')}}` : '';
            const prefix = `${indent}- [${block.id}] ${block.type}${styleSuffix}`;
            const preview = truncateText(block.content, 220);
            return preview ? `${prefix}: ${preview}` : prefix;
        }).join('\n');
    }

    function getSelectionSnapshot(pageContext) {
        const selectedBlockId = window.Selection?.getSelectedBlockId?.() || null;
        const selectedText = truncateText(window.Selection?.getSelectedText?.() || '', 300);

        if (!selectedBlockId && !selectedText) {
            return {
                selectedBlockSummary: 'No block is selected.',
                selectedText: ''
            };
        }

        const selectedBlock = pageContext?.blocks?.find((block) => block.id === selectedBlockId) || null;
        const selectedBlockStyle = selectedBlock
            ? [
                selectedBlock.color ? `bg:${selectedBlock.color}` : '',
                selectedBlock.textColor ? `text:${selectedBlock.textColor}` : ''
            ].filter(Boolean).join(', ')
            : '';
        const selectedBlockSummary = selectedBlock
            ? `[${selectedBlock.id}] ${selectedBlock.type}${selectedBlockStyle ? ` {${selectedBlockStyle}}` : ''}: ${truncateText(selectedBlock.content, 220)}`
            : (selectedBlockId ? `Selected block id: ${selectedBlockId}` : 'No block is selected.');

        return {
            selectedBlockSummary,
            selectedText
        };
    }

    function buildPageSetupSummary(pageContext) {
        if (!pageContext) {
            return 'No page is currently loaded.';
        }

        const selection = getSelectionSnapshot(pageContext);
        const properties = Array.isArray(pageContext.properties) ? pageContext.properties.length : 0;
        const outlineItems = pageContext.outline?.length || 0;
        const setupLines = [
            `Page title: ${pageContext.title || 'Untitled'}`,
            `Page id: ${pageContext.pageId || 'unknown'}`,
            `Block count: ${pageContext.blockCount}`,
            `Word count: ${pageContext.wordCount}`,
            `Reading time: ${pageContext.readingTime} min`,
            `Default model: ${pageContext.defaultModel || state.selectedModel}`,
            `Outline headings: ${outlineItems}`,
            `Properties: ${properties}`,
            `Last updated: ${formatTimestamp(pageContext.lastUpdated)}`,
            `Selection: ${selection.selectedBlockSummary}`,
            `Supported text colors: default, ${NOTES_COLOR_OPTIONS.join(', ')}`,
            `Supported block background colors: default, ${NOTES_COLOR_OPTIONS.join(', ')}`,
        ];

        if (selection.selectedText) {
            setupLines.push(`Selected text: ${selection.selectedText}`);
        }

        return setupLines.join('\n');
    }

    // Build system prompt with page context
    function buildSystemPrompt(pageContext) {
        const pageSetup = buildPageSetupSummary(pageContext);
        const blockMap = buildPageContentSnapshot(pageContext);
        const pageContent = (getFullPageContent() || '').slice(0, 6000);
        const outline = pageContext?.outline?.length
            ? pageContext.outline.map((heading) => `- [${heading.id}] ${heading.content}`).join('\n')
            : '- No headings yet';

        return `You are an AI assistant editing a Lilly-style block-based document.

CURRENT PAGE: "${pageContext?.title || 'Untitled'}"

PAGE STRUCTURE:
The document is organized into blocks. Each block has a unique ID shown in brackets like [block_abc123].
Reference blocks by their ID when editing or inserting content.

BLOCKS IN THIS PAGE:
${blockMap || '(page is empty)'}

OUTLINE (Headings):
${outline}

PAGE STATS:
${pageSetup}

AVAILABLE ACTIONS - Respond with JSON:
When the user asks you to edit, create, delete, or reorganize content, respond with a JSON action block like this:

\`\`\`notes-actions
{
  "assistant_reply": "Brief, friendly explanation of what I did",
  "actions": [
    { "op": "update_page", "title": "Middle East Overnight Brief", "icon": "🌍" },
    { "op": "update_block", "blockId": "block_abc123", "type": "text", "content": "New content here" },
    { "op": "insert_after", "blockId": "block_abc123", "blocks": [{ "type": "heading_2", "content": "New Section" }] },
    { "op": "delete_block", "blockId": "block_def456" },
    { "op": "append_to_page", "blocks": [{ "type": "text", "content": "Added at end" }] }
  ]
}
\`\`\`

VALID OPERATIONS:
- update_page: Update page-level metadata like title, icon, cover, properties, or page default model
- update_block: Change content of existing block (requires blockId, type, content)
- replace_block: Replace block with new block(s) (requires blockId, blocks array)
- insert_after: Add new block(s) after specified block (requires blockId, blocks array)
- insert_before: Add new block(s) before specified block (requires blockId, blocks array)
- append_to_page: Add block(s) at end of page (requires blocks array)
- prepend_to_page: Add block(s) at start of page (requires blocks array)
- delete_block: Remove a block (requires blockId)

BLOCK TYPES:
- text: Plain text paragraph
- heading_1, heading_2, heading_3: Section headings
- bulleted_list: Bullet points
- numbered_list: Numbered items
- todo: Checkbox item (content: {text: "...", checked: false})
- code: Code block (content: {language: "javascript", text: "..."})
- quote: Blockquote
- callout: Highlighted info box (content: {text: "...", icon: "💡"})
- divider: Horizontal line
- mermaid: Mermaid diagram (content: {text: "...", diagramType: "flowchart"})
- image: Image (content: {url: "...", caption: "..."})
- bookmark: Link bookmark (content: {url: "...", title: "..."})

GUIDELINES:
- Always reference blocks by their exact ID in [brackets]
- assistant_reply should be brief and user-friendly (not mention the JSON actions)
- The editor will automatically apply your actions and show the assistant_reply to the user
- In this notes interface, "page" means the current notes document unless the user explicitly says web page, site page, route, component, repo file, or server page.
- If the user says "put this on the page", "add this to the page", "insert this into the page", or similar, treat that as a request to edit the current notes page using notes-actions, not a request to inspect a remote server or codebase.
- Use \`\`\`notes-actions only when the user is actually asking to edit, create, delete, reorganize, or restyle page content.
- If the user is asking for remote execution, SSH work, cluster setup, deployment, debugging, research, or other non-page tasks, answer normally and use the available backend tools instead of forcing a notes-actions JSON response.
- For multi-step non-page work, continue the task with the best next concrete step and use verified prior tool results and session state before asking the user to repeat details.
- If SSH access or a prior SSH target is already established in the session, do not ask for host/user details again unless a tool failure shows the target is missing or incorrect.
- For substantial page-writing requests such as briefs, reports, specs, plans, guides, proposals, or polished notes pages, work in passes: decide the sections first, then expand each section, then polish the full page before returning the final answer or notes-actions block.
- When building a full page, prefer a clear structure with headings first and then supporting blocks under each heading instead of one long undifferentiated dump.
- For text-like blocks, use plain strings for content
- For special blocks (todo, code, mermaid, image, bookmark), use structured objects
- Do not invent block IDs - only use IDs that exist in the page
- Keep assistant_reply concise unless user asks for detailed explanation
- If generating Mermaid diagrams, include clean diagram code in a \`\`\`mermaid block
- Additional supported blocks and capabilities:
  - toggle: expand/collapse section with plain string content
  - math: equation block using {text, displayMode}
  - ai_image: use {prompt, source: "ai"|"unsplash", imageUrl, model, size, quality, style}
  - database: use {columns, rows, sortColumn, sortDirection}
  - ai: inline AI block using {prompt, result, model}
- For callout blocks, use structured content like {text: "...", icon: "💡"}.
- Use image for known image URLs or uploaded/static images.
- Use ai_image with source: "ai" for generated illustrations, posters, covers, concept art, mockups, and diagrams.
- Use ai_image with source: "unsplash" for real photography, mood boards, people, offices, products, and reference imagery.
- You may optionally add "color" and "textColor" to any inserted/replaced block using: ${NOTES_COLOR_OPTIONS.join(', ')}.
- Use styling intentionally for hierarchy and variety, for example yellow or blue callouts, gray supporting notes, red warnings, and green status summaries.
- For structured blocks (todo, callout, code, math, mermaid, image, ai_image, bookmark, database, ai), use structured objects rather than plain strings.
- When the user asks for a redesign, dashboard, brief, report, or polished layout, consider updating the page title/icon/cover with update_page in addition to the blocks.
- If the user asks for color or visual design, explicitly consider both block background colors ("color") and text colors ("textColor") where they improve readability.
- When improving layout or variety, prefer mixing headings, callouts, quotes, lists, databases, images, dividers, and tasteful color/textColor choices instead of only plain paragraphs`;
    }

    function unwrapCodeFence(text = '') {
        const trimmed = String(text || '').trim();
        const match = trimmed.match(/^```(?:json|notes-actions)?\s*([\s\S]*?)\s*```$/i);
        return match ? match[1].trim() : trimmed;
    }

    function safeJsonParse(text = '') {
        try {
            return JSON.parse(unwrapCodeFence(text));
        } catch (_error) {
            return null;
        }
    }

    function shouldUseMultiPassNotesDraft(question = '', context = null, requestOptions = {}) {
        if (requestOptions?.outputFormat) {
            return false;
        }

        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized || normalized.length < 40) {
            return false;
        }

        if (/\b(ssh|remote|server|cluster|k8s|kubernetes|kubectl|deploy|deployment|docker|traefik|let'?s encrypt|acme|cert-manager|research|search the web|browse|scrape|tool)\b/.test(normalized)) {
            return false;
        }

        const writingVerb = /\b(create|make|build|draft|write|expand|organize|polish|rewrite|turn|convert|structure|format)\b/.test(normalized);
        const substantialTarget = /\b(page|document|report|brief|spec|proposal|plan|guide|memo|summary|notes|runbook|dashboard|playbook)\b/.test(normalized);
        const pageHasEnoughSurface = (context?.blockCount || 0) > 3 || (context?.outline?.length || 0) > 1;

        return writingVerb && (substantialTarget || pageHasEnoughSurface);
    }

    function isExplicitPageEditIntent(question = '') {
        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return [
            /\b(put|add|insert|place|append|prepend|move|drop|apply|write|turn|convert|use|set)\b[\s\S]{0,40}\b(on|into|to|in)\b[\s\S]{0,20}\b(page|note|document|doc)\b/,
            /\b(edit|update|rewrite|reformat|reorganize|restyle|clean up|fix)\b[\s\S]{0,40}\b(page|note|document|doc)\b/,
            /\b(current page|this page|the page|this note|the note)\b/,
        ].some((pattern) => pattern.test(normalized));
    }

    function looksLikeShortAcknowledgement(text = '') {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return true;
        }

        if (normalized.length > 180) {
            return false;
        }

        const acknowledgementStart = /^(sure|yes|okay|ok|done|absolutely|certainly|yep|yeah|i('|’)ll|i can|i have|i did)\b/i.test(normalized);
        const placementIntent = /\b(place|put|add|insert|apply|placed|added|inserted|applied)\b[\s\S]{0,30}\b(page|note|document)\b/i.test(normalized);
        const pageReference = /\b(on|into|to|in)\s+(the\s+)?(page|note|document)\b/i.test(normalized);

        return (acknowledgementStart && pageReference) || placementIntent;
    }

    function getLastSubstantialAssistantMessage(excludeText = '') {
        syncConversationWithCurrentPage({ emitEvent: false });
        const excluded = String(excludeText || '').trim();

        for (let index = state.messages.length - 1; index >= 0; index -= 1) {
            const message = state.messages[index];
            if (!message || message.role !== 'assistant' || message.hidden || message.transient) {
                continue;
            }

            const content = String(message.content || '').trim();
            if (!content || content === excluded) {
                continue;
            }

            if (message.appliedCount > 0 || /^Applied \d+ page change/i.test(content)) {
                continue;
            }

            if (content.length < 160 && looksLikeShortAcknowledgement(content)) {
                continue;
            }

            return content;
        }

        return '';
    }

    function getPageRootBlocks() {
        const page = window.Editor?.getCurrentPage?.();
        return Array.isArray(page?.blocks) ? page.blocks : [];
    }

    function pageHasOnlyPlaceholderContent() {
        const blocks = getPageRootBlocks();
        if (blocks.length === 0) {
            return true;
        }

        if (blocks.length !== 1) {
            return false;
        }

        const [block] = blocks;
        const text = extractBlockTextValue(block).trim();
        return ['text', 'heading_1', 'heading_2', 'heading_3'].includes(block?.type) && !text;
    }

    function isStructuralTextBoundary(line = '') {
        const normalized = String(line || '').trim();
        if (!normalized) return true;

        return /^#{1,3}\s+/.test(normalized) ||
            /^>\s+/.test(normalized) ||
            /^[-*]\s+/.test(normalized) ||
            /^\d+\.\s+/.test(normalized) ||
            /^\[![a-z_ -]+\]$/i.test(normalized) ||
            /^!\s*\S+/.test(normalized) ||
            /^```/.test(normalized) ||
            /^---+$/.test(normalized);
    }

    function inferHeadingLevel(line = '', isFirstHeading = false) {
        const normalized = String(line || '').trim();
        if (!normalized) {
            return null;
        }

        if (/^#{1,3}\s+/.test(normalized)) {
            const level = normalized.match(/^#+/)[0].length;
            return `heading_${Math.min(level, 3)}`;
        }

        if (normalized.length > 90) {
            return null;
        }

        if (/[.:;!?]$/.test(normalized)) {
            return null;
        }

        if (normalized.split(/\s+/).length > 8) {
            return null;
        }

        if (isFirstHeading) {
            return 'heading_1';
        }

        return /^(summary|overview|background|market position|what the company does|core solution areas|business strengths|strategic direction|bottom line|sources)$/i.test(normalized)
            ? 'heading_2'
            : null;
    }

    function getCalloutIconForMarker(marker = '') {
        const normalized = String(marker || '').trim().toLowerCase();
        return {
            summary: '!',
            info: 'i',
            important: '!!',
            tip: '+',
            warning: '!',
            note: '*',
            callout: '!'
        }[normalized] || '!';
    }

    function buildBlocksFromRichText(sourceText = '') {
        const text = String(sourceText || '').replace(/\r\n/g, '\n').trim();
        if (!text) {
            return [];
        }

        const blocks = [];
        const lines = text.split('\n');
        let index = 0;
        let usedTitle = false;

        while (index < lines.length) {
            const rawLine = lines[index];
            const line = rawLine.trim();

            if (!line) {
                index += 1;
                continue;
            }

            if (/^```/.test(line)) {
                const language = line.slice(3).trim() || 'plain';
                const codeLines = [];
                index += 1;
                while (index < lines.length && !/^```/.test(lines[index].trim())) {
                    codeLines.push(lines[index]);
                    index += 1;
                }
                if (index < lines.length) {
                    index += 1;
                }
                blocks.push({
                    type: 'code',
                    content: {
                        language,
                        text: codeLines.join('\n')
                    }
                });
                continue;
            }

            const calloutMatch = line.match(/^\[!([a-z_ -]+)\]$/i);
            if (calloutMatch) {
                const calloutLines = [];
                index += 1;
                while (index < lines.length) {
                    const nextLine = lines[index].trim();
                    if (!nextLine) {
                        if (calloutLines.length > 0) break;
                        index += 1;
                        continue;
                    }
                    if (isStructuralTextBoundary(nextLine)) {
                        break;
                    }
                    calloutLines.push(nextLine);
                    index += 1;
                }
                blocks.push({
                    type: 'callout',
                    content: {
                        text: calloutLines.join(' ').trim() || calloutMatch[1],
                        icon: getCalloutIconForMarker(calloutMatch[1])
                    }
                });
                continue;
            }

            const imagePromptMatch = line.match(/^!\s*(.+)$/);
            if (imagePromptMatch && !/^!\[/.test(line)) {
                blocks.push({
                    type: 'ai_image',
                    content: {
                        prompt: imagePromptMatch[1].trim(),
                        caption: '',
                        imageUrl: null,
                        model: null,
                        size: '1536x1024',
                        quality: 'standard',
                        style: 'natural',
                        source: 'unsplash',
                        status: 'pending',
                        unsplashResults: null,
                        selectedUnsplashId: null,
                        unsplashPhotographer: null,
                        unsplashPhotographerUrl: null,
                        imageAssetId: null
                    }
                });
                index += 1;
                continue;
            }

            if (/^---+$/.test(line)) {
                blocks.push({ type: 'divider', content: '' });
                index += 1;
                continue;
            }

            const headingLevel = inferHeadingLevel(line, !usedTitle);
            const nextLine = lines[index + 1]?.trim() || '';
            if (headingLevel && (!nextLine || !/^[a-z]/.test(nextLine))) {
                blocks.push({
                    type: headingLevel,
                    content: line.replace(/^#{1,3}\s+/, '').trim()
                });
                usedTitle = true;
                index += 1;
                continue;
            }

            if (/^>\s+/.test(line)) {
                blocks.push({
                    type: 'quote',
                    content: line.replace(/^>\s+/, '').trim()
                });
                index += 1;
                continue;
            }

            if (/^[-*]\s+/.test(line)) {
                while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
                    blocks.push({
                        type: 'bulleted_list',
                        content: lines[index].trim().replace(/^[-*]\s+/, '')
                    });
                    index += 1;
                }
                continue;
            }

            if (/^\d+\.\s+/.test(line)) {
                while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
                    blocks.push({
                        type: 'numbered_list',
                        content: lines[index].trim().replace(/^\d+\.\s+/, '')
                    });
                    index += 1;
                }
                continue;
            }

            const paragraphLines = [line];
            index += 1;
            while (index < lines.length) {
                const next = lines[index].trim();
                if (!next || isStructuralTextBoundary(next) || inferHeadingLevel(next, false)) {
                    break;
                }
                paragraphLines.push(next);
                index += 1;
            }

            blocks.push({
                type: 'text',
                content: paragraphLines.join(' ').trim()
            });
        }

        return blocks.filter((block) => {
            if (!block || !block.type) return false;
            if (typeof block.content === 'string') return block.content.trim().length > 0 || block.type === 'divider';
            if (block.type === 'callout') return Boolean(block.content?.text);
            if (block.type === 'code') return Boolean(block.content?.text);
            if (block.type === 'ai_image') return Boolean(block.content?.prompt);
            return true;
        });
    }

    function buildFallbackNotesActionsFromText(sourceText = '') {
        const importedPage = window.ImportExport?.importFromMarkdown?.(sourceText);
        const importedBlocks = Array.isArray(importedPage?.blocks)
            ? importedPage.blocks.filter((block) => extractBlockTextValue(block).trim() || ['divider', 'image', 'ai_image'].includes(block.type))
            : [];
        const richTextBlocks = buildBlocksFromRichText(sourceText);
        const blocks = richTextBlocks.length >= importedBlocks.length ? richTextBlocks : importedBlocks;

        if (!blocks.length) {
            return null;
        }

        const actions = [];
        const importedTitle = String(importedPage?.title || '').trim();
        const currentPage = window.Editor?.getCurrentPage?.();
        const currentTitle = String(currentPage?.title || '').trim();

        if (importedTitle && (!currentTitle || /^untitled$/i.test(currentTitle))) {
            actions.push({
                op: 'update_page',
                title: importedTitle
            });
        }

        if (pageHasOnlyPlaceholderContent()) {
            const firstBlockId = getPageRootBlocks()[0]?.id || null;
            if (firstBlockId) {
                actions.push({
                    op: 'replace_block',
                    blockId: firstBlockId,
                    blocks
                });
            } else {
                actions.push({
                    op: 'append_to_page',
                    blocks
                });
            }
        } else {
            actions.push({
                op: 'append_to_page',
                blocks
            });
        }

        return actions;
    }

    function buildFallbackPageEditResponse(question = '', responseText = '') {
        const directResponse = String(responseText || '').trim();
        const preferredSource = directResponse && !looksLikeShortAcknowledgement(directResponse)
            ? directResponse
            : getLastSubstantialAssistantMessage(directResponse);
        const actions = buildFallbackNotesActionsFromText(preferredSource);

        if (!actions || actions.length === 0) {
            return null;
        }

        return {
            displayText: /blank page|place it on|put it on|add it to|insert it into/i.test(String(question || '').toLowerCase())
                ? 'Placed that on the page.'
                : 'Added that to the page.',
            appliedCount: applyNotesActions(actions).appliedCount
        };
    }

    function normalizeHiddenDraftResult(text = '', fallback = null) {
        const parsed = safeJsonParse(text);
        if (parsed) {
            return JSON.stringify(parsed, null, 2);
        }

        const normalized = unwrapCodeFence(text);
        if (normalized) {
            return normalized.slice(0, 6000);
        }

        return fallback;
    }

    async function buildMultiPassNotesMessages({
        apiClient,
        model,
        systemPrompt,
        question,
        requestOptions = {},
    }) {
        const planningClient = typeof NotesAPIClient !== 'undefined'
            ? new NotesAPIClient()
            : apiClient;

        const planningPrompt = `${systemPrompt}

Hidden planning pass for a substantial notes-writing request.
Do not return notes-actions in this pass.
Return JSON only in this shape:
{
  "title": "Page title",
  "sections": [
    {
      "heading": "Section heading",
      "goal": "Why this section exists",
      "blockTypes": ["heading_2", "text", "bulleted_list"],
      "keyPoints": ["Point 1", "Point 2"]
    }
  ]
}`;

        const planningResponse = await planningClient.chat([
            { role: 'system', content: planningPrompt },
            { role: 'user', content: question }
        ], model, requestOptions);

        if (planningResponse?.error) {
            throw new Error(planningResponse.content || 'Planning pass failed');
        }

        const normalizedPlan = normalizeHiddenDraftResult(planningResponse.content, null);
        if (!normalizedPlan) {
            return null;
        }

        const expansionPrompt = `${systemPrompt}

Hidden section-expansion pass for a substantial notes-writing request.
Do not return notes-actions in this pass.
You will receive the original request plus the approved page plan.
Return JSON only in this shape:
{
  "title": "Page title",
  "sections": [
    {
      "heading": "Section heading",
      "summary": "Detailed summary of what this section should say",
      "suggestedBlocks": [
        { "type": "heading_2", "content": "Section heading" },
        { "type": "text", "content": "Opening paragraph guidance" }
      ]
    }
  ]
}`;

        const expansionResponse = await planningClient.chat([
            { role: 'system', content: expansionPrompt },
            {
                role: 'user',
                content: `Original request:\n${question}\n\nApproved page plan:\n${normalizedPlan}`
            }
        ], model, requestOptions);

        if (expansionResponse?.error) {
            throw new Error(expansionResponse.content || 'Expansion pass failed');
        }

        const normalizedExpansion = normalizeHiddenDraftResult(expansionResponse.content, normalizedPlan);
        if (!normalizedExpansion) {
            return null;
        }

        return [
            {
                role: 'system',
                content: `${systemPrompt}

Use the hidden planning work below as internal guidance.
For this final pass, return the finished answer only.
If the user is editing the page, return notes-actions as needed.`
            },
            {
                role: 'user',
                content: `${question}

Use this approved page plan:
${normalizedPlan}

Use these expanded section briefs:
${normalizedExpansion}

Build the page in a structured, polished way instead of one-shotting the whole document.`
            }
        ];
    }

    function normalizeActionContent(type, content) {
        const value = content == null ? '' : content;

        switch (type) {
            case 'todo':
                if (value && typeof value === 'object') {
                    return {
                        text: String(value.text || ''),
                        checked: Boolean(value.checked)
                    };
                }
                return { text: String(value || ''), checked: false };
            case 'callout':
                if (value && typeof value === 'object') {
                    return {
                        text: coerceTextValue(
                            Object.prototype.hasOwnProperty.call(value, 'text')
                                ? value.text
                                : value.content ?? value.message ?? value
                        ),
                        icon: String(value.icon || '!')
                    };
                }
                return { text: coerceTextValue(value), icon: '!' };
            case 'code':
                if (value && typeof value === 'object') {
                    return {
                        language: value.language || 'plain',
                        text: String(value.text || '')
                    };
                }
                return { language: 'plain', text: String(value || '') };
            case 'math':
                if (value && typeof value === 'object') {
                    return {
                        text: String(value.text || value.latex || ''),
                        displayMode: value.displayMode !== false
                    };
                }
                return { text: String(value || ''), displayMode: true };
            case 'mermaid':
                if (value && typeof value === 'object') {
                    return {
                        text: String(value.text || ''),
                        diagramType: value.diagramType || 'flowchart',
                        _showEditor: false
                    };
                }
                return {
                    text: String(value || ''),
                    diagramType: 'flowchart',
                    _showEditor: false
                };
            case 'ai':
                if (value && typeof value === 'object') {
                    return {
                        prompt: String(value.prompt || ''),
                        result: value.result || null,
                        model: value.model || null
                    };
                }
                return { prompt: String(value || ''), result: null, model: null };
            case 'image':
                if (value && typeof value === 'object') {
                    return {
                        url: String(value.url || ''),
                        caption: coerceTextValue(value.caption || value.text || '')
                    };
                }
                return /^https?:\/\//i.test(String(value).trim())
                    ? { url: String(value).trim(), caption: '' }
                    : { url: '', caption: coerceTextValue(value) };
            case 'ai_image':
                if (value && typeof value === 'object') {
                    const hasSearchResults = Array.isArray(value.unsplashResults) && value.unsplashResults.length > 0;
                    const hasImage = Boolean(value.imageUrl || value.url || value.imageAssetId);
                    return {
                        prompt: coerceTextValue(value.prompt || value.text || value.description || ''),
                        caption: coerceTextValue(value.caption || ''),
                        imageUrl: value.imageUrl || value.url || null,
                        model: value.model || null,
                        size: value.size || '1024x1024',
                        quality: value.quality || 'standard',
                        style: value.style || 'vivid',
                        source: value.source === 'unsplash' ? 'unsplash' : 'ai',
                        status: value.status || (hasSearchResults ? 'search_results' : (hasImage ? 'done' : 'pending')),
                        unsplashResults: hasSearchResults ? value.unsplashResults : null,
                        selectedUnsplashId: value.selectedUnsplashId || null,
                        unsplashPhotographer: value.unsplashPhotographer || null,
                        unsplashPhotographerUrl: value.unsplashPhotographerUrl || null,
                        imageAssetId: value.imageAssetId || null
                    };
                }
                return {
                    prompt: coerceTextValue(value),
                    caption: '',
                    imageUrl: null,
                    model: null,
                    size: '1024x1024',
                    quality: 'standard',
                    style: 'vivid',
                    source: 'ai',
                    status: 'pending',
                    unsplashResults: null,
                    selectedUnsplashId: null,
                    unsplashPhotographer: null,
                    unsplashPhotographerUrl: null,
                    imageAssetId: null
                };
            case 'bookmark':
                if (value && typeof value === 'object') {
                    return {
                        url: String(value.url || ''),
                        title: String(value.title || ''),
                        description: String(value.description || ''),
                        favicon: String(value.favicon || ''),
                        image: String(value.image || '')
                    };
                }
                return {
                    url: String(value || ''),
                    title: '',
                    description: '',
                    favicon: '',
                    image: ''
                };
            case 'database':
                if (value && typeof value === 'object' && (Array.isArray(value.columns) || Array.isArray(value.rows))) {
                    return {
                        columns: Array.isArray(value.columns) ? value.columns : ['Name', 'Status', 'Notes'],
                        rows: Array.isArray(value.rows) ? value.rows : [],
                        sortColumn: value.sortColumn || null,
                        sortDirection: value.sortDirection || 'asc'
                    };
                }
                return {
                    columns: ['Name', 'Status', 'Notes'],
                    rows: String(value || '').trim() ? [[String(value).trim(), '', '']] : [['', '', '']],
                    sortColumn: null,
                    sortDirection: 'asc'
                };
            case 'divider':
                return '';
            default:
                return typeof value === 'string' ? value : String(value || '');
        }
    }

    function canonicalizeBlockType(type) {
        const normalized = String(type || 'text').trim().toLowerCase();
        const aliases = {
            paragraph: 'text',
            p: 'text',
            h1: 'heading_1',
            heading1: 'heading_1',
            'heading-1': 'heading_1',
            h2: 'heading_2',
            heading2: 'heading_2',
            'heading-2': 'heading_2',
            h3: 'heading_3',
            heading3: 'heading_3',
            'heading-3': 'heading_3',
            bullet: 'bulleted_list',
            bullets: 'bulleted_list',
            bullet_list: 'bulleted_list',
            'bullet-list': 'bulleted_list',
            bulletedlist: 'bulleted_list',
            togglelist: 'toggle',
            collapsible: 'toggle',
            numberedlist: 'numbered_list',
            number_list: 'numbered_list',
            numberlist: 'numbered_list',
            'number-list': 'numbered_list',
            checklist: 'todo',
            to_do: 'todo',
            todo: 'todo',
            calloutbox: 'callout',
            equation: 'math',
            formula: 'math',
            diagram: 'mermaid',
            aiimage: 'ai_image',
            'ai-image': 'ai_image',
            image_generation: 'ai_image',
            imagegeneration: 'ai_image',
            table: 'database'
        };

        return aliases[normalized] || normalized || 'text';
    }

    function normalizeActionBlock(blockDefinition, options = {}) {
        const defaultType = options.defaultType || 'text';
        const definition = typeof blockDefinition === 'string'
            ? { type: defaultType, content: blockDefinition }
            : (blockDefinition || {});
        const type = canonicalizeBlockType(definition.type || defaultType);
        let contentInput = Object.prototype.hasOwnProperty.call(definition, 'content')
            ? definition.content
            : (Object.prototype.hasOwnProperty.call(definition, 'text') ? definition.text : '');

        if (!Object.prototype.hasOwnProperty.call(definition, 'content') && definition && typeof definition === 'object') {
            switch (type) {
                case 'callout':
                    contentInput = {
                        text: Object.prototype.hasOwnProperty.call(definition, 'text') ? definition.text : '',
                        icon: definition.icon
                    };
                    break;
                case 'image':
                    contentInput = {
                        url: definition.url || '',
                        caption: definition.caption || definition.text || ''
                    };
                    break;
                case 'ai_image':
                    contentInput = {
                        prompt: definition.prompt || definition.text || '',
                        caption: definition.caption || '',
                        imageUrl: definition.imageUrl || definition.url || null,
                        model: definition.model || null,
                        size: definition.size || '1024x1024',
                        quality: definition.quality || 'standard',
                        style: definition.style || 'vivid',
                        source: definition.source || 'ai',
                        status: definition.status,
                        unsplashResults: definition.unsplashResults || null,
                        selectedUnsplashId: definition.selectedUnsplashId || null,
                        unsplashPhotographer: definition.unsplashPhotographer || null,
                        unsplashPhotographerUrl: definition.unsplashPhotographerUrl || null,
                        imageAssetId: definition.imageAssetId || null
                    };
                    break;
                case 'bookmark':
                    contentInput = {
                        url: definition.url || '',
                        title: definition.title || '',
                        description: definition.description || definition.text || '',
                        favicon: definition.favicon || '',
                        image: definition.image || ''
                    };
                    break;
                case 'database':
                    contentInput = {
                        columns: definition.columns,
                        rows: definition.rows,
                        sortColumn: definition.sortColumn,
                        sortDirection: definition.sortDirection
                    };
                    break;
                default:
                    break;
            }
        }

        const block = Blocks.createBlock(type, normalizeActionContent(type, contentInput), {
            children: [],
            formatting: definition.formatting || {},
            color: definition.color || null,
            textColor: definition.textColor || null,
            expanded: definition.expanded,
            icon: definition.icon
        });

        if (definition.id) {
            block.id = definition.id;
        }

        if (Array.isArray(definition.children) && definition.children.length > 0) {
            block.children = definition.children.map((child) => normalizeActionBlock(child));
        }

        return block;
    }

    function tryParseNotesActionPayload(payloadText) {
        if (!payloadText) return null;

        try {
            const payload = JSON.parse(payloadText);
            if (payload && typeof payload === 'object' && Array.isArray(payload.actions)) {
                return {
                    displayText: String(payload.assistant_reply || '').trim(),
                    actions: payload.actions
                };
            }
        } catch (error) {
            return null;
        }

        return null;
    }

    function isNotesBlockDefinition(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }

        return typeof value.type === 'string' &&
            Object.prototype.hasOwnProperty.call(value, 'content');
    }

    function detectMermaidDiagramType(text) {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) return 'flowchart';
        if (normalized.startsWith('sequencediagram')) return 'sequence';
        if (normalized.startsWith('classdiagram')) return 'class';
        if (normalized.startsWith('statediagram')) return 'state';
        if (normalized.startsWith('erdiagram')) return 'er';
        if (normalized.startsWith('gantt')) return 'gantt';
        if (normalized.startsWith('pie')) return 'pie';
        if (normalized.startsWith('mindmap')) return 'mindmap';
        if (normalized.startsWith('gitgraph')) return 'gitgraph';
        return 'flowchart';
    }

    const MERMAID_DIAGRAM_START_PATTERN = /^(flowchart|graph|sequencediagram|classdiagram|statediagram(?:-v2)?|erdiagram|gantt|pie|mindmap|gitgraph)\b/i;

    function normalizeMermaidSourceText(text) {
        let value = String(text || '').trim();
        if (!value) return '';

        const fencedMatch = value.match(/```mermaid\s*([\s\S]*?)```/i);
        if (fencedMatch?.[1]) {
            value = fencedMatch[1].trim();
        } else {
            value = value
                .replace(/^```mermaid\s*/i, '')
                .replace(/```$/, '')
                .trim();
        }

        return value
            .replace(/^[\s"'`]+/, '')
            .replace(/[\s"',}]+$/, '')
            .replace(/^mermaid(?:\\r\\n|\\n|\r?\n)+/i, '')
            .replace(/\\r\\n/g, '\n')
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .trim();
    }

    function looksLikeMermaidSource(text) {
        return MERMAID_DIAGRAM_START_PATTERN.test(normalizeMermaidSourceText(text));
    }

    function startsWithMermaidResponse(text) {
        const value = String(text || '').trim();
        if (!value) return false;

        return /^```mermaid\b/i.test(value) ||
            /^["'`]*mermaid(?:\\r\\n|\\n|\r?\n)+/i.test(value) ||
            looksLikeMermaidSource(value);
    }

    function extractLeadingMermaidBlock(text, stopIndex = null) {
        const source = String(text || '');
        const slice = source.slice(0, stopIndex == null ? source.length : stopIndex).trim();
        if (!slice) return null;

        const decoded = normalizeMermaidSourceText(slice);

        if (!decoded) return null;
        if (!MERMAID_DIAGRAM_START_PATTERN.test(decoded)) {
            return null;
        }

        return {
            type: 'mermaid',
            content: {
                text: decoded,
                diagramType: detectMermaidDiagramType(decoded),
            },
        };
    }

    function extractBlockFragmentActions(text) {
        const source = String(text || '');
        const blockMatches = [];

        for (let start = 0; start < source.length; start++) {
            if (source[start] !== '{') continue;

            let depth = 0;
            let inString = false;
            let isEscaped = false;

            for (let index = start; index < source.length; index++) {
                const char = source[index];

                if (inString) {
                    if (isEscaped) {
                        isEscaped = false;
                    } else if (char === '\\') {
                        isEscaped = true;
                    } else if (char === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (char === '"') {
                    inString = true;
                    continue;
                }

                if (char === '{') {
                    depth += 1;
                    continue;
                }

                if (char === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        const candidate = source.slice(start, index + 1);
                        try {
                            const parsed = JSON.parse(candidate);
                            if (isNotesBlockDefinition(parsed)) {
                                blockMatches.push({ parsed, start, end: index + 1 });
                            }
                        } catch (error) {
                            // Ignore malformed candidates and continue scanning.
                        }
                        break;
                    }
                }
            }
        }

        const recoveredBlocks = [];
        if (blockMatches.length > 0) {
            const leadingMermaid = extractLeadingMermaidBlock(source, blockMatches[0].start);
            if (leadingMermaid) {
                recoveredBlocks.push(leadingMermaid);
            }

            let previousEnd = blockMatches[0].start;
            blockMatches.forEach((match, index) => {
                const separator = source.slice(index === 0 ? blockMatches[0].start : previousEnd, match.start);
                if (index > 0 && /[^\s,\]\[]/.test(separator)) {
                    return;
                }

                recoveredBlocks.push(match.parsed);
                previousEnd = match.end;
            });
        } else {
            const mermaidOnly = extractLeadingMermaidBlock(source);
            if (mermaidOnly) {
                recoveredBlocks.push(mermaidOnly);
            }
        }

        if (!recoveredBlocks.length) {
            return null;
        }

        return [{
            op: 'append_to_page',
            blocks: recoveredBlocks,
        }];
    }

    function findBalancedNotesActionPayload(text) {
        const source = String(text || '');
        if (!source.includes('"actions"')) {
            return null;
        }

        for (let start = 0; start < source.length; start++) {
            if (source[start] !== '{') continue;

            let depth = 0;
            let inString = false;
            let isEscaped = false;

            for (let index = start; index < source.length; index++) {
                const char = source[index];

                if (inString) {
                    if (isEscaped) {
                        isEscaped = false;
                    } else if (char === '\\') {
                        isEscaped = true;
                    } else if (char === '"') {
                        inString = false;
                    }
                    continue;
                }

                if (char === '"') {
                    inString = true;
                    continue;
                }

                if (char === '{') {
                    depth += 1;
                    continue;
                }

                if (char === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        const candidate = source.slice(start, index + 1);
                        const parsed = tryParseNotesActionPayload(candidate);
                        if (parsed) {
                            return {
                                parsed,
                                candidate
                            };
                        }
                        break;
                    }
                }
            }
        }

        return null;
    }

    function looksLikeNotesActionResponse(text) {
        const value = String(text || '');
        return /```notes-actions/i.test(value) ||
            /```json/i.test(value) ||
            /"assistant_reply"\s*:/i.test(value) ||
            /"actions"\s*:/i.test(value) ||
            (/"type"\s*:\s*"(?:text|heading_1|heading_2|heading_3|bulleted_list|numbered_list|todo|code|quote|callout|divider|mermaid|image|ai_image|bookmark|database|ai|toggle|math)"/i.test(value) &&
                /"content"\s*:/i.test(value)) ||
            startsWithMermaidResponse(value);
    }

    function stripStructuredResponseText(text) {
        const value = String(text || '');
        if (startsWithMermaidResponse(value)) {
            return '';
        }

        const markerIndex = value.search(/```notes-actions|```json|"assistant_reply"\s*:|"actions"\s*:|"type"\s*:\s*"(?:text|heading_1|heading_2|heading_3|bulleted_list|numbered_list|todo|code|quote|callout|divider|mermaid|image|ai_image|bookmark|database|ai|toggle|math)"/i);
        if (markerIndex >= 0) {
            return value.slice(0, markerIndex).trim();
        }
        return value.trim();
    }

    function extractNotesActionPlan(responseText) {
        const text = String(responseText || '');
        const match = text.match(/```notes-actions\s*([\s\S]*?)```/i);
        if (!match) {
            const jsonFenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
            const directPayload = tryParseNotesActionPayload(text.trim());
            const fencedPayload = jsonFenceMatch ? tryParseNotesActionPayload(jsonFenceMatch[1].trim()) : null;
            const balancedPayload = findBalancedNotesActionPayload(text);
            const fragmentActions = extractBlockFragmentActions(text);
            const parsed = directPayload || fencedPayload || balancedPayload?.parsed || (fragmentActions
                ? { displayText: '', actions: fragmentActions }
                : null);

            if (parsed) {
                const visibleText = typeof parsed.displayText === 'string'
                    ? parsed.displayText
                    : text
                        .replace(jsonFenceMatch?.[0] || '', '')
                        .replace(balancedPayload?.candidate || '', '')
                        .trim();
                return {
                    displayText: visibleText,
                    actions: parsed.actions
                };
            }

            return {
                displayText: looksLikeNotesActionResponse(text) ? '' : text.trim(),
                actions: [],
                parseFailed: looksLikeNotesActionResponse(text)
            };
        }

        const payloadText = match[1].trim();
        const visibleText = text.replace(match[0], '').trim();

        const parsed = tryParseNotesActionPayload(payloadText);
        if (!parsed) {
            console.warn('Failed to parse notes action plan payload');
            return {
                displayText: visibleText || '',
                actions: [],
                parseFailed: true
            };
        }

        return {
            displayText: String(parsed.displayText || visibleText || '').trim(),
            actions: parsed.actions
        };
    }

    function getFirstBlockId() {
        return getPageContext()?.blocks?.[0]?.id || null;
    }

    function getLastBlockId() {
        const blocks = getPageContext()?.blocks || [];
        return blocks.length ? blocks[blocks.length - 1].id : null;
    }

    function applyNotesActions(actions = []) {
        const editor = window.Editor;
        if (!editor || !Array.isArray(actions) || actions.length === 0) {
            return { appliedCount: 0, focusBlockId: null };
        }

        let appliedCount = 0;
        let focusBlockId = null;
        
        // Get affected blocks for visual feedback
        const affectedBlockIds = getAffectedBlockIds(actions);
        
        // Highlight blocks before applying actions
        affectedBlockIds.forEach(blockId => {
            const action = actions.find(a => 
                a.blockId === blockId || a.targetBlockId === blockId
            );
            const actionType = action?.op?.includes('delete') ? 'deleting' : 
                              action?.op?.includes('insert') ? 'inserting' : 'editing';
            highlightBlock(blockId, actionType);
        });

        actions.forEach((rawAction) => {
            if (!rawAction || typeof rawAction !== 'object') return;

            const op = String(rawAction.op || '').toLowerCase();
            const targetBlockId = rawAction.blockId || rawAction.targetBlockId || null;
            const blockDefinitions = Array.isArray(rawAction.blocks)
                ? rawAction.blocks
                : (rawAction.block ? [rawAction.block] : []);

            try {
                switch (op) {
                    case 'update_page': {
                        const pageUpdates = {};
                        ['title', 'icon', 'cover', 'properties', 'defaultModel'].forEach((key) => {
                            if (Object.prototype.hasOwnProperty.call(rawAction, key)) {
                                pageUpdates[key] = rawAction[key];
                            }
                        });
                        editor.updatePageMetadata?.(pageUpdates);
                        appliedCount++;
                        break;
                    }
                    case 'update_block': {
                        if (!targetBlockId) return;
                        const existing = editor.getBlock?.(targetBlockId);
                        if (!existing) return;

                        const nextType = rawAction.type || existing.type;
                        const replacement = normalizeActionBlock({
                            ...JSON.parse(JSON.stringify(existing)),
                            id: targetBlockId,
                            type: nextType,
                            content: Object.prototype.hasOwnProperty.call(rawAction, 'content')
                                ? rawAction.content
                                : existing.content,
                            children: rawAction.keepChildren === false ? [] : (existing.children || []),
                            color: Object.prototype.hasOwnProperty.call(rawAction, 'color')
                                ? rawAction.color
                                : existing.color,
                            textColor: Object.prototype.hasOwnProperty.call(rawAction, 'textColor')
                                ? rawAction.textColor
                                : existing.textColor,
                            icon: Object.prototype.hasOwnProperty.call(rawAction, 'icon')
                                ? rawAction.icon
                                : existing.icon
                        }, { defaultType: nextType });
                        editor.replaceBlockWithBlocks?.(targetBlockId, [replacement]);
                        focusBlockId = replacement.id;
                        appliedCount++;
                        break;
                    }
                    case 'replace_block': {
                        if (!targetBlockId) return;
                        const replacements = (blockDefinitions.length ? blockDefinitions : [rawAction]).map((blockDef, index) => {
                            const normalized = normalizeActionBlock(blockDef, {
                                defaultType: rawAction.type || blockDef.type || 'text'
                            });
                            if (index === 0 && !normalized.id) {
                                normalized.id = targetBlockId;
                            }
                            return normalized;
                        });
                        const inserted = editor.replaceBlockWithBlocks?.(targetBlockId, replacements) || [];
                        focusBlockId = inserted[inserted.length - 1]?.id || focusBlockId;
                        appliedCount++;
                        break;
                    }
                    case 'insert_after': {
                        const insertAfterId = targetBlockId || getLastBlockId();
                        const blocksToInsert = blockDefinitions.length ? blockDefinitions : [{
                            type: rawAction.type || 'text',
                            content: rawAction.content || ''
                        }];
                        const inserted = editor.insertBlocksAfter?.(
                            insertAfterId,
                            blocksToInsert.map((blockDef) => normalizeActionBlock(blockDef, {
                                defaultType: rawAction.type || blockDef.type || 'text'
                            }))
                        ) || [];
                        focusBlockId = inserted[inserted.length - 1]?.id || focusBlockId;
                        appliedCount++;
                        break;
                    }
                    case 'insert_before': {
                        const insertBeforeId = targetBlockId || getFirstBlockId();
                        if (!insertBeforeId) return;
                        const blocksToInsert = blockDefinitions.length ? blockDefinitions : [{
                            type: rawAction.type || 'text',
                            content: rawAction.content || ''
                        }];
                        const inserted = editor.insertBlocksBefore?.(
                            insertBeforeId,
                            blocksToInsert.map((blockDef) => normalizeActionBlock(blockDef, {
                                defaultType: rawAction.type || blockDef.type || 'text'
                            }))
                        ) || [];
                        focusBlockId = inserted[inserted.length - 1]?.id || focusBlockId;
                        appliedCount++;
                        break;
                    }
                    case 'append_to_page':
                    case 'append': {
                        const blocksToInsert = blockDefinitions.length ? blockDefinitions : [{
                            type: rawAction.type || 'text',
                            content: rawAction.content || ''
                        }];
                        const lastBlockId = getLastBlockId();
                        const normalizedBlocks = blocksToInsert.map((blockDef) => normalizeActionBlock(blockDef, {
                            defaultType: rawAction.type || blockDef.type || 'text'
                        }));
                        const inserted = lastBlockId
                            ? (editor.insertBlocksAfter?.(lastBlockId, normalizedBlocks) || [])
                            : (editor.insertBlocksAfter?.(null, normalizedBlocks) || []);
                        focusBlockId = inserted[inserted.length - 1]?.id || focusBlockId;
                        appliedCount++;
                        break;
                    }
                    case 'prepend_to_page':
                    case 'prepend': {
                        const firstBlockId = getFirstBlockId();
                        const blocksToInsert = blockDefinitions.length ? blockDefinitions : [{
                            type: rawAction.type || 'text',
                            content: rawAction.content || ''
                        }];
                        const normalizedBlocks = blocksToInsert.map((blockDef) => normalizeActionBlock(blockDef, {
                            defaultType: rawAction.type || blockDef.type || 'text'
                        }));
                        const inserted = firstBlockId
                            ? (editor.insertBlocksBefore?.(firstBlockId, normalizedBlocks) || [])
                            : (editor.insertBlocksAfter?.(null, normalizedBlocks) || []);
                        focusBlockId = inserted[inserted.length - 1]?.id || focusBlockId;
                        appliedCount++;
                        break;
                    }
                    case 'delete_block':
                    case 'delete': {
                        if (!targetBlockId) return;
                        editor.deleteBlock?.(targetBlockId);
                        appliedCount++;
                        break;
                    }
                    default:
                        break;
                }
            } catch (error) {
                console.error(`Failed to apply notes action "${op}":`, error);
            }
        });

        if (appliedCount > 0) {
            editor.savePage?.();
            if (focusBlockId) {
                editor.focusBlock?.(focusBlockId);
            }
            showActionToast(appliedCount);
            
            // Remove highlights after a delay
            setTimeout(() => {
                unhighlightAllBlocks();
            }, 2000);
        } else {
            // Remove highlights immediately if no actions were applied
            unhighlightAllBlocks();
        }

        return { appliedCount, focusBlockId };
    }

    function prepareAssistantResponse(responseText) {
        const parsed = extractNotesActionPlan(responseText);
        const applied = applyNotesActions(parsed.actions);
        const fallbackReply = applied.appliedCount > 0
            ? `Applied ${applied.appliedCount} page change${applied.appliedCount === 1 ? '' : 's'}.`
            : '';

        return {
            displayText: parsed.displayText || fallbackReply || (parsed.parseFailed
                ? 'I prepared page updates, but the response could not be applied automatically. Please try again.'
                : ''),
            appliedCount: applied.appliedCount
        };
    }

    function getStreamingVisibleText(text) {
        const value = String(text || '');
        const trimmed = value.trim();

        if (/^\{[\s\S]*"actions"\s*:/i.test(trimmed) && /"assistant_reply"\s*:/i.test(trimmed)) {
            return '';
        }

        return stripStructuredResponseText(
            value
                .replace(/```notes-actions[\s\S]*$/i, '')
                .replace(/```json[\s\S]*?(?:"assistant_reply"|"actions")[\s\S]*$/i, '')
        ).trimEnd();
    }

    function isInvalidGatewayResponseText(text) {
        const normalized = String(text || '').trim().toLowerCase().replace(/[’]/g, '\'');
        if (!normalized) return false;

        return normalized.includes('support@backend.io') ||
            normalized.includes('docs.backend.io/cli') ||
            (normalized.includes('need help?') && normalized.includes('backend.io')) ||
            normalized.includes('cli_help sub-agent') ||
            normalized.includes('generalist agent') ||
            normalized.includes('grep_search') ||
            normalized.includes('provided file-system tools') ||
            normalized.includes('current environment\'s available toolset') ||
            normalized.includes('current workspace in /app') ||
            normalized.includes('i do not have access to an ssh-execute tool') ||
            normalized.includes('i do not have a usable remote-build or ssh execution tool') ||
            normalized.includes('i can\'t access the remote server from this environment') ||
            normalized.includes('i cannot access the remote server from this environment') ||
            normalized.includes('this session is restricted from network/ssh access') ||
            normalized.includes('this session is restricted from network access') ||
            normalized.includes('no ssh/network path to the remote server') ||
            normalized.includes('no ssh path to the remote server') ||
            normalized.includes('i can\'t run remote-build') ||
            normalized.includes('i cannot run remote-build') ||
            normalized.includes('i can\'t connect via ssh') ||
            normalized.includes('i cannot connect via ssh') ||
            normalized.includes('i can\'t execute ssh from this session') ||
            normalized.includes('i cannot execute ssh from this session') ||
            normalized.includes('bwrap: no permissions to create a new namespace') ||
            normalized.includes('bwrap: no permissions to create a new na') ||
            normalized.includes('bwrap: no permissions') ||
            normalized.includes('basic local commands fail before any ssh attempt') ||
            normalized.includes('testing command execution first') ||
            normalized.includes('earlier retries were failing before any remote connection could start') ||
            normalized.includes('local shell startup still breaks') ||
            normalized.includes('fails before any remote connection starts') ||
            normalized.includes('fails before any network connection starts') ||
            normalized.includes('workspace can execute anything locally') ||
            normalized.includes('launch a remote check from /app') ||
            normalized.includes('can\'t inspect config or launch a remote check from /app') ||
            normalized.startsWith('<!doctype html') ||
            normalized.startsWith('<html');
    }

    function isToolRuntimeSensitiveIntent(question = '', requestOptions = {}) {
        if (requestOptions?.outputFormat) {
            return false;
        }

        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return [
            /\bssh\b/,
            /\bssh-execute\b/,
            /\bremote-build\b/,
            /\bremote command\b/,
            /\bremote server\b/,
            /\bremote host\b/,
            /\bserver\b[\s\S]{0,40}\b(check|inspect|debug|deploy|build|install|setup|health)\b/,
            /\b(cluster|k3s|kubernetes|k8s|kubectl|docker|traefik|cert-manager|let'?s encrypt|acme)\b/,
            /\bweb research\b/,
            /\bsearch the web\b/,
            /\bbrowse online\b/,
            /\bscrape\b/,
            /\btool\b[\s\S]{0,20}\b(work|call|run|use|available)\b/,
        ].some((pattern) => pattern.test(normalized));
    }

    function isToolCompatibleNotesModelId(modelId = '') {
        const id = String(modelId || '').trim().toLowerCase();
        if (!id) {
            return false;
        }

        return isSupportedNotesModelId(id);
    }

    function getAvailableNotesModelIds(options = {}) {
        const {
            toolCompatibleOnly = false
        } = options;

        return (getModels() || [])
            .map((model) => model?.id || model)
            .map((modelId) => String(modelId || '').trim())
            .filter(Boolean)
            .filter((modelId) => (toolCompatibleOnly ? isToolCompatibleNotesModelId(modelId) : isSupportedNotesModelId(modelId)));
    }

    function isToolExecutionFailure(error = null) {
        const normalized = String(error?.message || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return [
            /\bssh\b/,
            /\bssh-execute\b/,
            /\bremote-build\b/,
            /\bremote command\b/,
            /\btool invocation failed\b/,
            /\btool execution failed\b/,
            /\bfailed to load tools\b/,
            /\bmissing-target\b/,
            /\bcredential\b/,
            /\bhost\b/,
            /\bconnection refused\b/,
            /\btimed out\b/,
            /\bpermission denied\b/,
            /\bkubectl\b/,
            /\bk3s\b/,
            /\bcluster\b/,
        ].some((pattern) => pattern.test(normalized));
    }

    function shouldRetryWithAlternateModel(error = null) {
        const status = Number(error?.status || 0);
        const normalized = String(error?.message || '').trim().toLowerCase();

        if (!normalized && !status) {
            return false;
        }

        if (isToolExecutionFailure(error)) {
            return false;
        }

        if (status === 404 && /\b(model|resource was not found|not found)\b/.test(normalized)) {
            return true;
        }

        if (status === 502 && /invalid response returned by the ai gateway/.test(normalized)) {
            return true;
        }

        return /server error|api request failed|streaming error|invalid response returned by the ai gateway|model .* failed|unsupported model/.test(normalized);
    }

    function buildCandidateModelsForRequest(question = '', preferredModel = 'gpt-4o', requestOptions = {}) {
        const toolSensitiveRequest = isToolRuntimeSensitiveIntent(question, requestOptions);
        const ordered = [];
        const pushUnique = (modelId) => {
            const normalized = String(modelId || '').trim();
            if (!normalized || ordered.includes(normalized) || !isSupportedNotesModelId(normalized)) {
                return;
            }
            ordered.push(normalized);
        };

        if (toolSensitiveRequest) {
            const availableModelIds = getAvailableNotesModelIds({ toolCompatibleOnly: true });

            if (isToolCompatibleNotesModelId(preferredModel)) {
                pushUnique(preferredModel);
            }
            if (ordered.length === 0) {
                availableModelIds.forEach(pushUnique);
            }
            return ordered;
        }

        pushUnique(preferredModel);
        getAvailableNotesModelIds().forEach(pushUnique);
        return ordered;
    }

    // ============================================
    // Visual Feedback for AI Actions
    // ============================================
    
    /**
     * Highlight a block to show AI is working on it
     * @param {string} blockId - The block ID to highlight
     * @param {string} action - The action being performed ('editing', 'inserting', 'deleting')
     */
    function highlightBlock(blockId, action = 'editing') {
        if (!blockId) return;
        
        const blockElement = document.querySelector(`[data-block-id="${blockId}"]`);
        if (!blockElement) return;
        
        // Remove any existing AI state classes
        blockElement.classList.remove('ai-editing', 'ai-inserting', 'ai-deleting');
        
        // Add appropriate class based on action
        blockElement.classList.add(`ai-${action}`);
        
        // Scroll block into view if needed
        blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        return blockElement;
    }
    
    /**
     * Remove AI highlight from a block
     * @param {string} blockId - The block ID to unhighlight
     */
    function unhighlightBlock(blockId) {
        if (!blockId) return;
        
        const blockElement = document.querySelector(`[data-block-id="${blockId}"]`);
        if (!blockElement) return;
        
        blockElement.classList.remove('ai-editing', 'ai-inserting', 'ai-deleting');
        return blockElement;
    }
    
    /**
     * Unhighlight all AI-affected blocks
     */
    function unhighlightAllBlocks() {
        document.querySelectorAll('.ai-editing, .ai-inserting, .ai-deleting').forEach(el => {
            el.classList.remove('ai-editing', 'ai-inserting', 'ai-deleting');
        });
    }
    
    /**
     * Show toast notification for completed AI actions
     * @param {number} actionCount - Number of actions applied
     * @param {string} description - Description of what was done
     */
    function showActionToast(actionCount, description = '') {
        if (actionCount === 0) return;
        
        const message = description || `Applied ${actionCount} change${actionCount === 1 ? '' : 's'}`;
        showToast(message, 'success');
    }
    
    /**
     * Extract block IDs from actions for highlighting
     * @param {Array} actions - Array of action objects
     * @returns {Array} Array of block IDs affected
     */
    function getAffectedBlockIds(actions = []) {
        const blockIds = new Set();
        
        actions.forEach(action => {
            if (action.blockId) blockIds.add(action.blockId);
            if (action.targetBlockId) blockIds.add(action.targetBlockId);
            
            // Also check for blocks being inserted (they won't have IDs yet, but their neighbors will)
            if (action.blocks && Array.isArray(action.blocks)) {
                // For insert operations, highlight the reference block
                if (action.blockId) blockIds.add(action.blockId);
            }
        });
        
        return Array.from(blockIds);
    }

    function getStoredModelId() {
        try {
            return localStorage.getItem(SHARED_MODEL_STORAGE_KEY) ||
                localStorage.getItem(LEGACY_MODEL_STORAGE_KEY) ||
                'gpt-4o';
        } catch (error) {
            return 'gpt-4o';
        }
    }

    function persistSelectedModel(modelId) {
        try {
            localStorage.setItem(SHARED_MODEL_STORAGE_KEY, modelId);
            localStorage.setItem(LEGACY_MODEL_STORAGE_KEY, modelId);
        } catch (error) {
            console.warn('Failed to persist selected model:', error);
        }
    }

    function isSupportedNotesModelId(modelId) {
        const id = String(modelId || '').trim().toLowerCase();
        if (!id) return false;

        const looksLikeChatModel = [
            'gpt',
            'claude',
            'gemini',
            'kimi',
            'llama',
            'mistral',
            'qwen',
            'phi',
            'ollama',
            'antigravity',
        ].some((token) => id.includes(token));

        const looksUnsupported = [
            'image',
            'embedding',
            'tts',
            'transcribe',
            'audio',
            'realtime',
            'vision-preview',
            'preview-tools',
            '-tools',
            'codex',
            'computer-use',
            'computer_use',
        ].some((token) => id.includes(token));

        return looksLikeChatModel && !looksUnsupported;
    }
    
    // ============================================
    // State Management
    // ============================================
    const state = {
        selectedModel: getStoredModelId(),
        isActive: false,
        messages: [],
        activePageId: null,
        isProcessing: false,
        streamingEnabled: true,
        cachedModels: null,
        modelsCacheTime: null
    };

    function emitConversationChange(detail = {}) {
        try {
            window.dispatchEvent(new CustomEvent('notes-agent-context-changed', {
                detail: {
                    pageId: state.activePageId,
                    messageCount: state.messages.length,
                    ...detail
                }
            }));
        } catch (error) {
            console.warn('Failed to dispatch conversation change event:', error);
        }
    }

    function syncConversationWithCurrentPage(options = {}) {
        const {
            pageId = getCurrentPageSessionId(),
            emitEvent = true
        } = options;

        if (!pageId) {
            return state.messages;
        }

        if (state.activePageId === pageId) {
            syncAPIClientSession(getAPIClient(), { pageId });
            if (emitEvent) {
                emitConversationChange({ reason: 'page-sync' });
            }
            return state.messages;
        }

        state.activePageId = pageId;
        state.messages = readStoredMessages(pageId).slice(-100);
        syncAPIClientSession(getAPIClient(), { pageId });

        if (emitEvent) {
            emitConversationChange({ reason: 'page-switch' });
        }

        return state.messages;
    }

    function setProcessingState(isProcessing, detail = {}) {
        state.isProcessing = Boolean(isProcessing);

        try {
            window.dispatchEvent(new CustomEvent('notes-agent-processing', {
                detail: {
                    isProcessing: state.isProcessing,
                    model: state.selectedModel,
                    ...detail
                }
            }));
        } catch (error) {
            console.warn('Failed to dispatch agent processing event:', error);
        }
    }

    const MODEL_DISPLAY_NAMES = {
        'gpt-4o': 'GPT-4o',
        'gpt-4o-mini': 'GPT-4o Mini',
        'gpt-4-turbo': 'GPT-4 Turbo',
        'gpt-4': 'GPT-4',
        'gpt-3.5-turbo': 'GPT-3.5 Turbo',
        'o1-preview': 'o1 Preview',
        'o1-mini': 'o1 Mini',
        'o3-mini': 'o3 Mini',
        'o4-mini': 'o4 Mini',
        'kimi-k2': 'Lilly K2',
        'kimi-k2-mini': 'Lilly K2 Mini',
        'claude-sonnet-4': 'Claude Sonnet 4',
        'claude-haiku-4': 'Claude Haiku 4',
        'claude-3-opus': 'Claude 3 Opus',
        'claude-3-sonnet': 'Claude 3 Sonnet',
        'claude-3-haiku': 'Claude 3 Haiku',
        'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
        'claude-3.5-sonnet-latest': 'Claude 3.5 Sonnet Latest',
    };

    const MODEL_DESCRIPTIONS = {
        'gpt-4o': 'Most capable multimodal model',
        'gpt-4o-mini': 'Fast and affordable',
        'gpt-4-turbo': 'Advanced reasoning',
        'o1-preview': 'Reasoning-focused model',
        'o1-mini': 'Fast reasoning model',
        'o3-mini': 'Compact reasoning model',
        'o4-mini': 'Fast multimodal reasoning',
        'kimi-k2': 'Advanced reasoning and coding',
        'kimi-k2-mini': 'Quick responses, everyday tasks',
        'claude-sonnet-4': 'Balanced intelligence and speed',
        'claude-haiku-4': 'Fast and lightweight',
        'claude-3-opus': 'Powerful reasoning',
        'claude-3-sonnet': 'Balanced performance',
        'claude-3-haiku': 'Fast and efficient',
        'claude-3-5-sonnet': 'Latest and most capable',
        'claude-3.5-sonnet-latest': 'Latest and most capable',
    };
    
    // ============================================
    // Model Definitions (Fallback when API unavailable)
    // ============================================
    const FALLBACK_MODELS = [
        { 
            id: 'gpt-4o', 
            name: 'GPT-4o', 
            provider: 'openai',
            description: 'Most capable multimodal model'
        },
        { 
            id: 'gpt-4o-mini', 
            name: 'GPT-4o Mini', 
            provider: 'openai',
            description: 'Fast and cost-effective'
        },
        { 
            id: 'kimi-k2', 
            name: 'Lilly K2', 
            provider: 'kimi',
            description: 'Advanced reasoning and coding'
        },
        { 
            id: 'kimi-k2-mini', 
            name: 'Lilly K2 Mini', 
            provider: 'kimi',
            description: 'Quick responses, everyday tasks'
        },
        { 
            id: 'claude-sonnet-4', 
            name: 'Claude Sonnet 4', 
            provider: 'anthropic',
            description: 'Balanced intelligence and speed'
        },
        { 
            id: 'claude-haiku-4', 
            name: 'Claude Haiku 4', 
            provider: 'anthropic',
            description: 'Fast and lightweight'
        }
    ];

    function inferProvider(modelOrId) {
        const provider = String(modelOrId?.provider || modelOrId?.owned_by || '').toLowerCase();
        if (provider === 'openai' || provider === 'anthropic' || provider === 'google' ||
            provider === 'meta' || provider === 'kimi' || provider === 'mistral') {
            return provider;
        }

        const id = String(modelOrId?.id || modelOrId || '').toLowerCase();
        if (id.includes('claude')) return 'anthropic';
        if (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('o4')) return 'openai';
        if (id.includes('kimi')) return 'kimi';
        if (id.includes('gemini') || id.includes('palm')) return 'google';
        if (id.includes('llama') || id.includes('meta')) return 'meta';
        if (id.includes('mistral')) return 'mistral';
        return 'other';
    }

    function formatModelName(modelId) {
        if (MODEL_DISPLAY_NAMES[modelId]) {
            return MODEL_DISPLAY_NAMES[modelId];
        }

        return modelId
            .split('-')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    function normalizeModel(model) {
        const id = String(model?.id || '').trim();
        if (!id) return null;

        const provider = inferProvider(model);

        return {
            ...model,
            id,
            provider,
            name: model.name || formatModelName(id),
            description: model.description || MODEL_DESCRIPTIONS[id] || model.owned_by || 'AI model'
        };
    }

    function normalizeModelsResponse(response) {
        const apiClient = getAPIClient();
        const rawModels = Array.isArray(response)
            ? response
            : Array.isArray(response?.data)
                ? response.data
                : [];

        const filteredModels = apiClient?.filterChatModels
            ? apiClient.filterChatModels(rawModels)
            : rawModels;

        const modelsToUse = filteredModels.length > 0 ? filteredModels : rawModels;
        const uniqueModels = new Map();

        modelsToUse.forEach((model) => {
            const normalized = normalizeModel(model);
            if (normalized && !uniqueModels.has(normalized.id)) {
                uniqueModels.set(normalized.id, normalized);
            }
        });

        return Array.from(uniqueModels.values());
    }
    
    // ============================================
    // Response Templates for Stub Mode
    // ============================================
    const RESPONSE_TEMPLATES = {
        greeting: [
            "Hello! I'm ready to help you with your notes. What would you like to do?",
            "Hi there! I can help you write, edit, or analyze your page. What do you need?",
            "Hey! I'm your AI assistant. Ask me anything about your page or how I can help!"
        ],
        question: [
            "Based on your page about **{topic}**, I can see you have {blockCount} blocks of content. {observation}",
            "Looking at your notes on **{topic}**, here's what I found: {observation}",
            "From what I can see in your **{topic}** page: {observation}"
        ],
        edit: [
            "✅ I've updated that block for you. The content has been improved while keeping your original meaning.",
            "✅ Done! I've made the requested changes to your content.",
            "✅ Block updated successfully. Let me know if you'd like any other edits!"
        ],
        insert: [
            "✅ I've added a new **{type}** block after the specified block.",
            "✅ New content added! You can find it in your page.",
            "✅ Inserted successfully. The page has been updated."
        ],
        delete: [
            "✅ Block removed from your page.",
            "✅ I've deleted that block for you.",
            "✅ Done! The block has been removed."
        ],
        summarize: [
            "Here's a summary of your page **{title}**:\n\n{summary}",
            "Summary of **{title}**:\n\n{summary}\n\nKey points have been condensed while keeping the essential information.",
            "📋 Page Summary:\n\n{summary}"
        ],
        improve: [
            "✅ I've improved the writing in that block. The text is now more polished and professional.",
            "✅ Writing enhanced! I've clarified the language and improved the flow.",
            "✅ Improvements made: better grammar, clearer structure, and more engaging language."
        ],
        continue: [
            "I've continued writing based on your content. Here's what I added:\n\n{content}",
            "Building on your existing content, I've added:\n\n{content}",
            "Following your writing style, I continued with:\n\n{content}"
        ],
        outline: [
            "Here's an outline for **{topic}**:\n\n{outline}",
            "📋 Suggested structure for {topic}:\n\n{outline}\n\nWould you like me to expand on any of these sections?",
            "I've created an outline for you:\n\n{outline}"
        ],
        unknown: [
            "I'm not sure I understood that. Could you rephrase or ask something specific about your page?",
            "I can help with writing, editing, summarizing, and more. What would you like to do?",
            "Try asking me to summarize your page, improve a block, or generate an outline!"
        ]
    };
    
    // ============================================
    // Initialization
    // ============================================
    async function init() {
        if (initPromise) {
            return initPromise;
        }

        initPromise = (async () => {
            state.messages = readStoredMessages();
            syncConversationWithCurrentPage({ emitEvent: false });

            // Try to fetch models from API first
            try {
                await refreshModelsFromAPI();
            } catch (error) {
                console.log('Using fallback models');
            }

            // Validate selected model
            const availableModels = state.cachedModels || FALLBACK_MODELS;
            if (!isSupportedNotesModelId(state.selectedModel) || !availableModels.find(m => m.id === state.selectedModel)) {
                state.selectedModel = availableModels[0]?.id || 'gpt-4o';
                persistSelectedModel(state.selectedModel);
            }

            console.log('Agent module initialized with model:', state.selectedModel);
        })();

        return initPromise;
    }
    
    // Fetch models from API with caching
    async function refreshModelsFromAPI() {
        const apiClient = getAPIClient();
        if (!apiClient) return false;

        syncAPIClientSession(apiClient);
        
        // Check cache (cache for 5 minutes)
        const cacheExpiry = 5 * 60 * 1000;
        if (state.cachedModels && state.modelsCacheTime && 
            (Date.now() - state.modelsCacheTime < cacheExpiry)) {
            return true;
        }
        
        try {
            const modelsResponse = await apiClient.getModels();
            const models = normalizeModelsResponse(modelsResponse);
            if (models.length > 0) {
                state.cachedModels = models;
                state.modelsCacheTime = Date.now();
                return true;
            }
        } catch (error) {
            console.warn('Failed to fetch models from API:', error);
        }
        
        return false;
    }
    
    // ============================================
    // Model Management
    // ============================================
    function getModels() {
        // Return cached models from API if available, otherwise fallback
        return state.cachedModels || FALLBACK_MODELS;
    }
    
    async function getModelsAsync() {
        // Try to refresh from API
        await refreshModelsFromAPI();
        return getModels();
    }
    
    function getSelectedModel() {
        return state.selectedModel;
    }
    
    function setSelectedModel(modelId) {
        const availableModels = getModels();
        const model = availableModels.find(m => m.id === modelId);
        if (model && isSupportedNotesModelId(modelId)) {
            state.selectedModel = modelId;
            persistSelectedModel(modelId);
            return true;
        }
        return false;
    }
    
    function getModelInfo(modelId) {
        const availableModels = getModels();
        return availableModels.find(m => m.id === modelId) || availableModels[0];
    }

    function getModel(modelId) {
        const availableModels = getModels();
        return availableModels.find(m => m.id === modelId) || availableModels[0];
    }

    function getModelsByProvider() {
        const availableModels = getModels();
        const grouped = {};
        availableModels.forEach(model => {
            const provider = model.provider || 'Other';
            if (!grouped[provider]) {
                grouped[provider] = [];
            }
            grouped[provider].push(model);
        });
        return grouped;
    }
    
    // ============================================
    // Page Context Extraction
    // ============================================
    function getPageContext() {
        const page = window.Editor?.getCurrentPage?.();
        if (!page) {
            return null;
        }
        
        // Flatten all blocks recursively
        function flattenBlocks(blocks, depth = 0) {
            const result = [];
            blocks.forEach(block => {
                result.push({
                    id: block.id,
                    type: block.type,
                    content: extractBlockTextValue(block),
                    depth: depth,
                    hasChildren: block.children && block.children.length > 0,
                    color: block.color || null,
                    textColor: block.textColor || null
                });
                if (block.children && block.children.length > 0) {
                    result.push(...flattenBlocks(block.children, depth + 1));
                }
            });
            return result;
        }
        
        const allBlocks = flattenBlocks(page.blocks || []);
        const outline = allBlocks.filter(b => b.type.startsWith('heading_'));
        const textBlocks = allBlocks.filter(b => {
            const textTypes = ['text', 'heading_1', 'heading_2', 'heading_3', 'quote', 'callout'];
            return textTypes.includes(b.type) && b.content;
        });
        
        // Calculate word count
        const fullText = textBlocks.map(b => b.content).join(' ');
        const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
        
        // Estimate reading time (average 200 words per minute)
        const readingTime = Math.max(1, Math.ceil(wordCount / 200));
        
        return {
            title: page.title || 'Untitled',
            icon: page.icon || '',
            pageId: page.id,
            blocks: allBlocks,
            outline: outline,
            blockCount: allBlocks.length,
            wordCount: wordCount,
            readingTime: readingTime,
            lastUpdated: page.updatedAt,
            defaultModel: page.defaultModel,
            hasCover: !!page.cover,
            properties: page.properties || []
        };
    }
    
    function getFullPageContentLegacy() {
        const context = getPageContext();
        if (!context) return '';
        
        let content = '';
        if (context.icon) content += `${context.icon} `;
        content += `# ${context.title}\n\n`;
        
        context.blocks.forEach(block => {
            const indent = '  '.repeat(block.depth);
            switch (block.type) {
                case 'heading_1':
                    content += `${indent}# ${block.content}\n\n`;
                    break;
                case 'heading_2':
                    content += `${indent}## ${block.content}\n\n`;
                    break;
                case 'heading_3':
                    content += `${indent}### ${block.content}\n\n`;
                    break;
                case 'text':
                    content += `${indent}${block.content}\n\n`;
                    break;
                case 'bulleted_list':
                    content += `${indent}- ${block.content}\n`;
                    break;
                case 'numbered_list':
                    content += `${indent}1. ${block.content}\n`;
                    break;
                case 'todo':
                    content += `${indent}- [ ] ${block.content}\n`;
                    break;
                case 'quote':
                    content += `${indent}> ${block.content}\n\n`;
                    break;
                case 'code':
                    content += `${indent}\`\`\`\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'divider':
                    content += `${indent}---\n\n`;
                    break;
                case 'callout':
                    content += `${indent}💡 ${block.content}\n\n`;
                    break;
                default:
                    content += `${indent}${block.content}\n\n`;
            }
        });
        
        return content;
    }
    
    function getFullPageContent() {
        const context = getPageContext();
        if (!context) return '';

        let content = '';
        if (context.icon) content += `${context.icon} `;
        content += `# ${context.title}\n\n`;

        context.blocks.forEach((block) => {
            const indent = '  '.repeat(block.depth);
            switch (block.type) {
                case 'heading_1':
                    content += `${indent}# ${block.content}\n\n`;
                    break;
                case 'heading_2':
                    content += `${indent}## ${block.content}\n\n`;
                    break;
                case 'heading_3':
                    content += `${indent}### ${block.content}\n\n`;
                    break;
                case 'text':
                    content += `${indent}${block.content}\n\n`;
                    break;
                case 'bulleted_list':
                    content += `${indent}- ${block.content}\n`;
                    break;
                case 'numbered_list':
                    content += `${indent}1. ${block.content}\n`;
                    break;
                case 'todo':
                    content += `${indent}- [ ] ${block.content}\n`;
                    break;
                case 'quote':
                    content += `${indent}> ${block.content}\n\n`;
                    break;
                case 'code':
                    content += `${indent}\`\`\`\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'divider':
                    content += `${indent}---\n\n`;
                    break;
                case 'callout':
                    content += `${indent}! ${block.content}\n\n`;
                    break;
                case 'mermaid':
                    content += `${indent}\`\`\`mermaid\n${block.content}\n\`\`\`\n\n`;
                    break;
                case 'ai':
                    content += `${indent}> AI block: ${block.content}\n\n`;
                    break;
                default:
                    content += `${indent}${block.content}\n\n`;
            }
        });

        return content;
    }

    function getOutline() {
        const context = getPageContext();
        if (!context) return [];
        return context.outline;
    }
    
    // ============================================
    // Page Context Helper
    // ============================================
    
    /**
     * Format page structure for AI context
     * Returns a structured summary of all blocks with IDs, types, and content previews
     * @param {Object} options - Formatting options
     * @param {number} options.maxContentLength - Max length for content preview (default: 100)
     * @param {boolean} options.includeStats - Include page statistics (default: true)
     * @returns {string} Formatted page structure
     */
    function formatPageContextForAI(options = {}) {
        const { maxContentLength = 100, includeStats = true } = options;
        const context = getPageContext();
        
        if (!context) {
            return 'No page is currently loaded.';
        }
        
        const lines = [];
        
        // Page header
        lines.push(`PAGE: "${context.title || 'Untitled'}"`);
        lines.push('');
        
        // Statistics
        if (includeStats) {
            lines.push('STATISTICS:');
            lines.push(`  - Total blocks: ${context.blockCount}`);
            lines.push(`  - Word count: ${context.wordCount}`);
            lines.push(`  - Reading time: ~${context.readingTime} min`);
            lines.push(`  - Headings: ${context.outline?.length || 0}`);
            lines.push('');
        }
        
        // Block structure
        lines.push('BLOCK STRUCTURE:');
        context.blocks?.forEach(block => {
            const indent = '  '.repeat(block.depth || 0);
            const contentPreview = block.content 
                ? truncateText(block.content, maxContentLength)
                : '(empty)';
            lines.push(`${indent}[${block.id}] ${block.type}: "${contentPreview}"`);
        });
        
        return lines.join('\n');
    }
    
    /**
     * Get detailed info about a specific block
     * @param {string} blockId - The block ID
     * @returns {Object|null} Block details or null if not found
     */
    function getBlockInfo(blockId) {
        const context = getPageContext();
        if (!context?.blocks) return null;
        
        const block = context.blocks.find(b => b.id === blockId);
        if (!block) return null;
        
        return {
            id: block.id,
            type: block.type,
            content: block.content,
            depth: block.depth,
            hasChildren: block.hasChildren,
            preview: truncateText(block.content, 200)
        };
    }
    
    function getPageMetadata() {
        const context = getPageContext();
        if (!context) return null;
        
        return {
            title: context.title,
            icon: context.icon,
            blockCount: context.blockCount,
            wordCount: context.wordCount,
            readingTime: context.readingTime,
            lastUpdated: context.lastUpdated
        };
    }
    
    // ============================================
    // Chat Interface
    // ============================================
    function addMessage(role, content, metadata = {}) {
        syncConversationWithCurrentPage({ emitEvent: false });

        const message = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            role: role, // 'user' or 'assistant'
            content: content,
            timestamp: Date.now(),
            model: role === 'assistant' ? state.selectedModel : null,
            ...metadata
        };
        
        state.messages.push(message);
        
        // Keep only last 100 messages
        if (state.messages.length > 100) {
            state.messages = state.messages.slice(-100);
        }
        
        // Save to localStorage
        saveMessages();
        
        return message;
    }
    
    function saveMessages() {
        saveMessagesForPage(state.activePageId, state.messages);
    }
    
    function getMessages() {
        syncConversationWithCurrentPage({ emitEvent: false });
        return [...state.messages];
    }
    
    function clearConversation() {
        syncConversationWithCurrentPage({ emitEvent: false });
        state.messages = [];
        try {
            localStorage.removeItem(getMessagesStorageKey(state.activePageId));
            if (!state.activePageId) {
                localStorage.removeItem(LEGACY_MESSAGES_STORAGE_KEY);
            }
        } catch (error) {
            console.warn('Failed to clear messages:', error);
        }
        emitConversationChange({ reason: 'clear' });
        showToast('Conversation cleared', 'info');
    }
    
    function formatMessageForDisplay(message) {
        // Convert markdown-like syntax to HTML
        let html = escapeHtml(message.content);
        
        // Bold: **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Italic: *text* or _text_
        html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');
        
        // Code: `text`
        html = html.replace(/`(.*?)`/g, '<code>$1</code>');
        
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }
    
    // ============================================
    // AI Response Generation (Stub Mode)
    // ============================================
    function generateStubResponse(userMessage, context) {
        const messageLower = userMessage.toLowerCase();
        const topic = context?.title || 'your notes';
        
        // Detect intent
        if (messageLower.match(/^(hi|hello|hey|greetings)/)) {
            return pickRandom(RESPONSE_TEMPLATES.greeting);
        }
        
        if (messageLower.includes('summarize') || messageLower.includes('summary')) {
            const summary = buildSummaryText(context);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.summarize), {
                title: topic,
                summary: summary
            });
        }
        
        if (messageLower.includes('outline') || messageLower.includes('structure')) {
            const match = userMessage.match(/(?:for|about|on)\s+(.+?)(?:\?|$)/i);
            const outlineTopic = match ? match[1] : topic;
            const outline = buildOutlineText(outlineTopic);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.outline), {
                topic: outlineTopic,
                outline: outline
            });
        }
        
        if (messageLower.includes('improve') || messageLower.includes('rewrite') || messageLower.includes('enhance')) {
            return pickRandom(RESPONSE_TEMPLATES.improve);
        }
        
        if (messageLower.includes('continue') || messageLower.includes('expand') || messageLower.includes('more')) {
            const continued = buildContinuedText(context);
            return formatTemplate(pickRandom(RESPONSE_TEMPLATES.continue), {
                content: continued
            });
        }
        
        // Default question/observation response
        const observation = generateObservation(context);
        return formatTemplate(pickRandom(RESPONSE_TEMPLATES.question), {
            topic: topic,
            blockCount: context?.blockCount || 0,
            observation: observation
        });
    }
    
    function generateObservation(context) {
        if (!context || !context.blocks || context.blocks.length === 0) {
            return "Your page is currently empty. Would you like me to help you get started?";
        }
        
        const headings = context.blocks.filter(b => b.type.startsWith('heading_'));
        const lists = context.blocks.filter(b => b.type.includes('list') || b.type === 'todo');
        
        let obs = "";
        if (headings.length > 0) {
            obs += `I can see ${headings.length} section${headings.length > 1 ? 's' : ''}`;
            if (context.wordCount > 0) {
                obs += ` with approximately ${context.wordCount} words`;
            }
            obs += ". ";
        }
        
        if (lists.length > 0) {
            obs += `You have ${lists.length} list${lists.length > 1 ? 's' : ''} for organizing items. `;
        }
        
        obs += `This would take about ${context.readingTime} minute${context.readingTime > 1 ? 's' : ''} to read.`;
        
        return obs;
    }
    
    function buildSummaryText(context) {
        if (!context || !context.blocks || context.blocks.length === 0) {
            return "The page is currently empty.";
        }
        
        const headings = context.blocks.filter(b => b.type.startsWith('heading_'));
        const mainPoints = context.blocks
            .filter(b => ['text', 'callout', 'quote'].includes(b.type) && b.content)
            .slice(0, 3)
            .map(b => b.content.substring(0, 100) + (b.content.length > 100 ? '...' : ''));
        
        let summary = "";
        if (headings.length > 0) {
            summary += "**Key Sections:**\n";
            headings.slice(0, 5).forEach(h => {
                summary += `- ${h.content}\n`;
            });
            summary += "\n";
        }
        
        if (mainPoints.length > 0) {
            summary += "**Main Points:**\n";
            mainPoints.forEach((point, i) => {
                summary += `${i + 1}. ${point}\n`;
            });
        }
        
        return summary || "The page contains content ready for review.";
    }
    
    function buildOutlineText(topic) {
        return [
            "1. **Introduction**",
            "   - Overview of " + topic,
            "   - Purpose and goals",
            "",
            "2. **Main Concepts**",
            "   - Key principles",
            "   - Important definitions",
            "   - Core ideas",
            "",
            "3. **Implementation**",
            "   - Step-by-step guide",
            "   - Best practices",
            "   - Common pitfalls",
            "",
            "4. **Examples**",
            "   - Real-world applications",
            "   - Case studies",
            "   - Code samples (if applicable)",
            "",
            "5. **Conclusion**",
            "   - Summary of key points",
            "   - Next steps",
            "   - Additional resources"
        ].join('\n');
    }
    
    function buildContinuedText(context) {
        const lastTextBlock = context?.blocks?.slice().reverse().find(b => 
            b.type === 'text' && b.content
        );
        
        if (!lastTextBlock) {
            return "I can continue writing once you have some text content on the page. Start with a paragraph and I'll help expand on it!";
        }
        
        const topics = [
            "Building on this foundation, it's important to consider the broader implications and how they apply to real-world scenarios.",
            "This leads us to consider additional factors that may influence the outcome. By examining these elements more closely, we can gain deeper insights.",
            "Furthermore, exploring alternative approaches can provide valuable perspectives and enhance our understanding of the subject matter.",
            "The next step involves putting these concepts into practice and observing the results through careful experimentation and analysis."
        ];
        
        return pickRandom(topics) + "\n\nWould you like me to add this to your page?";
    }
    
    // ============================================
    // Core AI Actions
    // ============================================
    function isToolCommand(question) {
        const trimmed = String(question || '').trim();
        return trimmed === '/tools' || trimmed.startsWith('/tools ') || trimmed.startsWith('/tool ') || trimmed.startsWith('/tool-help ');
    }

    function inferRequestedArtifactFormat(question) {
        const normalized = String(question || '').toLowerCase();
        if (!normalized) return null;

        if (/\bstandalone html\b|\bhtml\b/.test(normalized)) return 'html';
        if (/\bpdf\b/.test(normalized)) return 'pdf';
        if (/\bdocx\b|\bword document\b/.test(normalized)) return 'docx';
        if (/\bxml\b/.test(normalized)) return 'xml';
        if (/\bxlsx\b|\bexcel\b|\bspreadsheet\b/.test(normalized)) return 'xlsx';
        if (/\bmermaid\b/.test(normalized)) return 'mermaid';
        return null;
    }

    function isArtifactGenerationIntent(question) {
        const normalized = String(question || '').toLowerCase();
        if (!normalized) return false;

        const format = inferRequestedArtifactFormat(normalized);
        if (!format) return false;

        return /\b(export|generate|create|make|save|download|convert|render|produce|link)\b/.test(normalized);
    }

    function appendArtifactBookmark(artifact, format) {
        const downloadUrl = artifact?.downloadUrl
            ? new URL(artifact.downloadUrl, window.location.origin).toString()
            : null;
        if (!downloadUrl || !window.Blocks?.createBlock) {
            return false;
        }

        const page = window.Editor?.getCurrentPage?.();
        if (!page) {
            return false;
        }

        const exportMarker = `notes-agent-artifact-${format || artifact.format || 'file'}`;
        const existingBlock = (page.blocks || []).find((block) => block?.exportMarker === exportMarker);
        const title = artifact.filename
            ? `Download ${artifact.filename}`
            : `Download ${String(format || artifact.format || 'file').toUpperCase()} export`;
        const description = `Generated ${new Date().toLocaleString()}`;

        const bookmarkBlock = window.Blocks.createBlock('bookmark', {
            url: downloadUrl,
            title,
            description,
            favicon: '',
            image: ''
        }, {
            exportMarker
        });

        if (existingBlock) {
            bookmarkBlock.id = existingBlock.id;
            window.Editor.replaceBlockWithBlocks?.(existingBlock.id, [bookmarkBlock]);
            return true;
        }

        const blocks = page.blocks || [];
        const lastBlockId = blocks.length ? blocks[blocks.length - 1].id : null;
        window.Editor.insertBlocksAfter?.(lastBlockId, [bookmarkBlock]);
        return true;
    }

    function formatAvailableToolsResponse(toolResponse, category = null) {
        const tools = Array.isArray(toolResponse) ? toolResponse : (toolResponse?.tools || []);
        const runtime = toolResponse?.meta?.runtime || null;

        if (!Array.isArray(tools) || tools.length === 0) {
            return category
                ? `No frontend tools are available in category \`${category}\`.`
                : 'No frontend tools are currently available.';
        }

        const lines = ['## Available Tools', ''];
        if (runtime) {
            const gatewayScope = runtime.modelGateway?.internalCluster ? 'internal cluster' : 'external endpoint';
            lines.push(`Runtime source: \`${runtime.source || 'backend'}\``);
            lines.push(`Model gateway: \`${runtime.modelGateway?.baseURL || 'unknown'}\` (${gatewayScope})`);
            if (runtime.sshDefaults?.enabled) {
                const target = runtime.sshDefaults.host
                    ? `${runtime.sshDefaults.username || 'unknown'}@${runtime.sshDefaults.host}:${runtime.sshDefaults.port || 22}`
                    : 'not set';
                lines.push(`SSH defaults: source=${runtime.sshDefaults.source || 'unknown'}, target=${target}, configured=${runtime.sshDefaults.configured ? 'yes' : 'no'}`);
            } else {
                lines.push('SSH defaults: disabled');
            }
            lines.push('');
        }

        tools.forEach((tool) => {
            const params = Array.isArray(tool.parameters)
                ? tool.parameters.map((param) => typeof param === 'string' ? param : param.name).filter(Boolean)
                : Object.keys(tool.inputSchema?.properties || {});
            lines.push(`- \`${tool.id}\` (${tool.category})`);
            lines.push(`  ${tool.description || 'No description provided.'}`);
            if (tool.support?.status) {
                lines.push(`  Support: ${tool.support.status}`);
            }
            if (tool.runtime?.defaultTarget) {
                lines.push(`  Runtime: ${tool.runtime.defaultTarget} via ${tool.runtime.source || 'unknown'}`);
            } else if (tool.runtime && Object.prototype.hasOwnProperty.call(tool.runtime, 'configured')) {
                lines.push(`  Runtime: configured=${tool.runtime.configured ? 'yes' : 'no'}`);
            }
            if (params.length) {
                lines.push(`  Params: ${params.join(', ')}`);
            }
        });
        lines.push('');
        lines.push('Usage: `/tool <id> {"key":"value"}`');
        lines.push('Help: `/tool-help <id>`');
        return lines.join('\n');
    }

    async function handleToolCommand(question, options = {}) {
        const {
            onComplete,
            hiddenAssistantMessage = false
        } = options;
        const apiClient = getAPIClient();

        if (!apiClient) {
            throw new Error('Tool commands require the backend API client.');
        }

        const trimmed = String(question || '').trim();
        let responseText = '';

        if (trimmed === '/tools' || trimmed.startsWith('/tools ')) {
            const category = trimmed.startsWith('/tools ') ? trimmed.slice('/tools '.length).trim() : null;
            const toolResponse = await apiClient.getAvailableTools(category || null);
            responseText = formatAvailableToolsResponse(toolResponse, category);
        } else if (trimmed.startsWith('/tool-help ')) {
            const toolId = trimmed.slice('/tool-help '.length).trim();
            if (!toolId) {
                throw new Error('Usage: /tool-help <id>');
            }

            const doc = await apiClient.getToolDoc(toolId);
            responseText = `## Tool Help: \`${toolId}\`\n\nSupport: \`${doc?.support?.status || 'unknown'}\`\n\n${doc?.content || 'No documentation found.'}`;
        } else {
            const match = trimmed.match(/^\/tool\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
            if (!match) {
                throw new Error('Usage: /tool <id> {"key":"value"}');
            }

            const toolId = match[1];
            const rawParams = (match[2] || '').trim();
            let params = {};

            if (rawParams) {
                params = JSON.parse(rawParams);
            }

            const invocation = await apiClient.invokeTool(toolId, params);
            responseText = `## Tool Result: \`${toolId}\`\n\n\`\`\`json\n${JSON.stringify(invocation?.result, null, 2)}\n\`\`\``;
        }

        const assistantMessage = hiddenAssistantMessage
            ? null
            : addMessage('assistant', responseText, {
                model: state.selectedModel,
                source: 'tool-command'
            });

        setProcessingState(false);

        if (onComplete) {
            onComplete(responseText, assistantMessage);
        }

        return responseText;
    }

    async function ask(question, options = {}) {
        const {
            onChunk,
            onComplete,
            onError,
            hiddenUserMessage = false,
            hiddenAssistantMessage = false
        } = options;
        
        // Validate
        if (!question || typeof question !== 'string') {
            const error = new Error('Question must be a non-empty string');
            if (onError) onError(error);
            throw error;
        }

        syncConversationWithCurrentPage({ emitEvent: false });
        
        if (!hiddenUserMessage) {
            addMessage('user', question);
        }

        // Set processing state
        setProcessingState(true, {
            requestType: hiddenUserMessage || hiddenAssistantMessage ? 'internal' : 'chat'
        });

        try {
            if (isToolCommand(question)) {
                return await handleToolCommand(question, {
                    onComplete,
                    hiddenAssistantMessage
                });
            }

            const context = getPageContext();
            const apiClient = getAPIClient();
            const toolSensitiveRequest = isToolRuntimeSensitiveIntent(question);
            
            // Check if we can use the real API
            if (apiClient) {
                try {
                    const responseText = await askWithAPI(question, context, {
                        onChunk,
                        onComplete,
                        onError,
                        hiddenAssistantMessage
                    });
                    return responseText;
                } catch (apiError) {
                    const backendAvailable = await isBackendAvailable();
                    const shouldUseStubFallback = !toolSensitiveRequest && !backendAvailable;

                    if (!shouldUseStubFallback) {
                        throw apiError;
                    }

                    console.warn('API call failed, backend is unavailable, falling back to stub mode:', apiError.message);
                }
            }

            // Fallback to stub mode (offline/no API client)
            return await askWithStub(question, context, {
                onChunk,
                onComplete,
                onError,
                hiddenAssistantMessage
            });

        } catch (error) {
            setProcessingState(false, { error: error.message });
            console.error('Agent ask error:', error);
            
            if (onError) {
                onError(error);
            } else {
                showToast('Error: ' + error.message, 'error');
            }
            
            throw error;
        }
    }
    
    // Call the real API with streaming support
    async function askWithAPI(question, context, options) {
        const { onChunk, onComplete, onError, hiddenAssistantMessage = false } = options;
        const apiClient = getAPIClient();
        syncAPIClientSession(apiClient, context);
        const requestedArtifactFormat = isArtifactGenerationIntent(question)
            ? inferRequestedArtifactFormat(question)
            : null;
        const requestOptions = requestedArtifactFormat
            ? { outputFormat: requestedArtifactFormat }
            : {};
        
        // Build messages array with enhanced system prompt
        const systemPrompt = buildSystemPrompt(context || {
            title: 'Untitled',
            blockCount: 0,
            wordCount: 0,
            outline: []
        });

        const attemptedModels = [];
        const candidateModels = buildCandidateModelsForRequest(question, state.selectedModel, requestOptions);
        const toolSensitiveRequest = isToolRuntimeSensitiveIntent(question, requestOptions);

        try {
            for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex += 1) {
                const model = candidateModels[modelIndex];
                if (!isSupportedNotesModelId(model) || attemptedModels.includes(model)) {
                    continue;
                }

                attemptedModels.push(model);
                const useMultiPassDraft = shouldUseMultiPassNotesDraft(question, context, requestOptions);
                const explicitPageEditIntent = isExplicitPageEditIntent(question);
                const effectiveQuestion = explicitPageEditIntent
                    ? `${question}\n\nInterpret "page" as the current notes page shown in this editor. This is a direct page edit request, so return notes-actions that apply the content to the current notes page unless the user explicitly says web page, site page, repo file, or server component. Do not reply with chat prose alone.`
                    : question;
                let messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: effectiveQuestion }
                ];
                let responseText = '';
                let lastVisibleText = '';
                let jsonBuffer = '';
                let inJsonBlock = false;
                let generatedArtifacts = [];

                try {
                    if (useMultiPassDraft) {
                        const multiPassMessages = await buildMultiPassNotesMessages({
                            apiClient,
                            model,
                            systemPrompt,
                            question: effectiveQuestion,
                            requestOptions,
                        });
                        if (Array.isArray(multiPassMessages) && multiPassMessages.length > 0) {
                            messages = multiPassMessages;
                        }
                    }

                    if (state.streamingEnabled && apiClient.streamChat) {
                        for await (const chunk of apiClient.streamChat(messages, model, null, requestOptions)) {
                            if (chunk.type === 'delta' && chunk.content) {
                                const chunkText = chunk.content;
                                responseText += chunkText;

                                if (isInvalidGatewayResponseText(responseText)) {
                                    const invalidGatewayError = new Error('Invalid response returned by the AI gateway.');
                                    invalidGatewayError.status = 502;
                                    throw invalidGatewayError;
                                }

                                if (chunkText.includes('```notes-actions')) {
                                    inJsonBlock = true;
                                    jsonBuffer = chunkText;
                                } else if (inJsonBlock) {
                                    jsonBuffer += chunkText;
                                    if (chunkText.includes('```')) {
                                        inJsonBlock = false;
                                    }
                                    continue;
                                }

                                if (onChunk && !inJsonBlock) {
                                    const visibleText = getStreamingVisibleText(responseText);
                                    const visibleDelta = visibleText.slice(lastVisibleText.length);
                                    lastVisibleText = visibleText;
                                    if (visibleDelta) {
                                        onChunk(visibleDelta, visibleText);
                                    }
                                }
                                continue;
                            }

                            if (chunk.type === 'done' && Array.isArray(chunk.artifacts)) {
                                generatedArtifacts = chunk.artifacts;
                                continue;
                            }

                            if (chunk.type === 'error') {
                                const streamError = new Error(chunk.error || 'Streaming error');
                                streamError.status = chunk.status;
                                throw streamError;
                            }
                        }
                    } else {
                        const response = await apiClient.chat(messages, model, requestOptions);
                        if (response?.error) {
                            const apiError = new Error(response.content || 'API request failed');
                            apiError.status = response.status;
                            throw apiError;
                        }

                        responseText = response.content || response.message || String(response);
                        generatedArtifacts = Array.isArray(response.artifacts) ? response.artifacts : [];
                    }

                    if (isInvalidGatewayResponseText(responseText)) {
                        const invalidGatewayError = new Error('Invalid response returned by the AI gateway.');
                        invalidGatewayError.status = 502;
                        throw invalidGatewayError;
                    }

                    let preparedResponse;
                    try {
                        preparedResponse = prepareAssistantResponse(responseText);
                    } catch (parseError) {
                        console.warn('Failed to parse structured response, using raw text:', parseError);
                        const cleanedText = stripStructuredResponseText(responseText);
                        preparedResponse = {
                            displayText: cleanedText || (looksLikeNotesActionResponse(responseText)
                                ? 'I prepared page updates, but the response could not be applied automatically. Please try again.'
                                : ''),
                            appliedCount: 0
                        };
                    }

                    if (explicitPageEditIntent && preparedResponse.appliedCount === 0) {
                        const fallbackPageEdit = buildFallbackPageEditResponse(question, responseText);
                        if (fallbackPageEdit?.appliedCount > 0) {
                            preparedResponse = fallbackPageEdit;
                        }
                    }

                    if (generatedArtifacts.length > 0 && requestedArtifactFormat) {
                        generatedArtifacts.forEach((artifact) => appendArtifactBookmark(artifact, requestedArtifactFormat));
                    }

                    const artifactLinkNotice = generatedArtifacts.length > 0 && requestedArtifactFormat
                        ? `\n\nDownload link added at the bottom of the page for the generated ${requestedArtifactFormat.toUpperCase()} export.`
                        : '';
                    const visibleResponse = (preparedResponse.displayText || responseText) + artifactLinkNotice;
                    const assistantMessage = hiddenAssistantMessage
                        ? null
                        : addMessage('assistant', visibleResponse, {
                            model,
                            tokensUsed: estimateTokens(question + visibleResponse),
                            source: 'api',
                            appliedCount: preparedResponse.appliedCount || 0
                        });

                    if (model !== state.selectedModel && !toolSensitiveRequest) {
                        state.selectedModel = model;
                        persistSelectedModel(model);
                        window.dispatchEvent(new CustomEvent('modelChanged', { detail: { modelId: model } }));
                        showToast(`Switched AI model to ${model} after the previous model failed.`, 'info');
                    }

                    setProcessingState(false);

                    if (onComplete) {
                        onComplete(visibleResponse, assistantMessage);
                    }

                    return visibleResponse;
                } catch (error) {
                    const hasMoreCandidates = candidateModels
                        .slice(modelIndex + 1)
                        .some((candidate) => isSupportedNotesModelId(candidate) && !attemptedModels.includes(candidate));
                    const shouldRetryWithFallback = hasMoreCandidates && shouldRetryWithAlternateModel(error);

                    if (!shouldRetryWithFallback) {
                        throw error;
                    }

                    console.warn(`Model ${model} failed for Notes agent, retrying with the next candidate:`, error.message);
                }
            }

            throw new Error('AI request failed for all available fallback models');
        } catch (error) {
            setProcessingState(false, { error: error.message });
            unhighlightAllBlocks();

            if (onError) {
                onError(error);
            } else {
                showToast('AI request failed: ' + error.message, 'error');
            }
            throw error;
        }
    }
    
    // Stub mode for offline/no API
    async function askWithStub(question, context, options) {
        const { onChunk, onComplete, onError, hiddenAssistantMessage = false } = options;
        
        try {
            // Simulate processing delay
            await delay(500 + Math.random() * 1000);
            
            // Generate response (stub mode)
            const responseText = generateStubResponse(question, context);
            
            // Simulate streaming if enabled
            if (state.streamingEnabled && onChunk) {
                const chunks = simulateStreaming(responseText);
                let fullResponse = '';
                let visibleResponse = '';
                
                for (const chunk of chunks) {
                    await delay(30 + Math.random() * 50);
                    fullResponse += chunk;
                    const nextVisible = getStreamingVisibleText(fullResponse);
                    const visibleDelta = nextVisible.slice(visibleResponse.length);
                    visibleResponse = nextVisible;
                    if (visibleDelta) {
                        onChunk(visibleDelta, nextVisible);
                    }
                }
            }
            
            // Add assistant message
            const preparedResponse = prepareAssistantResponse(responseText);
            const visibleResponse = preparedResponse.displayText || responseText;

            const assistantMessage = hiddenAssistantMessage
                ? null
                : addMessage('assistant', visibleResponse, {
                    model: state.selectedModel,
                    tokensUsed: estimateTokens(question + visibleResponse),
                    source: 'stub',
                    appliedCount: preparedResponse.appliedCount || 0
                });

            setProcessingState(false);
            
            if (onComplete) {
                onComplete(visibleResponse, assistantMessage);
            }
            
            return visibleResponse;
            
        } catch (error) {
            setProcessingState(false, { error: error.message });
            unhighlightAllBlocks();
            
            if (onError) {
                onError(error);
            } else {
                showToast('Request failed: ' + error.message, 'error');
            }
            throw error;
        }
    }
    
    function simulateStreaming(text) {
        // Split text into chunks (words or small phrases)
        const chunks = [];
        const words = text.split(/(\s+)/);
        
        for (let i = 0; i < words.length; i++) {
            // Group 1-3 words per chunk for natural feeling
            const chunkSize = Math.floor(Math.random() * 3) + 1;
            const chunk = words.slice(i, i + chunkSize).join('');
            if (chunk) chunks.push(chunk);
            i += chunkSize - 1;
        }
        
        return chunks;
    }
    
    // ============================================
    // Block Editing Actions
    // ============================================
    function editBlock(blockId, newContent, options = {}) {
        try {
            const page = window.Editor?.getCurrentPage?.();
            if (!page) {
                throw new Error('No page is currently loaded');
            }
            
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found: ' + blockId);
            }
            
            // Update the block content
            window.Editor?.updateBlockContent?.(blockId, newContent);
            
            // Save the page
            window.Editor?.savePage?.();
            
            // Refresh the editor UI
            window.Editor?.refreshEditor?.();
            
            showToast('Block updated', 'success');
            
            // Add system message about the edit
            addMessage('assistant', pickRandom(RESPONSE_TEMPLATES.edit), {
                action: 'edit',
                blockId: blockId
            });
            
            return true;
            
        } catch (error) {
            console.error('Edit block error:', error);
            showToast('Failed to edit block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function insertBlockAfter(blockId, type, content, options = {}) {
        try {
            const newBlock = window.Editor?.insertBlockAfter?.(blockId, type, content);
            
            if (!newBlock) {
                throw new Error('Failed to insert block');
            }
            
            window.Editor?.savePage?.();
            
            // Refresh the editor UI
            window.Editor?.refreshEditor?.();
            
            const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            showToast(`${typeName} block added`, 'success');
            
            // Add system message
            addMessage('assistant', formatTemplate(pickRandom(RESPONSE_TEMPLATES.insert), {
                type: typeName
            }), {
                action: 'insert',
                blockId: newBlock.id,
                blockType: type
            });
            
            return newBlock;
            
        } catch (error) {
            console.error('Insert block error:', error);
            showToast('Failed to insert block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function insertBlockBefore(blockId, type, content, options = {}) {
        try {
            const newBlock = window.Editor?.insertBlockBefore?.(blockId, type, content);
            
            if (!newBlock) {
                throw new Error('Failed to insert block');
            }
            
            window.Editor?.savePage?.();
            
            // Refresh the editor UI
            window.Editor?.refreshEditor?.();
            
            const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            showToast(`${typeName} block added`, 'success');
            
            return newBlock;
            
        } catch (error) {
            console.error('Insert block error:', error);
            showToast('Failed to insert block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function deleteBlock(blockId) {
        try {
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found: ' + blockId);
            }
            
            window.Editor?.deleteBlock?.(blockId);
            window.Editor?.savePage?.();
            
            // Refresh the editor UI
            window.Editor?.refreshEditor?.();
            
            showToast('Block deleted', 'success');
            
            // Add system message
            addMessage('assistant', pickRandom(RESPONSE_TEMPLATES.delete), {
                action: 'delete',
                blockId: blockId
            });
            
            return true;
            
        } catch (error) {
            console.error('Delete block error:', error);
            showToast('Failed to delete block: ' + error.message, 'error');
            throw error;
        }
    }
    
    function duplicateBlock(blockId) {
        try {
            window.Editor?.duplicateBlock?.(blockId);
            window.Editor?.savePage?.();
            
            showToast('Block duplicated', 'success');
            
            return true;
            
        } catch (error) {
            console.error('Duplicate block error:', error);
            showToast('Failed to duplicate block: ' + error.message, 'error');
            throw error;
        }
    }
    
    // ============================================
    // AI-Powered Content Actions
    // ============================================
    async function summarize(target = 'page') {
        try {
            const context = getPageContext();
            if (!context) {
                throw new Error('No page is currently loaded');
            }
            
            setProcessingState(true, { requestType: 'summarize' });
            
            await delay(1000);
            
            const summary = buildSummaryText(context);
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.summarize), {
                title: context.title,
                summary: summary
            });
            
            addMessage('assistant', response, {
                action: 'summarize',
                target: target
            });
            
            setProcessingState(false);
            
            return summary;
            
        } catch (error) {
            setProcessingState(false, { error: error.message });
            console.error('Summarize error:', error);
            throw error;
        }
    }
    
    async function improveWriting(blockId) {
        try {
            const block = window.Editor?.getBlock?.(blockId);
            if (!block) {
                throw new Error('Block not found');
            }
            
            setProcessingState(true, { requestType: 'improve' });
            
            await delay(1500);
            
            // Simulate improved content (in real implementation, would call AI API)
            const originalContent = typeof block.content === 'string' ? block.content : block.content?.text || '';
            const improvedContent = simulateImprovement(originalContent);
            
            // Update the block
            window.Editor?.updateBlockContent?.(blockId, improvedContent);
            window.Editor?.savePage?.();
            
            // Refresh the editor UI
            window.Editor?.refreshEditor?.();
            
            const response = pickRandom(RESPONSE_TEMPLATES.improve);
            addMessage('assistant', response, {
                action: 'improve',
                blockId: blockId
            });
            
            setProcessingState(false);
            
            showToast('Writing improved', 'success');
            
            return improvedContent;
            
        } catch (error) {
            setProcessingState(false, { error: error.message });
            console.error('Improve writing error:', error);
            throw error;
        }
    }
    
    function simulateImprovement(text) {
        // Simple simulation of text improvement
        // In a real implementation, this would call an AI API
        const improvements = [
            text.replace(/\bgood\b/gi, 'excellent'),
            text.replace(/\bbad\b/gi, 'challenging'),
            text.replace(/\bvery\b/gi, 'remarkably'),
            text.replace(/\bthing\b/gi, 'aspect'),
        ];
        
        // Add some professional polish
        let improved = improvements[Math.floor(Math.random() * improvements.length)] || text;
        
        // Capitalize first letter of sentences better
        improved = improved.replace(/\.\s+([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);
        
        return improved;
    }
    
    async function continueWriting(insertAfterBlockId = null) {
        try {
            const context = getPageContext();
            if (!context) {
                throw new Error('No page is currently loaded');
            }
            
            setProcessingState(true, { requestType: 'continue' });
            
            await delay(2000);
            
            const continuedContent = buildContinuedText(context);
            
            // If no specific block ID, add at end
            const targetBlockId = insertAfterBlockId || context.blocks[context.blocks.length - 1]?.id;
            
            if (targetBlockId) {
                const newBlock = window.Editor?.insertBlockAfter?.(targetBlockId, 'text', continuedContent);
                window.Editor?.savePage?.();
                
                // Refresh the editor UI
                window.Editor?.refreshEditor?.();
                
                if (newBlock) {
                    window.Editor?.focusBlock?.(newBlock.id);
                }
            }
            
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.continue), {
                content: continuedContent.substring(0, 100) + '...'
            });
            
            addMessage('assistant', response, {
                action: 'continue'
            });
            
            setProcessingState(false);
            
            showToast('Content added', 'success');
            
            return continuedContent;
            
        } catch (error) {
            setProcessingState(false, { error: error.message });
            console.error('Continue writing error:', error);
            throw error;
        }
    }
    
    async function generateOutline(topic) {
        try {
            setProcessingState(true, { requestType: 'outline' });
            
            await delay(1500);
            
            const outlineTopic = topic || getPageContext()?.title || 'this topic';
            const outline = buildOutlineText(outlineTopic);
            
            const response = formatTemplate(pickRandom(RESPONSE_TEMPLATES.outline), {
                topic: outlineTopic,
                outline: outline
            });
            
            addMessage('assistant', response, {
                action: 'generateOutline',
                topic: outlineTopic
            });
            
            setProcessingState(false);
            
            return outline;
            
        } catch (error) {
            setProcessingState(false, { error: error.message });
            console.error('Generate outline error:', error);
            throw error;
        }
    }
    
    // ============================================
    // Utility Functions
    // ============================================
    function pickRandom(array) {
        return array[Math.floor(Math.random() * array.length)];
    }
    
    function formatTemplate(template, values) {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            return values[key] !== undefined ? values[key] : match;
        });
    }
    
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    function estimateTokens(text) {
        // Rough estimation: ~4 characters per token
        return Math.ceil(text.length / 4);
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function showToast(message, type = 'info') {
        if (window.Sidebar?.showToast) {
            window.Sidebar.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
    
    // ============================================
    // Advanced Features
    // ============================================
    function getConversationHistory(limit = 10) {
        syncConversationWithCurrentPage({ emitEvent: false });
        return state.messages.slice(-limit);
    }
    
    function exportConversation() {
        syncConversationWithCurrentPage({ emitEvent: false });
        const data = {
            exportedAt: new Date().toISOString(),
            pageId: state.activePageId,
            model: state.selectedModel,
            messages: state.messages
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `conversation-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Conversation exported', 'success');
    }
    
    function setStreamingEnabled(enabled) {
        state.streamingEnabled = enabled;
    }
    
    function isStreamingEnabled() {
        return state.streamingEnabled;
    }
    
    function getStats() {
        return {
            totalMessages: state.messages.length,
            userMessages: state.messages.filter(m => m.role === 'user').length,
            assistantMessages: state.messages.filter(m => m.role === 'assistant').length,
            estimatedTokens: state.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
            currentModel: state.selectedModel,
            isProcessing: state.isProcessing
        };
    }
    
    // ============================================
    // Initialize on load
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // ============================================
    // Public API
    // ============================================
    return {
        // Initialization
        init,
        
        // State
        state,
        getStats,
        
        // API Client
        getAPIClient,
        isBackendAvailable,
        
        // Models
        getModels,
        getModelsAsync,
        getSelectedModel,
        setSelectedModel,
        getModelInfo,
        getModel,
        getModelsByProvider,
        
        // Page Context
        getPageContext,
        getFullPageContent,
        getOutline,
        getPageMetadata,
        
        // Page Context Helper (new)
        formatPageContextForAI,
        getBlockInfo,
        
        // Chat Interface
        ask,
        getMessages,
        clearConversation,
        syncConversationWithCurrentPage,
        formatMessageForDisplay,
        getConversationHistory,
        exportConversation,
        
        // Streaming
        setStreamingEnabled,
        isStreamingEnabled,
        
        // Block Actions
        editBlock,
        insertBlockAfter,
        insertBlockBefore,
        deleteBlock,
        duplicateBlock,
        
        // AI Actions
        summarize,
        improveWriting,
        continueWriting,
        generateOutline,
        
        // Visual Feedback (new)
        highlightBlock,
        unhighlightBlock,
        unhighlightAllBlocks,
        
        // Internal utilities (exposed for testing/advanced use)
        _generateStubResponse: generateStubResponse,
        _simulateStreaming: simulateStreaming,
        _buildSystemPrompt: buildSystemPrompt,
        _applyNotesActions: applyNotesActions,
        _extractNotesActionPlan: extractNotesActionPlan
    };
})();

// Expose to window for global access
window.Agent = Agent;
