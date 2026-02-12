import { describe, it, expect, vi } from "vitest";
import { listFolders } from "./folders.js";
import type { ImapClient } from "./client.js";

function createMockImapClient(mailboxes: any[]) {
  const mockClient = {
    list: vi.fn().mockResolvedValue(mailboxes),
  };

  const imapClient = {
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient };
}

describe("listFolders", () => {
  it("returns empty array when no mailboxes exist", async () => {
    const { imapClient } = createMockImapClient([]);
    const result = await listFolders(imapClient);
    expect(result).toEqual([]);
  });

  it("maps mailbox properties to folder entries", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "/", flags: new Set() },
      { path: "INBOX/Receipts", name: "Receipts", delimiter: "/", flags: new Set() },
      { path: "Sent", name: "Sent", delimiter: "/", flags: new Set(["\\Sent"]) },
    ]);

    const result = await listFolders(imapClient);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ path: "INBOX", name: "INBOX", delimiter: "/" });
    expect(result[1]).toEqual({ path: "INBOX/Receipts", name: "Receipts", delimiter: "/" });
    expect(result[2]).toEqual({ path: "Sent", name: "Sent", delimiter: "/" });
  });

  it("only includes path, name, and delimiter (strips extra properties)", async () => {
    const { imapClient } = createMockImapClient([
      {
        path: "INBOX",
        name: "INBOX",
        delimiter: ".",
        flags: new Set(["\\HasNoChildren"]),
        specialUse: "\\Inbox",
        listed: true,
        subscribed: true,
      },
    ]);

    const result = await listFolders(imapClient);
    expect(Object.keys(result[0])).toEqual(["path", "name", "delimiter"]);
  });

  it("handles dot delimiter servers", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "." },
      { path: "INBOX.Archive", name: "Archive", delimiter: "." },
    ]);

    const result = await listFolders(imapClient);
    expect(result[1]).toEqual({ path: "INBOX.Archive", name: "Archive", delimiter: "." });
  });
});
