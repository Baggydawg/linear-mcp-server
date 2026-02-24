/**
 * Live test harness smoke test.
 *
 * Verifies the live test infrastructure works end-to-end:
 * - Real API token from LINEAR_ACCESS_TOKEN env var
 * - Tool handler invocation with live ToolContext
 * - TOON output parsing via toon-parser
 *
 * Run with: bun test tests/live/smoke.test.ts
 * Requires LINEAR_ACCESS_TOKEN environment variable.
 */

import { describe, expect, it } from 'vitest';
import { workspaceMetadataTool } from '../../src/shared/tools/linear/workspace-metadata.js';
import { clearRegistry } from '../../src/shared/toon/registry.js';
import { canRunLiveTests, createLiveContext } from './helpers/context.js';
import { parseToonText } from './helpers/toon-parser.js';

describe.skipIf(!canRunLiveTests)('live test harness smoke test', () => {
  it('can call workspace_metadata with real API token', async () => {
    const context = createLiveContext();

    try {
      // Call the workspace_metadata tool handler with empty args
      const result = await workspaceMetadataTool.handler({}, context);

      // Should not be an error
      expect(result.isError).not.toBe(true);

      // Should have text content
      const text = result.content[0].text;
      expect(text).toBeDefined();
      expect(text.length).toBeGreaterThan(0);

      // Should be parseable as TOON
      const parsed = parseToonText(text);
      expect(parsed.sections.size).toBeGreaterThan(0);

      // Should have _users section
      expect(parsed.sections.has('_users')).toBe(true);
      const users = parsed.sections.get('_users');
      expect(users).toBeDefined();
      expect(users?.rows.length).toBeGreaterThan(0);

      // Should have _states section
      expect(parsed.sections.has('_states')).toBe(true);
      const states = parsed.sections.get('_states');
      expect(states).toBeDefined();
      expect(states?.rows.length).toBeGreaterThan(0);

      // Should have _meta section with org and team fields
      expect(parsed.meta).toBeDefined();
      expect(parsed.meta.generated).toBeDefined();
    } finally {
      // Clean up the registry created by the tool call
      clearRegistry(context.sessionId);
    }
  }, 30000); // 30s timeout for live API call
});
