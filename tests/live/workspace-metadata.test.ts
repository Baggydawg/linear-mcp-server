/**
 * Live data validation for workspace_metadata tool.
 *
 * Validates the Tier 1 tool that returns ALL entities (users, states, projects,
 * labels, cycles, teams) and builds the short-key registry that all other tools
 * depend on.
 *
 * Each test case calls the Linear API directly and compares against parsed TOON
 * output to ensure the tool faithfully represents live workspace data.
 *
 * Run with: bun test tests/live/workspace-metadata.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import type { File, Suite } from '@vitest/runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import {
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
  type ShortKeyRegistry,
} from '../../src/shared/toon/registry.js';
import {
  expectDateMatch,
  expectFieldMatch,
  expectProgressMatch,
  formatWithResolution,
  normalizeEmpty,
} from './helpers/assertions.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import {
  fetchCycles,
  fetchLabels,
  fetchProjects,
  fetchStates,
  fetchTeams,
  fetchUsers,
} from './helpers/linear-api.js';
import {
  reportEntitiesValidated,
  reportFieldComparison,
  reportSkip,
  reportToolCall,
} from './helpers/report-collector.js';
import { type ParsedToon, parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('workspace_metadata live validation', () => {
  let suiteRef: Readonly<Suite | File> | null = null;
  const context = createLiveContext();
  let parsed: ParsedToon;
  let toolText: string;
  const validatedTeams: string[] = [];
  const validatedUsers: string[] = [];
  const validatedStates: string[] = [];
  const validatedLabels: string[] = [];
  const validatedProjects: string[] = [];
  const validatedCycles: string[] = [];

  beforeAll(async (suite) => {
    suiteRef = suite;
    try {
      const result = await workspaceMetadataTool.handler({}, context);
      expect(result.isError).not.toBe(true);
      toolText = result.content[0].text;
      reportToolCall(suite, 'workspace_metadata', {}, toolText);
      parsed = parseToonText(toolText);
    } catch (err) {
      // Propagate setup failure clearly
      throw new Error(
        `workspace_metadata tool call failed in beforeAll: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, 30000);

  afterAll((suite) => {
    if (validatedTeams.length > 0)
      reportEntitiesValidated(suite, 'teams', validatedTeams);
    if (validatedUsers.length > 0)
      reportEntitiesValidated(suite, 'users', validatedUsers);
    if (validatedStates.length > 0)
      reportEntitiesValidated(suite, 'states', validatedStates);
    if (validatedLabels.length > 0)
      reportEntitiesValidated(suite, 'labels', validatedLabels);
    if (validatedProjects.length > 0)
      reportEntitiesValidated(suite, 'projects', validatedProjects);
    if (validatedCycles.length > 0)
      reportEntitiesValidated(suite, 'cycles', validatedCycles);
    clearRegistry(context.sessionId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Teams validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('teams', () => {
    it('all API teams are present in TOON output', async () => {
      const teamsSection = parsed.sections.get('_teams');
      expect(teamsSection, '_teams section should exist').toBeDefined();

      const apiTeams = await fetchTeams();
      expect(apiTeams.length).toBeGreaterThan(0);

      for (const apiTeam of apiTeams) {
        const toonRow = teamsSection!.rows.find((r) => r.key === apiTeam.key);
        expect(
          toonRow,
          `API team "${apiTeam.key}" (${apiTeam.name}) should be in TOON _teams`,
        ).toBeDefined();
      }
    });

    it('team fields match API', async () => {
      const teamsSection = parsed.sections.get('_teams')!;
      const apiTeams = await fetchTeams();

      for (const toonRow of teamsSection.rows) {
        const apiTeam = apiTeams.find((t) => t.key === toonRow.key);
        expect(apiTeam, `TOON team "${toonRow.key}" should exist in API`).toBeDefined();

        const ctx = { entity: 'Team', identifier: toonRow.key, field: '' };
        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        // name
        expect(
          toonRow.name,
          `Team "${toonRow.key}" name: TOON="${toonRow.name}" vs API="${apiTeam!.name}"`,
        ).toBe(apiTeam!.name);
        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: String(apiTeam!.name ?? ''),
          match: (toonRow.name ?? '') === (apiTeam!.name ?? ''),
        });

        // cyclesEnabled (boolean)
        ctx.field = 'cyclesEnabled';
        expectFieldMatch(toonRow.cyclesEnabled, apiTeam!.cyclesEnabled, ctx);
        comparisons.push({
          field: 'cyclesEnabled',
          toon: toonRow.cyclesEnabled ?? '',
          api: String(apiTeam!.cyclesEnabled ?? ''),
          match: normalizeEmpty(toonRow.cyclesEnabled) === String(apiTeam!.cyclesEnabled),
        });

        // cycleDuration
        ctx.field = 'cycleDuration';
        const apiCycleDuration = apiTeam!.cycleDuration ?? '';
        expect(
          normalizeEmpty(toonRow.cycleDuration),
          `Team "${toonRow.key}" cycleDuration: TOON="${toonRow.cycleDuration}" vs API="${apiCycleDuration}"`,
        ).toBe(normalizeEmpty(apiCycleDuration));
        comparisons.push({
          field: 'cycleDuration',
          toon: toonRow.cycleDuration ?? '',
          api: String(apiCycleDuration),
          match: normalizeEmpty(toonRow.cycleDuration) === normalizeEmpty(apiCycleDuration),
        });

        // estimationType (SDK field is issueEstimationType, TOON field is estimationType)
        ctx.field = 'estimationType';
        const apiEstimationType =
          (apiTeam as unknown as { issueEstimationType?: string })
            .issueEstimationType ?? '';
        expect(
          normalizeEmpty(toonRow.estimationType),
          `Team "${toonRow.key}" estimationType: TOON="${toonRow.estimationType}" vs API="${apiEstimationType}"`,
        ).toBe(normalizeEmpty(apiEstimationType));
        comparisons.push({
          field: 'estimationType',
          toon: toonRow.estimationType ?? '',
          api: String(apiEstimationType),
          match:
            normalizeEmpty(toonRow.estimationType) === normalizeEmpty(apiEstimationType),
        });

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            toonRow.key,
            toonRow.name,
            comparisons,
            'Team',
          );
        }

        validatedTeams.push(toonRow.key);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Users validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('users', () => {
    it('user fields match API', async () => {
      const usersSection = parsed.sections.get('_users');
      expect(usersSection, '_users section should exist').toBeDefined();

      const apiUsers = await fetchUsers();

      for (const toonRow of usersSection!.rows) {
        const apiUser = apiUsers.find((u) => u.name === toonRow.name);
        expect(
          apiUser,
          `TOON user "${toonRow.name}" (key=${toonRow.key}) should exist in API`,
        ).toBeDefined();

        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        // name
        expect(toonRow.name, `User "${toonRow.key}" name`).toBe(apiUser!.name);
        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: String(apiUser!.name ?? ''),
          match: (toonRow.name ?? '') === (apiUser!.name ?? ''),
        });

        // displayName
        expect(
          normalizeEmpty(toonRow.displayName),
          `User "${toonRow.key}" displayName: TOON="${toonRow.displayName}" vs API="${apiUser!.displayName}"`,
        ).toBe(normalizeEmpty(apiUser!.displayName));
        comparisons.push({
          field: 'displayName',
          toon: toonRow.displayName ?? '',
          api: String(apiUser!.displayName ?? ''),
          match:
            normalizeEmpty(toonRow.displayName) === normalizeEmpty(apiUser!.displayName),
        });

        // email
        expect(
          normalizeEmpty(toonRow.email),
          `User "${toonRow.key}" email: TOON="${toonRow.email}" vs API="${apiUser!.email}"`,
        ).toBe(normalizeEmpty(apiUser!.email));
        comparisons.push({
          field: 'email',
          toon: toonRow.email ?? '',
          api: String(apiUser!.email ?? ''),
          match: normalizeEmpty(toonRow.email) === normalizeEmpty(apiUser!.email),
        });

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            toonRow.key,
            toonRow.name,
            comparisons,
            'User',
          );
        }

        validatedUsers.push(toonRow.key);
      }
    });

    it('short keys are assigned by createdAt ascending (u0 = oldest)', async () => {
      const usersSection = parsed.sections.get('_users')!;
      const apiUsers = await fetchUsers();

      // Sort API users by createdAt ascending (same logic as registry's sortByCreatedAt)
      const sortedApiUsers = [...apiUsers].sort((a, b) => {
        const dateA =
          a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt));
        const dateB =
          b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt));
        return dateA.getTime() - dateB.getTime();
      });

      // TOON rows may not be in createdAt order (they follow API response order).
      // But the short key index must match the user's position in createdAt-sorted order.
      // e.g., the user with key "u0" must be the oldest user by createdAt.
      for (const toonRow of usersSection.rows) {
        // Extract numeric index from the short key (e.g., "u3" -> 3)
        const match = (toonRow.key as string).match(/^u(\d+)$/);
        expect(
          match,
          `User key "${toonRow.key}" should match pattern u<number>`,
        ).not.toBeNull();

        const keyIndex = Number(match![1]);
        expect(
          keyIndex,
          `User key index ${keyIndex} should be within range of sorted API users (count=${sortedApiUsers.length})`,
        ).toBeLessThan(sortedApiUsers.length);

        // The user at this key index should match the createdAt-sorted API user at the same position
        expect(
          toonRow.name,
          `User key ${toonRow.key} should be "${sortedApiUsers[keyIndex].name}" (position ${keyIndex} in createdAt order)`,
        ).toBe(sortedApiUsers[keyIndex].name);
      }
    });

    it('all API users are present in TOON output', async () => {
      const usersSection = parsed.sections.get('_users')!;
      const apiUsers = await fetchUsers();

      // Filter to active users — workspace_metadata includes all users from client.users()
      for (const apiUser of apiUsers) {
        const toonRow = usersSection.rows.find((r) => r.name === apiUser.name);
        expect(
          toonRow,
          `API user "${apiUser.name}" should be in TOON _users`,
        ).toBeDefined();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. States validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('states', () => {
    it('state fields match API', async () => {
      const statesSection = parsed.sections.get('_states');
      expect(statesSection, '_states section should exist').toBeDefined();

      // Fetch states for all teams
      const apiTeams = await fetchTeams();
      const allApiStates: Array<{
        id: string;
        name: string;
        type: string;
        teamId: string;
        createdAt: Date | string;
      }> = [];

      for (const team of apiTeams) {
        const states = await fetchStates(team.id);
        for (const s of states) {
          allApiStates.push({
            id: s.id,
            name: s.name,
            type: (s as unknown as { type?: string }).type ?? '',
            teamId: team.id,
            createdAt: s.createdAt,
          });
        }
      }

      for (const toonRow of statesSection!.rows) {
        // Find matching API state by name (state names may not be globally unique,
        // but within the same key prefix they should match)
        const matchingApiStates = allApiStates.filter((s) => s.name === toonRow.name);
        expect(
          matchingApiStates.length,
          `TOON state "${toonRow.key}" (name="${toonRow.name}") should have at least one API match`,
        ).toBeGreaterThan(0);

        // At least one matching API state should have the same type
        const typeMatch = matchingApiStates.some((s) => s.type === toonRow.type);
        expect(
          typeMatch,
          `TOON state "${toonRow.key}" type "${toonRow.type}" should match one of the API states named "${toonRow.name}"`,
        ).toBe(true);

        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        // name — at least one API state matched by name
        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: matchingApiStates[0]?.name ?? '',
          match: matchingApiStates.length > 0,
        });

        // type — at least one API state with matching name also has matching type
        comparisons.push({
          field: 'type',
          toon: toonRow.type ?? '',
          api: matchingApiStates.find((s) => s.type === toonRow.type)?.type
            ?? matchingApiStates[0]?.type
            ?? '',
          match: typeMatch,
        });

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            toonRow.key,
            toonRow.name,
            comparisons,
            'State',
          );
        }

        validatedStates.push(toonRow.key);
      }
    });

    it('state key prefixing follows DEFAULT_TEAM convention', () => {
      const statesSection = parsed.sections.get('_states')!;
      const defaultTeam = process.env.DEFAULT_TEAM;

      if (!defaultTeam) {
        // Without DEFAULT_TEAM, all states get flat sequential keys
        for (const toonRow of statesSection.rows) {
          expect(
            toonRow.key,
            `State "${toonRow.name}" key should be unprefixed (no DEFAULT_TEAM)`,
          ).toMatch(/^s\d+$/);
        }
        return;
      }

      // With DEFAULT_TEAM set, default team states get clean keys (s0, s1...)
      // Other teams get prefixed keys (sqm:s0, eng:s0...)
      let hasCleanKeys = false;
      let hasPrefixedKeys = false;

      for (const toonRow of statesSection.rows) {
        if (/^s\d+$/.test(toonRow.key)) {
          hasCleanKeys = true;
        } else if (/^[a-z]+:s\d+$/.test(toonRow.key)) {
          hasPrefixedKeys = true;
        }
      }

      // Default team should always produce clean keys
      expect(
        hasCleanKeys,
        'Default team states should have clean keys (s0, s1...)',
      ).toBe(true);

      // If there are multiple teams, we should see prefixed keys too
      // (but don't assert if workspace only has one team)
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Labels validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('labels', () => {
    it('label names match API', async () => {
      const labelsSection = parsed.sections.get('_labels');
      if (!labelsSection || labelsSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(suiteRef, 'label names match API', 'no labels in workspace');
        return;
      }

      // Fetch labels for teams shown in the TOON output
      const apiTeams = await fetchTeams();
      const allApiLabels: Array<{ name: string; teamId: string }> = [];

      for (const team of apiTeams) {
        const labels = await fetchLabels(team.id);
        for (const l of labels) {
          allApiLabels.push({ name: l.name, teamId: team.id });
        }
      }

      for (const toonRow of labelsSection.rows) {
        const apiMatch = allApiLabels.find((l) => l.name === toonRow.name);
        expect(
          apiMatch,
          `TOON label "${toonRow.name}" should exist in API labels`,
        ).toBeDefined();

        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: apiMatch?.name ?? '',
          match: apiMatch !== undefined,
        });

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            toonRow.name,
            undefined,
            comparisons,
            'Label',
          );
        }

        validatedLabels.push(toonRow.name);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Projects validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('projects', () => {
    it('project fields match API', async () => {
      const projectsSection = parsed.sections.get('_projects');
      if (!projectsSection || projectsSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(suiteRef, 'project fields match API', 'no projects in workspace');
        return;
      }

      // Fetch projects for all teams (to handle multi-team projects)
      const apiTeams = await fetchTeams();
      const allApiProjects: Array<{
        id: string;
        name: string;
        state: string;
        priority: number;
        progress: number;
        leadId?: string;
        targetDate?: string;
      }> = [];
      const seenIds = new Set<string>();

      for (const team of apiTeams) {
        const projects = await fetchProjects(team.id);
        for (const p of projects) {
          if (seenIds.has(p.id)) continue;
          seenIds.add(p.id);

          // Resolve lead ID — lead is a lazy-loaded relation in the SDK
          let leadId: string | undefined;
          try {
            const lead = await (
              p as unknown as { lead: Promise<{ id: string } | null> }
            ).lead;
            leadId = lead?.id;
          } catch {
            // Lead not available
          }

          allApiProjects.push({
            id: p.id,
            name: p.name,
            state: (p as unknown as { state?: string }).state ?? '',
            priority: (p as unknown as { priority?: number }).priority ?? 0,
            progress: (p as unknown as { progress?: number }).progress ?? 0,
            leadId,
            targetDate: (p as unknown as { targetDate?: string }).targetDate,
          });
        }
      }

      const registry = getStoredRegistry(context.sessionId);
      expect(registry, 'Registry should exist after tool call').toBeDefined();

      for (const toonRow of projectsSection.rows) {
        // Verify short key format
        expect(toonRow.key).toMatch(/^pr\d+$/);

        const apiProject = allApiProjects.find((p) => p.name === toonRow.name);
        expect(
          apiProject,
          `TOON project "${toonRow.key}" (name="${toonRow.name}") should exist in API`,
        ).toBeDefined();

        const ctx = {
          entity: 'Project',
          identifier: toonRow.key,
          field: '',
        };
        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        // name
        expect(toonRow.name, `Project "${toonRow.key}" name`).toBe(apiProject!.name);
        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: String(apiProject!.name ?? ''),
          match: (toonRow.name ?? '') === (apiProject!.name ?? ''),
        });

        // state
        ctx.field = 'state';
        expect(
          normalizeEmpty(toonRow.state),
          `Project "${toonRow.key}" state: TOON="${toonRow.state}" vs API="${apiProject!.state}"`,
        ).toBe(normalizeEmpty(apiProject!.state));
        comparisons.push({
          field: 'state',
          toon: toonRow.state ?? '',
          api: String(apiProject!.state ?? ''),
          match: normalizeEmpty(toonRow.state) === normalizeEmpty(apiProject!.state),
        });

        // priority (raw number, not prefixed in _projects)
        ctx.field = 'priority';
        const toonPriority = toonRow.priority ? Number(toonRow.priority) : null;
        const apiPriority = apiProject!.priority ?? null;
        if (toonPriority !== null || apiPriority !== null) {
          expect(
            toonPriority,
            `Project "${toonRow.key}" priority: TOON="${toonRow.priority}" vs API="${apiPriority}"`,
          ).toBe(apiPriority);
        }
        comparisons.push({
          field: 'priority',
          toon: toonRow.priority ?? '',
          api: String(apiPriority ?? ''),
          match:
            toonPriority === null && apiPriority === null
              ? true
              : toonPriority === apiPriority,
        });

        // progress (with rounding)
        ctx.field = 'progress';
        expectProgressMatch(toonRow.progress, apiProject!.progress, ctx);
        const toonProgressNum = toonRow.progress ? parseFloat(toonRow.progress) : null;
        const toonProgressRounded =
          toonProgressNum !== null && !Number.isNaN(toonProgressNum)
            ? Math.round(toonProgressNum * 100) / 100
            : null;
        const apiProgressRounded =
          apiProject!.progress !== null && apiProject!.progress !== undefined
            ? Math.round(apiProject!.progress * 100) / 100
            : null;
        comparisons.push({
          field: 'progress',
          toon: toonRow.progress ?? '',
          api: String(apiProject!.progress ?? ''),
          match: toonProgressRounded === apiProgressRounded,
        });

        // lead short key -> resolves via registry -> matches API lead.id
        if (toonRow.lead && toonRow.lead !== '') {
          const resolvedLeadUuid = resolveShortKey(registry!, 'user', toonRow.lead);
          expect(
            resolvedLeadUuid,
            `Project "${toonRow.key}" lead short key "${toonRow.lead}" should resolve to API lead UUID "${apiProject!.leadId}"`,
          ).toBe(apiProject!.leadId);
          comparisons.push({
            field: 'lead',
            toon: formatWithResolution(registry, 'lead', toonRow.lead),
            api: apiProject!.leadId ?? '',
            match: resolvedLeadUuid === apiProject!.leadId,
          });
        } else {
          comparisons.push({
            field: 'lead',
            toon: '',
            api: apiProject!.leadId ?? '',
            match: !apiProject!.leadId,
          });
        }

        // targetDate
        ctx.field = 'targetDate';
        expectDateMatch(toonRow.targetDate, apiProject!.targetDate, ctx);
        {
          const toonDate = toonRow.targetDate ?? '';
          const apiDate = apiProject!.targetDate ?? '';
          const apiStr = apiDate instanceof Date ? apiDate.toISOString() : String(apiDate);
          let dateMatch: boolean;
          if (!toonDate && !apiDate) {
            dateMatch = true;
          } else if (!toonDate || !apiDate) {
            dateMatch = normalizeEmpty(toonDate) === normalizeEmpty(apiDate);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(toonDate)) {
            dateMatch = toonDate === apiStr.split('T')[0];
          } else {
            dateMatch = toonDate === apiStr;
          }
          comparisons.push({
            field: 'targetDate',
            toon: toonDate,
            api: apiStr,
            match: dateMatch,
          });
        }

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            toonRow.key,
            toonRow.name,
            comparisons,
            'Project',
          );
        }

        validatedProjects.push(toonRow.key);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Cycles validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('cycles', () => {
    it('cycle fields match API', async () => {
      const cyclesSection = parsed.sections.get('_cycles');
      if (!cyclesSection || cyclesSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(suiteRef, 'cycle fields match API', 'no cycles in workspace');
        return;
      }

      // Fetch cycles for teams that have cycles enabled
      const apiTeams = await fetchTeams();
      const allApiCycles: Array<{
        id: string;
        number: number;
        name: string;
        startsAt: Date;
        endsAt: Date;
        progress: number;
        teamKey: string;
      }> = [];

      for (const team of apiTeams) {
        if (!(team as unknown as { cyclesEnabled?: boolean }).cyclesEnabled) {
          continue;
        }
        const cycles = await fetchCycles(team.id, 5);
        for (const c of cycles) {
          allApiCycles.push({
            id: c.id,
            number: (c as unknown as { number?: number }).number ?? 0,
            name: (c as unknown as { name?: string }).name ?? '',
            startsAt: new Date((c as unknown as { startsAt?: Date }).startsAt ?? 0),
            endsAt: new Date((c as unknown as { endsAt?: Date }).endsAt ?? 0),
            progress: (c as unknown as { progress?: number }).progress ?? 0,
            teamKey: team.key ?? team.name,
          });
        }
      }

      for (const toonRow of cyclesSection.rows) {
        const toonNum = toonRow.num ? Number(toonRow.num) : 0;

        // Match by team + cycle number
        const apiCycle = allApiCycles.find(
          (c) => c.number === toonNum && c.teamKey === toonRow.team,
        );
        expect(
          apiCycle,
          `TOON cycle num=${toonNum} team=${toonRow.team} should exist in API`,
        ).toBeDefined();

        const ctx = {
          entity: 'Cycle',
          identifier: `${toonRow.team}#${toonNum}`,
          field: '',
        };
        const comparisons: Array<{
          field: string;
          toon: string;
          api: string;
          match: boolean;
        }> = [];

        // name
        expect(
          normalizeEmpty(toonRow.name),
          `Cycle ${toonRow.team}#${toonNum} name: TOON="${toonRow.name}" vs API="${apiCycle!.name}"`,
        ).toBe(normalizeEmpty(apiCycle!.name));
        comparisons.push({
          field: 'name',
          toon: toonRow.name ?? '',
          api: String(apiCycle!.name ?? ''),
          match: normalizeEmpty(toonRow.name) === normalizeEmpty(apiCycle!.name),
        });

        // start date
        ctx.field = 'start';
        expectDateMatch(toonRow.start, apiCycle!.startsAt, ctx);
        {
          const toonDate = toonRow.start ?? '';
          const apiStr = apiCycle!.startsAt instanceof Date
            ? apiCycle!.startsAt.toISOString()
            : String(apiCycle!.startsAt);
          let dateMatch: boolean;
          if (!toonDate && !apiCycle!.startsAt) {
            dateMatch = true;
          } else if (!toonDate || !apiCycle!.startsAt) {
            dateMatch = normalizeEmpty(toonDate) === normalizeEmpty(apiCycle!.startsAt);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(toonDate)) {
            dateMatch = toonDate === apiStr.split('T')[0];
          } else {
            dateMatch = toonDate === apiStr;
          }
          comparisons.push({
            field: 'start',
            toon: toonDate,
            api: apiStr,
            match: dateMatch,
          });
        }

        // end date
        ctx.field = 'end';
        expectDateMatch(toonRow.end, apiCycle!.endsAt, ctx);
        {
          const toonDate = toonRow.end ?? '';
          const apiStr = apiCycle!.endsAt instanceof Date
            ? apiCycle!.endsAt.toISOString()
            : String(apiCycle!.endsAt);
          let dateMatch: boolean;
          if (!toonDate && !apiCycle!.endsAt) {
            dateMatch = true;
          } else if (!toonDate || !apiCycle!.endsAt) {
            dateMatch = normalizeEmpty(toonDate) === normalizeEmpty(apiCycle!.endsAt);
          } else if (/^\d{4}-\d{2}-\d{2}$/.test(toonDate)) {
            dateMatch = toonDate === apiStr.split('T')[0];
          } else {
            dateMatch = toonDate === apiStr;
          }
          comparisons.push({
            field: 'end',
            toon: toonDate,
            api: apiStr,
            match: dateMatch,
          });
        }

        // progress (with rounding)
        ctx.field = 'progress';
        expectProgressMatch(toonRow.progress, apiCycle!.progress, ctx);
        {
          const toonProgressNum = toonRow.progress
            ? parseFloat(toonRow.progress)
            : null;
          const toonProgressRounded =
            toonProgressNum !== null && !Number.isNaN(toonProgressNum)
              ? Math.round(toonProgressNum * 100) / 100
              : null;
          const apiProgressRounded =
            apiCycle!.progress !== null && apiCycle!.progress !== undefined
              ? Math.round(apiCycle!.progress * 100) / 100
              : null;
          comparisons.push({
            field: 'progress',
            toon: toonRow.progress ?? '',
            api: String(apiCycle!.progress ?? ''),
            match: toonProgressRounded === apiProgressRounded,
          });
        }

        // active flag: independently compute using current date vs start/end
        const now = new Date();
        const expectedActive = apiCycle!.startsAt <= now && now <= apiCycle!.endsAt;
        expect(
          toonRow.active,
          `Cycle ${toonRow.team}#${toonNum} active: TOON="${toonRow.active}" vs computed="${expectedActive}"`,
        ).toBe(String(expectedActive));
        comparisons.push({
          field: 'active',
          toon: toonRow.active ?? '',
          api: String(expectedActive),
          match: toonRow.active === String(expectedActive),
        });

        if (suiteRef && comparisons.length > 0) {
          reportFieldComparison(
            suiteRef,
            String(toonNum),
            `${toonRow.team}#${toonNum}`,
            comparisons,
            'Cycle',
          );
        }

        validatedCycles.push(`${toonRow.team}#${toonNum}`);
      }
    });

    it('only shows current or upcoming cycles', () => {
      const cyclesSection = parsed.sections.get('_cycles');
      if (!cyclesSection || cyclesSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'only shows current or upcoming cycles',
            'no cycles in workspace',
          );
        return;
      }

      const now = new Date();

      for (const toonRow of cyclesSection.rows) {
        // Parse the end date from TOON
        const endDate = toonRow.end ? new Date(toonRow.end) : null;
        const startDate = toonRow.start ? new Date(toonRow.start) : null;

        // A cycle should be either active (now is within start..end) or upcoming (start > now)
        // Since workspace_metadata filters to current + upcoming, end date should be >= today
        // (or start should be in the future)
        if (endDate && startDate) {
          const isCurrent = startDate <= now && now <= endDate;
          const isUpcoming = startDate > now;
          expect(
            isCurrent || isUpcoming,
            `Cycle num=${toonRow.num} team=${toonRow.team} should be current or upcoming (start=${toonRow.start}, end=${toonRow.end})`,
          ).toBe(true);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Registry consistency
  // ─────────────────────────────────────────────────────────────────────────

  describe('registry consistency', () => {
    it('registry is populated after tool call', () => {
      const registry = getStoredRegistry(context.sessionId);
      expect(registry, 'Registry should be stored for the session').toBeDefined();
      expect(registry!.users.size).toBeGreaterThan(0);
      expect(registry!.states.size).toBeGreaterThan(0);
    });

    it('every user short key resolves to a valid API user', async () => {
      const registry = getStoredRegistry(context.sessionId)!;
      const apiUsers = await fetchUsers();

      for (const [shortKey, uuid] of registry.users) {
        // Resolve short key -> UUID
        const resolvedUuid = resolveShortKey(registry, 'user', shortKey);
        expect(resolvedUuid, `User short key "${shortKey}" should resolve`).toBe(uuid);

        // Find this user in API by UUID
        const apiUser = apiUsers.find((u) => u.id === uuid);
        expect(
          apiUser,
          `User short key "${shortKey}" -> UUID "${uuid}" should match an API user`,
        ).toBeDefined();

        // Registry metadata should match API user name
        const metadata = registry.userMetadata.get(uuid);
        expect(
          metadata?.name,
          `User "${shortKey}" registry name should match API name "${apiUser!.name}"`,
        ).toBe(apiUser!.name);
      }
    });

    it('every state short key resolves to a valid state', async () => {
      const registry = getStoredRegistry(context.sessionId)!;

      // Fetch all states from all teams
      const apiTeams = await fetchTeams();
      const allStateIds = new Set<string>();
      for (const team of apiTeams) {
        const states = await fetchStates(team.id);
        for (const s of states) {
          allStateIds.add(s.id);
        }
      }

      for (const [shortKey, uuid] of registry.states) {
        const resolvedUuid = resolveShortKey(registry, 'state', shortKey);
        expect(resolvedUuid, `State short key "${shortKey}" should resolve`).toBe(uuid);

        expect(
          allStateIds.has(uuid),
          `State short key "${shortKey}" -> UUID "${uuid}" should be a valid state ID`,
        ).toBe(true);
      }
    });

    it('every project short key resolves to a valid project', async () => {
      const registry = getStoredRegistry(context.sessionId)!;

      if (registry.projects.size === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'every project short key resolves to a valid project',
            'no projects in workspace registry',
          );
        return;
      }

      // Fetch all projects from all teams
      const apiTeams = await fetchTeams();
      const allProjectIds = new Set<string>();
      for (const team of apiTeams) {
        const projects = await fetchProjects(team.id);
        for (const p of projects) {
          allProjectIds.add(p.id);
        }
      }

      for (const [shortKey, uuid] of registry.projects) {
        const resolvedUuid = resolveShortKey(registry, 'project', shortKey);
        expect(resolvedUuid, `Project short key "${shortKey}" should resolve`).toBe(
          uuid,
        );

        expect(
          allProjectIds.has(uuid),
          `Project short key "${shortKey}" -> UUID "${uuid}" should be a valid project ID`,
        ).toBe(true);
      }
    });

    it('every TOON project key exists in the registry', () => {
      const registry = getStoredRegistry(context.sessionId)!;
      const projectsSection = parsed.sections.get('_projects');
      if (!projectsSection || projectsSection.rows.length === 0) {
        if (suiteRef)
          reportSkip(
            suiteRef,
            'every TOON project key exists in the registry',
            'no projects in TOON output',
          );
        return;
      }

      for (const toonRow of projectsSection.rows) {
        expect(
          registry.projects.has(toonRow.key),
          `TOON project key "${toonRow.key}" (name="${toonRow.name}") should exist in registry.projects`,
        ).toBe(true);
      }
    });
  });
});
