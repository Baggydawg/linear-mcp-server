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

// Mock cycles for testing (using SQT as primary team)
const mockCycles = [
  {
    id: 'cycle-sqt-001',
    number: 1,
    name: 'Sprint 1',
    startsAt: '2026-01-05T00:00:00Z',
    endsAt: '2026-01-18T23:59:59Z',
    progress: 1.0,
    team: { id: 'team-sqt' },
  },
  {
    id: 'cycle-sqt-002',
    number: 2,
    name: 'Sprint 2',
    startsAt: '2026-01-19T00:00:00Z',
    endsAt: '2026-02-01T23:59:59Z',
    progress: 0.5,
    team: { id: 'team-sqt' },
  },
  {
    id: 'cycle-sqt-003',
    number: 3,
    name: 'Sprint 3',
    startsAt: '2026-02-02T00:00:00Z',
    endsAt: '2026-02-15T23:59:59Z',
    progress: 0,
    team: { id: 'team-sqt' },
  },
];

// Mock issues for sprint context (using SQT as primary team)
const mockSprintIssues = [
  {
    id: 'issue-sprint-1',
    identifier: 'SQT-201',
    title: 'Implement authentication',
    description: 'Add OAuth2 authentication flow',
    priority: 1, // Urgent
    estimate: null, // Missing estimate - gap
    updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago - stale
    state: { id: 'state-sqt-todo', name: 'Todo', type: 'unstarted' },
    project: { id: 'project-001', name: 'Q1 Release' },
    assignee: { id: 'user-001', name: 'Test User' },
    parent: null,
    labels: { nodes: [{ id: 'label-sqt-bug', name: 'Bug' }] },
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
    identifier: 'SQT-202',
    title: 'Fix database connection',
    description: 'Connection pool exhaustion issue',
    priority: 2,
    estimate: 3,
    updatedAt: new Date().toISOString(), // Recent
    state: { id: 'state-sqt-inprogress', name: 'In Progress', type: 'started' },
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
          relatedIssue: { identifier: 'SQT-203' },
        },
      ],
    },
  },
  {
    id: 'issue-sprint-3',
    identifier: 'SQT-203',
    title: 'Deploy to production',
    description: 'Final deployment',
    priority: 2,
    estimate: null, // Missing estimate
    updatedAt: new Date().toISOString(),
    state: { id: 'state-sqt-todo', name: 'Todo', type: 'unstarted' },
    project: null, // No project
    assignee: null, // No assignee - gap
    parent: null,
    labels: { nodes: [] },
    comments: { nodes: [] },
    relations: { nodes: [] },
  },
  {
    id: 'issue-sprint-4',
    identifier: 'SQT-204',
    title: 'Completed task',
    description: 'Already done',
    priority: 3,
    estimate: 2,
    updatedAt: new Date().toISOString(),
    state: { id: 'state-sqt-done', name: 'Done', type: 'completed' },
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

  // Override rawRequest for sprint context queries (using SQT as primary team)
  mockClient.client.rawRequest = vi.fn(
    async (query: string, variables?: Record<string, unknown>) => {
      // Handle GetTeamCycles query
      if (query.includes('query GetTeamCycles')) {
        return {
          data: {
            team: {
              id: 'team-sqt',
              key: 'SQT',
              name: 'Squad Testing',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-sqt-002', number: 2 },
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
              id: 'team-sqt',
              key: 'SQT',
              name: 'Squad Testing',
              cycles: {
                nodes: [
                  {
                    ...cycle,
                    issues: { nodes: mockSprintIssues },
                  },
                ],
              },
              activeCycle: { id: 'cycle-sqt-002', number: 2 },
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
    expect(textContent).toContain('SQT-201'); // Has no estimate
    expect(textContent).toContain('SQT-203'); // Has no estimate
  });

  it('detects no_assignee gap', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect unassigned issues (excluding completed)
    expect(textContent).toContain('no_assignee');
    expect(textContent).toContain('SQT-203'); // No assignee, not completed
  });

  it('detects stale gap (7+ days old)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect stale issues
    expect(textContent).toContain('stale');
    expect(textContent).toContain('SQT-201'); // 10 days since update
  });

  it('detects blocked gap', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect blocked issues
    expect(textContent).toContain('blocked');
    expect(textContent).toContain('SQT-203'); // Blocked by SQT-202
  });

  it('detects priority_mismatch gap (urgent not started)', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should detect priority mismatch
    expect(textContent).toContain('priority_mismatch');
    expect(textContent).toContain('SQT-201'); // Priority 1, state = unstarted
  });

  it('uses first team when team not specified', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();

    // Should use first team (SQT) - verify in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('SQT');
  });

  it('handles specific cycle number', async () => {
    const result = await getSprintContextTool.handler({ cycle: 1 }, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
  });

  it('includes all referenced users in _users lookup (creators, assignees, comment authors)', async () => {
    // Override rawRequest to return issues where user-003 is ONLY a creator
    // (not an assignee of any issue, and not a comment author)
    const issuesWithCreators = [
      {
        id: 'issue-sprint-1',
        identifier: 'SQT-201',
        title: 'Implement authentication',
        description: 'Add OAuth2 authentication flow',
        priority: 1,
        estimate: null,
        updatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        state: { id: 'state-sqt-todo', name: 'Todo', type: 'unstarted' },
        project: { id: 'project-001', name: 'Q1 Release' },
        assignee: { id: 'user-001', name: 'Test User' },
        creator: { id: 'user-003', name: 'Bob Smith' }, // user-003 is only a creator here
        parent: null,
        labels: { nodes: [] },
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
        identifier: 'SQT-202',
        title: 'Fix database connection',
        description: 'Connection pool exhaustion issue',
        priority: 2,
        estimate: 3,
        updatedAt: new Date().toISOString(),
        state: {
          id: 'state-sqt-inprogress',
          name: 'In Progress',
          type: 'started',
        },
        project: { id: 'project-001', name: 'Q1 Release' },
        assignee: { id: 'user-002', name: 'Jane Doe' },
        creator: { id: 'user-002', name: 'Jane Doe' },
        parent: null,
        labels: { nodes: [] },
        comments: { nodes: [] },
        relations: { nodes: [] },
      },
    ];

    mockClient.client.rawRequest = vi.fn(
      async (query: string, variables?: Record<string, unknown>) => {
        if (query.includes('query GetTeamCycles')) {
          return {
            data: {
              team: {
                id: 'team-sqt',
                key: 'SQT',
                name: 'Squad Testing',
                cycles: { nodes: mockCycles },
                activeCycle: { id: 'cycle-sqt-002', number: 2 },
              },
            },
          };
        }
        if (query.includes('query GetSprintContext')) {
          const cycleNumber = variables?.cycleNumber as number;
          const cycle = mockCycles.find((c) => c.number === cycleNumber);
          if (!cycle) {
            return { data: { team: { cycles: { nodes: [] } } } };
          }
          return {
            data: {
              team: {
                id: 'team-sqt',
                key: 'SQT',
                name: 'Squad Testing',
                cycles: {
                  nodes: [
                    {
                      ...cycle,
                      issues: { nodes: issuesWithCreators },
                    },
                  ],
                },
                activeCycle: { id: 'cycle-sqt-002', number: 2 },
              },
            },
          };
        }
        return { data: {} };
      },
    );

    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // _users section should exist
    expect(textContent).toContain('_users[');

    // Parse _users section to verify all 3 users are present
    // user-001 is assignee + comment author, user-002 is assignee + creator, user-003 is ONLY a creator
    const usersMatch = textContent.match(
      /_users\[(\d+)\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|\nissues)/,
    );
    expect(usersMatch).not.toBeNull();

    const usersSection = usersMatch![2];
    // All three users should have entries: u0, u1, u2
    expect(usersSection).toContain('u0');
    expect(usersSection).toContain('u1');
    expect(usersSection).toContain('u2');

    // Verify the count matches: all 3 users are referenced
    const userCount = parseInt(usersMatch![1], 10);
    expect(userCount).toBe(3);

    // Verify user-003 (Bob Smith) appears in _users despite being only a creator
    expect(usersSection).toContain('Bob Smith');
  });

  it('handles external users not in registry with ext fallback', async () => {
    // Create mock issues where the creator is NOT in the workspace users list
    const issuesWithExternalCreator = [
      {
        id: 'issue-sprint-ext-1',
        identifier: 'SQT-301',
        title: 'Automated deployment setup',
        description: 'Set up CI/CD pipeline',
        priority: 2,
        estimate: 3,
        updatedAt: new Date().toISOString(),
        state: {
          id: 'state-sqt-inprogress',
          name: 'In Progress',
          type: 'started',
        },
        project: null,
        assignee: { id: 'user-001', name: 'Test User' },
        creator: { id: 'external-user-001', name: 'External Bot' }, // NOT in workspace users
        parent: null,
        labels: { nodes: [] },
        comments: { nodes: [] },
        relations: { nodes: [] },
      },
    ];

    mockClient.client.rawRequest = vi.fn(
      async (query: string, variables?: Record<string, unknown>) => {
        if (query.includes('query GetTeamCycles')) {
          return {
            data: {
              team: {
                id: 'team-sqt',
                key: 'SQT',
                name: 'Squad Testing',
                cycles: { nodes: mockCycles },
                activeCycle: { id: 'cycle-sqt-002', number: 2 },
              },
            },
          };
        }
        if (query.includes('query GetSprintContext')) {
          const cycleNumber = variables?.cycleNumber as number;
          const cycle = mockCycles.find((c) => c.number === cycleNumber);
          if (!cycle) {
            return { data: { team: { cycles: { nodes: [] } } } };
          }
          return {
            data: {
              team: {
                id: 'team-sqt',
                key: 'SQT',
                name: 'Squad Testing',
                cycles: {
                  nodes: [
                    {
                      ...cycle,
                      issues: { nodes: issuesWithExternalCreator },
                    },
                  ],
                },
                activeCycle: { id: 'cycle-sqt-002', number: 2 },
              },
            },
          };
        }
        return { data: {} };
      },
    );

    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // _users section should exist
    expect(textContent).toContain('_users[');

    // Parse _users section
    const usersMatch = textContent.match(
      /_users\[(\d+)\]\{[^}]+\}:\n([\s\S]*?)(?=\n\n|\n_|\nissues)/,
    );
    expect(usersMatch).not.toBeNull();

    const usersSection = usersMatch![2];

    // Should contain ext0 entry for the external user
    expect(usersSection).toContain('ext0');
    expect(usersSection).toContain('External Bot');
    expect(usersSection).toContain('(external)');

    // Should also contain the registered user (u0 for user-001)
    expect(usersSection).toContain('u0');

    // Verify that ext0 appears in the full output (both _users and issues sections)
    // ext0 is used in the issues section as the creator of SQT-301
    // Count ext0 occurrences: once in _users, once in issues row
    const ext0Occurrences = (textContent.match(/ext0/g) ?? []).length;
    expect(ext0Occurrences).toBeGreaterThanOrEqual(2); // At least in _users + issues creator column

    // Verify the issue row for SQT-301 contains ext0 (creator column is last in SPRINT_ISSUE_SCHEMA)
    const issueRow = textContent
      .split('\n')
      .find((line: string) => line.includes('SQT-301'));
    expect(issueRow).toBeDefined();
    expect(issueRow).toContain('ext0');
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

describe('get_sprint_context API error handling', () => {
  it('returns structured error when cycles query fails', async () => {
    mockClient.client.rawRequest = vi.fn().mockRejectedValue(
      new Error('Network timeout'),
    );

    const result = await getSprintContextTool.handler(
      { cycle: 'current' },
      baseContext,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain('Error');
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBeDefined();
    expect(structured.hint).toBeDefined();
  });

  it('returns structured error when sprint context query fails', async () => {
    // First call (cycles query) succeeds, second call (sprint context) fails
    let callCount = 0;
    mockClient.client.rawRequest = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            team: {
              id: 'team-sqt',
              cycles: { nodes: mockCycles },
              activeCycle: { number: 2 },
            },
          },
        };
      }
      throw new Error('Rate limit exceeded');
    });

    const result = await getSprintContextTool.handler(
      { cycle: 'current' },
      baseContext,
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain('Error');
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBeDefined();
    expect(structured.hint).toBeDefined();
  });

  it('does not hit cycles query for direct cycle number', async () => {
    mockClient.client.rawRequest = vi
      .fn()
      .mockRejectedValue(new Error('API failure'));

    const result = await getSprintContextTool.handler(
      { cycle: 5 },
      baseContext,
    );

    // Should fail on the sprint context query (only call), not cycles query
    expect(result.isError).toBe(true);
    expect(mockClient.client.rawRequest).toHaveBeenCalledTimes(1);
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
              id: 'team-sqt',
              key: 'SQT',
              name: 'Squad Testing',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-sqt-003', number: 3 }, // Last cycle is active
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
              id: 'team-sqt',
              key: 'SQT',
              name: 'Squad Testing',
              cycles: { nodes: mockCycles },
              activeCycle: { id: 'cycle-sqt-001', number: 1 }, // First cycle is active
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

// ─────────────────────────────────────────────────────────────────────────────
// Project Lookup Field Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('project lookup field population', () => {
  it('populates all 7 project fields from registry metadata', async () => {
    const result = await getSprintContextTool.handler({ cycle: 2 }, baseContext);
    const text = result.content[0].text;

    // Verify _projects header has all 7 fields
    const projectHeaderMatch = text.match(/_projects\[\d+\]\{([^}]+)\}/);
    expect(projectHeaderMatch).not.toBeNull();
    const fields = projectHeaderMatch![1].split(',');
    expect(fields).toEqual([
      'key',
      'name',
      'state',
      'priority',
      'progress',
      'lead',
      'targetDate',
    ]);
  });
});
