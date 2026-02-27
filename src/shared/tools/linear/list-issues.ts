/**
 * List Issues tool - search and filter issues with powerful GraphQL filtering.
 * Uses raw GraphQL to avoid N+1 query problem with SDK lazy loading.
 *
 * Returns TOON format (Tier 2) with only REFERENCED entities.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import {
  createErrorFromException,
  createToolError,
  formatErrorMessage,
  validateFilter,
} from '../../../utils/errors.js';
import { normalizeIssueFilter } from '../../../utils/filters.js';
import { resolveCycleSelector, resolveTeamId } from '../../../utils/resolvers.js';
import {
  COMMENT_SCHEMA,
  encodeResponse,
  formatCycleToon,
  formatEstimateToon,
  formatPriorityToon,
  getOrInitRegistry,
  getProjectMetadata,
  getUserMetadata,
  getUserStatusLabel,
  ISSUE_SCHEMA,
  LABEL_LOOKUP_SCHEMA,
  PAGINATION_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  RELATION_SCHEMA,
  type ShortKeyRegistry,
  STATE_LOOKUP_SCHEMA,
  stripMarkdownImages,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  tryResolveShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { fetchWorkspaceDataForRegistry } from '../shared/registry-init.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 100.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
  filter: z
    .record(z.any())
    .optional()
    .describe(
      'GraphQL-style IssueFilter. Structure: { field: { comparator: value } }. ' +
        'Comparators: eq, neq, lt, lte, gt, gte, in, nin, containsIgnoreCase, startsWith, endsWith. ' +
        "Examples: { state: { type: { eq: 'started' } } } for in-progress, " +
        "{ state: { type: { neq: 'completed' } } } for open issues, " +
        "{ assignee: { email: { eqIgnoreCase: 'x@y.com' } } }, " +
        "{ labels: { name: { in: ['Bug', 'Urgent'] } } }, " +
        "{ title: { containsIgnoreCase: 'search' } }.",
    ),
  teamId: z.string().optional().describe('Filter by team UUID.'),
  project: z
    .string()
    .optional()
    .describe(
      'Project short key (pr0, pr1...) from workspace_metadata. Preferred over projectId.',
    ),
  projectId: z
    .string()
    .optional()
    .describe('Project UUID. Use project (short key) instead when possible.'),
  cycle: z
    .union([z.enum(['current', 'next', 'previous']), z.number().int().positive()])
    .optional()
    .describe(
      'Filter by cycle: "current" (active cycle), "next", "previous", or a specific cycle number. ' +
        'Requires teamId or team to be specified.',
    ),
  team: z
    .string()
    .optional()
    .describe(
      'Team key (e.g., "SQT") or UUID. Alternative to teamId. Required for cycle filtering.',
    ),
  includeComments: z
    .boolean()
    .optional()
    .describe(
      'Include comments on issues (last 20 per issue). Default: true when TOON enabled.',
    ),
  includeRelations: z
    .boolean()
    .optional()
    .describe(
      'Include issue relations (blocks, blocked-by). Default: true when TOON enabled.',
    ),
  includeArchived: z
    .boolean()
    .optional()
    .describe('Include archived issues. Default: false.'),
  orderBy: z
    .enum(['updatedAt', 'createdAt'])
    .optional()
    .describe(
      "Sort order. Default: 'updatedAt'. Note: To prioritize high-priority issues, use filter: { priority: { lte: 2 } } instead.",
    ),
  detail: z
    .enum(['minimal', 'standard', 'full'])
    .optional()
    .describe(
      "Detail level: 'minimal' (id, title, state), 'standard' (+ priority, assignee, project, due), 'full' (+ labels, description). Default: 'standard'.",
    ),
  q: z
    .string()
    .optional()
    .describe(
      'Free-text search query. Splits into tokens by whitespace, matches title case-insensitively. ' +
        'Use 2-4 significant keywords extracted from user intent. Avoid short/common words. ' +
        "Example: user says 'find my task about the cursor workshop' → q: 'cursor workshop'",
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe(
      'Explicit keywords for title search. Uses matchMode logic (default: all must match).',
    ),
  matchMode: z
    .enum(['all', 'any'])
    .optional()
    .describe(
      "How keyword tokens are matched: 'all' requires ALL tokens present in title (precise, default), " +
        "'any' requires at least ONE token (broad, use for exploratory searches).",
    ),
  assignedToMe: z
    .boolean()
    .optional()
    .describe(
      'If true, only show issues assigned to the current viewer. Shortcut for filter.assignee.id.eq with viewer ID.',
    ),
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extended raw issue data from GraphQL response for TOON processing.
 */
interface RawIssueData {
  id: string;
  identifier?: string;
  title: string;
  description?: string | null;
  priority?: number;
  estimate?: number | null;
  state?: { id: string; name: string; type?: string };
  project?: { id: string; name?: string } | null;
  assignee?: { id: string; name?: string } | null;
  team?: { id: string; key?: string };
  cycle?: { number?: number } | null;
  parent?: { identifier?: string } | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  archivedAt?: string | null;
  dueDate?: string | null;
  url?: string;
  labels?: { nodes?: Array<{ id: string; name: string }> };
  creator?: { id: string; name?: string } | null;
}

interface RawCommentData {
  id: string;
  body: string;
  createdAt: string;
  issueIdentifier: string;
  user?: { id: string; name?: string } | null;
}

interface RawRelationData {
  type: string;
  issueIdentifier: string;
  relatedIssueIdentifier: string;
}

/**
 * Collected referenced entity IDs from issues.
 * Used for Tier 2 filtering - only include entities actually referenced.
 */
interface ReferencedEntities {
  userIds: Set<string>;
  stateIds: Set<string>;
  projectIds: Set<string>;
  labelNames: Set<string>;
}

/**
 * Collect all entity IDs referenced by issues.
 * This is the core of Tier 2 strategy - we only include entities that are actually used.
 */
function collectReferencedEntities(
  issues: RawIssueData[],
  comments: RawCommentData[] = [],
): ReferencedEntities {
  const refs: ReferencedEntities = {
    userIds: new Set(),
    stateIds: new Set(),
    projectIds: new Set(),
    labelNames: new Set(),
  };

  for (const issue of issues) {
    // Collect assignee IDs
    if (issue.assignee?.id) {
      refs.userIds.add(issue.assignee.id);
    }

    // Collect creator IDs
    if (issue.creator?.id) {
      refs.userIds.add(issue.creator.id);
    }

    // Collect state IDs
    if (issue.state?.id) {
      refs.stateIds.add(issue.state.id);
    }

    // Collect project IDs
    if (issue.project?.id) {
      refs.projectIds.add(issue.project.id);
    }

    // Collect label names
    const labels = issue.labels?.nodes ?? [];
    for (const label of labels) {
      refs.labelNames.add(label.name);
    }
  }

  // Comment authors MUST be included in _users lookup (per TOON spec)
  for (const comment of comments) {
    if (comment.user?.id) {
      refs.userIds.add(comment.user.id);
    }
  }

  return refs;
}

/**
 * Convert an issue to TOON row format.
 * Uses short keys from registry for users, states, projects.
 * Falls back to fallbackUserMap for unregistered users (ext keys).
 */
function issueToToonRow(
  issue: RawIssueData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  // Get short keys from registry, fallback to undefined if not available
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

  // Fallback to ext keys for unregistered users
  if (!assigneeKey && issue.assignee?.id && fallbackUserMap) {
    assigneeKey = fallbackUserMap.get(issue.assignee.id);
  }
  if (!creatorKey && issue.creator?.id && fallbackUserMap) {
    creatorKey = fallbackUserMap.get(issue.creator.id);
  }

  // Collect label names as comma-separated string
  const labelNames = (issue.labels?.nodes ?? []).map((l) => l.name).join(',');

  return {
    identifier: issue.identifier ?? '',
    title: issue.title,
    state: stateKey ?? issue.state?.name ?? '',
    assignee: assigneeKey ?? '',
    priority: formatPriorityToon(issue.priority),
    estimate: formatEstimateToon(issue.estimate),
    project: projectKey ?? issue.project?.name ?? '',
    cycle: formatCycleToon(issue.cycle?.number),
    dueDate: issue.dueDate ?? null,
    labels: labelNames || null,
    parent: issue.parent?.identifier ?? null,
    team: issue.team?.key ?? '',
    url: issue.url ?? null,
    desc: issue.description ?? null,
    createdAt: issue.createdAt
      ? issue.createdAt instanceof Date
        ? issue.createdAt.toISOString()
        : issue.createdAt
      : null,
    creator: creatorKey ?? '',
  };
}

/**
 * Build a filtered user lookup section with only referenced users.
 * Uses single-pass over referencedIds, looking up via registry.usersByUuid.
 * Unregistered users (e.g., external collaborators, bots) get ext0, ext1... keys.
 *
 * @returns section for TOON output and fallbackMap for ext key resolution in rows.
 */
function buildUserLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
  comments: RawCommentData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  const items: ToonRow[] = [];
  const fallbackMap = new Map<string, string>();

  // Build userInfo map from issue assignees, creators, and comment authors for name resolution
  const userInfo = new Map<string, string>();
  for (const issue of issues) {
    if (issue.assignee?.id && issue.assignee.name) {
      userInfo.set(issue.assignee.id, issue.assignee.name);
    }
    if (issue.creator?.id && issue.creator.name) {
      userInfo.set(issue.creator.id, issue.creator.name);
    }
  }
  for (const comment of comments) {
    if (comment.user?.id && comment.user.name) {
      userInfo.set(comment.user.id, comment.user.name);
    }
  }

  let extCounter = 0;

  for (const uuid of referencedIds) {
    const shortKey = registry.usersByUuid.get(uuid);
    if (shortKey) {
      // Registered user: use registry metadata for all fields
      const metadata = getUserMetadata(registry, uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? '',
        displayName: metadata?.displayName ?? '',
        email: metadata?.email ?? '',
        role: metadata?.role ?? '',
        teams: metadata?.teams?.join(',') || '',
      });
    } else {
      // Unregistered user: create ext entry
      const extKey = `ext${extCounter++}`;
      const name = userInfo.get(uuid) ?? 'Unknown User';
      fallbackMap.set(uuid, extKey);
      items.push({
        key: extKey,
        name,
        displayName: '',
        email: '',
        role: '(external)',
        teams: '',
      });
    }
  }

  // Sort: registry users (u*) first, then ext*, numeric within each group
  items.sort((a, b) => {
    const keyA = String(a.key);
    const keyB = String(b.key);
    const isExtA = keyA.startsWith('ext');
    const isExtB = keyB.startsWith('ext');
    if (isExtA !== isExtB) return isExtA ? 1 : -1;
    const numA = parseInt(keyA.replace(/\D+/g, ''), 10);
    const numB = parseInt(keyB.replace(/\D+/g, ''), 10);
    return numA - numB;
  });

  return { section: { schema: USER_LOOKUP_SCHEMA, items }, fallbackMap };
}

/**
 * Build a filtered state lookup section with only referenced states.
 */
function buildStateLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
): ToonSection {
  const items: ToonRow[] = [];

  // Build a map of state info from issues (since registry doesn't have names)
  const stateInfo = new Map<string, { name: string; type: string }>();
  for (const issue of issues) {
    if (issue.state?.id) {
      stateInfo.set(issue.state.id, {
        name: issue.state.name,
        type: issue.state.type ?? '',
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

  // Sort by key number for consistent output
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

  // Build a map of project info from issues as fallback
  const projectInfo = new Map<string, { name: string }>();
  for (const issue of issues) {
    if (issue.project?.id) {
      projectInfo.set(issue.project.id, {
        name: issue.project.name ?? '',
      });
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
          ? (tryGetShortKey(registry, 'user', metadata.leadId) ??
            getUserStatusLabel(registry, metadata.leadId))
          : '',
        targetDate: metadata?.targetDate ?? '',
      });
    }
  }

  // Sort by key number for consistent output
  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('pr', ''), 10);
    const numB = parseInt(String(b.key).replace('pr', ''), 10);
    return numA - numB;
  });

  return { schema: PROJECT_LOOKUP_SCHEMA, items };
}

/**
 * Build label lookup (all labels - exception for Tier 2).
 * Labels are small and useful for suggestions, so we include all.
 */
function buildLabelLookup(issues: RawIssueData[]): ToonSection {
  // Collect unique labels from issues
  const labelMap = new Map<string, { name: string; color?: string }>();

  for (const issue of issues) {
    const labels = issue.labels?.nodes ?? [];
    for (const label of labels) {
      if (!labelMap.has(label.name)) {
        labelMap.set(label.name, { name: label.name });
      }
    }
  }

  const items: ToonRow[] = Array.from(labelMap.values()).map((l) => ({
    name: l.name,
    color: l.color ?? '',
  }));

  // Sort alphabetically
  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return { schema: LABEL_LOOKUP_SCHEMA, items };
}

/**
 * Build TOON response for list_issues.
 */
function buildToonResponse(
  rawIssues: RawIssueData[],
  registry: ShortKeyRegistry | null,
  pagination: { hasMore: boolean; cursor?: string; fetched: number; total?: number },
  _queryInfo: Record<string, unknown>,
  rawComments: RawCommentData[] = [],
  rawRelations: RawRelationData[] = [],
): ToonResponse {
  // Collect referenced entities for Tier 2 filtering
  const refs = collectReferencedEntities(rawIssues, rawComments);

  // Build lookup sections (only referenced entities)
  const lookups: ToonSection[] = [];

  // Add user lookup if we have a registry and referenced users
  let fallbackMap: Map<string, string> | undefined;
  if (registry && refs.userIds.size > 0) {
    const userResult = buildUserLookup(registry, refs.userIds, rawIssues, rawComments);
    fallbackMap = userResult.fallbackMap;
    if (userResult.section.items.length > 0) {
      lookups.push(userResult.section);
    }
  }

  // Add state lookup if we have a registry and referenced states
  if (registry && refs.stateIds.size > 0) {
    const stateLookup = buildStateLookup(registry, refs.stateIds, rawIssues);
    if (stateLookup.items.length > 0) {
      lookups.push(stateLookup);
    }
  }

  // Add project lookup if we have a registry and referenced projects
  if (registry && refs.projectIds.size > 0) {
    const projectLookup = buildProjectLookup(registry, refs.projectIds, rawIssues);
    if (projectLookup.items.length > 0) {
      lookups.push(projectLookup);
    }
  }

  // Add label lookup (all labels from issues - exception for Tier 2)
  if (refs.labelNames.size > 0) {
    const labelLookup = buildLabelLookup(rawIssues);
    if (labelLookup.items.length > 0) {
      lookups.push(labelLookup);
    }
  }

  // Convert issues to TOON rows
  const issueRows = rawIssues.map((issue) =>
    issueToToonRow(issue, registry, fallbackMap),
  );

  // Build data sections
  const data: ToonSection[] = [{ schema: ISSUE_SCHEMA, items: issueRows }];

  // Add pagination if needed
  if (pagination.hasMore || pagination.total !== undefined) {
    data.push({
      schema: PAGINATION_SCHEMA,
      items: [
        {
          hasMore: pagination.hasMore,
          cursor: pagination.cursor ?? '',
          fetched: pagination.fetched,
          total: pagination.total ?? null,
        },
      ],
    });
  }

  // Add comments section if present
  if (rawComments.length > 0) {
    const commentRows: ToonRow[] = rawComments.map((c) => {
      const body = stripMarkdownImages(c.body) ?? '';
      return {
        issue: c.issueIdentifier,
        user: c.user?.id
          ? registry
            ? (tryGetShortKey(registry, 'user', c.user.id) ??
              fallbackMap?.get(c.user.id) ??
              '')
            : ''
          : '',
        body: body.length > 500 ? `${body.slice(0, 497)}...` : body,
        createdAt: c.createdAt,
      };
    });
    data.push({ schema: COMMENT_SCHEMA, items: commentRows });
  }

  // Add relations section if present
  if (rawRelations.length > 0) {
    const relationRows: ToonRow[] = rawRelations.map((r) => ({
      from: r.issueIdentifier,
      type: r.type,
      to: r.relatedIssueIdentifier,
    }));
    data.push({ schema: RELATION_SCHEMA, items: relationRows });
  }

  // Build meta section
  const metaFields = ['tool', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_issues',
    count: rawIssues.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

export const listIssuesTool = defineTool({
  name: toolsMetadata.list_issues.name,
  title: toolsMetadata.list_issues.title,
  description: toolsMetadata.list_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const limit = args.limit ?? 100;

    // Build filter
    let filter = normalizeIssueFilter(args.filter) ?? {};

    // Validate team/teamId conflict
    if (args.team && args.teamId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Cannot specify both team and teamId. Use one or the other.',
          },
        ],
        structuredContent: { error: 'CONFLICTING_PARAMS' },
      };
    }

    let resolvedTeamId = args.teamId;

    if (args.team && !resolvedTeamId) {
      const teamResult = await resolveTeamId(client, args.team);
      if (!teamResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: teamResult.error }],
          structuredContent: {
            error: 'TEAM_RESOLUTION_FAILED',
            message: teamResult.error,
          },
        };
      }
      resolvedTeamId = teamResult.value;
    }

    // Apply DEFAULT_TEAM if no team specified
    if (!resolvedTeamId && config.DEFAULT_TEAM) {
      const teamResult = await resolveTeamId(client, config.DEFAULT_TEAM);
      if (teamResult.success) resolvedTeamId = teamResult.value;
    }

    // Validate cycle requires team
    if (args.cycle !== undefined && !resolvedTeamId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Cycle filtering requires teamId or team to be specified (cycle numbers are team-specific).',
          },
        ],
        structuredContent: { error: 'CYCLE_REQUIRES_TEAM' },
      };
    }

    // Apply teamId filter
    if (resolvedTeamId) {
      filter = { ...filter, team: { id: { eq: resolvedTeamId } } };
    }

    // Apply cycle filter
    if (args.cycle !== undefined && resolvedTeamId) {
      const cycleResult = await resolveCycleSelector(
        client,
        resolvedTeamId,
        args.cycle,
      );
      if (!cycleResult.success) {
        return {
          isError: true,
          content: [{ type: 'text', text: cycleResult.error }],
          structuredContent: {
            error: 'CYCLE_RESOLUTION_FAILED',
            message: cycleResult.error,
            ...(cycleResult.suggestions ? { hint: cycleResult.suggestions[0] } : {}),
          },
        };
      }
      filter = { ...filter, cycle: { number: { eq: cycleResult.value } } };
    }

    // Apply project filter (project > projectId priority chain)
    const projectInput = args.project ?? args.projectId;
    if (projectInput) {
      let resolvedProjectId = projectInput;
      if (/^pr\d+$/.test(projectInput)) {
        // Short key detected — resolve via registry
        let earlyRegistry: ShortKeyRegistry | null = null;
        try {
          earlyRegistry = await getOrInitRegistry(
            { sessionId: context.sessionId, transport: 'stdio' },
            () => fetchWorkspaceDataForRegistry(client),
          );
        } catch (error) {
          console.error('Registry initialization failed:', error);
        }

        if (!earlyRegistry) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Cannot resolve project key '${projectInput}' — registry not available. Call workspace_metadata first, or use projectId with a UUID.`,
              },
            ],
          };
        }

        const uuid = tryResolveShortKey(earlyRegistry, 'project', projectInput);
        if (!uuid) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unknown project key '${projectInput}'. Call workspace_metadata to see available project keys.`,
              },
            ],
          };
        }
        resolvedProjectId = uuid;
      }
      filter = { ...filter, project: { id: { eq: resolvedProjectId } } };
    }

    // Apply assignedToMe filter
    if (args.assignedToMe) {
      try {
        const viewer = await client.viewer;
        const viewerId = (viewer as unknown as { id?: string })?.id;
        if (viewerId) {
          filter = { ...filter, assignee: { id: { eq: viewerId } } };
        }
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
    }

    // Handle keyword search
    const keywords =
      args.keywords ?? (args.q ? args.q.split(/\s+/).filter(Boolean) : []);
    if (keywords.length > 0) {
      const titleFilters = keywords.map((k) => ({
        title: { containsIgnoreCase: k },
      }));
      const mode = args.matchMode ?? 'all';
      filter = { ...filter, [mode === 'all' ? 'and' : 'or']: titleFilters };
    }

    // Validate filter structure before sending to API
    if (args.filter && Object.keys(args.filter).length > 0) {
      const validation = validateFilter(args.filter as Record<string, unknown>);
      if (!validation.valid) {
        const error = createToolError(
          'FILTER_INVALID',
          `Filter validation failed:\n${validation.errors.join('\n')}`,
        );
        return {
          isError: true,
          content: [{ type: 'text', text: formatErrorMessage(error) }],
          structuredContent: {
            error: error.code,
            message: error.message,
            hint: error.hint,
          },
        };
      }
    }

    // Use raw GraphQL to avoid N+1 query problem with SDK lazy loading
    // TOON output defaults to including comments and relations
    const includeComments = args.includeComments !== false;
    const includeRelations = args.includeRelations !== false;

    const QUERY = `
      query ListIssues(
        $first: Int!,
        $after: String,
        $filter: IssueFilter,
        $includeArchived: Boolean,
        $orderBy: PaginationOrderBy,
        $includeComments: Boolean!,
        $includeRelations: Boolean!
      ) {
        issues(
          first: $first,
          after: $after,
          filter: $filter,
          includeArchived: $includeArchived,
          orderBy: $orderBy
        ) {
          nodes {
            id
            identifier
            title
            description
            priority
            estimate
            state { id name type }
            project { id name }
            assignee { id name }
            creator { id name }
            team { id key }
            cycle { number }
            parent { identifier }
            createdAt
            updatedAt
            archivedAt
            dueDate
            url
            labels { nodes { id name } }
            comments(first: 20) @include(if: $includeComments) {
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
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const variables = {
      first: limit,
      after: args.cursor,
      filter: filter as Record<string, unknown>,
      includeArchived: args.includeArchived ?? false,
      orderBy: args.orderBy,
      includeComments,
      includeRelations,
    } as Record<string, unknown>;

    let conn: {
      nodes?: Array<Record<string, unknown>>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string };
    };
    let rawIssues: RawIssueData[];
    const rawComments: RawCommentData[] = [];
    const rawRelations: RawRelationData[] = [];

    try {
      const resp = await client.client.rawRequest(QUERY, variables);
      conn = (
        resp as unknown as {
          data?: {
            issues?: {
              nodes?: Array<Record<string, unknown>>;
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        }
      ).data?.issues ?? { nodes: [], pageInfo: {} };

      // ─────────────────────────────────────────────────────────────────────────
      // TOON Output Format
      // ─────────────────────────────────────────────────────────────────────────

      // Convert raw GraphQL response to RawIssueData for TOON processing
      rawIssues = (conn.nodes ?? []).map((i) => ({
        id: String(i.id ?? ''),
        identifier: (i.identifier as string) ?? undefined,
        title: String(i.title ?? ''),
        description: (i.description as string | null) ?? undefined,
        priority: (i.priority as number) ?? undefined,
        estimate: (i.estimate as number | null) ?? undefined,
        state: i.state as { id: string; name: string; type?: string } | undefined,
        project: i.project as { id: string; name?: string } | null | undefined,
        assignee: i.assignee as { id: string; name?: string } | null | undefined,
        creator: i.creator as { id: string; name?: string } | null | undefined,
        team: i.team as { id: string; key?: string } | undefined,
        cycle: i.cycle as { number?: number } | null | undefined,
        parent: i.parent as { identifier?: string } | null | undefined,
        createdAt: (i.createdAt as string | Date) ?? '',
        updatedAt: (i.updatedAt as string | Date) ?? '',
        archivedAt: (i.archivedAt as string | null) ?? undefined,
        dueDate: (i.dueDate as string | null) ?? undefined,
        url: (i.url as string) ?? undefined,
        labels: i.labels as { nodes?: Array<{ id: string; name: string }> } | undefined,
      }));

      // Parse comments from raw response
      if (includeComments) {
        for (const node of conn.nodes ?? []) {
          const issueIdentifier = (node.identifier as string) ?? '';
          const commentNodes =
            (node.comments as { nodes?: Array<Record<string, unknown>> })?.nodes ?? [];
          for (const c of commentNodes) {
            rawComments.push({
              id: String(c.id ?? ''),
              body: String(c.body ?? ''),
              createdAt: String(c.createdAt ?? ''),
              issueIdentifier,
              user: c.user as { id: string; name?: string } | null | undefined,
            });
          }
        }
      }

      // Parse relations from raw response
      if (includeRelations) {
        for (const node of conn.nodes ?? []) {
          const issueIdentifier = (node.identifier as string) ?? '';
          const relationNodes =
            (node.relations as { nodes?: Array<Record<string, unknown>> })?.nodes ?? [];
          for (const r of relationNodes) {
            const relatedIssue = r.relatedIssue as { identifier?: string } | undefined;
            rawRelations.push({
              type: String(r.type ?? ''),
              issueIdentifier,
              relatedIssueIdentifier: relatedIssue?.identifier ?? '',
            });
          }
        }
      }
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

    const pageInfo = conn.pageInfo ?? {};
    const hasMore = pageInfo.hasNextPage ?? false;
    const nextCursor = hasMore ? (pageInfo.endCursor ?? undefined) : undefined;

    // Initialize registry if needed (lazy init)
    // When registry is unavailable, TOON output will use names/UUIDs instead of short keys
    let registry: ShortKeyRegistry | null = null;
    try {
      registry = await getOrInitRegistry(
        {
          sessionId: context.sessionId,
          transport: 'stdio', // Default to stdio for now
        },
        () => fetchWorkspaceDataForRegistry(client),
      );
    } catch (error) {
      // Registry init failed, continue without it (will use names instead of short keys)
      console.error('Registry initialization failed:', error);
    }

    // Build TOON response
    const toonResponse = buildToonResponse(
      rawIssues,
      registry,
      {
        hasMore,
        cursor: nextCursor,
        fetched: rawIssues.length,
      },
      { filter, teamId: resolvedTeamId, projectId: args.project ?? args.projectId },
      rawComments,
      rawRelations,
    );

    // Encode TOON output
    const toonOutput = encodeResponse(rawIssues, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
