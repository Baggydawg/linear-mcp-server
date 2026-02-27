/**
 * Get Issue History tool - fetch the activity/audit log for issues.
 *
 * Shows who changed what and when on an issue: state transitions,
 * assignee changes, estimate updates, label modifications, etc.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with referenced _users and _states lookups
 * - Expands multi-field API entries into separate rows for clarity
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { makeConcurrencyGate } from '../../../utils/limits.js';
import {
  encodeResponse,
  formatCycleToon,
  formatEstimateToon,
  formatPriorityToon,
  getOrInitRegistry,
  getProjectSlugMap,
  getStateMetadata,
  getUserMetadata,
  HISTORY_ENTRY_SCHEMA,
  PAGINATION_SCHEMA,
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
// GraphQL Query
// ─────────────────────────────────────────────────────────────────────────────

const ISSUE_HISTORY_QUERY = `
  query IssueHistory($id: String!, $first: Int!, $after: String) {
    issue(id: $id) {
      identifier
      history(first: $first, after: $after) {
        nodes {
          id
          createdAt
          actorId
          actor { id name }
          fromState { id name type }
          toState { id name type }
          fromAssignee { id name }
          toAssignee { id name }
          fromEstimate
          toEstimate
          fromPriority
          toPriority
          fromDueDate
          toDueDate
          fromTitle
          toTitle
          fromProject { id name }
          toProject { id name }
          fromCycle { id number }
          toCycle { id number }
          fromParent { id identifier }
          toParent { id identifier }
          fromTeam { id key }
          toTeam { id key }
          addedLabels { id name }
          removedLabels { id name }
          archived
          trashed
          updatedDescription
          autoArchived
          autoClosed
          relationChanges { identifier type }
          botActor { name type }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Raw Response Types
// ─────────────────────────────────────────────────────────────────────────────

interface RawHistoryEntry {
  id: string;
  createdAt: string;
  actorId?: string | null;
  actor?: { id: string; name: string } | null;
  fromState?: { id: string; name: string; type: string } | null;
  toState?: { id: string; name: string; type: string } | null;
  fromAssignee?: { id: string; name: string } | null;
  toAssignee?: { id: string; name: string } | null;
  fromEstimate?: number | null;
  toEstimate?: number | null;
  fromPriority?: number | null;
  toPriority?: number | null;
  fromDueDate?: string | null;
  toDueDate?: string | null;
  fromTitle?: string | null;
  toTitle?: string | null;
  fromProject?: { id: string; name: string } | null;
  toProject?: { id: string; name: string } | null;
  fromCycle?: { id: string; number: number } | null;
  toCycle?: { id: string; number: number } | null;
  fromParent?: { id: string; identifier: string } | null;
  toParent?: { id: string; identifier: string } | null;
  fromTeam?: { id: string; key: string } | null;
  toTeam?: { id: string; key: string } | null;
  addedLabels?: { id: string; name: string }[] | null;
  removedLabels?: { id: string; name: string }[] | null;
  archived?: boolean | null;
  trashed?: boolean | null;
  updatedDescription?: boolean | null;
  autoArchived?: boolean | null;
  autoClosed?: boolean | null;
  relationChanges?: { identifier: string; type: string }[] | null;
  botActor?: { name: string; type: string } | null;
}

interface RawIssueHistoryResponse {
  data?: {
    issue?: {
      identifier: string;
      history?: {
        nodes?: RawHistoryEntry[];
        pageInfo?: { hasNextPage?: boolean; endCursor?: string };
      };
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry Expansion (one API entry -> multiple TOON rows)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the actor display key from a history entry.
 * Prefers short key from registry, falls back to inline name.
 */
function resolveActor(
  entry: RawHistoryEntry,
  registry: ShortKeyRegistry | null,
  fallbackUserMap: Map<string, string>,
): string {
  // Bot actor without human actorId
  if (entry.botActor?.name && !entry.actorId) {
    return entry.botActor.name;
  }

  const actorId = entry.actorId ?? entry.actor?.id;
  if (!actorId) return '';

  // Try registry short key
  if (registry) {
    const shortKey = tryGetShortKey(registry, 'user', actorId);
    if (shortKey) return shortKey;
  }

  // Try fallback map
  const existing = fallbackUserMap.get(actorId);
  if (existing) {
    return existing;
  }

  // Create fallback entry
  const adHocKey = `ext${fallbackUserMap.size}`;
  fallbackUserMap.set(actorId, adHocKey);

  return adHocKey;
}

/**
 * Resolve a state to its short key or inline name.
 */
function resolveState(
  state: { id: string; name: string; type?: string } | null | undefined,
  registry: ShortKeyRegistry | null,
): string {
  if (!state) return '';
  if (registry) {
    const shortKey = tryGetShortKey(registry, 'state', state.id);
    if (shortKey) return shortKey;
  }
  return state.name;
}

/**
 * Resolve a user to short key or inline name.
 */
function resolveUser(
  user: { id: string; name: string } | null | undefined,
  registry: ShortKeyRegistry | null,
  fallbackUserMap: Map<string, string>,
): string {
  if (!user) return '';
  if (registry) {
    const shortKey = tryGetShortKey(registry, 'user', user.id);
    if (shortKey) return shortKey;
  }
  const existingKey = fallbackUserMap.get(user.id);
  if (existingKey) {
    return existingKey;
  }
  const adHocKey = `ext${fallbackUserMap.size}`;
  fallbackUserMap.set(user.id, adHocKey);
  return adHocKey;
}

/**
 * Resolve a project to short key or inline name.
 */
function resolveProject(
  project: { id: string; name: string } | null | undefined,
  registry: ShortKeyRegistry | null,
): string {
  if (!project) return '';
  if (registry) {
    const shortKey = tryGetShortKey(registry, 'project', project.id);
    if (shortKey) return shortKey;
  }
  return project.name;
}

/**
 * Map Linear's internal relation history type codes to human-readable names.
 *
 * Linear uses 2-char codes in IssueRelationHistoryPayload.type:
 * - First char: a=added, r=removed
 * - Second char: b=blocked_by, x=blocks, r=related, d=duplicate, s=similar
 * These match Linear's keyboard shortcuts (M+B, M+X, M+R).
 */
const RELATION_TYPE_MAP: Record<string, string> = {
  ab: 'added blocked_by',
  ax: 'added blocks',
  ar: 'added related',
  ad: 'added duplicate',
  as: 'added similar',
  rb: 'removed blocked_by',
  rx: 'removed blocks',
  rr: 'removed related',
  rd: 'removed duplicate',
  rs: 'removed similar',
};

function formatRelationType(rawType: string): string {
  return RELATION_TYPE_MAP[rawType] ?? rawType;
}

/**
 * Expand a single history entry into TOON rows (one per field change).
 */
function expandHistoryEntry(
  entry: RawHistoryEntry,
  issueIdentifier: string,
  registry: ShortKeyRegistry | null,
  fallbackUserMap: Map<string, string>,
  isFirstEntry: boolean,
): ToonRow[] {
  const rows: ToonRow[] = [];
  const actor = resolveActor(entry, registry, fallbackUserMap);
  const time = entry.createdAt;

  const makeRow = (field: string, from: string, to: string): ToonRow => ({
    issue: issueIdentifier,
    time,
    actor,
    field,
    from,
    to,
  });

  // State transition
  if (entry.fromState || entry.toState) {
    rows.push(
      makeRow(
        'state',
        resolveState(entry.fromState, registry),
        resolveState(entry.toState, registry),
      ),
    );
  }

  // Assignee change
  if (entry.fromAssignee || entry.toAssignee) {
    rows.push(
      makeRow(
        'assignee',
        resolveUser(entry.fromAssignee, registry, fallbackUserMap),
        resolveUser(entry.toAssignee, registry, fallbackUserMap),
      ),
    );
  }

  // Estimate change
  if (entry.fromEstimate != null || entry.toEstimate != null) {
    rows.push(
      makeRow(
        'estimate',
        formatEstimateToon(entry.fromEstimate) ?? '',
        formatEstimateToon(entry.toEstimate) ?? '',
      ),
    );
  }

  // Priority change
  if (entry.fromPriority != null || entry.toPriority != null) {
    rows.push(
      makeRow(
        'priority',
        formatPriorityToon(entry.fromPriority) ?? '',
        formatPriorityToon(entry.toPriority) ?? '',
      ),
    );
  }

  // Due date change
  if (entry.fromDueDate != null || entry.toDueDate != null) {
    rows.push(makeRow('dueDate', entry.fromDueDate ?? '', entry.toDueDate ?? ''));
  }

  // Title change
  if (entry.fromTitle != null || entry.toTitle != null) {
    rows.push(makeRow('title', entry.fromTitle ?? '', entry.toTitle ?? ''));
  }

  // Project change
  if (entry.fromProject || entry.toProject) {
    rows.push(
      makeRow(
        'project',
        resolveProject(entry.fromProject, registry),
        resolveProject(entry.toProject, registry),
      ),
    );
  }

  // Cycle change
  if (entry.fromCycle || entry.toCycle) {
    rows.push(
      makeRow(
        'cycle',
        formatCycleToon(entry.fromCycle?.number) ?? '',
        formatCycleToon(entry.toCycle?.number) ?? '',
      ),
    );
  }

  // Parent change
  if (entry.fromParent || entry.toParent) {
    rows.push(
      makeRow(
        'parent',
        entry.fromParent?.identifier ?? '',
        entry.toParent?.identifier ?? '',
      ),
    );
  }

  // Team change
  if (entry.fromTeam || entry.toTeam) {
    rows.push(makeRow('team', entry.fromTeam?.key ?? '', entry.toTeam?.key ?? ''));
  }

  // Label changes
  if (
    (entry.addedLabels && entry.addedLabels.length > 0) ||
    (entry.removedLabels && entry.removedLabels.length > 0)
  ) {
    const removed = (entry.removedLabels ?? []).map((l) => l.name).join(',');
    const added = (entry.addedLabels ?? []).map((l) => l.name).join(',');
    rows.push(makeRow('labels', removed, added));
  }

  // Description updated
  if (entry.updatedDescription) {
    rows.push(makeRow('description', '(edited)', '(edited)'));
  }

  // Archived
  if (entry.archived === true) {
    rows.push(makeRow('archived', 'false', 'true'));
  }

  // Trashed
  if (entry.trashed === true) {
    rows.push(makeRow('trashed', 'false', 'true'));
  }

  // Relation changes
  if (entry.relationChanges && entry.relationChanges.length > 0) {
    for (const rel of entry.relationChanges) {
      rows.push(
        makeRow('relation', '', `${formatRelationType(rel.type)} ${rel.identifier}`),
      );
    }
  }

  // If no field changes detected and this is the first entry, emit "created"
  if (rows.length === 0 && isFirstEntry) {
    rows.push(makeRow('created', '', ''));
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Builders (Tier 2 - referenced entities only)
// ─────────────────────────────────────────────────────────────────────────────

interface ReferencedEntities {
  userIds: Set<string>;
  stateIds: Set<string>;
}

/**
 * Collect referenced entity IDs from history entries.
 */
function collectReferencedEntities(entries: RawHistoryEntry[]): ReferencedEntities {
  const userIds = new Set<string>();
  const stateIds = new Set<string>();

  for (const entry of entries) {
    if (entry.actorId) userIds.add(entry.actorId);
    if (entry.actor?.id) userIds.add(entry.actor.id);
    if (entry.fromAssignee?.id) userIds.add(entry.fromAssignee.id);
    if (entry.toAssignee?.id) userIds.add(entry.toAssignee.id);
    if (entry.fromState?.id) stateIds.add(entry.fromState.id);
    if (entry.toState?.id) stateIds.add(entry.toState.id);
  }

  return { userIds, stateIds };
}

/**
 * Build user lookup section for referenced users.
 */
function buildUserLookup(
  registry: ShortKeyRegistry,
  userIds: Set<string>,
  allEntries: RawHistoryEntry[],
  fallbackUserMap: Map<string, string>,
): ToonSection {
  const items: ToonRow[] = [];

  // Build userId -> userName map from entries for fallback users
  const userIdToName = new Map<string, string>();
  for (const entry of allEntries) {
    if (entry.actor?.id && entry.actor.name) {
      userIdToName.set(entry.actor.id, entry.actor.name);
    }
    if (entry.fromAssignee?.id && entry.fromAssignee.name) {
      userIdToName.set(entry.fromAssignee.id, entry.fromAssignee.name);
    }
    if (entry.toAssignee?.id && entry.toAssignee.name) {
      userIdToName.set(entry.toAssignee.id, entry.toAssignee.name);
    }
  }

  // Single pass over userIds using usersByUuid
  for (const uuid of userIds) {
    const shortKey = registry.usersByUuid.get(uuid);
    if (shortKey) {
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
      const adHocKey = fallbackUserMap.get(uuid);
      if (adHocKey) {
        const userName = userIdToName.get(uuid) ?? 'Unknown User';
        items.push({
          key: adHocKey,
          name: userName,
          displayName: '',
          email: '',
          role: '(external)',
          teams: '',
        });
      }
    }
  }

  // Sort: registry users first (u0, u1...), then external (ext0, ext1...)
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

  return { schema: USER_LOOKUP_SCHEMA, items };
}

/**
 * Build state lookup section for referenced states.
 */
function buildStateLookup(
  registry: ShortKeyRegistry,
  stateIds: Set<string>,
): ToonSection {
  const items: ToonRow[] = [];

  for (const [shortKey, uuid] of registry.states) {
    if (stateIds.has(uuid)) {
      const metadata = getStateMetadata(registry, uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? '',
        type: metadata?.type ?? '',
      });
    }
  }

  // Sort by key
  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace(/^[^0-9]*/, ''), 10);
    const numB = parseInt(String(b.key).replace(/^[^0-9]*/, ''), 10);
    return numA - numB;
  });

  return { schema: STATE_LOOKUP_SCHEMA, items };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOON Response Builder
// ─────────────────────────────────────────────────────────────────────────────

function buildHistoryToonResponse(
  allRows: ToonRow[],
  allEntries: RawHistoryEntry[],
  issueIdentifiers: string[],
  registry: ShortKeyRegistry | null,
  fallbackUserMap: Map<string, string>,
  pagination?: { hasMore: boolean; cursor?: string },
): ToonResponse {
  const lookups: ToonSection[] = [];

  if (registry) {
    const { userIds, stateIds } = collectReferencedEntities(allEntries);
    const userLookup = buildUserLookup(registry, userIds, allEntries, fallbackUserMap);
    if (userLookup.items.length > 0) lookups.push(userLookup);
    const stateLookup = buildStateLookup(registry, stateIds);
    if (stateLookup.items.length > 0) lookups.push(stateLookup);
  }

  const data: ToonSection[] = [{ schema: HISTORY_ENTRY_SCHEMA, items: allRows }];

  // Add pagination if applicable (single-issue only)
  if (pagination?.hasMore) {
    data.push({
      schema: PAGINATION_SCHEMA,
      items: [
        {
          hasMore: true,
          cursor: pagination.cursor ?? '',
          fetched: allRows.length,
          total: '',
        },
      ],
    });
  }

  const metaFields = ['tool', 'issues', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'get_issue_history',
    issues: issueIdentifiers.join(','),
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Schema
// ─────────────────────────────────────────────────────────────────────────────

const GetIssueHistoryInputSchema = z.object({
  issueIds: z
    .array(z.string())
    .min(1)
    .max(25)
    .describe('Issue identifiers (e.g., "SQT-542") or UUIDs. 1-25 issues per call.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Per-issue history limit. Default: 50 for single issue, 20 for bulk. Max 100.',
    ),
  cursor: z.string().optional().describe('Pagination cursor (single-issue only).'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export const getIssueHistoryTool = defineTool({
  name: toolsMetadata.get_issue_history.name,
  title: toolsMetadata.get_issue_history.title,
  description: toolsMetadata.get_issue_history.description,
  inputSchema: GetIssueHistoryInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);

    // Determine per-issue limit
    const isBulk = args.issueIds.length > 1;
    const perIssueLimit = args.limit ?? (isBulk ? 20 : 50);
    const after = args.cursor;

    // Fetch history for each issue in parallel with concurrency gate
    const gate = makeConcurrencyGate(3);

    const results = await Promise.all(
      args.issueIds.map((issueId) =>
        gate(async () => {
          if (context.signal?.aborted) {
            return { issueId, error: 'Operation cancelled' };
          }

          try {
            const resp = (await client.client.rawRequest(ISSUE_HISTORY_QUERY, {
              id: issueId,
              first: perIssueLimit,
              after: after ?? undefined,
            })) as unknown as RawIssueHistoryResponse;

            const issue = resp.data?.issue;
            if (!issue) {
              return { issueId, error: `Issue not found: ${issueId}` };
            }

            return {
              issueId,
              identifier: issue.identifier,
              entries: issue.history?.nodes ?? [],
              pageInfo: issue.history?.pageInfo,
            };
          } catch (err) {
            return {
              issueId,
              error: `Failed to fetch history: ${(err as Error).message}`,
            };
          }
        }),
      ),
    );

    // Initialize registry
    let registry: ShortKeyRegistry | null = null;
    try {
      registry = await getOrInitRegistry(
        { sessionId: context.sessionId, transport: 'stdio' },
        () => fetchWorkspaceDataForRegistry(client),
      );
    } catch {
      // Continue without registry
    }

    // Expand all entries into TOON rows
    const allRows: ToonRow[] = [];
    const allEntries: RawHistoryEntry[] = [];
    const issueIdentifiers: string[] = [];
    const fallbackUserMap = new Map<string, string>();
    let singleIssuePagination: { hasMore: boolean; cursor?: string } | undefined;

    for (const result of results) {
      if ('error' in result && result.error) {
        // Add a warning row for failed issues
        allRows.push({
          issue: result.issueId,
          time: '',
          actor: '',
          field: 'error',
          from: '',
          to: result.error,
        });
        issueIdentifiers.push(result.issueId);
        continue;
      }

      if (!('entries' in result)) continue;

      const identifier = result.identifier ?? result.issueId;
      issueIdentifiers.push(identifier);

      const entries = result.entries ?? [];
      allEntries.push(...entries);

      // Track pagination for single-issue requests
      if (!isBulk && result.pageInfo) {
        singleIssuePagination = {
          hasMore: result.pageInfo.hasNextPage ?? false,
          cursor: result.pageInfo.endCursor ?? undefined,
        };
      }

      // Expand entries (reverse order so oldest first)
      const orderedEntries = [...entries].reverse();
      for (let i = 0; i < orderedEntries.length; i++) {
        const entry = orderedEntries[i];
        if (!entry) continue;
        const isFirstEntry = i === 0;
        const rows = expandHistoryEntry(
          entry,
          identifier,
          registry,
          fallbackUserMap,
          isFirstEntry,
        );
        allRows.push(...rows);
      }
    }

    // Build TOON response
    const toonResponse = buildHistoryToonResponse(
      allRows,
      allEntries,
      issueIdentifiers,
      registry,
      fallbackUserMap,
      singleIssuePagination,
    );

    const projectSlugMap = registry ? getProjectSlugMap(registry) : undefined;
    const toonOutput = encodeResponse(allRows, toonResponse, { projectSlugMap });

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
