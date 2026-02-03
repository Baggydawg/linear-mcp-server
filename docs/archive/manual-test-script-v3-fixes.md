# MCP Manual Test Script v3 — Fix Verification

**Purpose:** Verify the bug fixes and enhancements implemented in the 2026-01-29 session.

**Prerequisites:**
- `TOON_OUTPUT_ENABLED=true`
- Server built and running via Claude Desktop
- Linear workspace with team "SQT"
- Run `workspace_metadata` first to initialize the registry

**Convention:** Test data uses `[TEST-v3]` prefix for easy cleanup.

---

## Summary of Fixes to Verify

| Phase | Bug/Enhancement | What Changed |
|-------|----------------|--------------|
| Phase 1 | BUG-9: Comments user field blank | External/deactivated users now get `ext0`, `ext1` keys |
| Phase 2 | BUG-8: Diff tracking for name-based inputs | `labelNames`, `stateName`, `assigneeName`, `projectName` now tracked |
| Phase 3 | New projects missing short keys | `registerNewProject()` auto-assigns keys immediately |
| Phase 4 | Project field blank in create_issues | Auto-resolved by Phase 3 |
| Phase 5 | User role field blank | Users now show `admin` or `member` role |
| Phase 6 | show_issues_ui removal | Tool removed (13 tools total) |

---

## Test 1: Phase 5 — User Role Field

**Prompt:**
> Give me a workspace overview

**Expected tool(s):** `workspace_metadata`

**Verify:**
- [ ] `_users[` section has `role` column
- [ ] Role values show `admin` or `member` (not blank)

**Paste actual response here:**
```


Thought process
The user wants a workspace overview in Linear. I should use the workspace_metadata tool to get comprehensive information about their Linear workspace including teams, workflow states, labels, projects, and profile information.
L


workspace_metadata
Request

{
  `include`: [
    `profile`,
    `teams`,
    `workflow_states`,
    `labels`,
    `projects`,
    `favorites`
  ]
}
Response

_meta{org,team,generated}:
  Sophiq Tech,SQT,2026-01-29T18:31:21.151Z

_teams[1]{key,name,cyclesEnabled,cycleDuration,estimationType}:
  SQT,Tech,true,1,fibonacci

_users[7]{key,name,displayName,email,role}:
  u6,Gonzalo Verdugo,gonzalo,gonzalo@galileo14.com,Admin
  u5,Juan Pablo Carbonell,jp.carbonell,jp.carbonell@atipikproperties.com,Admin
  u4,Guerson Meyer,g.meyer,g.meyer@atipikproperties.com,Admin
  u3,Ismael Osuna,ismaeloa,osuna.ismael@gmail.com,Admin
  u2,Luis M. de Carvajal,l.carvajal,l.carvajal@atipikproperties.com,Admin
  u1,Ian Bastos,ian,i.bastos@atipikproperties.com,Admin
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com,Admin

_states[7]{key,name,type}:
  s0,Todo,unstarted
  s1,Done,completed
  s2,Canceled,canceled
  s3,Backlog,backlog
  s4,In Progress,started
  s5,In Review,started
  s6,Triage,triage

_labels[9]{name,color}:
  Infrastructure,#26b5ce
  Design,#5e6ad2
  Tech Debt,#F2994A
  Orga,#f7c8c1
  Data,#4cb782
  Research,#5e6ad2
  Feature,#BB87FC
  Bug,#EB5757
  Improvement,#4EA7FC

_projects[5]{key,name,state}:
  pr4,[TEST] Q2 Data Pipeline v2,backlog
  pr3,[TEST] MCP Stress Test Project v2,started
  pr2,Valuation,backlog
  pr1,Data Intelligence,backlog
  pr0,MVP Sophiq Platform,started

_cycles[3]{num,name,start,end,active,progress}:
  7,,2026-02-08,2026-02-15,false,0
  6,,2026-02-01,2026-02-08,false,0
  5,,2026-01-25,2026-02-01,true,0.37
```

---

## Test 2: Phase 1 — Comments User Field (BUG-9)

**Prompt:**
> Show me the comments on SQT-157

**Expected tool(s):** `list_comments`

**Verify:**
- [ ] `_users[` section appears (if external/deactivated users exist)
- [ ] User field in `comments[` is NOT blank
- [ ] Users show short keys like `u0`, `u1`, or `ext0` for external users

**Paste actual response here:**
```


Thought process
The user wants to see comments on issue SQT-157. I'll use the list_comments function to fetch the comments for this issue.
L


list_comments
Request

{
  `issueId`: `SQT-157`
}
Response

_meta{tool,issue,count,generated}:
  list_comments,SQT-157,17,2026-01-29T18:31:55.782Z

comments[17]{id,issue,user,body,createdAt}:
  76e01c49-892d-41c9-b9c3-d455439352c1,SQT-157,,"**Solution:**\nCopy the AWS Cognito configuration block (`VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`) and the `VITE_S3_CACHE_URL` line from your `.env.development` file into your `.env` file, then restart the dev server.",2026-01-26T11:34:36.210Z
  f0f076c2-46ab-4d95-9ed2-562db1af3981,SQT-157,,no worries! Let me know if you need anything else🙌,2026-01-26T11:34:18.527Z
  3ff6e247-4810-472d-ae3f-4f89a0bde3d4,SQT-157,,ok that works! gonna delete the screenshots above as they contain keys just fyi. thanks gonzalo i’ll resolve the issue on linear now,2026-01-26T11:33:48.045Z
  f1fd0bdd-83cb-43c9-9b3e-81463b81b7f3,SQT-157,,"ahh right, i’m just missing the cognito configuration. i’ll add that into .env",2026-01-26T11:31:37.208Z
  a4d2faf5-89e9-4212-90e8-59354b62ca20,SQT-157,,but the app loads only the .env values if i am not mistaken,2026-01-26T11:28:03.628Z
  8d5f9c3c-e77b-4ab4-8980-080b483c7668,SQT-157,,yeah,2026-01-26T11:27:35.279Z
  4f4a7ef9-4c30-4882-9190-d6e3f355cf86,SQT-157,,ok,2026-01-26T11:26:54.810Z
  ce9c69b4-c92e-429e-beb1-0d2b4274b93f,SQT-157,,ahhh,2026-01-26T11:26:54.245Z
  52daf0a0-dd60-4acd-b23d-e62c3aaa2671,SQT-157,,copy&paste the values in the .[evn.dev](<http://evn.dev>) file,2026-01-26T11:26:45.616Z
  f7f95b1c-f04e-4c42-9a7b-5463d9807077,SQT-157,,@gonzalo,2026-01-26T11:25:53.497Z
  b44a8c52-b521-4816-aa09-d63d4a4a07ea,SQT-157,,let me check,2026-01-26T11:24:35.966Z
  baa6a9d3-57d0-408c-a671-f50c5b6d94d6,SQT-157,,i haven’t,2026-01-26T11:24:30.536Z
  28b33b1c-cf4c-4476-871d-0a7446b5004d,SQT-157,,you have the development values in .env.development,2026-01-26T11:24:17.471Z
  9ef183f6-8c9e-4ebd-a2a2-4299a13387fc,SQT-157,,@tobias have you configured the env vars in your .env file??,2026-01-26T11:24:01.319Z
  b78763b2-85bf-4ca7-8b4b-d70b848c6bcd,SQT-157,,I'll check it,2026-01-26T10:18:45.420Z
  8adbf8c9-b011-460e-ab99-3638ab328690,SQT-157,,just as an FYI @gonzalo Linear syncs messages on slack with comments on the Linear issue itself 👌 keeps everything connected / tracked,2026-01-26T09:17:17.156Z
  a84cac83-db3e-4e7e-a736-6ffb42f7e096,SQT-157,,This comment thread is synced to a corresponding [thread in Slack](https://sophiqproperties.slack.com/archives/C0A8NBEGY74/p1769418062969489?thread_ts=1769418062.969489&cid=C0A8NBEGY74). All replies are displayed in both locations.,2026-01-26T09:10:00.622Z
```

**Bug Fix Verification:**
- [ ] **BUG-9 FIXED:** User field populated (was blank before)

---

## Test 3: Phase 2 — Diff Tracking for Name-Based Inputs (BUG-8)

### Test 3a: Label change via name

**Prompt:**
> Create a test issue: title "[TEST-v3] Label diff test", team SQT

Then:
> Add the "Bug" label to [TEST-v3] Label diff test

**Expected tool(s):** `create_issues`, then `update_issues`

**Verify:**
- [ ] `changes[` section shows `labels+` change
- [ ] Label addition is tracked in diff

**Paste actual response here:**
```


Thought process
The user wants to create a test issue with a specific title in the SQT team.
L


create_issues
Request

{
  `items`: [
    {
      `title`: `[TEST-v3] Label diff test`,
      `teamId`: `SQT`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-244,

created[1]{identifier,title,state,assignee,project,url}:
  SQT-244,[TEST-v3] Label diff test,s6,u0,,https://linear.app/sophiq-tech/issue/SQT-244/test-v3-label-diff-test
  Add the "Bug" label to [TEST-v3] Label diff test
19:32

Hide steps

Thought process
The user wants to add the "Bug" label to the issue we just created (SQT-244). I'll use the update_issues tool with addLabelNames to add the label incrementally.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-244`,
      `addLabelNames`: [
        `Bug`
      ]
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-244,

changes[1]{identifier,field,before,after}:
  SQT-244,labels+,,Bug
```

**Bug Fix Verification:**
- [ ] **BUG-8 FIXED:** Label change appears in `changes[` (was missing before)

### Test 3b: State change via name

**Prompt:**
> Move [TEST-v3] Label diff test to "In Progress"

**Expected tool(s):** `update_issues` with `stateName: "In Progress"`

**Verify:**
- [ ] `changes[` section shows `state` change
- [ ] Before/after values shown

**Paste actual response here:**
```


Thought process
The user wants to move the test issue SQT-244 to "In Progress" state.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-244`,
      `stateName`: `In Progress`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-244,

changes[1]{identifier,field,before,after}:
  SQT-244,state,s6,s4
```

**Bug Fix Verification:**
- [ ] **BUG-8 FIXED:** State change via `stateName` appears in `changes[`

### Test 3c: Assignee change via name

**Prompt:**
> Assign [TEST-v3] Label diff test to Ian

**Expected tool(s):** `update_issues` with `assigneeName: "Ian"`

**Verify:**
- [ ] `changes[` section shows `assignee` change
- [ ] Before/after short keys shown (e.g., `u0` → `u1`)

**Paste actual response here:**
```


Thought process
The user wants to assign the test issue SQT-244 to Ian. From the workspace metadata, I can see Ian Bastos is u1.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-244`,
      `assignee`: `u1`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-244,

changes[1]{identifier,field,before,after}:
  SQT-244,assignee,u0,u1
```

**Bug Fix Verification:**
- [ ] **BUG-8 FIXED:** Assignee change via `assigneeName` appears in `changes[`

---

## Test 4: Phase 3 & 4 — New Project Short Keys

This tests that newly created projects get short keys immediately without needing `forceRefresh`.

### Test 4a: Create project and verify short key

**Prompt:**
> Create a project called "[TEST-v3] Immediate Key Project" for team SQT

**Expected tool(s):** `create_projects`

**Verify:**
- [ ] `created[` section shows the new project
- [ ] `key` field has a short key (e.g., `pr5`) — NOT blank
- [ ] No need for `workspace_metadata({ forceRefresh: true })`

**Paste actual response here:**
```


Thought process
The user wants to create a project with the name "[TEST-v3] Immediate Key Project" for team SQT.
L


create_projects
Request

{
  `items`: [
    {
      `name`: `[TEST-v3] Immediate Key Project`,
      `teamId`: `SQT`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_projects,1,0,1

results[1]{index,status,key,error}:
  0,ok,,

created[1]{key,name,state}:
  ,[TEST-v3] Immediate Key Project,planned
```

**Bug Fix Verification:**
- [ ] **Phase 3 FIXED:** New project has immediate short key (was blank before)

### Test 4b: Create issues in new project

**Prompt:**
> Create an issue "[TEST-v3] Issue in new project" for team SQT, assign it to the "[TEST-v3] Immediate Key Project" project

**Expected tool(s):** `create_issues` with project reference

**Verify:**
- [ ] Issue created successfully
- [ ] `created[` section shows `project` field with short key (e.g., `pr5`) — NOT blank
- [ ] The project short key matches what was assigned in Test 4a

**Paste actual response here:**
```


Thought process
The user wants to create an issue and assign it to the project we just created. I need to use the project name since I don't have a project ID from the creation. I can use the projectName parameter to resolve it.
L


create_issues
Request

{
  `items`: [
    {
      `title`: `[TEST-v3] Issue in new project`,
      `teamId`: `SQT`,
      `projectName`: `[TEST-v3] Immediate Key Project`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-245,

created[1]{identifier,title,state,assignee,project,url}:
  SQT-245,[TEST-v3] Issue in new project,s6,u0,,https://linear.app/sophiq-tech/issue/SQT-245/test-v3-issue-in-new-project
```

**Bug Fix Verification:**
- [ ] **Phase 4 FIXED:** Project field in created issues is NOT blank (was blank before)

---

## Test 5: Phase 6 — show_issues_ui Removal

**Prompt:**
> What tools do you have available?

Or try to trigger the old tool:
> Show me issues in a visual dashboard

**Verify:**
- [ ] `show_issues_ui` tool is NOT in the tool list
- [ ] Claude uses alternative approaches (list_issues, etc.)
- [ ] Total tool count is 13

**Paste actual response here:**
```
Thought process
The user is asking about the tools I have available. Let me provide a helpful overview of the tools I can use.

Here's what I have available:

Linear
workspace_metadata — Get teams, users, workflow states, labels, projects, cycles
list_issues — Search/filter issues with keywords, states, assignees, projects, cycles
get_issues — Fetch detailed info on specific issues by ID
create_issues — Create new issues (batch up to 50)
update_issues — Update issues: state, assignee, labels, priority, project, etc.
list_comments / add_comments / update_comments — Manage issue comments
list_cycles — List sprints for a team
get_sprint_context — Comprehensive sprint data with gap analysis
list_projects / create_projects / update_projects — Manage projects
```
**Bug Fix Verification:**
- [ ] **Phase 6 COMPLETE:** `show_issues_ui` tool removed

---

## Test 6: Multi-Step Workflow (Comprehensive)

This tests the complete fix chain in a realistic workflow.

**Prompt:**
> Let's test the full workflow:
> 1. Create a project "[TEST-v3] Full Workflow Project" for team SQT
> 2. Create 2 issues in that project:
>    - "[TEST-v3] Task Alpha" — High priority, estimate 5, assign to me
>    - "[TEST-v3] Task Beta" — Medium priority, estimate 3, assign to Ian
> 3. Move Task Alpha to "In Progress" and add the "Bug" label
> 4. Show me a summary of what was created

**Expected tool(s):** `create_projects` → `create_issues` → `update_issues` → `list_issues`

**Verify:**
- [ ] Project created with immediate short key (Phase 3)
- [ ] Issues created with project field populated (Phase 4)
- [ ] State change tracked in diff (Phase 2)
- [ ] Label change tracked in diff (Phase 2)
- [ ] User roles visible in any user lookups (Phase 5)

**Paste actual responses here:**
```


Thought process
The user wants to test a full workflow with multiple steps. Let me break this down:

Create a project "[TEST-v3] Full Workflow Project" for team SQT
Create 2 issues in that project with specific attributes
Update Task Alpha (move to In Progress, add Bug label)
Show a summary
I can batch some of these operations:

Step 1: Create project
Step 2: Create both issues in one call
Step 3: Update Task Alpha
Step 4: Summarize
Let me start with step 1.
L


create_projects
Request

{
  `items`: [
    {
      `name`: `[TEST-v3] Full Workflow Project`,
      `teamId`: `SQT`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_projects,1,0,1

results[1]{index,status,key,error}:
  0,ok,,

created[1]{key,name,state}:
  ,[TEST-v3] Full Workflow Project,planned


Thought process
Project created. Now I'll create both issues in a single batch call.
L


create_issues
Request

{
  `items`: [
    {
      `title`: `[TEST-v3] Task Alpha`,
      `teamId`: `SQT`,
      `assignee`: `u0`,
      `estimate`: 5,
      `priority`: `High`,
      `projectName`: `[TEST-v3] Full Workflow Project`
    },
    {
      `title`: `[TEST-v3] Task Beta`,
      `teamId`: `SQT`,
      `assignee`: `u1`,
      `estimate`: 3,
      `priority`: `Medium`,
      `projectName`: `[TEST-v3] Full Workflow Project`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_issues,2,0,2

results[2]{index,status,identifier,error}:
  0,ok,SQT-246,
  1,ok,SQT-247,

created[2]{identifier,title,state,assignee,project,url}:
  SQT-246,[TEST-v3] Task Alpha,s6,u0,,https://linear.app/sophiq-tech/issue/SQT-246/test-v3-task-alpha
  SQT-247,[TEST-v3] Task Beta,s6,u1,,https://linear.app/sophiq-tech/issue/SQT-247/test-v3-task-beta


Thought process
Both issues created. Now I'll update Task Alpha (SQT-246) to move it to In Progress and add the Bug label.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-246`,
      `stateName`: `In Progress`,
      `addLabelNames`: [
        `Bug`
      ]
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-246,

changes[2]{identifier,field,before,after}:
  SQT-246,state,s6,s4
  SQT-246,labels+,,Bug


Thought process
All done. Let me summarize what was created.
```

---

## Cleanup

After testing, clean up test data in Linear:
- Archive or delete all issues with `[TEST-v3]` prefix
- Archive the `[TEST-v3]` projects

---

## Results Summary

| Test | Phase | Bug/Fix | Status |
|------|-------|---------|--------|
| Test 1 | Phase 5 | User role field | [ ] Pass / [ ] Fail |
| Test 2 | Phase 1 | BUG-9: Comments user field | [ ] Pass / [ ] Fail |
| Test 3a | Phase 2 | BUG-8: Label diff tracking | [ ] Pass / [ ] Fail |
| Test 3b | Phase 2 | BUG-8: State diff tracking | [ ] Pass / [ ] Fail |
| Test 3c | Phase 2 | BUG-8: Assignee diff tracking | [ ] Pass / [ ] Fail |
| Test 4a | Phase 3 | New project short keys | [ ] Pass / [ ] Fail |
| Test 4b | Phase 4 | Project field in create_issues | [ ] Pass / [ ] Fail |
| Test 5 | Phase 6 | show_issues_ui removal | [ ] Pass / [ ] Fail |
| Test 6 | All | Multi-step workflow | [ ] Pass / [ ] Fail |

**Overall Result:** [ ] All Fixes Verified / [ ] Issues Found

**Notes:**
```
(any observations or issues found during testing)
```
