/**
 * Get Issues tool - fetch multiple issues by ID in batch.
 *
 * Returns TOON output format (Tier 2) with only REFERENCED entities.
 *
 * IMPORTANT: This is a detail view tool - descriptions are NOT truncated (unlimited).
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { fetchWorkspaceDataForRegistry } from '../shared/registry-init.js';

// Internal schema for validating fetched issue data
const GetIssueOutputSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    identifier: z.string().optional(),
    url: z.string().optional(),
    priority: z.number().optional(),
    estimate: z.number().optional(),
    cycle: z.object({ number: z.number().optional() }).optional(),
    team: z.object({ id: z.string(), key: z.string().optional() }).optional(),
    assignee: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    creator: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    state: z
      .object({ id: z.string(), name: z.string(), type: z.string().optional() })
      .optional(),
    project: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
    branchName: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
    createdAt: z.string().optional(),
  })
  .strict();

import { makeConcurrencyGate } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import {
  encodeResponse,
  formatCycleToon,
  formatEstimateToon,
  formatPriorityToon,
  getOrInitRegistry,
  getProjectMetadata,
  getUserMetadata,
  ISSUE_SCHEMA,
  LABEL_LOOKUP_SCHEMA,
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
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  ids: z
    .array(z.string())
    .min(1)
    .max(50)
    .describe('Issue IDs to fetch. Accepts UUIDs or short identifiers like ENG-123.'),
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extended raw issue data for TOON processing.
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
  createdAt?: string | Date;
  updatedAt?: string | Date;
  archivedAt?: string | null;
  dueDate?: string | null;
  url?: string;
  labels?: Array<{ id: string; name: string }>;
  branchName?: string | null;
  creator?: { id: string; name?: string } | null;
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
    if (issue.creator?.id) {
      refs.userIds.add(issue.creator.id);
    }
    if (issue.state?.id) {
      refs.stateIds.add(issue.state.id);
    }
    if (issue.project?.id) {
      refs.projectIds.add(issue.project.id);
    }
    const labels = issue.labels ?? [];
    for (const label of labels) {
      refs.labelNames.add(label.name);
    }
  }

  return refs;
}

/**
 * Convert an issue to TOON row format (for detail view - no truncation).
 */
function issueToToonRow(
  issue: RawIssueData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  let assigneeKey =
    registry && issue.assignee?.id
      ? tryGetShortKey(registry, 'user', issue.assignee.id)
      : undefined;
  if (!assigneeKey && issue.assignee?.id && fallbackUserMap) {
    assigneeKey = fallbackUserMap.get(issue.assignee.id);
  }
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
  if (!creatorKey && issue.creator?.id && fallbackUserMap) {
    creatorKey = fallbackUserMap.get(issue.creator.id);
  }

  const labelNames = (issue.labels ?? []).map((l) => l.name).join(',');

  return {
    identifier: issue.identifier ?? '',
    title: issue.title,
    state: stateKey ?? issue.state?.name ?? '',
    assignee: assigneeKey ?? '',
    priority: formatPriorityToon(issue.priority),
    estimate: formatEstimateToon(issue.estimate),
    project: projectKey ?? '',
    cycle: formatCycleToon(issue.cycle?.number),
    dueDate: issue.dueDate ?? null,
    labels: labelNames || null,
    parent: issue.parent?.identifier ?? null,
    team: issue.team?.key ?? '',
    url: issue.url ?? null,
    desc: issue.description ?? null, // Full description - no truncation for detail view
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
 * Single-pass: iterates referencedIds, looks up registry.usersByUuid.
 * Creates ext entries for users not in the registry.
 *
 * @returns section for TOON output, plus fallbackMap (uuid -> ext key) for
 *          unregistered users so issueToToonRow can resolve them.
 */
function buildUserLookup(
  registry: ShortKeyRegistry,
  referencedIds: Set<string>,
  issues: RawIssueData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  const items: ToonRow[] = [];
  const fallbackMap = new Map<string, string>();

  // Build a name lookup from issue data (assignees + creators)
  const userInfo = new Map<string, string>();
  for (const issue of issues) {
    if (issue.assignee?.id && issue.assignee.name) {
      userInfo.set(issue.assignee.id, issue.assignee.name);
    }
    if (issue.creator?.id && issue.creator.name) {
      userInfo.set(issue.creator.id, issue.creator.name);
    }
  }

  let extCounter = 0;

  for (const uuid of referencedIds) {
    const shortKey = registry.usersByUuid.get(uuid);

    if (shortKey) {
      // Registered user - use full metadata
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
      // Unregistered user - create ext entry with fallback name
      const extKey = `ext${extCounter++}`;
      const name = userInfo.get(uuid) ?? 'Unknown User';
      fallbackMap.set(uuid, extKey);
      items.push({
        key: extKey,
        name,
        displayName: '',
        email: '',
        role: '',
        teams: '',
      });
    }
  }

  items.sort((a, b) => {
    const keyA = String(a.key);
    const keyB = String(b.key);
    const isExtA = keyA.startsWith('ext');
    const isExtB = keyB.startsWith('ext');
    // Sort u* keys before ext* keys
    if (isExtA !== isExtB) return isExtA ? 1 : -1;
    const numA = parseInt(keyA.replace(/^(u|ext)/, ''), 10);
    const numB = parseInt(keyB.replace(/^(u|ext)/, ''), 10);
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
        state: metadata?.state ?? '',
        priority: metadata?.priority ?? null,
        progress:
          metadata?.progress !== undefined
            ? Math.round(metadata.progress * 100) / 100
            : null,
        lead: metadata?.leadId
          ? (tryGetShortKey(registry, 'user', metadata.leadId) ?? '(departed)')
          : '',
        targetDate: metadata?.targetDate ?? '',
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
 * Build label lookup from issues.
 */
function buildLabelLookup(issues: RawIssueData[]): ToonSection {
  const labelMap = new Map<string, { name: string; color?: string }>();

  for (const issue of issues) {
    const labels = issue.labels ?? [];
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
 * Build TOON response for get_issues.
 * Note: Uses unlimited description truncation (detail view).
 */
function buildToonResponse(
  rawIssues: RawIssueData[],
  rawRelations: Array<{
    issueIdentifier: string;
    type: string;
    relatedIssueIdentifier: string;
  }>,
  registry: ShortKeyRegistry | null,
  succeeded: number,
  failed: number,
): ToonResponse {
  const refs = collectReferencedEntities(rawIssues);
  const lookups: ToonSection[] = [];
  let fallbackMap: Map<string, string> | undefined;

  if (registry && refs.userIds.size > 0) {
    const userResult = buildUserLookup(registry, refs.userIds, rawIssues);
    fallbackMap = userResult.fallbackMap;
    if (userResult.section.items.length > 0) {
      lookups.push(userResult.section);
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

  const issueRows = rawIssues.map((issue) =>
    issueToToonRow(issue, registry, fallbackMap),
  );
  const data: ToonSection[] = [{ schema: ISSUE_SCHEMA, items: issueRows }];

  if (rawRelations.length > 0) {
    const relationRows: ToonRow[] = rawRelations.map((r) => ({
      from: r.issueIdentifier,
      type: r.type,
      to: r.relatedIssueIdentifier,
    }));
    data.push({ schema: RELATION_SCHEMA, items: relationRows });
  }

  const metaFields = ['tool', 'succeeded', 'failed', 'total', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'get_issues',
    succeeded,
    failed,
    total: succeeded + failed,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

export const getIssuesTool = defineTool({
  name: toolsMetadata.get_issues.name,
  title: toolsMetadata.get_issues.title,
  description: toolsMetadata.get_issues.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(3);
    const ids = args.ids;

    const results: Array<{
      requestedId: string;
      success: boolean;
      issue?: ReturnType<typeof GetIssueOutputSchema.parse>;
      error?: { code: string; message: string; suggestions?: string[] };
      // Extra fields for TOON output (not in GetIssueOutputSchema)
      creator?: { id: string; name?: string } | null;
      createdAt?: Date | string;
      relations?: Array<{ type: string; relatedIssueIdentifier: string }>;
    }> = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as string;
      try {
        const issue = await gate(() => client.issue(id));
        const labels = (await issue.labels()).nodes.map((l) => ({
          id: l.id,
          name: l.name,
        }));

        // Await lazy-loaded relations
        const assigneeData = await issue.assignee;
        const stateData = await issue.state;
        const projectData = await issue.project;
        const cycleData = await issue.cycle;
        const teamData = await issue.team;
        const creatorData = await issue.creator;

        const relationsData = await (
          issue as unknown as {
            relations?: () => Promise<{
              nodes: Array<{
                id: string;
                type: string;
                relatedIssue: { identifier: string };
              }>;
            }>;
          }
        ).relations?.();

        const issueUrl = (issue as unknown as { url?: string })?.url;
        const issueCreatedAt = (issue as unknown as { createdAt?: Date | string })
          ?.createdAt;

        const structured = GetIssueOutputSchema.parse({
          id: issue.id,
          title: issue.title,
          description: issue.description ?? undefined,
          identifier: issue.identifier ?? undefined,
          url: issueUrl,
          priority: issue.priority,
          estimate: issue.estimate ?? undefined,
          cycle: cycleData ? { number: cycleData.number } : undefined,
          team: teamData
            ? {
                id: teamData.id,
                key: (teamData as unknown as { key?: string })?.key,
              }
            : undefined,
          assignee: assigneeData
            ? {
                id: assigneeData.id,
                name: assigneeData.name ?? undefined,
              }
            : undefined,
          state: stateData
            ? {
                id: stateData.id,
                name: stateData.name ?? '',
                type: (stateData as unknown as { type?: string })?.type,
              }
            : undefined,
          project: projectData
            ? {
                id: projectData.id,
                name: projectData.name ?? undefined,
              }
            : undefined,
          labels,
          branchName: issue.branchName ?? undefined,
          attachments: (await issue.attachments()).nodes,
          creator: creatorData
            ? { id: creatorData.id, name: creatorData.name ?? undefined }
            : undefined,
          createdAt: issueCreatedAt
            ? issueCreatedAt instanceof Date
              ? issueCreatedAt.toISOString()
              : issueCreatedAt
            : undefined,
        });

        results.push({
          requestedId: id,
          success: true,
          issue: structured,
          relations: await Promise.all(
            (relationsData?.nodes ?? []).map(async (r) => {
              const related = await Promise.resolve(r.relatedIssue);
              return {
                type: r.type,
                relatedIssueIdentifier:
                  (related as unknown as { identifier?: string })?.identifier ?? '',
              };
            }),
          ),
        });
      } catch (error) {
        await logger.error('get_issues', {
          message: 'Failed to fetch issue',
          id,
          error: (error as Error).message,
        });
        results.push({
          requestedId: id,
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: (error as Error).message,
            suggestions: [
              'Verify the issue ID or identifier is correct.',
              'Use list_issues to find valid issue IDs.',
              'Check if the issue was archived (use includeArchived: true).',
            ],
          },
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Convert successful results to RawIssueData for TOON processing
    const rawIssues: RawIssueData[] = results
      .filter((r) => r.success && r.issue)
      .map((r) => {
        const issue = r.issue as unknown as {
          id: string;
          identifier?: string;
          title: string;
          description?: string | null;
          url?: string;
          priority?: number;
          estimate?: number | null;
          cycle?: { number?: number };
          team?: { id: string; key?: string };
          assignee?: { id: string; name?: string };
          state?: { id: string; name: string; type?: string };
          project?: { id: string; name?: string };
          labels?: Array<{ id: string; name: string }>;
          branchName?: string | null;
          creator?: { id: string; name?: string };
          createdAt?: string;
        };
        return {
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description,
          url: issue.url,
          priority: issue.priority,
          estimate: issue.estimate,
          cycle: issue.cycle,
          team: issue.team,
          assignee: issue.assignee,
          state: issue.state,
          project: issue.project,
          labels: issue.labels,
          creator: issue.creator,
          createdAt: issue.createdAt,
        };
      });

    const rawRelations: Array<{
      issueIdentifier: string;
      type: string;
      relatedIssueIdentifier: string;
    }> = [];
    for (const r of results) {
      if (r.success && r.relations) {
        const issueIdentifier =
          (r.issue as unknown as { identifier?: string })?.identifier ?? r.requestedId;
        for (const rel of r.relations) {
          rawRelations.push({
            issueIdentifier,
            type: rel.type,
            relatedIssueIdentifier: rel.relatedIssueIdentifier,
          });
        }
      }
    }

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

    // Build TOON response with unlimited desc truncation (detail view)
    const toonResponse = buildToonResponse(
      rawIssues,
      rawRelations,
      registry,
      succeeded,
      failed,
    );

    // Encode with no truncation for descriptions (detail view)
    const toonOutput = encodeResponse(rawIssues, toonResponse, {
      truncation: {
        title: 500,
        desc: undefined, // No truncation for detail views
        default: undefined,
      },
    });

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
