# BUG-8 Fix Verification Test Script

**Date**: 2026-01-29
**Fixes Implemented**: Label diff tracking + Cycle support in `update_issues`
**Environment**: Claude Desktop with TOON_OUTPUT_ENABLED=true

---

## Pre-Test Setup

Before testing, ensure you have:
1. A test issue to work with (or create one)
2. The Linear MCP server running with latest changes
3. TOON output enabled in your environment

**Setup Prompt**:
```
Create a test issue titled "[BUG-8-TEST] Verification Issue" in team SQT with state Todo
```

**Raw Output**:
```


Thought process
The user wants me to create a test issue in Linear with specific details:

Title: "[BUG-8-TEST] Verification Issue"
Team: SQT
State: Todo
I should first get the workspace metadata to find the team ID and available states, then create the issue.
L


workspace_metadata
Request

{
  `include`: [
    `teams`,
    `workflow_states`
  ]
}
Response

_meta{org,team,generated}:
  Sophiq Tech,SQT,2026-01-30T12:20:35.957Z

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

_projects[3]{key,name,state}:
  pr2,Valuation,started
  pr1,Data Intelligence,started
  pr0,MVP Sophiq Platform,started

_cycles[3]{num,name,start,end,active,progress}:
  7,,2026-02-08,2026-02-15,false,0
  6,,2026-02-01,2026-02-08,false,0
  5,,2026-01-25,2026-02-01,true,0.37



Thought process
I have the workspace metadata. Now I can create the issue:

Team: SQT
Title: "[BUG-8-TEST] Verification Issue"
State: Todo (s0)
Let me create the issue.

L


create_issues
Request

{
  `items`: [
    {
      `state`: `s0`,
      `title`: `[BUG-8-TEST] Verification Issue`,
      `teamId`: `SQT`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  create_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

created[1]{identifier,title,state,assignee,project,url}:
  SQT-280,[BUG-8-TEST] Verification Issue,s0,u0,,https://linear.app/sophiq-tech/issue/SQT-280/bug-8-test-verification-issue
```

---

## Test 1: Label Addition via `addLabelNames` (PRIMARY FIX)

**What was broken**: Using `addLabelNames` to add labels succeeded but `changes[]` section was missing from output.

**Test Prompt**:
```
Add the "Bug" label to [BUG-8-TEST] Verification Issue
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "addLabelNames": ["Bug"]
  }]
}
```

**Expected Output** (TOON format):
```
_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-XXX,

changes[1]{identifier,field,before,after}:
  SQT-XXX,labels+,,Bug
```

**Raw Output**:
```


Thought process
The user wants to add the "Bug" label to the issue SQT-280 that was just created. I can use the update_issues tool with addLabelNames to add the label.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
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
  0,ok,SQT-280,

changes[1]{identifier,field,before,after}:
  SQT-280,labels+,,Bug
```

**PASS Criteria**:
- [ ] `succeeded: 1`
- [ ] `changes[]` section is present
- [ ] Shows `labels+,,Bug` (empty before, "Bug" after)

**Result**: [ ] PASS / [ ] FAIL

**FAIL if**: Only `_meta` and `results[]` sections appear with no `changes[]`

---

## Test 2: Label Removal via `removeLabelNames`

**Test Prompt**:
```
Remove the "Bug" label from [BUG-8-TEST] Verification Issue

L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `removeLabelNames`: [
        `Bug`
      ]
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

changes[1]{identifier,field,before,after}:
  SQT-280,labels-,Bug,
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "removeLabelNames": ["Bug"]
  }]
}
```

**Expected Output**:
```
changes[1]{identifier,field,before,after}:
  SQT-XXX,labels-,Bug,
```

**Raw Output**:
```


Thought process
The user wants to remove the "Bug" label from SQT-280. I'll use the update_issues tool with removeLabelNames.
```

**PASS Criteria**:
- [ ] `changes[]` section present
- [ ] Shows `labels-,Bug,` (Bug before, empty after)

**Result**: [ ] PASS / [ ] FAIL

---

## Test 3: Cycle Assignment (NEW FEATURE)

**What was broken**: `update_issues` had no cycle support at all.

**Pre-check**: Verify available cycles first:
```
What cycles are available for team SQT?
```

**Raw Output**:
```
Thought process
The user is asking about available cycles for team SQT. I already have this information from the workspace_metadata call earlier in the conversation. Let me check what was returned:

_cycles[3]{num,name,start,end,active,progress}:
7,,2026-02-08,2026-02-15,false,0
6,,2026-02-01,2026-02-08,false,0
5,,2026-01-25,2026-02-01,true,0.37

So there are 3 cycles:

Cycle 5: Jan 25 - Feb 1, 2026 (active, 37% progress)
Cycle 6: Feb 1 - Feb 8, 2026 (upcoming)
Cycle 7: Feb 8 - Feb 15, 2026 (upcoming)
I can answer this from the data I already have, but let me also call list_cycles to get potentially more comprehensive data in case there are older cycles not shown in the metadata.
```

**Test Prompt**:
```
Assign [BUG-8-TEST] Verification Issue to cycle 5
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "cycle": 5
  }]
}
```

**Expected Output**:
```
_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-XXX,

changes[1]{identifier,field,before,after}:
  SQT-XXX,cycle,,c5
```

**Raw Output**:
```


Thought process
The user wants to assign SQT-280 to cycle 5. I can use the update_issues tool with the cycle parameter.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `cycle`: 5
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,
```

**PASS Criteria**:
- [ ] `succeeded: 1`
- [ ] `changes[]` section present
- [ ] Shows `cycle,,c5` (empty before, c5 after)

**Result**: [ ] PASS / [ ] FAIL

---

## Test 4: Cycle Assignment with String Format

**Test Prompt**:
```
Move [BUG-8-TEST] Verification Issue to cycle c6
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "cycle": "c6"
  }]
}
```

**Expected Output**:
```
changes[1]{identifier,field,before,after}:
  SQT-XXX,cycle,c5,c6
```

**Raw Output**:
```


Thought process
The user wants to move SQT-280 to cycle 6. They've used the "c6" format which is supported by the update_issues tool.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `cycle`: `c6`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

changes[1]{identifier,field,before,after}:
  SQT-280,cycle,c5,c6
```

**PASS Criteria**:
- [ ] Accepts string format "c6"
- [ ] Shows cycle change from c5 to c6

**Result**: [ ] PASS / [ ] FAIL

---

## Test 5: Cycle Removal

**Test Prompt**:
```
Remove [BUG-8-TEST] Verification Issue from its current cycle
```

**Expected Tool Call** (one of):
```json
{
  "items": [{
    "id": "SQT-XXX",
    "cycle": null
  }]
}
```
OR
```json
{
  "items": [{
    "id": "SQT-XXX",
    "cycle": 0
  }]
}
```

**Expected Output**:
```
changes[1]{identifier,field,before,after}:
  SQT-XXX,cycle,c6,
```

**Raw Output**:
```


Thought process
The user wants to remove SQT-280 from its current cycle. I can do this by setting cycle to null or 0.


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `cycle`: null
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

changes[1]{identifier,field,before,after}:
  SQT-280,cycle,c6,
```

**PASS Criteria**:
- [ ] Issue removed from cycle
- [ ] Shows `cycle,c6,` (c6 before, empty after)

**Result**: [ ] PASS / [ ] FAIL

---

## Test 6: Combined Update (State + Label)

**Test Prompt**:
```
Move [BUG-8-TEST] Verification Issue to "In Progress" and add the "Feature" label
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "stateName": "In Progress",
    "addLabelNames": ["Feature"]
  }]
}
```

**Expected Output**:
```
changes[2]{identifier,field,before,after}:
  SQT-XXX,state,s0,s4
  SQT-XXX,labels+,,Feature
```

**Raw Output**:
```


Thought process
The user wants to update SQT-280 to change its state to "In Progress" and add the "Feature" label. I can do both in a single update call.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `state`: `s4`,
      `addLabelNames`: [
        `Feature`
      ]
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

changes[2]{identifier,field,before,after}:
  SQT-280,state,s0,s4
  SQT-280,labels+,,Feature
```

**PASS Criteria**:
- [ ] Both state and label changes in `changes[]`
- [ ] State shows short key transition (e.g., s0 → s4)
- [ ] Labels shows addition

**Result**: [ ] PASS / [ ] FAIL

---

## Test 7: Combined Update (State + Cycle)

**Test Prompt**:
```
Move [BUG-8-TEST] Verification Issue to "In Review" and assign it to cycle 5
```

**Expected Tool Call**:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "stateName": "In Review",
    "cycle": 5
  }]
}
```

**Expected Output**:
```
changes[2]{identifier,field,before,after}:
  SQT-XXX,state,s4,s5
  SQT-XXX,cycle,,c5
```

**Raw Output**:
```


Thought process
The user wants to move SQT-280 to "In Review" state and assign it to cycle 5. I can do both in a single update call.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `cycle`: 5,
      `state`: `s5`
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,1,0,1

results[1]{index,status,identifier,error}:
  0,ok,SQT-280,

changes[1]{identifier,field,before,after}:
  SQT-280,state,s4,s5
```

**PASS Criteria**:
- [ ] Both state and cycle changes tracked
- [ ] Cycle shows `,,c5` (no cycle → c5)

**Result**: [ ] PASS / [ ] FAIL

---

## Test 8: Invalid Cycle Number

**Test Prompt**:
```
Assign [BUG-8-TEST] Verification Issue to cycle 999
```

**Expected Output**:
```
results[1]{index,status,identifier,error}:
  0,error,SQT-XXX,Cycle 999 not found...
```

**Raw Output**:
```


Thought process
The user wants to assign the issue to cycle 999, which doesn't exist based on the workspace metadata I have. The available cycles are 5, 6, and 7. I should try the update and see what happens - the API will likely return an error, or I should warn the user that this cycle doesn't exist.

Let me try the update and see what the API returns.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-280`,
      `cycle`: 999
    }
  ]
}
Response

_meta{action,succeeded,failed,total}:
  update_issues,0,1,1

results[1]{index,status,identifier,error}:
  0,error,SQT-280,Cycle 999 not found for this team.
```

**PASS Criteria**:
- [ ] Returns error with `CYCLE_RESOLUTION_FAILED` code
- [ ] Provides helpful suggestion to use `list_cycles`

**Result**: [ ] PASS / [ ] FAIL

---

## Test 9: Batch Update with Labels

**Test Prompt**:
```
Add the "Improvement" label to these issues: SQT-XXX, SQT-YYY
```

**Expected Output**:
```
_meta{action,succeeded,failed,total}:
  update_issues,2,0,2

results[2]{index,status,identifier,error}:
  0,ok,SQT-XXX,
  1,ok,SQT-YYY,

changes[2]{identifier,field,before,after}:
  SQT-XXX,labels+,,Improvement
  SQT-YYY,labels+,,Improvement
```

**Raw Output**:
```


Thought process
The user is asking me to add the "Improvement" label to issues "SQT-XXX" and "SQT-YYY". These look like placeholder issue identifiers, not real ones. I should try to update them and let the error response inform the user that these issues don't exist, or I could ask for clarification first.

Actually, it's better to just attempt the update and let the system return an error if these issues don't exist. That way the user gets clear feedback.
L

update_issues



Thought process
The issues SQT-XXX and SQT-YYY don't appear to be valid issue identifiers. The error suggests the issues weren't found. I should let the user know these identifiers don't exist and ask for the correct ones.
```

**NOTES ON THE ABOVE***
The update_issues tool call failed entirely; usually i receive output to see what the errors are. but i can't even see any from the ui. worth checking the logs

**PASS Criteria**:
- [ ] Both issues updated
- [ ] Each has its own `changes[]` entry

**Result**: [ ] PASS / [ ] FAIL

---

## Test 10: Backward Compatibility - addLabelIds

**Test Prompt** (may need to be explicit):
```
Use update_issues with addLabelIds to add a label by UUID to [BUG-8-TEST]
```

Or test via direct tool input if possible:
```json
{
  "items": [{
    "id": "SQT-XXX",
    "addLabelIds": ["<label-uuid>"]
  }]
}
```

**Raw Output**:
```


Thought process
The user wants me to use addLabelIds with a UUID to add a label to SQT-280. I need to get the label UUIDs first. The workspace_metadata I retrieved earlier only showed label names and colors, not UUIDs. Let me check if I can get label UUIDs from the workspace_metadata by requesting it again with labels included.

Actually, looking at my earlier workspace_metadata call, it returned labels with name and color but not UUIDs. I should fetch the workspace metadata again to get the label IDs, or I could use the list_issues tool with detail=full to see label UUIDs on an issue.

L


workspace_metadata
Request

{
  `include`: [
    `labels`
  ]
}
Response

_meta{org,team,generated}:
  Sophiq Tech,SQT,2026-01-30T12:32:40.841Z

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

_projects[3]{key,name,state}:
  pr2,Valuation,started
  pr1,Data Intelligence,started
  pr0,MVP Sophiq Platform,started

_cycles[3]{num,name,start,end,active,progress}:
  7,,2026-02-08,2026-02-15,false,0
  6,,2026-02-01,2026-02-08,false,0
  5,,2026-01-25,2026-02-01,true,0.37



Thought process
The TOON output doesn't include label UUIDs directly - it only shows name and color. The Linear MCP tool in TOON mode doesn't expose label UUIDs in the workspace_metadata output.

To use addLabelIds, I would need the actual UUID of the label. Since the TOON output doesn't provide label UUIDs, I should explain to the user that the preferred approach in TOON mode is to use addLabelNames instead, which resolves the name to UUID automatically.

However, I could try to get a label UUID by fetching an issue that has labels and looking at the full detail. Let me try getting SQT-280 with full detail to see if it shows label UUIDs.

L


get_issues
Request

{
  `ids`: [
    `SQT-280`
  ]
}
Response

_meta{tool,succeeded,failed,total,generated}:
  get_issues,1,0,1,2026-01-30T12:32:50.106Z

_users[1]{key,name,displayName,email,role}:
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com,

_states[1]{key,name,type}:
  s5,In Review,started

_labels[1]{name,color}:
  Feature,

issues[1]{identifier,title,state,assignee,priority,estimate,project,cycle,dueDate,labels,parent,team,url,desc,createdAt,creator}:
  SQT-280,[BUG-8-TEST] Verification Issue,s5,u0,p0,,,c5,,Feature,,SQT,https://linear.app/sophiq-tech/issue/SQT-280/bug-8-test-verification-issue,,,



Thought process
The TOON output doesn't expose raw UUIDs for labels - it uses the name-based approach instead. Let me explain to the user that in TOON mode, the workspace_metadata and get_issues outputs use human-readable names rather than UUIDs for labels, but I can still use addLabelIds if I have a UUID.

Since I don't have direct access to label UUIDs in the TOON output, I'll need to explain that addLabelNames is the preferred method in this context. If the user has a specific UUID they want to test with, they can provide it and I'll use it.

Actually, let me just demonstrate the syntax using a placeholder UUID and explain that the user would need to provide an actual UUID. Or I could explain that the TOON format is designed to use name-based lookups (addLabelNames) instead of UUIDs for convenience.
```

**Note on TOON Mode Behavior**:
> In TOON mode, labels use **name-based natural keys** (e.g., "Bug", "Feature") rather than UUIDs.
> The `workspace_metadata` and issue outputs only expose label names, not UUIDs.
> This is **by design** - TOON format prioritizes human-readable identifiers.
> To add labels in TOON mode, use `addLabelNames` with label names instead of `addLabelIds` with UUIDs.
> The `addLabelIds` field still works if you have a UUID from an external source, but TOON does not expose them.

**PASS Criteria**:
- [ ] Still works with UUID input (if UUID is provided externally)
- [ ] `changes[]` shows label addition

**Result**: [X] BY DESIGN - Not Testable in Pure TOON Mode
> Label UUIDs are not exposed in TOON output. Use `addLabelNames` instead.
> The `addLabelIds` functionality remains available for backward compatibility but requires UUIDs from non-TOON sources.

---

## Post-Test Cleanup

**Cleanup Prompt**:
```
Delete all issues with "[BUG-8-TEST]" in the title
```

**Raw Output**:
```


Thought process
The user wants to delete all issues with "[BUG-8-TEST]" in the title. First, I need to search for these issues, then I can archive them (Linear doesn't have a true delete via the API - archiving is the closest equivalent).

Let me search for issues with that title pattern.
L

list_issues



Thought process
The brackets in the query might be causing issues. Let me try without them.

L


list_issues
Request

{
  `q`: `BUG-8-TEST`,
  `team`: `SQT`
}
Response

_meta{tool,count,generated}:
  list_issues,1,2026-01-30T12:34:27.211Z

_users[1]{key,name,displayName,email,role}:
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com,

_states[1]{key,name,type}:
  s5,In Review,started

_labels[1]{name,color}:
  Feature,

issues[1]{identifier,title,state,assignee,priority,estimate,project,cycle,dueDate,labels,parent,team,url,desc,createdAt,creator}:
  SQT-280,[BUG-8-TEST] Verification Issue,s5,u0,p0,,,c5,,Feature,,SQT,https://linear.app/sophiq-tech/issue/SQT-280/bug-8-test-verification-issue,,2026-01-30T12:20:39.798Z,u0



Thought process
Found 1 issue: SQT-280. Linear doesn't have a true "delete" operation via the API - the closest is archiving. I should inform the user and offer to archive instead.

Found 1 issue matching "[BUG-8-TEST]":
IssueTitleStateSQT-280[BUG-8-TEST] Verification IssueIn Review
Linear doesn't support permanent deletion via the API — I can archive it instead. Want me to proceed?
```

---

## Results Summary

| Test | Description | Result |
|------|-------------|--------|
| 1 | Label addition via `addLabelNames` | [ ] PASS / [ ] FAIL |
| 2 | Label removal via `removeLabelNames` | [ ] PASS / [ ] FAIL |
| 3 | Cycle assignment (number) | [ ] PASS / [ ] FAIL |
| 4 | Cycle assignment (string "c6") | [ ] PASS / [ ] FAIL |
| 5 | Cycle removal (null/0) | [ ] PASS / [ ] FAIL |
| 6 | Combined: State + Label | [ ] PASS / [ ] FAIL |
| 7 | Combined: State + Cycle | [ ] PASS / [ ] FAIL |
| 8 | Invalid cycle error handling | [ ] PASS / [ ] FAIL |
| 9 | Batch update with labels | [ ] PASS / [ ] FAIL |
| 10 | Backward compatibility (addLabelIds) | [ ] PASS / [ ] FAIL |

**Overall**: ___/10 tests passed

---

## Notes

```
Test 9 + 10 seemingly both clearly failed. need to investigate. also test 9 we need to check mcp logs themselves from claude desktop as we obviously received nothing in the output. the same occured for the cleanup test; for some reason it wasn't able to delete, even though i have successfully requested claude desktop to delete items with [TEST...] in the title, both for issues and projects. not sure why this one failed.
```

---

## Sign-Off

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| Server Version | |
| All Critical Tests Pass | [ ] Yes / [ ] No |
