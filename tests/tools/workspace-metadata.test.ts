/**
 * Tests for workspace_metadata tool.
 * Verifies: input validation, output shape, TOON format output.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import workspaceMetadataFixtures from '../fixtures/tool-inputs/workspace-metadata.json';
import {
  createMockLinearClient,
  type MockLinearClient,
  resetMockCalls,
} from '../mocks/linear-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

// Mock the getLinearClient function
vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata tool metadata', () => {
  it('has correct name and title', () => {
    expect(workspaceMetadataTool.name).toBe('workspace_metadata');
    expect(workspaceMetadataTool.title).toBe('Discover IDs (Use First)');
  });

  it('has readOnlyHint annotation', () => {
    expect(workspaceMetadataTool.annotations?.readOnlyHint).toBe(true);
    expect(workspaceMetadataTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description for LLM', () => {
    expect(workspaceMetadataTool.description).toContain('discover');
    expect(workspaceMetadataTool.description).toContain('viewer');
    expect(workspaceMetadataTool.description).toContain('teams');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of workspaceMetadataFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = workspaceMetadataTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of workspaceMetadataFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = workspaceMetadataTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
        if (!result.success) {
          const errorMessage = result.error.errors.map((e) => e.message).join(', ');
          expect(errorMessage).toContain(fixture.expectedError);
        }
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests (TOON format)
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata handler', () => {
  it('returns TOON format output', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // TOON format is returned in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('_teams[');
  });

  it('returns counts for all entity types', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // Counts are embedded in text content section headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_teams[');
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('_labels[');
    expect(textContent).toContain('_projects[');
  });

  it('returns TOON text content with section headers', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0];
    expect(textContent.type).toBe('text');

    // TOON output should contain section headers
    const text = textContent.text;
    expect(text).toContain('_meta{');
    expect(text).toContain('_teams[');
    expect(text).toContain('_users[');
    expect(text).toContain('_states[');
    expect(text).toContain('_labels[');
  });

  it('includes all teams in TOON output', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;

    // Should include teams from mock - SQT is the primary team
    // Note: When DEFAULT_TEAM is set, only that team is shown
    expect(text).toContain('SQT');
    expect(text).toContain('Squad Testing');
  });

  it('includes all users in TOON output (Tier 1)', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // User short keys should be in output
    expect(text).toContain('u0');
    expect(text).toContain('_users[');
  });

  it('includes all states in TOON output (Tier 1)', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // State short keys should be in output
    expect(text).toContain('s0');
    expect(text).toContain('_states[');

    // State names should be present
    expect(text).toContain('Backlog');
    expect(text).toContain('Todo');
    expect(text).toContain('In Progress');
    expect(text).toContain('Done');
  });

  it('includes all labels in TOON output (Tier 1)', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // Labels section should be present
    expect(text).toContain('_labels[');

    // Label names should be present (labels use name as key, not short key)
    expect(text).toContain('Bug');
    expect(text).toContain('Feature');
  });

  it('stores registry when TOON is enabled', async () => {
    // Import registry functions
    const { getStoredRegistry, clearRegistry } = await import(
      '../../src/shared/toon/registry.js'
    );

    // Clear any existing registry
    clearRegistry(baseContext.sessionId);

    await workspaceMetadataTool.handler({}, baseContext);

    // Registry should be stored
    const registry = getStoredRegistry(baseContext.sessionId);
    expect(registry).toBeDefined();
    expect(registry?.users.size).toBeGreaterThan(0);
    expect(registry?.states.size).toBeGreaterThan(0);
    expect(registry?.projects.size).toBeGreaterThan(0);

    // Clean up
    clearRegistry(baseContext.sessionId);
  });

  it('accepts forceRefresh parameter', async () => {
    // Test that forceRefresh is accepted in input schema
    const result = workspaceMetadataTool.inputSchema.safeParse({ forceRefresh: true });
    expect(result.success).toBe(true);
  });

  it('filters teams by teamIds when provided', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');
    clearRegistry(baseContext.sessionId);

    const result = await workspaceMetadataTool.handler(
      { teamIds: ['team-eng'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify teams() was called to fetch all teams (needed for registry)
    expect(mockClient.teams).toHaveBeenCalled();

    const text = result.content[0].text;

    // _teams shows ALL teams (not just filtered)
    expect(text).toMatch(/_teams\[4\]/);

    // States now show ALL teams (not filtered) — 19 total states
    const statesSection = text.match(
      /_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
    );
    expect(statesSection).not.toBeNull();
    expect(statesSection![1]).toContain('In Review'); // SQT state present
    expect(statesSection![1]).toContain('Pending'); // SQM state present
    expect(text).toMatch(/_states\[19\]/);

    clearRegistry(baseContext.sessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Schema Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata output schema compliance', () => {
  it('returns TOON format in text content', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // TOON format is in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('_teams[');
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('_states[');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8: Bug Fix Verification Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata bug fix verification (Phase 8)', () => {
  it('state keys match registry (registry-based assignment)', async () => {
    const { getStoredRegistry, clearRegistry } = await import(
      '../../src/shared/toon/registry.js'
    );

    clearRegistry(baseContext.sessionId);

    const result = await workspaceMetadataTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();

    const registry = getStoredRegistry(baseContext.sessionId);
    expect(registry).toBeDefined();

    const text = result.content[0].text;

    // Extract state keys from the _states section in TOON output
    // The _states section has lines like: s0,Backlog,backlog
    const statesMatch = text.match(
      /_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
    );
    expect(statesMatch).not.toBeNull();

    const stateLines = statesMatch![1]
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    expect(stateLines.length).toBeGreaterThan(0);

    // Each state key in the output should exist in the registry's statesByUuid values
    const registryStateKeys = new Set(registry!.statesByUuid.values());
    for (const line of stateLines) {
      const key = line.split(',')[0];
      expect(registryStateKeys).toContain(key);
    }

    clearRegistry(baseContext.sessionId);
  });

  it('DEFAULT_TEAM shows all teams and all states', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefaultTeam = config.DEFAULT_TEAM;

    try {
      // Set DEFAULT_TEAM to SQT
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';

      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // _teams should show ALL 4 teams (not just SQT)
      expect(text).toMatch(/_teams\[4\]/);
      expect(text).toContain('SQT');
      expect(text).toContain('Squad Testing');

      // States now show ALL teams — including SQM states
      expect(text).toContain('Pending'); // SQM state
      expect(text).toContain('Resolved'); // SQM state
      expect(text).toMatch(/_states\[19\]/);
    } finally {
      // Restore original config
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefaultTeam;
      clearRegistry(baseContext.sessionId);
    }
  });

  it('projects are deduplicated across teams', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    // Create a shared project that appears in BOTH SQT and ENG teams
    const sharedProject = {
      id: 'project-shared',
      name: 'Cross-Team Project',
      state: 'started',
      lead: { id: 'user-001' },
      leadId: 'user-001',
      createdAt: new Date('2024-10-01T00:00:00Z'),
    };

    // Override both teams' projects() to return the same project
    const originalSqtProjects =
      mockClient._config.teams?.[0]?.projects ?? (mockClient as any).teams;
    const sqtTeam = (await mockClient.teams()).nodes[0];
    const engTeam = (await mockClient.teams()).nodes[1];

    const originalSqtProjectsFn = sqtTeam.projects;
    const originalEngProjectsFn = engTeam.projects;

    sqtTeam.projects = () => Promise.resolve({ nodes: [sharedProject] });
    engTeam.projects = () => Promise.resolve({ nodes: [sharedProject] });

    try {
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // Count occurrences of the shared project name in the _projects section
      const projectsSectionMatch = text.match(
        /_projects\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(projectsSectionMatch).not.toBeNull();

      const projectLines = projectsSectionMatch![1].trim().split('\n').filter(Boolean);
      const sharedProjectOccurrences = projectLines.filter((line: string) =>
        line.includes('Cross-Team Project'),
      );
      // Project should appear exactly once (deduplicated)
      expect(sharedProjectOccurrences.length).toBe(1);
    } finally {
      // Restore original project functions
      sqtTeam.projects = originalSqtProjectsFn;
      engTeam.projects = originalEngProjectsFn;
      clearRegistry(baseContext.sessionId);
    }
  });

  it('PROJECT_LOOKUP_SCHEMA has all 8 fields', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    clearRegistry(baseContext.sessionId);

    const result = await workspaceMetadataTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;

    // Verify _projects header contains all 8 fields
    const projectsHeader = text.match(/_projects\[\d+\]\{([^}]+)\}/);
    expect(projectsHeader).not.toBeNull();

    const fields = projectsHeader![1].split(',');
    expect(fields).toContain('key');
    expect(fields).toContain('name');
    expect(fields).toContain('icon');
    expect(fields).toContain('state');
    expect(fields).toContain('priority');
    expect(fields).toContain('progress');
    expect(fields).toContain('lead');
    expect(fields).toContain('targetDate');
    expect(fields.length).toBe(8);

    clearRegistry(baseContext.sessionId);
  });

  it('cycle output includes team key for disambiguation', async () => {
    // Override cycles to be active (default mock dates are in the past)
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const activeCycles = [
      {
        id: 'cycle-active-sqt',
        name: 'Active Sprint',
        number: 5,
        startsAt: weekAgo,
        endsAt: weekAhead,
        progress: 0.4,
        team: { id: 'team-sqt' },
      },
    ];

    // Get the SQT team mock and override its cycles (save original to restore)
    const teams = (await mockClient.teams({ first: 100 })).nodes;
    const sqtTeam = teams.find((t: { id: string }) => t.id === 'team-sqt');
    const originalCycles = sqtTeam!.cycles;
    sqtTeam!.cycles = () =>
      Promise.resolve({ nodes: activeCycles, pageInfo: { hasNextPage: false } });

    try {
      const result = await workspaceMetadataTool.handler({}, baseContext);
      const text = result.content[0].text;

      // Verify _cycles header includes team field
      const cycleHeaderMatch = text.match(/_cycles\[\d+\]\{([^}]+)\}/);
      expect(cycleHeaderMatch).not.toBeNull();
      const cycleFields = cycleHeaderMatch![1].split(',');
      expect(cycleFields).toContain('team');
      expect(cycleFields).toContain('num');

      // Verify cycle rows contain team keys
      const cyclesSection = text.slice(text.indexOf('_cycles['));
      expect(cyclesSection).toContain('SQT');
    } finally {
      // Restore original cycles to avoid polluting other tests
      sqtTeam!.cycles = originalCycles;
    }
  });

  it('resolves team keys in teamIds (not just UUIDs)', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');
    clearRegistry(baseContext.sessionId);

    const result = await workspaceMetadataTool.handler(
      { teamIds: ['ENG'] },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;

    // States now show ALL teams (not filtered) — 19 total
    const statesSection = text.match(
      /_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
    );
    expect(statesSection).not.toBeNull();
    expect(statesSection![1]).toContain('In Review'); // SQT state present
    expect(statesSection![1]).toContain('Pending'); // SQM state present
    expect(text).toMatch(/_states\[19\]/);

    // _meta should show ENG as the team
    expect(text).toMatch(/_meta\{[^}]+\}:\n\s+[^,]+,ENG,/);

    clearRegistry(baseContext.sessionId);
  });

  it('teamIds overrides DEFAULT_TEAM for output filtering', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefault = config.DEFAULT_TEAM;
    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler(
        { teamIds: ['SQM'] },
        baseContext,
      );
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // _meta should show SQM (the requested team), not SQT (the default)
      expect(text).toMatch(/_meta\{[^}]+\}:\n\s+[^,]+,SQM,/);

      // States now show ALL teams — both SQM and SQT states present
      expect(text).toContain('Pending');
      expect(text).toContain('Active');
      expect(text).toContain('Resolved');
      expect(text).toContain('In Review'); // SQT state also present
      expect(text).toMatch(/_states\[19\]/);

      // Labels should still be filtered to SQM (teamIds override)
      expect(text).toContain('Urgent'); // SQM label
      expect(text).toContain('Needs Review'); // SQM label

      clearRegistry(baseContext.sessionId);
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefault;
    }
  });

  it('registry maintains team-prefixed keys when teamIds overrides DEFAULT_TEAM', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry, getStoredRegistry } = await import(
      '../../src/shared/toon/registry.js'
    );

    const originalDefault = config.DEFAULT_TEAM;
    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      // Call with explicit SQM team
      await workspaceMetadataTool.handler({ teamIds: ['SQM'] }, baseContext);

      // Registry should still have defaultTeamId=SQT for key prefixing
      const registry = getStoredRegistry(baseContext.sessionId);
      expect(registry).not.toBeNull();

      // SQM states should have prefixed keys (sqm:s0, sqm:s1...)
      const sqmStateKeys = [...registry!.states.entries()].filter(([key]) =>
        key.startsWith('sqm:'),
      );
      expect(sqmStateKeys.length).toBeGreaterThan(0);

      clearRegistry(baseContext.sessionId);
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefault;
    }
  });

  it('_teams section shows all workspace teams regardless of filter', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefault = config.DEFAULT_TEAM;
    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();
      const text = result.content[0].text;

      // _teams should list ALL 4 teams, not just SQT
      expect(text).toMatch(/_teams\[4\]/);
      expect(text).toContain('SQT');
      expect(text).toContain('ENG');
      expect(text).toContain('DES');
      expect(text).toContain('SQM');

      clearRegistry(baseContext.sessionId);
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefault;
    }
  });

  it('include parameter is stripped from input schema (removed)', () => {
    // The `include` parameter was removed from InputSchema.
    // Zod should strip the unknown key and parse successfully.
    const result = workspaceMetadataTool.inputSchema.safeParse({
      include: ['profile'],
    });
    expect(result.success).toBe(true);

    // The parsed data should NOT contain `include`
    if (result.success) {
      expect((result.data as Record<string, unknown>).include).toBeUndefined();
    }
  });

  it('shows all teams states regardless of DEFAULT_TEAM filter', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefaultTeam = config.DEFAULT_TEAM;

    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // _states section should contain states from ALL teams (19 total)
      expect(text).toMatch(/_states\[19\]/);

      // SQT states present (including SQT-only "In Review")
      expect(text).toContain('In Review');
      expect(text).toContain('Backlog');
      expect(text).toContain('Todo');

      // SQM states present
      expect(text).toContain('Pending');
      expect(text).toContain('Active');
      expect(text).toContain('Resolved');

      // SQT states have clean (unprefixed) keys, other teams have prefixed keys
      const statesSection = text.match(
        /_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(statesSection).not.toBeNull();
      const stateLines = statesSection![1]
        .trim()
        .split('\n')
        .map((l: string) => l.trim());

      // SQT states: clean keys (s0, s1, s2, s3, s4, s5)
      const sqtStates = stateLines.filter((l: string) => /^s\d+,/.test(l));
      expect(sqtStates.length).toBe(6); // 6 SQT states

      // SQM states: prefixed keys (sqm:s0, sqm:s1, sqm:s2)
      const sqmStates = stateLines.filter((l: string) => l.startsWith('sqm:'));
      expect(sqmStates.length).toBe(3); // 3 SQM states

      // ENG states: prefixed keys (eng:s0, eng:s1, ...)
      const engStates = stateLines.filter((l: string) => l.startsWith('eng:'));
      expect(engStates.length).toBe(5); // 5 ENG states

      // DES states: prefixed keys (des:s0, des:s1, ...)
      const desStates = stateLines.filter((l: string) => l.startsWith('des:'));
      expect(desStates.length).toBe(5); // 5 DES states
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefaultTeam;
      clearRegistry(baseContext.sessionId);
    }
  });

  it('shows all users with teams column', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefaultTeam = config.DEFAULT_TEAM;

    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // All 3 users should appear
      expect(text).toMatch(/_users\[3\]/);
      expect(text).toContain('Test User');
      expect(text).toContain('Jane Doe');
      expect(text).toContain('Bob Smith');

      // _users header should include `teams` field
      expect(text).toMatch(/_users\[3\]\{key,name,displayName,email,role,teams\}/);

      // User rows should include team membership
      const usersSection = text.match(
        /_users\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(usersSection).not.toBeNull();
      const userLines = usersSection![1]
        .trim()
        .split('\n')
        .map((l: string) => l.trim());

      // user-001 (Test User) is in SQT, ENG, DES
      const user0Line = userLines.find((l: string) => l.startsWith('u0,'));
      expect(user0Line).toBeDefined();
      expect(user0Line).toContain('SQT');
      expect(user0Line).toContain('ENG');
      expect(user0Line).toContain('DES');

      // user-002 (Jane Doe) is in SQT, ENG, SQM
      const user1Line = userLines.find((l: string) => l.startsWith('u1,'));
      expect(user1Line).toBeDefined();
      expect(user1Line).toContain('SQT');
      expect(user1Line).toContain('ENG');
      expect(user1Line).toContain('SQM');

      // user-003 (Bob Smith) is in SQT, ENG, SQM
      const user2Line = userLines.find((l: string) => l.startsWith('u2,'));
      expect(user2Line).toBeDefined();
      expect(user2Line).toContain('SQT');
      expect(user2Line).toContain('ENG');
      expect(user2Line).toContain('SQM');
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefaultTeam;
      clearRegistry(baseContext.sessionId);
    }
  });

  it('shows (deactivated) label in _projects lead column for deactivated project lead', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    clearRegistry(baseContext.sessionId);

    // Create a project with a deactivated user as lead
    const deactivatedLeadProject = {
      id: 'project-deactivated-lead',
      name: 'Deactivated Lead Project',
      state: 'started',
      lead: { id: 'user-deactivated' },
      leadId: 'user-deactivated',
      createdAt: new Date('2024-10-01T00:00:00Z'),
    };

    // Override the SQT team's projects() to include our project
    const sqtTeam = (await mockClient.teams()).nodes[0];
    const originalProjectsFn = sqtTeam.projects;
    sqtTeam.projects = () => Promise.resolve({ nodes: [deactivatedLeadProject] });

    try {
      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // The _projects section should have the project with (deactivated) as lead
      const projectsSection = text.match(
        /_projects\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(projectsSection).not.toBeNull();

      const projectLine = projectsSection![1]
        .trim()
        .split('\n')
        .find((l: string) => l.includes('Deactivated Lead Project'));
      expect(projectLine).toBeDefined();
      expect(projectLine).toContain('(deactivated)');

      // Deactivated user should NOT appear in _users section (active users only)
      const usersSection = text.match(
        /_users\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(usersSection).not.toBeNull();
      expect(usersSection![1]).not.toContain('Deactivated Dave');
    } finally {
      sqtTeam.projects = originalProjectsFn;
      clearRegistry(baseContext.sessionId);
    }
  });

  it('keeps labels filtered to default team while showing all states', async () => {
    const { config } = await import('../../src/config/env.js');
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    const originalDefaultTeam = config.DEFAULT_TEAM;

    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      clearRegistry(baseContext.sessionId);

      const result = await workspaceMetadataTool.handler({}, baseContext);
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // _labels should contain SQT labels only (filtered to default team)
      const labelsSection = text.match(
        /_labels\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(labelsSection).not.toBeNull();

      // SQT labels present
      expect(labelsSection![1]).toContain('Bug');
      expect(labelsSection![1]).toContain('Feature');
      expect(labelsSection![1]).toContain('Documentation');

      // SQM labels NOT present (labels are still filtered)
      expect(labelsSection![1]).not.toContain('Urgent');
      expect(labelsSection![1]).not.toContain('Needs Review');

      // But states should contain ALL teams' states (not filtered)
      expect(text).toMatch(/_states\[19\]/);
      expect(text).toContain('Pending'); // SQM state
      expect(text).toContain('In Review'); // SQT state
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = originalDefaultTeam;
      clearRegistry(baseContext.sessionId);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata API error handling', () => {
  it('returns structured error when viewer/teams fetch fails', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');
    clearRegistry(baseContext.sessionId);

    // Override teams to throw a network error
    mockClient.teams = vi
      .fn()
      .mockRejectedValue(
        new Error('Network request failed'),
      ) as typeof mockClient.teams;

    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Network request failed');
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent).toHaveProperty('error');
    expect(result.structuredContent).toHaveProperty('hint');

    clearRegistry(baseContext.sessionId);
  });

  it('continues when team.states() fails for one team', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');
    clearRegistry(baseContext.sessionId);

    // Get the actual teams from the mock and break one team's states
    const teamsResponse = await mockClient.teams({ first: 100 });
    const sqtTeam = teamsResponse.nodes.find(
      (t: { id: string }) => t.id === 'team-sqt',
    );
    const originalStates = sqtTeam!.states;

    // SQT team's states() will throw
    sqtTeam!.states = () => Promise.reject(new Error('States fetch failed'));

    try {
      const result = await workspaceMetadataTool.handler({}, baseContext);

      // Tool should succeed (not an error)
      expect(result.isError).toBeFalsy();

      const text = result.content[0].text;

      // Should still have states from other teams (ENG, DES, SQM)
      // ENG has 5 states, DES has 5, SQM has 3 = 13 total (minus SQT's 6)
      expect(text).toContain('_states[');
      expect(text).toContain('Pending'); // SQM state still present
      expect(text).toContain('Active'); // SQM state still present

      // SQT-specific state "In Review" should be absent (SQT states failed)
      const statesSection = text.match(
        /_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/,
      );
      expect(statesSection).not.toBeNull();
      // "In Review" only exists in SQT states, so it should be missing
      expect(statesSection![1]).not.toContain('In Review');

      // Teams section should still show all teams
      expect(text).toContain('_teams[');
      expect(text).toContain('SQT');
    } finally {
      sqtTeam!.states = originalStates;
      clearRegistry(baseContext.sessionId);
    }
  });
});
