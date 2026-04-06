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
    const NOTES_PAGE_TEMPLATES = Object.freeze([
        Object.freeze({
            id: 'brief',
            name: 'Executive Brief',
            useWhen: 'Short, high-signal pages that need a fast read with a clear takeaway.',
            matchers: [/\bbrief\b/, /\bsummary\b/, /\boverview\b/, /\bdecision\b/, /\bkey takeaways?\b/, /\bnext steps?\b/],
            structure: [
                'heading_1 for the topic or decision',
                'callout with the bottom line or headline takeaway',
                'heading_2 for context or background',
                'bulleted_list for the main points',
                'heading_2 for risks, watchouts, or tradeoffs',
                'todo or numbered_list for next steps',
            ],
            designRules: [
                'Lead with the answer, not with history.',
                'Use one callout and one list before adding dense prose.',
                'Keep sections compact and scannable.',
            ],
        }),
        Object.freeze({
            id: 'research',
            name: 'Research Page',
            useWhen: 'Topic pages, research notes, explainers, and source-backed investigations.',
            matchers: [/\bresearch\b/, /\bfindings?\b/, /\btopic\b/, /\bcompare\b/, /\bevidence\b/, /\bsources?\b/, /\blearn about\b/],
            structure: [
                'heading_1 for the topic',
                'callout describing what the page covers',
                'heading_2 for overview',
                'heading_2 for findings or themes',
                'bulleted_list or numbered_list for evidence, examples, or facts',
                'heading_2 for sources or open questions',
            ],
            designRules: [
                'Organize by themes, not by one uninterrupted essay.',
                'Use lists for findings and bookmarks for key links when relevant.',
                'Reserve prose blocks for synthesis between evidence sections.',
            ],
        }),
        Object.freeze({
            id: 'project',
            name: 'Project Plan',
            useWhen: 'Project pages, rollouts, roadmaps, launches, and execution planning.',
            matchers: [/\bproject\b/, /\bplan\b/, /\broadmap\b/, /\btimeline\b/, /\bmilestones?\b/, /\bowners?\b/, /\blaunch\b/],
            structure: [
                'heading_1 for the project name',
                'callout with project snapshot, goal, or status',
                'database or list for milestones, owners, or status tracking',
                'heading_2 for goals and scope',
                'heading_2 for timeline or phases',
                'heading_2 for risks and dependencies',
                'todo list for immediate actions',
            ],
            designRules: [
                'Make ownership and next actions visible.',
                'Use structured blocks instead of hiding status in paragraphs.',
                'Treat the page like a working surface, not a static memo.',
            ],
        }),
        Object.freeze({
            id: 'meeting',
            name: 'Meeting Notes',
            useWhen: 'Meetings, workshops, interviews, retros, and collaborative sessions.',
            matchers: [/\bmeeting\b/, /\bnotes\b/, /\bagenda\b/, /\battendees?\b/, /\bdecisions?\b/, /\bretro\b/, /\binterview\b/],
            structure: [
                'heading_1 for the meeting title',
                'text block for date, owner, or context',
                'heading_2 for attendees',
                'heading_2 for agenda',
                'heading_2 for notes or discussion',
                'heading_2 for decisions',
                'todo list for action items',
            ],
            designRules: [
                'Separate decisions from raw discussion notes.',
                'Keep action items explicit and checkable.',
                'Use dividers sparingly to separate pre-meeting and post-meeting sections.',
            ],
        }),
        Object.freeze({
            id: 'documentation',
            name: 'Documentation',
            useWhen: 'Guides, SOPs, onboarding docs, references, and product documentation.',
            matchers: [/\bdocumentation\b/, /\bdoc\b/, /\bguide\b/, /\bhow to\b/, /\bonboarding\b/, /\bsetup\b/, /\breference\b/],
            structure: [
                'heading_1 for the doc title',
                'callout with audience, scope, or prerequisite note',
                'heading_2 for overview',
                'heading_2 for getting started or setup',
                'numbered_list for steps or process',
                'code blocks, quotes, or callouts for examples and warnings',
                'heading_2 for troubleshooting or FAQ',
            ],
            designRules: [
                'Optimize for scanning and task completion.',
                'Use numbered steps for sequences and code blocks for examples.',
                'Pull warnings or constraints into callouts instead of burying them.',
            ],
        }),
        Object.freeze({
            id: 'dashboard',
            name: 'Status Dashboard',
            useWhen: 'Status overviews, operating dashboards, trackers, and live working summaries.',
            matchers: [/\bdashboard\b/, /\bstatus\b/, /\btracker\b/, /\bmetrics?\b/, /\bkpis?\b/, /\bscorecard\b/, /\bhealth\b/],
            structure: [
                'heading_1 for the dashboard title',
                'callout with overall status or summary',
                'database for metrics, owners, risks, or workstreams',
                'heading_2 for highlights',
                'heading_2 for blockers or risks',
                'heading_2 for next moves or decisions',
            ],
            designRules: [
                'Use structured blocks first and summary prose second.',
                'Give the page obvious status surfaces near the top.',
                'Keep sections compact so the page feels operational.',
            ],
        }),
        Object.freeze({
            id: 'journal',
            name: 'Journal / Reflection',
            useWhen: 'Daily notes, reflections, check-ins, and personal working pages.',
            matchers: [/\bjournal\b/, /\bdaily\b/, /\breflection\b/, /\bcheck-in\b/, /\blog\b/, /\bdiary\b/],
            structure: [
                'heading_1 for the date or entry title',
                'callout for the mood, theme, or daily focus',
                'heading_2 for highlights',
                'heading_2 for reflections',
                'heading_2 for priorities or goals',
                'todo list for follow-up actions',
            ],
            designRules: [
                'Make the page feel lightweight and easy to revisit.',
                'Use short paragraphs and headings for emotional or thematic separation.',
                'Keep the page personal but still structured.',
            ],
        }),
    ]);
    const NOTES_BLOCK_PLAYBOOK = Object.freeze([
        Object.freeze({
            type: 'callout',
            whenToUse: 'Key takeaways, warnings, decisions, definitions, highlighted facts, project snapshots.',
            guidance: 'Use near the top or at turning points so the page has an obvious focal point.',
        }),
        Object.freeze({
            type: 'database',
            whenToUse: 'Comparisons, trackers, status boards, matrices, owners, metrics, timelines, repeated fields.',
            guidance: 'Prefer this over long repeated bullet lists when content is tabular or operational.',
        }),
        Object.freeze({
            type: 'bookmark',
            whenToUse: 'Sources, references, products, articles, documentation links, research citations.',
            guidance: 'When web research produced useful links, surface the best ones as page blocks instead of hiding them in prose.',
        }),
        Object.freeze({
            type: 'image / ai_image',
            whenToUse: 'Hero visuals, reference photos, concept visuals, mood-setting illustrations, explainer diagrams.',
            guidance: 'Use `image` for known URLs and `ai_image` for generated or curated visual ideas that belong on the page.',
        }),
        Object.freeze({
            type: 'mermaid',
            whenToUse: 'Processes, systems, workflows, relationships, architectures, state changes, decision paths.',
            guidance: 'Prefer a Mermaid block when the user is describing flow or structure that is easier to scan visually than in paragraphs.',
        }),
        Object.freeze({
            type: 'toggle',
            whenToUse: 'FAQs, optional details, appendix material, deep dives, raw notes beneath a clean summary.',
            guidance: 'Use toggles to keep the page compact while still preserving detail for interactive reading.',
        }),
        Object.freeze({
            type: 'quote',
            whenToUse: 'Excerpts, notable lines, testimonials, definitions, memorable phrasing, cited statements.',
            guidance: 'Use for emphasis when a line should stand apart from the surrounding copy.',
        }),
        Object.freeze({
            type: 'todo',
            whenToUse: 'Action items, next steps, follow-ups, checklists, punch lists.',
            guidance: 'Prefer todo blocks over plain bullets when the page should remain actionable.',
        }),
        Object.freeze({
            type: 'code / math',
            whenToUse: 'Examples, commands, formulas, equations, technical references.',
            guidance: 'Do not bury technical snippets inside text blocks when dedicated blocks would read better.',
        }),
        Object.freeze({
            type: 'divider',
            whenToUse: 'Separating major sections or changing page rhythm on dense pages.',
            guidance: 'Use sparingly to create breathing room, not after every heading.',
        }),
    ]);
    const NOTES_FRONTEND_FEATURE_PLAYBOOK = Object.freeze([
        Object.freeze({
            area: 'Page metadata',
            guidance: 'Use `update_page` to set `title`, `icon`, `cover`, `properties`, and `defaultModel` when the page should feel complete, branded, or easier to scan.',
        }),
        Object.freeze({
            area: 'Cover image',
            guidance: 'If you have a direct image URL or a resolved image block, you may set `cover` to give the page a true hero treatment instead of leaving the top visually empty.',
        }),
        Object.freeze({
            area: 'Properties',
            guidance: '`properties` accepts an array of `{key, value}` pairs shown under the title. Use them for page type, status, mode, audience, or other compact metadata.',
        }),
        Object.freeze({
            area: 'Block styling',
            guidance: 'All inserted or replaced blocks may use `color` and `textColor`. Use accent colors for focal blocks and muted gray for secondary notes or appendix material.',
        }),
        Object.freeze({
            area: 'Inline formatting',
            guidance: 'Text-like blocks may include `formatting` such as `{bold, italic, underline, strikethrough, code}` when a line needs emphasis without becoming a separate block.',
        }),
        Object.freeze({
            area: 'Nested structure',
            guidance: 'Blocks can include `children`. Use nested content especially under toggles or other parent blocks when the page should feel interactive instead of flat.',
        }),
        Object.freeze({
            area: 'Visuals',
            guidance: 'Use `image` for known URLs and `ai_image` for AI generation or Unsplash search. `ai_image` supports `source`, `prompt`, `imageUrl`, `size`, `quality`, and `style`.',
        }),
        Object.freeze({
            area: 'Source cards',
            guidance: 'Use `bookmark` blocks for real links. They render as rich cards with title, description, favicon, and optional preview image.',
        }),
        Object.freeze({
            area: 'Structured data',
            guidance: 'Use `database` with `{columns, rows, sortColumn, sortDirection}` for trackers, comparisons, owners, metrics, and matrices instead of long repeated lists.',
        }),
        Object.freeze({
            area: 'Diagrams and equations',
            guidance: 'Use `mermaid` for flows, systems, and sequences, and `math` for LaTeX equations or formulas.',
        }),
    ]);
    const NOTES_TEMPLATE_DESIGN_PRESETS = Object.freeze({
        brief: Object.freeze({
            pageIcon: '📌',
            calloutIcon: '⚡',
            calloutColor: 'yellow',
            sectionTextColor: 'blue',
            supportingTextColor: 'gray',
            sourceHeading: 'Supporting Notes',
            heroPromptSuffix: 'editorial desk scene',
            heroCaptionPrefix: 'Brief visual',
        }),
        research: Object.freeze({
            pageIcon: '🔎',
            calloutIcon: '🧭',
            calloutColor: 'blue',
            sectionTextColor: 'blue',
            supportingTextColor: 'gray',
            sourceHeading: 'Verified Sources',
            heroPromptSuffix: 'editorial wildlife or reference photo',
            heroCaptionPrefix: 'Reference visual',
        }),
        project: Object.freeze({
            pageIcon: '🚀',
            calloutIcon: '📍',
            calloutColor: 'green',
            sectionTextColor: 'green',
            supportingTextColor: 'gray',
            sourceHeading: 'Working References',
            heroPromptSuffix: 'team workspace or planning board',
            heroCaptionPrefix: 'Project visual',
        }),
        meeting: Object.freeze({
            pageIcon: '🗒️',
            calloutIcon: '👥',
            calloutColor: 'gray',
            sectionTextColor: 'brown',
            supportingTextColor: 'gray',
            sourceHeading: 'Follow-up Links',
            heroPromptSuffix: 'meeting desk or collaboration scene',
            heroCaptionPrefix: 'Meeting visual',
        }),
        documentation: Object.freeze({
            pageIcon: '🧩',
            calloutIcon: 'ℹ️',
            calloutColor: 'blue',
            sectionTextColor: 'blue',
            supportingTextColor: 'gray',
            sourceHeading: 'References',
            heroPromptSuffix: 'clean interface or system diagram reference',
            heroCaptionPrefix: 'Reference visual',
        }),
        dashboard: Object.freeze({
            pageIcon: '📊',
            calloutIcon: '📈',
            calloutColor: 'green',
            sectionTextColor: 'green',
            supportingTextColor: 'gray',
            sourceHeading: 'Reference Links',
            heroPromptSuffix: 'operations dashboard or team workspace',
            heroCaptionPrefix: 'Dashboard visual',
        }),
        journal: Object.freeze({
            pageIcon: '📔',
            calloutIcon: '🌤️',
            calloutColor: 'purple',
            sectionTextColor: 'purple',
            supportingTextColor: 'gray',
            sourceHeading: 'Context',
            heroPromptSuffix: 'calm editorial photo',
            heroCaptionPrefix: 'Mood visual',
        }),
    });
    const NOTES_PAGE_DESIGN_MANUAL = Object.freeze([
        'Design quality is part of correctness in notes mode. If the result feels like raw Markdown pasted into a page, it is not finished.',
        'Think in page roles, not just paragraphs: title/icon, focal summary, themed sections, supporting evidence, interactive details, sources, and next steps.',
        'Aim for a true Notion feel: one obvious focal block near the top, clear section rhythm, muted supporting notes, and at least one visual or source cluster when the page is substantial.',
        'Treat style as part of the page system, not decoration after the fact: use page icon, colored section labels, muted secondary copy, and accent callouts to create hierarchy.',
        'Avoid a long ladder of heading followed by paragraph repeated all the way down the page. Break the rhythm with callouts, visuals, bookmarks, databases, toggles, quotes, and dividers where they add clarity.',
        'Research pages should usually feel like a small knowledge hub: lead with a summary callout, group findings by theme, and surface real sources as bookmarks instead of hiding them in prose.',
        'When the topic is visual, real-world, product-like, place-based, or research-driven, include a hero image or ai_image near the top instead of leaving the page text-only.',
        'Operational pages should feel usable, not literary: use databases for repeated fields, todos for actions, and visible status or decision callouts near the top.',
        'Use toggles for optional depth, appendices, research notes, or background material so the main page stays scannable but still interactive.',
        'When a page is meant to look polished, upgrade page metadata too: title, icon, and section rhythm should feel intentional, not accidental.',
        'Use styling on purpose: accent callouts, muted gray support copy, section label colors where helpful, and image/bookmark blocks that make the page feel designed instead of dumped.',
    ]);
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

    function getConversationSessionId(pageContext = null) {
        return state.sharedSessionId || pageContext?.pageId || getCurrentPageSessionId();
    }

    function syncAPIClientSession(apiClient, pageContext = null) {
        if (!apiClient?.setSessionId) {
            return null;
        }

        const sessionId = getConversationSessionId(pageContext);
        if (sessionId) {
            apiClient.setSessionId(sessionId);
        }

        return sessionId;
    }

    async function hydrateSharedConversationSession(apiClient = null) {
        const client = apiClient || getAPIClient();
        if (!client?.getSessionState || !client?.getSessionMessages) {
            return null;
        }

        try {
            const sessionState = await client.getSessionState();
            const activeSessionId = String(sessionState.activeSessionId || '').trim()
                || String(sessionState.sessions?.[0]?.id || '').trim();

            if (!activeSessionId) {
                return null;
            }

            state.sharedSessionId = activeSessionId;
            client.setSessionId(activeSessionId);

            const backendMessages = await client.getSessionMessages(activeSessionId, 100);
            if (backendMessages.length > 0) {
                state.messages = backendMessages
                    .map((message) => ({
                        ...message,
                        content: String(message?.content || '').trim(),
                    }))
                    .filter((message) => message.role && message.content)
                    .slice(-100);
                saveMessagesForPage(activeSessionId, state.messages);
            }

            return activeSessionId;
        } catch (error) {
            console.warn('Failed to hydrate shared notes session:', error);
            return null;
        }
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

    function stripUnsafeNullCharacters(value = '') {
        return String(value || '').replace(/\u0000/g, '');
    }

    function sanitizeStructuredValue(value) {
        if (typeof value === 'string') {
            return stripUnsafeNullCharacters(value);
        }

        if (Array.isArray(value)) {
            return value.map((entry) => sanitizeStructuredValue(entry));
        }

        if (!value || typeof value !== 'object') {
            return value;
        }

        const sanitized = {};
        Object.entries(value).forEach(([key, entryValue]) => {
            sanitized[key] = sanitizeStructuredValue(entryValue);
        });
        return sanitized;
    }

    function looksLikeInternalNotesScaffold(text = '') {
        const normalized = stripUnsafeNullCharacters(text).trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return (
            normalized.includes('original request:')
            && (
                normalized.includes('approved page plan:')
                || normalized.includes('previous failed reply:')
            )
        )
            || normalized.includes('interpret "page" as the current notes page shown in this editor')
            || normalized.includes('return notes-actions that apply the content to the current notes page')
            || normalized.includes('use this approved page plan:')
            || normalized.includes('use these expanded section briefs:')
            || normalized.includes('hidden planning pass for a substantial notes-writing request')
            || normalized.includes('hidden section-expansion pass for a substantial notes-writing request');
    }

    function coerceTextValue(value) {
        if (typeof value === 'string') {
            return stripUnsafeNullCharacters(value);
        }

        if (value == null) {
            return '';
        }

        const extracted = window.Blocks?.extractResponseText?.(value);
        if (typeof extracted === 'string' && extracted) {
            return stripUnsafeNullCharacters(extracted);
        }

        if (typeof value === 'object') {
            if (typeof value.text === 'string') return stripUnsafeNullCharacters(value.text);
            if (typeof value.content === 'string') return stripUnsafeNullCharacters(value.content);
            if (typeof value.message === 'string') return stripUnsafeNullCharacters(value.message);
            if (typeof value.prompt === 'string') return stripUnsafeNullCharacters(value.prompt);
        }

        return stripUnsafeNullCharacters(String(value));
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
                if (content.source === 'artifact' && Array.isArray(content.artifactResults) && content.artifactResults.length > 0) {
                    const sourceHost = content.sourceHost || content.artifactResults[0]?.sourceHost || 'captured source';
                    return `Captured images from ${sourceHost}: ${content.artifactResults.length} options`;
                }

                const source = content.source === 'unsplash'
                    ? 'Unsplash'
                    : (content.source === 'artifact' ? 'Captured image' : 'AI image');
                const details = [
                    content.prompt || '',
                    content.unsplashPhotographer ? `photo by ${content.unsplashPhotographer}` : '',
                    content.sourceHost && content.source === 'artifact' ? `captured from ${content.sourceHost}` : '',
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

    function buildTopLevelLayoutSnapshot(pageContext) {
        if (!pageContext?.blocks?.length) {
            return '- Page is empty. Start with a clear top-level structure.';
        }

        const rootBlocks = pageContext.blocks.filter((block) => Number(block.depth || 0) === 0);
        if (!rootBlocks.length) {
            return '- No root-level blocks detected.';
        }

        const flow = rootBlocks
            .slice(0, 12)
            .map((block, index) => `${index + 1}. [${block.id}] ${block.type}: ${truncateText(block.content, 120) || '(empty)'}`)
            .join('\n');

        const typeCounts = rootBlocks.reduce((counts, block) => {
            const key = String(block.type || 'unknown');
            counts[key] = (counts[key] || 0) + 1;
            return counts;
        }, {});
        const mix = Object.entries(typeCounts)
            .map(([type, count]) => `${type} x${count}`)
            .join(', ');

        return [
            `Top-level flow (${rootBlocks.length} blocks):`,
            flow,
            mix ? `Top-level mix: ${mix}` : '',
        ].filter(Boolean).join('\n');
    }

    function buildPageDesignCriteria(pageContext) {
        const blocks = Array.isArray(pageContext?.blocks) ? pageContext.blocks : [];
        const headings = blocks.filter((block) => String(block?.type || '').startsWith('heading_'));
        const textBlocks = blocks.filter((block) => ['text', 'quote', 'callout'].includes(block?.type));
        const listBlocks = blocks.filter((block) => ['bulleted_list', 'numbered_list', 'todo'].includes(block?.type));
        const callouts = blocks.filter((block) => block?.type === 'callout');
        const dividers = blocks.filter((block) => block?.type === 'divider');
        const visualBlocks = blocks.filter((block) => ['image', 'ai_image', 'bookmark'].includes(block?.type));
        const styledBlocks = blocks.filter((block) => block?.color || block?.textColor);
        const longTextBlocks = textBlocks.filter((block) => String(block?.content || '').trim().length >= 280);

        const criteria = [
            '- Design the note as a sequence of purposeful blocks, not one long paragraph dump.',
            '- For full-page writing, build a scannable structure first, then fill in details.',
            '- Use headings to define sections before adding supporting text.',
            '- Keep paragraphs short. Split dense writing into multiple text blocks.',
            '- Use lists for grouped facts, steps, examples, or comparisons instead of burying them in prose.',
            '- Use callouts, quotes, dividers, visuals, and visual rhythm intentionally when they improve clarity.',
            '- For polished notes, use block styling intentionally: accent the focal callout, use colored section labels, and mute secondary/supporting copy.',
            '- Do not return a single giant text block for a substantial page unless the user explicitly asks for one paragraph.',
        ];

        if (!blocks.length) {
            criteria.push('- The page is empty, so create a complete top-level structure instead of appending a loose paragraph.');
        }

        if (blocks.length > 0 && headings.length === 0) {
            criteria.push('- The current page has no headings. Add section headings so the layout becomes navigable.');
        }

        if (longTextBlocks.length > 0) {
            criteria.push(`- The current page already has ${longTextBlocks.length} dense text block${longTextBlocks.length === 1 ? '' : 's'}. Break long content into smaller blocks.`);
        }

        if (textBlocks.length > 0 && listBlocks.length === 0) {
            criteria.push('- The page is text-heavy. Introduce list blocks where content can be chunked.');
        }

        if (headings.length > 0) {
            criteria.push(`- Preserve and strengthen the existing hierarchy across ${headings.length} heading block${headings.length === 1 ? '' : 's'} when it helps.`);
        }

        if (callouts.length === 0) {
            criteria.push('- Consider at least one callout for the key takeaway, status, warning, or decision when the content warrants it.');
        }

        if (visualBlocks.length === 0 && blocks.length >= 5) {
            criteria.push('- The page has no visual or source media blocks yet. Add an image, ai_image, or bookmark cluster if the topic supports it.');
        }

        if (styledBlocks.length === 0 && blocks.length >= 4) {
            criteria.push('- Nothing on the page is styled yet. Use textColor and background color intentionally so the hierarchy feels designed.');
        }

        if (dividers.length === 0 && blocks.length >= 6) {
            criteria.push('- Use dividers sparingly to separate major sections if the page starts to feel visually dense.');
        }

        return criteria.join('\n');
    }

    function buildTemplateSignalText(question = '', pageContext = null) {
        const parts = [
            String(question || ''),
            String(pageContext?.title || ''),
            ...(Array.isArray(pageContext?.outline)
                ? pageContext.outline.map((item) => item?.content || '')
                : []),
            ...(Array.isArray(pageContext?.blocks)
                ? pageContext.blocks.slice(0, 20).map((block) => `${block?.type || ''} ${block?.content || ''}`)
                : []),
        ];

        return parts.join('\n').toLowerCase();
    }

    function scoreNotesPageTemplate(template, question = '', pageContext = null) {
        const signalText = buildTemplateSignalText(question, pageContext);
        let score = 0;

        template.matchers.forEach((matcher, index) => {
            if (matcher.test(signalText)) {
                score += index === 0 ? 7 : 4;
            }
        });

        const blockCount = Number(pageContext?.blockCount || 0);
        const blockTypes = new Set((pageContext?.blocks || []).map((block) => String(block?.type || '').trim().toLowerCase()));
        const outlineText = Array.isArray(pageContext?.outline)
            ? pageContext.outline.map((heading) => String(heading?.content || '').toLowerCase()).join('\n')
            : '';

        if (!blockCount) {
            if (template.id === 'brief' || template.id === 'documentation') {
                score += 1;
            }
        }

        if (template.id === 'project' && (blockTypes.has('todo') || /\b(goals?|timeline|milestones?|owners?|resources?)\b/.test(outlineText))) {
            score += 3;
        }

        if (template.id === 'meeting' && /\b(attendees?|agenda|decisions?|action items?)\b/.test(outlineText)) {
            score += 4;
        }

        if (template.id === 'dashboard' && (blockTypes.has('database') || /\b(status|metrics?|kpis?|blockers?)\b/.test(outlineText))) {
            score += 4;
        }

        if (template.id === 'documentation' && blockTypes.has('code')) {
            score += 3;
        }

        if (template.id === 'research' && /\b(sources?|findings?|evidence|comparison)\b/.test(outlineText)) {
            score += 3;
        }

        return score;
    }

    function selectNotesPageTemplates(question = '', pageContext = null, options = {}) {
        const { limit = 3 } = options;
        const ranked = NOTES_PAGE_TEMPLATES
            .map((template) => ({
                ...template,
                score: scoreNotesPageTemplate(template, question, pageContext),
            }))
            .sort((left, right) => right.score - left.score);

        const matches = ranked.filter((template) => template.score > 0).slice(0, limit);
        if (matches.length > 0) {
            return matches;
        }

        return NOTES_PAGE_TEMPLATES
            .filter((template) => ['brief', 'documentation', 'project'].includes(template.id))
            .slice(0, limit)
            .map((template, index) => ({
                ...template,
                score: limit - index,
            }));
    }

    function buildTemplateGuidance(question = '', pageContext = null, templateMatches = []) {
        const matches = Array.isArray(templateMatches) && templateMatches.length > 0
            ? templateMatches
            : selectNotesPageTemplates(question, pageContext, { limit: 2 });

        if (!matches.length) {
            return 'No specific template match. Fall back to a clean heading-first document layout.';
        }

        return matches.map((template, index) => [
            `${index + 1}. ${template.name} [${template.id}]`,
            `   Use when: ${template.useWhen}`,
            `   Recommended metadata: ${buildTemplateMetadataSummary(template.id)}`,
            `   Required palette: ${buildTemplateRequiredPalette(template.id).join(' + ')}`,
            '   Suggested block flow:',
            ...template.structure.map((step) => `   - ${step}`),
            `   Design moves: ${template.designRules.join(' ')}`,
            `   Frontend moves: ${buildTemplateFrontendMoves(template.id).join(' ')}`,
        ].join('\n')).join('\n\n');
    }

    function buildBlockCapabilityPlaybook() {
        return NOTES_BLOCK_PLAYBOOK.map((entry) => [
            `- ${entry.type}: ${entry.whenToUse}`,
            `  Use guidance: ${entry.guidance}`,
        ].join('\n')).join('\n');
    }

    function buildFrontendFeatureGuide() {
        return NOTES_FRONTEND_FEATURE_PLAYBOOK.map((entry) => [
            `- ${entry.area}: ${entry.guidance}`,
        ].join('\n')).join('\n');
    }

    function buildTemplateRequiredPalette(templateId = 'brief') {
        switch (templateId) {
            case 'research':
                return ['callout', 'hero image/ai_image', 'bookmark source cluster', 'toggle for deep detail'];
            case 'project':
                return ['callout', 'database or tracker', 'todo next steps', 'styled section headings'];
            case 'meeting':
                return ['callout or summary block', 'agenda/notes hierarchy', 'todo action items', 'supporting divider or toggle'];
            case 'documentation':
                return ['callout', 'numbered steps or code', 'toggle or FAQ section', 'bookmark references'];
            case 'dashboard':
                return ['callout', 'database', 'compact highlights section', 'todo or blocker section'];
            case 'journal':
                return ['callout', 'short reflection sections', 'todo or priorities', 'optional visual or quote'];
            default:
                return ['callout', 'list for scannability', 'clear next-step or closeout section'];
        }
    }

    function buildTemplateMetadataSuggestions(templateId = 'brief') {
        switch (templateId) {
            case 'research':
                return [
                    { key: 'Type', value: 'Research' },
                    { key: 'Mode', value: 'Knowledge hub' },
                    { key: 'Evidence', value: 'Source-linked' },
                ];
            case 'project':
                return [
                    { key: 'Type', value: 'Project' },
                    { key: 'Status', value: 'Active draft' },
                    { key: 'Mode', value: 'Working plan' },
                ];
            case 'meeting':
                return [
                    { key: 'Type', value: 'Meeting' },
                    { key: 'Mode', value: 'Action log' },
                    { key: 'Status', value: 'Open' },
                ];
            case 'documentation':
                return [
                    { key: 'Type', value: 'Documentation' },
                    { key: 'Audience', value: 'Reader guide' },
                    { key: 'Status', value: 'Draft' },
                ];
            case 'dashboard':
                return [
                    { key: 'Type', value: 'Dashboard' },
                    { key: 'Cadence', value: 'Snapshot' },
                    { key: 'Mode', value: 'Operational' },
                ];
            case 'journal':
                return [
                    { key: 'Type', value: 'Journal' },
                    { key: 'Mode', value: 'Reflection' },
                    { key: 'Status', value: 'Personal note' },
                ];
            default:
                return [
                    { key: 'Type', value: 'Brief' },
                    { key: 'Layout', value: 'Scan-first' },
                    { key: 'Status', value: 'Draft' },
                ];
        }
    }

    function buildTemplateMetadataSummary(templateId = 'brief') {
        return buildTemplateMetadataSuggestions(templateId)
            .map((entry) => `${entry.key}: ${entry.value}`)
            .join(', ');
    }

    function buildTemplateFrontendMoves(templateId = 'brief') {
        switch (templateId) {
            case 'research':
                return [
                    'Set a page icon and compact research properties.',
                    'Lead with a hero visual or reference image when the topic benefits from it.',
                    'Use bookmarks instead of prose-only citations.',
                ];
            case 'project':
                return [
                    'Use update_page metadata so the page reads like a live working surface.',
                    'Prefer a database over repeated bullet lists for workstreams or owners.',
                    'Keep next actions visible as todo blocks.',
                ];
            case 'meeting':
                return [
                    'Use properties for the meeting type or status when useful.',
                    'Separate discussion from decisions and follow-up blocks.',
                    'Use toggles for raw notes or appendix material.',
                ];
            case 'documentation':
                return [
                    'Use properties to clarify document type or audience.',
                    'Keep setup or process sections procedural, not essay-like.',
                    'Use bookmarks for linked references and toggles for FAQ depth.',
                ];
            case 'dashboard':
                return [
                    'Use page metadata and database blocks to make the page feel operational.',
                    'Keep the top of the page status-first.',
                    'Use compact supporting sections rather than long prose.',
                ];
            case 'journal':
                return [
                    'Use a personal icon and light metadata only if it improves the page.',
                    'Keep sections short and revisitable.',
                    'A quote or visual can help the page feel intentional without becoming busy.',
                ];
            default:
                return [
                    'Use page metadata when it helps the page feel complete.',
                    'Lead with one focal block and one scannable support block.',
                    'Keep the page compact and deliberate.',
                ];
        }
    }

    function buildTemplateExecutionChecklist(templateMatches = []) {
        const leadTemplate = Array.isArray(templateMatches) && templateMatches.length > 0 ? templateMatches[0] : null;
        if (!leadTemplate) {
            return '- Use the strongest matching page recipe and make the design visible in blocks and metadata.';
        }

        return [
            `- Lead recipe: ${leadTemplate.name}.`,
            `- Add or preserve metadata: ${buildTemplateMetadataSummary(leadTemplate.id)}.`,
            `- Minimum block mix: ${buildTemplateRequiredPalette(leadTemplate.id).join(', ')}.`,
            `- Frontend moves: ${buildTemplateFrontendMoves(leadTemplate.id).join(' ')}`,
        ].join('\n');
    }

    function buildBlockOpportunityGuidance(question = '', pageContext = null, templateMatches = []) {
        const signalText = buildTemplateSignalText(question, pageContext);
        const currentTypes = new Set((pageContext?.blocks || []).map((block) => String(block?.type || '').trim().toLowerCase()));
        const templateIds = new Set((templateMatches || []).map((template) => template.id));
        const opportunities = [];

        if ((/\b(takeaway|summary|overview|warning|important|decision|snapshot|why it matters)\b/.test(signalText) || templateIds.has('brief'))
            && !currentTypes.has('callout')) {
            opportunities.push('- Add a `callout` for the key takeaway or headline insight instead of leaving it buried in text.');
        }

        if ((/\b(compare|comparison|status|tracker|metrics?|kpis?|owners?|timeline|matrix|table|database)\b/.test(signalText) || templateIds.has('dashboard') || templateIds.has('project'))
            && !currentTypes.has('database')) {
            opportunities.push('- Consider a `database` block if the page has repeated structured data, status items, comparisons, or ownership.');
        }

        if ((/\b(source|sources|reference|references|links?|citations?|research|article|documentation)\b/.test(signalText) || templateIds.has('research'))
            && !currentTypes.has('bookmark')) {
            opportunities.push('- Use `bookmark` blocks for the most important links or sources instead of mentioning them only inline.');
        }

        if ((/\b(process|workflow|flow|system|architecture|how it works|pipeline|steps?)\b/.test(signalText) || templateIds.has('documentation'))
            && !currentTypes.has('mermaid')) {
            opportunities.push('- A `mermaid` block may communicate process or structure better than another paragraph.');
        }

        if ((/\b(photo|visual|image|hero|animal|place|product|look|appearance|species)\b/.test(signalText) || templateIds.has('research'))
            && !currentTypes.has('image')
            && !currentTypes.has('ai_image')) {
            opportunities.push('- Add an `image` or `ai_image` block when the topic benefits from a strong visual on the page.');
        }

        if ((/\b(faq|questions|appendix|details|background|deep dive|extra context)\b/.test(signalText) || templateIds.has('documentation'))
            && !currentTypes.has('toggle')) {
            opportunities.push('- Use `toggle` blocks to keep optional details interactive instead of crowding the main flow.');
        }

        if ((/\b(action items?|next steps?|follow up|todo|checklist)\b/.test(signalText) || templateIds.has('project') || templateIds.has('meeting'))
            && !currentTypes.has('todo')) {
            opportunities.push('- Convert operational follow-ups into `todo` blocks so the page stays actionable.');
        }

        if ((/\b(quote|said|statement|definition|notable line|verbatim)\b/.test(signalText))
            && !currentTypes.has('quote')) {
            opportunities.push('- Use a `quote` block if there is a line or definition that deserves emphasis.');
        }

        if ((pageContext?.blockCount || 0) >= 6 && !currentTypes.has('divider')) {
            opportunities.push('- Add a `divider` between major sections if the page feels visually dense.');
        }

        if (!opportunities.length) {
            opportunities.push('- Do a palette audit before finalizing: if headings + text + lists are all you used, check whether one richer block type would improve the page.');
        }

        return opportunities.join('\n');
    }

    function buildNotesPageDesignManual() {
        return NOTES_PAGE_DESIGN_MANUAL.map((line) => `- ${line}`).join('\n');
    }

    function getTemplateDesignPreset(templateId = 'brief') {
        return NOTES_TEMPLATE_DESIGN_PRESETS[templateId] || NOTES_TEMPLATE_DESIGN_PRESETS.brief;
    }

    function extractBlockDefinitionText(block) {
        if (!block || typeof block !== 'object') {
            return '';
        }

        const type = canonicalizeBlockType(block.type || 'text');
        const content = Object.prototype.hasOwnProperty.call(block, 'content')
            ? block.content
            : (Object.prototype.hasOwnProperty.call(block, 'text') ? block.text : '');

        if (typeof content === 'string') {
            return stripUnsafeNullCharacters(content);
        }

        if (!content || typeof content !== 'object') {
            return '';
        }

        switch (type) {
            case 'todo':
                return stripUnsafeNullCharacters(String(content.text || ''));
            case 'callout':
                return coerceTextValue(content.text || content.content || content.message || '');
            case 'code':
                return stripUnsafeNullCharacters(String(content.text || ''));
            case 'math':
                return stripUnsafeNullCharacters(String(content.text || content.latex || ''));
            case 'mermaid':
                return stripUnsafeNullCharacters(String(content.text || ''));
            case 'ai':
                return coerceTextValue(content.result || content.prompt || '');
            case 'image':
                return coerceTextValue(content.caption || content.alt || content.url || '');
            case 'ai_image':
                return coerceTextValue(content.caption || content.prompt || content.imageUrl || '');
            case 'bookmark':
                return coerceTextValue(content.title || content.description || content.url || '');
            default:
                return coerceTextValue(
                    content.text
                    || content.prompt
                    || content.result
                    || content.caption
                    || content.url
                    || ''
                );
        }
    }

    function cloneStructuredValue(value) {
        if (value == null) {
            return value;
        }

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_error) {
            return value;
        }
    }

    function truncateStructuredSummary(text = '', maxChars = 180) {
        const normalized = String(text || '').replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length <= maxChars) {
            return normalized;
        }

        const clipped = normalized.slice(0, maxChars + 1);
        const boundary = clipped.lastIndexOf(' ');
        return `${(boundary >= 90 ? clipped.slice(0, boundary) : clipped.slice(0, maxChars)).trim()}...`;
    }

    function stripHtmlToPlainText(value = '') {
        return String(value || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function analyzeStructuredBlocks(blocks = []) {
        const typeCounts = {};
        let textChars = 0;
        let longTextCount = 0;
        let visualSupportCount = 0;
        let styledBlockCount = 0;

        blocks.forEach((block) => {
            const type = canonicalizeBlockType(block?.type || 'text');
            typeCounts[type] = (typeCounts[type] || 0) + 1;

            const text = extractBlockDefinitionText(block).trim();
            textChars += text.length;
            if (['text', 'quote', 'callout', 'toggle'].includes(type) && text.length >= 220) {
                longTextCount += 1;
            }

            if (['image', 'ai_image', 'bookmark'].includes(type)) {
                visualSupportCount += 1;
            }

            if (block?.color || block?.textColor) {
                styledBlockCount += 1;
            }
        });

        const layoutSupportTypes = ['callout', 'bookmark', 'database', 'image', 'ai_image', 'mermaid', 'toggle', 'divider', 'todo'];
        const layoutSupportCount = layoutSupportTypes.reduce((total, type) => total + (typeCounts[type] || 0), 0);

        return {
            blockCount: blocks.length,
            textChars,
            longTextCount,
            visualSupportCount,
            styledBlockCount,
            typeCounts,
            layoutSupportCount,
        };
    }

    function hasMeaningfulPageIcon(pageContext = null) {
        const icon = String(pageContext?.icon || '').trim();
        return Boolean(icon && !/^note$/i.test(icon));
    }

    function inferCoverUrlFromBlocks(blocks = []) {
        if (!Array.isArray(blocks)) {
            return '';
        }

        for (const block of blocks) {
            const type = canonicalizeBlockType(block?.type || '');
            if (type === 'image') {
                const url = String(block?.content?.url || '').trim();
                if (/^https?:\/\//i.test(url)) {
                    return url;
                }
            }

            if (type === 'ai_image') {
                const url = String(block?.content?.imageUrl || block?.content?.downloadUrl || '').trim();
                if (/^https?:\/\//i.test(url)) {
                    return url;
                }
            }
        }

        return '';
    }

    function buildPageContextFromGeneratedBlocks(blocks = [], context = null) {
        const outline = blocks
            .filter((block) => /^heading_/.test(canonicalizeBlockType(block?.type || '')))
            .map((block, index) => ({
                id: block?.id || `generated_heading_${index}`,
                content: extractBlockDefinitionText(block),
            }));

        return {
            ...(context || {}),
            blocks,
            blockCount: blocks.length,
            outline,
        };
    }

    function inferStructuredPageTitle({ blocks = [], action = null, context = null, question = '' } = {}) {
        const heading = blocks.find((block) => canonicalizeBlockType(block?.type || '') === 'heading_1');
        const headingText = extractBlockDefinitionText(heading).trim();
        if (headingText) {
            return headingText;
        }

        const actionTitle = String(action?.title || '').trim();
        if (actionTitle) {
            return actionTitle;
        }

        const contextTitle = String(context?.title || '').trim();
        if (contextTitle && !/^untitled$/i.test(contextTitle)) {
            return contextTitle;
        }

        const aboutMatch = String(question || '').match(/\b(?:about|on|regarding|for)\s+(.+?)(?:[?.!,]|$)/i);
        return aboutMatch ? aboutMatch[1].trim() : '';
    }

    function inferStructuredPageSubject(options = {}) {
        const title = inferStructuredPageTitle(options);
        if (!title) {
            return '';
        }

        const subject = title.split(/[:\-–—|]/)[0].trim();
        return subject || title;
    }

    function buildFallbackCalloutText(templateId = 'brief', subject = '') {
        const safeSubject = subject || 'This page';
        switch (templateId) {
            case 'research':
                return `${safeSubject} at a glance: the page should surface the strongest themes, the clearest evidence, and why the topic matters.`;
            case 'project':
                return `${safeSubject}: lead with the goal, current status, and the next actions that move the work forward.`;
            case 'dashboard':
                return `${safeSubject}: keep the operating picture visible with a clear status read, key highlights, and immediate watchouts.`;
            case 'documentation':
                return `${safeSubject}: clarify scope, the core workflow, and the warnings or prerequisites a reader should notice first.`;
            case 'meeting':
                return `${safeSubject}: separate context, decisions, and follow-up actions so the page works after the meeting is over.`;
            case 'journal':
                return `${safeSubject}: keep the main theme visible, then support it with highlights, reflections, and next moves.`;
            default:
                return `${safeSubject}: lead with the bottom line and keep the page scannable before adding deeper detail.`;
        }
    }

    function buildCalloutBlock(text = '', preset = {}) {
        return {
            type: 'callout',
            content: {
                text: truncateStructuredSummary(text, 220),
                icon: preset.calloutIcon || '💡',
            },
            color: preset.calloutColor || null,
        };
    }

    function ensureTemplateCalloutBlock(blocks = [], { template = null, preset = null, action = null, context = null, question = '' } = {}) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return blocks;
        }

        const typeCounts = analyzeStructuredBlocks(blocks).typeCounts;
        if (typeCounts.callout > 0) {
            return blocks;
        }

        const nextBlocks = blocks.map((block) => cloneStructuredValue(block));
        const introIndex = nextBlocks.findIndex((block, index) => {
            if (index === 0) {
                return false;
            }

            const type = canonicalizeBlockType(block?.type || '');
            if (!['quote', 'text'].includes(type)) {
                return false;
            }

            const text = extractBlockDefinitionText(block).trim();
            return text.length >= 24 && text.length <= 260;
        });

        const designPreset = preset || getTemplateDesignPreset(template?.id);
        if (introIndex >= 0) {
            nextBlocks[introIndex] = buildCalloutBlock(extractBlockDefinitionText(nextBlocks[introIndex]), designPreset);
            return nextBlocks;
        }

        const subject = inferStructuredPageSubject({ blocks: nextBlocks, action, context, question });
        const fallbackText = buildFallbackCalloutText(template?.id || 'brief', subject);
        const calloutBlock = buildCalloutBlock(fallbackText, designPreset);
        const firstHeadingIndex = nextBlocks.findIndex((block) => canonicalizeBlockType(block?.type || '') === 'heading_1');

        if (firstHeadingIndex >= 0) {
            nextBlocks.splice(firstHeadingIndex + 1, 0, calloutBlock);
            return nextBlocks;
        }

        return [calloutBlock, ...nextBlocks];
    }

    function looksLikeSourceHeadingText(text = '') {
        return /\b(sources?|references?|citations?|links?|verified sources?|source note|research note)\b/i.test(String(text || ''));
    }

    function maybeConvertSupportNoteToToggle(blocks = [], { template = null } = {}) {
        if (!Array.isArray(blocks) || blocks.length < 2) {
            return blocks;
        }

        const stats = analyzeStructuredBlocks(blocks);
        if (stats.typeCounts.toggle > 0 || !['research', 'documentation'].includes(template?.id)) {
            return blocks;
        }

        const nextBlocks = blocks.map((block) => cloneStructuredValue(block));
        for (let index = 0; index < nextBlocks.length - 1; index++) {
            const current = nextBlocks[index];
            const next = nextBlocks[index + 1];
            const currentType = canonicalizeBlockType(current?.type || '');
            const nextType = canonicalizeBlockType(next?.type || '');
            const headingText = extractBlockDefinitionText(current).trim();
            const nextText = extractBlockDefinitionText(next).trim();

            if (!/^heading_/.test(currentType) || nextType !== 'text') {
                continue;
            }

            if (!/\b(source note|research note|background|appendix|deep dive|extra context|verification note)\b/i.test(headingText)) {
                continue;
            }

            if (nextText.length < 120) {
                continue;
            }

            let headingIndex = index;
            if (headingIndex > 0 && canonicalizeBlockType(nextBlocks[headingIndex - 1]?.type || '') !== 'divider' && nextBlocks.length >= 7) {
                nextBlocks.splice(headingIndex, 0, { type: 'divider', content: '' });
                headingIndex += 1;
            }

            nextBlocks[headingIndex + 1] = {
                type: 'toggle',
                content: nextText,
                color: 'gray',
            };
            return nextBlocks;
        }

        return blocks;
    }

    function ensureSupportSectionDivider(blocks = [], { template = null } = {}) {
        if (!Array.isArray(blocks) || blocks.length < 6) {
            return blocks;
        }

        const stats = analyzeStructuredBlocks(blocks);
        if (stats.typeCounts.divider > 0 || !['research', 'documentation', 'meeting'].includes(template?.id)) {
            return blocks;
        }

        const nextBlocks = blocks.map((block) => cloneStructuredValue(block));
        const dividerIndex = nextBlocks.findIndex((block, index) => {
            if (index < 2) {
                return false;
            }

            const type = canonicalizeBlockType(block?.type || '');
            if (!/^heading_/.test(type)) {
                return false;
            }

            return /\b(source note|research note|sources?|references?|appendix|deep dive|follow[- ]?up|faq|next upgrade)\b/i.test(extractBlockDefinitionText(block));
        });

        if (dividerIndex >= 2) {
            nextBlocks.splice(dividerIndex, 0, { type: 'divider', content: '' });
            return nextBlocks;
        }

        return blocks;
    }

    function shouldPreferHeroVisual({ template = null, question = '', blocks = [] } = {}) {
        const signalText = [
            String(question || ''),
            ...blocks.slice(0, 12).map((block) => extractBlockDefinitionText(block)),
        ].join('\n').toLowerCase();

        if (['research', 'brief', 'journal'].includes(template?.id)) {
            return true;
        }

        return /\b(animal|wildlife|bird|species|nature|ocean|sea|mountain|city|travel|product|brand|design|visual|photo|look|appearance|gallery|place|landscape)\b/.test(signalText);
    }

    function buildTemplateHeroImageBlock({ template = null, preset = null, action = null, context = null, question = '' } = {}) {
        const subject = inferStructuredPageSubject({ blocks: action?.blocks || [], action, context, question }) || 'page topic';
        const promptBase = `${subject}, ${preset?.heroPromptSuffix || 'editorial reference photo'}`;
        const captionPrefix = preset?.heroCaptionPrefix || 'Reference visual';

        return {
            type: 'ai_image',
            content: {
                prompt: promptBase,
                caption: `${captionPrefix}: ${subject}`,
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
                imageAssetId: null,
                downloadUrl: null,
            },
        };
    }

    function ensureHeroVisualBlock(blocks = [], { template = null, preset = null, action = null, context = null, question = '' } = {}) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return blocks;
        }

        const stats = analyzeStructuredBlocks(blocks);
        if (stats.visualSupportCount > 0 || !shouldPreferHeroVisual({ template, question, blocks })) {
            return blocks;
        }

        const nextBlocks = blocks.map((block) => cloneStructuredValue(block));
        const heroBlock = buildTemplateHeroImageBlock({ template, preset, action, context, question });
        const calloutIndex = nextBlocks.findIndex((block) => canonicalizeBlockType(block?.type || '') === 'callout');
        if (calloutIndex >= 0) {
            nextBlocks.splice(calloutIndex + 1, 0, heroBlock);
            return nextBlocks;
        }

        const headingIndex = nextBlocks.findIndex((block) => canonicalizeBlockType(block?.type || '') === 'heading_1');
        if (headingIndex >= 0) {
            nextBlocks.splice(headingIndex + 1, 0, heroBlock);
            return nextBlocks;
        }

        return [heroBlock, ...nextBlocks];
    }

    function looksLikeSupportingSection(text = '') {
        return /\b(source note|research note|background|appendix|deep dive|extra context|verification note|references?|sources?|follow[- ]?up|next steps?|faq)\b/i.test(String(text || ''));
    }

    function applyTemplateDesignDecorations(blocks = [], { preset = null } = {}) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return blocks;
        }

        return blocks.map((block) => {
            if (!block || typeof block !== 'object') {
                return block;
            }

            const nextBlock = cloneStructuredValue(block);
            const type = canonicalizeBlockType(nextBlock.type || 'text');
            const text = extractBlockDefinitionText(nextBlock).trim();

            if (type === 'callout' && !nextBlock.color && preset?.calloutColor) {
                nextBlock.color = preset.calloutColor;
            }

            if ((type === 'heading_2' || type === 'heading_3') && !nextBlock.textColor) {
                nextBlock.textColor = looksLikeSupportingSection(text)
                    ? (preset?.supportingTextColor || 'gray')
                    : (preset?.sectionTextColor || null);
            }

            if ((type === 'text' || type === 'quote' || type === 'toggle') && !nextBlock.textColor && looksLikeSupportingSection(text)) {
                nextBlock.textColor = preset?.supportingTextColor || 'gray';
            }

            if (type === 'toggle' && !nextBlock.color && looksLikeSupportingSection(text)) {
                nextBlock.color = 'gray';
            }

            return nextBlock;
        });
    }

    function applyTemplatePageMetadata(action = null, { template = null, preset = null, context = null, question = '' } = {}) {
        if (!action || typeof action !== 'object') {
            return action;
        }

        const nextAction = {
            ...action,
        };
        const wantsDesignedPage = /\b(design|designed|polished|beautiful|styled|visual|notion|notion-like|dashboard|brief|report)\b/i.test(String(question || ''));
        const existingProperties = Array.isArray(context?.properties) ? context.properties : [];

        if (!nextAction.icon && (!hasMeaningfulPageIcon(context) || wantsDesignedPage) && preset?.pageIcon) {
            nextAction.icon = preset.pageIcon;
        }

        if ((!Array.isArray(nextAction.properties) || nextAction.properties.length === 0)
            && (existingProperties.length === 0 || wantsDesignedPage)) {
            nextAction.properties = buildTemplateMetadataSuggestions(template?.id || 'brief');
        }

        if (!nextAction.cover && !context?.hasCover) {
            const coverUrl = inferCoverUrlFromBlocks(nextAction.blocks);
            if (coverUrl) {
                nextAction.cover = coverUrl;
            }
        }

        return nextAction;
    }

    function extractSourceBookmarksFromToolEvents(toolEvents = []) {
        if (!Array.isArray(toolEvents) || toolEvents.length === 0) {
            return [];
        }

        const searchMetaByUrl = new Map();
        toolEvents.forEach((event) => {
            const toolId = event?.result?.toolId || event?.toolCall?.function?.name || '';
            if (toolId !== 'web-search' || event?.result?.success === false) {
                return;
            }

            const results = Array.isArray(event?.result?.data?.results) ? event.result.data.results : [];
            results.forEach((entry) => {
                const url = String(entry?.url || '').trim();
                if (!/^https?:\/\//i.test(url) || searchMetaByUrl.has(url)) {
                    return;
                }

                searchMetaByUrl.set(url, {
                    title: String(entry?.title || '').trim(),
                    description: truncateStructuredSummary(String(entry?.snippet || '').replace(/\s+/g, ' ').trim(), 180),
                });
            });
        });

        const seen = new Set();
        const bookmarks = [];

        toolEvents.forEach((event) => {
            const toolId = event?.result?.toolId || event?.toolCall?.function?.name || '';
            if (!['web-fetch', 'web-scrape'].includes(toolId) || event?.result?.success === false) {
                return;
            }

            const args = parseToolArguments(event?.toolCall?.function?.arguments);
            const data = event?.result?.data || {};
            const url = String(data.url || args.url || '').trim();
            if (!/^https?:\/\//i.test(url) || seen.has(url)) {
                return;
            }

            const searchMeta = searchMetaByUrl.get(url) || {};
            const rawExcerpt = toolId === 'web-fetch'
                ? stripHtmlToPlainText(data.body || '')
                : stripHtmlToPlainText(data.content || data.text || JSON.stringify(data.data || ''));

            bookmarks.push({
                url,
                title: String(data.title || searchMeta.title || '').trim(),
                description: truncateStructuredSummary(searchMeta.description || rawExcerpt, 180),
            });
            seen.add(url);
        });

        if (bookmarks.length < 3) {
            for (const [url, meta] of searchMetaByUrl.entries()) {
                if (seen.has(url)) {
                    continue;
                }

                bookmarks.push({
                    url,
                    title: meta.title || '',
                    description: meta.description || '',
                });
                seen.add(url);

                if (bookmarks.length >= 3) {
                    break;
                }
            }
        }

        return bookmarks
            .filter((bookmark) => bookmark.url)
            .slice(0, 3);
    }

    function ensureSourceBookmarkBlocks(blocks = [], { preset = null, toolEvents = [] } = {}) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return blocks;
        }

        const stats = analyzeStructuredBlocks(blocks);
        if (stats.typeCounts.bookmark > 0) {
            return blocks;
        }

        const bookmarks = extractSourceBookmarksFromToolEvents(toolEvents);
        if (!bookmarks.length) {
            return blocks;
        }

        const nextBlocks = blocks.map((block) => cloneStructuredValue(block));
        const bookmarkBlocks = bookmarks.map((bookmark) => ({
            type: 'bookmark',
            content: {
                url: bookmark.url,
                title: bookmark.title || bookmark.url,
                description: bookmark.description || '',
                favicon: '',
                image: '',
            },
        }));

        const sourceHeadingIndex = nextBlocks.findIndex((block) => {
            const type = canonicalizeBlockType(block?.type || '');
            return /^heading_/.test(type) && looksLikeSourceHeadingText(extractBlockDefinitionText(block));
        });

        if (sourceHeadingIndex >= 0) {
            let insertionHeadingIndex = sourceHeadingIndex;
            if (sourceHeadingIndex > 0 && canonicalizeBlockType(nextBlocks[sourceHeadingIndex - 1]?.type || '') !== 'divider' && nextBlocks.length >= 7) {
                nextBlocks.splice(sourceHeadingIndex, 0, { type: 'divider', content: '' });
                insertionHeadingIndex += 1;
            }
            nextBlocks.splice(insertionHeadingIndex + 1, 0, ...bookmarkBlocks);
            return nextBlocks;
        }

        if (nextBlocks.length >= 7 && canonicalizeBlockType(nextBlocks[nextBlocks.length - 1]?.type || '') !== 'divider') {
            nextBlocks.push({ type: 'divider', content: '' });
        }

        nextBlocks.push({
            type: 'heading_2',
            content: preset?.sourceHeading || 'Sources',
        });
        nextBlocks.push(...bookmarkBlocks);
        return nextBlocks;
    }

    function shouldApplyStructuredDesignUpgrade(blocks = [], { question = '', template = null } = {}) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return false;
        }

        const stats = analyzeStructuredBlocks(blocks);
        const structuralRequest = /\b(create|make|build|draft|write|turn|convert|organize|restructure|brief|report|guide|proposal|page|notes?)\b/i.test(String(question || ''));
        const substantial = stats.blockCount >= 6
            || stats.textChars >= 420
            || (stats.typeCounts.heading_2 || 0) >= 2
            || structuralRequest;

        if (!substantial) {
            return false;
        }

        switch (template?.id) {
            case 'research':
                return stats.typeCounts.callout === 0
                    || stats.typeCounts.bookmark === 0
                    || stats.visualSupportCount === 0
                    || stats.styledBlockCount === 0
                    || stats.layoutSupportCount < 3
                    || stats.longTextCount > 1;
            case 'project':
            case 'dashboard':
                return stats.typeCounts.callout === 0
                    || stats.styledBlockCount === 0
                    || stats.typeCounts.database === 0
                    || stats.typeCounts.todo === 0;
            case 'documentation':
                return stats.typeCounts.callout === 0
                    || stats.visualSupportCount === 0
                    || stats.styledBlockCount === 0
                    || ((stats.typeCounts.numbered_list || 0) === 0 && (stats.typeCounts.code || 0) === 0 && (stats.typeCounts.toggle || 0) === 0);
            case 'meeting':
                return stats.typeCounts.todo === 0 || stats.typeCounts.callout === 0 || stats.styledBlockCount === 0;
            default:
                return stats.typeCounts.callout === 0
                    || stats.visualSupportCount === 0
                    || stats.styledBlockCount === 0
                    || stats.layoutSupportCount < 2
                    || stats.longTextCount > 1;
        }
    }

    function enhanceStructuredPageActions(actions = [], question = '', context = null, toolEvents = []) {
        if (!Array.isArray(actions) || actions.length === 0) {
            return [];
        }

        return actions.map((action) => {
            if (!action || typeof action !== 'object') {
                return action;
            }

            const op = String(action.op || '').trim().toLowerCase();
            if (!['rebuild_page', 'replace_page'].includes(op) || !Array.isArray(action.blocks) || action.blocks.length === 0) {
                return action;
            }

            const generatedContext = buildPageContextFromGeneratedBlocks(action.blocks, context);
            const template = selectNotesPageTemplates(question, generatedContext, { limit: 1 })[0] || null;
            if (!shouldApplyStructuredDesignUpgrade(action.blocks, { question, template })) {
                return action;
            }

            const preset = getTemplateDesignPreset(template?.id);
            let nextBlocks = action.blocks.map((block) => cloneStructuredValue(block));
            nextBlocks = ensureTemplateCalloutBlock(nextBlocks, { template, preset, action, context, question });
            nextBlocks = ensureHeroVisualBlock(nextBlocks, { template, preset, action, context, question });
            nextBlocks = maybeConvertSupportNoteToToggle(nextBlocks, { template });
            nextBlocks = ensureSupportSectionDivider(nextBlocks, { template });
            nextBlocks = ensureSourceBookmarkBlocks(nextBlocks, { preset, toolEvents });
            nextBlocks = applyTemplateDesignDecorations(nextBlocks, { preset });

            const enhancedAction = {
                ...action,
                blocks: nextBlocks,
            };

            if (!enhancedAction.icon && preset?.pageIcon) {
                enhancedAction.icon = preset.pageIcon;
            }

            if (!enhancedAction.title) {
                const currentTitle = String(context?.title || '').trim();
                if (!currentTitle || /^untitled$/i.test(currentTitle)) {
                    const nextTitle = inferStructuredPageTitle({
                        blocks: nextBlocks,
                        action: enhancedAction,
                        context,
                        question,
                    });
                    if (nextTitle) {
                        enhancedAction.title = nextTitle;
                    }
                }
            }

            return applyTemplatePageMetadata(enhancedAction, {
                template,
                preset,
                context,
                question,
            });
        });
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
        const propertyList = Array.isArray(pageContext.properties) && pageContext.properties.length > 0
            ? pageContext.properties.map((prop) => `${prop.key}: ${prop.value}`).join(', ')
            : 'None';
        const outlineItems = pageContext.outline?.length || 0;
        const setupLines = [
            `Page title: ${pageContext.title || 'Untitled'}`,
            `Page id: ${pageContext.pageId || 'unknown'}`,
            `Page icon: ${pageContext.icon || '(none)'}`,
            `Has cover: ${pageContext.hasCover ? 'yes' : 'no'}`,
            `Block count: ${pageContext.blockCount}`,
            `Word count: ${pageContext.wordCount}`,
            `Reading time: ${pageContext.readingTime} min`,
            `Default model: ${pageContext.defaultModel || state.selectedModel}`,
            `Outline headings: ${outlineItems}`,
            `Properties: ${properties}`,
            `Property values: ${propertyList}`,
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
    function buildSystemPrompt(pageContext, requestContext = {}) {
        const question = String(requestContext?.question || '').trim();
        const templateMatches = selectNotesPageTemplates(question, pageContext, { limit: 2 });
        const pageSetup = buildPageSetupSummary(pageContext);
        const blockMap = buildPageContentSnapshot(pageContext);
        const pageContent = buildFullPageContentFromContext(pageContext).slice(0, 6000);
        const topLevelLayout = buildTopLevelLayoutSnapshot(pageContext);
        const blockPlaybook = buildBlockCapabilityPlaybook();
        const frontendFeatureGuide = buildFrontendFeatureGuide();
        const blockOpportunities = buildBlockOpportunityGuidance(question, pageContext, templateMatches);
        const designManual = buildNotesPageDesignManual();
        const templateChecklist = buildTemplateExecutionChecklist(templateMatches);
        const designCriteria = [
            buildPageDesignCriteria(pageContext),
            ...templateMatches.flatMap((template) => template.designRules.map((rule) => `- Template cue (${template.name}): ${rule}`)),
        ].filter(Boolean).join('\n');
        const templateGuidance = buildTemplateGuidance(question, pageContext, templateMatches);
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

TOP-LEVEL LAYOUT:
${topLevelLayout}

OUTLINE (Headings):
${outline}

CURRENT PAGE CONTENT (excerpt):
${pageContent || '(page is empty)'}

PAGE STATS:
${pageSetup}

BEST-FIT PAGE TEMPLATES:
${templateGuidance}

BLOCK CAPABILITY PLAYBOOK:
${blockPlaybook}

FRONTEND FEATURES YOU CAN USE:
${frontendFeatureGuide}

PAGE DESIGN MANUAL:
${designManual}

BLOCK OPPORTUNITIES FOR THIS REQUEST:
${blockOpportunities}

TEMPLATE EXECUTION CHECKLIST:
${templateChecklist}

PAGE DESIGN CRITERIA:
${designCriteria}

AVAILABLE ACTIONS - Respond with JSON:
When the user asks you to edit, create, delete, or reorganize content, respond with a JSON action block like this:

\`\`\`notes-actions
{
  "assistant_reply": "Brief, friendly explanation of what I did",
  "actions": [
    { "op": "update_page", "title": "Middle East Overnight Brief", "icon": "🌍" },
    { "op": "update_block", "blockId": "block_abc123", "type": "text", "content": "New content here" },
    { "op": "move_block", "blockId": "block_abc123", "targetBlockId": "block_xyz789", "position": "before" },
    { "op": "insert_after", "blockId": "block_abc123", "blocks": [{ "type": "heading_2", "content": "New Section" }] },
    { "op": "rebuild_page", "blocks": [{ "type": "heading_1", "content": "New Structure" }, { "type": "text", "content": "Fresh opening" }] },
    { "op": "delete_block", "blockId": "block_def456" },
    { "op": "append_to_page", "blocks": [{ "type": "text", "content": "Added at end" }] }
  ]
}
\`\`\`

VALID OPERATIONS:
- update_page: Update page-level metadata like title, icon, cover, properties, or page default model
- update_block: Change content of an existing block and optionally change its type in place (requires blockId; may include type and content)
- replace_block: Replace block with new block(s) (requires blockId, blocks array)
- move_block: Reorder an existing block relative to another block (requires blockId, targetBlockId, optional position "before"|"after")
- insert_after: Add new block(s) after specified block (requires blockId, blocks array)
- insert_before: Add new block(s) before specified block (requires blockId, blocks array)
- append_to_page: Add block(s) at end of page (requires blocks array)
- prepend_to_page: Add block(s) at start of page (requires blocks array)
- rebuild_page: Replace the full page body with a new block structure when a clean rebuild is better than incremental edits (requires blocks array)
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

BLOCK DESIGN HEURISTICS:
- Use heading blocks to create hierarchy before adding details.
- Use callout blocks for takeaways, warnings, decisions, or highlighted facts.
- Use bulleted or numbered lists for grouped items instead of long paragraphs.
- Use todo blocks for action items or checklists.
- Use quote blocks for direct excerpts or testimonial-style content.
- Use divider blocks to break up dense sections.
- Use image or ai_image blocks when visuals should live on the page, not in chat.
- Use mermaid blocks for flows, processes, systems, org charts, and diagrams.
- Use database blocks for comparison tables, trackers, or structured matrices.
- If headings, text, and bullets are the only blocks in a substantial page draft, you almost certainly have not used the full page palette yet.
- Before finalizing notes-actions, do a palette audit and check whether callout, database, bookmark, image/ai_image, mermaid, toggle, quote, todo, divider, code, or math would improve the page.
- For a polished Notion-like page, treat visual hierarchy as required work, not optional polish: use a focal block near the top, style section labels with textColor where helpful, and give secondary notes a quieter tone.
- Use the frontend metadata surface when it improves the result: page icon, cover URL, compact properties, and page default model are all available in notes mode.

GUIDELINES:
- Always reference blocks by their exact ID in [brackets]
- assistant_reply should be brief and user-friendly (not mention the JSON actions)
- The editor will automatically apply your actions and show the assistant_reply to the user
- Your default job in this interface is to edit the current notes page itself through block updates.
- When notes mode is active, the only supporting tools you may rely on are web-search, web-fetch, and web-scrape.
- Do not rely on document creation, artifact generation, filesystem writes, image tools, Git, deployment tools, or remote/server commands from this surface.
- Use any gathered web information only to update the current page blocks or to answer the user in chat while planning.
- When the user asks for page changes, put the final content into page blocks instead of replying with standalone HTML, artifact info, download links, or chat-only prose.
- Only stay in planning/chat mode when the user is explicitly brainstorming, outlining, asking for options, or says not to edit the page yet.
- When the user is brainstorming or asking for layout help, offer 2-3 template directions by name, explain the block structure briefly, and then adapt the chosen direction on the page.
- Only switch to standalone HTML/file/artifact output when the user explicitly asks for an export, download, link, attachment, or standalone file.
- You are free to change block types, replace weak sections, move blocks, delete redundant content, and rebuild the page structure when that produces a better result.
- In this notes interface, "page" means the current notes document unless the user explicitly says web page, site page, route, component, repo file, or server page.
- If the user says "put this on the page", "add this to the page", "insert this into the page", or similar, treat that as a request to edit the current notes page using notes-actions, not a request to inspect a remote server or codebase.
- Never satisfy a notes-page edit by writing a local repo/runtime file or by mentioning /app or filesystem write failures. Use notes-actions unless the user explicitly asks for an export, download, or file.
- Use \`\`\`notes-actions only when the user is actually asking to edit, create, delete, reorganize, or restyle page content.
- If the user is asking for remote execution, SSH work, cluster setup, deployment, debugging, research, or other non-page tasks, answer normally and use the available backend tools instead of forcing a notes-actions JSON response.
- For multi-step non-page work, keep ownership of the original ask and continue through the next concrete diagnostic, repair, and verification steps instead of turning each intermediate issue into a new user task.
- Treat intermediate SSH/server failures as part of the same troubleshooting chain. Do not stop to ask what to do next when the next reasonable remote action is implied by verified results.
- If SSH access or a prior SSH target is already established in the session, do not ask for host/user details again unless a tool failure shows the target is missing or incorrect.
- Ask the user only when blocked by missing secrets or credentials, a genuinely ambiguous product decision, or a destructive action that needs approval.
- For substantial page-writing requests such as briefs, reports, specs, plans, guides, proposals, or polished notes pages, work in passes: decide the sections first, then expand each section, then polish the full page before returning the final answer or notes-actions block.
- Choose a best-fit page template from the template guidance above and adapt it to the user's request instead of inventing the page layout from scratch every time.
- When building a full page, prefer a clear structure with headings first and then supporting blocks under each heading instead of one long undifferentiated dump.
- For non-trivial page builds, returns should usually involve multiple blocks with hierarchy, not a single oversized text block.
- If a generated text block would carry multiple sections, multiple ideas, or more than a short paragraph, split it into separate blocks before returning notes-actions.
- Do not ship a substantial page as only \`heading_*\` + \`text\` + list blocks unless the user explicitly asked for a minimal/plain layout.
- Research pages should usually use at least one richer support block such as \`callout\`, \`bookmark\`, \`image\`, \`ai_image\`, \`toggle\`, or \`database\` when the content supports it.
- When the user wants the page to feel polished, designed, or Notion-like, make the design visible in the returned blocks: page icon, a focal callout, a hero image/ai_image when the topic supports it, colored section labels, muted supporting notes, and a clear source or appendix cluster.
- Prefer structural edits over append-only edits when the page needs organization: use update_block to convert block types, replace_block to rebuild a section, move_block to reorder sections, and rebuild_page when the current layout should be replaced wholesale.
- It is acceptable to replace a single block with multiple blocks, or to rebuild the full page, if that is the clearest way to satisfy the request.
- In notes, Mermaid usually belongs as a mermaid block inside the page. Do not switch to a downloadable Mermaid artifact unless the user explicitly asks for a file, export, download, or shareable artifact.
- For text-like blocks, use plain strings for content
- For special blocks (todo, code, mermaid, image, bookmark), use structured objects
- You may include \`formatting\` on text-like blocks using \`{bold, italic, underline, strikethrough, code}\`.
- You may include \`children\` on blocks when nested content improves the page, especially under toggles.
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
        const trimmed = stripUnsafeNullCharacters(text).trim();
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

    function normalizeStructuredPayloadText(text = '') {
        return stripDiffStylePrefixes(unwrapCodeFence(text)).trim();
    }

    function isValidHiddenDraftPayload(payload = null) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return false;
        }

        const sections = Array.isArray(payload.sections) ? payload.sections : [];
        if (sections.length === 0) {
            return false;
        }

        return sections.some((section) => {
            if (!section || typeof section !== 'object' || Array.isArray(section)) {
                return false;
            }

            return typeof section.heading === 'string'
                || typeof section.goal === 'string'
                || typeof section.summary === 'string'
                || Array.isArray(section.keyPoints)
                || Array.isArray(section.blockTypes)
                || Array.isArray(section.suggestedBlocks);
        });
    }

    function shouldUseMultiPassNotesDraft(question = '', context = null, requestOptions = {}) {
        if (requestOptions?.outputFormat || isPlanningConversationIntent(question, context)) {
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

    function supportsStructuredNotesDrafting(modelId = '') {
        const normalized = String(modelId || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return !(
            /\bgpt-oss\b/.test(normalized)
            || /\boss\b/.test(normalized)
            || /\bgemini\b/.test(normalized)
            || /\bkimi\b/.test(normalized)
        );
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

    function hasExplicitExternalPageIntent(question = '') {
        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        if (/https?:\/\//.test(normalized)) {
            return true;
        }

        const externalTarget = /\b(site|website|web\s*page|homepage|landing\s*page|url)\b/.test(normalized);
        const externalVerb = /\b(look over|review|inspect|analyze|audit|browse|scrape|check|visit)\b/.test(normalized);
        return externalTarget && externalVerb;
    }

    function isPlanningConversationIntent(question = '', context = null) {
        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const planningPatterns = [
            /\b(help me|let'?s|lets|can we|could we|i want to|we should)\s+(plan|outline|brainstorm|think through|talk through|discuss|ideate|sketch out|map out)\b/,
            /\b(just|only)\s+(plan|outline|brainstorm|discuss)\b/,
            /\b(plan|outline|brainstorm|think through|talk through|discuss|ideate|sketch out|map out)\b[\s\S]{0,40}\b(before|first)\b/,
            /\b(before|first)\b[\s\S]{0,30}\b(edit|update|rewrite|apply|write|change|rebuild)\b/,
            /\b(do not|don't|dont|not)\b[\s\S]{0,20}\b(edit|update|rewrite|apply|write|change|rebuild)\b[\s\S]{0,20}\b(yet|first)\b/,
        ];
        const planningTarget = /\b(page|notes?|document|doc|brief|report|spec|guide|proposal|outline|section|content|html page|web page|landing page|website)\b/.test(normalized)
            || (context?.blockCount || 0) > 0
            || (context?.outline?.length || 0) > 0;

        return planningTarget && planningPatterns.some((pattern) => pattern.test(normalized));
    }

    function hasNonPageRuntimeIntent(question = '', requestOptions = {}) {
        if (requestOptions?.outputFormat) {
            return true;
        }

        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return hasExplicitExternalPageIntent(normalized)
            || /\b(ssh|remote|server|cluster|k8s|kubernetes|kubectl|deploy|deployment|docker|container|ingress|traefik|dns|tls|acme|cert|debug|troubleshoot|logs|research|search the web|browse|scrape|tool call|tool use)\b/.test(normalized);
    }

    function isImplicitPageBuildIntent(question = '', context = null, requestOptions = {}) {
        if (hasNonPageRuntimeIntent(question, requestOptions)) {
            return false;
        }

        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const pageWritingVerb = /\b(create|make|build|draft|write|expand|fill out|flesh out|continue|finish|polish|rewrite|turn|convert|organize|restructure|rework|improve|work on)\b/.test(normalized);
        const pageTarget = /\b(page|notes|note|document|doc|brief|report|spec|plan|guide|proposal|outline|section|content)\b/.test(normalized);
        const contextSurface = (context?.blockCount || 0) > 0 || (context?.outline?.length || 0) > 0;
        const asksForFullerContent = /\b(more detail|more details|fill it out|flesh it out|expand it|make it better|make it fuller|build it out|finish the page|work on the page)\b/.test(normalized);

        return (pageWritingVerb && (pageTarget || contextSurface)) || asksForFullerContent;
    }

    function shouldForcePageEditActions(question = '', context = null, requestOptions = {}) {
        if (isPlanningConversationIntent(question, context) || hasNonPageRuntimeIntent(question, requestOptions)) {
            return false;
        }

        return isExplicitPageEditIntent(question)
            || isImplicitPageBuildIntent(question, context, requestOptions)
            || shouldUseMultiPassNotesDraft(question, context, requestOptions);
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
        const excluded = stripUnsafeNullCharacters(excludeText).trim();

        for (let index = state.messages.length - 1; index >= 0; index -= 1) {
            const message = state.messages[index];
            if (!message || message.role !== 'assistant' || message.hidden || message.transient) {
                continue;
            }

            const content = unwrapGenericResponseContent(message.content || '');
            if (!content || content === excluded || looksLikeInternalNotesScaffold(content)) {
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

    function escapeMarkdownAltText(value = '') {
        return String(value || '')
            .replace(/\\/g, '\\\\')
            .replace(/\]/g, '\\]');
    }

    function buildMarkdownImageLine(url = '', altText = 'Image') {
        const normalizedUrl = String(url || '').trim();
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            return null;
        }

        const normalizedAlt = String(altText || '').replace(/\s+/g, ' ').trim() || 'Image';
        return `![${escapeMarkdownAltText(normalizedAlt)}](${normalizedUrl})`;
    }

    function looksLikeEmbeddableImageUrl(url = '') {
        const normalizedUrl = String(url || '').trim();
        if (!/^https?:\/\//i.test(normalizedUrl)) {
            return false;
        }

        if (/\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i.test(normalizedUrl)) {
            return true;
        }

        try {
            const parsed = new URL(normalizedUrl);
            const hostname = parsed.hostname.toLowerCase();
            if (/\/api\/artifacts\/[^/]+\/download\b/i.test(parsed.pathname)) {
                return true;
            }
            return /(?:^|\.)unsplash\.com$/.test(hostname) ||
                /(?:^|\.)oaiusercontent\.com$/.test(hostname) ||
                /(?:^|\.)openai\.com$/.test(hostname) ||
                /blob\.core\.windows\.net$/.test(hostname);
        } catch (_error) {
            return false;
        }
    }

    function buildArtifactDisplayUrl(path = '', options = {}) {
        const normalizedPath = String(path || '').trim();
        if (!normalizedPath) {
            return '';
        }

        try {
            const url = new URL(normalizedPath, window.location.origin);
            if (options.inline) {
                url.searchParams.set('inline', '1');
            }
            return url.toString();
        } catch (_error) {
            return '';
        }
    }

    function extractHostLabel(value = '') {
        try {
            return new URL(String(value || '').trim()).hostname.replace(/^www\./i, '');
        } catch (_error) {
            return '';
        }
    }

    function normalizeBlindArtifactItem(item, fallbackPrompt = '', fallbackHost = '') {
        if (!item || typeof item !== 'object') {
            return null;
        }

        const downloadUrl = buildArtifactDisplayUrl(item.downloadPath || item.downloadUrl || '');
        const inlineUrl = buildArtifactDisplayUrl(
            item.inlinePath || item.downloadPath || item.downloadUrl || '',
            { inline: true },
        );
        if (!downloadUrl || !inlineUrl) {
            return null;
        }

        const sourceHost = item.sourceHost || fallbackHost || '';
        const filename = item.filename || `captured-image-${item.index || 1}`;
        const alt = filename
            .replace(/\.[a-z0-9]{2,5}$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim() || fallbackPrompt || 'Captured image';

        return {
            artifactId: item.artifactId || null,
            filename,
            mimeType: item.mimeType || '',
            sizeBytes: item.sizeBytes || 0,
            sourceHost,
            downloadUrl,
            inlineUrl,
            imageUrl: inlineUrl,
            alt,
        };
    }

    function parseToolArguments(rawArgs) {
        if (!rawArgs) {
            return {};
        }

        if (typeof rawArgs === 'object') {
            return rawArgs;
        }

        if (typeof rawArgs !== 'string') {
            return {};
        }

        try {
            return JSON.parse(rawArgs);
        } catch (_error) {
            return {};
        }
    }

    function extractBlindArtifactSelectionsFromToolEvents(toolEvents = []) {
        if (!Array.isArray(toolEvents) || toolEvents.length === 0) {
            return [];
        }

        const selections = [];

        toolEvents.forEach((event) => {
            const toolId = event?.toolCall?.function?.name || event?.result?.toolId || '';
            if (toolId !== 'web-scrape') {
                return;
            }

            const args = parseToolArguments(event?.toolCall?.function?.arguments);
            const data = event?.result?.data || {};
            const imageCapture = data.imageCapture && typeof data.imageCapture === 'object'
                ? data.imageCapture
                : (event?.result?.imageCapture && typeof event.result.imageCapture === 'object'
                    ? event.result.imageCapture
                    : null);
            if (imageCapture?.mode !== 'blind-artifacts') {
                return;
            }

            const fallbackHost = extractHostLabel(data.url || args.url || '') || imageCapture.items?.[0]?.sourceHost || '';
            const items = (Array.isArray(imageCapture.items) ? imageCapture.items : [])
                .map((item) => normalizeBlindArtifactItem(item, data.title || data.url || args.url || '', fallbackHost))
                .filter(Boolean);
            if (items.length === 0) {
                return;
            }

            selections.push({
                prompt: data.title || data.url || args.url || `Captured images from ${fallbackHost || 'scraped page'}`,
                sourceHost: fallbackHost,
                items,
            });
        });

        return selections;
    }

    function isEmptyStarterBlock(block) {
        if (!block || block.type !== 'text' || (Array.isArray(block.children) && block.children.length > 0)) {
            return false;
        }

        return !extractBlockTextValue(block).trim();
    }

    function appendBlindArtifactSelectionBlocks(toolEvents = []) {
        const selections = extractBlindArtifactSelectionsFromToolEvents(toolEvents);
        if (!selections.length || !window.Blocks?.createBlock || !window.Editor?.getCurrentPage) {
            return { appliedCount: 0, selectionCount: 0, imageCount: 0 };
        }

        const page = window.Editor.getCurrentPage();
        if (!page) {
            return { appliedCount: 0, selectionCount: 0, imageCount: 0 };
        }

        const blocks = selections.map((selection) => window.Blocks.createBlock('ai_image', {
            prompt: selection.prompt,
            caption: '',
            imageUrl: null,
            model: null,
            size: '1536x1024',
            quality: 'standard',
            style: 'natural',
            source: 'artifact',
            status: 'search_results',
            unsplashResults: null,
            artifactResults: selection.items,
            selectedUnsplashId: null,
            selectedArtifactId: null,
            imageAssetId: null,
            artifactId: null,
            downloadUrl: null,
            sourceHost: selection.sourceHost || null,
        }));

        if (blocks.length === 0) {
            return { appliedCount: 0, selectionCount: 0, imageCount: 0 };
        }

        const existingBlocks = Array.isArray(page.blocks) ? page.blocks : [];
        const inserted = existingBlocks.length === 1 && isEmptyStarterBlock(existingBlocks[0])
            ? (window.Editor.replaceBlockWithBlocks?.(existingBlocks[0].id, blocks) || [])
            : (window.Editor.insertBlocksAfter?.(existingBlocks.length ? existingBlocks[existingBlocks.length - 1].id : null, blocks) || []);

        if (inserted.length > 0) {
            window.Editor.savePage?.();
        }

        return {
            appliedCount: inserted.length,
            selectionCount: inserted.length,
            imageCount: selections.reduce((total, selection) => total + selection.items.length, 0),
        };
    }

    function isImageLikePayload(value) {
        if (!value || typeof value !== 'object') {
            return false;
        }

        return Object.prototype.hasOwnProperty.call(value, 'imageUrl') ||
            Object.prototype.hasOwnProperty.call(value, 'thumbUrl') ||
            Object.prototype.hasOwnProperty.call(value, 'b64_json') ||
            Object.prototype.hasOwnProperty.call(value, 'markdownImage') ||
            Object.prototype.hasOwnProperty.call(value, 'markdownImages') ||
            Object.prototype.hasOwnProperty.call(value, 'images') ||
            Object.prototype.hasOwnProperty.call(value, 'image') ||
            Object.prototype.hasOwnProperty.call(value, 'alt') ||
            Object.prototype.hasOwnProperty.call(value, 'prompt') ||
            Object.prototype.hasOwnProperty.call(value, 'revisedPrompt') ||
            /^(generated|unsplash|artifact|url)$/i.test(String(value.source || '').trim()) ||
            looksLikeEmbeddableImageUrl(value.url || value.normalizedUrl || '');
    }

    function parseMarkdownImageDestination(destination = '') {
        let value = String(destination || '').trim();
        if (!value) {
            return { url: '', title: '' };
        }

        if (/^<[^>]+>$/.test(value)) {
            value = value.slice(1, -1).trim();
        }

        let title = '';
        const titleMatch = value.match(/\s+(["'])(.*?)\1\s*$/);
        if (titleMatch) {
            title = titleMatch[2].trim();
            value = value.slice(0, titleMatch.index).trim();
        }

        return {
            url: value,
            title
        };
    }

    function buildBlockFromMarkdownImage(altText = '', destination = '') {
        const { url, title } = parseMarkdownImageDestination(destination);
        if (!/^https?:\/\//i.test(url)) {
            return null;
        }

        const normalizedAlt = String(altText || '').trim();
        const normalizedTitle = String(title || '').trim();
        const isExplicitAIImage = /^ai(?:\s+image)?:\s*/i.test(normalizedAlt);
        const promptText = normalizedAlt.replace(/^ai(?:\s+image)?:\s*/i, '').trim();
        const caption = promptText || normalizedAlt || normalizedTitle;
        let hostname = '';
        try {
            hostname = new URL(url).hostname;
        } catch (_error) {
            hostname = '';
        }

        if (isExplicitAIImage || /(?:^|\.)unsplash\.com$/i.test(hostname)) {
            const isUnsplashPhotoPage = /(?:^|\.)unsplash\.com$/i.test(hostname) && /\/photos\/[^/?#]+/i.test(url);
            return {
                type: 'ai_image',
                content: {
                    prompt: caption || (isExplicitAIImage ? 'AI image' : 'Unsplash image'),
                    caption: normalizedTitle || caption || '',
                    imageUrl: isUnsplashPhotoPage ? null : url,
                    model: null,
                    size: isExplicitAIImage ? '1024x1024' : '1536x1024',
                    quality: 'standard',
                    style: isExplicitAIImage ? 'vivid' : 'natural',
                    source: isExplicitAIImage ? 'ai' : 'unsplash',
                    status: isUnsplashPhotoPage ? 'pending' : 'done',
                    unsplashResults: null,
                    selectedUnsplashId: null,
                    unsplashPhotographer: null,
                    unsplashPhotographerUrl: null,
                    imageAssetId: null,
                    downloadUrl: isUnsplashPhotoPage ? url : null,
                }
            };
        }

        return {
            type: 'image',
            content: {
                url,
                caption: normalizedAlt || normalizedTitle || ''
            }
        };
    }

    function extractMarkdownImageBlocksFromLine(line = '') {
        const source = String(line || '').trim();
        if (!source.startsWith('![')) {
            return [];
        }

        const matches = [...source.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
        if (matches.length === 0) {
            return [];
        }

        let cursor = 0;
        const blocks = [];

        for (const match of matches) {
            if (source.slice(cursor, match.index).trim()) {
                return [];
            }

            const block = buildBlockFromMarkdownImage(match[1], match[2]);
            if (!block) {
                return [];
            }

            blocks.push(block);
            cursor = match.index + match[0].length;
        }

        if (source.slice(cursor).trim()) {
            return [];
        }

        return blocks;
    }

    function extractMarkdownImageContent(value, seen = new WeakSet()) {
        if (value == null) {
            return null;
        }

        if (typeof value === 'string') {
            const normalized = value.trim();
            return normalized.startsWith('![') ? normalized : null;
        }

        if (typeof value !== 'object') {
            return null;
        }

        if (seen.has(value)) {
            return null;
        }
        seen.add(value);

        if (Array.isArray(value)) {
            const arrayImages = value
                .map((entry) => extractMarkdownImageContent(entry, seen))
                .filter(Boolean);
            return arrayImages.length ? arrayImages.join('\n\n') : null;
        }

        if (typeof value.markdownImage === 'string' && value.markdownImage.trim()) {
            return value.markdownImage.trim();
        }

        if (Array.isArray(value.markdownImages)) {
            const markdownImages = value.markdownImages
                .map((entry) => typeof entry === 'string' ? entry.trim() : '')
                .filter(Boolean);
            if (markdownImages.length) {
                return markdownImages.join('\n\n');
            }
        }

        const collectedImages = [];

        if (value.image && typeof value.image === 'object') {
            const singleImage = buildMarkdownImageLine(
                value.image.url || value.image.imageUrl || value.image.normalizedUrl || '',
                value.image.alt || value.image.prompt || value.image.caption || value.image.title || 'Image'
            );
            if (singleImage) {
                collectedImages.push(singleImage);
            }
        }

        if (Array.isArray(value.images)) {
            value.images.forEach((image) => {
                if (!image || typeof image !== 'object') return;
                const markdownImage = buildMarkdownImageLine(
                    image.url || image.imageUrl || image.normalizedUrl || image.thumbUrl || '',
                    image.alt || image.prompt || image.caption || image.title || value.query || 'Image'
                );
                if (markdownImage) {
                    collectedImages.push(markdownImage);
                }
            });
        }

        if (!collectedImages.length) {
            const directImageUrl = value.url || value.imageUrl || value.normalizedUrl || '';
            const directImage = buildMarkdownImageLine(
                isImageLikePayload(value) && looksLikeEmbeddableImageUrl(directImageUrl) ? directImageUrl : '',
                value.alt || value.prompt || value.caption || value.title || value.query || value.description || value.text || 'Image'
            );
            if (directImage) {
                collectedImages.push(directImage);
            }
        }

        return collectedImages.length ? collectedImages.join('\n\n') : null;
    }

    function scoreFallbackBlocks(blocks = []) {
        return blocks.reduce((score, block) => {
            const type = block?.type;
            if (!type) {
                return score;
            }

            let nextScore = score + 1;
            if (['image', 'ai_image', 'bookmark', 'database'].includes(type)) nextScore += 8;
            if (['heading_1', 'heading_2', 'heading_3', 'callout', 'quote'].includes(type)) nextScore += 2;
            if (type === 'divider') nextScore += 0.5;
            if (type === 'code') nextScore -= 0.5;
            return nextScore;
        }, 0);
    }

    function selectPreferredFallbackBlocks(importedBlocks = [], richTextBlocks = []) {
        if (!importedBlocks.length) return richTextBlocks;
        if (!richTextBlocks.length) return importedBlocks;

        const importedHasMedia = importedBlocks.some((block) => ['image', 'ai_image', 'bookmark', 'database'].includes(block?.type));
        const richTextHasMedia = richTextBlocks.some((block) => ['image', 'ai_image', 'bookmark', 'database'].includes(block?.type));

        if (importedHasMedia !== richTextHasMedia) {
            return importedHasMedia ? importedBlocks : richTextBlocks;
        }

        const importedScore = scoreFallbackBlocks(importedBlocks);
        const richTextScore = scoreFallbackBlocks(richTextBlocks);

        if (importedScore === richTextScore) {
            return richTextBlocks.length >= importedBlocks.length ? richTextBlocks : importedBlocks;
        }

        return richTextScore > importedScore ? richTextBlocks : importedBlocks;
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

            const markdownImageBlocks = extractMarkdownImageBlocksFromLine(line);
            if (markdownImageBlocks.length > 0) {
                blocks.push(...markdownImageBlocks);
                index += 1;
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

    function shouldPreferRebuildFallback(question = '', context = null, blocks = [], sourceText = '') {
        const normalized = String(question || '').trim().toLowerCase();
        const existingBlockCount = Number(context?.blockCount || 0);
        const generatedBlockCount = Array.isArray(blocks) ? blocks.length : 0;
        const substantialText = String(sourceText || '').trim().length > 500;
        const structuralRequest = /\b(create|make|build|draft|write|expand|fill out|flesh out|turn|convert|organize|restructure|report|brief|spec|plan|guide|proposal|page)\b/.test(normalized);

        return pageHasOnlyPlaceholderContent()
            || (generatedBlockCount >= 4 && (existingBlockCount <= 3 || structuralRequest))
            || (substantialText && existingBlockCount <= 2);
    }

    function buildFallbackNotesActionsFromText(question = '', sourceText = '', context = null) {
        if (looksLikeInternalNotesScaffold(sourceText)) {
            return null;
        }

        const { importedPage, blocks } = extractPreferredBlocksFromSourceText(sourceText);

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

        if (shouldPreferRebuildFallback(question, context, blocks, sourceText)) {
            const rebuildAction = {
                op: 'rebuild_page',
                blocks
            };

            if (importedTitle) {
                rebuildAction.title = importedTitle;
            }

            actions.push(rebuildAction);
        } else if (pageHasOnlyPlaceholderContent()) {
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

    function extractPreferredBlocksFromSourceText(sourceText = '') {
        const normalizedSourceText = stripUnsafeNullCharacters(sourceText);
        const importedPage = window.ImportExport?.importFromMarkdown?.(normalizedSourceText);
        const importedBlocks = Array.isArray(importedPage?.blocks)
            ? importedPage.blocks.filter((block) => extractBlockTextValue(block).trim() || ['divider', 'image', 'ai_image'].includes(block.type))
            : [];
        const richTextBlocks = buildBlocksFromRichText(normalizedSourceText);

        return {
            importedPage,
            blocks: selectPreferredFallbackBlocks(importedBlocks, richTextBlocks)
        };
    }

    function buildFallbackPageEditResponse(question = '', responseText = '', context = null) {
        const directResponse = unwrapGenericResponseContent(responseText);
        const preferredSource = directResponse && !looksLikeShortAcknowledgement(directResponse)
            ? directResponse
            : getLastSubstantialAssistantMessage(directResponse);
        const actions = buildFallbackNotesActionsFromText(question, preferredSource, context);

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

    function splitPlainTextIntoParagraphBlocks(sourceText = '') {
        const normalized = stripUnsafeNullCharacters(sourceText).replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length < 320) {
            return [];
        }

        const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g)
            ?.map((sentence) => sentence.trim())
            .filter(Boolean) || [];
        if (sentences.length < 2) {
            return [];
        }

        const blocks = [];
        let currentChunk = '';

        sentences.forEach((sentence) => {
            const nextChunk = currentChunk ? `${currentChunk} ${sentence}` : sentence;
            const sentenceCount = currentChunk ? currentChunk.match(/[^.!?]+(?:[.!?]+|$)/g)?.length || 0 : 0;
            if (currentChunk && (nextChunk.length > 260 || sentenceCount >= 2)) {
                blocks.push({
                    type: 'text',
                    content: currentChunk.trim()
                });
                currentChunk = sentence;
                return;
            }

            currentChunk = nextChunk;
        });

        if (currentChunk.trim()) {
            blocks.push({
                type: 'text',
                content: currentChunk.trim()
            });
        }

        return blocks.length > 1 ? blocks : [];
    }

    function shouldExpandSingleBlockText(sourceText = '', question = '', context = null) {
        const normalized = stripUnsafeNullCharacters(sourceText).trim();
        if (!normalized) {
            return false;
        }

        if (/\n\s*\n/.test(normalized) || /^#{1,3}\s+/m.test(normalized) || /^[-*]\s+/m.test(normalized) || /^\d+\.\s+/m.test(normalized)) {
            return true;
        }

        return shouldForcePageEditActions(question, context, {}) && normalized.length >= 320;
    }

    function expandStructuredPageTextIntoBlocks(sourceText = '', question = '', context = null) {
        const normalized = stripUnsafeNullCharacters(sourceText).trim();
        if (!normalized) {
            return [];
        }

        const preferredBlocks = extractPreferredBlocksFromSourceText(normalized).blocks;
        if (preferredBlocks.length > 1 || preferredBlocks.some((block) => block?.type !== 'text')) {
            return preferredBlocks;
        }

        if (!shouldExpandSingleBlockText(normalized, question, context)) {
            return preferredBlocks;
        }

        const paragraphBlocks = splitPlainTextIntoParagraphBlocks(normalized);
        return paragraphBlocks.length > 1 ? paragraphBlocks : preferredBlocks;
    }

    function normalizeStructuredPageActions(actions = [], question = '', context = null, toolEvents = []) {
        if (!Array.isArray(actions) || actions.length === 0) {
            return [];
        }

        const expandedActions = actions.map((action) => {
            if (!action || typeof action !== 'object') {
                return action;
            }

            const op = String(action.op || '').trim().toLowerCase();
            const blockDefinitions = Array.isArray(action.blocks)
                ? action.blocks
                : (action.block && typeof action.block === 'object' ? [action.block] : []);

            const getSingleTextSource = (block) => {
                if (!block || typeof block !== 'object') {
                    return '';
                }

                const type = canonicalizeBlockType(block.type || action.type || 'text');
                if (type !== 'text') {
                    return '';
                }

                if (typeof block.content === 'string') {
                    return block.content;
                }

                if (typeof block.text === 'string') {
                    return block.text;
                }

                return '';
            };

            if (op === 'update_block') {
                const sourceText = typeof action.content === 'string'
                    ? action.content
                    : (typeof action.text === 'string' ? action.text : '');
                const expandedBlocks = expandStructuredPageTextIntoBlocks(sourceText, question, context);
                if (expandedBlocks.length > 1) {
                    return {
                        ...action,
                        op: 'replace_block',
                        blocks: expandedBlocks,
                    };
                }
                return action;
            }

            if (!['replace_block', 'rebuild_page', 'append_to_page', 'prepend_to_page', 'insert_after', 'insert_before'].includes(op)) {
                return action;
            }

            if (blockDefinitions.length !== 1) {
                return action;
            }

            const sourceText = getSingleTextSource(blockDefinitions[0]);
            const expandedBlocks = expandStructuredPageTextIntoBlocks(sourceText, question, context);
            if (expandedBlocks.length <= 1) {
                return action;
            }

            return {
                ...action,
                blocks: expandedBlocks,
            };
        });

        return enhanceStructuredPageActions(expandedActions, question, context, toolEvents);
    }

    async function repairNotesPageEditResponse({
        apiClient,
        model,
        systemPrompt,
        question,
        previousResponse,
        requestOptions = {},
    }) {
        const repairPrompt = `${systemPrompt}

Repair pass: the previous assistant reply did not apply changes to the current notes page.
Return only a valid JSON notes-actions payload.
Do not return plain chat prose outside the JSON payload.
If the previous reply drifted into HTML, artifact creation, download links, or standalone file language, ignore that and convert the answer into direct page edits.
If the request is for a substantial page, brief, report, plan, or rewrite, prefer rebuild_page or replace_block over a tiny append.`;

        const repairResponse = await apiClient.chat([
            { role: 'system', content: repairPrompt },
            {
                role: 'user',
                content: `Original request:\n${question}\n\nPrevious failed reply:\n${previousResponse || '(empty)'}\n\nReturn notes-actions that directly update the current notes page.`
            }
        ], model, requestOptions);

        if (repairResponse?.error) {
            throw new Error(repairResponse.content || 'Notes repair pass failed');
        }

        return repairResponse?.content || '';
    }

    function summarizeAppliedNotesActions(actions = [], appliedCount = 0) {
        const normalizedActions = Array.isArray(actions) ? actions : [];
        if (normalizedActions.length === 0 || appliedCount <= 0) {
            return '';
        }

        const insertedBlockCount = normalizedActions.reduce((total, action) => {
            if (Array.isArray(action?.blocks)) {
                return total + action.blocks.length;
            }
            return total + (action?.content ? 1 : 0);
        }, 0);

        if (normalizedActions.some((action) => action?.op === 'rebuild_page' || action?.op === 'replace_page')) {
            return insertedBlockCount > 0
                ? `Rebuilt the page with ${insertedBlockCount} block${insertedBlockCount === 1 ? '' : 's'}.`
                : 'Rebuilt the page structure.';
        }

        if (normalizedActions.some((action) => action?.op === 'replace_block')) {
            return insertedBlockCount > 0
                ? `Reworked the page with ${insertedBlockCount} updated block${insertedBlockCount === 1 ? '' : 's'}.`
                : `Updated ${appliedCount} page change${appliedCount === 1 ? '' : 's'}.`;
        }

        if (normalizedActions.some((action) => ['append_to_page', 'prepend_to_page', 'insert_after', 'insert_before'].includes(action?.op))) {
            return insertedBlockCount > 0
                ? `Added ${insertedBlockCount} new block${insertedBlockCount === 1 ? '' : 's'} to the page.`
                : `Added content to the page in ${appliedCount} step${appliedCount === 1 ? '' : 's'}.`;
        }

        if (normalizedActions.some((action) => action?.op === 'update_block')) {
            return `Updated ${appliedCount} block${appliedCount === 1 ? '' : 's'} on the page.`;
        }

        return `Applied ${appliedCount} page change${appliedCount === 1 ? '' : 's'}.`;
    }

    function normalizeHiddenDraftResult(text = '', fallback = null) {
        const parsed = safeJsonParse(text);
        if (isValidHiddenDraftPayload(parsed)) {
            return JSON.stringify(parsed, null, 2);
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
Do not plan filesystem writes, repo paths, or local file creation.
Return JSON only in this shape:
{
  "templateId": "brief",
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
Do not plan filesystem writes, repo paths, or local file creation.
You will receive the original request plus the approved page plan.
Keep the chosen template consistent while expanding sections.
Return JSON only in this shape:
{
  "templateId": "brief",
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
Do not mention local file writes, /app paths, or filesystem errors.
If the user is editing the page, return notes-actions as needed.
Do not switch this final pass into standalone HTML, artifact output, or download-link language unless the user explicitly asked for that.`
            },
            {
                role: 'user',
                content: `${question}

Use this approved page plan:
${normalizedPlan}

Use these expanded section briefs:
${normalizedExpansion}

Preserve the chosen template's layout rhythm and block variety.
Build the page in a structured, polished way instead of one-shotting the whole document.`
            }
        ];
    }

    function normalizeActionContent(type, content) {
        const value = sanitizeStructuredValue(content == null ? '' : content);

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
                    const hasSearchResults =
                        (Array.isArray(value.unsplashResults) && value.unsplashResults.length > 0) ||
                        (Array.isArray(value.artifactResults) && value.artifactResults.length > 0);
                    const hasImage = Boolean(value.imageUrl || value.url || value.imageAssetId);
                    return {
                        prompt: coerceTextValue(value.prompt || value.text || value.description || ''),
                        caption: coerceTextValue(value.caption || ''),
                        imageUrl: value.imageUrl || value.url || null,
                        model: value.model || null,
                        size: value.size || '1024x1024',
                        quality: value.quality || 'standard',
                        style: value.style || 'vivid',
                        source: value.source === 'unsplash' ? 'unsplash' : (value.source === 'artifact' ? 'artifact' : 'ai'),
                        status: value.status || (hasSearchResults ? 'search_results' : (hasImage ? 'done' : 'pending')),
                        unsplashResults: Array.isArray(value.unsplashResults) && value.unsplashResults.length > 0 ? value.unsplashResults : null,
                        artifactResults: Array.isArray(value.artifactResults) && value.artifactResults.length > 0 ? value.artifactResults : null,
                        selectedUnsplashId: value.selectedUnsplashId || null,
                        selectedArtifactId: value.selectedArtifactId || null,
                        unsplashPhotographer: value.unsplashPhotographer || null,
                        unsplashPhotographerUrl: value.unsplashPhotographerUrl || null,
                        imageAssetId: value.imageAssetId || null,
                        artifactId: value.artifactId || null,
                        downloadUrl: value.downloadUrl || null,
                        sourceHost: value.sourceHost || null,
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
                    artifactResults: null,
                    selectedUnsplashId: null,
                    selectedArtifactId: null,
                    unsplashPhotographer: null,
                    unsplashPhotographerUrl: null,
                    imageAssetId: null,
                    artifactId: null,
                    downloadUrl: null,
                    sourceHost: null,
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
                return typeof value === 'string' ? value : stripUnsafeNullCharacters(String(value || ''));
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
                        artifactResults: definition.artifactResults || null,
                        selectedUnsplashId: definition.selectedUnsplashId || null,
                        selectedArtifactId: definition.selectedArtifactId || null,
                        unsplashPhotographer: definition.unsplashPhotographer || null,
                        unsplashPhotographerUrl: definition.unsplashPhotographerUrl || null,
                        imageAssetId: definition.imageAssetId || null,
                        artifactId: definition.artifactId || null,
                        downloadUrl: definition.downloadUrl || null,
                        sourceHost: definition.sourceHost || null,
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

    function buildBlocksFromLegacyActionContent(rawAction = {}) {
        if (Array.isArray(rawAction.blocks) && rawAction.blocks.length > 0) {
            return rawAction.blocks;
        }

        if (rawAction.block && typeof rawAction.block === 'object') {
            return [rawAction.block];
        }

        const textSource = [
            rawAction.content,
            rawAction.markdown,
            rawAction.text,
            rawAction.body,
            rawAction.result
        ].find((value) => typeof value === 'string' && value.trim());

        if (!textSource) {
            return [];
        }

        return extractPreferredBlocksFromSourceText(textSource).blocks;
    }

    function normalizeLegacyNotesAction(rawAction) {
        if (!rawAction || typeof rawAction !== 'object') {
            return null;
        }

        const op = String(rawAction.op || rawAction.action || rawAction.operation || '').trim().toLowerCase();
        const normalizedAction = {
            ...rawAction,
            op: rawAction.op || rawAction.action || rawAction.operation || ''
        };

        switch (op) {
            case 'replace-content':
            case 'replace_content': {
                const blocks = buildBlocksFromLegacyActionContent(rawAction);
                if (!blocks.length) {
                    return null;
                }

                return {
                    ...normalizedAction,
                    op: 'rebuild_page',
                    blocks
                };
            }
            case 'append-content':
            case 'append_content': {
                const blocks = buildBlocksFromLegacyActionContent(rawAction);
                if (!blocks.length) {
                    return null;
                }

                return {
                    ...normalizedAction,
                    op: 'append_to_page',
                    blocks
                };
            }
            case 'prepend-content':
            case 'prepend_content': {
                const blocks = buildBlocksFromLegacyActionContent(rawAction);
                if (!blocks.length) {
                    return null;
                }

                return {
                    ...normalizedAction,
                    op: 'prepend_to_page',
                    blocks
                };
            }
            default:
                return normalizedAction.op ? normalizedAction : null;
        }
    }

    function buildImplicitNotesActionsFromPayload(payload) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return null;
        }

        const directAction = normalizeLegacyNotesAction(payload);
        if (directAction) {
            return [directAction];
        }

        const pageLikeBlocks = Array.isArray(payload.blocks)
            ? payload.blocks
            : (Array.isArray(payload.page?.blocks)
                ? payload.page.blocks
                : (Array.isArray(payload.document?.blocks)
                    ? payload.document.blocks
                    : null));
        if (Array.isArray(pageLikeBlocks) && pageLikeBlocks.length > 0) {
            return [{
                op: 'rebuild_page',
                blocks: pageLikeBlocks
            }];
        }

        const textSource = [
            payload.content,
            payload.markdown,
            payload.text,
            payload.body,
            payload.result,
            payload.output,
            payload.page?.content,
            payload.document?.content
        ].find((value) => typeof value === 'string' && value.trim());
        if (!textSource) {
            return null;
        }

        const blocks = extractPreferredBlocksFromSourceText(textSource).blocks;
        if (!blocks.length) {
            return null;
        }

        return [{
            op: 'rebuild_page',
            blocks
        }];
    }

    function getNotesPayloadActions(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const actions = Array.isArray(payload.actions)
            ? payload.actions
            : (Array.isArray(payload.operations)
                ? payload.operations
                : (Array.isArray(payload.edits)
                    ? payload.edits
                    : (Array.isArray(payload['notes-actions'])
                        ? payload['notes-actions']
                        : null)));

        if (!Array.isArray(actions)) {
            return buildImplicitNotesActionsFromPayload(payload);
        }

        return actions
            .map((action) => normalizeLegacyNotesAction(action))
            .filter(Boolean);
    }

    function getNotesPayloadReply(payload) {
        if (!payload || typeof payload !== 'object') {
            return '';
        }

        return String(
            payload.assistant_reply
            || payload.assistantReply
            || payload.assistantMessage
            || payload.reply
            || payload.message
            || ''
        ).trim();
    }

    function tryParseNotesActionPayload(payloadText) {
        if (!payloadText) return null;

        try {
            const payload = JSON.parse(normalizeStructuredPayloadText(payloadText));
            if (Array.isArray(payload)) {
                const normalizedActions = payload
                    .map((action) => normalizeLegacyNotesAction(action))
                    .filter(Boolean);
                if (normalizedActions.length > 0) {
                    return {
                        displayText: '',
                        actions: normalizedActions
                    };
                }
                return null;
            }

            const actions = getNotesPayloadActions(payload);
            if (payload && typeof payload === 'object' && Array.isArray(actions)) {
                return {
                    displayText: getNotesPayloadReply(payload),
                    actions
                };
            }
        } catch (_error) {
            return null;
        }

        return null;
    }

    function stripDiffStylePrefixes(text = '') {
        const source = stripUnsafeNullCharacters(text);
        const lines = source.split(/\r?\n/);
        const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
        if (nonEmptyLines.length === 0) {
            return source.trim();
        }

        const prefixedLines = nonEmptyLines.filter((line) => /^\s*\+\s?/.test(line));
        if (prefixedLines.length < 3 || prefixedLines.length < Math.ceil(nonEmptyLines.length * 0.4)) {
            return source.trim();
        }

        return lines
            .map((line) => line.replace(/^\s*\+\s?/, ''))
            .join('\n')
            .trim();
    }

    function isAssistantReplyPlaceholderText(text = '') {
        const normalized = String(text || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return /^<\s*assistant(?:\s+reply)?\s*\/?>$/i.test(normalized)
            || normalized === 'assistant reply'
            || normalized === 'assistant_reply';
    }

    function parseLooseJsonValue(value) {
        if (!value || typeof value !== 'string') {
            return null;
        }

        try {
            return JSON.parse(stripUnsafeNullCharacters(value));
        } catch (_error) {
            return null;
        }
    }

    function looksLikeBlockTypeToken(value = '') {
        const normalized = String(value || '').trim();
        if (!normalized || /\s/.test(normalized)) {
            return false;
        }

        const canonical = canonicalizeBlockType(normalized);
        return [
            'text',
            'heading_1',
            'heading_2',
            'heading_3',
            'bulleted_list',
            'numbered_list',
            'todo',
            'code',
            'quote',
            'callout',
            'divider',
            'mermaid',
            'image',
            'ai_image',
            'bookmark',
            'database',
            'ai',
            'toggle',
            'math',
        ].includes(canonical);
    }

    function extractFunctionPayloadText(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }

        const type = String(value.type || '').trim().toLowerCase();
        const functionName = String(value.name || value.function?.name || '').trim();
        if (type !== 'function' && !functionName) {
            return null;
        }

        const candidateSources = [
            value.parameters,
            value.arguments,
            value.function?.arguments,
            value.function?.parameters,
        ];

        for (const source of candidateSources) {
            const parsed = typeof source === 'string'
                ? parseLooseJsonValue(source)
                : source;
            if (!parsed || typeof parsed !== 'object') {
                continue;
            }

            const functionText = [
                parsed.notes_page_update,
                parsed.assistant_reply,
                parsed.assistantReply,
                parsed.message,
                parsed.content,
                parsed.text,
                parsed.result,
                parsed.response,
                parsed.output_text,
                parsed.outputText,
            ].find((entry) => typeof entry === 'string' && entry.trim() && !isAssistantReplyPlaceholderText(entry));

            if (functionText) {
                const normalizedFunctionText = stripUnsafeNullCharacters(functionText).trim();
                return looksLikeInternalNotesScaffold(normalizedFunctionText) ? null : normalizedFunctionText;
            }
        }

        return null;
    }

    function extractGenericWrapperContent(value) {
        if (typeof value === 'string') {
            const trimmed = stripUnsafeNullCharacters(value).trim();
            if (!trimmed) {
                return null;
            }

            const parsedPayload = tryParseGenericContentPayload(trimmed);
            if (parsedPayload?.displayText && !looksLikeInternalNotesScaffold(parsedPayload.displayText)) {
                return parsedPayload.displayText;
            }

            if (looksLikeBlockTypeToken(trimmed)) {
                return null;
            }

            return (isAssistantReplyPlaceholderText(trimmed) || looksLikeInternalNotesScaffold(trimmed)) ? null : trimmed;
        }

        if (value == null) {
            return null;
        }

        if (Array.isArray(value)) {
            for (const item of value) {
                const extracted = extractGenericWrapperContent(item);
                if (extracted) {
                    return extracted;
                }
            }
            return null;
        }

        if (typeof value !== 'object') {
            return null;
        }

        const functionPayloadText = extractFunctionPayloadText(value);
        if (functionPayloadText) {
            return functionPayloadText;
        }

        const imageMarkdown = extractMarkdownImageContent(value);

        const directKeys = ['content', 'text', 'message', 'result', 'response', 'output', 'output_text', 'outputText', 'markdown'];
        let primaryText = null;
        for (const key of directKeys) {
            if (typeof value[key] === 'string' && value[key].trim() && !isAssistantReplyPlaceholderText(value[key])) {
                const candidateText = extractGenericWrapperContent(value[key])
                    || stripUnsafeNullCharacters(value[key]).trim();
                if (!looksLikeInternalNotesScaffold(candidateText)) {
                    primaryText = candidateText;
                    break;
                }
            }
        }

        if (primaryText && imageMarkdown && !primaryText.includes('![')) {
            return `${primaryText}\n\n${imageMarkdown}`.trim();
        }

        if (primaryText) {
            return primaryText;
        }

        if (imageMarkdown) {
            return imageMarkdown;
        }

        const nestedKeys = [
            'content',
            'output',
            'payload',
            'data',
            'item',
            'items',
            'value',
            'result',
            'details',
            'toolResult',
        ];
        for (const key of nestedKeys) {
            const extracted = extractGenericWrapperContent(value[key]);
            if (extracted) {
                return extracted;
            }
        }

        return null;
    }

    function tryParseGenericContentPayload(payloadText) {
        if (!payloadText) {
            return null;
        }

        const cleanedText = stripDiffStylePrefixes(unwrapCodeFence(payloadText));
        if (!cleanedText) {
            return null;
        }

        try {
            const payload = JSON.parse(cleanedText);
            if (payload && typeof payload === 'object' && Array.isArray(payload.actions)) {
                return null;
            }
            if (Array.isArray(payload) && payload.every((item) => typeof item === 'string' && looksLikeBlockTypeToken(item))) {
                return null;
            }
            if (Array.isArray(payload) && payload.some((item) => isNotesBlockDefinition(item))) {
                return null;
            }
            if (isNotesBlockDefinition(payload)) {
                return null;
            }

            const content = extractGenericWrapperContent(payload);
            if (!content || looksLikeInternalNotesScaffold(content)) {
                return null;
            }

            return {
                displayText: content,
                actions: []
            };
        } catch (_error) {
            return null;
        }
    }

    function findBalancedGenericContentPayload(text) {
        const source = stripDiffStylePrefixes(text);
        if (!source.includes('{') && !source.includes('[')) {
            return null;
        }

        for (let start = 0; start < source.length; start++) {
            if (!['{', '['].includes(source[start])) continue;

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

                if (char === '{' || char === '[') {
                    depth += 1;
                    continue;
                }

                if (char === '}' || char === ']') {
                    depth -= 1;
                    if (depth === 0) {
                        const candidate = source.slice(start, index + 1);
                        const parsed = tryParseGenericContentPayload(candidate);
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

    function unwrapGenericResponseContent(text = '') {
        const directPayload = tryParseGenericContentPayload(text);
        if (directPayload?.displayText && !looksLikeInternalNotesScaffold(directPayload.displayText)) {
            return directPayload.displayText;
        }

        const balancedPayload = findBalancedGenericContentPayload(text);
        if (balancedPayload?.parsed?.displayText && !looksLikeInternalNotesScaffold(balancedPayload.parsed.displayText)) {
            return balancedPayload.parsed.displayText;
        }

        const normalized = stripDiffStylePrefixes(text).trim();
        return looksLikeInternalNotesScaffold(normalized) ? '' : normalized;
    }

    function isNotesBlockDefinition(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
        }

        if (typeof value.type !== 'string' || !value.type.trim()) {
            return false;
        }
        const type = canonicalizeBlockType(value.type);

        if (Object.prototype.hasOwnProperty.call(value, 'content')) {
            return true;
        }

        switch (type) {
            case 'divider':
                return true;
            case 'image':
                return Boolean(value.url || value.caption || value.text);
            case 'ai_image':
                return Boolean(
                    value.prompt ||
                    value.text ||
                    value.imageUrl ||
                    value.url ||
                    value.imageAssetId ||
                    (Array.isArray(value.unsplashResults) && value.unsplashResults.length > 0) ||
                    (Array.isArray(value.artifactResults) && value.artifactResults.length > 0)
                );
            case 'bookmark':
                return Boolean(value.url || value.title || value.description || value.text);
            case 'database':
                return Array.isArray(value.columns) || Array.isArray(value.rows);
            case 'callout':
                return Boolean(value.text || value.icon);
            case 'code':
                return Boolean(value.text || value.language);
            case 'math':
                return Boolean(value.text || value.latex);
            case 'mermaid':
                return Boolean(value.text || value.diagramType);
            case 'ai':
                return Boolean(value.prompt || value.result || value.text);
            default:
                return Boolean(value.text);
        }
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
        if (!/"(?:actions|operations|edits)"\s*:/i.test(source)) {
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
        const value = stripUnsafeNullCharacters(text);
        return /```notes-actions/i.test(value) ||
            /```json/i.test(value) ||
            /"assistant_reply"\s*:/i.test(value) ||
            /"assistantReply"\s*:/i.test(value) ||
            /"notes-actions"\s*:/i.test(value) ||
            /"(?:actions|operations|edits)"\s*:/i.test(value) ||
            /"action"\s*:\s*"(?:replace-content|append-content|prepend-content)"/i.test(value) ||
            /"type"\s*:\s*"(?:text|heading_1|heading_2|heading_3|bulleted_list|numbered_list|todo|code|quote|callout|divider|mermaid|image|ai_image|bookmark|database|ai|toggle|math)"/i.test(value) ||
            startsWithMermaidResponse(value);
    }

    function stripStructuredResponseText(text) {
        const value = stripUnsafeNullCharacters(text);
        if (startsWithMermaidResponse(value) || looksLikeInternalNotesScaffold(value)) {
            return '';
        }

        const genericContent = tryParseGenericContentPayload(value) || findBalancedGenericContentPayload(value)?.parsed;
        if (genericContent?.displayText && !looksLikeInternalNotesScaffold(genericContent.displayText)) {
            return genericContent.displayText;
        }

        const markerIndex = value.search(/```notes-actions|```json|"assistant_reply"\s*:|"assistantReply"\s*:|"notes-actions"\s*:|"(?:actions|operations|edits)"\s*:|"action"\s*:\s*"(?:replace-content|append-content|prepend-content)"|"type"\s*:\s*"function"|"name"\s*:\s*"update_notes_page"|"type"\s*:\s*"(?:text|heading_1|heading_2|heading_3|bulleted_list|numbered_list|todo|code|quote|callout|divider|mermaid|image|ai_image|bookmark|database|ai|toggle|math)"/i);
        if (markerIndex >= 0) {
            return value.slice(0, markerIndex).trim();
        }
        return value.trim();
    }

    function extractNotesActionPlan(responseText) {
        const text = stripUnsafeNullCharacters(responseText);
        const match = text.match(/```notes-actions\s*([\s\S]*?)```/i);
        if (!match) {
            const jsonFenceMatch = text.match(/```json\s*([\s\S]*?)```/i);
            const directPayload = tryParseNotesActionPayload(text.trim());
            const fencedPayload = jsonFenceMatch ? tryParseNotesActionPayload(jsonFenceMatch[1].trim()) : null;
            const balancedPayload = findBalancedNotesActionPayload(text);
            const genericPayload = tryParseGenericContentPayload(text.trim())
                || (jsonFenceMatch ? tryParseGenericContentPayload(jsonFenceMatch[1].trim()) : null)
                || findBalancedGenericContentPayload(text)?.parsed;
            const fragmentActions = extractBlockFragmentActions(text);
            const parsed = directPayload || fencedPayload || balancedPayload?.parsed || genericPayload || (fragmentActions
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
                displayText: looksLikeNotesActionResponse(text)
                    || isAssistantReplyPlaceholderText(text)
                    || looksLikeInternalNotesScaffold(text)
                    ? ''
                    : text.trim(),
                actions: [],
                parseFailed: looksLikeNotesActionResponse(text)
            };
        }

        const payloadText = match[1].trim();
        const visibleText = text.replace(match[0], '').trim();

        const directPayload = tryParseNotesActionPayload(payloadText);
        const balancedPayload = findBalancedNotesActionPayload(payloadText);
        const genericPayload = tryParseGenericContentPayload(payloadText)
            || findBalancedGenericContentPayload(payloadText)?.parsed;
        const fragmentActions = extractBlockFragmentActions(payloadText);
        const parsed = directPayload || balancedPayload?.parsed || genericPayload || (fragmentActions
            ? { displayText: '', actions: fragmentActions }
            : null);
        if (!parsed) {
            console.warn('Failed to parse notes action plan payload');
            return {
                displayText: looksLikeInternalNotesScaffold(visibleText) ? '' : (visibleText || ''),
                actions: [],
                parseFailed: true
            };
        }

        return {
            displayText: looksLikeInternalNotesScaffold(parsed.displayText || visibleText || '')
                ? ''
                : String(parsed.displayText || visibleText || '').trim(),
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
                    case 'move_block':
                    case 'reorder_block':
                    case 'move': {
                        const moveBlockId = targetBlockId || rawAction.draggedBlockId || rawAction.sourceBlockId || null;
                        const destinationBlockId = rawAction.targetBlockId || rawAction.destinationBlockId || rawAction.referenceBlockId || rawAction.anchorBlockId || null;
                        const position = String(rawAction.position || 'after').toLowerCase() === 'before' ? 'before' : 'after';
                        if (!moveBlockId || !destinationBlockId || moveBlockId === destinationBlockId) return;
                        editor.reorderBlocks?.(moveBlockId, destinationBlockId, position);
                        focusBlockId = moveBlockId;
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
                    case 'rebuild_page':
                    case 'replace_page': {
                        const rebuiltBlocks = (blockDefinitions.length ? blockDefinitions : []).map((blockDef) => normalizeActionBlock(blockDef, {
                            defaultType: blockDef.type || 'text'
                        }));
                        if (!editor.importBlocks || rebuiltBlocks.length === 0) return;

                        const pageUpdates = {};
                        ['title', 'icon', 'cover', 'properties', 'defaultModel'].forEach((key) => {
                            if (Object.prototype.hasOwnProperty.call(rawAction, key)) {
                                pageUpdates[key] = rawAction[key];
                            }
                        });
                        if (Object.keys(pageUpdates).length > 0) {
                            editor.updatePageMetadata?.(pageUpdates);
                        }

                        editor.importBlocks(rebuiltBlocks, { replace: true });
                        focusBlockId = window.Editor?.getCurrentPage?.()?.blocks?.[0]?.id || focusBlockId;
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

    function prepareAssistantResponse(responseText, options = {}) {
        const {
            question = '',
            context = null,
            toolEvents = [],
        } = options;
        const parsed = extractNotesActionPlan(responseText);
        const normalizedActions = normalizeStructuredPageActions(parsed.actions, question, context, toolEvents);
        const applied = applyNotesActions(normalizedActions);
        const actionCount = Array.isArray(normalizedActions) ? normalizedActions.length : 0;

        if (actionCount > 0 || parsed.parseFailed) {
            const detail = {
                actionCount,
                appliedCount: applied.appliedCount,
                parseFailed: Boolean(parsed.parseFailed),
                structuredResponse: looksLikeNotesActionResponse(responseText),
                responseLength: String(responseText || '').length
            };

            try {
                window.dispatchEvent(new CustomEvent('notes-agent-parse', {
                    detail: {
                        model: state.selectedModel,
                        ...detail
                    }
                }));
            } catch (error) {
                console.warn('Failed to dispatch notes parse event:', error);
            }

            if (parsed.parseFailed || (actionCount > 0 && applied.appliedCount === 0)) {
                console.warn('Notes structured response was not fully applied:', detail);
            } else if (actionCount > 0) {
                console.info('Notes structured response parsed and applied:', detail);
            }
        }

        const fallbackReply = summarizeAppliedNotesActions(normalizedActions, applied.appliedCount);
        const shouldUseFallbackReply = !parsed.displayText || looksLikeShortAcknowledgement(parsed.displayText);

        return {
            displayText: (shouldUseFallbackReply ? fallbackReply : parsed.displayText) || (parsed.parseFailed
                ? 'I prepared page updates, but the response could not be applied automatically. Please try again.'
                : ''),
            appliedCount: applied.appliedCount
        };
    }

    function resolveVisibleAssistantText(preparedDisplayText = '', responseText = '') {
        const normalizedPrepared = stripUnsafeNullCharacters(preparedDisplayText).trim();
        if (normalizedPrepared
            && !isAssistantReplyPlaceholderText(normalizedPrepared)
            && !looksLikeInternalNotesScaffold(normalizedPrepared)) {
            return normalizedPrepared;
        }

        const normalizedGeneric = unwrapGenericResponseContent(responseText);
        if (normalizedGeneric
            && !looksLikeNotesActionResponse(responseText)
            && !isAssistantReplyPlaceholderText(normalizedGeneric)) {
            return normalizedGeneric;
        }

        const strippedStructured = stripStructuredResponseText(responseText);
        if (strippedStructured && !isAssistantReplyPlaceholderText(strippedStructured)) {
            return strippedStructured;
        }

        return '';
    }

    function getStreamingVisibleText(text) {
        const value = stripUnsafeNullCharacters(text);
        const trimmed = value.trim();

        if (/^\{[\s\S]*"(?:actions|operations|edits)"\s*:/i.test(trimmed)
            && /"(?:assistant_reply|assistantReply)"\s*:/i.test(trimmed)) {
            return '';
        }

        if (looksLikeInternalNotesScaffold(trimmed)) {
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
            normalized.includes('what i can do from this session') ||
            normalized.includes('what i cannot do in this session') ||
            normalized.includes('runtime exposes a writable file tool') ||
            normalized.includes('github/canva connector tools') ||
            normalized.includes('create a new local git repo in /app') ||
            normalized.includes('i cannot create a new repo from this exact turn') ||
            normalized.includes('run git init, builds, or normal shell commands') ||
            normalized.includes('modify the local filesystem') ||
            normalized.includes('the exact blocker is the runtime sandbox') ||
            normalized.includes('kernel does not allow non-privileged user namespaces') ||
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
            if (action.draggedBlockId) blockIds.add(action.draggedBlockId);
            if (action.sourceBlockId) blockIds.add(action.sourceBlockId);
            if (action.destinationBlockId) blockIds.add(action.destinationBlockId);
            if (action.referenceBlockId) blockIds.add(action.referenceBlockId);
            if (action.anchorBlockId) blockIds.add(action.anchorBlockId);
            
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
            'deepseek',
            'deepseak',
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
        sharedSessionId: null,
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
        const conversationId = getConversationSessionId({ pageId });

        if (!conversationId) {
            return state.messages;
        }

        if (state.activePageId === conversationId) {
            syncAPIClientSession(getAPIClient(), { pageId: conversationId });
            if (emitEvent) {
                emitConversationChange({ reason: 'page-sync' });
            }
            return state.messages;
        }

        state.activePageId = conversationId;
        state.messages = readStoredMessages(conversationId).slice(-100);
        syncAPIClientSession(getAPIClient(), { pageId: conversationId });

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

    function yieldToBrowser() {
        return new Promise((resolve) => {
            if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(() => resolve());
                return;
            }

            setTimeout(resolve, 0);
        });
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
            const apiClient = getAPIClient();
            await hydrateSharedConversationSession(apiClient);
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
    
    function buildFullPageContentFromContext(context = null) {
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

    function getFullPageContent() {
        const context = getPageContext();
        return buildFullPageContentFromContext(context);
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

        const explicitDeliveryIntent = hasExplicitArtifactDeliveryIntent(normalized);
        const explicitArtifactVerb = /\b(export|generate|create|make|save|download|convert|render|produce|link|share|attach)\b/.test(normalized);
        const explicitStandaloneHtmlIntent = /\b(standalone html|html file|downloadable html|shareable html|html artifact|html export)\b/.test(normalized);

        if (explicitStandaloneHtmlIntent || (/\bhtml\b/.test(normalized) && explicitDeliveryIntent)) return 'html';
        if (/\bpdf\b/.test(normalized) && explicitArtifactVerb) return 'pdf';
        if (/\bdocx\b|\bword document\b/.test(normalized) && explicitArtifactVerb) return 'docx';
        if (/\bxml\b/.test(normalized) && explicitArtifactVerb) return 'xml';
        if (/\bxlsx\b|\bexcel\b|\bspreadsheet\b/.test(normalized) && explicitArtifactVerb) return 'xlsx';
        if (/\b(mermaid|\.mmd\b)\b/.test(normalized)
            && /\b(export|download|save|artifact|file|mmd|link|share)\b/.test(normalized)) return 'mermaid';
        return null;
    }

    function hasExplicitArtifactDeliveryIntent(question = '') {
        const normalized = String(question || '').toLowerCase();
        if (!normalized) return false;

        return /\b(export|download|save|artifact|file|link|share|attachment)\b/.test(normalized);
    }

    function isArtifactGenerationIntent(question) {
        const normalized = String(question || '').toLowerCase();
        if (!normalized) return false;

        const format = inferRequestedArtifactFormat(normalized);
        if (!format) return false;

        return /\b(export|generate|create|make|save|download|convert|render|produce|link)\b/.test(normalized);
    }

    function shouldSuppressRequestedArtifactFormat(question = '', context = null, requestedArtifactFormat = null) {
        if (!requestedArtifactFormat) {
            return false;
        }

        if (isPlanningConversationIntent(question, context)) {
            return true;
        }

        if (shouldPreferInlineMermaidBlock(question, context, requestedArtifactFormat)) {
            return true;
        }

        if (hasExplicitArtifactDeliveryIntent(question)) {
            return false;
        }

        return shouldForcePageEditActions(question, context, {});
    }

    function isExplicitMermaidDownloadIntent(question = '') {
        const normalized = String(question || '').toLowerCase();
        if (!normalized) return false;

        return /\b(download|export|save|share|link|artifact|mmd)\b/.test(normalized);
    }

    function pageHasMermaidBlocks(context = null) {
        return Array.isArray(context?.blocks) && context.blocks.some((block) => block?.type === 'mermaid');
    }

    function shouldPreferInlineMermaidBlock(question = '', context = null, requestedArtifactFormat = null) {
        if (requestedArtifactFormat !== 'mermaid') {
            return false;
        }

        const normalized = String(question || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        const diagramEditIntent = [
            /\b(fill out|complete|finish|update|edit|fix|improve|expand|revise|polish|populate)\b[\s\S]{0,40}\b(mermaid|diagram)\b/,
            /\b(mermaid|diagram)\b[\s\S]{0,40}\b(fill out|complete|finish|update|edit|fix|improve|expand|revise|polish|populate)\b/,
        ].some((pattern) => pattern.test(normalized));

        return !isExplicitMermaidDownloadIntent(question)
            && (
                pageHasMermaidBlocks(context)
                || isExplicitPageEditIntent(question)
                || diagramEditIntent
            );
    }

    function flattenPageBlocks(blocks = [], result = []) {
        (Array.isArray(blocks) ? blocks : []).forEach((block) => {
            if (!block || typeof block !== 'object') {
                return;
            }

            result.push(block);
            if (Array.isArray(block.children) && block.children.length > 0) {
                flattenPageBlocks(block.children, result);
            }
        });

        return result;
    }

    function findPreferredMermaidTargetBlock(page = null) {
        const allBlocks = flattenPageBlocks(page?.blocks || []);
        const mermaidBlocks = allBlocks.filter((block) => block?.type === 'mermaid');
        if (mermaidBlocks.length === 0) {
            return null;
        }

        const emptyMermaidBlock = mermaidBlocks.find((block) => {
            const source = typeof block?.content === 'object'
                ? block.content.text
                : block?.content;
            return !normalizeMermaidSourceText(source).trim();
        });
        if (emptyMermaidBlock) {
            return emptyMermaidBlock;
        }

        return mermaidBlocks.length === 1 ? mermaidBlocks[0] : null;
    }

    async function loadMermaidSourceFromArtifact(artifact = {}) {
        const previewSource = normalizeMermaidSourceText(artifact?.preview?.content || '');
        if (looksLikeMermaidSource(previewSource)) {
            return previewSource;
        }

        const rawDownloadUrl = artifact?.downloadUrl
            ? new URL(artifact.downloadUrl, window.location.origin)
            : null;
        if (!rawDownloadUrl) {
            return '';
        }

        rawDownloadUrl.searchParams.set('inline', '1');

        try {
            const response = await fetch(rawDownloadUrl.toString(), {
                headers: {
                    Accept: 'text/plain, text/vnd.mermaid, */*'
                },
                credentials: 'same-origin'
            });

            if (!response.ok) {
                return '';
            }

            const source = normalizeMermaidSourceText(await response.text());
            return looksLikeMermaidSource(source) ? source : '';
        } catch (error) {
            console.warn('Failed to load Mermaid artifact source:', error);
            return '';
        }
    }

    async function applyGeneratedMermaidArtifactToPage(artifacts = [], options = {}) {
        const {
            question = '',
            explicitPageEditIntent = false
        } = options;

        if (!window.Blocks?.createBlock || !window.Editor?.getCurrentPage) {
            return { appliedCount: 0, blockCount: 0, reusedExisting: false };
        }

        const page = window.Editor.getCurrentPage();
        if (!page) {
            return { appliedCount: 0, blockCount: 0, reusedExisting: false };
        }

        const existingTopLevelBlocks = Array.isArray(page.blocks) ? page.blocks : [];
        const shouldApplyToPage = explicitPageEditIntent
            || pageHasMermaidBlocks({ blocks: flattenPageBlocks(existingTopLevelBlocks, []) })
            || (existingTopLevelBlocks.length === 1 && isEmptyStarterBlock(existingTopLevelBlocks[0]));

        if (!shouldApplyToPage) {
            return { appliedCount: 0, blockCount: 0, reusedExisting: false };
        }

        const mermaidSources = [];
        for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
            const format = String(artifact?.format || '').trim().toLowerCase();
            if (format && !['mermaid', 'mmd'].includes(format)) {
                continue;
            }

            const source = await loadMermaidSourceFromArtifact(artifact);
            if (source) {
                mermaidSources.push(source);
            }
        }

        if (mermaidSources.length === 0) {
            return { appliedCount: 0, blockCount: 0, reusedExisting: false };
        }

        const mermaidBlocks = mermaidSources.map((source) => window.Blocks.createBlock('mermaid', {
            text: source,
            diagramType: detectMermaidDiagramType(source),
            _showEditor: false
        }));

        const preferredTarget = mermaidBlocks.length === 1
            ? findPreferredMermaidTargetBlock(page)
            : null;

        let inserted = [];
        if (preferredTarget) {
            inserted = window.Editor.replaceBlockWithBlocks?.(preferredTarget.id, mermaidBlocks) || [];
        } else if (existingTopLevelBlocks.length === 1 && isEmptyStarterBlock(existingTopLevelBlocks[0])) {
            inserted = window.Editor.replaceBlockWithBlocks?.(existingTopLevelBlocks[0].id, mermaidBlocks) || [];
        } else {
            const lastBlockId = flattenPageBlocks(existingTopLevelBlocks, []).slice(-1)[0]?.id || null;
            inserted = window.Editor.insertBlocksAfter?.(lastBlockId, mermaidBlocks) || [];
        }

        if (inserted.length > 0) {
            window.Editor.savePage?.();
        }

        return {
            appliedCount: inserted.length,
            blockCount: inserted.length,
            reusedExisting: Boolean(preferredTarget && inserted.length > 0)
        };
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
            onStreamComplete,
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
                        onStreamComplete,
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
                onStreamComplete,
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
        const { onChunk, onStreamComplete, onComplete, onError, hiddenAssistantMessage = false } = options;
        const apiClient = getAPIClient();
        syncAPIClientSession(apiClient, context);
        const explicitPageEditIntent = isExplicitPageEditIntent(question);
        let requestedArtifactFormat = inferRequestedArtifactFormat(question);
        if (shouldSuppressRequestedArtifactFormat(question, context, requestedArtifactFormat)) {
            requestedArtifactFormat = null;
        }
        const requestOptions = requestedArtifactFormat
            ? { outputFormat: requestedArtifactFormat }
            : {};
        
        // Build messages array with enhanced system prompt
        const systemPrompt = buildSystemPrompt(context || {
            title: 'Untitled',
            blockCount: 0,
            wordCount: 0,
            outline: []
        }, {
            question
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
                const useMultiPassDraft = supportsStructuredNotesDrafting(model)
                    && shouldUseMultiPassNotesDraft(question, context, requestOptions);
                const forcePageEditActions = shouldForcePageEditActions(question, context, requestOptions);
                const effectiveQuestion = forcePageEditActions
                    ? `${question}\n\nInterpret "page" as the current notes page shown in this editor. This is a direct page edit request, so return notes-actions that apply the content to the current notes page unless the user explicitly says web page, site page, repo file, or server component. Put the result into page blocks. Do not reply with chat prose alone. Do not create standalone HTML, file, export, artifact, or download-link output unless the user explicitly asked for that.`
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
                let generatedToolEvents = [];
                let processingReleased = false;

                const releaseProcessing = async (detail = {}) => {
                    if (processingReleased) {
                        return;
                    }

                    processingReleased = true;
                    setProcessingState(false, {
                        phase: 'response-received',
                        ...detail
                    });

                    if (onStreamComplete) {
                        try {
                            onStreamComplete({
                                model,
                                ...detail
                            });
                        } catch (callbackError) {
                            console.warn('notes onStreamComplete callback failed:', callbackError);
                        }
                    }

                    await yieldToBrowser();
                };

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

                            if (chunk.type === 'done') {
                                generatedArtifacts = Array.isArray(chunk.artifacts) ? chunk.artifacts : [];
                                generatedToolEvents = Array.isArray(chunk.toolEvents) ? chunk.toolEvents : [];
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
                        generatedToolEvents = Array.isArray(response.toolEvents) ? response.toolEvents : [];
                    }

                    await releaseProcessing({
                        requestType: hiddenAssistantMessage ? 'internal' : 'chat'
                    });

                    if (isInvalidGatewayResponseText(responseText)) {
                        const invalidGatewayError = new Error('Invalid response returned by the AI gateway.');
                        invalidGatewayError.status = 502;
                        throw invalidGatewayError;
                    }

                    let preparedResponse;
                    try {
                        preparedResponse = prepareAssistantResponse(responseText, {
                            question,
                            context,
                            toolEvents: generatedToolEvents,
                        });
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

                    if (forcePageEditActions && preparedResponse.appliedCount === 0) {
                        const fallbackPageEdit = buildFallbackPageEditResponse(question, responseText, context);
                        if (fallbackPageEdit?.appliedCount > 0) {
                            preparedResponse = fallbackPageEdit;
                        } else {
                            try {
                                const repairedResponseText = await repairNotesPageEditResponse({
                                    apiClient,
                                    model,
                                    systemPrompt,
                                    question: effectiveQuestion,
                                    previousResponse: responseText,
                                    requestOptions,
                                });

                                if (repairedResponseText && repairedResponseText !== responseText) {
                                    responseText = repairedResponseText;
                                    preparedResponse = prepareAssistantResponse(repairedResponseText, {
                                        question,
                                        context,
                                        toolEvents: generatedToolEvents,
                                    });
                                }

                                if (preparedResponse.appliedCount === 0) {
                                    const repairedFallbackPageEdit = buildFallbackPageEditResponse(question, responseText, context);
                                    if (repairedFallbackPageEdit?.appliedCount > 0) {
                                        preparedResponse = repairedFallbackPageEdit;
                                    }
                                }
                            } catch (repairError) {
                                console.warn('Notes page-edit repair pass failed:', repairError);
                            }
                        }
                    }

                    const blindArtifactSelectionResult = appendBlindArtifactSelectionBlocks(generatedToolEvents);
                    const mermaidArtifactApplyResult = requestedArtifactFormat === 'mermaid'
                        ? await applyGeneratedMermaidArtifactToPage(generatedArtifacts, {
                            question,
                            explicitPageEditIntent
                        })
                        : { appliedCount: 0, blockCount: 0, reusedExisting: false };

                    const shouldAppendArtifactLinks = generatedArtifacts.length > 0
                        && requestedArtifactFormat
                        && !(
                            requestedArtifactFormat === 'mermaid'
                            && mermaidArtifactApplyResult.appliedCount > 0
                            && !isExplicitMermaidDownloadIntent(question)
                        );

                    if (shouldAppendArtifactLinks) {
                        generatedArtifacts.forEach((artifact) => appendArtifactBookmark(artifact, requestedArtifactFormat));
                    }

                    const artifactLinkNotice = shouldAppendArtifactLinks
                        ? `\n\nDownload link added at the bottom of the page for the generated ${requestedArtifactFormat.toUpperCase()} export.`
                        : '';
                    const mermaidArtifactNotice = mermaidArtifactApplyResult.appliedCount > 0
                        ? `\n\nUpdated ${mermaidArtifactApplyResult.blockCount} Mermaid block${mermaidArtifactApplyResult.blockCount === 1 ? '' : 's'} on the page from the generated diagram.`
                        : '';
                    const blindArtifactNotice = blindArtifactSelectionResult.selectionCount > 0
                        ? `\n\nAdded ${blindArtifactSelectionResult.imageCount} captured image option${blindArtifactSelectionResult.imageCount === 1 ? '' : 's'} to the page as selectable image blocks.`
                        : '';
                    const baseVisibleResponse = resolveVisibleAssistantText(preparedResponse.displayText, responseText);
                    const fallbackVisibleResponse = blindArtifactSelectionResult.selectionCount > 0
                        ? `Added ${blindArtifactSelectionResult.imageCount} captured image option${blindArtifactSelectionResult.imageCount === 1 ? '' : 's'} to the page as selectable image blocks.`
                        : (mermaidArtifactApplyResult.appliedCount > 0
                            ? `Updated ${mermaidArtifactApplyResult.blockCount} Mermaid block${mermaidArtifactApplyResult.blockCount === 1 ? '' : 's'} on the page.`
                            : '');
                    const visibleResponse = `${baseVisibleResponse}${artifactLinkNotice}${mermaidArtifactNotice}${blindArtifactNotice}`.trim()
                        || fallbackVisibleResponse;
                    const assistantMessage = hiddenAssistantMessage
                        ? null
                        : addMessage('assistant', visibleResponse, {
                            model,
                            tokensUsed: estimateTokens(question + visibleResponse),
                            source: 'api',
                            appliedCount: (preparedResponse.appliedCount || 0)
                                + (mermaidArtifactApplyResult.appliedCount || 0)
                                + (blindArtifactSelectionResult.appliedCount || 0)
                        });

                    if (model !== state.selectedModel && !toolSensitiveRequest) {
                        state.selectedModel = model;
                        persistSelectedModel(model);
                        window.dispatchEvent(new CustomEvent('modelChanged', { detail: { modelId: model } }));
                        showToast(`Switched AI model to ${model} after the previous model failed.`, 'info');
                    }

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
        const { onChunk, onStreamComplete, onComplete, onError, hiddenAssistantMessage = false } = options;
        
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

            setProcessingState(false, {
                phase: 'response-received',
                requestType: hiddenAssistantMessage ? 'internal' : 'chat'
            });
            if (onStreamComplete) {
                try {
                    onStreamComplete({
                        requestType: hiddenAssistantMessage ? 'internal' : 'chat'
                    });
                } catch (callbackError) {
                    console.warn('notes onStreamComplete callback failed:', callbackError);
                }
            }
            await yieldToBrowser();
            
            // Add assistant message
            const preparedResponse = prepareAssistantResponse(responseText, {
                question,
                context,
                toolEvents: generatedToolEvents,
            });
            const visibleResponse = resolveVisibleAssistantText(preparedResponse.displayText, responseText);

            const assistantMessage = hiddenAssistantMessage
                ? null
                : addMessage('assistant', visibleResponse, {
                    model: state.selectedModel,
                    tokensUsed: estimateTokens(question + visibleResponse),
                    source: 'stub',
                    appliedCount: preparedResponse.appliedCount || 0
                });

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
        _selectNotesPageTemplates: selectNotesPageTemplates,
        _applyNotesActions: applyNotesActions,
        _extractNotesActionPlan: extractNotesActionPlan,
        _normalizeStructuredPageActions: normalizeStructuredPageActions,
        _hasNonPageRuntimeIntent: hasNonPageRuntimeIntent,
        _shouldForcePageEditActions: shouldForcePageEditActions,
        _shouldSuppressRequestedArtifactFormat: shouldSuppressRequestedArtifactFormat
    };
})();

// Expose to window for global access
window.Agent = Agent;
