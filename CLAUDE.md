# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Linear MCP Server - A Model Context Protocol server for Linear.app that enables AI agents to manage issues, projects, teams, cycles, and comments. Runs in two environments: Node.js/Bun (local) and Cloudflare Workers (production).

## Development Commands

```bash
# Development
bun dev                    # Start with hot reload on port 3000
bun dev:worker            # Local Cloudflare Worker testing (port 8787)

# Code Quality
bun run typecheck         # TypeScript type checking
bun run lint              # Biome linting check
bun run lint:fix          # Auto-fix linting issues
bun run format            # Format code with Biome

# Testing
bun test                  # Run all unit tests (~4s)
bun run test:watch        # Watch mode
bun run test:integration  # Live API tests (~45s, requires LINEAR API key)

# Build & Deploy
bun run build             # Build production
bun deploy                # Deploy to Cloudflare Workers
```

## Architecture

### Dual-Runtime Design
All tool logic lives in `src/shared/` and works in both Node.js and Cloudflare Workers. Each runtime has a thin adapter layer:
- `src/index.ts` - Node.js entry (Hono HTTP)
- `src/worker.ts` - Cloudflare Workers entry

### Key Directories
- `src/shared/tools/linear/` - All 17 tool implementations (workspace_metadata, list_issues, create_issues, etc.)
- `src/shared/tools/shared/` - Shared utilities (formatting, validation, caching, diff/snapshots)
- `src/shared/config/env.ts` - Unified config parser for both runtimes
- `src/shared/oauth/` - OAuth 2.1 PKCE flow implementation
- `src/shared/storage/` - Token storage (file, KV, memory)
- `src/schemas/` - Zod input/output schemas
- `src/config/metadata.ts` - Tool names and descriptions (centralized)

### Tool Context Pattern
Tools receive a `ToolContext` with auth, session, and cancellation support:
```typescript
interface ToolContext {
  sessionId: string;
  signal?: AbortSignal;
  authStrategy?: 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';
  providerToken?: string;  // Linear access token
  resolvedHeaders?: Record<string, string>;  // Ready-to-use auth headers
}
```

### Auth Strategies
Configured via `AUTH_STRATEGY` env var:
- `oauth` - Full OAuth 2.1 PKCE flow with RS token mapping
- `bearer` - Static bearer token (BEARER_TOKEN env)
- `api_key` - API key header
- `none` - No authentication

## Tool Design Principles

From `docs/rules.md`:

1. **Self-Documented Contracts** - Tool descriptions explain what, where from, and recovery paths via Zod `.describe()`
2. **High-Signal Responses** - Human-readable summaries + structured output + actionable hints
3. **Batch-First Writes** - Index-stable results (`results[i]` → `items[i]`), per-item outcomes
4. **Human Inputs + Resolvers** - Accept names (e.g., "Done" state) and resolve to IDs internally
5. **Actionable Errors** - Errors include codes, hints, and suggestions

## Testing

Unit tests use mocked Linear API responses (`tests/mocks/linear-client.js`). Test files are in `tests/tools/`.

Run a single test file:
```bash
bun test tests/tools/list-issues.test.ts
```

Integration tests require a "Tests" team in Linear and `PROVIDER_API_KEY` in `.env`.

## Code Style

- Biome formatter: 2-space indent, 88-char line width
- TypeScript strict mode, ES2022
