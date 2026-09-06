FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORTAL_AUTH_FILE=/data/portal-auth.json \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npx playwright install --with-deps chromium \
    && npm cache clean --force

COPY . ./
RUN mkdir -p /data

# Unraid appdata is normally owned by nobody:users. Keep the runtime user as
# root so the container can write its persistent bind mount without weakening
# the host; the container has no privileged mode, host network, or devices.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/betas').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
