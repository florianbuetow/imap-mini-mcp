#!/usr/bin/env node

import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClientFromEnv } from "./imap/index.js";
import { createServer } from "./server.js";
import { safeStderrWrite } from "./stderr.js";

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

function logFatalError(label: string, err: unknown): void {
  safeStderrWrite(formatError(label, err));
}

async function main() {
  const imapClient = createClientFromEnv();
  const server = createServer(imapClient);
  const transport = new StdioServerTransport();

  let isShuttingDown = false;

  const shutdown = async (exitCode: number = 0) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    try {
      await imapClient.disconnect();
    } catch (error) {
      logFatalError("SHUTDOWN ERROR", error);
      exitCode = 1;
    }

    process.exit(exitCode);
  };

  const handleFatalError = (label: string, err: unknown) => {
    logFatalError(label, err);
    void shutdown(1);
  };

  process.on("uncaughtException", (err) => {
    handleFatalError("UNCAUGHT EXCEPTION", err);
  });
  process.on("unhandledRejection", (reason) => {
    handleFatalError("UNHANDLED REJECTION", reason);
  });

  process.stdin.on("end", () => {
    void shutdown(0);
  });
  process.stdin.on("close", () => {
    void shutdown(0);
  });
  process.on("SIGHUP", () => {
    void shutdown(0);
  });
  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  await server.connect(transport);
}

main().catch((error) => {
  logFatalError("FATAL ERROR", error);
  process.exit(1);
});
