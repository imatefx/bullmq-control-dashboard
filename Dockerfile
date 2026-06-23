# ---- Build stage: install all deps and build web + server ----
FROM node:22-alpine AS builder
WORKDIR /app

# Install workspace dependencies (root + server + web)
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Build the UI and compile the server
COPY . .
RUN npm run build

# ---- Runtime stage: production deps + built artifacts only ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev && npm cache clean --force

# Built output
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/web/dist ./web/dist

# Config lives on a mounted volume so it persists across container restarts.
# Seed an empty config the first time (the app also creates one if missing).
COPY config/config.example.json ./config/config.json
VOLUME ["/app/config"]

ENV PORT=3010 \
    CONFIG_PATH=/app/config/config.json \
    WEB_DIST=/app/web/dist

WORKDIR /app/server
EXPOSE 3010
CMD ["node", "dist/index.js"]
