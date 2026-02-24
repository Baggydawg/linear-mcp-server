/**
 * Live data validation test for list_project_updates.
 *
 * Calls the list_project_updates tool handler with a real API token, parses
 * the TOON output, then compares every field against a direct Linear SDK fetch.
 *
 * Run with: bun test tests/live/list-project-updates.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listProjectUpdatesTool } from '../../src/shared/tools/linear/project-updates.js';
import { listProjectsTool } from '../../src/shared/tools/linear/projects.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import {
  expectDateMatch,
  type FieldContext,
  normalizeEmpty,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import {
  fetchProjects,
  fetchProjectUpdates,
  fetchTeams,
  fetchUsers,
} from './helpers/linear-api.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.runIf(canRunLiveTests)('list_project_updates live data validation', () => {
  let context: ToolContext;
  let updatesParsed: ParsedToon | null = null;
  let projectUuid: string | null = null;
  let hasUpdates = false;

  beforeAll(async () => {
    context = createLiveContext();

    // First, call list_projects to establish registry and find the first project
    const projectsResult = await listProjectsTool.handler({ team: 'SQT' }, context);
    expect(projectsResult.isError).not.toBe(true);

    const projectsParsed = parseToonText(projectsResult.content[0].text);
    const projectsSection = projectsParsed.sections.get('projects');

    if (!projectsSection || projectsSection.rows.length === 0) {
      console.warn('No projects found, skipping project updates tests');
      return;
    }

    // Get the first project's short key and name so we can look up its UUID
    const firstProject = projectsSection.rows[0];
    const projectName = firstProject.name;
    const projectShortKey = firstProject.key;

    // Resolve project UUID via direct API
    const teams = await fetchTeams();
    const sqtTeam = teams.find((t) => (t as unknown as { key?: string }).key === 'SQT');
    if (!sqtTeam) return;

    const apiProjects = await fetchProjects(sqtTeam.id);
    const matchedProject = apiProjects.find((p) => p.name === projectName);
    if (!matchedProject) return;
    projectUuid = matchedProject.id;

    // Call list_project_updates with the actual short key from the first project
    const updatesResult = await listProjectUpdatesTool.handler(
      { project: projectShortKey },
      context,
    );
    expect(updatesResult.isError).not.toBe(true);

    const text = updatesResult.content[0].text;
    updatesParsed = parseToonText(text);

    // Check if there are any updates
    const updatesSection = updatesParsed.sections.get('projectUpdates');
    hasUpdates = !!updatesSection && updatesSection.rows.length > 0;
  }, 45000);

  afterAll(() => {
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('project updates match API data', async () => {
    if (!hasUpdates || !updatesParsed || !projectUuid) {
      console.warn('No project updates found for first project, skipping validation');
      return;
    }

    const updatesSection = updatesParsed.sections.get('projectUpdates');
    expect(updatesSection).toBeDefined();
    if (!updatesSection) return;

    // Fetch updates via direct API
    const apiUpdates = await fetchProjectUpdates(projectUuid);

    // Build users lookup from TOON output for short key resolution
    const usersSection = updatesParsed.sections.get('_users');
    const shortKeyToUserName = new Map<string, string>();
    if (usersSection) {
      for (const row of usersSection.rows) {
        shortKeyToUserName.set(row.key, row.name);
      }
    }

    // Build API user map
    const apiUsers = await fetchUsers();
    const userIdToName = new Map<string, string>();
    for (const u of apiUsers) {
      userIdToName.set(u.id, u.name);
    }

    for (const toonRow of updatesSection.rows) {
      const updateId = toonRow.id;

      // Match by UUID since project updates include their id
      const apiUpdate = apiUpdates.find((u) => u.id === updateId);

      expect(
        apiUpdate,
        `Project update id="${updateId}" from TOON not found in API response`,
      ).toBeDefined();
      if (!apiUpdate) continue;

      const ctx = (field: string): FieldContext => ({
        entity: 'ProjectUpdate',
        identifier: `id=${updateId}`,
        field,
      });

      // Compare body (NOT truncated in list_project_updates)
      const apiBody = (apiUpdate as unknown as { body?: string }).body ?? '';
      expect(
        normalizeEmpty(toonRow.body),
        `ProjectUpdate id=${updateId} field "body": lengths TOON=${toonRow.body?.length} API=${apiBody.length}`,
      ).toBe(normalizeEmpty(apiBody));

      // Compare health
      const apiHealth = (apiUpdate as unknown as { health?: string }).health ?? '';
      expect(
        normalizeEmpty(toonRow.health),
        `ProjectUpdate id=${updateId} field "health": TOON="${toonRow.health}" vs API="${apiHealth}"`,
      ).toBe(normalizeEmpty(apiHealth));

      // Compare createdAt
      expectDateMatch(toonRow.createdAt, apiUpdate.createdAt, ctx('createdAt'));

      // Verify user short key resolves correctly
      if (toonRow.user && toonRow.user !== '') {
        const toonUserName = shortKeyToUserName.get(toonRow.user);
        // Resolve the API user
        const apiUser = await (
          apiUpdate as unknown as {
            user?: Promise<{ id: string; name?: string } | null>;
          }
        ).user;
        if (apiUser) {
          const apiUserName = apiUser.name ?? userIdToName.get(apiUser.id);
          expect(
            toonUserName,
            `ProjectUpdate id=${updateId} field "user": short key "${toonRow.user}" should resolve to "${apiUserName}"`,
          ).toBe(apiUserName);
        }
      }
    }
  }, 30000);
});
