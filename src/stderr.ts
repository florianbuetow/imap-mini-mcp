import fs from "node:fs";

/**
 * Write diagnostics to stderr without throwing if the stdio pipe is gone.
 *
 * MCP stdio servers can outlive their parent process if the client crashes or
 * disconnects unexpectedly. In that state, normal stderr writes may throw
 * EPIPE and trigger another uncaught exception.
 */
export function safeStderrWrite(message: string): void {
  try {
    fs.writeSync(process.stderr.fd, message);
  } catch {
    // Ignore write failures during shutdown or after the parent disconnects.
  }
}
