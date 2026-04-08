FROM node:20-slim

RUN apt-get update && \
    apt-get install -y git curl gosu && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install all dependencies (including devDependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Remove devDependencies after build
RUN npm prune --production

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create non-root user (required for bypassPermissions mode)
RUN useradd -m -s /bin/bash claude && \
    mkdir -p /home/claude/.bridge && \
    chown -R claude:claude /home/claude /app

ENV NODE_ENV=production
ENV BRIDGE_HOME=/home/claude/.bridge
ENV HOME=/home/claude

CMD ["./entrypoint.sh"]
