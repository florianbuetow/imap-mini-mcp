import { describe, it, expect, vi, beforeEach } from "vitest";
import { tools, handleToolCall } from "./index.js";
import type { ImapClient } from "../imap/index.js";

// ---------------------------------------------------------------------------
// Mock the imap module so we don't need real IMAP connections
// ---------------------------------------------------------------------------

vi.mock("../imap/index.js", async () => {
  const actual = await vi.importActual<typeof import("../imap/index.js")>(
    "../imap/index.js"
  );
  return {
    ...actual,
    listEmails: vi.fn(),
    listEmailsFromDomain: vi.fn(),
    listEmailsFromSender: vi.fn(),
    fetchEmailContent: vi.fn(),
    fetchEmailAttachment: vi.fn(),
    listFolders: vi.fn(),
    createFolder: vi.fn(),
    moveEmail: vi.fn(),
    folderExists: vi.fn(),
    bulkMoveBySender: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    starEmail: vi.fn(),
    unstarEmail: vi.fn(),
    listStarredEmails: vi.fn(),
    findDraftsFolder: vi.fn(),
    resolveEmailId: vi.fn(),
    resolveInMailbox: vi.fn(),
  };
});

import {
  listEmails,
  listEmailsFromDomain,
  listEmailsFromSender,
  fetchEmailContent,
  fetchEmailAttachment,
  listFolders,
  createFolder,
  moveEmail,
  folderExists,
  bulkMoveBySender,
  createDraft,
  updateDraft,
  starEmail,
  unstarEmail,
  listStarredEmails,
  findDraftsFolder,
  resolveEmailId,
  resolveInMailbox,
} from "../imap/index.js";

const mockListEmails = vi.mocked(listEmails);
const mockListEmailsFromDomain = vi.mocked(listEmailsFromDomain);
const mockListEmailsFromSender = vi.mocked(listEmailsFromSender);
const mockFetchContent = vi.mocked(fetchEmailContent);
const mockFetchAttachment = vi.mocked(fetchEmailAttachment);
const mockListFolders = vi.mocked(listFolders);
const mockCreateFolder = vi.mocked(createFolder);
const mockMoveEmail = vi.mocked(moveEmail);
const mockFolderExists = vi.mocked(folderExists);
const mockBulkMoveBySender = vi.mocked(bulkMoveBySender);
const mockCreateDraft = vi.mocked(createDraft);
const mockUpdateDraft = vi.mocked(updateDraft);
const mockStarEmail = vi.mocked(starEmail);
const mockUnstarEmail = vi.mocked(unstarEmail);
const mockListStarredEmails = vi.mocked(listStarredEmails);
const mockFindDraftsFolder = vi.mocked(findDraftsFolder);
const mockResolveEmailId = vi.mocked(resolveEmailId);
const mockResolveInMailbox = vi.mocked(resolveInMailbox);
const mockImapClient = {} as ImapClient;

const TEST_ID = "2026-02-01T10:00:00.<msg@example.com>";

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe("tool definitions", () => {
  it("exposes exactly 24 tools", () => {
    expect(tools).toHaveLength(24);
  });

  it("has the expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "list_emails_24h",
      "list_emails_7days",
      "list_emails_month",
      "list_emails_quarter",
      "list_emails_year",
      "list_emails_all",
      "list_inbox_messages",
      "list_emails_from_domain",
      "list_emails_from_sender",
      "fetch_email_content",
      "fetch_email_attachment",
      "list_folders",
      "create_folder",
      "move_email",
      "create_draft",
      "draft_reply",
      "star_email",
      "unstar_email",
      "mark_read",
      "mark_unread",
      "list_starred_emails",
      "update_draft",
      "bulk_move_by_sender_email",
      "bulk_move_by_sender_domain",
    ]);
  });

  it("all list tools have optional mailbox parameter", () => {
    const listTools = tools.filter((t) => t.name.startsWith("list_emails_"));
    for (const tool of listTools) {
      expect(tool.inputSchema.properties).toHaveProperty("mailbox");
    }
  });

  it("time-range list tools have no required fields", () => {
    const timeTools = tools.filter(
      (t) =>
        t.name.startsWith("list_emails_") &&
        !t.name.includes("from_domain") &&
        !t.name.includes("from_sender")
    );
    for (const tool of timeTools) {
      expect((tool.inputSchema as any).required).toBeUndefined();
    }
  });

  it("list_emails_from_domain requires domain", () => {
    const tool = tools.find((t) => t.name === "list_emails_from_domain")!;
    expect(tool.inputSchema.required).toContain("domain");
  });

  it("list_emails_from_sender requires sender", () => {
    const tool = tools.find((t) => t.name === "list_emails_from_sender")!;
    expect(tool.inputSchema.required).toContain("sender");
  });

  it("fetch_email_content requires id", () => {
    const tool = tools.find((t) => t.name === "fetch_email_content")!;
    expect(tool.inputSchema.required).toContain("id");
  });

  it("fetch_email_attachment requires id and attachment_id", () => {
    const tool = tools.find((t) => t.name === "fetch_email_attachment")!;
    expect(tool.inputSchema.required).toContain("id");
    expect(tool.inputSchema.required).toContain("attachment_id");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — list tools
// ---------------------------------------------------------------------------

describe("handleToolCall — list tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_emails_7days calls listEmails with ~7 days ago", async () => {
    mockListEmails.mockResolvedValue([]);
    const result = await handleToolCall(mockImapClient, "list_emails_7days", {});

    expect(mockListEmails).toHaveBeenCalledOnce();
    const [client, since, mailbox] = mockListEmails.mock.calls[0];
    expect(since).toBeInstanceOf(Date);
    // Should be roughly 7 days ago
    const diffDays =
      (Date.now() - since!.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(7);
    expect(diffDays).toBeLessThanOrEqual(8);
    expect(mailbox).toBe("INBOX");
  });

  it("list_emails_month calls listEmails with ~30 days ago", async () => {
    mockListEmails.mockResolvedValue([]);
    await handleToolCall(mockImapClient, "list_emails_month", {});

    const [, since] = mockListEmails.mock.calls[0];
    const diffDays =
      (Date.now() - since!.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThanOrEqual(30);
    expect(diffDays).toBeLessThanOrEqual(31);
  });

  it("list_emails_all calls listEmails with undefined since", async () => {
    mockListEmails.mockResolvedValue([]);
    await handleToolCall(mockImapClient, "list_emails_all", {});

    const [, since] = mockListEmails.mock.calls[0];
    expect(since).toBeUndefined();
  });

  it("passes custom mailbox parameter", async () => {
    mockListEmails.mockResolvedValue([]);
    await handleToolCall(mockImapClient, "list_emails_7days", {
      mailbox: "Sent",
    });

    const [, , mailbox] = mockListEmails.mock.calls[0];
    expect(mailbox).toBe("Sent");
  });

  it("returns count and emails in JSON response", async () => {
    mockListEmails.mockResolvedValue([
      {
        id: TEST_ID,
        subject: "Test",
        from: "a@b.com",
        date: "2026-02-10T00:00:00.000Z",
      },
    ]);

    const result = await handleToolCall(
      mockImapClient,
      "list_emails_7days",
      {}
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.emails[0].id).toBe(TEST_ID);
    expect(parsed.emails[0].subject).toBe("Test");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — list_emails_from_domain
// ---------------------------------------------------------------------------

describe("handleToolCall — list_emails_from_domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when domain is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "list_emails_from_domain",
      {}
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("domain is required");
  });

  it("calls listEmailsFromDomain with correct arguments", async () => {
    mockListEmailsFromDomain.mockResolvedValue([
      {
        id: TEST_ID,
        subject: "Hello",
        from: "alice@you.com",
        date: "2026-02-10T00:00:00.000Z",
      },
    ]);

    const result = await handleToolCall(
      mockImapClient,
      "list_emails_from_domain",
      { domain: "you.com" }
    );

    expect(mockListEmailsFromDomain).toHaveBeenCalledWith(
      mockImapClient,
      "you.com",
      "INBOX"
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.emails[0].from).toBe("alice@you.com");
  });

  it("passes custom mailbox parameter", async () => {
    mockListEmailsFromDomain.mockResolvedValue([]);
    await handleToolCall(mockImapClient, "list_emails_from_domain", {
      domain: "example.com",
      mailbox: "Sent",
    });

    expect(mockListEmailsFromDomain).toHaveBeenCalledWith(
      mockImapClient,
      "example.com",
      "Sent"
    );
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — list_emails_from_sender
// ---------------------------------------------------------------------------

describe("handleToolCall — list_emails_from_sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when sender is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "list_emails_from_sender",
      {}
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("sender is required");
  });

  it("calls listEmailsFromSender with correct arguments", async () => {
    mockListEmailsFromSender.mockResolvedValue([
      {
        id: TEST_ID,
        subject: "Hello",
        from: "alice@example.com",
        date: "2026-02-10T00:00:00.000Z",
      },
    ]);

    const result = await handleToolCall(
      mockImapClient,
      "list_emails_from_sender",
      { sender: "alice@example.com" }
    );

    expect(mockListEmailsFromSender).toHaveBeenCalledWith(
      mockImapClient,
      "alice@example.com",
      "INBOX"
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.emails[0].from).toBe("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — fetch_email_content
// ---------------------------------------------------------------------------

describe("handleToolCall — fetch_email_content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when id is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_content",
      {}
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("id is required");
  });

  it("returns error when email not found", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 999, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue(null);
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_content",
      { id: TEST_ID }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No email found");
  });

  it("resolves composite ID and returns email content as JSON", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 42, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue({
      id: TEST_ID,
      subject: "Hello",
      from: "sender@test.com",
      to: "me@test.com",
      date: "2026-02-10T12:00:00.000Z",
      body: "Hello world",
      attachments: [],
    });

    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_content",
      { id: TEST_ID }
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(TEST_ID);
    expect(parsed.body).toBe("Hello world");
    expect(parsed.attachments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — fetch_email_attachment
// ---------------------------------------------------------------------------

describe("handleToolCall — fetch_email_attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when id or attachment_id is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_attachment",
      { id: TEST_ID }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("returns error when attachment not found", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 1, mailbox: "INBOX" });
    mockFetchAttachment.mockResolvedValue(null);
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_attachment",
      { id: TEST_ID, attachment_id: "nope" }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No attachment");
  });

  it("returns attachment data as JSON", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 10, mailbox: "INBOX" });
    mockFetchAttachment.mockResolvedValue({
      id: "att-0",
      filename: "data.csv",
      contentType: "text/csv",
      contentBase64: "bmFtZSx2YWx1ZQ==",
      size: 42,
    });

    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_attachment",
      { id: TEST_ID, attachment_id: "att-0" }
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.filename).toBe("data.csv");
    expect(parsed.contentBase64).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — list_folders
// ---------------------------------------------------------------------------

describe("handleToolCall — list_folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns folder list as JSON", async () => {
    mockListFolders.mockResolvedValue([
      { path: "INBOX", name: "INBOX", delimiter: "/" },
      { path: "INBOX/Receipts", name: "Receipts", delimiter: "/" },
      { path: "Sent", name: "Sent", delimiter: "/" },
    ]);

    const result = await handleToolCall(mockImapClient, "list_folders", {});
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(3);
    expect(parsed.folders[0].path).toBe("INBOX");
    expect(parsed.folders[1].name).toBe("Receipts");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — create_folder
// ---------------------------------------------------------------------------

describe("handleToolCall — create_folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when path is missing", async () => {
    const result = await handleToolCall(mockImapClient, "create_folder", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("path is required");
  });

  it("creates folder and returns path", async () => {
    mockCreateFolder.mockResolvedValue("INBOX/Receipts");

    const result = await handleToolCall(mockImapClient, "create_folder", {
      path: "INBOX/Receipts",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.created).toBe("INBOX/Receipts");
    expect(mockCreateFolder).toHaveBeenCalledWith(
      mockImapClient,
      "INBOX/Receipts"
    );
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — move_email
// ---------------------------------------------------------------------------

describe("handleToolCall — move_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when id or destination_folder is missing", async () => {
    const result = await handleToolCall(mockImapClient, "move_email", {
      id: TEST_ID,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("resolves ID, moves email, and returns id + destination", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 42, mailbox: "INBOX" });
    mockMoveEmail.mockResolvedValue({ uid: 55, destination: "INBOX/Receipts" });

    const result = await handleToolCall(mockImapClient, "move_email", {
      id: TEST_ID,
      destination_folder: "INBOX/Receipts",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(TEST_ID);
    expect(parsed.destination).toBe("INBOX/Receipts");
    expect(mockMoveEmail).toHaveBeenCalledWith(
      mockImapClient,
      42,
      "INBOX",
      "INBOX/Receipts"
    );
  });

  it("uses source_folder as hint", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 7, mailbox: "Sent" });
    mockMoveEmail.mockResolvedValue({ uid: 10, destination: "Archive" });

    await handleToolCall(mockImapClient, "move_email", {
      id: TEST_ID,
      source_folder: "Sent",
      destination_folder: "Archive",
    });
    expect(mockResolveEmailId).toHaveBeenCalledWith(
      mockImapClient,
      TEST_ID,
      "Sent"
    );
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — create_draft
// ---------------------------------------------------------------------------

describe("handleToolCall — create_draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("IMAP_USER", "me@test.com");
  });

  it("returns error when required fields are missing", async () => {
    const result = await handleToolCall(mockImapClient, "create_draft", {
      to: "recipient@test.com",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("calls createDraft with correct arguments", async () => {
    mockCreateDraft.mockResolvedValue({
      id: TEST_ID,
      subject: "Test",
      to: "recipient@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    const result = await handleToolCall(mockImapClient, "create_draft", {
      to: "recipient@test.com",
      subject: "Test",
      body: "Hello",
      cc: "cc@test.com",
    });

    expect(mockCreateDraft).toHaveBeenCalledWith(mockImapClient, "me@test.com", {
      to: "recipient@test.com",
      subject: "Test",
      body: "Hello",
      cc: "cc@test.com",
      bcc: undefined,
      inReplyTo: undefined,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(TEST_ID);
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — draft_reply
// ---------------------------------------------------------------------------

describe("handleToolCall — draft_reply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("IMAP_USER", "me@test.com");
  });

  it("returns error when id or body is missing", async () => {
    const result = await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("returns error when original email not found", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 999, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue(null);
    const result = await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
      body: "Reply text",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("derives to and subject from original email", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 100, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue({
      id: TEST_ID,
      subject: "Original Subject",
      from: "sender@test.com",
      to: "me@test.com",
      date: "2026-02-10T00:00:00.000Z",
      body: "Original body",
      attachments: [],
    });
    mockCreateDraft.mockResolvedValue({
      id: "2026-02-11T00:00:00.<reply@test.com>",
      subject: "Re: Original Subject",
      to: "sender@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
      body: "My reply",
    });

    expect(mockCreateDraft).toHaveBeenCalledWith(
      mockImapClient,
      "me@test.com",
      expect.objectContaining({
        to: "sender@test.com",
        subject: "Re: Original Subject",
        body: "My reply",
        inReplyTo: TEST_ID,
      })
    );
  });

  it("does not double-prefix Re: on subject", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 100, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue({
      id: TEST_ID,
      subject: "Re: Already Replied",
      from: "sender@test.com",
      to: "me@test.com",
      date: "2026-02-10T00:00:00.000Z",
      body: "Body",
      attachments: [],
    });
    mockCreateDraft.mockResolvedValue({
      id: "2026-02-11T00:00:00.<reply@test.com>",
      subject: "Re: Already Replied",
      to: "sender@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
      body: "Reply",
    });

    expect(mockCreateDraft).toHaveBeenCalledWith(
      mockImapClient,
      "me@test.com",
      expect.objectContaining({
        subject: "Re: Already Replied",
      })
    );
  });

  it("includes original recipients as CC when reply_all is true", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 100, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue({
      id: TEST_ID,
      subject: "Group Thread",
      from: "sender@test.com",
      to: "me@test.com, other@test.com",
      date: "2026-02-10T00:00:00.000Z",
      body: "Body",
      attachments: [],
    });
    mockCreateDraft.mockResolvedValue({
      id: "2026-02-11T00:00:00.<reply@test.com>",
      subject: "Re: Group Thread",
      to: "sender@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
      body: "Reply to all",
      reply_all: true,
    });

    expect(mockCreateDraft).toHaveBeenCalledWith(
      mockImapClient,
      "me@test.com",
      expect.objectContaining({
        cc: "other@test.com",
      })
    );
  });

  it("excludes current user from CC in reply_all", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 100, mailbox: "INBOX" });
    mockFetchContent.mockResolvedValue({
      id: TEST_ID,
      subject: "Thread",
      from: "sender@test.com",
      to: "me@test.com",
      date: "2026-02-10T00:00:00.000Z",
      body: "Body",
      attachments: [],
    });
    mockCreateDraft.mockResolvedValue({
      id: "2026-02-11T00:00:00.<reply@test.com>",
      subject: "Re: Thread",
      to: "sender@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    await handleToolCall(mockImapClient, "draft_reply", {
      id: TEST_ID,
      body: "Reply",
      reply_all: true,
    });

    // CC should be undefined since the only recipient was the current user
    expect(mockCreateDraft).toHaveBeenCalledWith(
      mockImapClient,
      "me@test.com",
      expect.objectContaining({
        cc: undefined,
      })
    );
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — update_draft
// ---------------------------------------------------------------------------

describe("handleToolCall — update_draft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("IMAP_USER", "me@test.com");
  });

  it("returns error when required fields are missing", async () => {
    const result = await handleToolCall(mockImapClient, "update_draft", {
      id: TEST_ID,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("resolves ID in Drafts folder and calls updateDraft", async () => {
    mockFindDraftsFolder.mockResolvedValue("Drafts");
    mockResolveInMailbox.mockResolvedValue(400);
    mockUpdateDraft.mockResolvedValue({
      id: "2026-02-11T00:00:00.<new-draft@test.com>",
      subject: "Updated",
      to: "recipient@test.com",
      date: "2026-02-11T00:00:00.000Z",
    });

    const result = await handleToolCall(mockImapClient, "update_draft", {
      id: TEST_ID,
      to: "recipient@test.com",
      subject: "Updated",
      body: "New content",
    });

    expect(mockFindDraftsFolder).toHaveBeenCalledWith(mockImapClient);
    expect(mockResolveInMailbox).toHaveBeenCalledWith(
      mockImapClient,
      "<msg@example.com>",
      "Drafts"
    );
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      mockImapClient,
      "me@test.com",
      400,
      {
        to: "recipient@test.com",
        subject: "Updated",
        body: "New content",
        cc: undefined,
        bcc: undefined,
        inReplyTo: undefined,
      }
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("2026-02-11T00:00:00.<new-draft@test.com>");
  });

  it("returns error when draft not found in Drafts folder", async () => {
    mockFindDraftsFolder.mockResolvedValue("Drafts");
    mockResolveInMailbox.mockResolvedValue(null);

    const result = await handleToolCall(mockImapClient, "update_draft", {
      id: TEST_ID,
      to: "recipient@test.com",
      subject: "Updated",
      body: "New content",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Draft not found");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — star_email / unstar_email
// ---------------------------------------------------------------------------

describe("handleToolCall — star_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when id is missing", async () => {
    const result = await handleToolCall(mockImapClient, "star_email", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("id is required");
  });

  it("resolves ID and stars the email", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 42, mailbox: "INBOX" });
    mockStarEmail.mockResolvedValue({ uid: 42, starred: true });

    const result = await handleToolCall(mockImapClient, "star_email", {
      id: TEST_ID,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(TEST_ID);
    expect(parsed.starred).toBe(true);
  });
});

describe("handleToolCall — unstar_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves ID and unstars the email", async () => {
    mockResolveEmailId.mockResolvedValue({ uid: 42, mailbox: "INBOX" });
    mockUnstarEmail.mockResolvedValue({ uid: 42, starred: false });

    const result = await handleToolCall(mockImapClient, "unstar_email", {
      id: TEST_ID,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(TEST_ID);
    expect(parsed.starred).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool metadata — draft tools
// ---------------------------------------------------------------------------

describe("tool definitions — draft tools", () => {
  it("create_draft requires to, subject, and body", () => {
    const tool = tools.find((t) => t.name === "create_draft")!;
    expect(tool.inputSchema.required).toContain("to");
    expect(tool.inputSchema.required).toContain("subject");
    expect(tool.inputSchema.required).toContain("body");
  });

  it("draft_reply requires id and body", () => {
    const tool = tools.find((t) => t.name === "draft_reply")!;
    expect(tool.inputSchema.required).toContain("id");
    expect(tool.inputSchema.required).toContain("body");
  });

  it("update_draft requires id, to, subject, and body", () => {
    const tool = tools.find((t) => t.name === "update_draft")!;
    expect(tool.inputSchema.required).toContain("id");
    expect(tool.inputSchema.required).toContain("to");
    expect(tool.inputSchema.required).toContain("subject");
    expect(tool.inputSchema.required).toContain("body");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — bulk_move_by_sender_email
// ---------------------------------------------------------------------------

describe("handleToolCall — bulk_move_by_sender_email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires sender, source_folder, and destination_folder", () => {
    const tool = tools.find((t) => t.name === "bulk_move_by_sender_email")!;
    expect(tool.inputSchema.required).toContain("sender");
    expect(tool.inputSchema.required).toContain("source_folder");
    expect(tool.inputSchema.required).toContain("destination_folder");
  });

  it("returns error when required params are missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_email",
      { sender: "alice@example.com" }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("returns error when source folder not found", async () => {
    mockFolderExists.mockResolvedValueOnce(false);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_email",
      {
        sender: "alice@example.com",
        source_folder: "NonExistent",
        destination_folder: "Archive",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Source folder not found");
  });

  it("returns error when destination folder not found", async () => {
    mockFolderExists.mockResolvedValueOnce(true);
    mockFolderExists.mockResolvedValueOnce(false);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_email",
      {
        sender: "alice@example.com",
        source_folder: "INBOX",
        destination_folder: "NonExistent",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Destination folder not found");
  });

  it("returns error when no emails match", async () => {
    mockFolderExists.mockResolvedValue(true);
    mockBulkMoveBySender.mockResolvedValue(0);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_email",
      {
        sender: "nobody@example.com",
        source_folder: "INBOX",
        destination_folder: "Archive",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No emails from");
  });

  it("calls bulkMoveBySender and returns moved count", async () => {
    mockFolderExists.mockResolvedValue(true);
    mockBulkMoveBySender.mockResolvedValue(5);

    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_email",
      {
        sender: "alice@example.com",
        source_folder: "INBOX",
        destination_folder: "Archive",
      }
    );

    expect(mockBulkMoveBySender).toHaveBeenCalledWith(
      mockImapClient,
      "INBOX",
      "Archive",
      "alice@example.com"
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.moved).toBe(5);
    expect(parsed.source_folder).toBe("INBOX");
    expect(parsed.destination_folder).toBe("Archive");
    expect(parsed.sender).toBe("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — bulk_move_by_sender_domain
// ---------------------------------------------------------------------------

describe("handleToolCall — bulk_move_by_sender_domain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires domain, source_folder, and destination_folder", () => {
    const tool = tools.find((t) => t.name === "bulk_move_by_sender_domain")!;
    expect(tool.inputSchema.required).toContain("domain");
    expect(tool.inputSchema.required).toContain("source_folder");
    expect(tool.inputSchema.required).toContain("destination_folder");
  });

  it("returns error when required params are missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_domain",
      { domain: "example.com" }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("returns error when source folder not found", async () => {
    mockFolderExists.mockResolvedValueOnce(false);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_domain",
      {
        domain: "example.com",
        source_folder: "NonExistent",
        destination_folder: "Archive",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Source folder not found");
  });

  it("returns error when destination folder not found", async () => {
    mockFolderExists.mockResolvedValueOnce(true);
    mockFolderExists.mockResolvedValueOnce(false);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_domain",
      {
        domain: "example.com",
        source_folder: "INBOX",
        destination_folder: "NonExistent",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Destination folder not found");
  });

  it("returns error when no emails match", async () => {
    mockFolderExists.mockResolvedValue(true);
    mockBulkMoveBySender.mockResolvedValue(0);
    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_domain",
      {
        domain: "nobody.com",
        source_folder: "INBOX",
        destination_folder: "Archive",
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No emails from");
  });

  it("calls bulkMoveBySender with @domain prefix and returns moved count", async () => {
    mockFolderExists.mockResolvedValue(true);
    mockBulkMoveBySender.mockResolvedValue(12);

    const result = await handleToolCall(
      mockImapClient,
      "bulk_move_by_sender_domain",
      {
        domain: "example.com",
        source_folder: "INBOX",
        destination_folder: "Promotions",
      }
    );

    expect(mockBulkMoveBySender).toHaveBeenCalledWith(
      mockImapClient,
      "INBOX",
      "Promotions",
      "@example.com"
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.moved).toBe(12);
    expect(parsed.source_folder).toBe("INBOX");
    expect(parsed.destination_folder).toBe("Promotions");
    expect(parsed.domain).toBe("example.com");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — unknown tool
// ---------------------------------------------------------------------------

describe("handleToolCall — unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "nonexistent_tool",
      {}
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });
});
