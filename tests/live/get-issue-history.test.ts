/**
 * Live data validation test for get_issue_history.
 *
 * Calls the get_issue_history tool handler with a real API token, parses
 * the TOON output, then compares against a direct GraphQL API fetch.
 *
 * Note: This is the most complex test because one API history entry may
 * expand into multiple TOON rows (the tool splits multi-field changes into
 * separate rows). We focus on verifying that entries exist and key fields
 * match, rather than exact 1:1 row matching.
 *
 * Run with: bun test tests/live/get-issue-history.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIssueHistoryTool } from '../../src/shared/tools/linear/get-issue-history.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import {
  fetchIssueHistory,
  fetchStates,
  fetchTeams,
  fetchUsers,
} from './helpers/linear-api.js';
import { reportEntitiesValidated, reportSkip } from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('get_issue_history live data validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ToolContext;
  let historyParsed: ParsedToon | null = null;
  let issueIdentifier: string | null = null;
  let hasHistory = false;

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // Call list_issues to find issues, then iterate to find one with history
    const issuesResult = await listIssuesTool.handler(
      { team: 'SQT', limit: 10 },
      context,
    );
    expect(issuesResult.isError).not.toBe(true);

    const issuesParsed = parseToonText(issuesResult.content[0].text);
    const issuesSection = issuesParsed.sections.get('issues');

    if (!issuesSection || issuesSection.rows.length === 0) {
      console.warn('No issues found, skipping issue history tests');
      return;
    }

    // Iterate through issues to find one with history
    for (const issue of issuesSection.rows) {
      const identifier = issue.identifier;
      const historyResult = await getIssueHistoryTool.handler(
        { issueIds: [identifier] },
        context,
      );
      if (historyResult.isError) continue;

      const text = historyResult.content[0].text;
      const parsed = parseToonText(text);
      const historySection = parsed.sections.get('history');

      if (historySection && historySection.rows.length > 0) {
        issueIdentifier = identifier;
        historyParsed = parsed;
        hasHistory = true;
        break;
      }
    }

    if (!hasHistory) {
      console.warn(
        'No issues with history found after checking up to 10, skipping validation',
      );
    }
  }, 45000);

  afterAll((suite) => {
    if (hasHistory && issueIdentifier) {
      reportEntitiesValidated(suite, 'history', [issueIdentifier]);
    }
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('issue history entries match API data', async () => {
    if (!hasHistory || !historyParsed || !issueIdentifier) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'issue history entries match API data',
          'no history entries found',
        );
      return;
    }

    const historySection = historyParsed.sections.get('history');
    expect(historySection).toBeDefined();
    if (!historySection) return;

    // Fetch history via direct GraphQL API
    const apiEntries = await fetchIssueHistory(issueIdentifier, 50);

    // Build lookup maps from TOON output
    const usersSection = historyParsed.sections.get('_users');
    const shortKeyToUserName = new Map<string, string>();
    if (usersSection) {
      for (const row of usersSection.rows) {
        shortKeyToUserName.set(row.key, row.name);
      }
    }

    const statesSection = historyParsed.sections.get('_states');
    const shortKeyToStateName = new Map<string, string>();
    if (statesSection) {
      for (const row of statesSection.rows) {
        shortKeyToStateName.set(row.key, row.name);
      }
    }

    // Build API lookup maps for users and states
    const apiUsers = await fetchUsers();
    const userIdToName = new Map<string, string>();
    for (const u of apiUsers) {
      userIdToName.set(u.id, u.name);
    }

    const teams = await fetchTeams();
    const sqtTeam = teams.find((t) => (t as unknown as { key?: string }).key === 'SQT');
    const stateIdToName = new Map<string, string>();
    if (sqtTeam) {
      const apiStates = await fetchStates(sqtTeam.id);
      for (const s of apiStates) {
        stateIdToName.set(s.id, s.name);
      }
    }

    // Verify that TOON history rows reference valid fields from API entries.
    // The tool reverses entries (oldest first) and expands multi-field changes
    // into separate rows, so we cannot do 1:1 row matching.
    // Instead, we verify that:
    // 1. Each unique (time, field) combination in TOON has a corresponding API entry
    // 2. State transitions resolve to correct state names
    // 3. Actor short keys resolve to correct user names

    // Collect API timestamps for matching
    const apiTimestamps = new Set(apiEntries.map((e) => e.createdAt));

    // Group TOON rows by timestamp for analysis
    const toonByTimestamp = new Map<string, typeof historySection.rows>();
    for (const row of historySection.rows) {
      if (!row.time) continue;
      if (!toonByTimestamp.has(row.time)) {
        toonByTimestamp.set(row.time, []);
      }
      toonByTimestamp.get(row.time)?.push(row);
    }

    // Verify each TOON timestamp exists in API data
    for (const [timestamp, rows] of toonByTimestamp) {
      // Skip "created" entries which may not have matching API timestamps
      if (rows.length === 1 && rows[0].field === 'created') continue;
      // Skip "error" rows
      if (rows.length === 1 && rows[0].field === 'error') continue;

      expect(
        apiTimestamps.has(timestamp),
        `TOON history timestamp "${timestamp}" for issue ${issueIdentifier} not found in API entries`,
      ).toBe(true);
    }

    // Verify state transitions: from/to short keys resolve to correct state names
    const stateRows = historySection.rows.filter((r) => r.field === 'state');
    for (const row of stateRows) {
      // Verify "from" state if present
      if (row.from && row.from !== '') {
        const resolvedFromName = shortKeyToStateName.get(row.from);
        // If it resolved from a short key, verify it matches an API state
        if (resolvedFromName) {
          // Find the matching API entry for this timestamp
          const apiEntry = apiEntries.find((e) => e.createdAt === row.time);
          if (apiEntry?.fromState) {
            expect(
              resolvedFromName,
              `State "from" for ${issueIdentifier} at ${row.time}: TOON key "${row.from}" -> "${resolvedFromName}" vs API "${apiEntry.fromState.name}"`,
            ).toBe(apiEntry.fromState.name);
          }
        }
      }

      // Verify "to" state if present
      if (row.to && row.to !== '') {
        const resolvedToName = shortKeyToStateName.get(row.to);
        if (resolvedToName) {
          const apiEntry = apiEntries.find((e) => e.createdAt === row.time);
          if (apiEntry?.toState) {
            expect(
              resolvedToName,
              `State "to" for ${issueIdentifier} at ${row.time}: TOON key "${row.to}" -> "${resolvedToName}" vs API "${apiEntry.toState.name}"`,
            ).toBe(apiEntry.toState.name);
          }
        }
      }
    }

    // Verify actor resolution: short keys resolve to correct user names
    const actorsVerified = new Set<string>();
    for (const row of historySection.rows) {
      if (!row.actor || row.actor === '' || actorsVerified.has(row.actor)) continue;

      // Check if this is a short key that we can verify
      const resolvedName = shortKeyToUserName.get(row.actor);
      if (resolvedName) {
        // Find the matching API entry to verify actor
        const apiEntry = apiEntries.find((e) => e.createdAt === row.time);
        if (apiEntry?.actor) {
          expect(
            resolvedName,
            `Actor short key "${row.actor}" should resolve to "${apiEntry.actor.name}"`,
          ).toBe(apiEntry.actor.name);
        }
        actorsVerified.add(row.actor);
      }
    }
  }, 30000);

  it('history has expected field types', () => {
    if (!hasHistory || !historyParsed) {
      if (suiteRef)
        reportSkip(suiteRef, 'history has expected field types', 'no history entries');
      return;
    }

    const historySection = historyParsed.sections.get('history');
    if (!historySection) return;

    // Verify TOON schema fields are correct
    expect(historySection.fields).toEqual(
      expect.arrayContaining(['issue', 'time', 'actor', 'field', 'from', 'to']),
    );

    // Verify all rows have the issue identifier
    for (const row of historySection.rows) {
      expect(
        row.issue,
        `History row missing issue identifier at time=${row.time}`,
      ).toBe(issueIdentifier);
    }

    // Verify known field types
    const validFields = new Set([
      'state',
      'assignee',
      'estimate',
      'priority',
      'dueDate',
      'title',
      'project',
      'cycle',
      'parent',
      'team',
      'labels',
      'description',
      'archived',
      'trashed',
      'relation',
      'created',
      'error',
    ]);

    for (const row of historySection.rows) {
      expect(
        validFields.has(row.field),
        `Unexpected field type "${row.field}" in history for ${issueIdentifier} at ${row.time}`,
      ).toBe(true);
    }
  });
});
