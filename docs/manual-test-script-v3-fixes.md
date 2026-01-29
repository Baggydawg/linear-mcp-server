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
(paste workspace_metadata response showing _users section)
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
(paste list_comments response)
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
(paste update_issues response for label change)
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
(paste update_issues response for state change)
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
(paste update_issues response for assignee change)
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
(paste create_projects response)
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
(paste create_issues response)
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
(paste each tool response)
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
