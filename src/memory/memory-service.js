const { config } = require('../config');
const { vectorStore } = require('./vector-store');
const { stripNullCharacters, chunkText } = require('../utils/text');
const { mergeMemoryKeywords, normalizeMemoryKeywords } = require('./memory-keywords');
const { runtimeDiagnostics } = require('../runtime-diagnostics');

const DEFAULT_RECALL_PROFILE = 'default';
const RESEARCH_RECALL_PROFILE = 'research';
const FACT_MEMORY_TYPE = 'fact';
const ARTIFACT_MEMORY_TYPE = 'artifact';
const SKILL_MEMORY_TYPE = 'skill';
const RESEARCH_MEMORY_TYPE = 'research';
const DEFAULT_FACT_LIMIT = 6;
const DEFAULT_ARTIFACT_LIMIT = 4;
const DEFAULT_SKILL_LIMIT = 3;
const DEFAULT_MEMORY_SCAN_LIMIT = 400;
const DEFAULT_FACT_IMPORTANCE = 0.6;
const DEFAULT_ARTIFACT_IMPORTANCE = 0.8;
const DEFAULT_SKILL_IMPORTANCE = 0.9;

function normalizeMemoryType(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if ([ARTIFACT_MEMORY_TYPE, SKILL_MEMORY_TYPE, RESEARCH_MEMORY_TYPE].includes(normalized)) {
        return normalized;
    }

    return FACT_MEMORY_TYPE;
}

function normalizeImportance(value = null, fallback = DEFAULT_FACT_IMPORTANCE) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.max(0, Math.min(1, numeric));
}

function normalizeVisibility(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || 'private';
}

function normalizeSourceSurface(metadata = {}) {
    const normalized = String(
        metadata?.sourceSurface
        || metadata?.clientSurface
        || metadata?.memoryScope
        || '',
    ).trim();
    return normalized || null;
}

function coerceTimestamp(value = null) {
    const timestamp = String(value || '').trim();
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function summarizeLine(value = '', limit = 220) {
    const normalized = stripNullCharacters(value).replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }

    return normalized.length > limit
        ? `${normalized.slice(0, Math.max(0, limit - 3))}...`
        : normalized;
}

function summarizeSkillText({ objective = '', assistantText = '', toolEvents = [], artifact = null } = {}) {
    const toolSummaries = (Array.isArray(toolEvents) ? toolEvents : [])
        .slice(0, 6)
        .map((event) => {
            const toolId = String(event?.toolCall?.function?.name || event?.result?.toolId || '').trim();
            const reason = summarizeLine(event?.reason || '', 100);
            return toolId ? `${toolId}${reason ? `: ${reason}` : ''}` : '';
        })
        .filter(Boolean);
    const artifactSummary = artifact?.filename
        ? `Output artifact: ${artifact.filename}${artifact.format ? ` (${artifact.format})` : ''}.`
        : '';

    return [
        `Reusable workflow: ${summarizeLine(objective, 220)}`,
        toolSummaries.length > 0 ? `Verified steps: ${toolSummaries.join(' -> ')}` : '',
        artifactSummary,
        assistantText ? `Outcome: ${summarizeLine(assistantText, 260)}` : '',
    ].filter(Boolean).join('\n');
}

function isArtifactFollowupQuery(query = '') {
    const normalized = String(query || '').trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    return /\b(section|revise|update|edit|continue|same|that|this|previous|prior|latest|generated|document|pdf|html|docx|artifact|file|page|report|brief)\b/.test(normalized);
}

function normalizeKeywordOverlap(keywords = []) {
    return normalizeMemoryKeywords(Array.isArray(keywords) ? keywords : []);
}

class MemoryService {
    constructor() {
        this.store = vectorStore;
    }

    async initialize() {
        await this.store.initialize();
    }

    normalizeMetadata(role = 'user', text = '', metadata = {}) {
        const memoryType = normalizeMemoryType(
            metadata?.memoryType
            || (role === 'research-note' ? RESEARCH_MEMORY_TYPE : FACT_MEMORY_TYPE),
        );
        const importance = normalizeImportance(
            metadata?.importance,
            memoryType === SKILL_MEMORY_TYPE
                ? DEFAULT_SKILL_IMPORTANCE
                : (memoryType === ARTIFACT_MEMORY_TYPE ? DEFAULT_ARTIFACT_IMPORTANCE : DEFAULT_FACT_IMPORTANCE),
        );

        return {
            role,
            memoryType,
            keywords: mergeMemoryKeywords(metadata?.memoryKeywords || metadata?.keywords || [], text),
            visibility: normalizeVisibility(
                metadata?.visibility
                || (memoryType === SKILL_MEMORY_TYPE ? 'frontend-shared' : 'private'),
            ),
            importance,
            timestamp: coerceTimestamp(metadata?.timestamp),
            sourceSurface: normalizeSourceSurface(metadata),
            ...(metadata?.ownerId ? { ownerId: String(metadata.ownerId).trim() } : {}),
            ...(metadata?.memoryScope ? { memoryScope: String(metadata.memoryScope).trim() } : {}),
            ...(metadata?.artifactId ? { artifactId: String(metadata.artifactId).trim() } : {}),
            ...(metadata?.artifactFilename ? { artifactFilename: String(metadata.artifactFilename).trim() } : {}),
            ...(metadata?.artifactFormat ? { artifactFormat: String(metadata.artifactFormat).trim().toLowerCase() } : {}),
            ...(metadata?.skillId ? { skillId: String(metadata.skillId).trim() } : {}),
            ...(metadata?.summary ? { summary: summarizeLine(metadata.summary, 280) } : {}),
            ...(metadata?.chunkIndex != null ? { chunkIndex: Number(metadata.chunkIndex) } : {}),
        };
    }

    async remember(sessionId, message, role = 'user', metadata = {}) {
        const normalizedMessage = stripNullCharacters(message).trim();
        if (!normalizedMessage) {
            return null;
        }

        return this.store.store(sessionId, normalizedMessage, this.normalizeMetadata(role, normalizedMessage, metadata));
    }

    async rememberArtifactResult(sessionId, {
        artifact = null,
        summary = '',
        sourceText = '',
        metadata = {},
    } = {}) {
        const summaryText = stripNullCharacters(summary).trim();
        const normalizedSource = stripNullCharacters(sourceText).trim();
        const artifactId = String(artifact?.id || metadata?.artifactId || '').trim() || null;
        const artifactFilename = String(artifact?.filename || metadata?.artifactFilename || '').trim() || null;
        const artifactFormat = String(artifact?.format || metadata?.artifactFormat || '').trim().toLowerCase() || null;
        const baseMetadata = {
            ...metadata,
            memoryType: ARTIFACT_MEMORY_TYPE,
            artifactId,
            artifactFilename,
            artifactFormat,
            importance: normalizeImportance(metadata?.importance, DEFAULT_ARTIFACT_IMPORTANCE),
        };

        const writes = [];
        if (summaryText) {
            writes.push(this.remember(sessionId, summaryText, 'artifact-summary', {
                ...baseMetadata,
                summary: summaryText,
                memoryKeywords: mergeMemoryKeywords(
                    metadata?.memoryKeywords || metadata?.keywords || [],
                    [summaryText, metadata?.sourcePrompt || '', artifactFilename || '', artifactFormat || ''].filter(Boolean).join('\n'),
                ),
            }));
        }

        if (normalizedSource) {
            const chunks = chunkText(normalizedSource);
            for (let index = 0; index < chunks.length; index += 1) {
                writes.push(this.remember(sessionId, chunks[index], 'artifact-source', {
                    ...baseMetadata,
                    chunkIndex: index,
                    summary: summaryText || artifactFilename || artifactId || '',
                    memoryKeywords: mergeMemoryKeywords(
                        metadata?.memoryKeywords || metadata?.keywords || [],
                        [metadata?.sourcePrompt || '', artifactFilename || '', artifactFormat || '', summaryText, chunks[index]].filter(Boolean).join('\n'),
                    ),
                }));
            }
        }

        if (writes.length === 0) {
            return [];
        }

        return Promise.all(writes);
    }

    async rememberLearnedSkill(sessionId, {
        objective = '',
        assistantText = '',
        toolEvents = [],
        artifact = null,
        metadata = {},
    } = {}) {
        const relevantToolEvents = (Array.isArray(toolEvents) ? toolEvents : [])
            .filter((event) => event?.result?.success !== false);
        if (!objective || (relevantToolEvents.length === 0 && !artifact)) {
            return null;
        }

        const skillText = summarizeSkillText({
            objective,
            assistantText,
            toolEvents: relevantToolEvents,
            artifact,
        });
        if (!skillText) {
            return null;
        }

        return this.remember(sessionId, skillText, 'skill', {
            ...metadata,
            memoryType: SKILL_MEMORY_TYPE,
            visibility: metadata?.visibility || 'frontend-shared',
            importance: normalizeImportance(metadata?.importance, DEFAULT_SKILL_IMPORTANCE),
            memoryKeywords: mergeMemoryKeywords(
                metadata?.memoryKeywords || metadata?.keywords || [],
                [
                    objective,
                    assistantText,
                    artifact?.filename || '',
                    artifact?.format || '',
                    relevantToolEvents.map((event) => event?.toolCall?.function?.name || event?.result?.toolId || '').join(' '),
                ].join('\n'),
            ),
        });
    }

    getRecallOptions({ profile = DEFAULT_RECALL_PROFILE, topK, scoreThreshold } = {}) {
        const normalizedProfile = String(profile || DEFAULT_RECALL_PROFILE).trim().toLowerCase();
        const isResearch = normalizedProfile === RESEARCH_RECALL_PROFILE;

        return {
            topK: Number.isFinite(Number(topK))
                ? Number(topK)
                : (isResearch ? config.memory.researchRecallTopK : config.memory.recallTopK),
            scoreThreshold: Number.isFinite(Number(scoreThreshold))
                ? Number(scoreThreshold)
                : (isResearch ? config.memory.researchRecallScoreThreshold : config.memory.recallScoreThreshold),
        };
    }

    entryMatchesScope(entry = {}, { sessionId = null, ownerId = null, memoryScope = null } = {}) {
        const metadata = entry?.metadata || {};
        if (sessionId && metadata.sessionId !== sessionId) {
            return false;
        }
        if (!sessionId && ownerId && metadata.ownerId !== ownerId) {
            return false;
        }
        if (memoryScope && metadata.memoryScope !== memoryScope) {
            return false;
        }

        return true;
    }

    getMemoryTypeGroup(entry = {}) {
        const memoryType = normalizeMemoryType(entry?.metadata?.memoryType || entry?.memoryType || '');
        if (memoryType === ARTIFACT_MEMORY_TYPE) {
            return 'artifact';
        }
        if (memoryType === SKILL_MEMORY_TYPE) {
            return 'skill';
        }
        if (memoryType === RESEARCH_MEMORY_TYPE) {
            return 'research';
        }
        return 'fact';
    }

    async keywordRecall(keywords = [], options = {}) {
        const normalizedKeywords = normalizeMemoryKeywords(keywords);
        if (normalizedKeywords.length === 0) {
            return [];
        }

        const rows = await this.store.scroll(this.store.collection, {
            limit: options.scanLimit || DEFAULT_MEMORY_SCAN_LIMIT,
            with_payload: true,
            with_vector: false,
        });

        return rows
            .map((row) => ({
                id: row?.id,
                score: 0,
                text: row?.payload?.text || '',
                sessionId: row?.payload?.sessionId || null,
                timestamp: row?.payload?.timestamp || null,
                metadata: row?.payload || {},
            }))
            .filter((entry) => this.entryMatchesScope(entry, options))
            .map((entry) => {
                const entryKeywords = normalizeKeywordOverlap(entry?.metadata?.keywords || []);
                const keywordOverlap = normalizedKeywords.filter((keyword) => entryKeywords.includes(keyword));
                if (keywordOverlap.length === 0) {
                    return null;
                }

                return {
                    ...entry,
                    keywordOverlap,
                };
            })
            .filter(Boolean);
    }

    scoreRecallEntry(entry = {}, {
        queryKeywords = [],
        artifactFollowup = false,
    } = {}) {
        const metadata = entry?.metadata || {};
        const keywordOverlap = Array.isArray(entry?.keywordOverlap) ? entry.keywordOverlap : [];
        const semanticScore = Number(entry?.semanticScore ?? entry?.score ?? 0);
        const importance = normalizeImportance(metadata?.importance, DEFAULT_FACT_IMPORTANCE);
        const timestamp = Date.parse(metadata?.timestamp || entry?.timestamp || '');
        const ageMs = Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
        const recencyBoost = Number.isFinite(ageMs)
            ? Math.max(0, 0.18 - (ageMs / (1000 * 60 * 60 * 24 * 30)))
            : 0;
        const keywordBoost = keywordOverlap.length > 0
            ? Math.min(0.5, keywordOverlap.length * 0.16)
            : 0;
        const typeGroup = this.getMemoryTypeGroup(entry);
        const artifactBoost = artifactFollowup && typeGroup === 'artifact' ? 0.25 : 0;
        const skillBoost = typeGroup === 'skill' ? 0.1 : 0;
        const textBoost = queryKeywords.some((keyword) => String(entry?.text || '').toLowerCase().includes(keyword))
            ? 0.05
            : 0;

        return semanticScore + keywordBoost + recencyBoost + artifactBoost + skillBoost + textBoost + importance;
    }

    mergeRecallResults(semanticResults = [], keywordResults = [], options = {}) {
        const merged = new Map();
        for (const entry of semanticResults) {
            merged.set(String(entry.id), {
                ...entry,
                semanticScore: Number(entry.score || 0),
                keywordOverlap: [],
            });
        }

        for (const entry of keywordResults) {
            const key = String(entry.id);
            const existing = merged.get(key);
            if (existing) {
                merged.set(key, {
                    ...existing,
                    keywordOverlap: Array.from(new Set([...(existing.keywordOverlap || []), ...(entry.keywordOverlap || [])])),
                });
                continue;
            }

            merged.set(key, {
                ...entry,
                semanticScore: 0,
            });
        }

        const queryKeywords = normalizeMemoryKeywords(options.queryKeywords || []);
        const artifactFollowup = Boolean(options.artifactFollowup);

        return Array.from(merged.values())
            .map((entry) => ({
                ...entry,
                typeGroup: this.getMemoryTypeGroup(entry),
                finalScore: this.scoreRecallEntry(entry, {
                    queryKeywords,
                    artifactFollowup,
                }),
            }))
            .sort((left, right) => right.finalScore - left.finalScore);
    }

    selectRecallGroups(entries = [], topK = DEFAULT_FACT_LIMIT + DEFAULT_ARTIFACT_LIMIT + DEFAULT_SKILL_LIMIT) {
        const caps = {
            fact: DEFAULT_FACT_LIMIT,
            artifact: DEFAULT_ARTIFACT_LIMIT,
            skill: DEFAULT_SKILL_LIMIT,
            research: DEFAULT_FACT_LIMIT,
        };
        const selected = [];
        const counts = {
            fact: 0,
            artifact: 0,
            skill: 0,
            research: 0,
        };

        for (const entry of entries) {
            const typeGroup = entry?.typeGroup || 'fact';
            if ((counts[typeGroup] || 0) >= (caps[typeGroup] || DEFAULT_FACT_LIMIT)) {
                continue;
            }

            selected.push(entry);
            counts[typeGroup] += 1;
            if (selected.length >= topK) {
                break;
            }
        }

        return { selected, counts };
    }

    formatRecallSections(entries = []) {
        const sections = {
            fact: [],
            artifact: [],
            skill: [],
        };

        for (const entry of entries) {
            const typeGroup = entry?.typeGroup || 'fact';
            const text = summarizeLine(entry?.text || '', typeGroup === 'artifact' ? 280 : 220);
            if (!text) {
                continue;
            }

            const metadata = entry?.metadata || {};
            if (typeGroup === 'artifact') {
                const label = [
                    metadata?.artifactFilename || '',
                    metadata?.artifactFormat ? `(${metadata.artifactFormat})` : '',
                ].filter(Boolean).join(' ');
                sections.artifact.push(`- ${label ? `${label}: ` : ''}${text}`);
                continue;
            }

            if (typeGroup === 'skill') {
                sections.skill.push(`- ${text}`);
                continue;
            }

            sections.fact.push(`- ${text}`);
        }

        const rendered = [];
        if (sections.fact.length > 0) {
            rendered.push('Relevant facts:', ...sections.fact);
        }
        if (sections.artifact.length > 0) {
            rendered.push('Relevant prior artifacts:', ...sections.artifact);
        }
        if (sections.skill.length > 0) {
            rendered.push('Reusable skills:', ...sections.skill);
        }

        return rendered.length > 0 ? [rendered.join('\n')] : [];
    }

    async recallDetailed(query, {
        sessionId = null,
        ownerId = null,
        memoryScope = null,
        topK,
        scoreThreshold,
        profile = DEFAULT_RECALL_PROFILE,
        memoryKeywords = [],
    } = {}) {
        const recallOptions = this.getRecallOptions({
            profile,
            topK,
            scoreThreshold,
        });
        const queryKeywords = mergeMemoryKeywords(memoryKeywords, query);
        const artifactFollowup = isArtifactFollowupQuery(query);
        const semanticResults = await this.store.search(query, {
            sessionId,
            ownerId,
            memoryScope: String(memoryScope || '').trim() || null,
            topK: recallOptions.topK,
            scoreThreshold: recallOptions.scoreThreshold,
        });
        const keywordResults = await this.keywordRecall(queryKeywords, {
            sessionId,
            ownerId,
            memoryScope: String(memoryScope || '').trim() || null,
        });
        const mergedResults = this.mergeRecallResults(semanticResults, keywordResults, {
            queryKeywords,
            artifactFollowup,
        });
        const { selected, counts } = this.selectRecallGroups(mergedResults, recallOptions.topK);
        const contextMessages = this.formatRecallSections(selected);
        const trace = {
            query: summarizeLine(query, 200),
            matchedKeywords: queryKeywords,
            artifactFollowup,
            selected: selected.map((entry) => ({
                id: String(entry.id),
                memoryType: entry?.metadata?.memoryType || FACT_MEMORY_TYPE,
                typeGroup: entry.typeGroup,
                score: Number(entry.finalScore || 0),
                semanticScore: Number(entry.semanticScore || 0),
                keywordOverlap: entry.keywordOverlap || [],
                artifactId: entry?.metadata?.artifactId || null,
            })),
            counts,
        };

        runtimeDiagnostics.recordMemoryHitMix({
            fact: counts.fact || 0,
            artifact: counts.artifact || 0,
            skill: counts.skill || 0,
            research: counts.research || 0,
        });
        if (artifactFollowup && (counts.artifact || 0) > 0) {
            runtimeDiagnostics.incrementArtifactFollowupRecalls();
        }

        return {
            entries: selected,
            contextMessages,
            trace,
        };
    }

    async recall(query, {
        sessionId = null,
        ownerId = null,
        memoryScope = null,
        topK,
        scoreThreshold,
        profile = DEFAULT_RECALL_PROFILE,
        memoryKeywords = [],
        returnDetails = false,
    } = {}) {
        const details = await this.recallDetailed(query, {
            sessionId,
            ownerId,
            memoryScope: String(memoryScope || '').trim() || null,
            topK,
            scoreThreshold,
            profile,
            memoryKeywords,
        });

        return returnDetails ? details : details.contextMessages;
    }

    async process(sessionId, message, options = {}) {
        const ownerId = String(options?.ownerId || '').trim() || null;
        const memoryScope = String(options?.memoryScope || '').trim() || null;
        const memoryKeywords = normalizeMemoryKeywords(options?.memoryKeywords || []);
        this.remember(sessionId, message, 'user', {
            ...(ownerId ? { ownerId } : {}),
            ...(memoryScope ? { memoryScope } : {}),
            ...(memoryKeywords.length > 0 ? { memoryKeywords } : {}),
            sourceSurface: options?.sourceSurface || memoryScope || null,
        }).catch((err) => {
            console.error('[Memory] Failed to store message:', err.message);
        });

        try {
            return await this.recall(message, {
                sessionId: ownerId ? null : sessionId,
                ownerId,
                memoryScope,
                memoryKeywords,
                ...options,
            });
        } catch (err) {
            console.error('[Memory] Failed to recall context:', err.message);
            return options?.returnDetails
                ? { entries: [], contextMessages: [], trace: { error: err.message } }
                : [];
        }
    }

    async rememberResponse(sessionId, response, metadata = {}) {
        try {
            await this.remember(sessionId, response, 'assistant', metadata);
        } catch (err) {
            console.error('[Memory] Failed to store response:', err.message);
        }
    }

    async rememberResearchNote(sessionId, note, metadata = {}) {
        const normalizedNote = stripNullCharacters(note).trim();
        if (!normalizedNote) {
            return null;
        }

        try {
            return await this.store.store(sessionId, normalizedNote, this.normalizeMetadata('research-note', normalizedNote, {
                ...metadata,
                memoryType: RESEARCH_MEMORY_TYPE,
            }));
        } catch (err) {
            console.error('[Memory] Failed to store research note:', err.message);
            return null;
        }
    }

    async forget(sessionId) {
        await this.store.deleteSession(sessionId);
    }

    getDiagnostics() {
        return runtimeDiagnostics.snapshot();
    }
}

const memoryService = new MemoryService();

module.exports = {
    memoryService,
    MemoryService,
    DEFAULT_RECALL_PROFILE,
    RESEARCH_RECALL_PROFILE,
    FACT_MEMORY_TYPE,
    ARTIFACT_MEMORY_TYPE,
    SKILL_MEMORY_TYPE,
    RESEARCH_MEMORY_TYPE,
};
