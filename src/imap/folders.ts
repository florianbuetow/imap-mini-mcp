import type { ImapClient } from "./client.js";

export interface FolderEntry {
  /** Full path of the folder (e.g. "INBOX/Receipts") */
  path: string;
  /** Display name (e.g. "Receipts") */
  name: string;
  /** Path delimiter used by the server (e.g. "/" or ".") */
  delimiter: string;
}

/**
 * List all folders in the account.
 */
export async function listFolders(
  imapClient: ImapClient
): Promise<FolderEntry[]> {
  const client = await imapClient.connect();
  const mailboxes = await client.list();

  return mailboxes.map((mb) => ({
    path: mb.path,
    name: mb.name,
    delimiter: mb.delimiter,
  }));
}

/**
 * Create a new folder. Returns the created path.
 */
export async function createFolder(
  imapClient: ImapClient,
  path: string
): Promise<string> {
  const client = await imapClient.connect();
  await client.mailboxCreate(path);
  return path;
}

/**
 * Move an email from one folder to another.
 * Returns the new UID of the email in the destination folder (if the server reports it).
 */
export async function moveEmail(
  imapClient: ImapClient,
  uid: number,
  sourceFolder: string,
  destinationFolder: string
): Promise<{ uid: number; destination: string }> {
  const lock = await imapClient.openMailbox(sourceFolder);
  try {
    const client = imapClient.getClient();
    const result = await client.messageMove(String(uid), destinationFolder, {
      uid: true,
    });

    // imapflow returns false on failure, or a CopyResponseObject with uidMap
    const newUid =
      result && result.uidMap ? result.uidMap.get(uid) : undefined;

    return {
      uid: newUid ?? uid,
      destination: destinationFolder,
    };
  } finally {
    lock.release();
  }
}
