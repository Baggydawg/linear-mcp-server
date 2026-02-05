/**
 * List Cycles tool - fetch cycles for a team.
 *
 * Returns TOON output format.
 * Cycles use natural key (number) - no short keys needed.
 */

import { LinearDocument } from '@linear/sdk';
import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { resolveTeamId } from '../../../utils/resolvers.js';
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
  // Sort cycles by number descending (most recent first)
  // Cycles without a number are pushed to the end
  const sortedCycles = [...cycles].sort((a, b) => {
    if (a.number === undefined && b.number === undefined) return 0;
    if (a.number === undefined) return 1; // a goes after b
    if (b.number === undefined) return -1; // b goes after a
    return b.number - a.number; // Descending order
  });

  // Convert cycles to TOON rows
  const cycleRows = sortedCycles.map((cycle) => cycleToToonRow(cycle));

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
  teamId: z.string().optional().describe('Team UUID or key. Defaults to DEFAULT_TEAM if configured.'),
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

    // Resolve teamId with DEFAULT_TEAM fallback
    const teamIdInput = args.teamId ?? config.DEFAULT_TEAM;
    if (!teamIdInput) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'teamId is required (no DEFAULT_TEAM configured)' }],
        structuredContent: { error: 'TEAM_REQUIRED', hint: 'Provide teamId or set DEFAULT_TEAM env var' },
      };
    }

    const resolvedResult = await resolveTeamId(client, teamIdInput);
    if (!resolvedResult.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: resolvedResult.error }],
        structuredContent: { error: 'TEAM_RESOLUTION_FAILED', message: resolvedResult.error },
      };
    }
    const resolvedTeamId = resolvedResult.value;

    const team = await client.team(resolvedTeamId);

    const cyclesEnabled =
      ((team as unknown as { cyclesEnabled?: boolean } | null)?.cyclesEnabled ??
        false) === true;

    if (!cyclesEnabled) {
      const msg =
        `Cycles are disabled for team ${teamIdInput}.\n\n` +
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
          teamId: teamIdInput,
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

    const pageInfo = conn.pageInfo;
    const _hasMore = pageInfo?.hasNextPage ?? false;
    const _nextCursor = _hasMore ? (pageInfo?.endCursor ?? undefined) : undefined;

    // Get team key for TOON output
    const teamKey = (team as unknown as { key?: string }).key ?? teamIdInput;

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
    };
  },
});
