/**
 * TOON Integration Tests - End-to-End Validation
 *
 * Tests the complete TOON system working across multiple tools:
 * - Round-trip validation: read data in TOON, use short keys to update, verify changes
 * - Cross-tool consistency: same short keys resolve identically across tools
 * - Registry persistence: verify registry survives across multiple tool calls
 * - Tier 1 -> Tier 2 flow: workspace_metadata populates registry, other tools use it correctly
 *
 * Run with: bun test tests/integration/toon-round-trip.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIssuesTool } from '../../src/shared/tools/linear/create-issues.js';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { updateIssuesTool } from '../../src/shared/tools/linear/update-issues.js';
// Import tools for integration testing
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  buildRegistry,
  clearAllRegistries,
  clearRegistry,
  getStoredRegistry,
  resolveShortKey,
  type ShortKeyRegistry,
  storeRegistry,
} from '../../src/shared/toon/index.js';
import {
  createMockLinearClient,
  defaultMockProjects,
  defaultMockStates,
  defaultMockUsers,
  type MockLinearClient,
  resetMockCalls,
} from '../mocks/linear-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;

const SESSION_ID = 'integration-test-session';

const baseContext: ToolContext = {
  sessionId: SESSION_ID,
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

// Mock the getLinearClient function
vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

/**
 * Create a mock registry matching the mock Linear client data.
 * This simulates what workspace_metadata would create.
 */
function createMockRegistry(): ShortKeyRegistry {
  // Sort entities by createdAt as the registry does
  const sortedUsers = [...defaultMockUsers].map((u, i) => ({
    id: u.id,
    createdAt: new Date(
      Date.now() - (defaultMockUsers.length - i) * 24 * 60 * 60 * 1000,
    ),
  }));

  const sortedStates = [...defaultMockStates].map((s, i) => ({
    id: s.id,
    createdAt: new Date(
      Date.now() - (defaultMockStates.length - i) * 24 * 60 * 60 * 1000,
    ),
  }));

  const sortedProjects = [...defaultMockProjects].map((p, i) => ({
    id: p.id,
    createdAt:
      typeof p.createdAt === 'string'
        ? new Date(p.createdAt)
        : p.createdAt instanceof Date
          ? p.createdAt
          : new Date(
              Date.now() - (defaultMockProjects.length - i) * 24 * 60 * 60 * 1000,
            ),
  }));

  return buildRegistry({
    users: sortedUsers,
    states: sortedStates,
    projects: sortedProjects,
    workspaceId: 'test-workspace',
  });
}

beforeEach(() => {
  // Create fresh mock client
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);

  // Clear any existing registries
  clearAllRegistries();
});

afterEach(() => {
  // Clean up registries
  clearAllRegistries();
});

// ─────────────────────────────────────────────────────────────────────────────
// Full Workflow Integration Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Full Workflow Integration', () => {
  it('workspace_metadata creates registry and returns all entities (Tier 1)', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text content has TOON format
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('_states[');

    // Verify ALL users are included (Tier 1 = complete reference)
    expect(textContent).toContain('u0');

    // Verify registry was created
    const registry = getStoredRegistry(SESSION_ID);
    expect(registry).toBeDefined();
    expect(registry?.users.size).toBeGreaterThan(0);
    expect(registry?.states.size).toBeGreaterThan(0);
  });

  it('list_issues uses registry short keys from workspace_metadata (Tier 2)', async () => {
    // Step 1: Call workspace_metadata to populate registry
    await workspaceMetadataTool.handler({}, baseContext);

    // Verify registry exists
    const registry = getStoredRegistry(SESSION_ID);
    expect(registry).toBeDefined();

    // Step 2: Call list_issues - should use TOON format with short keys
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text content has TOON format with issue data
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('issues[');

    // Tier 2: Only REFERENCED states should be included
    // (may include states lookup if issues reference states)
    expect(textContent).toContain('_states[');
  });

  it('update_issues resolves short keys to UUIDs correctly', async () => {
    // Step 1: Set up registry (simulating workspace_metadata)
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Get the UUID that u1 maps to
    const user1Uuid = resolveShortKey(registry, 'user', 'u1');
    const state2Uuid = resolveShortKey(registry, 'state', 's2');

    // Step 2: Update issue using short keys
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            assignee: 'u1',
            state: 's2',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the API was called with resolved UUIDs (not short keys)
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        assigneeId: user1Uuid,
        stateId: state2Uuid,
      }),
    );
  });

  it('complete round-trip: read -> update with short key -> verify', async () => {
    // Step 1: Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Step 2: Get initial issue state
    const getResult1 = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);
    expect(getResult1.isError).toBeFalsy();

    // Step 3: Update using short key
    const updateResult = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's3', // Use short key
          },
        ],
      },
      baseContext,
    );

    expect(updateResult.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(updateResult.structuredContent).toBeUndefined();

    // Verify TOON text output contains success information
    const textContent = updateResult.content[0].text;
    expect(textContent).toContain('_meta{');

    // Verify the short key was resolved correctly
    const state3Uuid = resolveShortKey(registry, 'state', 's3');
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        stateId: state3Uuid,
      }),
    );
  });

  it('create_issues resolves multiple short keys in batch', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const u0Uuid = resolveShortKey(registry, 'user', 'u0');
    const u1Uuid = resolveShortKey(registry, 'user', 'u1');
    const s1Uuid = resolveShortKey(registry, 'state', 's1');
    const pr0Uuid = resolveShortKey(registry, 'project', 'pr0');

    // Create multiple issues with different short keys
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue 1',
            assignee: 'u0',
            state: 's1',
          },
          {
            teamId: 'team-eng',
            title: 'Issue 2',
            assignee: 'u1',
            project: 'pr0',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify both issues were created with resolved UUIDs
    expect(mockClient.createIssue).toHaveBeenCalledTimes(2);

    const calls = mockClient._calls.createIssue;
    expect(calls[0]).toEqual(
      expect.objectContaining({
        assigneeId: u0Uuid,
        stateId: s1Uuid,
      }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        assigneeId: u1Uuid,
        projectId: pr0Uuid,
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Tool Short Key Consistency Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Cross-Tool Short Key Consistency', () => {
  it('same short key resolves to same UUID across all tools', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const expectedUserUuid = resolveShortKey(registry, 'user', 'u1');
    const expectedStateUuid = resolveShortKey(registry, 'state', 's2');

    // Use u1 in create_issues
    await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test consistency',
            assignee: 'u1',
          },
        ],
      },
      baseContext,
    );

    // Verify create_issues resolved u1 correctly
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: expectedUserUuid,
      }),
    );

    // Reset calls
    resetMockCalls(mockClient);

    // Use u1 in update_issues
    await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            assignee: 'u1',
            state: 's2',
          },
        ],
      },
      baseContext,
    );

    // Verify update_issues resolved u1 to SAME UUID
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        assigneeId: expectedUserUuid,
        stateId: expectedStateUuid,
      }),
    );
  });

  it('short keys are consistent with registry throughout session', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Get all short keys from registry
    const u0Uuid = resolveShortKey(registry, 'user', 'u0');
    const u1Uuid = resolveShortKey(registry, 'user', 'u1');
    const s0Uuid = resolveShortKey(registry, 'state', 's0');
    const s1Uuid = resolveShortKey(registry, 'state', 's1');

    // Perform multiple operations using different short keys
    await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', assignee: 'u0' }] },
      baseContext,
    );

    await updateIssuesTool.handler(
      { items: [{ id: 'issue-002', assignee: 'u1', state: 's0' }] },
      baseContext,
    );

    await updateIssuesTool.handler(
      { items: [{ id: 'issue-003', state: 's1' }] },
      baseContext,
    );

    // Verify all calls used consistent UUID resolution
    const calls = mockClient._calls.updateIssue;
    expect(calls.length).toBe(3);

    expect(calls[0].input.assigneeId).toBe(u0Uuid);
    expect(calls[1].input.assigneeId).toBe(u1Uuid);
    expect(calls[1].input.stateId).toBe(s0Uuid);
    expect(calls[2].input.stateId).toBe(s1Uuid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry Persistence Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Registry Persistence', () => {
  it('registry persists across multiple tool calls within session', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Call multiple tools in sequence
    await listIssuesTool.handler({}, baseContext);
    await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);
    await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Updated' }] },
      baseContext,
    );

    // Registry should still exist
    const storedRegistry = getStoredRegistry(SESSION_ID);
    expect(storedRegistry).toBeDefined();
    expect(storedRegistry?.users.size).toBe(registry.users.size);
    expect(storedRegistry?.states.size).toBe(registry.states.size);
    expect(storedRegistry?.projects.size).toBe(registry.projects.size);
  });

  it('registry is isolated per session', async () => {
    // Set up registry for session 1
    const registry1 = createMockRegistry();
    storeRegistry('session-1', registry1);

    // Set up different registry for session 2
    const registry2 = buildRegistry({
      users: [{ id: 'different-user', createdAt: new Date() }],
      states: [{ id: 'different-state', createdAt: new Date() }],
      projects: [{ id: 'different-project', createdAt: new Date() }],
      workspaceId: 'different-workspace',
    });
    storeRegistry('session-2', registry2);

    // Verify sessions have different registries
    const stored1 = getStoredRegistry('session-1');
    const stored2 = getStoredRegistry('session-2');

    expect(stored1?.workspaceId).toBe('test-workspace');
    expect(stored2?.workspaceId).toBe('different-workspace');
    expect(stored1?.users.get('u0')).not.toBe(stored2?.users.get('u0'));
  });

  it('clearRegistry removes only specific session', async () => {
    // Set up registries for multiple sessions
    const registry = createMockRegistry();
    storeRegistry('session-a', registry);
    storeRegistry('session-b', registry);

    // Clear one session
    clearRegistry('session-a');

    // Verify only session-a was cleared
    expect(getStoredRegistry('session-a')).toBeUndefined();
    expect(getStoredRegistry('session-b')).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1 vs Tier 2 Output Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Tier 1 vs Tier 2 Output', () => {
  it('workspace_metadata (Tier 1) returns ALL entities', async () => {
    const result = await workspaceMetadataTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Text should contain all short keys from u0 to uN
    const textContent = result.content[0].text;

    // Verify Tier 1 includes all users section
    expect(textContent).toContain('_users[');
    for (let i = 0; i < defaultMockUsers.length; i++) {
      expect(textContent).toContain(`u${i}`);
    }
  });

  it('list_issues (Tier 2) returns only REFERENCED entities', async () => {
    // Set up registry first
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // The TOON output should contain states section with only referenced states
    const textContent = result.content[0].text;
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('issues[');
  });

  it('short keys are consistent between Tier 1 and Tier 2', async () => {
    // Step 1: Get Tier 1 output
    const tier1Result = await workspaceMetadataTool.handler({}, baseContext);
    const tier1Text = tier1Result.content[0].text;

    // Step 2: Get registry created by Tier 1
    const registry = getStoredRegistry(SESSION_ID);
    expect(registry).toBeDefined();

    // Step 3: Get Tier 2 output
    const tier2Result = await listIssuesTool.handler({}, baseContext);
    const tier2Text = tier2Result.content[0].text;

    // Both should use same short key format
    // If tier1 has u0 for user-001, tier2 should also have u0 for user-001
    const u0Uuid = registry?.users.get('u0');
    expect(u0Uuid).toBeDefined();

    // The state s0 should map to same UUID in both tiers
    const s0Uuid = registry?.states.get('s0');
    expect(s0Uuid).toBeDefined();

    // Both outputs should have consistent formatting
    expect(tier1Text).toContain('_users[');
    expect(tier2Text).toContain('_states[');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Negative Test Cases - Error Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Error Handling', () => {
  it('invalid short key returns helpful error with available keys', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            assignee: 'u99', // Invalid short key
          },
        ],
      },
      baseContext,
    );

    // Should not throw but report error in results
    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text output shows the failure
    const textContent = result.content[0].text;
    expect(textContent).toContain('u99');
    expect(textContent).toContain('fail');
  });

  it('invalid state short key returns clear validation error', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's999', // Invalid state short key
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text output shows the failure
    const textContent = result.content[0].text;
    expect(textContent).toContain('s999');
    expect(textContent).toContain('fail');
  });

  it('tools work gracefully without registry (still uses TOON format)', async () => {
    // Ensure no registry exists
    clearRegistry(SESSION_ID);

    // update_issues should still work with UUID-based input
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            stateId: 'state-done', // Use UUID directly
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // TOON format is always used now
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();
  });

  it('create_issues returns error for invalid project short key', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test issue',
            project: 'pr999', // Invalid project short key
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text output shows the failure
    const textContent = result.content[0].text;
    expect(textContent).toContain('pr999');
    expect(textContent).toContain('fail');
  });

  it('batch operations continue on partial short key resolution failure', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    const result = await updateIssuesTool.handler(
      {
        items: [
          { id: 'issue-001', assignee: 'u999' }, // Invalid - should fail
          { id: 'issue-002', assignee: 'u0' }, // Valid - should succeed
          { id: 'issue-003', state: 's0' }, // Valid - should succeed
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text output shows mixed results (1 failed, 2 succeeded)
    const textContent = result.content[0].text;
    expect(textContent).toContain('u999'); // Failed short key
    expect(textContent).toContain('fail');

    // Verify the successful calls were made
    expect(mockClient.updateIssue).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Tool Workflow Simulation
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Multi-Tool Workflow', () => {
  it('simulates typical Claude workflow: discover -> list -> update -> verify', async () => {
    // Step 1: Discover workspace (Tier 1)
    const workspaceResult = await workspaceMetadataTool.handler({}, baseContext);
    expect(workspaceResult.isError).toBeFalsy();

    const registry = getStoredRegistry(SESSION_ID);
    expect(registry).toBeDefined();

    // Step 2: List issues (Tier 2)
    const listResult = await listIssuesTool.handler({ limit: 10 }, baseContext);
    expect(listResult.isError).toBeFalsy();

    // Step 3: Update an issue using short key
    const updateResult = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's3', // Use short key from registry
            assignee: 'u0',
          },
        ],
      },
      baseContext,
    );
    expect(updateResult.isError).toBeFalsy();

    // Verify update used correct UUIDs
    expect(registry).toBeDefined();
    if (!registry) throw new Error('Registry should be defined');
    const expectedStateUuid = resolveShortKey(registry, 'state', 's3');
    const expectedUserUuid = resolveShortKey(registry, 'user', 'u0');

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        stateId: expectedStateUuid,
        assigneeId: expectedUserUuid,
      }),
    );

    // Step 4: Verify changes (get specific issue)
    const verifyResult = await getIssuesTool.handler(
      { ids: ['issue-001'] },
      baseContext,
    );
    expect(verifyResult.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(verifyResult.structuredContent).toBeUndefined();

    // TOON format should show the issue in text content
    const verifyText = verifyResult.content[0].text;
    expect(verifyText).toContain('issues[');
    expect(verifyText).toContain('SQT-123');
  });

  it('simulates bulk create workflow with short keys', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Create multiple issues with different short key combinations
    const createResult = await createIssuesTool.handler(
      {
        items: [
          { teamId: 'team-eng', title: 'Task 1', assignee: 'u0', state: 's1' },
          { teamId: 'team-eng', title: 'Task 2', assignee: 'u1', state: 's1' },
          { teamId: 'team-eng', title: 'Task 3', assignee: 'u0', project: 'pr0' },
        ],
      },
      baseContext,
    );

    expect(createResult.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(createResult.structuredContent).toBeUndefined();

    // Verify text output shows successful creation (succeeded,failed,total format)
    const textContent = createResult.content[0].text;
    expect(textContent).toContain('succeeded,failed,total');
    expect(textContent).toContain('3,0,3');

    // Verify all issues were created with resolved UUIDs
    expect(mockClient.createIssue).toHaveBeenCalledTimes(3);

    const u0Uuid = resolveShortKey(registry, 'user', 'u0');
    const u1Uuid = resolveShortKey(registry, 'user', 'u1');
    const s1Uuid = resolveShortKey(registry, 'state', 's1');
    const pr0Uuid = resolveShortKey(registry, 'project', 'pr0');

    const calls = mockClient._calls.createIssue;
    expect(calls[0].assigneeId).toBe(u0Uuid);
    expect(calls[0].stateId).toBe(s1Uuid);
    expect(calls[1].assigneeId).toBe(u1Uuid);
    expect(calls[2].projectId).toBe(pr0Uuid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('TOON Edge Cases', () => {
  it('handles empty issue list gracefully', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Create client with no issues
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent is undefined for success cases (only used for errors)
    expect(result.structuredContent).toBeUndefined();

    // Verify text output shows empty issues list (count: 0)
    const textContent = result.content[0].text;
    expect(textContent).toContain('count');
    expect(textContent).toContain(',0,');
  });

  it('handles update with both UUID and short key fields', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Mix of short key (state) and UUID (stateId)
    // Short key should take precedence
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's2', // Short key
            priority: 1, // Regular field
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const s2Uuid = resolveShortKey(registry, 'state', 's2');
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        stateId: s2Uuid,
        priority: 1,
      }),
    );
  });

  it('preserves registry after error in tool call', async () => {
    // Set up registry
    const registry = createMockRegistry();
    storeRegistry(SESSION_ID, registry);

    // Make the API call fail
    (mockClient.updateIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('API Error'),
    );

    const result = await updateIssuesTool.handler(
      {
        items: [{ id: 'issue-001', state: 's0' }],
      },
      baseContext,
    );

    // Tool should handle error gracefully
    expect(result.isError).toBeFalsy();

    // Registry should still exist
    const storedRegistry = getStoredRegistry(SESSION_ID);
    expect(storedRegistry).toBeDefined();
    expect(storedRegistry?.users.size).toBe(registry.users.size);
  });
});
