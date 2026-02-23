import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTimeParam, hasAttachmentPart, findEmails, extractEmailAddress, fetchEmailContent, fetchEmailAttachment } from "./search.js";
import type { ImapClient } from "./client.js";
import type { MessageStructureObject } from "imapflow";

// ---------------------------------------------------------------------------
// parseTimeParam
// ---------------------------------------------------------------------------

describe("parseTimeParam", () => {
  it("parses minutes shorthand '30m'", () => {
    const before = Date.now();
    const result = parseTimeParam("30m");
    const diffMin = (before - result.getTime()) / (1000 * 60);
    expect(diffMin).toBeGreaterThanOrEqual(29.99);
    expect(diffMin).toBeLessThanOrEqual(30.01);
  });

  it("parses hours shorthand '2h'", () => {
    const before = Date.now();
    const result = parseTimeParam("2h");
    const diffHours = (before - result.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThanOrEqual(1.99);
    expect(diffHours).toBeLessThanOrEqual(2.01);
  });

  it("parses days shorthand '7d'", () => {
    const before = Date.now();
    const result = parseTimeParam("7d");
    const diffDays = (before - result.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(6.99);
    expect(diffDays).toBeLessThanOrEqual(7.01);
  });

  it("parses ISO date string", () => {
    const result = parseTimeParam("2026-02-20");
    expect(result.toISOString()).toContain("2026-02-20");
  });

  it("parses ISO datetime string", () => {
    const result = parseTimeParam("2026-02-20T15:00:00Z");
    expect(result.toISOString()).toBe("2026-02-20T15:00:00.000Z");
  });

  it("throws on invalid input", () => {
    expect(() => parseTimeParam("abc")).toThrow();
    expect(() => parseTimeParam("")).toThrow();
    expect(() => parseTimeParam("5x")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractEmailAddress
// ---------------------------------------------------------------------------

describe("extractEmailAddress", () => {
  it("returns empty string for null/undefined", () => {
    expect(extractEmailAddress(null)).toBe("");
    expect(extractEmailAddress(undefined)).toBe("");
  });

  it("returns the string as-is if given a string", () => {
    expect(extractEmailAddress("alice@example.com")).toBe("alice@example.com");
  });

  it("extracts address from an object with .address", () => {
    expect(
      extractEmailAddress({ name: "Alice", address: "alice@example.com" })
    ).toBe("alice@example.com");
  });

  it("extracts the first address from an array", () => {
    expect(
      extractEmailAddress([
        { name: "Alice", address: "alice@example.com" },
        { name: "Bob", address: "bob@example.com" },
      ])
    ).toBe("alice@example.com");
  });

  it("returns empty string for empty array", () => {
    expect(extractEmailAddress([])).toBe("");
  });

  it("handles object with only address, no name", () => {
    expect(extractEmailAddress({ address: "test@test.com" })).toBe(
      "test@test.com"
    );
  });

  it("returns empty string for object with neither address nor name", () => {
    expect(extractEmailAddress({})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Helpers: mock ImapClient
// ---------------------------------------------------------------------------

function createMockImapClient(overrides: {
  search?: number[];
  fetchMessages?: any[];
  fetchOneResult?: any;
}) {
  const mockLock = { release: vi.fn() };

  const mockFetchIterator = async function* () {
    for (const msg of overrides.fetchMessages || []) {
      yield msg;
    }
  };

  const mockClient = {
    search: vi.fn().mockResolvedValue(overrides.search || []),
    fetch: vi.fn().mockReturnValue(mockFetchIterator()),
    fetchOne: vi.fn().mockResolvedValue(overrides.fetchOneResult || null),
    getMailboxLock: vi.fn().mockResolvedValue(mockLock),
  };

  const imapClient = {
    openMailbox: vi.fn().mockResolvedValue(mockLock),
    getClient: vi.fn().mockReturnValue(mockClient),
    connect: vi.fn().mockResolvedValue(mockClient),
  } as unknown as ImapClient;

  return { imapClient, mockClient, mockLock };
}

// ---------------------------------------------------------------------------
// fetchEmailContent
// ---------------------------------------------------------------------------

describe("fetchEmailContent", () => {
  it("returns null when fetchOne returns null", async () => {
    const { imapClient } = createMockImapClient({ fetchOneResult: null });
    const result = await fetchEmailContent(imapClient, 999);
    expect(result).toBeNull();
  });

  it("returns email with (no body) when source is missing", async () => {
    const { imapClient } = createMockImapClient({
      fetchOneResult: {
        uid: 42,
        envelope: {
          subject: "Test",
          from: [{ address: "test@test.com" }],
          to: [{ address: "me@test.com" }],
          date: new Date("2026-02-10"),
          messageId: "<msg-42@test.com>",
        },
        source: null,
      },
    });

    const result = await fetchEmailContent(imapClient, 42);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("2026-02-10T00:00:00.<msg-42@test.com>");
    expect(result!.body).toBe("(no body)");
    expect(result!.attachments).toEqual([]);
  });

  it("parses a simple text/plain email", async () => {
    const rawEmail = Buffer.from(
      [
        "From: sender@example.com",
        "To: receiver@example.com",
        "Subject: Hello World",
        "Date: Tue, 10 Feb 2026 12:00:00 +0000",
        "Message-ID: <hello-world@example.com>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "This is the body of the email.",
      ].join("\r\n")
    );

    const { imapClient } = createMockImapClient({
      fetchOneResult: {
        uid: 101,
        envelope: {
          subject: "Hello World",
          from: [{ address: "sender@example.com" }],
          to: [{ address: "receiver@example.com" }],
          date: new Date("2026-02-10T12:00:00Z"),
          messageId: "<hello-world@example.com>",
        },
        source: rawEmail,
      },
    });

    const result = await fetchEmailContent(imapClient, 101);
    expect(result).not.toBeNull();
    expect(result!.id).toContain("<hello-world@example.com>");
    expect(result!.subject).toBe("Hello World");
    expect(result!.body).toContain("This is the body of the email.");
    expect(result!.attachments).toEqual([]);
  });

  it("detects attachments in multipart email", async () => {
    const boundary = "----boundary123";
    const rawEmail = Buffer.from(
      [
        "From: sender@example.com",
        "To: receiver@example.com",
        "Subject: With Attachment",
        "Date: Tue, 10 Feb 2026 12:00:00 +0000",
        "Message-ID: <att-email@example.com>",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Email body here.",
        `--${boundary}`,
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="report.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        "JVBERi0xLjQKMSAwIG9iago=",
        `--${boundary}--`,
      ].join("\r\n")
    );

    const { imapClient } = createMockImapClient({
      fetchOneResult: {
        uid: 102,
        envelope: {
          subject: "With Attachment",
          from: [{ address: "sender@example.com" }],
          to: [{ address: "receiver@example.com" }],
          date: new Date("2026-02-10T12:00:00Z"),
          messageId: "<att-email@example.com>",
        },
        source: rawEmail,
      },
    });

    const result = await fetchEmailContent(imapClient, 102);
    expect(result).not.toBeNull();
    expect(result!.body).toContain("Email body here.");
    expect(result!.attachments).toHaveLength(1);
    expect(result!.attachments[0].filename).toBe("report.pdf");
    expect(result!.attachments[0].contentType).toBe("application/pdf");
    expect(result!.attachments[0].size).toBeGreaterThan(0);
  });

  it("always releases the mailbox lock", async () => {
    const { imapClient, mockLock, mockClient } = createMockImapClient({});
    mockClient.fetchOne.mockRejectedValueOnce(new Error("fetch failed"));

    await expect(fetchEmailContent(imapClient, 1)).rejects.toThrow(
      "fetch failed"
    );
    expect(mockLock.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchEmailAttachment
// ---------------------------------------------------------------------------

describe("fetchEmailAttachment", () => {
  it("returns null when email not found", async () => {
    const { imapClient } = createMockImapClient({ fetchOneResult: null });
    const result = await fetchEmailAttachment(imapClient, 999, "att-0");
    expect(result).toBeNull();
  });

  it("returns null when attachment id doesn't match", async () => {
    const rawEmail = Buffer.from(
      [
        "From: sender@example.com",
        "To: receiver@example.com",
        "Subject: Test",
        "Content-Type: text/plain",
        "",
        "No attachments here.",
      ].join("\r\n")
    );

    const { imapClient } = createMockImapClient({
      fetchOneResult: { uid: 1, source: rawEmail },
    });

    const result = await fetchEmailAttachment(
      imapClient,
      1,
      "nonexistent-id"
    );
    expect(result).toBeNull();
  });

  it("returns base64-encoded attachment data", async () => {
    const boundary = "----boundary456";
    const rawEmail = Buffer.from(
      [
        "From: sender@example.com",
        "To: receiver@example.com",
        "Subject: With Attachment",
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        "Content-Type: text/plain",
        "",
        "Body.",
        `--${boundary}`,
        "Content-Type: text/csv",
        'Content-Disposition: attachment; filename="data.csv"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("name,value\nalice,42\n").toString("base64"),
        `--${boundary}--`,
      ].join("\r\n")
    );

    const { imapClient } = createMockImapClient({
      fetchOneResult: { uid: 50, source: rawEmail },
    });

    const result = await fetchEmailAttachment(
      imapClient,
      50,
      "attachment-0"
    );
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("data.csv");
    expect(result!.contentType).toBe("text/csv");
    expect(result!.contentBase64).toBeTruthy();

    // Decode and verify content
    const decoded = Buffer.from(result!.contentBase64, "base64").toString(
      "utf-8"
    );
    expect(decoded).toContain("name,value");
    expect(decoded).toContain("alice,42");
  });
});

// ---------------------------------------------------------------------------
// hasAttachmentPart
// ---------------------------------------------------------------------------

describe("hasAttachmentPart", () => {
  it("returns false for plain text message", () => {
    const struct: MessageStructureObject = { type: "text/plain" };
    expect(hasAttachmentPart(struct)).toBe(false);
  });

  it("returns true when disposition is 'attachment'", () => {
    const struct: MessageStructureObject = {
      type: "multipart/mixed",
      childNodes: [
        { type: "text/plain" },
        { type: "application/pdf", disposition: "attachment" },
      ],
    };
    expect(hasAttachmentPart(struct)).toBe(true);
  });

  it("returns true for nested attachment", () => {
    const struct: MessageStructureObject = {
      type: "multipart/mixed",
      childNodes: [
        {
          type: "multipart/alternative",
          childNodes: [
            { type: "text/plain" },
            { type: "text/html" },
          ],
        },
        { type: "image/png", disposition: "attachment" },
      ],
    };
    expect(hasAttachmentPart(struct)).toBe(true);
  });

  it("returns false when only inline images (no attachment disposition)", () => {
    const struct: MessageStructureObject = {
      type: "multipart/related",
      childNodes: [
        { type: "text/html" },
        { type: "image/png", disposition: "inline" },
      ],
    };
    expect(hasAttachmentPart(struct)).toBe(false);
  });

  it("returns false for null/undefined input", () => {
    expect(hasAttachmentPart(undefined as any)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findEmails
// ---------------------------------------------------------------------------

describe("findEmails", () => {
  it("returns all emails when no filters provided", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      search: [100, 200],
      fetchMessages: [
        {
          uid: 200,
          envelope: {
            subject: "Newer",
            from: [{ address: "b@test.com" }],
            date: new Date("2026-02-02"),
            messageId: "<msg-200@test.com>",
          },
        },
        {
          uid: 100,
          envelope: {
            subject: "Older",
            from: [{ address: "a@test.com" }],
            date: new Date("2026-02-01"),
            messageId: "<msg-100@test.com>",
          },
        },
      ],
    });

    const result = await findEmails(imapClient, {});
    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe("Newer");
    expect(result[1].subject).toBe("Older");
    expect(mockClient.search).toHaveBeenCalledWith({ all: true }, { uid: true });
  });

  it("passes after as since to IMAP search", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    const after = new Date("2026-02-20");
    await findEmails(imapClient, { after });
    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ since: after }),
      { uid: true }
    );
  });

  it("passes before to IMAP search", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    const before = new Date("2026-02-20");
    await findEmails(imapClient, { before });
    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ before }),
      { uid: true }
    );
  });

  it("passes from to IMAP search", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await findEmails(imapClient, { from: "@example.com" });
    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ from: "@example.com" }),
      { uid: true }
    );
  });

  it("passes subject to IMAP search", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await findEmails(imapClient, { subject: "invoice" });
    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "invoice" }),
      { uid: true }
    );
  });

  it("passes unseen for unreadOnly", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await findEmails(imapClient, { unreadOnly: true });
    expect(mockClient.search).toHaveBeenCalledWith(
      expect.objectContaining({ seen: false }),
      { uid: true }
    );
  });

  it("applies limit to results", async () => {
    const { imapClient } = createMockImapClient({
      search: [100, 200, 300],
      fetchMessages: [
        {
          uid: 300,
          envelope: {
            subject: "Third",
            from: [{ address: "c@test.com" }],
            date: new Date("2026-02-03"),
            messageId: "<msg-300@test.com>",
          },
        },
        {
          uid: 200,
          envelope: {
            subject: "Second",
            from: [{ address: "b@test.com" }],
            date: new Date("2026-02-02"),
            messageId: "<msg-200@test.com>",
          },
        },
      ],
    });

    const result = await findEmails(imapClient, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("uses INBOX as default folder", async () => {
    const { imapClient } = createMockImapClient({ search: [] });
    await findEmails(imapClient, {});
    expect(imapClient.openMailbox).toHaveBeenCalledWith("INBOX");
  });

  it("uses custom folder when provided", async () => {
    const { imapClient } = createMockImapClient({ search: [] });
    await findEmails(imapClient, { folder: "Sent" });
    expect(imapClient.openMailbox).toHaveBeenCalledWith("Sent");
  });

  it("combines multiple filters", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    const after = new Date("2026-02-01");
    await findEmails(imapClient, {
      after,
      from: "alice",
      unreadOnly: true,
    });
    expect(mockClient.search).toHaveBeenCalledWith(
      { since: after, from: "alice", seen: false },
      { uid: true }
    );
  });

  it("always releases the mailbox lock", async () => {
    const { imapClient, mockLock, mockClient } = createMockImapClient({ search: [] });
    mockClient.search.mockRejectedValueOnce(new Error("IMAP error"));
    await expect(findEmails(imapClient, {})).rejects.toThrow("IMAP error");
    expect(mockLock.release).toHaveBeenCalled();
  });
});
