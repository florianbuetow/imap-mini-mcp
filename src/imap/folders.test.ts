import { describe, it, expect, vi } from "vitest";
import { listFolders, addLabel, removeLabel, listLabels } from "./folders.js";
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

// ---------------------------------------------------------------------------
// listLabels
// ---------------------------------------------------------------------------

describe("listLabels", () => {
  it("returns only folders under Labels/ namespace", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
      { path: "Labels/Work", name: "Work", delimiter: "/" },
      { path: "Labels/Important", name: "Important", delimiter: "/" },
      { path: "Sent", name: "Sent", delimiter: "/" },
    ]);

    const result = await listLabels(imapClient);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ path: "Labels/Work", name: "Work", delimiter: "/" });
    expect(result[1]).toEqual({ path: "Labels/Important", name: "Important", delimiter: "/" });
  });

  it("returns empty array when no labels exist", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
      { path: "Sent", name: "Sent", delimiter: "/" },
    ]);

    const result = await listLabels(imapClient);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addLabel
// ---------------------------------------------------------------------------

function createMockImapClientWithLabelOps() {
  const mockLock = { release: vi.fn() };
  const mockClient = {
    messageCopy: vi.fn().mockResolvedValue(true),
    messageDelete: vi.fn().mockResolvedValue(undefined),
  };

  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue(mockLock),
    getClient: vi.fn().mockReturnValue(mockClient),
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, mockLock };
}

describe("addLabel", () => {
  it("copies email to Labels/<name> folder", async () => {
    const { imapClient, mockClient } = createMockImapClientWithLabelOps();

    const result = await addLabel(imapClient, 42, "INBOX", "Work");

    expect(mockClient.messageCopy).toHaveBeenCalledWith("42", "Labels/Work", { uid: true });
    expect(result).toEqual({ labelPath: "Labels/Work" });
  });

  it("opens the source mailbox before copying", async () => {
    const { imapClient } = createMockImapClientWithLabelOps();

    await addLabel(imapClient, 99, "Sent", "Important");

    expect(imapClient.openMailbox).toHaveBeenCalledWith("Sent");
  });

  it("throws when copy fails", async () => {
    const { imapClient, mockClient } = createMockImapClientWithLabelOps();
    mockClient.messageCopy.mockResolvedValue(false);

    await expect(addLabel(imapClient, 42, "INBOX", "Work")).rejects.toThrow(
      'Failed to copy email to label "Work".'
    );
  });

  it("releases the lock on success", async () => {
    const { imapClient, mockLock } = createMockImapClientWithLabelOps();

    await addLabel(imapClient, 42, "INBOX", "Work");
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("releases the lock on error", async () => {
    const { imapClient, mockClient, mockLock } = createMockImapClientWithLabelOps();
    mockClient.messageCopy.mockRejectedValue(new Error("copy failed"));

    await expect(addLabel(imapClient, 42, "INBOX", "Work")).rejects.toThrow("copy failed");
    expect(mockLock.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeLabel
// ---------------------------------------------------------------------------

describe("removeLabel", () => {
  it("deletes email in Labels/<name> folder", async () => {
    const { imapClient, mockClient } = createMockImapClientWithLabelOps();

    const result = await removeLabel(imapClient, 55, "Work");

    expect(mockClient.messageDelete).toHaveBeenCalledWith("55", { uid: true });
    expect(result).toEqual({ removed: true });
  });

  it("opens the label folder before deleting", async () => {
    const { imapClient } = createMockImapClientWithLabelOps();

    await removeLabel(imapClient, 55, "Work");

    expect(imapClient.openMailbox).toHaveBeenCalledWith("Labels/Work");
  });

  it("releases the lock on success", async () => {
    const { imapClient, mockLock } = createMockImapClientWithLabelOps();

    await removeLabel(imapClient, 55, "Work");
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("releases the lock on error", async () => {
    const { imapClient, mockClient, mockLock } = createMockImapClientWithLabelOps();
    mockClient.messageDelete.mockRejectedValue(new Error("delete failed"));

    await expect(removeLabel(imapClient, 55, "Work")).rejects.toThrow("delete failed");
    expect(mockLock.release).toHaveBeenCalled();
  });
});
