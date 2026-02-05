# Linear MCP Server - Comprehensive Testing Guide

## Overview

This document outlines all Linear MCP tools, their functionality, and testing workflows for systematic QA validation.

**Server Location:** `/Users/tobiasnilsson/linear-mcp-server/`
**Configuration:** `DEFAULT_TEAM=SQT`, `TOON_OUTPUT_ENABLED=true`

---

## Tools Inventory

### Tier 1: Workspace Context

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `workspace_metadata` | Initialize registry, get teams/users/states/labels/projects/cycles | `include[]`, `forceRefresh`, `teamIds[]`, `project_limit`, `label_limit` |

### Tier 2: Issue Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_issues` | Query issues with filtering | `teamId`, `projectId`, `filter{}`, `q`, `keywords[]`, `matchMode`, `assignedToMe`, `includeArchived`, `orderBy`, `detail`, `limit`, `cursor` |
| `get_issues` | Fetch specific issues by ID | `ids[]` (UUIDs or identifiers like SQT-123) |
| `create_issues` | Create new issues | `items[{teamId, title, description, stateId/stateName/stateType, assigneeId/assigneeName, projectId/projectName, labelIds/labelNames, priority, estimate, dueDate, parentId, allowZeroEstimate}]`, `parallel` |
| `update_issues` | Modify existing issues | `items[{id, title, description, stateId/stateName/stateType, assigneeId/assigneeName, projectId/projectName, labelIds/labelNames, addLabelIds/addLabelNames, removeLabelIds/removeLabelNames, priority, estimate, dueDate, parentId, archived, cycle, allowZeroEstimate}]`, `parallel` |
| `get_sprint_context` | Full sprint data with gap analysis | `team`, `cycle`, `includeComments`, `includeRelations` |

### Tier 3: Comments

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_comments` | Get comments on an issue | `issueId`, `limit`, `cursor` |
| `add_comments` | Add comments to issues | `items[{issueId, body}]`, `parallel` |
| `update_comments` | Edit existing comments | `items[{id, body}]` |

### Tier 4: Cycles

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_cycles` | List team cycles | `teamId`, `includeArchived`, `orderBy`, `limit`, `cursor` |

### Tier 5: Projects

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_projects` | Query projects | `filter{}`, `includeArchived`, `limit`, `cursor` |
| `create_projects` | Create new projects | `items[{name, teamId, leadId, description, targetDate, state}]` |
| `update_projects` | Modify projects | `items[{id, name, description, targetDate, state, leadId, archived}]` |
| `list_project_updates` | Get project status updates | `project`, `limit`, `cursor` |
| `create_project_update` | Add project status update | `project`, `body`, `health` |
| `update_project_update` | Edit status update | `id`, `body`, `health` |

---

## Short Key System

### Default Team (SQT) - Clean Keys
- States: `s0`, `s1`, `s2`...
- Users: `u0`, `u1`, `u2`... (global)
- Projects: `pr0`, `pr1`... (global)
- Cycles: `c6`, `c7`... or just number `6`, `7`
- Priority: `p0`-`p4` (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
- Estimate: `e1`, `e2`, `e3`...

### Non-Default Teams - Prefixed Keys
- States: `sqm:s0`, `sqm:s1`...
- Labels: `sqm:LabelName` (if team-specific)

### Flexible Input
- `s0` = `sqt:s0` = `SQT:s0` (case-insensitive)

### Human-Readable Alternatives
- Priority: `"Urgent"`, `"High"`, `"Medium"`, `"Low"` (instead of numbers)
- stateType: `"started"`, `"completed"`, `"backlog"`, `"unstarted"`, `"canceled"` (auto-resolves to first matching state)

---

## Testing Workflows

### Workflow 1: Sprint Planning Review
```
1. workspace_metadata() - Initialize registry
2. get_sprint_context({ team: "SQT", includeComments: true, includeRelations: true })
3. Review _gaps section:
   - no_estimate: Issues need story points
   - no_assignee: Issues need owners
   - stale: Issues with no updates for 7+ days
   - blocked: Issues waiting on dependencies
   - priority_mismatch: Urgent issues not started
4. update_issues() - Fix gaps (add estimates, assignees)
5. Verify with get_sprint_context() again
```

### Workflow 2: Ticket Enrichment
```
1. get_issues({ ids: ["SQT-XXX"] }) - Get issue details
2. list_comments({ issueId: "SQT-XXX" }) - Check existing context
3. [Slack/GitHub investigation]
4. update_issues({ items: [{ id: "SQT-XXX", description: "..." }] })
5. add_comments({ items: [{ issueId: "SQT-XXX", body: "Investigation notes..." }] })
```

### Workflow 3: Cross-Team Coordination
```
1. workspace_metadata() - See all teams in _teams[]
2. list_issues({ teamId: "SQM" }) - Query other team (note: prefixed keys sqm:s0)
3. create_issues({ items: [{ teamId: "SQM", title: "...", state: "sqm:s0" }] })
4. Verify cross-team validation: try applying "s0" to SQM issue (should fail)
```

### Workflow 4: Project Status Reporting
```
1. list_projects() - Get project list with pr0, pr1... keys
2. list_issues({ projectId: "pr0" }) - Get project issues
3. create_project_update({ project: "pr0", body: "Status update...", health: "onTrack" })
4. list_project_updates({ project: "pr0" }) - Verify update created
```

### Workflow 5: Cycle Management
```
1. list_cycles({ teamId: "SQT" }) - See available cycles
2. update_issues({ items: [{ id: "SQT-XXX", cycle: "current" }] }) - Add to current sprint
3. update_issues({ items: [{ id: "SQT-XXX", cycle: "next" }] }) - Move to next sprint
4. update_issues({ items: [{ id: "SQT-XXX", cycle: null }] }) - Remove from sprint
```

### Workflow 6: Error Recovery Testing
```
1. Try invalid short key: update_issues({ items: [{ id: "SQT-XXX", assignee: "u99" }] })
   - Verify error includes available keys suggestion
2. Try cross-team state: update_issues({ items: [{ id: "SQT-XXX", state: "sqm:s0" }] })
   - Verify error code: CROSS_TEAM_STATE_ERROR
   - Verify hint suggests correct team's states
3. Try non-existent issue: get_issues({ ids: ["FAKE-999"] })
   - Verify graceful error handling
```

---

## Detailed Test Scenarios

### workspace_metadata Tests

| Test | Input | Expected |
|------|-------|----------|
| Basic call | `workspace_metadata({})` | All teams in `_teams[]`, users/states/labels/projects/cycles |
| Force refresh | `workspace_metadata({ forceRefresh: true })` | Fresh data, new timestamp |
| Selective teams | `workspace_metadata({ teamIds: ["<SQT-UUID>"] })` | Only SQT data in lookups |
| Custom limits | `workspace_metadata({ project_limit: 5, label_limit: 10 })` | Respects limits |

### list_issues Tests

| Test | Input | Expected |
|------|-------|----------|
| Default team | `list_issues({})` | Issues from DEFAULT_TEAM (SQT) |
| Other team | `list_issues({ teamId: "SQM" })` | SQM issues with `sqm:s0` prefixed keys |
| By project | `list_issues({ projectId: "pr0" })` | Issues in that project |
| Priority filter | `list_issues({ filter: { priority: { lte: 2 } } })` | Only Urgent (1) and High (2) |
| State type filter | `list_issues({ filter: { state: { type: { eq: "started" } } } })` | Only "In Progress" issues |
| Keyword search (all) | `list_issues({ q: "auth bug", matchMode: "all" })` | Must match ALL keywords |
| Keyword search (any) | `list_issues({ q: "auth bug", matchMode: "any" })` | Match ANY keyword |
| My issues | `list_issues({ assignedToMe: true })` | Only viewer's issues |
| Detail minimal | `list_issues({ detail: "minimal" })` | Only id, title, state |
| Detail full | `list_issues({ detail: "full" })` | Includes labels, description |
| Pagination | `list_issues({ limit: 5 })` then use `cursor` | Next page of results |
| Include archived | `list_issues({ includeArchived: true })` | Includes archived issues |
| Order by created | `list_issues({ orderBy: "createdAt" })` | Sorted by creation date |

### get_issues Tests

| Test | Input | Expected |
|------|-------|----------|
| By identifier | `get_issues({ ids: ["SQT-123"] })` | Full issue details |
| By UUID | `get_issues({ ids: ["<uuid>"] })` | Full issue details |
| Multiple issues | `get_issues({ ids: ["SQT-123", "SQT-124"] })` | Batch results |
| Non-existent | `get_issues({ ids: ["FAKE-999"] })` | Graceful error in results |
| Mixed valid/invalid | `get_issues({ ids: ["SQT-123", "FAKE-999"] })` | Partial success |

### create_issues Tests

| Test | Input | Expected |
|------|-------|----------|
| Minimal | `create_issues({ items: [{ teamId: "SQT", title: "Test" }] })` | Issue created with defaults |
| With state key | `create_issues({ items: [{ teamId: "SQT", title: "Test", state: "s1" }] })` | State resolved from short key |
| With stateType | `create_issues({ items: [{ teamId: "SQT", title: "Test", stateType: "started" }] })` | Auto-resolves to "In Progress" |
| With stateName | `create_issues({ items: [{ teamId: "SQT", title: "Test", stateName: "Todo" }] })` | Resolves by name |
| Priority as string | `create_issues({ items: [{ teamId: "SQT", title: "Test", priority: "High" }] })` | Priority 2 |
| Priority as number | `create_issues({ items: [{ teamId: "SQT", title: "Test", priority: 1 }] })` | Urgent |
| With assignee | `create_issues({ items: [{ teamId: "SQT", title: "Test", assignee: "u0" }] })` | Assigned to user |
| With project | `create_issues({ items: [{ teamId: "SQT", title: "Test", project: "pr0" }] })` | In project |
| With labels | `create_issues({ items: [{ teamId: "SQT", title: "Test", labelNames: ["Bug"] }] })` | Label applied |
| With estimate | `create_issues({ items: [{ teamId: "SQT", title: "Test", estimate: 3 }] })` | Estimate set |
| With dueDate | `create_issues({ items: [{ teamId: "SQT", title: "Test", dueDate: "2026-03-01" }] })` | Due date set |
| Subtask | `create_issues({ items: [{ teamId: "SQT", title: "Subtask", parentId: "SQT-123" }] })` | Created as child |
| Cross-team | `create_issues({ items: [{ teamId: "SQM", title: "Test", state: "sqm:s0" }] })` | Created in SQM |
| Batch | `create_issues({ items: [{...}, {...}], parallel: true })` | Multiple created |

### update_issues Tests

| Test | Input | Expected |
|------|-------|----------|
| Change state | `update_issues({ items: [{ id: "SQT-123", state: "s3" }] })` | State updated |
| Change state by type | `update_issues({ items: [{ id: "SQT-123", stateType: "completed" }] })` | Moved to Done |
| Change assignee | `update_issues({ items: [{ id: "SQT-123", assignee: "u1" }] })` | Reassigned |
| Change priority | `update_issues({ items: [{ id: "SQT-123", priority: "Urgent" }] })` | Priority 1 |
| Add labels | `update_issues({ items: [{ id: "SQT-123", addLabelNames: ["Bug"] }] })` | Label added (keeps existing) |
| Remove labels | `update_issues({ items: [{ id: "SQT-123", removeLabelNames: ["Feature"] }] })` | Label removed |
| Replace labels | `update_issues({ items: [{ id: "SQT-123", labelNames: ["Bug"] }] })` | Labels replaced |
| Set estimate | `update_issues({ items: [{ id: "SQT-123", estimate: 5 }] })` | Estimate updated |
| Set dueDate | `update_issues({ items: [{ id: "SQT-123", dueDate: "2026-03-15" }] })` | Due date set |
| Clear dueDate | `update_issues({ items: [{ id: "SQT-123", dueDate: null }] })` | Due date removed |
| Add to current cycle | `update_issues({ items: [{ id: "SQT-123", cycle: "current" }] })` | In current sprint |
| Add to next cycle | `update_issues({ items: [{ id: "SQT-123", cycle: "next" }] })` | In next sprint |
| Add to specific cycle | `update_issues({ items: [{ id: "SQT-123", cycle: 6 }] })` | In cycle 6 |
| Remove from cycle | `update_issues({ items: [{ id: "SQT-123", cycle: null }] })` | No longer in sprint |
| Archive (soft delete) | `update_issues({ items: [{ id: "SQT-123", archived: true }] })` | Issue archived |
| Unarchive | `update_issues({ items: [{ id: "SQT-123", archived: false }] })` | Issue restored |
| Cross-team update | `update_issues({ items: [{ id: "SQM-123", state: "sqm:s1" }] })` | Works with prefix |
| Cross-team validation | `update_issues({ items: [{ id: "SQT-123", state: "sqm:s0" }] })` | FAILS with helpful error |
| Batch | `update_issues({ items: [{...}, {...}] })` | Multiple updated |

### get_sprint_context Tests

| Test | Input | Expected |
|------|-------|----------|
| Current sprint | `get_sprint_context({ team: "SQT" })` | Current cycle data |
| With comments | `get_sprint_context({ team: "SQT", includeComments: true })` | Comments section included |
| With relations | `get_sprint_context({ team: "SQT", includeRelations: true })` | Relations section included |
| Previous sprint | `get_sprint_context({ team: "SQT", cycle: "previous" })` | Last cycle's data |
| Next sprint | `get_sprint_context({ team: "SQT", cycle: "next" })` | Next cycle's data |
| Specific cycle | `get_sprint_context({ team: "SQT", cycle: 5 })` | Cycle 5 data |
| Gap analysis | Any call | `_gaps[]` section with issue types |
| Other team | `get_sprint_context({ team: "SQM" })` | SQM sprint with prefixed keys |

### list_comments Tests

| Test | Input | Expected |
|------|-------|----------|
| By issue identifier | `list_comments({ issueId: "SQT-123" })` | Comments on issue |
| With limit | `list_comments({ issueId: "SQT-123", limit: 5 })` | Limited results |
| Pagination | Use `cursor` from previous call | Next page |

### add_comments Tests

| Test | Input | Expected |
|------|-------|----------|
| Single comment | `add_comments({ items: [{ issueId: "SQT-123", body: "Note" }] })` | Comment added |
| Markdown body | `add_comments({ items: [{ issueId: "SQT-123", body: "**Bold** and `code`" }] })` | Markdown preserved |
| Multiple | `add_comments({ items: [{...}, {...}] })` | Batch added |

### update_comments Tests

| Test | Input | Expected |
|------|-------|----------|
| Edit body | `update_comments({ items: [{ id: "<comment-uuid>", body: "Updated" }] })` | Comment updated |

### list_cycles Tests

| Test | Input | Expected |
|------|-------|----------|
| Team cycles | `list_cycles({ teamId: "SQT" })` | Active cycles |
| Include archived | `list_cycles({ teamId: "SQT", includeArchived: true })` | All cycles |
| Pagination | `list_cycles({ teamId: "SQT", limit: 5, cursor: "..." })` | Paginated |

### list_projects Tests

| Test | Input | Expected |
|------|-------|----------|
| All projects | `list_projects({})` | Project list with pr0, pr1... |
| By state | `list_projects({ filter: { state: { eq: "started" } } })` | Active projects |
| Include archived | `list_projects({ includeArchived: true })` | All projects |

### create_projects Tests

| Test | Input | Expected |
|------|-------|----------|
| Minimal | `create_projects({ items: [{ name: "New Project" }] })` | Project created |
| With team | `create_projects({ items: [{ name: "Test", teamId: "SQT" }] })` | Team attached |
| With lead | `create_projects({ items: [{ name: "Test", leadId: "u0" }] })` | Lead assigned |
| With dates | `create_projects({ items: [{ name: "Test", targetDate: "2026-06-01" }] })` | Target date set |

### update_projects Tests

| Test | Input | Expected |
|------|-------|----------|
| Rename | `update_projects({ items: [{ id: "pr0", name: "New Name" }] })` | Name updated |
| Change state | `update_projects({ items: [{ id: "pr0", state: "completed" }] })` | State updated |
| Archive | `update_projects({ items: [{ id: "pr0", archived: true }] })` | Project archived |

### Project Updates Tests

| Test | Input | Expected |
|------|-------|----------|
| List updates | `list_project_updates({ project: "pr0" })` | Status updates |
| Create update | `create_project_update({ project: "pr0", body: "On track", health: "onTrack" })` | Update created |
| Create at risk | `create_project_update({ project: "pr0", body: "Delayed", health: "atRisk" })` | Yellow status |
| Create off track | `create_project_update({ project: "pr0", body: "Blocked", health: "offTrack" })` | Red status |
| Edit update | `update_project_update({ id: "<uuid>", body: "Revised", health: "onTrack" })` | Update modified |

---

## Error Handling Tests

| Scenario | Input | Expected Error |
|----------|-------|----------------|
| Invalid short key | `update_issues({ items: [{ id: "SQT-123", assignee: "u99" }] })` | Unknown key with suggestions |
| Invalid state key | `update_issues({ items: [{ id: "SQT-123", state: "s99" }] })` | Invalid state with available states |
| Cross-team state | `update_issues({ items: [{ id: "SQT-123", state: "sqm:s0" }] })` | `CROSS_TEAM_STATE_ERROR` with hint |
| Cross-team label | `update_issues({ items: [{ id: "SQT-123", labelNames: ["sqm:SomeLabel"] }] })` | Team mismatch error |
| Non-existent issue | `get_issues({ ids: ["FAKE-999"] })` | Not found in results |
| Non-existent project | `list_issues({ projectId: "pr99" })` | Invalid project error |
| Team without cycles | `get_sprint_context({ team: "DO" })` | No active cycles message |

---

## Validation Checklist

### TOON Output Format
- [ ] `_meta{}` section present with tool name and timestamp
- [ ] `_users[]` lookup with short keys (u0, u1...)
- [ ] `_states[]` lookup with short keys (s0, s1... or sqm:s0...)
- [ ] `_projects[]` lookup with short keys (pr0, pr1...)
- [ ] `_labels[]` lookup with names
- [ ] `_cycles[]` lookup with cycle numbers
- [ ] `_pagination[]` for list operations (hasMore, cursor, fetched)
- [ ] Actual data section (issues[], comments[], etc.)

### Short Key Resolution
- [ ] Clean keys resolve for DEFAULT_TEAM (s0 → SQT state)
- [ ] Prefixed keys resolve for other teams (sqm:s0 → SQM state)
- [ ] Case-insensitive prefix matching (SQT:s0 = sqt:s0)
- [ ] Explicit default prefix accepted (sqt:s0 when DEFAULT_TEAM=SQT)
- [ ] Cross-team validation errors are helpful with suggestions

### Human-Readable Input
- [ ] Priority strings work ("Urgent", "High", "Medium", "Low")
- [ ] stateType resolution works ("started", "completed", etc.)
- [ ] stateName resolution works (e.g., "Todo", "In Progress")
- [ ] assigneeName/assigneeEmail resolution works

### Gap Analysis (get_sprint_context)
- [ ] `_gaps[]` section present
- [ ] `no_estimate` gaps identified
- [ ] `no_assignee` gaps identified (excluding completed/canceled)
- [ ] `stale` issues flagged (7+ days without update)
- [ ] `blocked` issues identified
- [ ] `priority_mismatch` flagged (urgent not started)

### Data Integrity
- [ ] All expected fields present in responses
- [ ] URLs are valid Linear links (https://linear.app/...)
- [ ] Timestamps in ISO format
- [ ] Descriptions/bodies preserve markdown
- [ ] Changes section shows before/after for updates

---

## Test Status

| Tool | Tested | Notes |
|------|--------|-------|
| workspace_metadata | ✅ | All teams visible, DEFAULT_TEAM in _meta |
| list_issues | ✅ | Scoping, filtering, cross-team |
| get_issues | ✅ | By ID and identifier |
| create_issues | ✅ | Clean and prefixed keys |
| update_issues | ✅ | State changes, cross-team validation |
| get_sprint_context | ⬜ | To test |
| list_comments | ⬜ | To test |
| add_comments | ⬜ | To test |
| update_comments | ⬜ | To test |
| list_cycles | ⬜ | To test |
| list_projects | ⬜ | To test |
| create_projects | ⬜ | To test |
| update_projects | ⬜ | To test |
| list_project_updates | ⬜ | To test |
| create_project_update | ⬜ | To test |
| update_project_update | ⬜ | To test |

---

## Known Issues / Edge Cases

(Document any issues found during testing here)

1. **Cross-team validation** - States and team-specific labels are validated. Workspace labels work on any team.
2. **Cycle management** - Only works for teams with `cyclesEnabled: true`
3. **Soft delete only** - Linear API doesn't support hard delete; use `archived: true`

---

## Session Log

### 2026-02-05: Initial Setup & Multi-Team Testing
- Fixed TOON display in Claude Code (structuredContent issue)
- Implemented and tested multi-team short keys
- All 12/12 manual tests passed
- 695 automated tests passing
- Fixed workspace_metadata to show all teams in `_teams[]` output
- Fixed `_meta{team}` to show DEFAULT_TEAM instead of first alphabetically
