import { describe, it, expect, vi } from "vitest";
import { starEmail, unstarEmail, listStarredEmails } from "./flags.js";
import type { ImapClient } from "./client.js";

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
