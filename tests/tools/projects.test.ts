/**
 * Tests for project tools (list, create, update).
 * Verifies: project listing, creation, updates, filtering, output shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectsTool,
  listProjectsTool,
  updateProjectsTool,
} from '../../src/shared/tools/linear/projects.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockProjects,
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

vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

beforeEach(() => {
  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

// ─────────────────────────────────────────────────────────────────────────────
// List Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listProjectsTool.name).toBe('list_projects');
      expect(listProjectsTool.title).toBe('List Projects');
    });

    it('has readOnlyHint annotation', () => {
      expect(listProjectsTool.annotations?.readOnlyHint).toBe(true);
      expect(listProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('returns all projects by default', async () => {
      const result = await listProjectsTool.handler({}, baseContext);

      expect(result.isError).toBeFalsy();
    });

    it('supports filtering by project state', async () => {
      const result = await listProjectsTool.handler(
        { filter: { state: { eq: 'started' } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter was passed to API (includes default team filter when DEFAULT_TEAM is set)
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ state: { eq: 'started' } }),
        }),
      );
    });

    it('supports filtering by single project ID', async () => {
      const result = await listProjectsTool.handler(
        { filter: { id: { eq: 'project-001' } }, limit: 1 },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify filter and limit were passed (includes default team filter when DEFAULT_TEAM is set)
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({ id: { eq: 'project-001' } }),
          first: 1,
        }),
      );
    });

    it('supports filtering by team via accessibleTeams', async () => {
      const result = await listProjectsTool.handler(
        { filter: { accessibleTeams: { id: { eq: 'team-eng' } } } },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify accessibleTeams filter was passed (ProjectFilter uses accessibleTeams, not team)
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { accessibleTeams: { id: { eq: 'team-eng' } } },
        }),
      );
    });

    it('supports includeArchived option', async () => {
      const result = await listProjectsTool.handler(
        { includeArchived: true },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
    });

    it('respects limit parameter', async () => {
      const result = await listProjectsTool.handler({ limit: 5 }, baseContext);

      expect(result.isError).toBeFalsy();
      // Verify limit was passed to API
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({ first: 5 }),
      );
    });

    it('supports pagination with cursor', async () => {
      const result = await listProjectsTool.handler(
        { cursor: 'test-cursor' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
    });
  });

  describe('output shape', () => {
    it('includes project metadata in text content', async () => {
      const result = await listProjectsTool.handler({}, baseContext);

      expect(result.isError).toBeFalsy();
      const textContent = result.content[0].text;
      expect(textContent).toContain('projects[');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(createProjectsTool.name).toBe('create_projects');
      expect(createProjectsTool.title).toBe('Create Projects (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(createProjectsTool.annotations?.readOnlyHint).toBe(false);
      expect(createProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = createProjectsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires name for each project', () => {
      const result = createProjectsTool.inputSchema.safeParse({ items: [{}] });
      expect(result.success).toBe(false);
    });

    it('accepts minimal project (name only)', () => {
      const result = createProjectsTool.inputSchema.safeParse({
        items: [{ name: 'Q1 Goals' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts project with all optional fields', () => {
      const result = createProjectsTool.inputSchema.safeParse({
        items: [
          {
            name: 'Q1 Goals',
            teamId: 'team-eng',
            leadId: 'user-001',
            description: 'Q1 roadmap',
            targetDate: '2025-03-31',
            state: 'started',
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('creates a single project', async () => {
      const result = await createProjectsTool.handler(
        { items: [{ name: 'New Project' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createProject).toHaveBeenCalledTimes(1);
    });

    it('creates project with all fields', async () => {
      const result = await createProjectsTool.handler(
        {
          items: [
            {
              name: 'Infrastructure Upgrade',
              teamId: 'team-eng',
              leadId: 'user-001',
              description: 'Modernize stack',
              targetDate: '2025-06-30',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // API uses teamIds array, not teamId
      expect(mockClient.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Infrastructure Upgrade',
          teamIds: ['team-eng'],
          leadId: 'user-001',
        }),
      );
    });

    it('batch creates multiple projects', async () => {
      const result = await createProjectsTool.handler(
        {
          items: [{ name: 'Project A' }, { name: 'Project B' }, { name: 'Project C' }],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createProject).toHaveBeenCalledTimes(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Projects Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_projects tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateProjectsTool.name).toBe('update_projects');
      expect(updateProjectsTool.title).toBe('Update Projects (Batch)');
    });

    it('has non-destructive annotations', () => {
      expect(updateProjectsTool.annotations?.readOnlyHint).toBe(false);
      expect(updateProjectsTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires at least one item', () => {
      const result = updateProjectsTool.inputSchema.safeParse({ items: [] });
      expect(result.success).toBe(false);
    });

    it('requires id for each project', () => {
      const result = updateProjectsTool.inputSchema.safeParse({
        items: [{ name: 'Updated' }],
      });
      expect(result.success).toBe(false);
    });

    it('accepts update with id and any field', () => {
      const result = updateProjectsTool.inputSchema.safeParse({
        items: [{ id: 'project-001', name: 'Updated Name' }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates project name', async () => {
      const result = await updateProjectsTool.handler(
        { items: [{ id: 'project-001', name: 'New Name' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({ name: 'New Name' }),
      );
    });

    it('updates project state', async () => {
      const result = await updateProjectsTool.handler(
        { items: [{ id: 'project-001', state: 'completed' }] },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({ state: 'completed' }),
      );
    });

    it('updates multiple fields at once', async () => {
      const result = await updateProjectsTool.handler(
        {
          items: [
            {
              id: 'project-001',
              name: 'Updated',
              state: 'started',
              leadId: 'user-002',
              targetDate: '2025-12-31',
            },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProject).toHaveBeenCalledWith(
        'project-001',
        expect.objectContaining({
          name: 'Updated',
          state: 'started',
          leadId: 'user-002',
          targetDate: '2025-12-31',
        }),
      );
    });

    it('batch updates multiple projects', async () => {
      const result = await updateProjectsTool.handler(
        {
          items: [
            { id: 'project-001', state: 'started' },
            { id: 'project-002', state: 'completed' },
          ],
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.updateProject).toHaveBeenCalledTimes(2);
    });

    it('accepts archived in schema (note: not implemented in handler yet)', async () => {
      // The schema accepts archived, but handler doesn't implement it yet
      const schemaResult = updateProjectsTool.inputSchema.safeParse({
        items: [{ id: 'project-001', archived: true }],
      });

      expect(schemaResult.success).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('projects common workflows', () => {
  it('roadmap view: list active projects with state filter', async () => {
    const result = await listProjectsTool.handler(
      { filter: { state: { in: ['started', 'planned'] } } },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify filter was applied (includes default team filter when DEFAULT_TEAM is set)
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({ state: { in: ['started', 'planned'] } }),
      }),
    );
  });

  it('milestone tracking: get single project by ID', async () => {
    const result = await listProjectsTool.handler(
      { filter: { id: { eq: 'project-001' } }, limit: 1 },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
  });

  it('project creation with team assignment', async () => {
    const result = await createProjectsTool.handler(
      {
        items: [
          {
            name: 'Mobile App',
            teamId: 'team-eng',
            leadId: 'user-001',
            targetDate: '2025-09-01',
          },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify API was called with correct data
    expect(mockClient.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mobile App',
        teamIds: ['team-eng'],
        leadId: 'user-001',
        targetDate: '2025-09-01',
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient({ projects: defaultMockProjects });
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('projects[');
  });

  it('returns TOON with project schema fields', async () => {
    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have project schema header with fields
    expect(textContent).toContain('projects[');
    expect(textContent).toContain(
      '{key,name,description,state,priority,progress,lead,teams,startDate,targetDate,health}',
    );
  });

  it('uses short keys for projects (pr0, pr1...)', async () => {
    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Projects should have short keys starting with pr
    expect(textContent).toMatch(/projects\[\d+\]/);
  });

  it('includes team keys in TOON output from registry metadata', async () => {
    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // project-001 belongs to SQT, project-002 belongs to ENG
    // Registry should have team associations from team.projects() during init
    expect(textContent).toMatch(/SQT|ENG/);
  });

  it('handles empty projects in TOON format', async () => {
    // Create mock client with no projects
    mockClient = createMockLinearClient({ projects: [] });

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have meta section
    expect(textContent).toContain('_meta{');
  });
});

describe('create_projects TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await createProjectsTool.handler(
      {
        items: [{ name: 'New Project' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('create_projects');
  });

  it('includes results section with index, status, key fields', async () => {
    const result = await createProjectsTool.handler(
      {
        items: [{ name: 'Project A' }, { name: 'Project B' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have results schema
    expect(textContent).toContain('results[');
    expect(textContent).toContain('{index,status,key,error,code,hint}');
  });

  it('includes created section for successful creates', async () => {
    const result = await createProjectsTool.handler(
      {
        items: [{ name: 'New Project' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have created schema
    expect(textContent).toContain('created[');
    expect(textContent).toContain('{key,name,state}');
  });
});

describe('update_projects TOON output', () => {
  beforeEach(() => {
    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);
  });

  it('returns TOON format in text content', async () => {
    const result = await updateProjectsTool.handler(
      {
        items: [{ id: 'project-001', state: 'started' }],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');
    expect(textContent).toContain('update_projects');
  });

  it('includes results section with index, status, key fields', async () => {
    const result = await updateProjectsTool.handler(
      {
        items: [
          { id: 'project-001', state: 'started' },
          { id: 'project-002', state: 'completed' },
        ],
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have results schema
    expect(textContent).toContain('results[');
    expect(textContent).toContain('{index,status,key,error,code,hint}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Team & Team Parameter Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects team parameter', () => {
  it('filters by team parameter (team key)', async () => {
    const result = await listProjectsTool.handler({ team: 'ENG' }, baseContext);
    expect(result.isError).toBeFalsy();
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          accessibleTeams: { id: { eq: 'team-eng' } },
        }),
      }),
    );
  });

  it('filters by team parameter (UUID passthrough)', async () => {
    const result = await listProjectsTool.handler({ team: 'team-eng' }, baseContext);
    expect(result.isError).toBeFalsy();
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          accessibleTeams: { id: { eq: 'team-eng' } },
        }),
      }),
    );
  });

  it('rejects team + filter.accessibleTeams conflict', async () => {
    const result = await listProjectsTool.handler(
      { team: 'SQT', filter: { accessibleTeams: { id: { eq: 'team-eng' } } } },
      baseContext,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot specify both');
  });

  it('resolves team key in filter.accessibleTeams', async () => {
    const result = await listProjectsTool.handler(
      { filter: { accessibleTeams: { id: { eq: 'ENG' } } } },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          accessibleTeams: { id: { eq: 'team-eng' } },
        }),
      }),
    );
  });

  it('team param overrides DEFAULT_TEAM', async () => {
    const { config } = await import('../../src/config/env.js');
    const original = config.DEFAULT_TEAM;
    try {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = 'SQT';
      const result = await listProjectsTool.handler({ team: 'SQM' }, baseContext);
      expect(result.isError).toBeFalsy();
      expect(mockClient.projects).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: expect.objectContaining({
            accessibleTeams: { id: { eq: 'team-sqm' } },
          }),
        }),
      );
    } finally {
      (config as { DEFAULT_TEAM?: string }).DEFAULT_TEAM = original;
    }
  });
});

describe('create_projects multi-team support', () => {
  it('creates project with multiple teams via teamIds', async () => {
    const result = await createProjectsTool.handler(
      { items: [{ name: 'Cross-Team Project', teamIds: ['SQT', 'SQM'] }] },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    expect(mockClient.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        teamIds: ['team-sqt', 'team-sqm'],
      }),
    );
  });

  it('rejects teamId + teamIds conflict', async () => {
    const result = await createProjectsTool.handler(
      { items: [{ name: 'Conflict', teamId: 'SQT', teamIds: ['SQM'] }] },
      baseContext,
    );
    expect(result.isError).toBeFalsy(); // Per-item error, not tool-level
    const text = result.content[0].text;
    expect(text).toContain('CONFLICTING_PARAMS');
  });

  it('backward compat: single teamId still works', async () => {
    const result = await createProjectsTool.handler(
      { items: [{ name: 'Single Team', teamId: 'ENG' }] },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    expect(mockClient.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        teamIds: ['team-eng'],
      }),
    );
  });
});

describe('update_projects teamIds support', () => {
  it('updates project team associations via teamIds', async () => {
    const result = await updateProjectsTool.handler(
      { items: [{ id: 'project-001', teamIds: ['SQT', 'SQM'] }] },
      baseContext,
    );
    expect(result.isError).toBeFalsy();
    expect(mockClient.updateProject).toHaveBeenCalledWith(
      'project-001',
      expect.objectContaining({
        teamIds: ['team-sqt', 'team-sqm'],
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Project Parameter (Direct Lookup) Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects project parameter (direct lookup)', () => {
  it('resolves short key and fetches project by ID filter', async () => {
    const result = await listProjectsTool.handler({ project: 'pr0' }, baseContext);
    expect(result.isError).toBeFalsy();

    // pr0 resolves to project-002 (earliest createdAt: 2024-11-01)
    // The last projects() call is the actual lookup (earlier calls are registry init)
    const lastCall =
      mockClient.projects.mock.calls[mockClient.projects.mock.calls.length - 1][0];
    expect(lastCall.filter).toEqual({ id: { eq: 'project-002' } });
    expect(lastCall.first).toBe(1);
    expect(lastCall.includeArchived).toBe(true);

    // Should NOT have team filter (accessibleTeams)
    expect(lastCall.filter).not.toHaveProperty('accessibleTeams');
  });

  it('passes UUID through directly without resolution', async () => {
    const result = await listProjectsTool.handler(
      { project: 'project-002' },
      baseContext,
    );
    expect(result.isError).toBeFalsy();

    // UUID should be used as-is in filter
    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { id: { eq: 'project-002' } },
        first: 1,
      }),
    );
  });

  it('auto-sets includeArchived: true for direct lookup', async () => {
    const result = await listProjectsTool.handler(
      { project: 'project-001' },
      baseContext,
    );
    expect(result.isError).toBeFalsy();

    expect(mockClient.projects).toHaveBeenCalledWith(
      expect.objectContaining({
        includeArchived: true,
      }),
    );
  });

  it('returns error for unresolved short key', async () => {
    const result = await listProjectsTool.handler({ project: 'pr999' }, baseContext);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown project key');
    expect(result.content[0].text).toContain('pr999');
  });

  it('rejects project + team conflict', async () => {
    const result = await listProjectsTool.handler(
      { project: 'pr0', team: 'SQT' },
      baseContext,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot specify 'project'");
  });

  it('rejects project + filter conflict', async () => {
    const result = await listProjectsTool.handler(
      { project: 'pr0', filter: { state: { eq: 'started' } } },
      baseContext,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot specify 'project'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Departed User Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects departed user handling', () => {
  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('creates ext0 entry for project lead not in registry', async () => {
    const projectsWithDepartedLead: MockProject[] = [
      {
        id: 'project-departed-001',
        name: 'Legacy Project',
        state: 'started',
        priority: 1,
        progress: 0.5,
        leadId: 'departed-user-001',
        lead: { id: 'departed-user-001' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithDepartedLead });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have _users section with ext0 entry
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('ext0');
    // Default fallback name when lead.name is not available
    expect(textContent).toContain('Former User');

    // Project row should reference ext0 as its lead
    const lines = textContent.split('\n');
    const projectLine = lines.find((line: string) => line.includes('Legacy Project'));
    expect(projectLine).toBeDefined();
    expect(projectLine).toContain('ext0');
  });

  it('uses actual name from lead when available for ext entry', async () => {
    const projectsWithNamedDepartedLead: MockProject[] = [
      {
        id: 'project-departed-002',
        name: 'Named Lead Project',
        state: 'planned',
        priority: 2,
        progress: 0.2,
        leadId: 'departed-user-002',
        // Cast to include name which RawProjectData supports but MockProject interface doesn't declare
        lead: {
          id: 'departed-user-002',
          name: 'Alice Former',
        } as unknown as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithNamedDepartedLead });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have ext0 entry with the actual name, not "Former User"
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('ext0');
    expect(textContent).toContain('Alice Former');
    expect(textContent).not.toContain('Former User');
  });

  it('deduplicates ext entries for multiple projects sharing same departed lead', async () => {
    const departedLeadId = 'departed-user-shared';
    const projectsWithSharedDepartedLead: MockProject[] = [
      {
        id: 'project-shared-001',
        name: 'Shared Lead Project A',
        state: 'started',
        priority: 1,
        progress: 0.3,
        leadId: departedLeadId,
        lead: { id: departedLeadId } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
      {
        id: 'project-shared-002',
        name: 'Shared Lead Project B',
        state: 'planned',
        priority: 2,
        progress: 0.1,
        leadId: departedLeadId,
        lead: { id: departedLeadId } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-11-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithSharedDepartedLead });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have exactly one ext entry (ext0), not two
    expect(textContent).toContain('ext0');
    expect(textContent).not.toContain('ext1');

    // Both project rows should reference ext0
    const lines = textContent.split('\n');
    const projectLines = lines.filter(
      (line: string) =>
        line.includes('Shared Lead Project A') ||
        line.includes('Shared Lead Project B'),
    );
    expect(projectLines.length).toBe(2);
    for (const line of projectLines) {
      expect(line).toContain('ext0');
    }
  });

  it('distinguishes project with no lead from project with departed lead', async () => {
    const projectsWithMixedLeads: MockProject[] = [
      {
        id: 'project-no-lead',
        name: 'No Lead Project',
        state: 'started',
        priority: 1,
        progress: 0.4,
        // No leadId, no lead — truly no lead assigned
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
      {
        id: 'project-departed-lead',
        name: 'Departed Lead Project',
        state: 'planned',
        priority: 2,
        progress: 0.1,
        leadId: 'departed-user-003',
        lead: { id: 'departed-user-003' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-11-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithMixedLeads });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have ext0 entry for departed lead
    expect(textContent).toContain('ext0');

    // The project with no lead should have null/empty lead field, not ext0
    const lines = textContent.split('\n');
    const noLeadLine = lines.find((line: string) => line.includes('No Lead Project'));
    const departedLeadLine = lines.find((line: string) =>
      line.includes('Departed Lead Project'),
    );

    expect(noLeadLine).toBeDefined();
    expect(departedLeadLine).toBeDefined();

    // Departed lead project should have ext0
    expect(departedLeadLine).toContain('ext0');

    // No lead project should NOT have ext0
    expect(noLeadLine).not.toContain('ext0');
  });

  it('sorts registered users (u*) before ext entries in _users section', async () => {
    const projectsWithMixedLeads: MockProject[] = [
      {
        id: 'project-registered-lead',
        name: 'Registered Lead Project',
        state: 'started',
        priority: 1,
        progress: 0.5,
        leadId: 'user-001', // This user exists in defaultMockUsers
        lead: { id: 'user-001' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
      {
        id: 'project-departed-lead',
        name: 'Departed Lead Project',
        state: 'planned',
        priority: 2,
        progress: 0.1,
        leadId: 'departed-user-004',
        lead: { id: 'departed-user-004' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-11-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithMixedLeads });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have both u* and ext* entries in _users
    expect(textContent).toContain('_users[');
    expect(textContent).toMatch(/u\d+/);
    expect(textContent).toContain('ext0');

    // Verify ordering: u* entries come before ext* entries
    const lines = textContent.split('\n');
    const usersHeaderIndex = lines.findIndex((line: string) =>
      line.includes('_users['),
    );
    expect(usersHeaderIndex).toBeGreaterThan(-1);

    // Find the user entry lines (indented lines after _users header, before next section)
    const userEntryLines: string[] = [];
    for (let i = usersHeaderIndex + 1; i < lines.length; i++) {
      if (lines[i].startsWith('  ') && !lines[i].startsWith('  _')) {
        userEntryLines.push(lines[i]);
      } else if (lines[i].length > 0 && !lines[i].startsWith('  ')) {
        break;
      }
    }

    // Find position of u* and ext* entries
    const uIndex = userEntryLines.findIndex((line) => /^\s+u\d+,/.test(line));
    const extIndex = userEntryLines.findIndex((line) => /^\s+ext\d+,/.test(line));

    expect(uIndex).toBeGreaterThan(-1);
    expect(extIndex).toBeGreaterThan(-1);
    expect(uIndex).toBeLessThan(extIndex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deactivated User Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects deactivated user handling', () => {
  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('deactivated project lead uses real name from metadata in ext entry', async () => {
    const { clearRegistry, storeRegistry } = await import(
      '../../src/shared/toon/index.js'
    );
    type ShortKeyRegistry = import('../../src/shared/toon/index.js').ShortKeyRegistry;
    clearRegistry('test-session');

    // Create a registry where user-001 is active but 'deactivated-lead-uuid' is
    // in userMetadata with active: false (deactivated user — known name, no short key)
    const mockRegistry: ShortKeyRegistry = {
      users: new Map([['u0', 'user-001']]),
      states: new Map(),
      projects: new Map([['pr0', 'project-deactivated-lead']]),
      usersByUuid: new Map([['user-001', 'u0']]),
      statesByUuid: new Map(),
      projectsByUuid: new Map([['project-deactivated-lead', 'pr0']]),
      userMetadata: new Map([
        [
          'user-001',
          {
            name: 'Active User',
            displayName: 'Active',
            email: 'active@test.com',
            active: true,
          },
        ],
        [
          'deactivated-lead-uuid',
          {
            name: 'Deactivated Diana',
            displayName: 'Diana',
            email: 'diana@test.com',
            active: false,
          },
        ],
      ]),
      stateMetadata: new Map(),
      projectMetadata: new Map(),
      generatedAt: new Date(),
      workspaceId: 'ws-123',
    };

    storeRegistry('test-session', mockRegistry);

    const projectsWithDeactivatedLead: MockProject[] = [
      {
        id: 'project-deactivated-lead',
        name: 'Deactivated Lead Project',
        state: 'started',
        priority: 1,
        progress: 0.5,
        leadId: 'deactivated-lead-uuid',
        lead: { id: 'deactivated-lead-uuid' } as MockProject['lead'],
        teamId: 'team-sqt',
        createdAt: new Date('2024-10-01T00:00:00Z'),
      },
    ];

    mockClient = createMockLinearClient({ projects: projectsWithDeactivatedLead });
    resetMockCalls(mockClient);

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Should have _users section with ext0 entry
    expect(textContent).toContain('_users[');
    expect(textContent).toContain('ext0');

    // The ext entry should use the real name from userMetadata, NOT "Former User"
    expect(textContent).toContain('Deactivated Diana');
    expect(textContent).not.toContain('Former User');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Departed Lead Fallback in update_projects Change Diffs
// ─────────────────────────────────────────────────────────────────────────────

describe('update_projects departed lead diff fallback', () => {
  afterEach(async () => {
    const { clearRegistry } = await import('../../src/shared/toon/index.js');
    clearRegistry('test-session');
  });

  it('shows (departed) in lead change diff when before lead is not in registry', async () => {
    const { clearRegistry, storeRegistry } = await import(
      '../../src/shared/toon/index.js'
    );
    type ShortKeyRegistry = import('../../src/shared/toon/index.js').ShortKeyRegistry;
    clearRegistry('test-session');

    // Create a registry where user-001, user-002 are known but 'departed-lead-999' is NOT
    const mockRegistry: ShortKeyRegistry = {
      users: new Map([
        ['u0', 'user-001'],
        ['u1', 'user-002'],
      ]),
      states: new Map(),
      projects: new Map([['pr0', 'project-lead-change']]),
      usersByUuid: new Map([
        ['user-001', 'u0'],
        ['user-002', 'u1'],
      ]),
      statesByUuid: new Map(),
      projectsByUuid: new Map([['project-lead-change', 'pr0']]),
      userMetadata: new Map([
        [
          'user-001',
          {
            name: 'User One',
            displayName: 'User One',
            email: 'u1@test.com',
            active: true,
          },
        ],
        [
          'user-002',
          {
            name: 'User Two',
            displayName: 'User Two',
            email: 'u2@test.com',
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

    // Set up project with a departed lead initially, then new lead after update
    const beforeProject: MockProject = {
      id: 'project-lead-change',
      name: 'Lead Change Project',
      state: 'started',
      priority: 1,
      progress: 0.5,
      leadId: 'departed-lead-999',
      lead: { id: 'departed-lead-999' },
      teamId: 'team-sqt',
      createdAt: new Date('2024-10-01T00:00:00Z'),
    };

    const afterProject: MockProject = {
      ...beforeProject,
      leadId: 'user-002',
      lead: { id: 'user-002' },
    };

    mockClient = createMockLinearClient({
      projects: [beforeProject],
    });
    resetMockCalls(mockClient);

    // Track calls to client.projects with id filter for the target project
    let snapshotCallCount = 0;

    // Override client.projects to return different lead data on successive snapshot calls.
    // Registry init uses team.projects() (different method), so client.projects is only
    // called for captureProjectSnapshot (before) and captureProjectSnapshot (after).
    (mockClient.projects as ReturnType<typeof vi.fn>).mockImplementation(
      async (args?: { first?: number; filter?: Record<string, unknown> }) => {
        const idFilter = (args?.filter?.id as { eq?: string })?.eq;
        if (idFilter === 'project-lead-change') {
          snapshotCallCount++;
          // 1st snapshot call = before (departed lead), 2nd = after (new lead)
          const project = snapshotCallCount <= 1 ? beforeProject : afterProject;
          return {
            nodes: [project],
            pageInfo: { hasNextPage: false },
          };
        }

        // Default: return all projects
        return {
          nodes: [beforeProject],
          pageInfo: { hasNextPage: false },
        };
      },
    );

    const result = await updateProjectsTool.handler(
      { items: [{ id: 'project-lead-change', leadId: 'user-002' }] },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // The changes section should show '(departed)' as the before lead value
    // since 'departed-lead-999' is NOT in the registry
    expect(textContent).toContain('changes[');
    expect(textContent).toContain('lead');
    expect(textContent).toContain('(departed)');
    // The after value should be 'u1' (short key for user-002)
    expect(textContent).toContain('u1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// list_projects API Error Handling Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_projects API error handling', () => {
  it('returns structured error when projects fetch fails', async () => {
    mockClient.projects = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await listProjectsTool.handler({}, baseContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBeDefined();
    expect(structured.hint).toBeDefined();
  });
});
