# Document Workflow

`document-workflow` recommends, plans, generates, assembles, and bundles document outputs.

Core actions:

- `recommend`: infer document type, format, templates, layout, and next action.
- `plan`: build a deterministic production plan before generation.
- `generate`: create one document or presentation.
- `assemble`: combine source material into one document.
- `generate-suite`: create a multi-format package such as PDF + HTML + XLSX.

Training and Manuals:

- Use `documentType: "training-manual"` for manuals, learner guides, facilitator guides, job aids, workbooks, SOP training, curriculum plans, and training packages.
- Prefer `plan` before generation when the request is broad or design-sensitive.
- Prefer `generate-suite` when the user asks for a package across PDF, XLSX, HTML, or markdown.
- Ask concise design questions when audience, delivery mode, duration, format mix, research depth, assessment style, or visual direction is unclear.
- Ground subject-specific training in vector context and verified web research when the user asks for current facts, standards, procedures, or domain-specific instruction.

Podcast and video podcast training:

- Use `document-workflow` for planning briefs, scripts, worksheets, and supporting documents.
- Use `podcast` for actual audio and MP4 generation.
- For large packages, split work by surface: manual, workbook, HTML page, podcast script, video-podcast storyboard, research, and QA.
