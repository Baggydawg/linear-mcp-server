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
  it('requires teamId parameter', () => {
    const result = listCyclesTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
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
    expect(result.structuredContent).toBeDefined();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);
  });

  it('filters cycles by team', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // All cycles should belong to the requested team
    for (const item of items) {
      expect(item.teamId).toBe('team-eng');
    }
  });

  it('respects limit parameter', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', limit: 1 },
      baseContext,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.limit).toBe(1);
  });

  it('supports pagination with cursor', async () => {
    const result = await listCyclesTool.handler(
      { teamId: 'team-eng', cursor: 'test-cursor' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.cursor).toBe('test-cursor');
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
  it('matches ListCyclesOutputSchema', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;

    expect(structured.items).toBeDefined();
    const items = structured.items as Array<Record<string, unknown>>;

    for (const item of items) {
      expect(item.id).toBeDefined();
      expect(item.teamId).toBeDefined();
      expect(typeof item.id).toBe('string');
      expect(typeof item.teamId).toBe('string');
    }
  });

  it('includes cycle metadata (name, number, dates)', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);

    const firstCycle = items[0];
    expect(firstCycle.name).toBeDefined();
    expect(firstCycle.number).toBeDefined();
  });

  it('includes pagination info', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    expect('nextCursor' in structured || 'cursor' in structured).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles common workflows', () => {
  it('lists cycles with team ID association', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    // All cycles should be associated with the requested team
    for (const cycle of items) {
      expect(cycle.teamId).toBe('team-eng');
    }
  });

  it('provides cycle dates for sprint planning', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);

    // Cycles should have start/end dates for planning
    const firstCycle = items[0];
    expect(firstCycle.startsAt).toBeDefined();
    expect(firstCycle.endsAt).toBeDefined();
  });

  it('provides cycle number for identification', async () => {
    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items.length).toBeGreaterThan(0);

    // Cycles should have number for easy reference
    const firstCycle = items[0];
    expect(firstCycle.number).toBeDefined();
    expect(typeof firstCycle.number).toBe('number');
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

    const structured = result.structuredContent as Record<string, unknown>;
    const items = structured.items as Array<Record<string, unknown>>;

    expect(items).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_cycles TOON output', () => {
  // Store original config value
  let originalToonEnabled: boolean;

  beforeEach(async () => {
    // Import config dynamically to get fresh value
    const { config } = await import('../../src/config/env.js');
    originalToonEnabled = config.TOON_OUTPUT_ENABLED;
    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);
  });

  afterEach(async () => {
    // Reset config
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = originalToonEnabled;
  });

  it('returns TOON format when TOON_OUTPUT_ENABLED=true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

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

    // Structured content should indicate TOON format
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(typeof structured.count).toBe('number');
  });

  it('returns TOON with cycle schema fields', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

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
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Meta should contain team field
    expect(textContent).toContain('_meta{tool,team,count,generated}');
  });

  it('uses cycle number as natural key (no short keys)', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

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
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

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

    // Should have meta section with count 0
    expect(textContent).toContain('_meta{');

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.count).toBe(0);
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient({ cycles: defaultMockCycles });
    resetMockCalls(mockClient);

    const result = await listCyclesTool.handler({ teamId: 'team-eng' }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Cycles:" summary
    expect(textContent).toContain('Cycles:');

    // Structured content should have items array (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});
