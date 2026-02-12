/**
 * MCP Tool definitions for the IMAP email server.
 *
 * Design philosophy:
 * - Minimal, opinionated tools that AI agents can't misuse
 * - Every response includes IMAP UIDs (stable identifiers)
 * - All tools are read-only
 * - Date ranges are pre-computed — no agent date math needed
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
} from "../imap/index.js";

// ---------------------------------------------------------------------------
// Tool metadata (name + JSON Schema)
// ---------------------------------------------------------------------------

export const tools = [
  {
    name: "list_emails_7days",
    description:
      "List all emails received in the last 7 days. " +
      "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
      "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mailbox: {
          type: "string",
          description: 'Mailbox to list from. Default: "INBOX".',
        },
      },
    },
  },
  {
    name: "list_emails_month",
    description:
      "List all emails received in the last 30 days. " +
      "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
      "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mailbox: {
          type: "string",
          description: 'Mailbox to list from. Default: "INBOX".',
        },
      },
    },
  },
  {
    name: "list_emails_quarter",
    description:
      "List all emails received in the last 90 days. " +
      "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
      "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mailbox: {
          type: "string",
          description: 'Mailbox to list from. Default: "INBOX".',
        },
      },
    },
  },
  {
    name: "list_emails_year",
    description:
      "List all emails received in the last 365 days. " +
      "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
      "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mailbox: {
          type: "string",
          description: 'Mailbox to list from. Default: "INBOX".',
        },
      },
    },
  },
  {
    name: "list_emails_all",
    description:
      "List ALL emails in the mailbox (no date filter). " +
      "Warning: this may return a very large number of results. " +
      "Returns an array of {uid, subject, from, date} objects sorted newest-first. " +
      "The uid is a stable IMAP identifier — use it with fetch_email_content to read the full email.",
    inputSchema: {
      type: "object" as const,
      properties: {
        mailbox: {
          type: "string",
          description: 'Mailbox to list from. Default: "INBOX".',
        },
      },
    },
  },
  {
    name: "fetch_email_content",
    description:
      "Fetch the full content of a single email by its UID. " +
      "Returns {uid, subject, from, to, date, body, attachments}. " +
      "The attachments array contains metadata only (id, filename, contentType, size) — " +
      "use fetch_email_attachment to download actual attachment data. " +
      "Use a uid obtained from any of the list_emails_* tools.",
    inputSchema: {
      type: "object" as const,
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
  },
  {
    name: "fetch_email_attachment",
    description:
      "Download a specific attachment from an email. " +
      "Requires the email UID and the attachment id (obtained from fetch_email_content). " +
      "Returns {id, filename, contentType, size, contentBase64} where contentBase64 is the " +
      "base64-encoded file content.",
    inputSchema: {
      type: "object" as const,
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
  },
  {
    name: "list_folders",
    description:
      "List all folders in the email account. " +
      "Returns an array of {path, name, delimiter} objects. " +
      "Use the path value when specifying a folder in other tools.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "create_folder",
    description:
      "Create a new folder. Use a path with the server's delimiter for subfolders " +
      '(e.g. "INBOX/Receipts" or "Projects/2024"). ' +
      "Use list_folders first to discover the delimiter if unsure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description:
            'Full path of the folder to create (e.g. "INBOX/Receipts").',
        },
      },
      required: ["path"],
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
      type: "object" as const,
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
  },
] as const;

// ---------------------------------------------------------------------------
// Map of tool name → number of days to look back (undefined = all time)
// ---------------------------------------------------------------------------

const LIST_TOOL_DAYS: Record<string, number | undefined> = {
  list_emails_7days: 7,
  list_emails_month: 30,
  list_emails_quarter: 90,
  list_emails_year: 365,
  list_emails_all: undefined,
};

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

export async function handleToolCall(
  imapClient: ImapClient,
  name: string,
  args: Record<string, unknown>
) {
  // Handle list_emails_* tools
  if (name in LIST_TOOL_DAYS) {
    const days = LIST_TOOL_DAYS[name];
    const since = days !== undefined ? daysAgo(days) : undefined;
    const mailbox = (args.mailbox as string) || "INBOX";

    const emails = await listEmails(imapClient, since, mailbox);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ count: emails.length, emails }, null, 2),
        },
      ],
    };
  }

  // Handle fetch_email_content
  if (name === "fetch_email_content") {
    const uid = args.uid as number;
    const mailbox = (args.mailbox as string) || "INBOX";

    if (!uid) {
      return {
        content: [
          { type: "text" as const, text: "Error: uid is required." },
        ],
        isError: true,
      };
    }

    const email = await fetchEmailContent(imapClient, uid, mailbox);

    if (!email) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No email found with UID ${uid} in ${mailbox}.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(email, null, 2),
        },
      ],
    };
  }

  // Handle fetch_email_attachment
  if (name === "fetch_email_attachment") {
    const uid = args.uid as number;
    const attachmentId = args.attachment_id as string;
    const mailbox = (args.mailbox as string) || "INBOX";

    if (!uid || !attachmentId) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: uid and attachment_id are required.",
          },
        ],
        isError: true,
      };
    }

    const attachment = await fetchEmailAttachment(
      imapClient,
      uid,
      attachmentId,
      mailbox
    );

    if (!attachment) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No attachment "${attachmentId}" found in email UID ${uid} (${mailbox}).`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(attachment, null, 2),
        },
      ],
    };
  }

  // Handle list_folders
  if (name === "list_folders") {
    const folders = await listFolders(imapClient);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ count: folders.length, folders }, null, 2),
        },
      ],
    };
  }

  // Handle create_folder
  if (name === "create_folder") {
    const path = args.path as string;

    if (!path) {
      return {
        content: [
          { type: "text" as const, text: "Error: path is required." },
        ],
        isError: true,
      };
    }

    const created = await createFolder(imapClient, path);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ created }, null, 2),
        },
      ],
    };
  }

  // Handle move_email
  if (name === "move_email") {
    const uid = args.uid as number;
    const sourceFolder = (args.source_folder as string) || "INBOX";
    const destinationFolder = args.destination_folder as string;

    if (!uid || !destinationFolder) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: uid and destination_folder are required.",
          },
        ],
        isError: true,
      };
    }

    const result = await moveEmail(
      imapClient,
      uid,
      sourceFolder,
      destinationFolder
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  return {
    content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
    isError: true,
  };
}
