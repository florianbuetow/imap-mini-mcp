// ABOUTME: IMAP flag operations: star/unstar emails and list starred emails.
// ABOUTME: Supports both standard \Flagged and macOS Apple Mail $MailFlagBit* keywords.

import type { ImapClient } from "./client.js";
import type { EmailEntry } from "./types.js";
import { extractEmailAddress } from "./search.js";
import { buildCompositeId } from "./resolve.js";
import { listFolders } from "./folders.js";

/** Apple Mail colored-flag keywords ($MailFlagBit0/1/2 encode the 3-bit color index). */
export const MACOS_FLAG_KEYWORDS = ["$MailFlagBit0", "$MailFlagBit1", "$MailFlagBit2"];

export interface StarredFolderGroup {
  folder: string;
  count: number;
  emails: EmailEntry[];
}

/**
 * Add the \Flagged (starred) flag to an email.
 */
export async function starEmail(
  imapClient: ImapClient,
  uid: number,
  mailbox: string = "INBOX"
): Promise<{ uid: number; starred: boolean }> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true });
    return { uid, starred: true };
  } finally {
    lock.release();
  }
}

/**
 * Remove the \Flagged (starred) flag from an email.
 * Also removes macOS Apple Mail $MailFlagBit* keywords (best-effort).
 */
export async function unstarEmail(
  imapClient: ImapClient,
  uid: number,
  mailbox: string = "INBOX"
): Promise<{ uid: number; starred: boolean }> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    await client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true });
    try {
      await client.messageFlagsRemove(String(uid), MACOS_FLAG_KEYWORDS, { uid: true });
    } catch {
      // Server may not support these keywords; ignore
    }
    return { uid, starred: false };
  } finally {
    lock.release();
  }
}

/**
 * Add the \Seen (read) flag to an email.
 */
export async function markRead(
  imapClient: ImapClient,
  uid: number,
  mailbox: string = "INBOX"
): Promise<{ uid: number; read: boolean }> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    return { uid, read: true };
  } finally {
    lock.release();
  }
}

/**
 * Remove the \Seen (read) flag from an email.
 */
export async function markUnread(
  imapClient: ImapClient,
  uid: number,
  mailbox: string = "INBOX"
): Promise<{ uid: number; read: boolean }> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    return { uid, read: false };
  } finally {
    lock.release();
  }
}

/**
 * Builds the IMAP search query that matches \Flagged emails and all
 * Apple Mail color-flag keywords ($MailFlagBit*).
 */
function buildFlaggedOrColorQuery() {
  return {
    or: [
      { flagged: true as const },
      ...MACOS_FLAG_KEYWORDS.map((k) => ({ keyword: k })),
    ],
  };
}

/**
 * List all starred (flagged) emails in a mailbox, including emails that carry
 * an Apple Mail $MailFlagBit* color keyword but not the standard \Flagged flag.
 * Returns EmailEntry[] sorted newest-first by envelope date.
 */
export async function listStarredEmails(
  imapClient: ImapClient,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const uids = await client.search(buildFlaggedOrColorQuery(), { uid: true });

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

export interface ColoredEmailEntry extends EmailEntry {
  color: string;
}

export interface ColoredFolderGroup {
  folder: string;
  count: number;
  emails: ColoredEmailEntry[];
}

/**
 * List starred emails in a mailbox with their Apple Mail color tag.
 * Searches for \Flagged and $MailFlagBit* keywords, then returns only
 * messages that have a flagColor (i.e. a colored Apple Mail flag).
 * Pass a color name to filter results to that color only.
 */
export async function listEmailsByColor(
  imapClient: ImapClient,
  mailbox: string = "INBOX",
  color?: string
): Promise<ColoredEmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const uids = await client.search(buildFlaggedOrColorQuery(), { uid: true });

    if (!uids || uids.length === 0) {
      return [];
    }

    const sortedUids = uids.sort((a, b) => b - a);
    const results: ColoredEmailEntry[] = [];

    for await (const msg of client.fetch(
      sortedUids.join(","),
      { uid: true, envelope: true, flags: true },
      { uid: true }
    )) {
      const flagColor: string | undefined = (msg as unknown as Record<string, unknown>).flagColor as string | undefined;
      if (!flagColor) continue;
      if (color && flagColor !== color) continue;

      results.push({
        id: buildCompositeId(msg.envelope?.date || new Date(0), msg.envelope?.messageId || ""),
        subject: msg.envelope?.subject || "(no subject)",
        from: extractEmailAddress(msg.envelope?.from),
        date: msg.envelope?.date?.toISOString() || "",
        color: flagColor,
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
 * List color-flagged emails across all folders, grouped by folder.
 * Folders with no color-flagged emails are omitted. Groups sorted by folder path,
 * emails sorted newest-first within each group.
 * Pass a color name to filter results to that color only.
 */
export async function listAllEmailsByColor(
  imapClient: ImapClient,
  color?: string
): Promise<ColoredFolderGroup[]> {
  const folders = await listFolders(imapClient);
  const groups: ColoredFolderGroup[] = [];

  for (const folder of folders) {
    const emails = await listEmailsByColor(imapClient, folder.path, color);
    if (emails.length > 0) {
      groups.push({ folder: folder.path, count: emails.length, emails });
    }
  }

  groups.sort((a, b) => a.folder.localeCompare(b.folder));
  return groups;
}

/**
 * List starred emails across all folders, grouped by folder.
 * Folders with no starred emails are omitted. Groups sorted by folder path,
 * emails sorted newest-first within each group.
 */
export async function listAllStarredEmails(
  imapClient: ImapClient
): Promise<StarredFolderGroup[]> {
  const folders = await listFolders(imapClient);
  const groups: StarredFolderGroup[] = [];

  for (const folder of folders) {
    const emails = await listStarredEmails(imapClient, folder.path);
    if (emails.length > 0) {
      groups.push({ folder: folder.path, count: emails.length, emails });
    }
  }

  groups.sort((a, b) => a.folder.localeCompare(b.folder));
  return groups;
}
