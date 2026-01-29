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
The user wants me to create a test issue in Linear with a specific title and state. Let me create this issue using the Linear create_issues tool.
L


create_issues
Request

{
  `items`: [
    {
      `title`: `[BUG-8-TEST] Verification Issue`,
      `teamId`: `SQT`,
      `stateName`: `Todo`
    }
  ]
}
Response

Created issues: 1 / 1. OK: SQT-277.

- [SQT-277 — [BUG-8-TEST] Verification Issue](https://linear.app/sophiq-tech/issue/SQT-277/bug-8-test-verification-issue) — state Todo; priority 0; assignee Tobias Nilsson

Tip: Use list_issues to verify details, or update_issues to modify.
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
The user wants to add the "Bug" label to the issue SQT-277 that was just created. I'll use the update_issues tool with addLabelNames to add the Bug label.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-277`,
      `addLabelNames`: [
        `Bug`
      ]
    }
  ]
}
Response

Updated issues: 1 / 1. OK: SQT-277.

- [SQT-277 — [BUG-8-TEST] Verification Issue](https://linear.app/sophiq-tech/issue/SQT-277/bug-8-test-verification-issue) (id 1480a4ca-e9b2-41b2-8772-80403faa4246)
  Labels: +Bug

Tip: Use list_issues to verify changes.
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
The user wants to remove the "Bug" label from issue SQT-277. I'll use the update_issues function with removeLabelNames parameter.
L


update_issues
Request

{
  `items`: [
    {
      `id`: `SQT-277`,
      `removeLabelNames`: [
        `Bug`
      ]
    }
  ]
}
Response

Updated issues: 1 / 1. OK: SQT-277.

- [SQT-277 — [BUG-8-TEST] Verification Issue](https://linear.app/sophiq-tech/issue/SQT-277/bug-8-test-verification-issue) (id 1480a4ca-e9b2-41b2-8772-80403faa4246)
  Labels: −Bug

Tip: Use list_issues to verify changes.
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

**Pre-check Raw Output**:
```


Thought process
The user wants to know what cycles are available for team SQT. I should use the list_cycles tool to get this information.
L


list_cycles
Request

{
  `teamId`: `SQT`
}
Response

_meta{tool,team,count,generated}:
  list_cycles,SQT,7,2026-01-29T22:24:14.510Z

cycles[7]{num,name,start,end,active,progress}:
  7,,2026-02-08,2026-02-15,false,0
  6,,2026-02-01,2026-02-08,false,0
  5,,2026-01-25,2026-02-01,true,0.3677685950413223
  4,,2026-01-11,2026-01-25,false,0.6394736842105263
  3,,2025-12-28,2026-01-11,false,0.14583333333333334
  2,,2025-12-14,2025-12-28,false,0.13559322033898305
  1,,2025-11-30,2025-12-14,false,0.1875
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

```

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

```

**PASS Criteria**:
- [ ] Still works with UUID input
- [ ] `changes[]` shows label addition

**Result**: [ ] PASS / [ ] FAIL

---

## Post-Test Cleanup

**Cleanup Prompt**:
```
Delete all issues with "[BUG-8-TEST]" in the title
```

**Raw Output**:
```

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
[Record any observations, issues, or deviations from expected behavior here]
```

---

## Sign-Off

| Field | Value |
|-------|-------|
| Tester | |
| Date | |
| Server Version | |
| All Critical Tests Pass | [ ] Yes / [ ] No |
