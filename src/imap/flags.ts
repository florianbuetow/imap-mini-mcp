import type { ImapClient } from "./client.js";
import type { EmailEntry } from "./types.js";
import { extractEmailAddress } from "./search.js";
import { buildCompositeId } from "./resolve.js";

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
    return { uid, starred: false };
  } finally {
    lock.release();
  }
}

/**
 * List all starred (flagged) emails in a mailbox.
 * Returns EmailEntry[] sorted newest-first by envelope date.
 */
export async function listStarredEmails(
  imapClient: ImapClient,
  mailbox: string = "INBOX"
): Promise<EmailEntry[]> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();

    const uids = await client.search({ flagged: true }, { uid: true });

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
