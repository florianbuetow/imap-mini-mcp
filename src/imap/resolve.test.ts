import { describe, it, expect, vi } from "vitest";
import {
  buildCompositeId,
  parseCompositeId,
  resolveInMailbox,
  resolveEmailId,
} from "./resolve.js";
import type { ImapClient } from "./client.js";

// ---------------------------------------------------------------------------
// buildCompositeId
// ---------------------------------------------------------------------------

describe("buildCompositeId", () => {
  it("formats a Date object correctly", () => {
    const date = new Date("2026-02-12T14:30:25.000Z");
    const result = buildCompositeId(date, "<abc123@mail.example.com>");
    expect(result).toBe("2026-02-12T14:30:25.<abc123@mail.example.com>");
  });

  it("formats a date string correctly", () => {
    const result = buildCompositeId(
      "2026-01-01T00:00:00.000Z",
      "<msg@example.com>"
    );
    expect(result).toBe("2026-01-01T00:00:00.<msg@example.com>");
  });

  it("handles empty messageId", () => {
    const date = new Date("2026-02-12T14:30:25.000Z");
    const result = buildCompositeId(date, "");
    expect(result).toBe("2026-02-12T14:30:25.");
  });

  it("truncates milliseconds from ISO date", () => {
    const date = new Date("2026-06-15T09:45:30.123Z");
    const result = buildCompositeId(date, "<test@example.com>");
    expect(result).toBe("2026-06-15T09:45:30.<test@example.com>");
  });
});

// ---------------------------------------------------------------------------
// parseCompositeId
// ---------------------------------------------------------------------------

describe("parseCompositeId", () => {
  it("parses a valid composite ID", () => {
    const result = parseCompositeId(
      "2026-02-12T14:30:25.<abc123@mail.example.com>"
    );
    expect(result.date).toBe("2026-02-12T14:30:25");
    expect(result.messageId).toBe("<abc123@mail.example.com>");
  });

  it("handles empty messageId portion", () => {
    const result = parseCompositeId("2026-02-12T14:30:25.");
    expect(result.date).toBe("2026-02-12T14:30:25");
    expect(result.messageId).toBe("");
  });

  it("throws on too-short string", () => {
    expect(() => parseCompositeId("short")).toThrow("Invalid composite ID");
  });

  it("throws when separator is not a dot", () => {
    expect(() =>
      parseCompositeId("2026-02-12T14:30:25X<msg@example.com>")
    ).toThrow("Invalid composite ID");
  });
});

// ---------------------------------------------------------------------------
// resolveInMailbox
// ---------------------------------------------------------------------------

function createMockImapClient(searchResult: number[]) {
  const mockLock = { release: vi.fn() };
  const mockClient = {
    search: vi.fn().mockResolvedValue(searchResult),
  };

  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue(mockLock),
    getClient: vi.fn().mockReturnValue(mockClient),
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, mockLock };
}

describe("resolveInMailbox", () => {
  it("returns UID when email is found", async () => {
    const { imapClient } = createMockImapClient([42]);

    const result = await resolveInMailbox(
      imapClient,
      "<msg@example.com>",
      "INBOX"
    );
    expect(result).toBe(42);
  });

  it("returns null when email is not found", async () => {
    const { imapClient } = createMockImapClient([]);

    const result = await resolveInMailbox(
      imapClient,
      "<msg@example.com>",
      "INBOX"
    );
    expect(result).toBeNull();
  });

  it("searches with Message-ID header", async () => {
    const { imapClient, mockClient } = createMockImapClient([]);

    await resolveInMailbox(imapClient, "<msg@example.com>", "INBOX");

    expect(mockClient.search).toHaveBeenCalledWith(
      { header: { "Message-ID": "<msg@example.com>" } },
      { uid: true }
    );
  });

  it("releases lock even on error", async () => {
    const { imapClient, mockClient, mockLock } = createMockImapClient([]);
    mockClient.search.mockRejectedValue(new Error("search failed"));

    await expect(
      resolveInMailbox(imapClient, "<msg@example.com>", "INBOX")
    ).rejects.toThrow("search failed");
    expect(mockLock.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveEmailId
// ---------------------------------------------------------------------------

describe("resolveEmailId", () => {
  it("finds email in hint mailbox first", async () => {
    const { imapClient } = createMockImapClient([42]);

    const result = await resolveEmailId(
      imapClient,
      "2026-02-12T14:30:25.<msg@example.com>",
      "Sent"
    );
    expect(result).toEqual({ uid: 42, mailbox: "Sent" });
    expect(imapClient.openMailbox).toHaveBeenCalledWith("Sent");
  });

  it("falls back to INBOX when hint fails", async () => {
    const mockLock = { release: vi.fn() };
    const mockClient = {
      search: vi
        .fn()
        .mockResolvedValueOnce([]) // Sent: not found
        .mockResolvedValueOnce([99]), // INBOX: found
    };

    const imapClient = {
      openMailbox: vi.fn().mockResolvedValue(mockLock),
      getClient: vi.fn().mockReturnValue(mockClient),
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as ImapClient;

    const result = await resolveEmailId(
      imapClient,
      "2026-02-12T14:30:25.<msg@example.com>",
      "Sent"
    );
    expect(result).toEqual({ uid: 99, mailbox: "INBOX" });
  });

  it("throws when email not found anywhere", async () => {
    const mockLock = { release: vi.fn() };
    const mockClient = {
      search: vi.fn().mockResolvedValue([]),
      list: vi
        .fn()
        .mockResolvedValue([
          { path: "INBOX", name: "INBOX", delimiter: "/" },
          { path: "Sent", name: "Sent", delimiter: "/" },
        ]),
    };

    const imapClient = {
      openMailbox: vi.fn().mockResolvedValue(mockLock),
      getClient: vi.fn().mockReturnValue(mockClient),
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as ImapClient;

    await expect(
      resolveEmailId(
        imapClient,
        "2026-02-12T14:30:25.<msg@example.com>"
      )
    ).rejects.toThrow("Email not found");
  });
});
