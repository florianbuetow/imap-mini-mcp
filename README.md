# imap-mcp

An MCP (Model Context Protocol) server that provides convenient, agent-friendly tools for reading IMAP email. Designed so AI agents can browse and search email without needing to understand IMAP internals.

All tools are **read-only**.

## Features

- **Pre-built time ranges** — list emails from last 7 days, 30 days, 90 days, year, or all time
- **UID-centric** — every response includes stable IMAP UIDs that persist across sessions
- **MIME parsing** — proper text body extraction and attachment enumeration via `mailparser`
- **Attachment download** — fetch individual attachments by ID
- **Minimal surface area** — 7 opinionated tools, no confusing parameters for agents to misuse

## Setup

```bash
npm install
npm run build
```

Configure IMAP credentials via environment variables (see `.env.example`):

```
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=you@example.com
IMAP_PASS=your-password
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

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

## Available MCP Tools

### Listing tools

All list tools return `{count, emails}` where each email is `{uid, subject, from, date}`, sorted newest-first. Optional `mailbox` parameter (default: "INBOX").

| Tool                   | Time range    |
|------------------------|---------------|
| `list_emails_7days`    | Last 7 days   |
| `list_emails_month`    | Last 30 days  |
| `list_emails_quarter`  | Last 90 days  |
| `list_emails_year`     | Last 365 days |
| `list_emails_all`      | All time      |

### `fetch_email_content`

Fetch the full content of a single email by UID.

| Parameter | Type   | Required | Description                |
|-----------|--------|----------|----------------------------|
| uid       | number | yes      | IMAP UID from list results |
| mailbox   | string | no       | Default: "INBOX"           |

Returns `{uid, subject, from, to, date, body, attachments}`. The `attachments` array contains metadata only: `{id, filename, contentType, size}`.

### `fetch_email_attachment`

Download a specific attachment from an email.

| Parameter     | Type   | Required | Description                               |
|---------------|--------|----------|-------------------------------------------|
| uid           | number | yes      | IMAP UID of the email                     |
| attachment_id | string | yes      | Attachment id from fetch_email_content    |
| mailbox       | string | no       | Default: "INBOX"                          |

Returns `{id, filename, contentType, size, contentBase64}`.

## Typical agent workflow

1. Call `list_emails_7days` to get recent email summaries
2. Pick an email of interest by its `uid`
3. Call `fetch_email_content` with that `uid` to read the full email
4. If the email has attachments, call `fetch_email_attachment` with the `uid` and `attachment_id`

## Development

```bash
npm run dev          # Watch mode (recompile on changes)
npm run lint         # Type-check without emitting
npm run build        # Full build
npm test             # Run tests once
npm run test:watch   # Run tests in watch mode
```

### Testing

Tests use [vitest](https://vitest.dev) and live alongside the source files (`*.test.ts`). The test suite mocks the IMAP layer so no real server connection is needed:

- `src/imap/search.test.ts` — unit tests for `daysAgo`, `extractEmailAddress`, and integration tests for `listEmails`, `fetchEmailContent`, `fetchEmailAttachment` with mocked ImapFlow
- `src/imap/client.test.ts` — env var validation tests for `createClientFromEnv`
- `src/tools/index.test.ts` — tool metadata validation and dispatch tests for all 7 MCP tools

## License

MIT
