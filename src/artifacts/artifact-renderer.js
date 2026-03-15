const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const { createZip } = require('../utils/zip');
const { createFriendlyFilenameBase, escapeHtml, escapeXml, normalizeWhitespace, slugifyFilename, stripHtml } = require('../utils/text');
const { FORMAT_EXTENSIONS, FORMAT_MIME_TYPES, normalizeFormat } = require('./constants');
const { config } = require('../config');

const execFileAsync = promisify(execFile);
const DEFAULT_BROWSER_CANDIDATES = [
    config.artifacts.browserPath,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/snap/bin/chromium',
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
];

function detectMermaidDiagramType(text = '') {
    const source = String(text || '').trim();
    const detectors = [
        ['flowchart', /^(?:flowchart|graph)\b/i],
        ['sequence', /^sequenceDiagram\b/i],
        ['class', /^classDiagram\b/i],
        ['er', /^erDiagram\b/i],
        ['state', /^stateDiagram(?:-v2)?\b/i],
        ['gantt', /^gantt\b/i],
        ['pie', /^pie\b/i],
        ['journey', /^journey\b/i],
        ['timeline', /^timeline\b/i],
        ['mindmap', /^mindmap\b/i],
        ['gitgraph', /^gitGraph\b/i],
    ];

    return detectors.find(([, pattern]) => pattern.test(source))?.[0] || 'unknown';
}

function normalizeMermaidSource(text = '') {
    let source = String(text || '')
        .replace(/\r\n?/g, '\n')
        .trim();

    if (!source) {
        return '';
    }

    const fenced = source.match(/^```(?:mermaid)?\s*([\s\S]*?)```$/i);
    if (fenced) {
        source = fenced[1].trim();
    }

    const diagramType = detectMermaidDiagramType(source);
    const canRecoverFromInlineSpacing = diagramType !== 'mindmap';

    if (!source.includes('\n') && canRecoverFromInlineSpacing && /\s{2,}/.test(source)) {
        source = source
            .split(/\s{2,}/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');
    }

    source = source
        .replace(/^(flowchart|graph)\s+([A-Za-z]{2})\s+(?=\S)/i, '$1 $2\n')
        .replace(/^(sequenceDiagram|classDiagram|erDiagram|stateDiagram(?:-v2)?|gitGraph|journey|timeline)\s+(?=\S)/i, '$1\n');

    if (canRecoverFromInlineSpacing) {
        source = source.replace(
            /\s+(?=(?:style|classDef|class|linkStyle|click|subgraph|end|section|participant|actor|note|title|accTitle|accDescr)\b)/g,
            '\n',
        );
    }

    return source
        .split('\n')
        .flatMap((line) => (
            canRecoverFromInlineSpacing && /\s{2,}/.test(line) && !/^\s/.test(line)
                ? line.split(/\s{2,}/)
                : [line]
        ))
        .map((line) => line.trimEnd())
        .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1].trim()))
        .join('\n')
        .trim();
}

function extractHtmlBody(html = '') {
    const source = String(html || '').trim();
    if (!source) {
        return { body: '', head: '' };
    }

    const headMatch = source.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

    return {
        head: headMatch ? headMatch[1].trim() : '',
        body: bodyMatch ? bodyMatch[1].trim() : source,
    };
}

function extractCompositeDocumentParts(input = '') {
    let source = String(input || '').replace(/\r\n?/g, '\n').trim();
    if (!source) {
        return { mermaidSource: '', bodyContent: '', headContent: '' };
    }

    let bodyContent = '';
    let headContent = '';

    const htmlFence = source.match(/```html\s*([\s\S]*?)```/i);
    if (htmlFence) {
        source = source.replace(htmlFence[0], '').trim();
        const htmlParts = extractHtmlBody(htmlFence[1]);
        bodyContent = htmlParts.body;
        headContent = htmlParts.head;
    } else if (/<!doctype html>|<html\b|<body\b/i.test(source)) {
        const htmlParts = extractHtmlBody(source);
        source = '';
        bodyContent = htmlParts.body;
        headContent = htmlParts.head;
    }

    let mermaidSource = '';
    const mermaidFence = source.match(/```mermaid\s*([\s\S]*?)```/i);
    if (mermaidFence) {
        mermaidSource = normalizeMermaidSource(mermaidFence[1]);
        source = source.replace(mermaidFence[0], '').trim();
    } else if (detectMermaidDiagramType(source) !== 'unknown') {
        const htmlStart = source.search(/```html\b|<!doctype html>|<html\b|<body\b|^#\s|^\d+\.\s|\n#\s|\n\d+\.\s/m);
        const mermaidCandidate = htmlStart > 0 ? source.slice(0, htmlStart).trim() : source;
        const normalizedMermaid = normalizeMermaidSource(mermaidCandidate);
        if (detectMermaidDiagramType(normalizedMermaid) !== 'unknown') {
            mermaidSource = normalizedMermaid;
            source = htmlStart > 0 ? source.slice(htmlStart).trim() : '';
        }
    }

    if (!bodyContent) {
        bodyContent = source.trim();
    } else if (source.trim()) {
        bodyContent = `${source.trim()}\n\n${bodyContent}`.trim();
    }

    return { mermaidSource, bodyContent, headContent };
}

function renderBodyMarkup(content = '') {
    const trimmed = String(content || '').trim();
    if (!trimmed) {
        return '';
    }

    if (/<[a-z][\s\S]*>/i.test(trimmed)) {
        return trimmed;
    }

    return trimmed
        .split(/\n{2,}/)
        .map((block) => {
            const normalized = block.trim();
            if (!normalized) {
                return '';
            }
            return `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
        })
        .filter(Boolean)
        .join('\n');
}

function buildMermaidMarkup(mermaidSource = '') {
    if (!mermaidSource) {
        return '';
    }

    return `
<section class="mermaid-section">
  <div class="mermaid-frame">
    <div class="mermaid">${escapeHtml(mermaidSource)}</div>
  </div>
</section>`;
}

function ensureHtmlDocument(bodyHtml, title = 'Document') {
    const { mermaidSource, bodyContent, headContent } = extractCompositeDocumentParts(bodyHtml);
    const content = renderBodyMarkup(bodyContent);

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeXml(title)}</title>
<style>
body { font-family: Arial, sans-serif; margin: 40px; color: #1f2937; }
h1, h2, h3 { color: #111827; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
pre { background: #f3f4f6; padding: 12px; overflow: auto; }
code { background: #f3f4f6; padding: 2px 4px; }
.mermaid-section { margin: 0 0 24px; }
.mermaid-frame { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; background: #ffffff; }
.mermaid { text-align: center; }
.mermaid svg { max-width: 100%; height: auto; }
</style>
${headContent}
${mermaidSource ? '<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>' : ''}
${mermaidSource ? `<script>
window.addEventListener('load', async () => {
  if (!window.mermaid) return;
  try {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    const nodes = document.querySelectorAll('.mermaid');
    if (nodes.length) {
      await window.mermaid.run({ nodes });
    }
  } catch (error) {
    console.error('Mermaid render failed:', error);
  }
});
</script>` : ''}
</head>
<body>
${buildMermaidMarkup(mermaidSource)}
${content}
</body>
</html>`;
}

function buildPdfBufferFromText(text, title = 'Document') {
    const lines = normalizeWhitespace(text || '').split('\n');
    const safeLines = lines.length > 0 ? lines : [''];
    let y = 760;
    const commands = ['BT', '/F1 11 Tf'];

    for (const line of safeLines.slice(0, 120)) {
        const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        commands.push(`1 0 0 1 50 ${y} Tm (${escaped.slice(0, 120)}) Tj`);
        y -= 14;
        if (y < 60) break;
    }

    commands.push('ET');
    const contentStream = Buffer.from(commands.join('\n'), 'utf8');
    const objects = [];
    const offsets = [0];

    function addObject(body) {
        const objectNumber = objects.length + 1;
        const rendered = `${objectNumber} 0 obj\n${body}\nendobj\n`;
        objects.push(rendered);
        return objectNumber;
    }

    const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const contentId = addObject(`<< /Length ${contentStream.length} >>\nstream\n${contentStream.toString('binary')}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    const pagesId = addObject(`<< /Type /Pages /Count 1 /Kids [${pageId} 0 R] >>`);
    const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = addObject(`<< /Title (${title.replace(/[()]/g, '')}) >>`);

    let output = '%PDF-1.4\n';
    for (const object of objects) {
        offsets.push(Buffer.byteLength(output, 'binary'));
        output += object;
    }

    const xrefOffset = Buffer.byteLength(output, 'binary');
    output += `xref\n0 ${objects.length + 1}\n`;
    output += '0000000000 65535 f \n';
    for (let index = 1; index <= objects.length; index += 1) {
        output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return Buffer.from(output, 'binary');
}

function htmlToParagraphs(html) {
    return normalizeWhitespace(stripHtml(html)).split('\n').filter(Boolean);
}

function buildDocxBufferFromHtml(html, title = 'Document') {
    const paragraphs = htmlToParagraphs(html);
    const body = paragraphs.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`).join('') || '<w:p><w:r><w:t></w:t></w:r></w:p>';

    const entries = [
        {
            name: '[Content_Types].xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
        },
        {
            name: '_rels/.rels',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
        },
        {
            name: 'docProps/core.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>LillyBuilt</dc:creator>
  <cp:lastModifiedBy>LillyBuilt</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`,
        },
        {
            name: 'docProps/app.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LillyBuilt</Application>
</Properties>`,
        },
        {
            name: 'word/document.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 w15 wp14">
  <w:body>
    ${body}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`,
        },
    ];

    return createZip(entries);
}

function columnName(index) {
    let value = '';
    let current = index + 1;
    while (current > 0) {
        const remainder = (current - 1) % 26;
        value = String.fromCharCode(65 + remainder) + value;
        current = Math.floor((current - remainder) / 26);
    }
    return value;
}

function buildXlsxBufferFromWorkbookSpec(spec = {}) {
    const sheets = Array.isArray(spec.sheets) && spec.sheets.length > 0
        ? spec.sheets
        : [{ name: spec.title || 'Sheet1', rows: [['Output'], [spec.text || '']] }];

    const sharedStrings = [];
    const sharedStringIndex = new Map();
    const sheetEntries = [];

    function getSharedStringId(value) {
        const stringValue = String(value);
        if (!sharedStringIndex.has(stringValue)) {
            sharedStringIndex.set(stringValue, sharedStrings.length);
            sharedStrings.push(stringValue);
        }
        return sharedStringIndex.get(stringValue);
    }

    sheets.forEach((sheet, sheetIndex) => {
        const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
        const rowXml = rows.map((row, rowIndex) => {
            const cells = (Array.isArray(row) ? row : [row]).map((cell, cellIndex) => {
                if (typeof cell === 'number' && Number.isFinite(cell)) {
                    return `<c r="${columnName(cellIndex)}${rowIndex + 1}"><v>${cell}</v></c>`;
                }
                const stringId = getSharedStringId(cell == null ? '' : cell);
                return `<c r="${columnName(cellIndex)}${rowIndex + 1}" t="s"><v>${stringId}</v></c>`;
            }).join('');
            return `<row r="${rowIndex + 1}">${cells}</row>`;
        }).join('');

        sheetEntries.push({
            name: `xl/worksheets/sheet${sheetIndex + 1}.xml`,
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowXml}</sheetData>
</worksheet>`,
        });
    });

    const workbookSheets = sheets.map((sheet, index) => `
    <sheet name="${escapeXml(sheet.name || `Sheet${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');

    const workbookRels = sheets.map((sheet, index) => `
  <Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');

    const contentOverrides = sheets.map((sheet, index) => `
  <Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');

    const entries = [
        {
            name: '[Content_Types].xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>${contentOverrides}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
        },
        {
            name: '_rels/.rels',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
        },
        {
            name: 'docProps/core.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(spec.title || 'Workbook')}</dc:title>
  <dc:creator>LillyBuilt</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`,
        },
        {
            name: 'docProps/app.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>LillyBuilt</Application>
</Properties>`,
        },
        {
            name: 'xl/workbook.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${workbookSheets}
  </sheets>
</workbook>`,
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
        },
        {
            name: 'xl/sharedStrings.xml',
            data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`,
        },
        ...sheetEntries,
    ];

    return createZip(entries);
}

function buildWorkbookSpecFromText(text, title = 'Workbook') {
    const lines = normalizeWhitespace(text).split('\n').filter(Boolean);
    const rows = lines.map((line) => line.split('|').map((cell) => cell.trim())).filter((row) => row.length > 0);
    return {
        title,
        sheets: [
            {
                name: 'Sheet1',
                rows: rows.length > 0 ? rows : [['Output'], [text]],
            },
        ],
    };
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveBrowserPath() {
    for (const candidate of DEFAULT_BROWSER_CANDIDATES) {
        if (!candidate) continue;
        if (candidate.includes(path.sep)) {
            if (await fileExists(candidate)) {
                return candidate;
            }
            continue;
        }
        return candidate;
    }
    return null;
}

function getBrowserArgs(outputPath, inputPath, html = '') {
    const configuredArgs = String(config.artifacts.browserArgs || '').trim();
    const extraArgs = configuredArgs ? configuredArgs.split(/\s+/).filter(Boolean) : [];
    const virtualTimeBudget = /class="mermaid"|cdn\.jsdelivr\.net\/npm\/mermaid/i.test(String(html || ''))
        ? 10000
        : 5000;
    return [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--disable-dev-shm-usage',
        '--run-all-compositor-stages-before-draw',
        `--virtual-time-budget=${virtualTimeBudget}`,
        '--no-pdf-header-footer',
        `--print-to-pdf=${outputPath}`,
        ...extraArgs,
        pathToFileURL(inputPath).href,
    ];
}

async function renderPdfViaBrowser(html, title) {
    const browserPath = await resolveBrowserPath();
    if (!browserPath) {
        return null;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lillybuilt-pdf-'));
    const baseName = createFriendlyFilenameBase(title || 'document', 'document');
    const htmlPath = path.join(tempDir, `${baseName}.html`);
    const pdfPath = path.join(tempDir, `${baseName}.pdf`);

    try {
        await fs.writeFile(htmlPath, html, 'utf8');
        await execFileAsync(browserPath, getBrowserArgs(pdfPath, htmlPath, html), {
            timeout: config.artifacts.pdfTimeoutMs,
            windowsHide: true,
        });
        const buffer = await fs.readFile(pdfPath);
        return buffer;
    } catch (error) {
        console.warn('[Artifacts] Browser PDF rendering failed:', error.message);
        return null;
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function renderArtifact({ format, content, title = 'artifact', workbookSpec = null }) {
    const normalizedFormat = normalizeFormat(format);
    const extension = FORMAT_EXTENSIONS[normalizedFormat] || '.txt';
    const mimeType = FORMAT_MIME_TYPES[normalizedFormat] || 'application/octet-stream';
    const filename = `${createFriendlyFilenameBase(title, 'artifact')}${extension}`;

    if (normalizedFormat === 'html') {
        const html = ensureHtmlDocument(content, title);
        return {
            filename,
            format: 'html',
            mimeType,
            buffer: Buffer.from(html, 'utf8'),
            previewHtml: html,
            extractedText: stripHtml(html),
            metadata: { title },
        };
    }

    if (normalizedFormat === 'pdf') {
        const html = ensureHtmlDocument(content, title);
        const text = stripHtml(html);
        const browserBuffer = await renderPdfViaBrowser(html, title);
        return {
            filename,
            format: 'pdf',
            mimeType,
            buffer: browserBuffer || buildPdfBufferFromText(text, title),
            previewHtml: html,
            extractedText: text,
            metadata: {
                title,
                sourceHtml: html,
                renderEngine: browserBuffer ? 'browser' : 'basic',
            },
        };
    }

    if (normalizedFormat === 'docx') {
        const html = ensureHtmlDocument(content, title);
        return {
            filename,
            format: 'docx',
            mimeType,
            buffer: buildDocxBufferFromHtml(html, title),
            previewHtml: html,
            extractedText: stripHtml(html),
            metadata: { title, sourceHtml: html },
        };
    }

    if (normalizedFormat === 'xlsx') {
        const spec = workbookSpec || buildWorkbookSpecFromText(content, title);
        const text = spec.sheets.map((sheet) => `[${sheet.name}]\n${(sheet.rows || []).map((row) => row.join(' | ')).join('\n')}`).join('\n\n');
        return {
            filename,
            format: 'xlsx',
            mimeType,
            buffer: buildXlsxBufferFromWorkbookSpec(spec),
            previewHtml: `<pre>${escapeHtml(text)}</pre>`,
            extractedText: text,
            metadata: { title: spec.title || title, sheets: (spec.sheets || []).map((sheet) => sheet.name) },
        };
    }

    const textContent = String(content || '');
    const normalizedTextContent = normalizedFormat === 'mermaid'
        ? normalizeMermaidSource(textContent)
        : textContent;
    return {
        filename,
        format: normalizedFormat,
        mimeType,
        buffer: Buffer.from(normalizedTextContent, 'utf8'),
        previewHtml: normalizedFormat === 'xml' || normalizedFormat === 'mermaid' || normalizedFormat === 'power-query'
            ? `<pre>${escapeHtml(normalizedTextContent)}</pre>`
            : '',
        extractedText: normalizedTextContent,
        metadata: { title },
    };
}

module.exports = {
    ensureHtmlDocument,
    extractCompositeDocumentParts,
    normalizeMermaidSource,
    renderArtifact,
};
