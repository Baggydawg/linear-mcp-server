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
import { createErrorFromException, formatErrorMessage } from '../../../utils/errors.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { resolveTeamId } from '../../../utils/resolvers.js';
import {
  CREATED_PROJECT_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  getProjectSlugMap,
  getUserMetadata,
  getUserStatusLabel,
  PROJECT_CHANGES_SCHEMA,
  PROJECT_SCHEMA,
  PROJECT_WRITE_RESULT_SCHEMA,
  registerNewProject,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  tryResolveShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { fetchWorkspaceDataForRegistry } from '../shared/registry-init.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import { autoLinkWithRegistry } from './shared/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw project data from Linear API for TOON processing.
 */
interface RawProjectData {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  state?: string;
  priority?: number;
  progress?: number;
  leadId?: string;
  lead?: { id?: string; name?: string } | null;
  teams?: Array<{ key?: string }>;
  startDate?: string | null;
  targetDate?: string | null;
  health?: string | null;
  createdAt?: Date | string;
}

/**
 * Convert a project to TOON row format.
 */
function projectToToonRow(
  project: RawProjectData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  // Get short keys from registry
  const projectKey = registry
    ? tryGetShortKey(registry, 'project', project.id)
    : undefined;
  const leadId = project.leadId ?? project.lead?.id;
  let leadKey =
    registry && leadId ? tryGetShortKey(registry, 'user', leadId) : undefined;
  if (!leadKey && leadId && fallbackUserMap) {
    leadKey = fallbackUserMap.get(leadId);
  }

  // Format teams as comma-separated keys
  // SDK doesn't eagerly load teams, so fall back to registry metadata
  let teamsStr = (project.teams ?? [])
    .map((t) => t.key)
    .filter(Boolean)
    .join(',');
  if (!teamsStr && registry) {
    const meta = registry.projectMetadata.get(project.id);
    if (meta?.teamKeys?.length) {
      teamsStr = meta.teamKeys.join(',');
    }
  }

  return {
    key: projectKey ?? '',
    name: project.name ?? '',
    icon: project.icon ?? null,
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
 * Creates ext entries for users not in the registry (e.g., departed leads).
 *
 * @returns section for TOON output, plus fallbackMap (uuid -> ext key) for
 *          unregistered users so projectToToonRow can resolve them.
 */
function buildProjectLeadLookup(
  registry: ShortKeyRegistry,
  projects: RawProjectData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  // Collect unique lead IDs from projects
  const userIds = new Set<string>();
  for (const project of projects) {
    const leadId = project.leadId ?? project.lead?.id;
    if (leadId) {
      userIds.add(leadId);
    }
  }

  // Build a name lookup from project lead data
  const leadNameMap = new Map<string, string>();
  for (const project of projects) {
    const leadId = project.leadId ?? project.lead?.id;
    const leadName = project.lead?.name;
    if (leadId && leadName) {
      leadNameMap.set(leadId, leadName);
    }
  }

  // Build lookup items
  const items: ToonRow[] = [];
  const fallbackMap = new Map<string, string>();
  let extCounter = 0;

  for (const uuid of userIds) {
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
      const meta = getUserMetadata(registry, uuid);
      const name = leadNameMap.get(uuid) ?? meta?.name ?? 'Former User';
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

  // Sort: u* keys before ext* keys, then by number
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
 * Build TOON response for list_projects.
 */
function buildProjectsToonResponse(
  projects: RawProjectData[],
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Build lookup sections (Tier 2 - only project leads)
  const lookups: ToonSection[] = [];

  // Add user lookup if we have a registry and projects with leads
  let fallbackMap: Map<string, string> | undefined;
  if (registry) {
    const userResult = buildProjectLeadLookup(registry, projects);
    fallbackMap = userResult.fallbackMap;
    if (userResult.section.items.length > 0) {
      lookups.push(userResult.section);
    }
  }

  // Convert projects to TOON rows
  const projectRows = projects.map((project) =>
    projectToToonRow(project, registry, fallbackMap),
  );

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
  team: z
    .string()
    .optional()
    .describe(
      'Team key (e.g., "SQM") or UUID. Filters to projects accessible by this team. Overrides DEFAULT_TEAM.',
    ),
  project: z
    .string()
    .optional()
    .describe(
      'Project short key (pr0, pr1...) or UUID. Fetches a single project directly, bypassing team filter. Use for cross-team lookups.',
    ),
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
        "{ accessibleTeams: { id: { eq: 'TEAM_UUID' } } }, " +
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
    let first = args.limit ?? 20;
    const after = args.cursor;
    let filter = args.filter as Record<string, unknown> | undefined;
    let includeArchived = args.includeArchived;

    // ─── Direct project lookup (bypasses team filtering) ───────────────
    let earlyRegistry: ShortKeyRegistry | null = null;
    if (args.project) {
      // Conflict: project param doesn't combine with team/filter
      if (args.team || filter) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: "Cannot specify 'project' with 'team' or 'filter'. Project lookup fetches a single project directly.",
            },
          ],
        };
      }

      // Initialize registry early for short key resolution
      try {
        earlyRegistry = await getOrInitRegistry(
          { sessionId: context.sessionId, transport: 'stdio' },
          () => fetchWorkspaceDataForRegistry(client),
        );
      } catch (error) {
        console.error('Registry initialization failed:', error);
      }

      // Resolve project short key (pr0, pr1...) to UUID
      let resolvedProjectId = args.project;
      if (/^pr\d+$/.test(args.project)) {
        if (!earlyRegistry) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Cannot resolve project key '${args.project}' — registry not available. Call workspace_metadata first.`,
              },
            ],
          };
        }
        const uuid = tryResolveShortKey(earlyRegistry, 'project', args.project);
        if (!uuid) {
          return {
            content: [
              {
                type: 'text',
                text: `Unknown project key '${args.project}'. Call workspace_metadata to see available project keys.`,
              },
            ],
            isError: true,
          };
        }
        resolvedProjectId = uuid;
      }

      // Direct lookup: bypass team filter, auto-include archived, single result
      filter = { id: { eq: resolvedProjectId } };
      first = 1;
      includeArchived = true;
    }

    // ─── Team filtering (only when NOT doing direct project lookup) ────
    if (!args.project) {
      // Conflict: team param + filter.accessibleTeams
      if (args.team && filter?.accessibleTeams) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: "Cannot specify both 'team' and 'filter.accessibleTeams'. Use one or the other.",
            },
          ],
        };
      }

      // Resolve team param to UUID
      let resolvedTeamId: string | undefined;
      if (args.team) {
        const teamResult = await resolveTeamId(client, args.team);
        if (!teamResult.success) {
          return {
            isError: true,
            content: [{ type: 'text', text: teamResult.error }],
          };
        }
        resolvedTeamId = teamResult.value;
      }

      // Resolve team key in filter.accessibleTeams if present (user may pass key instead of UUID)
      if (
        !resolvedTeamId &&
        filter?.accessibleTeams &&
        typeof (filter.accessibleTeams as Record<string, unknown>)?.id === 'object'
      ) {
        const accessibleTeams = filter.accessibleTeams as Record<string, unknown>;
        const idFilter = accessibleTeams.id as Record<string, unknown> | undefined;
        if (idFilter?.eq && typeof idFilter.eq === 'string') {
          const teamValue = idFilter.eq as string;
          if (!teamValue.includes('-') && teamValue.length <= 20) {
            const resolved = await resolveTeamId(client, teamValue);
            if (resolved.success) {
              filter = {
                ...filter,
                accessibleTeams: {
                  ...accessibleTeams,
                  id: { ...idFilter, eq: resolved.value },
                },
              };
            }
          }
        }
      }

      // Apply team filter from resolved team param
      if (resolvedTeamId) {
        filter = { ...filter, accessibleTeams: { id: { eq: resolvedTeamId } } };
      } else if (!filter?.accessibleTeams && config.DEFAULT_TEAM) {
        // Fall back to DEFAULT_TEAM if no team specified
        const resolved = await resolveTeamId(client, config.DEFAULT_TEAM);
        if (resolved.success) {
          filter = { ...filter, accessibleTeams: { id: { eq: resolved.value } } };
        }
      }
    }

    let rawProjects: RawProjectData[];

    try {
      const conn = await client.projects({
        first,
        after: args.project ? undefined : after,
        filter: filter as Record<string, unknown> | undefined,
        includeArchived,
      });

      const pageInfo = conn.pageInfo;
      const _hasMore = pageInfo?.hasNextPage ?? false;
      const _nextCursor = _hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

      // Convert items to RawProjectData for TOON processing
      rawProjects = conn.nodes.map((p) => ({
        id: p.id,
        name: p.name,
        icon: (p as unknown as { icon?: string }).icon,
        description: (p as unknown as { description?: string }).description,
        state: p.state,
        priority: (p as unknown as { priority?: number }).priority,
        progress: (p as unknown as { progress?: number }).progress,
        leadId: (p as unknown as { leadId?: string }).leadId,
        lead: (p as unknown as { lead?: { id?: string; name?: string } }).lead,
        teams: (
          p as unknown as {
            teams?: { nodes?: Array<{ key?: string }> };
          }
        ).teams?.nodes,
        startDate: (p as unknown as { startDate?: string }).startDate,
        targetDate: (p as unknown as { targetDate?: string }).targetDate,
        health: (p as unknown as { health?: string }).health,
        createdAt: (p as unknown as { createdAt?: Date | string }).createdAt,
      }));
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

    // Initialize registry if needed (lazy init — may already exist from project lookup)
    let registry: ShortKeyRegistry | null = earlyRegistry;
    if (!registry) {
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
    }

    // Build TOON response
    const toonResponse = buildProjectsToonResponse(rawProjects, registry);

    // Encode TOON output
    const projectSlugMap = registry ? getProjectSlugMap(registry) : undefined;
    const toonOutput = encodeResponse(rawProjects, toonResponse, { projectSlugMap });

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
          .describe(
            'Team UUID or key (e.g., "SQT") to associate. For single-team projects.',
          ),
        teamIds: z
          .array(z.string())
          .optional()
          .describe(
            'Team UUIDs or keys (e.g., ["SQT", "SQM"]) to associate. For multi-team projects. Alternative to teamId.',
          ),
        leadId: z
          .string()
          .optional()
          .describe('Lead user UUID or short key (u0, u1...).'),
        lead: z.string().optional().describe('Lead user short key (u0, u1...).'),
        targetDate: z.string().optional().describe('Target date (YYYY-MM-DD).'),
        icon: z
          .string()
          .optional()
          .describe('Project icon as a colon-wrapped shortcode (e.g. ":rocket:", ":art:"). Raw emoji not accepted.'),
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
      icon?: string;
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

        // Resolve team(s) from key or UUID (with batch-level caching)
        // Supports both teamId (single, backward compat) and teamIds (multiple)
        const resolvedTeamIds: string[] = [];

        if (it.teamId && it.teamIds && it.teamIds.length > 0) {
          results.push({
            input: { name: it.name, teamId: it.teamId },
            success: false,
            error: {
              code: 'CONFLICTING_PARAMS',
              message:
                "Cannot specify both 'teamId' and 'teamIds'. Use one or the other.",
              suggestions: [],
            },
            index: i,
            ok: false,
          });
          continue;
        }

        const teamInputs = it.teamIds ?? (it.teamId ? [it.teamId] : []);
        for (const teamInput of teamInputs) {
          const cacheKey = teamInput.toLowerCase();
          let resolvedTeamId = teamKeyCache.get(cacheKey);

          if (!resolvedTeamId) {
            const teamResult = await resolveTeamId(client, teamInput);
            if (!teamResult.success) {
              results.push({
                input: { name: it.name, teamId: teamInput },
                success: false,
                error: {
                  code: 'TEAM_RESOLUTION_FAILED',
                  message: teamResult.error,
                  suggestions: teamResult.suggestions ?? [],
                },
                index: i,
                ok: false,
              });
              break;
            }
            resolvedTeamId = teamResult.value;
            teamKeyCache.set(cacheKey, resolvedTeamId);
          }
          resolvedTeamIds.push(resolvedTeamId);
        }

        // Skip if team resolution failed (error already pushed above)
        if (teamInputs.length > 0 && resolvedTeamIds.length !== teamInputs.length) {
          continue;
        }

        const call = () =>
          client.createProject({
            name: it.name,
            description: it.description
              ? autoLinkWithRegistry(it.description, registry)
              : it.description,
            content: it.content
              ? autoLinkWithRegistry(it.content, registry)
              : it.content,
            leadId: resolvedLeadId,
            targetDate: it.targetDate,
            teamIds: resolvedTeamIds,
            icon: it.icon,
          });

        const payload = await withRetry(
          () => (args.items.length > 1 ? gate(call) : call()),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        // Must await project relation as Linear SDK uses lazy-loading (returns Promise)
        const project = (await payload.project) as {
          id?: string;
          state?: string;
          icon?: string;
        } | null;

        // Register new project and get short key for TOON output
        let projectKey: string | undefined;
        if (registry && project?.id) {
          projectKey = registerNewProject(registry, project.id, {
            name: it.name,
            icon: project?.icon,
            state: project.state ?? 'planned',
          });
        }

        results.push({
          input: { name: it.name, teamId: it.teamId },
          success: payload.success ?? true,
          id: project?.id,
          projectKey,
          name: it.name,
          icon: project?.icon,
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
        icon: r.icon ?? '',
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
          .describe(
            'New full markdown content for the project (longer description area).',
          ),
        leadId: z
          .string()
          .optional()
          .describe('New lead user UUID or short key (u0, u1...).'),
        lead: z.string().optional().describe('New lead user short key (u0, u1...).'),
        teamIds: z
          .array(z.string())
          .optional()
          .describe(
            'Replace team associations. Team UUIDs or keys (e.g., ["SQT", "SQM"]). Sets all teams for this project.',
          ),
        targetDate: z.string().optional().describe('New target date (YYYY-MM-DD).'),
        icon: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Project icon as a colon-wrapped shortcode (e.g. ":rocket:", ":art:"). Set to null to clear. Raw emoji not accepted.',
          ),
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

        // Resolve teamIds if provided
        let resolvedTeamIds: string[] | undefined;
        if (it.teamIds && it.teamIds.length > 0) {
          resolvedTeamIds = [];
          let teamResolutionFailed = false;
          for (const teamInput of it.teamIds) {
            const teamResult = await resolveTeamId(client, teamInput);
            if (!teamResult.success) {
              results.push({
                input: { id: it.id, name: it.name, state: it.state },
                success: false,
                error: {
                  code: 'TEAM_RESOLUTION_FAILED',
                  message: teamResult.error,
                  suggestions: teamResult.suggestions ?? [],
                },
                index: i,
                ok: false,
              });
              teamResolutionFailed = true;
              break;
            }
            resolvedTeamIds.push(teamResult.value);
          }
          if (teamResolutionFailed) continue;
        }

        // Capture BEFORE snapshot for diff
        const beforeSnapshot = await gate(() =>
          captureProjectSnapshot(client, resolvedProjectId),
        );

        const updatePayload: Record<string, unknown> = {};
        if (it.name) updatePayload.name = it.name;
        if (it.description)
          updatePayload.description = autoLinkWithRegistry(it.description, registry);
        if (it.content)
          updatePayload.content = autoLinkWithRegistry(it.content, registry);
        if (resolvedLeadId) updatePayload.leadId = resolvedLeadId;
        if (it.targetDate) updatePayload.targetDate = it.targetDate;
        if (it.icon !== undefined) updatePayload.icon = it.icon;
        if (it.state) updatePayload.state = it.state;
        if (resolvedTeamIds) updatePayload.teamIds = resolvedTeamIds;

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
                ? (tryGetShortKey(registry, 'user', beforeSnapshot.leadId) ??
                  getUserStatusLabel(registry, beforeSnapshot.leadId))
                : beforeSnapshot.leadId;
            const afterLeadKey =
              registry && afterSnapshot.leadId
                ? (tryGetShortKey(registry, 'user', afterSnapshot.leadId) ??
                  getUserStatusLabel(registry, afterSnapshot.leadId))
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
