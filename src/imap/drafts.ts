import { createMimeMessage } from "mimetext";
import type { ImapClient } from "./client.js";

export interface DraftOptions {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  /** UID of the email being replied to (sets In-Reply-To and References headers) */
  inReplyTo?: number;
  /** Mailbox containing the email being replied to (default: "INBOX") */
  inReplyToMailbox?: string;
}

export interface DraftResult {
  uid: number;
  subject: string;
  to: string;
  date: string;
}

/**
 * Find the Drafts folder by looking for the \Drafts special-use attribute.
 * Falls back to a folder named "Drafts" if no special-use attribute is found.
 */
export async function findDraftsFolder(imapClient: ImapClient): Promise<string> {
  const client = await imapClient.connect();
  const mailboxes = await client.list();

  // Look for \Drafts special-use attribute
  for (const mb of mailboxes) {
    if (mb.specialUse === "\\Drafts") {
      return mb.path;
    }
  }

  // Fallback: look for a folder named "Drafts" (case-insensitive)
  for (const mb of mailboxes) {
    if (mb.name.toLowerCase() === "drafts") {
      return mb.path;
    }
  }

  throw new Error(
    "Could not find Drafts folder. Available folders can be listed with list_folders."
  );
}

/**
 * Fetch the Message-ID header from an email by UID.
 */
async function fetchMessageId(
  imapClient: ImapClient,
  uid: number,
  mailbox: string
): Promise<string | null> {
  const lock = await imapClient.openMailbox(mailbox);
  try {
    const client = imapClient.getClient();
    const msg = await client.fetchOne(String(uid), {
      uid: true,
      headers: true,
    }, { uid: true });

    if (!msg || !msg.headers) return null;

    // msg.headers is a Buffer containing raw headers
    const headersStr = msg.headers.toString("utf-8");
    const match = headersStr.match(/^Message-ID:\s*(.+)$/mi);
    return match ? match[1].trim() : null;
  } finally {
    lock.release();
  }
}

/**
 * Build a raw RFC 2822 message from draft options.
 */
function buildMessage(
  sender: string,
  options: DraftOptions,
  messageId?: string | null
): string {
  const msg = createMimeMessage();

  msg.setSender(sender);
  msg.setTo(options.to);
  msg.setSubject(options.subject);

  if (options.cc) {
    msg.setCc(options.cc);
  }
  if (options.bcc) {
    msg.setBcc(options.bcc);
  }

  if (messageId) {
    msg.setHeader("In-Reply-To", messageId);
    msg.setHeader("References", messageId);
  }

  msg.addMessage({
    contentType: "text/plain",
    data: options.body,
  });

  return msg.asRaw();
}

/**
 * Create a new email draft in the Drafts folder.
 * If `inReplyTo` is provided, fetches the original email's Message-ID
 * and sets In-Reply-To + References headers for proper threading.
 */
export async function createDraft(
  imapClient: ImapClient,
  sender: string,
  options: DraftOptions
): Promise<DraftResult> {
  let replyMessageId: string | null = null;
  if (options.inReplyTo) {
    const mailbox = options.inReplyToMailbox || "INBOX";
    replyMessageId = await fetchMessageId(imapClient, options.inReplyTo, mailbox);
  }

  const raw = buildMessage(sender, options, replyMessageId);
  const draftsFolder = await findDraftsFolder(imapClient);
  const client = await imapClient.connect();

  const result = await client.append(
    draftsFolder,
    Buffer.from(raw, "utf-8"),
    ["\\Draft", "\\Seen"]
  );

  const uid = result && result.uid ? result.uid : 0;

  return {
    uid,
    subject: options.subject,
    to: options.to,
    date: new Date().toISOString(),
  };
}

/**
 * Replace an existing draft. Verifies the UID is in the Drafts folder,
 * appends the new version, then deletes the old one.
 */
export async function updateDraft(
  imapClient: ImapClient,
  sender: string,
  uid: number,
  options: DraftOptions
): Promise<DraftResult> {
  const draftsFolder = await findDraftsFolder(imapClient);

  // Verify the UID exists in the Drafts folder
  const lock = await imapClient.openMailbox(draftsFolder);
  try {
    const client = imapClient.getClient();

    const msg = await client.fetchOne(String(uid), { uid: true }, { uid: true });
    if (!msg) {
      throw new Error(
        "You can only update drafts. The email you provided is not in the drafts folder."
      );
    }
  } finally {
    lock.release();
  }

  // Create the replacement draft
  const newDraft = await createDraft(imapClient, sender, options);

  // Delete the old draft
  const deleteLock = await imapClient.openMailbox(draftsFolder);
  try {
    const client = imapClient.getClient();
    await client.messageDelete(String(uid), { uid: true });
  } finally {
    deleteLock.release();
  }

  return newDraft;
}
