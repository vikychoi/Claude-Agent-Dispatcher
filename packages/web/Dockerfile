FROM node:20-slim AS build

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/

RUN pnpm --filter @taskshed/shared build
RUN pnpm --filter @taskshed/web build

FROM nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
