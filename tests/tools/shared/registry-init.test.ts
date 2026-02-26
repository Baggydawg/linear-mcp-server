/**
 * Tests for the shared registry initialization functions.
 *
 * Verifies that fetchGlobalProjects() correctly paginates through
 * all projects in large workspaces and handles edge cases.
 */

import { describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mock the config module before importing the function under test
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../src/config/env.js', () => ({
  config: { DEFAULT_TEAM: undefined },
}));

vi.mock('../../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(),
}));

import { fetchGlobalProjects } from '../../../src/shared/tools/shared/registry-init.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Create N mock projects with sequential IDs and createdAt dates */
function createMockProjects(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `project-${i}`,
    createdAt: new Date(2025, 0, 1 + i),
    name: `Project ${i}`,
    state: 'started',
    priority: 1,
    progress: 0.5,
    leadId: `user-0`,
    targetDate: '2026-06-01',
  }));
}

/**
 * Create a mock Linear client whose projects() method supports
 * cursor-based pagination with a configurable page size.
 */
function createPaginatingClient(
  allProjects: ReturnType<typeof createMockProjects>,
  pageSize: number,
) {
  return {
    projects: vi.fn(
      async (args?: { first?: number; after?: string; includeArchived?: boolean }) => {
        const limit = args?.first ?? pageSize;
        const offset = args?.after
          ? parseInt(args.after.replace('cursor-', ''), 10) || 0
          : 0;
        const slice = allProjects.slice(offset, offset + limit);
        const hasMore = offset + limit < allProjects.length;
        return {
          nodes: slice,
          pageInfo: {
            hasNextPage: hasMore,
            endCursor: hasMore ? `cursor-${offset + limit}` : undefined,
          },
        };
      },
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('fetchGlobalProjects', () => {
  it('returns all projects when under one page', async () => {
    const projects = createMockProjects(50);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(50);
    expect(client.projects).toHaveBeenCalledTimes(1);
    expect(result[0].name).toBe('Project 0');
    expect(result[49].name).toBe('Project 49');
  });

  it('paginates through multiple pages to fetch all projects', async () => {
    const projects = createMockProjects(400);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(400);
    expect(client.projects).toHaveBeenCalledTimes(2);
    // First page: no cursor
    expect(client.projects).toHaveBeenNthCalledWith(1, {
      first: 250,
      includeArchived: true,
    });
    // Second page: with cursor
    expect(client.projects).toHaveBeenNthCalledWith(2, {
      first: 250,
      includeArchived: true,
      after: 'cursor-250',
    });
    // Verify no projects are missing or duplicated
    const ids = result.map((p) => p.id);
    expect(new Set(ids).size).toBe(400);
    expect(result[0].name).toBe('Project 0');
    expect(result[399].name).toBe('Project 399');
  });

  it('paginates through three pages', async () => {
    const projects = createMockProjects(600);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(600);
    expect(client.projects).toHaveBeenCalledTimes(3);
  });

  it('handles exactly 250 projects (boundary — no second page needed)', async () => {
    const projects = createMockProjects(250);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(250);
    expect(client.projects).toHaveBeenCalledTimes(1);
  });

  it('handles exactly 251 projects (boundary — needs second page)', async () => {
    const projects = createMockProjects(251);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(251);
    expect(client.projects).toHaveBeenCalledTimes(2);
  });

  it('stops at safety cap to prevent infinite loops', async () => {
    // Create a client that always claims there are more pages
    const infiniteClient = {
      projects: vi.fn(async (args?: { first?: number; after?: string }) => {
        const page = args?.after
          ? parseInt(args.after.replace('cursor-', ''), 10) / 250
          : 0;
        return {
          nodes: createMockProjects(250).map((p, i) => ({
            ...p,
            id: `project-${page * 250 + i}`,
            name: `Project ${page * 250 + i}`,
          })),
          pageInfo: {
            hasNextPage: true, // Always true — infinite pages
            endCursor: `cursor-${(page + 1) * 250}`,
          },
        };
      }),
    };

    const result = await fetchGlobalProjects(infiniteClient as never);

    // Should stop at MAX_PROJECT_PAGES (20) × 250 = 5,000
    expect(result).toHaveLength(20 * 250);
    expect(infiniteClient.projects).toHaveBeenCalledTimes(20);
  });

  it('maps all metadata fields correctly', async () => {
    const projects = createMockProjects(1);
    const client = createPaginatingClient(projects, 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'project-0',
      name: 'Project 0',
      state: 'started',
      priority: 1,
      progress: 0.5,
      leadId: 'user-0',
      targetDate: '2026-06-01',
    });
    expect(result[0].createdAt).toBeInstanceOf(Date);
  });

  it('handles empty workspace (no projects)', async () => {
    const client = createPaginatingClient([], 250);

    const result = await fetchGlobalProjects(client as never);

    expect(result).toHaveLength(0);
    expect(client.projects).toHaveBeenCalledTimes(1);
  });
});
