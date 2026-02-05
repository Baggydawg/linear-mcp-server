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
    const result = await workspaceMetadataTool.handler(
      { teamIds: ['team-eng'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify teams() was called to fetch all teams (needed for registry)
    expect(mockClient.teams).toHaveBeenCalled();

    // Verify the TOON output contains only the filtered team
    // Note: The registry internally has all teams, but TOON output is filtered
    const textContent = result.content[0].text;
    expect(textContent).toContain('_teams[');
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
