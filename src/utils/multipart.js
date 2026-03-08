function parseMultipartRequest(req, { maxBytes = 25 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const match = contentType.match(/boundary=(?:\"([^\"]+)\"|([^;]+))/i);

        if (!match) {
            reject(new Error('Missing multipart boundary'));
            return;
        }

        const boundary = Buffer.from(`--${match[1] || match[2]}`);
        const chunks = [];
        let totalBytes = 0;

        req.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                reject(new Error('Multipart body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('error', reject);
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const parts = [];
            let cursor = buffer.indexOf(boundary);

            while (cursor !== -1) {
                const nextBoundary = buffer.indexOf(boundary, cursor + boundary.length);
                if (nextBoundary === -1) break;

                const part = buffer.slice(cursor + boundary.length + 2, nextBoundary - 2);
                if (part.length > 0) {
                    parts.push(part);
                }
                cursor = nextBoundary;
            }

            const fields = {};
            let file = null;

            for (const part of parts) {
                const separatorIndex = part.indexOf(Buffer.from('\r\n\r\n'));
                if (separatorIndex === -1) continue;

                const headerText = part.slice(0, separatorIndex).toString('utf8');
                const body = part.slice(separatorIndex + 4);
                const headers = headerText.split('\r\n');
                const disposition = headers.find((header) => header.toLowerCase().startsWith('content-disposition'));

                if (!disposition) continue;

                const nameMatch = disposition.match(/name=\"([^\"]+)\"/i);
                const filenameMatch = disposition.match(/filename=\"([^\"]*)\"/i);
                const typeHeader = headers.find((header) => header.toLowerCase().startsWith('content-type'));
                const fieldName = nameMatch ? nameMatch[1] : null;

                if (!fieldName) continue;

                if (filenameMatch) {
                    file = {
                        fieldName,
                        filename: filenameMatch[1],
                        mimeType: typeHeader ? typeHeader.split(':')[1].trim() : 'application/octet-stream',
                        buffer: body,
                        size: body.length,
                    };
                } else {
                    const value = body.toString('utf8');
                    if (fieldName.endsWith('[]')) {
                        const normalizedName = fieldName.slice(0, -2);
                        if (!Array.isArray(fields[normalizedName])) {
                            fields[normalizedName] = [];
                        }
                        fields[normalizedName].push(value);
                    } else if (fields[fieldName] !== undefined) {
                        fields[fieldName] = Array.isArray(fields[fieldName])
                            ? [...fields[fieldName], value]
                            : [fields[fieldName], value];
                    } else {
                        fields[fieldName] = value;
                    }
                }
            }

            resolve({ fields, file });
        });
    });
}

module.exports = { parseMultipartRequest };
