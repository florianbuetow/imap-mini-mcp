import { describe, it, expect, vi } from "vitest";
import { listFolders, createFolder, folderExists, moveEmail, bulkMoveBySender, addLabel, removeLabel, listLabels } from "./folders.js";
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

// ---------------------------------------------------------------------------
// createFolder
// ---------------------------------------------------------------------------

describe("createFolder", () => {
  it("creates the mailbox and returns its path", async () => {
    const mockClient = { mailboxCreate: vi.fn().mockResolvedValue({}) };
    const imapClient = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as ImapClient;

    const result = await createFolder(imapClient, "INBOX/Receipts");

    expect(mockClient.mailboxCreate).toHaveBeenCalledWith("INBOX/Receipts");
    expect(result).toBe("INBOX/Receipts");
  });

  it("propagates server errors", async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockRejectedValue(new Error("already exists")),
    };
    const imapClient = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as ImapClient;

    await expect(createFolder(imapClient, "INBOX")).rejects.toThrow("already exists");
  });
});

// ---------------------------------------------------------------------------
// folderExists
// ---------------------------------------------------------------------------

describe("folderExists", () => {
  it("returns true when the exact path exists", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
      { path: "INBOX/Receipts", name: "Receipts", delimiter: "/" },
    ]);

    expect(await folderExists(imapClient, "INBOX/Receipts")).toBe(true);
  });

  it("returns false when the path does not exist", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
    ]);

    expect(await folderExists(imapClient, "Archive")).toBe(false);
  });

  it("does not match on the display name alone", async () => {
    const { imapClient } = createMockImapClient([
      { path: "INBOX/Receipts", name: "Receipts", delimiter: "/" },
    ]);

    expect(await folderExists(imapClient, "Receipts")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// moveEmail
// ---------------------------------------------------------------------------

function createMockImapClientWithMove(moveResult: unknown) {
  const mockLock = { release: vi.fn() };
  const mockClient = {
    messageMove: vi.fn().mockResolvedValue(moveResult),
  };
  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue(mockLock),
    getClient: vi.fn().mockReturnValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, mockLock };
}

describe("moveEmail", () => {
  it("moves by UID from the source folder to the destination", async () => {
    const { imapClient, mockClient } = createMockImapClientWithMove({
      uidMap: new Map([[42, 7]]),
    });

    await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(imapClient.openMailbox).toHaveBeenCalledWith("INBOX");
    expect(mockClient.messageMove).toHaveBeenCalledWith("42", "Archive", { uid: true });
  });

  it("returns the new UID reported by the server", async () => {
    const { imapClient } = createMockImapClientWithMove({
      uidMap: new Map([[42, 7]]),
    });

    const result = await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(result).toEqual({ uid: 7, destination: "Archive" });
  });

  it("keeps the original UID when the server reports no uidMap", async () => {
    const { imapClient } = createMockImapClientWithMove({});

    const result = await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(result).toEqual({ uid: 42, destination: "Archive" });
  });

  it("keeps the original UID when the move reports failure (false)", async () => {
    const { imapClient } = createMockImapClientWithMove(false);

    const result = await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(result).toEqual({ uid: 42, destination: "Archive" });
  });

  it("keeps the original UID when the uidMap has no entry for it", async () => {
    const { imapClient } = createMockImapClientWithMove({
      uidMap: new Map([[99, 5]]),
    });

    const result = await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(result.uid).toBe(42);
  });

  it("releases the lock on success", async () => {
    const { imapClient, mockLock } = createMockImapClientWithMove({});

    await moveEmail(imapClient, 42, "INBOX", "Archive");

    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on error", async () => {
    const { imapClient, mockClient, mockLock } = createMockImapClientWithMove({});
    mockClient.messageMove.mockRejectedValue(new Error("move failed"));

    await expect(moveEmail(imapClient, 42, "INBOX", "Archive")).rejects.toThrow("move failed");
    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// bulkMoveBySender
// ---------------------------------------------------------------------------

function createMockImapClientWithBulkMove(uids: number[] | false) {
  const mockLock = { release: vi.fn() };
  const mockClient = {
    search: vi.fn().mockResolvedValue(uids),
    messageMove: vi.fn().mockResolvedValue({}),
  };
  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue(mockLock),
    getClient: vi.fn().mockReturnValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, mockLock };
}

describe("bulkMoveBySender", () => {
  it("searches the source folder by From and moves all matching UIDs in one call", async () => {
    const { imapClient, mockClient } = createMockImapClientWithBulkMove([3, 5, 8]);

    const moved = await bulkMoveBySender(imapClient, "INBOX", "Newsletters", "@news.example.com");

    expect(imapClient.openMailbox).toHaveBeenCalledWith("INBOX");
    expect(mockClient.search).toHaveBeenCalledWith({ from: "@news.example.com" }, { uid: true });
    expect(mockClient.messageMove).toHaveBeenCalledTimes(1);
    expect(mockClient.messageMove).toHaveBeenCalledWith("3,5,8", "Newsletters", { uid: true });
    expect(moved).toBe(3);
  });

  it("returns 0 and moves nothing when no email matches", async () => {
    const { imapClient, mockClient } = createMockImapClientWithBulkMove([]);

    const moved = await bulkMoveBySender(imapClient, "INBOX", "Newsletters", "a@b.com");

    expect(moved).toBe(0);
    expect(mockClient.messageMove).not.toHaveBeenCalled();
  });

  it("returns 0 and moves nothing when the search reports failure (false)", async () => {
    const { imapClient, mockClient } = createMockImapClientWithBulkMove(false);

    const moved = await bulkMoveBySender(imapClient, "INBOX", "Newsletters", "a@b.com");

    expect(moved).toBe(0);
    expect(mockClient.messageMove).not.toHaveBeenCalled();
  });

  it("releases the lock when nothing matches", async () => {
    const { imapClient, mockLock } = createMockImapClientWithBulkMove([]);

    await bulkMoveBySender(imapClient, "INBOX", "Newsletters", "a@b.com");

    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });

  it("releases the lock on error", async () => {
    const { imapClient, mockClient, mockLock } = createMockImapClientWithBulkMove([1]);
    mockClient.messageMove.mockRejectedValue(new Error("move failed"));

    await expect(
      bulkMoveBySender(imapClient, "INBOX", "Newsletters", "a@b.com")
    ).rejects.toThrow("move failed");
    expect(mockLock.release).toHaveBeenCalledTimes(1);
  });
});
