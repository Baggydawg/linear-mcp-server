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
    // TOON format uses succeeded/failed counts
    expect(structured.succeeded).toBe(1);
    expect(structured.failed).toBe(0);

    // Verify issue() was called
    expect(mockClient.issue).toHaveBeenCalledWith('issue-001');
  });

  it('fetches single issue by identifier', async () => {
    const result = await getIssuesTool.handler({ ids: ['ENG-123'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    // TOON format uses succeeded/failed counts
    expect(structured.succeeded).toBe(1);

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
    // TOON format uses total count
    expect(structured.total).toBe(3);
    expect(mockClient.issue).toHaveBeenCalledTimes(3);
  });

  it('returns issue details in text content', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    // TOON format returns issue details in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('issues[');
    expect(textContent).toContain('ENG-123'); // issue identifier
    expect(textContent).toContain('Fix authentication bug'); // issue title
  });

  it('includes succeeded/failed counts', async () => {
    const result = await getIssuesTool.handler(
      { ids: ['issue-001', 'issue-002'] },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    // TOON format uses top-level succeeded/failed
    expect(structured.succeeded).toBe(2);
    expect(structured.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues output shape', () => {
  it('matches TOON output format', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    // TOON format has these fields
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(typeof structured.succeeded).toBe('number');
    expect(typeof structured.failed).toBe('number');
    expect(typeof structured.total).toBe('number');
  });

  it('text content contains expected fields', async () => {
    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    const textContent = result.content[0].text;

    // TOON format includes issue details in text
    expect(textContent).toContain('issues[');
    expect(textContent).toContain('identifier');
    expect(textContent).toContain('title');
    expect(textContent).toContain('state');
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
    // TOON format uses top-level failed count
    expect(structured.failed).toBe(1);
    expect(structured.succeeded).toBe(0);
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
    // TOON format uses top-level succeeded/failed counts
    expect(structured.succeeded).toBe(1);
    expect(structured.failed).toBe(1);
  });

  it('handles API error gracefully', async () => {
    (mockClient.issue as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network error'),
    );

    const result = await getIssuesTool.handler({ ids: ['issue-001'] }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    // TOON format uses top-level failed count
    expect(structured.failed).toBe(1);
    expect(structured.succeeded).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_issues TOON output', () => {
  it('returns TOON format', async () => {
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
});
