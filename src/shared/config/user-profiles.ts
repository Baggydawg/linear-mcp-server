/**
 * User Profiles Configuration Loader
 *
 * Loads custom user profile metadata from a JSON config file or environment variable.
 * This helps Claude understand who should be assigned what work based on:
 * - Role (e.g., "Tech Lead", "Frontend Developer")
 * - Skills (e.g., ["TypeScript", "React"])
 * - Focus area (e.g., "Backend infrastructure")
 *
 * Config is matched by email address (case-insensitive).
 *
 * @example Config file (team-profiles.json):
 * ```json
 * {
 *   "version": 1,
 *   "profiles": {
 *     "dev@example.com": {
 *       "role": "Senior Developer",
 *       "skills": ["TypeScript", "Node.js"],
 *       "focusArea": "API development"
 *     }
 *   }
 * }
 * ```
 */

import { existsSync, readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  /** Job title or role (e.g., "Tech Lead", "Frontend Developer") */
  role?: string;
  /** List of technical skills */
  skills?: string[];
  /** Primary area of focus or responsibility */
  focusArea?: string;
}

export interface UserProfilesConfig {
  /** Schema version for future migrations */
  version: number;
  /** Email -> profile mapping */
  profiles: Record<string, UserProfile>;
  /** Default profile for users not in config */
  defaults?: UserProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

let cachedConfig: UserProfilesConfig | null = null;
let configLoadAttempted = false;

const DEFAULT_CONFIG: UserProfilesConfig = {
  version: 1,
  profiles: {},
  defaults: {
    role: '',
    skills: [],
    focusArea: '',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load user profiles from a JSON file (Node.js runtime).
 * Gracefully returns empty config if file doesn't exist.
 */
export function loadUserProfilesFromFile(filePath: string): UserProfilesConfig {
  if (cachedConfig && configLoadAttempted) {
    return cachedConfig;
  }

  configLoadAttempted = true;

  try {
    if (!existsSync(filePath)) {
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as UserProfilesConfig;

    // Validate basic structure
    if (!parsed.profiles || typeof parsed.profiles !== 'object') {
      console.warn('[user-profiles] Invalid config structure, using defaults');
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }

    cachedConfig = parsed;
    return cachedConfig;
  } catch (error) {
    console.warn('[user-profiles] Failed to load config:', (error as Error).message);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Load user profiles from an environment variable (Cloudflare Workers runtime).
 * Expects a JSON string in the env var.
 */
export function loadUserProfilesFromEnv(jsonString?: string): UserProfilesConfig {
  if (cachedConfig && configLoadAttempted) {
    return cachedConfig;
  }

  configLoadAttempted = true;

  if (!jsonString) {
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }

  try {
    const parsed = JSON.parse(jsonString) as UserProfilesConfig;

    // Validate basic structure
    if (!parsed.profiles || typeof parsed.profiles !== 'object') {
      console.warn('[user-profiles] Invalid config structure, using defaults');
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }

    cachedConfig = parsed;
    return cachedConfig;
  } catch (error) {
    console.warn('[user-profiles] Failed to parse JSON:', (error as Error).message);
    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Load user profiles using the appropriate method based on available config.
 * Tries env var first (works in both runtimes), then falls back to file.
 */
export function loadUserProfiles(options?: {
  envJson?: string;
  filePath?: string;
}): UserProfilesConfig {
  // Check for cached config first
  if (cachedConfig && configLoadAttempted) {
    return cachedConfig;
  }

  // Try env var first (works in both Node.js and Workers)
  if (options?.envJson) {
    return loadUserProfilesFromEnv(options.envJson);
  }

  // Fall back to file (Node.js only)
  const filePath = options?.filePath ?? './team-profiles.json';
  return loadUserProfilesFromFile(filePath);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get profile for a user by email address.
 * Returns defaults if user not found or config not loaded.
 * Email matching is case-insensitive.
 */
export function getUserProfile(
  config: UserProfilesConfig,
  email: string | undefined,
): UserProfile {
  if (!email) {
    return config.defaults ?? {};
  }

  // Case-insensitive email lookup
  const normalizedEmail = email.toLowerCase();
  const entry = Object.entries(config.profiles).find(
    ([key]) => key.toLowerCase() === normalizedEmail,
  );

  if (entry) {
    return entry[1];
  }

  return config.defaults ?? {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format user profile for TOON role field.
 * Produces a compact string suitable for TOON output.
 *
 * @example
 * formatProfileForToon({ role: "Tech Lead", focusArea: "Backend" })
 * // Returns: "Tech Lead (Backend)"
 *
 * formatProfileForToon({ role: "Developer" })
 * // Returns: "Developer"
 *
 * formatProfileForToon({ focusArea: "Frontend" })
 * // Returns: "(Frontend)"
 */
export function formatProfileForToon(profile: UserProfile): string {
  const parts: string[] = [];

  if (profile.role) {
    parts.push(profile.role);
  }

  if (profile.focusArea) {
    if (parts.length > 0) {
      parts.push(`(${profile.focusArea})`);
    } else {
      parts.push(`(${profile.focusArea})`);
    }
  }

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clear cached config (useful for testing and forced refresh).
 */
export function clearUserProfilesCache(): void {
  cachedConfig = null;
  configLoadAttempted = false;
}

/**
 * Check if a config has been loaded (for testing/debugging).
 */
export function isUserProfilesLoaded(): boolean {
  return configLoadAttempted && cachedConfig !== null;
}
