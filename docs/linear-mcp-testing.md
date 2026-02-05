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
| `workspace_metadata` | Initialize registry, get teams/users/states/labels/projects/cycles | `include[]`, `forceRefresh`, `teamIds[]` |

### Tier 2: Issue Operations

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_issues` | Query issues with filtering | `team`, `projectId`, `filter{}`, `q`, `keywords[]`, `cycle`, `assignedToMe`, `detail`, `limit` |
| `get_issues` | Fetch specific issues by ID | `ids[]` (UUIDs or identifiers like SQT-123) |
| `create_issues` | Create new issues | `items[{teamId, title, state, assignee, project, priority, estimate, labels, dueDate}]` |
| `update_issues` | Modify existing issues | `items[{id, state, assignee, priority, labels, archived, cycle}]` |
| `get_sprint_context` | Full sprint data with gap analysis | `team`, `cycle`, `includeComments`, `includeRelations` |

### Tier 3: Comments

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_comments` | Get comments on an issue | `issueId`, `limit`, `cursor` |
| `add_comments` | Add comments to issues | `items[{issueId, body}]` |
| `update_comments` | Edit existing comments | `items[{id, body}]` |

### Tier 4: Cycles

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_cycles` | List team cycles | `teamId`, `includeArchived`, `limit` |

### Tier 5: Projects

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `list_projects` | Query projects | `filter{}`, `includeArchived`, `limit` |
| `create_projects` | Create new projects | `items[{name, teamId, leadId, description, targetDate}]` |
| `update_projects` | Modify projects | `items[{id, name, state, leadId, archived}]` |
| `list_project_updates` | Get project status updates | `project`, `limit` |
| `create_project_update` | Add project status update | `project`, `body`, `health` |
| `update_project_update` | Edit status update | `id`, `body`, `health` |

---

## Short Key System

### Default Team (SQT) - Clean Keys
- States: `s0`, `s1`, `s2`...
- Users: `u0`, `u1`, `u2`... (global)
- Projects: `pr0`, `pr1`... (global)
- Cycles: `c6`, `c7`...
- Priority: `p0`-`p4` (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low)
- Estimate: `e1`, `e2`, `e3`...

### Non-Default Teams - Prefixed Keys
- States: `sqm:s0`, `sqm:s1`...
- Labels: `sqm:LabelName` (if team-specific)

### Flexible Input
- `s0` = `sqt:s0` = `SQT:s0` (case-insensitive)

---

## Testing Workflows

### Workflow 1: Sprint Planning Review
```
1. workspace_metadata() - Initialize registry
2. get_sprint_context({ team: "SQT" }) - Get current sprint
3. Review _gaps section for issues needing attention
4. update_issues() - Fix gaps (add estimates, assignees)
```

### Workflow 2: Ticket Enrichment
```
1. get_issues({ ids: ["SQT-XXX"] }) - Get issue details
2. list_comments({ issueId: "SQT-XXX" }) - Check existing context
3. [Slack/GitHub investigation]
4. update_issues() - Add description
5. add_comments() - Document findings
```

### Workflow 3: Cross-Team Coordination
```
1. workspace_metadata() - See all teams
2. list_issues({ team: "SQM" }) - Query other team
3. create_issues({ teamId: "SQM", state: "sqm:s0" }) - Create in other team
```

### Workflow 4: Project Status Reporting
```
1. list_projects() - Get project list
2. list_issues({ projectId: "pr0" }) - Get project issues
3. create_project_update({ project: "pr0", body: "...", health: "onTrack" })
```

---

## Validation Checklist

### TOON Output Format
- [ ] `_meta{}` section present with tool name
- [ ] `_users[]` lookup with short keys
- [ ] `_states[]` lookup with short keys
- [ ] `_projects[]` lookup with short keys
- [ ] `_pagination[]` for list operations
- [ ] Actual data section (issues, comments, etc.)

### Short Key Resolution
- [ ] Clean keys resolve for DEFAULT_TEAM
- [ ] Prefixed keys resolve for other teams
- [ ] Case-insensitive prefix matching
- [ ] Cross-team validation errors are helpful

### Data Integrity
- [ ] All expected fields present in responses
- [ ] URLs are valid Linear links
- [ ] Timestamps in ISO format
- [ ] Descriptions/bodies preserve markdown

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

---

## Session Log

### 2026-02-05: Initial Setup & Multi-Team Testing
- Fixed TOON display in Claude Code (structuredContent issue)
- Implemented and tested multi-team short keys
- All 12/12 manual tests passed
- 701 automated tests passing
