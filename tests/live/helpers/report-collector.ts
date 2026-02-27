/**
 * Skip & entity tracking helpers for live test reporting.
 *
 * Uses vitest's `task.meta` API to attach structured data to suites.
 * The custom MarkdownReporter reads this data via `testModule.meta()`
 * after the test run completes (vitest serializes meta across the
 * worker -> main process boundary).
 *
 * IMPORTANT: Inside a `describe` block, `afterAll((suite) => ...)` provides
 * the Suite task, NOT the File task. `TestModule.meta()` returns File-level
 * meta. These are separate objects. All collector functions write to
 * `suite.file.meta` so data reaches the reporter. Since `File extends Suite`
 * and `File.file` is self-referential, this works for both Suite and File inputs.
 *
 * Usage in a test file:
 *
 *   import { afterAll, describe, it } from 'vitest';
 *   import type { Suite } from '@vitest/runner';
 *   import { reportSkip, reportEntitiesValidated } from './helpers/report-collector.js';
 *
 *   describe('my suite', () => {
 *     afterAll((suite) => {
 *       reportEntitiesValidated(suite, 'issues', ['SQT-1', 'SQT-2']);
 *     });
 *
 *     it('checks something', () => {
 *       if (!data) {
 *         reportSkip(getCurrentSuite(), 'field check', 'no data returned');
 *         return;
 *       }
 *     });
 *   });
 */

import { type File, getCurrentTest, type Suite } from '@vitest/runner';

// ---------------------------------------------------------------------------
// Declaration merging — extend vitest's TaskMeta with our custom fields
// ---------------------------------------------------------------------------

declare module '@vitest/runner' {
  interface TaskMeta {
    skips?: Array<{ test: string; reason: string }>;
    validatedEntities?: Record<string, string[]>;
    lifecycleActions?: Array<{
      action: string;
      entity: string;
      id: string;
    }>;
    completenessResults?: Array<{
      tool: string;
      section: string;
      expected: string[];
      actual: string[];
      missing: string[];
    }>;
    fieldComparisons?: Array<{
      entity: string;
      entityLabel?: string;
      entityType?: string;
      testName?: string;
      fields: Array<{
        field: string;
        toon: string;
        api: string;
        match: boolean;
      }>;
    }>;
    toolCalls?: Array<{
      tool: string;
      params: Record<string, unknown>;
      response: string;
      testName?: string;
    }>;
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Record a soft skip: the test ran but a particular validation was skipped
 * because a precondition was not met (e.g. no active cycle, no comments).
 *
 * `suite` is the object vitest passes to `afterAll` callbacks.
 * Writes to `suite.file.meta` so data reaches the reporter via `mod.meta()`.
 */
export function reportSkip(
  suite: Readonly<Suite | File>,
  testName: string,
  reason: string,
): void {
  if (!suite.file.meta.skips) {
    suite.file.meta.skips = [];
  }
  suite.file.meta.skips.push({ test: testName, reason });
}

/**
 * Record which entities were validated (by section name + identifiers).
 * Useful for tracking coverage of the workspace: how many issues, users,
 * states, etc. were actually touched by the live tests.
 */
export function reportEntitiesValidated(
  suite: Readonly<Suite | File>,
  section: string,
  identifiers: string[],
): void {
  if (!suite.file.meta.validatedEntities) {
    suite.file.meta.validatedEntities = {};
  }
  const existing = suite.file.meta.validatedEntities[section];
  if (existing) {
    existing.push(...identifiers);
  } else {
    suite.file.meta.validatedEntities[section] = [...identifiers];
  }
}

/**
 * Record a lifecycle action (create/update/delete) for the report.
 */
export function reportLifecycleAction(
  suite: Readonly<Suite | File>,
  action: string,
  entity: string,
  id: string,
): void {
  if (!suite.file.meta.lifecycleActions) {
    suite.file.meta.lifecycleActions = [];
  }
  suite.file.meta.lifecycleActions.push({ action, entity, id });
}

/**
 * Record a completeness check result for the report.
 */
export function reportCompleteness(
  suite: Readonly<Suite | File>,
  tool: string,
  section: string,
  expectedFields: string[],
  actualFields: string[],
  missing: string[],
): void {
  if (!suite.file.meta.completenessResults) {
    suite.file.meta.completenessResults = [];
  }
  suite.file.meta.completenessResults.push({
    tool,
    section,
    expected: expectedFields,
    actual: actualFields,
    missing,
  });
}

/**
 * Record per-entity, per-field TOON-vs-API comparison data for the report.
 * The markdown reporter renders these as side-by-side comparison tables.
 */
export function reportFieldComparison(
  suite: Readonly<Suite | File>,
  entity: string,
  entityLabel: string | undefined,
  fields: Array<{ field: string; toon: string; api: string; match: boolean }>,
  entityType?: string,
): void {
  if (!suite.file.meta.fieldComparisons) {
    suite.file.meta.fieldComparisons = [];
  }
  const testName = getCurrentTest()?.name;
  suite.file.meta.fieldComparisons.push({
    entity,
    entityLabel,
    entityType,
    testName,
    fields,
  });
}

/**
 * Record a tool call (request params + raw TOON response) for the transcript.
 * Called after each `tool.handler()` invocation in test files.
 */
export function reportToolCall(
  suite: Readonly<Suite | File>,
  tool: string,
  params: Record<string, unknown>,
  response: string,
): void {
  if (!suite.file.meta.toolCalls) {
    suite.file.meta.toolCalls = [];
  }
  const testName = getCurrentTest()?.name;
  suite.file.meta.toolCalls.push({ tool, params, response, testName });
}
