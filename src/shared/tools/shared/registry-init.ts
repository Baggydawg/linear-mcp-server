/**
 * Shared registry initialization — single source of truth for workspace data
 * used to build the TOON short-key registry.
 *
 * Previously, 7 tool files each had their own copy of fetchWorkspaceDataForRegistry
 * with slightly different project sources, limits, and metadata fields. This module
 * consolidates them into one function that:
 * - Fetches users (first: 200) for comprehensive user coverage
 * - Fetches projects globally (first: 250, includeArchived) for stable short keys
 * - Fetches all teams, states, and team members for cross-team resolution
 * - Extracts full project metadata (priority, progress, leadId, targetDate)
 */

import { config } from '../../../config/env.js';
import type { getLinearClient } from '../../../services/linear/client.js';
import type {
  RegistryBuildData,
  RegistryProjectEntity,
} from '../../toon/index.js';

/** Linear client type extracted from getLinearClient return */
type LinearClient = Awaited<ReturnType<typeof getLinearClient>>;

/**
 * Fetch ALL projects globally for stable short key assignment.
 *
 * Returns the full project set (up to 250, including archived) so that
 * short keys (pr0, pr1, ...) are deterministic regardless of team filtering.
 * Used directly by workspace_metadata (which already has users/teams/states)
 * and internally by fetchWorkspaceDataForRegistry.
 */
export async function fetchGlobalProjects(
  client: LinearClient,
): Promise<RegistryProjectEntity[]> {
  const projectsConn = await client.projects({
    first: 250,
    includeArchived: true,
  });
  return (projectsConn.nodes ?? []).map((p) => ({
    id: p.id,
    createdAt:
      (p as unknown as { createdAt?: Date | string }).createdAt ?? new Date(),
    name: p.name,
    state: (p as unknown as { state?: string }).state ?? '',
    priority: (p as unknown as { priority?: number }).priority,
    progress: (p as unknown as { progress?: number }).progress,
    leadId: (p as unknown as { leadId?: string }).leadId,
    targetDate: (p as unknown as { targetDate?: string }).targetDate,
  }));
}

/**
 * Fetch workspace data for registry initialization with full metadata.
 *
 * This is the single shared implementation used by all tools via getOrInitRegistry.
 * Returns RegistryBuildData suitable for buildRegistry().
 */
export async function fetchWorkspaceDataForRegistry(
  client: LinearClient,
): Promise<RegistryBuildData> {
  // Fetch users with full metadata (200 to cover large workspaces)
  const usersConn = await client.users({ first: 200 });
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

  // Fetch all teams, their workflow states, and team members
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

    // Fetch team members for user team-membership enrichment
    const teamKey = (team as unknown as { key?: string }).key ?? team.id;
    const membersConn = await (
      team as unknown as {
        members: (opts: {
          first: number;
        }) => Promise<{ nodes: Array<{ id: string }> }>;
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

  // Fetch projects globally (reuses the standalone fetchGlobalProjects)
  const projects = await fetchGlobalProjects(client);

  // Get workspace ID from viewer
  const viewer = await client.viewer;
  const viewerOrg = viewer as unknown as {
    organization?: { id?: string };
  };
  const workspaceId = viewerOrg?.organization?.id ?? 'unknown';

  // Build teams array for multi-team support
  const teams = teamsNodes.map((t) => ({
    id: t.id,
    key: (t as unknown as { key?: string }).key ?? t.id,
  }));

  // Resolve defaultTeamId from config.DEFAULT_TEAM
  let defaultTeamId: string | undefined;
  if (config.DEFAULT_TEAM) {
    const defaultTeamKey = config.DEFAULT_TEAM.toLowerCase();
    const matchedTeam = teamsNodes.find(
      (t) =>
        (t as unknown as { key?: string }).key?.toLowerCase() ===
          defaultTeamKey || t.id === config.DEFAULT_TEAM,
    );
    defaultTeamId = matchedTeam?.id;
  }

  return {
    users: usersWithTeams,
    states,
    projects,
    workspaceId,
    teams,
    defaultTeamId,
  };
}
