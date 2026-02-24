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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import {
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
} from '../../src/shared/toon/registry.js';
import { expectFieldMatch, normalizeEmpty } from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchIssue } from './helpers/linear-api.js';
import { parseToonText } from './helpers/toon-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state across tests
// ─────────────────────────────────────────────────────────────────────────────

let context: ReturnType<typeof createLiveContext>;
let issueIdentifiers: string[] = [];

describe.skipIf(!canRunLiveTests)('get_issues live validation', () => {
  beforeAll(async () => {
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
    for (const field of issuesSection.fields) {
      const toonValue = toonIssue[field] ?? '';

      switch (field) {
        case 'identifier':
          expect(toonValue, `Issue "${identifier}" identifier`).toBe(
            apiIssue.identifier,
          );
          break;

        case 'title':
          ctx.field = 'title';
          expectFieldMatch(toonValue, apiIssue.title, ctx);
          break;

        case 'priority':
          ctx.field = 'priority';
          expectFieldMatch(toonValue, apiIssue.priority, ctx);
          break;

        case 'estimate':
          ctx.field = 'estimate';
          expectFieldMatch(toonValue, apiIssue.estimate, ctx);
          break;

        case 'dueDate':
          ctx.field = 'dueDate';
          expectFieldMatch(toonValue, apiIssue.dueDate, ctx);
          break;

        case 'createdAt':
          ctx.field = 'createdAt';
          expectFieldMatch(
            toonValue,
            (apiIssue as unknown as { createdAt?: Date | string }).createdAt,
            ctx,
          );
          break;

        case 'state': {
          const registry = getStoredRegistry(context.sessionId);
          if (registry && normalizeEmpty(toonValue)) {
            const stateUuid = resolveShortKey(registry, 'state', toonValue);
            const apiState = await (
              apiIssue as unknown as { state: Promise<{ id: string }> }
            ).state;
            expect(
              stateUuid,
              `Issue "${identifier}" state key "${toonValue}" should resolve to API state`,
            ).toBe(apiState.id);
          }
          break;
        }

        case 'assignee': {
          const registry = getStoredRegistry(context.sessionId);
          if (registry && normalizeEmpty(toonValue)) {
            const assigneeUuid = resolveShortKey(registry, 'user', toonValue);
            const apiAssignee = await (
              apiIssue as unknown as {
                assignee: Promise<{ id: string } | null>;
              }
            ).assignee;
            expect(
              assigneeUuid,
              `Issue "${identifier}" assignee key "${toonValue}" should resolve`,
            ).toBe(apiAssignee?.id);
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
          }
          break;
        }

        // Skip fields that are not directly comparable (url, parent, project, creator)
        default:
          break;
      }
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

      ctx.field = 'title';
      expectFieldMatch(toonIssue.title, apiIssue.title, ctx);

      ctx.field = 'priority';
      expectFieldMatch(toonIssue.priority, apiIssue.priority, ctx);

      ctx.field = 'estimate';
      expectFieldMatch(toonIssue.estimate, apiIssue.estimate, ctx);
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
