import { describe, it, expect, vi, beforeEach } from "vitest";
import { daysAgo, extractEmailAddress, listEmails, listInboxMessages, listEmailsFromDomain, listEmailsFromSender, fetchEmailContent, fetchEmailAttachment } from "./search.js";
import type { ImapClient } from "./client.js";

// ---------------------------------------------------------------------------
// daysAgo
// ---------------------------------------------------------------------------

describe("daysAgo", () => {
  it("returns a date N days in the past at midnight UTC", () => {
    const now = new Date();
    const result = daysAgo(7);

    // daysAgo snaps to midnight UTC, so the diff from "now" is between N and N+1 days
    const diffMs = now.getTime() - result.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(7);
    expect(diffDays).toBeLessThanOrEqual(8);

    // Should be at midnight UTC
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("returns today at midnight for daysAgo(0)", () => {
    const result = daysAgo(0);
    const today = new Date();
    expect(result.getUTCFullYear()).toBe(today.getUTCFullYear());
    expect(result.getUTCMonth()).toBe(today.getUTCMonth());
    expect(result.getUTCDate()).toBe(today.getUTCDate());
  });

  it("handles large values like 365", () => {
    const result = daysAgo(365);
    const now = new Date();
    const diffMs = now.getTime() - result.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(365);
    expect(diffDays).toBeLessThanOrEqual(366);
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
// listEmails
// ---------------------------------------------------------------------------

describe("listEmails", () => {
  it("returns empty array when search finds no UIDs", async () => {
    const { imapClient } = createMockImapClient({ search: [] });
    const result = await listEmails(imapClient, new Date());
    expect(result).toEqual([]);
  });

  it("returns email entries sorted by date descending", async () => {
    const { imapClient } = createMockImapClient({
      search: [100, 200, 300],
      fetchMessages: [
        {
          uid: 100,
          envelope: {
            subject: "Old email",
            from: [{ address: "old@test.com" }],
            date: new Date("2026-01-01"),
            messageId: "<msg-100@example.com>",
          },
        },
        {
          uid: 200,
          envelope: {
            subject: "Middle email",
            from: [{ address: "mid@test.com" }],
            date: new Date("2026-01-15"),
            messageId: "<msg-200@example.com>",
          },
        },
        {
          uid: 300,
          envelope: {
            subject: "New email",
            from: [{ address: "new@test.com" }],
            date: new Date("2026-02-01"),
            messageId: "<msg-300@example.com>",
          },
        },
      ],
    });

    const result = await listEmails(imapClient);

    expect(result).toHaveLength(3);
    // Newest first
    expect(result[0].id).toBe("2026-02-01T00:00:00.<msg-300@example.com>");
    expect(result[0].subject).toBe("New email");
    expect(result[0].from).toBe("new@test.com");
    expect(result[1].id).toBe("2026-01-15T00:00:00.<msg-200@example.com>");
    expect(result[2].id).toBe("2026-01-01T00:00:00.<msg-100@example.com>");
  });

  it("passes since date to IMAP search query", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    const since = new Date("2026-02-01");
    await listEmails(imapClient, since);

    expect(mockClient.search).toHaveBeenCalledWith(
      { since },
      { uid: true }
    );
  });

  it("passes {all: true} when no since date provided", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await listEmails(imapClient, undefined);

    expect(mockClient.search).toHaveBeenCalledWith(
      { all: true },
      { uid: true }
    );
  });

  it("always releases the mailbox lock", async () => {
    const { imapClient, mockLock, mockClient } = createMockImapClient({
      search: [],
    });

    // Simulate search throwing an error
    mockClient.search.mockRejectedValueOnce(new Error("IMAP error"));

    await expect(listEmails(imapClient)).rejects.toThrow("IMAP error");
    expect(mockLock.release).toHaveBeenCalled();
  });

  it("handles missing envelope fields gracefully", async () => {
    const { imapClient } = createMockImapClient({
      search: [1],
      fetchMessages: [
        {
          uid: 1,
          envelope: {
            subject: null,
            from: null,
            date: null,
            messageId: null,
          },
        },
      ],
    });

    const result = await listEmails(imapClient);
    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe("(no subject)");
    expect(result[0].from).toBe("");
    expect(result[0].date).toBe("");
  });
});

// ---------------------------------------------------------------------------
// listInboxMessages
// ---------------------------------------------------------------------------

describe("listInboxMessages", () => {
  it("returns empty array when no messages exist", async () => {
    const { imapClient } = createMockImapClient({ search: [] });
    const result = await listInboxMessages(imapClient, 5);
    expect(result).toEqual([]);
  });

  it("returns only the last N messages", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      search: [100, 200, 300, 400, 500],
      fetchMessages: [
        {
          uid: 500,
          envelope: {
            subject: "Fifth",
            from: [{ address: "e@test.com" }],
            date: new Date("2026-02-05"),
            messageId: "<msg-500@test.com>",
          },
        },
        {
          uid: 400,
          envelope: {
            subject: "Fourth",
            from: [{ address: "d@test.com" }],
            date: new Date("2026-02-04"),
            messageId: "<msg-400@test.com>",
          },
        },
      ],
    });

    const result = await listInboxMessages(imapClient, 2);

    // Should have fetched only 2 UIDs (500, 400)
    expect(mockClient.fetch).toHaveBeenCalledWith(
      "500,400",
      { uid: true, envelope: true },
      { uid: true }
    );
    expect(result).toHaveLength(2);
    expect(result[0].subject).toBe("Fifth");
    expect(result[1].subject).toBe("Fourth");
  });

  it("returns all messages when count exceeds total", async () => {
    const { imapClient } = createMockImapClient({
      search: [10, 20],
      fetchMessages: [
        {
          uid: 20,
          envelope: {
            subject: "Second",
            from: [{ address: "b@test.com" }],
            date: new Date("2026-02-02"),
            messageId: "<msg-20@test.com>",
          },
        },
        {
          uid: 10,
          envelope: {
            subject: "First",
            from: [{ address: "a@test.com" }],
            date: new Date("2026-02-01"),
            messageId: "<msg-10@test.com>",
          },
        },
      ],
    });

    const result = await listInboxMessages(imapClient, 100);
    expect(result).toHaveLength(2);
  });

  it("always releases the mailbox lock", async () => {
    const { imapClient, mockLock, mockClient } = createMockImapClient({
      search: [],
    });
    mockClient.search.mockRejectedValueOnce(new Error("IMAP error"));

    await expect(listInboxMessages(imapClient, 5)).rejects.toThrow("IMAP error");
    expect(mockLock.release).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listEmailsFromDomain
// ---------------------------------------------------------------------------

describe("listEmailsFromDomain", () => {
  it("searches with @domain in the from field", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await listEmailsFromDomain(imapClient, "you.com");

    expect(mockClient.search).toHaveBeenCalledWith(
      { from: "@you.com" },
      { uid: true }
    );
  });

  it("returns matching emails sorted by date descending", async () => {
    const { imapClient } = createMockImapClient({
      search: [10, 20],
      fetchMessages: [
        {
          uid: 10,
          envelope: {
            subject: "Old",
            from: [{ address: "alice@you.com" }],
            date: new Date("2026-01-01"),
            messageId: "<msg-10@you.com>",
          },
        },
        {
          uid: 20,
          envelope: {
            subject: "New",
            from: [{ address: "bob@you.com" }],
            date: new Date("2026-02-01"),
            messageId: "<msg-20@you.com>",
          },
        },
      ],
    });

    const result = await listEmailsFromDomain(imapClient, "you.com");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("2026-02-01T00:00:00.<msg-20@you.com>");
    expect(result[1].id).toBe("2026-01-01T00:00:00.<msg-10@you.com>");
  });

  it("returns empty array when no matches", async () => {
    const { imapClient } = createMockImapClient({ search: [] });
    const result = await listEmailsFromDomain(imapClient, "nobody.com");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listEmailsFromSender
// ---------------------------------------------------------------------------

describe("listEmailsFromSender", () => {
  it("searches with exact sender in the from field", async () => {
    const { imapClient, mockClient } = createMockImapClient({ search: [] });
    await listEmailsFromSender(imapClient, "alice@example.com");

    expect(mockClient.search).toHaveBeenCalledWith(
      { from: "alice@example.com" },
      { uid: true }
    );
  });

  it("returns matching emails", async () => {
    const { imapClient } = createMockImapClient({
      search: [5],
      fetchMessages: [
        {
          uid: 5,
          envelope: {
            subject: "Hello",
            from: [{ address: "alice@example.com" }],
            date: new Date("2026-02-10"),
            messageId: "<msg-5@example.com>",
          },
        },
      ],
    });

    const result = await listEmailsFromSender(imapClient, "alice@example.com");
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("alice@example.com");
  });
});

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
