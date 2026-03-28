# Claude-Agent-Dispatcher

Dispatch tasks to Claude Code agents running in isolated Docker containers. Submit jobs, watch output in real time, send follow-up prompts, and download results.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ and pnpm (for local development)

## Setup

```bash
cp .env.example .env
```

Fill in the required values:

| Variable | How to get it |
|---|---|
| `SECRET_KEY` | `openssl rand -hex 32` |
| `HOST_JOB_DATA_DIR` | Absolute path to `./data/jobs` on your host |
| `DOCKER_GID` | `getent group docker \| cut -d: -f3` |

Build the agent image, then start everything:

```bash
make agent
make dev
```

Open `http://localhost:5173`, go to **Settings**, and enter your credentials.

## Authentication

**API Key (simpler):** Go to [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key. Select "API Key" mode in Settings.

**OAuth Credentials (recommended for subscriptions):** Run `claude auth login` in your terminal, then paste the full contents of the credentials file:

```bash
cat ~/.claude/.credentials.json
```

Paste the entire JSON into the Settings page. Tokens refresh automatically inside agent containers.

## Architecture

```
Browser (React)
  ↕ REST + WebSocket
API Server (Express + Socket.io + PostgreSQL)
  ↕ BullMQ + Redis
Worker (dockerode)
  ↕ Docker API
Ephemeral agent containers (Claude Code)
```

## Project structure

```
packages/shared/    Types, constants, encryption
packages/api/       REST API + WebSocket server
packages/worker/    Job queue consumer + container orchestrator
packages/web/       React frontend
docker/agent/       Agent container image
```

## Important

- `SECRET_KEY` is used to encrypt stored credentials. Changing or losing it makes all saved auth tokens and MCP server env vars unreadable.
- Agent containers always run with `--dangerously-skip-permissions` and `IS_SANDBOX=1`. This is hardcoded and not configurable.
