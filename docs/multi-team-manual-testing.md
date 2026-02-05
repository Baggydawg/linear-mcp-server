# Multi-Team Short Keys - Manual Testing Script

## Background

### What We Implemented

The Linear MCP Server previously supported a `DEFAULT_TEAM` environment variable that scoped all queries to a single team. However, the **short key registry** (which maps readable keys like `s0`, `u1` to UUIDs) only contained entities from that one team.

**Problem:** Claude couldn't work with issues across multiple teams in the same session. If you queried issues from a non-default team, the state short keys wouldn't resolve because they weren't in the registry.

### The Solution: Multi-Team Short Keys

We implemented a system where:

1. **Registry contains ALL teams' data** - When `workspace_metadata` is called, the registry is populated with states, labels, and other entities from every team in the workspace (not just DEFAULT_TEAM).

2. **Team-prefixed short keys** - Non-default team entities get prefixed keys:
   - Default team (e.g., SQT): `s0`, `s1`, `s2` (clean keys)
   - Other teams (e.g., SQM): `sqm:s0`, `sqm:s1` (prefixed keys)
   - Users and projects remain global: `u0`, `pr0` (no prefix)

3. **Flexible input resolution** - For convenience, the default team's prefix is accepted:
   - `s0` and `sqt:s0` both resolve to the same state when DEFAULT_TEAM=SQT

4. **Cross-team validation** - Write tools validate that states/labels belong to the correct team, with helpful error messages:
   - "State 's0' belongs to team SQT, but the issue is in team SQM. Use workspace_metadata to see available states for team SQM."

### Key Files Changed

| File | Changes |
|------|---------|
| `src/shared/toon/registry.ts` | Added `teamKeys`, `defaultTeamId`, team prefix helpers, multi-team registry building |
| `src/shared/tools/linear/workspace-metadata.ts` | Fetches ALL teams/users/states for registry |
| `src/shared/tools/linear/shared/validation.ts` | Cross-team validation functions |
| `src/shared/tools/linear/create-issues.ts` | Uses cross-team validation |
| `src/shared/tools/linear/update-issues.ts` | Uses cross-team validation |
| `src/shared/tools/linear/list-issues.ts` | Includes team info in registry data |
| `src/shared/tools/linear/get-issues.ts` | Includes team info in registry data |
| `src/shared/tools/linear/get-sprint-context.ts` | Includes team info in registry data |

### Test Coverage Added

We added **67 new automated tests** covering:
- Cross-team validation functions (47 tests)
- Prefixed short keys end-to-end (8 tests)
- Encoder utility functions (22 tests)

**Total test count: 701 tests**

---

## Objectives of Manual Testing

The automated tests use mocked data. Manual testing verifies the implementation works with **real Linear API data** in your actual workspace.

### What We're Validating

1. **Regression** - Existing functionality still works (default team operations, short key resolution)
2. **Multi-team queries** - Can list/get issues from non-default teams with correct prefixed keys
3. **Cross-team writes** - Can create/update issues in non-default teams using prefixed keys
4. **Flexible input** - Default team prefix (`sqt:s0`) resolves same as clean key (`s0`)
5. **Validation** - Cross-team state/label application is blocked with helpful errors
6. **TOON output** - Prefixed keys appear correctly in tool outputs

---

## Prerequisites

- `DEFAULT_TEAM` environment variable set (e.g., `DEFAULT_TEAM=SQT`)
- At least 2 teams in your Linear workspace
- Note your team keys (visible in Linear URL or via `workspace_metadata`)

**Notation used below:**
- `[DEFAULT_TEAM]` = Your default team key (e.g., `SQT`)
- `[OTHER_TEAM]` = Another team's key (e.g., `SQM`, `ENG`)
- `[other]` = Lowercase version for prefixes (e.g., `sqm`)

---

## Manual Test Script

### Phase 1: Registry Population (Tier 1)

**Test 1.1: Workspace metadata includes all teams**
```
Call workspace_metadata with no parameters
```
**Verify:**
- [ ] `_teams[` section shows ALL teams (not just DEFAULT_TEAM)
- [ ] `_states[` section shows states with clean keys: `s0`, `s1`, `s2`...
- [ ] Users have global keys: `u0`, `u1`...
- [ ] Note: How many states does your default team have?

**Test 1.2: Confirm registry has multi-team data internally**
```
After 1.1, call list_issues with team: "[OTHER_TEAM]"
```
**Verify:**
- [ ] Query succeeds (registry has other team's data)
- [ ] `_states[` section in output shows PREFIXED keys: `[other]:s0`, `[other]:s1`...
- [ ] Issues from other team show prefixed state keys in their data

---

### Phase 2: Default Team Operations (Regression)

**Test 2.1: List issues from default team**
```
Call list_issues with no team parameter (should use DEFAULT_TEAM)
```
**Verify:**
- [ ] Returns issues from your DEFAULT_TEAM
- [ ] States show clean keys: `s0`, `s1`...
- [ ] Assignees show global keys: `u0`, `u1`...

**Test 2.2: Create issue with clean short keys**
```
Call create_issues with:
- teamId: "[DEFAULT_TEAM]"
- title: "Test issue for multi-team validation"
- state: "s0" (or appropriate clean state key from Test 1.1)
- assignee: "u0" (or appropriate user key)
```
**Verify:**
- [ ] Issue created successfully
- [ ] State resolved correctly (check the created issue's state name)
- [ ] Assignee resolved correctly
- [ ] Note the issue identifier (e.g., `SQT-XXX`) for later tests

**Test 2.3: Update issue with clean short keys**
```
Call update_issues with:
- id: "[issue identifier from 2.2]"
- state: "s1" (different state key)
```
**Verify:**
- [ ] Update succeeded
- [ ] State changed to the expected state

---

### Phase 3: Cross-Team Operations (New Functionality)

**Test 3.1: List issues from non-default team**
```
Call list_issues with team: "[OTHER_TEAM]"
```
**Verify:**
- [ ] Returns issues from the other team
- [ ] `_states[` lookup shows PREFIXED keys: `[other]:s0`, `[other]:s1`...
- [ ] Issue state fields in the issues section show prefixed keys

**Test 3.2: Create issue in non-default team with prefixed keys**
```
Call create_issues with:
- teamId: "[OTHER_TEAM]"
- title: "Test issue in non-default team"
- state: "[other]:s0" (prefixed state key from Test 3.1)
```
**Verify:**
- [ ] Issue created successfully in the other team
- [ ] State resolved correctly using prefixed key
- [ ] Note the issue identifier for later tests

**Test 3.3: Update issue in non-default team with prefixed keys**
```
Call update_issues with:
- id: "[issue identifier from 3.2]"
- state: "[other]:s1" (different prefixed state)
```
**Verify:**
- [ ] Update succeeded
- [ ] State changed correctly

---

### Phase 4: Flexible Input Resolution (New Functionality)

**Test 4.1: Default team prefix accepted (flexible input)**
```
Call update_issues with:
- id: "[DEFAULT_TEAM issue from Phase 2]"
- state: "[default]:s0" (explicit prefix for default team, e.g., "sqt:s0")
```
**Verify:**
- [ ] Update succeeded (`sqt:s0` resolved same as `s0`)
- [ ] No error about invalid key

**Test 4.2: Case-insensitive prefix**
```
Call update_issues with:
- id: "[DEFAULT_TEAM issue]"
- state: "[DEFAULT_TEAM]:s1" (UPPERCASE prefix, e.g., "SQT:s1")
```
**Verify:**
- [ ] Update succeeded
- [ ] Case-insensitive matching worked

---

### Phase 5: Cross-Team Validation (New Functionality)

**Test 5.1: Reject wrong team's state on update**
```
Call update_issues with:
- id: "[DEFAULT_TEAM issue identifier]"
- state: "[other]:s0" (trying to apply other team's state to default team issue)
```
**Verify:**
- [ ] Operation FAILS with error
- [ ] Error message mentions team mismatch
- [ ] Error includes helpful suggestion

**Test 5.2: Reject clean key on non-default team issue**
```
Call update_issues with:
- id: "[OTHER_TEAM issue identifier from 3.2]"
- state: "s0" (clean key - belongs to default team)
```
**Verify:**
- [ ] Operation FAILS with error
- [ ] Error mentions state belongs to default team
- [ ] Suggestion to use prefixed key or check workspace_metadata

---

### Phase 6: Labels (If Applicable)

**Test 6.1: Workspace labels work on any team**
```
If you have workspace-level labels (not team-specific):
Call update_issues with:
- id: "[any issue]"
- labelNames: ["[workspace-label-name]"]
```
**Verify:**
- [ ] Label applied successfully
- [ ] Workspace labels work regardless of issue's team

**Test 6.2: Team-specific labels with prefix** (Skip if no team labels)
```
If you have team-specific labels:
Call update_issues with:
- id: "[OTHER_TEAM issue]"
- labelNames: ["[other]:LabelName"]
```
**Verify:**
- [ ] Label applied if it exists for that team
- [ ] Or appropriate error if label doesn't exist

---

### Phase 7: Sprint Context (Regression + Multi-Team)

**Test 7.1: Sprint context for default team**
```
Call get_sprint_context with no team parameter
```
**Verify:**
- [ ] Returns current sprint for DEFAULT_TEAM
- [ ] States show clean keys in issues
- [ ] Gap analysis works (`_gaps[` section present)

**Test 7.2: Sprint context for non-default team** (Skip if other team has no cycles)
```
Call get_sprint_context with team: "[OTHER_TEAM]"
```
**Verify:**
- [ ] Returns sprint for other team
- [ ] States show PREFIXED keys
- [ ] Or appropriate error if team has no active cycles

---

### Phase 8: Force Refresh

**Test 8.1: Registry refresh**
```
Call workspace_metadata with forceRefresh: true
```
**Verify:**
- [ ] Fresh data returned
- [ ] No errors
- [ ] Subsequent tool calls still work with short keys

---

## Cleanup

After testing, you may want to:
1. Delete the test issues created in Phase 2 and 3
2. Or move them to a "Done" state

---

## Output Template

Please paste your results using this format:

```markdown
# Multi-Team Manual Test Results

Date: YYYY-MM-DD
DEFAULT_TEAM: [your default team key]
OTHER_TEAM: [second team key you used]
Linear Workspace: [workspace name]

## Phase 1: Registry Population

### Test 1.1 - Workspace metadata
**Input:** workspace_metadata({})
**Output:**
\`\`\`
[paste TOON output here]
\`\`\`

**Checklist:**
- [ ] All teams visible in _teams section
- [ ] Clean state keys (s0, s1...)
- [ ] Global user keys (u0, u1...)

### Test 1.2 - Cross-team query
**Input:** list_issues({ team: "[OTHER_TEAM]" })
**Output:**
\`\`\`
[paste TOON output here]
\`\`\`

**Checklist:**
- [ ] Query succeeded
- [ ] Prefixed state keys visible ([other]:s0...)

## Phase 2: Default Team Operations
...

[Continue for each test]
```

---

## Expected Outcomes

If everything works correctly:

| Test | Expected Result |
|------|-----------------|
| 1.1 | All teams in `_teams[`, clean state keys |
| 1.2 | Prefixed state keys for other team |
| 2.1-2.3 | Default team CRUD works with clean keys |
| 3.1-3.3 | Other team CRUD works with prefixed keys |
| 4.1-4.2 | Flexible input and case-insensitive prefixes work |
| 5.1-5.2 | Cross-team validation blocks invalid operations |
| 6.1-6.2 | Labels work correctly per team scope |
| 7.1-7.2 | Sprint context works for both teams |
| 8.1 | Force refresh works |

If any test fails, note the exact error message - this will help diagnose whether it's a bug or expected behavior.
