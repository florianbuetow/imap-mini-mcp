import type { SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailEntry } from "./types.js";
import type { ImapClient } from "./client.js";
import { buildCompositeId } from "./resolve.js";

/**
 * Extract a clean email address from an IMAP envelope address object.
 * Returns just the address part (e.g. "alice@example.com"), not the display name.
 */
export function extractEmailAddress(addr: any): string {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  if (Array.isArray(addr)) {
    // Take the first address (the primary sender)
    return addr.length > 0 ? extractEmailAddress(addr[0]) : "";
  }
  return addr.address || "";
}

/**
 * Compute a Date object for N days ago (at midnight UTC).
 */
export function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * List emails received since a given date.
 * If `since` is undefined, lists ALL emails (no date filter).
 *
 * Returns lightweight EmailEntry objects: uid, subject, from, date.
 * Results are sorted newest-first.
 */
export async function listEmails(
  imapClient: ImapClient,
  since?: Date,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    // Build search query
    const query: SearchObject = since ? { since } : { all: true };

    // Search returns UIDs
    const uids = await client.search(query, { uid: true });

    if (!uids || uids.length === 0) {
      return [];
    }

    // Sort newest first (higher UID = newer on most IMAP servers)
    const sortedUids = uids.sort((a, b) => b - a);

    // Fetch only what we need: envelope (subject, from, date) + uid
    const results: EmailEntry[] = [];
    for await (const msg of client.fetch(sortedUids.join(","), {
      uid: true,
      envelope: true,
    }, { uid: true })) {
      results.push({
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        date: msg.envelope?.date?.toISOString() || "",
      });
    }

    // Re-sort by date descending (envelope date is more accurate than UID order)
    results.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return results;
  } finally {
    lock.release();
  }
}

/**
 * List emails from a specific domain (e.g. "you.com" matches all senders @you.com).
 * Uses IMAP SEARCH FROM which does substring matching on the From header.
 */
export async function listEmailsFromDomain(
  imapClient: ImapClient,
  domain: string,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const query: SearchObject = { from: `@${domain}` };
    const uids = await client.search(query, { uid: true });

    if (!uids || uids.length === 0) {
      return [];
    }

    const sortedUids = uids.sort((a, b) => b - a);

    const results: EmailEntry[] = [];
    for await (const msg of client.fetch(sortedUids.join(","), {
      uid: true,
      envelope: true,
    }, { uid: true })) {
      results.push({
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        date: msg.envelope?.date?.toISOString() || "",
      });
    }

    results.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return results;
  } finally {
    lock.release();
  }
}

/**
 * List emails from a specific sender email address (e.g. "alice@you.com").
 * Uses IMAP SEARCH FROM which does substring matching on the From header.
 */
export async function listEmailsFromSender(
  imapClient: ImapClient,
  sender: string,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const query: SearchObject = { from: sender };
    const uids = await client.search(query, { uid: true });

    if (!uids || uids.length === 0) {
      return [];
    }

    const sortedUids = uids.sort((a, b) => b - a);

    const results: EmailEntry[] = [];
    for await (const msg of client.fetch(sortedUids.join(","), {
      uid: true,
      envelope: true,
    }, { uid: true })) {
      results.push({
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        date: msg.envelope?.date?.toISOString() || "",
      });
    }

    results.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return results;
  } finally {
    lock.release();
  }
}

/**
 * List the most recent N emails in a mailbox (default INBOX).
 * Fetches all UIDs, sorts descending, takes the first `count`, then fetches envelopes.
 */
export async function listInboxMessages(
  imapClient: ImapClient,
  count: number,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const uids = await client.search({ all: true }, { uid: true });

    if (!uids || uids.length === 0) {
      return [];
    }

    // Take only the last N UIDs (highest = newest)
    const sortedUids = uids.sort((a, b) => b - a).slice(0, count);

    const results: EmailEntry[] = [];
    for await (const msg of client.fetch(sortedUids.join(","), {
      uid: true,
      envelope: true,
    }, { uid: true })) {
      results.push({
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        date: msg.envelope?.date?.toISOString() || "",
      });
    }

    results.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    return results;
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------------------
// Email content + attachment metadata
// ---------------------------------------------------------------------------

/**
 * Attachment metadata (returned with email content, NOT the actual data).
 */
export interface AttachmentInfo {
  /** Unique identifier for this attachment within the email (MIME part content-id or index) */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type (e.g. "application/pdf", "image/png") */
  contentType: string;
  /** Size in bytes */
  size: number;
}

/**
 * The content returned when fetching a single email.
 */
export interface EmailContent {
  /** Composite identifier: date.messageId */
  id: string;
  /** Email subject line */
  subject: string;
  /** Sender email address */
  from: string;
  /** Recipient email address(es) */
  to: string;
  /** ISO 8601 date string */
  date: string;
  /** Plain text body */
  body: string;
  /** List of attachments (metadata only — use fetch_email_attachment to download) */
  attachments: AttachmentInfo[];
}

/**
 * Fetch the full content of a single email by its UID.
 * Parses MIME to extract clean text body and enumerate attachments.
 */
export async function fetchEmailContent(
  imapClient: ImapClient,
  uid: number,
  mailbox: string = "INBOX"
): Promise<EmailContent | null> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const msg = await client.fetchOne(String(uid), {
      uid: true,
      envelope: true,
      source: true,
    }, { uid: true });

    if (!msg) return null;

    const rawSource = msg.source;
    if (!rawSource) {
      return {
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        to: extractEmailAddress(msg.envelope?.to),
        date: msg.envelope?.date?.toISOString() || "",
        body: "(no body)",
        attachments: [],
      };
    }

    // Parse MIME structure
    const parsed = await simpleParser(rawSource);

    // Extract attachment metadata
    const attachments: AttachmentInfo[] = (parsed.attachments || []).map(
      (att, index) => ({
        id: att.contentId || `attachment-${index}`,
        filename: att.filename || `unnamed-${index}`,
        contentType: att.contentType || "application/octet-stream",
        size: att.size || 0,
      })
    );

    const messageId = parsed.messageId || msg.envelope?.messageId || "";
    return {
      id: buildCompositeId(parsed.date || msg.envelope?.date || new Date(0), messageId),
      subject: parsed.subject || msg.envelope?.subject || "(no subject)",
      from: parsed.from?.text || extractEmailAddress(msg.envelope?.from),
      to:
        (parsed.to
          ? Array.isArray(parsed.to)
            ? parsed.to.map((a) => a.text).join(", ")
            : parsed.to.text
          : undefined) || extractEmailAddress(msg.envelope?.to),
      date:
        parsed.date?.toISOString() ||
        msg.envelope?.date?.toISOString() ||
        "",
      body: parsed.text || "(no text body)",
      attachments,
    };
  } finally {
    lock.release();
  }
}

// ---------------------------------------------------------------------------
// Attachment fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a specific attachment from an email.
 * Returns the raw attachment data as a Buffer along with metadata.
 */
export interface AttachmentData {
  /** The attachment identifier (matches AttachmentInfo.id) */
  id: string;
  /** Original filename */
  filename: string;
  /** MIME type */
  contentType: string;
  /** Base64-encoded content */
  contentBase64: string;
  /** Size in bytes */
  size: number;
}

export async function fetchEmailAttachment(
  imapClient: ImapClient,
  uid: number,
  attachmentId: string,
  mailbox: string = "INBOX"
): Promise<AttachmentData | null> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const msg = await client.fetchOne(String(uid), {
      uid: true,
      source: true,
    }, { uid: true });

    if (!msg || !msg.source) return null;

    const parsed = await simpleParser(msg.source);

    // Find the attachment by id or by index-based id
    const attachment = (parsed.attachments || []).find((att, index) => {
      const id = att.contentId || `attachment-${index}`;
      return id === attachmentId;
    });

    if (!attachment) return null;

    return {
      id: attachmentId,
      filename: attachment.filename || "unnamed",
      contentType: attachment.contentType || "application/octet-stream",
      contentBase64: attachment.content.toString("base64"),
      size: attachment.size || 0,
    };
  } finally {
    lock.release();
  }
}
