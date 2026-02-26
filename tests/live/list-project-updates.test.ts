/**
 * Live data validation test for list_project_updates.
 *
 * Calls the list_project_updates tool handler with a real API token, parses
 * the TOON output, then compares every field against a direct Linear SDK fetch.
 *
 * Run with: bun test tests/live/list-project-updates.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
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
import {
  reportEntitiesValidated,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('list_project_updates live data validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ToolContext;
  let updatesParsed: ParsedToon | null = null;
  let projectUuid: string | null = null;
  let hasUpdates = false;
  const validatedUpdateIds: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // First, call list_projects to establish registry and find projects
    const projectsParams = { team: 'SQT' };
    const projectsResult = await listProjectsTool.handler(projectsParams, context);
    expect(projectsResult.isError).not.toBe(true);
    reportToolCall(suite, 'list_projects', projectsParams, projectsResult.content[0].text);

    const projectsParsed = parseToonText(projectsResult.content[0].text);
    const projectsSection = projectsParsed.sections.get('projects');

    if (!projectsSection || projectsSection.rows.length === 0) {
      console.warn('No projects found, skipping project updates tests');
      return;
    }

    // Resolve SQT team for UUID lookups
    const teams = await fetchTeams();
    const sqtTeam = teams.find((t) => (t as unknown as { key?: string }).key === 'SQT');
    if (!sqtTeam) return;

    const apiProjects = await fetchProjects(sqtTeam.id);

    // Iterate projects to find one with updates
    for (const project of projectsSection.rows) {
      const shortKey = project.key;
      const updatesParams = { project: shortKey };
      const updatesResult = await listProjectUpdatesTool.handler(
        updatesParams,
        context,
      );
      reportToolCall(suite, 'list_project_updates', updatesParams, updatesResult.content[0].text);
      if (updatesResult.isError) continue;

      const text = updatesResult.content[0].text;
      const parsed = parseToonText(text);
      const updatesSection = parsed.sections.get('projectUpdates');

      if (updatesSection && updatesSection.rows.length > 0) {
        const matched = apiProjects.find((p) => p.name === project.name);
        if (matched) {
          projectUuid = matched.id;
          updatesParsed = parsed;
          hasUpdates = true;
          break;
        }
      }
    }

    if (!hasUpdates) {
      console.warn('No projects with updates found, skipping validation');
    }
  }, 45000);

  afterAll((suite) => {
    if (validatedUpdateIds.length > 0) {
      reportEntitiesValidated(suite, 'projectUpdates', validatedUpdateIds);
    }
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('project updates match API data', async () => {
    if (!hasUpdates || !updatesParsed || !projectUuid) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'project updates match API data',
          'no projects with updates found',
        );
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

      validatedUpdateIds.push(updateId);

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
