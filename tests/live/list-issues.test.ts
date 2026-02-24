/**
 * Live data validation tests for `list_issues` tool.
 *
 * Calls the real list_issues handler with a live API token, parses the TOON
 * output, then verifies every field against direct Linear API fetches.
 *
 * Run with: bun test tests/live/list-issues.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { stripMarkdownImages } from '../../src/shared/toon/encoder.js';
import {
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
} from '../../src/shared/toon/registry.js';
import { expectFieldMatch, normalizeEmpty } from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchIssue } from './helpers/linear-api.js';
import type { ParsedToon } from './helpers/toon-parser.js';
import { parseToonText } from './helpers/toon-parser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared state across tests
// ─────────────────────────────────────────────────────────────────────────────

let context: ReturnType<typeof createLiveContext>;
let parsed: ParsedToon;
let rawText: string;

describe.runIf(canRunLiveTests)('list_issues live validation', () => {
  beforeAll(async () => {
    context = createLiveContext();

    const result = await listIssuesTool.handler({}, context);
    expect(result.isError).not.toBe(true);

    rawText = result.content[0].text;
    expect(rawText).toBeDefined();
    parsed = parseToonText(rawText);
  }, 60_000);

  afterAll(() => {
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
      const identifier = toonIssue.identifier;
      expect(identifier, 'issue identifier should not be empty').toBeTruthy();

      const apiIssue = await fetchIssue(identifier);
      const ctx = { entity: 'Issue', identifier, field: '' };

      // title
      ctx.field = 'title';
      expectFieldMatch(toonIssue.title, apiIssue.title, ctx);

      // priority: TOON "p2" -> API 2
      ctx.field = 'priority';
      expectFieldMatch(toonIssue.priority, apiIssue.priority, ctx);

      // estimate: TOON "e5" -> API 5
      ctx.field = 'estimate';
      expectFieldMatch(toonIssue.estimate, apiIssue.estimate, ctx);

      // dueDate
      if (issuesSection.fields.includes('dueDate')) {
        ctx.field = 'dueDate';
        expectFieldMatch(toonIssue.dueDate, apiIssue.dueDate, ctx);
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
      }

      // state short key resolution
      if (registry && normalizeEmpty(toonIssue.state)) {
        const stateUuid = resolveShortKey(registry, 'state', toonIssue.state);
        const apiState = await (
          apiIssue as unknown as { state: Promise<{ id: string }> }
        ).state;
        expect(
          stateUuid,
          `Issue "${identifier}" state: short key "${toonIssue.state}" should resolve to API state UUID`,
        ).toBe(apiState.id);
      }

      // assignee short key resolution
      if (registry && normalizeEmpty(toonIssue.assignee)) {
        const assigneeUuid = resolveShortKey(registry, 'user', toonIssue.assignee);
        const apiAssignee = await (
          apiIssue as unknown as { assignee: Promise<{ id: string } | null> }
        ).assignee;
        expect(
          assigneeUuid,
          `Issue "${identifier}" assignee: short key "${toonIssue.assignee}" should resolve to API assignee UUID`,
        ).toBe(apiAssignee?.id);
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
          } else {
            // Not truncated: should match fully
            expect(
              toonIssue.desc,
              `Issue "${identifier}" desc should match API description\n` +
                `Expected (API): ${apiDesc}\n` +
                `Received (TOON): ${toonIssue.desc}`,
            ).toBe(apiDesc);
          }
        }
      }
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Tier 2 _users section - referenced only
  // ─────────────────────────────────────────────────────────────────────────

  it('_users section contains only referenced users', async () => {
    const usersSection = parsed.sections.get('_users');
    if (!usersSection) return; // No users section is valid if no issues reference users

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
        }
      }
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Tier 2 _states section - referenced only
  // ─────────────────────────────────────────────────────────────────────────

  it('_states section contains only referenced states', async () => {
    const statesSection = parsed.sections.get('_states');
    if (!statesSection) return;

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
        }
      }
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Current cycle filter
  // ─────────────────────────────────────────────────────────────────────────

  it('current cycle filter returns only current sprint issues', async () => {
    const cycleResult = await listIssuesTool.handler(
      { cycle: 'current', team: process.env.DEFAULT_TEAM || 'SQT' },
      context,
    );

    // May fail if team has no active cycle - that's acceptable
    if (cycleResult.isError) return;

    const cycleParsed = parseToonText(cycleResult.content[0].text);
    const cycleIssues = cycleParsed.sections.get('issues');
    if (!cycleIssues || cycleIssues.rows.length === 0) return;

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
});
