/**
 * Document tools - list, create, and update Linear documents.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with document authors in _users lookup
 *
 * Primary use case: sprint summary documents inside cycles.
 * Documents can also be associated with projects and teams.
 *
 * NOTE: The Linear SDK (v55.2.1) does not include `cycleId` in DocumentCreateInput
 * TypeScript types, but the live GraphQL API accepts it. We use type casts to bypass
 * the SDK's TypeScript constraints. The SDK sends input as a GraphQL variable using
 * the named type, so extra fields pass through to the API at runtime.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { createErrorFromException, formatErrorMessage } from '../../../utils/errors.js';
import { delay, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import {
  type CycleSelector,
  normalizeCycleSelector,
  resolveCycleNumberToId,
  resolveCycleSelector,
  resolveTeamId,
} from '../../../utils/resolvers.js';
import {
  CREATED_DOCUMENT_SCHEMA,
  DOCUMENT_SCHEMA,
  DOCUMENT_WRITE_RESULT_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  getProjectSlugMap,
  getStoredRegistry,
  getUserMetadata,
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
 * Raw document data from Linear API for TOON processing.
 */
interface RawDocumentData {
  id: string;
  title: string;
  content?: string | null;
  createdAt: string | Date;
  updatedAt?: string | Date | null;
  url?: string | null;
  creator?: { id: string; name?: string } | null;
  updatedBy?: { id: string; name?: string } | null;
  project?: { id: string; name?: string } | null;
  cycle?: { id: string; number?: number } | null;
  team?: { id: string; key?: string } | null;
}

/**
 * Convert a document to TOON row format.
 * @param fallbackUserMap - Map of user UUID to ad-hoc key for users not in registry
 */
function documentToToonRow(
  doc: RawDocumentData,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  // Resolve creator short key
  let creatorKey: string | undefined;
  if (doc.creator?.id) {
    if (registry) {
      creatorKey = tryGetShortKey(registry, 'user', doc.creator.id);
    }
    if (!creatorKey && fallbackUserMap) {
      creatorKey = fallbackUserMap.get(doc.creator.id);
    }
  }

  // Resolve updatedBy short key
  let updatedByKey: string | undefined;
  if (doc.updatedBy?.id) {
    if (registry) {
      updatedByKey = tryGetShortKey(registry, 'user', doc.updatedBy.id);
    }
    if (!updatedByKey && fallbackUserMap) {
      updatedByKey = fallbackUserMap.get(doc.updatedBy.id);
    }
  }

  // Get project short key
  const projectKey =
    registry && doc.project?.id
      ? tryGetShortKey(registry, 'project', doc.project.id)
      : undefined;

  const createdAt =
    doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt;

  const updatedAt =
    doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt ?? '');

  return {
    id: doc.id,
    title: doc.title ?? '',
    cycle: doc.cycle?.number ?? '',
    project: projectKey ?? '',
    team: doc.team?.key ?? '',
    creator: creatorKey ?? '',
    updatedBy: updatedByKey ?? '',
    createdAt,
    updatedAt,
    url: doc.url ?? '',
    content: doc.content ?? '',
  };
}

/**
 * Build user lookup table with only document authors (Tier 2).
 * Also returns a fallback map for users not in the registry (external/deactivated users).
 */
function buildDocumentAuthorLookup(
  registry: ShortKeyRegistry,
  documents: RawDocumentData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  // Collect unique user IDs from documents and build userId -> userName map
  const userIds = new Set<string>();
  const userIdToName = new Map<string, string>();
  for (const doc of documents) {
    if (doc.creator?.id) {
      userIds.add(doc.creator.id);
      if (doc.creator.name) {
        userIdToName.set(doc.creator.id, doc.creator.name);
      }
    }
    if (doc.updatedBy?.id) {
      userIds.add(doc.updatedBy.id);
      if (doc.updatedBy.name) {
        userIdToName.set(doc.updatedBy.id, doc.updatedBy.name);
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

      // Add to fallback map for use in documentToToonRow
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
 * Build TOON response for list_documents.
 */
function buildDocumentsToonResponse(
  documents: RawDocumentData[],
  registry: ShortKeyRegistry | null,
  filterLabel: string,
): ToonResponse {
  // Build lookup sections (Tier 2 - only document authors)
  const lookups: ToonSection[] = [];
  let fallbackUserMap: Map<string, string> | undefined;

  // Add user lookup if we have a registry and documents with authors
  if (registry) {
    const { section: userLookup, fallbackMap } = buildDocumentAuthorLookup(
      registry,
      documents,
    );
    fallbackUserMap = fallbackMap;
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  // Convert documents to TOON rows
  const docRows = documents.map((doc) =>
    documentToToonRow(doc, registry, fallbackUserMap),
  );

  // Build data sections
  const data: ToonSection[] = [{ schema: DOCUMENT_SCHEMA, items: docRows }];

  // Build meta section
  const metaFields = ['tool', 'filter', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_documents',
    filter: filterLabel,
    count: documents.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Resolution Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a cycle input (number or selector) to a cycle UUID and team UUID.
 * Returns either { cycleId, teamId, cycleNumber } on success, or { error } on failure.
 */
async function resolveCycleId(
  client: Awaited<ReturnType<typeof getLinearClient>>,
  cycleInput: string | number,
  teamInput?: string,
): Promise<
  { cycleId: string; teamId: string; cycleNumber: number } | { error: ToolResult }
> {
  // 1. Determine team key
  const teamKey = teamInput ?? config.DEFAULT_TEAM;
  let teamId: string;

  if (!teamKey) {
    // No team specified and no DEFAULT_TEAM - fetch teams and use first
    try {
      const teamsConn = await client.teams({ first: 1 });
      const firstTeam = teamsConn.nodes?.[0];
      if (!firstTeam) {
        return {
          error: {
            content: [
              {
                type: 'text',
                text: 'No teams found in workspace. Cannot resolve cycle without a team.',
              },
            ],
            isError: true,
            structuredContent: {
              error: {
                code: 'NO_TEAMS_FOUND',
                message: 'No teams found in workspace',
                suggestions: [
                  'Ensure the workspace has at least one team.',
                  'Set DEFAULT_TEAM environment variable.',
                ],
              },
            },
          },
        };
      }
      teamId = firstTeam.id;
    } catch (e) {
      return {
        error: {
          content: [
            {
              type: 'text',
              text: `Failed to fetch teams: ${(e as Error).message}`,
            },
          ],
          isError: true,
          structuredContent: {
            error: {
              code: 'TEAM_FETCH_ERROR',
              message: (e as Error).message,
              suggestions: ['Check your Linear API token permissions.'],
            },
          },
        },
      };
    }
  } else {
    // Resolve team key to UUID
    const teamResult = await resolveTeamId(client, teamKey);
    if (!teamResult.success) {
      return {
        error: {
          content: [{ type: 'text', text: teamResult.error }],
          isError: true,
          structuredContent: {
            error: {
              code: 'TEAM_RESOLUTION_FAILED',
              message: teamResult.error,
              suggestions: teamResult.suggestions ?? [
                'Use workspace_metadata to see available teams.',
              ],
            },
          },
        },
      };
    }
    teamId = teamResult.value;
  }

  // 2. Resolve cycle input to cycle number, then to UUID
  let cycleNumber: number;

  if (typeof cycleInput === 'number') {
    cycleNumber = cycleInput;
  } else {
    // Try as a named selector first (current, next, previous)
    const selector = normalizeCycleSelector(cycleInput);
    if (selector) {
      const selectorResult = await resolveCycleSelector(
        client,
        teamId,
        selector as CycleSelector,
      );
      if (!selectorResult.success) {
        return {
          error: {
            content: [{ type: 'text', text: selectorResult.error }],
            isError: true,
            structuredContent: {
              error: {
                code: 'CYCLE_RESOLUTION_FAILED',
                message: selectorResult.error,
                suggestions: selectorResult.suggestions ?? [
                  'Use list_cycles to see available cycles.',
                ],
              },
            },
          },
        };
      }
      cycleNumber = selectorResult.value;
    } else {
      // Try parsing as number
      const parsed = parseInt(cycleInput, 10);
      if (Number.isNaN(parsed)) {
        return {
          error: {
            content: [
              {
                type: 'text',
                text: `Invalid cycle input: "${cycleInput}". Use a number or selector ("current", "next", "previous").`,
              },
            ],
            isError: true,
            structuredContent: {
              error: {
                code: 'INVALID_CYCLE_INPUT',
                message: `Invalid cycle input: "${cycleInput}"`,
                suggestions: [
                  'Use a cycle number (e.g., 5) or selector ("current", "next", "previous").',
                ],
              },
            },
          },
        };
      }
      cycleNumber = parsed;
    }
  }

  // 3. Resolve cycle number to UUID
  const cycleResult = await resolveCycleNumberToId(client, teamId, cycleNumber);
  if (!cycleResult.success) {
    return {
      error: {
        content: [{ type: 'text', text: cycleResult.error }],
        isError: true,
        structuredContent: {
          error: {
            code: 'CYCLE_RESOLUTION_FAILED',
            message: cycleResult.error,
            suggestions: cycleResult.suggestions ?? [
              'Use list_cycles to see available cycles.',
            ],
          },
        },
      },
    };
  }

  return { cycleId: cycleResult.value, teamId, cycleNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw GraphQL Query for Cycle Documents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw GraphQL query to fetch documents associated with a cycle.
 * DocumentFilter does NOT have a `cycle` field, so we must query via
 * the cycle's `documents` connection instead of using client.documents().
 */
const CYCLE_DOCUMENTS_QUERY = `
  query GetCycleDocuments($cycleId: String!) {
    cycle(id: $cycleId) {
      id
      number
      documents {
        nodes {
          id
          title
          content
          createdAt
          updatedAt
          url
          creator { id name }
          updatedBy { id name }
          project { id name }
          cycle { id number }
        }
      }
    }
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// List Documents Tool
// ─────────────────────────────────────────────────────────────────────────────

const ListDocumentsInputSchema = z.object({
  cycle: z
    .union([z.enum(['current', 'next', 'previous']), z.number().int().positive()])
    .optional()
    .describe(
      'Cycle selector: "current", "next", "previous", or a specific cycle number.',
    ),
  project: z.string().optional().describe('Project short key (pr0) or UUID.'),
  team: z.string().optional().describe('Team key or UUID (for cycle resolution).'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max results. Default: 20.'),
  cursor: z.string().optional().describe('Pagination cursor.'),
});

export const listDocumentsTool = defineTool({
  name: toolsMetadata.list_documents.name,
  title: toolsMetadata.list_documents.title,
  description: toolsMetadata.list_documents.description,
  inputSchema: ListDocumentsInputSchema,
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

    let rawDocuments: RawDocumentData[];
    let filterLabel: string;

    // ── Cycle-based listing (raw GraphQL) ──
    if (args.cycle !== undefined) {
      const cycleResolution = await resolveCycleId(client, args.cycle, args.team);
      if ('error' in cycleResolution) {
        return cycleResolution.error;
      }

      const { cycleId, cycleNumber } = cycleResolution;
      filterLabel = `cycle=${cycleNumber}`;

      try {
        const resp = await client.client.rawRequest(CYCLE_DOCUMENTS_QUERY, {
          cycleId,
        });

        const cycleData = (
          resp as unknown as {
            data?: {
              cycle?: {
                id: string;
                number: number;
                documents?: {
                  nodes?: Array<{
                    id: string;
                    title: string;
                    content?: string;
                    createdAt: string;
                    updatedAt?: string;
                    url?: string;
                    creator?: { id: string; name?: string };
                    updatedBy?: { id: string; name?: string };
                    project?: { id: string; name?: string };
                    cycle?: { id: string; number?: number };
                  }>;
                };
              };
            };
          }
        ).data?.cycle;

        const nodes = cycleData?.documents?.nodes ?? [];
        rawDocuments = nodes.map((node) => ({
          id: node.id,
          title: node.title,
          content: node.content,
          createdAt: node.createdAt,
          updatedAt: node.updatedAt,
          url: node.url,
          creator: node.creator,
          updatedBy: node.updatedBy,
          project: node.project,
          cycle: node.cycle,
          // team is implied by the cycle, not directly available in this query
          team: undefined,
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

      // ── Project-based listing (SDK filter) ──
    } else if (args.project) {
      // Resolve project short key (pr0, pr1...) to UUID
      let resolvedProjectId = args.project;
      let projectKey = args.project;

      if (registry && /^pr\d+$/.test(args.project)) {
        const uuid = tryResolveShortKey(registry, 'project', args.project);
        if (!uuid) {
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
        projectKey = tryGetShortKey(registry, 'project', args.project) ?? args.project;
      }

      filterLabel = `project=${projectKey}`;

      try {
        const conn = await client.documents({
          first,
          after,
          filter: { project: { id: { eq: resolvedProjectId } } },
        });

        rawDocuments = await Promise.all(
          conn.nodes.map(async (node) => {
            const creator = await (
              node as unknown as {
                creator?: Promise<{ id: string; name?: string } | null>;
              }
            ).creator;
            const updatedBy = await (
              node as unknown as {
                updatedBy?: Promise<{ id: string; name?: string } | null>;
              }
            ).updatedBy;
            const project = await (
              node as unknown as {
                project?: Promise<{ id: string; name?: string } | null>;
              }
            ).project;
            const cycle = await (
              node as unknown as {
                cycle?: Promise<{ id: string; number?: number } | null>;
              }
            ).cycle;

            return {
              id: node.id,
              title: (node as unknown as { title: string }).title,
              content: (node as unknown as { content?: string }).content,
              createdAt: node.createdAt,
              updatedAt: (node as unknown as { updatedAt?: Date | string }).updatedAt,
              url: (node as unknown as { url?: string }).url,
              creator,
              updatedBy,
              project,
              cycle,
            };
          }),
        );
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

      // ── Global listing (no filter) ──
    } else {
      filterLabel = 'all';

      try {
        const conn = await client.documents({ first, after });

        rawDocuments = await Promise.all(
          conn.nodes.map(async (node) => {
            const creator = await (
              node as unknown as {
                creator?: Promise<{ id: string; name?: string } | null>;
              }
            ).creator;
            const updatedBy = await (
              node as unknown as {
                updatedBy?: Promise<{ id: string; name?: string } | null>;
              }
            ).updatedBy;
            const project = await (
              node as unknown as {
                project?: Promise<{ id: string; name?: string } | null>;
              }
            ).project;
            const cycle = await (
              node as unknown as {
                cycle?: Promise<{ id: string; number?: number } | null>;
              }
            ).cycle;

            return {
              id: node.id,
              title: (node as unknown as { title: string }).title,
              content: (node as unknown as { content?: string }).content,
              createdAt: node.createdAt,
              updatedAt: (node as unknown as { updatedAt?: Date | string }).updatedAt,
              url: (node as unknown as { url?: string }).url,
              creator,
              updatedBy,
              project,
              cycle,
            };
          }),
        );
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

    // Build TOON response
    const toonResponse = buildDocumentsToonResponse(
      rawDocuments,
      registry,
      filterLabel,
    );

    // Encode TOON output
    const projectSlugMap = registry ? getProjectSlugMap(registry) : undefined;
    const toonOutput = encodeResponse(rawDocuments, toonResponse, {
      projectSlugMap,
    });

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Document Tool
// ─────────────────────────────────────────────────────────────────────────────

const CreateDocumentInputSchema = z.object({
  title: z.string().describe('Document title. Required.'),
  content: z.string().optional().describe('Document content in markdown.'),
  cycle: z
    .union([z.enum(['current', 'next', 'previous']), z.number().int().positive()])
    .optional()
    .describe('Cycle to associate with.'),
  project: z.string().optional().describe('Project short key (pr0) or UUID.'),
  team: z.string().optional().describe('Team key or UUID (for cycle resolution).'),
});

export const createDocumentTool = defineTool({
  name: toolsMetadata.create_document.name,
  title: toolsMetadata.create_document.title,
  description: toolsMetadata.create_document.description,
  inputSchema: CreateDocumentInputSchema,
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
    let resolvedProjectId: string | undefined;
    let projectKey = '';

    if (args.project) {
      if (registry && /^pr\d+$/.test(args.project)) {
        const uuid = tryResolveShortKey(registry, 'project', args.project);
        if (!uuid) {
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
      } else {
        resolvedProjectId = args.project;
        if (registry && !args.project.includes('-')) {
          projectKey =
            tryGetShortKey(registry, 'project', args.project) ?? args.project;
        } else {
          projectKey = args.project;
        }
      }
    }

    // Resolve cycle to UUID if provided
    let cycleId: string | undefined;
    let cycleNumber: number | undefined;

    if (args.cycle !== undefined) {
      const cycleResolution = await resolveCycleId(client, args.cycle, args.team);
      if ('error' in cycleResolution) {
        return cycleResolution.error;
      }
      cycleId = cycleResolution.cycleId;
      cycleNumber = cycleResolution.cycleNumber;
    }

    try {
      // Build create input
      // NOTE: cycleId is not in the SDK's DocumentCreateInput TypeScript types
      // (v55.2.1), but the live GraphQL API accepts it. The SDK sends input as
      // a GraphQL variable using the named type, so extra fields pass through
      // to the API at runtime. We use `as any` to bypass the SDK constraint.
      const createInput: Record<string, unknown> = {
        title: args.title,
      };

      if (args.content) {
        createInput.content = autoLinkWithRegistry(args.content, registry);
      }

      if (resolvedProjectId) {
        createInput.projectId = resolvedProjectId;
      }

      if (cycleId) {
        createInput.cycleId = cycleId;
      }

      // NOTE: `as any` required because cycleId is not in SDK's DocumentCreateInput
      // TypeScript types (v55.2.1), but the live GraphQL API accepts it.
      const payload = await withRetry(() => client.createDocument(createInput as any), {
        maxRetries: 3,
        baseDelayMs: 500,
      });

      // Must await document relation as Linear SDK uses lazy-loading
      const document = (await payload.document) as {
        id?: string;
        title?: string;
        url?: string;
      } | null;

      // Build TOON response for created document
      const createdDoc: ToonRow = {
        id: document?.id ?? '',
        title: args.title,
        cycle: cycleNumber ?? '',
        project: projectKey,
        url: document?.url ?? '',
      };

      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'project'],
          values: {
            action: 'create_document',
            succeeded: 1,
            project: projectKey,
          },
        },
        data: [{ schema: CREATED_DOCUMENT_SCHEMA, items: [createdDoc] }],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
      };
    } catch (error) {
      await logger.error('create_document', {
        message: 'Failed to create document',
        title: args.title,
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Failed to create document: ${(error as Error).message}`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify the project and/or cycle exist.',
              'Check that you have permission to create documents.',
            ],
          },
        },
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Document Tool
// ─────────────────────────────────────────────────────────────────────────────

const UpdateDocumentInputSchema = z.object({
  id: z.string().describe('Document UUID. Required.'),
  title: z.string().optional().describe('New document title.'),
  content: z.string().optional().describe('New document content in markdown.'),
});

export const updateDocumentTool = defineTool({
  name: toolsMetadata.update_document.name,
  title: toolsMetadata.update_document.title,
  description: toolsMetadata.update_document.description,
  inputSchema: UpdateDocumentInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);

    // Get registry for auto-linking (graceful degradation if not available)
    const registry = getStoredRegistry(context.sessionId);

    // Validate that at least one field is being updated
    // IMPORTANT: Use === undefined, not truthiness check, so content: "" is valid
    if (args.title === undefined && args.content === undefined) {
      return {
        content: [
          {
            type: 'text',
            text: 'No fields to update. Provide at least one of: title, content.',
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'NO_FIELDS_TO_UPDATE',
            message: 'No fields to update',
            suggestions: ['Provide at least one of: title, content'],
          },
        },
      };
    }

    try {
      // Build update payload
      const updatePayload: Record<string, unknown> = {};
      if (args.title !== undefined) updatePayload.title = args.title;
      if (args.content !== undefined)
        updatePayload.content = autoLinkWithRegistry(args.content, registry);

      // Add small delay to avoid rate limits
      await delay(100);

      // Update the document
      const payload = await withRetry(
        () => client.updateDocument(args.id, updatePayload),
        { maxRetries: 3, baseDelayMs: 500 },
      );

      // Must await document relation as Linear SDK uses lazy-loading
      await payload.document;

      // Build TOON result
      const result: ToonRow = {
        index: 0,
        status: 'ok',
        id: args.id,
        error: '',
        code: '',
        hint: '',
      };

      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'failed', 'total'],
          values: {
            action: 'update_document',
            succeeded: 1,
            failed: 0,
            total: 1,
          },
        },
        data: [{ schema: DOCUMENT_WRITE_RESULT_SCHEMA, items: [result] }],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
      };
    } catch (error) {
      await logger.error('update_document', {
        message: 'Failed to update document',
        id: args.id,
        error: (error as Error).message,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Failed to update document: ${(error as Error).message}`,
          },
        ],
        isError: true,
        structuredContent: {
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: [
              'Verify the document ID exists with list_documents.',
              'Check that you have permission to modify this document.',
            ],
          },
        },
      };
    }
  },
});
