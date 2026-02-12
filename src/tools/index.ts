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
  fetchEmailContent,
  fetchEmailAttachment,
  daysAgo,
  listFolders,
  createFolder,
  moveEmail,
  createDraft,
  updateDraft,
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
  "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
  "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.";

const MAILBOX_SCHEMA = {
  mailbox: {
    type: "string",
    description: 'Mailbox to list from. Default: "INBOX".',
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
    name: "fetch_email_content",
    description:
      "Fetch the full content of a single email by its UID. " +
      "Returns {uid, subject, from, to, date, body, attachments}. " +
      "The attachments array contains metadata only (id, filename, contentType, size) — " +
      "use fetch_email_attachment to download actual attachment data. " +
      "Use a uid obtained from any of the list_emails_* tools.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "number",
          description: "The IMAP UID of the email to fetch.",
        },
        mailbox: {
          type: "string",
          description: 'Mailbox containing the email. Default: "INBOX".',
        },
      },
      required: ["uid"],
    },
    handler: async (imapClient, args) => {
      const uid = args.uid as number;
      const mailbox = (args.mailbox as string) || "INBOX";

      if (!uid) return errorResult("Error: uid is required.");

      const email = await fetchEmailContent(imapClient, uid, mailbox);
      if (!email)
        return errorResult(
          `No email found with UID ${uid} in ${mailbox}.`
        );

      return jsonResult(email);
    },
  },

  {
    name: "fetch_email_attachment",
    description:
      "Download a specific attachment from an email. " +
      "Requires the email UID and the attachment id (obtained from fetch_email_content). " +
      "Returns {id, filename, contentType, size, contentBase64} where contentBase64 is the " +
      "base64-encoded file content.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "number",
          description: "The IMAP UID of the email containing the attachment.",
        },
        attachment_id: {
          type: "string",
          description:
            "The attachment identifier from fetch_email_content results.",
        },
        mailbox: {
          type: "string",
          description: 'Mailbox containing the email. Default: "INBOX".',
        },
      },
      required: ["uid", "attachment_id"],
    },
    handler: async (imapClient, args) => {
      const uid = args.uid as number;
      const attachmentId = args.attachment_id as string;
      const mailbox = (args.mailbox as string) || "INBOX";

      if (!uid || !attachmentId)
        return errorResult("Error: uid and attachment_id are required.");

      const attachment = await fetchEmailAttachment(
        imapClient,
        uid,
        attachmentId,
        mailbox
      );
      if (!attachment)
        return errorResult(
          `No attachment "${attachmentId}" found in email UID ${uid} (${mailbox}).`
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
      "Requires the email's UID (from list_emails_* or fetch_email_content), " +
      "the source folder it's currently in, and the destination folder to move it to. " +
      "Returns the new UID in the destination folder.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "number",
          description: "The IMAP UID of the email to move.",
        },
        source_folder: {
          type: "string",
          description: 'Folder the email is currently in. Default: "INBOX".',
        },
        destination_folder: {
          type: "string",
          description: "Folder to move the email to.",
        },
      },
      required: ["uid", "destination_folder"],
    },
    handler: async (imapClient, args) => {
      const uid = args.uid as number;
      const sourceFolder = (args.source_folder as string) || "INBOX";
      const destinationFolder = args.destination_folder as string;

      if (!uid || !destinationFolder)
        return errorResult(
          "Error: uid and destination_folder are required."
        );

      const result = await moveEmail(
        imapClient,
        uid,
        sourceFolder,
        destinationFolder
      );
      return jsonResult(result);
    },
  },

  {
    name: "create_draft",
    description:
      "Create a new email draft in the Drafts folder. " +
      "Returns {uid, subject, to, date} of the created draft. " +
      "Optionally set in_reply_to with a UID to create a threaded reply draft " +
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
          type: "number",
          description:
            "UID of the email being replied to (for threading). " +
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
        inReplyTo: args.in_reply_to as number | undefined,
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
      "Returns {uid, subject, to, date} of the created draft.",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "number",
          description: "UID of the email to reply to.",
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
        mailbox: {
          type: "string",
          description:
            'Mailbox containing the original email. Default: "INBOX".',
        },
      },
      required: ["uid", "body"],
    },
    handler: async (imapClient, args) => {
      const uid = args.uid as number;
      const body = args.body as string;
      const replyAll = (args.reply_all as boolean) || false;
      const mailbox = (args.mailbox as string) || "INBOX";

      if (!uid || !body)
        return errorResult("Error: uid and body are required.");

      // Fetch the original email to derive fields
      const original = await fetchEmailContent(imapClient, uid, mailbox);
      if (!original)
        return errorResult(`Email with UID ${uid} not found.`);

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
        inReplyTo: uid,
        inReplyToMailbox: mailbox,
      });
      return jsonResult(result);
    },
  },

  {
    name: "update_draft",
    description:
      "Replace an existing draft with new content. " +
      "The UID must refer to an email in the Drafts folder — " +
      "this tool cannot modify emails in other folders. " +
      "Returns {uid, subject, to, date} of the updated draft (with a new UID).",
    inputSchema: {
      type: "object",
      properties: {
        uid: {
          type: "number",
          description: "UID of the existing draft to replace.",
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
          type: "number",
          description:
            "UID of the email being replied to (for threading).",
        },
      },
      required: ["uid", "to", "subject", "body"],
    },
    handler: async (imapClient, args) => {
      const uid = args.uid as number;
      const to = args.to as string;
      const subject = args.subject as string;
      const body = args.body as string;

      if (!uid || !to || !subject || !body)
        return errorResult(
          "Error: uid, to, subject, and body are required."
        );

      const sender = process.env.IMAP_USER || "";
      const result = await updateDraft(imapClient, sender, uid, {
        to,
        subject,
        body,
        cc: args.cc as string | undefined,
        bcc: args.bcc as string | undefined,
        inReplyTo: args.in_reply_to as number | undefined,
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
