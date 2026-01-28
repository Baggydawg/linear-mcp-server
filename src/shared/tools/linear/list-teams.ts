/**
 * List Teams tool.
 *
 * Supports TOON output format:
 * - When TOON_OUTPUT_ENABLED=true, returns TOON format
 * - When TOON_OUTPUT_ENABLED=false (default), returns legacy human-readable format
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListTeamsOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { mapTeamNodeToListItem } from '../../../utils/mappers.js';
import { previewLinesFromItems, summarizeList } from '../../../utils/messages.js';
import {
  encodeResponse,
  PAGINATION_SCHEMA,
  TEAM_SCHEMA,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export const listTeamsTool = defineTool({
  name: toolsMetadata.list_teams.name,
  title: toolsMetadata.list_teams.title,
  description: toolsMetadata.list_teams.description,
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
        query ListTeams($first: Int!, $after: String) {
          teams(first: $first, after: $after) {
            nodes {
              id
              key
              name
              description
              cyclesEnabled
              cycleDuration
              defaultIssueEstimationType
              activeCycle {
                number
              }
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
            teams?: {
              nodes?: Array<RawTeamData>;
              pageInfo?: { hasNextPage?: boolean; endCursor?: string };
            };
          };
        }
      ).data?.teams ?? { nodes: [], pageInfo: {} };

      const rawTeams = conn.nodes ?? [];
      const pageInfo = conn.pageInfo ?? {};
      const hasMore = pageInfo.hasNextPage ?? false;
      const nextCursor = hasMore ? pageInfo.endCursor : undefined;

      // Convert to TOON rows
      const teamRows: ToonRow[] = rawTeams.map((team) => ({
        key: team.key ?? '',
        name: team.name ?? '',
        description: team.description ?? null,
        cyclesEnabled: team.cyclesEnabled ?? false,
        cycleDuration: team.cycleDuration ?? null,
        estimationType: team.defaultIssueEstimationType ?? null,
        activeCycle: team.activeCycle?.number ?? null,
      }));

      // Build data sections
      const data: ToonSection[] = [{ schema: TEAM_SCHEMA, items: teamRows }];

      // Add pagination if needed
      if (hasMore) {
        data.push({
          schema: PAGINATION_SCHEMA,
          items: [
            {
              hasMore,
              cursor: nextCursor ?? '',
              fetched: teamRows.length,
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
            tool: 'list_teams',
            count: teamRows.length,
            generated: new Date().toISOString(),
          },
        },
        data,
      };

      // Encode TOON output
      const toonOutput = encodeResponse(rawTeams, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          count: teamRows.length,
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

    const connection = await client.teams(
      queryArgs as Parameters<typeof client.teams>[0],
    );
    const items = connection.nodes.map(mapTeamNodeToListItem);
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
        'Use team id as teamId in list_issues or create_issues.',
        'Use workspace_metadata with teamIds to get workflow states and labels.',
      ],
      relatedTools: ['workspace_metadata', 'list_issues', 'create_issues'],
    };

    const structured = ListTeamsOutputSchema.parse({
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
      (t) => {
        const key = t.key as string | undefined;
        const name = t.name as string;
        return `${key ? `${key} — ` : ''}${name} → ${t.id as string}`;
      },
    );

    const text = summarizeList({
      subject: 'Teams',
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
 * Raw team data from GraphQL response for TOON processing.
 */
interface RawTeamData {
  id: string;
  key?: string;
  name?: string;
  description?: string | null;
  cyclesEnabled?: boolean;
  cycleDuration?: number;
  defaultIssueEstimationType?: string;
  activeCycle?: { number?: number } | null;
}
