/**
 * Tests for get_issue_history tool.
 * Verifies: input validation, history fetching, TOON output format, bulk, pagination,
 * bot actors, creation rows, error handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getIssueHistoryTool } from '../../src/shared/tools/linear/get-issue-history.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
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

vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock History Data
// ─────────────────────────────────────────────────────────────────────────────

// Mock entries in chronological order (oldest first).
// The makeIssueHistoryResponse helper reverses them to match the real API (newest first).
const mockHistoryEntries = [
  // Entry 0: creation (no from/to fields)
  {
    id: 'hist-001',
    createdAt: '2026-02-20T09:00:00Z',
    actorId: 'user-001',
    actor: { id: 'user-001', name: 'Test User' },
    fromState: null,
    toState: null,
    fromAssignee: null,
    toAssignee: null,
    fromEstimate: null,
    toEstimate: null,
    fromPriority: null,
    toPriority: null,
    fromDueDate: null,
    toDueDate: null,
    fromTitle: null,
    toTitle: null,
    fromProject: null,
    toProject: null,
    fromCycle: null,
    toCycle: null,
    fromParent: null,
    toParent: null,
    fromTeam: null,
    toTeam: null,
    addedLabels: null,
    removedLabels: null,
    archived: null,
    trashed: null,
    updatedDescription: null,
    autoArchived: null,
    autoClosed: null,
    relationChanges: null,
    botActor: null,
  },
  // Entry 1: state transition Todo -> Done
  {
    id: 'hist-002',
    createdAt: '2026-02-21T10:00:00Z',
    actorId: 'user-002',
    actor: { id: 'user-002', name: 'Jane Doe' },
    fromState: { id: 'state-sqt-todo', name: 'Todo', type: 'unstarted' },
    toState: { id: 'state-sqt-done', name: 'Done', type: 'completed' },
    fromAssignee: null,
    toAssignee: null,
    fromEstimate: null,
    toEstimate: null,
    fromPriority: null,
    toPriority: null,
    fromDueDate: null,
    toDueDate: null,
    fromTitle: null,
    toTitle: null,
    fromProject: null,
    toProject: null,
    fromCycle: null,
    toCycle: null,
    fromParent: null,
    toParent: null,
    fromTeam: null,
    toTeam: null,
    addedLabels: null,
    removedLabels: null,
    archived: null,
    trashed: null,
    updatedDescription: null,
    autoArchived: null,
    autoClosed: null,
    relationChanges: null,
    botActor: null,
  },
  // Entry 2: assignee change + estimate (multi-field)
  {
    id: 'hist-003',
    createdAt: '2026-02-21T10:05:00Z',
    actorId: 'user-002',
    actor: { id: 'user-002', name: 'Jane Doe' },
    fromState: null,
    toState: null,
    fromAssignee: null,
    toAssignee: { id: 'user-001', name: 'Test User' },
    fromEstimate: null,
    toEstimate: 3,
    fromPriority: null,
    toPriority: null,
    fromDueDate: null,
    toDueDate: null,
    fromTitle: null,
    toTitle: null,
    fromProject: null,
    toProject: null,
    fromCycle: null,
    toCycle: null,
    fromParent: null,
    toParent: null,
    fromTeam: null,
    toTeam: null,
    addedLabels: null,
    removedLabels: null,
    archived: null,
    trashed: null,
    updatedDescription: null,
    autoArchived: null,
    autoClosed: null,
    relationChanges: null,
    botActor: null,
  },
  // Entry 3: label change
  {
    id: 'hist-004',
    createdAt: '2026-02-22T14:00:00Z',
    actorId: 'user-001',
    actor: { id: 'user-001', name: 'Test User' },
    fromState: null,
    toState: null,
    fromAssignee: null,
    toAssignee: null,
    fromEstimate: null,
    toEstimate: null,
    fromPriority: null,
    toPriority: null,
    fromDueDate: null,
    toDueDate: null,
    fromTitle: null,
    toTitle: null,
    fromProject: null,
    toProject: null,
    fromCycle: null,
    toCycle: null,
    fromParent: null,
    toParent: null,
    fromTeam: null,
    toTeam: null,
    addedLabels: [{ id: 'label-sqt-bug', name: 'Bug' }],
    removedLabels: null,
    archived: null,
    trashed: null,
    updatedDescription: null,
    autoArchived: null,
    autoClosed: null,
    relationChanges: null,
    botActor: null,
  },
];

// Pre-extract entries for safe access (avoid non-null assertions)
const creationEntry = mockHistoryEntries[0];
const stateEntry = mockHistoryEntries[1];

/** Helper to extract text content from tool result */
function getText(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

function makeIssueHistoryResponse(
  identifier: string,
  entries: typeof mockHistoryEntries,
  hasNextPage = false,
  endCursor?: string,
) {
  // Real Linear API returns newest-first; reverse chronological entries to match
  const newestFirst = [...entries].reverse();
  return {
    data: {
      issue: {
        identifier,
        history: {
          nodes: newestFirst,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  };
}

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);

  // Override rawRequest for history queries
  mockClient.client.rawRequest = vi.fn(
    async (query: string, variables?: Record<string, unknown>) => {
      if (query.includes('IssueHistory')) {
        const id = variables?.id as string;

        if (id === 'SQT-123' || id === 'issue-001') {
          return makeIssueHistoryResponse('SQT-123', mockHistoryEntries);
        }
        if (id === 'SQT-124' || id === 'issue-002') {
          return makeIssueHistoryResponse('SQT-124', [
            creationEntry as (typeof mockHistoryEntries)[0],
          ]);
        }
        if (id === 'SQT-125' || id === 'issue-003') {
          return makeIssueHistoryResponse('SQT-125', []);
        }
        if (id === 'NOT-FOUND') {
          return { data: { issue: null } };
        }

        // Default: not found
        return { data: { issue: null } };
      }

      // Fallback for registry initialization queries
      if (query.includes('users(first: 100)')) {
        return { data: { users: { nodes: [] } } };
      }

      return { data: {} };
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issue_history tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(getIssueHistoryTool.name).toBe('get_issue_history');
      expect(getIssueHistoryTool.title).toBe('Get Issue History');
    });

    it('has readOnlyHint annotation', () => {
      expect(getIssueHistoryTool.annotations?.readOnlyHint).toBe(true);
      expect(getIssueHistoryTool.annotations?.destructiveHint).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Input Validation
  // ─────────────────────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('requires issueIds array', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty issueIds array', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({ issueIds: [] });
      expect(result.success).toBe(false);
    });

    it('accepts single issueId', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({
        issueIds: ['SQT-123'],
      });
      expect(result.success).toBe(true);
    });

    it('accepts multiple issueIds', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({
        issueIds: ['SQT-123', 'SQT-124', 'SQT-125'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects more than 25 issueIds', () => {
      const ids = Array.from({ length: 26 }, (_, i) => `SQT-${i}`);
      const result = getIssueHistoryTool.inputSchema.safeParse({ issueIds: ids });
      expect(result.success).toBe(false);
    });

    it('accepts optional limit', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({
        issueIds: ['SQT-123'],
        limit: 10,
      });
      expect(result.success).toBe(true);
    });

    it('rejects limit over 100', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({
        issueIds: ['SQT-123'],
        limit: 101,
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional cursor', () => {
      const result = getIssueHistoryTool.inputSchema.safeParse({
        issueIds: ['SQT-123'],
        cursor: 'abc123',
      });
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Single Issue History
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - single issue', () => {
    it('returns history for a single issue', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain('history[');
      expect(text).toContain('SQT-123');
    });

    it('shows state transition with from/to', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      // Should contain state field
      expect(text).toContain('state');
      // Should contain the timestamps
      expect(text).toContain('2026-02-21T10:00:00Z');
    });

    it('shows assignee change', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('assignee');
    });

    it('shows estimate change', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('estimate');
      expect(text).toContain('e3');
    });

    it('shows label changes', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('labels');
      expect(text).toContain('Bug');
    });

    it('shows creation row for first entry', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('created');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Multi-field Entry
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - multi-field entry', () => {
    it('expands multi-field entry into separate rows', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      // Entry 2 has assignee + estimate changes
      // Both should appear at the same timestamp
      const lines = text.split('\n');
      const assigneeLine = lines.find(
        (l) => l.includes('assignee') && l.includes('2026-02-21T10:05:00Z'),
      );
      const estimateLine = lines.find(
        (l) => l.includes('estimate') && l.includes('2026-02-21T10:05:00Z'),
      );
      expect(assigneeLine).toBeDefined();
      expect(estimateLine).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Bulk Fetch
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - bulk fetch', () => {
    it('returns history for multiple issues', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123', 'SQT-124'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain('SQT-123');
      expect(text).toContain('SQT-124');
    });

    it('handles partial failure in bulk', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123', 'NOT-FOUND'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      // Found issue should have history
      expect(text).toContain('SQT-123');
      // Not-found issue should have error row
      expect(text).toContain('NOT-FOUND');
      expect(text).toContain('error');
    });

    it('uses lower default limit for bulk requests', async () => {
      await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123', 'SQT-124'] },
        baseContext,
      );

      // Verify rawRequest was called with first: 20 (bulk default)
      const rawCalls = (mockClient.client.rawRequest as ReturnType<typeof vi.fn>).mock
        .calls;
      const historyCalls = rawCalls.filter((c: unknown[]) =>
        (c[0] as string).includes('IssueHistory'),
      );
      for (const call of historyCalls) {
        expect((call[1] as Record<string, unknown>).first).toBe(20);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Pagination
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - pagination', () => {
    it('includes pagination info when hasNextPage is true', async () => {
      // Override for paginated response
      mockClient.client.rawRequest = vi.fn(
        async (query: string, _variables?: Record<string, unknown>) => {
          if (query.includes('IssueHistory')) {
            return makeIssueHistoryResponse(
              'SQT-123',
              [stateEntry as (typeof mockHistoryEntries)[0]],
              true,
              'cursor-page-2',
            );
          }
          return { data: {} };
        },
      );

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('_pagination');
      expect(text).toContain('cursor-page-2');
    });

    it('passes cursor to rawRequest', async () => {
      await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'], cursor: 'my-cursor' },
        baseContext,
      );

      const rawCalls = (mockClient.client.rawRequest as ReturnType<typeof vi.fn>).mock
        .calls;
      const historyCall = rawCalls.find((c: unknown[]) =>
        (c[0] as string).includes('IssueHistory'),
      );
      expect(historyCall).toBeDefined();
      expect((historyCall?.[1] as Record<string, unknown>).after).toBe('my-cursor');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Error Handling
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - errors', () => {
    it('handles issue not found gracefully', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['NOT-FOUND'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain('NOT-FOUND');
      expect(text).toContain('not found');
    });

    it('handles API error gracefully', async () => {
      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          throw new Error('API rate limit exceeded');
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      expect(text).toContain('error');
      expect(text).toContain('API rate limit exceeded');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Bot Actor
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - bot actor', () => {
    it('shows bot name as actor when botActor is present', async () => {
      const botEntry = {
        ...(stateEntry as (typeof mockHistoryEntries)[0]),
        id: 'hist-bot-001',
        actorId: null,
        actor: null,
        botActor: { name: 'Zapier', type: 'integration' },
      };

      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          return makeIssueHistoryResponse('SQT-123', [botEntry]);
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('Zapier');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Empty History
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - empty history', () => {
    it('handles issue with no history entries', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-125'] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      const text = getText(result);
      // Empty sections are excluded by default, so no history section
      expect(text).toContain('SQT-125');
      expect(text).not.toContain('history[');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TOON Output Format
  // ─────────────────────────────────────────────────────────────────────────

  describe('TOON output format', () => {
    it('includes _meta section', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('_meta{');
      expect(text).toContain('get_issue_history');
    });

    it('includes history section header with correct schema', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('history[');
      expect(text).toContain('{issue,time,actor,field,from,to}');
    });

    it('orders entries oldest first', async () => {
      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      const lines = text.split('\n');

      // Find indices of timestamps in the output
      const createIdx = lines.findIndex((l) => l.includes('2026-02-20T09:00:00Z'));
      const stateIdx = lines.findIndex((l) => l.includes('2026-02-21T10:00:00Z'));
      const labelIdx = lines.findIndex((l) => l.includes('2026-02-22T14:00:00Z'));

      // Oldest (creation) should come before state change, which should come before labels
      expect(createIdx).toBeLessThan(stateIdx);
      expect(stateIdx).toBeLessThan(labelIdx);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Priority Change
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - priority change', () => {
    it('shows priority change with pN format', async () => {
      const priorityEntry = {
        ...(creationEntry as (typeof mockHistoryEntries)[0]),
        id: 'hist-pri-001',
        createdAt: '2026-02-21T12:00:00Z',
        fromPriority: 3,
        toPriority: 1,
      };

      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          return makeIssueHistoryResponse('SQT-123', [priorityEntry]);
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('priority');
      expect(text).toContain('p3');
      expect(text).toContain('p1');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Description Updated
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - description updated', () => {
    it('shows description change as (edited)', async () => {
      const descEntry = {
        ...(creationEntry as (typeof mockHistoryEntries)[0]),
        id: 'hist-desc-001',
        createdAt: '2026-02-21T15:00:00Z',
        updatedDescription: true,
      };

      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          return makeIssueHistoryResponse('SQT-123', [descEntry]);
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('description');
      expect(text).toContain('(edited)');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Handler - Relation Changes
  // ─────────────────────────────────────────────────────────────────────────

  describe('handler - relation changes', () => {
    it('maps raw relation type codes to human-readable names', async () => {
      const relEntry = {
        ...(creationEntry as (typeof mockHistoryEntries)[0]),
        id: 'hist-rel-001',
        createdAt: '2026-02-21T16:00:00Z',
        relationChanges: [
          { identifier: 'SQT-456', type: 'ab' },
          { identifier: 'SQT-789', type: 'ax' },
          { identifier: 'SQT-100', type: 'ar' },
        ],
      };

      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          return makeIssueHistoryResponse('SQT-123', [relEntry]);
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      expect(text).toContain('added blocked_by SQT-456');
      expect(text).toContain('added blocks SQT-789');
      expect(text).toContain('added related SQT-100');
    });

    it('passes through unknown relation type codes', async () => {
      const relEntry = {
        ...(creationEntry as (typeof mockHistoryEntries)[0]),
        id: 'hist-rel-002',
        createdAt: '2026-02-21T16:00:00Z',
        relationChanges: [{ identifier: 'SQT-456', type: 'zz' }],
      };

      mockClient.client.rawRequest = vi.fn(async (query: string) => {
        if (query.includes('IssueHistory')) {
          return makeIssueHistoryResponse('SQT-123', [relEntry]);
        }
        return { data: {} };
      });

      const result = await getIssueHistoryTool.handler(
        { issueIds: ['SQT-123'] },
        baseContext,
      );

      const text = getText(result);
      // Unknown codes pass through as-is
      expect(text).toContain('zz SQT-456');
    });
  });
});
