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
- [ ] TOON format output with `_meta{`, `_users[`, `_states[`, `_projects[`, `_teams[`, `_cycles[`
- [ ] All team members visible with short keys (u0, u1, u2...)
- [ ] All workflow states listed with short keys (s0, s1, s2...)
- [ ] Projects listed with short keys (pr0, pr1...)
- [ ] Team SQT visible with cycles enabled
- [ ] Claude summarizes the workspace clearly in natural language

**Bug Fix Verifications (BUG-1, BUG-2):**
- [ ] **BUG-1 FIXED:** `_meta{org,...}` shows organization name (not blank)
- [ ] **BUG-2 FIXED:** `_users` shows role column with "Admin", "Guest", or "Member" values (not blank)

### Step 2 — Teams discovery (UPDATED)
**Prompt:**
> What teams do we have?

**Expected tool(s):** `workspace_metadata` (or cached from Step 1)

**Verify:**
- [ ] Claude uses `workspace_metadata` data (NOT the removed `list_teams` tool)
- [ ] Team SQT (and any others) visible
- [ ] Team keys shown (SQT, etc.)

**Architecture Decision Verification (DECISION-1):**
- [ ] **DECISION-1 CONFIRMED:** `list_teams` tool is NOT available — Claude uses `workspace_metadata` instead

### Step 3 — Users discovery (UPDATED)
**Prompt:**
> Who are all the users in our workspace?

**Expected tool(s):** `workspace_metadata` (or cached from Step 1)

**Verify:**
- [ ] Claude uses `workspace_metadata` data (NOT the removed `list_users` tool)
- [ ] All team members listed with names and emails
- [ ] Short keys assigned (u0, u1, u2...)
- [ ] Claude can reference users by name in its summary

**Architecture Decision Verification (DECISION-1):**
- [ ] **DECISION-1 CONFIRMED:** `list_users` tool is NOT available — Claude uses `workspace_metadata` instead

---

## Phase 2: Sprint & Cycles

### Step 4 — Current sprint context
**Prompt:**
> Summarize the current sprint for team SQT. What's the health looking like?

**Expected tool(s):** `get_sprint_context` (with team: "SQT", cycle: "current")

**Verify:**
- [ ] TOON output with `_meta{`, `issues[`, `_gaps[`
- [ ] Gap analysis present (no_estimate, no_assignee, stale, blocked, priority_mismatch)
- [ ] Claude interprets the gaps and gives actionable insights
- [ ] Comments section present (if any issues have comments)
- [ ] Relations section present (if any blocking relationships exist)

**Enhancement Verifications (NOTE-1, NOTE-3, NOTE-4):**
- [ ] **NOTE-1 FIXED:** Descriptions with embedded images show `[N images]` count instead of raw markdown URLs
- [ ] **NOTE-3 ADDED:** Issues include `createdAt` (ISO timestamp) and `creator` (short key like u0) fields
- [ ] **NOTE-4 ADDED:** Priority shows as `p1`, `p2`, etc. (not bare numbers)
- [ ] **NOTE-4 ADDED:** Estimate shows as `e3`, `e5`, etc. (not bare numbers)
- [ ] **NOTE-4 ADDED:** Cycle shows as `c5`, `c6`, etc. (not bare numbers)

### Step 5 — Previous sprint
**Prompt:**
> How did the previous sprint go for SQT?

**Expected tool(s):** `get_sprint_context` (with cycle: "previous")

**Verify:**
- [ ] Different cycle number than step 4
- [ ] Issues from previous sprint (different set)
- [ ] Claude compares or summarizes completion

### Step 6 — List cycles
**Prompt:**
> What cycles does team SQT have? Show me all of them.

**Expected tool(s):** `list_cycles`

**Verify:**
- [ ] Cycles listed with numbers, dates, status
- [ ] TOON format with `cycles[` section
- [ ] Current/active cycle identifiable

**Bug Fix Verification (BUG-5):**
- [ ] **BUG-5 FIXED:** Cycles are in chronological order (descending: 7→6→5→4→3→2→1, NOT 7→6→5→4→2→3→1)

---

## Phase 3: Issue Querying

### Step 7 — List issues with filters
**Prompt:**
> Show me all in-progress issues for team SQT

**Expected tool(s):** `list_issues` (with team: "SQT", filter for state type "started")

**Verify:**
- [ ] Only issues in "In Progress" or "In Review" states returned
- [ ] TOON format with `issues[`, `_states[`, `_users[`
- [ ] Short keys used for states and assignees
- [ ] Comments and relations sections present

**Enhancement Verifications (NOTE-3, NOTE-4):**
- [ ] **NOTE-3 ADDED:** Issues include `createdAt` and `creator` fields
- [ ] **NOTE-4 ADDED:** Priority/estimate/cycle use prefixed format (p1, e5, c5)

### Step 8 — Search issues by keyword
**Prompt:**
> Search for issues related to "cognito" in team SQT

**Expected tool(s):** `list_issues` (with q: "cognito" or keywords: ["cognito"])

**Verify:**
- [ ] Issues mentioning cognito in title/description returned
- [ ] Relevant results (issues containing "cognito" text)

### Step 9 — My issues (UPDATED)
**Prompt:**
> What issues are assigned to me?

**Expected tool(s):** `list_issues` (with assignedToMe: true)

**Verify:**
- [ ] Claude uses `list_issues` with `assignedToMe: true` (NOT the removed `list_my_issues` tool)
- [ ] Only issues assigned to you returned
- [ ] TOON format
- [ ] Reasonable set of issues

**Architecture Decision Verification (DECISION-2):**
- [ ] **DECISION-2 CONFIRMED:** `list_my_issues` tool is NOT available — Claude uses `list_issues` + `assignedToMe: true` instead

### Step 10 — Get specific issues in detail
**Prompt:**
> Give me full details on SQT-174 and SQT-155

**Expected tool(s):** `get_issues` (with ids: ["SQT-174", "SQT-155"])

**Verify:**
- [ ] Both issues returned with full descriptions (not truncated)
- [ ] TOON format with `issues[` section
- [ ] Attachments/URLs included if present

**Bug Fix Verification (BUG-6):**
- [ ] **BUG-6 FIXED:** Priority field shows value (e.g., `p1` for Urgent) — NOT blank
- [ ] **BUG-6 FIXED:** Estimate field shows value (e.g., `e5`) — NOT blank
- [ ] **BUG-6 FIXED:** Cycle field shows value (e.g., `c5`) if assigned — NOT blank
- [ ] **BUG-6 FIXED:** Team field shows value (e.g., `SQT`) — NOT blank

### Step 11 — Unassigned issues
**Prompt:**
> Are there any unassigned issues in the current sprint?

**Expected tool(s):** `get_sprint_context` or `list_issues` (with filter for no assignee + cycle)

**Verify:**
- [ ] Identifies unassigned issues (if any)
- [ ] Claude suggests assigning them

### Step 12 — High priority issues not started
**Prompt:**
> Show me any urgent or high priority issues that haven't been started yet

**Expected tool(s):** `list_issues` (with priority filter + state type filter)

**Verify:**
- [ ] Returns issues with priority 1-2 in backlog/unstarted states
- [ ] Claude flags these as needing attention

**Enhancement Verification (NOTE-4 Input):**
- [ ] **NOTE-4 INPUT:** Claude can use `p1` or `p2` format for priority in filter (backwards compatible with numbers and names like "Urgent")

---

## Phase 4: Issue Creation (mutations)

### Step 13 — Create a single test issue
**Prompt:**
> Create an issue in team SQT titled "[TEST] Verify MCP integration v2" with High priority, assigned to me, in the Todo state, with estimate 3

**Expected tool(s):** `create_issues`

**Verify:**
- [ ] Issue created successfully
- [ ] Identifier returned (SQT-XXX)
- [ ] Correct priority (2 = High, shown as `p2`)
- [ ] Assigned to you (short key resolution worked)
- [ ] State set to Todo (short key resolution worked)
- [ ] Estimate = 3 (shown as `e3`)

**Enhancement Verifications (NOTE-6, NOTE-7):**
- [ ] **NOTE-6 FIXED:** `created[` response shows actual state assigned by Linear (e.g., `s0` for Todo or `s6` for Triage) — NOT blank
- [ ] **NOTE-7 FIXED:** `created[` response includes `url` field with Linear issue URL

**Note the issue identifier — you'll use it in later steps.**

### Step 14 — Batch create with short keys
**Prompt:**
> Create 3 test issues in team SQT:
> 1. "[TEST] Frontend unit tests v2" — Medium priority, assigned to Ian, estimate 5, label "Improvement"
> 2. "[TEST] Backend API docs v2" — Low priority, assigned to Gonzalo, estimate 2
> 3. "[TEST] Security review checklist v2" — Urgent priority, estimate 8, label "Infrastructure", in project "MVP Sophiq Platform"

**Expected tool(s):** `create_issues` (batch of 3)

**Verify:**
- [ ] All 3 issues created (succeeded: 3)
- [ ] Correct assignees resolved (Claude should use short keys u1, u6 etc.)
- [ ] Correct priorities (3=Medium/p3, 4=Low/p4, 1=Urgent/p1)
- [ ] Labels applied correctly
- [ ] Project assigned to issue 3
- [ ] All identifiers and URLs returned

**Enhancement Verification (NOTE-4 Input):**
- [ ] **NOTE-4 INPUT:** Claude can use `p1`, `p3`, `p4` format for priority (or numbers, or names — all accepted)
- [ ] **NOTE-4 INPUT:** Claude can use `e5`, `e2`, `e8` format for estimate (or numbers — both accepted)

**Note the identifiers for steps 16-18.**

### Step 15 — Create sub-issue
**Prompt:**
> Create a sub-issue under [SQT-XXX from step 13] titled "[TEST] Write test cases v2" with estimate 2, assigned to me

**Expected tool(s):** `create_issues` (with parentId)

**Verify:**
- [ ] Sub-issue created with parent relationship
- [ ] Parent identifier referenced in output

### Step 15b — Create issue with cycle assignment (NEW)
**Prompt:**
> Create an issue in team SQT titled "[TEST] Cycle assignment test" with estimate 3, and assign it to cycle 5

**Expected tool(s):** `create_issues` (with cycle: 5 or cycle: "c5")

**Verify:**
- [ ] Issue created successfully
- [ ] Issue is assigned to cycle 5 (verify in Linear UI)

**Bug Fix Verification (BUG-7):**
- [ ] **BUG-7 FIXED:** Cycle field is resolved and applied (NOT silently ignored)
- [ ] **NOTE-4 INPUT:** Claude can use `c5` format for cycle input (or bare number 5 — both accepted)

---

## Phase 5: Issue Updates (mutations on test issues only)

### Step 16 — Update state and priority
**Prompt:**
> Move [first issue from step 14] to "In Progress" and change priority to High

**Expected tool(s):** `update_issues`

**Verify:**
- [ ] State changed (short key resolved correctly)
- [ ] Priority changed to 2 (p2)
- [ ] Before/after diff shown in response
- [ ] Only the specified issue was modified

### Step 17 — Batch update with mixed changes
**Prompt:**
> Update these issues:
> - [second issue from step 14]: assign to Ian, add label "Bug"
> - [third issue from step 14]: move to "In Progress", change estimate to 5

**Expected tool(s):** `update_issues` (batch of 2)

**Verify:**
- [ ] Both updates succeeded
- [ ] Assignee resolved via short key
- [ ] State and estimate updated on second issue
- [ ] Diffs shown for both

**Bug Fix Verification (BUG-8):**
- [ ] **BUG-8 FIXED:** Label change appears in `changes[` section as `labels+` (additions) or `labels-` (removals)

### Step 18 — Update with due date
**Prompt:**
> Set a due date of 2026-02-15 on [issue from step 13]

**Expected tool(s):** `update_issues`

**Verify:**
- [ ] Due date set correctly
- [ ] Diff shows dueDate change

**Bug Fix Verification (BUG-8):**
- [ ] **BUG-8 FIXED:** `dueDate` change appears in `changes[` section (NOT missing)

---

## Phase 6: Comments

### Step 19 — List comments on a real issue
**Prompt:**
> Show me the comments on SQT-157

**Expected tool(s):** `list_comments`

**Verify:**
- [ ] Multiple comments returned (this issue has a long thread)
- [ ] Comment bodies and timestamps present
- [ ] TOON format with `comments[` section

**Bug Fix Verifications (BUG-9, BUG-10):**
- [ ] **BUG-9 FIXED:** Comment authors shown with names in `_users` lookup (NOT blank)
- [ ] **BUG-10 FIXED:** Comment `id` field present in each row (UUID for use with update_comments)

### Step 20 — Add a comment
**Prompt:**
> Add a comment to [issue from step 13] saying "MCP integration test v2 — this comment was added via the MCP server."

**Expected tool(s):** `add_comments`

**Verify:**
- [ ] Comment created successfully
- [ ] Comment ID returned
- [ ] Verify in Linear that the comment appears on the issue

### Step 21 — Batch add comments
**Prompt:**
> Add comments to these issues:
> - [first issue from step 14]: "Frontend tests should cover all components"
> - [second issue from step 14]: "API docs should follow OpenAPI spec"

**Expected tool(s):** `add_comments` (batch of 2)

**Verify:**
- [ ] Both comments created (succeeded: 2)
- [ ] Comments appear on correct issues

### Step 22 — Update a comment (NOW WORKING)
**Prompt:**
> Update the comment you just added to [issue from step 13] — change it to "MCP integration test v2 — UPDATED via update_comments tool."

**Expected tool(s):** `list_comments` (to find the comment ID) + `update_comments`

**Verify:**
- [ ] Claude first fetches comments to find the ID
- [ ] Claude can identify the correct comment ID from the `id` field
- [ ] Comment body updated successfully
- [ ] Verify in Linear that the comment text changed

**Bug Fix Verification (BUG-10):**
- [ ] **BUG-10 FIXED:** `update_comments` workflow is now FUNCTIONAL (no longer blocked by missing comment IDs)

---

## Phase 7: Projects

### Step 23 — List projects
**Prompt:**
> What projects do we have?

**Expected tool(s):** `list_projects`

**Verify:**
- [ ] Projects listed with names, states, leads
- [ ] TOON format with `projects[` section
- [ ] Short keys assigned (pr0, pr1...)

**Bug Fix Verification (BUG-11):**
- [ ] **BUG-11 FIXED:** `_users` lookup shows lead names, displayNames, emails (NOT blank fields like `u1,,,,`)

### Step 24 — Create a test project (NOW WORKING)
**Prompt:**
> Create a new project called "[TEST] MCP Stress Test Project v2" for team SQT with a target date of 2026-03-31

**Expected tool(s):** `create_projects`

**Verify:**
- [ ] Project created successfully (NOT failing with UUID error)
- [ ] Project ID/name returned
- [ ] Target date set

**Bug Fix Verification (BUG-12):**
- [ ] **BUG-12 FIXED:** Team key "SQT" is resolved to UUID internally — project creation works with TOON

### Step 25 — Update the test project
**Prompt:**
> Update the "[TEST] MCP Stress Test Project v2" — set its state to "started" and assign me as the lead

**Expected tool(s):** `update_projects`

**Verify:**
- [ ] State changed to "started"
- [ ] Lead set to you (short key resolution)
- [ ] Changes reflected in response

---

## Phase 8: Visual Dashboard

### Step 26 — Show UI dashboard
**Prompt:**
> Show me a visual dashboard of all in-progress issues assigned to me

**Expected tool(s):** `show_issues_ui`

**Verify:**
- [ ] Tool returns structured filter data
- [ ] Response mentions "Opening Linear Issues Dashboard"
- [ ] Filters include stateType: started, assignedToMe: true
- [ ] (If your client supports it) UI renders

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
- [ ] Sprint context fetched first
- [ ] Claude analyzes gaps (blocked, stale, priority_mismatch)
- [ ] Identifies specific action items
- [ ] Creates test issue(s) with relevant details
- [ ] Natural, useful standup summary produced

### Step 28 — Issue investigation workflow
**Prompt:**
> I want to understand the authentication work. Find all issues related to "login" or "cognito" or "auth", show me their details and any comments, and give me a summary of where things stand.

**Expected tool(s):** `list_issues` (search) → `get_issues` (details) → `list_comments` (on relevant issues)

**Verify:**
- [ ] Claude searches for auth-related issues
- [ ] Fetches full details on key issues
- [ ] Reads comments for context
- [ ] Produces a coherent summary of the auth work stream
- [ ] Multiple tools chained naturally (or single flexible call)

### Step 29 — Project planning workflow (NOW WORKING)
**Prompt:**
> We're planning a new workstream. Create a project called "[TEST] Q2 Data Pipeline v2" for team SQT with target date 2026-06-30. Then create 3 issues in team SQT under that project:
> 1. "[TEST] Design data pipeline architecture v2" — High priority, estimate 8
> 2. "[TEST] Set up ETL infrastructure v2" — High priority, estimate 5
> 3. "[TEST] Create monitoring dashboard v2" — Medium priority, estimate 3
> Assign the first to me and the others to Ian.

**Expected tool(s):** `create_projects` → `create_issues` (batch of 3 with project reference)

**Verify:**
- [ ] Project created first (team key "SQT" resolves correctly)
- [ ] All 3 issues created under that project
- [ ] Correct assignees (you and Ian)
- [ ] Correct priorities and estimates
- [ ] Project reference set on all issues
- [ ] Claude orchestrates the multi-step flow naturally

**Bug Fix Verification (BUG-12):**
- [ ] **BUG-12 FIXED:** This workflow is now FUNCTIONAL (was blocked by team key resolution)

### Step 30 — Triage and update workflow
**Prompt:**
> Look at the test issues we created today. Move all the "[TEST]" issues that are still in Todo to "In Progress", and add a comment to each one saying "Moving to In Progress as part of MCP stress test v2."

**Expected tool(s):** `list_issues` (search for [TEST]) → `update_issues` (batch state change) → `add_comments` (batch comments)

**Verify:**
- [ ] Claude finds the test issues
- [ ] Correctly identifies which are in Todo
- [ ] Batch updates states
- [ ] Batch adds comments to each
- [ ] Reports results clearly

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

| Bug ID | Description | Fix Verified In Step |
|--------|-------------|---------------------|
| BUG-1 | Empty org name in `_meta` | Step 1 |
| BUG-2 | User roles always blank | Step 1 |
| BUG-5 | Cycles out of chronological order | Step 6 |
| BUG-6 | `get_issues` missing priority/estimate/cycle/team | Step 10 |
| BUG-7 | `create_issues` cycle field ignored | Step 15b |
| BUG-8 | `changes[` diff incomplete (labels, dueDate) | Steps 17, 18 |
| BUG-9 | `list_comments` user field blank | Step 19 |
| BUG-10 | `list_comments` missing comment ID | Steps 19, 22 |
| BUG-11 | `list_projects` user lookup blank | Step 23 |
| BUG-12 | `create_projects` no team key resolution | Steps 24, 29 |

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

## Cleanup

After testing, clean up test data:
1. In Linear, filter issues by `[TEST]` prefix
2. Archive or delete test issues (SQT-XXX created during testing)
3. Archive or delete test projects (`[TEST] MCP Stress Test Project v2`, `[TEST] Q2 Data Pipeline v2`)
