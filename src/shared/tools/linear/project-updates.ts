/**
 * Project Updates tools - list, create, and update project status updates.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with update authors in _users lookup
 *
 * Project updates use project short keys (pr0, pr1...) for project reference.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { createErrorFromException, formatErrorMessage } from '../../../utils/errors.js';
import { delay, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { fetchWorkspaceDataForRegistry } from '../shared/registry-init.js';
import { autoLinkWithRegistry } from './shared/index.js';
import {
  CREATED_PROJECT_UPDATE_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  getStoredRegistry,
  getUserMetadata,
  PROJECT_UPDATE_SCHEMA,
  PROJECT_UPDATE_WRITE_RESULT_SCHEMA,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  tryResolveShortKey,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw project update data from Linear API for TOON processing.
 */
interface RawProjectUpdateData {
  id: string;
  body: string;
  health?: string | null;
  createdAt: string | Date;
  url?: string | null;
  user?: { id: string; name?: string } | null;
  project?: { id: string; name?: string } | null;
}

/**
 * Convert a project update to TOON row format.
 * @param fallbackUserMap - Map of user UUID to ad-hoc key for users not in registry
 */
function projectUpdateToToonRow(
  update: RawProjectUpdateData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  let userKey: string | undefined;

  if (update.user?.id) {
    // First, try to get short key from registry
    if (registry) {
      userKey = tryGetShortKey(registry, 'user', update.user.id);
    }
    // If not found in registry, check fallback map (external/deactivated users)
    if (!userKey && fallbackUserMap) {
      userKey = fallbackUserMap.get(update.user.id);
    }
  }

  // Get project short key
  const projectKey =
    registry && update.project?.id
      ? tryGetShortKey(registry, 'project', update.project.id)
      : undefined;

  const createdAt =
    update.createdAt instanceof Date
      ? update.createdAt.toISOString()
      : update.createdAt;

  return {
    id: update.id,
    project: projectKey ?? '',
    body: update.body ?? '',
    health: update.health ?? '',
    user: userKey ?? '',
    createdAt,
    url: update.url ?? '',
  };
}

/**
 * Build user lookup table with only update authors (Tier 2).
 * Also returns a fallback map for users not in the registry (external/deactivated users).
 */
function buildUpdateAuthorLookup(
  registry: ShortKeyRegistry,
  updates: RawProjectUpdateData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  // Collect unique user IDs from updates and build userId -> userName map
  const userIds = new Set<string>();
  const userIdToName = new Map<string, string>();
  for (const update of updates) {
    if (update.user?.id) {
      userIds.add(update.user.id);
      if (update.user.name) {
        userIdToName.set(update.user.id, update.user.name);
      }
    }
  }

  // Build lookup items - single pass over userIds using usersByUuid
  const items: ToonRow[] = [];
  const fallbackMap = new Map<string, string>();
  let extIndex = 0;
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
      const userName = userIdToName.get(uuid) ?? 'Unknown User';
      const adHocKey = `ext${extIndex}`;
      extIndex++;

      // Add to lookup items
      items.push({
        key: adHocKey,
        name: userName,
        displayName: '',
        email: '',
        role: '(external)', // Mark as external user
        teams: '',
      });

      // Add to fallback map for use in projectUpdateToToonRow
      fallbackMap.set(uuid, adHocKey);
    }
  }

  // Sort by key for consistent output (registry users first, then external)
  items.sort((a, b) => {
    const keyA = String(a.key);
    const keyB = String(b.key);
    // Registry users (u0, u1...) come before external users (ext0, ext1...)
    const isExtA = keyA.startsWith('ext');
    const isExtB = keyB.startsWith('ext');
    if (isExtA !== isExtB) {
      return isExtA ? 1 : -1;
    }
    // Within same type, sort by number
    const numA = parseInt(keyA.replace(/^(u|ext)/, ''), 10);
    const numB = parseInt(keyB.replace(/^(u|ext)/, ''), 10);
    return numA - numB;
  });

  return { section: { schema: USER_LOOKUP_SCHEMA, items }, fallbackMap };
}

/**
 * Build TOON response for list_project_updates.
 */
function buildProjectUpdatesToonResponse(
  updates: RawProjectUpdateData[],
  projectKey: string,
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Build lookup sections (Tier 2 - only update authors)
  const lookups: ToonSection[] = [];
  let fallbackUserMap: Map<string, string> | undefined;

  // Add user lookup if we have a registry and updates with authors
  if (registry) {
    const { section: userLookup, fallbackMap } = buildUpdateAuthorLookup(
      registry,
      updates,
    );
    fallbackUserMap = fallbackMap;
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  // Convert updates to TOON rows
  const updateRows = updates.map((update) =>
    projectUpdateToToonRow(update, registry, fallbackUserMap),
  );

  // Build data sections
  const data: ToonSection[] = [{ schema: PROJECT_UPDATE_SCHEMA, items: updateRows }];

  // Build meta section
  const metaFields = ['tool', 'project', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_project_updates',
    project: projectKey,
    count: updates.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// List Project Updates Tool
// ─────────────────────────────────────────────────────────────────────────────

const ListProjectUpdatesInputSchema = z.object({
  project: z.string().describe('Project short key (pr0) or UUID. Required.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 20.'),
  cursor: z.string().optional().describe('Pagination cursor.'),
});

export const listProjectUpdatesTool = defineTool({
  name: toolsMetadata.list_project_updates.name,
  title: toolsMetadata.list_project_updates.title,
  description: toolsMetadata.list_project_updates.description,
  inputSchema: ListProjectUpdatesInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const first = args.limit ?? 20;
    const after = args.cursor;

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

    // Resolve project short key (pr0, pr1...) to UUID
    let resolvedProjectId = args.project;
    let projectKey = args.project;

    if (registry && /^pr\d+$/.test(args.project)) {
      const uuid = tryResolveShortKey(registry, 'project', args.project);
      if (!uuid) {
        // Return structured error - DON'T pass invalid key to API
        return {
          content: [
            {
              type: 'text',
              text: `Unknown project key '${args.project}'. Call workspace_metadata to see available project keys.`,
            },
          ],
          isError: true,
          structuredContent: {
            error: {
              code: 'PROJECT_RESOLUTION_FAILED',
              message: `Unknown project key '${args.project}'`,
              suggestions: [
                'Call workspace_metadata to see available project keys (pr0, pr1, ...)',
              ],
            },
          },
        };
      }
      resolvedProjectId = uuid;
      projectKey = args.project;
    } else if (registry && !args.project.includes('-')) {
      // Not a short key pattern but not a UUID either - try to get project key if it's a UUID
      projectKey = tryGetShortKey(registry, 'project', args.project) ?? args.project;
    }

    // Fetch project updates using filter
    let rawUpdates: RawProjectUpdateData[];

    try {
      const conn = await client.projectUpdates({
        first,
        after,
        filter: { project: { id: { eq: resolvedProjectId } } },
      });

      // Convert to raw data for processing
      rawUpdates = await Promise.all(
        conn.nodes.map(async (update) => {
          const user = await (
            update as unknown as {
              user?: Promise<{ id: string; name?: string } | null>;
            }
          ).user;
          const project = await (
            update as unknown as {
              project?: Promise<{ id: string; name?: string } | null>;
            }
          ).project;

          return {
            id: update.id,
            body: (update as unknown as { body?: string }).body ?? '',
            health: (update as unknown as { health?: string }).health,
            createdAt: update.createdAt,
            url: (update as unknown as { url?: string }).url,
            user,
            project,
          };
        }),
      );

      const pageInfo = conn.pageInfo;
      const hasMore = pageInfo?.hasNextPage ?? false;
      const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;
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

    // Build TOON response
    const toonResponse = buildProjectUpdatesToonResponse(
      rawUpdates,
      projectKey,
      registry,
    );

    // Encode TOON output
    const toonOutput = encodeResponse(rawUpdates, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Project Update Tool
// ─────────────────────────────────────────────────────────────────────────────

const CreateProjectUpdateInputSchema = z.object({
  project: z.string().describe('Project short key (pr0) or UUID. Required.'),
  body: z.string().describe('Update content in markdown. Required.'),
  health: z
    .enum(['onTrack', 'atRisk', 'offTrack'])
    .optional()
    .describe('Project health status. Default: onTrack.'),
});

export const createProjectUpdateTool = defineTool({
  name: toolsMetadata.create_project_update.name,
  title: toolsMetadata.create_project_update.title,
  description: toolsMetadata.create_project_update.description,
  inputSchema: CreateProjectUpdateInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);

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

    // Resolve project short key (pr0, pr1...) to UUID
    let resolvedProjectId = args.project;
    let projectKey = args.project;

    if (registry && /^pr\d+$/.test(args.project)) {
      const uuid = tryResolveShortKey(registry, 'project', args.project);
      if (!uuid) {
        // Return structured error - DON'T pass invalid key to API
        return {
          content: [
            {
              type: 'text',
              text: `Unknown project key '${args.project}'. Call workspace_metadata to see available project keys.`,
            },
          ],
          isError: true,
          structuredContent: {
            error: {
              code: 'PROJECT_RESOLUTION_FAILED',
              message: `Unknown project key '${args.project}'`,
              suggestions: [
                'Call workspace_metadata to see available project keys (pr0, pr1, ...)',
              ],
            },
          },
        };
      }
      resolvedProjectId = uuid;
      projectKey = args.project;
    } else if (registry && !args.project.includes('-')) {
      // Not a short key pattern but not a UUID either - try to get project key if it's a UUID
      projectKey = tryGetShortKey(registry, 'project', args.project) ?? args.project;
    }

    try {
      // Create the project update
      // Cast health to expected Linear SDK type (string values match enum values)
      const payload = await withRetry(
        () =>
          client.createProjectUpdate({
            projectId: resolvedProjectId,
            body: autoLinkWithRegistry(args.body, registry),
            health: args.health as 'onTrack' | 'atRisk' | 'offTrack' | undefined,
          } as Parameters<typeof client.createProjectUpdate>[0]),
        { maxRetries: 3, baseDelayMs: 500 },
      );

      // Must await projectUpdate relation as Linear SDK uses lazy-loading
      const projectUpdate = (await payload.projectUpdate) as {
        id?: string;
        url?: string;
        health?: string;
        createdAt?: Date | string;
      } | null;

      // Build TOON response for created update
      const createdUpdate: ToonRow = {
        id: projectUpdate?.id ?? '',
        project: projectKey,
        body: args.body.slice(0, 100) + (args.body.length > 100 ? '...' : ''),
        health: args.health ?? 'onTrack',
        url: projectUpdate?.url ?? '',
      };

      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'project'],
          values: {
            action: 'create_project_update',
            succeeded: 1,
            project: projectKey,
          },
        },
        data: [{ schema: CREATED_PROJECT_UPDATE_SCHEMA, items: [createdUpdate] }],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
      };
    } catch (error) {
      await logger.error('create_project_update', {
        message: 'Failed to create project update',
        project: args.project,
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Failed to create project update: ${(error as Error).message}`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify the project exists with list_projects.',
              'Check that you have permission to create updates for this project.',
            ],
          },
        },
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Project Update Tool
// ─────────────────────────────────────────────────────────────────────────────

const UpdateProjectUpdateInputSchema = z.object({
  id: z.string().describe('Project update UUID. Required.'),
  body: z.string().optional().describe('New markdown content.'),
  health: z
    .enum(['onTrack', 'atRisk', 'offTrack'])
    .optional()
    .describe('New health status.'),
});

export const updateProjectUpdateTool = defineTool({
  name: toolsMetadata.update_project_update.name,
  title: toolsMetadata.update_project_update.title,
  description: toolsMetadata.update_project_update.description,
  inputSchema: UpdateProjectUpdateInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);

    // Get registry for auto-linking (graceful degradation if not available)
    const registry = getStoredRegistry(context.sessionId);

    // Validate that at least one field is being updated
    if (!args.body && !args.health) {
      return {
        content: [
          {
            type: 'text',
            text: 'No fields to update. Provide at least one of: body, health.',
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'NO_FIELDS_TO_UPDATE',
            message: 'No fields to update',
            suggestions: ['Provide at least one of: body, health'],
          },
        },
      };
    }

    try {
      // Build update payload
      const updatePayload: Record<string, unknown> = {};
      if (args.body) updatePayload.body = autoLinkWithRegistry(args.body, registry);
      if (args.health) updatePayload.health = args.health;

      // Add small delay to avoid rate limits
      await delay(100);

      // Update the project update
      const payload = await withRetry(
        () => client.updateProjectUpdate(args.id, updatePayload),
        { maxRetries: 3, baseDelayMs: 500 },
      );

      // Must await projectUpdate relation as Linear SDK uses lazy-loading
      await payload.projectUpdate;

      // Build TOON result
      const result: ToonRow = {
        index: 0,
        status: 'ok',
        id: args.id,
        project: '', // We don't have project key in update context
        error: '',
        code: '',
        hint: '',
      };

      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'failed', 'total'],
          values: {
            action: 'update_project_update',
            succeeded: 1,
            failed: 0,
            total: 1,
          },
        },
        data: [{ schema: PROJECT_UPDATE_WRITE_RESULT_SCHEMA, items: [result] }],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
      };
    } catch (error) {
      await logger.error('update_project_update', {
        message: 'Failed to update project update',
        id: args.id,
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Failed to update project update: ${(error as Error).message}`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify the update ID exists with list_project_updates.',
              'Check that you have permission to modify this update.',
            ],
          },
        },
      };
    }
  },
});
