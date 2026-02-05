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
import {
  formatProfileForToon,
  getUserProfile,
  loadUserProfiles,
  type UserProfilesConfig,
} from '../../config/user-profiles.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { resolveTeamId } from '../../../utils/resolvers.js';
// Note: config is still imported for USER_PROFILES_* settings
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
  members: (args: { first: number }) => Promise<{
    nodes: UserLike[];
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
    skills?: string[];
    focusArea?: string;
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
    // forceRefresh is accepted as input but currently unused
    // Will be used in the future to force registry rebuild even if one exists
    const _forceRefresh = args.forceRefresh ?? false;
    // Note: 'include' parameter is accepted for backwards compatibility but ignored
    // TOON format always returns all entity types

    const client = await getLinearClient(context);

    // Handle explicit teamIds OR fall back to DEFAULT_TEAM with proper UUID resolution
    let teamIdsFilter = new Set<string>();

    if (args.teamIds && args.teamIds.length > 0) {
      // User provided explicit team IDs - use them as-is
      teamIdsFilter = new Set(args.teamIds);
    } else if (config.DEFAULT_TEAM) {
      // Fall back to DEFAULT_TEAM, resolving key to UUID if needed
      const resolved = await resolveTeamId(client, config.DEFAULT_TEAM);
      if (resolved.success) {
        teamIdsFilter.add(resolved.value);
      } else {
        // Log warning but continue - will fetch all teams
        console.warn(
          `DEFAULT_TEAM '${config.DEFAULT_TEAM}' could not be resolved: ${resolved.error}`,
        );
      }
    }

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

    // Fetch viewer/profile (always needed for registry)
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

    // Fetch teams (always needed for registry)
    let teams: TeamLike[] = [];
    {
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

    // Fetch users (team members if scoped, all users otherwise)
    {
      // Load custom user profiles from config file or env var
      const userProfilesConfig: UserProfilesConfig = loadUserProfiles({
        envJson: config.USER_PROFILES_JSON,
        filePath: config.USER_PROFILES_FILE,
      });

      // Fetch users - use team.members() if team-scoped, otherwise client.users()
      let allUsers: UserLike[] = [];

      if (teams.length > 0 && teamIdsFilter.size > 0) {
        // Team-scoped: fetch members from each team
        for (const team of teams) {
          const membersConn = await team.members({ first: 200 });
          for (const member of membersConn.nodes) {
            // Deduplicate by id (user might be in multiple teams)
            if (!allUsers.some((u) => u.id === member.id)) {
              allUsers.push(member);
            }
          }
        }
      } else {
        // Not team-scoped: fetch all workspace users
        const usersConn = (await client.users({ first: 200 })) as unknown as {
          nodes: UserLike[];
        };
        allUsers = usersConn.nodes;
      }

      workspaceData.users = allUsers.map((u) => {
        // Look up custom profile by email
        const profile = getUserProfile(userProfilesConfig, u.email ?? undefined);
        const formattedRole = formatProfileForToon(profile);

        return {
          id: u.id,
          name: u.name ?? undefined,
          displayName: u.displayName ?? undefined,
          email: u.email ?? undefined,
          active: u.active,
          // Use custom profile role, fall back to Linear's admin/guest/member
          role: formattedRole || (u.admin ? 'Admin' : u.guest ? 'Guest' : 'Member'),
          // Include profile metadata for registry
          skills: profile.skills,
          focusArea: profile.focusArea,
          createdAt: u.createdAt,
        };
      });
    }

    // Fetch workflow states (always fetch for TOON registry)
    for (const team of teams) {
      const states = await team.states();
      for (const s of states.nodes) {
        workspaceData.states.push({
          id: s.id,
          name: s.name,
          type: s.type,
          createdAt: s.createdAt,
          teamId: team.id,
        });
      }
    }

    // Fetch labels (always fetch for TOON registry)
    const labelLimit = args.label_limit ?? 50;
    for (const team of teams) {
      const labels = await team.labels({ first: labelLimit });
      for (const l of labels.nodes) {
        workspaceData.labels.push({
          id: l.id,
          name: l.name,
          color: l.color ?? undefined,
          teamId: team.id,
        });
      }
    }

    // Fetch projects (always fetch for TOON registry)
    const projectLimit = args.project_limit ?? 10;
    for (const team of teams) {
      const conn = await team.projects({ first: projectLimit });
      for (const p of conn.nodes) {
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

    // Fetch cycles (always fetch for TOON registry)
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

    // ─────────────────────────────────────────────────────────────────────────
    // Build and store registry
    // ─────────────────────────────────────────────────────────────────────────

    // Prepare registry build data with full metadata
    const registryData: RegistryBuildData = {
      users: workspaceData.users.map((u) => ({
        id: u.id,
        createdAt: u.createdAt ?? new Date(0),
        name: u.name ?? '',
        displayName: u.displayName ?? '',
        email: u.email ?? '',
        active: u.active ?? true,
        role: u.role,
        skills: u.skills,
        focusArea: u.focusArea,
      })),
      states: workspaceData.states.map((s) => ({
        id: s.id,
        createdAt: s.createdAt ?? new Date(0),
        name: s.name,
        type: s.type ?? '',
        teamId: s.teamId, // Needed for registry filtering
      })),
      projects: workspaceData.projects.map((p) => ({
        id: p.id,
        createdAt: p.createdAt ?? new Date(0),
        name: p.name,
        state: p.state ?? '',
      })),
      workspaceId: workspaceData.viewer?.id ?? 'unknown',
      teamId: teams.length === 1 ? teams[0].id : undefined, // Single team = filter states
    };

    // Build the registry
    const builtRegistry = buildRegistry(registryData);

    // Store the registry for this session
    storeRegistry(context.sessionId, builtRegistry);

    // Keep reference for TOON encoding
    const registry = {
      usersByUuid: builtRegistry.usersByUuid,
      projectsByUuid: builtRegistry.projectsByUuid,
      statesByUuid: builtRegistry.statesByUuid,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Return TOON format
    // ─────────────────────────────────────────────────────────────────────────

    // Build TOON response
    const toonResponse = buildToonResponse(workspaceData, registry);
    const toonOutput = encodeResponse(workspaceData, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
