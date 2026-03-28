.PHONY: dev build agent migrate

dev:
	docker compose up --build -d

build:
	docker compose build

agent:
	docker build -t claude-agent:latest docker/agent/

migrate:
	docker compose exec api pnpm dev
