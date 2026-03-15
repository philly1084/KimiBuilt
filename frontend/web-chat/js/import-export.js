/**
 * Import/Export Module for KimiBuilt AI Chat
 * Handles DOCX, PDF, HTML, Markdown, JSON, and TXT formats
 */

class ImportExportManager {
    constructor() {
        this.maxFileSize = 50 * 1024 * 1024; // 50MB limit
        this.supportedImportFormats = ['.docx', '.pdf', '.html', '.htm', '.md', '.markdown', '.txt', '.json'];
        this.pendingImport = null;
        this.pendingImportFormat = null;
        this.progressCallback = null;
    }

    getGenericFilenameWords() {
        return new Set([
            'a', 'an', 'all', 'assistant', 'chat', 'conversation', 'default', 'document',
            'download', 'export', 'file', 'generated', 'generic', 'kimibuilt', 'new',
            'notes', 'output', 'pdf', 'report', 'response', 'result', 'session', 'temp',
            'test', 'text', 'tmp', 'untitled', 'web'
        ]);
    }

    generatePleasantFilenameBase() {
        const adjectives = [
            'amber', 'autumn', 'bright', 'calm', 'clear', 'crisp', 'dawn', 'ember',
            'gentle', 'golden', 'lively', 'lunar', 'maple', 'mellow', 'misty', 'noble',
            'orchid', 'quiet', 'silver', 'solar', 'steady', 'velvet', 'warm'
        ];
        const nouns = [
            'atlas', 'bloom', 'bridge', 'canvas', 'compass', 'draft', 'field', 'garden',
            'harbor', 'horizon', 'journal', 'lantern', 'meadow', 'notebook', 'outline',
            'palette', 'path', 'report', 'sketch', 'story', 'studio', 'summit', 'trail'
        ];
        const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adjective}-${noun}`;
    }

    createFriendlyFilenameBase(value, fallback = 'conversation') {
        const slug = String(value || fallback)
            .toLowerCase()
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');

        const tokens = slug.split('-').filter(Boolean);
        if (tokens.length === 0) {
            return this.generatePleasantFilenameBase();
        }

        const genericWords = this.getGenericFilenameWords();
        const meaningfulTokens = tokens.filter((token) => !genericWords.has(token));
        if (meaningfulTokens.length === 0) {
            return this.generatePleasantFilenameBase();
        }

        return meaningfulTokens.slice(0, 6).join('-') || this.generatePleasantFilenameBase();
    }

    // ============================================
    // Export Functions
    // ============================================

    /**
     * Export conversation in specified format
     */
    async exportConversation(format, messages, session) {
        if (!messages || messages.length === 0) {
            throw new Error('No messages to export');
        }

        const sessionTitle = this.createFriendlyFilenameBase(session?.title || 'conversation', 'conversation');

        switch (format) {
            case 'markdown':
                return this.exportAsMarkdown(messages, session, sessionTitle);
            case 'json':
                return this.exportAsJSON(messages, session, sessionTitle);
            case 'txt':
                return this.exportAsText(messages, session, sessionTitle);
            case 'html':
                return this.exportAsHTML(messages, session, sessionTitle);
            case 'docx':
                return await this.exportAsDOCX(messages, session, sessionTitle);
            case 'pdf':
                return await this.exportAsPDF(messages, session, sessionTitle);
            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    exportAsMarkdown(messages, session, sessionTitle) {
        const date = new Date().toLocaleString();
        let md = `# ${session?.title || 'Conversation'}\n\n`;
        md += `**Date:** ${date}  \n`;
        md += `**Messages:** ${messages.length}\n\n`;
        md += `---\n\n`;

        messages.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString();
            let roleLabel;
            switch (msg.role) {
                case 'user':
                    roleLabel = '**You**';
                    break;
                case 'assistant':
                    roleLabel = msg.type === 'image' ? '**AI Image Generator**' : '**Assistant**';
                    break;
                case 'system':
                    roleLabel = '**System**';
                    break;
                default:
                    roleLabel = '**Unknown**';
            }
            md += `### ${roleLabel} *(${time})*\n\n`;

            if (msg.type === 'image') {
                md += `*Prompt: "${msg.prompt || ''}"*\n\n`;
                if (msg.imageUrl) {
                    md += `![Generated Image](${msg.imageUrl})\n\n`;
                }
            } else {
                md += msg.content;
            }
            md += '\n\n---\n\n';
        });

        return {
            content: md,
            filename: `${sessionTitle}.md`,
            mimeType: 'text/markdown'
        };
    }

    exportAsJSON(messages, session, sessionTitle) {
        const exportData = {
            exportFormat: 'kimibuilt-conversation',
            version: '2.0',
            session: {
                id: session?.id,
                title: session?.title,
                mode: session?.mode,
                createdAt: session?.createdAt,
                updatedAt: session?.updatedAt,
                exportedAt: new Date().toISOString()
            },
            messages: messages.map(m => ({
                role: m.role,
                type: m.type,
                content: m.content,
                prompt: m.prompt,
                imageUrl: m.imageUrl,
                model: m.model,
                timestamp: m.timestamp
            }))
        };

        return {
            content: JSON.stringify(exportData, null, 2),
            filename: `${sessionTitle}.json`,
            mimeType: 'application/json'
        };
    }

    exportAsText(messages, session, sessionTitle) {
        const date = new Date().toLocaleString();
        let text = `${session?.title || 'Conversation'}\n`;
        text += `Date: ${date}\n`;
        text += `Messages: ${messages.length}\n`;
        text += `${'='.repeat(50)}\n\n`;

        messages.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleString();
            let roleLabel;
            switch (msg.role) {
                case 'user':
                    roleLabel = 'You';
                    break;
                case 'assistant':
                    roleLabel = msg.type === 'image' ? 'AI Image Generator' : 'Assistant';
                    break;
                case 'system':
                    roleLabel = 'System';
                    break;
                default:
                    roleLabel = 'Unknown';
            }
            text += `[${time}] ${roleLabel}:\n`;

            if (msg.type === 'image') {
                text += `Prompt: "${msg.prompt || ''}"\n`;
                if (msg.imageUrl) {
                    text += `Image: ${msg.imageUrl}\n`;
                }
            } else {
                text += msg.content;
            }
            text += '\n\n' + '-'.repeat(50) + '\n\n';
        });

        return {
            content: text,
            filename: `${sessionTitle}.txt`,
            mimeType: 'text/plain'
        };
    }

    exportAsHTML(messages, session, sessionTitle) {
        const date = new Date().toLocaleString();
        const theme = document.documentElement.getAttribute('data-theme') || 'dark';
        
        let messagesHtml = messages.map(msg => {
            const time = new Date(msg.timestamp).toLocaleString();
            const isUser = msg.role === 'user';
            
            let content = '';
            let avatar = '';
            let author = '';
            
            switch (msg.role) {
                case 'user':
                    avatar = '<div class="avatar user">Y</div>';
                    author = 'You';
                    content = `<div class="message-content user">${this.escapeHtml(msg.content)}</div>`;
                    break;
                case 'assistant':
                    if (msg.type === 'image') {
                        avatar = '<div class="avatar image">IMG</div>';
                        author = 'AI Image Generator';
                        content = `<div class="message-content image">
                            <p><strong>Prompt:</strong> ${this.escapeHtml(msg.prompt || '')}</p>
                            ${msg.imageUrl ? `<img src="${msg.imageUrl}" alt="Generated image" style="max-width: 100%; border-radius: 8px; margin-top: 10px;">` : ''}
                        </div>`;
                    } else {
                        avatar = '<div class="avatar assistant">AI</div>';
                        author = 'Assistant';
                        content = `<div class="message-content assistant">${this.markdownToHtml(msg.content)}</div>`;
                    }
                    break;
                case 'system':
                    avatar = '<div class="avatar system">S</div>';
                    author = 'System';
                    content = `<div class="message-content system">${this.escapeHtml(msg.content)}</div>`;
                    break;
            }
            
            return `
                <div class="message ${isUser ? 'user' : 'assistant'}">
                    ${avatar}
                    <div class="message-body">
                        <div class="message-header">
                            <span class="author">${author}</span>
                            <span class="time">${time}</span>
                        </div>
                        ${content}
                    </div>
                </div>
            `;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(session?.title || 'Conversation')} - KimiBuilt AI</title>
    <style>
        :root {
            --bg-primary: #0d0d0d;
            --bg-secondary: #171717;
            --bg-tertiary: #262626;
            --text-primary: #fafafa;
            --text-secondary: #a3a3a3;
            --border: #262626;
            --accent: #3b82f6;
            --user-bg: #3b82f6;
            --assistant-bg: #262626;
            --code-bg: #1a1a1a;
        }
        [data-theme="light"] {
            --bg-primary: #ffffff;
            --bg-secondary: #fafafa;
            --bg-tertiary: #f4f4f5;
            --text-primary: #18181b;
            --text-secondary: #71717a;
            --border: #e4e4e7;
            --accent: #3b82f6;
            --user-bg: #3b82f6;
            --assistant-bg: #f4f4f5;
            --code-bg: #f1f1f1;
        }
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            background: var(--bg-primary);
            color: var(--text-primary);
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            text-align: center;
            padding: 30px 20px;
            border-bottom: 1px solid var(--border);
            margin-bottom: 30px;
        }
        .header h1 { margin: 0 0 10px 0; color: var(--text-primary); }
        .header .meta { color: var(--text-secondary); font-size: 14px; }
        .message {
            display: flex;
            gap: 15px;
            margin-bottom: 25px;
            animation: fadeIn 0.3s ease;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .message.user { flex-direction: row-reverse; }
        .avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            flex-shrink: 0;
            color: white;
        }
        .avatar.user { background: linear-gradient(135deg, #3b82f6, #2563eb); }
        .avatar.assistant { background: linear-gradient(135deg, #8b5cf6, #ec4899); }
        .avatar.image { background: linear-gradient(135deg, #f59e0b, #ef4444); }
        .avatar.system { background: linear-gradient(135deg, #6b7280, #4b5563); }
        .message-body { flex: 1; }
        .message.user .message-body { text-align: right; }
        .message-header { margin-bottom: 5px; }
        .author { font-weight: 600; font-size: 14px; }
        .time { color: var(--text-secondary); font-size: 12px; margin-left: 10px; }
        .message.user .author { color: var(--accent); }
        .message-content {
            padding: 12px 16px;
            border-radius: 12px;
            text-align: left;
            word-wrap: break-word;
        }
        .message-content.user {
            background: var(--user-bg);
            color: white;
            display: inline-block;
            border-bottom-right-radius: 4px;
        }
        .message-content.assistant {
            background: var(--assistant-bg);
            border-bottom-left-radius: 4px;
        }
        .message-content.image { background: var(--assistant-bg); }
        .message-content.system {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            font-style: italic;
        }
        pre {
            background: var(--code-bg);
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 14px;
        }
        code {
            font-family: 'SF Mono', Monaco, monospace;
            font-size: 14px;
        }
        p code, li code {
            background: var(--code-bg);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 13px;
        }
        blockquote {
            border-left: 3px solid var(--accent);
            margin: 10px 0;
            padding-left: 15px;
            color: var(--text-secondary);
        }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
        th { background: var(--bg-tertiary); }
        ul, ol { padding-left: 20px; }
        .footer {
            text-align: center;
            padding: 30px;
            color: var(--text-secondary);
            font-size: 12px;
            border-top: 1px solid var(--border);
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${this.escapeHtml(session?.title || 'Conversation')}</h1>
        <div class="meta">
            Exported on ${date} | ${messages.length} messages
        </div>
    </div>
    <div class="conversation">
        ${messagesHtml}
    </div>
    <div class="footer">
        Exported from KimiBuilt AI
    </div>
</body>
</html>`;

        return {
            content: html,
            filename: `${sessionTitle}.html`,
            mimeType: 'text/html'
        };
    }

    async exportAsDOCX(messages, session, sessionTitle) {
        // Check if docx library is loaded
        if (typeof docx === 'undefined') {
            await this.loadScript('https://unpkg.com/docx@8.5.0/build/index.js');
        }

        const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = docx;

        const docChildren = [
            new Paragraph({
                text: session?.title || 'Conversation',
                heading: HeadingLevel.TITLE,
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 }
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: 'Exported: ', bold: true }),
                    new TextRun(new Date().toLocaleString())
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 100 }
            }),
            new Paragraph({
                children: [
                    new TextRun({ text: 'Messages: ', bold: true }),
                    new TextRun(String(messages.length))
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 400 }
            })
        ];

        messages.forEach((msg, index) => {
            const time = new Date(msg.timestamp).toLocaleString();
            let roleLabel, roleColor;
            
            switch (msg.role) {
                case 'user':
                    roleLabel = 'You';
                    roleColor = '3B82F6';
                    break;
                case 'assistant':
                    roleLabel = msg.type === 'image' ? 'AI Image Generator' : 'Assistant';
                    roleColor = '8B5CF6';
                    break;
                case 'system':
                    roleLabel = 'System';
                    roleColor = 'F59E0B';
                    break;
                default:
                    roleLabel = 'Unknown';
                    roleColor = '6B7280';
            }

            // Message header
            docChildren.push(new Paragraph({
                children: [
                    new TextRun({ text: roleLabel, bold: true, color: roleColor }),
                    new TextRun({ text: `  (${time})`, color: '888888', size: 18 })
                ],
                spacing: { before: 300, after: 100 },
                border: {
                    top: index > 0 ? {
                        color: 'CCCCCC',
                        space: 1,
                        style: BorderStyle.SINGLE,
                        size: 6
                    } : undefined
                }
            }));

            // Message content
            if (msg.type === 'image') {
                docChildren.push(new Paragraph({
                    children: [new TextRun({ text: `Prompt: "${msg.prompt || ''}"`, italics: true })],
                    spacing: { after: 100 }
                }));
                if (msg.imageUrl) {
                    docChildren.push(new Paragraph({
                        children: [new TextRun({ text: `Image URL: ${msg.imageUrl}`, color: '666666' })],
                        spacing: { after: 200 }
                    }));
                }
            } else {
                const paragraphs = this.parseContentForDocx(msg.content);
                paragraphs.forEach(p => docChildren.push(p));
            }
        });

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        margin: {
                            top: 1440, // 1 inch
                            right: 1440,
                            bottom: 1440,
                            left: 1440
                        }
                    }
                },
                children: docChildren
            }]
        });

        const blob = await Packer.toBlob(doc);
        return {
            blob: blob,
            filename: `${sessionTitle}.docx`,
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
    }

    parseContentForDocx(content) {
        if (!content) return [new Paragraph({ text: '' })];

        const paragraphs = [];
        const lines = content.split('\n');

        lines.forEach(line => {
            const trimmed = line.trim();
            
            // Headers
            if (trimmed.startsWith('### ')) {
                paragraphs.push(new Paragraph({
                    text: trimmed.substring(4),
                    heading: 3,
                    spacing: { before: 200, after: 100 }
                }));
            } else if (trimmed.startsWith('## ')) {
                paragraphs.push(new Paragraph({
                    text: trimmed.substring(3),
                    heading: 2,
                    spacing: { before: 200, after: 100 }
                }));
            } else if (trimmed.startsWith('# ')) {
                paragraphs.push(new Paragraph({
                    text: trimmed.substring(2),
                    heading: 1,
                    spacing: { before: 200, after: 100 }
                }));
            } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                // Bullet list
                paragraphs.push(new Paragraph({
                    text: trimmed.substring(2),
                    bullet: { level: 0 },
                    spacing: { after: 50 }
                }));
            } else if (/^\d+\.\s/.test(trimmed)) {
                // Numbered list
                paragraphs.push(new Paragraph({
                    text: trimmed.replace(/^\d+\.\s/, ''),
                    numbering: { level: 0 },
                    spacing: { after: 50 }
                }));
            } else if (trimmed.startsWith('> ')) {
                // Blockquote
                paragraphs.push(new Paragraph({
                    children: [new TextRun({ text: trimmed.substring(2), italics: true })],
                    indent: { left: 720 },
                    spacing: { after: 100 }
                }));
            } else if (trimmed.startsWith('```')) {
                // Code block indicator - skip
            } else if (trimmed === '---' || trimmed === '***') {
                // Horizontal rule
                paragraphs.push(new Paragraph({
                    text: '',
                    border: {
                        bottom: {
                            color: 'CCCCCC',
                            space: 1,
                            style: BorderStyle.SINGLE,
                            size: 6
                        }
                    },
                    spacing: { before: 100, after: 100 }
                }));
            } else if (trimmed) {
                // Regular paragraph with inline formatting
                const children = this.parseInlineFormatting(trimmed);
                paragraphs.push(new Paragraph({
                    children: children,
                    spacing: { after: 120 }
                }));
            } else {
                // Empty line
                paragraphs.push(new Paragraph({ text: '', spacing: { after: 100 } }));
            }
        });

        return paragraphs.length > 0 ? paragraphs : [new Paragraph({ text: '' })];
    }

    parseInlineFormatting(text) {
        const children = [];
        let remaining = text;

        // Pattern for inline formatting
        const patterns = [
            { regex: /\*\*\*(.+?)\*\*\*/g, format: { bold: true, italics: true } }, // ***bold italic***
            { regex: /\*\*(.+?)\*\*/g, format: { bold: true } },                     // **bold**
            { regex: /\*(.+?)\*/g, format: { italics: true } },                      // *italic*
            { regex: /`(.+?)`/g, format: { font: { name: 'Courier New' } } },        // `code`
            { regex: /__(.+?)__/g, format: { underline: {} } },                     // __underline__
            { regex: /~~(.+?)~~/g, format: { strike: true } }                        // ~~strikethrough~~
        ];

        while (remaining.length > 0) {
            let earliestMatch = null;
            let earliestPattern = null;

            patterns.forEach(pattern => {
                pattern.regex.lastIndex = 0;
                const match = pattern.regex.exec(remaining);
                if (match && (!earliestMatch || match.index < earliestMatch.index)) {
                    earliestMatch = match;
                    earliestPattern = pattern;
                }
            });

            if (earliestMatch) {
                // Add text before the match
                if (earliestMatch.index > 0) {
                    children.push(new docx.TextRun(remaining.substring(0, earliestMatch.index)));
                }
                // Add formatted text
                children.push(new docx.TextRun({
                    text: earliestMatch[1],
                    ...earliestPattern.format
                }));
                remaining = remaining.substring(earliestMatch.index + earliestMatch[0].length);
            } else {
                // No more matches, add remaining text
                children.push(new docx.TextRun(remaining));
                break;
            }
        }

        return children.length > 0 ? children : [new docx.TextRun(text)];
    }

    async exportAsPDF(messages, session, sessionTitle) {
        // Check if html2pdf is loaded
        if (typeof html2pdf === 'undefined') {
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js');
        }

        const htmlContent = this.exportAsHTML(messages, session, sessionTitle).content;
        
        // Create a temporary container
        const container = document.createElement('div');
        container.innerHTML = htmlContent;
        container.style.position = 'absolute';
        container.style.left = '-9999px';
        container.style.width = '800px';
        document.body.appendChild(container);

        try {
            const opt = {
                margin: [15, 15],
                filename: `${sessionTitle}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { 
                    scale: 2,
                    useCORS: true,
                    logging: false
                },
                jsPDF: { 
                    unit: 'mm', 
                    format: 'a4', 
                    orientation: 'portrait'
                }
            };

            const pdfBlob = await html2pdf().set(opt).from(container).output('blob');
            
            return {
                blob: pdfBlob,
                filename: `${sessionTitle}.pdf`,
                mimeType: 'application/pdf'
            };
        } finally {
            document.body.removeChild(container);
        }
    }

    // ============================================
    // Import Functions
    // ============================================

    /**
     * Import file and convert to chat messages
     */
    async importFile(file, onProgress = null) {
        this.progressCallback = onProgress;
        
        // Check file size
        if (file.size > this.maxFileSize) {
            throw new Error(`File too large. Maximum size is ${this.formatFileSize(this.maxFileSize)}`);
        }

        const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        
        if (!this.supportedImportFormats.includes(extension)) {
            throw new Error(`Unsupported file format: ${extension}. Supported: ${this.supportedImportFormats.join(', ')}`);
        }

        this.updateProgress(10, 'Reading file...');

        try {
            let result;
            switch (extension) {
                case '.docx':
                    result = await this.importDOCX(file);
                    break;
                case '.pdf':
                    result = await this.importPDF(file);
                    break;
                case '.html':
                case '.htm':
                    result = await this.importHTML(file);
                    break;
                case '.md':
                case '.markdown':
                    result = await this.importMarkdown(file);
                    break;
                case '.txt':
                    result = await this.importText(file);
                    break;
                case '.json':
                    result = await this.importJSON(file);
                    break;
                default:
                    throw new Error(`Unsupported format: ${extension}`);
            }
            
            this.updateProgress(100, 'Complete!');
            return result;
        } catch (error) {
            throw new Error(`Import failed: ${error.message}`);
        }
    }

    async importDOCX(file) {
        // Check if mammoth is loaded
        if (typeof mammoth === 'undefined') {
            this.updateProgress(20, 'Loading DOCX parser...');
            await this.loadScript('https://unpkg.com/mammoth@1.6.0/mammoth.browser.min.js');
        }

        this.updateProgress(30, 'Parsing DOCX...');

        const arrayBuffer = await file.arrayBuffer();
        
        const result = await mammoth.extractRawText({ arrayBuffer });
        
        if (result.messages && result.messages.length > 0) {
            console.log('DOCX conversion messages:', result.messages);
        }

        this.updateProgress(80, 'Converting to messages...');
        
        // Convert to messages
        const messages = this.parseTextToMessages(result.value);
        
        return {
            format: 'docx',
            title: file.name.replace(/\.docx$/i, ''),
            messages: messages,
            rawContent: result.value
        };
    }

    async importPDF(file) {
        // Check if pdf.js is loaded
        if (typeof pdfjsLib === 'undefined') {
            this.updateProgress(20, 'Loading PDF parser...');
            await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        this.updateProgress(30, 'Parsing PDF...');

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let fullText = '';
        const numPages = pdf.numPages;

        for (let i = 1; i <= numPages; i++) {
            this.updateProgress(30 + (40 * i / numPages), `Reading page ${i}/${numPages}...`);
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        this.updateProgress(80, 'Converting to messages...');
        
        const messages = this.parseTextToMessages(fullText);
        
        return {
            format: 'pdf',
            title: file.name.replace(/\.pdf$/i, ''),
            messages: messages,
            rawContent: fullText,
            pageCount: numPages
        };
    }

    async importHTML(file) {
        this.updateProgress(30, 'Parsing HTML...');
        
        const text = await file.text();
        
        // Create a temporary DOM to parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        
        // Try to extract conversation structure
        const messages = this.extractMessagesFromHTML(doc);
        
        // If no structured messages found, extract as plain text
        if (messages.length === 0) {
            const bodyText = doc.body.innerText || doc.body.textContent;
            const textMessages = this.parseTextToMessages(bodyText);
            messages.push(...textMessages);
        }

        return {
            format: 'html',
            title: this.extractTitle(doc) || file.name.replace(/\.html?$/i, ''),
            messages: messages,
            rawContent: text
        };
    }

    async importMarkdown(file) {
        this.updateProgress(30, 'Parsing Markdown...');
        
        const text = await file.text();
        
        // Parse markdown to extract conversation structure
        const messages = this.parseMarkdownToMessages(text);
        
        return {
            format: 'markdown',
            title: file.name.replace(/\.md$/i, '').replace(/\.markdown$/i, ''),
            messages: messages,
            rawContent: text
        };
    }

    async importText(file) {
        this.updateProgress(30, 'Reading text...');
        
        const text = await file.text();
        
        this.updateProgress(60, 'Converting to messages...');
        
        const messages = this.parseTextToMessages(text);
        
        return {
            format: 'txt',
            title: file.name.replace(/\.txt$/i, ''),
            messages: messages,
            rawContent: text
        };
    }

    async importJSON(file) {
        this.updateProgress(30, 'Parsing JSON...');
        
        const text = await file.text();
        const data = JSON.parse(text);
        
        // Check if it's a KimiBuilt export
        if (data.exportFormat === 'kimibuilt-conversation' && data.messages) {
            return {
                format: 'json',
                title: data.session?.title || file.name.replace(/\.json$/i, ''),
                messages: data.messages.map(m => ({
                    role: m.role,
                    content: m.content,
                    type: m.type,
                    prompt: m.prompt,
                    imageUrl: m.imageUrl,
                    model: m.model,
                    timestamp: m.timestamp || new Date().toISOString()
                })),
                session: data.session,
                rawContent: data
            };
        }
        
        // Try OpenAI format
        if (Array.isArray(data)) {
            return {
                format: 'json',
                title: file.name.replace(/\.json$/i, ''),
                messages: data.map(m => ({
                    role: m.role || 'user',
                    content: m.content || m.message || String(m),
                    timestamp: new Date().toISOString()
                })),
                rawContent: data
            };
        }
        
        // Try to find messages array in object
        const messagesArray = data.messages || data.conversation || data.chat || data.history;
        if (Array.isArray(messagesArray)) {
            return {
                format: 'json',
                title: data.title || file.name.replace(/\.json$/i, ''),
                messages: messagesArray.map(m => ({
                    role: m.role || m.sender || m.from || 'user',
                    content: m.content || m.message || m.text || String(m),
                    timestamp: m.timestamp || m.time || m.date || new Date().toISOString()
                })),
                rawContent: data
            };
        }
        
        throw new Error('Unrecognized JSON format. Expected KimiBuilt export, OpenAI format, or array of messages.');
    }

    // ============================================
    // Parsing Helpers
    // ============================================

    parseTextToMessages(text) {
        const messages = [];
        
        // Try to detect conversation patterns
        // Pattern 1: [Role] Content or Role: Content
        // Pattern 2: "You:" and "Assistant:" markers
        // Pattern 3: Split by double newlines
        
        // Try pattern-based parsing first
        const patterns = [
            // [Timestamp] Role: Content
            /\[(\d{1,2}[\/:]\d{1,2}[\/:]\d{2,4}[^\]]*)\]\s*(You|User|Assistant|AI|System):\s*([\s\S]*?)(?=\[|$)/gi,
            // Role (timestamp): Content
            /(You|User|Assistant|AI|System)\s*\([^)]*\):\s*([\s\S]*?)(?=(You|User|Assistant|AI|System)\s*\(|$)/gi,
            // ### Role *(timestamp)*
            /###\s*(You|\*\*You\*\*|Assistant|\*\*Assistant\*\*|AI Image Generator|\*\*AI Image Generator\*\*|System|\*\*System\*\*)\s*\*?\([^)]*\)\*?\s*\n\n([\s\S]*?)(?=###\s*(You|Assistant|AI|System)|\*\*You\*\*|$)/gi,
        ];
        
        for (const pattern of patterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length >= 2) {
                for (const match of matches) {
                    const roleText = (match[2] || match[1] || '').toLowerCase();
                    let role = 'user';
                    if (roleText.includes('assistant') || roleText.includes('ai')) role = 'assistant';
                    else if (roleText.includes('system')) role = 'system';
                    
                    const content = (match[3] || match[2] || '').trim();
                    if (content) {
                        messages.push({
                            role: role,
                            content: this.cleanContent(content),
                            timestamp: new Date().toISOString()
                        });
                    }
                }
                if (messages.length > 0) return messages;
            }
        }
        
        // Fallback: Split by paragraphs and alternate user/assistant
        const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
        
        if (paragraphs.length === 1) {
            // Single paragraph - treat as user message
            messages.push({
                role: 'user',
                content: this.cleanContent(paragraphs[0]),
                timestamp: new Date().toISOString()
            });
        } else {
            // Alternate between user and assistant
            paragraphs.forEach((para, index) => {
                messages.push({
                    role: index % 2 === 0 ? 'user' : 'assistant',
                    content: this.cleanContent(para),
                    timestamp: new Date().toISOString()
                });
            });
        }
        
        return messages;
    }

    parseMarkdownToMessages(md) {
        const messages = [];
        
        // Look for markdown headers indicating roles
        const rolePattern = /#{1,3}\s*\*?\*?(You|User|Assistant|AI|AI Image Generator|System)\*?\*?(?:\s*\*?\([^)]*\)\*?)?\s*\n\n([\s\S]*?)(?=#{1,3}\s*\*?\*?(You|User|Assistant|AI|System)\*?\*?|$)/gi;
        
        let match;
        while ((match = rolePattern.exec(md)) !== null) {
            const roleText = match[1].toLowerCase();
            let role = 'user';
            if (roleText.includes('assistant') || roleText.includes('ai')) role = 'assistant';
            else if (roleText.includes('system')) role = 'system';
            
            const content = match[2].trim();
            // Remove horizontal rules
            const cleanContent = content.replace(/\n?---+\n?/g, '\n\n').trim();
            
            if (cleanContent) {
                messages.push({
                    role: role,
                    content: this.cleanContent(cleanContent),
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        // If no structured headers found, fall back to paragraph parsing
        if (messages.length === 0) {
            return this.parseTextToMessages(md);
        }
        
        return messages;
    }

    extractMessagesFromHTML(doc) {
        const messages = [];
        
        // Try to find message elements by common class names or structure
        const messageSelectors = [
            '.message',
            '.chat-message',
            '[data-role]',
            '.user-message',
            '.assistant-message',
            '.bubble',
            '.chat-bubble'
        ];
        
        for (const selector of messageSelectors) {
            const elements = doc.querySelectorAll(selector);
            if (elements.length > 0) {
                elements.forEach(el => {
                    const role = el.dataset.role || 
                                 (el.classList.contains('user') || el.classList.contains('user-message') ? 'user' : 'assistant');
                    const content = el.textContent.trim();
                    if (content) {
                        messages.push({
                            role: role,
                            content: content,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
                break;
            }
        }
        
        return messages;
    }

    extractTitle(doc) {
        const title = doc.querySelector('title');
        if (title) return title.textContent.trim();
        
        const h1 = doc.querySelector('h1');
        if (h1) return h1.textContent.trim();
        
        return null;
    }

    cleanContent(content) {
        return content
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // ============================================
    // Utility Functions
    // ============================================

    updateProgress(percent, message = '') {
        if (this.progressCallback) {
            this.progressCallback(percent, message);
        }
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            // Check if already loaded
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    markdownToHtml(markdown) {
        if (!markdown) return '';
        // Simple markdown to HTML conversion
        if (typeof marked !== 'undefined') {
            return marked.parse(markdown);
        }
        // Fallback: basic HTML escape if marked is not available
        return this.escapeHtml(markdown).replace(/\n/g, '<br>');
    }

    downloadFile(content, filename, mimeType) {
        let blob;
        if (content instanceof Blob) {
            blob = content;
        } else {
            blob = new Blob([content], { type: mimeType });
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Create global instance
window.importExportManager = new ImportExportManager();
