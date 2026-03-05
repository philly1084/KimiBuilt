/**
 * Export Manager - Clipboard and Download functionality
 */

class ExportManager {
    constructor() {
        this.fileExtensions = {
            code: {
                javascript: '.js',
                typescript: '.ts',
                python: '.py',
                java: '.java',
                html: '.html',
                css: '.css',
                json: '.json',
                xml: '.xml',
                sql: '.sql',
                yaml: '.yaml',
                markdown: '.md',
                rust: '.rs',
                go: '.go',
                php: '.php',
                ruby: '.rb',
                c: '.c',
                cpp: '.cpp',
                csharp: '.cs',
                swift: '.swift',
                kotlin: '.kt',
                shell: '.sh',
                bash: '.sh',
                default: '.txt'
            },
            document: '.md',
            diagram: '.mmd'
        };

        this.mimeTypes = {
            '.js': 'application/javascript',
            '.ts': 'application/typescript',
            '.py': 'text/x-python',
            '.java': 'text/x-java-source',
            '.html': 'text/html',
            '.css': 'text/css',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.sql': 'application/sql',
            '.yaml': 'application/x-yaml',
            '.md': 'text/markdown',
            '.mmd': 'text/vnd.mermaid',
            '.rs': 'text/rust',
            '.go': 'text/x-go',
            '.php': 'application/x-php',
            '.rb': 'text/x-ruby',
            '.c': 'text/x-c',
            '.cpp': 'text/x-c++',
            '.cs': 'text/x-csharp',
            '.swift': 'text/x-swift',
            '.kt': 'text/x-kotlin',
            '.sh': 'application/x-sh',
            '.txt': 'text/plain'
        };
    }

    /**
     * Copy content to clipboard
     * @param {string} content 
     * @returns {Promise<boolean>}
     */
    async copyToClipboard(content) {
        try {
            await navigator.clipboard.writeText(content);
            return true;
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            // Fallback for older browsers
            return this._fallbackCopy(content);
        }
    }

    /**
     * Fallback copy method using textarea
     * @param {string} content 
     * @returns {boolean}
     */
    _fallbackCopy(content) {
        const textarea = document.createElement('textarea');
        textarea.value = content;
        textarea.style.position = 'fixed';
        textarea.style.left = '-999999px';
        textarea.style.top = '-999999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textarea);
            return successful;
        } catch (error) {
            document.body.removeChild(textarea);
            console.error('Fallback copy failed:', error);
            return false;
        }
    }

    /**
     * Download content as a file
     * @param {string} content 
     * @param {string} canvasType 
     * @param {string} language 
     * @param {string} suggestedName 
     * @returns {boolean}
     */
    downloadFile(content, canvasType, language = '', suggestedName = '') {
        const extension = this._getExtension(canvasType, language);
        const filename = suggestedName || this._generateFilename(canvasType, extension);
        const mimeType = this.mimeTypes[extension] || 'text/plain';

        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
        return true;
    }

    /**
     * Get file extension based on canvas type and language
     * @param {string} canvasType 
     * @param {string} language 
     * @returns {string}
     */
    _getExtension(canvasType, language) {
        if (canvasType === 'code') {
            const lang = (language || 'default').toLowerCase();
            return this.fileExtensions.code[lang] || this.fileExtensions.code.default;
        }
        return this.fileExtensions[canvasType] || '.txt';
    }

    /**
     * Generate a filename with timestamp
     * @param {string} canvasType 
     * @param {string} extension 
     * @returns {string}
     */
    _generateFilename(canvasType, extension) {
        const now = new Date();
        const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
        return `kimibuilt-${canvasType}-${timestamp}${extension}`;
    }

    /**
     * Export as PDF (for documents)
     * @param {HTMLElement} element 
     * @param {string} filename 
     */
    exportAsPDF(element, filename = 'document.pdf') {
        // Open print dialog for PDF export
        const originalTitle = document.title;
        document.title = filename.replace('.pdf', '');
        
        // Store current body content
        const originalBody = document.body.innerHTML;
        const originalStyles = document.body.style.cssText;
        
        // Create print-only content
        const printContent = `
            <div class="print-header">
                <h1>Exported from KimiBuilt Canvas</h1>
                <p>Generated on ${new Date().toLocaleString()}</p>
            </div>
            <div class="print-content">${element.innerHTML}</div>
        `;
        
        // Add print styles
        const printStyles = document.createElement('style');
        printStyles.textContent = `
            @media print {
                body { 
                    padding: 20px; 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                .print-header {
                    border-bottom: 2px solid #333;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .print-header h1 {
                    margin: 0 0 10px 0;
                    font-size: 24px;
                }
                .print-header p {
                    margin: 0;
                    color: #666;
                }
                pre {
                    background: #f5f5f5;
                    padding: 15px;
                    border-radius: 5px;
                    overflow-x: auto;
                }
                code {
                    background: #f5f5f5;
                    padding: 2px 6px;
                    border-radius: 3px;
                }
                blockquote {
                    border-left: 4px solid #333;
                    padding-left: 20px;
                    margin-left: 0;
                    color: #555;
                }
            }
        `;
        
        // Apply print content and styles
        document.body.innerHTML = printContent;
        document.head.appendChild(printStyles);
        
        // Print
        window.print();
        
        // Restore original content
        document.body.innerHTML = originalBody;
        document.body.style.cssText = originalStyles;
        document.head.removeChild(printStyles);
        document.title = originalTitle;
    }

    /**
     * Export diagram as SVG
     * @param {string} svgContent 
     * @param {string} filename 
     */
    downloadSVG(svgContent, filename = 'diagram.svg') {
        const blob = new Blob([svgContent], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    /**
     * Export diagram as PNG
     * @param {HTMLElement} svgElement 
     * @param {string} filename 
     * @returns {Promise<boolean>}
     */
    async downloadPNG(svgElement, filename = 'diagram.png') {
        try {
            const svgData = new XMLSerializer().serializeToString(svgElement);
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();

            // Get SVG dimensions
            const svgRect = svgElement.getBoundingClientRect();
            canvas.width = svgRect.width * 2; // High DPI
            canvas.height = svgRect.height * 2;

            return new Promise((resolve, reject) => {
                img.onload = () => {
                    // Fill white background
                    ctx.fillStyle = 'white';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                    canvas.toBlob((blob) => {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        resolve(true);
                    }, 'image/png');
                };

                img.onerror = reject;
                img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
            });
        } catch (error) {
            console.error('Failed to export PNG:', error);
            return false;
        }
    }

    /**
     * Get available export options for canvas type
     * @param {string} canvasType 
     * @returns {Array}
     */
    getExportOptions(canvasType) {
        const baseOptions = [
            { id: 'clipboard', label: 'Copy to Clipboard', icon: '📋' },
            { id: 'download', label: 'Download File', icon: '💾' }
        ];

        if (canvasType === 'document') {
            baseOptions.push({ id: 'pdf', label: 'Export as PDF', icon: '📄' });
        } else if (canvasType === 'diagram') {
            baseOptions.push(
                { id: 'svg', label: 'Export as SVG', icon: '🎨' },
                { id: 'png', label: 'Export as PNG', icon: '🖼️' }
            );
        }

        return baseOptions;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportManager;
}
