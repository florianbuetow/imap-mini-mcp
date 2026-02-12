# imap-mcp

An MCP (Model Context Protocol) server that gives AI agents the ability to read, organize, and manage email over IMAP. Agents can browse mailboxes, read emails, download attachments, and move messages between folders — without being able to delete anything.

## Tools

### Listing emails

All list tools return `{count, emails}` where each email is `{uid, subject, from, date}`, sorted newest-first. Optional `folder` parameter (default: `"INBOX"`).

| Tool | Time range |
|---|---|
| `list_emails_24h` | Last 24 hours |
| `list_emails_7days` | Last 7 days |
| `list_emails_month` | Last 30 days |
| `list_emails_quarter` | Last 90 days |
| `list_emails_year` | Last 365 days |
| `list_emails_all` | All time |

### `fetch_email_content`

Fetch the full content of a single email by UID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | number | yes | IMAP UID from list results |
| `mailbox` | string | no | Default: `"INBOX"` |

Returns `{uid, subject, from, to, date, body, attachments}`. The `attachments` array contains metadata only: `{id, filename, contentType, size}`.

### `fetch_email_attachment`

Download a specific attachment from an email.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | number | yes | IMAP UID of the email |
| `attachment_id` | string | yes | Attachment id from `fetch_email_content` |
| `mailbox` | string | no | Default: `"INBOX"` |

Returns `{id, filename, contentType, size, contentBase64}`.

### `list_folders`

List all folders in the email account. Takes no parameters.

Returns `{count, folders}` where each folder is `{path, name, delimiter}`. Use the `path` value when specifying folders in other tools.

### `create_folder`

Create a new folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | yes | Full path of the folder (e.g. `"INBOX/Receipts"`) |

Returns `{created}` with the path of the created folder.

### `move_email`

Move an email from one folder to another. The email is not deleted — it is atomically relocated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | number | yes | IMAP UID of the email to move |
| `source_folder` | string | no | Folder the email is currently in. Default: `"INBOX"` |
| `destination_folder` | string | yes | Folder to move the email to |

Returns `{uid, destination}` where `uid` is the new UID in the destination folder.

### `create_draft`

Create a new email draft in the Drafts folder.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `to` | string | yes | Recipient email address |
| `subject` | string | yes | Email subject line |
| `body` | string | yes | Plain text email body |
| `cc` | string | no | CC recipient(s) |
| `bcc` | string | no | BCC recipient(s) |
| `in_reply_to` | number | no | UID of email being replied to (for threading) |

Returns `{uid, subject, to, date}`. The Drafts folder is auto-detected via the `\Drafts` special-use attribute.

### `draft_reply`

Create a reply draft to an existing email. Automatically derives recipient, subject, and threading headers from the original email.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | number | yes | UID of the email to reply to |
| `body` | string | yes | Plain text reply body |
| `reply_all` | boolean | no | Include original To/CC as CC (default: `false`) |
| `mailbox` | string | no | Mailbox containing the original email. Default: `"INBOX"` |

Returns `{uid, subject, to, date}`.

### `update_draft`

Replace an existing draft with new content. The UID must refer to an email in the Drafts folder — this tool cannot modify emails in other folders.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `uid` | number | yes | UID of the existing draft to replace |
| `to` | string | yes | Recipient email address |
| `subject` | string | yes | Email subject line |
| `body` | string | yes | Plain text email body |
| `cc` | string | no | CC recipient(s) |
| `bcc` | string | no | BCC recipient(s) |
| `in_reply_to` | number | no | UID of email being replied to (for threading) |

Returns `{uid, subject, to, date}` with the new draft's UID.

## Agent configuration

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/path/to/imap-mcp/dist/index.js"],
      "env": {
        "IMAP_HOST": "imap.example.com",
        "IMAP_PORT": "993",
        "IMAP_SECURE": "true",
        "IMAP_USER": "you@example.com",
        "IMAP_PASS": "your-password"
      }
    }
  }
}
```

Replace the `env` values with your actual IMAP credentials. The `args` path must point to the built `dist/index.js`.

## Development

### Build and run

```bash
npm install
npm run build
```

### Local development with `.env`

For running the server directly (outside of an MCP client), create a `.env` file:

```
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=you@example.com
IMAP_PASS=your-password
```

Then start the server:

```bash
npm start
```

This is only needed for local testing. When used through an MCP client, credentials are provided via the client config's `env` block.

### Testing

Tests use [vitest](https://vitest.dev) and mock the IMAP layer — no real server connection is needed:

```bash
npm test             # run once
npm run test:watch   # watch mode
npm run lint         # type-check only
```

## License

MIT
