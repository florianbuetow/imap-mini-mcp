/**
 * MCP Tool definitions for the IMAP email server.
 *
 * Each tool co-locates its schema and handler in a single registration object.
 * Adding a new tool means adding a new entry to the registry — no dispatch
 * logic needs to change (OCP). Schema and handler live together (SRP).
 */

import type { ImapClient } from "../imap/index.js";
import {
  listEmails,
  listEmailsFromDomain,
  listEmailsFromSender,
  listInboxMessages,
  fetchEmailContent,
  fetchEmailAttachment,
  daysAgo,
  listFolders,
  createFolder,
  moveEmail,
  createDraft,
  updateDraft,
  starEmail,
  unstarEmail,
  markRead,
  markUnread,
  listAllStarredEmails,
  findDraftsFolder,
  resolveEmailId,
  resolveInMailbox,
  parseCompositeId,
} from "../imap/index.js";

// ---------------------------------------------------------------------------
// Tool registry types and helpers
// ---------------------------------------------------------------------------

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: true;
  [key: string]: unknown;
}

interface ToolRegistration {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: readonly string[];
  };
  handler: (
    imapClient: ImapClient,
    args: Record<string, unknown>
  ) => Promise<ToolResult>;
}

function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// List email tools (generated from range config)
// ---------------------------------------------------------------------------

const LIST_DESCRIPTION_SUFFIX =
  "Returns an array of {id, subject, from, date} objects sorted newest-first. " +
  "The id is a globally unique identifier — use it with fetch_email_content to read the full email.";

const MAILBOX_SCHEMA = {
  mailbox: {
    type: "string",
    description: 'Mailbox to list from. Default: "INBOX".',
  },
};

const MAILBOX_HINT_SCHEMA = {
  mailbox: {
    type: "string",
    description:
      "Optional folder hint for faster lookup. If omitted, searches all folders.",
  },
};

function createListTool(
  name: string,
  days: number | undefined,
  rangeLabel: string
): ToolRegistration {
  const isAll = days === undefined;
  return {
    name,
    description: isAll
      ? "List ALL emails in the mailbox (no date filter). " +
        "Warning: this may return a very large number of results. " +
        LIST_DESCRIPTION_SUFFIX
      : `List all emails received in the ${rangeLabel}. ` +
        LIST_DESCRIPTION_SUFFIX,
    inputSchema: {
      type: "object",
      properties: { ...MAILBOX_SCHEMA },
    },
    handler: async (imapClient, args) => {
      const since = days !== undefined ? daysAgo(days) : undefined;
      const mailbox = (args.mailbox as string) || "INBOX";
      const emails = await listEmails(imapClient, since, mailbox);
      return jsonResult({ count: emails.length, emails });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const registry: ToolRegistration[] = [
  createListTool("list_emails_24h", 1, "last 24 hours"),
  createListTool("list_emails_7days", 7, "last 7 days"),
  createListTool("list_emails_month", 30, "last 30 days"),
  createListTool("list_emails_quarter", 90, "last 90 days"),
  createListTool("list_emails_year", 365, "last 365 days"),
  createListTool("list_emails_all", undefined, ""),

  {
    name: "list_inbox_messages",
    description:
      "List the most recent N messages in the inbox. " +
      LIST_DESCRIPTION_SUFFIX,
    inputSchema: {
      type: "object",
      properties: {
        n: {
          type: "number",
          description: "Number of recent messages to return.",
        },
      },
      required: ["n"],
    },
    handler: async (imapClient, args) => {
      const n = args.n as number;
      if (!n || n < 1) return errorResult("Error: n must be a positive number.");
      const emails = await listInboxMessages(imapClient, n);
      return jsonResult({ count: emails.length, emails });
    },
  },

  {
    name: "list_emails_from_domain",
    description:
      "List all emails from a specific domain (e.g. \"you.com\" finds all emails from @you.com senders). " +
      LIST_DESCRIPTION_SUFFIX,
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description:
            'The domain to search for (e.g. "example.com"). Do not include the @ sign.',
        },
        ...MAILBOX_SCHEMA,
      },
      required: ["domain"],
    },
    handler: async (imapClient, args) => {
      const domain = args.domain as string;
      const mailbox = (args.mailbox as string) || "INBOX";

      if (!domain) return errorResult("Error: domain is required.");

      const emails = await listEmailsFromDomain(imapClient, domain, mailbox);
      return jsonResult({ count: emails.length, emails });
    },
  },

  {
    name: "list_emails_from_sender",
    description:
      "List all emails from a specific sender email address (e.g. \"alice@example.com\"). " +
      LIST_DESCRIPTION_SUFFIX,
    inputSchema: {
      type: "object",
      properties: {
        sender: {
          type: "string",
          description:
            'The sender email address to search for (e.g. "alice@example.com").',
        },
        ...MAILBOX_SCHEMA,
      },
      required: ["sender"],
    },
    handler: async (imapClient, args) => {
      const sender = args.sender as string;
      const mailbox = (args.mailbox as string) || "INBOX";

      if (!sender) return errorResult("Error: sender is required.");

      const emails = await listEmailsFromSender(imapClient, sender, mailbox);
      return jsonResult({ count: emails.length, emails });
    },
  },

  {
    name: "fetch_email_content",
    description:
      "Fetch the full content of a single email by its id. " +
      "Returns {id, subject, from, to, date, body, attachments}. " +
      "The attachments array contains metadata only (id, filename, contentType, size) — " +
      "use fetch_email_attachment to download actual attachment data. " +
      "Use an id obtained from any of the list_emails_* tools.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier from list results.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id) return errorResult("Error: id is required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      const email = await fetchEmailContent(imapClient, uid, mailbox);
      if (!email)
        return errorResult(`No email found for id "${id}".`);

      return jsonResult(email);
    },
  },

  {
    name: "fetch_email_attachment",
    description:
      "Download a specific attachment from an email. " +
      "Requires the email id and the attachment id (obtained from fetch_email_content). " +
      "Returns {id, filename, contentType, size, contentBase64} where contentBase64 is the " +
      "base64-encoded file content.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier from list results.",
        },
        attachment_id: {
          type: "string",
          description:
            "The attachment identifier from fetch_email_content results.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id", "attachment_id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const attachmentId = args.attachment_id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id || !attachmentId)
        return errorResult("Error: id and attachment_id are required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      const attachment = await fetchEmailAttachment(
        imapClient,
        uid,
        attachmentId,
        mailbox
      );
      if (!attachment)
        return errorResult(
          `No attachment "${attachmentId}" found for email "${id}".`
        );

      return jsonResult(attachment);
    },
  },

  {
    name: "list_folders",
    description:
      "List all folders in the email account. " +
      "Returns an array of {path, name, delimiter} objects. " +
      "Use the path value when specifying a folder in other tools.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (imapClient) => {
      const folders = await listFolders(imapClient);
      return jsonResult({ count: folders.length, folders });
    },
  },

  {
    name: "create_folder",
    description:
      "Create a new folder. Use a path with the server's delimiter for subfolders " +
      '(e.g. "INBOX/Receipts" or "Projects/2024"). ' +
      "Use list_folders first to discover the delimiter if unsure.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            'Full path of the folder to create (e.g. "INBOX/Receipts").',
        },
      },
      required: ["path"],
    },
    handler: async (imapClient, args) => {
      const path = args.path as string;
      if (!path) return errorResult("Error: path is required.");

      const created = await createFolder(imapClient, path);
      return jsonResult({ created });
    },
  },

  {
    name: "move_email",
    description:
      "Move an email from one folder to another. " +
      "Requires the email's id (from list_emails_* or fetch_email_content) " +
      "and the destination folder to move it to. " +
      "Returns {id, destination}.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier.",
        },
        source_folder: {
          type: "string",
          description:
            "Optional folder hint for faster lookup. If omitted, searches all folders.",
        },
        destination_folder: {
          type: "string",
          description: "Folder to move the email to.",
        },
      },
      required: ["id", "destination_folder"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const sourceHint = args.source_folder as string | undefined;
      const destinationFolder = args.destination_folder as string;

      if (!id || !destinationFolder)
        return errorResult(
          "Error: id and destination_folder are required."
        );

      const { uid, mailbox } = await resolveEmailId(imapClient, id, sourceHint);
      const result = await moveEmail(
        imapClient,
        uid,
        mailbox,
        destinationFolder
      );
      return jsonResult({ id, destination: result.destination });
    },
  },

  {
    name: "create_draft",
    description:
      "Create a new email draft in the Drafts folder. " +
      "Returns {id, subject, to, date} of the created draft. " +
      "Optionally set in_reply_to with an email id to create a threaded reply draft " +
      "(sets In-Reply-To and References headers automatically).",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Plain text email body.",
        },
        cc: {
          type: "string",
          description: "CC recipient(s).",
        },
        bcc: {
          type: "string",
          description: "BCC recipient(s).",
        },
        in_reply_to: {
          type: "string",
          description:
            "ID of the email being replied to (for threading). " +
            "Automatically sets In-Reply-To and References headers.",
        },
      },
      required: ["to", "subject", "body"],
    },
    handler: async (imapClient, args) => {
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;

      if (!to || !subject || !body)
        return errorResult("Error: to, subject, and body are required.");

      const sender = process.env.IMAP_USER || "";
      const result = await createDraft(imapClient, sender, {
        to,
        subject,
        body,
        cc: args.cc as string | undefined,
        bcc: args.bcc as string | undefined,
        inReplyTo: args.in_reply_to as string | undefined,
      });
      return jsonResult(result);
    },
  },

  {
    name: "draft_reply",
    description:
      "Create a reply draft to an existing email. " +
      "Automatically derives recipient, subject (Re: prefix), and threading headers " +
      "from the original email. Set reply_all to true to include original recipients as CC. " +
      "Returns {id, subject, to, date} of the created draft.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID of the email to reply to.",
        },
        body: {
          type: "string",
          description: "Plain text reply body.",
        },
        reply_all: {
          type: "boolean",
          description:
            "Include original To/CC recipients as CC (default: false).",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id", "body"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const body = args.body as string;
      const replyAll = (args.reply_all as boolean) || false;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id || !body)
        return errorResult("Error: id and body are required.");

      // Resolve composite ID to UID + mailbox
      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);

      // Fetch the original email to derive fields
      const original = await fetchEmailContent(imapClient, uid, mailbox);
      if (!original)
        return errorResult(`Email not found for id "${id}".`);

      // Derive "to" from original sender
      const to = original.from;

      // Derive subject with Re: prefix (avoid double Re:)
      const subject = original.subject.startsWith("Re: ")
        ? original.subject
        : `Re: ${original.subject}`;

      // Derive CC for reply-all: original to + cc, minus current user
      let cc: string | undefined;
      if (replyAll) {
        const currentUser = (process.env.IMAP_USER || "").toLowerCase();
        const allRecipients = original.to
          .split(",")
          .map((addr) => addr.trim())
          .filter((addr) => addr.toLowerCase() !== currentUser && addr !== "");
        if (allRecipients.length > 0) {
          cc = allRecipients.join(", ");
        }
      }

      const sender = process.env.IMAP_USER || "";
      const result = await createDraft(imapClient, sender, {
        to,
        subject,
        body,
        cc,
        inReplyTo: id,
      });
      return jsonResult(result);
    },
  },

  {
    name: "star_email",
    description:
      "Add a star (flag) to an email. " +
      "Requires the email's id (from list_emails_* or fetch_email_content). " +
      "Returns {id, starred: true}.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier to star.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id) return errorResult("Error: id is required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      await starEmail(imapClient, uid, mailbox);
      return jsonResult({ id, starred: true });
    },
  },

  {
    name: "unstar_email",
    description:
      "Remove the star (flag) from an email. " +
      "Requires the email's id (from list_emails_* or fetch_email_content). " +
      "Returns {id, starred: false}.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier to unstar.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id) return errorResult("Error: id is required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      await unstarEmail(imapClient, uid, mailbox);
      return jsonResult({ id, starred: false });
    },
  },

  {
    name: "mark_read",
    description:
      "Mark an email as read (adds the \\Seen flag). " +
      "Requires the email's id (from list_emails_* or fetch_email_content). " +
      "Returns {id, read: true}.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier to mark as read.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id) return errorResult("Error: id is required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      await markRead(imapClient, uid, mailbox);
      return jsonResult({ id, read: true });
    },
  },

  {
    name: "mark_unread",
    description:
      "Mark an email as unread (removes the \\Seen flag). " +
      "Requires the email's id (from list_emails_* or fetch_email_content). " +
      "Returns {id, read: false}.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The email identifier to mark as unread.",
        },
        ...MAILBOX_HINT_SCHEMA,
      },
      required: ["id"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const mailboxHint = args.mailbox as string | undefined;

      if (!id) return errorResult("Error: id is required.");

      const { uid, mailbox } = await resolveEmailId(imapClient, id, mailboxHint);
      await markUnread(imapClient, uid, mailbox);
      return jsonResult({ id, read: false });
    },
  },

  {
    name: "list_starred_emails",
    description:
      "List all starred (flagged) emails across all folders, grouped by folder. " +
      LIST_DESCRIPTION_SUFFIX,
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (imapClient) => {
      const groups = await listAllStarredEmails(imapClient);
      const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
      return jsonResult({ totalCount, folders: groups });
    },
  },

  {
    name: "update_draft",
    description:
      "Replace an existing draft with new content. " +
      "The id must refer to an email in the Drafts folder — " +
      "this tool cannot modify emails in other folders. " +
      "Returns {id, subject, to, date} of the updated draft.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "ID of the existing draft to replace.",
        },
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Plain text email body.",
        },
        cc: {
          type: "string",
          description: "CC recipient(s).",
        },
        bcc: {
          type: "string",
          description: "BCC recipient(s).",
        },
        in_reply_to: {
          type: "string",
          description:
            "ID of the email being replied to (for threading).",
        },
      },
      required: ["id", "to", "subject", "body"],
    },
    handler: async (imapClient, args) => {
      const id = args.id as string;
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;

      if (!id || !to || !subject || !body)
        return errorResult(
          "Error: id, to, subject, and body are required."
        );

      // Resolve in Drafts folder specifically
      const draftsFolder = await findDraftsFolder(imapClient);
      const uid = await resolveInMailbox(
        imapClient,
        parseCompositeId(id).messageId,
        draftsFolder
      );
      if (!uid)
        return errorResult(
          "Draft not found. The id must refer to an email in the Drafts folder."
        );

      const sender = process.env.IMAP_USER || "";
      const result = await updateDraft(imapClient, sender, uid, {
        to,
        subject,
        body,
        cc: args.cc as string | undefined,
        bcc: args.bcc as string | undefined,
        inReplyTo: args.in_reply_to as string | undefined,
      });
      return jsonResult(result);
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Tool schemas for MCP ListTools response. */
export const tools = registry.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

/** Map-based dispatch — open for extension, closed for modification. */
const handlerMap = new Map(
  registry.map((t) => [t.name, t.handler])
);

export async function handleToolCall(
  imapClient: ImapClient,
  name: string,
  args: Record<string, unknown>
) {
  const handler = handlerMap.get(name);
  if (!handler)
    return errorResult(`Unknown tool: ${name}`);
  return handler(imapClient, args);
}
