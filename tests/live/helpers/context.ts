/**
 * Live test context factory.
 * Provides real ToolContext with actual API token for live validation tests.
 */

import type { ToolContext } from '../../../src/shared/tools/types.js';

// Boolean for describe.skipIf() -- tests skip cleanly when conditions aren't met.
// Requires both: (1) a real API token, and (2) running under vitest (not bun's native runner).
// Vitest sets VITEST=true automatically; bun's native runner does not.
// NOTE: Use describe.skipIf(!canRunLiveTests), NOT describe.runIf(canRunLiveTests).
// describe.runIf is vitest-only; describe.skipIf works in both vitest and bun's native runner.
export const canRunLiveTests =
  !!process.env.LINEAR_ACCESS_TOKEN && !!process.env.VITEST;

/**
 * Creates a ToolContext with real API token and unique session ID.
 * Each test file should call this once to get an isolated session.
 */
export function createLiveContext(): ToolContext {
  return {
    sessionId: `live-test-${crypto.randomUUID()}`,
    providerToken: process.env.LINEAR_ACCESS_TOKEN ?? '',
    // No signal needed for live tests
  };
}
