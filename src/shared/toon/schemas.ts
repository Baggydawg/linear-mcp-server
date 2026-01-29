/**
 * TOON Schema Definitions for Linear MCP Server
 *
 * This file defines all TOON schemas for Linear entity types.
 *
 * Design Principles:
 * 1. No UUIDs in output - MCP server stores them internally
 * 2. Short keys for static entities - Users (u0), States (s0), Projects (pr0)
 * 3. Natural keys where available - Issues (SQT-123), Teams (SQT), Cycles (5), Labels (name)
 * 4. Dynamic entities (Comments, Relations, Attachments) - UUID only when mutation needed
 *
 * @see docs/toon-schema.md for full specification
 */

import type { ToonSchema } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP TABLES (prefixed with _)
// These define short keys for entities referenced multiple times.
// NO UUIDs in output - they're stored internally by the MCP server.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User lookup table schema.
 * Maps short keys (u0, u1, u2...) to user details.
 *
 * @example
 * ```
 * _users[3]{key,name,displayName,email,role}:
 *   u0,Tobias Nilsson,tobias,t.nilsson@example.com,Tech Lead
 *   u1,Ian Bastos,ian-bastos,i.bastos@example.com,Frontend Dev
 *   u2,Luis Carvajal,l.carvajal,l.carvajal@example.com,
 * ```
 */
export const USER_LOOKUP_SCHEMA: ToonSchema = {
  name: '_users',
  fields: ['key', 'name', 'displayName', 'email', 'role'],
  // key: u0, u1... | name: full name | displayName: nick | email: for identification
  // role: optional context from local config (e.g., "Overseer (no assignments)")
};

/**
 * Workflow state lookup table schema.
 * Maps short keys (s0, s1, s2...) to state details.
 *
 * @example
 * ```
 * _states[8]{key,name,type}:
 *   s0,Triage,triage
 *   s1,Backlog,backlog
 *   s2,Todo,unstarted
 *   s3,In Progress,started
 *   s4,In Review,started
 *   s5,Done,completed
 *   s6,Canceled,canceled
 *   s7,Duplicate,canceled
 * ```
 */
export const STATE_LOOKUP_SCHEMA: ToonSchema = {
  name: '_states',
  fields: ['key', 'name', 'type'],
  // key: s0, s1... | name: state name | type: triage/backlog/unstarted/started/completed/canceled
};

/**
 * Project lookup table schema.
 * Maps short keys (pr0, pr1, pr2...) to project details.
 *
 * @example
 * ```
 * _projects[3]{key,name,state}:
 *   pr0,MVP Sophiq Platform,started
 *   pr1,Data Intelligence,backlog
 *   pr2,Valuation,backlog
 * ```
 */
export const PROJECT_LOOKUP_SCHEMA: ToonSchema = {
  name: '_projects',
  fields: ['key', 'name', 'state'],
  // key: pr0, pr1... | name: project name | state: backlog/planned/started/paused/completed/canceled
};

/**
 * Team lookup table schema.
 * Uses natural key (team key like SQT) - no short key needed.
 *
 * @example
 * ```
 * _teams[1]{key,name,cyclesEnabled,cycleDuration,estimationType}:
 *   SQT,Tech,true,2,fibonacci
 * ```
 */
export const TEAM_LOOKUP_SCHEMA: ToonSchema = {
  name: '_teams',
  fields: ['key', 'name', 'cyclesEnabled', 'cycleDuration', 'estimationType'],
  // key: SQT (natural) | name: team name | cyclesEnabled: bool | cycleDuration: weeks | estimationType: fibonacci/linear/etc
};

/**
 * Cycle lookup table schema.
 * Uses natural number (cycle number) - no short key needed.
 *
 * @example
 * ```
 * _cycles[3]{num,name,start,end,active,progress}:
 *   5,,2026-01-26,2026-02-08,true,0.27
 *   6,,2026-02-09,2026-02-22,false,0
 *   4,,2026-01-12,2026-01-25,false,0.64
 * ```
 */
export const CYCLE_LOOKUP_SCHEMA: ToonSchema = {
  name: '_cycles',
  fields: ['num', 'name', 'start', 'end', 'active', 'progress'],
  // num: 5 (natural) | name: custom name | start/end: dates | active: bool | progress: 0-1
};

/**
 * Label lookup table schema.
 * Uses label name as primary key - API accepts names directly.
 *
 * @example
 * ```
 * _labels[9]{name,color}:
 *   Bug,#EB5757
 *   Feature,#BB87FC
 *   Improvement,#4EA7FC
 *   Tech Debt,#F2994A
 * ```
 */
export const LABEL_LOOKUP_SCHEMA: ToonSchema = {
  name: '_labels',
  fields: ['name', 'color'],
  // name: label name (primary key) | color: hex color
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA TABLES
// These are the main entity schemas for data output.
// NO UUIDs in output - they're stored internally by the MCP server.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Issue schema for data output.
 * Primary key: identifier (SQT-123).
 *
 * @example
 * ```
 * issues[5]{identifier,title,state,assignee,priority,estimate,project,cycle,dueDate,labels,parent,team,url,desc}:
 *   SQT-174,"Security: Migrate secrets",s2,u0,1,5,,,,,,,https://...,"Security audit revealed..."
 *   SQT-171,"Filters panel UX",s2,u0,2,,pr0,5,,Improvement,,,https://...,
 * ```
 *
 * Note: Tools may output a subset of fields based on context.
 * Sprint context typically omits: dueDate, team, url (included in _meta or implied)
 * Full issue detail views include all fields.
 */
export const ISSUE_SCHEMA: ToonSchema = {
  name: 'issues',
  fields: [
    'identifier', // SQT-160 (primary key)
    'title',
    'state', // s0 (short key -> lookup)
    'assignee', // u0 (short key -> lookup) or empty
    'priority', // 0-4 (API number)
    'estimate', // number or empty
    'project', // pr0 (short key -> lookup) or empty
    'cycle', // 5 (cycle number) or empty
    'dueDate', // YYYY-MM-DD or empty
    'labels', // "Bug,Feature" (comma-separated names)
    'parent', // SQT-159 (parent issue identifier) or empty
    'team', // SQT (team key)
    'url', // Direct URL to issue
    'desc', // Description (may be truncated)
    'createdAt', // ISO timestamp
    'creator', // u0 (short key -> lookup) or empty
  ],
};

/**
 * Comment schema for read-only output.
 * Dynamic entity - no short keys. UUID omitted for read-only context.
 *
 * IMPORTANT: Comment authors MUST always be included in _users lookup table.
 *
 * @example
 * ```
 * comments[2]{issue,user,body,createdAt}:
 *   SQT-163,u1,"Fixed the S3 permissions issue",2026-01-26T15:30:00Z
 *   SQT-163,u0,"LGTM, moving to review",2026-01-26T18:00:00Z
 * ```
 */
export const COMMENT_SCHEMA: ToonSchema = {
  name: 'comments',
  fields: ['issue', 'user', 'body', 'createdAt'],
  // Read-only: no id field
  // Note: user field references _users short key (u0, u1...) - always include author in _users
};

/**
 * Comment schema with UUID for mutations.
 * Include UUID when edit/delete is needed.
 *
 * @example
 * ```
 * comments[1]{id,issue,user,body,createdAt}:
 *   abc123-...,SQT-160,u0,"This blocks the algorithm work",2026-01-26T11:30:00Z
 * ```
 */
export const COMMENT_SCHEMA_WITH_ID: ToonSchema = {
  name: 'comments',
  fields: ['id', 'issue', 'user', 'body', 'createdAt'],
};

/**
 * Issue relation schema for read-only output.
 * Dynamic entity - no short keys. UUID omitted for read-only context.
 *
 * @example
 * ```
 * relations[1]{from,type,to}:
 *   SQT-167,blocks,SQT-168
 * ```
 */
export const RELATION_SCHEMA: ToonSchema = {
  name: 'relations',
  fields: ['from', 'type', 'to'],
  // from/to: issue identifiers | type: blocks/duplicate/related
};

/**
 * Issue relation schema with UUID for mutations.
 * Include UUID when deletion is needed.
 *
 * @example
 * ```
 * relations[1]{id,from,type,to}:
 *   rel-uuid-...,SQT-160,blocks,SQT-159
 * ```
 */
export const RELATION_SCHEMA_WITH_ID: ToonSchema = {
  name: 'relations',
  fields: ['id', 'from', 'type', 'to'],
};

/**
 * Attachment schema for read-only output.
 * Dynamic entity - typically read-only context.
 *
 * @example
 * ```
 * attachments[1]{issue,title,subtitle,url,sourceType}:
 *   SQT-160,"PR #42","Add login feature",https://github.com/...,github
 * ```
 */
export const ATTACHMENT_SCHEMA: ToonSchema = {
  name: 'attachments',
  fields: ['issue', 'title', 'subtitle', 'url', 'sourceType'],
};

// ─────────────────────────────────────────────────────────────────────────────
// FULL ENTITY SCHEMAS (for dedicated list tools)
// These provide complete entity views when listing all of a type.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full team schema for list_teams tool output.
 * Uses natural key (team key like SQT).
 *
 * @example
 * ```
 * teams[1]{key,name,description,cyclesEnabled,cycleDuration,estimationType,activeCycle}:
 *   SQT,Tech,"Platform development team",true,2,fibonacci,5
 * ```
 */
export const TEAM_SCHEMA: ToonSchema = {
  name: 'teams',
  fields: [
    'key',
    'name',
    'description',
    'cyclesEnabled',
    'cycleDuration',
    'estimationType',
    'activeCycle',
  ],
};

/**
 * Full user schema for list_users tool output.
 * Uses short key (u0, u1...).
 *
 * @example
 * ```
 * users[2]{key,name,displayName,email,active}:
 *   u0,Tobias Nilsson,tobias,t.nilsson@example.com,true
 *   u1,Ian Bastos,ian-bastos,i.bastos@example.com,true
 * ```
 */
export const USER_SCHEMA: ToonSchema = {
  name: 'users',
  fields: ['key', 'name', 'displayName', 'email', 'active'],
};

/**
 * Full cycle schema for cycles list output.
 * Uses natural number (cycle number).
 *
 * @example
 * ```
 * cycles[3]{num,name,start,end,active,progress}:
 *   5,,2026-01-26,2026-02-08,true,0.27
 *   6,,2026-02-09,2026-02-22,false,0
 *   4,,2026-01-12,2026-01-25,false,0.64
 * ```
 */
export const CYCLE_SCHEMA: ToonSchema = {
  name: 'cycles',
  fields: ['num', 'name', 'start', 'end', 'active', 'progress'],
};

/**
 * Full project schema for list_projects tool output.
 * Uses short key (pr0, pr1...).
 *
 * @example
 * ```
 * projects[2]{key,name,description,state,priority,progress,lead,teams,startDate,targetDate,health}:
 *   pr0,MVP Sophiq Platform,"Platform for property management",started,2,0.61,u1,"SQT",,2026-02-27,onTrack
 *   pr1,Data Intelligence,,backlog,3,0.06,u2,"SQT",,,
 * ```
 */
export const PROJECT_SCHEMA: ToonSchema = {
  name: 'projects',
  fields: [
    'key',
    'name',
    'description',
    'state',
    'priority',
    'progress',
    'lead',
    'teams',
    'startDate',
    'targetDate',
    'health',
  ],
};

/**
 * Milestone schema for project milestones.
 * Uses short key (m0, m1...).
 *
 * @example
 * ```
 * milestones[2]{key,name,status,targetDate,progress,project}:
 *   m0,Alpha Release,started,2026-02-15,0.6,pr0
 *   m1,Beta Release,planned,2026-03-01,0,pr0
 * ```
 */
export const MILESTONE_SCHEMA: ToonSchema = {
  name: 'milestones',
  fields: ['key', 'name', 'status', 'targetDate', 'progress', 'project'],
  // key: m0, m1... | status: planned/started/completed
};

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION SCHEMA
// Used for paginated responses.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pagination schema for paginated responses.
 *
 * @example
 * ```
 * _pagination{hasMore,cursor,fetched,total}:
 *   true,eyJwb3MiOjUwfQ==,50,127
 * ```
 */
export const PAGINATION_SCHEMA: ToonSchema = {
  name: '_pagination',
  fields: ['hasMore', 'cursor', 'fetched', 'total'],
  // hasMore: true/false | cursor: opaque string for next page | fetched: count in response | total: total count (if known)
};

// ─────────────────────────────────────────────────────────────────────────────
// WRITE RESULTS SCHEMAS
// Used for create/update operation results.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write result metadata schema.
 * Summarizes the outcome of a batch write operation.
 *
 * @example
 * ```
 * _meta{action,succeeded,failed,total}:
 *   create_issues,2,1,3
 * ```
 */
export const WRITE_RESULT_META_SCHEMA: ToonSchema = {
  name: '_meta',
  fields: ['action', 'succeeded', 'failed', 'total'],
};

/**
 * Individual write result schema.
 * Per-item outcome in batch operations.
 *
 * @example
 * ```
 * results[3]{index,status,identifier,error}:
 *   0,ok,SQT-175,
 *   1,ok,SQT-176,
 *   2,error,,Invalid teamId
 * ```
 */
export const WRITE_RESULT_SCHEMA: ToonSchema = {
  name: 'results',
  fields: ['index', 'status', 'identifier', 'error'],
};

/**
 * Changes schema for update diffs.
 * Shows before/after values for changed fields.
 *
 * @example
 * ```
 * changes[3]{identifier,field,before,after}:
 *   SQT-160,state,s2,s3
 *   SQT-160,assignee,,u2
 *   SQT-161,priority,3,1
 * ```
 */
export const CHANGES_SCHEMA: ToonSchema = {
  name: 'changes',
  fields: ['identifier', 'field', 'before', 'after'],
};

/**
 * Write result schema for comments (uses issue identifier).
 * Per-item outcome for comment batch operations.
 *
 * @example
 * ```
 * results[2]{index,status,issue,error}:
 *   0,ok,SQT-160,
 *   1,ok,SQT-161,
 * ```
 */
export const COMMENT_WRITE_RESULT_SCHEMA: ToonSchema = {
  name: 'results',
  fields: ['index', 'status', 'issue', 'error'],
};

/**
 * Created comments schema for add_comments output.
 *
 * @example
 * ```
 * comments[2]{issue,body,createdAt}:
 *   SQT-160,"Comment text here",2026-01-27T12:00:00Z
 *   SQT-161,"Another comment",2026-01-27T12:01:00Z
 * ```
 */
export const CREATED_COMMENT_SCHEMA: ToonSchema = {
  name: 'comments',
  fields: ['issue', 'body', 'createdAt'],
};

/**
 * Write result schema for projects (uses short key).
 * Per-item outcome for project batch operations.
 *
 * @example
 * ```
 * results[2]{index,status,key,error}:
 *   0,ok,pr0,
 *   1,error,,Invalid teamId
 * ```
 */
export const PROJECT_WRITE_RESULT_SCHEMA: ToonSchema = {
  name: 'results',
  fields: ['index', 'status', 'key', 'error'],
};

/**
 * Created projects schema for create_projects output.
 *
 * @example
 * ```
 * created[1]{key,name,state}:
 *   pr2,New Project,planned
 * ```
 */
export const CREATED_PROJECT_SCHEMA: ToonSchema = {
  name: 'created',
  fields: ['key', 'name', 'state'],
};

/**
 * Project changes schema for update_projects diffs.
 * Shows before/after values for changed fields using project short keys.
 *
 * @example
 * ```
 * changes[2]{key,field,before,after}:
 *   pr0,state,planned,started
 *   pr0,targetDate,,2026-03-15
 * ```
 */
export const PROJECT_CHANGES_SCHEMA: ToonSchema = {
  name: 'changes',
  fields: ['key', 'field', 'before', 'after'],
};

// ─────────────────────────────────────────────────────────────────────────────
// GAP ANALYSIS SCHEMA (for get_sprint_context)
// Identifies sprint health issues that require attention.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gap analysis schema for sprint context.
 * Identifies issues that need attention.
 *
 * Gap types:
 * - no_estimate: Issues without estimate field (affects velocity calculation)
 * - no_assignee: Issues without assignee (unassigned work may be forgotten)
 * - stale: No updates for 7+ days (may be blocked or deprioritized)
 * - blocked: Has blocking relations (cannot proceed until dependency resolved)
 * - priority_mismatch: Urgent (priority 1) issues not started (high priority items stuck)
 *
 * @example
 * ```
 * _gaps[5]{type,count,issues}:
 *   no_estimate,3,"SQT-174,SQT-168,SQT-171"
 *   no_assignee,1,"SQT-165"
 *   stale,2,"SQT-163,SQT-168"
 *   blocked,1,"SQT-168"
 *   priority_mismatch,1,"SQT-174"
 * ```
 */
export const GAP_SCHEMA: ToonSchema = {
  name: '_gaps',
  fields: ['type', 'count', 'issues'],
};

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA COLLECTIONS
// Grouped exports for convenience.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All lookup table schemas (prefixed with _).
 */
export const LOOKUP_SCHEMAS = {
  USER: USER_LOOKUP_SCHEMA,
  STATE: STATE_LOOKUP_SCHEMA,
  PROJECT: PROJECT_LOOKUP_SCHEMA,
  TEAM: TEAM_LOOKUP_SCHEMA,
  CYCLE: CYCLE_LOOKUP_SCHEMA,
  LABEL: LABEL_LOOKUP_SCHEMA,
} as const;

/**
 * All data table schemas (main entities).
 */
export const DATA_SCHEMAS = {
  ISSUE: ISSUE_SCHEMA,
  COMMENT: COMMENT_SCHEMA,
  COMMENT_WITH_ID: COMMENT_SCHEMA_WITH_ID,
  RELATION: RELATION_SCHEMA,
  RELATION_WITH_ID: RELATION_SCHEMA_WITH_ID,
  ATTACHMENT: ATTACHMENT_SCHEMA,
} as const;

/**
 * All full entity schemas (for dedicated list tools).
 */
export const FULL_ENTITY_SCHEMAS = {
  TEAM: TEAM_SCHEMA,
  USER: USER_SCHEMA,
  CYCLE: CYCLE_SCHEMA,
  PROJECT: PROJECT_SCHEMA,
  MILESTONE: MILESTONE_SCHEMA,
} as const;

/**
 * All write result schemas.
 */
export const WRITE_SCHEMAS = {
  META: WRITE_RESULT_META_SCHEMA,
  RESULT: WRITE_RESULT_SCHEMA,
  CHANGES: CHANGES_SCHEMA,
  COMMENT_RESULT: COMMENT_WRITE_RESULT_SCHEMA,
  CREATED_COMMENT: CREATED_COMMENT_SCHEMA,
  PROJECT_RESULT: PROJECT_WRITE_RESULT_SCHEMA,
  CREATED_PROJECT: CREATED_PROJECT_SCHEMA,
  PROJECT_CHANGES: PROJECT_CHANGES_SCHEMA,
} as const;

/**
 * All schemas combined.
 */
export const ALL_SCHEMAS = {
  // Lookup tables
  ...LOOKUP_SCHEMAS,

  // Data tables
  ...DATA_SCHEMAS,

  // Full entities
  TEAM_FULL: TEAM_SCHEMA,
  USER_FULL: USER_SCHEMA,
  CYCLE_FULL: CYCLE_SCHEMA,
  PROJECT_FULL: PROJECT_SCHEMA,
  MILESTONE_FULL: MILESTONE_SCHEMA,

  // Pagination
  PAGINATION: PAGINATION_SCHEMA,

  // Write results
  WRITE_META: WRITE_RESULT_META_SCHEMA,
  WRITE_RESULT: WRITE_RESULT_SCHEMA,
  WRITE_CHANGES: CHANGES_SCHEMA,
  COMMENT_WRITE_RESULT: COMMENT_WRITE_RESULT_SCHEMA,
  CREATED_COMMENT: CREATED_COMMENT_SCHEMA,
  PROJECT_WRITE_RESULT: PROJECT_WRITE_RESULT_SCHEMA,
  CREATED_PROJECT: CREATED_PROJECT_SCHEMA,
  PROJECT_CHANGES: PROJECT_CHANGES_SCHEMA,

  // Gap analysis
  GAP: GAP_SCHEMA,
} as const;
