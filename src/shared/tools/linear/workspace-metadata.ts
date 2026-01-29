/**
 * Workspace Metadata tool - discover IDs, teams, workflow states, labels, projects.
 *
 * This is a **Tier 1** TOON tool - it returns ALL available entities so Claude
 * knows the full workspace context. It also builds and stores the short key
 * registry for UUID resolution in subsequent tool calls.
 */

import { z } from 'zod';
import { config } from '../../../config/env.js';
import { toolsMetadata } from '../../../config/metadata.js';
import { AccountOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { previewLinesFromItems, summarizeList } from '../../../utils/messages.js';
import {
  buildRegistry,
  CYCLE_LOOKUP_SCHEMA,
  encodeResponse,
  LABEL_LOOKUP_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  type RegistryBuildData,
  STATE_LOOKUP_SCHEMA,
  storeRegistry,
  TEAM_LOOKUP_SCHEMA,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  USER_LOOKUP_SCHEMA,
} from '../../toon/index.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  include: z
    .array(
      z.enum([
        'profile',
        'teams',
        'workflow_states',
        'labels',
        'projects',
        'favorites',
      ]),
    )
    .optional()
    .describe(
      "What to include. Defaults to ['profile','teams','workflow_states','labels','projects']. " +
        "'profile' returns viewer (id, name, email, timezone). " +
        "'teams' returns team list with cyclesEnabled flag. " +
        "'workflow_states' returns workflowStatesByTeam[teamId] with state id/name/type. " +
        "'labels' returns labelsByTeam[teamId]. " +
        "'projects' returns project list. " +
        "'favorites' returns user favorites.",
    ),
  teamIds: z
    .array(z.string())
    .optional()
    .describe('Filter to specific team UUIDs. If omitted, fetches all teams.'),
  project_limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max projects per team. Default: 10.'),
  label_limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max labels per team. Default: 50.'),
  forceRefresh: z
    .boolean()
    .optional()
    .describe('Force registry rebuild even if one exists. Default: false.'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Types for Linear API responses
// ─────────────────────────────────────────────────────────────────────────────

type TeamLike = {
  id: string;
  key?: string;
  name: string;
  description?: string;
  defaultIssueEstimate?: number;
  cyclesEnabled?: boolean;
  cycleDuration?: number;
  issueEstimationAllowZero?: boolean;
  issueEstimationExtended?: boolean;
  issueEstimationType?: string;
  createdAt?: Date | string;
  states: () => Promise<{
    nodes: Array<{
      id: string;
      name: string;
      type?: string;
      createdAt?: Date | string;
    }>;
  }>;
  labels: (args: { first: number }) => Promise<{
    nodes: Array<{
      id: string;
      name: string;
      color?: string;
      description?: string;
      createdAt?: Date | string;
    }>;
  }>;
  projects: (args: { first: number }) => Promise<{
    nodes: Array<{
      id: string;
      name: string;
      state?: string;
      priority?: number;
      progress?: number;
      lead?: { id?: string; name?: string };
      targetDate?: string;
      createdAt?: Date | string;
    }>;
  }>;
  cycles: (args?: { first?: number; filter?: Record<string, unknown> }) => Promise<{
    nodes: Array<{
      id: string;
      number?: number;
      name?: string;
      startsAt?: Date;
      endsAt?: Date;
      progress?: number;
      createdAt?: Date | string;
    }>;
  }>;
};

type UserLike = {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  active?: boolean;
  admin?: boolean;
  guest?: boolean;
  createdAt?: Date | string;
};

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Functions
// ─────────────────────────────────────────────────────────────────────────────

interface WorkspaceData {
  organizationName?: string;
  viewer?: {
    id: string;
    name?: string;
    email?: string;
    displayName?: string;
    timezone?: string;
  };
  teams: Array<{
    id: string;
    key?: string;
    name: string;
    cyclesEnabled?: boolean;
    cycleDuration?: number;
    estimationType?: string;
    createdAt?: Date | string;
  }>;
  users: Array<{
    id: string;
    name?: string;
    displayName?: string;
    email?: string;
    active?: boolean;
    role?: string;
    createdAt?: Date | string;
  }>;
  states: Array<{
    id: string;
    name: string;
    type?: string;
    teamId: string;
    createdAt?: Date | string;
  }>;
  labels: Array<{
    id: string;
    name: string;
    color?: string;
    teamId: string;
    createdAt?: Date | string;
  }>;
  projects: Array<{
    id: string;
    name: string;
    state?: string;
    priority?: number;
    progress?: number;
    leadId?: string;
    targetDate?: string;
    createdAt?: Date | string;
  }>;
  cycles: Array<{
    id: string;
    number?: number;
    name?: string;
    startsAt?: Date;
    endsAt?: Date;
    active: boolean;
    progress?: number;
    teamId: string;
  }>;
}

/**
 * Build the TOON response format for workspace metadata.
 * This is a Tier 1 tool - returns ALL entities.
 */
function buildToonResponse(
  data: WorkspaceData,
  registry: { usersByUuid: Map<string, string>; projectsByUuid: Map<string, string> },
): ToonResponse {
  const sections: ToonSection[] = [];

  // _teams section
  if (data.teams.length > 0) {
    const teamItems: ToonRow[] = data.teams.map((t) => ({
      key: t.key ?? '',
      name: t.name,
      cyclesEnabled: t.cyclesEnabled ?? false,
      cycleDuration: t.cycleDuration ?? null,
      estimationType: t.estimationType ?? '',
    }));
    sections.push({ schema: TEAM_LOOKUP_SCHEMA, items: teamItems });
  }

  // _users section - ALL users
  if (data.users.length > 0) {
    const userItems: ToonRow[] = data.users.map((u) => ({
      key: registry.usersByUuid.get(u.id) ?? '',
      name: u.name ?? '',
      displayName: u.displayName ?? '',
      email: u.email ?? '',
      role: u.role ?? '',
    }));
    sections.push({ schema: USER_LOOKUP_SCHEMA, items: userItems });
  }

  // _states section - ALL states
  if (data.states.length > 0) {
    // Group states by team, then sort by createdAt for consistent key assignment
    const statesSorted = [...data.states].sort((a, b) => {
      const dateA =
        a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt ?? 0);
      const dateB =
        b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt ?? 0);
      return dateA.getTime() - dateB.getTime();
    });

    // Assign short keys s0, s1, s2...
    const stateItems: ToonRow[] = statesSorted.map((s, index) => ({
      key: `s${index}`,
      name: s.name,
      type: s.type ?? '',
    }));
    sections.push({ schema: STATE_LOOKUP_SCHEMA, items: stateItems });
  }

  // _labels section - ALL labels
  if (data.labels.length > 0) {
    // Labels use name as primary key (no short key)
    const labelItems: ToonRow[] = data.labels.map((l) => ({
      name: l.name,
      color: l.color ?? '',
    }));
    // Deduplicate by name (labels might appear for multiple teams)
    const seenNames = new Set<string>();
    const uniqueLabels = labelItems.filter((l) => {
      if (seenNames.has(l.name as string)) return false;
      seenNames.add(l.name as string);
      return true;
    });
    sections.push({ schema: LABEL_LOOKUP_SCHEMA, items: uniqueLabels });
  }

  // _projects section - ALL projects
  if (data.projects.length > 0) {
    const projectItems: ToonRow[] = data.projects.map((p) => {
      const leadKey = p.leadId ? (registry.usersByUuid.get(p.leadId) ?? '') : '';
      return {
        key: registry.projectsByUuid.get(p.id) ?? '',
        name: p.name,
        state: p.state ?? '',
        priority: p.priority ?? null,
        progress: p.progress !== undefined ? Math.round(p.progress * 100) / 100 : null,
        lead: leadKey,
        targetDate: p.targetDate ?? '',
      };
    });
    sections.push({ schema: PROJECT_LOOKUP_SCHEMA, items: projectItems });
  }

  // _cycles section - current + upcoming cycles
  if (data.cycles.length > 0) {
    const cycleItems: ToonRow[] = data.cycles.map((c) => ({
      num: c.number ?? null,
      name: c.name ?? '',
      start: c.startsAt ? formatDate(c.startsAt) : '',
      end: c.endsAt ? formatDate(c.endsAt) : '',
      active: c.active,
      progress: c.progress !== undefined ? Math.round(c.progress * 100) / 100 : null,
    }));
    sections.push({ schema: CYCLE_LOOKUP_SCHEMA, items: cycleItems });
  }

  // Build _meta section
  const teamKey =
    data.teams.length > 0 ? (data.teams[0].key ?? data.teams[0].name) : '';

  return {
    meta: {
      fields: ['org', 'team', 'generated'],
      values: {
        org: data.organizationName ?? '',
        team: teamKey,
        generated: new Date().toISOString(),
      },
    },
    lookups: sections,
  };
}

/**
 * Format date to YYYY-MM-DD string.
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definition
// ─────────────────────────────────────────────────────────────────────────────

export const workspaceMetadataTool = defineTool({
  name: toolsMetadata.workspace_metadata.name,
  title: toolsMetadata.workspace_metadata.title,
  description: toolsMetadata.workspace_metadata.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const include = args.include ?? [
      'profile',
      'teams',
      'workflow_states',
      'labels',
      'projects',
    ];
    const teamIdsFilter = new Set(args.teamIds ?? []);
    // forceRefresh is accepted as input but currently unused
    // Will be used in the future to force registry rebuild even if one exists
    const _forceRefresh = args.forceRefresh ?? false;

    const client = await getLinearClient(context);

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch workspace data
    // ─────────────────────────────────────────────────────────────────────────

    const workspaceData: WorkspaceData = {
      teams: [],
      users: [],
      states: [],
      labels: [],
      projects: [],
      cycles: [],
    };

    // Fetch viewer/profile
    if (include.includes('profile') || config.TOON_OUTPUT_ENABLED) {
      const viewer = await client.viewer;
      workspaceData.viewer = {
        id: viewer.id,
        name: viewer.name ?? undefined,
        email: viewer.email ?? undefined,
        displayName: viewer.displayName ?? undefined,
        timezone: viewer.timezone ?? undefined,
      };

      // Fetch organization name for TOON _meta section
      try {
        const org = await viewer.organization;
        workspaceData.organizationName = org?.name ?? undefined;
      } catch {
        // Organization fetch failed, leave organizationName undefined
      }
    }

    // Fetch teams
    let teams: TeamLike[] = [];
    if (
      include.includes('teams') ||
      include.includes('workflow_states') ||
      include.includes('labels') ||
      include.includes('projects') ||
      config.TOON_OUTPUT_ENABLED
    ) {
      if (teamIdsFilter.size) {
        const ids = Array.from(teamIdsFilter);
        const fetched: TeamLike[] = [];
        for (const id of ids) {
          try {
            const t = (await client.team(id)) as unknown as TeamLike;
            fetched.push(t);
          } catch {
            // Non-fatal: continue collecting other teams
          }
        }
        teams = fetched;
      } else {
        const teamConn = (await client.teams({ first: 100 })) as unknown as {
          nodes: TeamLike[];
        };
        teams = teamConn.nodes as TeamLike[];
      }

      workspaceData.teams = teams.map((t) => ({
        id: t.id,
        key: t.key ?? undefined,
        name: t.name,
        cyclesEnabled: t.cyclesEnabled,
        cycleDuration: t.cycleDuration,
        estimationType: t.issueEstimationType,
        createdAt: t.createdAt,
      }));
    }

    // Fetch users (always fetch for TOON to build registry)
    if (config.TOON_OUTPUT_ENABLED) {
      const usersConn = (await client.users({ first: 200 })) as unknown as {
        nodes: UserLike[];
      };
      workspaceData.users = usersConn.nodes.map((u) => ({
        id: u.id,
        name: u.name ?? undefined,
        displayName: u.displayName ?? undefined,
        email: u.email ?? undefined,
        active: u.active,
        role: u.admin ? 'Admin' : u.guest ? 'Guest' : 'Member',
        createdAt: u.createdAt,
      }));
    }

    // Fetch workflow states
    let statesByTeamComputed: Record<
      string,
      Array<{ id: string; name: string; type?: string; createdAt?: Date | string }>
    > = {};
    if (include.includes('workflow_states') || config.TOON_OUTPUT_ENABLED) {
      const statesByTeam: Record<
        string,
        Array<{ id: string; name: string; type?: string; createdAt?: Date | string }>
      > = {};
      for (const team of teams) {
        const states = await team.states();
        statesByTeam[team.id] = states.nodes.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          createdAt: s.createdAt,
        }));

        // Add to workspaceData for TOON
        for (const state of statesByTeam[team.id]) {
          workspaceData.states.push({
            ...state,
            teamId: team.id,
          });
        }
      }
      statesByTeamComputed = statesByTeam;
    }

    // Fetch labels
    let labelsByTeamComputed: Record<
      string,
      Array<{ id: string; name: string; color?: string; description?: string }>
    > = {};
    if (include.includes('labels') || config.TOON_OUTPUT_ENABLED) {
      const labelLimit = args.label_limit ?? 50;
      const labelsByTeam: Record<
        string,
        Array<{
          id: string;
          name: string;
          color?: string;
          description?: string;
        }>
      > = {};
      for (const team of teams) {
        const labels = await team.labels({ first: labelLimit });
        labelsByTeam[team.id] = labels.nodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color ?? undefined,
          description: l.description ?? undefined,
        }));

        // Add to workspaceData for TOON
        for (const label of labelsByTeam[team.id]) {
          workspaceData.labels.push({
            ...label,
            teamId: team.id,
          });
        }
      }
      labelsByTeamComputed = labelsByTeam;
    }

    // Fetch projects
    let projectsLocal: Array<Record<string, unknown>> = [];
    if (include.includes('projects') || config.TOON_OUTPUT_ENABLED) {
      const limit = args.project_limit ?? 10;
      const projects: Array<Record<string, unknown>> = [];
      for (const team of teams) {
        const conn = await team.projects({ first: limit });
        for (const p of conn.nodes) {
          // Legacy format: only fields allowed by AccountOutputSchema
          projects.push({
            id: p.id,
            name: p.name,
            state: p.state,
            leadId: p.lead?.id ?? undefined,
            teamId: team.id,
            targetDate: p.targetDate ?? undefined,
            createdAt: p.createdAt?.toString(),
          });

          // Add to workspaceData for TOON (includes extra fields)
          workspaceData.projects.push({
            id: p.id,
            name: p.name,
            state: p.state,
            priority: p.priority,
            progress: p.progress,
            leadId: p.lead?.id ?? undefined,
            targetDate: p.targetDate ?? undefined,
            createdAt: p.createdAt,
          });
        }
      }
      projectsLocal = projects;
    }

    // Fetch cycles (for TOON output)
    if (config.TOON_OUTPUT_ENABLED) {
      const now = new Date();
      for (const team of teams) {
        if (team.cyclesEnabled) {
          try {
            // Fetch current and upcoming cycles
            const cyclesConn = await team.cycles({ first: 5 });
            for (const cycle of cyclesConn.nodes) {
              const startsAt = cycle.startsAt ? new Date(cycle.startsAt) : undefined;
              const endsAt = cycle.endsAt ? new Date(cycle.endsAt) : undefined;
              const isActive = startsAt && endsAt && now >= startsAt && now <= endsAt;
              const isUpcoming = startsAt && startsAt > now;

              // Include current and upcoming cycles
              if (isActive || isUpcoming) {
                workspaceData.cycles.push({
                  id: cycle.id,
                  number: cycle.number,
                  name: cycle.name ?? undefined,
                  startsAt: cycle.startsAt,
                  endsAt: cycle.endsAt,
                  active: isActive ?? false,
                  progress: cycle.progress,
                  teamId: team.id,
                });
              }
            }
          } catch {
            // Cycles not enabled or error fetching
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Build and store registry (for TOON output)
    // ─────────────────────────────────────────────────────────────────────────

    let registry = {
      usersByUuid: new Map<string, string>(),
      projectsByUuid: new Map<string, string>(),
      statesByUuid: new Map<string, string>(),
    };

    if (config.TOON_OUTPUT_ENABLED) {
      // Prepare registry build data with full metadata
      const registryData: RegistryBuildData = {
        users: workspaceData.users.map((u) => ({
          id: u.id,
          createdAt: u.createdAt ?? new Date(0),
          name: u.name ?? '',
          displayName: u.displayName ?? '',
          email: u.email ?? '',
          active: u.active ?? true,
        })),
        states: workspaceData.states.map((s) => ({
          id: s.id,
          createdAt: s.createdAt ?? new Date(0),
          name: s.name,
          type: s.type ?? '',
        })),
        projects: workspaceData.projects.map((p) => ({
          id: p.id,
          createdAt: p.createdAt ?? new Date(0),
          name: p.name,
          state: p.state ?? '',
        })),
        workspaceId: workspaceData.viewer?.id ?? 'unknown',
      };

      // Build the registry
      const builtRegistry = buildRegistry(registryData);

      // Store the registry for this session
      storeRegistry(context.sessionId, builtRegistry);

      // Keep reference for TOON encoding
      registry = {
        usersByUuid: builtRegistry.usersByUuid,
        projectsByUuid: builtRegistry.projectsByUuid,
        statesByUuid: builtRegistry.statesByUuid,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Return TOON or legacy format based on flag
    // ─────────────────────────────────────────────────────────────────────────

    if (config.TOON_OUTPUT_ENABLED) {
      // Build TOON response
      const toonResponse = buildToonResponse(workspaceData, registry);
      const toonOutput = encodeResponse(workspaceData, toonResponse);

      return {
        content: [{ type: 'text', text: toonOutput }],
        structuredContent: {
          _toon: true,
          _format: 'workspace_metadata_tier1',
          teams: workspaceData.teams.length,
          users: workspaceData.users.length,
          states: workspaceData.states.length,
          labels: workspaceData.labels.length,
          projects: workspaceData.projects.length,
          cycles: workspaceData.cycles.length,
        },
      };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy format (TOON_OUTPUT_ENABLED=false)
    // ─────────────────────────────────────────────────────────────────────────

    const result: Record<string, unknown> = {};

    if (include.includes('profile') && workspaceData.viewer) {
      result.viewer = {
        id: workspaceData.viewer.id,
        name: workspaceData.viewer.name ?? undefined,
        email: workspaceData.viewer.email ?? undefined,
        displayName: workspaceData.viewer.displayName ?? undefined,
        timezone: workspaceData.viewer.timezone ?? undefined,
      };
    }

    if (include.includes('teams')) {
      result.teams = teams.map((t) => ({
        id: t.id,
        key: t.key ?? undefined,
        name: t.name,
        description: t.description ?? undefined,
        defaultIssueEstimate: t.defaultIssueEstimate ?? undefined,
        cyclesEnabled: t.cyclesEnabled,
        issueEstimationAllowZero: t.issueEstimationAllowZero,
        issueEstimationExtended: t.issueEstimationExtended,
        issueEstimationType: t.issueEstimationType,
      }));
    }

    if (include.includes('workflow_states')) {
      result.workflowStatesByTeam = Object.fromEntries(
        Object.entries(statesByTeamComputed).map(([teamId, states]) => [
          teamId,
          states.map((s) => ({ id: s.id, name: s.name, type: s.type })),
        ]),
      );
    }

    if (include.includes('labels')) {
      result.labelsByTeam = labelsByTeamComputed;
    }

    if (include.includes('favorites')) {
      try {
        const favConn = (await client.favorites({ first: 100 })) as unknown as {
          nodes: Array<{
            id: string;
            type?: string;
            url?: string;
            projectId?: string;
            issueId?: string;
          }>;
        };
        result.favorites = favConn.nodes.map((f) => ({
          id: f.id,
          type: f.type,
          url: f.url,
          projectId: f.projectId,
          issueId: f.issueId,
        }));
      } catch {
        // ignore favorites errors; not essential
      }
    }

    if (include.includes('projects')) {
      result.projects = projectsLocal;
    }

    const summary = {
      teamCount: teams.length,
      stateCount: Object.values(statesByTeamComputed).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      ),
      labelCount: Object.values(labelsByTeamComputed).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      ),
      projectCount: projectsLocal.length,
    };
    result.summary = summary;

    // Build quickLookup for easy access
    const quickLookup: Record<string, unknown> = {};
    if (result.viewer) {
      const viewer = result.viewer as Record<string, unknown>;
      quickLookup.viewerId = viewer.id;
      quickLookup.viewerName = viewer.name;
      quickLookup.viewerEmail = viewer.email;
    }
    if (teams.length > 0) {
      quickLookup.teamIds = teams.map((t) => t.id);
      quickLookup.teamByKey = Object.fromEntries(
        teams.filter((t) => t.key).map((t) => [t.key, t.id]),
      );
      quickLookup.teamByName = Object.fromEntries(teams.map((t) => [t.name, t.id]));
    }
    if (Object.keys(statesByTeamComputed).length > 0) {
      // Flatten all states into a single lookup by name
      const stateIdByName: Record<string, string> = {};
      for (const states of Object.values(statesByTeamComputed)) {
        for (const s of states) {
          stateIdByName[s.name] = s.id;
        }
      }
      quickLookup.stateIdByName = stateIdByName;
    }
    if (Object.keys(labelsByTeamComputed).length > 0) {
      // Flatten all labels into a single lookup by name
      const labelIdByName: Record<string, string> = {};
      for (const labels of Object.values(labelsByTeamComputed)) {
        for (const l of labels) {
          labelIdByName[l.name] = l.id;
        }
      }
      quickLookup.labelIdByName = labelIdByName;
    }
    if (result.projects && Array.isArray(result.projects)) {
      quickLookup.projectIdByName = Object.fromEntries(
        (result.projects as Array<{ name: string; id: string }>).map((p) => [
          p.name,
          p.id,
        ]),
      );
    }
    result.quickLookup = quickLookup;

    // Build meta
    const meta = {
      nextSteps: [
        'Use quickLookup for fast ID resolution.',
        'Use team IDs with list_issues to fetch issues.',
        'Use stateIdByName to update issue states.',
        'Use labelIdByName for label operations.',
      ],
      relatedTools: ['list_issues', 'create_issues', 'update_issues', 'list_projects'],
    };
    result.meta = meta;

    const structured = AccountOutputSchema.parse(result);
    const parts: Array<{ type: 'text'; text: string }> = [];

    const viewerBit = structured.viewer
      ? `${structured.viewer.displayName ?? structured.viewer.name ?? structured.viewer.id}`
      : `not requested (include 'profile' to fetch viewer)`;
    const viewerIdBit = structured.viewer?.id
      ? ` (viewer.id: ${structured.viewer.id})`
      : '';

    const teamPreview: string[] = Array.isArray(structured.teams)
      ? previewLinesFromItems(
          structured.teams as unknown as Record<string, unknown>[],
          (t) => {
            const id = String(t.id ?? '');
            const key = t.key as string | undefined;
            const name = t.name as string | undefined;
            return `${key ? `${key} — ` : ''}${name ?? id} (${id})`;
          },
        )
      : [];

    const summaryLines: string[] = [];
    summaryLines.push(
      summarizeList({
        subject: 'Teams',
        count: teams.length,
        previewLines: teamPreview,
        nextSteps: ['Use team ids to list issues or workflow states (list_issues).'],
      }),
    );

    if (
      include.includes('workflow_states') &&
      Object.keys(statesByTeamComputed).length > 0
    ) {
      const statePreviewLines: string[] = [];
      for (const [teamId, states] of Object.entries(statesByTeamComputed)) {
        const team = teams.find((t) => t.id === teamId);
        const teamLabel = team?.key ?? team?.name ?? teamId;
        const statesList = states
          .map((s) => `${s.name} [${s.type}] → ${s.id}`)
          .join(', ');
        statePreviewLines.push(`${teamLabel}: ${statesList}`);
      }
      summaryLines.push(
        summarizeList({
          subject: 'Workflow States',
          count: summary.stateCount,
          previewLines: statePreviewLines,
        }),
      );
    }

    if (
      include.includes('projects') &&
      Array.isArray(structured.projects) &&
      structured.projects.length > 0
    ) {
      const projectPreviewLines = (
        structured.projects as Array<{ id: string; name: string; state?: string }>
      ).map((p) => `${p.name} [${p.state ?? 'unknown'}] → ${p.id}`);
      summaryLines.push(
        summarizeList({
          subject: 'Projects',
          count: structured.projects.length,
          previewLines: projectPreviewLines,
        }),
      );
    }

    parts.push({
      type: 'text',
      text: `Loaded workspace bootstrap for ${viewerBit}${viewerIdBit}. ${summaryLines.join(' ')}`,
    });

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});
