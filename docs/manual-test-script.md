# MCP Manual Test Script

Structured test prompts for Claude Desktop. Each step lists the prompt to give Claude, which tools should fire, and what to verify in the response.

**Prerequisites:** TOON_OUTPUT_ENABLED=true, server built and running via Claude Desktop.

**Convention:** Test data uses `[TEST]` prefix in titles so it's easy to spot and clean up in Linear's recents view.

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

### Step 2 — List teams
**Prompt:**
> What teams do we have?

**Expected tool(s):** `list_teams`

**Verify:**
- [ ] Returns team SQT (and any others)
- [ ] TOON format with `teams[` section
- [ ] Team keys shown (SQT, etc.)

### Step 3 — List users
**Prompt:**
> Who are all the users in our workspace?

**Expected tool(s):** `list_users`

**Verify:**
- [ ] All team members listed with names and emails
- [ ] Short keys assigned (u0, u1, u2...)
- [ ] Claude can reference users by name in its summary

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

### Step 8 — Search issues by keyword
**Prompt:**
> Search for issues related to "cognito" in team SQT

**Expected tool(s):** `list_issues` (with q: "cognito" or keywords: ["cognito"])

**Verify:**
- [ ] Issues mentioning cognito in title/description returned
- [ ] Relevant results (SQT-143, SQT-158, SQT-190, etc.)

### Step 9 — My issues
**Prompt:**
> What issues are assigned to me?

**Expected tool(s):** `list_my_issues`

**Verify:**
- [ ] Only issues assigned to you (Tobias) returned
- [ ] TOON format
- [ ] Reasonable set of issues

### Step 10 — Get specific issues in detail
**Prompt:**
> Give me full details on SQT-174 and SQT-155

**Expected tool(s):** `get_issues` (with ids: ["SQT-174", "SQT-155"])

**Verify:**
- [ ] Both issues returned with full descriptions (not truncated)
- [ ] TOON format with `issues[` section
- [ ] Attachments/URLs included if present
- [ ] Priority, estimate, assignee, project all shown

### Step 11 — Unassigned issues
**Prompt:**
> Are there any unassigned issues in the current sprint?

**Expected tool(s):** `get_sprint_context` or `list_issues` (with filter for no assignee + cycle)

**Verify:**
- [ ] Identifies unassigned issues (SQT-164 based on earlier data)
- [ ] Claude suggests assigning them

### Step 12 — High priority issues not started
**Prompt:**
> Show me any urgent or high priority issues that haven't been started yet

**Expected tool(s):** `list_issues` (with priority filter + state type filter)

**Verify:**
- [ ] Returns issues with priority 1-2 in backlog/unstarted states
- [ ] SQT-174 (Urgent, Todo) should appear
- [ ] Claude flags these as needing attention

---

## Phase 4: Issue Creation (mutations)

### Step 13 — Create a single test issue
**Prompt:**
> Create an issue in team SQT titled "[TEST] Verify MCP integration" with High priority, assigned to me, in the Todo state, with estimate 3

**Expected tool(s):** `create_issues`

**Verify:**
- [ ] Issue created successfully
- [ ] Identifier returned (SQT-XXX)
- [ ] Correct priority (2 = High)
- [ ] Assigned to you (short key resolution worked)
- [ ] State set to Todo (short key resolution worked)
- [ ] Estimate = 3
- [ ] URL to Linear issue provided

**Note the issue identifier — you'll use it in later steps.**

### Step 14 — Batch create with short keys
**Prompt:**
> Create 3 test issues in team SQT:
> 1. "[TEST] Frontend unit tests" — Medium priority, assigned to Ian, estimate 5, label "Improvement"
> 2. "[TEST] Backend API docs" — Low priority, assigned to Gonzalo, estimate 2
> 3. "[TEST] Security review checklist" — Urgent priority, estimate 8, label "Infrastructure", in project "MVP Sophiq Platform"

**Expected tool(s):** `create_issues` (batch of 3)

**Verify:**
- [ ] All 3 issues created (succeeded: 3)
- [ ] Correct assignees resolved (Claude should use short keys u1, u6 etc.)
- [ ] Correct priorities (3=Medium, 4=Low, 1=Urgent)
- [ ] Labels applied correctly
- [ ] Project assigned to issue 3
- [ ] All identifiers and URLs returned

**Note the identifiers for steps 16-18.**

### Step 15 — Create sub-issue
**Prompt:**
> Create a sub-issue under [SQT-XXX from step 13] titled "[TEST] Write test cases" with estimate 2, assigned to me

**Expected tool(s):** `create_issues` (with parentId)

**Verify:**
- [ ] Sub-issue created with parent relationship
- [ ] Parent identifier referenced in output

---

## Phase 5: Issue Updates (mutations on test issues only)

### Step 16 — Update state and priority
**Prompt:**
> Move [first issue from step 14] to "In Progress" and change priority to High

**Expected tool(s):** `update_issues`

**Verify:**
- [ ] State changed (short key resolved correctly)
- [ ] Priority changed to 2
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
- [ ] Label added incrementally (addLabelNames, not replacing all labels)
- [ ] State and estimate updated on second issue
- [ ] Diffs shown for both

### Step 18 — Update with due date
**Prompt:**
> Set a due date of 2026-02-15 on [issue from step 13]

**Expected tool(s):** `update_issues`

**Verify:**
- [ ] Due date set correctly
- [ ] Diff shows dueDate change

---

## Phase 6: Comments

### Step 19 — List comments on a real issue
**Prompt:**
> Show me the comments on SQT-157

**Expected tool(s):** `list_comments`

**Verify:**
- [ ] Multiple comments returned (this issue has a long thread)
- [ ] Comment authors shown with short keys or names
- [ ] Comment bodies and timestamps present
- [ ] TOON format with `comments[` section

### Step 20 — Add a comment
**Prompt:**
> Add a comment to [issue from step 13] saying "MCP integration test — this comment was added via the MCP server. Testing add_comments tool."

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

### Step 22 — Update a comment
**Prompt:**
> Update the comment you just added to [issue from step 13] — change it to "MCP integration test — UPDATED via update_comments tool."

**Expected tool(s):** `list_comments` (to find the comment ID) + `update_comments`

**Verify:**
- [ ] Claude first fetches comments to find the ID
- [ ] Comment body updated
- [ ] Verify in Linear that the comment text changed

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

### Step 24 — Create a test project
**Prompt:**
> Create a new project called "[TEST] MCP Stress Test Project" with a target date of 2026-03-31

**Expected tool(s):** `create_projects`

**Verify:**
- [ ] Project created successfully
- [ ] Project ID/name returned
- [ ] Target date set

### Step 25 — Update the test project
**Prompt:**
> Update the "[TEST] MCP Stress Test Project" — set its state to "started" and assign me as the lead

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
- [ ] Multiple tools chained naturally

### Step 29 — Project planning workflow
**Prompt:**
> We're planning a new workstream. Create a project called "[TEST] Q2 Data Pipeline" with target date 2026-06-30. Then create 3 issues in team SQT under that project:
> 1. "[TEST] Design data pipeline architecture" — High priority, estimate 8
> 2. "[TEST] Set up ETL infrastructure" — High priority, estimate 5
> 3. "[TEST] Create monitoring dashboard" — Medium priority, estimate 3
> Assign the first to me and the others to Ian.

**Expected tool(s):** `create_projects` → `create_issues` (batch of 3 with project reference)

**Verify:**
- [ ] Project created first
- [ ] All 3 issues created under that project
- [ ] Correct assignees (you and Ian)
- [ ] Correct priorities and estimates
- [ ] Project reference set on all issues
- [ ] Claude orchestrates the multi-step flow naturally

### Step 30 — Triage and update workflow
**Prompt:**
> Look at the test issues we created today. Move all the "[TEST]" issues that are still in Todo to "In Progress", and add a comment to each one saying "Moving to In Progress as part of MCP stress test."

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

| # | Tool | Tested In Steps |
|---|------|----------------|
| 1 | workspace_metadata | 1 |
| 2 | list_issues | 7, 8, 12, 28, 30 |
| 3 | get_issues | 10, 28 |
| 4 | list_my_issues | 9 |
| 5 | create_issues | 13, 14, 15, 27, 29 |
| 6 | update_issues | 16, 17, 18, 30 |
| 7 | list_projects | 23 |
| 8 | create_projects | 24, 29 |
| 9 | update_projects | 25 |
| 10 | list_teams | 2 |
| 11 | list_users | 3 |
| 12 | list_comments | 19, 22, 28 |
| 13 | add_comments | 20, 21, 30 |
| 14 | update_comments | 22 |
| 15 | list_cycles | 6 |
| 16 | get_sprint_context | 4, 5, 11, 27 |
| 17 | show_issues_ui | 26 |

All 17 tools covered.
