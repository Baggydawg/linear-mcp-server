/**
 * Short Key Registry for TOON output format.
 *
 * Provides session-scoped mapping between short keys (u0, s1, pr0) and UUIDs.
 * The registry is built from workspace data and enables:
 * - Encoding: Converting UUIDs to short keys for TOON output
 * - Decoding: Resolving short keys to UUIDs for Linear API calls
 *
 * Key assignment is deterministic: entities sorted by createdAt (ascending),
 * then assigned sequential keys (u0, u1... / s0, s1... / pr0, pr1...).
 */

import {
  ToonRegistryError,
  ToonResolutionError,
  unknownShortKeyError,
} from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entity types that use short key mappings.
 */
export type ShortKeyEntityType = 'user' | 'state' | 'project';

/**
 * Transport type affects TTL strategy.
 * - stdio: Claude Desktop, infinite TTL (user controls refresh)
 * - http: Cloudflare Workers, 30-minute TTL (stateless, shared server)
 */
export type TransportType = 'stdio' | 'http';

/**
 * Input data for a single entity to be registered.
 */
export interface RegistryEntity {
  /** UUID of the entity */
  id: string;
  /** When the entity was created (for deterministic ordering) */
  createdAt: Date | string;
}

/**
 * Input data for building the registry.
 */
export interface RegistryBuildData {
  /** Users to register (will be assigned u0, u1, ...) */
  users: RegistryEntity[];
  /** Workflow states to register (will be assigned s0, s1, ...) */
  states: RegistryEntity[];
  /** Projects to register (will be assigned pr0, pr1, ...) */
  projects: RegistryEntity[];
  /** Workspace ID for scoping */
  workspaceId: string;
}

/**
 * Session-scoped registry for short key to UUID resolution.
 *
 * Maintains bidirectional mappings:
 * - Short key -> UUID (for decoding Claude input to Linear API calls)
 * - UUID -> Short key (for encoding Linear data to TOON output)
 */
export interface ShortKeyRegistry {
  // ─────────────────────────────────────────────────────────────────────────
  // Short key -> UUID mappings (for decoding/resolving)
  // ─────────────────────────────────────────────────────────────────────────

  /** User short keys to UUIDs: u0 -> UUID */
  users: Map<string, string>;

  /** State short keys to UUIDs: s0 -> UUID */
  states: Map<string, string>;

  /** Project short keys to UUIDs: pr0 -> UUID */
  projects: Map<string, string>;

  // ─────────────────────────────────────────────────────────────────────────
  // UUID -> Short key mappings (for encoding)
  // ─────────────────────────────────────────────────────────────────────────

  /** User UUIDs to short keys: UUID -> u0 */
  usersByUuid: Map<string, string>;

  /** State UUIDs to short keys: UUID -> s0 */
  statesByUuid: Map<string, string>;

  /** Project UUIDs to short keys: UUID -> pr0 */
  projectsByUuid: Map<string, string>;

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /** When the registry was generated */
  generatedAt: Date;

  /** Workspace ID this registry belongs to */
  workspaceId: string;

  /** Transport type (affects TTL strategy) */
  transport?: TransportType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Short key prefixes by entity type */
const KEY_PREFIXES: Record<ShortKeyEntityType, string> = {
  user: 'u',
  state: 's',
  project: 'pr',
};

/** TTL for HTTP transport (30 minutes) */
const HTTP_TTL_MS = 30 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Registry Building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an empty registry structure.
 *
 * @param workspaceId - Workspace ID for the registry
 * @param transport - Transport type (affects TTL)
 * @returns Empty ShortKeyRegistry
 */
export function createEmptyRegistry(
  workspaceId = '',
  transport?: TransportType,
): ShortKeyRegistry {
  return {
    users: new Map(),
    states: new Map(),
    projects: new Map(),
    usersByUuid: new Map(),
    statesByUuid: new Map(),
    projectsByUuid: new Map(),
    generatedAt: new Date(),
    workspaceId,
    transport,
  };
}

/**
 * Sort entities by createdAt timestamp (ascending - oldest first).
 * This ensures deterministic key assignment.
 *
 * @param entities - Array of entities with createdAt
 * @returns Sorted array (does not mutate original)
 */
function sortByCreatedAt<T extends RegistryEntity>(entities: T[]): T[] {
  return [...entities].sort((a, b) => {
    const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
    const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
    return dateA.getTime() - dateB.getTime();
  });
}

/**
 * Build bidirectional maps for a single entity type.
 *
 * @param entities - Entities to map
 * @param prefix - Short key prefix (u, s, pr)
 * @returns Tuple of [shortKey -> UUID, UUID -> shortKey] maps
 */
function buildMapsForType(
  entities: RegistryEntity[],
  prefix: string,
): [Map<string, string>, Map<string, string>] {
  const sorted = sortByCreatedAt(entities);
  const keyToUuid = new Map<string, string>();
  const uuidToKey = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const shortKey = `${prefix}${i}`;
    const uuid = sorted[i].id;

    keyToUuid.set(shortKey, uuid);
    uuidToKey.set(uuid, shortKey);
  }

  return [keyToUuid, uuidToKey];
}

/**
 * Build a complete registry from workspace data.
 *
 * Entities are sorted by createdAt (ascending) and assigned sequential keys:
 * - Users: u0, u1, u2, ...
 * - States: s0, s1, s2, ...
 * - Projects: pr0, pr1, pr2, ...
 *
 * @param data - Workspace data with users, states, projects
 * @returns Complete ShortKeyRegistry
 */
export function buildRegistry(data: RegistryBuildData): ShortKeyRegistry {
  const [users, usersByUuid] = buildMapsForType(data.users, KEY_PREFIXES.user);
  const [states, statesByUuid] = buildMapsForType(data.states, KEY_PREFIXES.state);
  const [projects, projectsByUuid] = buildMapsForType(
    data.projects,
    KEY_PREFIXES.project,
  );

  return {
    users,
    states,
    projects,
    usersByUuid,
    statesByUuid,
    projectsByUuid,
    generatedAt: new Date(),
    workspaceId: data.workspaceId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the appropriate map for an entity type (short key -> UUID direction).
 */
function getKeyToUuidMap(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
): Map<string, string> {
  switch (type) {
    case 'user':
      return registry.users;
    case 'state':
      return registry.states;
    case 'project':
      return registry.projects;
  }
}

/**
 * Get the appropriate map for an entity type (UUID -> short key direction).
 */
function getUuidToKeyMap(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
): Map<string, string> {
  switch (type) {
    case 'user':
      return registry.usersByUuid;
    case 'state':
      return registry.statesByUuid;
    case 'project':
      return registry.projectsByUuid;
  }
}

/**
 * Get the short key for a UUID (for encoding Linear data -> TOON output).
 *
 * @param registry - The short key registry
 * @param type - Entity type (user, state, project)
 * @param uuid - The UUID to look up
 * @returns The short key (e.g., "u0", "s1", "pr2")
 * @throws ToonResolutionError if UUID not found in registry
 *
 * @example
 * ```typescript
 * const shortKey = getShortKey(registry, 'user', '186df438-...');
 * // Returns: 'u0'
 * ```
 */
export function getShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  uuid: string,
): string {
  const map = getUuidToKeyMap(registry, type);
  const shortKey = map.get(uuid);

  if (!shortKey) {
    const availableUuids = Array.from(map.keys()).slice(0, 5);
    throw new ToonResolutionError({
      code: 'ENTITY_NOT_FOUND',
      message: `UUID '${uuid}' not found in ${type} registry`,
      hint: `Registry contains ${map.size} ${type}(s). Sample UUIDs: ${availableUuids.join(', ')}${map.size > 5 ? '...' : ''}`,
      suggestion:
        'The entity may have been created after registry initialization. Call workspace_metadata({ forceRefresh: true }) to refresh.',
      entityType: type,
    });
  }

  return shortKey;
}

/**
 * Resolve a short key to its UUID (for decoding Claude input -> Linear API).
 *
 * @param registry - The short key registry
 * @param type - Entity type (user, state, project)
 * @param shortKey - The short key to resolve (e.g., "u0", "s1", "pr2")
 * @returns The UUID for the entity
 * @throws ToonResolutionError if short key not found or invalid format
 *
 * @example
 * ```typescript
 * const uuid = resolveShortKey(registry, 'user', 'u1');
 * // Returns: 'abc12345-...'
 * ```
 */
export function resolveShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  shortKey: string,
): string {
  const map = getKeyToUuidMap(registry, type);
  const uuid = map.get(shortKey);

  if (!uuid) {
    const availableKeys = Array.from(map.keys());
    throw unknownShortKeyError(type, shortKey, availableKeys);
  }

  return uuid;
}

/**
 * Safely get a short key, returning undefined if not found (no throw).
 *
 * @param registry - The short key registry
 * @param type - Entity type
 * @param uuid - The UUID to look up
 * @returns The short key or undefined if not found
 */
export function tryGetShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  uuid: string | null | undefined,
): string | undefined {
  if (!uuid) return undefined;

  const map = getUuidToKeyMap(registry, type);
  return map.get(uuid);
}

/**
 * Safely resolve a short key, returning undefined if not found (no throw).
 *
 * @param registry - The short key registry
 * @param type - Entity type
 * @param shortKey - The short key to resolve
 * @returns The UUID or undefined if not found
 */
export function tryResolveShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  shortKey: string | null | undefined,
): string | undefined {
  if (!shortKey) return undefined;

  const map = getKeyToUuidMap(registry, type);
  return map.get(shortKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// TTL & Staleness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a registry is stale based on transport type.
 *
 * - stdio transport: Never auto-expires (infinite TTL)
 * - http transport: 30-minute TTL
 *
 * @param registry - The registry to check
 * @param transport - Transport type (overrides registry.transport if provided)
 * @returns true if the registry is stale and should be refreshed
 */
export function isStale(
  registry: ShortKeyRegistry,
  transport?: TransportType,
): boolean {
  const effectiveTransport = transport ?? registry.transport;

  // stdio transport: never auto-expires
  if (effectiveTransport === 'stdio') {
    return false;
  }

  // http transport: 30-minute TTL
  if (effectiveTransport === 'http') {
    const now = Date.now();
    const age = now - registry.generatedAt.getTime();
    return age > HTTP_TTL_MS;
  }

  // Default: no auto-expiry if transport unknown
  return false;
}

/**
 * Get the age of a registry in milliseconds.
 *
 * @param registry - The registry to check
 * @returns Age in milliseconds
 */
export function getRegistryAge(registry: ShortKeyRegistry): number {
  return Date.now() - registry.generatedAt.getTime();
}

/**
 * Get the remaining TTL for a registry (for http transport only).
 *
 * @param registry - The registry to check
 * @returns Remaining TTL in milliseconds, or Infinity for stdio
 */
export function getRemainingTtl(registry: ShortKeyRegistry): number {
  if (registry.transport === 'stdio') {
    return Infinity;
  }

  if (registry.transport === 'http') {
    const age = getRegistryAge(registry);
    return Math.max(0, HTTP_TTL_MS - age);
  }

  // Default to infinite if transport unknown
  return Infinity;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrent Initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session-scoped registry storage.
 * Maps sessionId -> ShortKeyRegistry
 */
const registryStore = new Map<string, ShortKeyRegistry>();

/**
 * In-flight initialization promises.
 * Prevents duplicate initialization during concurrent tool calls.
 */
const initPromises = new Map<string, Promise<ShortKeyRegistry>>();

/**
 * Store a registry for a session.
 *
 * @param sessionId - Session identifier
 * @param registry - Registry to store
 */
export function storeRegistry(sessionId: string, registry: ShortKeyRegistry): void {
  registryStore.set(sessionId, registry);
}

/**
 * Get the stored registry for a session.
 *
 * @param sessionId - Session identifier
 * @returns The registry or undefined if not found
 */
export function getStoredRegistry(sessionId: string): ShortKeyRegistry | undefined {
  return registryStore.get(sessionId);
}

/**
 * Clear the stored registry for a session.
 *
 * @param sessionId - Session identifier
 */
export function clearRegistry(sessionId: string): void {
  registryStore.delete(sessionId);
  initPromises.delete(sessionId);
}

/**
 * Clear all stored registries.
 * Useful for testing and cleanup.
 */
export function clearAllRegistries(): void {
  registryStore.clear();
  initPromises.clear();
}

/**
 * Context for registry initialization.
 * Should be provided by the tool execution framework.
 */
export interface RegistryInitContext {
  /** Session identifier */
  sessionId: string;
  /** Transport type */
  transport?: TransportType;
  /** Force refresh even if registry exists */
  forceRefresh?: boolean;
}

/**
 * Function type for fetching workspace data.
 * Implement this to connect to the Linear API.
 */
export type FetchWorkspaceDataFn = () => Promise<RegistryBuildData>;

/**
 * Get or initialize a registry for a session.
 *
 * Uses singleton promise pattern to prevent duplicate initialization
 * during concurrent tool calls.
 *
 * @param context - Initialization context with session info
 * @param fetchWorkspaceData - Function to fetch workspace data
 * @returns The registry (existing or newly initialized)
 *
 * @example
 * ```typescript
 * const registry = await getOrInitRegistry(
 *   { sessionId: 'abc123', transport: 'stdio' },
 *   async () => {
 *     const users = await linearClient.users();
 *     const states = await linearClient.workflowStates();
 *     const projects = await linearClient.projects();
 *     return { users: users.nodes, states: states.nodes, projects: projects.nodes, workspaceId: '...' };
 *   }
 * );
 * ```
 */
export async function getOrInitRegistry(
  context: RegistryInitContext,
  fetchWorkspaceData: FetchWorkspaceDataFn,
): Promise<ShortKeyRegistry> {
  const { sessionId, transport, forceRefresh } = context;

  // Check for existing registry
  const existing = registryStore.get(sessionId);

  if (existing && !forceRefresh) {
    // Check staleness
    if (!isStale(existing, transport)) {
      return existing;
    }
    // Registry is stale, will reinitialize below
  }

  // Check for in-flight initialization
  const inFlight = initPromises.get(sessionId);
  if (inFlight && !forceRefresh) {
    return inFlight;
  }

  // Start new initialization
  const initPromise = (async () => {
    try {
      const data = await fetchWorkspaceData();
      const registry = buildRegistry(data);
      registry.transport = transport;

      registryStore.set(sessionId, registry);
      return registry;
    } catch (error) {
      throw new ToonRegistryError({
        code: 'REGISTRY_INIT_FAILED',
        message: 'Failed to initialize short key registry',
        cause: error instanceof Error ? error.message : String(error),
        hint: 'Check Linear API connectivity and authentication',
        sessionId,
      });
    } finally {
      // Clean up the promise after completion
      initPromises.delete(sessionId);
    }
  })();

  initPromises.set(sessionId, initPromise);
  return initPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get statistics about a registry.
 *
 * @param registry - The registry to inspect
 * @returns Object with counts and metadata
 */
export function getRegistryStats(registry: ShortKeyRegistry): {
  userCount: number;
  stateCount: number;
  projectCount: number;
  ageMs: number;
  isStale: boolean;
  transport?: TransportType;
} {
  return {
    userCount: registry.users.size,
    stateCount: registry.states.size,
    projectCount: registry.projects.size,
    ageMs: getRegistryAge(registry),
    isStale: isStale(registry),
    transport: registry.transport,
  };
}

/**
 * List all short keys for an entity type.
 *
 * @param registry - The registry
 * @param type - Entity type
 * @returns Array of short keys in order (u0, u1, ...)
 */
export function listShortKeys(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
): string[] {
  const map = getKeyToUuidMap(registry, type);
  return Array.from(map.keys()).sort((a, b) => {
    // Extract numeric portion and sort numerically
    const numA = parseInt(a.replace(/\D/g, ''), 10);
    const numB = parseInt(b.replace(/\D/g, ''), 10);
    return numA - numB;
  });
}

/**
 * Check if a short key exists in the registry.
 *
 * @param registry - The registry
 * @param type - Entity type
 * @param shortKey - The short key to check
 * @returns true if the key exists
 */
export function hasShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  shortKey: string,
): boolean {
  const map = getKeyToUuidMap(registry, type);
  return map.has(shortKey);
}

/**
 * Check if a UUID exists in the registry.
 *
 * @param registry - The registry
 * @param type - Entity type
 * @param uuid - The UUID to check
 * @returns true if the UUID exists
 */
export function hasUuid(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  uuid: string,
): boolean {
  const map = getUuidToKeyMap(registry, type);
  return map.has(uuid);
}
