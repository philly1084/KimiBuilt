const zlib = require('zlib');

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let crc = index;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
        table[index] = crc >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(entries = []) {
    let offset = 0;
    const localParts = [];
    const centralParts = [];

    for (const entry of entries) {
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
        const compressed = zlib.deflateRawSync(dataBuffer);
        const checksum = crc32(dataBuffer);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034B50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(dataBuffer.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);

        localParts.push(localHeader, nameBuffer, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014B50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(0, 12);
        centralHeader.writeUInt16LE(0, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(dataBuffer.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuffer);
        offset += localHeader.length + nameBuffer.length + compressed.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const localDirectory = Buffer.concat(localParts);

    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054B50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(entries.length, 8);
    endRecord.writeUInt16LE(entries.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(localDirectory.length, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([localDirectory, centralDirectory, endRecord]);
}

function readZipEntries(buffer) {
    const entries = new Map();
    const signature = 0x06054B50;
    let endOffset = -1;

    for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
        if (buffer.readUInt32LE(index) === signature) {
            endOffset = index;
            break;
        }
    }

    if (endOffset === -1) {
        throw new Error('Invalid ZIP archive');
    }

    const totalEntries = buffer.readUInt16LE(endOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(endOffset + 16);
    let offset = centralDirectoryOffset;

    for (let index = 0; index < totalEntries; index += 1) {
        if (buffer.readUInt32LE(offset) !== 0x02014B50) {
            throw new Error('Invalid ZIP central directory');
        }

        const compressionMethod = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString('utf8');

        const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressedData = buffer.slice(dataStart, dataStart + compressedSize);

        let data;
        if (compressionMethod === 0) {
            data = compressedData;
        } else if (compressionMethod === 8) {
            data = zlib.inflateRawSync(compressedData);
        } else {
            throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
        }

        entries.set(fileName, data);
        offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return entries;
}

module.exports = {
    createZip,
    readZipEntries,
};
