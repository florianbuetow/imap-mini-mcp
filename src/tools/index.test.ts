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
    fetchEmailContent: vi.fn(),
    fetchEmailAttachment: vi.fn(),
    listFolders: vi.fn(),
    createFolder: vi.fn(),
    moveEmail: vi.fn(),
  };
});

import {
  listEmails,
  fetchEmailContent,
  fetchEmailAttachment,
  listFolders,
  createFolder,
  moveEmail,
} from "../imap/index.js";

const mockListEmails = vi.mocked(listEmails);
const mockFetchContent = vi.mocked(fetchEmailContent);
const mockFetchAttachment = vi.mocked(fetchEmailAttachment);
const mockListFolders = vi.mocked(listFolders);
const mockCreateFolder = vi.mocked(createFolder);
const mockMoveEmail = vi.mocked(moveEmail);
const mockImapClient = {} as ImapClient;

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

describe("tool definitions", () => {
  it("exposes exactly 10 tools", () => {
    expect(tools).toHaveLength(10);
  });

  it("has the expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "list_emails_7days",
      "list_emails_month",
      "list_emails_quarter",
      "list_emails_year",
      "list_emails_all",
      "fetch_email_content",
      "fetch_email_attachment",
      "list_folders",
      "create_folder",
      "move_email",
    ]);
  });

  it("all list tools have optional mailbox parameter", () => {
    const listTools = tools.filter((t) => t.name.startsWith("list_emails_"));
    for (const tool of listTools) {
      expect(tool.inputSchema.properties).toHaveProperty("mailbox");
      // No required fields
      expect((tool.inputSchema as any).required).toBeUndefined();
    }
  });

  it("fetch_email_content requires uid", () => {
    const tool = tools.find((t) => t.name === "fetch_email_content")!;
    expect(tool.inputSchema.required).toContain("uid");
  });

  it("fetch_email_attachment requires uid and attachment_id", () => {
    const tool = tools.find((t) => t.name === "fetch_email_attachment")!;
    expect(tool.inputSchema.required).toContain("uid");
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
        uid: 1,
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
    expect(parsed.emails[0].uid).toBe(1);
    expect(parsed.emails[0].subject).toBe("Test");
  });
});

// ---------------------------------------------------------------------------
// handleToolCall — fetch_email_content
// ---------------------------------------------------------------------------

describe("handleToolCall — fetch_email_content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when uid is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_content",
      {}
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("uid is required");
  });

  it("returns error when email not found", async () => {
    mockFetchContent.mockResolvedValue(null);
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_content",
      { uid: 999 }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No email found");
  });

  it("returns email content as JSON", async () => {
    mockFetchContent.mockResolvedValue({
      uid: 42,
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
      { uid: 42 }
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe(42);
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

  it("returns error when uid or attachment_id is missing", async () => {
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_attachment",
      { uid: 1 }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("returns error when attachment not found", async () => {
    mockFetchAttachment.mockResolvedValue(null);
    const result = await handleToolCall(
      mockImapClient,
      "fetch_email_attachment",
      { uid: 1, attachment_id: "nope" }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No attachment");
  });

  it("returns attachment data as JSON", async () => {
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
      { uid: 10, attachment_id: "att-0" }
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

  it("returns error when uid or destination_folder is missing", async () => {
    const result = await handleToolCall(mockImapClient, "move_email", {
      uid: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("required");
  });

  it("moves email and returns new UID", async () => {
    mockMoveEmail.mockResolvedValue({ uid: 55, destination: "INBOX/Receipts" });

    const result = await handleToolCall(mockImapClient, "move_email", {
      uid: 42,
      destination_folder: "INBOX/Receipts",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.uid).toBe(55);
    expect(parsed.destination).toBe("INBOX/Receipts");
    expect(mockMoveEmail).toHaveBeenCalledWith(
      mockImapClient,
      42,
      "INBOX",
      "INBOX/Receipts"
    );
  });

  it("uses custom source_folder", async () => {
    mockMoveEmail.mockResolvedValue({ uid: 10, destination: "Archive" });

    await handleToolCall(mockImapClient, "move_email", {
      uid: 7,
      source_folder: "Sent",
      destination_folder: "Archive",
    });
    expect(mockMoveEmail).toHaveBeenCalledWith(
      mockImapClient,
      7,
      "Sent",
      "Archive"
    );
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
