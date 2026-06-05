FROM node:22-bookworm-slim

# Install build tools for better-sqlite3 native compile
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps with npm (better prebuilt binary support for native modules)
COPY package.json bun.lock* package-lock.json* ./
RUN npm install --include=dev --legacy-peer-deps

# Build
COPY . .
RUN npm run build

ENV INSFORGE_DB_PATH=/data/forgecloud.sqlite

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server-entry.mjs"]
