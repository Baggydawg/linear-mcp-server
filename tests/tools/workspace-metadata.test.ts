/**
 * Tests for workspace_metadata tool.
 * Verifies: input validation, output shape, viewer/teams/states/labels/projects fetching.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata handler', () => {
  it('returns viewer profile when include contains "profile"', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['profile'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.viewer).toBeDefined();

    const viewer = structured.viewer as Record<string, unknown>;
    expect(viewer.id).toBe('user-001');
    expect(viewer.name).toBe('Test User');
    expect(viewer.email).toBe('test@example.com');
    expect(viewer.timezone).toBe('Europe/Warsaw');
  });

  it('returns teams when include contains "teams"', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.teams).toBeDefined();
    expect(Array.isArray(structured.teams)).toBe(true);

    const teams = structured.teams as Array<Record<string, unknown>>;
    expect(teams.length).toBe(2);
    expect(teams[0].id).toBe('team-eng');
    expect(teams[0].key).toBe('ENG');
    expect(teams[0].name).toBe('Engineering');
    expect(teams[0].cyclesEnabled).toBe(true);
  });

  it('returns workflow states by team when include contains "workflow_states"', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams', 'workflow_states'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.workflowStatesByTeam).toBeDefined();
    const statesByTeam = structured.workflowStatesByTeam as Record<string, unknown[]>;

    expect(statesByTeam['team-eng']).toBeDefined();
    expect(statesByTeam['team-eng'].length).toBe(5);

    const inProgressState = statesByTeam['team-eng'].find(
      (s: unknown) => (s as Record<string, unknown>).name === 'In Progress',
    );
    expect(inProgressState).toBeDefined();
    expect((inProgressState as Record<string, unknown>).type).toBe('started');
  });

  it('returns labels by team when include contains "labels"', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams', 'labels'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.labelsByTeam).toBeDefined();
    const labelsByTeam = structured.labelsByTeam as Record<string, unknown[]>;

    expect(labelsByTeam['team-eng']).toBeDefined();
    expect(labelsByTeam['team-eng'].length).toBe(3);

    const bugLabel = labelsByTeam['team-eng'].find(
      (l: unknown) => (l as Record<string, unknown>).name === 'Bug',
    );
    expect(bugLabel).toBeDefined();
    expect((bugLabel as Record<string, unknown>).color).toBe('#ff0000');
  });

  it('returns projects when include contains "projects"', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams', 'projects'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.projects).toBeDefined();
    const projects = structured.projects as Array<Record<string, unknown>>;

    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0].name).toBe('Q1 Release');
    expect(projects[0].state).toBe('started');
    expect(projects[0].teamId).toBe('team-eng');
  });

  it('returns default includes when no include specified', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // Default: profile, teams, workflow_states, labels, projects
    expect(structured.viewer).toBeDefined();
    expect(structured.teams).toBeDefined();
    expect(structured.workflowStatesByTeam).toBeDefined();
    expect(structured.labelsByTeam).toBeDefined();
    expect(structured.projects).toBeDefined();
    // favorites is NOT included by default
    expect(structured.favorites).toBeUndefined();
  });

  it('filters teams by teamIds when provided', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams'], teamIds: ['team-eng'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    const teams = structured.teams as Array<Record<string, unknown>>;
    expect(teams.length).toBe(1);
    expect(teams[0].id).toBe('team-eng');

    // Verify team() was called with the ID
    expect(mockClient.team).toHaveBeenCalledWith('team-eng');
  });

  it('respects project_limit parameter', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['teams', 'projects'], project_limit: 1 },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    const projects = structured.projects as Array<Record<string, unknown>>;

    // With 2 teams and limit 1, should get at most 2 projects (1 per team)
    expect(projects.length).toBeLessThanOrEqual(2);
  });

  it('includes summary with counts', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.summary).toBeDefined();
    const summary = structured.summary as Record<string, number>;

    expect(typeof summary.teamCount).toBe('number');
    expect(typeof summary.stateCount).toBe('number');
    expect(typeof summary.labelCount).toBe('number');
    expect(typeof summary.projectCount).toBe('number');
  });

  it('returns text content with viewer info', async () => {
    const result = await workspaceMetadataTool.handler(
      { include: ['profile'] },
      baseContext,
    );

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0];
    expect(textContent.type).toBe('text');

    // Text should include viewer identification
    expect(textContent.text).toContain('Test User');
    expect(textContent.text).toContain('user-001');

    // Verify structuredContent matches text claims
    const structured = result.structuredContent as Record<string, unknown>;
    const viewer = structured.viewer as Record<string, unknown>;
    expect(viewer.id).toBe('user-001');
    expect(viewer.name).toBe('Test User');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Schema Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata output schema compliance', () => {
  it('structuredContent matches AccountOutputSchema shape', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as Record<string, unknown>;

    // Verify required fields
    expect(structured.summary).toBeDefined();

    // Verify viewer shape if present
    if (structured.viewer) {
      const viewer = structured.viewer as Record<string, unknown>;
      expect(typeof viewer.id).toBe('string');
    }

    // Verify teams shape if present
    if (structured.teams) {
      const teams = structured.teams as Array<Record<string, unknown>>;
      for (const team of teams) {
        expect(typeof team.id).toBe('string');
        expect(typeof team.name).toBe('string');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('workspace_metadata TOON output', () => {
  // Save original config value
  let originalToonEnabled: boolean;

  beforeEach(async () => {
    // Import config module dynamically to access the mutable config
    const configModule = await import('../../src/config/env.js');
    originalToonEnabled = configModule.config.TOON_OUTPUT_ENABLED;
  });

  afterEach(async () => {
    // Restore original config value
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      originalToonEnabled;
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED is false', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      false;

    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // Legacy format has these fields
    expect(structured.viewer).toBeDefined();
    expect(structured.teams).toBeDefined();
    expect(structured.summary).toBeDefined();
    expect(structured.quickLookup).toBeDefined();

    // Should NOT have TOON marker
    expect(structured._toon).toBeUndefined();
  });

  it('returns TOON format when TOON_OUTPUT_ENABLED is true', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // TOON format has these marker fields
    expect(structured._toon).toBe(true);
    expect(structured._format).toBe('workspace_metadata_tier1');

    // Should have counts
    expect(typeof structured.teams).toBe('number');
    expect(typeof structured.users).toBe('number');
    expect(typeof structured.states).toBe('number');
    expect(typeof structured.labels).toBe('number');
    expect(typeof structured.projects).toBe('number');
    expect(typeof structured.cycles).toBe('number');
  });

  it('returns TOON text content with proper format', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

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
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;

    // Should include both teams from mock
    expect(text).toContain('ENG');
    expect(text).toContain('Engineering');
    expect(text).toContain('DES');
    expect(text).toContain('Design');
  });

  it('includes all users in TOON output (Tier 1)', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;
    const structured = result.structuredContent as Record<string, unknown>;

    // Tier 1 should include ALL users
    expect(structured.users as number).toBeGreaterThan(0);

    // User short keys should be in output
    expect(text).toContain('u0');
  });

  it('includes all states in TOON output (Tier 1)', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;
    const structured = result.structuredContent as Record<string, unknown>;

    // Tier 1 should include ALL states
    expect(structured.states as number).toBeGreaterThan(0);

    // State short keys should be in output
    expect(text).toContain('s0');

    // State names should be present
    expect(text).toContain('Backlog');
    expect(text).toContain('Todo');
    expect(text).toContain('In Progress');
    expect(text).toContain('Done');
  });

  it('includes all labels in TOON output (Tier 1)', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

    const result = await workspaceMetadataTool.handler({}, baseContext);
    const text = result.content[0].text;
    const structured = result.structuredContent as Record<string, unknown>;

    // Tier 1 should include ALL labels
    expect(structured.labels as number).toBeGreaterThan(0);

    // Label names should be present (labels use name as key, not short key)
    expect(text).toContain('Bug');
    expect(text).toContain('Feature');
  });

  it('stores registry when TOON is enabled', async () => {
    const configModule = await import('../../src/config/env.js');
    (configModule.config as { TOON_OUTPUT_ENABLED: boolean }).TOON_OUTPUT_ENABLED =
      true;

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
});
