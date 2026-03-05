# ================================
# Stage 1: Install dependencies
# ================================
FROM --platform=$TARGETPLATFORM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ================================
# Stage 2: Production image
# ================================
FROM --platform=$TARGETPLATFORM node:20-alpine

WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S kimibuilt && \
  adduser -S kimibuilt -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY frontend/ ./frontend/
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER kimibuilt

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
