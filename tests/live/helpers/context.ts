/**
 * Live test context factory.
 * Provides real ToolContext with actual API token for live validation tests.
 */

import type { ToolContext } from '../../../src/shared/tools/types.js';

// Boolean for describe.runIf() -- tests skip cleanly when no API key
export const canRunLiveTests = !!process.env.LINEAR_ACCESS_TOKEN;

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
