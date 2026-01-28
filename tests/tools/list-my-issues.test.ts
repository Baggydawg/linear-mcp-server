/**
 * Tests for list_my_issues tool.
 * Verifies: filtering current user's issues, state filters, output shape, TOON format.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listMyIssuesTool } from '../../src/shared/tools/linear/list-my-issues.js';
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

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(listMyIssuesTool.name).toBe('list_my_issues');
    expect(listMyIssuesTool.title).toBe('List My Issues');
  });

  it('has readOnlyHint annotation', () => {
    expect(listMyIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(listMyIssuesTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description mentioning current user filter', () => {
    expect(listMyIssuesTool.description).toContain('assigned to you');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues handler', () => {
  it('returns issues assigned to current viewer', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);
  });

  it('uses viewer.assignedIssues query (implicit assignee filter)', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();

    // Verify the query uses assignedIssues (not issues with assignee filter)
    const call = mockClient._calls.rawRequest[0];
    expect(call.query).toContain('assignedIssues');
  });

  it('passes custom filters to assignedIssues query', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // assignedIssues already filters by viewer, so only state filter is added
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('supports filtering active issues only', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { neq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { neq: 'completed' } });
  });

  it('supports keyword search', async () => {
    const result = await listMyIssuesTool.handler({ q: 'authentication' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    // Default matchMode is 'all', which uses 'and' filter
    expect(filter.and).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const result = await listMyIssuesTool.handler({ limit: 5 }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.first).toBe(5);
  });

  it('supports pagination with cursor', async () => {
    const result = await listMyIssuesTool.handler(
      { cursor: 'test-cursor' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.after).toBe('test-cursor');
  });

  it('supports ordering by updatedAt', async () => {
    const result = await listMyIssuesTool.handler(
      { orderBy: 'updatedAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.orderBy).toBe('updatedAt');
  });

  it('supports ordering by priority', async () => {
    const result = await listMyIssuesTool.handler({ orderBy: 'priority' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.orderBy).toBe('priority');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues output shape', () => {
  it('matches ListIssuesOutputSchema', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.items).toBeDefined();
    expect(structured.limit).toBeDefined();

    const items = structured.items as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.title).toBeDefined();
      expect(item.stateId).toBeDefined();
    }
  });

  it('includes pagination info', async () => {
    const result = await listMyIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues common workflows', () => {
  it('shows my active tasks (most common query)', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { neq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Uses assignedIssues query
    const call = mockClient._calls.rawRequest[0];
    expect(call.query).toContain('assignedIssues');
  });

  it('shows my in-progress tasks', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was passed to query
    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('shows my completed tasks', async () => {
    const result = await listMyIssuesTool.handler(
      { filter: { state: { type: { eq: 'completed' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was passed to query
    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'completed' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_my_issues TOON output', () => {
  // Store original config value
  let originalToonEnabled: boolean;

  beforeEach(async () => {
    const { config } = await import('../../src/config/env.js');
    originalToonEnabled = config.TOON_OUTPUT_ENABLED;
  });

  afterEach(async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = originalToonEnabled;
  });

  it('returns TOON format when TOON_OUTPUT_ENABLED=true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('issues[');

    // Structured content should indicate TOON format
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(typeof structured.count).toBe('number');
  });

  it('returns TOON with state lookup table (Tier 2 - referenced only)', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have states section (only referenced states)
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('{key,name,type}');
  });

  it('returns TOON with issue data rows', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have issue schema header with all fields
    expect(textContent).toContain('issues[');
    expect(textContent).toContain('identifier');
    expect(textContent).toContain('title');
    expect(textContent).toContain('state');

    // Data rows should be indented with 2 spaces
    const lines = textContent.split('\n');
    const dataLines = lines.filter(
      (line: string) => line.startsWith('  ') && !line.startsWith('  _'),
    );
    expect(dataLines.length).toBeGreaterThan(0);
  });

  it('handles empty results in TOON format', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient({ issues: [] });
    resetMockCalls(mockClient);

    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');

    // Structured content should indicate count 0
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.count).toBe(0);
  });

  it('includes pagination info when hasMore is true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    // Request only 2 items to trigger pagination
    const result = await listMyIssuesTool.handler({ limit: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // Check if hasMore is set correctly
    expect(typeof structured.hasMore).toBe('boolean');
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listMyIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "My issues:" summary
    expect(textContent).toContain('My issues:');

    // Structured content should have items array (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});
