/**
 * Tests for get_sprint_context tool.
 * Verifies: input validation, cycle selection, TOON output, gap analysis.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSprintContextTool } from '../../src/shared/tools/linear/get-sprint-context.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockStates,
  defaultMockTeams,
  defaultMockUsers,
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

// Mock the config module to ensure DEFAULT_TEAM is not set in tests
vi.mock('../../src/config/env.js', () => ({
  config: {
    HOST: '127.0.0.1',
    PORT: 3000,
    NODE_ENV: 'test',
    AUTH_STRATEGY: 'bearer',
    LINEAR_ACCESS_TOKEN: 'test-token-xxx',
    DEFAULT_TEAM: undefined,
  },
}));

// Mock cycles for testing
const mockCycles = [
  {
    id: 'cycle-001',
    number: 1,
    name: 'Sprint 1',
    startsAt: '2026-01-05T00:00:00Z',
    endsAt: '2026-01-18T23:59:59Z',
    progress: 1.0,
    team: { id: 'team-eng' },
  },
  {
    id: 'cycle-002',
    number: 2,
    name: 'Sprint 2',
    startsAt: '2026-01-19T00:00:00Z',
    endsAt: '2026-02-01T23:59:59Z',
    progress: 0.5,
    team: { id: 'team-eng' },
  },
  {
    id: 'cycle-003',
    number: 3,
    name: 'Sprint 3',
    startsAt: '2026-02-02T00:00:00Z',
    endsAt: '2026-02-15T23:59:59Z',
    progress: 0,
    team: { id: 'team-eng' },
  },
];

// Mock issues for sprint context
const mockSprintIssues = [
  {
    id: 'issue-sprint-1',
    identifier: 'ENG-201',
    title: 'Implement authentication',
    description: 'Add OAuth2 authentication flow',
    priority: 1, // Urgent
    estimate: null, // Missing estimate - gap
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago - stale
    state: { id: 'state-eng-todo', name: 'Todo', type: 'unstarted' },
    project: { id: 'project-001', name: 'Q1 Release' },
    assignee: { id: 'user-001', name: 'Test User' },
    parent: null,
    labels: { nodes: [{ id: 'label-bug', name: 'Bug' }] },
    comments: {
      nodes: [
        {
          id: 'comment-s1',
          body: 'Working on this',
          createdAt: '2026-01-20T10:00:00Z',
          user: { id: 'user-001', name: 'Test User' },
        },
      ],
    },
    relations: { nodes: [] },
  },
  {
    id: 'issue-sprint-2',
    identifier: 'ENG-202',
    title: 'Fix database connection',
    description: 'Connection pool exhaustion issue',
    priority: 2,
    estimate: 3,
    updatedAt: new Date().toISOString(), // Recent
    state: { id: 'state-eng-inprogress', name: 'In Progress', type: 'started' },
    project: { id: 'project-001', name: 'Q1 Release' },
    assignee: { id: 'user-002', name: 'Jane Doe' },
    parent: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    relations: {
      nodes: [
        {
          id: 'rel-001',
          type: 'blocks',
          relatedIssue: { identifier: 'ENG-203' },
        },
      ],
    },
  },
  {
    id: 'issue-sprint-3',
    identifier: 'ENG-203',
    title: 'Deploy to production',
    description: 'Final deployment',
    priority: 2,
    estimate: null, // Missing estimate
    updatedAt: new Date().toISOString(),
    state: { id: 'state-eng-todo', name: 'Todo', type: 'unstarted' },
    project: null, // No project
    assignee: null, // No assignee - gap
    parent: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    relations: { nodes: [] },
  },
  {
    id: 'issue-sprint-4',
    identifier: 'ENG-204',
    title: 'Completed task',
    description: 'Already done',
    priority: 3,
    estimate: 2,
    updatedAt: new Date().toISOString(),
    state: { id: 'state-eng-done', name: 'Done', type: 'completed' },
    project: { id: 'project-001', name: 'Q1 Release' },
    assignee: { id: 'user-001', name: 'Test User' },
    parent: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    relations: { nodes: [] },
  },
];

beforeEach(() => {
  mockClient = createMockLinearClient({
    teams: defaultMockTeams,
    users: defaultMockUsers,
    cycles: mockCycles,
  });

  // Override rawRequest for sprint context queries
  mockClient.client.rawRequest = vi.fn(
    async (query: string, variables?: Record<string, unknown>) => {
      // Handle GetTeamCycles query
      if (query.includes('query GetTeamCycles')) {
        return {
          data: {
            team: {
              id: 'team-eng',
              key: 'ENG',
              name: 'Engineering',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-002', number: 2 },
            },
          },
        };
      }

      // Handle GetSprintContext query
      if (query.includes('query GetSprintContext')) {
        const cycleNumber = variables?.cycleNumber as number;
        const cycle = mockCycles.find((c) => c.number === cycleNumber);

        if (!cycle) {
          return { data: { team: { cycles: { nodes: [] } } } };
        }

        return {
          data: {
            team: {
              id: 'team-eng',
              key: 'ENG',
              name: 'Engineering',
              cycles: {
                nodes: [
                  {
                    ...cycle,
                    issues: { nodes: mockSprintIssues },
                  },
                ],
              },
              activeCycle: { id: 'cycle-002', number: 2 },
            },
          },
        };
      }

      return { data: {} };
    },
  );

  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context tool metadata', () => {
  it('has correct name and title', () => {
    expect(getSprintContextTool.name).toBe('get_sprint_context');
    expect(getSprintContextTool.title).toBe('Get Sprint Context');
  });

  it('has readOnlyHint annotation', () => {
    expect(getSprintContextTool.annotations?.readOnlyHint).toBe(true);
    expect(getSprintContextTool.annotations?.destructiveHint).toBe(false);
  });

  it('has description with gap analysis info', () => {
    expect(getSprintContextTool.description).toContain('gap analysis');
    expect(getSprintContextTool.description).toContain('no_estimate');
    expect(getSprintContextTool.description).toContain('no_assignee');
    expect(getSprintContextTool.description).toContain('stale');
    expect(getSprintContextTool.description).toContain('blocked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Input Validation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context input validation', () => {
  it('accepts empty input (uses defaults)', () => {
    const result = getSprintContextTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts team key', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ team: 'ENG' });
    expect(result.success).toBe(true);
  });

  it('accepts cycle selector "current"', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 'current' });
    expect(result.success).toBe(true);
  });

  it('accepts cycle selector "next"', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 'next' });
    expect(result.success).toBe(true);
  });

  it('accepts cycle selector "previous"', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 'previous' });
    expect(result.success).toBe(true);
  });

  it('accepts numeric cycle number', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 5 });
    expect(result.success).toBe(true);
  });

  it('accepts includeComments flag', () => {
    const result = getSprintContextTool.inputSchema.safeParse({
      includeComments: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts includeRelations flag', () => {
    const result = getSprintContextTool.inputSchema.safeParse({
      includeRelations: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid cycle selector', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects negative cycle number', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects zero cycle number', () => {
    const result = getSprintContextTool.inputSchema.safeParse({ cycle: 0 });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler Behavior Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context handler', () => {
  it('returns TOON format output', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0].text;

    // TOON output should contain meta section
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('version');
    expect(textContent).toContain('team');
    expect(textContent).toContain('cycle');
  });

  it('includes issues section', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have issues section
    expect(textContent).toContain('issues[');
    expect(textContent).toContain('identifier');
    expect(textContent).toContain('title');
    expect(textContent).toContain('state');
  });

  it('includes _states lookup (Tier 2 - referenced only)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have states lookup section
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('{key,name,type}');
  });

  it('includes comments when includeComments is true (default)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have comments section
    expect(textContent).toContain('comments[');
  });

  it('includes relations when includeRelations is true (default)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have relations section
    expect(textContent).toContain('relations[');
  });

  it('includes _gaps section with gap analysis', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have gaps section
    expect(textContent).toContain('_gaps[');
    expect(textContent).toContain('{type,count,issues}');
  });

  it('detects no_estimate gap', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect issues without estimates
    expect(textContent).toContain('no_estimate');
    expect(textContent).toContain('ENG-201'); // Has no estimate
    expect(textContent).toContain('ENG-203'); // Has no estimate
  });

  it('detects no_assignee gap', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect unassigned issues (excluding completed)
    expect(textContent).toContain('no_assignee');
    expect(textContent).toContain('ENG-203'); // No assignee, not completed
  });

  it('detects stale gap (7+ days old)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect stale issues
    expect(textContent).toContain('stale');
    expect(textContent).toContain('ENG-201'); // 10 days since update
  });

  it('detects blocked gap', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect blocked issues
    expect(textContent).toContain('blocked');
    expect(textContent).toContain('ENG-203'); // Blocked by ENG-202
  });

  it('detects priority_mismatch gap (urgent not started)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect priority mismatch
    expect(textContent).toContain('priority_mismatch');
    expect(textContent).toContain('ENG-201'); // Priority 1, state = unstarted
  });

  it('uses first team when team not specified', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();

    // Should use first team (ENG) - verify in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('ENG');
  });

  it('handles specific cycle number', async () => {
    const result = await getSprintContextTool.handler({ cycle: 1 }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context error handling', () => {
  it('returns error when team not found', async () => {
    const result = await getSprintContextTool.handler(
      { team: 'NONEXISTENT' },
      baseContext,
    );

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('TEAM_NOT_FOUND');
    expect(structured.availableTeams).toBeDefined();
  });

  it('returns error when cycles are disabled for team', async () => {
    const result = await getSprintContextTool.handler({ team: 'DES' }, baseContext);

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('CYCLES_DISABLED');
  });

  it('returns error when cycle not found', async () => {
    // Request a cycle that doesn't exist
    const result = await getSprintContextTool.handler({ cycle: 999 }, baseContext);

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('CYCLE_NOT_FOUND');
    expect(structured.cycleNumber).toBe(999);
  });

  it('returns error when no teams in workspace', async () => {
    mockClient = createMockLinearClient({ teams: [] });

    const result = await getSprintContextTool.handler({}, baseContext);

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('NO_TEAMS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Navigation Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context cycle navigation', () => {
  it('handles "next" cycle selector', async () => {
    // Active cycle is 2, next should be 3
    const result = await getSprintContextTool.handler({ cycle: 'next' }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });

  it('handles "previous" cycle selector', async () => {
    // Active cycle is 2, previous should be 1
    const result = await getSprintContextTool.handler(
      { cycle: 'previous' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });

  it('returns error when no next cycle exists', async () => {
    // Override to make cycle 3 active
    mockClient.client.rawRequest = vi.fn(async (query: string) => {
      if (query.includes('query GetTeamCycles')) {
        return {
          data: {
            team: {
              id: 'team-eng',
              key: 'ENG',
              name: 'Engineering',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-003', number: 3 }, // Last cycle is active
            },
          },
        };
      }
      return { data: {} };
    });

    const result = await getSprintContextTool.handler({ cycle: 'next' }, baseContext);

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('NO_NEXT_CYCLE');
  });

  it('returns error when no previous cycle exists', async () => {
    // Override to make cycle 1 active
    mockClient.client.rawRequest = vi.fn(async (query: string) => {
      if (query.includes('query GetTeamCycles')) {
        return {
          data: {
            team: {
              id: 'team-eng',
              key: 'ENG',
              name: 'Engineering',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-001', number: 1 }, // First cycle is active
            },
          },
        };
      }
      return { data: {} };
    });

    const result = await getSprintContextTool.handler(
      { cycle: 'previous' },
      baseContext,
    );

    expect(result.isError).toBe(true);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe('NO_PREVIOUS_CYCLE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Structure Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('get_sprint_context output structure', () => {
  it('includes issue counts in text output', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('includes cycle dates in meta section', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Meta should include start and end dates
    expect(textContent).toContain('start');
    expect(textContent).toContain('end');
    expect(textContent).toContain('2026-01-19'); // Sprint 2 start
  });

  it('omits comments section when includeComments is false', async () => {
    const result = await getSprintContextTool.handler(
      { cycle: 2, includeComments: false },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should NOT have comments section
    expect(textContent).not.toContain('comments[');
  });

  it('omits relations section when includeRelations is false', async () => {
    const result = await getSprintContextTool.handler(
      { cycle: 2, includeRelations: false },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should NOT have relations section
    expect(textContent).not.toContain('relations[');
  });
});
