# IMAP Mini MCP

A lightweight MCP (Model Context Protocol) server for reading IMAP email and creating draft replies. Works with any standard IMAP server (Gmail, Outlook, Fastmail, etc.) and local bridges like [ProtonMail Bridge](https://proton.me/mail/bridge).

All tools are read-only, except for draft creation — agents can compose and update drafts but cannot send or delete emails.

## Workflow Recommendation

I highly recommend using a speech-to-text tool (e.g. [SuperWhisper](https://superwhisper.com) on Mac or [Whisperflow](https://whisperflow.com) on Windows) and connecting your AI desktop application (Claude, Codex, etc.) to this MCP server. That way you can converse with your email inbox using speech, which dramatically speeds up your workflow.

## How to Use

### Agent configuration

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imap": {
      "command": "node",
      "args": ["/path/to/imap-mini-mcp/dist/index.js"],
      "env": {
        "IMAP_HOST": "imap.example.com",
        "IMAP_USER": "you@example.com",
        "IMAP_PASS": "your-password"
      }
    }
  }
}
```

The `args` path must point to the built `dist/index.js`. Add any optional variables to the `env` block as needed.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `IMAP_HOST` | yes | — | IMAP server hostname (e.g. `imap.gmail.com`) |
| `IMAP_USER` | yes | — | Email address or username |
| `IMAP_PASS` | yes | — | Password or app-specific password |
| `IMAP_PORT` | no | `993` | IMAP server port |
| `IMAP_SECURE` | no | `true` | Use TLS for the connection |
| `IMAP_STARTTLS` | no | `true` | Upgrade to TLS via STARTTLS (when `IMAP_SECURE=false`) |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | no | `true` | Reject self-signed TLS certificates |

For most providers (Gmail, Outlook, Fastmail), the defaults work — just set host, user, and password.

For **ProtonMail Bridge** (localhost, self-signed cert, no TLS):

```
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
IMAP_SECURE=false
IMAP_STARTTLS=false
IMAP_TLS_REJECT_UNAUTHORIZED=false
```

## Tools

### Listing emails

All list tools return `{count, emails}` where each email is `{uid, subject, from, date}`, sorted newest-first. Optional `folder` parameter (default: `"INBOX"`).

**Addressing emails** — Every email is identified by a **UID** (unique identifier), a stable numeric ID assigned by the IMAP server. UIDs don't change when other emails are moved or deleted, making them reliable references across tool calls. Use UIDs returned by any `list_emails_*` tool to fetch content, download attachments, move emails, or create reply drafts.

| Tool | Time range |
|---|---|
| `list_emails_24h` | Last 24 hours |
| `list_emails_7days` | Last 7 days |
| `list_emails_month` | Last 30 days |
| `list_emails_quarter` | Last 90 days |
| `list_emails_year` | Last 365 days |
| `list_emails_all` | All time |

### `list_emails_from_domain`

List all emails from a specific domain.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `domain` | string | yes | Domain to search for (e.g. `"example.com"`) |
| `mailbox` | string | no | Default: `"INBOX"` |

Returns `{count, emails}`.

### `list_emails_from_sender`

List all emails from a specific sender email address.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sender` | string | yes | Sender email address (e.g. `"alice@example.com"`) |
| `mailbox` | string | no | Default: `"INBOX"` |

Returns `{count, emails}`.

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

## Development

### Build and run

```bash
npm install
npm run build
```

### Local development with `.env`

For running the server directly (outside of an MCP client), copy `.env.example` to `.env` and fill in your credentials, then:

```bash
npm start
```

When used through an MCP client, credentials are provided via the client config's `env` block instead.

### Testing

Tests use [vitest](https://vitest.dev) and mock the IMAP layer — no real server connection is needed:

```bash
npm test             # run once
npm run test:watch   # watch mode
npm run lint         # type-check only
```

## License

MIT
