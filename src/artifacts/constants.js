const SUPPORTED_UPLOAD_FORMATS = new Set([
    'xlsx',
    'csv',
    'doc',
    'pdf',
    'docx',
    'xml',
    'html',
    'mermaid',
    'mmd',
]);

const SUPPORTED_GENERATION_FORMATS = new Set([
    'xlsx',
    'pdf',
    'docx',
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
    html: 'text/html',
    m: 'text/plain',
    mermaid: 'text/vnd.mermaid',
    mmd: 'text/vnd.mermaid',
    pdf: 'application/pdf',
    pq: 'text/plain',
    'power-query': 'text/plain',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xml: 'application/xml',
};

const FORMAT_EXTENSIONS = {
    csv: '.csv',
    doc: '.doc',
    docx: '.docx',
    html: '.html',
    m: '.m',
    mermaid: '.mmd',
    mmd: '.mmd',
    pdf: '.pdf',
    pq: '.pq',
    'power-query': '.pq',
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

    if (lowerMime.includes('spreadsheetml')) return 'xlsx';
    if (lowerMime.includes('wordprocessingml')) return 'docx';
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
