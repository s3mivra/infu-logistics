# Semivra POS — Operations Makefile
# Run `make` or `make help` to list available commands.

.DEFAULT_GOAL := help
.PHONY: help setup install dev test build deploy stop logs restart status health backup restore prune clean

help:           ## Show this help message
	@echo ""
	@echo "  Semivra POS — Operations"
	@echo "  ========================"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
	@echo ""

# ---------- DEV ----------
setup:          ## Generate .env with strong secrets (interactive)
	@bash scripts/setup-env.sh

install:        ## Install dependencies for server + client
	@cd server && npm install
	@cd client && npm install

dev:            ## Run server + client in dev mode (two terminals recommended)
	@echo "Run these in two terminals:"
	@echo "  Terminal 1: cd server && npm run dev"
	@echo "  Terminal 2: cd client && npm run dev"

test:           ## Run server unit tests
	@cd server && npm test

build:          ## Build the client for production
	@cd client && npm run build

# ---------- DEPLOY ----------
deploy:         ## Build + start production stack (docker compose)
	@docker compose up -d --build
	@$(MAKE) status

stop:           ## Stop the running stack
	@docker compose down

restart:        ## Restart the stack
	@docker compose restart
	@$(MAKE) status

status:         ## Show container status
	@docker compose ps

logs:           ## Tail logs from all services (Ctrl+C to exit)
	@docker compose logs -f --tail=100

logs-api:       ## Tail API logs only
	@docker compose logs -f --tail=100 api

health:         ## Check API health endpoint
	@curl -s http://localhost:5002/health | (command -v jq >/dev/null && jq . || cat)

# ---------- BACKUP ----------
backup:         ## Run a one-off MongoDB backup
	@bash scripts/backup-mongo.sh

restore:        ## Restore from a backup archive (interactive)
	@bash scripts/restore-mongo.sh

# ---------- HOUSEKEEPING ----------
prune:          ## Delete backups older than 30 days
	@find backups -maxdepth 1 -name '*.tar.gz' -mtime +30 -delete -print

clean:          ## Remove client dist + server node_modules + backups (DESTRUCTIVE)
	@read -r -p "Delete dist/, node_modules/, backups/? Type 'yes': " ok && [ "$$ok" = "yes" ] && rm -rf client/dist client/node_modules server/node_modules backups && echo "Cleaned." || echo "Aborted."
