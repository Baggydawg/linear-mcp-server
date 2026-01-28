/**
 * List Cycles tool - fetch cycles for a team.
 *
 * Supports TOON output format:
 * - When TOON_OUTPUT_ENABLED=true, returns TOON format
 * - When TOON_OUTPUT_ENABLED=false (default), returns legacy human-readable format
 *
 * Cycles use natural key (number) - no short keys needed.
 */

import { LinearDocument } from '@linear/sdk';
import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { ListCyclesOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { previewLinesFromItems, summarizeList } from '../../../utils/messages.js';
import {
  CYCLE_SCHEMA,
  encodeResponse,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Support
// Cycles use natural key (number) - no short keys needed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Raw cycle data from Linear API for TOON processing.
 */
interface RawCycleData {
  id: string;
  name?: string;
  number?: number;
  startsAt?: Date | string;
  endsAt?: Date | string;
  completedAt?: Date | string;
  progress?: number;
}

/**
 * Convert a cycle to TOON row format.
 * Cycles use natural key (number) - no short keys needed.
 */
function cycleToToonRow(cycle: RawCycleData): ToonRow {
  const formatDate = (date?: Date | string): string | null => {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0]; // YYYY-MM-DD format
  };

  // Determine if cycle is active
  const now = new Date();
  const startsAt = cycle.startsAt ? new Date(cycle.startsAt) : null;
  const endsAt = cycle.endsAt ? new Date(cycle.endsAt) : null;
  const isActive =
    startsAt && endsAt ? now >= startsAt && now <= endsAt : !cycle.completedAt;

  return {
    num: cycle.number ?? null,
    name: cycle.name ?? null,
    start: formatDate(cycle.startsAt),
    end: formatDate(cycle.endsAt),
    active: isActive,
    progress: cycle.progress ?? 0,
  };
}

/**
 * Build TOON response for list_cycles.
 */
function buildCyclesToonResponse(
  cycles: RawCycleData[],
  teamKey: string,
): ToonResponse {
  // Convert cycles to TOON rows
  const cycleRows = cycles.map((cycle) => cycleToToonRow(cycle));

  // Build data sections
  const data: ToonSection[] = [{ schema: CYCLE_SCHEMA, items: cycleRows }];

  // Build meta section
  const metaFields = ['tool', 'team', 'count', 'generated'];
  const metaValues: Record<string, string | number | boolean | null> = {
    tool: 'list_cycles',
    team: teamKey,
    count: cycles.length,
    generated: new Date().toISOString(),
  };

  return {
    meta: { fields: metaFields, values: metaValues },
    data,
  };
}

const InputSchema = z.object({
  teamId: z.string(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt']).optional(),
});

export const listCyclesTool = defineTool({
  name: toolsMetadata.list_cycles.name,
  title: toolsMetadata.list_cycles.title,
  description: toolsMetadata.list_cycles.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const client = await getLinearClient(context);
    const team = await client.team(args.teamId);

    const cyclesEnabled =
      ((team as unknown as { cyclesEnabled?: boolean } | null)?.cyclesEnabled ??
        false) === true;

    if (!cyclesEnabled) {
      const msg =
        `Cycles are disabled for team ${args.teamId}.\n\n` +
        `Alternatives for organizing work:\n` +
        `- Use list_projects to manage work with milestones and project phases\n` +
        `- Use labels to group issues by sprint/phase (e.g., "Sprint 23", "Q1-2024")\n` +
        `- Use dueDate field on issues to track timelines\n\n` +
        `Next steps: Check workspace_metadata with include=["teams"] to find teams with cyclesEnabled=true, ` +
        `or use list_projects for milestone-based planning.`;
      return {
        isError: true,
        content: [{ type: 'text', text: msg }],
        structuredContent: {
          error: 'CYCLES_DISABLED',
          teamId: args.teamId,
          alternatives: ['list_projects', 'labels', 'dueDate'],
          hint: 'Use workspace_metadata to find teams with cycles enabled.',
        },
      };
    }

    const first = args.limit ?? 20;
    const after = args.cursor;
    const orderBy =
      args.orderBy === 'updatedAt'
        ? LinearDocument.PaginationOrderBy.UpdatedAt
        : args.orderBy === 'createdAt'
          ? LinearDocument.PaginationOrderBy.CreatedAt
          : undefined;

    const conn = await team.cycles({
      first,
      after,
      includeArchived: args.includeArchived,
      orderBy,
    });

    const items = conn.nodes.map((c) => ({
      id: c.id,
      name: (c as unknown as { name?: string })?.name ?? undefined,
      number: (c as unknown as { number?: number })?.number ?? undefined,
      startsAt: c.startsAt?.toString() ?? undefined,
      endsAt: c.endsAt?.toString() ?? undefined,
      completedAt: c.completedAt?.toString() ?? undefined,
      teamId: args.teamId,
      status: (c as unknown as { status?: string })?.status ?? undefined,
    }));

    const pageInfo = conn.pageInfo;
    const hasMore = pageInfo?.hasNextPage ?? false;
    const nextCursor = hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

    // Get team key for TOON output
    const teamKey = (team as unknown as { key?: string }).key ?? args.teamId;

    // ─────────────────────────────────────────────────────────────────────────
    // TOON Output Format (when TOON_OUTPUT_ENABLED=true)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.TOON_OUTPUT_ENABLED) {
      // Convert items to RawCycleData for TOON processing
      const rawCycles: RawCycleData[] = conn.nodes.map((c) => ({
        id: c.id,
        name: (c as unknown as { name?: string })?.name,
        number: (c as unknown as { number?: number })?.number,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        completedAt: c.completedAt,
        progress: (c as unknown as { progress?: number })?.progress,
      }));

      // Build TOON response
      const toonResponse = buildCyclesToonResponse(rawCycles, teamKey);

      // Encode TOON output
      const toonOutput = encodeResponse(rawCycles, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _format: 'toon',
          _version: '1',
          team: teamKey,
          count: rawCycles.length,
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
      teamId: args.teamId,
      includeArchived: args.includeArchived,
      orderBy: args.orderBy,
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
        'Use cycle number/name to coordinate planning.',
        'Use list_issues with team filter to gather work for cycles.',
      ],
      relatedTools: ['list_issues', 'update_issues'],
    };

    const structured = ListCyclesOutputSchema.parse({
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
      (c) =>
        `${String(
          (c.name as string) ?? (c.number as number | undefined) ?? 'Cycle',
        )} (${c.id}) ${
          (c.startsAt as string | undefined)
            ? `— ${String(c.startsAt)} → ${String(c.endsAt ?? '')}`
            : ''
        }`.trim(),
    );

    const message = summarizeList({
      subject: 'Cycles',
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
