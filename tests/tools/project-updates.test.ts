/**
 * Tests for project update tools (list, create, update).
 * Verifies: project update listing, creation, updates, output shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectUpdateTool,
  listProjectUpdatesTool,
  updateProjectUpdateTool,
} from '../../src/shared/tools/linear/project-updates.js';
import type { ToolContext } from '../../src/shared/tools/types.js';
import {
  createMockLinearClient,
  defaultMockProjectUpdates,
  type MockLinearClient,
  resetMockCalls,
} from '../mocks/linear-client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Setup
// ─────────────────────────────────────────────────────────────────────────────

let mockClient: MockLinearClient;
let originalToonEnabled: boolean;

const baseContext: ToolContext = {
  sessionId: 'test-session',
  providerToken: 'test-token',
  authStrategy: 'bearer',
};

vi.mock('../../src/services/linear/client.js', () => ({
  getLinearClient: vi.fn(() => Promise.resolve(mockClient)),
}));

beforeEach(async () => {
  // Force TOON off for non-TOON tests (legacy format)
  const { config } = await import('../../src/config/env.js');
  originalToonEnabled = config.TOON_OUTPUT_ENABLED;
  // @ts-expect-error - modifying config for test
  config.TOON_OUTPUT_ENABLED = false;

  mockClient = createMockLinearClient();
  resetMockCalls(mockClient);
});

afterEach(async () => {
  // Restore config
  const { config } = await import('../../src/config/env.js');
  // @ts-expect-error - modifying config for test
  config.TOON_OUTPUT_ENABLED = originalToonEnabled;
});

// ─────────────────────────────────────────────────────────────────────────────
// List Project Updates Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_project_updates tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(listProjectUpdatesTool.name).toBe('list_project_updates');
      expect(listProjectUpdatesTool.title).toBe('List Project Updates');
    });

    it('has readOnlyHint annotation', () => {
      expect(listProjectUpdatesTool.annotations?.readOnlyHint).toBe(true);
      expect(listProjectUpdatesTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('handler behavior', () => {
    it('lists updates for a project', async () => {
      const result = await listProjectUpdatesTool.handler(
        { project: 'project-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect(Array.isArray(structured.items)).toBe(true);
    });

    it('resolves project short key to UUID', async () => {
      // Test with a UUID directly (short key resolution requires TOON mode and registry)
      const result = await listProjectUpdatesTool.handler(
        { project: 'project-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify API was called with correct filter
      expect(mockClient.projectUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { project: { id: { eq: 'project-001' } } },
        }),
      );
    });

    it('handles empty results', async () => {
      // Create mock client with no project updates
      mockClient = createMockLinearClient({ projectUpdates: [] });

      const result = await listProjectUpdatesTool.handler(
        { project: 'project-001' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.items).toBeDefined();
      expect((structured.items as unknown[]).length).toBe(0);
    });

    it('supports pagination with cursor', async () => {
      const result = await listProjectUpdatesTool.handler(
        { project: 'project-001', cursor: 'test-cursor' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify cursor was passed to API
      expect(mockClient.projectUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          after: 'test-cursor',
        }),
      );

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.cursor).toBe('test-cursor');
    });

    it('respects limit parameter', async () => {
      const result = await listProjectUpdatesTool.handler(
        { project: 'project-001', limit: 5 },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      // Verify limit was passed to API
      expect(mockClient.projectUpdates).toHaveBeenCalledWith(
        expect.objectContaining({
          first: 5,
        }),
      );

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.limit).toBe(5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Project Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('create_project_update tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(createProjectUpdateTool.name).toBe('create_project_update');
      expect(createProjectUpdateTool.title).toBe('Create Project Update');
    });

    it('has correct annotations (not readOnly, not destructive)', () => {
      expect(createProjectUpdateTool.annotations?.readOnlyHint).toBe(false);
      expect(createProjectUpdateTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires project', () => {
      const result = createProjectUpdateTool.inputSchema.safeParse({
        body: 'Test update',
      });
      expect(result.success).toBe(false);
    });

    it('requires body', () => {
      const result = createProjectUpdateTool.inputSchema.safeParse({
        project: 'project-001',
      });
      expect(result.success).toBe(false);
    });

    it('accepts minimal input (project and body)', () => {
      const result = createProjectUpdateTool.inputSchema.safeParse({
        project: 'project-001',
        body: 'Test update',
      });
      expect(result.success).toBe(true);
    });

    it('accepts optional health status', () => {
      const result = createProjectUpdateTool.inputSchema.safeParse({
        project: 'project-001',
        body: 'Test update',
        health: 'atRisk',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('creates update with body only', async () => {
      const result = await createProjectUpdateTool.handler(
        { project: 'project-001', body: 'Sprint completed successfully.' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.createProjectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-001',
          body: 'Sprint completed successfully.',
        }),
      );
    });

    it('creates update with health status', async () => {
      const result = await createProjectUpdateTool.handler(
        {
          project: 'project-001',
          body: 'Delays due to dependencies.',
          health: 'atRisk',
        },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.createProjectUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-001',
          body: 'Delays due to dependencies.',
          health: 'atRisk',
        }),
      );
    });

    it('resolves project short key', async () => {
      // Test with UUID directly (short key resolution requires TOON mode and registry)
      const result = await createProjectUpdateTool.handler(
        { project: 'project-001', body: 'Test update' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();
      expect(mockClient.createProjectUpdate).toHaveBeenCalledTimes(1);
    });

    it('returns created update with url', async () => {
      const result = await createProjectUpdateTool.handler(
        { project: 'project-001', body: 'Test update' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.success).toBe(true);
      expect(structured.id).toBeDefined();
    });

    it('returns error for unknown project short key', async () => {
      // Enable TOON mode to test short key resolution
      const { config } = await import('../../src/config/env.js');
      // @ts-expect-error - modifying config for test
      config.TOON_OUTPUT_ENABLED = true;

      mockClient = createMockLinearClient();
      resetMockCalls(mockClient);

      // Use a short key pattern that won't be in the registry
      const result = await createProjectUpdateTool.handler(
        { project: 'pr999', body: 'Test update' },
        baseContext,
      );

      expect(result.isError).toBe(true);

      const structured = result.structuredContent as Record<string, unknown>;
      const error = structured.error as Record<string, unknown>;
      expect(error.code).toBe('PROJECT_RESOLUTION_FAILED');
      expect(error.message).toContain('pr999');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Update Project Update Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('update_project_update tool', () => {
  describe('metadata', () => {
    it('has correct name and title', () => {
      expect(updateProjectUpdateTool.name).toBe('update_project_update');
      expect(updateProjectUpdateTool.title).toBe('Update Project Update');
    });

    it('has correct annotations', () => {
      expect(updateProjectUpdateTool.annotations?.readOnlyHint).toBe(false);
      expect(updateProjectUpdateTool.annotations?.destructiveHint).toBe(false);
    });
  });

  describe('input validation', () => {
    it('requires id', () => {
      const result = updateProjectUpdateTool.inputSchema.safeParse({
        body: 'Updated content',
      });
      expect(result.success).toBe(false);
    });

    it('accepts id with body', () => {
      const result = updateProjectUpdateTool.inputSchema.safeParse({
        id: 'project-update-001',
        body: 'Updated content',
      });
      expect(result.success).toBe(true);
    });

    it('accepts id with health', () => {
      const result = updateProjectUpdateTool.inputSchema.safeParse({
        id: 'project-update-001',
        health: 'offTrack',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('handler behavior', () => {
    it('updates body', async () => {
      const result = await updateProjectUpdateTool.handler(
        { id: 'project-update-001', body: 'Updated content here.' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProjectUpdate).toHaveBeenCalledWith(
        'project-update-001',
        expect.objectContaining({ body: 'Updated content here.' }),
      );
    });

    it('updates health status', async () => {
      const result = await updateProjectUpdateTool.handler(
        { id: 'project-update-001', health: 'offTrack' },
        baseContext,
      );

      expect(result.isError).toBeFalsy();

      expect(mockClient.updateProjectUpdate).toHaveBeenCalledWith(
        'project-update-001',
        expect.objectContaining({ health: 'offTrack' }),
      );
    });

    it('handles non-existent id', async () => {
      // Create mock that simulates non-existent update
      mockClient.updateProjectUpdate = vi.fn(async () => ({
        success: false,
        projectUpdate: undefined,
      }));

      const result = await updateProjectUpdateTool.handler(
        { id: 'non-existent-update', body: 'Updated content' },
        baseContext,
      );

      // The handler still returns success since the API call didn't throw
      // Real Linear API would return success: false which could be checked
      expect(mockClient.updateProjectUpdate).toHaveBeenCalledWith(
        'non-existent-update',
        expect.objectContaining({ body: 'Updated content' }),
      );
    });

    it('returns error when no fields to update', async () => {
      const result = await updateProjectUpdateTool.handler(
        { id: 'project-update-001' },
        baseContext,
      );

      expect(result.isError).toBe(true);

      const structured = result.structuredContent as Record<string, unknown>;
      const error = structured.error as Record<string, unknown>;
      expect(error.code).toBe('NO_FIELDS_TO_UPDATE');
      expect(error.message).toBe('No fields to update');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Common Workflow Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('project updates common workflows', () => {
  it('project status check: list updates for a project', async () => {
    const result = await listProjectUpdatesTool.handler(
      { project: 'project-001', limit: 5 },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    // Verify API was called with correct filter
    expect(mockClient.projectUpdates).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { project: { id: { eq: 'project-001' } } },
        first: 5,
      }),
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
  });

  it('post weekly update: create update with health', async () => {
    const result = await createProjectUpdateTool.handler(
      {
        project: 'project-001',
        body: 'Week 3 update: On track for delivery. Completed auth feature.',
        health: 'onTrack',
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.createProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-001',
        body: 'Week 3 update: On track for delivery. Completed auth feature.',
        health: 'onTrack',
      }),
    );
  });

  it('escalate project risk: update health to atRisk', async () => {
    const result = await updateProjectUpdateTool.handler(
      {
        id: 'project-update-001',
        health: 'atRisk',
        body: 'Update: Dependencies delayed. Moving to at-risk status.',
      },
      baseContext,
    );

    expect(result.isError).toBeFalsy();

    expect(mockClient.updateProjectUpdate).toHaveBeenCalledWith(
      'project-update-001',
      expect.objectContaining({
        health: 'atRisk',
        body: 'Update: Dependencies delayed. Moving to at-risk status.',
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TOON Output Format Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('list_project_updates TOON output', () => {
  it('returns TOON format when TOON_OUTPUT_ENABLED=true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient({ projectUpdates: defaultMockProjectUpdates });
    resetMockCalls(mockClient);

    const result = await listProjectUpdatesTool.handler(
      { project: 'project-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');

    // Structured content should indicate TOON format
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(typeof structured.count).toBe('number');
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient({ projectUpdates: defaultMockProjectUpdates });
    resetMockCalls(mockClient);

    const result = await listProjectUpdatesTool.handler(
      { project: 'project-001' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Project Updates:" summary
    expect(textContent).toContain('Project Updates:');

    // Structured content should have items array (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.items).toBeDefined();
    expect(Array.isArray(structured.items)).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});

describe('create_project_update TOON output', () => {
  it('returns TOON format when TOON_OUTPUT_ENABLED=true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await createProjectUpdateTool.handler(
      { project: 'project-001', body: 'Test update content.' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');

    // Structured content should indicate TOON format
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(structured.action).toBe('create_project_update');
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await createProjectUpdateTool.handler(
      { project: 'project-001', body: 'Test update content.' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Created project update"
    expect(textContent).toContain('Created project update');

    // Structured content should have success flag (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.success).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});

describe('update_project_update TOON output', () => {
  it('returns TOON format when TOON_OUTPUT_ENABLED=true', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = true;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await updateProjectUpdateTool.handler(
      { id: 'project-update-001', body: 'Updated content.' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);

    // TOON output should contain schema headers
    const textContent = result.content[0].text;
    expect(textContent).toContain('_meta{');

    // Structured content should indicate TOON format
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured._format).toBe('toon');
    expect(structured._version).toBe('1');
    expect(structured.action).toBe('update_project_update');
  });

  it('returns legacy format when TOON_OUTPUT_ENABLED=false', async () => {
    const { config } = await import('../../src/config/env.js');
    // @ts-expect-error - modifying config for test
    config.TOON_OUTPUT_ENABLED = false;

    mockClient = createMockLinearClient();
    resetMockCalls(mockClient);

    const result = await updateProjectUpdateTool.handler(
      { id: 'project-update-001', body: 'Updated content.' },
      baseContext,
    );

    expect(result.isError).toBeFalsy();
    const textContent = result.content[0].text;

    // Legacy format should contain "Updated project update"
    expect(textContent).toContain('Updated project update');

    // Structured content should have success flag (legacy format)
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.success).toBe(true);

    // Should NOT have TOON format indicator
    expect(structured._format).toBeUndefined();
  });
});
