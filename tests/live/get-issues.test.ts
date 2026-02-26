/**
 * Live data validation tests for `get_issues` tool.
 *
 * Calls the real get_issues handler with a live API token, parses the TOON
 * output, then verifies every field against direct Linear API fetches.
 * Validates full (non-truncated) descriptions and partial failure handling.
 *
 * Run with: bun test tests/live/get-issues.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import {
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
} from '../../src/shared/toon/registry.js';
import {
  expectFieldMatch,
  formatWithResolution,
  normalizeEmpty,
  stripToonPrefix,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchIssue } from './helpers/linear-api.js';
import { reportFieldComparison } from './helpers/report-collector.js';
import { parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('get_issues live validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ReturnType<typeof createLiveContext>;
  let issueIdentifiers: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // First, get some issue identifiers via list_issues
    const listResult = await listIssuesTool.handler({}, context);
    expect(listResult.isError).not.toBe(true);

    const listParsed = parseToonText(listResult.content[0].text);
    const issuesSection = listParsed.sections.get('issues');
    expect(issuesSection, 'list_issues should return issues section').toBeDefined();
    if (!issuesSection) return;

    issueIdentifiers = issuesSection.rows.map((r) => r.identifier).filter(Boolean);
    expect(issueIdentifiers.length).toBeGreaterThan(0);
  }, 60_000);

  afterAll(() => {
    if (context) clearRegistry(context.sessionId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Single issue detail - full description
  // ─────────────────────────────────────────────────────────────────────────

  it('single issue detail with full (non-truncated) description', async () => {
    const identifier = issueIdentifiers[0];
    expect(identifier).toBeDefined();

    const result = await getIssuesTool.handler({ ids: [identifier] }, context);
    expect(result.isError).not.toBe(true);

    const parsed = parseToonText(result.content[0].text);

    // Verify meta
    expect(parsed.meta.succeeded).toBe('1');
    expect(parsed.meta.failed).toBe('0');

    const issuesSection = parsed.sections.get('issues');
    expect(issuesSection, 'issues section should exist').toBeDefined();
    if (!issuesSection) return;
    expect(issuesSection.rows.length).toBe(1);

    const toonIssue = issuesSection.rows[0];
    expect(toonIssue.identifier).toBe(identifier);

    // Fetch from API for comparison
    const apiIssue = await fetchIssue(identifier);
    const ctx = { entity: 'Issue', identifier, field: '' };

    // Compare ALL fields present in the TOON output header
    const comparisons: Array<{
      field: string;
      toon: string;
      api: string;
      match: boolean;
    }> = [];

    for (const field of issuesSection.fields) {
      const toonValue = toonIssue[field] ?? '';

      switch (field) {
        case 'identifier':
          expect(toonValue, `Issue "${identifier}" identifier`).toBe(
            apiIssue.identifier,
          );
          comparisons.push({
            field: 'identifier',
            toon: toonValue,
            api: apiIssue.identifier ?? '',
            match: toonValue === apiIssue.identifier,
          });
          break;

        case 'title':
          ctx.field = 'title';
          expectFieldMatch(toonValue, apiIssue.title, ctx);
          comparisons.push({
            field: 'title',
            toon: toonValue,
            api: String(apiIssue.title ?? ''),
            match:
              normalizeEmpty(toonValue) === normalizeEmpty(apiIssue.title),
          });
          break;

        case 'priority':
          ctx.field = 'priority';
          expectFieldMatch(toonValue, apiIssue.priority, ctx);
          {
            const toonNum = stripToonPrefix(toonValue);
            const apiNum =
              apiIssue.priority !== null && apiIssue.priority !== undefined
                ? Number(apiIssue.priority)
                : null;
            comparisons.push({
              field: 'priority',
              toon: toonValue,
              api: String(apiIssue.priority ?? ''),
              match:
                (toonNum === null && (apiNum === null || apiNum === 0)) ||
                toonNum === apiNum,
            });
          }
          break;

        case 'estimate':
          ctx.field = 'estimate';
          expectFieldMatch(toonValue, apiIssue.estimate, ctx);
          {
            const toonNum = stripToonPrefix(toonValue);
            const apiNum =
              apiIssue.estimate !== null && apiIssue.estimate !== undefined
                ? Number(apiIssue.estimate)
                : null;
            comparisons.push({
              field: 'estimate',
              toon: toonValue,
              api: String(apiIssue.estimate ?? ''),
              match:
                (toonNum === null && apiNum === null) || toonNum === apiNum,
            });
          }
          break;

        case 'dueDate':
          ctx.field = 'dueDate';
          expectFieldMatch(toonValue, apiIssue.dueDate, ctx);
          {
            const toonDate = normalizeEmpty(toonValue);
            const apiDateRaw = normalizeEmpty(apiIssue.dueDate);
            const apiDateStr = apiDateRaw
              ? String(apiDateRaw).split('T')[0]
              : '';
            comparisons.push({
              field: 'dueDate',
              toon: toonDate,
              api: apiDateStr || apiDateRaw,
              match: toonDate === (apiDateStr || apiDateRaw),
            });
          }
          break;

        case 'createdAt':
          ctx.field = 'createdAt';
          expectFieldMatch(
            toonValue,
            (apiIssue as unknown as { createdAt?: Date | string }).createdAt,
            ctx,
          );
          {
            const apiCreatedAt = (
              apiIssue as unknown as { createdAt?: Date | string }
            ).createdAt;
            const apiStr = apiCreatedAt
              ? apiCreatedAt instanceof Date
                ? apiCreatedAt.toISOString()
                : String(apiCreatedAt)
              : '';
            // TOON may be YYYY-MM-DD or full ISO
            const toonNorm = normalizeEmpty(toonValue);
            const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(toonNorm);
            const apiCmp = isDateOnly ? apiStr.split('T')[0] : apiStr;
            comparisons.push({
              field: 'createdAt',
              toon: toonNorm,
              api: apiStr,
              match: toonNorm === apiCmp,
            });
          }
          break;

        case 'state': {
          const registry = getStoredRegistry(context.sessionId);
          if (registry && normalizeEmpty(toonValue)) {
            const stateUuid = resolveShortKey(registry, 'state', toonValue);
            const apiState = await (
              apiIssue as unknown as {
                state: Promise<{ id: string; name: string }>;
              }
            ).state;
            expect(
              stateUuid,
              `Issue "${identifier}" state key "${toonValue}" should resolve to API state`,
            ).toBe(apiState.id);
            comparisons.push({
              field: 'state',
              toon: formatWithResolution(registry, 'state', toonValue),
              api: apiState.name ?? apiState.id,
              match: stateUuid === apiState.id,
            });
          }
          break;
        }

        case 'assignee': {
          const registry = getStoredRegistry(context.sessionId);
          if (registry && normalizeEmpty(toonValue)) {
            const assigneeUuid = resolveShortKey(registry, 'user', toonValue);
            const apiAssignee = await (
              apiIssue as unknown as {
                assignee: Promise<{ id: string; name: string } | null>;
              }
            ).assignee;
            expect(
              assigneeUuid,
              `Issue "${identifier}" assignee key "${toonValue}" should resolve`,
            ).toBe(apiAssignee?.id);
            comparisons.push({
              field: 'assignee',
              toon: formatWithResolution(registry, 'assignee', toonValue),
              api: apiAssignee?.name ?? apiAssignee?.id ?? '',
              match: assigneeUuid === apiAssignee?.id,
            });
          }
          break;
        }

        case 'team': {
          const apiTeam = await (
            apiIssue as unknown as { team: Promise<{ key: string }> }
          ).team;
          expect(normalizeEmpty(toonValue), `Issue "${identifier}" team`).toBe(
            normalizeEmpty(apiTeam?.key),
          );
          comparisons.push({
            field: 'team',
            toon: toonValue,
            api: apiTeam?.key ?? '',
            match:
              normalizeEmpty(toonValue) === normalizeEmpty(apiTeam?.key),
          });
          break;
        }

        case 'cycle': {
          ctx.field = 'cycle';
          const apiCycle = await (
            apiIssue as unknown as {
              cycle: Promise<{ number: number } | null>;
            }
          ).cycle;
          expectFieldMatch(toonValue, apiCycle?.number ?? null, ctx);
          {
            const toonNum = stripToonPrefix(toonValue);
            const apiNum =
              apiCycle?.number !== null && apiCycle?.number !== undefined
                ? Number(apiCycle.number)
                : null;
            comparisons.push({
              field: 'cycle',
              toon: toonValue,
              api: apiCycle?.number != null ? String(apiCycle.number) : '',
              match:
                (toonNum === null && apiNum === null) || toonNum === apiNum,
            });
          }
          break;
        }

        case 'labels': {
          const apiLabels = await (
            apiIssue as unknown as {
              labels: () => Promise<{
                nodes: Array<{ name: string }>;
              }>;
            }
          ).labels();
          const apiLabelNames = (apiLabels.nodes ?? []).map((l) => l.name).sort();
          const toonLabelNames = normalizeEmpty(toonValue)
            ? toonValue.split(',').sort()
            : [];
          expect(toonLabelNames, `Issue "${identifier}" labels`).toEqual(apiLabelNames);
          comparisons.push({
            field: 'labels',
            toon: toonValue,
            api: apiLabelNames.join(','),
            match:
              JSON.stringify(toonLabelNames) ===
              JSON.stringify(apiLabelNames),
          });
          break;
        }

        case 'desc': {
          // get_issues should NOT truncate descriptions
          const apiDesc = normalizeEmpty(apiIssue.description);
          const toonDesc = normalizeEmpty(toonValue);
          if (apiDesc) {
            expect(
              toonDesc,
              `Issue "${identifier}" desc should be full (non-truncated)`,
            ).toBe(apiDesc);
            // Ensure it does NOT have the truncation suffix
            expect(
              toonDesc.endsWith('... [truncated]'),
              `Issue "${identifier}" desc should NOT be truncated in get_issues detail view`,
            ).toBe(false);
            comparisons.push({
              field: 'desc',
              toon:
                toonDesc.length > 80
                  ? `${toonDesc.slice(0, 80)}...`
                  : toonDesc,
              api:
                apiDesc.length > 80
                  ? `${apiDesc.slice(0, 80)}...`
                  : apiDesc,
              match: toonDesc === apiDesc,
            });
          }
          break;
        }

        // Skip fields that are not directly comparable (url, parent, project, creator)
        default:
          break;
      }
    }

    if (suiteRef && comparisons.length > 0) {
      reportFieldComparison(
        suiteRef,
        identifier,
        toonIssue.title,
        comparisons,
        'Issue',
      );
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Multiple issues
  // ─────────────────────────────────────────────────────────────────────────

  it('multiple issues all returned and match API', async () => {
    // Pick up to 3 identifiers
    const ids = issueIdentifiers.slice(0, Math.min(3, issueIdentifiers.length));
    expect(ids.length).toBeGreaterThan(0);

    const result = await getIssuesTool.handler({ ids }, context);
    expect(result.isError).not.toBe(true);

    const parsed = parseToonText(result.content[0].text);

    // Check meta counts
    expect(parsed.meta.succeeded).toBe(String(ids.length));
    expect(parsed.meta.failed).toBe('0');

    const issuesSection = parsed.sections.get('issues');
    expect(issuesSection, 'issues section should exist').toBeDefined();
    if (!issuesSection) return;

    // Verify all requested issues are returned
    const returnedIdentifiers = issuesSection.rows.map((r) => r.identifier);
    for (const id of ids) {
      expect(
        returnedIdentifiers,
        `Requested issue "${id}" should be in the response`,
      ).toContain(id);
    }

    // Verify fields for each issue
    for (const toonIssue of issuesSection.rows) {
      const apiIssue = await fetchIssue(toonIssue.identifier);
      const ctx = { entity: 'Issue', identifier: toonIssue.identifier, field: '' };
      const comparisons: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }> = [];

      ctx.field = 'title';
      expectFieldMatch(toonIssue.title, apiIssue.title, ctx);
      comparisons.push({
        field: 'title',
        toon: toonIssue.title ?? '',
        api: String(apiIssue.title ?? ''),
        match: normalizeEmpty(toonIssue.title) === normalizeEmpty(apiIssue.title),
      });

      ctx.field = 'priority';
      expectFieldMatch(toonIssue.priority, apiIssue.priority, ctx);
      {
        const toonNum = stripToonPrefix(toonIssue.priority);
        const apiNum =
          apiIssue.priority !== null && apiIssue.priority !== undefined
            ? Number(apiIssue.priority)
            : null;
        comparisons.push({
          field: 'priority',
          toon: toonIssue.priority ?? '',
          api: String(apiIssue.priority ?? ''),
          match:
            (toonNum === null && (apiNum === null || apiNum === 0)) ||
            toonNum === apiNum,
        });
      }

      ctx.field = 'estimate';
      expectFieldMatch(toonIssue.estimate, apiIssue.estimate, ctx);
      {
        const toonNum = stripToonPrefix(toonIssue.estimate);
        const apiNum =
          apiIssue.estimate !== null && apiIssue.estimate !== undefined
            ? Number(apiIssue.estimate)
            : null;
        comparisons.push({
          field: 'estimate',
          toon: toonIssue.estimate ?? '',
          api: String(apiIssue.estimate ?? ''),
          match: (toonNum === null && apiNum === null) || toonNum === apiNum,
        });
      }

      if (suiteRef && comparisons.length > 0) {
        reportFieldComparison(
          suiteRef,
          toonIssue.identifier,
          toonIssue.title,
          comparisons,
          'Issue',
        );
      }
    }
  }, 90_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Partial failure
  // ─────────────────────────────────────────────────────────────────────────

  it('partial failure returns valid issue and reports failure', async () => {
    const validId = issueIdentifiers[0];
    expect(validId).toBeDefined();

    const result = await getIssuesTool.handler({ ids: ['FAKE-999', validId] }, context);

    // The tool should not be an error overall (partial success)
    expect(result.isError).not.toBe(true);

    const parsed = parseToonText(result.content[0].text);

    // Check meta: 1 succeeded, 1 failed
    expect(parsed.meta.succeeded, '_meta succeeded count should be 1').toBe('1');
    expect(parsed.meta.failed, '_meta failed count should be 1').toBe('1');
    expect(parsed.meta.total, '_meta total count should be 2').toBe('2');

    // Valid issue should be in the issues section
    const issuesSection = parsed.sections.get('issues');
    expect(issuesSection, 'issues section should exist with valid issue').toBeDefined();
    if (!issuesSection) return;

    const returnedIdentifiers = issuesSection.rows.map((r) => r.identifier);
    expect(
      returnedIdentifiers,
      `Valid issue "${validId}" should be in the response`,
    ).toContain(validId);

    // FAKE-999 should NOT be in the issues section
    expect(returnedIdentifiers, 'FAKE-999 should not be in issues').not.toContain(
      'FAKE-999',
    );
  }, 60_000);
});
