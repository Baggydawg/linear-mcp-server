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

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadata for user entities stored in the registry.
 */
export interface UserMetadata {
  name: string;
  displayName: string;
  email: string;
  active: boolean;
  /** Custom role from user profiles config (e.g., "Tech Lead (Backend)") */
  role?: string;
  /** Technical skills from user profiles config */
  skills?: string[];
  /** Primary area of focus from user profiles config */
  focusArea?: string;
  /** Team keys the user belongs to (e.g., ["SQT", "SQM"]) */
  teams?: string[];
}

/**
 * Metadata for workflow state entities stored in the registry.
 */
export interface StateMetadata {
  name: string;
  type: string;
  teamId: string; // Required for getShortKey() to determine team prefix
}

/**
 * Metadata for project entities stored in the registry.
 */
export interface ProjectMetadata {
  name: string;
  icon?: string;
  state: string;
  priority?: number;
  progress?: number;
  leadId?: string;
  targetDate?: string;
  /** Team keys this project belongs to (e.g., ["SQT", "GRW"]) */
  teamKeys?: string[];
  slugId?: string;
}

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
 * User entity with metadata for registry building.
 */
export interface RegistryUserEntity extends RegistryEntity {
  /** User's full name */
  name: string;
  /** User's display name */
  displayName: string;
  /** User's email address */
  email: string;
  /** Whether the user is active */
  active: boolean;
  /** Custom role from user profiles config (e.g., "Tech Lead (Backend)") */
  role?: string;
  /** Technical skills from user profiles config */
  skills?: string[];
  /** Primary area of focus from user profiles config */
  focusArea?: string;
  /** Team keys the user belongs to (e.g., ["SQT", "SQM"]) */
  teams?: string[];
}

/**
 * Workflow state entity with metadata for registry building.
 */
export interface RegistryStateEntity extends RegistryEntity {
  /** State name (e.g., "In Progress") */
  name: string;
  /** State type (e.g., "started", "completed", "unstarted", "canceled") */
  type: string;
  /** Team this state belongs to */
  teamId?: string;
}

/**
 * Project entity with metadata for registry building.
 */
export interface RegistryProjectEntity extends RegistryEntity {
  /** Project name */
  name: string;
  /** Project icon (emoji string, e.g. "🚀") */
  icon?: string;
  /** Project state (e.g., "planned", "started", "completed", "canceled") */
  state: string;
  /** Priority level (0-4, where 0=none, 1=urgent, 4=low) */
  priority?: number;
  /** Completion progress (0 to 1 ratio) */
  progress?: number;
  /** UUID of the project lead user */
  leadId?: string;
  /** Target completion date (YYYY-MM-DD) */
  targetDate?: string;
  /** Team keys this project belongs to (e.g., ["SQT", "GRW"]) */
  teamKeys?: string[];
  slugId?: string;
}

/**
 * Input data for building the registry.
 */
export interface RegistryBuildData {
  /** Users to register (will be assigned u0, u1, ...) */
  users: RegistryUserEntity[];
  /** Workflow states to register (will be assigned s0, s1, ...) */
  states: RegistryStateEntity[];
  /** Projects to register (will be assigned pr0, pr1, ...) */
  projects: RegistryProjectEntity[];
  /** Workspace ID for scoping */
  workspaceId: string;
  /** Optional team filter for scoping (legacy single-team mode) */
  teamId?: string;
  /** All teams in workspace (for multi-team mode) */
  teams?: Array<{ id: string; key: string }>;
  /** Default team UUID - states for this team get clean keys (s0, s1...) */
  defaultTeamId?: string;
  /** Workspace URL key for constructing Linear URLs (e.g., 'sophiq-tech') */
  urlKey?: string;
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

  /** Project slugIds to short keys: slugId -> pr0 (for read path URL stripping) */
  projectsBySlugId: Map<string, string>;

  // ─────────────────────────────────────────────────────────────────────────
  // Entity Metadata (UUID -> metadata)
  // ─────────────────────────────────────────────────────────────────────────

  /** User metadata by UUID */
  userMetadata: Map<string, UserMetadata>;

  /** State metadata by UUID */
  stateMetadata: Map<string, StateMetadata>;

  /** Project metadata by UUID */
  projectMetadata: Map<string, ProjectMetadata>;

  // ─────────────────────────────────────────────────────────────────────────
  // Registry Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /** When the registry was generated */
  generatedAt: Date;

  /** Workspace ID this registry belongs to */
  workspaceId: string;

  /** Transport type (affects TTL strategy) */
  transport?: TransportType;

  // ─────────────────────────────────────────────────────────────────────────
  // Multi-Team Support
  // ─────────────────────────────────────────────────────────────────────────

  /** Map of team UUID -> team key (e.g., "abc-123" -> "sqm") */
  teamKeys: Map<string, string>;

  /** Default team UUID (for clean keys) */
  defaultTeamId?: string;

  /** Workspace URL key for constructing Linear URLs */
  urlKey?: string;
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

/**
 * Get the team prefix for a given team ID.
 * Returns empty string for default team or if no team context.
 * Returns lowercase team key with colon for non-default teams (e.g., "sqm:").
 */
export function getTeamPrefix(
  teamId: string,
  defaultTeamId?: string,
  teamKeys?: Map<string, string>,
): string {
  // No prefix if this is the default team or no default team is set
  if (!defaultTeamId || teamId === defaultTeamId) return '';
  // Look up the team key and return lowercase with colon
  const teamKey = teamKeys?.get(teamId);
  return teamKey ? `${teamKey.toLowerCase()}:` : '';
}

/**
 * Parse a short key into its components.
 * Examples:
 * - "sqm:s0" -> { teamPrefix: "sqm", type: "state", index: 0 }
 * - "u0" -> { teamPrefix: undefined, type: "user", index: 0 }
 * - "pr10" -> { teamPrefix: undefined, type: "project", index: 10 }
 * - "eng:u5" -> { teamPrefix: "eng", type: "user", index: 5 }
 * Returns undefined for invalid formats.
 */
export function parseShortKey(key: string):
  | {
      teamPrefix?: string;
      type: 'user' | 'state' | 'project';
      index: number;
    }
  | undefined {
  // Check for team prefix (format: "team:key")
  let teamPrefix: string | undefined;
  let shortKey = key;

  const colonIndex = key.indexOf(':');
  if (colonIndex > 0) {
    teamPrefix = key.slice(0, colonIndex).toLowerCase();
    shortKey = key.slice(colonIndex + 1);
  }

  // Parse the short key pattern: u0, s0, pr0
  const match = shortKey.match(/^(u|s|pr)(\d+)$/);
  if (!match) return undefined;

  const prefixMap: Record<string, 'user' | 'state' | 'project'> = {
    u: 'user',
    s: 'state',
    pr: 'project',
  };

  return {
    teamPrefix,
    type: prefixMap[match[1]],
    index: parseInt(match[2], 10),
  };
}

/**
 * Parse a label key into its components.
 * Labels use names (not numeric keys).
 * Examples:
 * - "sqm:Bugs" -> { teamPrefix: "sqm", labelName: "Bugs" }
 * - "sqm:Herramientas/Airtable" -> { teamPrefix: "sqm", labelName: "Herramientas/Airtable" }
 * - "Bug" -> { teamPrefix: undefined, labelName: "Bug" }
 * Note: Only the first colon is treated as a separator (label names can contain colons).
 */
export function parseLabelKey(key: string): {
  teamPrefix?: string;
  labelName: string;
} {
  const colonIndex = key.indexOf(':');
  if (colonIndex > 0) {
    return {
      teamPrefix: key.slice(0, colonIndex).toLowerCase(),
      labelName: key.slice(colonIndex + 1),
    };
  }
  return { labelName: key };
}

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
    projectsBySlugId: new Map(),
    userMetadata: new Map(),
    stateMetadata: new Map(),
    projectMetadata: new Map(),
    generatedAt: new Date(),
    workspaceId,
    transport,
    teamKeys: new Map(),
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
 * Team context for building maps with team-prefixed keys.
 */
interface TeamContext {
  /** Map of entity UUID -> team UUID */
  entityTeamIds?: Map<string, string>;
  /** Default team UUID (states for this team get clean keys) */
  defaultTeamId?: string;
  /** Map of team UUID -> team key (lowercase) */
  teamKeys?: Map<string, string>;
}

/**
 * Build bidirectional maps for a single entity type.
 *
 * @param entities - Entities to map
 * @param prefix - Short key prefix (u, s, pr)
 * @param teamContext - Optional team context for team-prefixed keys (states only)
 * @returns Tuple of [shortKey -> UUID, UUID -> shortKey] maps
 */
function buildMapsForType(
  entities: RegistryEntity[],
  prefix: string,
  teamContext?: TeamContext,
): [Map<string, string>, Map<string, string>] {
  const sorted = sortByCreatedAt(entities);
  const keyToUuid = new Map<string, string>();
  const uuidToKey = new Map<string, string>();

  // If no team context, use simple sequential numbering
  if (!teamContext?.entityTeamIds || !teamContext.defaultTeamId) {
    for (let i = 0; i < sorted.length; i++) {
      const shortKey = `${prefix}${i}`;
      const uuid = sorted[i].id;

      keyToUuid.set(shortKey, uuid);
      uuidToKey.set(uuid, shortKey);
    }
    return [keyToUuid, uuidToKey];
  }

  // Group entities by team for team-prefixed keys
  const { entityTeamIds, defaultTeamId, teamKeys } = teamContext;
  const entitiesByTeam = new Map<string, RegistryEntity[]>();

  for (const entity of sorted) {
    const teamId = entityTeamIds.get(entity.id) ?? '';
    if (!entitiesByTeam.has(teamId)) {
      entitiesByTeam.set(teamId, []);
    }
    entitiesByTeam.get(teamId)!.push(entity);
  }

  // Process each team's entities with per-team indexing
  for (const [teamId, teamEntities] of entitiesByTeam) {
    const teamPrefix = getTeamPrefix(teamId, defaultTeamId, teamKeys);

    for (let i = 0; i < teamEntities.length; i++) {
      const shortKey = `${teamPrefix}${prefix}${i}`;
      const uuid = teamEntities[i].id;

      keyToUuid.set(shortKey, uuid);
      uuidToKey.set(uuid, shortKey);
    }
  }

  return [keyToUuid, uuidToKey];
}

/**
 * Build user metadata map from user entities.
 *
 * @param users - User entities with metadata
 * @returns Map of UUID -> UserMetadata
 */
function buildUserMetadata(users: RegistryUserEntity[]): Map<string, UserMetadata> {
  const metadata = new Map<string, UserMetadata>();
  for (const user of users) {
    metadata.set(user.id, {
      name: user.name,
      displayName: user.displayName,
      email: user.email,
      active: user.active,
      role: user.role,
      skills: user.skills,
      focusArea: user.focusArea,
      teams: user.teams,
    });
  }
  return metadata;
}

/**
 * Build state metadata map from state entities.
 *
 * @param states - State entities with metadata
 * @returns Map of UUID -> StateMetadata
 */
function buildStateMetadata(states: RegistryStateEntity[]): Map<string, StateMetadata> {
  const metadata = new Map<string, StateMetadata>();
  for (const state of states) {
    metadata.set(state.id, {
      name: state.name,
      type: state.type,
      teamId: state.teamId ?? '', // Preserve teamId for prefix lookup
    });
  }
  return metadata;
}

/**
 * Build project metadata map from project entities.
 *
 * @param projects - Project entities with metadata
 * @returns Map of UUID -> ProjectMetadata
 */
function buildProjectMetadata(
  projects: RegistryProjectEntity[],
): Map<string, ProjectMetadata> {
  const metadata = new Map<string, ProjectMetadata>();
  for (const project of projects) {
    metadata.set(project.id, {
      name: project.name,
      icon: project.icon,
      state: project.state,
      priority: project.priority,
      progress: project.progress,
      leadId: project.leadId,
      targetDate: project.targetDate,
      teamKeys: project.teamKeys,
      slugId: project.slugId,
    });
  }
  return metadata;
}

/**
 * Build a complete registry from workspace data.
 *
 * Entities are sorted by createdAt (ascending) and assigned sequential keys:
 * - Users: u0, u1, u2, ... (global, no team prefix)
 * - States: s0, s1, s2, ... (default team) or sqm:s0, sqm:s1, ... (other teams)
 * - Projects: pr0, pr1, pr2, ... (global, no team prefix)
 *
 * Also populates metadata maps for each entity type.
 *
 * @param data - Workspace data with users, states, projects
 * @returns Complete ShortKeyRegistry
 */
export function buildRegistry(data: RegistryBuildData): ShortKeyRegistry {
  // Build teamKeys map from teams array
  const teamKeys = new Map<string, string>();
  if (data.teams) {
    for (const team of data.teams) {
      teamKeys.set(team.id, team.key.toLowerCase());
    }
  }

  // Filter states by team if teamId provided (legacy single-team mode)
  const filteredStates = data.teamId
    ? data.states.filter((s) => s.teamId === data.teamId)
    : data.states;

  // Users and projects are global (no team prefix)
  const activeUsers = data.users.filter((u) => u.active !== false);
  const [users, usersByUuid] = buildMapsForType(activeUsers, KEY_PREFIXES.user);
  const [projects, projectsByUuid] = buildMapsForType(
    data.projects,
    KEY_PREFIXES.project,
  );

  // States get team-prefixed keys in multi-team mode
  let states: Map<string, string>;
  let statesByUuid: Map<string, string>;

  if (data.defaultTeamId && data.teams && data.teams.length > 0) {
    // Multi-team mode: build entityTeamIds map for states
    const entityTeamIds = new Map<string, string>();
    for (const state of filteredStates) {
      if (state.teamId) {
        entityTeamIds.set(state.id, state.teamId);
      }
    }

    const teamContext: TeamContext = {
      entityTeamIds,
      defaultTeamId: data.defaultTeamId,
      teamKeys,
    };

    [states, statesByUuid] = buildMapsForType(
      filteredStates,
      KEY_PREFIXES.state,
      teamContext,
    );
  } else {
    // Legacy mode: simple sequential keys
    [states, statesByUuid] = buildMapsForType(filteredStates, KEY_PREFIXES.state);
  }

  // Build metadata maps - IMPORTANT: use filteredStates for consistency
  const userMetadata = buildUserMetadata(data.users);
  const stateMetadata = buildStateMetadata(filteredStates);
  const projectMetadata = buildProjectMetadata(data.projects);

  // Build project slugId -> shortKey map for read path URL stripping
  const projectsBySlugId = new Map<string, string>();
  for (const project of data.projects) {
    if (project.slugId) {
      const shortKey = projectsByUuid.get(project.id);
      if (shortKey) {
        projectsBySlugId.set(project.slugId, shortKey);
        // Also index by hash suffix for Linear's shortened URLs in descriptions
        // Linear reformats project URLs: /project/full-slug-878d2a8b5972 → /project/878d2a8b5972
        const lastHyphen = project.slugId.lastIndexOf('-');
        if (lastHyphen > 0) {
          const hashSuffix = project.slugId.slice(lastHyphen + 1);
          if (/^[a-f0-9]+$/.test(hashSuffix)) {
            projectsBySlugId.set(hashSuffix, shortKey);
          }
        }
      }
    }
  }

  // Also index by lowercase project name for Linear's named markdown links
  // Linear reformats: bare URL → [Project Name](url) in descriptions
  const ambiguousNames = new Set<string>();
  for (const [uuid, meta] of projectMetadata) {
    if (!meta.name) continue;
    const nameKey = meta.name.toLowerCase();
    const shortKey = projectsByUuid.get(uuid);
    if (!shortKey) continue;
    if (ambiguousNames.has(nameKey)) continue;
    const existing = projectsBySlugId.get(nameKey);
    if (existing === undefined) {
      projectsBySlugId.set(nameKey, shortKey);
    } else if (existing !== shortKey) {
      // Two different projects with same name — remove to avoid wrong resolution
      projectsBySlugId.delete(nameKey);
      ambiguousNames.add(nameKey);
    }
  }

  return {
    users,
    states,
    projects,
    usersByUuid,
    statesByUuid,
    projectsByUuid,
    projectsBySlugId,
    userMetadata,
    stateMetadata,
    projectMetadata,
    generatedAt: new Date(),
    workspaceId: data.workspaceId,
    teamKeys,
    defaultTeamId: data.defaultTeamId,
    urlKey: data.urlKey,
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
 * Get the default team's key (lowercase) from the registry.
 * Returns undefined if no default team is set.
 */
function getDefaultTeamKey(registry: ShortKeyRegistry): string | undefined {
  if (!registry.defaultTeamId) return undefined;
  return registry.teamKeys.get(registry.defaultTeamId);
}

/**
 * Get the short key for a UUID (for encoding Linear data -> TOON output).
 *
 * For states in multi-team mode:
 * - Default team states get clean keys (s0, s1, ...)
 * - Non-default team states get prefixed keys (sqm:s0, sqm:s1, ...)
 *
 * @param registry - The short key registry
 * @param type - Entity type (user, state, project)
 * @param uuid - The UUID to look up
 * @returns The short key (e.g., "u0", "s1", "sqm:s0", "pr2")
 * @throws ToonResolutionError if UUID not found in registry
 *
 * @example
 * ```typescript
 * const shortKey = getShortKey(registry, 'user', '186df438-...');
 * // Returns: 'u0'
 *
 * // For states, returns team-prefixed keys for non-default teams:
 * const stateKey = getShortKey(registry, 'state', 'state-uuid-...');
 * // Returns: 's0' (default team) or 'sqm:s0' (non-default team)
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
 * Normalize a short key for lookup, handling flexible input for default team.
 *
 * For states in multi-team mode:
 * - "sqt:s0" with DEFAULT_TEAM=SQT -> look up "s0" (normalized)
 * - "sqm:s0" with DEFAULT_TEAM=SQT -> look up "sqm:s0" (non-default, keep prefix)
 * - "s0" -> look up "s0" (no prefix)
 *
 * For users/projects (global entities):
 * - "sqt:u0" with DEFAULT_TEAM=SQT -> look up "u0" (strip default team prefix)
 * - "u0" -> look up "u0" (no prefix)
 *
 * @param registry - The short key registry
 * @param type - Entity type
 * @param shortKey - The short key to normalize
 * @returns The normalized key for lookup
 */
function normalizeShortKeyForLookup(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  shortKey: string,
): string {
  const parsed = parseShortKey(shortKey);
  if (!parsed) return shortKey; // Invalid format, let lookup fail

  // No prefix - use as-is
  if (!parsed.teamPrefix) return shortKey;

  // Check if prefix matches default team
  const defaultTeamKey = getDefaultTeamKey(registry);

  // If prefix matches default team, normalize to clean key
  if (defaultTeamKey && parsed.teamPrefix === defaultTeamKey) {
    // Return clean key without prefix
    const prefix = KEY_PREFIXES[parsed.type];
    return `${prefix}${parsed.index}`;
  }

  // For users and projects (global entities), strip any team prefix
  // since they don't have team-scoped keys
  if (type === 'user' || type === 'project') {
    const prefix = KEY_PREFIXES[parsed.type];
    return `${prefix}${parsed.index}`;
  }

  // Non-default team prefix for states - keep the prefixed key
  return shortKey.toLowerCase();
}

/**
 * Resolve a short key to its UUID (for decoding Claude input -> Linear API).
 *
 * Supports flexible input for the default team:
 * - "s0" -> resolves to default team's first state
 * - "sqt:s0" (with DEFAULT_TEAM=SQT) -> same result (flexible input)
 * - "sqm:s0" -> resolves to SQM team's first state
 *
 * @param registry - The short key registry
 * @param type - Entity type (user, state, project)
 * @param shortKey - The short key to resolve (e.g., "u0", "s1", "sqm:s0", "pr2")
 * @returns The UUID for the entity
 * @throws ToonResolutionError if short key not found or invalid format
 *
 * @example
 * ```typescript
 * const uuid = resolveShortKey(registry, 'user', 'u1');
 * // Returns: 'abc12345-...'
 *
 * // With DEFAULT_TEAM=SQT, both resolve to same UUID:
 * resolveShortKey(registry, 'state', 's0');     // SQT's first state
 * resolveShortKey(registry, 'state', 'sqt:s0'); // Same result
 * ```
 */
export function resolveShortKey(
  registry: ShortKeyRegistry,
  type: ShortKeyEntityType,
  shortKey: string,
): string {
  const map = getKeyToUuidMap(registry, type);

  // Normalize the key for lookup (handles flexible input)
  const normalizedKey = normalizeShortKeyForLookup(registry, type, shortKey);
  const uuid = map.get(normalizedKey);

  if (!uuid) {
    const availableKeys = Array.from(map.keys());
    throw unknownShortKeyError(type, shortKey, availableKeys);
  }

  return uuid;
}

/**
 * Safely get a short key, returning undefined if not found (no throw).
 *
 * For states in multi-team mode:
 * - Default team states get clean keys (s0, s1, ...)
 * - Non-default team states get prefixed keys (sqm:s0, sqm:s1, ...)
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
 * Supports flexible input for the default team (same as resolveShortKey).
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

  // Normalize the key for lookup (handles flexible input)
  const normalizedKey = normalizeShortKeyForLookup(registry, type, shortKey);
  return map.get(normalizedKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Retrieval Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get user metadata by UUID.
 *
 * @param registry - The short key registry
 * @param uuid - The user's UUID
 * @returns User metadata or undefined if not found
 *
 * @example
 * ```typescript
 * const metadata = getUserMetadata(registry, 'abc12345-...');
 * // Returns: { name: 'John Doe', displayName: 'john', email: 'john@example.com', active: true }
 * ```
 */
export function getUserMetadata(
  registry: ShortKeyRegistry,
  uuid: string,
): UserMetadata | undefined {
  return registry.userMetadata.get(uuid);
}

/**
 * Get state metadata by UUID.
 *
 * @param registry - The short key registry
 * @param uuid - The state's UUID
 * @returns State metadata or undefined if not found
 *
 * @example
 * ```typescript
 * const metadata = getStateMetadata(registry, 'def67890-...');
 * // Returns: { name: 'In Progress', type: 'started' }
 * ```
 */
export function getStateMetadata(
  registry: ShortKeyRegistry,
  uuid: string,
): StateMetadata | undefined {
  return registry.stateMetadata.get(uuid);
}

/**
 * Get project metadata by UUID.
 *
 * @param registry - The short key registry
 * @param uuid - The project's UUID
 * @returns Project metadata or undefined if not found
 *
 * @example
 * ```typescript
 * const metadata = getProjectMetadata(registry, 'ghi11223-...');
 * // Returns: { name: 'Q1 Launch', state: 'started' }
 * ```
 */
export function getProjectMetadata(
  registry: ShortKeyRegistry,
  uuid: string,
): ProjectMetadata | undefined {
  return registry.projectMetadata.get(uuid);
}

/**
 * Get the project slugId -> shortKey map for read path URL stripping.
 * Returns the registry's projectsBySlugId map directly (no copy needed).
 */
export function getProjectSlugMap(registry: ShortKeyRegistry): Map<string, string> {
  return registry.projectsBySlugId;
}

/**
 * Returns a human-readable label for a user UUID that couldn't be resolved
 * to a short key. Checks registry metadata to distinguish deactivated users
 * (confirmed inactive, still in workspace data) from departed users (not in
 * workspace at all).
 *
 * Note: Result reflects registry state at last refresh. A reactivated user
 * will still show '(deactivated)' until `workspace_metadata({ forceRefresh: true })`.
 */
export function getUserStatusLabel(
  registry: ShortKeyRegistry,
  uuid: string,
): '(deactivated)' | '(departed)' {
  const meta = registry.userMetadata.get(uuid);
  return meta?.active === false ? '(deactivated)' : '(departed)';
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
  if (inFlight) {
    if (!forceRefresh) {
      // Reuse existing promise
      return inFlight;
    }
    // If forceRefresh, wait for in-flight to complete, then start fresh
    // This prevents race conditions where multiple forceRefresh calls overlap
    await inFlight.catch(() => {}); // Ignore errors from previous init
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

/**
 * Register a newly created project in the registry.
 *
 * Finds the next available project short key by scanning existing keys,
 * adds the project to both maps, and stores its metadata.
 *
 * @param registry - The short key registry
 * @param projectId - The UUID of the new project
 * @param metadata - Project metadata (name, state)
 * @returns The assigned short key (e.g., 'pr6')
 *
 * @example
 * ```typescript
 * const shortKey = registerNewProject(registry, 'abc-123', { name: 'My Project', state: 'planned' });
 * // Returns: 'pr6' (or next available)
 * ```
 */
export function registerNewProject(
  registry: ShortKeyRegistry,
  projectId: string,
  metadata: ProjectMetadata,
): string {
  // Find next available key by finding max index (NOT just map.size)
  // This handles gaps in the sequence (e.g., if pr0, pr1, pr5 exist, next is pr6)
  let maxIndex = -1;
  for (const key of registry.projects.keys()) {
    const num = parseInt(key.replace('pr', ''), 10);
    if (!isNaN(num) && num > maxIndex) {
      maxIndex = num;
    }
  }
  const nextKey = `pr${maxIndex + 1}`;

  // Add to both maps (key -> UUID and UUID -> key)
  registry.projects.set(nextKey, projectId);
  registry.projectsByUuid.set(projectId, nextKey);

  // Add metadata
  registry.projectMetadata.set(projectId, metadata);

  // Update slugId reverse lookup if available
  if (metadata.slugId) {
    registry.projectsBySlugId.set(metadata.slugId, nextKey);
  }

  // Also index by hash suffix
  if (metadata.slugId) {
    const lastHyphen = metadata.slugId.lastIndexOf('-');
    if (lastHyphen > 0) {
      const hashSuffix = metadata.slugId.slice(lastHyphen + 1);
      if (/^[a-f0-9]+$/.test(hashSuffix)) {
        registry.projectsBySlugId.set(hashSuffix, nextKey);
      }
    }
  }

  // Also index by lowercase name
  if (metadata.name) {
    const nameKey = metadata.name.toLowerCase();
    const existing = registry.projectsBySlugId.get(nameKey);
    if (existing === undefined) {
      registry.projectsBySlugId.set(nameKey, nextKey);
    }
    // If existing !== nextKey, another project has this name — don't overwrite
  }

  return nextKey;
}
