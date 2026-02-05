# Test Coverage Report

Last updated: 2026-02-05

## Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | 701 |
| **Test Files** | 16 |
| **Expect Calls** | 1,564 |
| **Run Time** | ~7 seconds |

```bash
bun test                    # Run all unit tests
bun run test:integration    # Live API tests (requires PROVIDER_API_KEY)
```

---

## Coverage by Area

### TOON System (Registry & Encoder)

| File | Tests | Function Coverage |
|------|-------|-------------------|
| `tests/toon/registry.test.ts` | 135 | 83% (20/24 exported functions) |
| `tests/toon/encoder.test.ts` | 57 | 85% (11/13 exported functions) |

**Tested Features:**
- Registry building with deterministic key assignment by `createdAt`
- Multi-team prefixed short keys (`sqm:s0`, `sqt:s1`)
- Flexible input resolution (`sqt:s0` = `s0` for default team)
- Team prefix parsing (case-insensitive)
- TTL/staleness management (30min HTTP, never stdio)
- Concurrent initialization (singleton promise pattern)
- TOON value escaping (quotes, newlines, commas, backslashes)
- Field truncation (500 char titles, 3000 char descriptions)
- Markdown image stripping
- Priority/estimate/cycle formatters (`p1`, `e5`, `c3`)

**Untested Functions:**
- `getUserMetadata()`, `getStateMetadata()`, `getProjectMetadata()` - metadata getters
- `registerNewProject()` - dynamic project registration
- `encodeSimpleSection()` - convenience wrapper

---

### Tool Handlers

| Tool | Tests | Key Coverage |
|------|-------|--------------|
| `list_issues` | 38 | Filters, pagination, keywords, TOON output |
| `get_issues` | 22 | UUID/identifier lookup, batch fetch, errors |
| `create_issues` | 32 | All fields, batch, short key resolution |
| `update_issues` | 31 | Updates, labels, archive, short key resolution |
| `get_sprint_context` | 33 | Cycle navigation, all 5 gap types |
| `workspace_metadata` | 16 | All entity types, registry storage, forceRefresh |
| `comments` | 47 | List, add, update operations |
| `projects` | 34 | List, create, update, state transitions |
| `project_updates` | 24 | Health status tracking |
| **Total** | **277** | |

**All tools test:**
- Tool metadata (name, title, annotations)
- Input validation (via Zod schema + fixtures)
- Handler behavior with mock client
- TOON output format
- Error handling

---

### Integration & Cross-Cutting Tests

| File | Tests | Focus |
|------|-------|-------|
| `tests/integration/toon-round-trip.test.ts` | 24 | End-to-end workflows |
| `tests/tools/shared/validation.test.ts` | 47 | Cross-team validation |
| `tests/tools/llm-ux-behaviors.test.ts` | 33 | LLM-specific UX |
| **Total** | **104** | |

**Integration tests cover:**
- Tier 1 → Tier 2 flow (workspace_metadata → list_issues)
- Create → update → verify cycles
- Session isolation and registry persistence
- Multi-team prefixed keys through full handler pipeline
- Batch operations with partial failures

**Cross-team validation tests cover:**
- `validateStateBelongsToTeam()` - state ownership checks
- `validateLabelBelongsToTeam()` - label ownership + workspace labels
- `validateStateKeyPrefix()` - prefix validation before resolution
- `validateLabelKeyPrefix()` - label prefix validation
- Error messages with helpful suggestions

**LLM UX tests cover:**
- Pagination indicators and cursors
- Zero-result handling (graceful empty states)
- Context bloat prevention
- State filtering examples in tool descriptions

---

### Config Tests

| File | Tests | Coverage |
|------|-------|----------|
| `tests/config/user-profiles.test.ts` | 23 | Profile loading, caching, formatting |

---

## Mock Infrastructure

### Mock Client (`tests/mocks/linear-client.ts`)

**18 Linear API methods mocked:**
- Query: `viewer`, `teams()`, `team()`, `issues()`, `issue()`, `users()`, `projects()`, `cycles()`, `comments()`, `projectUpdates()`
- Mutations: `createIssue()`, `updateIssue()`, `createProject()`, `updateProject()`, `createComment()`, `updateComment()`, `createProjectUpdate()`, `updateProjectUpdate()`
- Raw: `rawRequest()` with complex filter support

**Mock Data:**

| Entity | Count | Details |
|--------|-------|---------|
| Teams | 4 | SQT (default), ENG, DES, SQM |
| Users | 3 | Test User, Jane Doe, Bob Smith |
| Workflow States | 19 | 6 per team (distinct IDs per team) |
| Labels | 8 | Team-specific labels |
| Issues | 6 | Various states, priorities, relations |
| Projects | 2 | Q1 Release, Infrastructure |
| Cycles | 4 | 2 per team |
| Comments | 2 | User comments |
| Project Updates | 2 | onTrack, atRisk statuses |

### Input Fixtures (`tests/fixtures/tool-inputs/`)

| Tool | Valid Cases | Invalid Cases |
|------|-------------|---------------|
| `list_issues` | 22 | 3 |
| `get_issues` | 4 | 2 |
| `create_issues` | 9 | 4 |
| `update_issues` | 16 | 3 |
| `workspace_metadata` | 10 | 4 |
| **Total** | **61** | **16** |

---

## Multi-Team Functionality

Comprehensive coverage of the multi-team short key system:

| Feature | Tests | Location |
|---------|-------|----------|
| Default team clean keys (`s0`, `s1`) | 10+ | `registry.test.ts` |
| Non-default team prefixed keys (`sqm:s0`) | 10+ | `registry.test.ts` |
| Flexible input (`sqt:s0` = `s0`) | 8+ | `registry.test.ts` |
| Case-insensitive prefixes | 3+ | `registry.test.ts` |
| Cross-team validation | 47 | `validation.test.ts` |
| E2E prefixed keys through handlers | 8 | `toon-round-trip.test.ts` |
| Error messages with suggestions | 10+ | Multiple files |

---

## Test Patterns

### Fixture-Based Input Validation
```typescript
describe('valid inputs', () => {
  for (const fixture of listIssuesFixtures.valid) {
    it(`accepts: ${fixture.name}`, () => {
      const result = tool.inputSchema.safeParse(fixture.input);
      expect(result.success).toBe(true);
    });
  }
});
```

### Short Key Registry Setup
```typescript
beforeEach(() => {
  const mockRegistry = buildRegistry({
    users: [...],
    states: [...],
    teams: [{ id: 'team-sqt', key: 'SQT' }],
    defaultTeamId: 'team-sqt',
  });
  storeRegistry('test-session', mockRegistry);
});

afterEach(() => {
  clearRegistry('test-session');
});
```

### TOON Output Verification
```typescript
it('includes TOON sections', async () => {
  const result = await tool.handler(input, context);
  const text = result.content[0].text;

  expect(text).toContain('_meta{');
  expect(text).toContain('issues[');
  expect(text).toContain('_states[');
});
```

### Error Verification
```typescript
it('throws with helpful error', () => {
  expect(() => resolveShortKey(registry, 'state', 'xyz:s0'))
    .toThrow(ToonResolutionError);

  try {
    resolveShortKey(registry, 'state', 'xyz:s0');
  } catch (error) {
    expect(error.code).toBe('UNKNOWN_SHORT_KEY');
    expect(error.suggestion).toContain('workspace_metadata');
  }
});
```

---

## Running Tests

```bash
# All tests
bun test

# Specific file
bun test tests/toon/registry.test.ts

# Watch mode
bun run test:watch

# Integration tests (requires PROVIDER_API_KEY in .env)
bun run test:integration
```
