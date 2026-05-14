.PHONY: help all engine orchestrator sdks sdk-ts sdk-py mcp test lint typecheck clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

all: engine orchestrator sdks mcp ## Build everything

engine: ## Build the Zig engine (forked lightpanda)
	@echo ">> Building engine"
	cd engine && zig build -Doptimize=ReleaseSafe

orchestrator: ## Build the TS orchestrator
	@echo ">> Building orchestrator"
	pnpm --filter ./orchestrator run build

sdks: sdk-ts sdk-py ## Build both SDKs

sdk-ts: ## Build the TypeScript SDK
	@echo ">> Building TS SDK"
	pnpm --filter ./sdk-ts run build

sdk-py: ## Build the Python SDK
	@echo ">> Building Python SDK"
	cd sdk-py && python -m pip install -e . --quiet

mcp: ## Build the MCP bridge
	@echo ">> Building MCP bridge"
	pnpm --filter ./mcp run build

test: ## Run all tests
	@echo ">> Running TS tests"
	pnpm test
	@echo ">> Running Python tests"
	cd sdk-py && python -m pytest -q

lint: ## Lint all packages
	pnpm lint

typecheck: ## Typecheck all TS packages
	pnpm typecheck

clean: ## Remove build artifacts
	rm -rf engine/zig-cache engine/zig-out
	pnpm -r exec rm -rf dist .turbo .tsbuildinfo
	find . -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
	find . -name ".pytest_cache" -type d -prune -exec rm -rf {} + 2>/dev/null || true
