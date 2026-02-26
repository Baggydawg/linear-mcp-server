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

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSprintContextTool } from '../../src/shared/tools/linear/get-sprint-context.js';
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
import { fetchIssue, fetchIssueRelations } from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportFieldComparison,
  reportSkip,
} from './helpers/report-collector.js';
import type { ParsedToon } from './helpers/toon-parser.js';
import { parseToonText } from './helpers/toon-parser.js';

const TEAM_KEY = process.env.DEFAULT_TEAM || 'SQT';

describe.skipIf(!canRunLiveTests)('get_sprint_context live validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ReturnType<typeof createLiveContext>;
  let currentParsed: ParsedToon;
  let currentRawText: string;
  const validatedSprintIssues: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
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

  afterAll((suite) => {
    if (validatedSprintIssues.length > 0) {
      reportEntitiesValidated(suite, 'sprintIssues', validatedSprintIssues);
    }
    if (context) clearRegistry(context.sessionId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Current sprint matches API
  // ─────────────────────────────────────────────────────────────────────────

  it('current sprint metadata and issues match API', async () => {
    if (!currentRawText) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'current sprint metadata and issues match API',
          'no active cycle',
        );
      return;
    }

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
    if (!issuesSection || issuesSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'current sprint metadata and issues match API',
          'no issues in current sprint',
        );
      return;
    }

    const registry = getStoredRegistry(context.sessionId);

    // Validate each issue against direct API
    for (const toonIssue of issuesSection.rows) {
      const identifier = toonIssue.identifier;
      expect(identifier, 'issue identifier should not be empty').toBeTruthy();
      validatedSprintIssues.push(identifier);

      const apiIssue = await fetchIssue(identifier);
      const ctx = { entity: 'Issue', identifier, field: '' };
      const comparisons: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }> = [];

      // Validate only fields present in the TOON output header
      for (const field of issuesSection.fields) {
        const toonValue = toonIssue[field] ?? '';

        switch (field) {
          case 'identifier':
            expect(toonValue).toBe(apiIssue.identifier);
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

          case 'state':
            if (registry && normalizeEmpty(toonValue)) {
              const stateUuid = resolveShortKey(registry, 'state', toonValue);
              const apiState = await (
                apiIssue as unknown as {
                  state: Promise<{ id: string; name: string }>;
                }
              ).state;
              expect(
                stateUuid,
                `Issue "${identifier}" state: "${toonValue}" should resolve`,
              ).toBe(apiState.id);
              comparisons.push({
                field: 'state',
                toon: formatWithResolution(registry, 'state', toonValue),
                api: apiState.name ?? apiState.id,
                match: stateUuid === apiState.id,
              });
            }
            break;

          case 'assignee':
            if (registry && normalizeEmpty(toonValue)) {
              const assigneeUuid = resolveShortKey(
                registry,
                'user',
                toonValue,
              );
              const apiAssignee = await (
                apiIssue as unknown as {
                  assignee: Promise<{ id: string; name: string } | null>;
                }
              ).assignee;
              expect(
                assigneeUuid,
                `Issue "${identifier}" assignee: "${toonValue}" should resolve`,
              ).toBe(apiAssignee?.id);
              comparisons.push({
                field: 'assignee',
                toon: formatWithResolution(
                  registry,
                  'assignee',
                  toonValue,
                ),
                api: apiAssignee?.name ?? apiAssignee?.id ?? '',
                match: assigneeUuid === apiAssignee?.id,
              });
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
            {
              const toonNum = stripToonPrefix(toonValue);
              const apiNum =
                apiCycle?.number !== null && apiCycle?.number !== undefined
                  ? Number(apiCycle.number)
                  : null;
              comparisons.push({
                field: 'cycle',
                toon: toonValue,
                api:
                  apiCycle?.number != null ? String(apiCycle.number) : '',
                match:
                  (toonNum === null && apiNum === null) ||
                  toonNum === apiNum,
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
            expect(toonLabelNames, `Issue "${identifier}" labels`).toEqual(
              apiLabelNames,
            );
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

          // Skip fields not directly comparable (project, parent, desc, creator)
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
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Previous sprint
  // ─────────────────────────────────────────────────────────────────────────

  it('previous sprint has different cycle number', async () => {
    if (!currentRawText) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'previous sprint has different cycle number',
          'no active cycle',
        );
      return;
    }

    const prevResult = await getSprintContextTool.handler(
      { team: TEAM_KEY, cycle: 'previous' },
      context,
    );

    // May fail if there is no previous cycle - that's acceptable
    if (prevResult.isError) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'previous sprint has different cycle number',
          'no previous cycle available',
        );
      return;
    }

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
    if (!currentRawText) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'gap analysis matches independently computed values',
          'no active cycle',
        );
      return;
    }

    const issuesSection = currentParsed.sections.get('issues');
    if (!issuesSection || issuesSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'gap analysis matches independently computed values',
          'no issues in current sprint',
        );
      return;
    }

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
      const comparisons: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }> = [];

      if (computed.size === 0) {
        // No computed gap - TOON should also not have this gap type
        // (or have count=0, which typically means the gap row is omitted)
        if (toonGap) {
          expect(
            toonGap.count,
            `Gap "${gapType}": computed 0 issues but TOON reports ${toonGap.count}`,
          ).toBe(0);
          comparisons.push({
            field: 'count',
            toon: String(toonGap.count),
            api: '0',
            match: toonGap.count === 0,
          });
        } else {
          comparisons.push({
            field: 'count',
            toon: '(absent)',
            api: '0',
            match: true,
          });
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
          comparisons.push({
            field: 'count',
            toon: String(toonGap.count),
            api: String(computed.size),
            match: toonGap.count === computed.size,
          });

          // Issue lists must match (order-independent)
          const toonIssuesSorted = [...toonGap.issues].sort();
          const computedIssuesSorted = [...computed].sort();
          expect(
            toonIssuesSorted,
            `Gap "${gapType}" issues: TOON=[${toonIssuesSorted}] vs computed=[${computedIssuesSorted}]`,
          ).toEqual(computedIssuesSorted);
          comparisons.push({
            field: 'issues',
            toon: toonIssuesSorted.join(','),
            api: computedIssuesSorted.join(','),
            match:
              JSON.stringify(toonIssuesSorted) ===
              JSON.stringify(computedIssuesSorted),
          });
        }
      }

      if (suiteRef && comparisons.length > 0) {
        reportFieldComparison(
          suiteRef,
          gapType,
          undefined,
          comparisons,
          'Gap',
        );
      }
    }
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Sprint relations match API and cross-reference with gaps
  // ─────────────────────────────────────────────────────────────────────────

  it('sprint relations match API and cross-reference with gaps', async () => {
    if (!currentRawText) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'sprint relations match API and cross-reference with gaps',
          'no active cycle',
        );
      return;
    }

    const relationsSection = currentParsed.sections.get('relations');
    const gapsSection = currentParsed.sections.get('_gaps');

    if (!relationsSection || relationsSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'sprint relations match API and cross-reference with gaps',
          'no relations in sprint context',
        );
      return;
    }

    // Validate all relations have valid types
    const validTypes = new Set(['blocks', 'duplicate', 'related']);
    for (const relation of relationsSection.rows) {
      expect(
        validTypes.has(relation.type),
        `Invalid relation type: ${relation.type}`,
      ).toBe(true);
    }

    // Verify against API
    const checkedIssues = new Set<string>();
    for (const relation of relationsSection.rows) {
      if (checkedIssues.has(relation.from)) continue;
      checkedIssues.add(relation.from);

      const apiIssue = await fetchIssue(relation.from);
      const apiRelations = await fetchIssueRelations(apiIssue.id);

      const toonRelsForIssue = relationsSection.rows.filter(
        (r) => r.from === relation.from,
      );
      for (const toonRel of toonRelsForIssue) {
        const apiTarget = apiRelations.find(
          (ar) => ar.relatedIssue?.identifier === toonRel.to,
        );
        expect(
          apiTarget,
          `Sprint relation ${toonRel.from} -> ${toonRel.to} (${toonRel.type}) not found in API`,
        ).toBeDefined();
      }
    }

    // Cross-reference: if _gaps has "blocked" entries, those issues should appear in relations with "blocks" type
    if (gapsSection) {
      const blockedGap = gapsSection.rows.find((g) => g.type === 'blocked');
      if (blockedGap && blockedGap.issues) {
        const blockedIssueIds = blockedGap.issues
          .split(',')
          .map((s: string) => s.trim());
        for (const blockedId of blockedIssueIds) {
          // The blocked issue should appear as the "to" in a "blocks" relation
          // OR the blocked issue could be the "from" with type "blocks"
          const hasRelation = relationsSection.rows.some(
            (r) => r.to === blockedId || r.from === blockedId,
          );
          expect(
            hasRelation,
            `Issue "${blockedId}" is in _gaps as "blocked" but has no corresponding relation`,
          ).toBe(true);
        }
      }
    }
  }, 60_000);
});
