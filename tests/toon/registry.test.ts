import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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
  hasShortKey,
  hasUuid,
  isStale,
  listShortKeys,
  type RegistryBuildData,
  type RegistryEntity,
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
