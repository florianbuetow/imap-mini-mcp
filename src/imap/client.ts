import { ImapFlow } from "imapflow";
import type { ImapConfig } from "./types.js";

/**
 * Manages the IMAP connection lifecycle.
 * Wraps ImapFlow to provide a clean interface for the MCP tools.
 */
export class ImapClient {
  private client: ImapFlow | null = null;
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  /**
   * Get or create an IMAP connection.
   */
  async connect(): Promise<ImapFlow> {
    if (this.client) {
      return this.client;
    }

    this.client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      logger: false,
      tls: {
        rejectUnauthorized: false,
      },
    });

    await this.client.connect();
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
   */
  async openMailbox(path: string = "INBOX") {
    const client = await this.connect();
    return client.getMailboxLock(path);
  }
}

/**
 * Create an ImapClient from environment variables.
 */
export function createClientFromEnv(): ImapClient {
  const host = process.env.IMAP_HOST;
  const port = parseInt(process.env.IMAP_PORT || "993", 10);
  const secure = process.env.IMAP_SECURE !== "false";
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASS;

  if (!host) throw new Error("IMAP_HOST environment variable is required");
  if (!user) throw new Error("IMAP_USER environment variable is required");
  if (!pass) throw new Error("IMAP_PASS environment variable is required");

  return new ImapClient({ host, port, secure, auth: { user, pass } });
}
