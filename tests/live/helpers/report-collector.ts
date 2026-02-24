/**
 * Skip & entity tracking helpers for live test reporting.
 *
 * Uses vitest's `task.meta` API to attach structured data to suites.
 * The custom MarkdownReporter reads this data via `testModule.meta()`
 * after the test run completes (vitest serializes meta across the
 * worker -> main process boundary).
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

import type { File, Suite } from '@vitest/runner';

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
 * `Readonly<Suite | File>` is shallow — mutating `.meta` properties is fine.
 */
export function reportSkip(
  suite: Readonly<Suite | File>,
  testName: string,
  reason: string,
): void {
  if (!suite.meta.skips) {
    suite.meta.skips = [];
  }
  suite.meta.skips.push({ test: testName, reason });
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
  if (!suite.meta.validatedEntities) {
    suite.meta.validatedEntities = {};
  }
  const existing = suite.meta.validatedEntities[section];
  if (existing) {
    existing.push(...identifiers);
  } else {
    suite.meta.validatedEntities[section] = [...identifiers];
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
  if (!suite.meta.lifecycleActions) {
    suite.meta.lifecycleActions = [];
  }
  suite.meta.lifecycleActions.push({ action, entity, id });
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
  if (!suite.meta.completenessResults) {
    suite.meta.completenessResults = [];
  }
  suite.meta.completenessResults.push({
    tool,
    section,
    expected: expectedFields,
    actual: actualFields,
    missing,
  });
}
