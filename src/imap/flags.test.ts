import { describe, it, expect, vi } from "vitest";
import { starEmail, unstarEmail, listStarredEmails, listAllStarredEmails } from "./flags.js";
import type { ImapClient } from "./client.js";

vi.mock("./folders.js", () => ({
  listFolders: vi.fn().mockResolvedValue([]),
}));

import { listFolders } from "./folders.js";
const mockListFolders = vi.mocked(listFolders);

function createMockImapClient() {
  const mockClient = {
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    messageFlagsRemove: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue([]),
    fetch: vi.fn(),
  };

  const releaseFn = vi.fn();
  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue({ release: releaseFn }),
    getClient: vi.fn().mockReturnValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, releaseFn };
}

describe("starEmail", () => {
  it("adds \\Flagged flag to the email", async () => {
    const { imapClient, mockClient } = createMockImapClient();

    const result = await starEmail(imapClient, 42, "INBOX");

    expect(mockClient.messageFlagsAdd).toHaveBeenCalledWith(
      "42",
      ["\\Flagged"],
      { uid: true }
    );
    expect(result).toEqual({ uid: 42, starred: true });
  });

  it("uses default mailbox INBOX", async () => {
    const { imapClient } = createMockImapClient();

    await starEmail(imapClient, 1);

    expect(imapClient.openMailbox).toHaveBeenCalledWith("INBOX");
  });

  it("releases lock even on error", async () => {
    const { imapClient, mockClient, releaseFn } = createMockImapClient();
    mockClient.messageFlagsAdd.mockRejectedValue(new Error("fail"));

    await expect(starEmail(imapClient, 1)).rejects.toThrow("fail");
    expect(releaseFn).toHaveBeenCalled();
  });
});

describe("unstarEmail", () => {
  it("removes \\Flagged flag from the email", async () => {
    const { imapClient, mockClient } = createMockImapClient();

    const result = await unstarEmail(imapClient, 42, "INBOX");

    expect(mockClient.messageFlagsRemove).toHaveBeenCalledWith(
      "42",
      ["\\Flagged"],
      { uid: true }
    );
    expect(result).toEqual({ uid: 42, starred: false });
  });

  it("releases lock even on error", async () => {
    const { imapClient, mockClient, releaseFn } = createMockImapClient();
    mockClient.messageFlagsRemove.mockRejectedValue(new Error("fail"));

    await expect(unstarEmail(imapClient, 1)).rejects.toThrow("fail");
    expect(releaseFn).toHaveBeenCalled();
  });
});

describe("listStarredEmails", () => {
  it("searches with { flagged: true } and returns sorted emails", async () => {
    const { imapClient, mockClient } = createMockImapClient();
    mockClient.search.mockResolvedValue([10, 20]);

    const messages = [
      {
        uid: 10,
        envelope: {
          subject: "Older",
          from: [{ address: "a@test.com" }],
          date: new Date("2026-01-01"),
          messageId: "<msg-10@test.com>",
        },
      },
      {
        uid: 20,
        envelope: {
          subject: "Newer",
          from: [{ address: "b@test.com" }],
          date: new Date("2026-02-01"),
          messageId: "<msg-20@test.com>",
        },
      },
    ];

    mockClient.fetch.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m;
      },
    });

    const result = await listStarredEmails(imapClient, "INBOX");

    expect(mockClient.search).toHaveBeenCalledWith(
      { flagged: true },
      { uid: true }
    );
    expect(result).toHaveLength(2);
    // Newest first
    expect(result[0].id).toBe("2026-02-01T00:00:00.<msg-20@test.com>");
    expect(result[1].id).toBe("2026-01-01T00:00:00.<msg-10@test.com>");
  });

  it("returns empty array when no starred emails", async () => {
    const { imapClient, mockClient } = createMockImapClient();
    mockClient.search.mockResolvedValue([]);

    const result = await listStarredEmails(imapClient);

    expect(result).toEqual([]);
  });

  it("releases lock even on error", async () => {
    const { imapClient, mockClient, releaseFn } = createMockImapClient();
    mockClient.search.mockRejectedValue(new Error("fail"));

    await expect(listStarredEmails(imapClient)).rejects.toThrow("fail");
    expect(releaseFn).toHaveBeenCalled();
  });
});

describe("listAllStarredEmails", () => {
  function makeFetchIterator(messages: any[]) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const m of messages) yield m;
      },
    };
  }

  it("returns starred emails grouped by folder, sorted by folder path", async () => {
    const { imapClient, mockClient } = createMockImapClient();

    mockListFolders.mockResolvedValue([
      { path: "Sent", name: "Sent", delimiter: "/" },
      { path: "INBOX", name: "INBOX", delimiter: "/" },
    ]);

    // Track which mailbox is opened to return different results per folder
    let currentMailbox = "";
    (imapClient.openMailbox as ReturnType<typeof vi.fn>).mockImplementation(
      async (mb: string) => {
        currentMailbox = mb;
        return { release: vi.fn() };
      }
    );

    mockClient.search.mockImplementation(async () => {
      if (currentMailbox === "INBOX") return [10];
      if (currentMailbox === "Sent") return [20, 30];
      return [];
    });

    mockClient.fetch.mockImplementation(() => {
      if (currentMailbox === "INBOX") {
        return makeFetchIterator([
          {
            uid: 10,
            envelope: {
              subject: "Inbox starred",
              from: [{ address: "a@test.com" }],
              date: new Date("2026-01-15"),
              messageId: "<msg-10@test.com>",
            },
          },
        ]);
      }
      // Sent folder
      return makeFetchIterator([
        {
          uid: 20,
          envelope: {
            subject: "Sent older",
            from: [{ address: "b@test.com" }],
            date: new Date("2026-01-01"),
            messageId: "<msg-20@test.com>",
          },
        },
        {
          uid: 30,
          envelope: {
            subject: "Sent newer",
            from: [{ address: "c@test.com" }],
            date: new Date("2026-02-01"),
            messageId: "<msg-30@test.com>",
          },
        },
      ]);
    });

    const result = await listAllStarredEmails(imapClient);

    expect(result).toHaveLength(2);
    // Sorted by folder path: INBOX < Sent
    expect(result[0].folder).toBe("INBOX");
    expect(result[0].count).toBe(1);
    expect(result[0].emails).toHaveLength(1);
    expect(result[1].folder).toBe("Sent");
    expect(result[1].count).toBe(2);
    // Newest first within group
    expect(result[1].emails[0].subject).toBe("Sent newer");
    expect(result[1].emails[1].subject).toBe("Sent older");
  });

  it("skips folders with no starred emails", async () => {
    const { imapClient, mockClient } = createMockImapClient();

    mockListFolders.mockResolvedValue([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
      { path: "Trash", name: "Trash", delimiter: "/" },
    ]);

    mockClient.search.mockResolvedValue([]);

    const result = await listAllStarredEmails(imapClient);

    expect(result).toEqual([]);
  });

  it("returns empty array when no folders exist", async () => {
    const { imapClient } = createMockImapClient();

    mockListFolders.mockResolvedValue([]);

    const result = await listAllStarredEmails(imapClient);

    expect(result).toEqual([]);
  });
});
