/**
 * Stdio transport entry point for Claude Desktop.
 * Allows the server to be launched directly by Claude Desktop without HTTP.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config/env.js';
import { buildServer } from './core/mcp.js';

// CRITICAL: Redirect all console output to stderr to keep stdout clean for JSON-RPC
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const originalConsoleDebug = console.debug;

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.warn = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

async function main(): Promise<void> {
  // Validate Linear token is available
  if (!config.LINEAR_ACCESS_TOKEN) {
    console.error('ERROR: LINEAR_ACCESS_TOKEN environment variable is required');
    process.exit(1);
  }

  const server = buildServer({
    name: config.MCP_TITLE,
    version: config.MCP_VERSION,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start stdio server:', error);
  process.exit(1);
});
