/**
 * Get Sprint Context tool - fetch comprehensive sprint data in a single call.
 *
 * This is a Tier 2 tool that returns:
 * - Cycle metadata (team, sprint number, dates)
 * - All issues in the cycle with comments and relations
 * - Gap analysis (missing estimates, unassigned, stale, blocked, priority mismatches)
 *
 * Always outputs TOON format (new tool, no legacy mode).
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import {
  createErrorFromException,
  formatErrorMessage,
} from '../../../utils/errors.js';
import { getLinearClient } from '../../../services/linear/client.js';
import {
  COMMENT_SCHEMA,
  encodeResponse,
  formatCycleToon,
  formatEstimateToon,
  formatPriorityToon,
  GAP_SCHEMA,
  getOrInitRegistry,
  getProjectMetadata,
  getUserMetadata,
  getUserStatusLabel,
  PROJECT_LOOKUP_SCHEMA,
  RELATION_SCHEMA,
  type ShortKeyRegistry,
  STATE_LOOKUP_SCHEMA,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { fetchWorkspaceDataForRegistry } from '../shared/registry-init.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input Schema
// ─────────────────────────────────────────────────────────────────────────────

const InputSchema = z.object({
  team: z
    .string()
    .optional()
    .describe('Team key (e.g., "SQT"). Defaults to first team.'),
  cycle: z
    .union([z.enum(['current', 'next', 'previous']), z.number().int().positive()])
    .optional()
    .describe(
      'Cycle selector: "current" (default), "next", "previous", or a specific cycle number.',
    ),
  includeComments: z
    .boolean()
    .optional()
    .describe('Include comments on issues. Default: true.'),
  includeRelations: z
    .boolean()
    .optional()
    .describe('Include issue relations (blocks, etc.). Default: true.'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RawIssueData {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  state: { id: string; name: string; type: string };
  project?: { id: string; name?: string } | null;
  assignee?: { id: string; name?: string } | null;
  cycle?: { number: number } | null;
  parent?: { identifier: string } | null;
  createdAt?: string | Date;
  updatedAt: string;
  labels?: Array<{ id: string; name: string }>;
  creator?: { id: string; name?: string } | null;
}

interface RawCommentData {
  id: string;
  issueIdentifier: string;
  body: string;
  createdAt: string;
  user?: { id: string; name?: string } | null;
}

interface RawRelationData {
  id: string;
  type: string;
  issue: { identifier: string };
  relatedIssue: { identifier: string };
}

interface RawCycleData {
  id: string;
  number: number;
  name?: string | null;
  startsAt: string;
  endsAt: string;
  progress?: number;
}

interface Gap {
  type: 'no_estimate' | 'no_assignee' | 'stale' | 'blocked' | 'priority_mismatch';
  count: number;
  issues: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GraphQL Query
// ─────────────────────────────────────────────────────────────────────────────

const SPRINT_CONTEXT_QUERY = `
  query GetSprintContext(
    $teamId: String!,
    $cycleNumber: Float,
    $includeComments: Boolean!,
    $includeRelations: Boolean!
  ) {
    team(id: $teamId) {
      id
      key
      name
      cycles(
        filter: { number: { eq: $cycleNumber } }
        first: 1
      ) {
        nodes {
          id
          number
          name
          startsAt
          endsAt
          progress
          issues {
            nodes {
              id
              identifier
              title
              description
              priority
              estimate
              createdAt
              updatedAt
              state { id name type }
              project { id name }
              assignee { id name }
              creator { id name }
              parent { identifier }
              labels { nodes { id name } }
              comments(first: 50) @include(if: $includeComments) {
                nodes {
                  id
                  body
                  createdAt
                  user { id name }
                }
              }
              relations @include(if: $includeRelations) {
                nodes {
                  id
                  type
                  relatedIssue { identifier }
                }
              }
            }
          }
        }
      }
      activeCycle {
        id
        number
        name
        startsAt
        endsAt
        progress
      }
    }
  }
`;

// Separate query to find cycles by relative position
const CYCLES_QUERY = `
  query GetTeamCycles($teamId: String!) {
    team(id: $teamId) {
      id
      key
      name
      cycles(
        orderBy: createdAt
        first: 50
      ) {
        nodes {
          id
          number
          name
          startsAt
          endsAt
          progress
        }
      }
      activeCycle {
        id
        number
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Gap Analysis
// ─────────────────────────────────────────────────────────────────────────────

function calculateGaps(issues: RawIssueData[], relations: RawRelationData[]): Gap[] {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const gaps: Gap[] = [];

  // Terminal states that should be excluded from most gap checks
  const terminalTypes = ['completed', 'canceled'];

  // No estimate - all issues without estimate
  const noEstimate = issues.filter(
    (i) => i.estimate === null || i.estimate === undefined,
  );
  if (noEstimate.length > 0) {
    gaps.push({
      type: 'no_estimate',
      count: noEstimate.length,
      issues: noEstimate.map((i) => i.identifier),
    });
  }

  // No assignee - unassigned, excluding terminal states
  const noAssignee = issues.filter(
    (i) => !i.assignee && !terminalTypes.includes(i.state.type),
  );
  if (noAssignee.length > 0) {
    gaps.push({
      type: 'no_assignee',
      count: noAssignee.length,
      issues: noAssignee.map((i) => i.identifier),
    });
  }

  // Stale - no updates for 7+ days, excluding terminal states
  const stale = issues.filter(
    (i) =>
      !terminalTypes.includes(i.state.type) && new Date(i.updatedAt) < sevenDaysAgo,
  );
  if (stale.length > 0) {
    gaps.push({
      type: 'stale',
      count: stale.length,
      issues: stale.map((i) => i.identifier),
    });
  }

  // Blocked - has blocking relations, excluding terminal states
  // In Linear, type "blocks" means the issue blocks the related issue
  // So we look for issues where relatedIssue matches (they are blocked BY something)
  const blockedIdentifiers = new Set<string>();
  for (const relation of relations) {
    if (relation.type === 'blocks') {
      // The relatedIssue is blocked by the source issue
      blockedIdentifiers.add(relation.relatedIssue.identifier);
    }
  }
  const blocked = issues.filter(
    (i) =>
      blockedIdentifiers.has(i.identifier) && !terminalTypes.includes(i.state.type),
  );
  if (blocked.length > 0) {
    gaps.push({
      type: 'blocked',
      count: blocked.length,
      issues: blocked.map((i) => i.identifier),
    });
  }

  // Priority mismatch - urgent (priority 1) issues not started
  const unstartedTypes = ['unstarted', 'backlog', 'triage'];
  const priorityMismatch = issues.filter(
    (i) => i.priority === 1 && unstartedTypes.includes(i.state.type),
  );
  if (priorityMismatch.length > 0) {
    gaps.push({
      type: 'priority_mismatch',
      count: priorityMismatch.length,
      issues: priorityMismatch.map((i) => i.identifier),
    });
  }

  return gaps;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOON Builders
// ─────────────────────────────────────────────────────────────────────────────

function issueToToonRow(
  issue: RawIssueData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  let assigneeKey =
    registry && issue.assignee?.id
      ? tryGetShortKey(registry, 'user', issue.assignee.id)
      : undefined;
  const stateKey =
    registry && issue.state?.id
      ? tryGetShortKey(registry, 'state', issue.state.id)
      : undefined;
  const projectKey =
    registry && issue.project?.id
      ? tryGetShortKey(registry, 'project', issue.project.id)
      : undefined;
  let creatorKey =
    registry && issue.creator?.id
      ? tryGetShortKey(registry, 'user', issue.creator.id)
      : undefined;

  // Fallback to external user keys if not found in registry
  if (!assigneeKey && fallbackUserMap && issue.assignee?.id) {
    assigneeKey = fallbackUserMap.get(issue.assignee.id);
  }
  if (!creatorKey && fallbackUserMap && issue.creator?.id) {
    creatorKey = fallbackUserMap.get(issue.creator.id);
  }

  // Collect label names as comma-separated string
  const labelNames = (issue.labels ?? []).map((l) => l.name).join(',');

  // Truncate description to 3000 chars for bulk tool (Tier 2)
  let desc = issue.description ?? null;
  if (desc && desc.length > 3000) {
    desc = `${desc.slice(0, 2985)}... [truncated]`;
  }

  return {
    identifier: issue.identifier,
    title: issue.title,
    state: stateKey ?? issue.state?.name ?? '',
    assignee: assigneeKey ?? '',
    priority: formatPriorityToon(issue.priority),
    estimate: formatEstimateToon(issue.estimate),
    project: projectKey ?? issue.project?.name ?? '',
    cycle: formatCycleToon(issue.cycle?.number),
    labels: labelNames || null,
    parent: issue.parent?.identifier ?? null,
    desc,
    createdAt: issue.createdAt
      ? issue.createdAt instanceof Date
        ? issue.createdAt.toISOString()
        : issue.createdAt
      : null,
    creator: creatorKey ?? '',
  };
}

function commentToToonRow(
  comment: RawCommentData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  let userKey =
    registry && comment.user?.id
      ? tryGetShortKey(registry, 'user', comment.user.id)
      : undefined;

  // Fallback to external user key if not found in registry
  if (!userKey && fallbackUserMap && comment.user?.id) {
    userKey = fallbackUserMap.get(comment.user.id);
  }

  return {
    issue: comment.issueIdentifier,
    user: userKey ?? '',
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function relationToToonRow(relation: RawRelationData): ToonRow {
  // Normalize relation type to TOON format
  const typeMap: Record<string, string> = {
    blocks: 'blocks',
    duplicate: 'duplicate',
    related: 'related',
  };

  return {
    from: relation.issue.identifier,
    type: typeMap[relation.type] ?? relation.type,
    to: relation.relatedIssue.identifier,
  };
}

function gapToToonRow(gap: Gap): ToonRow {
  return {
    type: gap.type,
    count: gap.count,
    issues: gap.issues.join(','),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Builders (Tier 2 - Referenced Only)
// ─────────────────────────────────────────────────────────────────────────────

interface ReferencedEntities {
  userIds: Set<string>;
  stateIds: Set<string>;
  projectIds: Set<string>;
}

function collectReferencedEntities(
  issues: RawIssueData[],
  comments: RawCommentData[],
): ReferencedEntities {
  const refs: ReferencedEntities = {
    userIds: new Set(),
    stateIds: new Set(),
    projectIds: new Set(),
  };

  for (const issue of issues) {
    if (issue.assignee?.id) refs.userIds.add(issue.assignee.id);
    if (issue.creator?.id) refs.userIds.add(issue.creator.id);
    if (issue.state?.id) refs.stateIds.add(issue.state.id);
    if (issue.project?.id) refs.projectIds.add(issue.project.id);
  }

  // Comment authors MUST be included in _users lookup (per TOON spec)
  for (const comment of comments) {
    if (comment.user?.id) refs.userIds.add(comment.user.id);
  }

  return refs;
}

/**
 * Build a filtered user lookup section with only referenced users.
 * Uses registry metadata for user details, with issue/comment data as fallback.
 */
function buildUserLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
  comments: RawCommentData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  const items: ToonRow[] = [];
  const fallbackMap = new Map<string, string>();

  // Build name map from assignees, creators, and comment authors as fallback
  const userInfo = new Map<string, { name?: string }>();
  for (const issue of issues) {
    if (issue.assignee?.id) {
      userInfo.set(issue.assignee.id, { name: issue.assignee.name });
    }
    if (issue.creator?.id) {
      userInfo.set(issue.creator.id, { name: issue.creator.name });
    }
  }
  for (const comment of comments) {
    if (comment.user?.id) {
      userInfo.set(comment.user.id, { name: comment.user.name });
    }
  }

  let extCounter = 0;

  for (const uuid of referencedIds) {
    const shortKey = registry.usersByUuid.get(uuid);
    if (shortKey) {
      // Registered user — use registry metadata
      const metadata = getUserMetadata(registry, uuid);
      const fallbackInfo = userInfo.get(uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? fallbackInfo?.name ?? '',
        displayName: metadata?.displayName ?? '',
        email: metadata?.email ?? '',
        role: metadata?.role ?? '',
        teams: metadata?.teams?.join(',') || '',
      });
    } else {
      // Unregistered / external user — create ext entry
      const extKey = `ext${extCounter++}`;
      const info = userInfo.get(uuid);
      items.push({
        key: extKey,
        name: info?.name ?? 'Unknown User',
        displayName: '',
        email: '',
        role: '(external)',
        teams: '',
      });
      fallbackMap.set(uuid, extKey);
    }
  }

  // Sort: registry users (u*) first, then ext*, numeric within each group
  items.sort((a, b) => {
    const keyA = String(a.key);
    const keyB = String(b.key);
    const isExtA = keyA.startsWith('ext');
    const isExtB = keyB.startsWith('ext');
    if (isExtA !== isExtB) return isExtA ? 1 : -1;
    const numA = parseInt(keyA.replace(/^(u|ext)/, ''), 10);
    const numB = parseInt(keyB.replace(/^(u|ext)/, ''), 10);
    return numA - numB;
  });

  return { section: { schema: USER_LOOKUP_SCHEMA, items }, fallbackMap };
}

function buildStateLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
): ToonSection {
  const items: ToonRow[] = [];

  // Build state info from issues
  const stateInfo = new Map<string, { name: string; type: string }>();
  for (const issue of issues) {
    if (issue.state?.id) {
      stateInfo.set(issue.state.id, {
        name: issue.state.name,
        type: issue.state.type,
      });
    }
  }

  for (const [shortKey, uuid] of registry.states) {
    if (referencedIds.has(uuid)) {
      const info = stateInfo.get(uuid);
      items.push({
        key: shortKey,
        name: info?.name ?? '',
        type: info?.type ?? '',
      });
    }
  }

  // Sort by key number
  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('s', ''), 10);
    const numB = parseInt(String(b.key).replace('s', ''), 10);
    return numA - numB;
  });

  return { schema: STATE_LOOKUP_SCHEMA, items };
}

/**
 * Build a filtered project lookup section with only referenced projects.
 * Uses registry metadata for project details, with issue data as fallback.
 */
function buildProjectLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
): ToonSection {
  const items: ToonRow[] = [];

  // Build project info from issues as fallback
  const projectInfo = new Map<string, { name?: string }>();
  for (const issue of issues) {
    if (issue.project?.id) {
      projectInfo.set(issue.project.id, { name: issue.project.name });
    }
  }

  for (const [shortKey, uuid] of registry.projects) {
    if (referencedIds.has(uuid)) {
      const metadata = getProjectMetadata(registry, uuid);
      const issueInfo = projectInfo.get(uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? issueInfo?.name ?? '',
        state: metadata?.state ?? '',
        priority: metadata?.priority ?? null,
        progress:
          metadata?.progress !== undefined
            ? Math.round(metadata.progress * 100) / 100
            : null,
        lead: metadata?.leadId
          ? (tryGetShortKey(registry, 'user', metadata.leadId) ?? getUserStatusLabel(registry, metadata.leadId))
          : '',
        targetDate: metadata?.targetDate ?? '',
      });
    }
  }

  // Sort by key number
  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('pr', ''), 10);
    const numB = parseInt(String(b.key).replace('pr', ''), 10);
    return numA - numB;
  });

  return { schema: PROJECT_LOOKUP_SCHEMA, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOON Response Builder
// ─────────────────────────────────────────────────────────────────────────────

// Use a modified issue schema for sprint context (omit some fields)
const SPRINT_ISSUE_SCHEMA = {
  name: 'issues',
  fields: [
    'identifier',
    'title',
    'state',
    'assignee',
    'priority',
    'estimate',
    'project',
    'cycle',
    'labels',
    'parent',
    'desc',
    'createdAt',
    'creator',
  ],
};

function buildSprintContextResponse(
  cycle: RawCycleData,
  teamKey: string,
  issues: RawIssueData[],
  comments: RawCommentData[],
  relations: RawRelationData[],
  gaps: Gap[],
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Collect referenced entities for Tier 2
  const refs = collectReferencedEntities(issues, comments);

  // Build lookup sections
  const lookups: ToonSection[] = [];
  let fallbackMap: Map<string, string> = new Map();

  if (registry && refs.userIds.size > 0) {
    const { section: userLookup, fallbackMap: userFallbackMap } = buildUserLookup(
      registry,
      refs.userIds,
      issues,
      comments,
    );
    fallbackMap = userFallbackMap;
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  if (registry && refs.stateIds.size > 0) {
    const stateLookup = buildStateLookup(registry, refs.stateIds, issues);
    if (stateLookup.items.length > 0) {
      lookups.push(stateLookup);
    }
  }

  if (registry && refs.projectIds.size > 0) {
    const projectLookup = buildProjectLookup(registry, refs.projectIds, issues);
    if (projectLookup.items.length > 0) {
      lookups.push(projectLookup);
    }
  }

  // Build data sections
  const data: ToonSection[] = [];

  // Issues section
  const issueRows = issues.map((issue) => issueToToonRow(issue, registry, fallbackMap));
  if (issueRows.length > 0) {
    data.push({ schema: SPRINT_ISSUE_SCHEMA, items: issueRows });
  }

  // Comments section
  if (comments.length > 0) {
    const commentRows = comments.map((c) => commentToToonRow(c, registry, fallbackMap));
    data.push({ schema: COMMENT_SCHEMA, items: commentRows });
  }

  // Relations section
  if (relations.length > 0) {
    const relationRows = relations.map(relationToToonRow);
    data.push({ schema: RELATION_SCHEMA, items: relationRows });
  }

  // Gaps section
  if (gaps.length > 0) {
    const gapRows = gaps.map(gapToToonRow);
    data.push({ schema: GAP_SCHEMA, items: gapRows });
  }

  // Build meta section
  const startDate = new Date(cycle.startsAt).toISOString().split('T')[0];
  const endDate = new Date(cycle.endsAt).toISOString().split('T')[0];

  return {
    meta: {
      fields: ['version', 'team', 'cycle', 'start', 'end', 'generated'],
      values: {
        version: 1,
        team: teamKey,
        cycle: cycle.number,
        start: startDate,
        end: endDate,
        generated: new Date().toISOString(),
      },
    },
    lookups: lookups.length > 0 ? lookups : undefined,
    data: data.length > 0 ? data : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export const getSprintContextTool = defineTool({
  name: toolsMetadata.get_sprint_context.name,
  title: toolsMetadata.get_sprint_context.title,
  description: toolsMetadata.get_sprint_context.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);

    // Get team (default to first team if not specified)
    let teamsConn;
    try {
      teamsConn = await client.teams({ first: 100 });
    } catch (error) {
      const toolError = createErrorFromException(error as Error);
      return {
        isError: true,
        content: [{ type: 'text', text: formatErrorMessage(toolError) }],
        structuredContent: {
          error: toolError.code,
          message: toolError.message,
          hint: toolError.hint,
        },
      };
    }
    const teams = teamsConn.nodes ?? [];

    if (teams.length === 0) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'No teams found in workspace.' }],
        structuredContent: {
          error: 'NO_TEAMS',
          message: 'No teams found in workspace',
          hint: 'Ensure you have access to at least one team in Linear.',
        },
      };
    }

    // Use args.team, fall back to DEFAULT_TEAM, then first team
    const defaultTeamKey = args.team ?? config.DEFAULT_TEAM;
    const team = defaultTeamKey
      ? teams.find(
          (t) =>
            (t as unknown as { key?: string }).key?.toLowerCase() ===
              defaultTeamKey.toLowerCase() || t.id === defaultTeamKey,
        )
      : teams[0];

    if (!team && defaultTeamKey) {
      const availableKeys = teams
        .map((t) => (t as unknown as { key?: string }).key)
        .filter(Boolean);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Team '${defaultTeamKey}' not found. Available: ${availableKeys.join(', ')}`,
          },
        ],
        structuredContent: {
          error: 'TEAM_NOT_FOUND',
          message: `Team '${defaultTeamKey}' not found`,
          availableTeams: availableKeys,
          hint: 'Use one of the available team keys.',
        },
      };
    }

    if (!team) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'No teams found in workspace.' }],
        structuredContent: {
          error: 'NO_TEAMS',
          message: 'No teams found in workspace',
          hint: 'Ensure you have access to at least one team in Linear.',
        },
      };
    }

    const teamKey = (team as unknown as { key?: string }).key ?? team.id;

    // Check if team has cycles enabled
    const cyclesEnabled =
      ((team as unknown as { cyclesEnabled?: boolean })?.cyclesEnabled ?? false) ===
      true;

    if (!cyclesEnabled) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Cycles are disabled for team ${teamKey}. Use list_issues with filter for non-cycle work organization.`,
          },
        ],
        structuredContent: {
          error: 'CYCLES_DISABLED',
          team: teamKey,
          hint: 'Use list_issues with state/project filters for teams without cycles.',
        },
      };
    }

    // Determine target cycle number
    let targetCycleNumber: number;
    const cycleSelector = args.cycle ?? 'current';

    if (typeof cycleSelector === 'number') {
      // Direct cycle number
      targetCycleNumber = cycleSelector;
    } else {
      // Fetch cycles to find relative position
      let cyclesResp;
      try {
        cyclesResp = await client.client.rawRequest(CYCLES_QUERY, {
          teamId: team.id,
        });
      } catch (error) {
        const toolError = createErrorFromException(error as Error);
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(toolError) }],
          structuredContent: {
            error: toolError.code,
            message: toolError.message,
            hint: toolError.hint,
          },
        };
      }

      const cyclesData = (
        cyclesResp as unknown as {
          data?: {
            team?: {
              cycles?: { nodes?: Array<{ number: number; startsAt: string }> };
              activeCycle?: { number: number } | null;
            };
          };
        }
      ).data?.team;

      const cycles =
        cyclesData?.cycles?.nodes?.sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        ) ?? [];
      const activeCycleNumber = cyclesData?.activeCycle?.number;

      if (cycleSelector === 'current') {
        if (activeCycleNumber !== undefined) {
          targetCycleNumber = activeCycleNumber;
        } else {
          // No active cycle, find the most recent one
          const now = new Date();
          const recentCycle = [...cycles]
            .reverse()
            .find((c) => new Date(c.startsAt) <= now);
          if (recentCycle) {
            targetCycleNumber = recentCycle.number;
          } else if (cycles.length > 0) {
            targetCycleNumber = cycles[cycles.length - 1].number;
          } else {
            return {
              isError: true,
              content: [{ type: 'text', text: 'No cycles found for this team.' }],
              structuredContent: {
                error: 'NO_CYCLES',
                team: teamKey,
                hint: 'Create a cycle in Linear first.',
              },
            };
          }
        }
      } else if (cycleSelector === 'next' || cycleSelector === 'previous') {
        const currentNumber = activeCycleNumber ?? cycles[cycles.length - 1]?.number;
        if (currentNumber === undefined) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'No cycles found to navigate from.' }],
            structuredContent: {
              error: 'NO_CYCLES',
              team: teamKey,
            },
          };
        }

        const currentIndex = cycles.findIndex((c) => c.number === currentNumber);
        if (cycleSelector === 'next') {
          const nextCycle = cycles[currentIndex + 1];
          if (!nextCycle) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `No cycle after cycle ${currentNumber}. Current cycle is the latest.`,
                },
              ],
              structuredContent: {
                error: 'NO_NEXT_CYCLE',
                currentCycle: currentNumber,
                hint: 'Use "current" or create a new cycle in Linear.',
              },
            };
          }
          targetCycleNumber = nextCycle.number;
        } else {
          const prevCycle = cycles[currentIndex - 1];
          if (!prevCycle) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `No cycle before cycle ${currentNumber}. Current cycle is the earliest.`,
                },
              ],
              structuredContent: {
                error: 'NO_PREVIOUS_CYCLE',
                currentCycle: currentNumber,
                hint: 'Use "current" or specify a cycle number.',
              },
            };
          }
          targetCycleNumber = prevCycle.number;
        }
      } else {
        targetCycleNumber = 1; // Fallback, shouldn't reach here
      }
    }

    // Fetch sprint context data
    const includeComments = args.includeComments !== false;
    const includeRelations = args.includeRelations !== false;

    let resp;
    try {
      resp = await client.client.rawRequest(SPRINT_CONTEXT_QUERY, {
        teamId: team.id,
        cycleNumber: targetCycleNumber,
        includeComments,
        includeRelations,
      });
    } catch (error) {
      const toolError = createErrorFromException(error as Error);
      return {
        isError: true,
        content: [{ type: 'text', text: formatErrorMessage(toolError) }],
        structuredContent: {
          error: toolError.code,
          message: toolError.message,
          hint: toolError.hint,
        },
      };
    }

    const teamData = (
      resp as unknown as {
        data?: {
          team?: {
            id: string;
            key: string;
            name: string;
            cycles?: {
              nodes?: Array<{
                id: string;
                number: number;
                name?: string;
                startsAt: string;
                endsAt: string;
                progress?: number;
                issues?: {
                  nodes?: Array<{
                    id: string;
                    identifier: string;
                    title: string;
                    description?: string;
                    priority?: number;
                    estimate?: number;
                    createdAt?: string;
                    updatedAt: string;
                    state: { id: string; name: string; type: string };
                    project?: { id: string; name?: string } | null;
                    assignee?: { id: string; name?: string } | null;
                    creator?: { id: string; name?: string } | null;
                    parent?: { identifier: string } | null;
                    labels?: { nodes?: Array<{ id: string; name: string }> };
                    comments?: {
                      nodes?: Array<{
                        id: string;
                        body: string;
                        createdAt: string;
                        user?: { id: string; name?: string } | null;
                      }>;
                    };
                    relations?: {
                      nodes?: Array<{
                        id: string;
                        type: string;
                        relatedIssue: { identifier: string };
                      }>;
                    };
                  }>;
                };
              }>;
            };
          };
        };
      }
    ).data?.team;

    const cycleData = teamData?.cycles?.nodes?.[0];

    if (!cycleData) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Cycle ${targetCycleNumber} not found for team ${teamKey}.`,
          },
        ],
        structuredContent: {
          error: 'CYCLE_NOT_FOUND',
          team: teamKey,
          cycleNumber: targetCycleNumber,
          hint: 'Use list_cycles to see available cycles.',
        },
      };
    }

    // Parse cycle data
    const cycle: RawCycleData = {
      id: cycleData.id,
      number: cycleData.number,
      name: cycleData.name,
      startsAt: cycleData.startsAt,
      endsAt: cycleData.endsAt,
      progress: cycleData.progress,
    };

    // Parse issues
    const rawIssueNodes = cycleData.issues?.nodes ?? [];
    const issues: RawIssueData[] = rawIssueNodes.map((node) => ({
      id: node.id,
      identifier: node.identifier,
      title: node.title,
      description: node.description,
      priority: node.priority,
      estimate: node.estimate,
      state: node.state,
      project: node.project,
      assignee: node.assignee,
      creator: node.creator,
      cycle: { number: cycle.number },
      parent: node.parent,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      labels: node.labels?.nodes ?? [],
    }));

    // Parse comments
    const comments: RawCommentData[] = [];
    if (includeComments) {
      for (const node of rawIssueNodes) {
        const issueComments = node.comments?.nodes ?? [];
        for (const comment of issueComments) {
          comments.push({
            id: comment.id,
            issueIdentifier: node.identifier,
            body: comment.body,
            createdAt: comment.createdAt,
            user: comment.user,
          });
        }
      }
    }

    // Parse relations
    const relations: RawRelationData[] = [];
    if (includeRelations) {
      for (const node of rawIssueNodes) {
        const issueRelations = node.relations?.nodes ?? [];
        for (const relation of issueRelations) {
          relations.push({
            id: relation.id,
            type: relation.type,
            issue: { identifier: node.identifier },
            relatedIssue: relation.relatedIssue,
          });
        }
      }
    }

    // Calculate gaps
    const gaps = calculateGaps(issues, relations);

    // Initialize registry
    let registry: ShortKeyRegistry | null = null;
    try {
      registry = await getOrInitRegistry(
        {
          sessionId: context.sessionId,
          transport: 'stdio',
        },
        () => fetchWorkspaceDataForRegistry(client),
      );
    } catch (error) {
      console.error('Registry initialization failed:', error);
    }

    // Build TOON response
    const toonResponse = buildSprintContextResponse(
      cycle,
      teamKey,
      issues,
      comments,
      relations,
      gaps,
      registry,
    );

    // Encode TOON output
    const toonOutput = encodeResponse(issues, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
