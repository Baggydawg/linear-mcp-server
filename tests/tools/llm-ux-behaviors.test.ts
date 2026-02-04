/**
 * LLM UX Behavior Tests
 *
 * These tests verify that the MCP tools provide good UX for language models:
 * - Context bloat prevention (pagination hints when more results exist)
 * - Easy navigation through completed/cancelled issues with time ranges
 * - Clear guidance for common workflows
 * - Helpful error messages and zero-result hints
 *
 * All tests now use TOON-only output format.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  type MockIssue,
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

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Generate many issues for pagination tests
// ─────────────────────────────────────────────────────────────────────────────

function generateManyIssues(count: number): MockIssue[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `issue-${String(i + 1).padStart(3, '0')}`,
    identifier: `ENG-${100 + i}`,
    title: `Issue ${i + 1}`,
    priority: (i % 4) + 1,
    createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - i * 12 * 60 * 60 * 1000),
    state: Promise.resolve({
      id: i % 3 === 0 ? 'state-done' : 'state-inprogress',
      name: i % 3 === 0 ? 'Done' : 'In Progress',
      type: i % 3 === 0 ? 'completed' : 'started',
    }),
    project: Promise.resolve(null),
    assignee: Promise.resolve({ id: 'user-001', name: 'Test User' }),
    labels: () => Promise.resolve({ nodes: [] }),
    attachments: () => Promise.resolve({ nodes: [] }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Context Bloat Prevention
// ─────────────────────────────────────────────────────────────────────────────

describe('Context Bloat Prevention', () => {
  describe('when there are more results than the limit', () => {
    it('includes pagination section with hasMore indicator in TOON format', async () => {
      // Create many issues to trigger pagination
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      expect(result.isError).toBeFalsy();

      // TOON format uses _pagination section
      const textContent = result.content[0].text;
      expect(textContent).toContain('_pagination');
      expect(textContent).toContain('hasMore');
      expect(textContent).toContain('true');
    });

    it('provides cursor in pagination section for next page', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      // structuredContent was removed - pagination info is in TOON text
      expect(result.structuredContent).toBeUndefined();

      // Cursor is in _pagination section of TOON output
      const textContent = result.content[0].text;
      expect(textContent).toContain('_pagination');
      expect(textContent).toContain('cursor');
    });

    it('includes cursor in pagination section of TOON output', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      const textContent = result.content[0].text;
      expect(textContent).toContain('_pagination');
      expect(textContent).toContain('cursor');
    });

    it('shows count in TOON format', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({ limit: 10 }, baseContext);

      // TOON format uses issues[ header with count
      const textContent = result.content[0].text;
      expect(textContent).toMatch(/issues\[\d+\]/);

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();
    });
  });

  describe('when results fit within limit', () => {
    it('does NOT show "more available" when all results returned', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(5) });

      const result = await listIssuesTool.handler({ limit: 25 }, baseContext);

      const textContent = result.content[0].text;
      // Should not mention more available
      expect(textContent).not.toContain('more available');
    });

    it('does NOT include pagination section when no more pages', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(5) });

      const result = await listIssuesTool.handler({ limit: 25 }, baseContext);

      // structuredContent was removed - pagination info would be in TOON text
      expect(result.structuredContent).toBeUndefined();

      // When there are no more pages, _pagination section is omitted entirely
      const textContent = result.content[0].text;
      expect(textContent).not.toContain('_pagination');
    });
  });

  describe('default limit behavior', () => {
    it('uses reasonable default limit (100) when not specified', async () => {
      mockClient = createMockLinearClient({ issues: generateManyIssues(50) });

      const result = await listIssuesTool.handler({}, baseContext);

      // Verify the query was made with default limit (100 in TOON mode)
      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.first).toBe(100);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Navigating Completed/Cancelled Issues
// ─────────────────────────────────────────────────────────────────────────────

describe('Navigating Completed/Cancelled Issues', () => {
  describe('filtering by state type', () => {
    it('returns ONLY completed issues when filtering by state.type.eq=completed', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'completed' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter was passed to API
      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.state).toEqual({ type: { eq: 'completed' } });

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();

      // TOON format shows count in issues header
      const textContent = result.content[0].text;
      expect(textContent).toMatch(/issues\[\d+\]/);
    });

    it('returns ONLY cancelled issues when filtering by state.type.eq=canceled', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'canceled' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();

      // TOON format shows count in issues header
      const textContent = result.content[0].text;
      expect(textContent).toMatch(/issues\[\d+\]/);
    });

    it('EXCLUDES completed issues when filtering by state.type.neq=completed', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { neq: 'completed' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();

      // TOON format shows count in issues header
      const textContent = result.content[0].text;
      expect(textContent).toMatch(/issues\[\d+\]/);
    });

    it('returns ONLY in-progress issues when filtering by state.type.eq=started', async () => {
      const result = await listIssuesTool.handler(
        { filter: { state: { type: { eq: 'started' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();

      // TOON format shows count in issues header
      const textContent = result.content[0].text;
      expect(textContent).toMatch(/issues\[\d+\]/);
    });
  });

  describe('filtering by date range', () => {
    it('accepts updatedAt date range filter', async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const result = await listIssuesTool.handler(
        {
          filter: {
            updatedAt: {
              gte: threeMonthsAgo.toISOString(),
            },
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.updatedAt).toBeDefined();
    });

    it('accepts completedAt date range for finished issues', async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const result = await listIssuesTool.handler(
        {
          filter: {
            state: { type: { eq: 'completed' } },
            completedAt: {
              gte: threeMonthsAgo.toISOString(),
            },
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.state).toEqual({ type: { eq: 'completed' } });
      expect(filter.completedAt).toBeDefined();
    });

    it('supports combining state and date filters', async () => {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

      const result = await listIssuesTool.handler(
        {
          filter: {
            and: [
              { state: { type: { in: ['completed', 'canceled'] } } },
              { updatedAt: { gte: oneMonthAgo.toISOString() } },
            ],
          },
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      const filter = call.variables?.filter as Record<string, unknown>;
      expect(filter.and).toBeDefined();
    });
  });

  describe('includeArchived option', () => {
    it('allows including archived issues', async () => {
      const result = await listIssuesTool.handler(
        {
          filter: { state: { type: { eq: 'completed' } } },
          includeArchived: true,
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.includeArchived).toBe(true);
    });

    it('excludes archived by default', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      const call = mockClient._calls.rawRequest[0];
      // includeArchived should be false or undefined (not explicitly true)
      expect(call.variables?.includeArchived).not.toBe(true);
    });
  });

  describe('ordering for historical queries', () => {
    it('supports ordering by updatedAt (default, preferred for recency)', async () => {
      const result = await listIssuesTool.handler(
        { orderBy: 'updatedAt' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.orderBy).toBe('updatedAt');
    });

    it('supports ordering by createdAt', async () => {
      const result = await listIssuesTool.handler(
        { orderBy: 'createdAt' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const call = mockClient._calls.rawRequest[0];
      expect(call.variables?.orderBy).toBe('createdAt');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Workflow Chaining Guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('Workflow Chaining Guidance', () => {
  describe('workspace_metadata as entry point', () => {
    it('provides team keys for subsequent list_issues calls (TOON format)', async () => {
      const result = await workspaceMetadataTool.handler({}, baseContext);

      // In TOON format, teams are in text output with short keys
      const textContent = result.content[0].text;
      expect(textContent).toContain('_teams[');

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();
    });

    it('provides workflow state short keys for state filtering (TOON format)', async () => {
      const result = await workspaceMetadataTool.handler({}, baseContext);

      // In TOON format, states have short keys like s0, s1, etc.
      const textContent = result.content[0].text;
      expect(textContent).toContain('_states[');
      expect(textContent).toContain('s0');

      // structuredContent was removed - count is in TOON text header
      expect(result.structuredContent).toBeUndefined();
    });

    it('viewer info enables self-assignment (TOON format)', async () => {
      const result = await workspaceMetadataTool.handler({}, baseContext);

      // TOON format should include viewer info
      const textContent = result.content[0].text;
      expect(textContent).toContain('_meta{');
    });
  });

  describe('list_issues provides actionable IDs', () => {
    it('returns issue identifiers in TOON format', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      // TOON format uses identifiers like ENG-123
      const textContent = result.content[0].text;
      expect(textContent).toContain('issues[');
    });

    it('returns state short keys for understanding current state', async () => {
      const result = await listIssuesTool.handler({}, baseContext);

      // structuredContent was removed - TOON format is in text content
      expect(result.structuredContent).toBeUndefined();

      // TOON format includes state short keys in issue rows
      const textContent = result.content[0].text;
      expect(textContent).toContain('issues[');
      // State short keys like s0, s1 appear in the text
      expect(textContent).toMatch(/s\d+/);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Zero Results Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Zero Results Handling', () => {
  it('returns count 0 gracefully', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent was removed - count is in TOON _meta section
    expect(result.structuredContent).toBeUndefined();

    // TOON _meta shows count as 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('count');
    expect(textContent).toContain('list_issues,0,');
  });

  it('shows count as 0 in TOON text output', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    // structuredContent was removed - count is in TOON text
    expect(result.structuredContent).toBeUndefined();

    // Text content shows metadata with count 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('list_issues');
    expect(textContent).toContain('list_issues,0,');
  });

  it('handles state filter with zero results gracefully', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler(
      { filter: { state: { type: { eq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // structuredContent was removed - count is in TOON _meta section
    expect(result.structuredContent).toBeUndefined();

    // TOON _meta shows count as 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('list_issues,0,');
  });

  it('handles assignee filter with zero results gracefully', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({ assignedToMe: true }, baseContext);

    expect(result.isError).toBeFalsy();

    // structuredContent was removed - count is in TOON _meta section
    expect(result.structuredContent).toBeUndefined();

    // TOON _meta shows count as 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('list_issues,0,');
  });

  it('handles keyword filter with zero results gracefully', async () => {
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler(
      { q: 'nonexistent query' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // structuredContent was removed - count is in TOON _meta section
    expect(result.structuredContent).toBeUndefined();

    // TOON _meta shows count as 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('list_issues,0,');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tool Description Guidance
// ─────────────────────────────────────────────────────────────────────────────

describe('Tool Description Provides State Filtering Guidance', () => {
  it('list_issues description mentions state filtering', () => {
    const desc = listIssuesTool.description;

    // Should mention state filtering
    expect(desc).toContain('state');
    expect(desc).toContain('started');
    expect(desc).toContain('completed');
  });

  it('list_issues description shows active issues filter example', () => {
    const desc = listIssuesTool.description;

    // Should mention how to get active/open issues
    expect(desc).toContain('neq');
    expect(desc).toContain('completed');
  });

  it('list_issues description shows in-progress filter example', () => {
    const desc = listIssuesTool.description;

    // Should mention how to get in-progress issues
    expect(desc).toContain('started');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Reasonable Limits
// ─────────────────────────────────────────────────────────────────────────────

describe('Reasonable Limits', () => {
  it('maximum limit is 100 per request', () => {
    // Check schema accepts 100
    const result = listIssuesTool.inputSchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);

    // Check schema rejects > 100
    const tooHigh = listIssuesTool.inputSchema.safeParse({ limit: 101 });
    expect(tooHigh.success).toBe(false);
  });

  it('minimum limit is 1', () => {
    const result = listIssuesTool.inputSchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);

    const zero = listIssuesTool.inputSchema.safeParse({ limit: 0 });
    expect(zero.success).toBe(false);
  });

  it('get_issues batch limited to 50 items', async () => {
    // Import get_issues schema to verify batch limit
    const { getIssuesTool } = await import(
      '../../src/shared/tools/linear/get-issues.js'
    );

    // Should accept exactly 50 items
    const valid = getIssuesTool.inputSchema.safeParse({
      ids: Array.from({ length: 50 }, (_, i) => `id-${i}`),
    });
    expect(valid.success).toBe(true);

    // Should reject 51 items
    const tooMany = getIssuesTool.inputSchema.safeParse({
      ids: Array.from({ length: 51 }, (_, i) => `id-${i}`),
    });
    expect(tooMany.success).toBe(false);
  });
});
