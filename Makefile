.PHONY: help all engine orchestrator sdks sdk-ts sdk-py mcp test lint typecheck clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

all: engine orchestrator sdks mcp ## Build everything

engine: ## Build the Zig engine (forked lightpanda) — best-effort pre-M2
	@echo ">> Building engine (best-effort pre-M2)"
	cd engine && zig build -Doptimize=ReleaseSafe || echo "WARNING: engine build failed (expected pre-M2, zig may not be installed)"

orchestrator: ## Build the TS orchestrator
	@echo ">> Building orchestrator"
	pnpm --filter ./orchestrator run build

sdks: sdk-ts sdk-py ## Build both SDKs

sdk-ts: ## Build the TypeScript SDK
	@echo ">> Building TS SDK"
	pnpm --filter ./sdk-ts run build

sdk-py: ## Build the Python SDK (creates .venv if absent, uses uv when available)
	@echo ">> Building Python SDK"
	@if [ ! -d sdk-py/.venv ]; then \
	  if command -v uv >/dev/null 2>&1; then uv venv sdk-py/.venv; \
	  else python3 -m venv sdk-py/.venv; fi; \
	fi
	@if command -v uv >/dev/null 2>&1; then \
	  uv pip install -e "sdk-py[dev]" --python sdk-py/.venv/bin/python --quiet; \
	else \
	  sdk-py/.venv/bin/pip install -e "sdk-py[dev]" --quiet; \
	fi

mcp: ## Build the MCP bridge
	@echo ">> Building MCP bridge"
	pnpm --filter ./mcp run build

test: ## Run all tests
	@echo ">> Running TS tests"
	pnpm test
	@echo ">> Running Python tests"
	cd sdk-py && .venv/bin/python -m pytest -q

lint: ## Lint all packages
	pnpm lint

typecheck: ## Typecheck all TS packages
	pnpm typecheck

clean: ## Remove build artifacts
	rm -rf engine/zig-cache engine/zig-out
	pnpm -r exec rm -rf dist .turbo .tsbuildinfo
	find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name ".pytest_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
