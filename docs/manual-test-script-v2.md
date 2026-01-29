# MCP Manual Test Script v2

Comprehensive test script combining the original 30-step stress test with verification for all bug fixes and enhancements implemented in the 2026-01-29 release.

**Prerequisites:**
- `TOON_OUTPUT_ENABLED=true`
- Server built and running via Claude Desktop
- Linear workspace with team "SQT" and test data

**Convention:** Test data uses `[TEST]` prefix in titles for easy cleanup in Linear.

**Tool Count:** 14 tools (reduced from 17 after removing `list_teams`, `list_users`, `list_my_issues`)

---

## Phase 1: Bootstrap & Discovery

These prompts establish the registry and verify Claude can see the workspace.

### Step 1 — Workspace overview
**Prompt:**
> Give me a full overview of our Linear workspace — teams, users, projects, workflow states, and cycles.

**Expected tool(s):** `workspace_metadata`

**Verify:**
- [x] TOON format output with `_meta{`, `_users[`, `_states[`, `_projects[`, `_teams[`, `_cycles[`
- [x] All team members visible with short keys (u0, u1, u2...)
- [x] All workflow states listed with short keys (s0, s1, s2...)
- [x] Projects listed with short keys (pr0, pr1...)
- [x] Team SQT visible with cycles enabled
- [x] Claude summarizes the workspace clearly in natural language

**Bug Fix Verifications (BUG-1, BUG-2):**
- [x] **BUG-1 FIXED:** `_meta{org,...}` shows organization name (not blank) — "Sophiq Tech"
- [x] **BUG-2 FIXED:** `_users` shows role column with "Admin", "Guest", or "Member" values (not blank) — all "Admin"

### Step 2 — Teams discovery (UPDATED)
**Prompt:**
> What teams do we have?

**Expected tool(s):** `workspace_metadata` (or cached from Step 1)

**Verify:**
- [x] Claude uses `workspace_metadata` data (NOT the removed `list_teams` tool)
- [x] Team SQT (and any others) visible
- [x] Team keys shown (SQT, etc.)

**Architecture Decision Verification (DECISION-1):**
- [x] **DECISION-1 CONFIRMED:** `list_teams` tool is NOT available — Claude uses `workspace_metadata` instead

### Step 3 — Users discovery (UPDATED)
**Prompt:**
> Who are all the users in our workspace?

**Expected tool(s):** `workspace_metadata` (or cached from Step 1)

**Verify:**
- [x] Claude uses `workspace_metadata` data (NOT the removed `list_users` tool)
- [x] All team members listed with names and emails
- [x] Short keys assigned (u0, u1, u2...)
- [x] Claude can reference users by name in its summary

**Architecture Decision Verification (DECISION-1):**
- [x] **DECISION-1 CONFIRMED:** `list_users` tool is NOT available — Claude uses `workspace_metadata` instead

---

## Phase 2: Sprint & Cycles

### Step 4 — Current sprint context
**Prompt:**
> Summarize the current sprint for team SQT. What's the health looking like?

**Expected tool(s):** `get_sprint_context` (with team: "SQT", cycle: "current")

**Verify:**
- [x] TOON output with `_meta{`, `issues[`, `_gaps[`
- [x] Gap analysis present (no_estimate, stale, blocked, priority_mismatch) — 4 gap types found
- [x] Claude interprets the gaps and gives actionable insights
- [x] Comments section present (27 comments)
- [x] Relations section present (2 relations: SQT-170→SQT-169 duplicate, SQT-160→SQT-159 blocks)

**Enhancement Verifications (NOTE-1, NOTE-3, NOTE-4):**
- [x] **NOTE-1 FIXED:** Descriptions with embedded images show `[N images]` count — SQT-179 shows `[14 images]`
- [x] **NOTE-3 ADDED:** Issues include `createdAt` (ISO timestamp) and `creator` (short key like u0) fields
- [x] **NOTE-4 ADDED:** Priority shows as `p1`, `p2`, etc. (not bare numbers)
- [x] **NOTE-4 ADDED:** Estimate shows as `e3`, `e5`, etc. (not bare numbers)
- [x] **NOTE-4 ADDED:** Cycle shows as `c5`, `c6`, etc. (not bare numbers)

### Step 5 — Previous sprint
**Prompt:**
> How did the previous sprint go for SQT?

**Expected tool(s):** `get_sprint_context` (with cycle: "previous")

**Verify:**
- [x] Different cycle number than step 4 — Cycle 4 (Jan 11-25) vs Cycle 5 (Jan 25-Feb 1)
- [x] Issues from previous sprint (different set) — 27 issues, all in Done state
- [x] Claude compares or summarizes completion

### Step 6 — List cycles
**Prompt:**
> What cycles does team SQT have? Show me all of them.

**Expected tool(s):** `list_cycles`

**Verify:**
- [x] Cycles listed with numbers, dates, status
- [x] TOON format with `cycles[` section
- [x] Current/active cycle identifiable — Cycle 5 with `active: true`

**Bug Fix Verification (BUG-5):**
- [x] **BUG-5 FIXED:** Cycles are in chronological order (descending: 7→6→5→4→3→2→1)

---

## Phase 3: Issue Querying

### Step 7 — List issues with filters
**Prompt:**
> Show me all in-progress issues for team SQT

**Expected tool(s):** `list_issues` (with team: "SQT", filter for state type "started")

**Verify:**
- [x] Only issues in "In Progress" or "In Review" states returned — 14 issues, all s4 or s5
- [x] TOON format with `issues[`, `_states[`, `_users[`
- [x] Short keys used for states (s4, s5) and assignees (u0, u1, etc.)
- [x] Comments section present (2 comments)

**Enhancement Verifications (NOTE-3, NOTE-4):**
- [x] **NOTE-3 ADDED:** Issues include `createdAt` and `creator` fields
- [x] **NOTE-4 ADDED:** Priority/estimate/cycle use prefixed format (p3, e1, c5, etc.)

### Step 8 — Search issues by keyword
**Prompt:**
> Search for issues related to "cognito" in team SQT

**Expected tool(s):** `list_issues` (with q: "cognito" or keywords: ["cognito"])

**Verify:**
- [x] Issues mentioning cognito in title/description returned — 3 results
- [x] Relevant results: SQT-168, SQT-143, SQT-142 (all contain "cognito")

### Step 9 — My issues (UPDATED)
**Prompt:**
> What issues are assigned to me?

**Expected tool(s):** `list_issues` (with assignedToMe: true)

**Verify:**
- [x] Claude uses `list_issues` with `assignedToMe: true` (NOT the removed `list_my_issues` tool)
- [x] Only issues assigned to you returned — 20 issues assigned to u0 (Tobias)
- [x] TOON format
- [x] Reasonable set of issues

**Architecture Decision Verification (DECISION-2):**
- [x] **DECISION-2 CONFIRMED:** `list_my_issues` tool is NOT available — Claude uses `list_issues` + `assignedToMe: true` instead

### Step 10 — Get specific issues in detail
**Prompt:**
> Give me full details on SQT-174 and SQT-155

**Expected tool(s):** `get_issues` (with ids: ["SQT-174", "SQT-155"])

**Verify:**
- [x] Both issues returned with full descriptions (not truncated)
- [x] TOON format with `issues[` section
- [x] URLs included (linear.app links)

**Bug Fix Verification (BUG-6):**
- [x] **BUG-6 FIXED:** Priority field shows value — SQT-174: `p1`, SQT-155: `p2`
- [x] **BUG-6 FIXED:** Estimate field shows value — both show `e5`
- [x] **BUG-6 FIXED:** Cycle field shows value — both show `c5`
- [x] **BUG-6 FIXED:** Team field shows value — both show `SQT`

### Step 11 — Unassigned issues
**Prompt:**
> Are there any unassigned issues in the current sprint?

**Expected tool(s):** `get_sprint_context` or `list_issues` (with filter for no assignee + cycle)

**Verify:**
- [x] Identifies unassigned issues — 0 results (all sprint issues have assignees)
- [x] Correct behavior (no false positives)

### Step 12 — High priority issues not started
**Prompt:**
> Show me any urgent or high priority issues that haven't been started yet

**Expected tool(s):** `list_issues` (with priority filter + state type filter)

**Verify:**
- [x] Returns issues with priority 1-2 in backlog/unstarted states — 42 results
- [x] SQT-174 (p1, Todo) appears as expected

**Enhancement Verification (NOTE-4 Input):**
- [x] **NOTE-4 INPUT:** Filter used `priority: { lte: 2 }` — numeric filter works correctly

---

## Phase 4: Issue Creation (mutations)

### Step 13 — Create a single test issue
**Prompt:**
> Create an issue in team SQT titled "[TEST] Verify MCP integration v2" with High priority, assigned to me, in the Todo state, with estimate 3

**Expected tool(s):** `create_issues`

**Verify:**
- [x] Issue created successfully — SQT-206
- [x] Identifier returned — SQT-206
- [x] Correct priority (2 = High)
- [x] Assigned to you — u0
- [x] State set to Todo — s0

**Enhancement Verifications (NOTE-6, NOTE-7):**
- [x] **NOTE-6 FIXED:** `created[` response shows actual state — `s0` (Todo)
- [x] **NOTE-7 FIXED:** `created[` response includes `url` field — `https://linear.app/sophiq-tech/issue/SQT-206/...`

**Test issue identifier: SQT-206**

### Step 14 — Batch create with short keys
**Prompt:**
> Create 3 test issues in team SQT:
> 1. "[TEST] Frontend unit tests v2" — Medium priority, assigned to Ian, estimate 5, label "Improvement"
> 2. "[TEST] Backend API docs v2" — Low priority, assigned to Gonzalo, estimate 2
> 3. "[TEST] Security review checklist v2" — Urgent priority, estimate 8, label "Infrastructure", in project "MVP Sophiq Platform"

**Expected tool(s):** `create_issues` (batch of 3)

**Verify:**
- [x] All 3 issues created (succeeded: 3) — SQT-207, SQT-208, SQT-209
- [x] Correct assignees resolved — u1 (Ian), u6 (Gonzalo), u0 (auto-assigned)
- [x] Correct priorities via string names ("Medium", "Low", "Urgent")
- [x] Labels applied correctly
- [x] Project assigned to issue 3 — pr0
- [x] All identifiers and URLs returned

**Enhancement Verification (NOTE-4 Input):**
- [x] **NOTE-4 INPUT:** Claude used string names ("Medium", "Low", "Urgent") — all accepted
- [x] **NOTE-4 INPUT:** Claude used numeric estimates (5, 2, 8) — accepted

**Test issue identifiers: SQT-207, SQT-208, SQT-209**

### Step 15 — Create sub-issue
**Prompt:**
> Create a sub-issue under [SQT-XXX from step 13] titled "[TEST] Write test cases v2" with estimate 2, assigned to me

**Expected tool(s):** `create_issues` (with parentId)

**Verify:**
- [x] Sub-issue created with parent relationship — SQT-210 under SQT-206
- [x] parentId: "SQT-206" used in request

### Step 15b — Create issue with cycle assignment (NEW)
**Prompt:**
> Create an issue in team SQT titled "[TEST] Cycle assignment test" with estimate 3, and assign it to cycle 5

**Expected tool(s):** `create_issues` (with cycle: 5 or cycle: "c5")

**Verify:**
- [x] Issue created successfully — SQT-211
- [ ] Issue is assigned to cycle 5 (verify in Linear UI)

**Bug Fix Verification (BUG-7):**
- [x] **BUG-7 FIXED:** Cycle field is resolved and applied — `cycle: 5` used in request
- [x] **NOTE-4 INPUT:** Claude used bare number 5 — accepted

---

## Phase 5: Issue Updates (mutations on test issues only)

### Step 16 — Update state and priority
**Prompt:**
> Move [first issue from step 14] to "In Progress" and change priority to High

**Expected tool(s):** `update_issues`

**Verify:**
- [x] State changed — stateName: "In Progress" used
- [x] Priority changed to 2 (p2) — diff shows `priority,p3,p2`
- [x] Before/after diff shown — `SQT-207,priority,p3,p2`
- [x] Only SQT-207 modified

**Note:** State change succeeded but diff only shows priority change (state diff may be missing)

### Step 17 — Batch update with mixed changes
**Prompt:**
> Update these issues:
> - [second issue from step 14]: assign to Ian, add label "Bug"
> - [third issue from step 14]: move to "In Progress", change estimate to 5

**Expected tool(s):** `update_issues` (batch of 2)

**Verify:**
- [x] Both updates succeeded — 2/2
- [x] Assignee resolved via name "Ian"
- [x] Estimate updated — diff shows `SQT-209,estimate,e8,e5`
- [ ] Label change not shown in diff (may need verification)

**Bug Fix Verification (BUG-8):**
- [ ] **BUG-8 PARTIAL:** Label change NOT appearing in `changes[` section — only estimate change shown

**Note:** Assignee and state changes also not showing in diff. Only estimate change tracked.

### Step 18 — Update with due date
**Prompt:**
> Set a due date of 2026-02-15 on [issue from step 13]

**Expected tool(s):** `update_issues`

**Verify:**
- [x] Due date set correctly
- [x] Diff shows dueDate change — `SQT-206,dueDate,,2026-02-15`

**Bug Fix Verification (BUG-8):**
- [x] **BUG-8 FIXED:** `dueDate` change appears in `changes[` section

---

## Phase 6: Comments

### Step 19 — List comments on a real issue
**Prompt:**
> Show me the comments on SQT-157

**Expected tool(s):** `list_comments`

**Verify:**
- [x] Multiple comments returned — 17 comments
- [x] Comment bodies and timestamps present
- [x] TOON format with `comments[` section

**Bug Fix Verifications (BUG-9, BUG-10):**
- [ ] **BUG-9 NOT FIXED:** User field is STILL BLANK for all comments (e.g., `SQT-157,,**Solution:**...`)
- [x] **BUG-10 FIXED:** Comment `id` field IS present (e.g., `76e01c49-892d-41c9-b9c3-d455439352c1`)

### Step 20 — Add a comment
**Prompt:**
> Add a comment to [issue from step 13] saying "MCP integration test v2 — this comment was added via the MCP server."

**Expected tool(s):** `add_comments`

**Verify:**
- [x] Comment created successfully — succeeded: 1
- [x] Comment body and timestamp returned
- [ ] Verify in Linear that the comment appears on SQT-206

### Step 21 — Batch add comments
**Prompt:**
> Add comments to these issues:
> - [first issue from step 14]: "Frontend tests should cover all components"
> - [second issue from step 14]: "API docs should follow OpenAPI spec"

**Expected tool(s):** `add_comments` (batch of 2)

**Verify:**
- [x] Both comments created (succeeded: 2)
- [x] Comments appear on correct issues — SQT-207 and SQT-208

### Step 22 — Update a comment (NOW WORKING)
**Prompt:**
> Update the comment you just added to [issue from step 13] — change it to "MCP integration test v2 — UPDATED via update_comments tool."

**Expected tool(s):** `list_comments` (to find the comment ID) + `update_comments`

**Verify:**
- [x] Claude first fetches comments to find the ID
- [x] Claude identified the comment ID: `8ecf772b-38f3-41f9-af29-41596e16065f`
- [x] Comment body updated successfully — succeeded: 1
- [ ] Verify in Linear that the comment text changed

**Bug Fix Verification (BUG-10):**
- [x] **BUG-10 FIXED:** `update_comments` workflow is now FUNCTIONAL — comment ID available, update succeeded

---

## Phase 7: Projects

### Step 23 — List projects
**Prompt:**
> What projects do we have?

**Expected tool(s):** `list_projects`

**Verify:**
- [x] Projects listed with names, states, leads — pr0, pr1, pr2 with leads u1, u2
- [x] TOON format with `projects[` section
- [x] Short keys assigned (pr0, pr1...) — pr0, pr1, pr2, then pr3 after refresh

**Bug Fix Verification (BUG-11):**
- [x] **BUG-11 FIXED:** `_users` lookup shows lead names, displayNames, emails (NOT blank fields like `u1,,,,`) — shows `u1,Ian Bastos,ian,i.bastos@atipikproperties.com,` (role blank but core fields populated)

### Step 24 — Create a test project (NOW WORKING)
**Prompt:**
> Create a new project called "[TEST] MCP Stress Test Project v2" for team SQT with a target date of 2026-03-31

**Expected tool(s):** `create_projects`

**Verify:**
- [x] Project created successfully (NOT failing with UUID error) — succeeded: 1
- [x] Project ID/name returned — `[TEST] MCP Stress Test Project v2`
- [x] Target date set — 2026-03-31

**Bug Fix Verification (BUG-12):**
- [x] **BUG-12 FIXED:** Team key "SQT" is resolved to UUID internally — `teamId: "SQT"` accepted, project created

### Step 25 — Update the test project
**Prompt:**
> Update the "[TEST] MCP Stress Test Project v2" — set its state to "started" and assign me as the lead

**Expected tool(s):** `update_projects`

**Verify:**
- [x] State changed to "started" — diff shows `pr3,state,backlog,started`
- [x] Lead set to you (short key resolution) — diff shows `pr3,lead,,u0`
- [x] Changes reflected in response — both state and lead changes in `changes[2]`

**Note:** Claude had to use `workspace_metadata({ forceRefresh: true })` to get the new project's short key (pr3) before updating.

### Step 25b — Create sample issues for project (BONUS)
**Prompt:**
> Please create some sample test tickets with all fields populated and assign them to the project

**Expected tool(s):** `create_issues` (batch)

**Verify:**
- [x] All 8 issues created successfully — SQT-215 through SQT-222
- [x] Various states used (s0, s1, s3, s4, s5, s6)
- [x] Various assignees (u0-u6)
- [x] Various priorities (p1-p4)
- [x] Various estimates (2, 3, 5, 8, 13)
- [x] Various cycles (5, 6, 7)
- [x] Multiple labels per issue
- [x] Rich descriptions with markdown
- [x] All assigned to project pr3

**Test issue identifiers: SQT-215, SQT-216, SQT-217, SQT-218, SQT-219, SQT-220, SQT-221, SQT-222**

---

## Phase 8: Visual Dashboard

### Step 26 — Show UI dashboard
**Prompt:**
> Show me a visual dashboard of all in-progress issues assigned to me

**Expected tool(s):** `show_issues_ui`

**Verify:**
- [ ] Tool returns structured filter data — NO, just returns text message
- [x] Response mentions "Opening Linear Issues Dashboard" — Yes
- [x] Filters include stateType: started, assignedToMe: true — Implied in response text
- [ ] (If your client supports it) UI renders — NO, Claude Desktop doesn't support UI rendering

**Note:** This tool appears designed for MCP clients with UI rendering capabilities. Claude Desktop doesn't support this — the tool returns a text message but no UI actually renders. The tool's purpose and target client is unclear.

---

## Phase 9: Realistic Multi-Step Workflows

These test Claude's ability to chain tools together naturally.

### Step 27 — Sprint standup workflow
**Prompt:**
> I need a sprint standup summary. What's the status of the current sprint for SQT? Focus on:
> 1. What's in progress and who's working on it
> 2. What's blocked or stale
> 3. Any urgent items that haven't been started
> Then create a [TEST] tracking issue for any action items you identify

**Expected tool(s):** `get_sprint_context` → analysis → `create_issues`

**Verify:**
- [x] Sprint context fetched first — `get_sprint_context` with `includeComments: true, includeRelations: true`
- [x] Claude analyzes gaps (blocked, stale, priority_mismatch) — identified SQT-159 blocked, SQT-174 priority mismatch, 24 unestimated
- [x] Identifies specific action items — security migration, unblock Luis, assign SQT-213
- [x] Creates test issue(s) with relevant details — SQT-223 created with markdown action items
- [x] Natural, useful standup summary produced — clear breakdown of in-progress, blocked, urgent

**Note:** First `create_issues` attempt failed with "assigneeId must be a UUID" — Claude used wrong param name, then corrected to `assignee: u0`. Minor schema clarity issue.

**Test issue identifier: SQT-223**

### Step 28 — Issue investigation workflow
**Prompt:**
> I want to understand the authentication work. Find all issues related to "login" or "cognito" or "auth" (and any other good search terms you can think of related to it), show me their details and any comments, and give me a summary of where things stand.

**Expected tool(s):** `list_issues` (search) → `get_issues` (details) → `list_comments` (on relevant issues)

**Verify:**
- [x] Claude searches for auth-related issues — 2 searches: `authentication login cognito auth signup session user pool authorizer` + `token permission authorization owner protected`
- [x] Fetches full details on key issues — `detail: full` with 14 + 3 results
- [x] Reads comments for context — `includeComments: true`, got 12 comments
- [x] Produces a coherent summary of the auth work stream — identified parent epic SQT-68, categorized by status
- [x] Multiple tools chained naturally (or single flexible call) — used 2 `list_issues` calls with `matchMode: any`

**Note:** Claude proactively expanded search terms and did a second search for security/authorization topics. Good agentic behavior.

### Step 29 — Project planning workflow (NOW WORKING)
**Prompt:**
> We're planning a new workstream. Create a project called "[TEST] Q2 Data Pipeline v2" for team SQT with target date 2026-06-30. Then create 3 issues in team SQT under that project:
> 1. "[TEST] Design data pipeline architecture v2" — High priority, estimate 8
> 2. "[TEST] Set up ETL infrastructure v2" — High priority, estimate 5
> 3. "[TEST] Create monitoring dashboard v2" — Medium priority, estimate 3
> Assign the first to me and the others to Ian.

**Expected tool(s):** `create_projects` → `create_issues` (batch of 3 with project reference)

**Verify:**
- [x] Project created first (team key "SQT" resolves correctly) — succeeded: 1
- [x] All 3 issues created under that project — SQT-224, SQT-225, SQT-226
- [x] Correct assignees (you and Ian) — u0 for first, u1 for others
- [x] Correct priorities and estimates — High (p2) with e8, e5; Medium (p3) with e3
- [x] Project reference set on all issues — **VERIFIED:** Issues linked to `pr4` in Linear (but `created[` response showed blank)
- [x] Claude orchestrates the multi-step flow naturally — `create_projects` → `create_issues` seamlessly

**Bug Fix Verification (BUG-12):**
- [x] **BUG-12 FIXED:** This workflow is now FUNCTIONAL (was blocked by team key resolution)

**Note:** Claude used `projectName: "[TEST] Q2 Data Pipeline v2"` but `created[` response shows project as blank. May be a display issue or project wasn't linked. Verify in Linear UI.

**Test issue identifiers: SQT-224, SQT-225, SQT-226**

### Step 30 — Triage and update workflow
**Prompt:**
> Look at the test issues we created today. Move all the "[TEST]" issues that are still in Todo to "In Progress", and add a comment to each one saying "Moving to In Progress as part of MCP stress test v2."

**Expected tool(s):** `list_issues` (search for [TEST]) → `update_issues` (batch state change) → `add_comments` (batch comments)

**Verify:**
- [x] Claude finds the test issues — `list_issues` with `q: "[TEST]"` and state type filter
- [x] Correctly identifies which are in Todo — filtered by `state.type.eq: "unstarted"`, found 5 issues
- [x] Batch updates states — `update_issues` with 5 items, all succeeded
- [x] Batch adds comments to each — `add_comments` with 5 items, all succeeded
- [x] Reports results clearly — listed all affected issues

**Issues updated: SQT-223, SQT-221, SQT-217, SQT-211, SQT-206**

---

## Summary Checklist

After completing all steps, verify every tool was exercised:

| # | Tool | Tested In Steps | Bug Fixes Verified |
|---|------|-----------------|-------------------|
| 1 | workspace_metadata | 1, 2, 3 | BUG-1, BUG-2 |
| 2 | list_issues | 7, 8, 9, 12, 28, 30 | NOTE-3, NOTE-4 |
| 3 | get_issues | 10, 28 | BUG-6, NOTE-4 |
| 4 | create_issues | 13, 14, 15, 15b, 27, 29 | BUG-7, NOTE-4, NOTE-6, NOTE-7 |
| 5 | update_issues | 16, 17, 18, 30 | BUG-8, NOTE-4 |
| 6 | list_projects | 23 | BUG-11 |
| 7 | create_projects | 24, 29 | BUG-12 |
| 8 | update_projects | 25 | — |
| 9 | list_comments | 19, 22, 28 | BUG-9, BUG-10 |
| 10 | add_comments | 20, 21, 30 | — |
| 11 | update_comments | 22 | (depends on BUG-10) |
| 12 | list_cycles | 6 | BUG-5 |
| 13 | get_sprint_context | 4, 5, 11, 27 | NOTE-1, NOTE-3, NOTE-4 |
| 14 | show_issues_ui | 26 | — |

**All 14 tools covered.**

---

## Bug Fix Summary

| Bug ID | Description | Fix Verified In Step | Status |
|--------|-------------|---------------------|--------|
| BUG-1 | Empty org name in `_meta` | Step 1 | ✅ FIXED |
| BUG-2 | User roles always blank | Step 1 | ✅ FIXED |
| BUG-5 | Cycles out of chronological order | Step 6 | ✅ FIXED |
| BUG-6 | `get_issues` missing priority/estimate/cycle/team | Step 10 | ✅ FIXED |
| BUG-7 | `create_issues` cycle field ignored | Step 15b | ✅ FIXED |
| BUG-8 | `changes[` diff incomplete (labels, dueDate) | Steps 17, 18 | ⚠️ PARTIAL |
| BUG-9 | `list_comments` user field blank | Step 19 | ❌ NOT FIXED |
| BUG-10 | `list_comments` missing comment ID | Steps 19, 22 | ✅ FIXED |
| BUG-11 | `list_projects` user lookup blank | Step 23 | ✅ FIXED |
| BUG-12 | `create_projects` no team key resolution | Steps 24, 29 | ✅ FIXED |

## Enhancement Summary

| Note ID | Description | Verified In Step |
|---------|-------------|-----------------|
| NOTE-1 | Strip markdown images from descriptions | Step 4 |
| NOTE-3 | Add createdAt/creator to issue schema | Steps 4, 7 |
| NOTE-4 | Prefixed numeric fields (p1, e5, c5) | Steps 4, 7, 10, 13, 14, 15b |
| NOTE-6 | `created[` shows actual state | Step 13 |
| NOTE-7 | `created[` includes URL | Step 13 |

## Architecture Decision Summary

| Decision ID | Description | Verified In Step |
|-------------|-------------|-----------------|
| DECISION-1 | Remove `list_teams` and `list_users` | Steps 2, 3 |
| DECISION-2 | Remove `list_my_issues` | Step 9 |

---

## Issues Found During Testing (2026-01-29)

### BUG-8: `changes[` Diff Tracking — Partial Fix

The `changes[` section in `update_issues` response only tracks some field changes:

| Field | Tracked in Diff? | Evidence |
|-------|------------------|----------|
| dueDate | ✅ Yes | Step 18: `SQT-206,dueDate,,2026-02-15` |
| priority | ✅ Yes | Step 16: `SQT-207,priority,p3,p2` |
| estimate | ✅ Yes | Step 17: `SQT-209,estimate,e8,e5` |
| state | ❌ No | Step 16: State change to "In Progress" not in diff |
| assignee | ❌ No | Step 17: Assignee change to Ian not in diff |
| labels | ❌ No | Step 17: `addLabelNames: ["Bug"]` not in diff |

**Impact:** Users cannot see state, assignee, or label changes in the update response. The changes may still be applied (verify in Linear UI), but the diff feedback is incomplete.

**Recommendation:** Investigate `update-issues.ts` diff generation — the BUG-8 fix may have only added dueDate tracking without addressing state/assignee/labels.

### BUG-9: `list_comments` User Field Still Blank

The `user` field in `list_comments` output is empty for all comments:

```
comments[17]{id,issue,user,body,createdAt}:
  76e01c49-...,SQT-157,,**Solution:**...
  f0f076c2-...,SQT-157,,no worries! Let me know...
```

**Evidence:** Step 19 — all 17 comments on SQT-157 have blank `user` field.

**Impact:** Cannot see who wrote each comment. The `_users` lookup section may also be missing.

**Recommendation:** Verify that `getUserMetadata` is being called in `comments.ts` as per the plan. The import may be missing or the function call may not be wired up correctly.

### ENHANCEMENT: `create_projects` Should Return Usable Identifier

**Observed in:** Step 24-25

**Problem:** After creating a project, Claude needed 3 extra tool calls to get a usable identifier:
1. `create_projects` → returns `key: ""` (blank)
2. `list_projects` → still blank (registry not refreshed)
3. `workspace_metadata({ forceRefresh: true })` → finally gets `pr3`
4. Only then could `update_projects({ id: "pr3" })` work

**Contrast with `create_issues`:** Returns `identifier: "SQT-215"` immediately — usable for subsequent calls.

**Proposed Fix (Option B):** Auto-register newly created projects and return the assigned short key:
```
created[1]{key,name,state}:
  pr3,[TEST] MCP Stress Test Project v2,planned
```

**Implementation:**
1. In `create-projects.ts`, after successful Linear API call, register the new project(s) in the TOON registry
2. Include the assigned short key in the response

**Impact:** Saves 2-3 tool calls for any create→update workflow. Better UX, less context usage.

**Priority:** Medium — nice-to-have improvement, not blocking functionality.

---

### QUESTION: `show_issues_ui` Tool Purpose Unclear

**Observed in:** Step 26

**Problem:** The tool returns only a text message:
```
Opening Linear Issues Dashboard (filtered by state: started, assigned to you). The interactive UI will display below.
```

No UI actually renders in Claude Desktop. The tool doesn't return structured filter data — just prose.

**Questions:**
1. What MCP client is this tool designed for? (Not Claude Desktop)
2. Should this tool return structured filter data that a UI-capable client could render?
3. Is this tool needed at all, or should it be removed?

**Current Behavior:** Tool "works" (doesn't error) but provides no value in Claude Desktop.

**Recommendation:** Either:
- **A)** Document which clients support this tool's UI rendering
- **B)** Return structured filter data (JSON) that clients could use
- **C)** Remove the tool if no client supports it

**Priority:** Low — doesn't break anything, but takes up tool slot with no apparent value.

---

### BUG: `create_issues` Response Missing Project Field (Display Only)

**Observed in:** Step 29

**Problem:** When creating issues with `projectName: "[TEST] Q2 Data Pipeline v2"`, the `created[` response shows project field as empty:

```
created[3]{identifier,title,state,assignee,project,url}:
  SQT-224,[TEST] Design data pipeline architecture v2,s6,u0,,https://...
  SQT-225,[TEST] Set up ETL infrastructure v2,s6,u1,,https://...
```

**Verified:** Issues ARE correctly linked to project `pr4` in Linear. This is a **display-only bug** in the response encoding.

**Root Cause:** The `created[` response encoding doesn't look up the project short key for newly created issues, even though the project was successfully linked.

**Impact:** Low — functionality works, but response feedback is incomplete. Claude doesn't see confirmation that project was linked.

**Recommendation:** In `create-issues.ts`, after creating issues, look up and include the project short key in the `created[` response.

---

### Minor: `create_issues` Schema Confusion — `assigneeId` vs `assignee`

**Observed in:** Step 27

Claude first tried `assigneeId: "u0"` which failed with "assigneeId must be a UUID". Then corrected to `assignee: "u0"` which worked.

**Impact:** Minor — Claude self-corrected, but schema could be clearer.

**Recommendation:** Either remove `assigneeId` from schema or document that it requires UUID while `assignee` accepts short keys.

---

### Minor: `list_projects` User Role Field Blank

The `_users` lookup in `list_projects` shows all fields except `role`:

```
_users[2]{key,name,displayName,email,role}:
  u1,Ian Bastos,ian,i.bastos@atipikproperties.com,
  u2,Luis M. de Carvajal,l.carvajal,l.carvajal@atipikproperties.com,
```

**Impact:** Minor — role info unavailable in project user lookup. Core user identification (name, email) works.

**Note:** This is separate from BUG-11 which was about completely blank user fields. BUG-11 is fixed (name, displayName, email now populated).

---

## Cleanup

After testing, clean up test data:
1. In Linear, filter issues by `[TEST]` prefix
2. Archive or delete test issues created during testing:
   - Phase 4: SQT-206, SQT-207, SQT-208, SQT-209, SQT-210, SQT-211
   - Phase 7 bonus: SQT-215, SQT-216, SQT-217, SQT-218, SQT-219, SQT-220, SQT-221, SQT-222
   - Phase 9: SQT-223, SQT-224, SQT-225, SQT-226
3. Archive or delete test projects (`[TEST] MCP Stress Test Project v2`, `[TEST] Q2 Data Pipeline v2`)
