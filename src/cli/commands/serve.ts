/**
 * serve command - Start MCP server
 */

import { Command } from 'commander';
import { startServer } from '../../mcp/server.js';

export function serveCommand(): Command {
  return new Command('serve')
    .description('Start the MCP server (stdio transport)')
    .action(async () => {
      try {
        await startServer();
      } catch (error) {
        console.error('Failed to start MCP server');
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
