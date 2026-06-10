.PHONY: collect collect-coda migrate dev build test test-collector test-ui install

SESSIONS_ROOT ?= $(HOME)/.claude/projects/
MACHINE       ?= cadence

collect:        ## Collect Code sessions → upsert to Supabase (run on Cadence)
	python3 scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)"

collect-dry:    ## Dry run — show what would be upserted
	python3 scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine "$(MACHINE)" \
		--dry-run

collect-coda:   ## Collect Code sessions on Coda (run on iMac with MACHINE=coda)
	python3 scripts/collect.py \
		--sessions-root "$(SESSIONS_ROOT)" \
		--machine coda

migrate:        ## One-time: migrate legacy daily-burn.json → Supabase
	python3 scripts/migrate_legacy.py

dev:            ## Start Vite dev server (use vercel dev for API routes)
	npm run dev

build:          ## Build frontend
	npm run build

install:        ## Install dependencies
	npm install
	pip3 install supabase python-dotenv pytest

test-collector: ## Run Python collector unit tests
	python3 -m pytest tests/collector/ -v

test-ui:        ## Run Playwright UI tests
	npx playwright test --config tests/ui/playwright.config.ts

test: test-collector test-ui  ## Run all tests
