/**
 * Direct Linear API helper for live data validation tests.
 *
 * Wraps Linear SDK calls to fetch raw API data for comparison against
 * tool output. Creates its OWN LinearClient directly from the
 * LINEAR_ACCESS_TOKEN env var (not via the app's getLinearClient).
 */

import {
  type Comment,
  type Cycle,
  type Issue,
  type IssueLabel,
  LinearClient,
  type Project,
  type ProjectUpdate,
  type Team,
  type User,
  type WorkflowState,
} from '@linear/sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Client
// ─────────────────────────────────────────────────────────────────────────────

let _client: LinearClient | null = null;

/**
 * Get or create a singleton LinearClient from LINEAR_ACCESS_TOKEN env var.
 * Uses apiKey mode since the token starts with `lin_api_`.
 */
export function getDirectClient(): LinearClient {
  if (_client) return _client;

  const token = process.env.LINEAR_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      'LINEAR_ACCESS_TOKEN environment variable is required for live tests',
    );
  }

  _client = token.startsWith('lin_')
    ? new LinearClient({ apiKey: token })
    : new LinearClient({ accessToken: token });

  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch all teams in the workspace.
 * Returns up to 100 teams (matching workspace_metadata pagination).
 */
export async function fetchTeams(): Promise<Team[]> {
  const client = getDirectClient();
  const conn = await client.teams({ first: 100 });
  return conn.nodes;
}

/**
 * Fetch all workspace users.
 * @param first - Max users to fetch. Default: 200 (matches workspace_metadata).
 */
export async function fetchUsers(first = 200): Promise<User[]> {
  const client = getDirectClient();
  const conn = await client.users({ first });
  return conn.nodes;
}

/**
 * Fetch members of a specific team.
 * @param teamId - Team UUID.
 * @param first - Max members to fetch. Default: 200 (matches workspace_metadata).
 */
export async function fetchTeamMembers(teamId: string, first = 200): Promise<User[]> {
  const client = getDirectClient();
  const team = await client.team(teamId);
  const conn = await (
    team as unknown as {
      members: (opts: { first: number }) => Promise<{ nodes: User[] }>;
    }
  ).members({ first });
  return conn.nodes;
}

/**
 * Fetch workflow states for a specific team.
 * @param teamId - Team UUID.
 */
export async function fetchStates(teamId: string): Promise<WorkflowState[]> {
  const client = getDirectClient();
  const team = await client.team(teamId);
  const conn = await (
    team as unknown as {
      states: () => Promise<{ nodes: WorkflowState[] }>;
    }
  ).states();
  return conn.nodes;
}

/**
 * Fetch labels for a specific team.
 * @param teamId - Team UUID.
 * @param first - Max labels to fetch. Default: 50 (matches workspace_metadata).
 */
export async function fetchLabels(teamId: string, first = 50): Promise<IssueLabel[]> {
  const client = getDirectClient();
  const team = await client.team(teamId);
  const conn = await (
    team as unknown as {
      labels: (opts: { first: number }) => Promise<{ nodes: IssueLabel[] }>;
    }
  ).labels({ first });
  return conn.nodes;
}

/**
 * Fetch projects associated with a specific team.
 * @param teamId - Team UUID.
 */
export async function fetchProjects(teamId: string): Promise<Project[]> {
  const client = getDirectClient();
  const team = await client.team(teamId);
  const conn = await (
    team as unknown as {
      projects: (opts: {
        first: number;
        includeArchived?: boolean;
      }) => Promise<{ nodes: Project[] }>;
    }
  ).projects({ first: 100, includeArchived: true });
  return conn.nodes;
}

/**
 * Fetch cycles for a specific team.
 * @param teamId - Team UUID.
 * @param first - Max cycles to fetch. Default: 5 (matches workspace_metadata).
 *   Use 20 when matching list_cycles tool output.
 */
export async function fetchCycles(teamId: string, first = 5): Promise<Cycle[]> {
  const client = getDirectClient();
  const team = await client.team(teamId);
  const conn = await (
    team as unknown as {
      cycles: (opts?: {
        first?: number;
        filter?: Record<string, unknown>;
      }) => Promise<{ nodes: Cycle[] }>;
    }
  ).cycles({ first });
  return conn.nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single issue by identifier (e.g., "SQT-123") or UUID.
 * @param id - Issue identifier or UUID.
 */
export async function fetchIssue(id: string): Promise<Issue> {
  const client = getDirectClient();
  return client.issue(id);
}

/**
 * Fetch relations for an issue using raw GraphQL.
 * Uses the same query pattern as list-issues.ts to ensure comparable results.
 * @param issueId - Issue identifier (e.g., "SQT-123") or UUID.
 */
export async function fetchIssueRelations(
  issueId: string,
): Promise<Array<{ id: string; type: string; relatedIssue: { identifier: string } }>> {
  const client = getDirectClient();

  const RELATIONS_QUERY = `
    query IssueRelations($id: String!) {
      issue(id: $id) {
        relations {
          nodes {
            id
            type
            relatedIssue { identifier }
          }
        }
      }
    }
  `;

  const resp = (await client.client.rawRequest(RELATIONS_QUERY, {
    id: issueId,
  })) as unknown as {
    data?: {
      issue?: {
        relations?: {
          nodes?: Array<{
            id: string;
            type: string;
            relatedIssue: { identifier: string };
          }>;
        };
      };
    };
  };

  return resp.data?.issue?.relations?.nodes ?? [];
}

/**
 * Fetch activity/audit history for an issue using raw GraphQL.
 * Uses the same query pattern as get-issue-history.ts.
 * @param issueId - Issue identifier (e.g., "SQT-123") or UUID.
 * @param first - Max history entries. Default: 50.
 */
export async function fetchIssueHistory(
  issueId: string,
  first = 50,
): Promise<
  Array<{
    id: string;
    createdAt: string;
    actorId?: string | null;
    actor?: { id: string; name: string } | null;
    fromState?: { id: string; name: string; type: string } | null;
    toState?: { id: string; name: string; type: string } | null;
    fromAssignee?: { id: string; name: string } | null;
    toAssignee?: { id: string; name: string } | null;
    fromEstimate?: number | null;
    toEstimate?: number | null;
    fromPriority?: number | null;
    toPriority?: number | null;
    fromDueDate?: string | null;
    toDueDate?: string | null;
    fromTitle?: string | null;
    toTitle?: string | null;
    fromProject?: { id: string; name: string } | null;
    toProject?: { id: string; name: string } | null;
    fromCycle?: { id: string; number: number } | null;
    toCycle?: { id: string; number: number } | null;
    fromParent?: { id: string; identifier: string } | null;
    toParent?: { id: string; identifier: string } | null;
    fromTeam?: { id: string; key: string } | null;
    toTeam?: { id: string; key: string } | null;
    addedLabels?: { id: string; name: string }[] | null;
    removedLabels?: { id: string; name: string }[] | null;
    archived?: boolean | null;
    trashed?: boolean | null;
    updatedDescription?: boolean | null;
    autoArchived?: boolean | null;
    autoClosed?: boolean | null;
    relationChanges?: { identifier: string; type: string }[] | null;
    botActor?: { name: string; type: string } | null;
  }>
> {
  const client = getDirectClient();

  const ISSUE_HISTORY_QUERY = `
    query IssueHistory($id: String!, $first: Int!) {
      issue(id: $id) {
        identifier
        history(first: $first) {
          nodes {
            id
            createdAt
            actorId
            actor { id name }
            fromState { id name type }
            toState { id name type }
            fromAssignee { id name }
            toAssignee { id name }
            fromEstimate
            toEstimate
            fromPriority
            toPriority
            fromDueDate
            toDueDate
            fromTitle
            toTitle
            fromProject { id name }
            toProject { id name }
            fromCycle { id number }
            toCycle { id number }
            fromParent { id identifier }
            toParent { id identifier }
            fromTeam { id key }
            toTeam { id key }
            addedLabels { id name }
            removedLabels { id name }
            archived
            trashed
            updatedDescription
            autoArchived
            autoClosed
            relationChanges { identifier type }
            botActor { name type }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;

  const resp = (await client.client.rawRequest(ISSUE_HISTORY_QUERY, {
    id: issueId,
    first,
  })) as unknown as {
    data?: {
      issue?: {
        identifier: string;
        history?: {
          nodes?: Array<Record<string, unknown>>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        };
      };
    };
  };

  // Return raw nodes cast to the expected type
  return (resp.data?.issue?.history?.nodes ?? []) as ReturnType<
    typeof fetchIssueHistory
  > extends Promise<infer T>
    ? T
    : never;
}

// ─────────────────────────────────────────────────────────────────────────────
// Comment Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch comments for an issue.
 * Uses SDK's issue.comments() method (matching comments.ts pattern).
 * Must await lazy-loaded user relation on each comment.
 * @param issueId - Issue identifier (e.g., "SQT-123") or UUID.
 * @param first - Max comments to fetch. Default: 20 (matches list_comments default).
 */
export async function fetchComments(issueId: string, first = 20): Promise<Comment[]> {
  const client = getDirectClient();
  const issue = await client.issue(issueId);
  const conn = await issue.comments({ first });
  return conn.nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch project updates for a specific project.
 * Uses client.projectUpdates() with a project filter (matching project-updates.ts).
 * Must await lazy-loaded user and project relations on each update.
 * @param projectId - Project UUID.
 * @param first - Max updates to fetch. Default: 20 (matches list_project_updates default).
 */
export async function fetchProjectUpdates(
  projectId: string,
  first = 20,
): Promise<ProjectUpdate[]> {
  const client = getDirectClient();
  const conn = await client.projectUpdates({
    first,
    filter: { project: { id: { eq: projectId } } },
  });
  return conn.nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete an issue. Moves it to Linear's trash (30-day retention).
 * We intentionally avoid `permanentlyDelete: true` so that a bug
 * targeting the wrong UUID can never destroy real company data.
 */
export async function deleteIssue(id: string): Promise<void> {
  const client = getDirectClient();
  await client.deleteIssue(id);
}

/**
 * Delete a project update by its UUID.
 */
export async function deleteProjectUpdate(id: string): Promise<void> {
  const client = getDirectClient();
  await client.deleteProjectUpdate(id);
}
