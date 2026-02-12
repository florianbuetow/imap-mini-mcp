import { describe, it, expect, vi, beforeEach } from "vitest";
import { daysAgo, extractEmailAddress, listEmails, fetchEmailContent, fetchEmailAttachment } from "./search.js";
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
          },
        },
        {
          uid: 200,
          envelope: {
            subject: "Middle email",
            from: [{ address: "mid@test.com" }],
            date: new Date("2026-01-15"),
          },
        },
        {
          uid: 300,
          envelope: {
            subject: "New email",
            from: [{ address: "new@test.com" }],
            date: new Date("2026-02-01"),
          },
        },
      ],
    });

    const result = await listEmails(imapClient);

    expect(result).toHaveLength(3);
    // Newest first
    expect(result[0].uid).toBe(300);
    expect(result[0].subject).toBe("New email");
    expect(result[0].from).toBe("new@test.com");
    expect(result[1].uid).toBe(200);
    expect(result[2].uid).toBe(100);
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
        },
        source: null,
      },
    });

    const result = await fetchEmailContent(imapClient, 42);
    expect(result).not.toBeNull();
    expect(result!.uid).toBe(42);
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
        },
        source: rawEmail,
      },
    });

    const result = await fetchEmailContent(imapClient, 101);
    expect(result).not.toBeNull();
    expect(result!.uid).toBe(101);
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
