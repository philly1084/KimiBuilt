# ================================
# Stage 1: Install dependencies
# ================================
FROM --platform=$TARGETPLATFORM node:20-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ================================
# Stage 2: Production image
# ================================
FROM --platform=$TARGETPLATFORM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && \
  apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates openssh-client docker.io git curl bash && \
  rm -rf /var/lib/apt/lists/*

# Security: run as non-root
RUN groupadd --gid 1001 kimibuilt && \
  useradd --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin kimibuilt

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY package.json ./
COPY package-lock.json* ./

RUN mkdir -p /home/kimibuilt/.opencode && \
  chown -R kimibuilt:kimibuilt /home/kimibuilt /app

ENV NODE_ENV=production
ENV PORT=3000
ENV ARTIFACT_BROWSER_PATH=/usr/bin/chromium
ENV PATH=/home/kimibuilt/.opencode/bin:$PATH

USER kimibuilt

RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
