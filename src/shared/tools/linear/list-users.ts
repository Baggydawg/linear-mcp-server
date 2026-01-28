/**
 * List Users tool.
 *
 * Supports TOON output format:
 * - When TOON_OUTPUT_ENABLED=true, returns TOON format with short keys (u0, u1...)
 * - When TOON_OUTPUT_ENABLED=false (default), returns legacy human-readable format
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListUsersOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { mapUserNodeToListItem } from '../../../utils/mappers.js';
import { previewLinesFromItems, summarizeList } from '../../../utils/messages.js';
import {
  buildRegistry,
  encodeResponse,
  getOrInitRegistry,
  PAGINATION_SCHEMA,
  type ShortKeyRegistry,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  tryGetShortKey,
  USER_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listUsersTool = defineTool({
  name: toolsMetadata.list_users.name,
  title: toolsMetadata.list_users.title,
  description: toolsMetadata.list_users.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const limit = args.limit ?? 50;

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Use GraphQL to fetch all needed fields for TOON output
      const QUERY = `
        query ListUsers($first: Int!, $after: String) {
          users(first: $first, after: $after) {
            nodes {
              id
              name
              displayName
              email
              active
              createdAt
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `;

      const variables = { first: limit, after: args.cursor };
      const resp = await client.client.rawRequest(QUERY, variables);
      const conn = (
        resp as {
          data?: {
            users?: {
              nodes?: Array<RawUserData>;
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        }
      ).data?.users ?? { nodes: [], pageInfo: {} };

      const rawUsers = conn.nodes ?? [];
      const pageInfo = conn.pageInfo ?? {};
      const hasMore = pageInfo.hasNextPage ?? false;
      const nextCursor = hasMore ? pageInfo.endCursor : undefined;

      // Initialize registry for short key assignment
      // Users need short keys (u0, u1...) based on createdAt order
      let registry: ShortKeyRegistry | null = null;
      try {
        registry = await getOrInitRegistry(
          {
            sessionId: context.sessionId,
            transport: 'stdio', // Default to stdio
          },
          async () => {
            // Build registry from the fetched users
            // Note: For full registry we'd need all users, but for list_users
            // we only show the current page with keys based on their position
            // We need to fetch ALL users to get proper short keys
            const allUsersResp = await client.client.rawRequest(
              `query { users(first: 100) { nodes { id createdAt } } }`,
            );
            const allUsersData =
              (
                allUsersResp as {
                  data?: {
                    users?: { nodes?: Array<{ id: string; createdAt: string }> };
                  };
                }
              ).data?.users?.nodes ?? [];

            // Get viewer org for workspace ID
            const viewer = await client.viewer;
            const viewerOrg = viewer as unknown as { organization?: { id?: string } };
            const workspaceId = viewerOrg?.organization?.id ?? 'unknown';

            return {
              users: allUsersData.map((u) => ({
                id: u.id,
                createdAt: new Date(u.createdAt),
              })),
              states: [],
              projects: [],
              workspaceId,
            };
          },
        );
      } catch (error) {
        console.error('Registry initialization failed:', error);
      }

      // Convert to TOON rows with short keys
      const userRows: ToonRow[] = rawUsers.map((user) => {
        const shortKey =
          registry && user.id ? tryGetShortKey(registry, 'user', user.id) : null;

        return {
          key: shortKey ?? `u?`, // Fallback if registry unavailable
          name: user.name ?? '',
          displayName: user.displayName ?? null,
          email: user.email ?? null,
          active: user.active ?? true,
        };
      });

      // Build data sections
      const data: ToonSection[] = [{ schema: USER_SCHEMA, items: userRows }];

      // Add pagination if needed
      if (hasMore) {
        data.push({
          schema: PAGINATION_SCHEMA,
          items: [
            {
              hasMore,
              cursor: nextCursor ?? '',
              fetched: userRows.length,
              total: null,
            },
          ],
        });
      }

      // Build TOON response
      const toonResponse: ToonResponse = {
        meta: {
          fields: ['tool', 'count', 'generated'],
          values: {
            tool: 'list_users',
            count: userRows.length,
            generated: new Date().toISOString(),
          },
        },
        data,
      };

      // Encode TOON output
      const toonOutput = encodeResponse(rawUsers, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          count: userRows.length,
          hasMore,
          nextCursor,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy Output Format (when TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────
    const queryArgs: Record<string, unknown> = { first: limit };
    if (args.cursor) {
      queryArgs.after = args.cursor;
    }

    const connection = await client.users(
      queryArgs as Parameters<typeof client.users>[0],
    );
    const items = connection.nodes.map(mapUserNodeToListItem);
    const pageInfo = connection.pageInfo;

    const hasMore = pageInfo.hasNextPage;
    const nextCursor = hasMore ? pageInfo.endCursor : undefined;

    // Build pagination
    const pagination = {
      hasMore,
      nextCursor,
      itemsReturned: items.length,
      limit,
    };

    // Build meta
    const meta = {
      nextSteps: [
        ...(hasMore ? [`Call again with cursor="${nextCursor}" for more.`] : []),
        'Use user id as assigneeId in create_issues or update_issues.',
        'Use assigneeName or assigneeEmail in create/update_issues for name-based assignment.',
      ],
      relatedTools: ['create_issues', 'update_issues'],
    };

    const structured = ListUsersOutputSchema.parse({
      items,
      pagination,
      meta,
      // Legacy
      cursor: args.cursor,
      nextCursor,
      limit,
    });

    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (u) => {
        const name =
          (u.displayName as string) ?? (u.name as string) ?? (u.id as string);
        const email = u.email as string | undefined;
        return `${name}${email ? ` <${email}>` : ''} → ${u.id as string}`;
      },
    );

    const text = summarizeList({
      subject: 'Users',
      count: items.length,
      limit,
      nextCursor,
      previewLines: preview,
      nextSteps: meta.nextSteps,
    });

    return {
      content: [{ type: 'text', text }],
      structuredContent: structured,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Types for TOON processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw user data from GraphQL response for TOON processing.
 */
interface RawUserData {
  id: string;
  name?: string | null;
  displayName?: string | null;
  email?: string | null;
  active?: boolean;
  createdAt?: string;
}
