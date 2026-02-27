import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from '../lib/logger.js';

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      // Best-effort cleanup
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await server.connect(transport);
}

main().catch((error) => {
  logger.error('MCP Server failed to start', { error: error.message });
  process.exitCode = 1;
});
