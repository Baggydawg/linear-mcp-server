# TOON Schema Reference

Consolidated reference for TOON (Token-Oriented Object Notation) output format.

Generated: 2026-01-27
Source: [linear-schema.md](./linear-schema.md) (full field documentation)

---

## Two-Tier Lookup Strategy

TOON uses a two-tier approach to balance token efficiency with complete context:

### Tier 1: Complete Reference Data (`workspace_metadata`)

Called once per session. Returns **all available options** so Claude knows what exists:

| Data | Purpose |
|------|---------|
| `_team_members` | All users who can be assigned |
| `_workflow_states` | Full state machine (including Triage, Backlog) |
| `_labels` | All label categories |
| `_projects` | All projects |
| `_teams` | All teams with keys |
| `_cycles` | Current and upcoming cycles |

This gives Claude the full picture for making suggestions and edits.

### Tier 2: Referenced Data Only (Issue Queries)

Tools like `list_issues` and `get_sprint_context` only include lookup entries that are **actually referenced** in the response. **No UUIDs** - just short keys.

```
# Only 2 of 7 users are assigned to issues in this response
_users[2]{key,name,displayName,email}:
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com
  u1,i.bastos@atipikproperties.com,ian-bastos,i.bastos@atipikproperties.com

# Only 3 of 8 states are used
_states[3]{key,name,type}:
  s2,Todo,unstarted
  s3,In Progress,started
  s5,Done,completed
```

This keeps responses lean while Claude can cross-reference with `workspace_metadata` for the full context.

### Exception: Labels

Labels are small (just name + color) and few in number (typically 5-15). Consider **always including all labels** in Tier 2 responses since:
- Token cost is minimal (~20-30 tokens for all labels)
- Claude can immediately suggest appropriate labels without cross-referencing
- Labels rarely change mid-session

### Why This Matters

Without Tier 1, if a sprint starts with all issues in "Todo":
- Claude only sees `s0 = Todo`
- Doesn't know "In Progress", "In Review", "Done" exist
- Can't suggest "move to In Progress"

With Tier 1, Claude knows the full workflow upfront and can make informed suggestions.

---

## Short Key Resolution (MCP Server Responsibility)

The MCP server acts as a translator between Claude's token-efficient short keys and Linear's UUIDs.

### Static Entities → Short Keys

For **stable, fixed-size** entities, short keys work well:

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude                    MCP Server                 Linear API │
│                                                                  │
│  "move SQT-174    ──►   resolves s3 to      ──►   stateId:      │
│   to s3"                 1cbe7fd1-c232-...         1cbe7fd1-... │
│                                                                  │
│  "assign to u1"   ──►   resolves u1 to      ──►   assigneeId:   │
│                          04ab3df5-0844-...         04ab3df5-... │
└─────────────────────────────────────────────────────────────────┘
```

| Static Entity | Short Key | Why It Works |
|---------------|-----------|--------------|
| Users | `u0, u1, u2` | Fixed team, ~5-10 people |
| Workflow States | `s0, s1, s2` | Fixed per team, ~8 states |
| Projects | `pr0, pr1, pr2` | Relatively stable, ~5-10 |
| Labels | (use name) | Fixed categories, API accepts names |
| Teams | (use key) | Fixed, `SQT` is already short |
| Cycles | (use number) | Fixed set, `5` is already short |

### Dynamic Entities → UUIDs or Omit

For **ever-growing** entities, short keys don't work:

| Dynamic Entity | Approach | Why |
|----------------|----------|-----|
| Comments | UUID when mutation needed, omit for read-only | New comments added constantly |
| Relations | UUID when deletion needed, or just `from→type→to` | Can be added anytime |
| Attachments | UUID when deletion needed, omit for read-only | Can be added anytime |
| Issues | Use `identifier` (SQT-123) | Natural key, API accepts it |

**Why short keys fail for dynamic entities:**
- Comments can be added by anyone at any time
- A short key mapping (`c0`, `c1`) becomes stale within seconds
- Would require tracking ALL historical comments (infeasible)

**Token savings (static entities only):**
- UUID: `6f2a8f4b-34fd-46e3-ab5d-b54ce8e667dc` = ~40 characters
- Short key: `s1` = 2 characters
- 50 issues × 3 static references each = ~5,700 characters saved

---

## Quick Reference

### Primary Identifiers

| Entity | Primary Key | Format | Notes |
|--------|-------------|--------|-------|
| Issue | `identifier` | `SQT-123` | Natural key, API accepts it |
| Team | `key` | `SQT` | Natural key, already short |
| Cycle | `number` | `5` | Natural key, already short |
| User | short key | `u0` | Static - MCP resolves to UUID |
| WorkflowState | short key | `s0` | Static - MCP resolves to UUID |
| Project | short key | `pr0` | Static - MCP resolves to UUID |
| Label | `name` | `Bug` | API accepts names directly |
| Comment | `id` (optional) | UUID | Dynamic - only include when mutation needed |
| Relation | `id` (optional) | UUID | Dynamic - only include when deletion needed |
| Attachment | `id` (optional) | UUID | Dynamic - only include when deletion needed |

### API-Native Values (No Translation)

| Field | Values | Example |
|-------|--------|---------|
| `priority` | 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low | `2` |
| `estimate` | Number (team's scale) | `3` |
| `progress` | Decimal 0-1 | `0.62` |
| `state.type` | triage, backlog, unstarted, started, completed, canceled | `started` |
| `project.status` | backlog, planned, started, paused, completed, canceled | `started` |
| `relation.type` | blocks, duplicate, related | `blocks` |

---

## Lookup Tables

Lookup tables are prefixed with `_` and define short keys for entities referenced multiple times. **UUIDs are NOT included in output** - they're stored internally by the MCP server for resolution.

### `_users`

Maps short keys to user details for assignee/creator/commenter references.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Short key (u0, u1, u2...) - use in requests |
| `name` | string | Full name |
| `displayName` | string | Display/nick name |
| `email` | string | Email address |

```
_users[3]{key,name,displayName,email}:
  u0,Tobias Nilsson,tobias,t.nilsson@example.com
  u1,Ian Bastos,ian-bastos,i.bastos@example.com
  u2,Luis Carvajal,l.carvajal,l.carvajal@example.com
```

### `_states`

Maps short keys to workflow state details.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Short key (s0, s1, s2...) - use in requests |
| `name` | string | State name (Todo, In Progress, Done) |
| `type` | enum | Category: triage/backlog/unstarted/started/completed/canceled |

```
_states[8]{key,name,type}:
  s0,Triage,triage
  s1,Backlog,backlog
  s2,Todo,unstarted
  s3,In Progress,started
  s4,In Review,started
  s5,Done,completed
  s6,Canceled,canceled
  s7,Duplicate,canceled
```

### `_projects`

Maps short keys to project details.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Short key (pr0, pr1...) - use in requests |
| `name` | string | Project name |
| `state` | enum | backlog/planned/started/paused/completed/canceled |

```
_projects[3]{key,name,state}:
  pr0,MVP Sophiq Platform,started
  pr1,Data Intelligence,backlog
  pr2,Valuation,backlog
```

### `_teams`

Uses natural key (no short key needed). Team key is already short.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Team key (SQT, ENG) - use directly in requests |
| `name` | string | Team display name |
| `cyclesEnabled` | boolean | Whether sprints are used |
| `estimationType` | enum | fibonacci/linear/tShirt/notUsed |

```
_teams[1]{key,name,cyclesEnabled,estimationType}:
  SQT,Tech,true,fibonacci
```

### `_cycles`

Uses natural number (no short key needed). Cycle number is already short.

| Field | Type | Description |
|-------|------|-------------|
| `num` | number | Cycle number (1, 2, 3...) - use directly in requests |
| `name` | string | Custom name (nullable) |
| `start` | date | Start date (YYYY-MM-DD) |
| `end` | date | End date (YYYY-MM-DD) |
| `active` | boolean | Is current active cycle |
| `progress` | number | Completion percentage (0-1) |

```
_cycles[3]{num,name,start,end,active,progress}:
  5,,2026-01-26,2026-02-08,true,0.27
  6,,2026-02-09,2026-02-22,false,0
  4,,2026-01-12,2026-01-25,false,0.64
```

---

## Workspace Metadata (Tier 1 Complete Reference)

The `workspace_metadata` tool returns all available options. Called once per session to give Claude full context. **No UUIDs in output** - MCP server stores mappings internally.

```
_meta{org,team,generated}:
  Atipik Properties,SQT,2026-01-27T12:00:00Z

_teams[1]{key,name,cyclesEnabled,cycleDuration,estimationType}:
  SQT,Tech,true,2,fibonacci

_users[7]{key,name,displayName,email,active}:
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com,true
  u1,i.bastos@atipikproperties.com,ian-bastos,i.bastos@atipikproperties.com,true
  u2,l.carvajal@atipikproperties.com,l.carvajal,l.carvajal@atipikproperties.com,true
  u3,gonzalo@galileo14.com,gonzalo,gonzalo@galileo14.com,true
  u4,Juan Pablo Carbonell,jp.carbonell,jp.carbonell@atipikproperties.com,true
  u5,Guerson Meyer,g.meyer,g.meyer@atipikproperties.com,true
  u6,osuna.ismael@gmail.com,osuna.ismael,osuna.ismael@gmail.com,true

_states[8]{key,name,type}:
  s0,Triage,triage
  s1,Backlog,backlog
  s2,Todo,unstarted
  s3,In Progress,started
  s4,In Review,started
  s5,Done,completed
  s6,Canceled,canceled
  s7,Duplicate,canceled

_labels[9]{name,color}:
  Bug,#EB5757
  Feature,#BB87FC
  Improvement,#4EA7FC
  Tech Debt,#F2994A
  Infrastructure,#26b5ce
  Design,#5e6ad2
  Data,#4cb782
  Research,#5e6ad2
  Orga,#f7c8c1

_projects[3]{key,name,state,priority,progress,lead,targetDate}:
  pr0,MVP Sophiq Platform,started,2,0.61,u1,2026-02-27
  pr1,Data Intelligence,backlog,3,0.06,u2,
  pr2,Valuation,backlog,0,0.31,u2,

_cycles[3]{num,name,start,end,active,progress}:
  5,,2026-01-26,2026-02-08,true,0.27
  6,,2026-02-09,2026-02-22,false,0
  4,,2026-01-12,2026-01-25,false,0.64
```

This complete reference lets Claude:
- Know all team members for assignment suggestions (use `u0`, `u1`, etc.)
- Understand the full workflow (use `s0` for Triage, `s3` for In Progress, etc.)
- See all available labels for categorization (use names directly)
- Know all projects for context and organization (use `pr0`, `pr1`, etc.)
- Understand sprint timing and progress (use cycle number directly)

---

## Entity Schemas

### Issue

The core work item. Primary key: `identifier` (SQT-123).

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `identifier` | string | Human-readable ID (SQT-123) | Primary key - use in requests |
| `title` | string | Issue title | |
| `state` | string | Short key → `_states` lookup | `s2` (Todo) |
| `assignee` | string | Short key → `_users` lookup (nullable) | `u1` |
| `priority` | number | 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low | |
| `estimate` | number | Effort estimate (nullable) | |
| `project` | string | Short key → `_projects` lookup (nullable) | `pr0` |
| `cycle` | number | Cycle number (nullable) | `5` |
| `dueDate` | date | YYYY-MM-DD (nullable) | |
| `labels` | string | Comma-separated names | `"Bug,Feature"` |
| `parent` | string | Parent issue identifier (nullable) | `SQT-100` |
| `team` | string | Team key | `SQT` |
| `url` | string | Direct URL to issue | |
| `createdAt` | datetime | ISO timestamp | |
| `updatedAt` | datetime | ISO timestamp | |
| `startedAt` | datetime | When moved to started state (nullable) | |
| `completedAt` | datetime | When moved to completed state (nullable) | |
| `desc` | string | Description (may be truncated) | |

**TOON Format:**
```
issues[n]{identifier,title,state,assignee,priority,estimate,project,cycle,dueDate,labels,parent,team,url,desc}:
  SQT-174,"Security: Migrate secrets",s2,u0,1,5,,,,,,,https://...,"Security audit revealed..."
  SQT-171,"Filters panel UX",s2,u0,2,,pr0,5,,Improvement,,,https://...,
  SQT-163,"File uploads fix",s4,u1,2,3,pr0,5,,Bug,,,https://...,
```

### Comment

Comment on an issue. **Dynamic entity** - no short keys. Include UUID only when edit/delete is needed.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `id` | UUID | Only include if edit/delete needed | Optional |
| `issue` | string | Issue identifier | `SQT-160` |
| `user` | string | Short key → `_users` lookup | `u0` |
| `body` | string | Markdown content | |
| `createdAt` | datetime | ISO timestamp | |

**TOON Format (read-only context):**
```
comments[n]{issue,user,body,createdAt}:
  SQT-160,u0,"This blocks the algorithm work",2026-01-26T11:30:00Z
  SQT-160,u1,"On it, ready by EOD",2026-01-26T14:15:00Z
```

**TOON Format (when mutation needed):**
```
comments[n]{id,issue,user,body,createdAt}:
  abc123-...,SQT-160,u0,"This blocks the algorithm work",2026-01-26T11:30:00Z
```

### IssueRelation

Link between two issues. **Dynamic entity** - no short keys. Include UUID only when deletion is needed.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `id` | UUID | Only include if deletion needed | Optional |
| `from` | string | Source issue identifier | `SQT-160` |
| `type` | enum | blocks, duplicate, related | |
| `to` | string | Target issue identifier | `SQT-159` |

**TOON Format (read-only context):**
```
relations[n]{from,type,to}:
  SQT-160,blocks,SQT-159
  SQT-161,duplicate,SQT-150
```

**TOON Format (when deletion needed):**
```
relations[n]{id,from,type,to}:
  rel-uuid-...,SQT-160,blocks,SQT-159
```

### Team

Organizational unit containing issues. Primary key: `key` (SQT) - use directly in requests.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Team key (SQT, ENG) - use in requests |
| `name` | string | Display name |
| `description` | string | Team description (nullable) |
| `cyclesEnabled` | boolean | Whether sprints are used |
| `cycleDuration` | number | Sprint duration in weeks |
| `estimationType` | enum | notUsed, exponential, fibonacci, linear, tShirt |
| `activeCycle` | number | Current active cycle number (nullable) |

**TOON Format:**
```
teams[n]{key,name,description,cyclesEnabled,cycleDuration,estimationType,activeCycle}:
  SQT,Tech,"Platform development team",true,2,fibonacci,5
```

### User

A workspace member. Uses short key for mutations.

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | Short key (u0, u1...) - use in requests |
| `name` | string | Full name |
| `displayName` | string | Display/nick name |
| `email` | string | Email address |
| `active` | boolean | Account is active (not suspended) |

**TOON Format:**
```
users[n]{key,name,displayName,email,active}:
  u0,Tobias Nilsson,tobias,t.nilsson@example.com,true
  u1,Ian Bastos,ian-bastos,i.bastos@example.com,true
```

### Cycle

A sprint. Primary key: `number` - use directly in requests.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `num` | number | Sequential cycle number (1, 2, 3...) | Use in requests |
| `name` | string | Custom name (nullable) | |
| `start` | date | Start date (YYYY-MM-DD) | |
| `end` | date | End date (YYYY-MM-DD) | |
| `active` | boolean | Currently active cycle | |
| `progress` | number | Completion percentage (0-1) | |

**TOON Format:**
```
cycles[n]{num,name,start,end,active,progress}:
  5,,2026-01-26,2026-02-08,true,0.27
  4,,2026-01-12,2026-01-25,false,0.64
```

### Project

A project grouping related issues. Uses short key for mutations.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `key` | string | Short key (pr0, pr1...) | Use in requests |
| `name` | string | Project name | |
| `description` | string | Project description | |
| `state` | enum | backlog/planned/started/paused/completed/canceled | |
| `priority` | number | 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low | |
| `progress` | number | Completion percentage (0-1) | |
| `lead` | string | Short key → `_users` lookup (nullable) | `u0` |
| `teams` | string | Comma-separated team keys | `"SQT"` |
| `startDate` | date | Planned start (nullable) | |
| `targetDate` | date | Target completion (nullable) | |
| `health` | enum | onTrack, atRisk, offTrack (nullable) | |

**TOON Format:**
```
projects[n]{key,name,state,priority,progress,lead,teams,targetDate,health}:
  pr0,MVP Sophiq Platform,started,2,0.61,u1,"SQT",2026-02-27,onTrack
  pr1,Data Intelligence,backlog,3,0.06,u2,"SQT",,
```

### IssueLabel

Labels for categorizing issues. Primary key: `name`.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Label name (API accepts directly) |
| `color` | string | Hex color (#ff0000) |
| `parent` | string | Parent label name if grouped (nullable) |

**TOON Format:**
```
labels[n]{name,color,parent}:
  Bug,#ff0000,
  Feature,#00ff00,
  Tech Debt,#ffaa00,Engineering
```

### WorkflowState

Workflow state in a team. Uses short key for mutations.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `key` | string | Short key (s0, s1...) | Use in requests |
| `name` | string | State name (Todo, In Progress, Done) | |
| `type` | enum | triage/backlog/unstarted/started/completed/canceled | |

**TOON Format:**
```
states[n]{key,name,type}:
  s0,Triage,triage
  s1,Backlog,backlog
  s2,Todo,unstarted
  s3,In Progress,started
  s4,In Review,started
  s5,Done,completed
  s6,Canceled,canceled
  s7,Duplicate,canceled
```

### Attachment

File or link attached to an issue. **Dynamic entity** - typically read-only context.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `id` | UUID | Only include if deletion needed | Optional |
| `issue` | string | Issue identifier | `SQT-160` |
| `title` | string | Display title | |
| `subtitle` | string | Display subtitle (nullable) | |
| `url` | string | Attachment URL | |
| `sourceType` | string | github, slack, zendesk, etc. (nullable) | |

**TOON Format (read-only, typical):**
```
attachments[n]{issue,title,subtitle,url,sourceType}:
  SQT-160,"PR #42","Add login feature",https://github.com/...,github
```

### ProjectMilestone

Milestone within a project. **Semi-static** - small fixed set per project, short keys can work.

| Field | Type | Description | Reference |
|-------|------|-------------|-----------|
| `key` | string | Short key (m0, m1...) | Use in requests |
| `name` | string | Milestone name | |
| `status` | enum | planned, started, completed | |
| `targetDate` | date | Target date (nullable) | |
| `progress` | number | Completion percentage (0-1) | |
| `project` | string | Project short key | `pr0` |

**TOON Format:**
```
milestones[n]{key,name,status,targetDate,progress,project}:
  m0,Alpha Release,started,2026-02-15,0.6,pr0
```

---

## Complete Example: Sprint Context (Tier 2)

Full TOON output for a sprint pull. **No UUIDs** - only short keys and natural identifiers. Claude cross-references with `workspace_metadata` for full context.

```
_meta{team,cycle,start,end,generated}:
  SQT,5,2026-01-26,2026-02-08,2026-01-27T12:00:00Z

_users[3]{key,name,displayName,email}:
  u0,Tobias Nilsson,tobias,t.nilsson@atipikproperties.com
  u1,i.bastos@atipikproperties.com,ian-bastos,i.bastos@atipikproperties.com
  u2,l.carvajal@atipikproperties.com,l.carvajal,l.carvajal@atipikproperties.com

_states[4]{key,name,type}:
  s2,Todo,unstarted
  s3,In Progress,started
  s4,In Review,started
  s5,Done,completed

_projects[2]{key,name,state}:
  pr0,MVP Sophiq Platform,started
  pr1,Data Intelligence,backlog

issues[5]{identifier,title,state,assignee,priority,estimate,project,cycle,labels,parent,desc}:
  SQT-174,"Security: Migrate secrets",s2,u0,1,5,,,,,Security audit revealed 9+ hardcoded secrets...
  SQT-171,"Filters panel UX",s2,u0,2,,pr0,5,Improvement,,"Filters panel UX flow optimisation"
  SQT-168,"Cognito user deletion",s2,u3,2,,pr0,5,,SQT-68,"When user deleted, sync to cognito"
  SQT-163,"File uploads fix",s4,u1,2,3,pr0,5,Bug,,"Make file uploads work during visit"
  SQT-165,"MVI access",s5,u2,0,,,,,,

comments[2]{issue,user,body,createdAt}:
  SQT-163,u1,"Fixed the S3 permissions issue",2026-01-26T15:30:00Z
  SQT-163,u0,"LGTM, moving to review",2026-01-26T18:00:00Z

relations[1]{from,type,to}:
  SQT-168,blocks,SQT-167
```

**How Claude uses this:**
- To assign SQT-174 to Ian: `update_issues({ items: [{ id: "SQT-174", assigneeId: "u1" }] })`
- To move SQT-163 to Done: `update_issues({ items: [{ id: "SQT-163", stateId: "s5" }] })`
- To add a comment: `add_comments({ items: [{ issueId: "SQT-174", body: "Started work" }] })`

**Note:** Comments and relations shown without IDs (read-only context). If Claude needs to edit/delete a specific comment, that tool would return the UUID for that item.

MCP server resolves static short keys (u1, s5, pr0) to UUIDs internally before calling Linear API.

---

## Escaping Rules

1. **Commas in values**: Wrap in double quotes → `"Value, with comma"`
2. **Quotes in values**: Escape with backslash → `"He said \"hello\""`
3. **Backslashes in values**: Escape with backslash → `"Path\\to\\file"`
4. **Newlines in values**: Replace with `\n` → `"Line 1\nLine 2"`
5. **Empty values**: Leave blank between commas → `field1,,field3`
6. **Boolean values**: Use `true`/`false` lowercase

---

## Write Operation Results

For create/update operations, results use this format:

```
_meta{action,succeeded,failed,total}:
  create_issues,2,1,3

results[3]{index,status,identifier,error}:
  0,ok,SQT-175,
  1,ok,SQT-176,
  2,error,,Invalid teamId

created[2]{identifier,title,state,assignee,project}:
  SQT-175,New feature,s2,u1,pr0
  SQT-176,Bug fix,s2,u0,
```

For updates with diffs:

```
_meta{action,succeeded,failed,total}:
  update_issues,2,0,2

results[2]{index,status,identifier,error}:
  0,ok,SQT-160,
  1,ok,SQT-161,

changes[2]{identifier,field,before,after}:
  SQT-160,state,s2,s3
  SQT-160,assignee,,u2
  SQT-161,priority,3,1
```

**Note:** All references use short keys (s2, u1, pr0). MCP server resolved Claude's input short keys to UUIDs for the Linear API call.
