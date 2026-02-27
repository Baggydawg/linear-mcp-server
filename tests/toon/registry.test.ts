import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ToonRegistryError,
  ToonResolutionError,
} from '../../src/shared/toon/errors.js';
import {
  buildRegistry,
  clearAllRegistries,
  clearRegistry,
  createEmptyRegistry,
  getOrInitRegistry,
  getRegistryAge,
  getRegistryStats,
  getRemainingTtl,
  getShortKey,
  getStoredRegistry,
  getTeamPrefix,
  getUserStatusLabel,
  hasShortKey,
  hasUuid,
  isStale,
  listShortKeys,
  type ProjectMetadata,
  parseLabelKey,
  parseShortKey,
  type RegistryBuildData,
  type RegistryEntity,
  type RegistryUserEntity,
  registerNewProject,
  resolveShortKey,
  type ShortKeyRegistry,
  storeRegistry,
  tryGetShortKey,
  tryResolveShortKey,
} from '../../src/shared/toon/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Data Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const createTestUsers = (): RegistryEntity[] => [
  { id: 'user-uuid-alice', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'user-uuid-bob', createdAt: '2024-01-02T00:00:00Z' },
  { id: 'user-uuid-charlie', createdAt: '2024-01-03T00:00:00Z' },
];

const createTestStates = (): RegistryEntity[] => [
  { id: 'state-uuid-triage', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'state-uuid-backlog', createdAt: '2024-01-01T01:00:00Z' },
  { id: 'state-uuid-todo', createdAt: '2024-01-01T02:00:00Z' },
  { id: 'state-uuid-progress', createdAt: '2024-01-01T03:00:00Z' },
  { id: 'state-uuid-done', createdAt: '2024-01-01T04:00:00Z' },
];

const createTestProjects = (): RegistryEntity[] => [
  { id: 'project-uuid-alpha', createdAt: '2024-02-01T00:00:00Z' },
  { id: 'project-uuid-beta', createdAt: '2024-02-15T00:00:00Z' },
];

const createTestBuildData = (): RegistryBuildData => ({
  users: createTestUsers(),
  states: createTestStates(),
  projects: createTestProjects(),
  workspaceId: 'workspace-123',
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: createEmptyRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('createEmptyRegistry', () => {
  it('creates an empty registry with all maps', () => {
    const registry = createEmptyRegistry();

    expect(registry.users).toBeInstanceOf(Map);
    expect(registry.states).toBeInstanceOf(Map);
    expect(registry.projects).toBeInstanceOf(Map);
    expect(registry.usersByUuid).toBeInstanceOf(Map);
    expect(registry.statesByUuid).toBeInstanceOf(Map);
    expect(registry.projectsByUuid).toBeInstanceOf(Map);

    expect(registry.users.size).toBe(0);
    expect(registry.states.size).toBe(0);
    expect(registry.projects.size).toBe(0);
  });

  it('sets workspaceId', () => {
    const registry = createEmptyRegistry('my-workspace');
    expect(registry.workspaceId).toBe('my-workspace');
  });

  it('sets transport type', () => {
    const registry = createEmptyRegistry('workspace', 'stdio');
    expect(registry.transport).toBe('stdio');
  });

  it('sets generatedAt to current time', () => {
    const before = new Date();
    const registry = createEmptyRegistry();
    const after = new Date();

    expect(registry.generatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(registry.generatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: buildRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRegistry', () => {
  it('assigns sequential user keys sorted by createdAt', () => {
    const data = createTestBuildData();
    const registry = buildRegistry(data);

    // Alice (oldest) = u0, Bob = u1, Charlie (newest) = u2
    expect(registry.users.get('u0')).toBe('user-uuid-alice');
    expect(registry.users.get('u1')).toBe('user-uuid-bob');
    expect(registry.users.get('u2')).toBe('user-uuid-charlie');
  });

  it('assigns sequential state keys sorted by createdAt', () => {
    const data = createTestBuildData();
    const registry = buildRegistry(data);

    expect(registry.states.get('s0')).toBe('state-uuid-triage');
    expect(registry.states.get('s1')).toBe('state-uuid-backlog');
    expect(registry.states.get('s2')).toBe('state-uuid-todo');
    expect(registry.states.get('s3')).toBe('state-uuid-progress');
    expect(registry.states.get('s4')).toBe('state-uuid-done');
  });

  it('assigns sequential project keys sorted by createdAt', () => {
    const data = createTestBuildData();
    const registry = buildRegistry(data);

    expect(registry.projects.get('pr0')).toBe('project-uuid-alpha');
    expect(registry.projects.get('pr1')).toBe('project-uuid-beta');
  });

  it('builds reverse mappings (UUID -> short key)', () => {
    const data = createTestBuildData();
    const registry = buildRegistry(data);

    expect(registry.usersByUuid.get('user-uuid-alice')).toBe('u0');
    expect(registry.usersByUuid.get('user-uuid-bob')).toBe('u1');
    expect(registry.usersByUuid.get('user-uuid-charlie')).toBe('u2');

    expect(registry.statesByUuid.get('state-uuid-triage')).toBe('s0');
    expect(registry.statesByUuid.get('state-uuid-done')).toBe('s4');

    expect(registry.projectsByUuid.get('project-uuid-alpha')).toBe('pr0');
    expect(registry.projectsByUuid.get('project-uuid-beta')).toBe('pr1');
  });

  it('sets workspaceId from input data', () => {
    const data = createTestBuildData();
    const registry = buildRegistry(data);

    expect(registry.workspaceId).toBe('workspace-123');
  });

  it('handles Date objects in createdAt', () => {
    const data: RegistryBuildData = {
      users: [
        { id: 'newer', createdAt: new Date('2024-06-01') },
        { id: 'older', createdAt: new Date('2024-01-01') },
      ],
      states: [],
      projects: [],
      workspaceId: 'test',
    };

    const registry = buildRegistry(data);

    // older should be u0, newer should be u1
    expect(registry.users.get('u0')).toBe('older');
    expect(registry.users.get('u1')).toBe('newer');
  });

  it('produces deterministic keys for same input', () => {
    const data = createTestBuildData();
    const registry1 = buildRegistry(data);
    const registry2 = buildRegistry(data);

    // Same input should produce same mappings
    expect(registry1.users.get('u0')).toBe(registry2.users.get('u0'));
    expect(registry1.users.get('u1')).toBe(registry2.users.get('u1'));
    expect(registry1.users.get('u2')).toBe(registry2.users.get('u2'));
  });

  it('handles empty collections', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [],
      projects: [],
      workspaceId: 'empty-workspace',
    };

    const registry = buildRegistry(data);

    expect(registry.users.size).toBe(0);
    expect(registry.states.size).toBe(0);
    expect(registry.projects.size).toBe(0);
  });

  it('new entities get highest keys (newest createdAt)', () => {
    // Simulate adding a new user to existing data
    const existingUsers = createTestUsers();
    const newUser: RegistryEntity = {
      id: 'user-uuid-david',
      createdAt: '2024-06-01T00:00:00Z',
    };

    const registry = buildRegistry({
      users: [...existingUsers, newUser],
      states: [],
      projects: [],
      workspaceId: 'test',
    });

    // New user (David) should get u3 (highest key)
    expect(registry.users.get('u3')).toBe('user-uuid-david');

    // Original users should keep their keys
    expect(registry.users.get('u0')).toBe('user-uuid-alice');
    expect(registry.users.get('u1')).toBe('user-uuid-bob');
    expect(registry.users.get('u2')).toBe('user-uuid-charlie');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Team Filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('team filtering', () => {
  it('filters states by teamId when provided', () => {
    const data: RegistryBuildData = {
      users: [
        {
          id: 'user-1',
          createdAt: new Date('2024-01-01'),
          name: 'User 1',
          displayName: 'u1',
          email: 'u1@test.com',
          active: true,
        },
      ],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-a',
        },
        {
          id: 'state-3',
          createdAt: new Date('2024-01-03'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-b',
        },
        {
          id: 'state-4',
          createdAt: new Date('2024-01-04'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-b',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teamId: 'team-a', // Filter to team-a only
    };

    const registry = buildRegistry(data);

    // Should only have 2 states (team-a's states)
    expect(registry.states.size).toBe(2);
    expect(registry.statesByUuid.size).toBe(2);
    expect(registry.stateMetadata.size).toBe(2);

    // Verify the correct states are included
    expect(registry.statesByUuid.has('state-1')).toBe(true);
    expect(registry.statesByUuid.has('state-2')).toBe(true);
    expect(registry.statesByUuid.has('state-3')).toBe(false);
    expect(registry.statesByUuid.has('state-4')).toBe(false);
  });

  it('includes all states when teamId not provided', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-b',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      // No teamId - should include all states
    };

    const registry = buildRegistry(data);

    expect(registry.states.size).toBe(2);
    expect(registry.statesByUuid.has('state-1')).toBe(true);
    expect(registry.statesByUuid.has('state-2')).toBe(true);
  });

  it('assigns sequential short keys for filtered states', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'In Progress',
          type: 'started',
          teamId: 'team-b',
        },
        {
          id: 'state-3',
          createdAt: new Date('2024-01-03'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-a',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teamId: 'team-a',
    };

    const registry = buildRegistry(data);

    // Should only have 2 states, with sequential keys starting from s0
    expect(registry.states.size).toBe(2);
    expect(registry.states.get('s0')).toBe('state-1');
    expect(registry.states.get('s1')).toBe('state-3');
    expect(registry.states.has('s2')).toBe(false);
  });

  it('preserves state metadata for filtered states only', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Backlog',
          type: 'backlog',
          teamId: 'team-a',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Working',
          type: 'started',
          teamId: 'team-b',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teamId: 'team-a',
    };

    const registry = buildRegistry(data);

    // Should have metadata for team-a state only
    const metadata = registry.stateMetadata.get('state-1');
    expect(metadata).toBeDefined();
    expect(metadata?.name).toBe('Backlog');
    expect(metadata?.type).toBe('backlog');

    // Should NOT have metadata for team-b state
    expect(registry.stateMetadata.has('state-2')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Multi-Team State Keys
// ─────────────────────────────────────────────────────────────────────────────

describe('multi-team state keys', () => {
  it('assigns clean keys to default team states', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a-uuid',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-a-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-a-uuid', key: 'SQT' },
        { id: 'team-b-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-a-uuid',
    };

    const registry = buildRegistry(data);

    // Default team states get clean keys (no prefix)
    expect(registry.states.get('s0')).toBe('state-1');
    expect(registry.states.get('s1')).toBe('state-2');
    expect(registry.statesByUuid.get('state-1')).toBe('s0');
    expect(registry.statesByUuid.get('state-2')).toBe('s1');
  });

  it('assigns prefixed keys to non-default team states', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a-uuid',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-b-uuid',
        },
        {
          id: 'state-3',
          createdAt: new Date('2024-01-03'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-b-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-a-uuid', key: 'SQT' },
        { id: 'team-b-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-a-uuid',
    };

    const registry = buildRegistry(data);

    // Default team (SQT) gets clean keys
    expect(registry.states.get('s0')).toBe('state-1');
    expect(registry.statesByUuid.get('state-1')).toBe('s0');

    // Non-default team (SQM) gets prefixed keys
    expect(registry.states.get('sqm:s0')).toBe('state-2');
    expect(registry.states.get('sqm:s1')).toBe('state-3');
    expect(registry.statesByUuid.get('state-2')).toBe('sqm:s0');
    expect(registry.statesByUuid.get('state-3')).toBe('sqm:s1');
  });

  it('uses per-team indexing (each team starts at s0)', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-a1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a-uuid',
        },
        {
          id: 'state-b1',
          createdAt: new Date('2024-01-02'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-b-uuid',
        },
        {
          id: 'state-a2',
          createdAt: new Date('2024-01-03'),
          name: 'In Progress',
          type: 'started',
          teamId: 'team-a-uuid',
        },
        {
          id: 'state-c1',
          createdAt: new Date('2024-01-04'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-c-uuid',
        },
        {
          id: 'state-b2',
          createdAt: new Date('2024-01-05'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-b-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-a-uuid', key: 'SQT' },
        { id: 'team-b-uuid', key: 'SQM' },
        { id: 'team-c-uuid', key: 'DEV' },
      ],
      defaultTeamId: 'team-a-uuid',
    };

    const registry = buildRegistry(data);

    // Default team (SQT) - clean keys, indexed 0, 1
    expect(registry.statesByUuid.get('state-a1')).toBe('s0');
    expect(registry.statesByUuid.get('state-a2')).toBe('s1');

    // Team SQM - prefixed keys, indexed 0, 1
    expect(registry.statesByUuid.get('state-b1')).toBe('sqm:s0');
    expect(registry.statesByUuid.get('state-b2')).toBe('sqm:s1');

    // Team DEV - prefixed keys, indexed 0
    expect(registry.statesByUuid.get('state-c1')).toBe('dev:s0');
  });

  it('stores teamKeys and defaultTeamId in registry', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-a-uuid', key: 'SQT' },
        { id: 'team-b-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-a-uuid',
    };

    const registry = buildRegistry(data);

    expect(registry.defaultTeamId).toBe('team-a-uuid');
    expect(registry.teamKeys.get('team-a-uuid')).toBe('sqt');
    expect(registry.teamKeys.get('team-b-uuid')).toBe('sqm');
  });

  it('falls back to simple keys when no teams provided', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a-uuid',
        },
        {
          id: 'state-2',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-b-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      // No teams or defaultTeamId
    };

    const registry = buildRegistry(data);

    // Should use simple sequential keys (legacy behavior)
    expect(registry.states.get('s0')).toBe('state-1');
    expect(registry.states.get('s1')).toBe('state-2');
    expect(registry.statesByUuid.get('state-1')).toBe('s0');
    expect(registry.statesByUuid.get('state-2')).toBe('s1');
  });

  it('falls back to simple keys when no defaultTeamId provided', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-a-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [{ id: 'team-a-uuid', key: 'SQT' }],
      // No defaultTeamId
    };

    const registry = buildRegistry(data);

    // Should use simple sequential keys
    expect(registry.states.get('s0')).toBe('state-1');
  });

  it('users and projects remain global (no team prefix)', () => {
    const data: RegistryBuildData = {
      users: [
        {
          id: 'user-1',
          createdAt: new Date('2024-01-01'),
          name: 'User 1',
          displayName: 'u1',
          email: 'u1@test.com',
          active: true,
        },
        {
          id: 'user-2',
          createdAt: new Date('2024-01-02'),
          name: 'User 2',
          displayName: 'u2',
          email: 'u2@test.com',
          active: true,
        },
      ],
      states: [],
      projects: [
        {
          id: 'project-1',
          createdAt: new Date('2024-01-01'),
          name: 'Project 1',
          state: 'started',
        },
        {
          id: 'project-2',
          createdAt: new Date('2024-01-02'),
          name: 'Project 2',
          state: 'planned',
        },
      ],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-a-uuid', key: 'SQT' },
        { id: 'team-b-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-a-uuid',
    };

    const registry = buildRegistry(data);

    // Users should have simple global keys (no team prefix)
    expect(registry.users.get('u0')).toBe('user-1');
    expect(registry.users.get('u1')).toBe('user-2');
    expect(registry.usersByUuid.get('user-1')).toBe('u0');
    expect(registry.usersByUuid.get('user-2')).toBe('u1');

    // Projects should have simple global keys (no team prefix)
    expect(registry.projects.get('pr0')).toBe('project-1');
    expect(registry.projects.get('pr1')).toBe('project-2');
    expect(registry.projectsByUuid.get('project-1')).toBe('pr0');
    expect(registry.projectsByUuid.get('project-2')).toBe('pr1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Resolution Functions
// ─────────────────────────────────────────────────────────────────────────────

describe('getShortKey', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns short key for valid user UUID', () => {
    expect(getShortKey(registry, 'user', 'user-uuid-alice')).toBe('u0');
    expect(getShortKey(registry, 'user', 'user-uuid-bob')).toBe('u1');
    expect(getShortKey(registry, 'user', 'user-uuid-charlie')).toBe('u2');
  });

  it('returns short key for valid state UUID', () => {
    expect(getShortKey(registry, 'state', 'state-uuid-triage')).toBe('s0');
    expect(getShortKey(registry, 'state', 'state-uuid-done')).toBe('s4');
  });

  it('returns short key for valid project UUID', () => {
    expect(getShortKey(registry, 'project', 'project-uuid-alpha')).toBe('pr0');
    expect(getShortKey(registry, 'project', 'project-uuid-beta')).toBe('pr1');
  });

  it('throws ToonResolutionError for unknown UUID', () => {
    expect(() => getShortKey(registry, 'user', 'unknown-uuid')).toThrow(
      ToonResolutionError,
    );

    try {
      getShortKey(registry, 'user', 'unknown-uuid');
    } catch (error) {
      expect(error).toBeInstanceOf(ToonResolutionError);
      expect((error as ToonResolutionError).code).toBe('ENTITY_NOT_FOUND');
      expect((error as ToonResolutionError).entityType).toBe('user');
      expect((error as ToonResolutionError).hint).toContain('Registry contains');
      expect((error as ToonResolutionError).suggestion).toContain('workspace_metadata');
    }
  });
});

describe('resolveShortKey', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns UUID for valid user short key', () => {
    expect(resolveShortKey(registry, 'user', 'u0')).toBe('user-uuid-alice');
    expect(resolveShortKey(registry, 'user', 'u1')).toBe('user-uuid-bob');
    expect(resolveShortKey(registry, 'user', 'u2')).toBe('user-uuid-charlie');
  });

  it('returns UUID for valid state short key', () => {
    expect(resolveShortKey(registry, 'state', 's0')).toBe('state-uuid-triage');
    expect(resolveShortKey(registry, 'state', 's4')).toBe('state-uuid-done');
  });

  it('returns UUID for valid project short key', () => {
    expect(resolveShortKey(registry, 'project', 'pr0')).toBe('project-uuid-alpha');
    expect(resolveShortKey(registry, 'project', 'pr1')).toBe('project-uuid-beta');
  });

  it('throws ToonResolutionError for unknown short key', () => {
    expect(() => resolveShortKey(registry, 'user', 'u99')).toThrow(ToonResolutionError);

    try {
      resolveShortKey(registry, 'user', 'u99');
    } catch (error) {
      expect(error).toBeInstanceOf(ToonResolutionError);
      expect((error as ToonResolutionError).code).toBe('UNKNOWN_SHORT_KEY');
      expect((error as ToonResolutionError).shortKey).toBe('u99');
      expect((error as ToonResolutionError).availableKeys).toContain('u0');
      expect((error as ToonResolutionError).availableKeys).toContain('u1');
      expect((error as ToonResolutionError).availableKeys).toContain('u2');
    }
  });

  it('error includes helpful hint with available keys', () => {
    try {
      resolveShortKey(registry, 'state', 's99');
    } catch (error) {
      expect((error as ToonResolutionError).hint).toContain('Available keys:');
      expect((error as ToonResolutionError).hint).toContain('s0');
    }
  });
});

describe('tryGetShortKey', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns short key for valid UUID', () => {
    expect(tryGetShortKey(registry, 'user', 'user-uuid-alice')).toBe('u0');
  });

  it('returns undefined for unknown UUID (no throw)', () => {
    expect(tryGetShortKey(registry, 'user', 'unknown-uuid')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(tryGetShortKey(registry, 'user', null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(tryGetShortKey(registry, 'user', undefined)).toBeUndefined();
  });
});

describe('tryResolveShortKey', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns UUID for valid short key', () => {
    expect(tryResolveShortKey(registry, 'user', 'u0')).toBe('user-uuid-alice');
  });

  it('returns undefined for unknown short key (no throw)', () => {
    expect(tryResolveShortKey(registry, 'user', 'u99')).toBeUndefined();
  });

  it('returns undefined for null input', () => {
    expect(tryResolveShortKey(registry, 'user', null)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(tryResolveShortKey(registry, 'user', undefined)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Multi-Team Resolution with Flexible Input
// ─────────────────────────────────────────────────────────────────────────────

describe('multi-team resolution - flexible input', () => {
  // Create a multi-team registry with DEFAULT_TEAM=SQT
  const createMultiTeamBuildData = (): RegistryBuildData => ({
    users: [
      {
        id: 'user-1',
        createdAt: new Date('2024-01-01'),
        name: 'Alice',
        displayName: 'alice',
        email: 'alice@test.com',
        active: true,
      },
      {
        id: 'user-2',
        createdAt: new Date('2024-01-02'),
        name: 'Bob',
        displayName: 'bob',
        email: 'bob@test.com',
        active: true,
      },
    ],
    states: [
      // SQT (default team) states
      {
        id: 'sqt-todo',
        createdAt: new Date('2024-01-01'),
        name: 'Todo',
        type: 'unstarted',
        teamId: 'team-sqt-uuid',
      },
      {
        id: 'sqt-done',
        createdAt: new Date('2024-01-02'),
        name: 'Done',
        type: 'completed',
        teamId: 'team-sqt-uuid',
      },
      // SQM (non-default team) states
      {
        id: 'sqm-todo',
        createdAt: new Date('2024-01-03'),
        name: 'Todo',
        type: 'unstarted',
        teamId: 'team-sqm-uuid',
      },
      {
        id: 'sqm-done',
        createdAt: new Date('2024-01-04'),
        name: 'Done',
        type: 'completed',
        teamId: 'team-sqm-uuid',
      },
    ],
    projects: [
      {
        id: 'project-1',
        createdAt: new Date('2024-01-01'),
        name: 'Project Alpha',
        state: 'started',
      },
    ],
    workspaceId: 'workspace-1',
    teams: [
      { id: 'team-sqt-uuid', key: 'SQT' },
      { id: 'team-sqm-uuid', key: 'SQM' },
    ],
    defaultTeamId: 'team-sqt-uuid',
  });

  describe('resolveShortKey with team prefixes', () => {
    let registry: ShortKeyRegistry;

    beforeEach(() => {
      registry = buildRegistry(createMultiTeamBuildData());
    });

    it('resolves clean key to default team state', () => {
      // s0 should resolve to SQT's first state (clean key)
      expect(resolveShortKey(registry, 'state', 's0')).toBe('sqt-todo');
      expect(resolveShortKey(registry, 'state', 's1')).toBe('sqt-done');
    });

    it('resolves default team prefix to same result as clean key (flexible input)', () => {
      // "sqt:s0" should resolve to same UUID as "s0" when DEFAULT_TEAM=SQT
      expect(resolveShortKey(registry, 'state', 'sqt:s0')).toBe('sqt-todo');
      expect(resolveShortKey(registry, 'state', 'sqt:s1')).toBe('sqt-done');

      // Both forms should return the same result
      expect(resolveShortKey(registry, 'state', 's0')).toBe(
        resolveShortKey(registry, 'state', 'sqt:s0'),
      );
    });

    it('resolves non-default team prefixed key', () => {
      // "sqm:s0" should resolve to SQM's first state
      expect(resolveShortKey(registry, 'state', 'sqm:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'sqm:s1')).toBe('sqm-done');
    });

    it('resolves user keys (global, no team prefix)', () => {
      expect(resolveShortKey(registry, 'user', 'u0')).toBe('user-1');
      expect(resolveShortKey(registry, 'user', 'u1')).toBe('user-2');
    });

    it('strips team prefix from global user keys (flexible input)', () => {
      // Users are global, so "sqt:u0" should normalize to "u0"
      expect(resolveShortKey(registry, 'user', 'sqt:u0')).toBe('user-1');
      expect(resolveShortKey(registry, 'user', 'sqm:u0')).toBe('user-1');
    });

    it('strips team prefix from global project keys (flexible input)', () => {
      // Projects are global, so prefixes should be stripped
      expect(resolveShortKey(registry, 'project', 'pr0')).toBe('project-1');
      expect(resolveShortKey(registry, 'project', 'sqt:pr0')).toBe('project-1');
    });

    it('handles case-insensitive team prefixes', () => {
      // Should work with different cases
      expect(resolveShortKey(registry, 'state', 'SQM:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'Sqm:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'SQT:s0')).toBe('sqt-todo');
    });

    it('throws for unknown team prefix', () => {
      expect(() => resolveShortKey(registry, 'state', 'xyz:s0')).toThrow(
        ToonResolutionError,
      );
    });
  });

  describe('tryResolveShortKey with team prefixes', () => {
    let registry: ShortKeyRegistry;

    beforeEach(() => {
      registry = buildRegistry(createMultiTeamBuildData());
    });

    it('returns UUID for clean key', () => {
      expect(tryResolveShortKey(registry, 'state', 's0')).toBe('sqt-todo');
    });

    it('returns UUID for default team prefixed key (flexible input)', () => {
      expect(tryResolveShortKey(registry, 'state', 'sqt:s0')).toBe('sqt-todo');
    });

    it('returns UUID for non-default team prefixed key', () => {
      expect(tryResolveShortKey(registry, 'state', 'sqm:s0')).toBe('sqm-todo');
    });

    it('returns undefined for unknown team prefix', () => {
      expect(tryResolveShortKey(registry, 'state', 'xyz:s0')).toBeUndefined();
    });

    it('strips team prefix from global user keys', () => {
      expect(tryResolveShortKey(registry, 'user', 'sqt:u0')).toBe('user-1');
    });
  });

  describe('getShortKey with team prefixes', () => {
    let registry: ShortKeyRegistry;

    beforeEach(() => {
      registry = buildRegistry(createMultiTeamBuildData());
    });

    it('returns clean key for default team state', () => {
      // SQT states should have clean keys
      expect(getShortKey(registry, 'state', 'sqt-todo')).toBe('s0');
      expect(getShortKey(registry, 'state', 'sqt-done')).toBe('s1');
    });

    it('returns prefixed key for non-default team state', () => {
      // SQM states should have prefixed keys
      expect(getShortKey(registry, 'state', 'sqm-todo')).toBe('sqm:s0');
      expect(getShortKey(registry, 'state', 'sqm-done')).toBe('sqm:s1');
    });

    it('returns clean key for global users', () => {
      expect(getShortKey(registry, 'user', 'user-1')).toBe('u0');
      expect(getShortKey(registry, 'user', 'user-2')).toBe('u1');
    });

    it('returns clean key for global projects', () => {
      expect(getShortKey(registry, 'project', 'project-1')).toBe('pr0');
    });
  });

  describe('tryGetShortKey with team prefixes', () => {
    let registry: ShortKeyRegistry;

    beforeEach(() => {
      registry = buildRegistry(createMultiTeamBuildData());
    });

    it('returns clean key for default team state', () => {
      expect(tryGetShortKey(registry, 'state', 'sqt-todo')).toBe('s0');
    });

    it('returns prefixed key for non-default team state', () => {
      expect(tryGetShortKey(registry, 'state', 'sqm-todo')).toBe('sqm:s0');
    });

    it('returns undefined for unknown UUID', () => {
      expect(tryGetShortKey(registry, 'state', 'unknown-uuid')).toBeUndefined();
    });
  });

  describe('round-trip consistency', () => {
    let registry: ShortKeyRegistry;

    beforeEach(() => {
      registry = buildRegistry(createMultiTeamBuildData());
    });

    it('resolving and getting short key is reversible for default team', () => {
      const uuid = resolveShortKey(registry, 'state', 's0');
      const key = getShortKey(registry, 'state', uuid);
      expect(key).toBe('s0');
    });

    it('resolving and getting short key is reversible for non-default team', () => {
      const uuid = resolveShortKey(registry, 'state', 'sqm:s0');
      const key = getShortKey(registry, 'state', uuid);
      expect(key).toBe('sqm:s0');
    });

    it('flexible input resolves to canonical key', () => {
      // "sqt:s0" (flexible input) -> UUID -> "s0" (canonical clean key)
      const uuid = resolveShortKey(registry, 'state', 'sqt:s0');
      const key = getShortKey(registry, 'state', uuid);
      expect(key).toBe('s0'); // Should be clean key (canonical form)
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: TTL & Staleness
// ─────────────────────────────────────────────────────────────────────────────

describe('isStale', () => {
  it('returns false for stdio transport (never stale)', () => {
    const registry = createEmptyRegistry('test', 'stdio');
    expect(isStale(registry)).toBe(false);
  });

  it('returns false for fresh http registry', () => {
    const registry = createEmptyRegistry('test', 'http');
    expect(isStale(registry)).toBe(false);
  });

  it('returns true for old http registry (> 30 min)', () => {
    const registry = createEmptyRegistry('test', 'http');
    // Manually set generatedAt to 31 minutes ago
    registry.generatedAt = new Date(Date.now() - 31 * 60 * 1000);
    expect(isStale(registry)).toBe(true);
  });

  it('respects transport parameter override', () => {
    const registry = createEmptyRegistry('test', 'http');
    registry.generatedAt = new Date(Date.now() - 31 * 60 * 1000);

    // With http transport, it's stale
    expect(isStale(registry, 'http')).toBe(true);

    // With stdio override, it's not stale
    expect(isStale(registry, 'stdio')).toBe(false);
  });

  it('returns false for unknown transport', () => {
    const registry = createEmptyRegistry('test');
    registry.generatedAt = new Date(Date.now() - 60 * 60 * 1000);
    expect(isStale(registry)).toBe(false);
  });
});

describe('getRegistryAge', () => {
  it('returns age in milliseconds', () => {
    const registry = createEmptyRegistry();
    // Fresh registry should be very young
    expect(getRegistryAge(registry)).toBeLessThan(100);
  });

  it('returns correct age for older registry', () => {
    const registry = createEmptyRegistry();
    registry.generatedAt = new Date(Date.now() - 5000);
    expect(getRegistryAge(registry)).toBeGreaterThanOrEqual(5000);
  });
});

describe('getRemainingTtl', () => {
  it('returns Infinity for stdio transport', () => {
    const registry = createEmptyRegistry('test', 'stdio');
    expect(getRemainingTtl(registry)).toBe(Infinity);
  });

  it('returns remaining time for http transport', () => {
    const registry = createEmptyRegistry('test', 'http');
    const ttl = getRemainingTtl(registry);
    // Should be close to 30 minutes (give or take execution time)
    expect(ttl).toBeGreaterThan(29 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('returns 0 for expired http registry', () => {
    const registry = createEmptyRegistry('test', 'http');
    registry.generatedAt = new Date(Date.now() - 31 * 60 * 1000);
    expect(getRemainingTtl(registry)).toBe(0);
  });

  it('returns Infinity for unknown transport', () => {
    const registry = createEmptyRegistry('test');
    expect(getRemainingTtl(registry)).toBe(Infinity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Registry Storage
// ─────────────────────────────────────────────────────────────────────────────

describe('registry storage', () => {
  beforeEach(() => {
    clearAllRegistries();
  });

  afterEach(() => {
    clearAllRegistries();
  });

  it('stores and retrieves registry by session ID', () => {
    const registry = buildRegistry(createTestBuildData());
    storeRegistry('session-1', registry);

    const retrieved = getStoredRegistry('session-1');
    expect(retrieved).toBe(registry);
  });

  it('returns undefined for unknown session', () => {
    expect(getStoredRegistry('unknown-session')).toBeUndefined();
  });

  it('clears registry for a session', () => {
    const registry = buildRegistry(createTestBuildData());
    storeRegistry('session-1', registry);

    clearRegistry('session-1');
    expect(getStoredRegistry('session-1')).toBeUndefined();
  });

  it('clears all registries', () => {
    const registry = buildRegistry(createTestBuildData());
    storeRegistry('session-1', registry);
    storeRegistry('session-2', registry);

    clearAllRegistries();
    expect(getStoredRegistry('session-1')).toBeUndefined();
    expect(getStoredRegistry('session-2')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Concurrent Initialization
// ─────────────────────────────────────────────────────────────────────────────

describe('getOrInitRegistry', () => {
  beforeEach(() => {
    clearAllRegistries();
  });

  afterEach(() => {
    clearAllRegistries();
  });

  it('initializes registry on first call', async () => {
    const fetchData = async () => createTestBuildData();

    const registry = await getOrInitRegistry(
      { sessionId: 'test-session', transport: 'stdio' },
      fetchData,
    );

    expect(registry.users.get('u0')).toBe('user-uuid-alice');
    expect(registry.transport).toBe('stdio');
  });

  it('returns existing registry on subsequent calls', async () => {
    let fetchCount = 0;
    const fetchData = async () => {
      fetchCount++;
      return createTestBuildData();
    };

    const context = { sessionId: 'test-session' };
    const registry1 = await getOrInitRegistry(context, fetchData);
    const registry2 = await getOrInitRegistry(context, fetchData);

    expect(fetchCount).toBe(1); // Only fetched once
    expect(registry1).toBe(registry2);
  });

  it('reuses in-flight initialization promise', async () => {
    let fetchCount = 0;
    const fetchData = async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate delay
      return createTestBuildData();
    };

    const context = { sessionId: 'test-session' };

    // Start two concurrent initializations
    const [registry1, registry2] = await Promise.all([
      getOrInitRegistry(context, fetchData),
      getOrInitRegistry(context, fetchData),
    ]);

    expect(fetchCount).toBe(1); // Only fetched once despite concurrent calls
    expect(registry1).toBe(registry2);
  });

  it('force refresh reinitializes registry', async () => {
    let fetchCount = 0;
    const fetchData = async () => {
      fetchCount++;
      return createTestBuildData();
    };

    const context = { sessionId: 'test-session' };
    await getOrInitRegistry(context, fetchData);
    await getOrInitRegistry({ ...context, forceRefresh: true }, fetchData);

    expect(fetchCount).toBe(2);
  });

  it('refreshes stale http registry automatically', async () => {
    let fetchCount = 0;
    const fetchData = async () => {
      fetchCount++;
      return createTestBuildData();
    };

    // Initialize with http transport
    const context = { sessionId: 'test-session', transport: 'http' as const };
    const registry = await getOrInitRegistry(context, fetchData);

    // Make it stale
    registry.generatedAt = new Date(Date.now() - 31 * 60 * 1000);
    storeRegistry('test-session', registry);

    // Should reinitialize due to staleness
    await getOrInitRegistry(context, fetchData);
    expect(fetchCount).toBe(2);
  });

  it('throws ToonRegistryError on fetch failure', async () => {
    const fetchData = async () => {
      throw new Error('API unavailable');
    };

    await expect(
      getOrInitRegistry({ sessionId: 'test-session' }, fetchData),
    ).rejects.toThrow(ToonRegistryError);

    try {
      await getOrInitRegistry({ sessionId: 'test-session2' }, fetchData);
    } catch (error) {
      expect((error as ToonRegistryError).code).toBe('REGISTRY_INIT_FAILED');
      expect((error as ToonRegistryError).cause).toContain('API unavailable');
      expect((error as ToonRegistryError).hint).toContain('Linear API');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

describe('getRegistryStats', () => {
  it('returns correct counts', () => {
    const registry = buildRegistry(createTestBuildData());
    const stats = getRegistryStats(registry);

    expect(stats.userCount).toBe(3);
    expect(stats.stateCount).toBe(5);
    expect(stats.projectCount).toBe(2);
  });

  it('includes age and staleness info', () => {
    const registry = buildRegistry(createTestBuildData());
    registry.transport = 'http';

    const stats = getRegistryStats(registry);

    expect(stats.ageMs).toBeGreaterThanOrEqual(0);
    expect(stats.isStale).toBe(false);
    expect(stats.transport).toBe('http');
  });
});

describe('listShortKeys', () => {
  it('returns sorted user keys', () => {
    const registry = buildRegistry(createTestBuildData());
    const keys = listShortKeys(registry, 'user');

    expect(keys).toEqual(['u0', 'u1', 'u2']);
  });

  it('returns sorted state keys', () => {
    const registry = buildRegistry(createTestBuildData());
    const keys = listShortKeys(registry, 'state');

    expect(keys).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('returns sorted project keys', () => {
    const registry = buildRegistry(createTestBuildData());
    const keys = listShortKeys(registry, 'project');

    expect(keys).toEqual(['pr0', 'pr1']);
  });

  it('returns empty array for empty registry', () => {
    const registry = createEmptyRegistry();
    expect(listShortKeys(registry, 'user')).toEqual([]);
  });
});

describe('hasShortKey', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns true for existing key', () => {
    expect(hasShortKey(registry, 'user', 'u0')).toBe(true);
    expect(hasShortKey(registry, 'state', 's4')).toBe(true);
    expect(hasShortKey(registry, 'project', 'pr1')).toBe(true);
  });

  it('returns false for non-existing key', () => {
    expect(hasShortKey(registry, 'user', 'u99')).toBe(false);
    expect(hasShortKey(registry, 'state', 's99')).toBe(false);
    expect(hasShortKey(registry, 'project', 'pr99')).toBe(false);
  });
});

describe('hasUuid', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('returns true for existing UUID', () => {
    expect(hasUuid(registry, 'user', 'user-uuid-alice')).toBe(true);
    expect(hasUuid(registry, 'state', 'state-uuid-done')).toBe(true);
    expect(hasUuid(registry, 'project', 'project-uuid-beta')).toBe(true);
  });

  it('returns false for non-existing UUID', () => {
    expect(hasUuid(registry, 'user', 'unknown-uuid')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles entities with same createdAt timestamp', () => {
    // When timestamps are the same, order should still be deterministic
    const data: RegistryBuildData = {
      users: [
        { id: 'user-a', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'user-b', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'user-c', createdAt: '2024-01-01T00:00:00Z' },
      ],
      states: [],
      projects: [],
      workspaceId: 'test',
    };

    const registry1 = buildRegistry(data);
    const registry2 = buildRegistry(data);

    // Should produce same mapping each time
    expect(registry1.users.get('u0')).toBe(registry2.users.get('u0'));
    expect(registry1.users.get('u1')).toBe(registry2.users.get('u1'));
    expect(registry1.users.get('u2')).toBe(registry2.users.get('u2'));
  });

  it('handles large registries', () => {
    const users: RegistryEntity[] = [];
    for (let i = 0; i < 100; i++) {
      users.push({
        id: `user-${i}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      });
    }

    const data: RegistryBuildData = {
      users,
      states: [],
      projects: [],
      workspaceId: 'test',
    };

    const registry = buildRegistry(data);

    expect(registry.users.size).toBe(100);
    expect(hasShortKey(registry, 'user', 'u0')).toBe(true);
    expect(hasShortKey(registry, 'user', 'u99')).toBe(true);
    expect(hasShortKey(registry, 'user', 'u100')).toBe(false);
  });

  it('bidirectional mappings are consistent', () => {
    const registry = buildRegistry(createTestBuildData());

    // For each user, forward and reverse mappings should match
    for (const [shortKey, uuid] of registry.users) {
      expect(registry.usersByUuid.get(uuid)).toBe(shortKey);
    }

    // Same for states
    for (const [shortKey, uuid] of registry.states) {
      expect(registry.statesByUuid.get(uuid)).toBe(shortKey);
    }

    // Same for projects
    for (const [shortKey, uuid] of registry.projects) {
      expect(registry.projectsByUuid.get(uuid)).toBe(shortKey);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Helper Functions (getTeamPrefix, parseShortKey, parseLabelKey)
// ─────────────────────────────────────────────────────────────────────────────

describe('getTeamPrefix', () => {
  it('returns empty string for default team', () => {
    const teamKeys = new Map([
      ['team-sqt-uuid', 'sqt'],
      ['team-sqm-uuid', 'sqm'],
    ]);
    const result = getTeamPrefix('team-sqt-uuid', 'team-sqt-uuid', teamKeys);
    expect(result).toBe('');
  });

  it('returns lowercase team key with colon for non-default teams', () => {
    const teamKeys = new Map([
      ['team-sqt-uuid', 'sqt'],
      ['team-sqm-uuid', 'sqm'],
      ['team-eng-uuid', 'eng'],
    ]);
    // SQM is not the default team (SQT is)
    const result = getTeamPrefix('team-sqm-uuid', 'team-sqt-uuid', teamKeys);
    expect(result).toBe('sqm:');

    // ENG is not the default team
    const result2 = getTeamPrefix('team-eng-uuid', 'team-sqt-uuid', teamKeys);
    expect(result2).toBe('eng:');
  });

  it('returns empty string when defaultTeamId is undefined', () => {
    const teamKeys = new Map([
      ['team-sqt-uuid', 'sqt'],
      ['team-sqm-uuid', 'sqm'],
    ]);
    const result = getTeamPrefix('team-sqm-uuid', undefined, teamKeys);
    expect(result).toBe('');
  });

  it('returns empty string when teamKeys map is undefined', () => {
    const result = getTeamPrefix('team-sqm-uuid', 'team-sqt-uuid', undefined);
    expect(result).toBe('');
  });

  it('returns empty string when teamId not found in teamKeys', () => {
    const teamKeys = new Map([['team-sqt-uuid', 'sqt']]);
    // Unknown team ID
    const result = getTeamPrefix('team-unknown-uuid', 'team-sqt-uuid', teamKeys);
    expect(result).toBe('');
  });
});

describe('parseShortKey', () => {
  it('parses sqm:s0 to { teamPrefix: "sqm", type: "state", index: 0 }', () => {
    const result = parseShortKey('sqm:s0');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      type: 'state',
      index: 0,
    });
  });

  it('parses u0 to { teamPrefix: undefined, type: "user", index: 0 }', () => {
    const result = parseShortKey('u0');
    expect(result).toEqual({
      teamPrefix: undefined,
      type: 'user',
      index: 0,
    });
  });

  it('parses pr10 to { teamPrefix: undefined, type: "project", index: 10 }', () => {
    const result = parseShortKey('pr10');
    expect(result).toEqual({
      teamPrefix: undefined,
      type: 'project',
      index: 10,
    });
  });

  it('parses eng:u5 to { teamPrefix: "eng", type: "user", index: 5 }', () => {
    const result = parseShortKey('eng:u5');
    expect(result).toEqual({
      teamPrefix: 'eng',
      type: 'user',
      index: 5,
    });
  });

  it('returns undefined for invalid format like "invalid"', () => {
    expect(parseShortKey('invalid')).toBeUndefined();
    expect(parseShortKey('xyz')).toBeUndefined();
    expect(parseShortKey('123')).toBeUndefined();
    expect(parseShortKey('')).toBeUndefined();
  });

  it('parses state keys with various indices', () => {
    expect(parseShortKey('s0')).toEqual({
      teamPrefix: undefined,
      type: 'state',
      index: 0,
    });
    expect(parseShortKey('s99')).toEqual({
      teamPrefix: undefined,
      type: 'state',
      index: 99,
    });
    expect(parseShortKey('sqt:s123')).toEqual({
      teamPrefix: 'sqt',
      type: 'state',
      index: 123,
    });
  });

  it('handles uppercase team prefix by converting to lowercase', () => {
    const result = parseShortKey('SQM:s5');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      type: 'state',
      index: 5,
    });
  });

  it('parses project keys with team prefix', () => {
    const result = parseShortKey('dev:pr3');
    expect(result).toEqual({
      teamPrefix: 'dev',
      type: 'project',
      index: 3,
    });
  });
});

describe('parseLabelKey', () => {
  it('parses sqm:Bugs to { teamPrefix: "sqm", labelName: "Bugs" }', () => {
    const result = parseLabelKey('sqm:Bugs');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      labelName: 'Bugs',
    });
  });

  it('parses sqm:Herramientas/Airtable preserving slash', () => {
    const result = parseLabelKey('sqm:Herramientas/Airtable');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      labelName: 'Herramientas/Airtable',
    });
  });

  it('parses Bug to { teamPrefix: undefined, labelName: "Bug" }', () => {
    const result = parseLabelKey('Bug');
    expect(result).toEqual({
      teamPrefix: undefined,
      labelName: 'Bug',
    });
  });

  it('handles labels with colons in name - only first colon is separator', () => {
    // Label name contains a colon: "My:Label:Name"
    const result = parseLabelKey('sqm:My:Label:Name');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      labelName: 'My:Label:Name',
    });
  });

  it('handles label name that looks like a time (10:30)', () => {
    const result = parseLabelKey('eng:10:30');
    expect(result).toEqual({
      teamPrefix: 'eng',
      labelName: '10:30',
    });
  });

  it('handles empty prefix (colon at start)', () => {
    // Colon at position 0 means no prefix (colonIndex > 0 check fails)
    const result = parseLabelKey(':NoPrefixLabel');
    expect(result).toEqual({
      teamPrefix: undefined,
      labelName: ':NoPrefixLabel',
    });
  });

  it('converts team prefix to lowercase', () => {
    const result = parseLabelKey('SQM:HighPriority');
    expect(result).toEqual({
      teamPrefix: 'sqm',
      labelName: 'HighPriority',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: DEFAULT_TEAM Not Set Behavior
// ─────────────────────────────────────────────────────────────────────────────

describe('when DEFAULT_TEAM not set', () => {
  it('assigns prefixed keys to ALL team states when teams provided but no defaultTeamId', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'sqt-state-1',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqm-state-1',
          createdAt: new Date('2024-01-02'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
        {
          id: 'sqt-state-2',
          createdAt: new Date('2024-01-03'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-sqt-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      // NO defaultTeamId - this triggers legacy sequential behavior
    };

    const registry = buildRegistry(data);

    // Without defaultTeamId, falls back to simple sequential keys
    expect(registry.states.get('s0')).toBe('sqt-state-1');
    expect(registry.states.get('s1')).toBe('sqm-state-1');
    expect(registry.states.get('s2')).toBe('sqt-state-2');
    expect(registry.statesByUuid.get('sqt-state-1')).toBe('s0');
    expect(registry.statesByUuid.get('sqm-state-1')).toBe('s1');
    expect(registry.statesByUuid.get('sqt-state-2')).toBe('s2');
  });

  it('users and projects remain global (no prefix) regardless of team context', () => {
    const data: RegistryBuildData = {
      users: [
        {
          id: 'user-1',
          createdAt: new Date('2024-01-01'),
          name: 'Alice',
          displayName: 'alice',
          email: 'alice@example.com',
          active: true,
        },
        {
          id: 'user-2',
          createdAt: new Date('2024-01-02'),
          name: 'Bob',
          displayName: 'bob',
          email: 'bob@example.com',
          active: true,
        },
      ],
      states: [],
      projects: [
        {
          id: 'project-1',
          createdAt: new Date('2024-01-01'),
          name: 'Project Alpha',
          state: 'started',
        },
        {
          id: 'project-2',
          createdAt: new Date('2024-01-02'),
          name: 'Project Beta',
          state: 'planned',
        },
      ],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };

    const registry = buildRegistry(data);

    // Users get global keys (u0, u1) - no team prefix ever
    expect(registry.users.get('u0')).toBe('user-1');
    expect(registry.users.get('u1')).toBe('user-2');
    expect(registry.usersByUuid.get('user-1')).toBe('u0');
    expect(registry.usersByUuid.get('user-2')).toBe('u1');

    // Verify no prefixed user keys exist
    expect(registry.users.has('sqt:u0')).toBe(false);
    expect(registry.users.has('sqm:u0')).toBe(false);

    // Projects get global keys (pr0, pr1) - no team prefix ever
    expect(registry.projects.get('pr0')).toBe('project-1');
    expect(registry.projects.get('pr1')).toBe('project-2');
    expect(registry.projectsByUuid.get('project-1')).toBe('pr0');
    expect(registry.projectsByUuid.get('project-2')).toBe('pr1');

    // Verify no prefixed project keys exist
    expect(registry.projects.has('sqt:pr0')).toBe(false);
    expect(registry.projects.has('sqm:pr0')).toBe(false);
  });

  it('builds teamKeys map even when no defaultTeamId', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      // No defaultTeamId
    };

    const registry = buildRegistry(data);

    // teamKeys should still be populated
    expect(registry.teamKeys.get('team-sqt-uuid')).toBe('sqt');
    expect(registry.teamKeys.get('team-sqm-uuid')).toBe('sqm');
    expect(registry.defaultTeamId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Flexible Input Resolution (Additional Edge Cases)
// ─────────────────────────────────────────────────────────────────────────────

describe('flexible input resolution - additional edge cases', () => {
  const createMultiTeamRegistry = (): ShortKeyRegistry => {
    const data: RegistryBuildData = {
      users: [
        {
          id: 'user-1',
          createdAt: new Date('2024-01-01'),
          name: 'Alice',
          displayName: 'alice',
          email: 'alice@example.com',
          active: true,
        },
        {
          id: 'user-2',
          createdAt: new Date('2024-01-02'),
          name: 'Bob',
          displayName: 'bob',
          email: 'bob@example.com',
          active: true,
        },
      ],
      states: [
        {
          id: 'sqt-todo',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-done',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqm-todo',
          createdAt: new Date('2024-01-03'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
        {
          id: 'sqm-done',
          createdAt: new Date('2024-01-04'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-sqm-uuid',
        },
      ],
      projects: [
        {
          id: 'project-1',
          createdAt: new Date('2024-01-01'),
          name: 'Project Alpha',
          state: 'started',
        },
        {
          id: 'project-2',
          createdAt: new Date('2024-01-02'),
          name: 'Project Beta',
          state: 'planned',
        },
      ],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };
    return buildRegistry(data);
  };

  describe('resolves sqt:s0 same as s0 for default team', () => {
    it('both resolve to same UUID', () => {
      const registry = createMultiTeamRegistry();

      // Both "s0" and "sqt:s0" should resolve to the same UUID
      const uuidClean = resolveShortKey(registry, 'state', 's0');
      const uuidPrefixed = resolveShortKey(registry, 'state', 'sqt:s0');

      expect(uuidClean).toBe('sqt-todo');
      expect(uuidPrefixed).toBe('sqt-todo');
      expect(uuidClean).toBe(uuidPrefixed);
    });
  });

  describe('resolves sqt:u0 same as u0 for default team', () => {
    it('strips team prefix from user keys', () => {
      const registry = createMultiTeamRegistry();

      // Users are global, so "sqt:u0" should normalize to "u0"
      const uuidClean = resolveShortKey(registry, 'user', 'u0');
      const uuidPrefixed = resolveShortKey(registry, 'user', 'sqt:u0');

      expect(uuidClean).toBe('user-1');
      expect(uuidPrefixed).toBe('user-1');
      expect(uuidClean).toBe(uuidPrefixed);
    });
  });

  describe('resolves sqt:pr0 same as pr0 for default team', () => {
    it('strips team prefix from project keys', () => {
      const registry = createMultiTeamRegistry();

      // Projects are global, so "sqt:pr0" should normalize to "pr0"
      const uuidClean = resolveShortKey(registry, 'project', 'pr0');
      const uuidPrefixed = resolveShortKey(registry, 'project', 'sqt:pr0');

      expect(uuidClean).toBe('project-1');
      expect(uuidPrefixed).toBe('project-1');
      expect(uuidClean).toBe(uuidPrefixed);
    });
  });

  describe('does not normalize prefix for non-default teams', () => {
    it('sqm:s0 stays as sqm:s0 (not normalized)', () => {
      const registry = createMultiTeamRegistry();

      // SQM is non-default, so "sqm:s0" resolves to SQM's first state
      const uuid = resolveShortKey(registry, 'state', 'sqm:s0');
      expect(uuid).toBe('sqm-todo');

      // Verify this is different from the default team's s0
      const defaultUuid = resolveShortKey(registry, 'state', 's0');
      expect(defaultUuid).toBe('sqt-todo');
      expect(uuid).not.toBe(defaultUuid);
    });

    it('any team prefix on global entity types is stripped', () => {
      const registry = createMultiTeamRegistry();

      // Even non-default team prefixes are stripped for users/projects
      expect(resolveShortKey(registry, 'user', 'sqm:u0')).toBe('user-1');
      expect(resolveShortKey(registry, 'project', 'sqm:pr1')).toBe('project-2');
    });
  });

  describe('mixed case handling', () => {
    it('handles uppercase, lowercase, and mixed case team prefixes', () => {
      const registry = createMultiTeamRegistry();

      // All of these should resolve to SQM's first state
      expect(resolveShortKey(registry, 'state', 'sqm:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'SQM:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'Sqm:s0')).toBe('sqm-todo');
      expect(resolveShortKey(registry, 'state', 'sQm:s0')).toBe('sqm-todo');
    });

    it('handles uppercase default team prefix', () => {
      const registry = createMultiTeamRegistry();

      // SQT is default team - uppercase/mixed should still normalize
      expect(resolveShortKey(registry, 'state', 'SQT:s0')).toBe('sqt-todo');
      expect(resolveShortKey(registry, 'state', 'Sqt:s0')).toBe('sqt-todo');
    });
  });

  describe('error handling for unknown team prefixes', () => {
    it('throws ToonResolutionError for completely unknown team prefix on states', () => {
      const registry = createMultiTeamRegistry();

      // "xyz" is not a known team
      expect(() => resolveShortKey(registry, 'state', 'xyz:s0')).toThrow(
        ToonResolutionError,
      );
    });

    it('returns undefined from tryResolveShortKey for unknown team prefix', () => {
      const registry = createMultiTeamRegistry();

      expect(tryResolveShortKey(registry, 'state', 'xyz:s0')).toBeUndefined();
    });

    it('strips unknown team prefix for global entities (users/projects)', () => {
      const registry = createMultiTeamRegistry();

      // For users and projects, any prefix is stripped
      // So "xyz:u0" becomes "u0" which should resolve
      expect(resolveShortKey(registry, 'user', 'xyz:u0')).toBe('user-1');
      expect(resolveShortKey(registry, 'project', 'xyz:pr0')).toBe('project-1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Multiple Teams with Different State Counts
// ─────────────────────────────────────────────────────────────────────────────

describe('multiple teams with varying state counts', () => {
  it('handles teams with different numbers of states', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        // SQT has 5 states
        {
          id: 'sqt-s0',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          name: 'Triage',
          type: 'triage',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-s1',
          createdAt: new Date('2024-01-01T01:00:00Z'),
          name: 'Backlog',
          type: 'backlog',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-s2',
          createdAt: new Date('2024-01-01T02:00:00Z'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-s3',
          createdAt: new Date('2024-01-01T03:00:00Z'),
          name: 'In Progress',
          type: 'started',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-s4',
          createdAt: new Date('2024-01-01T04:00:00Z'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-sqt-uuid',
        },
        // SQM has only 2 states
        {
          id: 'sqm-s0',
          createdAt: new Date('2024-01-02T00:00:00Z'),
          name: 'Open',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
        {
          id: 'sqm-s1',
          createdAt: new Date('2024-01-02T01:00:00Z'),
          name: 'Closed',
          type: 'completed',
          teamId: 'team-sqm-uuid',
        },
        // ENG has 3 states
        {
          id: 'eng-s0',
          createdAt: new Date('2024-01-03T00:00:00Z'),
          name: 'New',
          type: 'unstarted',
          teamId: 'team-eng-uuid',
        },
        {
          id: 'eng-s1',
          createdAt: new Date('2024-01-03T01:00:00Z'),
          name: 'Working',
          type: 'started',
          teamId: 'team-eng-uuid',
        },
        {
          id: 'eng-s2',
          createdAt: new Date('2024-01-03T02:00:00Z'),
          name: 'Complete',
          type: 'completed',
          teamId: 'team-eng-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
        { id: 'team-eng-uuid', key: 'ENG' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };

    const registry = buildRegistry(data);

    // Default team (SQT) has s0-s4
    expect(registry.states.get('s0')).toBe('sqt-s0');
    expect(registry.states.get('s1')).toBe('sqt-s1');
    expect(registry.states.get('s2')).toBe('sqt-s2');
    expect(registry.states.get('s3')).toBe('sqt-s3');
    expect(registry.states.get('s4')).toBe('sqt-s4');
    expect(registry.states.has('s5')).toBe(false);

    // SQM has sqm:s0-s1
    expect(registry.states.get('sqm:s0')).toBe('sqm-s0');
    expect(registry.states.get('sqm:s1')).toBe('sqm-s1');
    expect(registry.states.has('sqm:s2')).toBe(false);

    // ENG has eng:s0-s2
    expect(registry.states.get('eng:s0')).toBe('eng-s0');
    expect(registry.states.get('eng:s1')).toBe('eng-s1');
    expect(registry.states.get('eng:s2')).toBe('eng-s2');
    expect(registry.states.has('eng:s3')).toBe(false);

    // Total state count
    expect(registry.states.size).toBe(10); // 5 + 2 + 3
  });

  it('preserves state metadata with correct teamId', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'sqt-todo',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqm-pending',
          createdAt: new Date('2024-01-02'),
          name: 'Pending',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };

    const registry = buildRegistry(data);

    // Check metadata for default team state
    const sqtMeta = registry.stateMetadata.get('sqt-todo');
    expect(sqtMeta).toBeDefined();
    expect(sqtMeta?.name).toBe('Todo');
    expect(sqtMeta?.type).toBe('unstarted');
    expect(sqtMeta?.teamId).toBe('team-sqt-uuid');

    // Check metadata for non-default team state
    const sqmMeta = registry.stateMetadata.get('sqm-pending');
    expect(sqmMeta).toBeDefined();
    expect(sqmMeta?.name).toBe('Pending');
    expect(sqmMeta?.type).toBe('unstarted');
    expect(sqmMeta?.teamId).toBe('team-sqm-uuid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: listShortKeys with Multi-Team States
// ─────────────────────────────────────────────────────────────────────────────

describe('listShortKeys with multi-team states', () => {
  it('lists all state keys including prefixed ones', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'sqt-s0',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqt-s1',
          createdAt: new Date('2024-01-02'),
          name: 'Done',
          type: 'completed',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqm-s0',
          createdAt: new Date('2024-01-03'),
          name: 'Open',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };

    const registry = buildRegistry(data);
    const keys = listShortKeys(registry, 'state');

    // Should include both clean keys and prefixed keys
    expect(keys).toContain('s0');
    expect(keys).toContain('s1');
    expect(keys).toContain('sqm:s0');
    expect(keys.length).toBe(3);
  });

  it('hasShortKey works with prefixed keys', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [
        {
          id: 'sqt-s0',
          createdAt: new Date('2024-01-01'),
          name: 'Todo',
          type: 'unstarted',
          teamId: 'team-sqt-uuid',
        },
        {
          id: 'sqm-s0',
          createdAt: new Date('2024-01-02'),
          name: 'Open',
          type: 'unstarted',
          teamId: 'team-sqm-uuid',
        },
      ],
      projects: [],
      workspaceId: 'workspace-1',
      teams: [
        { id: 'team-sqt-uuid', key: 'SQT' },
        { id: 'team-sqm-uuid', key: 'SQM' },
      ],
      defaultTeamId: 'team-sqt-uuid',
    };

    const registry = buildRegistry(data);

    expect(hasShortKey(registry, 'state', 's0')).toBe(true);
    expect(hasShortKey(registry, 'state', 'sqm:s0')).toBe(true);
    expect(hasShortKey(registry, 'state', 'sqt:s0')).toBe(false); // Not stored with prefix for default team
    expect(hasShortKey(registry, 'state', 'eng:s0')).toBe(false); // Non-existent team
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: registerNewProject
// ─────────────────────────────────────────────────────────────────────────────

describe('registerNewProject', () => {
  let registry: ShortKeyRegistry;

  beforeEach(() => {
    registry = buildRegistry(createTestBuildData());
  });

  it('assigns next available key correctly', () => {
    // Existing registry has pr0 (alpha) and pr1 (beta)
    expect(registry.projects.size).toBe(2);
    expect(registry.projects.get('pr0')).toBe('project-uuid-alpha');
    expect(registry.projects.get('pr1')).toBe('project-uuid-beta');

    const metadata: ProjectMetadata = {
      name: 'Gamma Project',
      state: 'planned',
    };
    const key = registerNewProject(registry, 'project-uuid-gamma', metadata);

    expect(key).toBe('pr2');
    expect(registry.projects.size).toBe(3);
  });

  it('assigns sequential keys for multiple new projects', () => {
    const key1 = registerNewProject(registry, 'project-uuid-gamma', {
      name: 'Gamma',
      state: 'planned',
    });
    const key2 = registerNewProject(registry, 'project-uuid-delta', {
      name: 'Delta',
      state: 'started',
    });
    const key3 = registerNewProject(registry, 'project-uuid-epsilon', {
      name: 'Epsilon',
      state: 'completed',
    });

    expect(key1).toBe('pr2');
    expect(key2).toBe('pr3');
    expect(key3).toBe('pr4');
  });

  it('handles gaps in key sequence (max+1 strategy)', () => {
    // Manually create a gap: remove pr0 but keep pr1
    registry.projects.delete('pr0');
    registry.projectsByUuid.delete('project-uuid-alpha');

    // Even though there is a gap at pr0, next key should be max+1 = pr2
    const key = registerNewProject(registry, 'project-uuid-gamma', {
      name: 'Gamma',
      state: 'planned',
    });

    expect(key).toBe('pr2');
  });

  it('updates both bidirectional maps', () => {
    const uuid = 'project-uuid-gamma';
    const key = registerNewProject(registry, uuid, {
      name: 'Gamma',
      state: 'planned',
    });

    // Forward map: short key -> UUID
    expect(registry.projects.get(key)).toBe(uuid);

    // Reverse map: UUID -> short key
    expect(registry.projectsByUuid.get(uuid)).toBe(key);
  });

  it('stores metadata correctly', () => {
    const uuid = 'project-uuid-gamma';
    const metadata: ProjectMetadata = {
      name: 'Gamma Project',
      state: 'started',
      priority: 2,
      progress: 0.45,
      leadId: 'user-uuid-alice',
      targetDate: '2026-06-01',
    };

    const key = registerNewProject(registry, uuid, metadata);

    const stored = registry.projectMetadata.get(uuid);
    expect(stored).toBeDefined();
    expect(stored!.name).toBe('Gamma Project');
    expect(stored!.state).toBe('started');
    expect(stored!.priority).toBe(2);
    expect(stored!.progress).toBe(0.45);
    expect(stored!.leadId).toBe('user-uuid-alice');
    expect(stored!.targetDate).toBe('2026-06-01');

    // Verify the key is correct
    expect(key).toBe('pr2');
  });

  it('stores metadata with only required fields', () => {
    const uuid = 'project-uuid-minimal';
    const metadata: ProjectMetadata = {
      name: 'Minimal Project',
      state: 'planned',
    };

    registerNewProject(registry, uuid, metadata);

    const stored = registry.projectMetadata.get(uuid);
    expect(stored).toBeDefined();
    expect(stored!.name).toBe('Minimal Project');
    expect(stored!.state).toBe('planned');
    expect(stored!.priority).toBeUndefined();
    expect(stored!.progress).toBeUndefined();
    expect(stored!.leadId).toBeUndefined();
    expect(stored!.targetDate).toBeUndefined();
  });

  it('tryGetShortKey returns undefined for unknown project UUID', () => {
    expect(tryGetShortKey(registry, 'project', 'unknown-uuid')).toBeUndefined();
  });

  it('tryGetShortKey returns key for newly registered project', () => {
    const uuid = 'project-uuid-gamma';
    registerNewProject(registry, uuid, {
      name: 'Gamma',
      state: 'planned',
    });

    expect(tryGetShortKey(registry, 'project', uuid)).toBe('pr2');
  });

  it('works on an empty registry', () => {
    const emptyRegistry = buildRegistry({
      users: [],
      states: [],
      projects: [],
      workspaceId: 'empty-workspace',
    });

    const key = registerNewProject(emptyRegistry, 'project-uuid-first', {
      name: 'First Project',
      state: 'planned',
    });

    expect(key).toBe('pr0');
    expect(emptyRegistry.projects.get('pr0')).toBe('project-uuid-first');
    expect(emptyRegistry.projectsByUuid.get('project-uuid-first')).toBe('pr0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Deterministic project ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('deterministic project ordering', () => {
  it('assigns keys based on createdAt order (oldest first = pr0)', () => {
    const data: RegistryBuildData = {
      users: [],
      states: [],
      projects: [
        { id: 'project-newest', createdAt: '2024-06-01T00:00:00Z' },
        { id: 'project-oldest', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'project-middle', createdAt: '2024-03-15T00:00:00Z' },
      ],
      workspaceId: 'test',
    };

    const registry = buildRegistry(data);

    // Oldest first: oldest=pr0, middle=pr1, newest=pr2
    expect(registry.projects.get('pr0')).toBe('project-oldest');
    expect(registry.projects.get('pr1')).toBe('project-middle');
    expect(registry.projects.get('pr2')).toBe('project-newest');
  });

  it('produces identical keys regardless of input order', () => {
    const projects = [
      { id: 'project-c', createdAt: '2024-03-01T00:00:00Z' },
      { id: 'project-a', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'project-b', createdAt: '2024-02-01T00:00:00Z' },
    ];

    // Build with original order
    const registry1 = buildRegistry({
      users: [],
      states: [],
      projects: [...projects],
      workspaceId: 'test',
    });

    // Build with reversed order
    const registry2 = buildRegistry({
      users: [],
      states: [],
      projects: [...projects].reverse(),
      workspaceId: 'test',
    });

    // Build with shuffled order
    const registry3 = buildRegistry({
      users: [],
      states: [],
      projects: [projects[1], projects[2], projects[0]],
      workspaceId: 'test',
    });

    // All should produce the same mappings
    expect(registry1.projects.get('pr0')).toBe('project-a');
    expect(registry1.projects.get('pr1')).toBe('project-b');
    expect(registry1.projects.get('pr2')).toBe('project-c');

    expect(registry2.projects.get('pr0')).toBe(registry1.projects.get('pr0'));
    expect(registry2.projects.get('pr1')).toBe(registry1.projects.get('pr1'));
    expect(registry2.projects.get('pr2')).toBe(registry1.projects.get('pr2'));

    expect(registry3.projects.get('pr0')).toBe(registry1.projects.get('pr0'));
    expect(registry3.projects.get('pr1')).toBe(registry1.projects.get('pr1'));
    expect(registry3.projects.get('pr2')).toBe(registry1.projects.get('pr2'));
  });

  it('handles Date objects and ISO strings consistently', () => {
    const withStrings = buildRegistry({
      users: [],
      states: [],
      projects: [
        { id: 'project-b', createdAt: '2024-06-01T00:00:00Z' },
        { id: 'project-a', createdAt: '2024-01-01T00:00:00Z' },
      ],
      workspaceId: 'test',
    });

    const withDates = buildRegistry({
      users: [],
      states: [],
      projects: [
        { id: 'project-b', createdAt: new Date('2024-06-01T00:00:00Z') },
        { id: 'project-a', createdAt: new Date('2024-01-01T00:00:00Z') },
      ],
      workspaceId: 'test',
    });

    // Same ordering regardless of date format
    expect(withStrings.projects.get('pr0')).toBe('project-a');
    expect(withStrings.projects.get('pr1')).toBe('project-b');
    expect(withDates.projects.get('pr0')).toBe('project-a');
    expect(withDates.projects.get('pr1')).toBe('project-b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: Deactivated User Handling
// ─────────────────────────────────────────────────────────────────────────────

describe('deactivated user handling', () => {
  const createDeactivatedUserBuildData = (): RegistryBuildData => {
    const users: RegistryUserEntity[] = [
      {
        id: 'user-alice',
        createdAt: new Date('2024-01-02'),
        name: 'Alice Active',
        displayName: 'alice',
        email: 'alice@test.com',
        active: true,
      },
      {
        id: 'user-deactivated',
        createdAt: new Date('2024-01-01'), // oldest — would steal u0 if not filtered
        name: 'Deactivated Dave',
        displayName: 'dave',
        email: 'dave@test.com',
        active: false,
      },
      {
        id: 'user-bob',
        createdAt: new Date('2024-01-03'),
        name: 'Bob Builder',
        displayName: 'bob',
        email: 'bob@test.com',
        active: true,
      },
    ];

    return {
      users,
      states: [],
      projects: [],
      workspaceId: 'test-workspace',
    };
  };

  it('disabled users are excluded from short key assignment', () => {
    const data = createDeactivatedUserBuildData();
    const registry = buildRegistry(data);

    // Only 2 active users should have short keys
    expect(registry.users.size).toBe(2);

    // Alice (oldest active, 2024-01-02) = u0, Bob (2024-01-03) = u1
    expect(registry.users.get('u0')).toBe('user-alice');
    expect(registry.users.get('u1')).toBe('user-bob');
    expect(registry.users.has('u2')).toBe(false);

    // Deactivated user should NOT appear in reverse map
    expect(registry.usersByUuid.has('user-deactivated')).toBe(false);

    // Active users should be in reverse map
    expect(registry.usersByUuid.get('user-alice')).toBe('u0');
    expect(registry.usersByUuid.get('user-bob')).toBe('u1');
  });

  it('disabled users are present in userMetadata with active: false', () => {
    const data = createDeactivatedUserBuildData();
    const registry = buildRegistry(data);

    // Deactivated user should be in userMetadata
    const meta = registry.userMetadata.get('user-deactivated');
    expect(meta).toBeDefined();
    expect(meta?.active).toBe(false);
    expect(meta?.name).toBe('Deactivated Dave');
    expect(meta?.displayName).toBe('dave');
    expect(meta?.email).toBe('dave@test.com');

    // Active users should also be in userMetadata with active: true
    const aliceMeta = registry.userMetadata.get('user-alice');
    expect(aliceMeta).toBeDefined();
    expect(aliceMeta?.active).toBe(true);
    expect(aliceMeta?.name).toBe('Alice Active');
  });

  it('getUserStatusLabel returns (deactivated) for disabled user', () => {
    const data = createDeactivatedUserBuildData();
    const registry = buildRegistry(data);

    // Deactivated user in metadata with active: false
    expect(getUserStatusLabel(registry, 'user-deactivated')).toBe('(deactivated)');

    // Totally unknown UUID not in metadata at all
    expect(getUserStatusLabel(registry, 'totally-unknown-uuid')).toBe('(departed)');
  });
});
