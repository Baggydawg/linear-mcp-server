/**
 * Live data validation tests for `get_sprint_context` tool.
 *
 * Calls the real get_sprint_context handler with a live API token, parses the
 * TOON output, then verifies cycle metadata, issue fields, and gap analysis
 * against direct Linear API fetches and independent computation.
 *
 * Run with: bun test tests/live/get-sprint-context.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSprintContextTool } from '../../src/shared/tools/linear/get-sprint-context.js';
import {
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
} from '../../src/shared/toon/registry.js';
import { expectFieldMatch, normalizeEmpty } from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchIssue, fetchIssueRelations } from './helpers/linear-api.js';
import type { ParsedToon } from './helpers/toon-parser.js';
import { parseToonText } from './helpers/toon-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

const TEAM_KEY = process.env.DEFAULT_TEAM || 'SQT';

let context: ReturnType<typeof createLiveContext>;
let currentParsed: ParsedToon;
let currentRawText: string;

describe.runIf(canRunLiveTests)('get_sprint_context live validation', () => {
  beforeAll(async () => {
    context = createLiveContext();

    const result = await getSprintContextTool.handler({ team: TEAM_KEY }, context);

    // May fail if team has no active cycle
    if (result.isError) {
      // Store empty parsed so tests can skip gracefully
      currentRawText = '';
      currentParsed = { meta: {}, sections: new Map() };
      return;
    }

    currentRawText = result.content[0].text;
    expect(currentRawText).toBeDefined();
    currentParsed = parseToonText(currentRawText);
  }, 60_000);

  afterAll(() => {
    if (context) clearRegistry(context.sessionId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Current sprint matches API
  // ─────────────────────────────────────────────────────────────────────────

  it('current sprint metadata and issues match API', async () => {
    if (!currentRawText) return; // Skip if no active cycle

    // Verify _meta section
    expect(currentParsed.meta.team).toBe(TEAM_KEY);
    expect(currentParsed.meta.cycle).toBeDefined();
    expect(currentParsed.meta.start).toBeDefined();
    expect(currentParsed.meta.end).toBeDefined();

    // start and end should be YYYY-MM-DD format
    expect(currentParsed.meta.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentParsed.meta.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Parse the issues section (sprint issues use SPRINT_ISSUE_SCHEMA with 13 fields)
    const issuesSection = currentParsed.sections.get('issues');
    if (!issuesSection || issuesSection.rows.length === 0) return;

    const registry = getStoredRegistry(context.sessionId);

    // Validate each issue against direct API
    for (const toonIssue of issuesSection.rows) {
      const identifier = toonIssue.identifier;
      expect(identifier, 'issue identifier should not be empty').toBeTruthy();

      const apiIssue = await fetchIssue(identifier);
      const ctx = { entity: 'Issue', identifier, field: '' };

      // Validate only fields present in the TOON output header
      for (const field of issuesSection.fields) {
        const toonValue = toonIssue[field] ?? '';

        switch (field) {
          case 'identifier':
            expect(toonValue).toBe(apiIssue.identifier);
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

          case 'createdAt':
            ctx.field = 'createdAt';
            expectFieldMatch(
              toonValue,
              (apiIssue as unknown as { createdAt?: Date | string }).createdAt,
              ctx,
            );
            break;

          case 'state':
            if (registry && normalizeEmpty(toonValue)) {
              const stateUuid = resolveShortKey(registry, 'state', toonValue);
              const apiState = await (
                apiIssue as unknown as { state: Promise<{ id: string }> }
              ).state;
              expect(
                stateUuid,
                `Issue "${identifier}" state: "${toonValue}" should resolve`,
              ).toBe(apiState.id);
            }
            break;

          case 'assignee':
            if (registry && normalizeEmpty(toonValue)) {
              const assigneeUuid = resolveShortKey(registry, 'user', toonValue);
              const apiAssignee = await (
                apiIssue as unknown as {
                  assignee: Promise<{ id: string } | null>;
                }
              ).assignee;
              expect(
                assigneeUuid,
                `Issue "${identifier}" assignee: "${toonValue}" should resolve`,
              ).toBe(apiAssignee?.id);
            }
            break;

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
            expect(toonLabelNames, `Issue "${identifier}" labels`).toEqual(
              apiLabelNames,
            );
            break;
          }

          // Skip fields not directly comparable (project, parent, desc, creator)
          default:
            break;
        }
      }
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Previous sprint
  // ─────────────────────────────────────────────────────────────────────────

  it('previous sprint has different cycle number', async () => {
    if (!currentRawText) return;

    const prevResult = await getSprintContextTool.handler(
      { team: TEAM_KEY, cycle: 'previous' },
      context,
    );

    // May fail if there is no previous cycle - that's acceptable
    if (prevResult.isError) return;

    const prevParsed = parseToonText(prevResult.content[0].text);

    // Should have a different cycle number than current
    expect(prevParsed.meta.cycle).toBeDefined();
    expect(
      prevParsed.meta.cycle,
      'Previous cycle number should differ from current',
    ).not.toBe(currentParsed.meta.cycle);

    // Verify issues belong to that cycle by checking the _meta cycle
    const prevCycleNum = prevParsed.meta.cycle;
    const prevIssues = prevParsed.sections.get('issues');
    if (!prevIssues || prevIssues.rows.length === 0) return;

    // All issues should have cycle = the previous cycle number
    for (const issue of prevIssues.rows) {
      if (normalizeEmpty(issue.cycle)) {
        const toonCycleNum = issue.cycle.match(/^c(\d+)$/)?.[1];
        if (toonCycleNum) {
          expect(
            toonCycleNum,
            `Issue "${issue.identifier}" cycle should match previous sprint number "${prevCycleNum}"`,
          ).toBe(prevCycleNum);
        }
      }
    }
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Gap analysis validation (CRITICAL)
  // ─────────────────────────────────────────────────────────────────────────

  it('gap analysis matches independently computed values', async () => {
    if (!currentRawText) return;

    const issuesSection = currentParsed.sections.get('issues');
    if (!issuesSection || issuesSection.rows.length === 0) return;

    // ─── Build raw issue data for independent gap computation ───

    const issueData: Array<{
      identifier: string;
      estimate: number | null;
      assignee: string;
      stateType: string;
      updatedAt: Date;
      priority: number | null;
    }> = [];

    for (const toonIssue of issuesSection.rows) {
      // Fetch from API for ground truth
      const apiIssue = await fetchIssue(toonIssue.identifier);
      const apiState = await (
        apiIssue as unknown as { state: Promise<{ type: string }> }
      ).state;
      const apiAssignee = await (
        apiIssue as unknown as { assignee: Promise<{ id: string } | null> }
      ).assignee;
      const updatedAt = (apiIssue as unknown as { updatedAt?: Date | string })
        .updatedAt;

      issueData.push({
        identifier: toonIssue.identifier,
        estimate: apiIssue.estimate ?? null,
        assignee: apiAssignee?.id ?? '',
        stateType: apiState?.type ?? '',
        updatedAt: updatedAt instanceof Date ? updatedAt : new Date(String(updatedAt)),
        priority: apiIssue.priority ?? null,
      });
    }

    // ─── Independently compute gaps ───

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const terminalTypes = ['completed', 'canceled'];
    const unstartedTypes = ['unstarted', 'backlog', 'triage'];

    const computedGaps: Record<string, Set<string>> = {
      no_estimate: new Set(),
      no_assignee: new Set(),
      stale: new Set(),
      blocked: new Set(),
      priority_mismatch: new Set(),
    };

    // no_estimate: issues where estimate is null
    for (const issue of issueData) {
      if (issue.estimate === null || issue.estimate === undefined) {
        computedGaps.no_estimate.add(issue.identifier);
      }
    }

    // no_assignee: unassigned issues (excluding completed/canceled)
    for (const issue of issueData) {
      if (!issue.assignee && !terminalTypes.includes(issue.stateType)) {
        computedGaps.no_assignee.add(issue.identifier);
      }
    }

    // stale: no updates for 7+ days (excluding completed/canceled)
    for (const issue of issueData) {
      if (!terminalTypes.includes(issue.stateType) && issue.updatedAt < sevenDaysAgo) {
        computedGaps.stale.add(issue.identifier);
      }
    }

    // blocked: has blocking relations (excluding completed/canceled)
    // Fetch relations for all issues to find blocked ones
    const blockedIdentifiers = new Set<string>();
    for (const toonIssue of issuesSection.rows) {
      const relations = await fetchIssueRelations(toonIssue.identifier);
      for (const relation of relations) {
        if (relation.type === 'blocks') {
          // The relatedIssue is blocked by this issue
          blockedIdentifiers.add(relation.relatedIssue.identifier);
        }
      }
    }

    // Also check the relations section from TOON output for additional blocked info
    const relationsSection = currentParsed.sections.get('relations');
    if (relationsSection) {
      for (const rel of relationsSection.rows) {
        if (rel.type === 'blocks') {
          blockedIdentifiers.add(rel.to);
        }
      }
    }

    for (const issue of issueData) {
      if (
        blockedIdentifiers.has(issue.identifier) &&
        !terminalTypes.includes(issue.stateType)
      ) {
        computedGaps.blocked.add(issue.identifier);
      }
    }

    // priority_mismatch: priority 1 issues in unstarted/backlog/triage state
    for (const issue of issueData) {
      if (issue.priority === 1 && unstartedTypes.includes(issue.stateType)) {
        computedGaps.priority_mismatch.add(issue.identifier);
      }
    }

    // ─── Compare against TOON _gaps section ───

    const gapsSection = currentParsed.sections.get('_gaps');

    // Build a map of TOON gap data
    const toonGaps: Record<string, { count: number; issues: Set<string> }> = {};
    if (gapsSection) {
      for (const gapRow of gapsSection.rows) {
        const gapType = gapRow.type;
        const count = parseInt(gapRow.count, 10);
        const issuesList = normalizeEmpty(gapRow.issues)
          ? gapRow.issues
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)
          : [];
        toonGaps[gapType] = { count, issues: new Set(issuesList) };
      }
    }

    // Compare each gap type
    for (const gapType of [
      'no_estimate',
      'no_assignee',
      'stale',
      'blocked',
      'priority_mismatch',
    ] as const) {
      const computed = computedGaps[gapType];
      const toonGap = toonGaps[gapType];

      if (computed.size === 0) {
        // No computed gap - TOON should also not have this gap type
        // (or have count=0, which typically means the gap row is omitted)
        if (toonGap) {
          expect(
            toonGap.count,
            `Gap "${gapType}": computed 0 issues but TOON reports ${toonGap.count}`,
          ).toBe(0);
        }
      } else {
        // Computed gap exists
        expect(
          toonGap,
          `Gap "${gapType}": computed ${computed.size} issues but no _gaps entry found. ` +
            `Expected issues: ${[...computed].join(',')}`,
        ).toBeDefined();

        if (toonGap) {
          // Count must match
          expect(
            toonGap.count,
            `Gap "${gapType}" count: TOON=${toonGap.count} vs computed=${computed.size}`,
          ).toBe(computed.size);

          // Issue lists must match (order-independent)
          const toonIssuesSorted = [...toonGap.issues].sort();
          const computedIssuesSorted = [...computed].sort();
          expect(
            toonIssuesSorted,
            `Gap "${gapType}" issues: TOON=[${toonIssuesSorted}] vs computed=[${computedIssuesSorted}]`,
          ).toEqual(computedIssuesSorted);
        }
      }
    }
  }, 180_000);
});
