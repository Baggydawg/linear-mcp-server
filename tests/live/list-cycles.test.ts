/**
 * Live data validation test for list_cycles.
 *
 * Calls the list_cycles tool handler with a real API token, parses the
 * TOON output, then compares every field against a direct Linear SDK fetch.
 *
 * Run with: bun test tests/live/list-cycles.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listCyclesTool } from '../../src/shared/tools/linear/cycles.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import {
  expectDateMatch,
  expectProgressMatch,
  type FieldContext,
  normalizeEmpty,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { fetchCycles, fetchTeams } from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('list_cycles live data validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  let context: ToolContext;
  let parsed: ParsedToon;
  let sqtTeamId: string;
  const validatedCycleNums: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    context = createLiveContext();

    // Resolve SQT team ID for direct API calls
    const teams = await fetchTeams();
    const sqtTeam = teams.find((t) => (t as unknown as { key?: string }).key === 'SQT');
    expect(sqtTeam, 'SQT team must exist in workspace').toBeDefined();
    sqtTeamId = sqtTeam?.id ?? '';

    // Call the list_cycles tool
    const params = { teamId: 'SQT' };
    const result = await listCyclesTool.handler(params, context);
    expect(result.isError).not.toBe(true);
    reportToolCall(suite, 'list_cycles', params, result.content[0].text);

    const text = result.content[0].text;
    expect(text).toBeDefined();
    parsed = parseToonText(text);
  }, 30000);

  afterAll((suite) => {
    if (validatedCycleNums.length > 0) {
      reportEntitiesValidated(suite, 'cycles', validatedCycleNums);
    }
    if (context) {
      clearRegistry(context.sessionId);
    }
  });

  it('SQT cycles match API data', async () => {
    const cyclesSection = parsed.sections.get('cycles');
    if (!cyclesSection || cyclesSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'SQT cycles match API data',
          'no cycles found for SQT team',
        );
      return;
    }

    // Fetch cycles via direct API (list_cycles uses first:20 by default)
    const apiCycles = await fetchCycles(sqtTeamId, 20);

    for (const toonRow of cyclesSection.rows) {
      const cycleNum = parseInt(toonRow.num, 10);
      const apiCycle = apiCycles.find(
        (c) => (c as unknown as { number?: number }).number === cycleNum,
      );

      expect(
        apiCycle,
        `Cycle num=${cycleNum} from TOON not found in API response`,
      ).toBeDefined();
      if (!apiCycle) continue;

      const ctx = (field: string): FieldContext => ({
        entity: 'Cycle',
        identifier: `num=${cycleNum}`,
        field,
      });

      // Compare name
      const apiName = (apiCycle as unknown as { name?: string }).name ?? '';
      expect(
        normalizeEmpty(toonRow.name),
        `Cycle num=${cycleNum} field "name": TOON="${toonRow.name}" vs API="${apiName}"`,
      ).toBe(normalizeEmpty(apiName));

      // Compare start date (TOON YYYY-MM-DD vs API Date)
      expectDateMatch(toonRow.start, apiCycle.startsAt, ctx('start'));

      // Compare end date
      expectDateMatch(toonRow.end, apiCycle.endsAt, ctx('end'));

      // Compare progress with rounding tolerance
      expectProgressMatch(
        toonRow.progress,
        (apiCycle as unknown as { progress?: number }).progress,
        ctx('progress'),
      );

      validatedCycleNums.push(String(cycleNum));
    }
  }, 30000);

  it('active flag is independently verified', () => {
    const cyclesSection = parsed.sections.get('cycles');
    if (!cyclesSection || cyclesSection.rows.length === 0) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'active flag is independently verified',
          'no cycles found',
        );
      return;
    }

    const now = new Date();

    for (const toonRow of cyclesSection.rows) {
      const cycleNum = toonRow.num;
      const startStr = toonRow.start;
      const endStr = toonRow.end;

      if (!startStr || !endStr) continue;

      const startsAt = new Date(startStr);
      const endsAt = new Date(endStr);
      const expectedActive = now >= startsAt && now <= endsAt;

      expect(
        toonRow.active,
        `Cycle num=${cycleNum} active flag: TOON="${toonRow.active}" vs computed="${expectedActive}" (now=${now.toISOString()}, start=${startStr}, end=${endStr})`,
      ).toBe(String(expectedActive));
    }
  });

  it('cycles are sorted by number descending', () => {
    const cyclesSection = parsed.sections.get('cycles');
    if (!cyclesSection || cyclesSection.rows.length < 2) {
      if (suiteRef)
        reportSkip(
          suiteRef,
          'cycles are sorted by number descending',
          'fewer than 2 cycles found',
        );
      return;
    }

    const cycleNums = cyclesSection.rows.map((r) => parseInt(r.num, 10));

    for (let i = 1; i < cycleNums.length; i++) {
      expect(
        cycleNums[i - 1],
        `Cycle sort order: num=${cycleNums[i - 1]} should be >= num=${cycleNums[i]}`,
      ).toBeGreaterThanOrEqual(cycleNums[i]);
    }
  });
});
