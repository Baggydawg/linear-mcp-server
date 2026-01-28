/**
 * Tests for get_issues tool.
 * Verifies: input validation, batch fetching, output shape, TOON format.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIssuesTool } from '../../src/shared/tools/linear/get-issues.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import getIssuesFixtures from '../fixtures/tool-inputs/get-issues.json';
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

describe('get_issues tool metadata', () => {
  it('has correct name and title', () => {
    expect(getIssuesTool.name).toBe('get_issues');
    expect(getIssuesTool.title).toBe('Get Issues (Batch)');
  });

  it('has readOnlyHint annotation', () => {
    expect(getIssuesTool.annotations?.readOnlyHint).toBe(true);
    expect(getIssuesTool.annotations?.destructiveHint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues input validation', () => {
  describe('valid inputs', () => {
    for (const fixture of getIssuesFixtures.valid) {
      it(`accepts: ${fixture.name}`, () => {
        const result = getIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('invalid inputs', () => {
    for (const fixture of getIssuesFixtures.invalid) {
      it(`rejects: ${fixture.name}`, () => {
        const result = getIssuesTool.inputSchema.safeParse(fixture.input);
        expect(result.success).toBe(false);
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues handler', () => {
  it('fetches single issue by UUID', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.results).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    expect(results.length).toBe(1);
    expect(results[0].success).toBe(true);
    expect(results[0].issue).toBeDefined();
    expect((results[0].issue as Record<string, unknown>).id).toBe('issue-001');

    // Verify issue() was called
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');
  });

  it('fetches single issue by identifier', async () => {
    const result = await getIssuesTool.handler({ ids: ['ENG-123'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(true);
    expect((results[0].issue as Record<string, unknown>).identifier).toBe('ENG-123');

    // Verify issue() was called with identifier
    expect(mockClient.issue).toHaveBeenCalledWith('ENG-123');
  });

  it('fetches multiple issues in batch', async () => {
    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002', 'issue-003'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results.length).toBe(3);
    expect(mockClient.issue).toHaveBeenCalledTimes(3);
  });

  it('returns issue details in result', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const issue = results[0].issue as Record<string, unknown>;

    expect(issue).toBeDefined();
    expect(issue.id).toBe('issue-001');
    expect(issue.title).toBe('Fix authentication bug');
  });

  it('includes summary with ok/failed counts', async () => {
    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002'] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { succeeded: number; failed: number };

    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues output shape', () => {
  it('matches GetIssuesOutputSchema', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.results).toBeDefined();
    expect(structured.summary).toBeDefined();

    const results = structured.results as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(typeof r.requestedId).toBe('string');
      expect(typeof r.success).toBe('boolean');
      if (r.success) {
        expect(r.issue).toBeDefined();
      }
    }
  });

  it('issue contains expected fields', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;
    const issue = results[0].issue as Record<string, unknown>;

    // Required identification fields
    expect(issue.id).toBeDefined();
    expect(issue.identifier).toBeDefined();
    expect(issue.title).toBeDefined();

    // State info (nested object in GetIssueOutputSchema)
    expect(issue.state).toBeDefined();
    const state = issue.state as Record<string, unknown>;
    expect(state.id).toBeDefined();
    expect(state.name).toBeDefined();

    // Labels array
    expect(issue.labels).toBeDefined();
    expect(Array.isArray(issue.labels)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues error handling', () => {
  it('handles not found gracefully', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

    const result = await getIssuesTool.handler({ ids: ['nonexistent'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });

  it('continues batch on partial failure', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null) // First fails (not found)
      .mockResolvedValueOnce({
        // Second succeeds - full mock with all required async properties
        id: 'issue-002',
        identifier: 'ENG-124',
        title: 'Test',
        description: null,
        branchName: null,
        state: Promise.resolve({ id: 'state-todo', name: 'Todo', type: 'unstarted' }),
        project: Promise.resolve(null),
        assignee: Promise.resolve(null),
        labels: () => Promise.resolve({ nodes: [] }),
        attachments: () => Promise.resolve({ nodes: [] }),
      });

    const result = await getIssuesTool.handler(
      { ids: ['bad-id', 'issue-002'] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const summary = structured.summary as { succeeded: number; failed: number };

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it('handles API error gracefully', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const results = structured.results as Array<Record<string, unknown>>;

    expect(results[0].success).toBe(false);
    expect((results[0].error as Record<string, unknown>).message).toContain(
      'Network error',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues TOON output', () => {
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

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

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
    expect(typeof structured.succeeded).toBe('number');
    expect(typeof structured.failed).toBe('number');
  });

  it('returns TOON with lookup tables (Tier 2 - referenced only)', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have some lookup tables (users, labels, etc.)
    // Note: _states may not be present if registry state IDs don't match mock issue state IDs
    expect(textContent).toMatch(
      /_users\[\d+\]|_states\[\d+\]|_projects\[\d+\]|_labels\[\d+\]/,
    );
  });

  it('returns TOON with issue data rows including full description', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

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

  it('includes succeeded and failed counts in TOON meta', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Meta should include succeeded, failed, total counts
    expect(textContent).toContain('succeeded');
    expect(textContent).toContain('failed');
    expect(textContent).toContain('total');

    // Structured content should have counts
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.succeeded).toBe(2);
    expect(structured.failed).toBe(0);
    expect(structured.total).toBe(2);
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Fetched" summary
    expect(textContent).toContain('Fetched');

    // Structured content should have results array (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.results).toBeDefined();
    expect(Array.isArray(structured.results)).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});
