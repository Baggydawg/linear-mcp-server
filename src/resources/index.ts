import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.js';
import { issuesUIMetadata, issuesUIResource } from './issues-ui.resource.js';

/**
 * Register resources with the MCP server.
 *
 * Resources:
 * - ui://linear/issues - Interactive issues dashboard UI
 */
export function registerResources(server: McpServer): void {
  // Register the Linear Issues UI resource
  server.resource(
    issuesUIMetadata.name,
    issuesUIMetadata.uri,
    {
      description: issuesUIMetadata.description,
      mimeType: issuesUIMetadata.mimeType,
    },
    async () => issuesUIResource.handler(),
  );

  logger.debug('resources', {
    message: 'Registered Linear Issues UI resource',
    uri: issuesUIMetadata.uri,
  });
}

/**
 * Emit resource update notification.
 */
export function emitResourceUpdated(server: McpServer, uri: string): void {
  try {
    (server as any).sendResourceUpdated?.({ uri });
  } catch {
    // Non-fatal
  }
  logger.debug('resources', { message: 'Resource updated notification sent', uri });
}

/**
 * Emit listChanged when resources are updated.
 */
export function emitResourcesListChanged(server: McpServer): void {
  server.sendResourceListChanged();
  logger.debug('resources', { message: 'Resources list changed notification sent' });
}
