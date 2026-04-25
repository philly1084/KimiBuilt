/**
 * Notes Design Layout Catalog
 *
 * A small indexed library that agents and users can reference when turning
 * rough notes into a designed block page.
 */
const NotesLayoutCatalog = (function() {
    const PAGE_LAYOUTS = Object.freeze([
        Object.freeze({
            index: 1,
            id: 'executive-brief',
            name: 'Executive Brief',
            bestFor: 'Decisions, summaries, stakeholder updates, and fast-read pages.',
            opening: 'Title, compact metadata, and one bottom-line callout.',
            blockFlow: ['heading_1', 'callout', 'bulleted_list', 'heading_2', 'text', 'todo'],
            prompt: 'Use layout #1 Executive Brief: lead with the answer, add key signals, risks, and next steps, and replace weak sections instead of appending duplicates.',
        }),
        Object.freeze({
            index: 2,
            id: 'editorial-explainer',
            name: 'Editorial Explainer',
            bestFor: 'Topic pages, learning notes, science explainers, animal pages, and polished knowledge pages.',
            opening: 'Title, big-idea callout, and a hero image or quick-facts cluster.',
            blockFlow: ['heading_1', 'callout', 'image', 'database', 'heading_2', 'bulleted_list', 'toggle'],
            prompt: 'Use layout #2 Editorial Explainer: create an editorial first screen with a big idea, visual support, quick facts, themed sections, and a source or appendix cluster.',
        }),
        Object.freeze({
            index: 3,
            id: 'research-hub',
            name: 'Research Hub',
            bestFor: 'Source-backed research, comparisons, evidence pages, and investigations.',
            opening: 'Research question, synthesis callout, and visible source handling.',
            blockFlow: ['heading_1', 'callout', 'heading_2', 'database', 'heading_2', 'bookmark', 'toggle'],
            prompt: 'Use layout #3 Research Hub: group findings by theme, separate synthesis from evidence, use bookmarks or databases for proof, and end with open questions.',
        }),
        Object.freeze({
            index: 4,
            id: 'operator-board',
            name: 'Operator Board',
            bestFor: 'Projects, dashboards, trackers, roadmaps, and working status pages.',
            opening: 'Status callout plus a tracker near the top.',
            blockFlow: ['heading_1', 'callout', 'database', 'heading_2', 'todo', 'heading_2', 'bulleted_list'],
            prompt: 'Use layout #4 Operator Board: make status, owners, blockers, and next moves visible with structured blocks instead of long prose.',
        }),
        Object.freeze({
            index: 5,
            id: 'sales-proof-stack',
            name: 'Sales Proof Stack',
            bestFor: 'Sales pitches, proposals, offer pages, proof narratives, and client briefs.',
            opening: 'Value proposition callout and one proof cue close to the top.',
            blockFlow: ['heading_1', 'callout', 'heading_2', 'quote', 'database', 'heading_2', 'todo'],
            prompt: 'Use layout #5 Sales Proof Stack: move from pain to solution to proof to objections and finish with a clear next step.',
        }),
        Object.freeze({
            index: 6,
            id: 'guided-procedure',
            name: 'Guided Procedure',
            bestFor: 'How-to guides, SOPs, runbooks, setup docs, and onboarding pages.',
            opening: 'Scope or prerequisite callout before the procedure.',
            blockFlow: ['heading_1', 'callout', 'heading_2', 'numbered_list', 'code', 'toggle', 'bookmark'],
            prompt: 'Use layout #6 Guided Procedure: keep the main flow procedural, put warnings in callouts, examples in code or diagrams, and optional depth in toggles.',
        }),
        Object.freeze({
            index: 7,
            id: 'session-record',
            name: 'Session Record',
            bestFor: 'Meetings, interviews, retros, journals, check-ins, and collaborative notes.',
            opening: 'Context metadata and a summary callout before detailed notes.',
            blockFlow: ['heading_1', 'text', 'callout', 'heading_2', 'bulleted_list', 'heading_2', 'todo'],
            prompt: 'Use layout #7 Session Record: separate context, discussion, decisions, and follow-up work so the note is easy to revisit.',
        }),
    ]);

    const BLOCK_STARTERS = Object.freeze([
        Object.freeze({ index: 1, type: 'text', label: 'Blank paragraph', useWhen: 'General prose or a small connective note.' }),
        Object.freeze({ index: 2, type: 'heading_2', label: 'Section heading', useWhen: 'A major section needs a clear anchor.' }),
        Object.freeze({ index: 3, type: 'heading_3', label: 'Compact label', useWhen: 'A short Notion-style sublabel is better than a large heading.' }),
        Object.freeze({ index: 4, type: 'callout', label: 'Focal callout', useWhen: 'A takeaway, warning, decision, or summary deserves emphasis.' }),
        Object.freeze({ index: 5, type: 'database', label: 'Tracker table', useWhen: 'Items need repeated fields, owners, status, or comparison.' }),
        Object.freeze({ index: 6, type: 'todo', label: 'Action item', useWhen: 'The block is an executable task or follow-up.' }),
        Object.freeze({ index: 7, type: 'toggle', label: 'Expandable detail', useWhen: 'The detail matters but should not dominate the main page.' }),
        Object.freeze({ index: 8, type: 'quote', label: 'Proof quote', useWhen: 'A definition, source excerpt, or testimonial needs visual separation.' }),
        Object.freeze({ index: 9, type: 'bookmark', label: 'Source bookmark', useWhen: 'A link should be visible as evidence or reference.' }),
        Object.freeze({ index: 10, type: 'mermaid', label: 'Diagram shell', useWhen: 'A process, architecture, timeline, or relationship map is clearer visually.' }),
    ]);

    function getPageLayouts() {
        return PAGE_LAYOUTS.map((layout) => ({ ...layout, blockFlow: [...layout.blockFlow] }));
    }

    function getBlockStarters() {
        return BLOCK_STARTERS.map((starter) => ({ ...starter }));
    }

    function findPageLayout(value) {
        const normalized = String(value || '').trim().toLowerCase();
        return PAGE_LAYOUTS.find((layout) =>
            String(layout.index) === normalized
            || layout.id === normalized
            || layout.name.toLowerCase() === normalized
        ) || null;
    }

    function buildIndexedGuide(limit = PAGE_LAYOUTS.length) {
        return PAGE_LAYOUTS.slice(0, limit).map((layout) => [
            `${layout.index}. ${layout.name} [${layout.id}]`,
            `   Best for: ${layout.bestFor}`,
            `   Opening: ${layout.opening}`,
            `   Block flow: ${layout.blockFlow.join(' -> ')}`,
        ].join('\n')).join('\n\n');
    }

    function buildStarterGuide(limit = BLOCK_STARTERS.length) {
        return BLOCK_STARTERS.slice(0, limit)
            .map((starter) => `${starter.index}. ${starter.label} (${starter.type}) - ${starter.useWhen}`)
            .join('\n');
    }

    return {
        getPageLayouts,
        getBlockStarters,
        findPageLayout,
        buildIndexedGuide,
        buildStarterGuide,
    };
})();

window.NotesLayoutCatalog = NotesLayoutCatalog;
