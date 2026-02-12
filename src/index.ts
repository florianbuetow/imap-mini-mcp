#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClientFromEnv } from "./imap/index.js";
import { createServer } from "./server.js";

async function main() {
  // Create IMAP client from environment variables
  const imapClient = createClientFromEnv();

  // Create the MCP server with all tools registered
  const server = createServer(imapClient);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const shutdown = async () => {
    await imapClient.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
