FROM node:20-slim

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/worker/ packages/worker/

RUN pnpm --filter @taskshed/shared build

WORKDIR /app/packages/worker

CMD ["pnpm", "dev"]
