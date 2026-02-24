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

    // But states should only include ENG states (not SQT/DES/SQM)
    const statesSection = text.match(/_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/);
    expect(statesSection).not.toBeNull();
    expect(statesSection![1]).not.toContain('In Review'); // SQT-only state
    expect(statesSection![1]).not.toContain('Pending'); // SQM-only state

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
    const statesMatch = text.match(/_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/);
    expect(statesMatch).not.toBeNull();

    const stateLines = statesMatch![1].trim().split('\n').map((l: string) => l.trim()).filter(Boolean);
    expect(stateLines.length).toBeGreaterThan(0);

    // Each state key in the output should exist in the registry's statesByUuid values
    const registryStateKeys = new Set(registry!.statesByUuid.values());
    for (const line of stateLines) {
      const key = line.split(',')[0];
      expect(registryStateKeys).toContain(key);
    }

    clearRegistry(baseContext.sessionId);
  });

  it('DEFAULT_TEAM filters states but shows all teams', async () => {
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

      // States should be filtered to SQT only — no SQM states
      expect(text).not.toContain('Pending'); // SQM state
      expect(text).not.toContain('Resolved'); // SQM state
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
    const originalSqtProjects = mockClient._config.teams?.[0]?.projects ?? (mockClient as any).teams;
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
      const projectsSectionMatch = text.match(/_projects\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/);
      expect(projectsSectionMatch).not.toBeNull();

      const projectLines = projectsSectionMatch![1].trim().split('\n').filter(Boolean);
      const sharedProjectOccurrences = projectLines.filter(
        (line: string) => line.includes('Cross-Team Project'),
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

  it('PROJECT_LOOKUP_SCHEMA has all 7 fields', async () => {
    const { clearRegistry } = await import('../../src/shared/toon/registry.js');

    clearRegistry(baseContext.sessionId);

    const result = await workspaceMetadataTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();

    const text = result.content[0].text;

    // Verify _projects header contains all 7 fields
    const projectsHeader = text.match(/_projects\[\d+\]\{([^}]+)\}/);
    expect(projectsHeader).not.toBeNull();

    const fields = projectsHeader![1].split(',');
    expect(fields).toContain('key');
    expect(fields).toContain('name');
    expect(fields).toContain('state');
    expect(fields).toContain('priority');
    expect(fields).toContain('progress');
    expect(fields).toContain('lead');
    expect(fields).toContain('targetDate');
    expect(fields.length).toBe(7);

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

    const result = await workspaceMetadataTool.handler({ teamIds: ['ENG'] }, baseContext);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;

    // States should be filtered to ENG team only
    const statesSection = text.match(/_states\[\d+\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|$)/);
    expect(statesSection).not.toBeNull();
    expect(statesSection![1]).not.toContain('In Review'); // SQT-only
    expect(statesSection![1]).not.toContain('Pending'); // SQM-only

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

      // States should include SQM states (Pending, Active, Resolved)
      expect(text).toContain('Pending');
      expect(text).toContain('Active');
      expect(text).toContain('Resolved');

      // States should NOT include SQT-only states
      expect(text).not.toContain('In Review');

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
    const result = workspaceMetadataTool.inputSchema.safeParse({ include: ['profile'] });
    expect(result.success).toBe(true);

    // The parsed data should NOT contain `include`
    if (result.success) {
      expect((result.data as Record<string, unknown>).include).toBeUndefined();
    }
  });
});
