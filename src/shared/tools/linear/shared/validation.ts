/**
 * Validation utilities for issue fields
 */

import type { LinearClient } from '@linear/sdk';
import {
  parseLabelKey,
  parseShortKey,
  type ShortKeyRegistry,
} from '../../../toon/index.js';

/**
 * Validate and process estimate value based on team settings
 */
export async function validateEstimate(
  estimate: number | undefined,
  teamId: string | undefined,
  teamAllowZeroCache: Map<string, boolean>,
  client: LinearClient,
  allowZeroEstimate?: boolean,
): Promise<number | undefined> {
  if (typeof estimate !== 'number') {
    return undefined;
  }

  if (estimate > 0) {
    return estimate;
  }

  if (estimate === 0) {
    let allowZero = allowZeroEstimate === true;

    if (!allowZero && teamId) {
      // Check cache first
      if (teamAllowZeroCache.has(teamId)) {
        allowZero = teamAllowZeroCache.get(teamId) === true;
      } else {
        // Fetch team settings
        try {
          const team = await client.team(teamId);
          allowZero =
            ((team as unknown as { issueEstimationAllowZero?: boolean })
              .issueEstimationAllowZero ?? false) === true;
          teamAllowZeroCache.set(teamId, allowZero);
        } catch {
          allowZero = false;
        }
      }
    }

    if (allowZero) {
      return 0;
    }
  }

  return undefined;
}

/**
 * Validate priority value.
 * Linear priority: 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low.
 */
export function validatePriority(
  priority: number | string | undefined,
): number | undefined {
  if (typeof priority === 'undefined') {
    return undefined;
  }

  const n = typeof priority === 'string' ? Number(priority) : priority;
  // Validate range 0-4 per Linear API
  if (Number.isInteger(n) && n >= 0 && n <= 4) {
    return n;
  }

  return undefined;
}

/**
 * Clean payload by removing empty strings and invalid values
 */
export function cleanPayload<T extends Record<string, unknown>>(input: T): Partial<T> {
  const cleaned: Partial<T> = {};

  for (const [key, value] of Object.entries(input)) {
    // Skip empty strings
    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    // Skip undefined
    if (value === undefined) {
      continue;
    }

    cleaned[key as keyof T] = value as T[keyof T];
  }

  return cleaned;
}

/**
 * Validate that a field should be included in the payload
 */
export function shouldIncludeField(value: unknown, allowEmpty = false): boolean {
  // Always exclude undefined
  if (value === undefined) {
    return false;
  }

  // Handle strings
  if (typeof value === 'string') {
    return allowEmpty || value.trim() !== '';
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return allowEmpty || value.length > 0;
  }

  // Include all other values
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-Team Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of cross-team entity validation.
 */
export interface CrossTeamValidationResult {
  /** Whether the entity is valid for the target team */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Suggestion for correct key if available */
  suggestion?: string;
}

/**
 * Get team key (lowercase) from team UUID using the registry.
 */
function getTeamKeyFromId(
  teamId: string,
  registry: ShortKeyRegistry,
): string | undefined {
  return registry.teamKeys?.get(teamId);
}

/**
 * Validate that a state belongs to the target team.
 *
 * For states with a team prefix in the short key:
 * - If the prefix matches the target team, it's valid
 * - If the prefix doesn't match, returns an error with suggestion
 *
 * For states without a prefix (default team):
 * - Valid if target team IS the default team
 * - If target is non-default team, returns error with suggestion
 *
 * @param stateKey - The state short key (e.g., "s0", "sqm:s0")
 * @param resolvedStateId - The resolved state UUID
 * @param targetTeamId - The UUID of the team the issue belongs to / is being created in
 * @param registry - The short key registry
 * @returns Validation result with error and suggestion if invalid
 */
export function validateStateBelongsToTeam(
  stateKey: string,
  resolvedStateId: string,
  targetTeamId: string,
  registry: ShortKeyRegistry,
): CrossTeamValidationResult {
  // Get the state's actual team from metadata
  // Safely handle cases where stateMetadata map might not be initialized
  const stateMetadata = registry.stateMetadata?.get(resolvedStateId);
  if (!stateMetadata) {
    // State not in registry - let the API handle validation
    return { valid: true };
  }

  const stateTeamId = stateMetadata.teamId;
  if (!stateTeamId) {
    // No team info - let the API handle validation
    return { valid: true };
  }

  // If state belongs to the target team, it's valid
  if (stateTeamId === targetTeamId) {
    return { valid: true };
  }

  // State belongs to a different team - this is an error
  const parsed = parseShortKey(stateKey);
  const stateTeamKey = getTeamKeyFromId(stateTeamId, registry);
  const targetTeamKey = getTeamKeyFromId(targetTeamId, registry);

  // Build helpful error message
  const stateTeamDisplay = stateTeamKey?.toUpperCase() ?? 'another team';
  const targetTeamDisplay = targetTeamKey?.toUpperCase() ?? 'the target team';

  // Build suggestion for the correct key
  let suggestion: string | undefined;
  if (parsed) {
    // If user used a prefixed key like "sqm:s0", suggest the correct team's equivalent
    // or if they used a clean key that resolved to wrong team
    if (targetTeamKey) {
      // Find what key the user should use for target team
      // The user should look up states for target team in workspace_metadata
      suggestion = `Use workspace_metadata to see available states for team ${targetTeamDisplay}`;
    }
  }

  return {
    valid: false,
    error: `State '${stateKey}' belongs to team ${stateTeamDisplay}, but the issue is in team ${targetTeamDisplay}`,
    suggestion,
  };
}

/**
 * Validate that a label can be applied to an issue in the target team.
 *
 * Labels can be:
 * 1. Workspace labels (no team) - valid on any issue
 * 2. Team labels - only valid on issues in that team
 *
 * For labels with a team prefix:
 * - If prefix matches target team or label is workspace-level, it's valid
 * - If prefix doesn't match and label is team-scoped, returns error
 *
 * @param labelKey - The label key/name (e.g., "Bug", "sqm:Bugs")
 * @param resolvedLabelId - The resolved label UUID
 * @param targetTeamId - The UUID of the team the issue belongs to
 * @param registry - The short key registry
 * @param labelTeamId - The team ID the label belongs to (undefined for workspace labels)
 * @returns Validation result with error and suggestion if invalid
 */
export function validateLabelBelongsToTeam(
  labelKey: string,
  resolvedLabelId: string,
  targetTeamId: string,
  registry: ShortKeyRegistry,
  labelTeamId?: string,
): CrossTeamValidationResult {
  // Workspace labels (no team) are valid on any issue
  if (!labelTeamId) {
    return { valid: true };
  }

  // If label belongs to target team, it's valid
  if (labelTeamId === targetTeamId) {
    return { valid: true };
  }

  // Label belongs to a different team - this is an error
  const parsed = parseLabelKey(labelKey);
  const labelTeamKey = getTeamKeyFromId(labelTeamId, registry);
  const targetTeamKey = getTeamKeyFromId(targetTeamId, registry);

  const labelTeamDisplay = labelTeamKey?.toUpperCase() ?? 'another team';
  const targetTeamDisplay = targetTeamKey?.toUpperCase() ?? 'the target team';

  return {
    valid: false,
    error: `Label '${labelKey}' belongs to team ${labelTeamDisplay}, but the issue is in team ${targetTeamDisplay}`,
    suggestion: `Use workspace_metadata to see available labels for team ${targetTeamDisplay}, or use a workspace-level label`,
  };
}

/**
 * Parse a state key and check if it has a team prefix that doesn't match the target team.
 * This is a quick check before resolution to provide early feedback.
 *
 * @param stateKey - The state short key (e.g., "s0", "sqm:s0")
 * @param targetTeamId - The UUID of the target team
 * @param registry - The short key registry
 * @returns Validation result if prefix mismatch detected, or { valid: true } to proceed
 */
export function validateStateKeyPrefix(
  stateKey: string,
  targetTeamId: string,
  registry: ShortKeyRegistry,
): CrossTeamValidationResult {
  const parsed = parseShortKey(stateKey);
  if (!parsed || parsed.type !== 'state') {
    // Invalid format or not a state key - let normal resolution handle it
    return { valid: true };
  }

  // No prefix means it's a default team key
  if (!parsed.teamPrefix) {
    // If target team is NOT the default team, this key won't work
    if (registry.defaultTeamId && targetTeamId !== registry.defaultTeamId) {
      const targetTeamKey = getTeamKeyFromId(targetTeamId, registry);
      const defaultTeamKey = registry.defaultTeamId
        ? getTeamKeyFromId(registry.defaultTeamId, registry)
        : undefined;

      const targetDisplay = targetTeamKey?.toUpperCase() ?? 'the target team';
      const defaultDisplay = defaultTeamKey?.toUpperCase() ?? 'the default team';

      return {
        valid: false,
        error: `State '${stateKey}' is a ${defaultDisplay} state key, but the issue is in team ${targetDisplay}`,
        suggestion: targetTeamKey
          ? `Use '${targetTeamKey}:s0', '${targetTeamKey}:s1', etc. for team ${targetDisplay} states, or check workspace_metadata for available states`
          : `Check workspace_metadata to see state keys for team ${targetDisplay}`,
      };
    }
    return { valid: true };
  }

  // Has a prefix - check if it matches target team
  const targetTeamKey = getTeamKeyFromId(targetTeamId, registry);

  if (targetTeamKey && parsed.teamPrefix !== targetTeamKey.toLowerCase()) {
    const prefixTeamDisplay = parsed.teamPrefix.toUpperCase();
    const targetDisplay = targetTeamKey.toUpperCase();

    return {
      valid: false,
      error: `State '${stateKey}' belongs to team ${prefixTeamDisplay}, but the issue is in team ${targetDisplay}`,
      suggestion: `Use '${targetTeamKey}:s0', '${targetTeamKey}:s1', etc. for team ${targetDisplay} states, or check workspace_metadata for available states`,
    };
  }

  return { valid: true };
}

/**
 * Parse a label key and check if it has a team prefix that doesn't match the target team.
 * This is a quick check before resolution to provide early feedback.
 *
 * @param labelKey - The label key/name (e.g., "Bug", "sqm:Bugs")
 * @param targetTeamId - The UUID of the target team
 * @param registry - The short key registry
 * @returns Validation result if prefix mismatch detected, or { valid: true } to proceed
 */
export function validateLabelKeyPrefix(
  labelKey: string,
  targetTeamId: string,
  registry: ShortKeyRegistry,
): CrossTeamValidationResult {
  const parsed = parseLabelKey(labelKey);

  // No prefix means workspace label or default team label - allow for now
  // (actual team validation happens after resolution with labelTeamId)
  if (!parsed.teamPrefix) {
    return { valid: true };
  }

  // Has a prefix - check if it matches target team
  const targetTeamKey = getTeamKeyFromId(targetTeamId, registry);

  if (targetTeamKey && parsed.teamPrefix !== targetTeamKey.toLowerCase()) {
    const prefixTeamDisplay = parsed.teamPrefix.toUpperCase();
    const targetDisplay = targetTeamKey.toUpperCase();

    return {
      valid: false,
      error: `Label '${labelKey}' has team prefix ${prefixTeamDisplay}, but the issue is in team ${targetDisplay}`,
      suggestion: `Use '${targetTeamKey}:${parsed.labelName}' for team ${targetDisplay}, or use the label name without a prefix if it's a workspace label`,
    };
  }

  return { valid: true };
}
