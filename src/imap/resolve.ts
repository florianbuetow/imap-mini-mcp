import type { ImapClient } from "./client.js";
import { listFolders } from "./folders.js";

/**
 * Build the composite ID from date + messageId.
 * Format: `YYYY-MM-DDTHH:mm:ss.<messageId>`
 */
export function buildCompositeId(
  date: Date | string,
  messageId: string
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const iso = d.toISOString().slice(0, 19); // YYYY-MM-DDTHH:mm:ss
  return `${iso}.${messageId}`;
}

/**
 * Parse composite ID into { date, messageId }.
 * The date portion is always 19 characters (YYYY-MM-DDTHH:mm:ss),
 * followed by a dot separator, then the Message-ID.
 */
export function parseCompositeId(compositeId: string): {
  date: string;
  messageId: string;
} {
  if (compositeId.length < 20 || compositeId[19] !== ".") {
    throw new Error(
      `Invalid composite ID format: "${compositeId}". Expected "YYYY-MM-DDTHH:mm:ss.<messageId>".`
    );
  }
  const date = compositeId.slice(0, 19);
  const messageId = compositeId.slice(20);
  return { date, messageId };
}

/**
 * Search a single mailbox for an email by Message-ID header.
 * Returns the IMAP UID or null if not found.
 */
export async function resolveInMailbox(
  imapClient: ImapClient,
  messageId: string,
  mailbox: string
): Promise<number | null> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    const uids = await client.search(
      { header: { "Message-ID": messageId } } as any,
      { uid: true }
    );
    return uids && uids.length > 0 ? uids[0] : null;
  } finally {
    lock.release();
  }
}

/**
 * Resolve a composite ID to { uid, mailbox }.
 * Search order: mailboxHint → INBOX → all other folders.
 * Throws if the email cannot be found in any folder.
 */
export async function resolveEmailId(
  imapClient: ImapClient,
  compositeId: string,
  mailboxHint?: string
): Promise<{ uid: number; mailbox: string }> {
  const { messageId } = parseCompositeId(compositeId);

  // 1. Try the hint mailbox first
  if (mailboxHint) {
    const uid = await resolveInMailbox(imapClient, messageId, mailboxHint);
    if (uid) return { uid, mailbox: mailboxHint };
  }

  // 2. Try INBOX (skip if already tried as hint)
  if (mailboxHint !== "INBOX") {
    const uid = await resolveInMailbox(imapClient, messageId, "INBOX");
    if (uid) return { uid, mailbox: "INBOX" };
  }

  // 3. Scan all folders
  const folders = await listFolders(imapClient);
  const tried = new Set([mailboxHint, "INBOX"]);
  for (const folder of folders) {
    if (tried.has(folder.path)) continue;
    const uid = await resolveInMailbox(imapClient, messageId, folder.path);
    if (uid) return { uid, mailbox: folder.path };
  }

  throw new Error(
    `Email not found for ID "${compositeId}". It may have been deleted.`
  );
}
