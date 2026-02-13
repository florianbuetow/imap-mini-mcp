#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClientFromEnv } from "./imap/index.js";
import { createServer } from "./server.js";

// Keep the process alive on unexpected errors — log to stderr so the
// MCP client (Claude Desktop) can surface the message in its logs.
function formatError(label: string, err: unknown): string {
  const lines = [`[imap-mini-mcp] ${label}`];
  if (err instanceof Error) {
    lines.push(`  Message: ${err.message}`);
    lines.push(`  Name:    ${err.name}`);
    const code = (err as Error & { code?: string }).code;
    if (code) lines.push(`  Code:    ${code}`);
    if (err.cause) lines.push(`  Cause:   ${JSON.stringify(err.cause)}`);
    if (err.stack) lines.push(`  Stack:\n${err.stack}`);
  } else {
    lines.push(`  Value: ${JSON.stringify(err)}`);
  }
  lines.push(`  Time:  ${new Date().toISOString()}`);
  lines.push(`  PID:   ${process.pid}`);
  lines.push(`  Node:  ${process.version}`);
  lines.push(`  CWD:   ${process.cwd()}`);
  lines.push(`  Env:   IMAP_HOST=${process.env.IMAP_HOST} IMAP_PORT=${process.env.IMAP_PORT} IMAP_SECURE=${process.env.IMAP_SECURE} IMAP_STARTTLS=${process.env.IMAP_STARTTLS}`);
  return lines.join("\n") + "\n";
}

process.on("uncaughtException", (err) => {
  process.stderr.write(formatError("UNCAUGHT EXCEPTION", err));
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(formatError("UNHANDLED REJECTION", reason));
});

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
