# Repo Complexity Analysis: linear-mcp-server

> Generated 2026-02-06. Used to calibrate explore-agent model selection in a planning orchestrator.

## 1. Source-Only Sizing

| Metric | Value |
|--------|-------|
| **Source file count** | 118 `.ts` files |
| **Total source lines** | 37,254 |
| **Mean lines/file** | 315 |
| **Median lines/file** | 191 |

**Breakdown by category:**

| Category | Files | Lines |
|----------|-------|-------|
| Production src/ | 97 | 25,050 (67.2%) |
| Tests tests/ | 18 | 11,845 (31.8%) |
| Scripts scripts/ | 2 | 336 (0.9%) |
| Config (vitest.config.ts) | 1 | 23 (0.1%) |

All 118 files are TypeScript. No `.js`, `.jsx`, `.tsx`, `.css`, `.html`, `.sh`, `.sql`, or other source extensions present.

## 2. File Size Distribution

| Bucket | Files | % Files | Lines | % Lines |
|--------|-------|---------|-------|---------|
| 0-50 | 23 | 19.5% | 741 | 2.0% |
| 51-100 | 14 | 11.9% | 1,108 | 3.0% |
| 101-200 | 22 | 18.6% | 3,128 | 8.4% |
| 201-500 | 31 | 26.3% | 8,495 | 22.8% |
| 501-1000 | 21 | 17.8% | 13,998 | 37.6% |
| 1000+ | 7 | 5.9% | 9,784 | 26.3% |

**Key insight:** The distribution is top-heavy. 7 files (5.9%) hold 26.3% of all code. The 501+ bucket (28 files, 23.7%) holds 63.9% of all lines. But the median is 191 — the "typical" file is moderate.

## 3. Non-Source File Inventory

| Type | Files | Total Lines | Relevant to Architecture? |
|------|-------|-------------|--------------------------|
| **package-lock.json** | 1 | 4,552 | No — auto-generated dependency lock |
| **bun.lock** | 1 | 473 | No — auto-generated dependency lock |
| **Markdown docs** | 14 | ~12,000 | Partially — `CLAUDE.md` (233 lines), `rules.md` (72), `toon-schema.md` (651), and `linear-schema.md` (681) document architecture decisions; the rest are test scripts and archives |
| **JSON fixtures** | 6 | 570 | Yes — `tests/fixtures/tool-inputs/*.json` define test input shapes that mirror the Zod schemas |
| **Config JSON** | 3 | 133 | Marginally — `tsconfig.json`, `biome.json`, `package.json` define build/lint/dep config |
| **PNG images** | 3 | binary | No — documentation screenshots |
| **TOML** | 1 | 61 | Marginally — `wrangler.toml` configures Cloudflare Workers deployment |
| **Env files** | 3 | 85 | No — `.env`, `env.example`, `team-profiles.json.example` are config templates |
| **.gitignore** | 1 | 105 | No |

**Verdict:** Safe to filter all non-source files. The only ones with architectural bearing are `CLAUDE.md` and the `docs/toon-schema.md`/`docs/linear-schema.md` docs, which describe the TOON encoding system — but that system's implementation lives in source files anyway.

## 4. Top 10 Largest Source Files

| # | File | Lines | Imports | Funcs/Blocks | Fan-In | Verdict |
|---|------|-------|---------|-------------|--------|---------|
| 1 | `tests/toon/registry.test.ts` | 2,244 | 3 | 204 | 0 | **Exhaustive test suite** — 204 test blocks covering the TOON registry. Long because it tests every edge case of short key resolution. Not complex, just thorough. |
| 2 | `src/resources/issues-ui.resource.ts` | 1,547 | 1 | 59 | 1 | **Template/resource file** — generates a UI representation of issues. Single import, mostly string templates and formatting helpers. Long but self-contained. |
| 3 | `src/shared/tools/linear/update-issues.ts` | 1,265 | 11 | 46 | 2 | **Legitimate hub** — the most complex write tool. Handles batch updates, field resolution, validation, diff computation, snapshot management. Architecturally important. |
| 4 | `src/shared/toon/registry.ts` | 1,208 | 1 | 41 | ~15 (via toon/index) | **Core infrastructure** — the short key registry that maps `u0`/`s3`/`pr1` to UUIDs. Central to the entire TOON system. Only 1 direct import because it's re-exported through `toon/index.ts`. |
| 5 | `tests/mocks/linear-client.ts` | 1,189 | 2 | 112 | 13 | **Mock factory** — every test imports this. 112 mock method definitions. Long because it mocks the entire Linear API surface. |
| 6 | `tests/integration/toon-round-trip.test.ts` | 1,173 | 9 | 48 | 0 | **Integration test** — end-to-end TOON encoding/decoding round trips. Test file, no fan-in. |
| 7 | `src/shared/tools/linear/get-sprint-context.ts` | 1,158 | 6 | 42 | 2 | **Complex query orchestrator** — fetches cycle data, computes gaps, formats sprint context. Contains the gap analysis logic. Legitimate complexity. |
| 8 | `src/shared/tools/linear/list-issues.ts` | 969 | 9 | 43 | 3 | **Query tool** — handles filtering, pagination, and TOON encoding for issue lists. Moderate complexity, well-structured. |
| 9 | `src/shared/tools/linear/projects.ts` | 930 | 9 | 55 | 1 | **Projects CRUD** — full project management (list, create, update). 55 functions across 3 operations. Slightly bloated but reasonable. |
| 10 | `src/shared/tools/linear/create-issues.ts` | 910 | 11 | 31 | 2 | **Batch issue creation** — handles field resolution, validation, parent/sub-issue relationships. Complex write path. |

## 5. Hub / High-Coupling Files

No file in this repo exceeds 15 imports. The maximum is **12 imports**. Top 15 by import count:

| # | File | Imports | Role |
|---|------|---------|------|
| 1 | `src/http/app.ts` | 12 | Hono HTTP app assembly — wires routes, middleware, auth |
| 2 | `src/adapters/http-workers/index.ts` | 12 | Cloudflare Workers adapter — mirrors app.ts for worker runtime |
| 3 | `src/shared/tools/linear/update-issues.ts` | 11 | Issue update tool (see above) |
| 4 | `src/shared/tools/linear/create-issues.ts` | 11 | Issue creation tool |
| 5 | `tests/integration/toon-round-trip.test.ts` | 9 | Integration test |
| 6 | `src/shared/tools/linear/projects.ts` | 9 | Projects tool |
| 7 | `src/shared/tools/linear/list-issues.ts` | 9 | List issues tool |
| 8 | `src/index.ts` | 9 | Node.js entry point |
| 9 | `src/adapters/http-workers/mcp.handler.ts` | 9 | Worker MCP request handler |
| 10 | `src/shared/tools/linear/workspace-metadata.ts` | 8 | Workspace metadata tool |
| 11 | `src/shared/tools/linear/cycles.ts` | 8 | Cycles tool |
| 12 | `src/shared/tools/linear/comments.ts` | 8 | Comments tool |
| 13 | `src/http/routes/mcp.ts` | 8 | MCP route handler |
| 14 | `src/core/mcp.ts` | 8 | Core MCP server setup |
| 15 | `src/adapters/http-hono/routes.oauth.ts` | 8 | OAuth routes |

**Most-imported modules (fan-in):**

| Module | Fan-In | Role |
|--------|--------|------|
| `utils/logger` (both shared and src) | ~24 | Logging utility — everywhere |
| `shared/toon/*` (via toon/index re-export) | ~15 | TOON encoding system |
| `shared/tools/types` | 14 | Tool type definitions |
| `shared/config/env` | 13 | Environment config |
| `config/metadata` | 12 | Tool names/descriptions |
| `services/linear/client` | 10 | Linear API client |
| `storage/interface` | 8 | Storage abstraction |
| `storage/singleton` | 7 | Storage singleton access |
| `utils/limits` | 7 | Rate limits/pagination limits |
| `utils/resolvers` | 6 | ID/name resolvers |

## 6. Complexity Concentration

| Metric | Value |
|--------|-------|
| **Top 5% (6 files)** hold | 20.0% of all lines |
| **Top 10% (12 files)** hold | 35.8% of all lines |
| **Files under 10 lines** | 1 (`src/shared/tools/linear/shared/index.ts` — a re-export barrel) |
| **Files under 30 lines** | 11 (barrel files, small configs, health endpoint, error types) |

The concentration is moderate. Compare: a "highly concentrated" repo would show top-5% holding 40%+. Here, the code is meaningfully distributed across the 201-1000 range — the **middle 50 files** hold the bulk of logic.

## 7. Assessment

### Effective Size

- **118 source files, 37.3K lines total** — but only **97 production files (25K lines)** matter for architecture understanding. The 18 test files (11.8K lines) mirror production structure and can be discovered from it.
- Of those 97 production files, roughly **15-20 are boilerplate/glue** (barrel exports, small configs, single-purpose adapters under 50 lines).
- **Effective complexity footprint: ~75-80 files containing meaningful logic, totaling ~23K lines.**
- This is a **medium-small repo** by any measure.

### Where the Real Complexity Lives

The 8 architecturally critical files, in order of importance:

1. **`src/shared/toon/registry.ts`** (1,208 lines) — The heart of the system. Short key registration, resolution, multi-team prefixing, session lifecycle. Every tool depends on this.
2. **`src/shared/tools/linear/update-issues.ts`** (1,265 lines) — Most complex write path. Batch updates, field validation, diff/snapshot integration.
3. **`src/shared/tools/linear/get-sprint-context.ts`** (1,158 lines) — Complex read orchestrator: gap analysis, cycle context aggregation, multi-entity joins.
4. **`src/shared/toon/encoder.ts`** (514 lines) — TOON encoding logic. The output format everything produces.
5. **`src/shared/tools/linear/shared/validation.ts`** (368 lines) — Cross-team validation logic. Ensures states/labels match target team.
6. **`src/shared/config/env.ts`** (202 lines) — Dual-runtime config parsing. Small but critical junction point.
7. **`src/shared/mcp/dispatcher.ts`** (439 lines) — Tool dispatch and routing. Connects MCP protocol to tool implementations.
8. **`src/shared/tools/types.ts`** (165 lines) — ToolContext and core type definitions. Every tool depends on these shapes.

### Model Recommendation

**Haiku is adequate for exploring this repo.** Here's why:

- **Low coupling ceiling:** Max 12 imports per file. No god objects. No complex inheritance hierarchies. The dependency graph is shallow — most files import from 6-9 well-named modules.
- **Consistent patterns:** All 13 tools follow the same structure (input schema -> fetch -> transform -> TOON encode -> output). Once you understand one tool, you understand the pattern.
- **Clear naming:** Files are named exactly what they do (`update-issues.ts`, `workspace-metadata.ts`, `registry.ts`). No indirection or metaprogramming.
- **Single language, single framework:** Pure TypeScript, no mixed paradigms.
- **Flat architecture:** Only 4 levels of directory nesting. No complex module resolution or dynamic imports.

The only thing that *might* require sonnet-level reasoning: understanding the **TOON encoding system** as a coherent abstraction — specifically how the registry, encoder, schemas, and error handling interact across files. But even this is well-documented in `CLAUDE.md` and follows predictable patterns.

### What Would Trip Up a Weaker Model

1. **The TOON abstraction layer** — A weaker model might not understand that `toon/registry.ts`, `toon/encoder.ts`, `toon/schemas.ts`, and `toon/types.ts` form a single cohesive system. It might describe them as independent utilities.

2. **The dual-runtime architecture** — `src/shared/` exists because code runs in both Node.js and Cloudflare Workers. A weaker model might not grasp why there's both `src/index.ts` and `src/worker.ts`, or why `shared/config/env.ts` and `src/config/env.ts` both exist.

3. **Short key indirection** — The repo's central innovation is that tools accept `u0`, `s3`, `pr1` instead of UUIDs. A weak model might miss that this is the architectural raison d'etre, not just a convenience.

4. **Re-export barrels** — Fan-in analysis is misleading if you only look at direct imports. The TOON registry has apparent fan-in of 1, but actual fan-in of ~15 via `toon/index.ts`. A weak model might underestimate its importance.

5. **Test file sizes** — 5 of the top 12 largest files are tests. A weak model might flag these as complexity hotspots when they're actually just thorough test suites.

### Calibration Summary

This repo should be classified as **"small-medium, low coupling, consistent patterns."** Haiku would explore it competently. Sonnet would be overkill. Opus would be waste. The thresholds to calibrate against: repos where haiku starts struggling are ones with 200+ source files, >15 avg imports, complex inheritance/generics, or multiple interacting languages.
