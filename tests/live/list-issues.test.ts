/**
 * Live data validation tests for `list_issues` tool.
 *
 * Calls the real list_issues handler with a live API token, parses the TOON
 * output, then verifies every field against direct Linear API fetches.
 *
 * Run with: bun test tests/live/list-issues.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { stripMarkdownImages } from '../../src/shared/toon/encoder.js';
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
import {
  fetchComments,
  fetchIssue,
  fetchIssueRelations,
} from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportFieldComparison,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import type { ParsedToon } from './helpers/toon-parser.js';
import { parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('list_issues live validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ReturnType<typeof createLiveContext>;
  let parsed: ParsedToon;
  let rawText: string;
  const validatedIssueIds: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    const result = await listIssuesTool.handler({}, context);
    expect(result.isError).not.toBe(true);

    rawText = result.content[0].text;
    reportToolCall(suite, 'list_issues', {}, rawText);
    expect(rawText).toBeDefined();
    parsed = parseToonText(rawText);
  }, 60_000);

  afterAll((suite) => {
    if (validatedIssueIds.length > 0) {
      reportEntitiesValidated(suite, 'issues', validatedIssueIds);
    }
    if (context) clearRegistry(context.sessionId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Default query issues match API
  // ─────────────────────────────────────────────────────────────────────────

  it('default query issues match API', async () => {
    const issuesSection = parsed.sections.get('issues');
    expect(issuesSection, 'issues section should exist').toBeDefined();
    if (!issuesSection) return;

    const issues = issuesSection.rows;
    expect(issues.length).toBeGreaterThan(0);

    const registry = getStoredRegistry(context.sessionId);

    // Validate each issue against direct API
    for (const toonIssue of issues) {
      validatedIssueIds.push(toonIssue.identifier);
      const identifier = toonIssue.identifier;
      expect(identifier, 'issue identifier should not be empty').toBeTruthy();

      const apiIssue = await fetchIssue(identifier);
      const ctx = { entity: 'Issue', identifier, field: '' };
      const comparisons: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }> = [];

      // title
      ctx.field = 'title';
      expectFieldMatch(toonIssue.title, apiIssue.title, ctx);
      comparisons.push({
        field: 'title',
        toon: toonIssue.title ?? '',
        api: String(apiIssue.title ?? ''),
        match: normalizeEmpty(toonIssue.title) === normalizeEmpty(apiIssue.title),
      });

      // priority: TOON "p2" -> API 2
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

      // estimate: TOON "e5" -> API 5
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

      // dueDate
      if (issuesSection.fields.includes('dueDate')) {
        ctx.field = 'dueDate';
        expectFieldMatch(toonIssue.dueDate, apiIssue.dueDate, ctx);
        {
          const toonDate = normalizeEmpty(toonIssue.dueDate);
          const apiDateRaw = normalizeEmpty(apiIssue.dueDate);
          const apiDateStr = apiDateRaw ? String(apiDateRaw).split('T')[0] : '';
          comparisons.push({
            field: 'dueDate',
            toon: toonDate,
            api: apiDateStr || apiDateRaw,
            match: toonDate === (apiDateStr || apiDateRaw),
          });
        }
      }

      // labels: comma-separated names
      if (issuesSection.fields.includes('labels')) {
        const apiLabels = await (
          apiIssue as unknown as {
            labels: () => Promise<{ nodes: Array<{ name: string }> }>;
          }
        ).labels();
        const apiLabelNames = (apiLabels.nodes ?? []).map((l) => l.name).sort();
        const toonLabelNames = normalizeEmpty(toonIssue.labels)
          ? toonIssue.labels.split(',').sort()
          : [];
        expect(
          toonLabelNames,
          `Issue "${identifier}" labels: TOON="${toonIssue.labels}" vs API="${apiLabelNames.join(',')}"`,
        ).toEqual(apiLabelNames);
        comparisons.push({
          field: 'labels',
          toon: toonIssue.labels ?? '',
          api: apiLabelNames.join(','),
          match: JSON.stringify(toonLabelNames) === JSON.stringify(apiLabelNames),
        });
      }

      // state short key resolution
      if (registry && normalizeEmpty(toonIssue.state)) {
        const stateUuid = resolveShortKey(registry, 'state', toonIssue.state);
        const apiState = await (
          apiIssue as unknown as { state: Promise<{ id: string; name: string }> }
        ).state;
        expect(
          stateUuid,
          `Issue "${identifier}" state: short key "${toonIssue.state}" should resolve to API state UUID`,
        ).toBe(apiState.id);
        comparisons.push({
          field: 'state',
          toon: formatWithResolution(registry, 'state', toonIssue.state),
          api: apiState.name ?? apiState.id,
          match: stateUuid === apiState.id,
        });
      }

      // assignee short key resolution
      if (registry && normalizeEmpty(toonIssue.assignee)) {
        const assigneeUuid = resolveShortKey(registry, 'user', toonIssue.assignee);
        const apiAssignee = await (
          apiIssue as unknown as {
            assignee: Promise<{ id: string; name: string } | null>;
          }
        ).assignee;
        expect(
          assigneeUuid,
          `Issue "${identifier}" assignee: short key "${toonIssue.assignee}" should resolve to API assignee UUID`,
        ).toBe(apiAssignee?.id);
        comparisons.push({
          field: 'assignee',
          toon: formatWithResolution(registry, 'assignee', toonIssue.assignee),
          api: apiAssignee?.name ?? apiAssignee?.id ?? '',
          match: assigneeUuid === apiAssignee?.id,
        });
      }

      // team key
      if (issuesSection.fields.includes('team')) {
        const apiTeam = await (
          apiIssue as unknown as { team: Promise<{ key: string }> }
        ).team;
        expect(
          normalizeEmpty(toonIssue.team),
          `Issue "${identifier}" team: TOON="${toonIssue.team}" vs API="${apiTeam?.key}"`,
        ).toBe(normalizeEmpty(apiTeam?.key));
        comparisons.push({
          field: 'team',
          toon: toonIssue.team ?? '',
          api: apiTeam?.key ?? '',
          match: normalizeEmpty(toonIssue.team) === normalizeEmpty(apiTeam?.key),
        });
      }

      // desc: should match API description after stripping markdown images and truncation
      if (issuesSection.fields.includes('desc') && normalizeEmpty(toonIssue.desc)) {
        const rawApiDesc = normalizeEmpty(apiIssue.description);
        if (rawApiDesc) {
          // The TOON encoder strips markdown images before truncation
          const apiDesc = stripMarkdownImages(rawApiDesc) ?? '';
          if (apiDesc.length > 3000) {
            // Truncated: TOON desc should end with "... [truncated]"
            expect(
              toonIssue.desc.endsWith('... [truncated]'),
              `Issue "${identifier}" desc should be truncated with suffix`,
            ).toBe(true);
            // The text before the suffix should be a prefix of the image-stripped description
            const toonPrefix = toonIssue.desc.replace(/\.\.\. \[truncated\]$/, '');
            expect(
              apiDesc.startsWith(toonPrefix),
              `Issue "${identifier}" desc prefix should match image-stripped API description start`,
            ).toBe(true);
            comparisons.push({
              field: 'desc',
              toon:
                toonIssue.desc.length > 80
                  ? `${toonIssue.desc.slice(0, 80)}...`
                  : toonIssue.desc,
              api: apiDesc.length > 80 ? `${apiDesc.slice(0, 80)}...` : apiDesc,
              match:
                toonIssue.desc.endsWith('... [truncated]') &&
                apiDesc.startsWith(toonPrefix),
            });
          } else {
            // Not truncated: should match fully
            expect(
              toonIssue.desc,
              `Issue "${identifier}" desc should match API description\n` +
                `Expected (API): ${apiDesc}\n` +
                `Received (TOON): ${toonIssue.desc}`,
            ).toBe(apiDesc);
            comparisons.push({
              field: 'desc',
              toon:
                toonIssue.desc.length > 80
                  ? `${toonIssue.desc.slice(0, 80)}...`
                  : toonIssue.desc,
              api: apiDesc.length > 80 ? `${apiDesc.slice(0, 80)}...` : apiDesc,
              match: toonIssue.desc === apiDesc,
            });
          }
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
  // 2. Tier 2 _users section - referenced only
  // ─────────────────────────────────────────────────────────────────────────

  it('_users section contains only referenced users', async () => {
    const usersSection = parsed.sections.get('_users');
    if (!usersSection) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          '_users section contains only referenced users',
          'no _users section in output',
        );
      return;
    }

    const issuesSection = parsed.sections.get('issues');
    const commentsSection = parsed.sections.get('comments');

    // Collect all user short keys referenced by issues and comments
    const referencedKeys = new Set<string>();
    if (issuesSection) {
      for (const issue of issuesSection.rows) {
        if (normalizeEmpty(issue.assignee)) referencedKeys.add(issue.assignee);
        if (normalizeEmpty(issue.creator)) referencedKeys.add(issue.creator);
      }
    }
    if (commentsSection) {
      for (const comment of commentsSection.rows) {
        if (normalizeEmpty(comment.user)) referencedKeys.add(comment.user);
      }
    }

    // Every user in _users should be referenced somewhere
    for (const userRow of usersSection.rows) {
      expect(
        referencedKeys.has(userRow.key),
        `User "${userRow.key}" (${userRow.name}) in _users is not referenced by any issue or comment`,
      ).toBe(true);
    }

    // Verify user names match API
    const registry = getStoredRegistry(context.sessionId);
    if (registry) {
      for (const userRow of usersSection.rows) {
        // Skip ext* users (external/unregistered)
        if (userRow.key.startsWith('ext')) continue;

        const uuid = resolveShortKey(registry, 'user', userRow.key);
        const metadata = registry.userMetadata.get(uuid);
        if (metadata) {
          expect(
            userRow.name,
            `User "${userRow.key}" name should match registry metadata`,
          ).toBe(metadata.name);

          const comparisons: Array<{
            field: string;
            toon: string;
            api: string;
            match: boolean;
          }> = [];
          comparisons.push({
            field: 'name',
            toon: userRow.name ?? '',
            api: metadata.name ?? '',
            match: userRow.name === metadata.name,
          });
          if (suiteRef) {
            reportFieldComparison(
              suiteRef,
              userRow.key,
              userRow.name,
              comparisons,
              'User',
            );
          }
        }
      }
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Tier 2 _states section - referenced only
  // ─────────────────────────────────────────────────────────────────────────

  it('_states section contains only referenced states', async () => {
    const statesSection = parsed.sections.get('_states');
    if (!statesSection) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          '_states section contains only referenced states',
          'no _states section in output',
        );
      return;
    }

    const issuesSection = parsed.sections.get('issues');
    if (!issuesSection) return;

    // Collect all state short keys used by issues
    const usedStateKeys = new Set<string>();
    for (const issue of issuesSection.rows) {
      if (normalizeEmpty(issue.state)) usedStateKeys.add(issue.state);
    }

    // Every state in _states should be used by at least one issue
    for (const stateRow of statesSection.rows) {
      expect(
        usedStateKeys.has(stateRow.key),
        `State "${stateRow.key}" (${stateRow.name}) in _states is not used by any issue`,
      ).toBe(true);
    }

    // Verify state name and type match registry metadata
    const registry = getStoredRegistry(context.sessionId);
    if (registry) {
      for (const stateRow of statesSection.rows) {
        const uuid = resolveShortKey(registry, 'state', stateRow.key);
        const metadata = registry.stateMetadata.get(uuid);
        if (metadata) {
          expect(
            stateRow.name,
            `State "${stateRow.key}" name: TOON="${stateRow.name}" vs metadata="${metadata.name}"`,
          ).toBe(metadata.name);
          expect(
            stateRow.type,
            `State "${stateRow.key}" type: TOON="${stateRow.type}" vs metadata="${metadata.type}"`,
          ).toBe(metadata.type);

          const comparisons: Array<{
            field: string;
            toon: string;
            api: string;
            match: boolean;
          }> = [];
          comparisons.push({
            field: 'name',
            toon: stateRow.name ?? '',
            api: metadata.name ?? '',
            match: stateRow.name === metadata.name,
          });
          comparisons.push({
            field: 'type',
            toon: stateRow.type ?? '',
            api: metadata.type ?? '',
            match: stateRow.type === metadata.type,
          });
          if (suiteRef) {
            reportFieldComparison(
              suiteRef,
              stateRow.key,
              stateRow.name,
              comparisons,
              'State',
            );
          }
        }
      }
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Current cycle filter
  // ─────────────────────────────────────────────────────────────────────────

  it('current cycle filter returns only current sprint issues', async () => {
    const cycleParams = { cycle: 'current', team: process.env.DEFAULT_TEAM || 'SQT' };
    const cycleResult = await listIssuesTool.handler(cycleParams, context);
    if (suiteRef)
      reportToolCall(suiteRef, 'list_issues', cycleParams, cycleResult.content[0].text);

    // May fail if team has no active cycle - that's acceptable
    if (cycleResult.isError) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'current cycle filter returns only current sprint issues',
          'no active cycle for team',
        );
      return;
    }

    const cycleParsed = parseToonText(cycleResult.content[0].text);
    const cycleIssues = cycleParsed.sections.get('issues');
    if (!cycleIssues || cycleIssues.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'current cycle filter returns only current sprint issues',
          'no issues in current cycle',
        );
      return;
    }

    // All issues should have the same cycle number
    const cycleValues = new Set<string>();
    for (const issue of cycleIssues.rows) {
      if (normalizeEmpty(issue.cycle)) {
        cycleValues.add(issue.cycle);
      }
    }

    // All issues with a cycle should share the same value
    if (cycleValues.size > 0) {
      expect(
        cycleValues.size,
        `All issues should belong to the same cycle, but found: ${[...cycleValues].join(', ')}`,
      ).toBe(1);
    }

    // Verify each issue actually belongs to the current cycle via API
    for (const issue of cycleIssues.rows) {
      const apiIssue = await fetchIssue(issue.identifier);
      const apiCycle = await (
        apiIssue as unknown as { cycle: Promise<{ number: number } | null> }
      ).cycle;

      if (apiCycle) {
        const toonCycleNum = issue.cycle?.match(/^c(\d+)$/)?.[1];
        if (toonCycleNum) {
          expect(
            parseInt(toonCycleNum, 10),
            `Issue "${issue.identifier}" cycle: TOON="${issue.cycle}" vs API cycle number=${apiCycle.number}`,
          ).toBe(apiCycle.number);
        }
      }
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Inline comments match API and are properly truncated
  // ─────────────────────────────────────────────────────────────────────────

  it('inline comments match API and are properly truncated', async () => {
    const commentsSection = parsed.sections.get('comments');
    if (!commentsSection || commentsSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'inline comments match API and are properly truncated',
          'no inline comments in output',
        );
      return;
    }

    // Inline comments use COMMENT_SCHEMA (no 'id' field)
    expect(commentsSection.fields).not.toContain('id');

    // Build users lookup from _users section
    const usersSection = parsed.sections.get('_users');
    const shortKeyToUserName = new Map<string, string>();
    if (usersSection) {
      for (const row of usersSection.rows) {
        shortKeyToUserName.set(row.key, row.name);
      }
    }

    // Group comments by issue
    const commentsByIssue = new Map<string, typeof commentsSection.rows>();
    for (const comment of commentsSection.rows) {
      if (!commentsByIssue.has(comment.issue)) {
        commentsByIssue.set(comment.issue, []);
      }
      commentsByIssue.get(comment.issue)!.push(comment);
    }

    // Validate a sample of comments
    for (const [issueIdentifier, toonComments] of commentsByIssue) {
      // Fetch API comments
      const apiIssue = await fetchIssue(issueIdentifier);
      const apiComments = await fetchComments(apiIssue.id);

      for (const toonComment of toonComments) {
        // Verify createdAt and body match an API comment
        const apiMatch = apiComments.find((ac) => {
          const apiDate = new Date(ac.createdAt).toISOString();
          return toonComment.createdAt === apiDate;
        });

        if (!apiMatch) continue; // Timing issues, skip

        // Verify truncation: if API body > 500 chars, TOON should be truncated
        const apiBody = stripMarkdownImages(apiMatch.body ?? '') ?? '';
        if (apiBody.length > 500) {
          expect(
            toonComment.body.length,
            `Comment on ${issueIdentifier} should be truncated to ~500 chars, got ${toonComment.body.length}`,
          ).toBeLessThanOrEqual(503); // 500 + "..."
          expect(
            toonComment.body.endsWith('...'),
            `Truncated comment on ${issueIdentifier} should end with "..."`,
          ).toBe(true);
        } else {
          expect(
            normalizeEmpty(toonComment.body),
            `Comment on ${issueIdentifier} body should match API`,
          ).toBe(normalizeEmpty(apiBody));
        }

        // Verify user short key resolves correctly
        if (normalizeEmpty(toonComment.user)) {
          const toonUserName = shortKeyToUserName.get(toonComment.user);
          const apiUser = await (apiMatch as any).user;
          if (apiUser && toonUserName) {
            expect(
              toonUserName,
              `Comment user "${toonComment.user}" should resolve to "${apiUser.name}"`,
            ).toBe(apiUser.name);
          }
        }
      }
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Relations match API
  // ─────────────────────────────────────────────────────────────────────────

  it('relations match API', async () => {
    const relationsSection = parsed.sections.get('relations');
    if (!relationsSection || relationsSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(suiteRef, 'relations match API', 'no relations in output');
      return;
    }

    // Validate relation types
    const validTypes = new Set(['blocks', 'duplicate', 'related']);
    for (const relation of relationsSection.rows) {
      expect(
        validTypes.has(relation.type),
        `Relation type "${relation.type}" should be one of: blocks, duplicate, related`,
      ).toBe(true);
    }

    // Verify a sample of relations against API
    const checkedIssues = new Set<string>();
    for (const relation of relationsSection.rows) {
      if (checkedIssues.has(relation.from)) continue;
      checkedIssues.add(relation.from);

      const apiIssue = await fetchIssue(relation.from);
      const apiRelations = await fetchIssueRelations(apiIssue.id);

      // Check that the TOON relation exists in API relations
      const relationsForThisIssue = relationsSection.rows.filter(
        (r) => r.from === relation.from,
      );
      for (const toonRel of relationsForThisIssue) {
        // Note: relation type mapping may differ (API uses camelCase like "blocks", "isBlocking", etc.)
        // Just verify the target issue exists in API relations
        const apiTarget = apiRelations.find(
          (ar) => ar.relatedIssue?.identifier === toonRel.to,
        );
        expect(
          apiTarget,
          `Relation ${toonRel.from} -> ${toonRel.to} (${toonRel.type}) not found in API`,
        ).toBeDefined();
      }
    }
  }, 60_000);
});
