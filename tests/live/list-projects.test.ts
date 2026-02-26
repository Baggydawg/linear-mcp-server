/**
 * Live data validation test for list_projects.
 *
 * Calls the list_projects tool handler with a real API token, parses the
 * TOON output, then compares every field against a direct Linear SDK fetch.
 *
 * Run with: bun test tests/live/list-projects.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listProjectsTool } from '../../src/shared/tools/linear/projects.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import {
  expectDateMatch,
  type FieldContext,
  normalizeEmpty,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchProjects, fetchTeams, fetchUsers } from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('list_projects live data validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ToolContext;
  let parsed: ParsedToon;
  let sqtTeamId: string;
  const validatedProjectNames: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // Resolve SQT team ID for direct API calls
    const teams = await fetchTeams();
    const sqtTeam = teams.find((t) => (t as unknown as { key?: string }).key === 'SQT');
    expect(sqtTeam, 'SQT team must exist in workspace').toBeDefined();
    sqtTeamId = sqtTeam?.id ?? '';

    // Call the list_projects tool
    const params = { team: 'SQT' };
    const result = await listProjectsTool.handler(params, context);
    expect(result.isError).not.toBe(true);
    reportToolCall(suite, 'list_projects', params, result.content[0].text);

    const text = result.content[0].text;
    expect(text).toBeDefined();
    parsed = parseToonText(text);
  }, 30000);

  afterAll((suite) => {
    if (validatedProjectNames.length > 0) {
      reportEntitiesValidated(suite, 'projects', validatedProjectNames);
    }
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('default team projects match API data', async () => {
    const projectsSection = parsed.sections.get('projects');
    if (!projectsSection || projectsSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'default team projects match API data',
          'no projects found for SQT team',
        );
      return;
    }

    // Fetch projects via direct API
    const apiProjects = await fetchProjects(sqtTeamId);

    // Build user map for lead resolution
    const apiUsers = await fetchUsers();
    const userIdToName = new Map<string, string>();
    for (const u of apiUsers) {
      userIdToName.set(u.id, u.name);
    }

    // Build users lookup from TOON output for short key resolution
    const usersSection = parsed.sections.get('_users');
    const shortKeyToUserName = new Map<string, string>();
    if (usersSection) {
      for (const row of usersSection.rows) {
        shortKeyToUserName.set(row.key, row.name);
      }
    }

    // Verify all project keys are unique
    const allKeys = projectsSection.rows.map((r) => r.key);
    const uniqueKeys = new Set(allKeys);
    expect(
      uniqueKeys.size,
      `Project keys should be unique (got ${allKeys.length} keys but only ${uniqueKeys.size} unique)`,
    ).toBe(allKeys.length);

    for (const toonRow of projectsSection.rows) {
      // Verify short key format
      expect(toonRow.key).toMatch(/^pr\d+$/);

      // Match by name since TOON uses short keys (pr0, pr1) not UUIDs
      const apiProject = apiProjects.find((p) => p.name === toonRow.name);

      expect(
        apiProject,
        `Project "${toonRow.name}" (key=${toonRow.key}) from TOON not found in API response`,
      ).toBeDefined();
      if (!apiProject) continue;

      const projectId = `key=${toonRow.key}, name="${toonRow.name}"`;
      const ctx = (field: string): FieldContext => ({
        entity: 'Project',
        identifier: projectId,
        field,
      });

      // Compare name
      expect(toonRow.name, `Project ${projectId} field "name"`).toBe(apiProject.name);

      // Compare state
      const apiState = (apiProject as unknown as { state?: string }).state ?? '';
      expect(
        normalizeEmpty(toonRow.state),
        `Project ${projectId} field "state": TOON="${toonRow.state}" vs API="${apiState}"`,
      ).toBe(normalizeEmpty(apiState));

      // Compare priority (raw number, NOT prefixed)
      const apiPriority = (apiProject as unknown as { priority?: number }).priority;
      const toonPriority = toonRow.priority !== '' ? Number(toonRow.priority) : null;
      const apiPriorityNum =
        apiPriority !== null && apiPriority !== undefined ? Number(apiPriority) : null;
      if (toonPriority !== null || apiPriorityNum !== null) {
        expect(
          toonPriority,
          `Project ${projectId} field "priority": TOON="${toonRow.priority}" vs API="${apiPriority}"`,
        ).toBe(apiPriorityNum);
      }

      // Compare progress (raw value, NOT rounded for list_projects)
      const apiProgress = (apiProject as unknown as { progress?: number }).progress;
      const toonProgress =
        toonRow.progress !== '' ? parseFloat(toonRow.progress) : null;
      const apiProgressNum =
        apiProgress !== null && apiProgress !== undefined ? apiProgress : null;
      if (toonProgress !== null || apiProgressNum !== null) {
        expect(
          toonProgress,
          `Project ${projectId} field "progress": TOON="${toonRow.progress}" vs API="${apiProgress}"`,
        ).toBe(apiProgressNum);
      }

      // Verify lead short key resolves to correct user
      if (toonRow.lead && toonRow.lead !== '') {
        const leadName = shortKeyToUserName.get(toonRow.lead);
        const apiLeadId = (apiProject as unknown as { leadId?: string }).leadId;
        if (apiLeadId) {
          const apiLeadName = userIdToName.get(apiLeadId);
          expect(
            leadName,
            `Project ${projectId} field "lead": short key "${toonRow.lead}" should resolve to "${apiLeadName}"`,
          ).toBe(apiLeadName);
        }
      }

      // Compare health
      const apiHealth = (apiProject as unknown as { health?: string }).health ?? '';
      expect(
        normalizeEmpty(toonRow.health),
        `Project ${projectId} field "health": TOON="${toonRow.health}" vs API="${apiHealth}"`,
      ).toBe(normalizeEmpty(apiHealth));

      // Compare startDate
      const apiStartDate = (apiProject as unknown as { startDate?: string }).startDate;
      expectDateMatch(toonRow.startDate, apiStartDate, ctx('startDate'));

      // Compare targetDate
      const apiTargetDate = (apiProject as unknown as { targetDate?: string })
        .targetDate;
      expectDateMatch(toonRow.targetDate, apiTargetDate, ctx('targetDate'));

      validatedProjectNames.push(toonRow.name);
    }
  }, 30000);
});
