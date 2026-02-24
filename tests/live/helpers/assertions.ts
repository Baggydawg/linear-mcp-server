/**
 * TOON-aware assertion helpers for live data validation tests.
 *
 * Handles the encoding transforms between TOON output format and raw Linear API
 * values: prefixed numbers (p2, e5, c7), date formats, progress rounding,
 * short key resolution, and null/empty normalization.
 */

import { expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldContext {
  /** Entity type (e.g., "User", "Issue", "State") */
  entity: string;
  /** Entity identifier (e.g., "u0", "SQT-160", "s3") */
  identifier: string;
  /** Field name (e.g., "email", "priority", "name") */
  field: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a value for comparison: handles empty string, null, undefined.
 * Returns empty string for all "no value" cases.
 */
export function normalizeEmpty(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str === 'null' || str === 'undefined') return '';
  return str;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prefix Stripping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip TOON prefix format: "p2" -> 2, "e5" -> 5, "c7" -> 7
 * Returns null if value is empty/null.
 */
export function stripToonPrefix(value: string): number | null {
  if (!value || value === '') return null;
  // Match patterns like p0, p1, e3, e5, c7 etc.
  const match = value.match(/^[pec](\d+)$/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Comparison
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare a date value: handles YYYY-MM-DD vs ISO datetime.
 *
 * TOON dates may be either YYYY-MM-DD (cycle start/end, dueDate, targetDate)
 * or full ISO datetime (createdAt). The API may return Date objects or strings.
 */
export function expectDateMatch(
  toonDate: string,
  apiDate: Date | string | null | undefined,
  ctx: FieldContext,
): void {
  const msg = `${ctx.entity} "${ctx.identifier}" field "${ctx.field}"`;

  // Both empty
  if (!toonDate && !apiDate) return;

  // One empty, the other not
  if (!toonDate || !apiDate) {
    expect(
      normalizeEmpty(toonDate),
      `${msg}: TOON="${toonDate}" vs API="${apiDate}"`,
    ).toBe(normalizeEmpty(apiDate));
    return;
  }

  // Convert API value to string
  const apiStr = apiDate instanceof Date ? apiDate.toISOString() : String(apiDate);

  // If TOON date is YYYY-MM-DD format, compare date portions only
  if (/^\d{4}-\d{2}-\d{2}$/.test(toonDate)) {
    const apiDatePortion = apiStr.split('T')[0];
    expect(toonDate, `${msg}: TOON="${toonDate}" vs API="${apiStr}"`).toBe(
      apiDatePortion,
    );
    return;
  }

  // Full ISO datetime comparison
  expect(toonDate, `${msg}: TOON="${toonDate}" vs API="${apiStr}"`).toBe(apiStr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Progress Comparison
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare progress values with rounding tolerance.
 * Both sides are rounded to 2 decimal places before comparison.
 */
export function expectProgressMatch(
  toonProgress: string,
  apiProgress: number | null | undefined,
  ctx: FieldContext,
): void {
  const msg = `${ctx.entity} "${ctx.identifier}" field "${ctx.field}"`;

  // Both empty
  if (!toonProgress && (apiProgress === null || apiProgress === undefined)) {
    return;
  }

  // Normalize to numbers and round
  const toonNum = toonProgress ? parseFloat(toonProgress) : null;
  const toonRounded =
    toonNum !== null && !Number.isNaN(toonNum) ? Math.round(toonNum * 100) / 100 : null;
  const apiRounded =
    apiProgress !== null && apiProgress !== undefined
      ? Math.round(apiProgress * 100) / 100
      : null;

  expect(
    toonRounded,
    `${msg}: TOON="${toonProgress}" (rounded=${toonRounded}) vs API="${apiProgress}" (rounded=${apiRounded})`,
  ).toBe(apiRounded);
}

// ─────────────────────────────────────────────────────────────────────────────
// General Field Match
// ─────────────────────────────────────────────────────────────────────────────

/** Fields that use the "p" prefix format (priority) */
const PRIORITY_FIELDS = new Set(['priority']);

/** Fields that use the "e" prefix format (estimate) */
const ESTIMATE_FIELDS = new Set(['estimate']);

/** Fields that use the "c" prefix format (cycle) */
const CYCLE_FIELDS = new Set(['cycle']);

/** Fields that contain date values in YYYY-MM-DD format */
const DATE_FIELDS = new Set([
  'start',
  'end',
  'dueDate',
  'targetDate',
  'startDate',
  'createdAt',
]);

/** Fields that contain progress values (0-1 ratio) */
const PROGRESS_FIELDS = new Set(['progress']);

/**
 * Compare a TOON output value against an API value with proper context.
 * All assertion messages include entity type, identifier, and field name.
 *
 * Dispatches to the appropriate comparison based on field name:
 * - Priority fields: strip "p" prefix and compare as number
 * - Estimate fields: strip "e" prefix and compare as number
 * - Cycle fields: strip "c" prefix and compare as number
 * - Date fields: date-aware comparison
 * - Progress fields: rounding-tolerant comparison
 * - Default: string comparison with empty normalization
 */
export function expectFieldMatch(
  toonValue: string,
  apiValue: unknown,
  ctx: FieldContext,
): void {
  const msg = `${ctx.entity} "${ctx.identifier}" field "${ctx.field}": TOON="${toonValue}" vs API="${apiValue}"`;

  // Priority: "p2" -> 2
  if (PRIORITY_FIELDS.has(ctx.field)) {
    const toonNum = stripToonPrefix(toonValue);
    const apiNum =
      apiValue !== null && apiValue !== undefined ? Number(apiValue) : null;
    // Both empty
    if (toonNum === null && (apiNum === null || apiNum === 0)) return;
    expect(toonNum, msg).toBe(apiNum);
    return;
  }

  // Estimate: "e5" -> 5
  if (ESTIMATE_FIELDS.has(ctx.field)) {
    const toonNum = stripToonPrefix(toonValue);
    const apiNum =
      apiValue !== null && apiValue !== undefined ? Number(apiValue) : null;
    if (toonNum === null && apiNum === null) return;
    expect(toonNum, msg).toBe(apiNum);
    return;
  }

  // Cycle: "c7" -> 7
  if (CYCLE_FIELDS.has(ctx.field)) {
    const toonNum = stripToonPrefix(toonValue);
    const apiNum =
      apiValue !== null && apiValue !== undefined ? Number(apiValue) : null;
    if (toonNum === null && apiNum === null) return;
    expect(toonNum, msg).toBe(apiNum);
    return;
  }

  // Dates
  if (DATE_FIELDS.has(ctx.field)) {
    expectDateMatch(toonValue, apiValue as Date | string | null | undefined, ctx);
    return;
  }

  // Progress
  if (PROGRESS_FIELDS.has(ctx.field)) {
    expectProgressMatch(toonValue, apiValue as number | null | undefined, ctx);
    return;
  }

  // Boolean: TOON uses lowercase "true"/"false"
  if (typeof apiValue === 'boolean') {
    expect(toonValue, msg).toBe(String(apiValue));
    return;
  }

  // Default: string comparison with empty normalization
  const normalizedToon = normalizeEmpty(toonValue);
  const normalizedApi = normalizeEmpty(apiValue);
  expect(normalizedToon, msg).toBe(normalizedApi);
}
