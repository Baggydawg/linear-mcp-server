/**
 * Projects tools - list, create, and update projects.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with project leads in _users lookup
 *
 * Projects use short keys (pr0, pr1...).
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { resolveTeamId } from '../../../utils/resolvers.js';
import {
  CREATED_PROJECT_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  getUserMetadata,
  PROJECT_CHANGES_SCHEMA,
  PROJECT_SCHEMA,
  PROJECT_WRITE_RESULT_SCHEMA,
  type RegistryBuildData,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  registerNewProject,
  tryGetShortKey,
  tryResolveShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw project data from Linear API for TOON processing.
 */
interface RawProjectData {
  id: string;
  name: string;
  description?: string | null;
  state?: string;
  priority?: number;
  progress?: number;
  leadId?: string;
  lead?: { id?: string } | null;
  teams?: Array<{ key?: string }>;
  startDate?: string | null;
  targetDate?: string | null;
  health?: string | null;
  createdAt?: Date | string;
}

/**
 * Fetch workspace data for registry initialization with full metadata.
 */
async function fetchWorkspaceDataForRegistry(
  client: Awaited<ReturnType<typeof getLinearClient>>,
): Promise<RegistryBuildData> {
  // Fetch users with full metadata
  const usersConn = await client.users({ first: 100 });
  const users = (usersConn.nodes ?? []).map((u) => {
    const admin = (u as unknown as { admin?: boolean }).admin ?? false;
    return {
      id: u.id,
      createdAt:
        (u as unknown as { createdAt?: Date | string }).createdAt ?? new Date(),
      name: u.name ?? '',
      displayName: (u as unknown as { displayName?: string }).displayName ?? '',
      email: (u as unknown as { email?: string }).email ?? '',
      active: (u as unknown as { active?: boolean }).active ?? true,
      role: admin ? 'admin' : 'member',
    };
  });

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
        teamId: team.id,
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

  // Get workspace ID from viewer
  const viewer = await client.viewer;
  const viewerOrg = viewer as unknown as { organization?: { id?: string } };
  const workspaceId = viewerOrg?.organization?.id ?? 'unknown';

  return { users, states, projects, workspaceId };
}

/**
 * Convert a project to TOON row format.
 */
function projectToToonRow(
  project: RawProjectData,
  registry: ShortKeyRegistry | null,
): ToonRow {
  // Get short keys from registry
  const projectKey = registry
    ? tryGetShortKey(registry, 'project', project.id)
    : undefined;
  const leadId = project.leadId ?? project.lead?.id;
  const leadKey =
    registry && leadId ? tryGetShortKey(registry, 'user', leadId) : undefined;

  // Format teams as comma-separated keys
  const teamsStr = (project.teams ?? [])
    .map((t) => t.key)
    .filter(Boolean)
    .join(',');

  return {
    key: projectKey ?? '',
    name: project.name ?? '',
    description: project.description ?? null,
    state: project.state ?? null,
    priority: project.priority ?? null,
    progress: project.progress ?? 0,
    lead: leadKey ?? null,
    teams: teamsStr || null,
    startDate: project.startDate ?? null,
    targetDate: project.targetDate ?? null,
    health: project.health ?? null,
  };
}

/**
 * Build user lookup table with only project leads (Tier 2).
 */
function buildProjectLeadLookup(
  registry: ShortKeyRegistry,
  projects: RawProjectData[],
): ToonSection {
  // Collect unique lead IDs from projects
  const userIds = new Set<string>();
  for (const project of projects) {
    const leadId = project.leadId ?? project.lead?.id;
    if (leadId) {
      userIds.add(leadId);
    }
  }

  // Build lookup items
  const items: ToonRow[] = [];
  for (const [shortKey, uuid] of registry.users) {
    if (userIds.has(uuid)) {
      const metadata = getUserMetadata(registry, uuid);
      items.push({
        key: shortKey,
        name: metadata?.name ?? '',
        displayName: metadata?.displayName ?? '',
        email: metadata?.email ?? '',
        role: metadata?.role ?? '',
      });
    }
  }

  // Sort by key number for consistent output
  items.sort((a, b) => {
    const numA = parseInt(String(a.key).replace('u', ''), 10);
    const numB = parseInt(String(b.key).replace('u', ''), 10);
    return numA - numB;
  });

  return { schema: USER_LOOKUP_SCHEMA, items };
}

/**
 * Build TOON response for list_projects.
 */
function buildProjectsToonResponse(
  projects: RawProjectData[],
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Build lookup sections (Tier 2 - only project leads)
  const lookups: ToonSection[] = [];

  // Add user lookup if we have a registry and projects with leads
  if (registry) {
    const userLookup = buildProjectLeadLookup(registry, projects);
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  // Convert projects to TOON rows
  const projectRows = projects.map((project) => projectToToonRow(project, registry));

  // Build data sections
  const data: ToonSection[] = [{ schema: PROJECT_SCHEMA, items: projectRows }];

  // Build meta section
  const metaFields = ['tool', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_projects',
    count: projects.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

// List Projects
const ListProjectsInputSchema = z.object({
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
      'GraphQL-style ProjectFilter. Structure: { field: { comparator: value } }. ' +
        "Examples: { id: { eq: 'PROJECT_UUID' } } for single project, " +
        "{ state: { eq: 'started' } }, " +
        "{ team: { id: { eq: 'TEAM_UUID' } } }, " +
        "{ lead: { id: { eq: 'USER_UUID' } } }, " +
        "{ targetDate: { lt: '2025-01-01', gt: '2024-01-01' } }.",
    ),
  includeArchived: z
    .boolean()
    .optional()
    .describe('Include archived projects. Default: false.'),
});

export const listProjectsTool = defineTool({
  name: toolsMetadata.list_projects.name,
  title: toolsMetadata.list_projects.title,
  description: toolsMetadata.list_projects.description,
  inputSchema: ListProjectsInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const first = args.limit ?? 20;
    const after = args.cursor;
    let filter = args.filter as Record<string, unknown> | undefined;

    // Apply team filter if DEFAULT_TEAM configured and no team filter in args
    if (!filter?.team && config.DEFAULT_TEAM) {
      const resolved = await resolveTeamId(client, config.DEFAULT_TEAM);
      if (resolved.success) {
        filter = { ...filter, team: { id: { eq: resolved.value } } };
      }
    }

    const conn = await client.projects({
      first,
      after,
      filter: filter as Record<string, unknown> | undefined,
      includeArchived: args.includeArchived,
    });

    const pageInfo = conn.pageInfo;
    const _hasMore = pageInfo?.hasNextPage ?? false;
    const _nextCursor = _hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

    // Convert items to RawProjectData for TOON processing
    const rawProjects: RawProjectData[] = conn.nodes.map((p) => ({
      id: p.id,
      name: p.name,
      description: (p as unknown as { description?: string }).description,
      state: p.state,
      priority: (p as unknown as { priority?: number }).priority,
      progress: (p as unknown as { progress?: number }).progress,
      leadId: (p as unknown as { leadId?: string }).leadId,
      lead: (p as unknown as { lead?: { id?: string } }).lead,
      teams: (p as unknown as { teams?: { nodes?: Array<{ key?: string }> } }).teams
        ?.nodes,
      startDate: (p as unknown as { startDate?: string }).startDate,
      targetDate: (p as unknown as { targetDate?: string }).targetDate,
      health: (p as unknown as { health?: string }).health,
      createdAt: (p as unknown as { createdAt?: Date | string }).createdAt,
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
      // Registry init failed, continue without it
      console.error('Registry initialization failed:', error);
    }

    // Build TOON response
    const toonResponse = buildProjectsToonResponse(rawProjects, registry);

    // Encode TOON output
    const toonOutput = encodeResponse(rawProjects, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});

// Create Projects
const CreateProjectsInputSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().describe('Project name. Required.'),
        description: z
          .string()
          .optional()
          .describe('Short description shown under project title.'),
        content: z
          .string()
          .optional()
          .describe('Full markdown content for the project (longer description area).'),
        teamId: z
          .string()
          .optional()
          .describe('Team UUID or key (e.g., "SQT") to associate.'),
        leadId: z
          .string()
          .optional()
          .describe('Lead user UUID or short key (u0, u1...).'),
        lead: z.string().optional().describe('Lead user short key (u0, u1...).'),
        targetDate: z.string().optional().describe('Target date (YYYY-MM-DD).'),
      }),
    )
    .min(1)
    .max(50)
    .describe(
      'Projects to create. Use update_projects to change state after creation.',
    ),
});

export const createProjectsTool = defineTool({
  name: toolsMetadata.create_projects.name,
  title: toolsMetadata.create_projects.title,
  description: toolsMetadata.create_projects.description,
  inputSchema: CreateProjectsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    // Initialize registry for short key resolution
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

    const results: {
      index: number;
      ok: boolean;
      id?: string;
      projectKey?: string;
      name?: string;
      state?: string;
      error?: string | { code: string; message: string; suggestions: string[] };
      code?: string;
      input?: { name: string; teamId?: string };
      success?: boolean;
    }[] = [];

    // Batch-level cache for team key resolution
    const teamKeyCache = new Map<string, string>();

    for (let i = 0; i < args.items.length; i++) {
      const it = args.items[i];
      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        // Resolve lead short key (u0, u1...) to UUID if registry available
        let resolvedLeadId = it.leadId;
        const leadShortKey = it.lead ?? it.leadId;
        if (registry && leadShortKey && /^u\d+$/.test(leadShortKey)) {
          const uuid = tryResolveShortKey(registry, 'user', leadShortKey);
          if (uuid) {
            resolvedLeadId = uuid;
          }
        }

        // Resolve team from key or UUID (with batch-level caching)
        let resolvedTeamIds: string[] = [];
        if (it.teamId) {
          const cacheKey = it.teamId.toLowerCase();
          let resolvedTeamId = teamKeyCache.get(cacheKey);

          if (!resolvedTeamId) {
            const teamResult = await resolveTeamId(client, it.teamId);
            if (!teamResult.success) {
              results.push({
                input: { name: it.name, teamId: it.teamId },
                success: false,
                error: {
                  code: 'TEAM_RESOLUTION_FAILED',
                  message: teamResult.error,
                  suggestions: teamResult.suggestions ?? [],
                },
                index: i,
                ok: false,
              });
              continue;
            }
            resolvedTeamId = teamResult.value;
            teamKeyCache.set(cacheKey, resolvedTeamId);
          }
          resolvedTeamIds = [resolvedTeamId];
        }

        const call = () =>
          client.createProject({
            name: it.name,
            description: it.description,
            content: it.content,
            leadId: resolvedLeadId,
            targetDate: it.targetDate,
            teamIds: resolvedTeamIds,
          });

        const payload = await withRetry(
          () => (args.items.length > 1 ? gate(call) : call()),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        // Must await project relation as Linear SDK uses lazy-loading (returns Promise)
        const project = (await payload.project) as {
          id?: string;
          state?: string;
        } | null;

        // Register new project and get short key for TOON output
        let projectKey: string | undefined;
        if (registry && project?.id) {
          projectKey = registerNewProject(registry, project.id, {
            name: it.name,
            state: project.state ?? 'planned',
          });
        }

        results.push({
          input: { name: it.name, teamId: it.teamId },
          success: payload.success ?? true,
          id: project?.id,
          projectKey,
          name: it.name,
          state: project?.state ?? 'planned',
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('create_projects', {
          message: 'Failed to create project',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          input: { name: it.name, teamId: it.teamId },
          success: false,
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: ['Verify teamId with workspace_metadata.'],
          },
          // Legacy
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Build TOON results section
    const toonResults: ToonRow[] = results.map((r) => {
      const errObj =
        typeof r.error === 'object'
          ? (r.error as { code?: string; message?: string; suggestions?: string[] })
          : null;
      return {
        index: r.index,
        status: r.success ? 'ok' : 'error',
        key: r.projectKey ?? '',
        error: r.success
          ? ''
          : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
        code: r.success ? '' : (errObj?.code ?? ''),
        hint: r.success ? '' : (errObj?.suggestions?.[0] ?? ''),
      };
    });

    // Build created projects section (only for successful results)
    const createdProjects: ToonRow[] = results
      .filter((r) => r.success)
      .map((r) => ({
        key: r.projectKey ?? '',
        name: r.name ?? '',
        state: r.state ?? 'planned',
      }));

    // Build TOON response
    const toonResponse: ToonResponse = {
      meta: {
        fields: ['action', 'succeeded', 'failed', 'total'],
        values: {
          action: 'create_projects',
          succeeded,
          failed,
          total: args.items.length,
        },
      },
      data: [
        { schema: PROJECT_WRITE_RESULT_SCHEMA, items: toonResults },
        ...(createdProjects.length > 0
          ? [{ schema: CREATED_PROJECT_SCHEMA, items: createdProjects }]
          : []),
      ],
    };

    const toonOutput = encodeToon(toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});

// Update Projects
const UpdateProjectsInputSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe('Project UUID or short key (pr0, pr1...). Required.'),
        name: z.string().optional().describe('New project name.'),
        description: z
          .string()
          .optional()
          .describe('New short description shown under project title.'),
        content: z
          .string()
          .optional()
          .describe('New full markdown content for the project (longer description area).'),
        leadId: z
          .string()
          .optional()
          .describe('New lead user UUID or short key (u0, u1...).'),
        lead: z.string().optional().describe('New lead user short key (u0, u1...).'),
        targetDate: z.string().optional().describe('New target date (YYYY-MM-DD).'),
        state: z
          .string()
          .optional()
          .describe(
            "New state: 'planned', 'started', 'paused', 'completed', 'canceled'.",
          ),
        archived: z
          .boolean()
          .optional()
          .describe('Set true to archive, false to unarchive.'),
      }),
    )
    .min(1)
    .max(50)
    .describe('Projects to update.'),
});

/**
 * Capture project snapshot for before/after diff.
 */
interface ProjectSnapshot {
  id: string;
  name?: string;
  state?: string;
  targetDate?: string | null;
  leadId?: string | null;
}

async function captureProjectSnapshot(
  client: Awaited<ReturnType<typeof getLinearClient>>,
  projectId: string,
): Promise<ProjectSnapshot | null> {
  try {
    const projectsConn = await client.projects({
      first: 1,
      filter: { id: { eq: projectId } },
    });
    const project = projectsConn.nodes[0];
    if (!project) return null;

    return {
      id: project.id,
      name: project.name,
      state: project.state,
      targetDate: (project as unknown as { targetDate?: string }).targetDate ?? null,
      leadId: (project as unknown as { leadId?: string }).leadId ?? null,
    };
  } catch {
    return null;
  }
}

export const updateProjectsTool = defineTool({
  name: toolsMetadata.update_projects.name,
  title: toolsMetadata.update_projects.title,
  description: toolsMetadata.update_projects.description,
  inputSchema: UpdateProjectsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    // Initialize registry for short key resolution
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

    // Track results with changes
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      projectKey?: string;
      changes?: Array<{
        field: string;
        before: string | null;
        after: string | null;
      }>;
      error?: string | { code: string; message: string; suggestions: string[] };
      code?: string;
      input?: { id: string; name?: string; state?: string };
      success?: boolean;
    }[] = [];

    for (let i = 0; i < args.items.length; i++) {
      const it = args.items[i];
      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        // Resolve project short key (pr0, pr1...) to UUID if registry available
        let resolvedProjectId = it.id;
        if (registry && /^pr\d+$/.test(it.id)) {
          const uuid = tryResolveShortKey(registry, 'project', it.id);
          if (uuid) {
            resolvedProjectId = uuid;
          }
        }

        // Resolve lead short key (u0, u1...) to UUID if registry available
        let resolvedLeadId = it.leadId;
        const leadShortKey = it.lead ?? it.leadId;
        if (registry && leadShortKey && /^u\d+$/.test(leadShortKey)) {
          const uuid = tryResolveShortKey(registry, 'user', leadShortKey);
          if (uuid) {
            resolvedLeadId = uuid;
          }
        }

        // Capture BEFORE snapshot for diff
        const beforeSnapshot = await gate(() =>
          captureProjectSnapshot(client, resolvedProjectId),
        );

        const updatePayload: Record<string, unknown> = {};
        if (it.name) updatePayload.name = it.name;
        if (it.description) updatePayload.description = it.description;
        if (it.content) updatePayload.content = it.content;
        if (resolvedLeadId) updatePayload.leadId = resolvedLeadId;
        if (it.targetDate) updatePayload.targetDate = it.targetDate;
        if (it.state) updatePayload.state = it.state;

        const call = () => client.updateProject(resolvedProjectId, updatePayload);

        const result = await withRetry(
          () => (args.items.length > 1 ? gate(call) : call()),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        // Handle archive/unarchive
        if (typeof it.archived === 'boolean') {
          try {
            if (it.archived) {
              await client.archiveProject(resolvedProjectId);
            } else {
              await client.unarchiveProject(resolvedProjectId);
            }
          } catch {
            // Ignore archive errors to preserve other updates
          }
        }

        // Capture AFTER snapshot for diff
        const afterSnapshot = await gate(() =>
          captureProjectSnapshot(client, resolvedProjectId),
        );

        // Compute changes
        const changes: Array<{
          field: string;
          before: string | null;
          after: string | null;
        }> = [];

        if (beforeSnapshot && afterSnapshot) {
          if (beforeSnapshot.state !== afterSnapshot.state) {
            changes.push({
              field: 'state',
              before: beforeSnapshot.state ?? null,
              after: afterSnapshot.state ?? null,
            });
          }
          if (beforeSnapshot.name !== afterSnapshot.name) {
            changes.push({
              field: 'name',
              before: beforeSnapshot.name ?? null,
              after: afterSnapshot.name ?? null,
            });
          }
          if (beforeSnapshot.targetDate !== afterSnapshot.targetDate) {
            changes.push({
              field: 'targetDate',
              before: beforeSnapshot.targetDate ?? null,
              after: afterSnapshot.targetDate ?? null,
            });
          }
          if (beforeSnapshot.leadId !== afterSnapshot.leadId) {
            // Convert lead UUID to short key for TOON output
            const beforeLeadKey =
              registry && beforeSnapshot.leadId
                ? tryGetShortKey(registry, 'user', beforeSnapshot.leadId)
                : beforeSnapshot.leadId;
            const afterLeadKey =
              registry && afterSnapshot.leadId
                ? tryGetShortKey(registry, 'user', afterSnapshot.leadId)
                : afterSnapshot.leadId;
            changes.push({
              field: 'lead',
              before: beforeLeadKey ?? null,
              after: afterLeadKey ?? null,
            });
          }
        }

        // Get project short key for TOON output
        const projectKey =
          registry && resolvedProjectId
            ? tryGetShortKey(registry, 'project', resolvedProjectId)
            : undefined;

        results.push({
          input: { id: it.id, name: it.name, state: it.state },
          success: result.success ?? true,
          id: resolvedProjectId,
          projectKey,
          changes,
          // Legacy
          index: i,
          ok: result.success ?? true,
        });
      } catch (error) {
        await logger.error('update_projects', {
          message: 'Failed to update project',
          id: it.id,
          error: (error as Error).message,
        });
        results.push({
          input: { id: it.id },
          success: false,
          id: it.id,
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: ['Verify project ID with list_projects.'],
          },
          // Legacy
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    // Build TOON results section
    const toonResults: ToonRow[] = results.map((r) => {
      const errObj =
        typeof r.error === 'object'
          ? (r.error as { code?: string; message?: string; suggestions?: string[] })
          : null;
      return {
        index: r.index,
        status: r.success ? 'ok' : 'error',
        key: r.projectKey ?? '',
        error: r.success
          ? ''
          : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
        code: r.success ? '' : (errObj?.code ?? ''),
        hint: r.success ? '' : (errObj?.suggestions?.[0] ?? ''),
      };
    });

    // Build changes section (flatten all changes from all results)
    const allChanges: ToonRow[] = [];
    for (const r of results.filter((r) => r.success && r.changes)) {
      for (const change of r.changes ?? []) {
        allChanges.push({
          key: r.projectKey ?? '',
          field: change.field,
          before: change.before ?? '',
          after: change.after ?? '',
        });
      }
    }

    // Build TOON response
    const toonResponse: ToonResponse = {
      meta: {
        fields: ['action', 'succeeded', 'failed', 'total'],
        values: {
          action: 'update_projects',
          succeeded,
          failed,
          total: args.items.length,
        },
      },
      data: [
        { schema: PROJECT_WRITE_RESULT_SCHEMA, items: toonResults },
        ...(allChanges.length > 0
          ? [{ schema: PROJECT_CHANGES_SCHEMA, items: allChanges }]
          : []),
      ],
    };

    const toonOutput = encodeToon(toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
