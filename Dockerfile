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

# Security: run as non-root
RUN groupadd --gid 1001 kimibuilt && \
  useradd --uid 1001 --gid 1001 --create-home --shell /usr/sbin/nologin kimibuilt

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER kimibuilt

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
