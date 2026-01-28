/**
 * Error classes for TOON encoding and short key resolution.
 *
 * Errors follow the project's pattern of actionable errors with
 * code, message, hint, and suggestion fields.
 */

/**
 * Base error class for TOON-related errors.
 * Provides structured error information for debugging and recovery.
 */
export abstract class ToonError extends Error {
  /** Machine-readable error code */
  abstract readonly code: string;

  /** Human-readable hint for resolution */
  readonly hint?: string;

  /** Suggested action to resolve the error */
  readonly suggestion?: string;

  /** Original cause of the error (if any) */
  readonly cause?: string;

  constructor(
    message: string,
    options?: {
      hint?: string;
      suggestion?: string;
      cause?: string;
    },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.hint = options?.hint;
    this.suggestion = options?.suggestion;
    this.cause = options?.cause;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Returns a structured error object for API responses.
   */
  toJSON(): Record<string, unknown> {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      suggestion: this.suggestion,
      cause: this.cause,
    };
  }
}

/**
 * Error codes for short key resolution failures.
 */
export type ToonResolutionErrorCode =
  | 'UNKNOWN_SHORT_KEY'
  | 'INVALID_KEY_FORMAT'
  | 'ENTITY_NOT_FOUND'
  | 'AMBIGUOUS_KEY';

/**
 * Error thrown when a short key cannot be resolved to a UUID.
 *
 * @example
 * ```typescript
 * throw new ToonResolutionError({
 *   code: 'UNKNOWN_SHORT_KEY',
 *   message: "Unknown user key 'u99'",
 *   hint: 'Available keys: u0, u1, u2, u3',
 *   suggestion: 'Call workspace_metadata to refresh available options',
 * });
 * ```
 */
export class ToonResolutionError extends ToonError {
  readonly code: ToonResolutionErrorCode;

  /** Entity type that failed resolution (user, state, project) */
  readonly entityType?: string;

  /** The short key that failed to resolve */
  readonly shortKey?: string;

  /** Available keys that could be used instead */
  readonly availableKeys?: string[];

  constructor(options: {
    code: ToonResolutionErrorCode;
    message: string;
    hint?: string;
    suggestion?: string;
    entityType?: string;
    shortKey?: string;
    availableKeys?: string[];
  }) {
    super(options.message, {
      hint: options.hint,
      suggestion: options.suggestion,
    });
    this.code = options.code;
    this.entityType = options.entityType;
    this.shortKey = options.shortKey;
    this.availableKeys = options.availableKeys;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      entityType: this.entityType,
      shortKey: this.shortKey,
      availableKeys: this.availableKeys,
    };
  }
}

/**
 * Error codes for registry initialization failures.
 */
export type ToonRegistryErrorCode =
  | 'REGISTRY_INIT_FAILED'
  | 'REGISTRY_STALE'
  | 'REGISTRY_CORRUPT'
  | 'WORKSPACE_FETCH_FAILED'
  | 'SESSION_NOT_FOUND';

/**
 * Error thrown when the short key registry fails to initialize or is unavailable.
 *
 * @example
 * ```typescript
 * throw new ToonRegistryError({
 *   code: 'REGISTRY_INIT_FAILED',
 *   message: 'Failed to initialize short key registry',
 *   cause: 'Linear API returned 401 Unauthorized',
 *   hint: 'Check Linear API connectivity and authentication',
 * });
 * ```
 */
export class ToonRegistryError extends ToonError {
  readonly code: ToonRegistryErrorCode;

  /** Session ID where the error occurred (if applicable) */
  readonly sessionId?: string;

  constructor(options: {
    code: ToonRegistryErrorCode;
    message: string;
    hint?: string;
    suggestion?: string;
    cause?: string;
    sessionId?: string;
  }) {
    super(options.message, {
      hint: options.hint,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.code = options.code;
    this.sessionId = options.sessionId;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      sessionId: this.sessionId,
    };
  }
}

/**
 * Error codes for TOON encoding failures.
 */
export type ToonEncodingErrorCode =
  | 'ENCODING_FAILED'
  | 'INVALID_SCHEMA'
  | 'INVALID_DATA'
  | 'FIELD_MISMATCH'
  | 'UNSUPPORTED_TYPE';

/**
 * Error thrown when TOON encoding fails.
 *
 * @example
 * ```typescript
 * throw new ToonEncodingError({
 *   code: 'FIELD_MISMATCH',
 *   message: "Schema field 'assignee' not found in data row",
 *   hint: 'Ensure data objects have all fields defined in schema',
 *   schemaName: 'issues',
 *   fieldName: 'assignee',
 * });
 * ```
 */
export class ToonEncodingError extends ToonError {
  readonly code: ToonEncodingErrorCode;

  /** Schema name where encoding failed */
  readonly schemaName?: string;

  /** Field name where encoding failed */
  readonly fieldName?: string;

  /** Row index where encoding failed */
  readonly rowIndex?: number;

  constructor(options: {
    code: ToonEncodingErrorCode;
    message: string;
    hint?: string;
    suggestion?: string;
    cause?: string;
    schemaName?: string;
    fieldName?: string;
    rowIndex?: number;
  }) {
    super(options.message, {
      hint: options.hint,
      suggestion: options.suggestion,
      cause: options.cause,
    });
    this.code = options.code;
    this.schemaName = options.schemaName;
    this.fieldName = options.fieldName;
    this.rowIndex = options.rowIndex;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      schemaName: this.schemaName,
      fieldName: this.fieldName,
      rowIndex: this.rowIndex,
    };
  }
}

/**
 * Helper function to create a resolution error for unknown short keys.
 */
export function unknownShortKeyError(
  entityType: 'user' | 'state' | 'project',
  shortKey: string,
  availableKeys: string[],
): ToonResolutionError {
  const prefix = entityType === 'user' ? 'u' : entityType === 'state' ? 's' : 'pr';
  return new ToonResolutionError({
    code: 'UNKNOWN_SHORT_KEY',
    message: `Unknown ${entityType} key '${shortKey}'`,
    hint: `Available keys: ${availableKeys.slice(0, 10).join(', ')}${availableKeys.length > 10 ? '...' : ''}`,
    suggestion: 'Call workspace_metadata to refresh available options',
    entityType,
    shortKey,
    availableKeys,
  });
}

/**
 * Helper function to create a resolution error for invalid key format.
 */
export function invalidKeyFormatError(
  entityType: 'user' | 'state' | 'project',
  shortKey: string,
): ToonResolutionError {
  const prefix = entityType === 'user' ? 'u' : entityType === 'state' ? 's' : 'pr';
  return new ToonResolutionError({
    code: 'INVALID_KEY_FORMAT',
    message: `Invalid ${entityType} key format '${shortKey}'`,
    hint: `${entityType.charAt(0).toUpperCase() + entityType.slice(1)} keys should be in format '${prefix}N' (e.g., ${prefix}0, ${prefix}1)`,
    suggestion:
      'Use the correct key format or call workspace_metadata to see available keys',
    entityType,
    shortKey,
  });
}
