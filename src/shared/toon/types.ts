/**
 * TypeScript types for TOON (Token-Oriented Object Notation) encoding.
 *
 * TOON is a token-efficient format for structured data output, designed for
 * LLM consumption with unambiguous parsing and minimal token overhead.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitive Types (must be defined first, referenced by other types)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Field value types supported by TOON encoding.
 */
export type ToonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | ToonValue[];

/**
 * Row data for TOON encoding.
 * Keys should match schema field names.
 */
export type ToonRow = Record<string, ToonValue>;

// ─────────────────────────────────────────────────────────────────────────────
// Schema Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema definition for a TOON section.
 * Defines the structure of data rows in TOON output.
 *
 * @example
 * ```typescript
 * const issueSchema: ToonSchema = {
 *   name: 'issues',
 *   fields: ['identifier', 'title', 'state', 'assignee', 'priority'],
 * };
 * // Output: issues[5]{identifier,title,state,assignee,priority}:
 * ```
 */
export interface ToonSchema {
  /**
   * Section name (e.g., 'issues', '_users', '_states').
   * Lookup tables are prefixed with underscore.
   */
  name: string;

  /**
   * Ordered list of field names.
   * Data rows must provide values in this exact order.
   */
  fields: string[];
}

/**
 * A section of TOON output containing schema + data rows.
 * Used for both lookup tables and data tables.
 *
 * @example
 * ```typescript
 * const section: ToonSection = {
 *   schema: { name: '_users', fields: ['key', 'name', 'email'] },
 *   items: [
 *     { key: 'u0', name: 'Alice', email: 'alice@example.com' },
 *     { key: 'u1', name: 'Bob', email: 'bob@example.com' },
 *   ],
 * };
 * ```
 */
export interface ToonSection<T extends Record<string, unknown> = ToonRow> {
  /** Schema definition for this section */
  schema: ToonSchema;

  /** Array of data items to encode */
  items: T[];
}

/**
 * Metadata section for TOON output.
 * Always appears first in output, provides context about the response.
 *
 * @example
 * ```typescript
 * const meta: ToonMeta = {
 *   fields: ['version', 'team', 'cycle', 'generated'],
 *   values: { version: '1', team: 'SQT', cycle: '5', generated: '2026-01-27T12:00:00Z' },
 * };
 * // Output: _meta{version,team,cycle,generated}:
 * //           1,SQT,5,2026-01-27T12:00:00Z
 * ```
 */
export interface ToonMeta {
  /** Ordered list of metadata field names */
  fields: string[];

  /** Key-value pairs for metadata */
  values: Record<string, string | number | boolean | null | undefined>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration options for TOON encoding.
 */
export interface ToonEncodingOptions {
  /**
   * Indentation string for data rows.
   * Default: '  ' (two spaces)
   */
  indent?: string;

  /**
   * Whether to include empty sections in output.
   * Default: false (omit empty sections)
   */
  includeEmptySections?: boolean;

  /**
   * Maximum length for text fields before truncation.
   * Set per-field or use defaults.
   */
  truncation?: {
    /** Max chars for title field (default: 500) */
    title?: number;
    /** Max chars for description in bulk tools (default: 3000) */
    desc?: number;
    /** Max chars for other text fields (default: no limit) */
    default?: number;
  };

  /**
   * Truncation indicator appended to truncated values.
   * Default: '... [truncated]'
   */
  truncationIndicator?: string;

  /**
   * Map of project slugId -> short key for stripping project URLs in description fields.
   * Built from registry's projectsBySlugId. Undefined means no stripping (graceful degradation).
   */
  projectSlugMap?: Map<string, string> | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Complete TOON response structure.
 * Combines metadata, lookup sections, and data sections.
 */
export interface ToonResponse {
  /** Metadata section (always present) */
  meta?: ToonMeta;

  /** Lookup table sections (prefixed with _) */
  lookups?: ToonSection[];

  /** Main data sections */
  data?: ToonSection[];
}

/**
 * Result of encoding a TOON response.
 */
export interface ToonEncodingResult {
  /** Whether encoding succeeded */
  success: boolean;

  /** Encoded TOON string (if success) */
  output?: string;

  /** Error message (if failure) */
  error?: string;
}

/**
 * Fallback JSON response when TOON encoding fails.
 */
export interface ToonFallbackResponse {
  /** Indicates this is a fallback response */
  _fallback: 'json';

  /** Reason for fallback */
  _reason: string;

  /** Original data that failed to encode */
  data: unknown;
}
