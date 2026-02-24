/**
 * Comments tools - list and add comments on issues.
 *
 * Uses TOON output format (Tier 2):
 * - Returns TOON format with comment authors in _users lookup
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { delay, makeConcurrencyGate, withRetry } from '../../../utils/limits.js';
import { logger } from '../../../utils/logger.js';
import {
  COMMENT_SCHEMA_WITH_ID,
  COMMENT_WRITE_RESULT_SCHEMA,
  CREATED_COMMENT_SCHEMA,
  encodeResponse,
  encodeToon,
  getOrInitRegistry,
  getUserMetadata,
  type RegistryBuildData,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  USER_LOOKUP_SCHEMA,
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
  const teamsNodes = teamsConn.nodes ?? [];
  const states: RegistryBuildData['states'] = [];

  const userTeamMap = new Map<string, string[]>();

  for (const team of teamsNodes) {
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

    // Fetch team members for team membership column
    const teamKey = (team as unknown as { key?: string }).key ?? team.id;
    const membersConn = await (
      team as unknown as {
        members: (opts: { first: number }) => Promise<{ nodes: Array<{ id: string }> }>;
      }
    ).members({ first: 200 });
    for (const member of membersConn.nodes ?? []) {
      if (!userTeamMap.has(member.id)) {
        userTeamMap.set(member.id, []);
      }
      userTeamMap.get(member.id)!.push(teamKey);
    }
  }

  // Enrich users with team membership
  const usersWithTeams = users.map((u) => ({
    ...u,
    teams: userTeamMap.get(u.id) ?? [],
  }));

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

  const teams = teamsNodes.map((t) => ({
    id: t.id,
    key: (t as unknown as { key?: string }).key ?? t.id,
  }));

  let defaultTeamId: string | undefined;
  if (config.DEFAULT_TEAM) {
    const defaultTeamKey = config.DEFAULT_TEAM.toLowerCase();
    const matchedTeam = teamsNodes.find(
      (t) =>
        (t as unknown as { key?: string }).key?.toLowerCase() === defaultTeamKey ||
        t.id === config.DEFAULT_TEAM,
    );
    defaultTeamId = matchedTeam?.id;
  }

  return { users: usersWithTeams, states, projects, workspaceId, teams, defaultTeamId };
}

/**
 * Convert a comment to TOON row format.
 * @param fallbackUserMap - Map of user UUID to ad-hoc key for users not in registry
 */
function commentToToonRow(
  comment: RawCommentData,
  issueIdentifier: string,
  registry: ShortKeyRegistry | null,
  fallbackUserMap?: Map<string, string>,
): ToonRow {
  let userKey: string | undefined;

  if (comment.user?.id) {
    // First, try to get short key from registry
    if (registry) {
      userKey = tryGetShortKey(registry, 'user', comment.user.id);
    }
    // If not found in registry, check fallback map (external/deactivated users)
    if (!userKey && fallbackUserMap) {
      userKey = fallbackUserMap.get(comment.user.id);
    }
  }

  const createdAt =
    comment.createdAt instanceof Date
      ? comment.createdAt.toISOString()
      : comment.createdAt;

  return {
    id: comment.id,
    issue: issueIdentifier,
    user: userKey ?? '',
    body: comment.body ?? '',
    createdAt,
  };
}

/**
 * Build user lookup table with only comment authors (Tier 2).
 * Also returns a fallback map for users not in the registry (external/deactivated users).
 */
function buildCommentAuthorLookup(
  registry: ShortKeyRegistry,
  comments: RawCommentData[],
): { section: ToonSection; fallbackMap: Map<string, string> } {
  // Collect unique user IDs from comments and build userId -> userName map
  const userIds = new Set<string>();
  const userIdToName = new Map<string, string>();
  for (const comment of comments) {
    if (comment.user?.id) {
      userIds.add(comment.user.id);
      if (comment.user.name) {
        userIdToName.set(comment.user.id, comment.user.name);
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

      // Add to fallback map for use in commentToToonRow
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
 * Build TOON response for list_comments.
 */
function buildCommentsToonResponse(
  comments: RawCommentData[],
  issueIdentifier: string,
  registry: ShortKeyRegistry | null,
): ToonResponse {
  // Build lookup sections (Tier 2 - only comment authors)
  const lookups: ToonSection[] = [];
  let fallbackUserMap: Map<string, string> | undefined;

  // Add user lookup if we have a registry and comments with authors
  if (registry) {
    const { section: userLookup, fallbackMap } = buildCommentAuthorLookup(
      registry,
      comments,
    );
    fallbackUserMap = fallbackMap;
    if (userLookup.items.length > 0) {
      lookups.push(userLookup);
    }
  }

  // Convert comments to TOON rows
  const commentRows = comments.map((comment) =>
    commentToToonRow(comment, issueIdentifier, registry, fallbackUserMap),
  );

  // Build data sections
  const data: ToonSection[] = [{ schema: COMMENT_SCHEMA_WITH_ID, items: commentRows }];

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

    const pageInfo = conn.pageInfo;
    const _hasMore = pageInfo?.hasNextPage ?? false;
    const _nextCursor = _hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

    // Get issue identifier for TOON output
    const issueIdentifier =
      (issue as unknown as { identifier?: string }).identifier ?? args.issueId;

    // Convert items to RawCommentData for TOON processing
    // Must await user relation as Linear SDK uses lazy-loading (returns Promise)
    const rawComments: RawCommentData[] = await Promise.all(
      conn.nodes.map(async (c) => ({
        id: c.id,
        body: (c as unknown as { body?: string }).body ?? '',
        createdAt: c.createdAt,
        user:
          (await (
            c as unknown as { user?: Promise<{ id: string; name?: string } | null> }
          ).user) ?? null,
      })),
    );

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
    };
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

    // Build TOON results section
    const toonResults: ToonRow[] = results.map((r) => {
      const errObj =
        typeof r.error === 'object'
          ? (r.error as { code?: string; message?: string; suggestions?: string[] })
          : null;
      return {
        index: r.index,
        status: r.success ? 'ok' : 'error',
        issue: r.issueIdentifier ?? '',
        error: r.success
          ? ''
          : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
        code: r.success ? '' : (errObj?.code ?? ''),
        hint: r.success ? '' : (errObj?.suggestions?.[0] ?? ''),
      };
    });

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
    };
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
  fields: ['index', 'status', 'id', 'error', 'code', 'hint'],
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

    // Build TOON results section
    const toonResults: ToonRow[] = results.map((r) => {
      const errObj =
        typeof r.error === 'object'
          ? (r.error as { code?: string; message?: string; suggestions?: string[] })
          : null;
      return {
        index: r.index,
        status: r.success ? 'ok' : 'error',
        id: r.id ?? '',
        error: r.success
          ? ''
          : (errObj?.message ?? (typeof r.error === 'string' ? r.error : '')),
        code: r.success ? '' : (errObj?.code ?? ''),
        hint: r.success ? '' : (errObj?.suggestions?.[0] ?? ''),
      };
    });

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
    };
  },
});
