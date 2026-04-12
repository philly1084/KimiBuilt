function readString(buffer, start, length) {
  return buffer.toString('ascii', start, start + length);
}

function parseWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error('Invalid WAV buffer.');
  }

  if (readString(buffer, 0, 4) !== 'RIFF' || readString(buffer, 8, 4) !== 'WAVE') {
    throw new Error('Unsupported WAV container.');
  }

  let offset = 12;
  let format = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = readString(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkSize > buffer.length) {
      throw new Error('Corrupt WAV chunk size.');
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error('Unsupported WAV fmt chunk.');
      }

      format = {
        audioFormat: buffer.readUInt16LE(chunkDataOffset),
        numChannels: buffer.readUInt16LE(chunkDataOffset + 2),
        sampleRate: buffer.readUInt32LE(chunkDataOffset + 4),
        byteRate: buffer.readUInt32LE(chunkDataOffset + 8),
        blockAlign: buffer.readUInt16LE(chunkDataOffset + 12),
        bitsPerSample: buffer.readUInt16LE(chunkDataOffset + 14),
      };
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataSize = chunkSize;
    }

    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }

  if (!format || dataOffset < 0) {
    throw new Error('WAV buffer is missing required fmt or data chunks.');
  }

  if (format.audioFormat !== 1) {
    throw new Error('Only PCM WAV audio is supported for stitching.');
  }

  const data = buffer.slice(dataOffset, dataOffset + dataSize);
  return {
    ...format,
    data,
  };
}

function writeWavBuffer({ sampleRate, bitsPerSample, numChannels, data }) {
  const pcmData = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  const header = Buffer.alloc(44);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function createSilenceWavBuffer(format, durationMs = 250) {
  const sampleRate = Number(format?.sampleRate || 0);
  const bitsPerSample = Number(format?.bitsPerSample || 0);
  const numChannels = Number(format?.numChannels || 0);
  if (!sampleRate || !bitsPerSample || !numChannels) {
    throw new Error('Cannot create silence without a valid WAV format.');
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.max(0, Math.round((sampleRate * Math.max(0, durationMs)) / 1000));
  const pcmData = Buffer.alloc(frameCount * numChannels * bytesPerSample, 0);
  return writeWavBuffer({
    sampleRate,
    bitsPerSample,
    numChannels,
    data: pcmData,
  });
}

function concatWavBuffers(buffers = []) {
  const parsedBuffers = (Array.isArray(buffers) ? buffers : [])
    .filter((buffer) => Buffer.isBuffer(buffer) && buffer.length > 0)
    .map((buffer) => parseWavBuffer(buffer));

  if (parsedBuffers.length === 0) {
    throw new Error('At least one WAV buffer is required to concatenate audio.');
  }

  const base = parsedBuffers[0];
  parsedBuffers.slice(1).forEach((entry) => {
    if (entry.audioFormat !== base.audioFormat
      || entry.numChannels !== base.numChannels
      || entry.sampleRate !== base.sampleRate
      || entry.bitsPerSample !== base.bitsPerSample) {
      throw new Error('All WAV buffers must share the same PCM format.');
    }
  });

  return writeWavBuffer({
    sampleRate: base.sampleRate,
    bitsPerSample: base.bitsPerSample,
    numChannels: base.numChannels,
    data: Buffer.concat(parsedBuffers.map((entry) => entry.data)),
  });
}

module.exports = {
  concatWavBuffers,
  createSilenceWavBuffer,
  parseWavBuffer,
  writeWavBuffer,
};
