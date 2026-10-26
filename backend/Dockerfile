# Multi-stage build for the Split Bill API (Node.js / Express)
# Mirrors the structure required by Dockerfile.template in this repo:
#   - Stage 1 builds the application
#   - Stage 2 is a slim runtime
#   - Runs on port 4110
#   - Starts with no manual steps

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifest first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Run the test suite at build time so a broken image never ships
RUN npm test

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4110

# Only the production dependencies + compiled/app source are needed at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src

EXPOSE 4110

# Graceful startup, no manual steps required
CMD ["node", "src/server.js"]
