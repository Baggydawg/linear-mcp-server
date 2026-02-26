/**
 * Live data validation for edge cases and cross-tool behavior.
 *
 * Tests: cross-team state prefixes, empty results, pagination,
 * description truncation, progress rounding, and external/deactivated users.
 *
 * These tests are more likely to encounter unexpected data shapes, so
 * they are written defensively with graceful skips when conditions aren't met.
 *
 * Run with: bun test tests/live/edge-cases.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { listProjectsTool } from '../../src/shared/tools/linear/projects.js';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchTeams } from './helpers/linear-api.js';
import { reportSkip, reportToolCall } from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('edge cases live validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  // Track all contexts for cleanup
  const contexts: Array<{ sessionId: string }> = [];

  beforeAll((suite) => {
    suiteRef = suite;
  });

  afterAll(() => {
    for (const ctx of contexts) {
      clearRegistry(ctx.sessionId);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Cross-team state prefixes
  // ─────────────────────────────────────────────────────────────────────────

  describe('cross-team state prefixes', () => {
    it('SQM issues use prefixed state keys, SQT uses clean keys', async () => {
      // Check if SQM team exists
      const apiTeams = await fetchTeams();
      const sqmTeam = apiTeams.find(
        (t) => (t as unknown as { key?: string }).key === 'SQM',
      );

      if (!sqmTeam) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'SQM issues use prefixed state keys, SQT uses clean keys',
            'SQM team does not exist in workspace',
          );
        return;
      }

      const defaultTeam = process.env.DEFAULT_TEAM;
      if (!defaultTeam) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'SQM issues use prefixed state keys, SQT uses clean keys',
            'DEFAULT_TEAM not set, prefixing logic not active',
          );
        return;
      }

      // Call list_issues for SQM team
      const sqmContext = createLiveContext();
      contexts.push(sqmContext);

      const sqmParams = { team: 'SQM', limit: 5 };
      const sqmResult = await listIssuesTool.handler(sqmParams, sqmContext);
      if (suiteRef)
        reportToolCall(suiteRef, 'list_issues', sqmParams, sqmResult.content[0].text);
      expect(sqmResult.isError).not.toBe(true);

      const sqmParsed = parseToonText(sqmResult.content[0].text);
      const sqmStates = sqmParsed.sections.get('_states');

      if (sqmStates && sqmStates.rows.length > 0) {
        // SQM states should use prefixed keys (sqm:s0, sqm:s1, ...)
        for (const row of sqmStates.rows) {
          expect(
            row.key,
            `SQM state "${row.name}" key should be prefixed with "sqm:" but got "${row.key}"`,
          ).toMatch(/^sqm:s\d+$/);
        }
      }

      // Call list_issues for SQT (default team)
      const sqtContext = createLiveContext();
      contexts.push(sqtContext);

      const sqtParams = { team: 'SQT', limit: 5 };
      const sqtResult = await listIssuesTool.handler(sqtParams, sqtContext);
      if (suiteRef)
        reportToolCall(suiteRef, 'list_issues', sqtParams, sqtResult.content[0].text);
      expect(sqtResult.isError).not.toBe(true);

      const sqtParsed = parseToonText(sqtResult.content[0].text);
      const sqtStates = sqtParsed.sections.get('_states');

      if (sqtStates && sqtStates.rows.length > 0) {
        // SQT (default team) states should use clean keys (s0, s1, ...)
        for (const row of sqtStates.rows) {
          expect(
            row.key,
            `SQT state "${row.name}" key should be clean (no prefix) but got "${row.key}"`,
          ).toMatch(/^s\d+$/);
        }
      }
    }, 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Empty results
  // ─────────────────────────────────────────────────────────────────────────

  describe('empty results', () => {
    it('returns clean response with no matching issues', async () => {
      const context = createLiveContext();
      contexts.push(context);

      // Use a filter combination unlikely to match any issues
      const emptyParams = {
        filter: {
          labels: { name: { in: ['NONEXISTENT_LABEL_12345_XYZZY'] } },
        },
      };
      const result = await listIssuesTool.handler(emptyParams, context);
      if (suiteRef)
        reportToolCall(suiteRef, 'list_issues', emptyParams, result.content[0].text);

      // Should not be an error
      expect(result.isError, 'Empty results should not be an error').not.toBe(true);

      const text = result.content[0].text;
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);

      // Should be parseable TOON
      const parsed = parseToonText(text);

      // The issues section should have 0 rows or be absent
      const issuesSection = parsed.sections.get('issues');
      if (issuesSection) {
        expect(
          issuesSection.rows.length,
          'Issues section should have 0 rows for empty results',
        ).toBe(0);
        expect(issuesSection.count, 'Issues section count should be 0').toBe(0);
      }

      // Meta section should exist and report count of 0
      expect(parsed.meta.count, '_meta count should be "0"').toBe('0');

      // Should not contain error indicators
      expect(text).not.toContain('error');
      expect(text).not.toContain('ERROR');
    }, 30000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Pagination
  // ─────────────────────────────────────────────────────────────────────────

  describe('pagination', () => {
    it('respects limit and reports pagination correctly', async () => {
      const context = createLiveContext();
      contexts.push(context);

      const paginationParams = { limit: 2 };
      const result = await listIssuesTool.handler(paginationParams, context);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'list_issues',
          paginationParams,
          result.content[0].text,
        );

      expect(result.isError).not.toBe(true);

      const parsed = parseToonText(result.content[0].text);
      const issuesSection = parsed.sections.get('issues');

      // Fetched count should be <= 2
      const fetchedCount = issuesSection?.rows.length ?? 0;
      expect(
        fetchedCount,
        `Should fetch at most 2 issues, got ${fetchedCount}`,
      ).toBeLessThanOrEqual(2);

      // Parse _pagination section
      const paginationSection = parsed.sections.get('_pagination');

      if (fetchedCount === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'respects limit and reports pagination correctly',
            'no issues returned',
          );
        return;
      }

      // fetched should match actual number of rows
      if (paginationSection && paginationSection.rows.length > 0) {
        const pRow = paginationSection.rows[0];

        expect(pRow.fetched, `_pagination fetched should be "${fetchedCount}"`).toBe(
          String(fetchedCount),
        );

        // hasMore should be a boolean string
        expect(
          ['true', 'false'],
          `_pagination hasMore should be "true" or "false", got "${pRow.hasMore}"`,
        ).toContain(pRow.hasMore);

        // If hasMore is true, cursor should be non-empty
        if (pRow.hasMore === 'true') {
          expect(
            pRow.cursor,
            '_pagination cursor should be non-empty when hasMore is true',
          ).toBeTruthy();
          expect(
            pRow.cursor.length,
            '_pagination cursor should be a non-trivial string',
          ).toBeGreaterThan(0);
        }
      }

      // The _meta count should match fetched
      expect(parsed.meta.count, `_meta count should be "${fetchedCount}"`).toBe(
        String(fetchedCount),
      );
    }, 30000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Description truncation comparison
  // ─────────────────────────────────────────────────────────────────────────

  describe('description truncation', () => {
    it('list_issues truncates descriptions, get_issues does not', async () => {
      // Step 1: Call list_issues to find an issue with a non-empty description
      const listContext = createLiveContext();
      contexts.push(listContext);

      const listParams = { limit: 20 };
      const listResult = await listIssuesTool.handler(listParams, listContext);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'list_issues',
          listParams,
          listResult.content[0].text,
        );
      expect(listResult.isError).not.toBe(true);

      const listParsed = parseToonText(listResult.content[0].text);
      const issuesSection = listParsed.sections.get('issues');

      if (!issuesSection || issuesSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'list_issues truncates descriptions, get_issues does not',
            'no issues returned',
          );
        return;
      }

      // Find an issue with a non-empty description
      const issueWithDesc = issuesSection.rows.find(
        (r) => r.desc && r.desc.trim().length > 0,
      );

      if (!issueWithDesc) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'list_issues truncates descriptions, get_issues does not',
            'no issues with descriptions found',
          );
        return;
      }

      const identifier = issueWithDesc.identifier;
      const listDesc = issueWithDesc.desc;

      // Step 2: Call get_issues for the same issue
      const getContext = createLiveContext();
      contexts.push(getContext);

      const getParams = { ids: [identifier] };
      const getResult = await getIssuesTool.handler(getParams, getContext);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'get_issues',
          getParams,
          getResult.content[0].text,
        );
      expect(getResult.isError).not.toBe(true);

      const getParsed = parseToonText(getResult.content[0].text);
      const getIssuesSection = getParsed.sections.get('issues');
      expect(
        getIssuesSection,
        'get_issues should return an issues section',
      ).toBeDefined();

      const getIssue = getIssuesSection!.rows.find((r) => r.identifier === identifier);
      expect(getIssue, `get_issues should return issue ${identifier}`).toBeDefined();

      const getDesc = getIssue!.desc;

      // Step 3: Compare descriptions
      if (listDesc.endsWith('... [truncated]')) {
        // list_issues truncated the description
        // The truncated prefix should be a prefix of the full description
        const truncatedContent = listDesc.replace(/\.\.\. \[truncated\]$/, '');
        expect(
          getDesc.startsWith(truncatedContent),
          `Truncated list_issues desc should be a prefix of get_issues desc for ${identifier}`,
        ).toBe(true);

        // get_issues should have more content
        expect(
          getDesc.length,
          `get_issues desc should be longer than list_issues desc for ${identifier}`,
        ).toBeGreaterThan(listDesc.length);

        // get_issues should NOT be truncated
        expect(
          getDesc.endsWith('... [truncated]'),
          `get_issues desc should NOT be truncated for ${identifier}`,
        ).toBe(false);
      } else {
        // Short description -- both should match (or the get_issues desc might
        // differ only by image stripping; be lenient)
        // Note: both tools strip markdown images, so we compare what we got
        expect(
          listDesc,
          `Short desc should match between list_issues and get_issues for ${identifier}`,
        ).toBe(getDesc);
      }
    }, 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Progress rounding validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('progress rounding', () => {
    it('workspace_metadata rounds progress, list_projects does not', async () => {
      // Step 1: Call workspace_metadata and parse _projects
      const wmContext = createLiveContext();
      contexts.push(wmContext);

      const wmParams = {};
      const wmResult = await workspaceMetadataTool.handler(wmParams, wmContext);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'workspace_metadata',
          wmParams,
          wmResult.content[0].text,
        );
      expect(wmResult.isError).not.toBe(true);

      const wmParsed = parseToonText(wmResult.content[0].text);
      const wmProjects = wmParsed.sections.get('_projects');

      if (!wmProjects || wmProjects.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'workspace_metadata rounds progress, list_projects does not',
            'no projects in workspace_metadata',
          );
        return;
      }

      // For workspace_metadata projects with progress values,
      // verify they look like properly rounded values (at most 2 decimal places)
      for (const row of wmProjects.rows) {
        if (row.progress && row.progress !== '') {
          const progressNum = parseFloat(row.progress);
          if (!Number.isNaN(progressNum)) {
            // Rounding to 2 decimal places means the value should survive
            // a round-trip: Math.round(x * 100) / 100 === x
            const rounded = Math.round(progressNum * 100) / 100;
            expect(
              progressNum,
              `workspace_metadata project "${row.name}" progress ${row.progress} should be rounded to 2 decimals`,
            ).toBe(rounded);
          }
        }
      }

      // Step 2: Call list_projects and parse projects
      const lpContext = createLiveContext();
      contexts.push(lpContext);

      const lpParams = { team: 'SQT' };
      const lpResult = await listProjectsTool.handler(lpParams, lpContext);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'list_projects',
          lpParams,
          lpResult.content[0].text,
        );
      expect(lpResult.isError).not.toBe(true);

      const lpParsed = parseToonText(lpResult.content[0].text);
      const lpProjects = lpParsed.sections.get('projects');

      if (!lpProjects || lpProjects.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'workspace_metadata rounds progress, list_projects does not',
            'no projects from list_projects',
          );
        return;
      }

      // For list_projects, the progress value is the raw API value.
      // We just verify it's a valid number (we can't verify it's NOT rounded
      // since the raw value might happen to already be rounded).
      for (const row of lpProjects.rows) {
        if (row.progress && row.progress !== '' && row.progress !== '0') {
          const progressNum = parseFloat(row.progress);
          expect(
            Number.isNaN(progressNum),
            `list_projects project "${row.name}" progress "${row.progress}" should be a valid number`,
          ).toBe(false);

          // Compare against workspace_metadata for the same project (by name)
          const wmRow = wmProjects.rows.find((r) => r.name === row.name);
          if (wmRow && wmRow.progress && wmRow.progress !== '') {
            const wmProgressNum = parseFloat(wmRow.progress);
            // The workspace_metadata rounded value should equal
            // Math.round(rawValue * 100) / 100 applied to the list_projects value
            const expectedRounded = Math.round(progressNum * 100) / 100;
            expect(
              wmProgressNum,
              `workspace_metadata progress for "${row.name}" (${wmRow.progress}) should be Math.round(${row.progress} * 100) / 100 = ${expectedRounded}`,
            ).toBe(expectedRounded);
          }
        }
      }
    }, 60000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. External/deactivated users (conditional)
  // ─────────────────────────────────────────────────────────────────────────

  describe('external/deactivated users', () => {
    it('external users have preserved names', async () => {
      const context = createLiveContext();
      contexts.push(context);

      const extParams = { limit: 50 };
      const result = await listIssuesTool.handler(extParams, context);
      if (suiteRef)
        reportToolCall(suiteRef, 'list_issues', extParams, result.content[0].text);
      expect(result.isError).not.toBe(true);

      const parsed = parseToonText(result.content[0].text);
      const usersSection = parsed.sections.get('_users');

      if (!usersSection || usersSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'external users have preserved names',
            'no users in lookup',
          );
        return;
      }

      // Scan for any user with an "ext" prefix key
      const extUsers = usersSection.rows.filter((r) => r.key.startsWith('ext'));

      if (extUsers.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'external users have preserved names',
            'no external users found in workspace',
          );
        return;
      }

      // For each external user, verify the name is preserved (not empty)
      for (const extUser of extUsers) {
        expect(
          extUser.name,
          `External user "${extUser.key}" should have a non-empty name`,
        ).toBeTruthy();
        expect(
          extUser.name.length,
          `External user "${extUser.key}" name should be non-trivial`,
        ).toBeGreaterThan(0);
        expect(
          extUser.name,
          `External user "${extUser.key}" name should not be "Unknown User"`,
        ).not.toBe('Unknown User');
      }

      // Also verify ext users are referenced in at least one issue
      const issuesSection = parsed.sections.get('issues');
      if (issuesSection) {
        for (const extUser of extUsers) {
          const referencedInIssue = issuesSection.rows.some(
            (r) => r.assignee === extUser.key || r.creator === extUser.key,
          );
          expect(
            referencedInIssue,
            `External user "${extUser.key}" (${extUser.name}) should be referenced by at least one issue`,
          ).toBe(true);
        }
      }
    }, 30000);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-tool project short key consistency
  // ─────────────────────────────────────────────────────────────────────────

  describe('cross-tool project key consistency', () => {
    it('workspace_metadata and list_projects assign the same short keys to the same projects', async () => {
      const ctx = createLiveContext();
      contexts.push(ctx);

      // Call workspace_metadata first (builds the registry)
      const wmResult = await workspaceMetadataTool.handler(
        { teamIds: ['SQT'] },
        ctx,
      );
      expect(wmResult.isError).not.toBe(true);
      const wmParsed = parseToonText(wmResult.content[0].text);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'workspace_metadata',
          { teamIds: ['SQT'] },
          wmResult.content[0].text,
        );

      // Call list_projects (uses the same registry)
      const lpResult = await listProjectsTool.handler({ team: 'SQT' }, ctx);
      expect(lpResult.isError).not.toBe(true);
      const lpParsed = parseToonText(lpResult.content[0].text);
      if (suiteRef)
        reportToolCall(
          suiteRef,
          'list_projects',
          { team: 'SQT' },
          lpResult.content[0].text,
        );

      // Extract project name->key maps from both tools
      const wmProjects = wmParsed.sections.get('_projects');
      const lpProjects = lpParsed.sections.get('projects');

      if (!wmProjects || !lpProjects) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'workspace_metadata and list_projects assign the same short keys',
            'one or both tools returned no projects',
          );
        return;
      }

      const wmKeyByName = new Map<string, string>();
      for (const row of wmProjects.rows) {
        wmKeyByName.set(row.name, row.key);
      }

      const lpKeyByName = new Map<string, string>();
      for (const row of lpProjects.rows) {
        lpKeyByName.set(row.name, row.key);
      }

      // Every project in list_projects that also appears in workspace_metadata
      // must have the same short key
      let matchCount = 0;
      for (const [name, lpKey] of lpKeyByName) {
        const wmKey = wmKeyByName.get(name);
        if (wmKey) {
          expect(
            lpKey,
            `Project "${name}" has key "${lpKey}" in list_projects but "${wmKey}" in workspace_metadata`,
          ).toBe(wmKey);
          matchCount++;
        }
      }

      // Sanity: we should have at least one overlapping project
      expect(
        matchCount,
        'Expected at least one project to appear in both workspace_metadata and list_projects',
      ).toBeGreaterThan(0);
    }, 30000);
  });
});
