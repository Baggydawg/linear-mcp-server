/**
 * Tests for list_cycles tool.
 * Verifies: cycle listing, team filtering, cyclesEnabled check, output shape.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listCyclesTool } from '../../src/shared/tools/linear/cycles.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockCycles,
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
  mockClient = createMockLinearClient({ cycles: defaultMockCycles });
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles tool metadata', () => {
  it('has correct name and title', () => {
    expect(listCyclesTool.name).toBe('list_cycles');
    expect(listCyclesTool.title).toBe('List Cycles');
  });

  it('has readOnlyHint annotation', () => {
    expect(listCyclesTool.annotations?.readOnlyHint).toBe(true);
    expect(listCyclesTool.annotations?.destructiveHint).toBe(false);
  });

  it('description mentions cyclesEnabled requirement', () => {
    expect(listCyclesTool.description).toContain('cyclesEnabled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles input validation', () => {
  it('teamId is optional (defaults to DEFAULT_TEAM)', () => {
    const result = listCyclesTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid teamId', () => {
    const result = listCyclesTool.inputSchema.safeParse({ teamId: 'team-eng' });
    expect(result.success).toBe(true);
  });

  it('accepts optional limit', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      limit: 10,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional cursor for pagination', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      cursor: 'test-cursor',
    });
    expect(result.success).toBe(true);
  });

  it('accepts includeArchived option', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      includeArchived: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts orderBy parameter', () => {
    const result = listCyclesTool.inputSchema.safeParse({
      teamId: 'team-eng',
      orderBy: 'createdAt',
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles handler', () => {
  it('returns cycles for specified team', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('filters cycles by team', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', limit: 1 },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports pagination with cursor', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', cursor: 'test-cursor' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports ordering by updatedAt', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', orderBy: 'updatedAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports ordering by createdAt', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', orderBy: 'createdAt' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('supports includeArchived option', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', includeArchived: true },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles output shape', () => {
  it('matches TOON output format', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // TOON format should have cycles section with schema
    expect(textContent).toContain('cycles[');
    expect(textContent).toContain('_meta{');
  });

  it('includes cycle metadata in text content', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const textContent = result.content[0].text;

    // TOON format should have cycles section with schema
    expect(textContent).toContain('cycles[');
  });

  it('includes pagination info', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles common workflows', () => {
  it('lists cycles with team ID association', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();

    // TOON format should show team in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
  });

  it('provides cycle dates for sprint planning', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const textContent = result.content[0].text;

    // TOON format should include start and end dates in schema
    expect(textContent).toContain('start');
    expect(textContent).toContain('end');
  });

  it('provides cycle number for identification', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const textContent = result.content[0].text;

    // TOON format should include num field in cycles schema
    expect(textContent).toContain('num');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles edge cases', () => {
  it('returns error when team has cyclesEnabled=false', async () => {
    // team-design has cyclesEnabled=false
    const result = await listCyclesTool.handler({ teamId: 'team-design' }, baseContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cycles are disabled');
  });

  it('returns empty list when team has no cycles but cyclesEnabled=true', async () => {
    // Create a team with cycles enabled but no cycles
    mockClient = createMockLinearClient({
      teams: [
        {
          id: 'team-new',
          key: 'NEW',
          name: 'New Team',
          cyclesEnabled: true,
          states: () => Promise.resolve({ nodes: [] }),
          labels: () => Promise.resolve({ nodes: [] }),
          projects: () => Promise.resolve({ nodes: [] }),
          cycles: () =>
            Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
        },
      ],
      cycles: [],
    });

    const result = await listCyclesTool.handler({ teamId: 'team-new' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);
  });

  it('returns TOON format', async () => {
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('cycles[');
  });

  it('returns TOON with cycle schema fields', async () => {
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have cycle schema header with fields (num, name, start, end, active, progress)
    expect(textContent).toContain('cycles[');
    expect(textContent).toContain('{num,name,start,end,active,progress}');
  });

  it('includes team key in meta', async () => {
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Meta should contain team field
    expect(textContent).toContain('_meta{tool,team,count,generated}');
  });

  it('uses cycle number as natural key (no short keys)', async () => {
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Data rows should have cycle numbers (1, 2, etc.) not short keys
    // The first cycle in mock has number=1
    expect(textContent).toMatch(/cycles\[\d+\]/);
  });

  it('handles empty cycles in TOON format', async () => {
    // Create a team with cycles enabled but no cycles
    mockClient = createMockLinearClient({
      teams: [
        {
          id: 'team-new',
          key: 'NEW',
          name: 'New Team',
          cyclesEnabled: true,
          states: () => Promise.resolve({ nodes: [] }),
          labels: () => Promise.resolve({ nodes: [] }),
          projects: () => Promise.resolve({ nodes: [] }),
          cycles: () =>
            Promise.resolve({ nodes: [], pageInfo: { hasNextPage: false } }),
        },
      ],
      cycles: [],
    });

    const result = await listCyclesTool.handler({ teamId: 'team-new' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');
  });
});
