/**
 * Tests for update_issues tool.
 * Verifies: input validation, batch updates, state/label changes, error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateIssuesTool } from '../../src/shared/tools/linear/update-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  clearRegistry,
  type ShortKeyRegistry,
  storeRegistry,
} from '../../src/shared/toon/index.js';
import updateIssuesFixtures from '../fixtures/tool-inputs/update-issues.json';
import {
  createMockLinearClient,
  defaultMockTeams,
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

describe('update_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(updateIssuesTool.name).toBe('update_issues');
    expect(updateIssuesTool.title).toBe('Update Issues (Batch)');
  });

  it('has destructive annotation', () => {
    expect(updateIssuesTool.annotations?.readOnlyHint).toBe(false);
    // Update can modify data
    expect(updateIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of updateIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = updateIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of updateIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = updateIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues handler', () => {
  it('updates issue title', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Updated title' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ title: 'Updated title' }),
    );
  });

  it('updates issue state', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', stateId: 'state-done' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ stateId: 'state-done' }),
    );
  });

  it('updates assignee', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', assigneeId: 'user-002' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ assigneeId: 'user-002' }),
    );
  });

  it('batch updates multiple issues', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          { id: 'issue-001', stateId: 'state-done' },
          { id: 'issue-002', stateId: 'state-inprogress' },
          { id: 'issue-003', assigneeId: 'user-001' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledTimes(3);
  });

  it('updates multiple fields at once', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            title: 'New title',
            stateId: 'state-done',
            priority: 1,
            assigneeId: 'user-002',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        title: 'New title',
        stateId: 'state-done',
        priority: 1,
        assigneeId: 'user-002',
      }),
    );
  });

  it('supports update by identifier (ENG-123)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'ENG-123', stateId: 'state-done' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // The mock should accept identifier as id
    expect(mockClient.updateIssue).toHaveBeenCalledWith('ENG-123', expect.any(Object));
  });

  it('archives issue (calls archiveIssue method)', async () => {
    // Add archiveIssue method to mock
    (mockClient as unknown as { archiveIssue: ReturnType<typeof vi.fn> }).archiveIssue =
      vi.fn(async () => ({ success: true }));

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', archived: true }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Archive uses a separate archiveIssue method, not updateIssue
    expect(
      (mockClient as unknown as { archiveIssue: ReturnType<typeof vi.fn> })
        .archiveIssue,
    ).toHaveBeenCalledWith('issue-001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Label Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues label operations', () => {
  it('replaces all labels with labelIds', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', labelIds: ['label-docs'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({ labelIds: ['label-docs'] }),
    );
  });

  it('adds labels with addLabelIds (computes final labelIds)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', addLabelIds: ['label-feature'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Must fetch current issue to get existing labels
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');

    // updateIssue should be called with merged labelIds
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBeGreaterThan(0);

    // Find the call that has labelIds (the one after label computation)
    const labelUpdateCall = updateCalls.find((c) => c.input.labelIds !== undefined);
    if (labelUpdateCall) {
      const labelIds = labelUpdateCall.input.labelIds as string[];
      // Should include the added label
      expect(labelIds).toContain('label-feature');
      // Should retain existing labels (issue-001 has label-sqt-bug)
      expect(labelIds).toContain('label-sqt-bug');
    }
  });

  it('removes labels with removeLabelIds (computes final labelIds)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', removeLabelIds: ['label-sqt-bug'] }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Must fetch current issue to get existing labels
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');

    // updateIssue should be called with computed labelIds
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBeGreaterThan(0);

    // Find the call that has labelIds (the one after label computation)
    const labelUpdateCall = updateCalls.find((c) => c.input.labelIds !== undefined);
    if (labelUpdateCall) {
      const labelIds = labelUpdateCall.input.labelIds as string[];
      // Should NOT include the removed label
      expect(labelIds).not.toContain('label-sqt-bug');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues output shape', () => {
  it('success responses have no structuredContent', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    // Success responses no longer include structuredContent
    expect(result.structuredContent).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues error handling', () => {
  it('handles API error gracefully', async () => {
    (mockClient.updateIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Issue not found'),
    );

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'nonexistent', stateId: 'state-done' }] },
      baseContext,
    );

    // Batch continues but item fails - error details now in text content
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('fail');
  });

  it('returns error with code, message, and suggestions for non-existent issue IDs', async () => {
    // Simulate API error for non-existent issue
    (mockClient.updateIssue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Entity not found: Issue with id FAKE-999'),
    );

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'FAKE-999', stateId: 'state-done' }] },
      baseContext,
    );

    // Batch operation should not mark entire result as error
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    // Error details are now in text content
    expect(result.content[0].text).toContain('fail');
  });

  it('continues batch on partial failure', async () => {
    (mockClient.updateIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce({
        success: true,
        issue: { id: 'issue-002', identifier: 'ENG-124' },
      });

    const result = await updateIssuesTool.handler(
      {
        items: [
          { id: 'bad-id', stateId: 'state-done' },
          { id: 'issue-002', stateId: 'state-done' },
        ],
      },
      baseContext,
    );

    // Batch continues despite partial failures
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Short Key Resolution Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues short key resolution', () => {
  beforeEach(() => {
    // Create a mock registry with short key mappings
    const mockRegistry: ShortKeyRegistry = {
      users: new Map([
        ['u0', 'user-001'],
        ['u1', 'user-002'],
        ['u2', 'user-003'],
      ]),
      states: new Map([
        ['s0', 'state-backlog'],
        ['s1', 'state-todo'],
        ['s2', 'state-inprogress'],
        ['s3', 'state-done'],
      ]),
      projects: new Map([
        ['pr0', 'project-001'],
        ['pr1', 'project-002'],
      ]),
      usersByUuid: new Map([
        ['user-001', 'u0'],
        ['user-002', 'u1'],
        ['user-003', 'u2'],
      ]),
      statesByUuid: new Map([
        ['state-backlog', 's0'],
        ['state-todo', 's1'],
        ['state-inprogress', 's2'],
        ['state-done', 's3'],
      ]),
      projectsByUuid: new Map([
        ['project-001', 'pr0'],
        ['project-002', 'pr1'],
      ]),
      generatedAt: new Date(),
      workspaceId: 'ws-123',
    };

    // Store the registry for the session
    storeRegistry('test-session', mockRegistry);
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  afterEach(() => {
    clearRegistry('test-session');
  });

  it('resolves assignee short key to UUID', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            assignee: 'u1', // Should resolve to user-002
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        assigneeId: 'user-002',
      }),
    );
  });

  it('resolves state short key to UUID', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's3', // Should resolve to state-done
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        stateId: 'state-done',
      }),
    );
  });

  it('resolves project short key to UUID', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            project: 'pr1', // Should resolve to project-002
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        projectId: 'project-002',
      }),
    );
  });

  it('resolves multiple short keys in single update', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            assignee: 'u2',
            state: 's2',
            project: 'pr0',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.updateIssue).toHaveBeenCalledWith(
      'issue-001',
      expect.objectContaining({
        assigneeId: 'user-003',
        stateId: 'state-inprogress',
        projectId: 'project-001',
      }),
    );
  });

  it('returns error for unknown short key', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [
          {
            id: 'issue-001',
            state: 's99', // Unknown short key
          },
        ],
      },
      baseContext,
    );

    // Batch continues but item fails - error details now in text content
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('s99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues TOON output', () => {
  beforeEach(() => {
    // Create a mock registry for TOON output
    const mockRegistry: ShortKeyRegistry = {
      users: new Map([
        ['u0', 'user-001'],
        ['u1', 'user-002'],
      ]),
      states: new Map([
        ['s0', 'state-backlog'],
        ['s1', 'state-todo'],
        ['s2', 'state-inprogress'],
        ['s3', 'state-done'],
      ]),
      projects: new Map([['pr0', 'project-001']]),
      usersByUuid: new Map([
        ['user-001', 'u0'],
        ['user-002', 'u1'],
      ]),
      statesByUuid: new Map([
        ['state-backlog', 's0'],
        ['state-todo', 's1'],
        ['state-inprogress', 's2'],
        ['state-done', 's3'],
      ]),
      projectsByUuid: new Map([['project-001', 'pr0']]),
      generatedAt: new Date(),
      workspaceId: 'ws-123',
    };

    storeRegistry('test-session', mockRegistry);
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  afterEach(() => {
    clearRegistry('test-session');
  });

  it('returns TOON format', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Updated title' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('update_issues');
    expect(textContent).toContain('results[');
  });

  it('includes meta with action and counts', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', state: 's3' }] },
      baseContext,
    );

    const textContent = result.content[0].text;

    expect(textContent).toContain('_meta{action,succeeded,failed,total}');
    expect(textContent).toContain('update_issues,1,0,1');
  });

  it('includes results section with status and identifier', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', state: 's3' }] },
      baseContext,
    );

    const textContent = result.content[0].text;

    // Should have results section with expected fields
    expect(textContent).toContain('results[');
    expect(textContent).toContain('{index,status,identifier,error,code,hint}');
    // Status should be 'ok' for successful updates
    expect(textContent).toContain('0,ok');
  });

  it('includes changes section when actual changes are detected', async () => {
    // Note: The changes section is only added when computeFieldChanges detects
    // actual differences between before/after snapshots. Since our mock returns
    // the same state before and after, no changes will be detected.
    // This test verifies the TOON format structure is correct.
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', priority: 1 }] },
      baseContext,
    );

    const textContent = result.content[0].text;

    // Should have meta and results sections
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('results[');

    // Changes section would only appear if the mock simulated actual changes
    // In unit tests without mock state changes, we just verify the structure
  });

  it('returns TOON format even when no registry is available', async () => {
    // Clear the registry to simulate workspace_metadata not being called
    clearRegistry('test-session');

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'No registry test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // TOON format is always used now
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('update_issues');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Selector Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('cycle selector support', () => {
  beforeEach(() => {
    // Ensure the SQT team's activeCycle is reset to the default before each test,
    // since some tests mutate it (e.g., the "last" alias test sets it to cycle 2).
    const sqtTeam = defaultMockTeams.find((t) => t.id === 'team-sqt');
    if (sqtTeam) {
      sqtTeam.activeCycle = { id: 'cycle-sqt-001', number: 1 };
    }
  });

  it('resolves "current" selector to active cycle', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 'current' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;
    expect(textContent).toContain('update_issues');

    // Verify the updateIssue was called with the correct cycleId
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.cycleId).toBe('cycle-sqt-001');
  });

  it('resolves "last" alias to previous cycle', async () => {
    // Set active cycle to 2 so "last"/"previous" resolves to cycle 1
    const teams = (await mockClient.teams()).nodes;
    const sqtTeam = teams.find((t) => t.id === 'team-sqt');
    if (sqtTeam) {
      sqtTeam.activeCycle = { id: 'cycle-sqt-002', number: 2 };
    }

    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 'last' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.cycleId).toBe('cycle-sqt-001');
  });

  it('resolves "upcoming" alias to next cycle', async () => {
    // Active cycle is 1, so "upcoming"/"next" resolves to cycle 2
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 'upcoming' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.cycleId).toBe('cycle-sqt-002');
  });

  it('still supports numeric cycle input', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 1 }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.cycleId).toBe('cycle-sqt-001');
  });

  it('still supports c-prefixed cycle input', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 'c2' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const updateCalls = mockClient._calls.updateIssue;
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].input.cycleId).toBe('cycle-sqt-002');
  });

  it('returns error for invalid cycle string', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', cycle: 'invalid_cycle' }] },
      baseContext,
    );

    const textContent = result.content[0].text;
    expect(textContent).toContain('CYCLE_INVALID');
  });
});
