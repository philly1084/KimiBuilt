const SUPPORTED_UPLOAD_FORMATS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'svg',
    'xlsx',
    'csv',
    'doc',
    'pdf',
    'docx',
    'pptx',
    'xml',
    'html',
    'mermaid',
    'mmd',
]);

const SUPPORTED_GENERATION_FORMATS = new Set([
    'xlsx',
    'pdf',
    'pptx',
    'html',
    'xml',
    'mermaid',
    'power-query',
    'pq',
    'm',
]);

const FORMAT_MIME_TYPES = {
    csv: 'text/csv',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    gif: 'image/gif',
    html: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m: 'text/plain',
    mermaid: 'text/vnd.mermaid',
    mmd: 'text/vnd.mermaid',
    pdf: 'application/pdf',
    png: 'image/png',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pq: 'text/plain',
    'power-query': 'text/plain',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
};

const FORMAT_EXTENSIONS = {
    csv: '.csv',
    doc: '.doc',
    docx: '.docx',
    gif: '.gif',
    html: '.html',
    jpeg: '.jpg',
    jpg: '.jpg',
    m: '.m',
    mermaid: '.mmd',
    mmd: '.mmd',
    pdf: '.pdf',
    png: '.png',
    pptx: '.pptx',
    pq: '.pq',
    'power-query': '.pq',
    svg: '.svg',
    webp: '.webp',
    xlsx: '.xlsx',
    xml: '.xml',
};

const TEXTUAL_FORMATS = new Set(['csv', 'html', 'xml', 'mermaid', 'mmd', 'pq', 'm', 'power-query']);

function normalizeFormat(format = '') {
    const normalized = String(format || '').trim().toLowerCase();
    if (normalized === 'mmd') return 'mermaid';
    if (normalized === 'pq' || normalized === 'm') return 'power-query';
    return normalized;
}

function inferFormat(filename = '', mimeType = '') {
    const lowerFilename = String(filename || '').toLowerCase();
    const lowerMime = String(mimeType || '').toLowerCase();
    const extensionMatch = lowerFilename.match(/\.([a-z0-9]+)$/i);
    const extension = extensionMatch ? extensionMatch[1] : '';

    if (extension === 'mmd') return 'mermaid';
    if (extension === 'pq' || extension === 'm') return 'power-query';
    if (SUPPORTED_UPLOAD_FORMATS.has(extension) || SUPPORTED_GENERATION_FORMATS.has(extension)) {
        return extension;
    }

    if (lowerMime.includes('png')) return 'png';
    if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) return 'jpg';
    if (lowerMime.includes('gif')) return 'gif';
    if (lowerMime.includes('webp')) return 'webp';
    if (lowerMime.includes('svg')) return 'svg';
    if (lowerMime.includes('spreadsheetml')) return 'xlsx';
    if (lowerMime.includes('wordprocessingml')) return 'docx';
    if (lowerMime.includes('presentationml')) return 'pptx';
    if (lowerMime.includes('msword')) return 'doc';
    if (lowerMime.includes('pdf')) return 'pdf';
    if (lowerMime.includes('html')) return 'html';
    if (lowerMime.includes('xml')) return 'xml';
    if (lowerMime.includes('csv')) return 'csv';
    if (lowerMime.includes('mermaid')) return 'mermaid';

    return extension || '';
}

module.exports = {
    FORMAT_EXTENSIONS,
    FORMAT_MIME_TYPES,
    SUPPORTED_GENERATION_FORMATS,
    SUPPORTED_UPLOAD_FORMATS,
    TEXTUAL_FORMATS,
    inferFormat,
    normalizeFormat,
};
