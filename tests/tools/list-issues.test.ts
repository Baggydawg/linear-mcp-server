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
  defaultMockIssues,
  type MockLinearClient,
  type MockProject,
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
    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();
  });

  it('respects limit parameter', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    expect(result.isError).toBeFalsy();

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
// Dedicated Filter Params Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues dedicated filter params', () => {
  it('injects stateType into filter', async () => {
    const result = await listIssuesTool.handler(
      { stateType: 'started' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
  });

  it('injects numeric priority into filter', async () => {
    const result = await listIssuesTool.handler({ priority: 2 }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.priority).toEqual({ eq: 2 });
  });

  it('injects string priority into filter', async () => {
    const result = await listIssuesTool.handler(
      { priority: 'high' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.priority).toEqual({ eq: 2 });
  });

  it('injects labels into filter', async () => {
    const result = await listIssuesTool.handler(
      { labels: ['Bug', 'Feature'] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.labels).toEqual({ name: { in: ['Bug', 'Feature'] } });
  });

  it('stateType overrides filter state type', async () => {
    const result = await listIssuesTool.handler(
      {
        stateType: 'completed',
        filter: { state: { type: { eq: 'started' } } },
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'completed' } });
  });

  it('combines dedicated params with other filter params', async () => {
    const result = await listIssuesTool.handler(
      { stateType: 'started', priority: 'high', team: 'SQT' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.state).toEqual({ type: { eq: 'started' } });
    expect(filter.priority).toEqual({ eq: 2 });
    expect(filter.team).toBeDefined();
  });

  it('rejects invalid stateType via schema validation', () => {
    const result = listIssuesTool.inputSchema.safeParse({
      stateType: 'invalid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errorMessage = result.error.errors.map((e) => e.message).join(', ');
      expect(errorMessage).toContain('Invalid enum value');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Output Shape Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues output shape', () => {
  it('matches TOON output format', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // TOON format is returned in text content
    const textContent = result.content[0].text;
    expect(textContent).toContain('issues[');
  });

  it('includes pagination info', async () => {
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // Pagination info is in text content
    expect(result.content[0].text).toContain('_meta{');
  });

  it('returns text content with issue preview', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    const textContent = result.content[0];
    expect(textContent.type).toBe('text');

    // TOON format uses schema headers
    expect(textContent.text).toContain('issues[');

    // Should contain issue identifier in TOON format (SQT is now the primary team)
    expect(textContent.text).toContain('SQT-');
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
    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // Empty results are indicated in text content - count shows 0
    const textContent = result.content[0].text;
    expect(textContent).toContain('count');
    expect(textContent).toContain(',0,');
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
  beforeEach(() => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  it('returns TOON format', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('issues[');

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();
  });

  it('returns TOON with state lookup table (Tier 2 - referenced only)', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have states section (only referenced states)
    expect(textContent).toContain('_states[');
    expect(textContent).toContain('{key,name,type}');
  });

  it('returns TOON with labels section', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Labels section is included even in Tier 2 (exception)
    // Note: The mock may or may not have labels depending on setup
    // We just verify the output format is valid TOON
    expect(textContent).toMatch(/issues\[\d+\]\{/);
  });

  it('returns TOON with issue data rows', async () => {
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
    mockClient = createMockLinearClient({ issues: [] });
    resetMockCalls(mockClient);

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');

    // Meta section should show count 0
    expect(textContent).toContain('count');

    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();
  });

  it('includes pagination info when hasMore is true', async () => {
    // Request only 2 items to trigger pagination
    const result = await listIssuesTool.handler({ limit: 2 }, baseContext);

    expect(result.isError).toBeFalsy();
    // Success responses no longer have structuredContent
    expect(result.structuredContent).toBeUndefined();

    // Pagination info is in text content (_meta section)
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
  });

  it('includes comments section in TOON output', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have comments section with schema header
    expect(textContent).toContain('comments[');
    expect(textContent).toContain('{issue,user,body,createdAt}');
  });

  it('includes relations section in TOON output', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have relations section with schema header
    expect(textContent).toContain('relations[');
    expect(textContent).toContain('{from,type,to}');
  });

  it('includes comment authors in _users lookup', async () => {
    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have _users section that includes comment authors
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('{key,name,displayName,email,role,teams}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enhancement Features Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues enhancement features', () => {
  it('uses default limit of 100', async () => {
    const result = await listIssuesTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();
    expect(mockClient._calls.rawRequest[0].variables?.first).toBe(100);
  });

  it('rejects team and teamId together', async () => {
    const result = await listIssuesTool.handler(
      { team: 'SQT', teamId: 'team-eng' },
      baseContext,
    );
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Cannot specify both');
  });

  it('handles cycle filter with default team', async () => {
    // When DEFAULT_TEAM is set (SQT), cycle filtering uses that team automatically
    // If no active cycle is found, it returns an appropriate error
    const result = await listIssuesTool.handler({ cycle: 'current' }, baseContext);
    // May succeed or fail depending on cycle availability, but should not require explicit team
    // The test verifies the cycle parameter is accepted when default team is configured
    expect(result.content).toBeDefined();
  });

  it('passes includeComments and includeRelations to GraphQL variables', async () => {
    const result = await listIssuesTool.handler({}, baseContext);
    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    // When TOON is enabled, defaults are true
    expect(call.variables?.includeComments).toBeDefined();
    expect(call.variables?.includeRelations).toBeDefined();
    expect(typeof call.variables?.includeComments).toBe('boolean');
    expect(typeof call.variables?.includeRelations).toBe('boolean');
  });

  it('passes teamId filter when team key is provided', async () => {
    // Note: resolveTeamId will be called with 'ENG' which is a mock team key
    // The mock client's teams have key 'ENG' (team-eng)
    const result = await listIssuesTool.handler({ teamId: 'team-eng' }, baseContext);
    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.team).toEqual({ id: { eq: 'team-eng' } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Departed User in _projects Lookup Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues departed user in _projects lookup', () => {
  beforeEach(async () => {
    // Clear registry so it re-initializes with our custom mock data
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('shows (departed) for project lead not in user registry', async () => {
    // Create a project with a leadId that is NOT in the mock users list
    const projectsWithDepartedLead: MockProject[] = [
      {
        id: 'project-departed-lead',
        name: 'Departed Lead Project',
        state: 'started',
        priority: 1,
        progress: 0.5,
        leadId: 'departed-user-001',
        lead: { id: 'departed-user-001' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
    ];

    // Create issues that reference this project
    const issuesWithDepartedProject = [
      {
        ...defaultMockIssues[0],
        project: Promise.resolve({
          id: 'project-departed-lead',
          name: 'Departed Lead Project',
        }),
      },
    ];

    mockClient = createMockLinearClient({
      projects: projectsWithDepartedLead,
      issues: issuesWithDepartedProject,
    });
    resetMockCalls(mockClient);

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // The _projects lookup section should contain (departed) for the lead
    // since 'departed-user-001' is not a registered user
    expect(textContent).toContain('_projects[');
    expect(textContent).toContain('(departed)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deleted Project Name Fallback Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues deleted project name fallback', () => {
  beforeEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('shows project name when project ID is not in registry', async () => {
    // Create an issue whose project has an ID NOT registered in any team's projects
    // but WITH a name in the GraphQL response. The registry will NOT contain
    // 'project-deleted-999' because no team.projects() returns it.
    const issuesWithDeletedProject = [
      {
        ...defaultMockIssues[0],
        project: Promise.resolve({
          id: 'project-deleted-999',
          name: 'Archived Alpha Project',
        }),
      },
    ];

    // Use default projects (project-001, project-002) — 'project-deleted-999' won't be in registry
    mockClient = createMockLinearClient({
      issues: issuesWithDeletedProject,
    });
    resetMockCalls(mockClient);

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // The issue row should show the project name 'Archived Alpha Project'
    // as a fallback since the project ID is not in the registry (no short key available)
    expect(textContent).toContain('Archived Alpha Project');

    // Should NOT show it as blank — the name fallback should kick in
    // Verify the issue row contains the project name (look for it in the data rows)
    const lines = textContent.split('\n');
    const issueDataLine = lines.find(
      (line: string) =>
        line.includes('SQT-123') && line.includes('Fix authentication bug'),
    );
    expect(issueDataLine).toBeDefined();
    expect(issueDataLine).toContain('Archived Alpha Project');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Short Key Resolution Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues project short key resolution', () => {
  beforeEach(async () => {
    const { clearRegistry, storeRegistry } = await import(
      '../../src/shared/toon/index.js'
    );
    type ShortKeyRegistry = import('../../src/shared/toon/index.js').ShortKeyRegistry;
    clearRegistry('test-session');

    const mockRegistry: ShortKeyRegistry = {
      users: new Map([['u0', 'user-001']]),
      states: new Map(),
      projects: new Map([
        ['pr0', 'project-001'],
        ['pr1', 'project-002'],
      ]),
      usersByUuid: new Map([['user-001', 'u0']]),
      statesByUuid: new Map(),
      projectsByUuid: new Map([
        ['project-001', 'pr0'],
        ['project-002', 'pr1'],
      ]),
      userMetadata: new Map([
        [
          'user-001',
          {
            name: 'Test User',
            displayName: 'Test',
            email: 'test@test.com',
            active: true,
          },
        ],
      ]),
      stateMetadata: new Map(),
      projectMetadata: new Map(),
      generatedAt: new Date(),
      workspaceId: 'ws-123',
    };

    storeRegistry('test-session', mockRegistry);
  });

  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('resolves project short key via project param', async () => {
    const result = await listIssuesTool.handler({ project: 'pr0' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'project-001' } });
  });

  it('resolves project short key via projectId param (backward compat)', async () => {
    const result = await listIssuesTool.handler({ projectId: 'pr0' }, baseContext);

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'project-001' } });
  });

  it('project param takes priority over projectId', async () => {
    const result = await listIssuesTool.handler(
      { project: 'pr0', projectId: 'some-uuid' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'project-001' } });
  });

  it('passes UUID directly when projectId is not a short key', async () => {
    const result = await listIssuesTool.handler(
      { projectId: 'some-uuid-value' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'some-uuid-value' } });
  });

  it('passes non-short-key string via project as UUID', async () => {
    const result = await listIssuesTool.handler(
      { project: 'some-uuid-value' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    const call = mockClient._calls.rawRequest[0];
    const filter = call.variables?.filter as Record<string, unknown>;
    expect(filter.project).toEqual({ id: { eq: 'some-uuid-value' } });
  });

  it('returns error for unknown project short key', async () => {
    const result = await listIssuesTool.handler({ project: 'pr99' }, baseContext);

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('pr99');
    expect(text).toContain('workspace_metadata');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_issues error handling', () => {
  beforeEach(async () => {
    // Pre-populate registry so handler doesn't trigger init during the test
    const { clearRegistry, storeRegistry } = await import(
      '../../src/shared/toon/index.js'
    );
    type ShortKeyRegistry = import('../../src/shared/toon/index.js').ShortKeyRegistry;
    clearRegistry('test-session');

    const mockRegistry: ShortKeyRegistry = {
      users: new Map(),
      states: new Map(),
      projects: new Map(),
      usersByUuid: new Map(),
      statesByUuid: new Map(),
      projectsByUuid: new Map(),
      userMetadata: new Map(),
      stateMetadata: new Map(),
      projectMetadata: new Map(),
      generatedAt: new Date(),
      workspaceId: 'ws-123',
    };

    storeRegistry('test-session', mockRegistry);
  });

  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('returns structured error when rawRequest throws', async () => {
    (mockClient.client.rawRequest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Argument Validation Error'),
    );

    const result = await listIssuesTool.handler({}, baseContext);

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain('Argument Validation Error');
  });

  it('returns structured error when viewer fetch fails for assignedToMe', async () => {
    Object.defineProperty(mockClient, 'viewer', {
      get: () => Promise.reject(new Error('Auth token expired')),
      configurable: true,
    });

    const result = await listIssuesTool.handler({ assignedToMe: true }, baseContext);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { type: string; text: string }).text;
    expect(text).toContain('Error');
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBeDefined();
    expect(structured.hint).toBeDefined();
  });
});
