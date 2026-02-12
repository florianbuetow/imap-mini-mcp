/**
 * Configuration for connecting to an IMAP server.
 */
export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

/**
 * Lightweight email listing entry.
 * This is the standard return type for all list_emails_* tools.
 * Intentionally minimal to keep token usage low for AI agents.
 *
 * The `uid` is the IMAP UID — a persistent identifier that does NOT change
 * when other emails are moved or deleted (unlike sequence numbers).
 */
export interface EmailEntry {
  /** IMAP UID — stable, unique identifier within this mailbox */
  uid: number;
  /** Email subject line */
  subject: string;
  /** Sender email address (e.g. "alice@example.com") */
  from: string;
  /** ISO 8601 date string (e.g. "2026-02-11T10:30:00.000Z") */
  date: string;
}
