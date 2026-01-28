# Linear API Schema Reference

Generated: 2026-01-27

This document maps all Linear API fields to TOON inclusion decisions.

## Type Notation Guide

- `!` after a type = non-null (always returns a value, never null)
- `Connection` = paginated list wrapper containing `nodes` (items) + `pageInfo` (cursor). Requires separate query with pagination - not included by default when fetching the parent entity.
- `[Type!]!` = non-null array of non-null items
- `[Type!]` = nullable array of non-null items
- `[Type]!` = non-null array of nullable items

## Legend

- **In TOON?**: `yes` = included in TOON output, `no` = excluded, `❓` = pending decision

## TOON Design Principles

1. **Actionability**: Every entity must include an identifier that Claude can use in edit requests
2. **Short IDs preferred**: Use `identifier` (SQT-123) over UUID where the API accepts it
3. **Lookup tables**: For entities referenced multiple times (users, states, projects), use short keys (u0, s0, pr0) with UUID in lookup
4. **API-native values**: Use Linear's native formats directly (priority 0-4, state type enums) - no translation needed
5. **Minimal payload**: Only include fields needed to understand context + make edits

---

## API Rate Limits

Linear uses a **leaky bucket algorithm** with continuous token refill.

### Limits (per user, per hour)

| Metric | API Key | OAuth App |
|--------|---------|-----------|
| Requests | 5,000 | 5,000 |
| Complexity points | 250,000 | 2,000,000 |
| Max points per query | 10,000 (hard cap) | 10,000 |

### Complexity Calculation

- Each scalar property: **0.1 points**
- Each object: **1 point** (+ its properties)
- Connections: **multiply** children's points by pagination limit (default 50)

**Example - Full sprint pull (50 issues with all TOON fields):**
- Per issue: ~79 points (base + scalars + nested objects + labels/relations connections)
- 50 issues: ~3,950 points
- **Result**: ~63 full sprint pulls per hour, or ~1 per minute sustained

### Leaky Bucket Behavior

- Bucket capacity: 250,000 points
- Refill rate: ~69 points/second (250,000 ÷ 3,600)
- Burst: Can use full 250,000 instantly if bucket is full
- Sustained: ~4,140 points/minute after burst depleted
- Recovery: A 4,000-point sprint pull refills in ~58 seconds

### Free Plan Limits

| Feature | Free | Basic ($10/user/mo) |
|---------|------|---------------------|
| Active issues | **250 max** | Unlimited |
| Teams | 2 | Unlimited |
| API access | Full | Full |

Note: Archived issues don't count toward 250 limit. Auto-archive: 28 days for completed, 7 days for canceled.

---

## Issue

An issue - the core work item in Linear. **Primary identifier: `identifier` (e.g., SQT-123)** - Linear API accepts this for queries and mutations.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| activitySummary | JSONObject | [Internal] Aggregated activity metrics (comment counts, updates, etc.). Internal use only. | no |
| addedToCycleAt | DateTime | Timestamp when added to a cycle. Just *when*, not *which* - see `cycle` field for that. | no |
| addedToProjectAt | DateTime | Timestamp when added to a project. Just *when*, not *which* - see `project` field. | no |
| addedToTeamAt | DateTime | Timestamp when added to a team. Just *when*, not *which* - see `team` field. | no |
| archivedAt | DateTime | Timestamp when archived. Null if not archived. | no |
| asksExternalUserRequester | ExternalUser | For "Asks" feature: external user who requested issue creation. Niche feature. | no |
| asksRequester | User | For "Asks" feature: internal user who requested issue creation. Niche feature. | no |
| assignee | User | The user assigned to this issue. Returns User object `{ id, name, email }`. | **yes** (as short key → lookup) |
| attachments | AttachmentConnection! | Paginated list of attachments (files, links, PRs, support tickets). Requires separate query. | no (separate query if needed) |
| autoArchivedAt | DateTime | Timestamp when auto-archived by Linear's pruning process. | no |
| autoClosedAt | DateTime | Timestamp when auto-closed by Linear's pruning process. | no |
| botActor | ActorBot | If created by a bot/automation, identifies which bot. | no |
| branchName | String! | Auto-generated suggested git branch name (e.g., `sqt-123-fix-login-bug`). It's a *suggestion* - doesn't track actual branch used. | no |
| canceledAt | DateTime | Timestamp when moved to canceled state. | no |
| children | IssueConnection! | Paginated list of sub-issues (issues with this as `parent`). Requires separate query. | no (use `parent` field on children instead) |
| comments | CommentConnection! | Paginated list of comments. Each has `{ id, body, user, createdAt }`. Requires separate query. | no (separate tool: list_comments) |
| completedAt | DateTime | Timestamp when moved to completed state. Useful for cycle time metrics. | **yes** |
| createdAt | DateTime! | Timestamp when the issue was created. | **yes** |
| creator | User | The user who created the issue. Returns User object. | **yes** (as short key → lookup) |
| customerTicketCount | Int! | Count of linked support tickets (Zendesk, Intercom). Part of Linear's "Customers" feature. | no |
| cycle | Cycle | The sprint/cycle this issue belongs to. Returns Cycle object `{ id, number, name, startsAt, endsAt }`. | **yes** (as cycle number) |
| delegate | User | For Linear's AI agent delegation - an AI agent assigned to work on this. Different from `assignee` (humans). | no |
| description | String | The issue description in markdown format. This is what you want for reading/displaying. | **yes** |
| descriptionState | String | [Internal] YJS CRDT binary state for collaborative editing. Use `description` instead. | no |
| documentContent | DocumentContent | [ALPHA] Link to Linear's Documents feature. Internal rich document system. | no |
| documents | DocumentConnection! | Paginated list of linked Linear Documents. | no |
| dueDate | TimelessDate | Due date for the issue (date only, no time). | **yes** |
| estimate | Float | Complexity/effort estimate. Scale depends on team settings (fibonacci, t-shirt, etc.). | **yes** |
| externalUserCreator | ExternalUser | If created by an external (non-Linear) user, their info. | no |
| favorite | Favorite | If current user has favorited this issue. | no |
| formerAttachments | AttachmentConnection! | Attachments previously on this issue but moved elsewhere. Edge case. | no |
| formerNeeds | CustomerNeedConnection! | Customer needs previously linked but moved. Part of "Customers" feature. | no |
| history | IssueHistoryConnection! | Paginated audit log of all changes. | no |
| id | ID! | UUID for API calls. Use for mutations when `identifier` isn't accepted. | **yes** (in lookup, referenced via identifier) |
| identifier | String! | Human-readable ID like `SQT-123`. **Primary identifier** - Linear accepts this in most API calls. | **yes** (primary key for issues) |
| incomingSuggestions | IssueSuggestionConnection! | [Internal] Linear's AI suggesting related issues. Not for external use. | no |
| integrationSourceType | IntegrationService | If auto-created by an integration (Slack, GitHub, Zendesk), identifies which. Null if manual. | no |
| inverseRelations | IssueRelationConnection! | Relations where this issue is the *target*. E.g., if A blocks B, B's inverseRelations shows "blocked by A". | **yes** (combined with relations) |
| labelIds | [ID!]! | Array of label UUIDs. Use `labels` field for names. | no (use labels) |
| labels | IssueLabelConnection! | Labels on this issue. Each has `{ id, name, color }`. | **yes** (as comma-separated names) |
| lastAppliedTemplate | Template | If a template was applied, which one. | no |
| needs | CustomerNeedConnection! | Customer needs (feature requests/feedback) linked. Part of "Customers" feature. | no |
| number | Float! | Numeric part of identifier (123 from SQT-123). | no (redundant with identifier) |
| parent | Issue | Parent issue if this is a sub-issue. Returns Issue object. | **yes** (as parent identifier) |
| previousIdentifiers | [String!]! | Old identifiers if moved between teams (was `OLD-123`, now `NEW-456`). | no |
| priority | Float! | Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low. Use directly - already efficient. | **yes** (as 0-4 number) |
| priorityLabel | String! | Human-readable priority ("Urgent", "High"). Redundant if you have `priority` number. | no |
| prioritySortOrder | Float! | Internal sort order for priority views. Not for display. | no |
| project | Project | The project this issue belongs to. Returns Project object `{ id, name, state }`. | **yes** (as short key → lookup) |
| projectMilestone | ProjectMilestone | The milestone within the project. Returns `{ id, name, targetDate }`. | maybe (if using milestones) |
| reactionData | JSONObject! | Emoji reactions summary. | no |
| reactions | [Reaction!]! | Individual emoji reactions. | no |
| recurringIssueTemplate | Template | If auto-created from recurring template, which one. | no |
| relations | IssueRelationConnection! | Issue-to-issue links. Types: `blocks`, `duplicate`, `related`. E.g., "SQT-10 blocks SQT-11". | **yes** (as from→type→to) |
| slaBreachesAt | DateTime | SLA tracking: when SLA breaches if not resolved. | no |
| slaHighRiskAt | DateTime | SLA tracking: when enters high-risk status. | no |
| slaMediumRiskAt | DateTime | SLA tracking: when enters medium-risk status. | no |
| slaStartedAt | DateTime | SLA tracking: when timer started. | no |
| slaType | String | SLA calculation: calendar or business days. | no |
| snoozedBy | User | If snoozed in triage, who snoozed it. | no |
| snoozedUntilAt | DateTime | If snoozed, when it reappears in triage. | no |
| sortOrder | Float! | Internal sort order. Not for display. | no |
| sourceComment | Comment | If created from a comment, the source comment. | no |
| startedAt | DateTime | Timestamp when moved to "started" state (In Progress, In Review). | **yes** |
| startedTriageAt | DateTime | Timestamp when entered triage state. | no |
| state | WorkflowState! | Current workflow state. Returns `{ id, name, type }`. Type is: triage/backlog/unstarted/started/completed/canceled. | **yes** (as short key → lookup with type) |
| stateHistory | IssueStateSpanConnection! | [ALPHA] Timeline of state changes - when moved between states, how long in each. | no (separate query if needed) |
| subIssueSortOrder | Float | Sort order among sibling sub-issues. Only set if has parent. | no |
| subscribers | UserConnection! | Users subscribed to notifications. | no |
| suggestions | IssueSuggestionConnection! | [Internal] Linear's AI suggestions. Not for external use. | no |
| suggestionsGeneratedAt | DateTime | [Internal] When AI suggestions were generated. | no |
| syncedWith | [ExternalEntityInfo!] | External services synced with (GitHub, Slack). | no |
| team | Team! | The team this issue belongs to. Returns Team object `{ id, key, name }`. | **yes** (as team key, e.g., SQT) |
| title | String! | The issue title. | **yes** |
| trashed | Boolean | Whether in trash bin. | no |
| triagedAt | DateTime | Timestamp when left triage state. | no |
| updatedAt | DateTime! | Timestamp of last meaningful update. | **yes** |
| url | String! | Direct URL to issue in Linear web app. | **yes** |

### Issue TOON Schema Summary

**Included fields:** `identifier` (primary key), `id` (UUID in lookup), `title`, `description`, `state` (short key), `assignee` (short key), `creator` (short key), `priority` (0-4), `estimate`, `project` (short key), `cycle` (number), `dueDate`, `labels` (names), `parent` (identifier), `relations`/`inverseRelations` (identifiers + type), `team` (key), `url`, `createdAt`, `updatedAt`, `startedAt`, `completedAt`

---

## Team

An organizational unit that contains issues. **Primary identifier: `key` (e.g., SQT, ENG)** - this is the prefix used in issue identifiers.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| activeCycle | Cycle | Team's currently active cycle. Returns Cycle object. | **yes** (useful context) |
| aiDiscussionSummariesEnabled | Boolean! | Whether AI discussion summaries enabled. Config setting. | no |
| aiThreadSummariesEnabled | Boolean! | Whether resolved thread AI summaries enabled. Config setting. | no |
| allMembersCanJoin | Boolean | Whether all org members can join. Only for public teams. | no |
| archivedAt | DateTime | Timestamp when archived. Null if not archived. | no |
| autoArchivePeriod | Float! | Months after which completed issues auto-archive. Config setting. | no |
| autoCloseChildIssues | Boolean | Auto-close children when parent closes. Config setting. | no |
| autoCloseParentIssues | Boolean | Auto-close parent when all children close. Config setting. | no |
| autoClosePeriod | Float | Months after which issues auto-close. Null = disabled. | no |
| autoCloseStateId | String | State for auto-closed issues. | no |
| children | [Team!]! | [Internal] Sub-teams. | no |
| color | String | Team's display color. | no |
| createdAt | DateTime! | Timestamp when created. | no |
| currentProgress | JSONObject! | [Internal] Current progress metrics. | no |
| cycleCalenderUrl | String! | iCal calendar URL for cycles. | no |
| cycleCooldownTime | Float! | Cooldown between cycles in weeks. | no |
| cycleDuration | Float! | Cycle duration in weeks. | **yes** (useful for planning) |
| cycleIssueAutoAssignCompleted | Boolean! | Auto-assign completed issues to current cycle. | no |
| cycleIssueAutoAssignStarted | Boolean! | Auto-assign started issues to current cycle. | no |
| cycleLockToActive | Boolean! | Lock issues to active cycle. | no |
| cycles | CycleConnection! | All cycles. Requires separate query. | no (use list_cycles) |
| cyclesEnabled | Boolean! | Whether team uses cycles/sprints. | **yes** |
| cycleStartDay | Float! | Day of week cycles start (0=Sunday). | no |
| defaultIssueEstimate | Float! | Default estimate for unestimated issues. | no |
| defaultIssueState | WorkflowState | Default state for new issues by members. | no |
| defaultProjectTemplate | Template | Default template for new projects. | no |
| defaultTemplateForMembers | Template | Default issue template for members. | no |
| defaultTemplateForNonMembers | Template | Default issue template for non-members. | no |
| description | String | Team description. | **yes** |
| displayName | String! | Name including parent team name if sub-team. | no (use name) |
| facets | [Unknown!]! | [Internal] Facets. | no |
| gitAutomationStates | GitAutomationStateConnection! | Git automation state mappings. | no |
| groupIssueHistory | Boolean! | Whether to group history entries. | no |
| icon | String | Team icon. | no |
| id | ID! | UUID. Needed for some API calls. | **yes** (in lookup) |
| inheritIssueEstimation | Boolean! | Inherit estimation from parent. Sub-teams only. | no |
| inheritWorkflowStatuses | Boolean! | Inherit workflow from parent. Sub-teams only. | no |
| integrationsSettings | IntegrationsSettings | Integration settings. | no |
| issueCount | Int! | Total issue count. | no |
| issueEstimationAllowZero | Boolean! | Allow zero estimates. | no |
| issueEstimationExtended | Boolean! | Extended estimate scale. | no |
| issueEstimationType | String! | Estimation type: "notUsed", "exponential", "fibonacci", "linear", "tShirt". | **yes** |
| issues | IssueConnection! | All issues. Requires separate query. | no (use list_issues) |
| joinByDefault | Boolean | [Internal] New users auto-join. | no |
| key | String! | Team's unique key (SQT, ENG). **Primary identifier** - used in issue identifiers and URLs. | **yes** (primary key) |
| labels | IssueLabelConnection! | Team's labels. Requires separate query. | no (included in workspace_metadata) |
| markedAsDuplicateWorkflowState | WorkflowState | State for duplicates. | no |
| members | UserConnection! | Team members. Requires separate query. | no (use list_users) |
| membership | TeamMembership | [ALPHA] Current user's membership. | no |
| memberships | TeamMembershipConnection! | All memberships. Use `members` instead. | no |
| name | String! | Team's display name. | **yes** |
| organization | Organization! | Parent organization. | no |
| parent | Team | [Internal] Parent team for sub-teams. | no |
| posts | [Unknown!]! | [Internal] Posts. | no |
| private | Boolean! | Whether team is private. | no |
| progressHistory | JSONObject! | [Internal] Progress history. | no |
| projects | ProjectConnection! | Team's projects. Requires separate query. | no (use list_projects) |
| requirePriorityToLeaveTriage | Boolean! | Require priority before leaving triage. | no |
| scimGroupName | String | SCIM group name. | no |
| scimManaged | Boolean! | Managed by SCIM. | no |
| securitySettings | JSONObject! | Security settings. | no |
| setIssueSortOrderOnStateChange | String! | Where to move issues on state change. | no |
| states | WorkflowStateConnection! | Team's workflow states. Requires separate query. | no (included in workspace_metadata) |
| templates | TemplateConnection! | Issue/project templates. | no |
| timezone | String! | Team timezone. | no |
| triageEnabled | Boolean! | Whether triage mode enabled. | no |
| triageIssueState | WorkflowState | State for triaged issues. | no |
| triageResponsibility | TriageResponsibility | Triage responsibility settings. | no |
| upcomingCycleCount | Float! | How many upcoming cycles to create. | no |
| updatedAt | DateTime! | Last update timestamp. | no |
| webhooks | WebhookConnection! | Webhooks. | no |

### Team TOON Schema Summary

**Included fields:** `key` (primary key), `id` (UUID in lookup), `name`, `description`, `cyclesEnabled`, `cycleDuration`, `issueEstimationType`, `activeCycle`

---

## User

A user with access to organization resources. **Primary identifier: UUID (`id`)** - users don't have a natural short identifier, so we use short keys (u0, u1) in TOON with UUID in lookup table.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| active | Boolean! | Whether account is active (not suspended). | **yes** |
| admin | Boolean! | Whether user is org admin. | no |
| app | Boolean! | Whether user is an app (bot). | no |
| archivedAt | DateTime | Timestamp when archived. | no |
| assignedIssues | IssueConnection! | Issues assigned to user. Requires separate query. | no |
| avatarBackgroundColor | String! | Default avatar background color. | no |
| avatarUrl | String | Avatar image URL. | no |
| calendarHash | String | [DEPRECATED] Calendar URL hash. | no |
| canAccessAnyPublicTeam | Boolean! | Can access public teams. | no |
| createdAt | DateTime! | Account creation timestamp. | no |
| createdIssueCount | Int! | Total issues created. | no |
| createdIssues | IssueConnection! | Issues created by user. Requires separate query. | no |
| delegatedIssues | IssueConnection! | Issues delegated to user (AI agents). | no |
| description | String | User bio/title. | no |
| disableReason | String | Why account is disabled. | no |
| displayName | String! | Display/nick name. Unique within org. | **yes** (primary display name) |
| drafts | DraftConnection! | User's drafts. | no |
| email | String! | Email address. Used for identification/mentions. | **yes** |
| feedFacets | FacetConnection! | [INTERNAL] Pinned feeds. | no |
| gitHubUserId | String | Linked GitHub user ID. | no |
| guest | Boolean! | Whether user is a guest (limited access). | no |
| id | ID! | UUID. **Required for mutations** (assigning issues, etc.). | **yes** (in lookup) |
| identityProvider | IdentityProvider | [INTERNAL] Identity provider. | no |
| initials | String! | User's initials. | no |
| isAssignable | Boolean! | Whether user can be assigned issues. | no |
| isMe | Boolean! | Whether this is the authenticated user. | no |
| isMentionable | Boolean! | Whether user can be @mentioned. | no |
| issueDrafts | IssueDraftConnection! | User's issue drafts. | no |
| lastSeen | DateTime | Last online timestamp. | no |
| name | String! | Full name. | **yes** |
| organization | Organization! | User's organization. | no |
| owner | Boolean! | Whether user is org owner. | no |
| statusEmoji | String | Current status emoji. | no |
| statusLabel | String | Current status label. | no |
| statusUntilAt | DateTime | When status clears. | no |
| supportsAgentSessions | Boolean! | Whether agent supports sessions (AI). | no |
| teamMemberships | TeamMembershipConnection! | Team memberships. Use `teams` instead. | no |
| teams | TeamConnection! | Teams user belongs to. | no |
| timezone | String | User's timezone. | no |
| updatedAt | DateTime! | Last update timestamp. | no |
| url | String! | Profile URL. | no |

### User TOON Schema Summary

**Included fields (in lookup table):** short key (u0, u1), `id` (UUID for API), `name`, `displayName`, `email`, `active`

---

## Cycle

A sprint - a set of issues to be resolved in a time period. **Primary identifier: `number`** - cycles are numbered sequentially per team (Sprint 1, Sprint 2). Combined with team key for uniqueness.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| autoArchivedAt | DateTime | Timestamp when auto-archived. | no |
| completedAt | DateTime | When cycle was completed. Null if not yet completed. | no |
| completedIssueCountHistory | [Float!]! | Daily completed issue count history. For burndown charts. | no |
| completedScopeHistory | [Float!]! | Daily completed estimate points. For burndown charts. | no |
| createdAt | DateTime! | Creation timestamp. | no |
| currentProgress | JSONObject! | [Internal] Current progress metrics. | no |
| description | String | Cycle description/goals. | **yes** |
| documents | DocumentConnection! | [Internal] Linked documents. | no |
| endsAt | DateTime! | End date/time of cycle. | **yes** |
| id | ID! | UUID. Needed for some API mutations. | **yes** (in lookup) |
| inheritedFrom | Cycle | Parent cycle if inherited. | no |
| inProgressScopeHistory | [Float!]! | Daily in-progress estimate points. | no |
| isActive | Boolean! | Whether currently the active cycle. | **yes** |
| isFuture | Boolean! | Whether cycle is in the future. | no |
| isNext | Boolean! | Whether this is the next upcoming cycle. | no |
| isPast | Boolean! | Whether cycle is in the past. | no |
| isPrevious | Boolean! | Whether this is the previous cycle. | no |
| issueCountHistory | [Float!]! | Daily total issue count. | no |
| issues | IssueConnection! | Issues in this cycle. Requires separate query. | no (use list_issues with cycle filter) |
| links | EntityExternalLinkConnection! | [Internal] External links. | no |
| name | String | Custom cycle name (e.g., "Launch Sprint"). Null if using default "Sprint N". | **yes** |
| number | Float! | Cycle number (1, 2, 3...). **Primary identifier** within a team. | **yes** (primary key) |
| progress | Float! | Overall progress percentage (0-1). Based on completed + 0.25*in-progress estimates. | **yes** |
| progressHistory | JSONObject! | [Internal] Progress history. | no |
| scopeHistory | [Float!]! | Daily total estimate points. | no |
| startsAt | DateTime! | Start date/time of cycle. | **yes** |
| team | Team! | The team this cycle belongs to. | **yes** (as team key) |
| uncompletedIssuesUponClose | IssueConnection! | Issues not completed when cycle closed. | no |
| updatedAt | DateTime! | Last update timestamp. | no |

### Cycle TOON Schema Summary

**Included fields:** `number` (primary key), `id` (UUID in lookup), `name`, `startsAt`, `endsAt`, `isActive`, `progress`, `description`, `team` (as key)

---

## Project

A project grouping related issues. **Primary identifier: UUID (`id`)** - projects don't have a natural short identifier, so we use short keys (pr0, pr1) in TOON with UUID in lookup.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| autoArchivedAt | DateTime | Timestamp when auto-archived. | no |
| canceledAt | DateTime | Timestamp when canceled. | no |
| color | String! | Project display color. | no |
| comments | CommentConnection! | Comments on project overview. | no |
| completedAt | DateTime | Timestamp when completed. | no |
| completedIssueCountHistory | [Float!]! | Weekly completed issue count. | no |
| completedScopeHistory | [Float!]! | Weekly completed estimates. | no |
| content | String | Project content/documentation in markdown. | no |
| contentState | String | [Internal] YJS state. | no |
| convertedFromIssue | Issue | If project was converted from an issue. | no |
| createdAt | DateTime! | Creation timestamp. | no |
| creator | User | User who created the project. | no |
| currentProgress | JSONObject! | [INTERNAL] Current progress. | no |
| description | String! | Project description. | **yes** |
| documentContent | DocumentContent | Rich document content. | no |
| documents | DocumentConnection! | Linked documents. | no |
| externalLinks | EntityExternalLinkConnection! | External links (docs, designs, etc.). | no |
| facets | [Unknown!]! | [Internal] Facets. | no |
| favorite | Favorite | If current user favorited. | no |
| frequencyResolution | FrequencyResolutionType! | Reminder frequency resolution. | no |
| health | ProjectUpdateHealthType | Project health status (onTrack, atRisk, offTrack). | **yes** |
| healthUpdatedAt | DateTime | When health was last updated. | no |
| history | ProjectHistoryConnection! | Project change history. | no |
| icon | String | Project icon. | no |
| id | ID! | UUID. **Required for mutations**. | **yes** (in lookup) |
| initiatives | InitiativeConnection! | Parent initiatives. | no |
| initiativeToProjects | InitiativeToProjectConnection! | Initiative associations. | no |
| inProgressScopeHistory | [Float!]! | Weekly in-progress estimates. | no |
| integrationsSettings | IntegrationsSettings | Integration settings. | no |
| inverseRelations | ProjectRelationConnection! | Inverse project relations. | no |
| issueCountHistory | [Float!]! | Weekly issue count. | no |
| issues | IssueConnection! | Project issues. Requires separate query. | no (use list_issues with project filter) |
| labelIds | [ID!]! | Project label UUIDs. | no |
| labels | ProjectLabelConnection! | Project labels. | no |
| lastAppliedTemplate | Template | Last applied template. | no |
| lastUpdate | ProjectUpdate | Most recent project update post. | no |
| lead | User | Project lead/owner. | **yes** (as short key → lookup) |
| members | UserConnection! | Project members. | no |
| name | String! | Project name. | **yes** |
| needs | CustomerNeedConnection! | Linked customer needs. | no |
| priority | Int! | Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low. | **yes** (as 0-4 number) |
| priorityLabel | String! | Human-readable priority. Redundant with number. | no |
| prioritySortOrder | Float! | Internal sort order. | no |
| progress | Float! | Overall progress (0-1). | **yes** |
| progressHistory | JSONObject! | [INTERNAL] Progress history. | no |
| projectMilestones | ProjectMilestoneConnection! | Project milestones. | no |
| projectUpdateRemindersPausedUntilAt | DateTime | Update reminders paused until. | no |
| projectUpdates | ProjectUpdateConnection! | Project update posts. | no |
| relations | ProjectRelationConnection! | Project-to-project relations. | no |
| scope | Float! | Total estimate points in project. | no |
| scopeHistory | [Float!]! | Weekly scope history. | no |
| slugId | String! | URL slug. | no |
| sortOrder | Float! | Internal sort order. | no |
| startDate | TimelessDate | Planned start date. | **yes** |
| startDateResolution | DateResolutionType | Start date granularity (day/week/month). | no |
| startedAt | DateTime | When moved to started state. | no |
| status | ProjectStatus! | Project status object. Contains `{ id, name, type }`. Type: backlog/planned/started/paused/completed/canceled. | **yes** (use status.name or status.type) |
| targetDate | TimelessDate | Target completion date. | **yes** |
| targetDateResolution | DateResolutionType | Target date granularity. | no |
| teams | TeamConnection! | Teams working on project. | **yes** (as team keys) |
| trashed | Boolean | Whether in trash bin. | no |
| updatedAt | DateTime! | Last update timestamp. | no |
| updateReminderFrequency | Float | Update reminder frequency. | no |
| updateReminderFrequencyInWeeks | Float | Update frequency in weeks. | no |
| updateRemindersDay | Day | Day for update reminders. | no |
| updateRemindersHour | Float | Hour for update reminders. | no |
| url | String! | Project URL in Linear. | **yes** |

### Project TOON Schema Summary

**Included fields (in lookup table):** short key (pr0, pr1), `id` (UUID for API), `name`, `description`, `status` (type), `priority` (0-4), `progress`, `lead` (short key), `teams` (keys), `startDate`, `targetDate`, `health`, `url`

---

## Comment

A comment on an issue. **Primary identifier: UUID (`id`)** - required for editing/deleting comments.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| agentSession | AgentSession | Associated AI agent session. | no |
| agentSessions | AgentSessionConnection! | [Internal] Agent sessions. | no |
| archivedAt | DateTime | Timestamp when archived. | no |
| body | String! | Comment content in markdown. **The main content.** | **yes** |
| bodyData | String! | [Internal] Prosemirror document format. Use `body` instead. | no |
| botActor | ActorBot | Bot that created comment, if applicable. | no |
| children | CommentConnection! | Nested reply comments. | no (separate query) |
| createdAt | DateTime! | When comment was posted. | **yes** |
| createdIssues | IssueConnection! | Issues created from this comment. | no |
| documentContent | DocumentContent | Associated document content. | no |
| documentContentId | String | Document content ID. | no |
| editedAt | DateTime | When comment was last edited. Null if never edited. | **yes** |
| externalThread | SyncedExternalThread | External thread (Slack, etc.) synced with. | no |
| externalUser | ExternalUser | External user who wrote comment. | no |
| hideInLinear | Boolean! | [Internal] Hidden from Linear UI. | no |
| id | ID! | UUID. **Required for edit/delete mutations.** | **yes** |
| initiativeUpdate | InitiativeUpdate | Associated initiative update. | no |
| initiativeUpdateId | String | Initiative update ID. | no |
| issue | Issue | The issue this comment is on. Returns Issue object. | **yes** (as issue identifier) |
| issueId | String | Issue UUID. Use `issue` for identifier. | no |
| parent | Comment | Parent comment if this is a reply. | no |
| parentId | String | Parent comment UUID. | no |
| post | Post | Associated post. | no |
| projectUpdate | ProjectUpdate | Associated project update. | no |
| projectUpdateId | String | Project update ID. | no |
| quotedText | String | Referenced text for inline comments. | no |
| reactionData | JSONObject! | Emoji reaction summary. | no |
| reactions | [Reaction!]! | Individual reactions. | no |
| resolvedAt | DateTime | When thread was resolved. | no |
| resolvingComment | Comment | Comment that resolved the thread. | no |
| resolvingCommentId | String | Resolving comment ID. | no |
| resolvingUser | User | User who resolved the thread. | no |
| syncedWith | [ExternalEntityInfo!] | External services synced with. | no |
| threadSummary | JSONObject | [Internal] AI-generated thread summary. | no |
| updatedAt | DateTime! | Last update timestamp. | no |
| url | String! | Direct URL to comment. | **yes** |
| user | User | User who wrote the comment. | **yes** (as short key → lookup) |

### Comment TOON Schema Summary

**Included fields:** `id` (UUID for mutations), `issue` (identifier), `user` (short key), `body`, `createdAt`, `editedAt`, `url`

---

## WorkflowState

A state in a team's workflow (e.g., Todo, In Progress, Done). **Primary identifier: UUID (`id`)** - required for changing issue states. Use short keys (s0, s1) in TOON.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| color | String! | Display color (HEX). | no |
| createdAt | DateTime! | Creation timestamp. | no |
| description | String | State description. | no |
| id | ID! | UUID. **Required for mutations** (changing issue state). | **yes** (in lookup) |
| inheritedFrom | WorkflowState | Parent state if inherited. | no |
| issues | IssueConnection! | Issues in this state. Requires separate query. | no |
| name | String! | State name (e.g., "Todo", "In Progress", "Done"). | **yes** |
| position | Float! | Position in workflow (order). Lower = earlier in flow. | **yes** (for ordering) |
| team | Team! | Team this state belongs to. | **yes** (as team key) |
| type | String! | State category: "triage", "backlog", "unstarted", "started", "completed", "canceled". **Consistent across teams.** | **yes** |
| updatedAt | DateTime! | Last update timestamp. | no |

### WorkflowState TOON Schema Summary

**Included fields (in lookup table):** short key (s0, s1), `id` (UUID for API), `name`, `type`, `position`, `team` (key)

---

## IssueLabel

Labels that can be applied to issues. **Primary identifier: `name`** - Linear API accepts label names directly in mutations, resolving to the correct label.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| children | IssueLabelConnection! | Child labels (for label groups). | no |
| color | String! | Display color (HEX). | **yes** |
| createdAt | DateTime! | Creation timestamp. | no |
| creator | User | User who created the label. | no |
| description | String | Label description. | no |
| id | ID! | UUID. Not needed for most operations - name works. | no |
| inheritedFrom | IssueLabel | Original label if inherited. | no |
| isGroup | Boolean! | Whether label is a group (has children). | no |
| issues | IssueConnection! | Issues with this label. Requires separate query. | no |
| lastAppliedAt | DateTime | When last applied to an issue. | no |
| name | String! | Label name. **Primary identifier** - API accepts names directly. | **yes** |
| parent | IssueLabel | Parent label if in a group. | **yes** (parent name) |
| retiredAt | DateTime | [Internal] When retired. | no |
| retiredBy | User | User who retired label. | no |
| team | Team | Team label belongs to. Null = workspace-wide. | no |
| updatedAt | DateTime! | Last update timestamp. | no |

### IssueLabel TOON Schema Summary

**Included fields:** `name` (primary key - used directly in API), `color`, `parent` (name if grouped)

Note: Labels don't need a lookup table. Use names directly in issue data (comma-separated) and in mutations.

---

## IssueRelation

A relation between two issues (blocks, duplicate, related). **Primary identifier: UUID (`id`)** - for deleting relations. Usually created by specifying issue identifiers.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| createdAt | DateTime! | Creation timestamp. | no |
| id | ID! | UUID. Needed for deleting relations. | **yes** |
| issue | Issue! | Source issue ("this issue blocks..."). Returns Issue object. | **yes** (as identifier) |
| relatedIssue | Issue! | Target issue ("...blocks this issue"). Returns Issue object. | **yes** (as identifier) |
| type | String! | Relation type: "blocks", "duplicate", "related". | **yes** |
| updatedAt | DateTime! | Last update timestamp. | no |

### IssueRelation TOON Schema Summary

**Included fields:** `id` (for deletion), `issue` (source identifier), `type`, `relatedIssue` (target identifier)

Example: `SQT-123,blocks,SQT-456` means SQT-123 blocks SQT-456.

---

## Attachment

An attachment on an issue (files, PR links, support tickets). **Primary identifier: UUID (`id`) or `url`** - URL is often the unique identifier for external attachments.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| bodyData | String | Attachment body/description. | no |
| createdAt | DateTime! | Creation timestamp. | **yes** |
| creator | User | User who created attachment. | no |
| externalUserCreator | ExternalUser | External user creator. | no |
| groupBySource | Boolean! | Group attachments from same source. | no |
| id | ID! | UUID. For deletion/updates. | **yes** |
| issue | Issue! | Issue this attachment belongs to. | **yes** (as identifier) |
| metadata | JSONObject! | Custom metadata (varies by source). | no |
| originalIssue | Issue | Original issue if attachment was moved. | no |
| source | JSONObject | Source information (integration details). | no |
| sourceType | String | Source type (github, slack, zendesk, etc.). | **yes** |
| subtitle | String | Subtitle text in Linear widget. | **yes** |
| title | String! | Title text in Linear widget. | **yes** |
| updatedAt | DateTime! | Last update timestamp. | no |
| url | String! | Attachment URL/location. **Often the unique identifier** for external resources. | **yes** |

### Attachment TOON Schema Summary

**Included fields:** `id`, `issue` (identifier), `title`, `subtitle`, `url`, `sourceType`, `createdAt`

---

## ProjectMilestone

A milestone within a project. **Primary identifier: UUID (`id`)** - no natural short key.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| archivedAt | DateTime | Timestamp when archived. | no |
| createdAt | DateTime! | Creation timestamp. | no |
| currentProgress | JSONObject! | [Internal] Current progress. | no |
| description | String | Milestone description in markdown. | **yes** |
| descriptionState | String | [Internal] YJS state. | no |
| documentContent | DocumentContent | Rich document content. | no |
| id | ID! | UUID. Required for mutations. | **yes** |
| issues | IssueConnection! | Issues in this milestone. | no |
| name | String! | Milestone name. | **yes** |
| progress | Float! | Progress percentage (0-1). | **yes** |
| progressHistory | JSONObject! | [Internal] Progress history. | no |
| project | Project! | Parent project. | **yes** (as project short key) |
| sortOrder | Float! | Order within project. | no |
| status | ProjectMilestoneStatus! | Status: planned, started, completed. | **yes** |
| targetDate | TimelessDate | Target completion date. | **yes** |
| updatedAt | DateTime! | Last update timestamp. | no |

### ProjectMilestone TOON Schema Summary

**Included fields:** `id`, `name`, `description`, `status`, `targetDate`, `progress`, `project` (short key)

---

## Organization

The workspace/organization containing teams and users. **Rarely needed in TOON** - workspace-level config. Included for reference.

| Field | Type | Description | In TOON? |
|-------|------|-------------|----------|
| aiAddonEnabled | Boolean! | [INTERNAL] AI add-on enabled. | no |
| aiDiscussionSummariesEnabled | Boolean! | AI discussion summaries enabled. | no |
| aiProviderConfiguration | JSONObject | [INTERNAL] AI provider config. | no |
| aiThreadSummariesEnabled | Boolean! | AI thread summaries enabled. | no |
| allowedAuthServices | [String!]! | Allowed auth providers. | no |
| allowedFileUploadContentTypes | [String!] | Allowed upload types. | no |
| archivedAt | DateTime | Timestamp when archived. | no |
| codeIntelligenceEnabled | Boolean! | [INTERNAL] Code intelligence. | no |
| codeIntelligenceRepository | String | [INTERNAL] Code intel repo. | no |
| createdAt | DateTime! | Creation timestamp. | no |
| createdIssueCount | Int! | Total issue count. | no |
| customerCount | Int! | Customer count. | no |
| customersConfiguration | JSONObject! | Customers feature config. | no |
| customersEnabled | Boolean! | Customers feature enabled. | no |
| defaultFeedSummarySchedule | FeedSummarySchedule | Feed summary schedule. | no |
| deletionRequestedAt | DateTime | Deletion request timestamp. | no |
| facets | [Unknown!]! | [Internal] Facets. | no |
| feedEnabled | Boolean! | Feed feature enabled. | no |
| fiscalYearStartMonth | Float! | Fiscal year start (0-11). | no |
| generatedUpdatesEnabled | Boolean! | [INTERNAL] Generated updates. | no |
| gitBranchFormat | String | Git branch naming format. | no |
| gitLinkbackDescriptionsEnabled | Boolean! | Include descriptions in Git linkbacks. | no |
| gitLinkbackMessagesEnabled | Boolean! | Git linkbacks for private repos. | no |
| gitPublicLinkbackMessagesEnabled | Boolean! | Git linkbacks for public repos. | no |
| hideNonPrimaryOrganizations | Boolean! | Hide other orgs for new users. | no |
| hipaaComplianceEnabled | Boolean! | HIPAA compliance mode. | no |
| id | ID! | UUID. | maybe (for API reference) |
| initiativeUpdateReminderFrequencyInWeeks | Float | Initiative update frequency. | no |
| initiativeUpdateRemindersDay | Day! | Initiative reminder day. | no |
| initiativeUpdateRemindersHour | Float! | Initiative reminder hour. | no |
| integrations | IntegrationConnection! | Org integrations. | no |
| ipRestrictions | [OrganizationIpRestriction!] | IP restrictions. | no |
| labels | IssueLabelConnection! | Workspace-wide labels. | no |
| logoUrl | String | Org logo URL. | no |
| name | String! | Organization name. | maybe |
| periodUploadVolume | Float! | 30-day upload volume (MB). | no |
| previousUrlKeys | [String!]! | Previous URL keys. | no |
| projectLabels | ProjectLabelConnection! | Project labels. | no |
| projectStatuses | [ProjectStatus!]! | Project status definitions. | no |
| projectUpdateReminderFrequencyInWeeks | Float | Project update frequency. | no |
| projectUpdateRemindersDay | Day! | Project reminder day. | no |
| projectUpdateRemindersHour | Float! | Project reminder hour. | no |
| releaseChannel | ReleaseChannel! | Feature release channel. | no |
| roadmapEnabled | Boolean! | Roadmap feature enabled. | no |
| samlEnabled | Boolean! | SAML auth enabled. | no |
| samlSettings | JSONObject | [INTERNAL] SAML settings. | no |
| scimEnabled | Boolean! | SCIM provisioning enabled. | no |
| scimSettings | JSONObject | [INTERNAL] SCIM settings. | no |
| securitySettings | JSONObject! | Security settings. | no |
| subscription | PaidSubscription | Paid subscription info. | no |
| teams | TeamConnection! | All teams. | no |
| templates | TemplateConnection! | Org templates. | no |
| themeSettings | JSONObject | [ALPHA] Theme settings. | no |
| trialEndsAt | DateTime | Trial end date. | no |
| trialStartsAt | DateTime | Trial start date. | no |
| updatedAt | DateTime! | Last update timestamp. | no |
| urlKey | String! | Org URL key. | maybe |
| userCount | Int! | Active user count. | no |
| users | UserConnection! | All users. | no |
| workingDays | [Float!]! | [Internal] Working days (0-6). | no |

### Organization TOON Schema Summary

**Usually not included in TOON** - this is workspace config, not transactional data. If needed: `id`, `name`, `urlKey`.
