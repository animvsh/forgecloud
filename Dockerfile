FROM node:20-bookworm-slim

# Install build tools for better-sqlite3 native compile + bun
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    pkg-config \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Install deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build
COPY . .
RUN bun run build

ENV INSFORGE_DB_PATH=/data/forgecloud.sqlite

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server-entry.mjs"]
