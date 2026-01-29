# Stress Test Findings

Findings, decisions, and action items from the manual stress test session (2026-01-28).

Test script: `docs/manual-test-script.md` — 30 steps across 9 phases, all 17 tools.

---

## Phase 1: Bootstrap & Discovery (Steps 1–3)

### Step 1 — Workspace overview

**Result: PASS**

- Tool: `workspace_metadata` — correct Tier 1 tool selected
- Claude also called `list_cycles` to get full cycle history (7 cycles vs 3 from workspace_metadata) — reasonable
- All TOON sections present: `_meta{`, `_teams[`, `_users[`, `_states[`, `_labels[`, `_projects[`, `_cycles[`
- Short keys correctly assigned: u0–u6, s0–s6, pr0–pr2
- Clear natural-language summary with formatted tables

**Short key registry (reference for consistency checks):**

| Entity | Key | Value |
|--------|-----|-------|
| Users | u0 | Tobias Nilsson |
| | u1 | Ian Bastos |
| | u2 | Luis M. de Carvajal |
| | u3 | Ismael Osuna |
| | u4 | Guerson Meyer |
| | u5 | Juan Pablo Carbonell |
| | u6 | Gonzalo Verdugo |
| States | s0 | Todo (unstarted) |
| | s1 | Done (completed) |
| | s2 | Canceled (canceled) |
| | s3 | Backlog (backlog) |
| | s4 | In Progress (started) |
| | s5 | In Review (started) |
| | s6 | Triage (triage) |
| Projects | pr0 | MVP Sophiq Platform (started) |
| | pr1 | Data Intelligence (backlog) |
| | pr2 | Valuation (backlog) |

**Bugs found:**

- **BUG-1: Empty org name** — `_meta{org,team,generated}` has blank `org` field. Organization name not being populated. Investigate `workspace_metadata` tool / Linear API query.
- **BUG-2: User roles always blank** — `_users` includes `role` column but all values are empty. This is valuable contextual info for assignment decisions. Investigate whether the Linear API field is being queried and whether roles are set in Linear.

### Steps 2 & 3 — List teams / List users

**Result: PASS (covered by Step 1)**

Claude did not call `list_teams` or `list_users` — it correctly recognized the data was already available from `workspace_metadata`. This is good agent behavior and validates the Tier 1 design.

**Decision: REMOVE `list_teams` and `list_users` tools**

Rationale:
- `workspace_metadata` (Tier 1) already returns complete teams and users data
- Claude Desktop correctly avoids calling these redundant tools
- Fewer tools = less noise in the tool manifest = better LLM tool selection
- Single-user MCP (Tobias, possibly small tech team in future) — no need for standalone refresh
- No pagination concern (< 10 users, 1–2 teams max)
- If multi-team expansion happens in future, tools can be restored from git history

This reduces the tool count from 17 to 15.

---

## Phase 2: Sprint & Cycles (Steps 4–6)

### Step 4 — Current sprint context

**Result: PASS**

- Tool: `get_sprint_context` with `team: "SQT"`, `cycle: "current"` — correct
- All TOON sections present: `_meta{`, `_users[`, `_states[`, `_projects[`, `issues[`, `comments[`, `relations[`, `_gaps[`
- **Tier 2 filtering correct:** 6/7 users (u4/Guerson excluded — not referenced in sprint), 4/7 states, 2/3 projects
- Short keys consistent with Phase 1 registry
- Gap analysis: `no_estimate(32)`, `stale(2)`, `blocked(1)`, `priority_mismatch(1)` — `no_assignee` correctly absent (all issues assigned)
- Comments (23) and relations (1: SQT-160 blocks SQT-159) both present
- Claude produced an excellent standup: status breakdown, per-person table, gap interpretation, actionable recommendations

**Notes:**

- **~~BUG-3~~: CLEARED** — Confirmed via screenshot that the issue field IS present in raw output. Was a copy-paste formatting artifact.
- **NOTE-1: Strip image URLs from descriptions** — SQT-179 includes 14 embedded image markdown URLs (`![name](https://uploads.linear.app/...)`). These are not accessible without auth and waste tokens. **Decision:** Strip image markdown from descriptions and replace with a count indicator (e.g. `[3 images]`). Full image viewing can be a future tool. Long text descriptions are fine and should be kept — only strip inaccessible image links.
- **NOTE-2: Tier 2 states may be incomplete for mutations** — Only 4/7 states shown (the ones referenced in sprint issues). If Claude needs to mutate to Backlog, Canceled, or Triage, it won't know those short keys from this output alone. **Decision:** Ensure `workspace_metadata` is always called first in every session. Consider enforcing this via tool descriptions or Claude Desktop system prompt.

### Step 5 — Previous sprint

**Result: PASS**

- Tool: `get_sprint_context` with `cycle: "previous"` — correct
- Returns Cycle 4 (Jan 11–25) — different from Step 4's Cycle 5 ✓
- Tier 2 filtering: 4 users, 1 state (Done only — all completed), 2 projects
- Short keys consistent
- Claude gave good recap: 100% completion, per-person breakdown, velocity comparison

**Notes:**

- **~~BUG-4~~: CLEARED** — SQT-119 IS in the `issues[27]` list. The pasted text rendered `SQT-119` as `SQT-11` (trailing `9` cut off). Confirmed via screenshot that `SQT-119,fix despublicaods manualmente...` is present.

### Step 6 — List cycles

**Result: PASS**

- Tool: `list_cycles` with `teamId: "SQT"`, `limit: 100` — correct
- TOON format: `_meta{` + `cycles[7]{num,name,start,end,active,progress}:`
- All 7 cycles returned, cycle 5 active at 33%
- Claude noted sprint cadence shift (2-week → 1-week) and interpreted completion rates
- **BUG-5: Cycles out of chronological order** — Cycles 2 and 3 listed as `2, 3` instead of chronological `3, 2` (or ascending `2, 3` which would be fine but the surrounding order is descending 7→6→5→4→**2→3**→1). Cycle ordering should be consistent (either ascending or descending by number).

---

## Bugs & Action Items

| ID | Type | Summary | Priority | Status |
|----|------|---------|----------|--------|
| BUG-1 | Bug | Empty org name in `_meta` section | Low | To investigate |
| BUG-2 | Bug | User roles always blank in `_users` section | Medium | To investigate |
| ~~BUG-3~~ | ~~Bug~~ | ~~Missing issue field in comment row~~ | — | Cleared (copy-paste artifact) |
| ~~BUG-4~~ | ~~Bug~~ | ~~Phantom issue SQT-119 in `_gaps`~~ | — | Cleared (copy-paste artifact — SQT-119 rendered as SQT-11) |
| BUG-5 | Bug | Cycles out of chronological order in `list_cycles` TOON output (7→6→5→4→2→3→1) | Low | To fix |
| NOTE-1 | Improvement | Strip image markdown URLs from descriptions, replace with `[N images]` count | Medium | Decided — not yet implemented |
| NOTE-2 | Architecture | Tier 2 states incomplete for mutations — ensure `workspace_metadata` always called first | Medium | To implement (tool description or system prompt) |
| NOTE-3 | Enhancement | Add `createdAt` and `creator` fields to TOON issue schema | Medium | To implement |
| DECISION-1 | Architecture | Remove `list_teams` and `list_users` tools | Medium | Decided — not yet implemented |

---

## Phase 3: Issue Querying (Steps 7–12)

### Step 7 — List issues with filters (in-progress)

**Result: PASS**

- Tool: `list_issues` with `team: "SQT"`, `filter: { state: { type: { eq: "started" } } }` — correct
- All TOON sections present: `_meta{`, `_users[6]`, `_states[2]` (s4+s5, both "started"), `_projects[3]`, `_labels[3]`, `issues[20]`, `comments[12]`
- Tier 2 filtering correct, short keys consistent
- All 20 issues in In Progress or In Review states

### Step 8 — Search cognito

**Result: PASS**

- Tool: `list_issues` with `q: "cognito"`, `team: "SQT"` — correct
- 2 results: SQT-168, SQT-143 — both contain "cognito" in title/description
- Test script expected SQT-158 and SQT-190 too, but those don't contain "cognito" in their text. Keyword search is working correctly; test expectations were overly broad.

### Step 9 — My issues

**Result: PASS (tool selection note)**

- Tool: `list_issues` with `assignedToMe: true` + `filter: { state: { type: { neq: "completed" } } }` — **not** `list_my_issues`
- Claude chose the more flexible tool. Same result, better filtering.
- 20 open issues assigned to u0 (Tobias). Correct.
- Tier 2 includes u1, u2 as comment authors — correct.

**Decision candidate: REMOVE `list_my_issues`** — `list_issues` with `assignedToMe: true` achieves the same result with more flexibility. Would bring tool count from 15 → 14.

### Step 10 — Get specific issues

**Result: PASS (with data bug)**

- Tool: `get_issues` with `ids: ["SQT-174", "SQT-155"]` — correct
- `_meta` shows succeeded:2, failed:0
- Full descriptions present (not truncated)

**Bug found:**

- **BUG-6: `get_issues` missing priority, estimate, cycle, and team fields** — Both issues return blank values for these fields, but other tools return them correctly for the same issues:

  | Field | `get_issues` (Step 10) | `get_sprint_context` (Step 4) | `list_issues` (Step 9) |
  |-------|----------------------|------------------------------|----------------------|
  | SQT-174 priority | blank | 1 (Urgent) | 1 |
  | SQT-174 estimate | blank | 5 | 5 |
  | SQT-174 cycle | blank | 5 | 5 |
  | SQT-174 team | blank | — | SQT |
  | SQT-155 priority | blank | 2 (High) | — |
  | SQT-155 estimate | blank | 5 | — |

  The `get_issues` GraphQL query or TOON row mapper is not fetching/mapping these fields. **This is the "full details" tool but it returns less data than `list_issues`.** High priority fix.

### Step 11 — Unassigned issues

**Result: PASS**

- Tool: `list_issues` with `cycle: "current"`, `filter: { assignee: { null: true }, state: { type: { neq: "completed" } } }` — well-constructed
- 0 results — correct, all sprint issues have assignees (confirmed by Step 4)
- Test script expected SQT-164 unassigned, but it's assigned to u1 (Ian). Test expectation was outdated.

### Step 12 — High priority not started

**Result: PASS**

- Tool: `list_issues` with priority + state type filter
- SQT-174 (Urgent, Todo) appears as expected
- 41 results — many priority 1–2 issues in non-started states across all time (not just current sprint)

---

## Bugs & Action Items

| ID | Type | Summary | Priority | Status |
|----|------|---------|----------|--------|
| BUG-1 | Bug | Empty org name in `_meta` section | Low | To investigate |
| BUG-2 | Bug | User roles always blank in `_users` section | Medium | To investigate |
| ~~BUG-3~~ | ~~Bug~~ | ~~Missing issue field in comment row~~ | — | Cleared (copy-paste artifact) |
| ~~BUG-4~~ | ~~Bug~~ | ~~Phantom issue SQT-119 in `_gaps`~~ | — | Cleared (copy-paste artifact — SQT-119 rendered as SQT-11) |
| BUG-5 | Bug | Cycles out of chronological order in `list_cycles` TOON output (7→6→5→4→2→3→1) | Low | To fix |
| BUG-6 | Bug | `get_issues` missing priority, estimate, cycle, team fields (blank where other tools return data) | **High** | To fix |
| NOTE-1 | Improvement | Strip image markdown URLs from descriptions, replace with `[N images]` count | Medium | Decided — not yet implemented |
| NOTE-2 | Architecture | Tier 2 states incomplete for mutations — ensure `workspace_metadata` always called first | Medium | To implement (tool description or system prompt) |
| NOTE-3 | Enhancement | Add `createdAt` and `creator` fields to TOON issue schema | Medium | To implement |
| NOTE-4 | Enhancement | Add letter prefixes to numeric TOON fields for readability (see details below) — requires both encoder + input resolver updates | Medium | Decided — to implement separately |
| BUG-7 | Bug | `create_issues` cycle field is a TODO — accepted in schema but silently ignored (never resolved to cycleId) | Medium | To fix |
| DECISION-1 | Architecture | Remove `list_teams` and `list_users` tools | Medium | Decided — not yet implemented |
| DECISION-2 | Architecture | Remove `list_my_issues` tool (`list_issues` + `assignedToMe: true` is equivalent) | Medium | To discuss |

---

## NOTE-4: Prefixed Numeric Fields (Detail)

**Problem:** Three TOON fields use bare numbers — priority, cycle, and estimate. In a row like `SQT-174,...,s0,u0,1,5,,5,,,`, it's ambiguous which `5` is the estimate and which is the cycle number. This makes manual validation difficult and is error-prone for both humans and LLMs.

**Decision:** Add single-letter prefixes to all numeric-only fields, making each value self-documenting:

| Field | Current | Proposed | Full value set |
|-------|---------|----------|----------------|
| Priority | `1` | `p1` | `p0` (None), `p1` (Urgent), `p2` (High), `p3` (Medium), `p4` (Low) |
| Cycle | `5` | `c5` | `c1`, `c2`, `c3`... (cycle number) |
| Estimate | `5` | `e5` | `e1`, `e2`, `e3`, `e5`, `e8` (fibonacci) |

**Example row (before):**
```
SQT-174,Security: Migrate secrets,s0,u0,1,5,,5,,,
```

**Example row (after):**
```
SQT-174,Security: Migrate secrets,s0,u0,p1,e5,,c5,,,
```

**Implementation notes:**
- **Output (encoder):** Add prefix when formatting TOON issue rows. No registry lookup needed.
- **Input (resolver):** Must also update input resolvers to strip prefixes before validation. Currently `p1`, `e5`, `c5` would all fail — priority only accepts `0-4` or names like `"Urgent"`, estimate/cycle only accept bare numbers. Both sides must ship together or Claude will see prefixed output and fail on input.
- **Backwards compatibility:** Accept both `p1` and `1`, both `e5` and `5`, etc.
- **Scope:** All tools that output issue rows (list_issues, get_issues, get_sprint_context, create_issues, update_issues)
- To be implemented as a separate task after stress test

**BUG-7 (found during investigation): Cycle assignment in `create_issues` is a TODO** — the `cycle` field is accepted in the input schema but never resolved to a `cycleId`. The code has a `// TODO: Resolve cycle number to cycleId via Linear API` comment. The field is silently ignored. Issues created with a cycle number will not be assigned to any cycle.

---

## Phase 4: Issue Creation (Steps 13–15)

### Step 13 — Create single test issue

**Result: PASS**

- Tools: `workspace_metadata` (registry refresh) → `create_issues` — Claude proactively refreshed registry before mutations. Validates NOTE-2.
- Short key inputs: `assignee: "u0"`, `state: "s0"`, `priority: "High"` (string name) — all correct
- Response: succeeded:1, SQT-197 created, index-stable `results[`
- **NOTE-7: URL missing from `created[` response** — `created[` schema is `{identifier,title,state,assignee,project}` — no `url` field. The URL is important for the user to verify in Linear. Investigate why it's not included and add it.

### Step 14 — Batch create with short keys

**Result: PASS (with notes)**

- Tool: `create_issues` batch of 3 — all succeeded, index-stable (0→SQT-198, 1→SQT-199, 2→SQT-200)
- Short keys used correctly: `u1` (Ian), `u6` (Gonzalo), `pr0` (MVP Sophiq Platform)
- Labels applied via `labelNames` array
- Priorities via string names (Medium, Low, Urgent)

**Issues found:**

- **NOTE-5: Unspecified assignee auto-assigned to u0** — Item 3 (SQT-200) had no `assignee` field in the request, but `created[` output shows `u0` (Tobias). Either the Linear API auto-assigns to the API key owner, or the tool defaults to current user. Needs investigation — creating unassigned issues must be possible (e.g. planning project issues before knowing who will work on them).
- **NOTE-6: State blank in `created[` output** — All 3 items show blank state field in `created[` despite Linear assigning Triage (s6) by default (confirmed via Linear UI screenshot and Step 17 diff `s6→s4`). The `created[` response should fetch and include the actual state assigned by Linear.

### Step 15 — Create sub-issue

**Result: PASS**

- Tools: `get_issues` (verify parent) → `create_issues` with `parentId: "SQT-197"` — correct
- SQT-201 created as sub-issue
- **Confirms BUG-6:** `get_issues` for SQT-197 shows blank priority/estimate despite being created with High priority and estimate 3.

---

## Phase 5: Issue Updates (Steps 16–18)

### Step 16 — Update state and priority

**Result: PASS**

- Tool: `update_issues` with `state: "s4"`, `priority: "High"` — short key resolution correct
- Diff: `state,s0,s4` — only state changed (priority already High from creation, no-op)
- Note: User used SQT-197 (Step 13) instead of SQT-198 (Step 14 per test script). Still valid.

### Step 17 — Batch update with mixed changes

**Result: PASS (with bug)**

- Tool: `update_issues` batch of 2 — both succeeded
- Used `addLabelNames` (additive) not `labelNames` (replace) — correct for adding labels ✓
- Diffs:
  - `SQT-199,assignee,u6,u1` — Gonzalo → Ian ✓
  - `SQT-200,state,s6,s4` — Triage → In Progress ✓ (confirms default creation state is Triage)
  - `SQT-200,estimate,8,5` ✓

**Bug found:**

- **BUG-8: `changes[` diff doesn't track labels or dueDate** — SQT-199 had `addLabelNames: ["Bug"]` in the request but the label change doesn't appear in the diff. Only state, assignee, and estimate changes are tracked. Step 18 confirms: dueDate update also produces no `changes[` section. The diff mechanism is incomplete — it only tracks a subset of fields.

### Step 18 — Update with due date

**Result: PASS**

- Tool: `update_issues` with `dueDate: "2026-02-15"` — correct
- succeeded:1
- No `changes[` section in response — dueDate not tracked in diff (see BUG-8)

---

**Test issue reference (for remaining phases):**

| Identifier | Title | Created In |
|------------|-------|------------|
| SQT-197 | [TEST] Verify MCP integration | Step 13 |
| SQT-198 | [TEST] Frontend unit tests | Step 14 |
| SQT-199 | [TEST] Backend API docs | Step 14 |
| SQT-200 | [TEST] Security review checklist | Step 14 |
| SQT-201 | [TEST] Write test cases | Step 15 |

---

## Bugs & Action Items

| ID | Type | Summary | Priority | Status |
|----|------|---------|----------|--------|
| BUG-1 | Bug | Empty org name in `_meta` section | Low | To investigate |
| BUG-2 | Bug | User roles always blank in `_users` section | Medium | To investigate |
| ~~BUG-3~~ | ~~Bug~~ | ~~Missing issue field in comment row~~ | — | Cleared (copy-paste artifact) |
| ~~BUG-4~~ | ~~Bug~~ | ~~Phantom issue SQT-119 in `_gaps`~~ | — | Cleared (copy-paste artifact — SQT-119 rendered as SQT-11) |
| BUG-5 | Bug | Cycles out of chronological order in `list_cycles` TOON output (7→6→5→4→2→3→1) | Low | To fix |
| BUG-6 | Bug | `get_issues` missing priority, estimate, cycle, team fields (blank where other tools return data) | **High** | To fix |
| BUG-7 | Bug | `create_issues` cycle field is a TODO — accepted in schema but silently ignored (never resolved to cycleId) | Medium | To fix |
| BUG-8 | Bug | `changes[` diff only tracks state/assignee/estimate — missing labels, dueDate, priority, project | Medium | To fix |
| NOTE-1 | Improvement | Strip image markdown URLs from descriptions, replace with `[N images]` count | Medium | Decided — not yet implemented |
| NOTE-2 | Architecture | Tier 2 states incomplete for mutations — ensure `workspace_metadata` always called first | Medium | Validated by Step 13 (Claude did this naturally) |
| NOTE-3 | Enhancement | Add `createdAt` and `creator` fields to TOON issue schema | Medium | To implement |
| NOTE-4 | Enhancement | Add letter prefixes to numeric TOON fields for readability — requires both encoder + input resolver | Medium | Decided — to implement separately |
| NOTE-5 | Investigation | Unspecified assignee auto-assigned to u0 — must support creating unassigned issues | Medium | To investigate |
| NOTE-6 | Improvement | `created[` response should include actual state assigned by Linear (currently blank) | Medium | To fix |
| NOTE-7 | Improvement | `created[` response missing `url` field — add to schema | Medium | To fix |
| DECISION-1 | Architecture | Remove `list_teams` and `list_users` tools | Medium | Decided — not yet implemented |
| DECISION-2 | Architecture | Remove `list_my_issues` tool (`list_issues` + `assignedToMe: true` is equivalent) | Medium | To discuss |

---

## Phase 6: Comments (Steps 19–22)

### Step 19 — List comments on SQT-157

**Result: PASS (with bug)**

- Tool: `list_comments` with `issueId: "SQT-157"` — correct
- TOON format: `_meta{tool,issue,count,generated}:` + `comments[17]{issue,user,body,createdAt}:`
- 17 comments returned with bodies and timestamps

**Bug found:**

- **BUG-9: `list_comments` user field blank for all comments** — Every comment row has an empty `user` field (e.g. `SQT-157,,**Solution:**...`). Comment authors are known (u0/Tobias and u6/Gonzalo from Step 4's sprint context) but `list_comments` doesn't populate them. Comment authorship is critical context.

### Step 20 — Add a comment

**Result: PASS**

- Tool: `add_comments` with single item — correct
- succeeded:1, comment body and timestamp returned, index-stable

### Step 21 — Batch add comments

**Result: PASS**

- Tool: `add_comments` batch of 2 — correct
- succeeded:2, both comments created with timestamps, index-stable (0→SQT-198, 1→SQT-199)

### Step 22 — Update a comment

**Result: FAIL (blocked)**

- Claude correctly identified the workflow: `list_comments` → get comment ID → `update_comments`
- **BLOCKED:** `list_comments` schema is `{issue,user,body,createdAt}` — no `id` field
- `update_comments` requires a comment UUID as input
- Without comment IDs in the output, `update_comments` is unusable

**Bug found:**

- **BUG-10: `list_comments` missing comment `id` field — makes `update_comments` dead code** — The comments TOON schema doesn't include the comment UUID. Since `update_comments` requires a comment ID, there is no way to obtain the ID to pass to it. Must add `id` field to comments schema. This is a **high priority** fix since it makes an entire tool non-functional.

---

## Bugs & Action Items

| ID | Type | Summary | Priority | Status |
|----|------|---------|----------|--------|
| BUG-1 | Bug | Empty org name in `_meta` section | Low | To investigate |
| BUG-2 | Bug | User roles always blank in `_users` section | Medium | To investigate |
| ~~BUG-3~~ | ~~Bug~~ | ~~Missing issue field in comment row~~ | — | Cleared (copy-paste artifact) |
| ~~BUG-4~~ | ~~Bug~~ | ~~Phantom issue SQT-119 in `_gaps`~~ | — | Cleared (copy-paste artifact — SQT-119 rendered as SQT-11) |
| BUG-5 | Bug | Cycles out of chronological order in `list_cycles` TOON output (7→6→5→4→2→3→1) | Low | To fix |
| BUG-6 | Bug | `get_issues` missing priority, estimate, cycle, team fields (blank where other tools return data) | **High** | To fix |
| BUG-7 | Bug | `create_issues` cycle field is a TODO — accepted in schema but silently ignored (never resolved to cycleId) | Medium | To fix |
| BUG-8 | Bug | `changes[` diff only tracks state/assignee/estimate — missing labels, dueDate, priority, project | Medium | To fix |
| BUG-9 | Bug | `list_comments` user field blank for all comments (authors not populated) | **High** | To fix |
| BUG-10 | Bug | `list_comments` missing comment `id` field — makes `update_comments` unusable | **High** | To fix |
| NOTE-1 | Improvement | Strip image markdown URLs from descriptions, replace with `[N images]` count | Medium | Decided — not yet implemented |
| NOTE-2 | Architecture | Tier 2 states incomplete for mutations — ensure `workspace_metadata` always called first | Medium | Validated by Step 13 (Claude did this naturally) |
| NOTE-3 | Enhancement | Add `createdAt` and `creator` fields to TOON issue schema | Medium | To implement |
| NOTE-4 | Enhancement | Add letter prefixes to numeric TOON fields for readability — requires both encoder + input resolver | Medium | Decided — to implement separately |
| NOTE-5 | Investigation | Unspecified assignee auto-assigned to u0 — must support creating unassigned issues | Medium | To investigate |
| NOTE-6 | Improvement | `created[` response should include actual state assigned by Linear (currently blank) | Medium | To fix |
| NOTE-7 | Improvement | `created[` response missing `url` field — add to schema | Medium | To fix |
| DECISION-1 | Architecture | Remove `list_teams` and `list_users` tools | Medium | Decided — not yet implemented |
| DECISION-2 | Architecture | Remove `list_my_issues` tool (`list_issues` + `assignedToMe: true` is equivalent) | Medium | To discuss |

---

## Phase 7: Projects (Steps 23–25)

### Step 23 — List projects

**Result: PASS (with bug)**

- Tool: `list_projects` with no params — correct
- TOON format: `_meta{` + `projects[3]{key,name,description,state,priority,progress,lead,teams,startDate,targetDate,health}:` — rich schema
- 3 projects returned with progress percentages, health, leads, dates

**Bug found:**

- **BUG-11: `list_projects` user lookup table has blank fields** — `_users[2]` shows `u1,,,,` and `u2,,,,` — only the short key is populated, all name/displayName/email/role fields are empty. Other Tier 2 tools populate user details correctly. The `list_projects` user resolution is not fetching user metadata.

### Step 24 — Create a test project

**Result: FAIL (tool bug)**

- Claude attempted 3 times:
  1. No `teamId` → "teamIds must contain at least 1 elements"
  2. `teamId: "SQT"` → "each value in teamIds must be a UUID"
  3. Spiraled through 4 more tool calls trying to find the raw UUID — none available (TOON hides UUIDs by design)
- Claude correctly diagnosed the root cause

**Bug found:**

- **BUG-12: `create_projects` doesn't resolve team keys/short keys to UUIDs** — `create_issues` accepts `teamId: "SQT"` and resolves internally, but `create_projects` requires a raw UUID and has no resolution. This is a fundamental incompatibility with the TOON system — TOON intentionally hides UUIDs behind short keys. Any tool that requires raw UUIDs without doing resolution is broken when TOON is enabled. **High priority** — project creation is impossible.

### Step 25 — Update the test project

**Result: SKIPPED** — Blocked by Step 24 failure. `update_projects` likely has the same UUID resolution gap.

---

## Bugs & Action Items

| ID | Type | Summary | Priority | Status |
|----|------|---------|----------|--------|
| BUG-1 | Bug | Empty org name in `_meta` section | Low | To investigate |
| BUG-2 | Bug | User roles always blank in `_users` section | Medium | To investigate |
| ~~BUG-3~~ | ~~Bug~~ | ~~Missing issue field in comment row~~ | — | Cleared (copy-paste artifact) |
| ~~BUG-4~~ | ~~Bug~~ | ~~Phantom issue SQT-119 in `_gaps`~~ | — | Cleared (copy-paste artifact — SQT-119 rendered as SQT-11) |
| BUG-5 | Bug | Cycles out of chronological order in `list_cycles` TOON output (7→6→5→4→2→3→1) | Low | To fix |
| BUG-6 | Bug | `get_issues` missing priority, estimate, cycle, team fields (blank where other tools return data) | **High** | To fix |
| BUG-7 | Bug | `create_issues` cycle field is a TODO — accepted in schema but silently ignored (never resolved to cycleId) | Medium | To fix |
| BUG-8 | Bug | `changes[` diff only tracks state/assignee/estimate — missing labels, dueDate, priority, project | Medium | To fix |
| BUG-9 | Bug | `list_comments` user field blank for all comments (authors not populated) | **High** | To fix |
| BUG-10 | Bug | `list_comments` missing comment `id` field — makes `update_comments` unusable | **High** | To fix |
| BUG-11 | Bug | `list_projects` user lookup table has blank fields (only short key populated, no name/email) | Medium | To fix |
| BUG-12 | Bug | `create_projects` doesn't resolve team keys/short keys to UUIDs — project creation impossible with TOON | **High** | To fix |
| NOTE-1 | Improvement | Strip image markdown URLs from descriptions, replace with `[N images]` count | Medium | Decided — not yet implemented |
| NOTE-2 | Architecture | Tier 2 states incomplete for mutations — ensure `workspace_metadata` always called first | Medium | Validated by Step 13 (Claude did this naturally) |
| NOTE-3 | Enhancement | Add `createdAt` and `creator` fields to TOON issue schema | Medium | To implement |
| NOTE-4 | Enhancement | Add letter prefixes to numeric TOON fields for readability — requires both encoder + input resolver | Medium | Decided — to implement separately |
| NOTE-5 | Investigation | Unspecified assignee auto-assigned to u0 — must support creating unassigned issues | Medium | To investigate |
| NOTE-6 | Improvement | `created[` response should include actual state assigned by Linear (currently blank) | Medium | To fix |
| NOTE-7 | Improvement | `created[` response missing `url` field — add to schema | Medium | To fix |
| DECISION-1 | Architecture | Remove `list_teams` and `list_users` tools | Medium | Decided — not yet implemented |
| DECISION-2 | Architecture | Remove `list_my_issues` tool (`list_issues` + `assignedToMe: true` is equivalent) | Medium | To discuss |

---

## Phase 8: Visual Dashboard (Step 26)

### Step 26 — Show UI dashboard

**Result: PARTIAL PASS**

- Tool: `show_issues_ui` with `stateType: "started"`, `assignedToMe: true` — correct inputs
- Response: "Opening Linear Issues Dashboard (filtered by state: started, assigned to you)" — correct
- **UI did not render** — no interactive dashboard appeared in Claude Desktop
- Claude gracefully fell back to `list_issues` with the same filters — returned 6 correct issues
- Fallback data confirms Phase 4/5 mutations are reflected (SQT-200 now In Progress/Urgent/e5, SQT-197 In Progress with dueDate)

**Not a server bug** — the `show_issues_ui` tool returns filter data as designed. The interactive UI depends on the MCP client supporting the rendering capability. Claude Desktop may not support this. Low priority — the tool is functional, just not visually rendered.

---

## Phase 9: Multi-Step Workflows (Steps 27–30)

### Step 27 — Sprint standup workflow

**Result: PASS**

- Tool: `get_sprint_context` with `team: "SQT"`, `cycle: "current"`, `includeComments: true`, `includeRelations: true`
- 50 issues, 26 comments, 2 relations, 4 gap types
- Data reflects mutations from earlier phases (test comments visible, gap counts updated)
- Claude produced a good standup synthesis with status, blockers, and recommendations
- Response truncated — unable to verify if [TEST] tracking issue was created (test expected `get_sprint_context` → analysis → `create_issues`)

### Step 28 — Issue investigation workflow

**Result: PASS**

- Tool: Single `list_issues` call with `q: "login cognito auth"`, `matchMode: "any"`, `detail: "full"`, `includeComments: true`
- 8 auth-related issues found — full hierarchy visible (SQT-68 parent + 3 children + 4 related issues)
- 8 comments included inline — architecture discussion and open questions
- Claude produced an excellent summary: issue hierarchy, status matrix, key context from comments, identified open question (mobile login)
- Test expected 3 chained tools (`list_issues` → `get_issues` → `list_comments`) but Claude achieved the same result in **one call** — validates that `list_issues` is flexible enough for investigation workflows

### Steps 29 & 30 — Skipped

- **Step 29** (project planning workflow): Blocked by BUG-12 (`create_projects` can't resolve team keys)
- **Step 30** (triage and update workflow): Skipped

---

## Final Summary

### Test Coverage

| Phase | Steps | Status | Tools Exercised |
|-------|-------|--------|----------------|
| 1. Bootstrap & Discovery | 1–3 | **3/3 PASS** | workspace_metadata, (list_teams, list_users covered by workspace_metadata) |
| 2. Sprint & Cycles | 4–6 | **3/3 PASS** | get_sprint_context ×2, list_cycles |
| 3. Issue Querying | 7–12 | **6/6 PASS** | list_issues ×5, get_issues |
| 4. Issue Creation | 13–15 | **3/3 PASS** | create_issues ×3 (single, batch, sub-issue) |
| 5. Issue Updates | 16–18 | **3/3 PASS** | update_issues ×3 (state, batch, dueDate) |
| 6. Comments | 19–22 | **3/4 (1 FAIL)** | list_comments, add_comments ×2, update_comments (BLOCKED) |
| 7. Projects | 23–25 | **1/3 (1 FAIL, 1 SKIP)** | list_projects, create_projects (FAIL), update_projects (SKIP) |
| 8. Visual Dashboard | 26 | **1/1 PARTIAL** | show_issues_ui (tool works, UI doesn't render) |
| 9. Multi-Step Workflows | 27–30 | **2/4 (2 SKIP)** | get_sprint_context, list_issues |

**Overall: 25/30 steps completed, 23 PASS, 2 FAIL, 5 SKIPPED/PARTIAL**

### Tool Coverage

| # | Tool | Tested | Result |
|---|------|--------|--------|
| 1 | workspace_metadata | Steps 1, 13, 24 | ✅ Works |
| 2 | list_issues | Steps 7, 8, 9, 11, 12, 28 | ✅ Works |
| 3 | get_issues | Steps 10, 15 | ⚠️ Works but BUG-6 (missing fields) |
| 4 | list_my_issues | Not called | ⏭️ Redundant (Claude uses list_issues + assignedToMe) |
| 5 | create_issues | Steps 13, 14, 15 | ✅ Works |
| 6 | update_issues | Steps 16, 17, 18 | ⚠️ Works but BUG-8 (incomplete diffs) |
| 7 | list_projects | Step 23 | ⚠️ Works but BUG-11 (blank user fields) |
| 8 | create_projects | Step 24 | ❌ Broken (BUG-12: no team key resolution) |
| 9 | update_projects | Not tested | ❓ Likely broken (same resolution issue) |
| 10 | list_teams | Not called | ⏭️ Redundant (covered by workspace_metadata) |
| 11 | list_users | Not called | ⏭️ Redundant (covered by workspace_metadata) |
| 12 | list_comments | Steps 19, 22 | ⚠️ Works but BUG-9 (blank authors), BUG-10 (no comment ID) |
| 13 | add_comments | Steps 20, 21 | ✅ Works |
| 14 | update_comments | Step 22 | ❌ Unusable (blocked by BUG-10) |
| 15 | list_cycles | Steps 1, 6 | ⚠️ Works but BUG-5 (ordering) |
| 16 | get_sprint_context | Steps 4, 5, 27 | ✅ Works |
| 17 | show_issues_ui | Step 26 | ⚠️ Tool works, UI doesn't render in Claude Desktop |

### Priority Bugs (must fix)

| ID | Bug | Severity |
|----|-----|----------|
| BUG-6 | `get_issues` missing priority, estimate, cycle, team fields | **High** |
| BUG-9 | `list_comments` user/author field blank | **High** |
| BUG-10 | `list_comments` missing comment `id` → `update_comments` unusable | **High** |
| BUG-12 | `create_projects` no team key/short key resolution → project creation impossible | **High** |

### Architecture Decisions

| Decision | Description |
|----------|-------------|
| DECISION-1 | Remove `list_teams` and `list_users` (redundant with workspace_metadata) |
| DECISION-2 | Remove `list_my_issues` (redundant with `list_issues` + `assignedToMe`) |
| NOTE-4 | Add letter prefixes to numeric fields (p1, e5, c5) for readability |

These decisions would reduce the tool count from **17 → 14**.
