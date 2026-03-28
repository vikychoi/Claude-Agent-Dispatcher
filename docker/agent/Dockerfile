FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN groupadd -g 1001 claude && useradd -m -u 1001 -g claude claude

RUN mkdir -p /workspace/input /workspace/output && \
    chown -R claude:claude /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER claude
WORKDIR /workspace

ENTRYPOINT ["/entrypoint.sh"]
