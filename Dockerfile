# ================================
# Stage 1: Install dependencies
# ================================
FROM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# ================================
# Stage 2: BuildKit client
# ================================
FROM moby/buildkit:v0.17.2 AS buildkit

# ================================
# Stage 3: Production image
# ================================
FROM node:20-bookworm-slim

WORKDIR /app

ARG PIPER_TTS_VERSION=1.4.2
ARG PIPER_VOICES_REF=v1.0.0
ARG PIPER_VOICES_BASE_URL=https://huggingface.co/rhasspy/piper-voices/resolve

RUN apt-get update && \
  apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates openssh-client docker.io git curl bash python3 python3-pip && \
  python3 -m pip install --break-system-packages --no-cache-dir "piper-tts==${PIPER_TTS_VERSION}" && \
  command -v piper >/dev/null && \
  rm -rf /var/lib/apt/lists/*

COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl

# Security: run as non-root
RUN groupadd --gid 1001 kimibuilt && \
  useradd --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin kimibuilt

COPY --from=deps /app/node_modules ./node_modules
COPY bin/ ./bin/
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY data/piper/voices/manifest.json ./data/piper/voices/manifest.json
COPY package.json ./
COPY package-lock.json* ./
COPY .npmrc ./

RUN mkdir -p /app/data/piper/voices && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/amy/medium/en_US-amy-medium.onnx" \
    --output /app/data/piper/voices/en_US-amy-medium.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/amy/medium/en_US-amy-medium.onnx.json" \
    --output /app/data/piper/voices/en_US-amy-medium.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx" \
    --output /app/data/piper/voices/en_US-hfc_female-medium.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json" \
    --output /app/data/piper/voices/en_US-hfc_female-medium.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/kathleen/low/en_US-kathleen-low.onnx" \
    --output /app/data/piper/voices/en_US-kathleen-low.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/kathleen/low/en_US-kathleen-low.onnx.json" \
    --output /app/data/piper/voices/en_US-kathleen-low.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/lessac/high/en_US-lessac-high.onnx" \
    --output /app/data/piper/voices/en_US-lessac-high.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/lessac/high/en_US-lessac-high.onnx.json" \
    --output /app/data/piper/voices/en_US-lessac-high.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx" \
    --output /app/data/piper/voices/en_US-ljspeech-high.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx.json" \
    --output /app/data/piper/voices/en_US-ljspeech-high.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/ryan/high/en_US-ryan-high.onnx" \
    --output /app/data/piper/voices/en_US-ryan-high.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_US/ryan/high/en_US-ryan-high.onnx.json" \
    --output /app/data/piper/voices/en_US-ryan-high.onnx.json && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_GB/cori/high/en_GB-cori-high.onnx" \
    --output /app/data/piper/voices/en_GB-cori-high.onnx && \
  curl --fail --show-error --silent --location --retry 3 \
    "${PIPER_VOICES_BASE_URL}/${PIPER_VOICES_REF}/en/en_GB/cori/high/en_GB-cori-high.onnx.json" \
    --output /app/data/piper/voices/en_GB-cori-high.onnx.json

RUN mkdir -p /home/kimibuilt/.kimibuilt && \
  chown -R kimibuilt:kimibuilt /home/kimibuilt /app

ENV NODE_ENV=production
ENV PORT=3000
ENV ARTIFACT_BROWSER_PATH=/usr/bin/chromium
ENV KIMIBUILT_DATA_DIR=/home/kimibuilt/.kimibuilt
ENV KIMIBUILT_STATE_DIR=/home/kimibuilt/.kimibuilt
ENV PIPER_TTS_BINARY_PATH=/usr/local/bin/piper
ENV PIPER_TTS_VOICES_PATH=/app/data/piper/voices/manifest.json
ENV OPENCODE_ENABLED=false

USER kimibuilt

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
