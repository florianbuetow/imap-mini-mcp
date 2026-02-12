import { describe, it, expect, vi, beforeEach } from "vitest";
import { findDraftsFolder, createDraft, updateDraft } from "./drafts.js";
import type { ImapClient } from "./client.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockImapClient(overrides: {
  mailboxes?: any[];
  fetchOneResult?: any;
  appendResult?: any;
  deleteResult?: any;
}) {
  const mockLock = { release: vi.fn() };

  const mockClient = {
    list: vi.fn().mockResolvedValue(overrides.mailboxes || []),
    fetchOne: vi.fn().mockResolvedValue(overrides.fetchOneResult || null),
    append: vi.fn().mockResolvedValue(
      overrides.appendResult || { uid: 500, destination: "Drafts" }
    ),
    messageDelete: vi.fn().mockResolvedValue(overrides.deleteResult ?? true),
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
// findDraftsFolder
// ---------------------------------------------------------------------------

describe("findDraftsFolder", () => {
  it("finds folder with \\Drafts special-use attribute", async () => {
    const { imapClient } = createMockImapClient({
      mailboxes: [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "[Gmail]/Drafts", name: "Drafts", specialUse: "\\Drafts" },
        { path: "Sent", name: "Sent", specialUse: "\\Sent" },
      ],
    });

    const result = await findDraftsFolder(imapClient);
    expect(result).toBe("[Gmail]/Drafts");
  });

  it("falls back to folder named 'Drafts' when no special-use attribute", async () => {
    const { imapClient } = createMockImapClient({
      mailboxes: [
        { path: "INBOX", name: "INBOX" },
        { path: "Drafts", name: "Drafts" },
        { path: "Sent", name: "Sent" },
      ],
    });

    const result = await findDraftsFolder(imapClient);
    expect(result).toBe("Drafts");
  });

  it("falls back case-insensitively to 'drafts'", async () => {
    const { imapClient } = createMockImapClient({
      mailboxes: [
        { path: "INBOX", name: "INBOX" },
        { path: "INBOX.drafts", name: "drafts" },
      ],
    });

    const result = await findDraftsFolder(imapClient);
    expect(result).toBe("INBOX.drafts");
  });

  it("throws when no Drafts folder exists", async () => {
    const { imapClient } = createMockImapClient({
      mailboxes: [
        { path: "INBOX", name: "INBOX" },
        { path: "Sent", name: "Sent" },
      ],
    });

    await expect(findDraftsFolder(imapClient)).rejects.toThrow(
      "Could not find Drafts folder"
    );
  });
});

// ---------------------------------------------------------------------------
// createDraft
// ---------------------------------------------------------------------------

describe("createDraft", () => {
  it("appends message to Drafts folder with \\Draft flag", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      appendResult: { uid: 500, destination: "Drafts" },
    });

    const result = await createDraft(imapClient, "me@test.com", {
      to: "recipient@test.com",
      subject: "Test Draft",
      body: "Hello world",
    });

    expect(mockClient.append).toHaveBeenCalledOnce();
    const [path, content, flags] = mockClient.append.mock.calls[0];
    expect(path).toBe("Drafts");
    expect(flags).toContain("\\Draft");
    expect(flags).toContain("\\Seen");
    expect(content).toBeInstanceOf(Buffer);

    // Verify the raw message contains expected content
    const raw = content.toString("utf-8");
    expect(raw).toContain("recipient@test.com");
    expect(raw).toContain("Hello world");
    // Subject is RFC 2047 encoded by mimetext, so check the result object instead
    expect(raw).toContain("Subject:");

    expect(result.uid).toBe(500);
    expect(result.subject).toBe("Test Draft");
    expect(result.to).toBe("recipient@test.com");
  });

  it("sets In-Reply-To and References when inReplyTo is provided", async () => {
    const messageId = "<original-123@example.com>";
    const headersBuffer = Buffer.from(
      `Message-ID: ${messageId}\r\nSubject: Original\r\n`
    );

    const { imapClient, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      fetchOneResult: { uid: 100, headers: headersBuffer },
      appendResult: { uid: 501, destination: "Drafts" },
    });

    await createDraft(imapClient, "me@test.com", {
      to: "recipient@test.com",
      subject: "Re: Original",
      body: "My reply",
      inReplyTo: 100,
    });

    const raw = mockClient.append.mock.calls[0][1].toString("utf-8");
    expect(raw).toContain("In-Reply-To");
    expect(raw).toContain(messageId);
    expect(raw).toContain("References");
  });

  it("sets CC and BCC when provided", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      appendResult: { uid: 502, destination: "Drafts" },
    });

    await createDraft(imapClient, "me@test.com", {
      to: "recipient@test.com",
      subject: "Test",
      body: "Body",
      cc: "cc@test.com",
      bcc: "bcc@test.com",
    });

    const raw = mockClient.append.mock.calls[0][1].toString("utf-8");
    expect(raw).toContain("cc@test.com");
    // BCC should NOT appear in raw message headers (stripped by mimetext)
    // but we verify the call was made
    expect(mockClient.append).toHaveBeenCalledOnce();
  });

  it("returns uid 0 when server does not report UIDPLUS", async () => {
    const { imapClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      appendResult: { destination: "Drafts" },
    });

    const result = await createDraft(imapClient, "me@test.com", {
      to: "recipient@test.com",
      subject: "Test",
      body: "Body",
    });

    expect(result.uid).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// updateDraft
// ---------------------------------------------------------------------------

describe("updateDraft", () => {
  it("replaces draft and returns new UID", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      fetchOneResult: { uid: 400 },
      appendResult: { uid: 501, destination: "Drafts" },
    });

    const result = await updateDraft(imapClient, "me@test.com", 400, {
      to: "recipient@test.com",
      subject: "Updated Draft",
      body: "New content",
    });

    expect(result.uid).toBe(501);
    expect(result.subject).toBe("Updated Draft");
    expect(mockClient.messageDelete).toHaveBeenCalledWith("400", { uid: true });
  });

  it("rejects when UID is not in Drafts folder", async () => {
    const { imapClient, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      fetchOneResult: null,
    });

    await expect(
      updateDraft(imapClient, "me@test.com", 999, {
        to: "recipient@test.com",
        subject: "Test",
        body: "Body",
      })
    ).rejects.toThrow("You can only update drafts");

    // Should not attempt to append or delete
    expect(mockClient.append).not.toHaveBeenCalled();
    expect(mockClient.messageDelete).not.toHaveBeenCalled();
  });

  it("always releases mailbox locks", async () => {
    const { imapClient, mockLock, mockClient } = createMockImapClient({
      mailboxes: [{ path: "Drafts", name: "Drafts", specialUse: "\\Drafts" }],
      fetchOneResult: null,
    });

    await expect(
      updateDraft(imapClient, "me@test.com", 999, {
        to: "recipient@test.com",
        subject: "Test",
        body: "Body",
      })
    ).rejects.toThrow();

    expect(mockLock.release).toHaveBeenCalled();
  });
});
