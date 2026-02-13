import { ImapFlow } from "imapflow";
import type { ImapConfig } from "./types.js";

/**
 * Classify an IMAP/network error into a clear, actionable message.
 * Inspects error properties set by ImapFlow and Node.js to determine the cause.
 */
export function classifyImapError(error: unknown, config: ImapConfig): Error {
  if (!(error instanceof Error)) {
    return new Error(`IMAP error: ${String(error)}`);
  }

  const err = error as Error & {
    authenticationFailed?: boolean;
    code?: string;
  };

  if (err.authenticationFailed) {
    return new Error(
      "IMAP authentication failed — check IMAP_USER and IMAP_PASS credentials."
    );
  }

  if (err.code === "ECONNREFUSED") {
    return new Error(
      `Cannot reach IMAP server at ${config.host}:${config.port} — connection refused. Is the server running?`
    );
  }

  if (err.code === "ENOTFOUND") {
    return new Error(
      `Cannot resolve IMAP server hostname '${config.host}' — check IMAP_HOST.`
    );
  }

  if (err.code === "ETIMEDOUT" || err.code === "CONNECT_TIMEOUT") {
    return new Error(
      "Connection to IMAP server timed out — server may be slow or unreachable."
    );
  }

  if (
    err.code?.startsWith("ERR_TLS") ||
    /tls|certificate/i.test(err.message)
  ) {
    return new Error(
      "TLS/SSL error connecting to IMAP server — check IMAP_SECURE setting."
    );
  }

  return new Error(`IMAP error: ${err.message}`);
}

function isRetryableMailboxLockError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const err = error as Error & { code?: string };
  if (
    err.code &&
    [
      "ECONNRESET",
      "EPIPE",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ENOTFOUND",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EAI_AGAIN",
    ].includes(err.code)
  ) {
    return true;
  }

  return /connection|socket|not connected|closed|broken pipe|timeout/i.test(
    err.message
  );
}

/**
 * Manages the IMAP connection lifecycle.
 * Wraps ImapFlow to provide a clean interface for the MCP tools.
 *
 * Automatically reconnects when the cached connection is no longer usable
 * (e.g. server timeout, network drop) and classifies connection errors
 * into actionable messages for MCP tool callers.
 */
export class ImapClient {
  private client: ImapFlow | null = null;
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  /**
   * Get or create an IMAP connection.
   * Discards stale connections and reconnects automatically.
   */
  async connect(): Promise<ImapFlow> {
    // Discard dead connections so the next block creates a fresh one
    if (this.client && !this.client.usable) {
      this.client = null;
    }

    if (this.client) {
      return this.client;
    }

    const flow = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      logger: false,
      disableAutoIdle: false,
      ...(!this.config.starttls ? { disableSTARTTLS: true } : {}),
      tls: {
        rejectUnauthorized: this.config.tlsRejectUnauthorized,
      },
    } as any);

    try {
      await flow.connect();
    } catch (error) {
      throw classifyImapError(error, this.config);
    }

    // Clear cached client when the server drops the connection
    flow.on("close", () => {
      this.client = null;
    });

    // EventEmitter requires handling "error" events, otherwise Node throws.
    // ImapFlow also emits "close" after "error", but we clear state here too
    // so reconnect behavior is immediate even if ordering changes.
    flow.on("error", (error) => {
      const err = classifyImapError(error, this.config);
      process.stderr.write(`IMAP connection error: ${err.message}\n`);
      this.client = null;
    });

    this.client = flow;
    return this.client;
  }

  /**
   * Get the underlying ImapFlow instance (must be connected first).
   */
  getClient(): ImapFlow {
    if (!this.client) {
      throw new Error("IMAP client not connected. Call connect() first.");
    }
    return this.client;
  }

  /**
   * Disconnect from the IMAP server.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout();
      this.client = null;
    }
  }

  /**
   * Open a mailbox lock for reading. Caller must release the lock when done.
   * Retries once on stale-connection errors by reconnecting.
   */
  async openMailbox(path: string = "INBOX") {
    const client = await this.connect();
    try {
      return await client.getMailboxLock(path);
    } catch (error) {
      if (!isRetryableMailboxLockError(error)) {
        throw error;
      }

      // If the connection died between connect() and getMailboxLock(),
      // discard it and retry once with a fresh connection.
      this.client = null;
      const freshClient = await this.connect();
      return freshClient.getMailboxLock(path);
    }
  }
}

/**
 * Create an ImapClient from environment variables.
 */
export function createClientFromEnv(): ImapClient {
  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT || "993", 10);
  const secure = process.env.IMAP_SECURE !== "false";
  const starttls = process.env.IMAP_STARTTLS !== "false";
  const tlsRejectUnauthorized =
    process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== "false";
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;

  if (!host) throw new Error("IMAP_HOST environment variable is required");
  if (!user) throw new Error("IMAP_USER environment variable is required");
  if (!pass) throw new Error("IMAP_PASS environment variable is required");

  return new ImapClient({
    host,
    port,
    secure,
    starttls,
    tlsRejectUnauthorized,
    auth: { user, pass },
  });
}
