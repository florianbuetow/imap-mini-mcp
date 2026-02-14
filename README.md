# IMAP Mini MCP

![Made with AI](https://img.shields.io/badge/Made%20with-AI-333333?labelColor=f00) ![Verified by Humans](https://img.shields.io/badge/Verified%20by-Humans-333333?labelColor=brightgreen)

A lightweight MCP (Model Context Protocol) server for reading IMAP email and creating draft replies. Works with any standard IMAP server (Gmail, Outlook, Fastmail, etc.) and local bridges like [ProtonMail Bridge](https://proton.me/mail/bridge).

Agents can read, search, move, star, and organize emails, and compose drafts — but cannot send or delete emails.

## Workflow Recommendation

I highly recommend using a speech-to-text tool (e.g. [SuperWhisper](https://superwhisper.com) on Mac or [Whisperflow](https://whisperflow.com) on Windows) and connecting your AI desktop application (Claude, Codex, etc.) to this MCP server. That way you can converse with your email inbox using speech, which will dramatically speed up your workflow.

## How to Use

### Agent configuration

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "imap-mini-mcp": {
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

For **ProtonMail Bridge** — all five settings below are required (the bridge listens on localhost without TLS, uses a self-signed certificate, and does not support STARTTLS):

```
IMAP_HOST=127.0.0.1
IMAP_PORT=1143
IMAP_SECURE=false
IMAP_STARTTLS=false
IMAP_TLS_REJECT_UNAUTHORIZED=false
```

Or as MCP client config:

```json
{
  "mcpServers": {
    "imap-mini-mcp": {
      "command": "node",
      "args": ["/path/to/imap-mini-mcp/dist/index.js"],
      "env": {
        "IMAP_HOST": "127.0.0.1",
        "IMAP_PORT": "1143",
        "IMAP_SECURE": "false",
        "IMAP_STARTTLS": "false",
        "IMAP_TLS_REJECT_UNAUTHORIZED": "false",
        "IMAP_USER": "you@proton.me",
        "IMAP_PASS": "your-bridge-password"
      }
    }
  }
}
```

## Tools

Every email is identified by a composite **id** (`YYYY-MM-DDTHH:mm:ss.<Message-ID>`) that is globally unique and stable across folder moves. Use the `id` returned by any listing tool to fetch content, download attachments, move emails, or create reply drafts. Action tools accept an optional `mailbox` hint for faster lookup; if omitted, all folders are searched.

| Tool | Description | Key parameters |
|---|---|---|
| `list_emails_24h` | Emails from the last 24 hours | `mailbox?` |
| `list_emails_7days` | Emails from the last 7 days | `mailbox?` |
| `list_emails_month` | Emails from the last 30 days | `mailbox?` |
| `list_emails_quarter` | Emails from the last 90 days | `mailbox?` |
| `list_emails_year` | Emails from the last 365 days | `mailbox?` |
| `list_emails_all` | All emails (no date filter) | `mailbox?` |
| `list_inbox_messages` | Most recent N messages in the inbox | `n` |
| `list_emails_n_hours` | Emails from the last N hours | `hours` |
| `list_emails_n_minutes` | Emails from the last N minutes | `minutes` |
| `list_n_recent_emails` | N most recent emails from the inbox | `n` |
| `list_emails_from_domain` | All emails from a domain | `domain`, `mailbox?` |
| `list_emails_from_sender` | All emails from a sender address | `sender`, `mailbox?` |
| `list_starred_emails` | Starred emails across all folders | — |
| `fetch_email_content` | Full email content by id | `id`, `mailbox?` |
| `fetch_email_attachment` | Download an attachment | `id`, `attachment_id`, `mailbox?` |
| `list_folders` | List all folders | — |
| `create_folder` | Create a new folder | `path` |
| `move_email` | Move an email to another folder | `id`, `destination_folder`, `source_folder?` |
| `bulk_move_by_sender_email` | Move all emails from a sender | `sender`, `source_folder`, `destination_folder` |
| `bulk_move_by_sender_domain` | Move all emails from a domain | `domain`, `source_folder`, `destination_folder` |
| `star_email` | Star an email | `id`, `mailbox?` |
| `unstar_email` | Unstar an email | `id`, `mailbox?` |
| `mark_read` | Mark an email as read | `id`, `mailbox?` |
| `mark_unread` | Mark an email as unread | `id`, `mailbox?` |
| `create_draft` | Create a new draft | `to`, `subject`, `body`, `cc?`, `bcc?`, `in_reply_to?` |
| `draft_reply` | Create a reply draft from an existing email | `id`, `body`, `reply_all?`, `mailbox?` |
| `update_draft` | Replace an existing draft (Drafts folder only) | `id`, `to`, `subject`, `body`, `cc?`, `bcc?`, `in_reply_to?` |

## Troubleshooting

### "IMAP connection closed unexpectedly" or "Server disconnected"

This almost always means the server rejected the connection due to a TLS/STARTTLS mismatch. Verify these environment variables are set correctly in your MCP client config:

| Variable | Check |
|---|---|
| `IMAP_HOST` | Correct hostname or IP |
| `IMAP_PORT` | Matches your server (993 for TLS, 143/1143 for plain) |
| `IMAP_SECURE` | `true` for port 993, `false` for plain connections |
| `IMAP_STARTTLS` | `false` if your server does not support STARTTLS |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | `false` if your server uses a self-signed certificate |

Local IMAP bridges (e.g. ProtonMail Bridge) typically require `IMAP_SECURE=false`, `IMAP_STARTTLS=false`, and `IMAP_TLS_REJECT_UNAUTHORIZED=false`. See the ProtonMail Bridge config example in the [Environment variables](#environment-variables) section above.

### "IMAP authentication failed"

Check that `IMAP_USER` and `IMAP_PASS` are correct. Some providers (e.g. Gmail) require an app-specific password rather than your account password.

### "Cannot reach IMAP server — connection refused"

The IMAP server is not running or not listening on the configured host and port. For local bridges, make sure the bridge application is running.

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

[MIT](https://opensource.org/license/mit)
