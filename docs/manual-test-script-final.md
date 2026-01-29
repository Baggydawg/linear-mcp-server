# MCP Manual Test Script — Final Comprehensive Edition

The definitive test document consolidating all findings from v1, v2, v3, and subsequent bug fixes. This script provides complete coverage of all 13 tools with verification for all known bugs and enhancements.

---

## Document Information

| Field | Value |
|-------|-------|
| Version | Final (consolidated from v1, v2, v3) |
| Last Updated | 2026-01-29 |
| Total Tools | 13 (reduced from original 17) |
| Total Tests | 48 (5 smoke + 30 tool coverage + 12 bug verification + 1 workflow) |
| Test Data Prefix | `[TEST-FINAL]` |

---

## Prerequisites

Before running these tests:

1. **Environment Configuration**
   ```bash
   TOON_OUTPUT_ENABLED=true
   ```

2. **Server Running**
   - Server built and running via Claude Desktop
   - Linear MCP server connected and responding

3. **Linear Workspace**
   - Team "SQT" exists with cycles enabled
   - At least one active cycle
   - Test users available (Tobias, Ian, etc.)

4. **Test Data Convention**
   - All test data uses `[TEST-FINAL]` prefix in titles
   - Easy to filter and clean up in Linear's UI
   - Never use production issue/project names

---

## Registry Reference

These short keys are assigned in the test workspace. Your keys may differ — update as needed after running `workspace_metadata`.

| Entity | Key | Value |
|--------|-----|-------|
| **Users** | u0 | Tobias Nilsson |
| | u1 | Ian Bastos |
| | u2 | Luis M. de Carvajal |
| | u3 | Ismael Osuna |
| | u4 | Guerson Meyer |
| | u5 | Juan Pablo Carbonell |
| | u6 | Gonzalo Verdugo |
| **States** | s0 | Todo (unstarted) |
| | s1 | Done (completed) |
| | s2 | Canceled (canceled) |
| | s3 | Backlog (backlog) |
| | s4 | In Progress (started) |
| | s5 | In Review (started) |
| | s6 | Triage (triage) |
| **Projects** | pr0 | MVP Sophiq Platform |
| | pr1 | Data Intelligence |
| | pr2 | Valuation |

---

## Part 1: Quick Smoke Tests (5 tests)

Fast verification that all critical fixes work. Run these first before the full test suite.

### SMOKE-1: Registry Bootstrap

**Purpose:** Verify workspace metadata loads correctly with all sections populated.

**Prompt:**
> Give me a workspace overview

**Expected tool:** `workspace_metadata`

**Verify:**
- [ ] TOON format with `_meta{`, `_users[`, `_states[`, `_projects[`, `_teams[`, `_cycles[`
- [ ] Organization name in `_meta{org,...}` is NOT blank (BUG-1 fix)
- [ ] User roles show "Admin" or "Member" (BUG-2 fix)
- [ ] Short keys assigned to all entities

---

### SMOKE-2: Comment User Field

**Purpose:** Verify comments show author information (BUG-9 fix).

**Prompt:**
> Show me comments on SQT-157

**Expected tool:** `list_comments`

**Verify:**
- [ ] Comment `user` field shows short keys (u0, u1, etc.) — NOT blank
- [ ] Comment `id` field present (BUG-10 fix)
- [ ] `_users[` lookup section present with author details

---

### SMOKE-3: Project Creation

**Purpose:** Verify projects can be created with team key resolution (BUG-12 fix).

**Prompt:**
> Create a project called "[TEST-FINAL] Smoke Test Project" for team SQT

**Expected tool:** `create_projects`

**Verify:**
- [ ] Project created successfully (NOT failing with UUID error)
- [ ] `created[` section shows project with short key (NOT blank)

---

### SMOKE-4: Issue Update Diff Tracking

**Purpose:** Verify update diffs track all field changes (BUG-8 fix).

**Prompt (run in sequence):**
> Create an issue "[TEST-FINAL] Diff Test" in team SQT

Then:
> Add the "Bug" label to [TEST-FINAL] Diff Test and move it to "In Progress"

**Expected tools:** `create_issues`, then `update_issues`

**Verify:**
- [ ] `changes[` shows `state` change (s6 -> s4)
- [ ] `changes[` shows `labels+` change (adding Bug label)

---

### SMOKE-5: Issue Details

**Purpose:** Verify get_issues returns all fields (BUG-6 fix).

**Prompt:**
> Get full details on the [TEST-FINAL] Diff Test issue

**Expected tool:** `get_issues`

**Verify:**
- [ ] Priority field populated (e.g., `p3`)
- [ ] Estimate field populated if set (e.g., `e5`)
- [ ] Team field shows `SQT`
- [ ] Cycle field populated if assigned (e.g., `c5`)

---

## Part 2: Complete Tool Coverage (13 sections)

Comprehensive testing of every tool with expected behaviors and verification points.

---

### Tool 1: workspace_metadata

**Description:** Tier 1 tool that returns ALL entities (users, states, projects, labels, cycles). Call once per session.

#### Test 1.1 — Full workspace overview

**Prompt:**
> Give me a complete overview of our Linear workspace — all teams, users, projects, workflow states, labels, and cycles

**Expected tool:** `workspace_metadata`

**Verify:**
- [ ] `_meta{org,team,generated}` — org name populated
- [ ] `_teams[N]{key,name,cyclesEnabled,cycleDuration,estimationType}`
- [ ] `_users[N]{key,name,displayName,email,role}` — role column populated
- [ ] `_states[N]{key,name,type}` — all workflow states
- [ ] `_labels[N]{name,color}` — workspace labels
- [ ] `_projects[N]{key,name,state}` — all projects with short keys
- [ ] `_cycles[N]{num,name,start,end,active,progress}` — team cycles

#### Test 1.2 — Force refresh

**Prompt:**
> Refresh the workspace metadata

**Expected tool:** `workspace_metadata` with `forceRefresh: true`

**Verify:**
- [ ] Registry refreshed (new timestamp in `generated` field)
- [ ] Any newly created projects/users now have short keys

---

### Tool 2: list_issues

**Description:** Search and filter issues with keywords, states, assignees, projects, cycles. Tier 2 output.

#### Test 2.1 — Filter by state type

**Prompt:**
> Show me all in-progress issues for team SQT

**Expected tool:** `list_issues` with `filter: { state: { type: { eq: "started" } } }`

**Verify:**
- [ ] Only issues in "In Progress" or "In Review" states
- [ ] `issues[N]` with full field set
- [ ] `_states[` shows only referenced states (Tier 2)
- [ ] `_users[` shows only referenced users (Tier 2)

#### Test 2.2 — Keyword search

**Prompt:**
> Search for issues containing "authentication" in team SQT

**Expected tool:** `list_issues` with `q: "authentication"`

**Verify:**
- [ ] Issues with "authentication" in title/description returned
- [ ] Results are relevant

#### Test 2.3 — Assigned to me

**Prompt:**
> What issues are assigned to me?

**Expected tool:** `list_issues` with `assignedToMe: true`

**Verify:**
- [ ] Only issues assigned to current user
- [ ] Uses `list_issues` (NOT removed `list_my_issues` tool)

#### Test 2.4 — Priority filter

**Prompt:**
> Show me urgent and high priority issues that haven't been started

**Expected tool:** `list_issues` with priority + state type filters

**Verify:**
- [ ] Returns issues with priority 1-2 in unstarted/backlog states
- [ ] Priority shown as `p1`, `p2` (prefixed format)

#### Test 2.5 — Unassigned issues filter

**Prompt:**
> Are there any unassigned issues in the current sprint for team SQT?

**Expected tool:** `list_issues` with assignee filter OR `get_sprint_context` with gap analysis

**Verify:**
- [ ] Query identifies unassigned issues (or confirms none exist)
- [ ] If using `list_issues`: filter includes `assignee: { null: true }` or similar
- [ ] If using `get_sprint_context`: `_gaps[` section shows `no_assignee` count
- [ ] Results accurately reflect sprint state

---

### Tool 3: get_issues

**Description:** Fetch detailed information on specific issues by identifier. Returns full descriptions.

#### Test 3.1 — Get multiple issues

**Prompt:**
> Give me full details on SQT-174 and SQT-155

**Expected tool:** `get_issues` with `ids: ["SQT-174", "SQT-155"]`

**Verify:**
- [ ] Both issues returned with full descriptions (not truncated)
- [ ] **BUG-6 FIXED:** Priority field populated (e.g., `p1`, `p2`)
- [ ] **BUG-6 FIXED:** Estimate field populated (e.g., `e5`)
- [ ] **BUG-6 FIXED:** Cycle field populated (e.g., `c5`)
- [ ] **BUG-6 FIXED:** Team field shows `SQT`
- [ ] URL field present

---

### Tool 4: create_issues

**Description:** Create new issues. Supports batch creation (up to 50). Index-stable results.

#### Test 4.1 — Single issue with all fields

**Prompt:**
> Create an issue in team SQT titled "[TEST-FINAL] Complete Issue Test" with:
> - High priority
> - Estimate 5
> - Assigned to me
> - In Todo state
> - Add label "Improvement"
> - In cycle 5

**Expected tool:** `create_issues`

**Verify:**
- [ ] Issue created successfully
- [ ] `results[0]{index,status,identifier}` shows `ok` status
- [ ] `created[1]` shows all fields:
  - [ ] `state` — NOT blank (NOTE-6 fix)
  - [ ] `url` — present (NOTE-7 fix)
  - [ ] `assignee` — shows short key
- [ ] **BUG-7 FIXED:** Cycle field accepted and applied

**Record identifier:** `_____________` (use in later tests)

#### Test 4.2 — Batch create

**Prompt:**
> Create 3 issues in team SQT:
> 1. "[TEST-FINAL] Batch Item 1" — Low priority, estimate 2, assign to Ian
> 2. "[TEST-FINAL] Batch Item 2" — Medium priority, estimate 3, assign to me
> 3. "[TEST-FINAL] Batch Item 3" — Urgent priority, estimate 8, in project "MVP Sophiq Platform"

**Expected tool:** `create_issues` (batch of 3)

**Verify:**
- [ ] `succeeded: 3, failed: 0`
- [ ] Index-stable: `results[0]` -> first issue, etc.
- [ ] Short keys resolved: `u1` (Ian), `u0` (me), `pr0` (project)
- [ ] Priority strings accepted: "Low", "Medium", "Urgent"

**Record identifiers:** `_____________, _____________, _____________`

#### Test 4.3 — Sub-issue

**Prompt:**
> Create a sub-issue under [identifier from 4.1] titled "[TEST-FINAL] Sub-task" with estimate 2

**Expected tool:** `create_issues` with `parentId`

**Verify:**
- [ ] Sub-issue created with parent relationship
- [ ] Parent identifier shown in response

---

### Tool 5: update_issues

**Description:** Update issues — state, assignee, labels, priority, project, etc. Supports batch updates.

#### Test 5.1 — State change via name

**Prompt:**
> Move [TEST-FINAL] Complete Issue Test to "In Progress"

**Expected tool:** `update_issues` with `stateName: "In Progress"`

**Verify:**
- [ ] `succeeded: 1`
- [ ] **BUG-8 FIXED:** `changes[` shows `state,s0,s4` (or similar)

#### Test 5.2 — Assignee change

**Prompt:**
> Assign [TEST-FINAL] Batch Item 1 to Gonzalo

**Expected tool:** `update_issues` with assignee

**Verify:**
- [ ] `succeeded: 1`
- [ ] **BUG-8 FIXED:** `changes[` shows `assignee,u1,u6` (or similar)

#### Test 5.3 — Label addition

**Prompt:**
> Add the "Bug" label to [TEST-FINAL] Batch Item 2

**Expected tool:** `update_issues` with `addLabelNames: ["Bug"]`

**Verify:**
- [ ] `succeeded: 1`
- [ ] **BUG-8 FIXED:** `changes[` shows `labels+,,Bug`

#### Test 5.4 — Due date

**Prompt:**
> Set a due date of 2026-03-15 on [TEST-FINAL] Complete Issue Test

**Expected tool:** `update_issues` with `dueDate`

**Verify:**
- [ ] `succeeded: 1`
- [ ] **BUG-8 FIXED:** `changes[` shows `dueDate,,2026-03-15`

#### Test 5.5 — Batch update

**Prompt:**
> Update these issues:
> - [TEST-FINAL] Batch Item 1: move to "In Review", change estimate to 5
> - [TEST-FINAL] Batch Item 2: change priority to High

**Expected tool:** `update_issues` (batch of 2)

**Verify:**
- [ ] Both updates succeeded
- [ ] `changes[` shows all field changes with before/after values

---

### Tool 6: list_projects

**Description:** List all projects with details. Returns project leads in `_users` lookup.

#### Test 6.1 — List all projects

**Prompt:**
> What projects do we have?

**Expected tool:** `list_projects`

**Verify:**
- [ ] `projects[N]{key,name,description,state,priority,progress,lead,...}`
- [ ] **BUG-11 FIXED:** `_users[` shows full user details (name, email) — NOT blank
- [ ] Short keys assigned (pr0, pr1...)
- [ ] Project states shown (planned, started, backlog, etc.)

---

### Tool 7: create_projects

**Description:** Create new projects. Requires team association.

#### Test 7.1 — Create project with team key

**Prompt:**
> Create a project called "[TEST-FINAL] New Project Test" for team SQT with target date 2026-06-30

**Expected tool:** `create_projects`

**Verify:**
- [ ] **BUG-12 FIXED:** Project created successfully (team key "SQT" resolved)
- [ ] `created[1]{key,name,state}` shows project
- [ ] Short key assigned immediately (NOT blank)
- [ ] Target date set

**Record project name for cleanup:** `[TEST-FINAL] New Project Test`

**Record project short key:** `_______` (e.g., pr3, pr4 — use in Test 7.2)

#### Test 7.2 — Create issue in newly created project (Phase 3/4 verification)

**Prompt:**
> Create an issue "[TEST-FINAL] Issue in New Project" for team SQT and assign it to the "[TEST-FINAL] New Project Test" project

**Expected tool:** `create_issues` with `projectName` or `project` (short key from 7.1)

**Verify:**
- [ ] Issue created successfully
- [ ] **Phase 3 FIXED:** Project resolved via name or short key (no forceRefresh needed)
- [ ] **Phase 4 FIXED:** `created[1]` shows `project` field with short key (NOT blank)
- [ ] Project short key matches what was assigned in Test 7.1
- [ ] Issue visible under the project in Linear UI

---

### Tool 8: update_projects

**Description:** Update project state, lead, dates, etc.

#### Test 8.1 — Update project state and lead

**Prompt:**
> Update "[TEST-FINAL] New Project Test" — set state to "started" and assign me as the lead

**Expected tool:** `update_projects`

**Verify:**
- [ ] `succeeded: 1`
- [ ] `changes[` shows `state,planned,started`
- [ ] `changes[` shows `lead,,u0`

---

### Tool 9: list_comments

**Description:** List comments on an issue. Returns comment authors in `_users` lookup.

#### Test 9.1 — List comments on real issue

**Prompt:**
> Show me the comments on SQT-157

**Expected tool:** `list_comments`

**Verify:**
- [ ] `comments[N]{id,issue,user,body,createdAt}`
- [ ] **BUG-10 FIXED:** `id` field present (UUID)
- [ ] **BUG-9 FIXED:** `user` field shows short key (u0, u1, etc.) — NOT blank
- [ ] `_users[` lookup section with author details
- [ ] Comment bodies and timestamps present

#### Test 9.2 — List comments on test issue

**Prompt:**
> Show me comments on [TEST-FINAL] Complete Issue Test

**Expected tool:** `list_comments`

**Verify:**
- [ ] Returns any comments added (or empty if none)
- [ ] Format consistent with Test 9.1

---

### Tool 10: add_comments

**Description:** Add comments to issues. Supports batch.

#### Test 10.1 — Single comment

**Prompt:**
> Add a comment to [TEST-FINAL] Complete Issue Test saying "Testing add_comments tool via MCP integration."

**Expected tool:** `add_comments`

**Verify:**
- [ ] `succeeded: 1`
- [ ] Comment body and timestamp returned
- [ ] Comment visible in Linear UI

#### Test 10.2 — Batch comments

**Prompt:**
> Add comments to:
> - [TEST-FINAL] Batch Item 1: "First batch comment"
> - [TEST-FINAL] Batch Item 2: "Second batch comment"

**Expected tool:** `add_comments` (batch of 2)

**Verify:**
- [ ] `succeeded: 2`
- [ ] Both comments created on correct issues

---

### Tool 11: update_comments

**Description:** Update comment body. Requires comment ID.

#### Test 11.1 — Update a comment

**Prompt:**
> Update the comment you added to [TEST-FINAL] Complete Issue Test — change it to "UPDATED via update_comments tool."

**Expected tool sequence:** `list_comments` (to get ID) -> `update_comments`

**Verify:**
- [ ] Claude fetches comments to find the ID
- [ ] **BUG-10 DEPENDENCY:** Comment ID available from `list_comments`
- [ ] Comment body updated successfully
- [ ] Updated text visible in Linear UI

---

### Tool 12: list_cycles

**Description:** List sprints/cycles for a team.

#### Test 12.1 — List all cycles

**Prompt:**
> What cycles does team SQT have?

**Expected tool:** `list_cycles`

**Verify:**
- [ ] `cycles[N]{num,name,start,end,active,progress}`
- [ ] **BUG-5 FIXED:** Cycles in chronological order (descending: 7,6,5,4,3,2,1)
- [ ] Current/active cycle identifiable
- [ ] Progress percentages shown

---

### Tool 13: get_sprint_context

**Description:** Comprehensive sprint data with gap analysis. Tier 2 output.

#### Test 13.1 — Current sprint

**Prompt:**
> Summarize the current sprint for team SQT with comments and relations

**Expected tool:** `get_sprint_context` with `cycle: "current"`, `includeComments: true`, `includeRelations: true`

**Verify:**
- [ ] `_meta{team,cycle,start,end,generated}`
- [ ] `issues[N]` with sprint issues
- [ ] `_gaps[N]{type,count,issues}` — gap analysis:
  - [ ] `no_estimate` — issues without estimates
  - [ ] `no_assignee` — unassigned issues (excluding completed)
  - [ ] `stale` — no updates for 7+ days
  - [ ] `blocked` — has blocking relations
  - [ ] `priority_mismatch` — urgent items not started
- [ ] `comments[` section (if `includeComments: true`)
- [ ] `relations[` section (if `includeRelations: true`)
- [ ] **NOTE-1 FIXED:** Descriptions show `[N images]` (not raw image URLs)
- [ ] **NOTE-3 ADDED:** Issues include `createdAt` and `creator` fields
- [ ] **NOTE-4 ADDED:** Priority as `p1`, `p2`, estimate as `e3`, `e5`, cycle as `c5`

#### Test 13.2 — Previous sprint

**Prompt:**
> How did the previous sprint go for SQT?

**Expected tool:** `get_sprint_context` with `cycle: "previous"`

**Verify:**
- [ ] Different cycle number than Test 13.1
- [ ] Issues from previous sprint
- [ ] Gap analysis for historical sprint

---

## Part 3: Bug Fix Verification (Consolidated)

All bugs discovered in v1, v2, v3 testing with their verification tests.

### High Priority Bugs

| Bug ID | Description | Status | Verification Test |
|--------|-------------|--------|-------------------|
| BUG-6 | `get_issues` missing priority/estimate/cycle/team | FIXED | Tool 3: Test 3.1 |
| BUG-9 | `list_comments` user field blank | FIXED | Tool 9: Test 9.1 |
| BUG-10 | `list_comments` missing comment ID | FIXED | Tool 9: Test 9.1, Tool 11: Test 11.1 |
| BUG-12 | `create_projects` no team key resolution | FIXED | Tool 7: Test 7.1 |

### Medium Priority Bugs

| Bug ID | Description | Status | Verification Test |
|--------|-------------|--------|-------------------|
| BUG-1 | Empty org name in `_meta` | FIXED | Tool 1: Test 1.1 |
| BUG-2 | User roles blank | FIXED | Tool 1: Test 1.1 |
| BUG-5 | Cycles out of order | FIXED | Tool 12: Test 12.1 |
| BUG-7 | `create_issues` cycle field ignored | FIXED | Tool 4: Test 4.1 |
| BUG-8 | `changes[` diff incomplete | FIXED | Tool 5: Tests 5.1-5.5 |
| BUG-11 | `list_projects` user lookup blank | FIXED | Tool 6: Test 6.1 |

### Enhancements

| Note ID | Description | Status | Verification Test |
|---------|-------------|--------|-------------------|
| NOTE-1 | Strip image markdown from descriptions | IMPLEMENTED | Tool 13: Test 13.1 |
| NOTE-3 | Add createdAt/creator to issues | IMPLEMENTED | Tool 13: Test 13.1 |
| NOTE-4 | Prefixed numeric fields (p1, e5, c5) | IMPLEMENTED | Tool 2: Test 2.4, Tool 13: Test 13.1 |
| NOTE-6 | `created[` shows actual state | IMPLEMENTED | Tool 4: Test 4.1 |
| NOTE-7 | `created[` includes URL | IMPLEMENTED | Tool 4: Test 4.1 |

### Architecture Decisions

| Decision | Description | Status |
|----------|-------------|--------|
| DECISION-1 | Remove `list_teams` and `list_users` | IMPLEMENTED |
| DECISION-2 | Remove `list_my_issues` | IMPLEMENTED |
| DECISION-3 | Remove `show_issues_ui` | IMPLEMENTED |

**Tool count reduced from 17 to 13.**

---

## Part 4: Multi-Step Workflows (5 scenarios)

Realistic scenarios that test Claude's ability to chain tools naturally.

### Workflow 1: Sprint Standup

**Prompt:**
> I need a sprint standup summary for team SQT:
> 1. What's in progress and who's working on it?
> 2. What's blocked or stale?
> 3. Any urgent items not started?
> Then create a [TEST-FINAL] tracking issue for any action items you identify.

**Expected tools:** `get_sprint_context` -> analysis -> `create_issues`

**Verify:**
- [ ] Sprint context fetched first
- [ ] Gap analysis interpreted (blocked, stale, priority_mismatch)
- [ ] Action items identified
- [ ] Test issue created with relevant details
- [ ] Natural standup summary produced

---

### Workflow 2: Issue Investigation

**Prompt:**
> I want to understand our authentication work. Find all issues related to "login", "cognito", or "auth", show me their details with comments, and summarize where things stand.

**Expected tools:** `list_issues` (search) -> possibly `get_issues` (details) -> `list_comments`

**Verify:**
- [ ] Auth-related issues found
- [ ] Full details fetched on key issues
- [ ] Comments read for context
- [ ] Coherent summary produced
- [ ] Multiple tools chained (or single flexible call)

---

### Workflow 3: Project Planning

**Prompt:**
> We're starting a new workstream. Create a project "[TEST-FINAL] Q2 Initiative" for team SQT with target date 2026-06-30. Then create 3 issues under that project:
> 1. "[TEST-FINAL] Design phase" — High priority, estimate 8, assign to me
> 2. "[TEST-FINAL] Implementation" — High priority, estimate 5, assign to Ian
> 3. "[TEST-FINAL] Testing" — Medium priority, estimate 3

**Expected tools:** `create_projects` -> `create_issues` (batch)

**Verify:**
- [ ] Project created first (team key resolved)
- [ ] All 3 issues created under project
- [ ] Correct assignees (you and Ian)
- [ ] Correct priorities and estimates
- [ ] Project reference set on all issues
- [ ] Seamless multi-step flow

---

### Workflow 4: Triage and Update

**Prompt:**
> Find all [TEST-FINAL] issues that are still in Triage or Todo state. Move them to "In Progress" and add a comment to each saying "Moving to active work."

**Expected tools:** `list_issues` (search) -> `update_issues` (batch) -> `add_comments` (batch)

**Verify:**
- [ ] Test issues found
- [ ] Correctly identifies Triage/Todo issues
- [ ] Batch state updates
- [ ] Batch comments added
- [ ] Results reported clearly

---

### Workflow 5: Complete Issue Lifecycle

**Prompt:**
> Let's test the complete issue lifecycle:
> 1. Create an issue "[TEST-FINAL] Lifecycle Test" in team SQT, High priority, estimate 5, assigned to me
> 2. Add a comment "Starting work on this"
> 3. Move it to "In Progress"
> 4. Add the "Bug" label
> 5. Add another comment "Found the root cause"
> 6. Move it to "In Review"
> 7. Finally, move it to "Done"
>
> Show me the final state of the issue.

**Expected tools:** Multiple `create_issues`, `add_comments`, `update_issues`, `get_issues`

**Verify:**
- [ ] Issue created
- [ ] Comments added at each stage
- [ ] State transitions tracked in diffs
- [ ] Label added
- [ ] Final state is "Done"
- [ ] Full lifecycle completed

---

### Workflow 6: Sprint Planning

**Prompt:**
> Let's plan the next sprint for team SQT:
> 1. Show me the available cycles
> 2. Find high-priority backlog issues that aren't assigned to any cycle
> 3. Assign the top 3 unassigned backlog issues to cycle 6 (or the next available cycle)
> 4. Add a comment to each saying "Added to sprint planning"

**Expected tools:** `list_cycles` -> `list_issues` (backlog, no cycle) -> `update_issues` (assign cycle) -> `add_comments`

**Verify:**
- [ ] Cycles listed with numbers and dates
- [ ] Backlog issues without cycle identified
- [ ] Issues successfully assigned to cycle
- [ ] `changes[` shows cycle assignment (e.g., `cycle,,c6`)
- [ ] Comments added to each issue
- [ ] Multi-step planning workflow completed naturally

---

## Part 5: Cleanup

After testing, clean up all test data in Linear.

### Issues to Delete

Run this prompt to find all test issues:
> List all issues with "[TEST-FINAL]" in the title

Then manually archive/delete them in Linear, or use:
> Move all [TEST-FINAL] issues to "Canceled" state

### Projects to Delete

- `[TEST-FINAL] Smoke Test Project`
- `[TEST-FINAL] New Project Test`
- `[TEST-FINAL] Q2 Initiative`
- Any other `[TEST-FINAL]` projects

### Cleanup Verification

> Search for any remaining [TEST-FINAL] issues or projects

**Verify:**
- [ ] No test issues remain (or all canceled/archived)
- [ ] No test projects remain (or archived)

---

## Part 6: Results Summary

### Smoke Tests

| Test | Description | Result |
|------|-------------|--------|
| SMOKE-1 | Registry Bootstrap | [ ] PASS / [ ] FAIL |
| SMOKE-2 | Comment User Field | [ ] PASS / [ ] FAIL |
| SMOKE-3 | Project Creation | [ ] PASS / [ ] FAIL |
| SMOKE-4 | Update Diff Tracking | [ ] PASS / [ ] FAIL |
| SMOKE-5 | Issue Details | [ ] PASS / [ ] FAIL |

### Tool Coverage

| # | Tool | Tests Passed | Status |
|---|------|--------------|--------|
| 1 | workspace_metadata | /2 | [ ] PASS |
| 2 | list_issues | /5 | [ ] PASS |
| 3 | get_issues | /1 | [ ] PASS |
| 4 | create_issues | /3 | [ ] PASS |
| 5 | update_issues | /5 | [ ] PASS |
| 6 | list_projects | /1 | [ ] PASS |
| 7 | create_projects | /2 | [ ] PASS |
| 8 | update_projects | /1 | [ ] PASS |
| 9 | list_comments | /2 | [ ] PASS |
| 10 | add_comments | /2 | [ ] PASS |
| 11 | update_comments | /1 | [ ] PASS |
| 12 | list_cycles | /1 | [ ] PASS |
| 13 | get_sprint_context | /2 | [ ] PASS |

### Bug Fix Verification

| Bug ID | Description | Verified |
|--------|-------------|----------|
| BUG-1 | Empty org name | [ ] |
| BUG-2 | User roles blank | [ ] |
| BUG-5 | Cycles out of order | [ ] |
| BUG-6 | get_issues missing fields | [ ] |
| BUG-7 | create_issues cycle ignored | [ ] |
| BUG-8 | Incomplete diff tracking | [ ] |
| BUG-9 | Comments user blank | [ ] |
| BUG-10 | Comments missing ID | [ ] |
| BUG-11 | list_projects user blank | [ ] |
| BUG-12 | create_projects no team resolution | [ ] |

### Workflow Tests

| Workflow | Description | Result |
|----------|-------------|--------|
| 1 | Sprint Standup | [ ] PASS / [ ] FAIL |
| 2 | Issue Investigation | [ ] PASS / [ ] FAIL |
| 3 | Project Planning | [ ] PASS / [ ] FAIL |
| 4 | Triage and Update | [ ] PASS / [ ] FAIL |
| 5 | Complete Lifecycle | [ ] PASS / [ ] FAIL |
| 6 | Sprint Planning | [ ] PASS / [ ] FAIL |

### Overall Result

**Date:** _______________

**Tester:** _______________

**Tool Count Verified:** [ ] 13 tools

**All Smoke Tests Pass:** [ ] Yes / [ ] No

**All Bug Fixes Verified:** [ ] Yes / [ ] No

**All Workflows Pass:** [ ] Yes / [ ] No

**Issues Found:**
```
(document any new issues here)
```

**Notes:**
```
(any observations or recommendations)
```

---

## Appendix A: Quick Reference — All 13 Tools

| # | Tool | Purpose | Key Parameters |
|---|------|---------|----------------|
| 1 | workspace_metadata | Get all workspace entities (Tier 1) | `include`, `forceRefresh` |
| 2 | list_issues | Search/filter issues | `team`, `q`, `filter`, `assignedToMe`, `cycle` |
| 3 | get_issues | Get issue details by ID | `ids` (array of identifiers) |
| 4 | create_issues | Create issues (batch) | `items[]{title, teamId, assignee, state, priority, estimate, ...}` |
| 5 | update_issues | Update issues (batch) | `items[]{id, stateName, assignee, addLabelNames, ...}` |
| 6 | list_projects | List all projects | (no required params) |
| 7 | create_projects | Create projects | `items[]{name, teamId, targetDate, ...}` |
| 8 | update_projects | Update projects | `items[]{id, state, leadId, ...}` |
| 9 | list_comments | List comments on issue | `issueId` |
| 10 | add_comments | Add comments (batch) | `items[]{issueId, body}` |
| 11 | update_comments | Update comment body | `items[]{id, body}` |
| 12 | list_cycles | List team cycles | `teamId`, `limit` |
| 13 | get_sprint_context | Sprint data + gap analysis | `team`, `cycle`, `includeComments`, `includeRelations` |

---

## Appendix B: TOON Format Reference

### Section Headers

```
_meta{field1,field2,...}:        # Metadata
_users[N]{key,name,...}:         # User lookup (Tier 2)
_states[N]{key,name,type}:       # State lookup (Tier 2)
_projects[N]{key,name,state}:    # Project lookup (Tier 2)
issues[N]{identifier,...}:       # Main data
comments[N]{id,issue,...}:       # Comments
relations[N]{...}:               # Issue relations
_gaps[N]{type,count,issues}:     # Gap analysis
changes[N]{identifier,...}:      # Update diffs
results[N]{index,status,...}:    # Batch results
created[N]{identifier,...}:      # Created items
```

### Short Key Prefixes

| Entity | Prefix | Example |
|--------|--------|---------|
| Users | `u` | `u0`, `u1`, `u2` |
| States | `s` | `s0`, `s1`, `s4` |
| Projects | `pr` | `pr0`, `pr1` |
| External users | `ext` | `ext0`, `ext1` |

### Numeric Field Prefixes

| Field | Prefix | Example |
|-------|--------|---------|
| Priority | `p` | `p1` (Urgent), `p2` (High), `p3` (Medium), `p4` (Low) |
| Estimate | `e` | `e1`, `e2`, `e3`, `e5`, `e8`, `e13` (Fibonacci) |
| Cycle | `c` | `c5`, `c6`, `c7` |

---

## Appendix C: Removed Tools (Historical Reference)

These tools were removed as part of architecture decisions:

| Tool | Removed In | Reason |
|------|------------|--------|
| list_teams | v2 | Redundant with workspace_metadata |
| list_users | v2 | Redundant with workspace_metadata |
| list_my_issues | v2 | Redundant with list_issues + assignedToMe |
| show_issues_ui | v3 | No MCP client supports ui:// protocol |

---

*End of Manual Test Script — Final Edition*
