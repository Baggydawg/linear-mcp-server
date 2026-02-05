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
- `src/shared/tools/linear/` - All 13 tool implementations (workspace_metadata, list_issues, create_issues, etc.)
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

### Team Scoping

Set `DEFAULT_TEAM` environment variable to scope all queries to a specific team:

```bash
DEFAULT_TEAM=SQT  # Team key (recommended) or UUID
```

When `DEFAULT_TEAM` is configured:
- `workspace_metadata` returns only team members (via `team.members()`) instead of all workspace users
- `workspace_metadata` filters workflow states to only the specified team's states
- Query tools (`list_issues`, `list_cycles`, `list_projects`, `get_sprint_context`) automatically filter to the default team when no team is explicitly specified
- Short keys (u0, s0, pr0) only cover team-specific entities

This is useful for multi-team workspaces where you want Claude to focus on a single team's context. To switch teams, update the environment variable and call `workspace_metadata({ forceRefresh: true })`.

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

## TOON Output Format

Tools output TOON (Token-Oriented Object Notation) - a token-efficient CSV-like format designed for AI agents. TOON provides unambiguous parsing and consistent round-trip data handling between Claude and the Linear API.

### Two-Tier Strategy

- **Tier 1** (`workspace_metadata`): Returns ALL entities (users, states, projects, labels, cycles). Call once per session to give Claude full workspace context.
- **Tier 2** (other tools): Returns only REFERENCED entities for token efficiency. Claude cross-references with Tier 1 data for complete context.

### Short Keys

Static entities use short keys instead of UUIDs. The MCP server maintains an internal registry that maps short keys to UUIDs, resolving them when making API calls.

| Entity | Short Key | Example |
|--------|-----------|---------|
| Users | `u0, u1, u2...` | `u0` for first user |
| States | `s0, s1, s2...` | `s3` for "In Progress" |
| Projects | `pr0, pr1, pr2...` | `pr0` for first project |

Natural keys are used where available (no translation needed):
- Issues: `SQT-123` (identifier)
- Teams: `SQT` (team key)
- Cycles: `5` (cycle number)
- Labels: `Bug` (label name)

### Multi-Team Short Keys

When `DEFAULT_TEAM` is set, that team's entities get clean (unprefixed) keys. Other teams use prefixed keys:

| Entity | Default Team | Other Teams | Notes |
|--------|--------------|-------------|-------|
| Users | `u0, u1` | `u0, u1` | Global - no prefix |
| Projects | `pr0, pr1` | `pr0, pr1` | Global - no prefix |
| States | `s0, s1` | `sqm:s0, sqm:s1` | Team-scoped |
| Labels | `Bug, Feature` | `sqm:Bugs` | Team-scoped; use names not numbers |
| Workspace Labels | `Idea` | `Idea` | Global - no prefix |
| Grouped Labels | `Type/Bug` | `sqm:Herramientas/Airtable` | Slash preserved |

**Flexible Input:** Default team prefix is accepted: `sqt:s0` resolves same as `s0` when DEFAULT_TEAM=SQT.

### Cross-Team Workflow Example

1. Query SQT issues: states show `s0`, `s1`; labels show `Bug`, `Feature`
2. Query SQM issues: states show `sqm:s0`; labels show `sqm:Bugs`
3. Update SQM issue: use `sqm:s2` for state, `sqm:Audiencias` for label
4. Workspace labels work everywhere: `Idea` applies to any team

### Cross-Team Validation

Write tools validate that states/labels belong to the target issue's team:
- Applying SQT's state `s0` to an SQM issue will fail with a helpful error
- Error includes suggestion: "State 's0' belongs to SQT. For SQM issues, use 'sqm:s0' or check workspace_metadata for SQM states."
- Workspace labels (no team) can be applied to any issue

### When DEFAULT_TEAM Not Set

If `DEFAULT_TEAM` is not configured:
- All team-scoped entities use prefixed keys (no "home" team)
- States: `sqt:s0`, `sqm:s0`, `eng:s0` (all prefixed)
- Labels: `sqt:Bug`, `sqm:Bugs` (all prefixed)
- Users and projects remain global: `u0`, `pr0`
- Workspace labels remain unprefixed: `Idea`, `Board`

### TOON Format Example

```
_meta{team,cycle,start,end,generated}:
  SQT,5,2026-01-26,2026-02-08,2026-01-27T12:00:00Z

_users[2]{key,name,displayName,email}:
  u0,Tobias Nilsson,tobias,t@example.com
  u1,Ian Bastos,ian,i@example.com

_states[3]{key,name,type}:
  s2,Todo,unstarted
  s3,In Progress,started
  s5,Done,completed

issues[3]{identifier,title,state,assignee,priority,estimate}:
  SQT-160,Set up schema,s2,u1,2,3
  SQT-161,Upload algorithm,s3,u0,1,5
```

### Short Key Resolution

Claude uses short keys in both input and output:
- To assign: `update_issues({ items: [{ id: "SQT-174", assignee: "u1" }] })`
- To move state: `update_issues({ items: [{ id: "SQT-163", state: "s5" }] })`

The MCP server resolves `u1` and `s5` to UUIDs internally before calling Linear API.

### Gap Analysis (`get_sprint_context`)

The `get_sprint_context` tool includes a `_gaps` section identifying sprint health issues:

| Gap Type | Condition | Why It Matters |
|----------|-----------|----------------|
| `no_estimate` | Issues without estimate | Affects sprint velocity calculation |
| `no_assignee` | Unassigned issues (excluding completed/canceled) | Unassigned work may be forgotten |
| `stale` | No updates for 7+ days (excluding completed/canceled) | May be blocked or deprioritized |
| `blocked` | Has blocking relations (excluding completed/canceled) | Cannot proceed until dependency resolved |
| `priority_mismatch` | Urgent (priority 1) issues not started | High priority items stuck in backlog |

Example `_gaps` output:
```
_gaps[4]{type,count,issues}:
  no_estimate,3,"SQT-174,SQT-168,SQT-171"
  no_assignee,1,"SQT-165"
  stale,2,"SQT-163,SQT-168"
  priority_mismatch,1,"SQT-174"
```

### Registry and Session

- Registry is populated on first tool call (lazy initialization)
- For stdio (Claude Desktop): Registry persists for session duration, no auto-expiry
- For HTTP/Workers: 30-minute TTL
- Manual refresh: `workspace_metadata({ forceRefresh: true })`

### Key Files

- `src/shared/toon/encoder.ts` - Core TOON encoding functions
- `src/shared/toon/registry.ts` - Short key registry implementation
- `src/shared/toon/schemas.ts` - TOON schema definitions for all entity types
- `src/shared/toon/types.ts` - TypeScript types for TOON structures
