/**
 * Tests for cross-team validation functions.
 *
 * These functions ensure that states and labels are applied only to issues
 * in teams where they are valid (preventing cross-team contamination).
 */

import { describe, expect, it } from 'vitest';
import {
  validateLabelBelongsToTeam,
  validateLabelKeyPrefix,
  validateStateBelongsToTeam,
  validateStateKeyPrefix,
} from '../../../src/shared/tools/linear/shared/validation.js';
import {
  buildRegistry,
  type RegistryBuildData,
  type ShortKeyRegistry,
} from '../../../src/shared/toon/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a multi-team registry with two teams (SQT and SQM).
 * SQT is the default team (gets clean state keys: s0, s1, etc.)
 * SQM is a secondary team (gets prefixed state keys: sqm:s0, sqm:s1, etc.)
 */
function createMultiTeamRegistry(): ShortKeyRegistry {
  const data: RegistryBuildData = {
    users: [
      {
        id: 'user-alice',
        createdAt: new Date('2024-01-01'),
        name: 'Alice',
        displayName: 'alice',
        email: 'alice@example.com',
        active: true,
      },
      {
        id: 'user-bob',
        createdAt: new Date('2024-01-02'),
        name: 'Bob',
        displayName: 'bob',
        email: 'bob@example.com',
        active: true,
      },
    ],
    states: [
      // SQT (default team) states
      {
        id: 'state-sqt-todo',
        teamId: 'team-sqt',
        name: 'Todo',
        type: 'unstarted',
        createdAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        id: 'state-sqt-inprogress',
        teamId: 'team-sqt',
        name: 'In Progress',
        type: 'started',
        createdAt: new Date('2024-01-01T01:00:00Z'),
      },
      {
        id: 'state-sqt-done',
        teamId: 'team-sqt',
        name: 'Done',
        type: 'completed',
        createdAt: new Date('2024-01-01T02:00:00Z'),
      },
      // SQM (secondary team) states
      {
        id: 'state-sqm-todo',
        teamId: 'team-sqm',
        name: 'Todo',
        type: 'unstarted',
        createdAt: new Date('2024-01-02T00:00:00Z'),
      },
      {
        id: 'state-sqm-inprogress',
        teamId: 'team-sqm',
        name: 'In Progress',
        type: 'started',
        createdAt: new Date('2024-01-02T01:00:00Z'),
      },
      {
        id: 'state-sqm-done',
        teamId: 'team-sqm',
        name: 'Done',
        type: 'completed',
        createdAt: new Date('2024-01-02T02:00:00Z'),
      },
    ],
    projects: [
      {
        id: 'project-alpha',
        createdAt: new Date('2024-01-01'),
        name: 'Project Alpha',
        state: 'started',
      },
    ],
    workspaceId: 'test-workspace',
    teams: [
      { id: 'team-sqt', key: 'SQT' },
      { id: 'team-sqm', key: 'SQM' },
    ],
    defaultTeamId: 'team-sqt',
  };

  return buildRegistry(data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validateStateBelongsToTeam
// ─────────────────────────────────────────────────────────────────────────────

describe('validateStateBelongsToTeam', () => {
  describe('valid cases', () => {
    it('returns valid when state belongs to target team (default team)', () => {
      const registry = createMultiTeamRegistry();

      // s0 resolves to state-sqt-todo which belongs to team-sqt
      const result = validateStateBelongsToTeam(
        's0',
        'state-sqt-todo',
        'team-sqt', // target team
        registry,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.suggestion).toBeUndefined();
    });

    it('returns valid when state belongs to target team (non-default team)', () => {
      const registry = createMultiTeamRegistry();

      // sqm:s0 resolves to state-sqm-todo which belongs to team-sqm
      const result = validateStateBelongsToTeam(
        'sqm:s0',
        'state-sqm-todo',
        'team-sqm', // target team
        registry,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid when state metadata is missing (lets API validate)', () => {
      const registry = createMultiTeamRegistry();

      // Test with a state ID that doesn't exist in metadata
      const result = validateStateBelongsToTeam(
        's99',
        'unknown-state-id',
        'team-sqt',
        registry,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid when state metadata has no teamId', () => {
      const registry = createMultiTeamRegistry();

      // Manually add a state without teamId
      registry.stateMetadata.set('state-no-team', {
        name: 'No Team State',
        type: 'unstarted',
        teamId: '', // Empty teamId
      });

      const result = validateStateBelongsToTeam(
        's99',
        'state-no-team',
        'team-sqt',
        registry,
      );

      // Empty string is falsy, so should return valid
      expect(result.valid).toBe(true);
    });
  });

  describe('error cases', () => {
    it('returns error with team names when state belongs to different team', () => {
      const registry = createMultiTeamRegistry();

      // Try to apply SQT state (state-sqt-todo) to SQM issue
      const result = validateStateBelongsToTeam(
        's0',
        'state-sqt-todo',
        'team-sqm', // target team (different from state's team)
        registry,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('SQT'); // State's team
      expect(result.error).toContain('SQM'); // Target team
      expect(result.error).toContain("State 's0' belongs to team SQT");
    });

    it('returns error when SQM state used on SQT issue', () => {
      const registry = createMultiTeamRegistry();

      // Try to apply SQM state (state-sqm-done) to SQT issue
      const result = validateStateBelongsToTeam(
        'sqm:s2',
        'state-sqm-done',
        'team-sqt', // target team
        registry,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("State 'sqm:s2' belongs to team SQM");
      expect(result.error).toContain('but the issue is in team SQT');
    });

    it('includes suggestion to check workspace_metadata', () => {
      const registry = createMultiTeamRegistry();

      const result = validateStateBelongsToTeam(
        's0',
        'state-sqt-todo',
        'team-sqm',
        registry,
      );

      expect(result.valid).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('workspace_metadata');
      expect(result.suggestion).toContain('SQM');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validateLabelBelongsToTeam
// ─────────────────────────────────────────────────────────────────────────────

describe('validateLabelBelongsToTeam', () => {
  describe('valid cases', () => {
    it('returns valid for workspace labels (no team)', () => {
      const registry = createMultiTeamRegistry();

      // Workspace labels have no labelTeamId
      const result = validateLabelBelongsToTeam(
        'Bug',
        'label-bug-uuid',
        'team-sqt',
        registry,
        undefined, // No team - workspace label
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid when label belongs to target team', () => {
      const registry = createMultiTeamRegistry();

      // Team-specific label applied to its own team
      const result = validateLabelBelongsToTeam(
        'sqt:Feature',
        'label-sqt-feature-uuid',
        'team-sqt', // target team
        registry,
        'team-sqt', // label's team (same as target)
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid when workspace label applied to any team', () => {
      const registry = createMultiTeamRegistry();

      // Workspace label can be applied to any team
      const result1 = validateLabelBelongsToTeam(
        'Enhancement',
        'label-enhancement-uuid',
        'team-sqt',
        registry,
        undefined, // Workspace label
      );

      const result2 = validateLabelBelongsToTeam(
        'Enhancement',
        'label-enhancement-uuid',
        'team-sqm',
        registry,
        undefined, // Workspace label
      );

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('error cases', () => {
    it('returns error when team label applied to wrong team', () => {
      const registry = createMultiTeamRegistry();

      // Try to apply SQT label to SQM issue
      const result = validateLabelBelongsToTeam(
        'sqt:Priority',
        'label-sqt-priority-uuid',
        'team-sqm', // target team (different from label's team)
        registry,
        'team-sqt', // label's team
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain('SQT'); // Label's team
      expect(result.error).toContain('SQM'); // Target team
      expect(result.error).toContain("Label 'sqt:Priority' belongs to team SQT");
    });

    it('returns error when SQM label used on SQT issue', () => {
      const registry = createMultiTeamRegistry();

      const result = validateLabelBelongsToTeam(
        'sqm:Urgent',
        'label-sqm-urgent-uuid',
        'team-sqt', // target team
        registry,
        'team-sqm', // label's team
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Label 'sqm:Urgent' belongs to team SQM");
      expect(result.error).toContain('but the issue is in team SQT');
    });

    it('includes helpful suggestion in error', () => {
      const registry = createMultiTeamRegistry();

      const result = validateLabelBelongsToTeam(
        'sqt:Feature',
        'label-sqt-feature-uuid',
        'team-sqm',
        registry,
        'team-sqt',
      );

      expect(result.valid).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('workspace_metadata');
      expect(result.suggestion).toContain('SQM');
      expect(result.suggestion).toContain('workspace-level label');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validateStateKeyPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('validateStateKeyPrefix', () => {
  describe('valid cases', () => {
    it('returns valid for clean key on default team issue', () => {
      const registry = createMultiTeamRegistry();

      // Clean key (s0) is valid for default team (SQT)
      const result = validateStateKeyPrefix(
        's0',
        'team-sqt', // target team (default)
        registry,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid for matching prefixed key (sqm:s0 on SQM issue)', () => {
      const registry = createMultiTeamRegistry();

      // Prefixed key (sqm:s0) is valid for SQM team
      const result = validateStateKeyPrefix(
        'sqm:s0',
        'team-sqm', // target team
        registry,
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid for default team prefix on default team issue', () => {
      const registry = createMultiTeamRegistry();

      // sqt:s0 is also valid for SQT (flexible input)
      const result = validateStateKeyPrefix('sqt:s0', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });

    it('returns valid for invalid format keys (lets normal resolution handle)', () => {
      const registry = createMultiTeamRegistry();

      // Invalid format - should pass prefix check (let resolution handle it)
      const result = validateStateKeyPrefix('invalid-key', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });

    it('returns valid for non-state keys (lets normal resolution handle)', () => {
      const registry = createMultiTeamRegistry();

      // User key - not a state, should pass prefix check
      const result = validateStateKeyPrefix('u0', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });
  });

  describe('error cases', () => {
    it('returns error for mismatched prefix (sqm:s0 on SQT issue)', () => {
      const registry = createMultiTeamRegistry();

      // sqm:s0 used on SQT issue
      const result = validateStateKeyPrefix(
        'sqm:s0',
        'team-sqt', // target team (SQT)
        registry,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("State 'sqm:s0' belongs to team SQM");
      expect(result.error).toContain('but the issue is in team SQT');
    });

    it('returns error for clean key on non-default team issue', () => {
      const registry = createMultiTeamRegistry();

      // Clean key (s0) used on SQM issue (non-default team)
      const result = validateStateKeyPrefix(
        's0',
        'team-sqm', // target team (not default)
        registry,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toContain("State 's0' is a SQT state key");
      expect(result.error).toContain('but the issue is in team SQM');
    });

    it('suggests correct prefix format in error for mismatched prefix', () => {
      const registry = createMultiTeamRegistry();

      const result = validateStateKeyPrefix('sqm:s0', 'team-sqt', registry);

      expect(result.valid).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('sqt:s0');
      expect(result.suggestion).toContain('sqt:s1');
      expect(result.suggestion).toContain('SQT');
    });

    it('suggests correct prefix format in error for clean key on wrong team', () => {
      const registry = createMultiTeamRegistry();

      const result = validateStateKeyPrefix('s0', 'team-sqm', registry);

      expect(result.valid).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('sqm:s0');
      expect(result.suggestion).toContain('sqm:s1');
      expect(result.suggestion).toContain('SQM');
    });
  });

  describe('edge cases', () => {
    it('handles registry without defaultTeamId', () => {
      const data: RegistryBuildData = {
        users: [],
        states: [
          {
            id: 'state-todo',
            teamId: 'team-sqt',
            name: 'Todo',
            type: 'unstarted',
            createdAt: new Date('2024-01-01'),
          },
        ],
        projects: [],
        workspaceId: 'test-workspace',
        teams: [{ id: 'team-sqt', key: 'SQT' }],
        // No defaultTeamId
      };

      const registry = buildRegistry(data);

      // Without defaultTeamId, clean key should be valid for any team
      const result = validateStateKeyPrefix('s0', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });

    it('handles case-insensitive prefix matching', () => {
      const registry = createMultiTeamRegistry();

      // Uppercase prefix should still work
      const result = validateStateKeyPrefix('SQM:s0', 'team-sqm', registry);

      expect(result.valid).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validateLabelKeyPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('validateLabelKeyPrefix', () => {
  describe('valid cases', () => {
    it('returns valid for workspace label name (no prefix)', () => {
      const registry = createMultiTeamRegistry();

      // Plain label name without prefix - could be workspace label
      const result = validateLabelKeyPrefix('Bug', 'team-sqt', registry);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid for matching team prefix', () => {
      const registry = createMultiTeamRegistry();

      // sqt:Feature for SQT team
      const result = validateLabelKeyPrefix('sqt:Feature', 'team-sqt', registry);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid for SQM prefix on SQM issue', () => {
      const registry = createMultiTeamRegistry();

      const result = validateLabelKeyPrefix('sqm:Priority', 'team-sqm', registry);

      expect(result.valid).toBe(true);
    });

    it('returns valid for label with colon in name but no team prefix', () => {
      const registry = createMultiTeamRegistry();

      // Labels starting with ":" are not team-prefixed
      const result = validateLabelKeyPrefix(':Special:Label', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });
  });

  describe('error cases', () => {
    it('returns error for mismatched team prefix', () => {
      const registry = createMultiTeamRegistry();

      // sqm:Feature on SQT issue
      const result = validateLabelKeyPrefix('sqm:Feature', 'team-sqt', registry);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Label 'sqm:Feature' has team prefix SQM");
      expect(result.error).toContain('but the issue is in team SQT');
    });

    it('returns error for SQT prefix on SQM issue', () => {
      const registry = createMultiTeamRegistry();

      const result = validateLabelKeyPrefix('sqt:Urgent', 'team-sqm', registry);

      expect(result.valid).toBe(false);
      expect(result.error).toContain("Label 'sqt:Urgent' has team prefix SQT");
      expect(result.error).toContain('but the issue is in team SQM');
    });

    it('suggests correct label format in error', () => {
      const registry = createMultiTeamRegistry();

      const result = validateLabelKeyPrefix('sqm:Feature', 'team-sqt', registry);

      expect(result.valid).toBe(false);
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('sqt:Feature');
      expect(result.suggestion).toContain('SQT');
      expect(result.suggestion).toContain('workspace label');
    });
  });

  describe('edge cases', () => {
    it('handles case-insensitive prefix matching', () => {
      const registry = createMultiTeamRegistry();

      // Uppercase prefix should still be checked correctly
      const result = validateLabelKeyPrefix('SQM:Feature', 'team-sqm', registry);

      expect(result.valid).toBe(true);
    });

    it('handles labels with multiple colons', () => {
      const registry = createMultiTeamRegistry();

      // sqt:Priority:High - prefix is "sqt", label name is "Priority:High"
      const result = validateLabelKeyPrefix('sqt:Priority:High', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });

    it('handles empty label key gracefully', () => {
      const registry = createMultiTeamRegistry();

      // Empty string - no prefix
      const result = validateLabelKeyPrefix('', 'team-sqt', registry);

      expect(result.valid).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Tests: Combined Validation Scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe('cross-team validation integration', () => {
  it('correctly validates SQT state on SQT issue', () => {
    const registry = createMultiTeamRegistry();
    const targetTeamId = 'team-sqt';

    // Step 1: Prefix check
    const prefixResult = validateStateKeyPrefix('s0', targetTeamId, registry);
    expect(prefixResult.valid).toBe(true);

    // Step 2: After resolution, team membership check
    const teamResult = validateStateBelongsToTeam(
      's0',
      'state-sqt-todo',
      targetTeamId,
      registry,
    );
    expect(teamResult.valid).toBe(true);
  });

  it('correctly rejects SQM state on SQT issue at prefix level', () => {
    const registry = createMultiTeamRegistry();
    const targetTeamId = 'team-sqt';

    // Prefix check catches the error early
    const prefixResult = validateStateKeyPrefix('sqm:s0', targetTeamId, registry);
    expect(prefixResult.valid).toBe(false);
    expect(prefixResult.error).toContain('SQM');
    expect(prefixResult.error).toContain('SQT');
  });

  it('correctly rejects default team state on non-default team issue', () => {
    const registry = createMultiTeamRegistry();
    const targetTeamId = 'team-sqm'; // Non-default

    // Clean key on non-default team is caught at prefix level
    const prefixResult = validateStateKeyPrefix('s0', targetTeamId, registry);
    expect(prefixResult.valid).toBe(false);
    expect(prefixResult.suggestion).toContain('sqm:');
  });

  it('workspace labels pass all validation for any team', () => {
    const registry = createMultiTeamRegistry();

    // Prefix check (no prefix = valid)
    const sqtPrefixResult = validateLabelKeyPrefix('Bug', 'team-sqt', registry);
    const sqmPrefixResult = validateLabelKeyPrefix('Bug', 'team-sqm', registry);

    expect(sqtPrefixResult.valid).toBe(true);
    expect(sqmPrefixResult.valid).toBe(true);

    // Team membership check (no team = workspace label = valid for any team)
    const sqtTeamResult = validateLabelBelongsToTeam(
      'Bug',
      'label-bug-uuid',
      'team-sqt',
      registry,
      undefined,
    );
    const sqmTeamResult = validateLabelBelongsToTeam(
      'Bug',
      'label-bug-uuid',
      'team-sqm',
      registry,
      undefined,
    );

    expect(sqtTeamResult.valid).toBe(true);
    expect(sqmTeamResult.valid).toBe(true);
  });
});
