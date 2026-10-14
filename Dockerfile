# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime stage ----------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist

ENV SOURCED_HOST=0.0.0.0 \
    SOURCED_PORT=7700 \
    SOURCED_DATA_DIR=/data \
    SOURCED_WEB_DIR=/app/web/dist

VOLUME ["/data"]
EXPOSE 7700

RUN addgroup -S sourced && adduser -S sourced -G sourced && mkdir -p /data && chown sourced:sourced /data
USER sourced

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SOURCED_PORT||7700)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
