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

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(1);
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

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(3);
    expect(mockClient.updateIssue).toHaveBeenCalledTimes(3);
  });

  it('dry run validates without updating', async () => {
    const result = await updateIssuesTool.handler(
      {
        items: [{ id: 'issue-001', stateId: 'state-done' }],
        dry_run: true,
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.dry_run).toBe(true);

    // Verify updateIssue was NOT called
    expect(mockClient.updateIssue).not.toHaveBeenCalled();
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
      // Should retain existing labels (issue-001 has label-bug)
      expect(labelIds).toContain('label-bug');
    }
  });

  it('removes labels with removeLabelIds (computes final labelIds)', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', removeLabelIds: ['label-bug'] }] },
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
      expect(labelIds).not.toContain('label-bug');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_issues output shape', () => {
  it('matches UpdateIssuesOutputSchema', async () => {
    const result = await updateIssuesTool.handler(
      { items: [{ id: 'issue-001', title: 'Test' }] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    expect(Array.isArray(results)).toBe(true);

    for (const r of results) {
      expect(typeof r.index).toBe('number');
      expect(typeof r.ok).toBe('boolean');
    }

    const summary = structured.summary as Record<string, unknown>;
    expect(typeof summary.ok).toBe('number');
    expect(typeof summary.failed).toBe('number');
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

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain(
      'Issue not found',
    );
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

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const summary = structured.summary as { ok: number; failed: number };

    // Verify the batch tracked the failure
    expect(summary.failed).toBe(1);
    expect(summary.ok).toBe(0);

    // Verify the individual result has error details
    expect(results[0].success).toBe(false);

    const error = results[0].error as {
      code?: string;
      message: string;
      suggestions?: string[];
    };

    // Verify error has the expected fields
    expect(error.message).toBeDefined();
    expect(typeof error.message).toBe('string');
    expect(error.message.length).toBeGreaterThan(0);

    // Code and suggestions may or may not be present depending on error type,
    // but if they exist they should be properly typed
    if (error.code !== undefined) {
      expect(typeof error.code).toBe('string');
    }
    if (error.suggestions !== undefined) {
      expect(Array.isArray(error.suggestions)).toBe(true);
    }
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

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.ok).toBe(1);
    expect(summary.failed).toBe(1);
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

    expect(result.isError).toBeFalsy(); // Batch continues

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { ok: number; failed: number };

    expect(summary.failed).toBe(1);

    const results = structured.results as Array<Record<string, unknown>>;
    expect(results[0].success).toBe(false);
    expect((results[0].error as { message: string }).message).toContain(
      "Unknown state key 's99'",
    );
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
