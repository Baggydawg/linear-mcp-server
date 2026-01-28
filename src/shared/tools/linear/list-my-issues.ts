/**
 * List My Issues tool - fetch issues assigned to the current user.
 *
 * Supports TOON output format (Tier 2):
 * - When TOON_OUTPUT_ENABLED=true, returns TOON format with only REFERENCED entities
 * - When TOON_OUTPUT_ENABLED=false (default), returns legacy human-readable format
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListIssuesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { normalizeIssueFilter } from '../../../utils/filters.js';
import { summarizeList } from '../../../utils/messages.js';
import {
  encodeResponse,
  getOrInitRegistry,
  getProjectMetadata,
  getUserMetadata,
  ISSUE_SCHEMA,
  LABEL_LOOKUP_SCHEMA,
  PAGINATION_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  type RegistryBuildData,
  type ShortKeyRegistry,
  STATE_LOOKUP_SCHEMA,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import {
  type DetailLevel,
  formatIssueDetails,
  formatIssuePreviewLine,
  type IssueListItem,
  previewLinesFromItems,
} from './shared/index.js';

const InputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 20.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
  filter: z
    .record(z.any())
    .optional()
    .describe(
      'GraphQL-style IssueFilter. Structure: { field: { comparator: value } }. ' +
        'Comparators: eq, neq, lt, lte, gt, gte, in, nin, containsIgnoreCase. ' +
        "Examples: { state: { type: { eq: 'started' } } } for in-progress, " +
        "{ state: { type: { neq: 'completed' } } } for open issues, " +
        "{ project: { id: { eq: 'PROJECT_UUID' } } }.",
    ),
  includeArchived: z
    .boolean()
    .optional()
    .describe('Include archived issues. Default: false.'),
  orderBy: z
    .enum(['updatedAt', 'createdAt'])
    .optional()
    .describe(
      "Sort order. Default: 'updatedAt'. Use filter.priority for priority-based filtering.",
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
}

/**
 * Collected referenced entity IDs from issues.
 */
interface ReferencedEntities {
  userIds: Set<string>;
  stateIds: Set<string>;
  projectIds: Set<string>;
  labelNames: Set<string>;
}

/**
 * Collect all entity IDs referenced by issues.
 */
function collectReferencedEntities(issues: RawIssueData[]): ReferencedEntities {
  const refs: ReferencedEntities = {
    userIds: new Set(),
    stateIds: new Set(),
    projectIds: new Set(),
    labelNames: new Set(),
  };

  for (const issue of issues) {
    if (issue.assignee?.id) {
      refs.userIds.add(issue.assignee.id);
    }
    if (issue.state?.id) {
      refs.stateIds.add(issue.state.id);
    }
    if (issue.project?.id) {
      refs.projectIds.add(issue.project.id);
    }
    const labels = issue.labels?.nodes ?? [];
    for (const label of labels) {
      refs.labelNames.add(label.name);
    }
  }

  return refs;
}

/**
 * Convert an issue to TOON row format.
 */
function issueToToonRow(
  issue: RawIssueData,
  registry: ShortKeyRegistry | null,
): ToonRow {
  const assigneeKey =
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

  const labelNames = (issue.labels?.nodes ?? []).map((l) => l.name).join(',');

  return {
    identifier: issue.identifier ?? '',
    title: issue.title,
    state: stateKey ?? issue.state?.name ?? '',
    assignee: assigneeKey ?? '',
    priority: issue.priority ?? null,
    estimate: issue.estimate ?? null,
    project: projectKey ?? '',
    cycle: issue.cycle?.number ?? null,
    dueDate: issue.dueDate ?? null,
    labels: labelNames || null,
    parent: issue.parent?.identifier ?? null,
    team: issue.team?.key ?? '',
    url: issue.url ?? null,
    desc: issue.description ?? null,
  };
}

/**
 * Build a filtered user lookup section with only referenced users.
 * Uses registry metadata for user details.
 */
function buildUserLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
): ToonSection {
  const items: ToonRow[] = [];

  for (const [shortKey, uuid] of registry.users) {
    if (referencedIds.has(uuid)) {
      const metadata = getUserMetadata(registry, uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? '',
        displayName: metadata?.displayName ?? '',
        email: metadata?.email ?? '',
        role: '', // Keep empty, not stored in registry
      });
    }
  }

  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('u', ''), 10);
    const numB = parseInt(String(b.key).replace('u', ''), 10);
    return numA - numB;
  });

  return { schema: USER_LOOKUP_SCHEMA, items };
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
        state: metadata?.state ?? '', // Now from registry!
      });
    }
  }

  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('pr', ''), 10);
    const numB = parseInt(String(b.key).replace('pr', ''), 10);
    return numA - numB;
  });

  return { schema: PROJECT_LOOKUP_SCHEMA, items };
}

/**
 * Build label lookup (all labels from issues).
 */
function buildLabelLookup(issues: RawIssueData[]): ToonSection {
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

  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return { schema: LABEL_LOOKUP_SCHEMA, items };
}

/**
 * Fetch workspace data for registry initialization with full metadata.
 */
async function fetchWorkspaceDataForRegistry(
  client: ReturnType<typeof getLinearClient> extends Promise<infer T> ? T : never,
): Promise<RegistryBuildData> {
  // Fetch users with full metadata
  const usersConn = await client.users({ first: 100 });
  const users = (usersConn.nodes ?? []).map((u) => ({
    id: u.id,
    createdAt: (u as unknown as { createdAt?: Date | string }).createdAt ?? new Date(),
    name: u.name ?? '',
    displayName: (u as unknown as { displayName?: string }).displayName ?? '',
    email: (u as unknown as { email?: string }).email ?? '',
    active: (u as unknown as { active?: boolean }).active ?? true,
  }));

  // Fetch workflow states via teams with full metadata
  const teamsConn = await client.teams({ first: 100 });
  const teams = teamsConn.nodes ?? [];
  const states: RegistryBuildData['states'] = [];

  for (const team of teams) {
    const statesConn = await (
      team as unknown as {
        states: () => Promise<{
          nodes: Array<{
            id: string;
            createdAt?: Date | string;
            name: string;
            type?: string;
          }>;
        }>;
      }
    ).states();
    for (const state of statesConn.nodes ?? []) {
      states.push({
        id: state.id,
        createdAt: state.createdAt ?? new Date(),
        name: state.name,
        type: state.type ?? '',
      });
    }
  }

  // Fetch projects with full metadata
  const projectsConn = await client.projects({ first: 100 });
  const projects = (projectsConn.nodes ?? []).map((p) => ({
    id: p.id,
    createdAt: (p as unknown as { createdAt?: Date | string }).createdAt ?? new Date(),
    name: p.name,
    state: (p as unknown as { state?: string }).state ?? '',
  }));

  const viewer = await client.viewer;
  const viewerOrg = viewer as unknown as { organization?: { id?: string } };
  const workspaceId = viewerOrg?.organization?.id ?? 'unknown';

  return { users, states, projects, workspaceId };
}

/**
 * Build TOON response for list_my_issues.
 */
function buildToonResponse(
  rawIssues: RawIssueData[],
  registry: ShortKeyRegistry | null,
  pagination: { hasMore: boolean; cursor?: string; fetched: number; total?: number },
): ToonResponse {
  const refs = collectReferencedEntities(rawIssues);
  const lookups: ToonSection[] = [];

  if (registry && refs.userIds.size > 0) {
    const userLookup = buildUserLookup(registry, refs.userIds);
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  if (registry && refs.stateIds.size > 0) {
    const stateLookup = buildStateLookup(registry, refs.stateIds, rawIssues);
    if (stateLookup.items.length > 0) {
      lookups.push(stateLookup);
    }
  }

  if (registry && refs.projectIds.size > 0) {
    const projectLookup = buildProjectLookup(registry, refs.projectIds, rawIssues);
    if (projectLookup.items.length > 0) {
      lookups.push(projectLookup);
    }
  }

  if (refs.labelNames.size > 0) {
    const labelLookup = buildLabelLookup(rawIssues);
    if (labelLookup.items.length > 0) {
      lookups.push(labelLookup);
    }
  }

  const issueRows = rawIssues.map((issue) => issueToToonRow(issue, registry));
  const data: ToonSection[] = [{ schema: ISSUE_SCHEMA, items: issueRows }];

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

  const metaFields = ['tool', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_my_issues',
    count: rawIssues.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

export const listMyIssuesTool = defineTool({
  name: toolsMetadata.list_my_issues.name,
  title: toolsMetadata.list_my_issues.title,
  description: toolsMetadata.list_my_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const first = args.limit ?? 20;
    const after = args.cursor && args.cursor.trim() !== '' ? args.cursor : undefined;

    // Build keyword-aware filter for assigned issues
    const keywordTokens = [
      ...(args.keywords ?? []),
      ...(args.q ?? '')
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ];
    const mode = args.matchMode ?? 'all';
    const keywordFilter = keywordTokens.length
      ? {
          [mode === 'all' ? 'and' : 'or']: keywordTokens.map((t) => ({
            title: { containsIgnoreCase: t },
          })),
        }
      : undefined;
    const baseFilter =
      normalizeIssueFilter(args.filter as Record<string, unknown> | undefined) ?? {};
    const mergedFilter = keywordFilter
      ? { ...(baseFilter as object), ...(keywordFilter as object) }
      : baseFilter;

    // Single GraphQL query to avoid N+1 requests
    const QUERY = `
      query ListMyIssues(
        $first: Int!,
        $after: String,
        $filter: IssueFilter,
        $includeArchived: Boolean,
        $orderBy: PaginationOrderBy
      ) {
        viewer {
          assignedIssues(
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
              createdAt
              updatedAt
              archivedAt
              dueDate
              url
              labels { nodes { id name } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;

    const variables = {
      first,
      after,
      filter: mergedFilter as Record<string, unknown>,
      includeArchived: args.includeArchived,
      orderBy: args.orderBy,
    } as Record<string, unknown>;

    const resp = await client.client.rawRequest(QUERY, variables);
    const conn = (
      resp as unknown as {
        data?: {
          viewer?: {
            assignedIssues?: {
              nodes?: Array<Record<string, unknown>>;
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        };
      }
    ).data?.viewer?.assignedIssues ?? { nodes: [], pageInfo: {} };

    const items: IssueListItem[] = (conn.nodes ?? []).map((i) => {
      const state =
        (i.state as { id?: string; name?: string } | undefined) ?? undefined;
      const project =
        (i.project as { id?: string; name?: string } | undefined) ?? undefined;
      const assignee =
        (i.assignee as { id?: string; name?: string } | undefined) ?? undefined;
      const labelsConn = i.labels as
        | { nodes?: Array<{ id: string; name: string }> }
        | undefined;
      const labels = (labelsConn?.nodes ?? []).map((l) => ({
        id: l.id,
        name: l.name,
      }));
      const archivedAtRaw = (i.archivedAt as string | null | undefined) ?? undefined;
      return {
        id: String(i.id ?? ''),
        identifier: (i as { identifier?: string }).identifier ?? undefined,
        title: String(i.title ?? ''),
        description: (i as { description?: string | null }).description ?? undefined,
        priority: (i as { priority?: number | null }).priority ?? undefined,
        estimate: (i as { estimate?: number | null }).estimate ?? undefined,
        stateId: state?.id ?? '',
        stateName: state?.name ?? undefined,
        projectId: project?.id ?? undefined,
        projectName: project?.name ?? undefined,
        assigneeId: assignee?.id ?? undefined,
        assigneeName: assignee?.name ?? undefined,
        createdAt: String((i as { createdAt?: string | Date | null }).createdAt ?? ''),
        updatedAt: String((i as { updatedAt?: string | Date | null }).updatedAt ?? ''),
        archivedAt: archivedAtRaw ? String(archivedAtRaw) : undefined,
        dueDate: (i as { dueDate?: string }).dueDate ?? undefined,
        url: (i as { url?: string }).url ?? undefined,
        labels,
      };
    });

    const pageInfo = conn.pageInfo ?? {};
    const hasMore = pageInfo.hasNextPage ?? false;
    const nextCursor = hasMore ? (pageInfo.endCursor ?? undefined) : undefined;

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Convert raw GraphQL response to RawIssueData for TOON processing
      const rawIssues: RawIssueData[] = (conn.nodes ?? []).map((i) => ({
        id: String(i.id ?? ''),
        identifier: (i.identifier as string) ?? undefined,
        title: String(i.title ?? ''),
        description: (i.description as string | null) ?? undefined,
        priority: (i.priority as number) ?? undefined,
        estimate: (i.estimate as number | null) ?? undefined,
        state: i.state as { id: string; name: string; type?: string } | undefined,
        project: i.project as { id: string; name?: string } | null | undefined,
        assignee: i.assignee as { id: string; name?: string } | null | undefined,
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

      // Initialize registry if needed (lazy init)
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
      const toonResponse = buildToonResponse(rawIssues, registry, {
        hasMore,
        cursor: nextCursor,
        fetched: rawIssues.length,
      });

      // Encode TOON output
      const toonOutput = encodeResponse(rawIssues, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          count: rawIssues.length,
          hasMore,
          nextCursor,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format (when TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────

    // Build query echo for LLM context
    const query = {
      filter: Object.keys(mergedFilter).length > 0 ? mergedFilter : undefined,
      assignedToMe: true,
      keywords: keywordTokens.length > 0 ? keywordTokens : undefined,
      matchMode: args.matchMode ?? 'all',
      includeArchived: args.includeArchived,
      orderBy: args.orderBy,
      limit: first,
    };

    // Build pagination info
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit: first,
    };

    // Build meta with next steps
    const metaNextSteps: string[] = [];
    if (items.length > 0) {
      metaNextSteps.push('Use get_issues with specific IDs for detailed info.');
      metaNextSteps.push('Use update_issues to change state, assignee, or labels.');
    } else {
      metaNextSteps.push(
        "Refine filters: try state.type 'started' or remove keyword filter.",
      );
      metaNextSteps.push('Use list_issues without assignedToMe to see all issues.');
    }
    if (hasMore) {
      metaNextSteps.unshift(`Call again with cursor="${nextCursor}" to fetch more.`);
    }

    const meta = {
      nextSteps: metaNextSteps,
      hints:
        items.length === 0
          ? ['No issues assigned to you match the current filters.']
          : undefined,
      relatedTools: ['get_issues', 'update_issues', 'add_comments', 'list_issues'],
    };

    const structured = ListIssuesOutputSchema.parse({
      query,
      items,
      pagination,
      meta,
      // Legacy fields
      cursor: args.cursor,
      nextCursor,
      limit: first,
    });

    // Use shared formatting utilities with detail level
    const detail: DetailLevel = args.detail ?? 'standard';
    const preview = previewLinesFromItems(items, (i) =>
      formatIssuePreviewLine(i, detail),
    );

    const message = summarizeList({
      subject: 'My issues',
      count: items.length,
      limit: first,
      nextCursor,
      previewLines: preview,
      nextSteps: metaNextSteps,
    });

    // Use shared details formatting with detail level
    const details = items.map((i) => formatIssueDetails(i, { detail })).join('\n');

    const full = details ? `${message}\n\n${details}` : message;
    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: full }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});
