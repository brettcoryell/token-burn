.PHONY: collect collect-dry collect-codex collect-codex-dry migrate dev build test test-collector test-ui install

SESSIONS_ROOT ?= $(HOME)/.claude/projects/
MACHINE       ?= $(shell hostname | tr '[:upper:]' '[:lower:]' | awk '/mini/ {print "mini"; found=1} /macbook|book/ {print "macbook"; found=1} /imac/ {print "imac"; found=1} END {if (!found) print "unknown"}')
AGENT_FAMILY  ?= claude
SURFACE       ?= claude-code
CODEX_STATE_DB ?= $(HOME)/.codex/state_5.sqlite
CODEX_MIN_DATE ?= $(shell date +%Y-%m-%d)

collect:        ## Collect agent sessions → upsert to Supabase
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)"

collect-dry:    ## Dry run — show what would be upserted
	.venv/bin/python scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--agent-family "$(AGENT_FAMILY)" \
		--surface "$(SURFACE)" \
		--dry-run

collect-codex:  ## Collect Codex sessions → upsert to Supabase
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)"

collect-codex-dry:  ## Dry run Codex collection
		.venv/bin/python scripts/collect.py \
			--source codex \
			--codex-state-db "$(CODEX_STATE_DB)" \
			--machine "$(MACHINE)" \
			--codex-min-date "$(CODEX_MIN_DATE)" \
			--dry-run \
			--verbose

migrate:        ## One-time: migrate legacy daily-burn.json → Supabase
	.venv/bin/python scripts/migrate_legacy.py

dev:            ## Start Vite dev server (use vercel dev for API routes)
	npm run dev

build:          ## Build frontend
	npm run build

install:        ## Install dependencies
	npm install
	python3.12 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -e ".[dev]" 2>/dev/null || .venv/bin/pip install supabase python-dotenv pytest

test-collector: ## Run Python collector unit tests
	.venv/bin/python -m pytest tests/collector/ -v

test-ui:        ## Run Playwright UI tests
	npx playwright test --config tests/ui/playwright.config.ts

test: test-collector test-ui  ## Run all tests
