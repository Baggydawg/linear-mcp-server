/**
 * Comments tools - list and add comments on issues.
 *
 * Supports TOON output format (Tier 2):
 * - When TOON_OUTPUT_ENABLED=true, returns TOON format with comment authors in _users lookup
 * - When TOON_OUTPUT_ENABLED=false (default), returns legacy human-readable format
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import {
  AddCommentsOutputSchema,
  ListCommentsOutputSchema,
  UpdateCommentsOutputSchema,
} from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import { mapCommentNodeToListItem } from '../../../utils/mappers.js';
import {
  previewLinesFromItems,
  summarizeBatch,
  summarizeList,
} from '../../../utils/messages.js';
import {
  COMMENT_SCHEMA,
  COMMENT_WRITE_RESULT_SCHEMA,
  CREATED_COMMENT_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  type RegistryBuildData,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  USER_LOOKUP_SCHEMA,
  WRITE_RESULT_META_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support (Tier 2 - Referenced Entities Only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw comment data from Linear API for TOON processing.
 */
interface RawCommentData {
  id: string;
  body: string;
  createdAt: string | Date;
  user?: { id: string; name?: string } | null;
}

/**
 * Fetch workspace data for registry initialization with full metadata.
 */
async function fetchWorkspaceDataForRegistry(
  client: Awaited<ReturnType<typeof getLinearClient>>,
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

  // Get workspace ID from viewer
  const viewer = await client.viewer;
  const viewerOrg = viewer as unknown as { organization?: { id?: string } };
  const workspaceId = viewerOrg?.organization?.id ?? 'unknown';

  return { users, states, projects, workspaceId };
}

/**
 * Convert a comment to TOON row format.
 */
function commentToToonRow(
  comment: RawCommentData,
  issueIdentifier: string,
  registry: ShortKeyRegistry | null,
): ToonRow {
  const userKey =
    registry && comment.user?.id
      ? tryGetShortKey(registry, 'user', comment.user.id)
      : undefined;

  const createdAt =
    comment.createdAt instanceof Date
      ? comment.createdAt.toISOString()
      : comment.createdAt;

  return {
    issue: issueIdentifier,
    user: userKey ?? '',
    body: comment.body ?? '',
    createdAt,
  };
}

/**
 * Build user lookup table with only comment authors (Tier 2).
 */
function buildCommentAuthorLookup(
  registry: ShortKeyRegistry,
  comments: RawCommentData[],
): ToonSection {
  // Collect unique user IDs from comments
  const userIds = new Set<string>();
  for (const comment of comments) {
    if (comment.user?.id) {
      userIds.add(comment.user.id);
    }
  }

  // Build lookup items
  const items: ToonRow[] = [];
  for (const [shortKey, uuid] of registry.users) {
    if (userIds.has(uuid)) {
      items.push({
        key: shortKey,
        name: '', // User details not available in registry
        displayName: '',
        email: '',
        role: '',
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
 * Build TOON response for list_comments.
 */
function buildCommentsToonResponse(
  comments: RawCommentData[],
  issueIdentifier: string,
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Build lookup sections (Tier 2 - only comment authors)
  const lookups: ToonSection[] = [];

  // Add user lookup if we have a registry and comments with authors
  if (registry) {
    const userLookup = buildCommentAuthorLookup(registry, comments);
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  // Convert comments to TOON rows
  const commentRows = comments.map((comment) =>
    commentToToonRow(comment, issueIdentifier, registry),
  );

  // Build data sections
  const data: ToonSection[] = [{ schema: COMMENT_SCHEMA, items: commentRows }];

  // Build meta section
  const metaFields = ['tool', 'issue', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_comments',
    issue: issueIdentifier,
    count: comments.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    lookups: lookups.length > 0 ? lookups : undefined,
    data,
  };
}

// List Comments
const ListCommentsInputSchema = z.object({
  issueId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listCommentsTool = defineTool({
  name: toolsMetadata.list_comments.name,
  title: toolsMetadata.list_comments.title,
  description: toolsMetadata.list_comments.description,
  inputSchema: ListCommentsInputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const issue = await client.issue(args.issueId);
    const first = args.limit ?? 20;
    const after = args.cursor;
    const conn = await issue.comments({ first, after });
    const items = await Promise.all(conn.nodes.map((c) => mapCommentNodeToListItem(c)));

    const pageInfo = conn.pageInfo;
    const hasMore = pageInfo?.hasNextPage ?? false;
    const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

    // Get issue identifier for TOON output
    const issueIdentifier =
      (issue as unknown as { identifier?: string }).identifier ?? args.issueId;

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Convert items to RawCommentData for TOON processing
      const rawComments: RawCommentData[] = conn.nodes.map((c) => ({
        id: c.id,
        body: (c as unknown as { body?: string }).body ?? '',
        createdAt: c.createdAt,
        user: (c as unknown as { user?: { id: string; name?: string } }).user ?? null,
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
      const toonResponse = buildCommentsToonResponse(
        rawComments,
        issueIdentifier,
        registry,
      );

      // Encode TOON output
      const toonOutput = encodeResponse(rawComments, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          issue: issueIdentifier,
          count: rawComments.length,
          hasMore,
          nextCursor,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format (when TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────

    // Build query echo
    const query = {
      issueId: args.issueId,
      limit: first,
    };

    // Build pagination
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit: first,
    };

    // Build meta
    const meta = {
      nextSteps: [
        ...(hasMore ? [`Call again with cursor="${nextCursor}" for more.`] : []),
        'Use add_comments to add context or mention teammates.',
        'Use update_comments to edit existing comments.',
      ],
      relatedTools: ['add_comments', 'update_comments', 'get_issues'],
    };

    const structured = ListCommentsOutputSchema.parse({
      query,
      items,
      pagination,
      meta,
      // Legacy
      cursor: args.cursor,
      nextCursor,
      limit: first,
    });

    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (c) => {
        const user = c.user as unknown as { name?: string; id?: string } | undefined;
        const author = user?.name ?? user?.id ?? 'unknown';
        const body = String((c.body as string | undefined) ?? '').slice(0, 80);
        const url = (c.url as string | undefined) ?? undefined;
        const title = url ? `[${author}](${url})` : author;
        return `${title}: ${body}`;
      },
    );

    const message = summarizeList({
      subject: 'Comments',
      count: items.length,
      limit: first,
      nextCursor,
      previewLines: preview,
      nextSteps: meta.nextSteps,
    });

    const parts: Array<{ type: 'text'; text: string }> = [
      { type: 'text', text: message },
    ];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});

// Add Comments
const AddCommentsInputSchema = z.object({
  items: z
    .array(
      z.object({
        issueId: z.string(),
        body: z.string(),
      }),
    )
    .min(1)
    .max(50),
  parallel: z.boolean().optional(),
});

export const addCommentsTool = defineTool({
  name: toolsMetadata.add_comments.name,
  title: toolsMetadata.add_comments.title,
  description: toolsMetadata.add_comments.description,
  inputSchema: AddCommentsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    // Track results with issue identifiers for TOON output
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      issueIdentifier?: string;
      body?: string;
      createdAt?: string;
      error?: string | { code: string; message: string; suggestions: string[] };
      code?: string;
      input?: { issueId: string; body: string };
      success?: boolean;
    }[] = [];

    // First, resolve issue identifiers for TOON output
    const issueIdentifiers = new Map<string, string>();
    for (const item of args.items) {
      if (!issueIdentifiers.has(item.issueId)) {
        try {
          const issue = await client.issue(item.issueId);
          const identifier =
            (issue as unknown as { identifier?: string }).identifier ?? item.issueId;
          issueIdentifiers.set(item.issueId, identifier);
        } catch {
          // Use issueId as fallback
          issueIdentifiers.set(item.issueId, item.issueId);
        }
      }
    }

    for (let i = 0; i < args.items.length; i++) {
      const it = args.items[i];
      if (!it) continue;

      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        const call = () =>
          client.createComment({
            issueId: it.issueId,
            body: it.body,
          });

        const payload = await withRetry(
          () => (args.parallel === true ? call() : gate(call)),
          { maxRetries: 3, baseDelayMs: 500 },
        );

        const comment = payload.comment as unknown as {
          id?: string;
          createdAt?: Date | string;
        } | null;

        results.push({
          input: {
            issueId: it.issueId,
            body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
          },
          success: payload.success ?? true,
          id: comment?.id,
          issueIdentifier: issueIdentifiers.get(it.issueId) ?? it.issueId,
          body: it.body,
          createdAt:
            comment?.createdAt instanceof Date
              ? comment.createdAt.toISOString()
              : (comment?.createdAt ?? new Date().toISOString()),
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('add_comments', {
          message: 'Failed to add comment',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          input: {
            issueId: it.issueId,
            body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
          },
          success: false,
          issueIdentifier: issueIdentifiers.get(it.issueId) ?? it.issueId,
          error: {
            code: 'LINEAR_CREATE_ERROR',
            message: (error as Error).message,
            suggestions: ['Verify issueId with list_issues or get_issues.'],
          },
          // Legacy
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary = {
      total: args.items.length,
      succeeded,
      failed,
      ok: succeeded,
    };

    const meta = {
      nextSteps: ['Use list_comments to verify and retrieve URLs.'],
      relatedTools: ['list_comments', 'update_comments', 'get_issues'],
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Build TOON results section
      const toonResults: ToonRow[] = results.map((r) => ({
        index: r.index,
        status: r.success ? 'ok' : 'error',
        issue: r.issueIdentifier ?? '',
        error:
          r.success !== true
            ? typeof r.error === 'object'
              ? ((r.error as { message?: string }).message ?? '')
              : String(r.error ?? '')
            : '',
      }));

      // Build created comments section (only for successful results)
      const createdComments: ToonRow[] = results
        .filter((r) => r.success)
        .map((r) => ({
          issue: r.issueIdentifier ?? '',
          body: r.body ?? '',
          createdAt: r.createdAt ?? '',
        }));

      // Build TOON response
      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'failed', 'total'],
          values: {
            action: 'add_comments',
            succeeded,
            failed,
            total: args.items.length,
          },
        },
        data: [
          { schema: COMMENT_WRITE_RESULT_SCHEMA, items: toonResults },
          ...(createdComments.length > 0
            ? [{ schema: CREATED_COMMENT_SCHEMA, items: createdComments }]
            : []),
        ],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          action: 'add_comments',
          succeeded,
          failed,
          total: args.items.length,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format (when TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────

    // Strip TOON-specific fields for legacy schema compatibility
    // BatchResultSchema only allows: input, success, id, identifier, url, error, index, ok
    const legacyResults = results.map((r) => ({
      index: r.index,
      ok: r.ok,
      id: r.id,
      error: r.error,
      input: r.input,
      success: r.success,
    }));

    const structured = AddCommentsOutputSchema.parse({
      results: legacyResults,
      summary,
      meta,
    });

    const failures = results
      .filter((r) => !r.success)
      .map((r) => ({
        index: r.index,
        id: r.input?.issueId,
        error: typeof r.error === 'object' ? r.error.message : (r.error ?? ''),
        code: typeof r.error === 'object' ? r.error.code : undefined,
      }));

    // Don't show comment UUIDs (not helpful), just the count
    const text = summarizeBatch({
      action: 'Added comments',
      ok: succeeded,
      total: args.items.length,
      // Skip okIdentifiers - comment UUIDs aren't useful to show
      failures,
      nextSteps:
        succeeded > 0
          ? ['Use list_comments to verify and get comment URLs.']
          : ['Check issueId values with list_issues.'],
    });

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});

// Update Comments
const UpdateCommentsInputSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe('Comment ID to update.'),
        body: z.string().min(1).describe('New comment body (cannot be empty).'),
      }),
    )
    .min(1)
    .max(50),
});

// Schema for update_comments TOON output - uses comment ID
const UPDATE_COMMENT_RESULT_SCHEMA = {
  name: 'results',
  fields: ['index', 'status', 'id', 'error'],
};

export const updateCommentsTool = defineTool({
  name: toolsMetadata.update_comments.name,
  title: toolsMetadata.update_comments.title,
  description: toolsMetadata.update_comments.description,
  inputSchema: UpdateCommentsInputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);

    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string | { code: string; message: string; suggestions: string[] };
      code?: string;
      input?: { id: string; body?: string };
      success?: boolean;
    }[] = [];

    for (let i = 0; i < args.items.length; i++) {
      const it = args.items[i];
      if (!it) continue;

      try {
        if (context.signal?.aborted) {
          throw new Error('Operation aborted');
        }

        // Add small delay between requests to avoid rate limits
        if (i > 0) {
          await delay(100);
        }

        const call = () =>
          client.updateComment(it.id, {
            body: it.body,
          });

        const payload = await withRetry(() => gate(call), {
          maxRetries: 3,
          baseDelayMs: 500,
        });

        results.push({
          input: {
            id: it.id,
            body: it.body.slice(0, 50) + (it.body.length > 50 ? '...' : ''),
          },
          success: payload.success ?? true,
          id: it.id,
          // Legacy
          index: i,
          ok: payload.success ?? true,
        });
      } catch (error) {
        await logger.error('update_comments', {
          message: 'Failed to update comment',
          index: i,
          error: (error as Error).message,
        });
        results.push({
          input: { id: it.id },
          success: false,
          id: it.id,
          error: {
            code: 'LINEAR_UPDATE_ERROR',
            message: (error as Error).message,
            suggestions: ['Verify comment ID with list_comments.'],
          },
          // Legacy
          index: i,
          ok: false,
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    const summary = {
      total: args.items.length,
      succeeded,
      failed,
      ok: succeeded,
    };

    const meta = {
      nextSteps: ['Use list_comments to verify changes.'],
      relatedTools: ['list_comments', 'add_comments'],
    };

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Build TOON results section
      const toonResults: ToonRow[] = results.map((r) => ({
        index: r.index,
        status: r.success ? 'ok' : 'error',
        id: r.id ?? '',
        error:
          r.success !== true
            ? typeof r.error === 'object'
              ? ((r.error as { message?: string }).message ?? '')
              : String(r.error ?? '')
            : '',
      }));

      // Build TOON response
      const toonResponse: ToonResponse = {
        meta: {
          fields: ['action', 'succeeded', 'failed', 'total'],
          values: {
            action: 'update_comments',
            succeeded,
            failed,
            total: args.items.length,
          },
        },
        data: [{ schema: UPDATE_COMMENT_RESULT_SCHEMA, items: toonResults }],
      };

      const toonOutput = encodeToon(toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          action: 'update_comments',
          succeeded,
          failed,
          total: args.items.length,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format (when TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────

    // Strip TOON-specific fields for legacy schema compatibility
    // BatchResultSchema only allows: input, success, id, identifier, url, error, index, ok
    const legacyResults = results.map((r) => ({
      index: r.index,
      ok: r.ok,
      id: r.id,
      error: r.error,
      input: r.input,
      success: r.success,
    }));

    const structured = UpdateCommentsOutputSchema.parse({
      results: legacyResults,
      summary,
      meta,
    });

    const failures = legacyResults
      .filter((r) => !r.success)
      .map((r) => ({
        index: r.index,
        id: r.id,
        error: typeof r.error === 'object' ? r.error.message : (r.error ?? ''),
        code: typeof r.error === 'object' ? r.error.code : undefined,
      }));

    // Don't show comment UUIDs (not helpful), just the count
    const text = summarizeBatch({
      action: 'Updated comments',
      ok: succeeded,
      total: args.items.length,
      failures,
      nextSteps:
        succeeded > 0
          ? ['Use list_comments to verify changes.']
          : ['Check comment IDs with list_comments first.'],
    });

    const parts: Array<{ type: 'text'; text: string }> = [{ type: 'text', text }];

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});
