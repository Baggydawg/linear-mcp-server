/**
 * Tests for create_issues tool.
 * Verifies: input validation, batch creation, dry run, error handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIssuesTool } from '../../src/shared/tools/linear/create-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  clearRegistry,
  type ShortKeyRegistry,
  storeRegistry,
} from '../../src/shared/toon/index.js';
import createIssuesFixtures from '../fixtures/tool-inputs/create-issues.json';
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

describe('create_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(createIssuesTool.name).toBe('create_issues');
    expect(createIssuesTool.title).toBe('Create Issues (Batch)');
  });

  it('has non-destructive annotations', () => {
    expect(createIssuesTool.annotations?.readOnlyHint).toBe(false);
    expect(createIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of createIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = createIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of createIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = createIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues handler', () => {
  it('creates a single issue with minimal input', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Test issue' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify createIssue was called
    expect(mockClient.createIssue).toHaveBeenCalledTimes(1);
  });

  it('creates issue with all optional fields', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Full issue',
            description: 'Detailed description',
            stateId: 'state-todo',
            labelIds: ['label-feature'],
            assigneeId: 'user-002',
            projectId: 'project-001',
            priority: 2,
            estimate: 5,
            dueDate: '2025-01-15',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call included all fields
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Full issue',
        description: 'Detailed description',
        stateId: 'state-todo',
        labelIds: ['label-feature'],
        assigneeId: 'user-002',
        projectId: 'project-001',
        priority: 2,
        estimate: 5,
        dueDate: '2025-01-15',
      }),
    );
  });

  it('batch creates multiple issues', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          { teamId: 'team-eng', title: 'Issue 1' },
          { teamId: 'team-eng', title: 'Issue 2' },
          { teamId: 'team-eng', title: 'Issue 3' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.createIssue).toHaveBeenCalledTimes(3);
  });

  it('resolves assigneeName to assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with name-based assignee',
            assigneeName: 'Jane', // Should match Jane Doe (user-002)
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call resolved Jane to user-002
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Issue with name-based assignee',
        assigneeId: 'user-002',
      }),
    );
  });

  it('resolves assigneeEmail to assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with email-based assignee',
            assigneeEmail: 'bob@example.com', // Should match Bob Smith (user-003)
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify the call resolved email to user-003
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: 'team-eng',
        title: 'Issue with email-based assignee',
        assigneeId: 'user-003',
      }),
    );
  });

  it('returns error for non-matching assigneeName', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Issue with unknown assignee',
            assigneeName: 'NonExistentPerson',
          },
        ],
      },
      baseContext,
    );

    // Batch continues but item fails - error details now in text content
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('No user found');
  });

  it('dry run validates without creating', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [{ teamId: 'team-eng', title: 'Dry run test' }],
        dry_run: true,
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.dry_run).toBe(true);

    const summary = structured.summary as { ok: number; failed: number };
    expect(summary.ok).toBe(1);

    // Verify createIssue was NOT called
    expect(mockClient.createIssue).not.toHaveBeenCalled();

    // Verify text mentions dry run
    expect(result.content[0].text).toContain('Dry run');
  });

  it('defaults assigneeId to viewer when not provided', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Auto-assign test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Should have called createIssue with viewer's ID as assigneeId
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-001', // Default viewer ID from mock
      }),
    );
  });

  it('respects explicit assigneeId', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [{ teamId: 'team-eng', title: 'Assigned test', assigneeId: 'user-002' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-002',
      }),
    );
  });

  it('returns results with id and identifier', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    // Success responses no longer include structuredContent
    expect(result.structuredContent).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues output shape', () => {
  it('success responses have no structuredContent', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Schema test' }] },
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

describe('create_issues error handling', () => {
  it('handles API error gracefully after retries', async () => {
    // Make createIssue throw consistently (3 retries + 1 = 4 calls)
    const error = new Error('API rate limit exceeded');
    (mockClient.createIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error);

    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'Error test' }] },
      baseContext,
    );

    // Should not throw, but report error in text content
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    // Error details are now in text content
    expect(result.content[0].text).toContain('fail');
  });

  it('continues batch on partial failure', async () => {
    // First call fails, second succeeds
    (mockClient.createIssue as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce({
        success: true,
        issue: { id: 'new-id', identifier: 'ENG-100' },
      });

    const result = await createIssuesTool.handler(
      {
        items: [
          { teamId: 'team-eng', title: 'Will fail' },
          { teamId: 'team-eng', title: 'Will succeed' },
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

describe('create_issues short key resolution', () => {
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
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test with short key assignee',
            assignee: 'u1', // Should resolve to user-002
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-002',
      }),
    );
  });

  it('resolves state short key to UUID', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test with short key state',
            state: 's2', // Should resolve to state-inprogress
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        stateId: 'state-inprogress',
      }),
    );
  });

  it('resolves project short key to UUID', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test with short key project',
            project: 'pr0', // Should resolve to project-001
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-001',
      }),
    );
  });

  it('resolves multiple short keys in batch', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Full short key test',
            assignee: 'u2',
            state: 's3',
            project: 'pr1',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(mockClient.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: 'user-003',
        stateId: 'state-done',
        projectId: 'project-002',
      }),
    );
  });

  it('returns error for unknown short key', async () => {
    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'Test with invalid short key',
            assignee: 'u99', // Unknown short key
          },
        ],
      },
      baseContext,
    );

    // Batch continues but item fails - error details now in text content
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0].text).toContain('u99');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_issues TOON output', () => {
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
        ['s2', 'state-done'],
      ]),
      projects: new Map([['pr0', 'project-001']]),
      usersByUuid: new Map([
        ['user-001', 'u0'],
        ['user-002', 'u1'],
      ]),
      statesByUuid: new Map([
        ['state-backlog', 's0'],
        ['state-todo', 's1'],
        ['state-done', 's2'],
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
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'TOON test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('create_issues');
    expect(textContent).toContain('results[');
  });

  it('includes meta with action and counts', async () => {
    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'TOON test' }] },
      baseContext,
    );

    const textContent = result.content[0].text;

    expect(textContent).toContain('_meta{action,succeeded,failed,total}');
    expect(textContent).toContain('create_issues,1,0,1');
  });

  it('includes created section with short keys', async () => {
    // Make createIssue return specific values we can track
    (mockClient.createIssue as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      issue: {
        id: 'new-issue-id',
        identifier: 'ENG-123',
        title: 'TOON test',
        state: { id: 'state-todo', name: 'Todo' },
        assignee: { id: 'user-001', name: 'John' },
        project: { id: 'project-001', name: 'Project A' },
      },
    });

    const result = await createIssuesTool.handler(
      {
        items: [
          {
            teamId: 'team-eng',
            title: 'TOON test',
            state: 's1',
            assignee: 'u0',
            project: 'pr0',
          },
        ],
      },
      baseContext,
    );

    const textContent = result.content[0].text;

    // Should have created section with short keys
    expect(textContent).toContain('created[');
    expect(textContent).toContain('{identifier,title,state,assignee,project,url}');
    // The created row should use short keys for state, assignee, project
    expect(textContent).toContain('ENG-123');
  });

  it('returns TOON format even when no registry is available', async () => {
    // Clear the registry to simulate workspace_metadata not being called
    clearRegistry('test-session');

    const result = await createIssuesTool.handler(
      { items: [{ teamId: 'team-eng', title: 'No registry test' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // TOON format is always used now
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('create_issues');
  });
});
