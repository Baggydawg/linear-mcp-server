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

/** Max pages to fetch before stopping (safety cap: 20 × 250 = 5,000 projects) */
const MAX_PROJECT_PAGES = 20;

/**
 * Fetch ALL projects globally for stable short key assignment.
 *
 * Paginates through all pages (250 per page) so that every project in
 * the workspace gets a stable short key, regardless of workspace size.
 * Used directly by workspace_metadata (which already has users/teams/states)
 * and internally by fetchWorkspaceDataForRegistry.
 */
export async function fetchGlobalProjects(
  client: LinearClient,
): Promise<RegistryProjectEntity[]> {
  // biome-ignore lint/suspicious/noExplicitAny: Linear SDK Project type lacks index signature
  const allNodes: Array<any> = [];
  let after: string | undefined;
  let pages = 0;

  do {
    const conn = await client.projects({
      first: 250,
      includeArchived: true,
      ...(after ? { after } : {}),
    });
    allNodes.push(...(conn.nodes ?? []));

    const hasNextPage =
      (conn as unknown as { pageInfo?: { hasNextPage?: boolean; endCursor?: string } })
        .pageInfo?.hasNextPage ?? false;
    after = hasNextPage
      ? (conn as unknown as { pageInfo?: { endCursor?: string } }).pageInfo
          ?.endCursor ?? undefined
      : undefined;
    pages++;
    if (!hasNextPage) break;
  } while (pages < MAX_PROJECT_PAGES);

  return allNodes.map((p) => ({
    id: p.id,
    createdAt:
      (p as unknown as { createdAt?: Date | string }).createdAt ?? new Date(),
    name: (p as unknown as { name: string }).name,
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

  // Fetch all teams, their workflow states, members, and project associations
  const teamsConn = await client.teams({ first: 100 });
  const teamsNodes = teamsConn.nodes ?? [];
  const states: RegistryBuildData['states'] = [];
  const userTeamMap = new Map<string, string[]>();
  const projectTeamMap = new Map<string, string[]>();

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

    const teamKey = (team as unknown as { key?: string }).key ?? team.id;

    // Fetch team members for user team-membership enrichment
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

    // Fetch team projects for project-team association
    const teamProjectsConn = await (
      team as unknown as {
        projects: (opts?: {
          first?: number;
          includeArchived?: boolean;
        }) => Promise<{ nodes: Array<{ id: string }> }>;
      }
    ).projects({ first: 100, includeArchived: true });
    for (const project of teamProjectsConn.nodes ?? []) {
      if (!projectTeamMap.has(project.id)) {
        projectTeamMap.set(project.id, []);
      }
      projectTeamMap.get(project.id)!.push(teamKey);
    }
  }

  // Enrich users with team membership
  const usersWithTeams = users.map((u) => ({
    ...u,
    teams: userTeamMap.get(u.id) ?? [],
  }));

  // Fetch projects globally (reuses the standalone fetchGlobalProjects)
  const projects = await fetchGlobalProjects(client);

  // Enrich projects with team associations
  for (const project of projects) {
    project.teamKeys = projectTeamMap.get(project.id);
  }

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
