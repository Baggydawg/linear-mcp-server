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
import { getLinearClient } from '../../../services/linear/client.js';
import {
  createErrorFromException,
  formatErrorMessage,
} from '../../../utils/errors.js';
import { resolveTeamId } from '../../../utils/resolvers.js';
import {
  formatProfileForToon,
  getUserProfile,
  loadUserProfiles,
  type UserProfilesConfig,
} from '../../config/user-profiles.js';
// Note: config is still imported for USER_PROFILES_* settings
import {
  buildRegistry,
  CYCLE_LOOKUP_SCHEMA,
  encodeResponse,
  getUserStatusLabel,
  LABEL_LOOKUP_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  type RegistryBuildData,
  type RegistryProjectEntity,
  STATE_LOOKUP_SCHEMA,
  storeRegistry,
  TEAM_LOOKUP_SCHEMA,
  type ToonResponse,
  type ToonRow,
  type ToonSection,
  USER_LOOKUP_SCHEMA,
  type UserMetadata,
} from '../../toon/index.js';
import { fetchGlobalProjects } from '../shared/registry-init.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const InputSchema = z.object({
  teamIds: z
    .array(z.string())
    .optional()
    .describe(
      'Filter to specific teams by key (e.g., "SQM") or UUID. Overrides DEFAULT_TEAM when provided.',
    ),
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
    teams?: string[];
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
  registry: {
    usersByUuid: Map<string, string>;
    projectsByUuid: Map<string, string>;
    statesByUuid: Map<string, string>;
    userMetadata: Map<string, UserMetadata>;
  },
  defaultTeamKey?: string,
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

  // _users section - active users only (deactivated users filtered out)
  if (data.users.length > 0) {
    const activeDisplayUsers = data.users.filter((u) => u.active !== false);
    const userItems: ToonRow[] = activeDisplayUsers.map((u) => ({
      key: registry.usersByUuid.get(u.id) ?? '',
      name: u.name ?? '',
      displayName: u.displayName ?? '',
      email: u.email ?? '',
      role: u.role ?? '',
      teams: u.teams?.join(',') || '',
    }));
    sections.push({ schema: USER_LOOKUP_SCHEMA, items: userItems });
  }

  // _states section - ALL states (keys from registry for consistency with downstream tools)
  if (data.states.length > 0) {
    const stateItems: ToonRow[] = data.states
      .map((s) => ({
        key: registry.statesByUuid.get(s.id) ?? '',
        name: s.name,
        type: s.type ?? '',
      }))
      .filter((s) => s.key !== '');
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
      const leadKey = p.leadId
        ? (registry.usersByUuid.get(p.leadId) ?? (registry.userMetadata.get(p.leadId)?.active === false ? '(deactivated)' : '(departed)'))
        : '';
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

  // _cycles section - current + upcoming cycles (includes team key for disambiguation)
  if (data.cycles.length > 0) {
    const teamIdToKey = new Map(data.teams.map((t) => [t.id, t.key ?? t.name]));
    const cycleItems: ToonRow[] = data.cycles.map((c) => ({
      team: teamIdToKey.get(c.teamId) ?? '',
      num: c.number ?? null,
      name: c.name ?? '',
      start: c.startsAt ? formatDate(c.startsAt) : '',
      end: c.endsAt ? formatDate(c.endsAt) : '',
      active: c.active,
      progress: c.progress !== undefined ? Math.round(c.progress * 100) / 100 : null,
    }));
    sections.push({ schema: CYCLE_LOOKUP_SCHEMA, items: cycleItems });
  }

  // Build _meta section - show DEFAULT_TEAM if set, otherwise first team
  const teamKey =
    defaultTeamKey ??
    (data.teams.length > 0 ? (data.teams[0].key ?? data.teams[0].name) : '');

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
    // forceRefresh: workspace_metadata always rebuilds the registry.
    // The parameter is retained for API compatibility but has no conditional effect.

    const client = await getLinearClient(context);

    // ─────────────────────────────────────────────────────────────────────────
    // Resolve DEFAULT_TEAM to UUID for filtering
    // ─────────────────────────────────────────────────────────────────────────

    let defaultTeamUuid: string | undefined;
    const teamIdsFilter = new Set<string>();

    // Always resolve DEFAULT_TEAM for registry key prefixing (clean keys vs prefixed)
    if (config.DEFAULT_TEAM) {
      const resolved = await resolveTeamId(client, config.DEFAULT_TEAM);
      if (resolved.success) {
        defaultTeamUuid = resolved.value;
      } else {
        console.warn(
          `DEFAULT_TEAM '${config.DEFAULT_TEAM}' could not be resolved: ${resolved.error}`,
        );
      }
    }

    // Resolve teamIds filter (accepts team keys or UUIDs)
    if (args.teamIds && args.teamIds.length > 0) {
      for (const idOrKey of args.teamIds) {
        const resolved = await resolveTeamId(client, idOrKey);
        if (resolved.success) {
          teamIdsFilter.add(resolved.value);
        } else {
          console.warn(
            `teamIds value '${idOrKey}' could not be resolved: ${resolved.error}`,
          );
        }
      }
    } else if (defaultTeamUuid) {
      // No explicit teamIds — fall back to DEFAULT_TEAM for filtering
      teamIdsFilter.add(defaultTeamUuid);
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

    // Fetch viewer/profile and teams (both are fatal — tool cannot produce
    // output without them)
    let allTeams: TeamLike[] = [];
    let filteredTeams: TeamLike[] = [];
    try {
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

      // ───────────────────────────────────────────────────────────────────────
      // Fetch ALL teams (registry needs all, TOON output may be filtered)
      // ───────────────────────────────────────────────────────────────────────

      {
        // Always fetch all teams for the registry
        const teamConn = (await client.teams({ first: 100 })) as unknown as {
          nodes: TeamLike[];
        };
        allTeams = teamConn.nodes as TeamLike[];

        // Filter teams for TOON output display
        if (teamIdsFilter.size > 0) {
          filteredTeams = allTeams.filter((t) => teamIdsFilter.has(t.id));
        } else {
          filteredTeams = allTeams;
        }

        // Show ALL teams so Claude knows workspace structure (filtered teams used for states/labels/cycles)
        workspaceData.teams = allTeams.map((t) => ({
          id: t.id,
          key: t.key ?? undefined,
          name: t.name,
          cyclesEnabled: t.cyclesEnabled,
          cycleDuration: t.cycleDuration,
          estimationType: t.issueEstimationType,
          createdAt: t.createdAt,
        }));
      }
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

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch ALL users (registry needs all, TOON output may be filtered)
    // ─────────────────────────────────────────────────────────────────────────

    let allWorkspaceUsers: Array<{
      id: string;
      name?: string;
      displayName?: string;
      email?: string;
      active?: boolean;
      role?: string;
      skills?: string[];
      focusArea?: string;
      createdAt?: Date | string;
      teams?: string[];
    }> = [];
    {
      // Load custom user profiles from config file or env var
      const userProfilesConfig: UserProfilesConfig = loadUserProfiles({
        envJson: config.USER_PROFILES_JSON,
        filePath: config.USER_PROFILES_FILE,
      });

      try {
        // Always fetch ALL workspace users for the registry
        const usersConn = (await client.users({
          first: 200,
          includeDisabled: true,
        })) as unknown as {
          nodes: UserLike[];
        };

        // Transform all users with profile data
        allWorkspaceUsers = usersConn.nodes.map((u) => {
          const profile = getUserProfile(
            userProfilesConfig,
            u.email ?? undefined,
          );
          const formattedRole = formatProfileForToon(profile);

          return {
            id: u.id,
            name: u.name ?? undefined,
            displayName: u.displayName ?? undefined,
            email: u.email ?? undefined,
            active: u.active,
            role:
              formattedRole ||
              (u.admin ? 'Admin' : u.guest ? 'Guest' : 'Member'),
            skills: profile.skills,
            focusArea: profile.focusArea,
            createdAt: u.createdAt,
          };
        });
      } catch (error) {
        console.error(
          'Failed to fetch workspace users:',
          (error as Error).message,
        );
        allWorkspaceUsers = [];
      }

      // Build team membership map for ALL teams (userId -> team keys)
      const userTeamMap = new Map<string, string[]>();
      for (const team of allTeams) {
        try {
          const membersConn = await team.members({ first: 200 });
          const teamKey = team.key ?? team.name;
          for (const member of membersConn.nodes) {
            if (!userTeamMap.has(member.id)) {
              userTeamMap.set(member.id, []);
            }
            userTeamMap.get(member.id)!.push(teamKey);
          }
        } catch {
          // Non-critical: skip this team's members
        }
      }

      // Enrich all users with team membership and show ALL users (no filtering)
      for (const user of allWorkspaceUsers) {
        user.teams = userTeamMap.get(user.id) ?? [];
      }
      workspaceData.users = allWorkspaceUsers;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch states from ALL teams (registry needs all for cross-team resolution)
    // ─────────────────────────────────────────────────────────────────────────

    const allTeamsStates: Array<{
      id: string;
      name: string;
      type?: string;
      teamId: string;
      createdAt?: Date | string;
    }> = [];
    for (const team of allTeams) {
      try {
        const states = await team.states();
        for (const s of states.nodes) {
          allTeamsStates.push({
            id: s.id,
            name: s.name,
            type: s.type,
            createdAt: s.createdAt,
            teamId: team.id,
          });
        }
      } catch {
        // Non-critical: skip this team's states
      }
    }

    // Show ALL teams' states (Claude needs cross-team state awareness)
    workspaceData.states = allTeamsStates;

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch labels from filtered teams (labels are team-scoped, no cross-team needed)
    // ─────────────────────────────────────────────────────────────────────────

    const labelLimit = args.label_limit ?? 50;
    for (const team of filteredTeams) {
      try {
        const labels = await team.labels({ first: labelLimit });
        for (const l of labels.nodes) {
          workspaceData.labels.push({
            id: l.id,
            name: l.name,
            color: l.color ?? undefined,
            teamId: team.id,
          });
        }
      } catch {
        // Non-critical: skip this team's labels
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch projects from filtered teams
    // ─────────────────────────────────────────────────────────────────────────

    const projectLimit = args.project_limit ?? 10;
    for (const team of filteredTeams) {
      try {
        const conn = await team.projects({ first: projectLimit });
        for (const p of conn.nodes) {
          workspaceData.projects.push({
            id: p.id,
            name: p.name,
            state: p.state,
            priority: p.priority,
            progress: p.progress,
            leadId:
              (p as unknown as { leadId?: string }).leadId ?? undefined,
            targetDate: p.targetDate ?? undefined,
            createdAt: p.createdAt,
          });
        }
      } catch {
        // Non-critical: skip this team's projects
      }
    }

    // Deduplicate projects (a project may appear under multiple teams)
    const seenProjectIds = new Set<string>();
    workspaceData.projects = workspaceData.projects.filter((p) => {
      if (seenProjectIds.has(p.id)) return false;
      seenProjectIds.add(p.id);
      return true;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Fetch cycles from filtered teams
    // ─────────────────────────────────────────────────────────────────────────

    const now = new Date();
    for (const team of filteredTeams) {
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

    // Fetch ALL projects globally for the registry (stable short keys).
    // Only fetches projects — workspace_metadata already has users, teams, states.
    // The TOON _projects display section still uses workspaceData.projects (team-filtered).
    let globalProjects: RegistryProjectEntity[] = [];
    try {
      globalProjects = await fetchGlobalProjects(client);
    } catch (error) {
      console.error(
        'Failed to fetch global projects:',
        (error as Error).message,
      );
    }

    // Prepare registry build data with ALL workspace data for cross-team resolution.
    // Uses workspace_metadata's enriched users (with profiles) + global projects.
    const registryData: RegistryBuildData = {
      // ALL workspace users (not filtered) — use workspace_metadata's enriched data
      // which includes profile roles, skills, and focusArea
      users: allWorkspaceUsers.map((u) => ({
        id: u.id,
        createdAt: u.createdAt ?? new Date(0),
        name: u.name ?? '',
        displayName: u.displayName ?? '',
        email: u.email ?? '',
        active: u.active ?? true,
        role: u.role,
        skills: u.skills,
        focusArea: u.focusArea,
        teams: u.teams,
      })),
      // ALL teams' states (not filtered)
      states: allTeamsStates.map((s) => ({
        id: s.id,
        createdAt: s.createdAt ?? new Date(0),
        name: s.name,
        type: s.type ?? '',
        teamId: s.teamId, // Required for team-prefixed keys
      })),
      // ALL projects globally for stable short keys
      projects: globalProjects,
      // ALL teams for multi-team key resolution
      teams: allTeams.map((t) => ({
        id: t.id,
        key: t.key ?? t.name,
      })),
      // Default team UUID for clean keys (s0, s1...) vs prefixed (sqm:s0)
      defaultTeamId: defaultTeamUuid,
      workspaceId: workspaceData.viewer?.id ?? 'unknown',
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
      userMetadata: builtRegistry.userMetadata,
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Return TOON format
    // ─────────────────────────────────────────────────────────────────────────

    // _meta.team: show explicitly requested team if teamIds provided, otherwise DEFAULT_TEAM
    const metaTeamKey =
      args.teamIds && args.teamIds.length > 0 && filteredTeams.length > 0
        ? filteredTeams.length === 1
          ? (filteredTeams[0].key ?? filteredTeams[0].name)
          : filteredTeams.map((t) => t.key ?? t.name).join(',')
        : config.DEFAULT_TEAM;
    const toonResponse = buildToonResponse(workspaceData, registry, metaTeamKey);
    const toonOutput = encodeResponse(workspaceData, toonResponse);

    return {
      content: [{ type: 'text', text: toonOutput }],
    };
  },
});
