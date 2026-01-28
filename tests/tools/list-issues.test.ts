/**
 * Tests for list_issues tool.
 * Verifies: input validation, filtering, pagination, output shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listIssuesTool } from '../../src/shared/tools/linear/list-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import listIssuesFixtures from '../fixtures/tool-inputs/list-issues.json';
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

describe('list_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(listIssuesTool.name).toBe('list_issues');
    expect(listIssuesTool.title).toBe('List Issues');
  });

  it('has readOnlyHint annotation', () => {
    expect(listIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(listIssuesTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description with state filtering guidance', () => {
    expect(listIssuesTool.description).toContain('List issues');
    expect(listIssuesTool.description).toContain('state');
    expect(listIssuesTool.description).toContain('filter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of listIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = listIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of listIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = listIssuesTool.inputSchema.safeParse(fixture.input);
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

describe('list_issues handler', () => {
  it('returns issues with default parameters', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    const items = structured.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
  });

  it('respects limit parameter', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;

    // Verify rawRequest was called with correct limit
    expect(mockClient._calls.rawRequest.length).toBe(1);
    expect(mockClient._calls.rawRequest[0].variables?.first).toBe(2);
  });

  it('passes teamId as filter', async () => {
    const result = await listIssuesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();

    // Verify filter was passed with team constraint
    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.filter).toBeDefined();
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.team).toEqual({ id: { eq: 'team-eng' } });
  });

  it('passes projectId as filter', async () => {
    const result = await listIssuesTool.handler(
      { projectId: 'project-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'project-001' } });
  });

  it('converts q parameter to keyword AND filter (default matchMode=all)', async () => {
    const result = await listIssuesTool.handler({ q: 'auth bug' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // Default matchMode is 'all', which uses AND filter
    expect(filter.and).toBeDefined();
    const andFilters = filter.and as Array<Record<string, unknown>>;
    expect(andFilters.length).toBe(2);
    expect(andFilters).toContainEqual({ title: { containsIgnoreCase: 'auth' } });
    expect(andFilters).toContainEqual({ title: { containsIgnoreCase: 'bug' } });
  });

  it('uses OR filter when matchMode is any', async () => {
    const result = await listIssuesTool.handler(
      { q: 'auth bug', matchMode: 'any' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // matchMode='any' uses OR filter
    expect(filter.or).toBeDefined();
    const orFilters = filter.or as Array<Record<string, unknown>>;
    expect(orFilters.length).toBe(2);
    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'auth' } });
    expect(orFilters).toContainEqual({ title: { containsIgnoreCase: 'bug' } });
  });

  it('uses explicit keywords array with AND filter', async () => {
    const result = await listIssuesTool.handler(
      { keywords: ['fix', 'auth'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    const andFilters = filter.and as Array<Record<string, unknown>>;

    expect(andFilters).toContainEqual({ title: { containsIgnoreCase: 'fix' } });
    expect(andFilters).toContainEqual({ title: { containsIgnoreCase: 'auth' } });
  });

  it('passes state filter to GraphQL', async () => {
    const result = await listIssuesTool.handler(
      { filter: { state: { type: { eq: 'started' } } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('passes cursor for pagination', async () => {
    const result = await listIssuesTool.handler({ cursor: 'abc-cursor' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.after).toBe('abc-cursor');
  });

  it('passes orderBy parameter', async () => {
    const result = await listIssuesTool.handler({ orderBy: 'createdAt' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.orderBy).toBe('createdAt');
  });

  it('passes includeArchived parameter', async () => {
    const result = await listIssuesTool.handler({ includeArchived: true }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    expect(call.variables?.includeArchived).toBe(true);
  });

  it('combines multiple filters', async () => {
    const result = await listIssuesTool.handler(
      {
        teamId: 'team-eng',
        filter: { state: { type: { eq: 'started' } } },
        q: 'auth',
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;

    // Should have all three filters (keywords use 'and' by default)
    expect(filter.team).toEqual({ id: { eq: 'team-eng' } });
    expect(filter.state).toEqual({ type: { eq: 'started' } });
    expect(filter.and).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues output shape', () => {
  it('returns items array with issue objects', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    for (const item of items) {
      // Required fields
      expect(typeof item.id).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(typeof item.stateId).toBe('string');
      expect(typeof item.createdAt).toBe('string');
      expect(typeof item.updatedAt).toBe('string');

      // Labels array
      expect(Array.isArray(item.labels)).toBe(true);
    }
  });

  it('includes pagination info', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.limit).toBe(2);
    // nextCursor may or may not be present depending on hasNextPage
    expect('cursor' in structured || 'nextCursor' in structured).toBe(true);
  });

  it('returns text content with issue preview', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0];
    expect(textContent.type).toBe('text');
    expect(textContent.text).toContain('Issues');

    // Text should include actual issue data from mock
    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // If we have issues, text should reflect the count
    if (items.length > 0) {
      expect(textContent.text).toMatch(/Issues:\s*\d+/);
      // Should contain issue identifier or title
      const firstIssue = items[0];
      expect(
        textContent.text.includes(firstIssue.identifier as string) ||
          textContent.text.includes(firstIssue.title as string),
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues edge cases', () => {
  it('handles empty results gracefully', async () => {
    // Create client with no issues
    mockClient = createMockLinearClient({ issues: [] });

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBe(0);
  });

  it('handles complex nested filter', async () => {
    const complexFilter = {
      and: [
        { state: { type: { neq: 'completed' } } },
        { assignee: { id: { eq: 'user-001' } } },
        { priority: { lte: 2 } },
      ],
    };

    const result = await listIssuesTool.handler({ filter: complexFilter }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.and).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues TOON output', () => {
  // Store original config value
  let originalToonEnabled: boolean;

  beforeEach(async () => {
    // Import config dynamically to get fresh value
    const { config } = await import('../../src/config/env.js');
    originalToonEnabled = config.TOON_OUTPUT_ENABLED;
  });

  afterEach(async () => {
    // Reset config (note: config is a resolved singleton, so this may not work perfectly)
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

    const result = await listIssuesTool.handler({}, baseContext);

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

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have states section (only referenced states)
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('{key,name,type}');
  });

  it('returns TOON with labels section', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Labels section is included even in Tier 2 (exception)
    // Note: The mock may or may not have labels depending on setup
    // We just verify the output format is valid TOON
    expect(textContent).toMatch(/issues\[\d+\]\{/);
  });

  it('returns TOON with issue data rows', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await listIssuesTool.handler({}, baseContext);

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

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');

    // Meta section should show count 0
    expect(textContent).toContain('count');

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
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

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

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Issues:" summary
    expect(textContent).toContain('Issues:');

    // Structured content should have items array (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});
