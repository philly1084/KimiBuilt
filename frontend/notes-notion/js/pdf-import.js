/**
 * Enhanced PDF Import Module
 * Handles complex PDFs with mixed text and images using PDF.js
 * Features: text extraction, image extraction, OCR hints, progress tracking, page selection
 */

const PDFImport = (function() {
    // Configuration
    const CONFIG = {
        // Image extraction quality (0-1)
        imageQuality: 0.92,
        // Max image dimension for performance
        maxImageDimension: 2048,
        // Minimum text length to consider page as "text-based"
        minTextLength: 10,
        // Enable/disable image extraction
        extractImages: true,
        // Render scale for image extraction (higher = better quality but slower)
        renderScale: 2.0,
        // Batch size for processing pages (to avoid UI blocking)
        batchSize: 3
    };

    // PDF.js library reference
    let pdfjsLib = null;

    /**
     * Initialize the PDF import module
     */
    function initialize() {
        // Check for PDF.js
        if (typeof window.pdfjsLib !== 'undefined') {
            pdfjsLib = window.pdfjsLib;
            // Set worker source
            pdfjsLib.GlobalWorkerOptions.workerSrc = 
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            return true;
        }
        return false;
    }

    /**
     * Load PDF.js dynamically if not already loaded
     */
    async function loadPDFJS() {
        if (pdfjsLib) return true;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => {
                pdfjsLib = window.pdfjsLib;
                pdfjsLib.GlobalWorkerOptions.workerSrc = 
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                resolve(true);
            };
            script.onerror = () => reject(new Error('Failed to load PDF.js library'));
            document.head.appendChild(script);
        });
    }

    /**
     * Main import function with progress callback
     * @param {ArrayBuffer} arrayBuffer - PDF file data
     * @param {Object} options - Import options
     * @param {Function} progressCallback - Called with progress updates
     * @returns {Promise<Object>} - Page object with blocks
     */
    async function importPDF(arrayBuffer, options = {}, progressCallback = null) {
        const settings = { ...CONFIG, ...options };
        
        // Ensure PDF.js is loaded
        if (!pdfjsLib) {
            await loadPDFJS();
        }

        try {
            // Load the PDF document
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;
            
            const totalPages = pdf.numPages;
            const pagesToProcess = settings.pageRange ? 
                getPagesInRange(settings.pageRange, totalPages) :
                Array.from({ length: totalPages }, (_, i) => i + 1);

            if (progressCallback) {
                progressCallback({ 
                    stage: 'loading', 
                    message: `Loaded PDF with ${totalPages} pages`,
                    totalPages,
                    pagesToProcess: pagesToProcess.length,
                    progress: 0.05
                });
            }

            // Process pages
            const pageBlocks = [];
            let hasImages = false;
            let hasText = false;
            let scannedPageCount = 0;

            for (let i = 0; i < pagesToProcess.length; i++) {
                const pageNum = pagesToProcess[i];
                const progress = 0.1 + (0.8 * (i / pagesToProcess.length));
                
                if (progressCallback) {
                    progressCallback({
                        stage: 'processing',
                        message: `Processing page ${pageNum} of ${totalPages}...`,
                        currentPage: pageNum,
                        totalPages,
                        progress
                    });
                }

                const pageResult = await processPage(pdf, pageNum, settings);
                
                if (pageResult.hasImages) hasImages = true;
                if (pageResult.hasText) hasText = true;
                if (pageResult.isScanned) scannedPageCount++;

                // Add page separator if not the first page and has content
                if (i > 0 && pageResult.blocks.length > 0) {
                    pageBlocks.push({
                        type: 'divider',
                        content: '',
                        id: generateId()
                    });
                }

                pageBlocks.push(...pageResult.blocks);
            }

            if (progressCallback) {
                progressCallback({
                    stage: 'finalizing',
                    message: 'Finalizing import...',
                    progress: 0.95
                });
            }

            // Determine if PDF might be scanned
            const isMostlyScanned = scannedPageCount > (pagesToProcess.length / 2);

            // Create the page object
            const page = {
                title: settings.title || extractTitleFromBlocks(pageBlocks) || 'Imported PDF',
                icon: '📄',
                blocks: pageBlocks.length > 0 ? pageBlocks : [createTextBlock('No content could be extracted from this PDF.')],
                metadata: {
                    totalPages,
                    pagesImported: pagesToProcess.length,
                    hasImages,
                    hasText,
                    isScanned: isMostlyScanned,
                    needsOCR: isMostlyScanned && !hasText
                }
            };

            // Add warning for scanned PDFs
            if (isMostlyScanned && !settings.skipOCRWarning) {
                page.blocks.unshift(createCalloutBlock(
                    '⚠️ This appears to be a scanned or image-based PDF. Text extraction may be limited. Consider using OCR tools before importing for better results.',
                    '⚠️'
                ));
            }

            if (progressCallback) {
                progressCallback({
                    stage: 'complete',
                    message: 'Import complete!',
                    progress: 1.0
                });
            }

            return page;

        } catch (error) {
            console.error('PDF import error:', error);
            throw new Error(`Failed to import PDF: ${error.message}`);
        }
    }

    /**
     * Process a single PDF page
     */
    async function processPage(pdf, pageNum, settings) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.0 });
        
        // Get text content
        const textContent = await page.getTextContent();
        const textItems = textContent.items;
        
        // Extract text with positioning info
        const textResult = extractStructuredText(textItems, viewport);
        
        // Check if page appears to be scanned (very little text)
        const isScanned = textResult.fullText.length < settings.minTextLength;
        
        const blocks = [];
        let hasImages = false;
        let hasText = textResult.fullText.length > 0;

        // If scanned or image-based, render as image
        if (isScanned && settings.extractImages) {
            try {
                const imageBlock = await renderPageToImageBlock(page, viewport, settings, `Page ${pageNum}`);
                if (imageBlock) {
                    blocks.push(imageBlock);
                    hasImages = true;
                }
            } catch (e) {
                console.warn(`Failed to render page ${pageNum} as image:`, e);
                blocks.push(createTextBlock(`[Page ${pageNum} - Could not extract content]`));
            }
        } else {
            // Process text into blocks
            const textBlocks = convertTextToBlocks(textResult);
            blocks.push(...textBlocks);

            // Also extract any images embedded in the PDF
            if (settings.extractImages) {
                try {
                    const imageBlocks = await extractImagesFromPage(page, viewport, settings);
                    if (imageBlocks.length > 0) {
                        blocks.push(...imageBlocks);
                        hasImages = true;
                    }
                } catch (e) {
                    console.warn(`Failed to extract images from page ${pageNum}:`, e);
                }
            }
        }

        // Clean up
        page.cleanup();

        return {
            blocks,
            hasImages,
            hasText,
            isScanned
        };
    }

    /**
     * Extract structured text from PDF text items
     */
    function extractStructuredText(items, viewport) {
        // Group items by their vertical position (lines)
        const lines = new Map();
        const fullTextParts = [];

        items.forEach(item => {
            const text = item.str;
            if (!text.trim()) return;

            fullTextParts.push(text);

            // Get vertical position (transform[5] is the y-coordinate)
            const y = Math.round(item.transform[5]);
            const fontHeight = item.height || 12;
            
            // Group by approximate line (within 3 pixels)
            let lineKey = null;
            for (const [key] of lines) {
                if (Math.abs(key - y) < 3) {
                    lineKey = key;
                    break;
                }
            }
            
            if (lineKey === null) {
                lineKey = y;
            }

            if (!lines.has(lineKey)) {
                lines.set(lineKey, []);
            }

            lines.get(lineKey).push({
                text,
                x: item.transform[4],
                y,
                fontSize: item.fontName ? parseFontSize(item.fontName) : 12,
                fontHeight,
                hasEOL: item.hasEOL
            });
        });

        // Sort lines by Y position (top to bottom)
        const sortedLines = Array.from(lines.entries())
            .sort((a, b) => b[0] - a[0]) // PDF coordinates: higher Y = lower on page
            .map(([_, items]) => {
                // Sort items in line by X position (left to right)
                items.sort((a, b) => a.x - b.x);
                return items;
            });

        return {
            lines: sortedLines,
            fullText: fullTextParts.join(' ')
        };
    }

    /**
     * Convert structured text to blocks with formatting detection
     */
    function convertTextToBlocks(textResult) {
        const blocks = [];
        const { lines } = textResult;

        let currentParagraph = '';
        let prevLineY = null;
        let prevFontSize = null;

        lines.forEach((line, index) => {
            const lineText = line.map(item => item.text).join('').trim();
            if (!lineText) return;

            // Calculate line properties
            const avgFontSize = line.reduce((sum, item) => sum + (item.fontSize || 12), 0) / line.length;
            const avgY = line[0].y;

            // Detect formatting based on font size and position
            const isHeading = detectHeading(lineText, avgFontSize, lines);
            const isListItem = detectListItem(lineText);
            const isQuote = detectQuote(lineText);

            // Check for paragraph break (large vertical gap)
            const isNewParagraph = prevLineY !== null && (prevLineY - avgY) > 20;

            // Flush current paragraph if needed
            if (isNewParagraph && currentParagraph) {
                blocks.push(createTextBlock(currentParagraph));
                currentParagraph = '';
            }

            // Process the line based on its type
            if (isHeading) {
                if (currentParagraph) {
                    blocks.push(createTextBlock(currentParagraph));
                    currentParagraph = '';
                }
                const headingLevel = detectHeadingLevel(avgFontSize, lines);
                blocks.push(createHeadingBlock(lineText, headingLevel));
            } else if (isListItem) {
                if (currentParagraph) {
                    blocks.push(createTextBlock(currentParagraph));
                    currentParagraph = '';
                }
                const listType = detectListType(lineText);
                const cleanText = cleanListMarker(lineText);
                blocks.push(createListBlock(cleanText, listType));
            } else if (isQuote) {
                if (currentParagraph) {
                    blocks.push(createTextBlock(currentParagraph));
                    currentParagraph = '';
                }
                blocks.push(createQuoteBlock(lineText.replace(/^["'"']+/, '')));
            } else {
                // Regular text - add to paragraph
                currentParagraph += (currentParagraph ? ' ' : '') + lineText;
            }

            prevLineY = avgY;
            prevFontSize = avgFontSize;
        });

        // Don't forget the last paragraph
        if (currentParagraph) {
            blocks.push(createTextBlock(currentParagraph));
        }

        return blocks;
    }

    /**
     * Detect if text is a heading based on font size and formatting
     */
    function detectHeading(text, fontSize, allLines) {
        // Calculate average font size
        let totalSize = 0;
        let count = 0;
        allLines.forEach(line => {
            line.forEach(item => {
                totalSize += item.fontSize || 12;
                count++;
            });
        });
        const avgSize = count > 0 ? totalSize / count : 12;

        // Heading if significantly larger than average
        const isLarger = fontSize > avgSize * 1.2;
        
        // Or if it's short and looks like a title
        const isShortTitle = text.length < 100 && !text.endsWith('.');

        // Or if it's all caps (common for headings)
        const isAllCaps = text === text.toUpperCase() && text.length > 3 && text.length < 100;

        return isLarger || (isShortTitle && fontSize >= avgSize);
    }

    /**
     * Detect heading level (1, 2, or 3)
     */
    function detectHeadingLevel(fontSize, allLines) {
        // Calculate max font size
        let maxSize = 0;
        allLines.forEach(line => {
            line.forEach(item => {
                maxSize = Math.max(maxSize, item.fontSize || 12);
            });
        });

        if (fontSize > maxSize * 0.9) return 1;
        if (fontSize > maxSize * 0.8) return 2;
        return 3;
    }

    /**
     * Detect if text is a list item
     */
    function detectListItem(text) {
        const listPatterns = [
            /^\s*[•\-\*\+➢➣➤→⇒›>◦○●■□▪▫]\s+/,
            /^\s*\d+[\.\)]\s+/,
            /^\s*\([\d\w]\)\s+/,
            /^\s*[\d\w][\.\)]\s+/
        ];
        return listPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Detect list type (bulleted or numbered)
     */
    function detectListType(text) {
        if (/^\s*\d+[\.\)]\s+/.test(text)) return 'numbered_list';
        return 'bulleted_list';
    }

    /**
     * Clean list markers from text
     */
    function cleanListMarker(text) {
        return text.replace(/^\s*[•\-\*\+➢➣➤→⇒›>◦○●■□▪▫\d\w\.\)\(\]]+\s*/, '');
    }

    /**
     * Detect if text is a quote
     */
    function detectQuote(text) {
        return /^\s*["'"']/.test(text) || /^\s*>/.test(text);
    }

    /**
     * Render a PDF page to an image block
     */
    async function renderPageToImageBlock(page, viewport, settings, caption) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        // Calculate dimensions with scale
        const scale = settings.renderScale;
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        // Fill white background
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Render PDF page to canvas
        await page.render({
            canvasContext: context,
            viewport: scaledViewport
        }).promise;

        // Convert to data URL with size limits
        let dataUrl = canvas.toDataURL('image/jpeg', settings.imageQuality);
        
        // Check dimensions and resize if needed
        let width = canvas.width;
        let height = canvas.height;
        
        if (width > settings.maxImageDimension || height > settings.maxImageDimension) {
            const ratio = Math.min(
                settings.maxImageDimension / width,
                settings.maxImageDimension / height
            );
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
            
            // Resize
            const resizeCanvas = document.createElement('canvas');
            resizeCanvas.width = width;
            resizeCanvas.height = height;
            const resizeCtx = resizeCanvas.getContext('2d');
            resizeCtx.drawImage(canvas, 0, 0, width, height);
            dataUrl = resizeCanvas.toDataURL('image/jpeg', settings.imageQuality);
        }

        return createImageBlock(dataUrl, caption);
    }

    /**
     * Extract embedded images from a PDF page
     * Note: This is a simplified implementation
     */
    async function extractImagesFromPage(page, viewport, settings) {
        // PDF.js doesn't provide a direct API for extracting embedded images
        // This would require parsing the PDF structure at a lower level
        // For now, we return empty array but provide the hook for future enhancement
        
        // Future implementation could:
        // 1. Use pdf.js getOperatorList to find image operators
        // 2. Extract raw image data from the PDF
        // 3. Convert to appropriate format
        
        return [];
    }

    /**
     * Parse font size from font name
     */
    function parseFontSize(fontName) {
        // Try to extract size from font name (e.g., "Arial-Bold-12")
        const match = fontName.match(/(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
        return 12;
    }

    /**
     * Get page numbers from range string (e.g., "1-5,7,10-12")
     */
    function getPagesInRange(rangeStr, totalPages) {
        const pages = new Set();
        const parts = rangeStr.split(',');

        parts.forEach(part => {
            part = part.trim();
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
                for (let i = start; i <= Math.min(end, totalPages); i++) {
                    pages.add(i);
                }
            } else {
                const page = parseInt(part, 10);
                if (page > 0 && page <= totalPages) {
                    pages.add(page);
                }
            }
        });

        return Array.from(pages).sort((a, b) => a - b);
    }

    /**
     * Extract title from first heading or text block
     */
    function extractTitleFromBlocks(blocks) {
        // Look for first heading
        const heading = blocks.find(b => b.type === 'heading_1');
        if (heading) return heading.content;

        // Or use first text block (truncated)
        const text = blocks.find(b => b.type === 'text');
        if (text) {
            const title = text.content.substring(0, 100);
            return title.length < text.content.length ? title + '...' : title;
        }

        return null;
    }

    // Block creation helpers
    function generateId() {
        return 'block_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function createTextBlock(text) {
        return { type: 'text', content: text, id: generateId() };
    }

    function createHeadingBlock(text, level) {
        return { type: `heading_${level}`, content: text, id: generateId() };
    }

    function createListBlock(text, listType) {
        return { type: listType, content: text, id: generateId() };
    }

    function createQuoteBlock(text) {
        return { type: 'quote', content: text, id: generateId() };
    }

    function createImageBlock(url, caption) {
        return {
            type: 'image',
            content: { url, caption: caption || '', align: 'center' },
            id: generateId()
        };
    }

    function createCalloutBlock(text, icon) {
        return {
            type: 'callout',
            content: text,
            icon: icon || '💡',
            id: generateId()
        };
    }

    /**
     * Preview PDF before import - returns page thumbnails and metadata
     */
    async function previewPDF(arrayBuffer, maxPages = 5) {
        if (!pdfjsLib) {
            await loadPDFJS();
        }

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;
        const pagesToPreview = Math.min(maxPages, totalPages);

        const previews = [];

        for (let i = 1; i <= pagesToPreview; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 0.5 }); // Small thumbnail

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            context.fillStyle = 'white';
            context.fillRect(0, 0, canvas.width, canvas.height);

            await page.render({ canvasContext: context, viewport }).promise;

            // Get text content to determine if page has text
            const textContent = await page.getTextContent();
            const hasText = textContent.items.some(item => item.str.trim().length > 0);

            previews.push({
                pageNum: i,
                thumbnail: canvas.toDataURL('image/jpeg', 0.7),
                hasText,
                dimensions: { width: page.view[2], height: page.view[3] }
            });

            page.cleanup();
        }

        return {
            totalPages,
            previews,
            hasMore: totalPages > maxPages
        };
    }

    /**
     * Check if PDF is likely scanned/image-based
     */
    async function detectScannedPDF(arrayBuffer) {
        if (!pdfjsLib) {
            await loadPDFJS();
        }

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const pagesToCheck = Math.min(3, pdf.numPages);
        let textCount = 0;
        let scannedCount = 0;

        for (let i = 1; i <= pagesToCheck; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join('').trim();
            
            if (pageText.length < CONFIG.minTextLength) {
                scannedCount++;
            }
            textCount += pageText.length;

            page.cleanup();
        }

        return {
            isScanned: scannedCount >= pagesToCheck / 2,
            hasText: textCount > 0,
            confidence: scannedCount / pagesToCheck
        };
    }

    // Public API
    return {
        initialize,
        loadPDFJS,
        importPDF,
        previewPDF,
        detectScannedPDF,
        CONFIG
    };
})();

// Expose to window
window.PDFImport = PDFImport;
