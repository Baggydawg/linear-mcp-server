/**
 * Tests for resolveProject() in src/utils/resolvers.ts.
 * Verifies: exact match, prefix match, substring suggestions, no-match, empty input.
 */

import { describe, expect, it } from 'vitest';
import { resolveProject } from '../../src/utils/resolvers.js';
import { createMockLinearClient } from '../mocks/linear-client.js';

// Mock projects available via createMockLinearClient().projects():
//   project-001: "Q1 Release"     (team-sqt)
//   project-002: "Infrastructure"  (team-eng)
//   project-003: "Q1 Planning"     (team-sqt)

describe('resolveProject', () => {
  const client = createMockLinearClient();

  it('resolves exact match (case-insensitive)', async () => {
    const result = await resolveProject(client as any, 'infrastructure');

    expect(result).toEqual({ success: true, value: 'project-002' });
  });

  it('resolves exact match with different casing', async () => {
    const result = await resolveProject(client as any, 'Q1 RELEASE');

    expect(result).toEqual({ success: true, value: 'project-001' });
  });

  it('auto-resolves single prefix match', async () => {
    // "Q1 R" matches only "Q1 Release" as a prefix (not "Q1 Planning")
    const result = await resolveProject(client as any, 'Q1 R');

    expect(result).toEqual({ success: true, value: 'project-001' });
  });

  it('returns error when multiple projects match prefix', async () => {
    // "Q1" is a prefix of both "Q1 Release" and "Q1 Planning"
    const result = await resolveProject(client as any, 'Q1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions![0]).toContain('Q1 Release');
      expect(result.suggestions![0]).toContain('Q1 Planning');
    }
  });

  it('returns error with suggestions for substring (non-prefix) match', async () => {
    // "structure" is a substring of "Infrastructure" but not a prefix
    const result = await resolveProject(client as any, 'structure');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions![0]).toContain('Infrastructure');
    }
  });

  it('returns error with generic hint when no match at all', async () => {
    const result = await resolveProject(client as any, 'Nonexistent Project');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('not found');
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions![0]).toContain('workspace_metadata');
    }
  });

  it('returns error for empty/whitespace input', async () => {
    const result = await resolveProject(client as any, '   ');

    expect(result).toEqual({
      success: false,
      error: 'Project name cannot be empty',
    });
  });
});
