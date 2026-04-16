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

function wavFormatsMatch(left = {}, right = {}) {
  return Number(left?.audioFormat || 0) === Number(right?.audioFormat || 0)
    && Number(left?.numChannels || 0) === Number(right?.numChannels || 0)
    && Number(left?.sampleRate || 0) === Number(right?.sampleRate || 0)
    && Number(left?.bitsPerSample || 0) === Number(right?.bitsPerSample || 0);
}

function readInt16Sample(data, frameIndex, channelIndex, channelCount) {
  const offset = ((frameIndex * channelCount) + channelIndex) * 2;
  return data.readInt16LE(offset);
}

function resolveInt16SampleForChannel(data, frameIndex, sourceChannels, targetChannels, targetChannelIndex) {
  if (sourceChannels === targetChannels) {
    return readInt16Sample(data, frameIndex, targetChannelIndex, sourceChannels);
  }

  if (sourceChannels === 1 && targetChannels === 2) {
    return readInt16Sample(data, frameIndex, 0, sourceChannels);
  }

  if (sourceChannels === 2 && targetChannels === 1) {
    const left = readInt16Sample(data, frameIndex, 0, sourceChannels);
    const right = readInt16Sample(data, frameIndex, 1, sourceChannels);
    return Math.round((left + right) / 2);
  }

  throw new Error('Only mono and stereo PCM WAV normalization is supported.');
}

function normalizeWavBufferFormat(buffer, targetFormat = {}) {
  const source = parseWavBuffer(buffer);
  const target = {
    audioFormat: Number(targetFormat?.audioFormat || source.audioFormat || 0),
    sampleRate: Number(targetFormat?.sampleRate || 0),
    bitsPerSample: Number(targetFormat?.bitsPerSample || 0),
    numChannels: Number(targetFormat?.numChannels || 0),
  };

  if (wavFormatsMatch(source, target)) {
    return buffer;
  }

  if (source.audioFormat !== 1 || target.audioFormat !== 1) {
    throw new Error('Only PCM WAV normalization is supported.');
  }

  if (source.bitsPerSample !== 16 || target.bitsPerSample !== 16) {
    throw new Error('Only 16-bit PCM WAV normalization is supported.');
  }

  if (![1, 2].includes(source.numChannels) || ![1, 2].includes(target.numChannels)) {
    throw new Error('Only mono and stereo PCM WAV normalization is supported.');
  }

  if (!target.sampleRate || !target.numChannels || !target.bitsPerSample) {
    throw new Error('A complete target PCM format is required for WAV normalization.');
  }

  const sourceFrameCount = Math.floor(source.data.length / (2 * source.numChannels));
  if (sourceFrameCount <= 0) {
    return writeWavBuffer({
      sampleRate: target.sampleRate,
      bitsPerSample: target.bitsPerSample,
      numChannels: target.numChannels,
      data: Buffer.alloc(0),
    });
  }

  const targetFrameCount = Math.max(1, Math.round(sourceFrameCount * (target.sampleRate / source.sampleRate)));
  const output = Buffer.alloc(targetFrameCount * target.numChannels * 2);

  for (let targetFrameIndex = 0; targetFrameIndex < targetFrameCount; targetFrameIndex += 1) {
    const sourcePosition = targetFrameIndex * (source.sampleRate / target.sampleRate);
    const leftFrameIndex = Math.max(0, Math.min(sourceFrameCount - 1, Math.floor(sourcePosition)));
    const rightFrameIndex = Math.max(0, Math.min(sourceFrameCount - 1, Math.ceil(sourcePosition)));
    const interpolation = Math.max(0, Math.min(1, sourcePosition - leftFrameIndex));

    for (let targetChannelIndex = 0; targetChannelIndex < target.numChannels; targetChannelIndex += 1) {
      const leftSample = resolveInt16SampleForChannel(
        source.data,
        leftFrameIndex,
        source.numChannels,
        target.numChannels,
        targetChannelIndex,
      );
      const rightSample = resolveInt16SampleForChannel(
        source.data,
        rightFrameIndex,
        source.numChannels,
        target.numChannels,
        targetChannelIndex,
      );
      const interpolated = Math.round(leftSample + ((rightSample - leftSample) * interpolation));
      output.writeInt16LE(interpolated, ((targetFrameIndex * target.numChannels) + targetChannelIndex) * 2);
    }
  }

  return writeWavBuffer({
    sampleRate: target.sampleRate,
    bitsPerSample: target.bitsPerSample,
    numChannels: target.numChannels,
    data: output,
  });
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
  normalizeWavBufferFormat,
  parseWavBuffer,
  wavFormatsMatch,
  writeWavBuffer,
};
