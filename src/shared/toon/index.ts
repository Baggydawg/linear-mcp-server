/**
 * TOON (Token-Oriented Object Notation) Module
 *
 * Public exports for the TOON encoding system. This module provides:
 * - Type definitions for TOON schemas and responses
 * - Encoding functions for converting data to TOON format
 * - Error classes for resolution and encoding failures
 *
 * @example
 * ```typescript
 * import {
 *   encodeToon,
 *   encodeToonValue,
 *   encodeResponse,
 *   ToonSchema,
 *   ToonResponse,
 *   ToonResolutionError,
 * } from './toon';
 *
 * // Define a schema
 * const issueSchema: ToonSchema = {
 *   name: 'issues',
 *   fields: ['identifier', 'title', 'state', 'assignee'],
 * };
 *
 * // Encode a response
 * const response: ToonResponse = {
 *   meta: {
 *     fields: ['team', 'generated'],
 *     values: { team: 'SQT', generated: new Date().toISOString() },
 *   },
 *   lookups: [
 *     {
 *       schema: { name: '_users', fields: ['key', 'name'] },
 *       items: [{ key: 'u0', name: 'Alice' }],
 *     },
 *   ],
 *   data: [
 *     {
 *       schema: issueSchema,
 *       items: [{ identifier: 'SQT-1', title: 'Test', state: 's0', assignee: 'u0' }],
 *     },
 *   ],
 * };
 *
 * const output = encodeToon(response);
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ToonEncodingOptions,
  ToonEncodingResult,
  ToonFallbackResponse,
  ToonMeta,
  ToonResponse,
  ToonRow,
  ToonSchema,
  ToonSection,
  ToonValue,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Encoder Functions
// ─────────────────────────────────────────────────────────────────────────────

export {
  encodeResponse,
  encodeSimpleSection,
  encodeToon,
  encodeToonMeta,
  encodeToonRow,
  encodeToonSection,
  encodeToonValue,
  formatCycleToon,
  formatEstimateToon,
  formatPriorityToon,
  safeEncode,
  stripMarkdownImages,
  validateRowAgainstSchema,
} from './encoder.js';

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ToonEncodingErrorCode,
  ToonRegistryErrorCode,
  ToonResolutionErrorCode,
} from './errors.js';
export {
  invalidKeyFormatError,
  ToonEncodingError,
  ToonError,
  ToonRegistryError,
  ToonResolutionError,
  unknownShortKeyError,
} from './errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas (Entity definitions for TOON output)
// ─────────────────────────────────────────────────────────────────────────────

// Lookup Table Schemas (prefixed with _)
// Data Table Schemas
// Full Entity Schemas (for dedicated list tools)
// Pagination Schema
// Write Results Schemas
// Gap Analysis Schema
// Project Update Schemas
// Schema Collections
export {
  ALL_SCHEMAS,
  ATTACHMENT_SCHEMA,
  CHANGES_SCHEMA,
  COMMENT_SCHEMA,
  COMMENT_SCHEMA_WITH_ID,
  COMMENT_WRITE_RESULT_SCHEMA,
  CREATED_COMMENT_SCHEMA,
  CREATED_PROJECT_SCHEMA,
  CREATED_PROJECT_UPDATE_SCHEMA,
  CYCLE_LOOKUP_SCHEMA,
  CYCLE_SCHEMA,
  DATA_SCHEMAS,
  FULL_ENTITY_SCHEMAS,
  GAP_SCHEMA,
  ISSUE_SCHEMA,
  LABEL_LOOKUP_SCHEMA,
  LOOKUP_SCHEMAS,
  MILESTONE_SCHEMA,
  PAGINATION_SCHEMA,
  PROJECT_CHANGES_SCHEMA,
  PROJECT_LOOKUP_SCHEMA,
  PROJECT_SCHEMA,
  PROJECT_UPDATE_SCHEMA,
  PROJECT_UPDATE_WRITE_RESULT_SCHEMA,
  PROJECT_WRITE_RESULT_SCHEMA,
  RELATION_SCHEMA,
  RELATION_SCHEMA_WITH_ID,
  RELATION_WRITE_RESULT_SCHEMA,
  STATE_LOOKUP_SCHEMA,
  TEAM_LOOKUP_SCHEMA,
  TEAM_SCHEMA,
  USER_LOOKUP_SCHEMA,
  USER_SCHEMA,
  WRITE_RESULT_META_SCHEMA,
  WRITE_RESULT_SCHEMA,
  WRITE_SCHEMAS,
} from './schemas.js';

// ─────────────────────────────────────────────────────────────────────────────
// Registry (Short Key <-> UUID Resolution)
// ─────────────────────────────────────────────────────────────────────────────

// Registry types
export type {
  FetchWorkspaceDataFn,
  ProjectMetadata,
  RegistryBuildData,
  RegistryEntity,
  RegistryInitContext,
  ShortKeyEntityType,
  ShortKeyRegistry,
  StateMetadata,
  TransportType,
  UserMetadata,
} from './registry.js';
// Registry building
// Resolution functions
// TTL & staleness
// Session storage
// Utility functions
// Metadata retrieval
export {
  buildRegistry,
  clearAllRegistries,
  clearRegistry,
  createEmptyRegistry,
  getOrInitRegistry,
  getProjectMetadata,
  getRegistryAge,
  getRegistryStats,
  getRemainingTtl,
  getShortKey,
  getStateMetadata,
  getStoredRegistry,
  getTeamPrefix,
  getUserMetadata,
  hasShortKey,
  hasUuid,
  isStale,
  listShortKeys,
  parseLabelKey,
  parseShortKey,
  registerNewProject,
  resolveShortKey,
  storeRegistry,
  tryGetShortKey,
  tryResolveShortKey,
} from './registry.js';
