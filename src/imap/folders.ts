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

/**
 * Check whether a folder path exists on the server.
 */
export async function folderExists(
  imapClient: ImapClient,
  path: string
): Promise<boolean> {
  const folders = await listFolders(imapClient);
  return folders.some((f) => f.path === path);
}

/**
 * Bulk-move all emails matching a FROM query from one folder to another.
 * Returns the number of emails moved.
 *
 * @param fromQuery - full email address or "@domain" to match against the From header
 */
export async function bulkMoveBySender(
  imapClient: ImapClient,
  sourceFolder: string,
  destinationFolder: string,
  fromQuery: string
): Promise<number> {
  const lock = await imapClient.openMailbox(sourceFolder);
  try {
    const client = imapClient.getClient();

    const uids = await client.search({ from: fromQuery }, { uid: true });
    if (!uids || uids.length === 0) {
      return 0;
    }

    await client.messageMove(uids.join(","), destinationFolder, { uid: true });
    return uids.length;
  } finally {
    lock.release();
  }
}
