/**
 * Issue snapshot utilities for tracking state changes
 */

import type { LinearClient } from '@linear/sdk';
import type { IssueSnapshot } from './types.js';

/**
 * Capture a complete snapshot of an issue's current state
 */
export async function captureIssueSnapshot(
  client: LinearClient,
  issueId: string,
): Promise<IssueSnapshot | undefined> {
  try {
    const issue = await client.issue(issueId);
    if (!issue) {
      return undefined;
    }

    const [state, project, assignee, labelsConn, cycleData] = await Promise.all([
      getState(issue),
      getProject(issue),
      getAssignee(issue),
      getLabels(issue),
      getCycle(issue),
    ]);

    const idf = (issue as unknown as { identifier?: string })?.identifier;
    const url = (issue as unknown as { url?: string })?.url;
    const dueDate = (issue as unknown as { dueDate?: string })?.dueDate;
    const priority = (issue as unknown as { priority?: number })?.priority;
    const estimate = (issue as unknown as { estimate?: number })?.estimate;
    const archivedAt = (issue as unknown as { archivedAt?: Date | string | null })
      ?.archivedAt;

    return {
      id: issue.id,
      identifier: idf,
      title: issue.title,
      url,
      stateId: (issue as unknown as { stateId?: string })?.stateId ?? '',
      stateName: state?.name,
      projectId: (issue as unknown as { projectId?: string })?.projectId,
      projectName: project?.name,
      assigneeId: (issue as unknown as { assigneeId?: string })?.assigneeId,
      assigneeName: assignee?.name,
      priority,
      estimate,
      dueDate,
      archivedAt: archivedAt ? String(archivedAt) : undefined,
      cycleId: cycleData?.id,
      cycleNumber: cycleData?.number,
      labels: labelsConn,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get issue state information
 */
async function getState(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const state = await (issue as { state?: Promise<{ id?: string; name?: string }> })
      .state;
    return state;
  } catch {
    return undefined;
  }
}

/**
 * Get issue project information
 */
async function getProject(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const project = await (
      issue as { project?: Promise<{ id?: string; name?: string }> }
    ).project;
    return project;
  } catch {
    return undefined;
  }
}

/**
 * Get issue assignee information
 */
async function getAssignee(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const assignee = await (
      issue as { assignee?: Promise<{ id?: string; name?: string }> }
    ).assignee;
    return assignee;
  } catch {
    return undefined;
  }
}

/**
 * Get issue labels
 */
async function getLabels(issue: unknown): Promise<Array<{ id: string; name: string }>> {
  try {
    const labelsResponse = await (
      issue as {
        labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
      }
    ).labels();
    return labelsResponse.nodes.map((l) => ({ id: l.id, name: l.name }));
  } catch {
    return [];
  }
}

/**
 * Get issue cycle information
 *
 * IMPORTANT: The Linear SDK's lazy-loaded cycle relation can return stale/cached
 * data or the team's active cycle even when no cycle is assigned. To accurately
 * detect null→value transitions, we MUST check the direct cycleId property first.
 * If cycleId is null/undefined, the issue has no cycle assigned - do not await
 * the lazy relation which may return incorrect data.
 */
async function getCycle(
  issue: unknown,
): Promise<{ id?: string; number?: number } | undefined> {
  try {
    // First check the direct cycleId property on the issue
    // This is the authoritative source for whether a cycle is assigned
    const issueObj = issue as {
      cycleId?: string | null;
      cycle?: Promise<{ id?: string; number?: number } | null> | null;
    };

    // If cycleId is null/undefined, the issue has no cycle assigned
    // Do NOT await the lazy relation as it may return incorrect data
    if (!issueObj.cycleId) {
      return undefined;
    }

    // Cycle is assigned - fetch the full cycle data for the number
    const cyclePromise = issueObj.cycle;
    if (cyclePromise === null || cyclePromise === undefined) {
      // cycleId exists but lazy relation doesn't - return just the ID
      return { id: issueObj.cycleId, number: undefined };
    }

    const cycle = await cyclePromise;
    if (!cycle) {
      // cycleId exists but lazy relation returned null - return just the ID
      return { id: issueObj.cycleId, number: undefined };
    }

    return { id: cycle.id, number: cycle.number };
  } catch {
    return undefined;
  }
}

/**
 * Get state name from an issue object
 */
export async function getStateName(issue: unknown): Promise<string | undefined> {
  try {
    const s = await (issue as { state?: Promise<{ name?: string }> }).state;
    return s?.name;
  } catch {
    return undefined;
  }
}

/**
 * Get project name from an issue object
 */
export async function getProjectName(issue: unknown): Promise<string | undefined> {
  try {
    const p = await (issue as { project?: Promise<{ name?: string }> }).project;
    return p?.name;
  } catch {
    return undefined;
  }
}

/**
 * Get assignee name from an issue object
 */
export async function getAssigneeName(issue: unknown): Promise<string | undefined> {
  try {
    const a = await (issue as { assignee?: Promise<{ name?: string }> }).assignee;
    return a?.name;
  } catch {
    return undefined;
  }
}
