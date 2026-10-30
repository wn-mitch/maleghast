set shell := ["bash", "-euo", "pipefail", "-c"]

port := "8787"

# List recipes
default:
    @just --list

# Install dependencies
install:
    pnpm install

# Typecheck the client and the Worker
check:
    pnpm exec tsc --noEmit -p .
    pnpm exec tsc --noEmit -p worker

# Run the unit tests; pass a file or -t pattern to narrow them
test *args:
    pnpm exec vitest run {{args}}

# Typecheck and build the client into dist/
build:
    pnpm build

# Hot-reloading client on Vite, with the Worker behind it for rooms
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm exec wrangler dev --port {{port}} --show-interactive-dev-session=false &
    trap 'kill $! 2>/dev/null' EXIT
    pnpm exec vite

# Build, then serve the built game from the Worker as it runs in production
serve: build
    pnpm exec wrangler dev --port {{port}}

# Build, start the Worker, and play full games in headless browsers
e2e: build
    #!/usr/bin/env bash
    set -euo pipefail
    pnpm exec wrangler dev --port {{port}} --show-interactive-dev-session=false >/dev/null 2>&1 &
    trap 'kill $! 2>/dev/null' EXIT
    for _ in $(seq 60); do curl -sf http://127.0.0.1:{{port}}/ >/dev/null && break; sleep 0.5; done
    BASE=http://127.0.0.1:{{port}} node e2e/duel.mjs
    BASE=http://127.0.0.1:{{port}} node e2e/solo.mjs

# Everything that gates a commit
verify: check test e2e

# Build and publish to Cloudflare
deploy: check test build
    pnpm exec wrangler deploy
