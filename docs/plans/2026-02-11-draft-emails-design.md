# Draft Emails Design

## Summary

Add three new MCP tools for creating and managing email drafts via IMAP. Drafts are the only mutable email objects — no sending, no deleting emails outside the Drafts folder.

## New Tools

### `create_draft`

Create a new email draft in the auto-detected Drafts folder.

| Parameter    | Type   | Required | Description                                   |
|-------------|--------|----------|-----------------------------------------------|
| to          | string | yes      | Recipient email address                       |
| subject     | string | yes      | Email subject line                            |
| body        | string | yes      | Plain text email body                         |
| cc          | string | no       | CC recipient(s)                               |
| bcc         | string | no       | BCC recipient(s)                              |
| in_reply_to | number | no       | UID of email being replied to (for threading) |

### `draft_reply`

Create a reply draft to an existing email. Auto-derives recipient, subject, and threading fields.

| Parameter  | Type    | Required | Description                                  |
|-----------|---------|----------|----------------------------------------------|
| uid       | number  | yes      | UID of the email to reply to                 |
| body      | string  | yes      | Plain text reply body                        |
| reply_all | boolean | no       | Include original to/cc as CC (default false) |

Field derivation:
- `to` = original email's `from`
- `subject` = `Re: <original subject>` (no double-prefix)
- `cc` = original `to` + `cc` minus current user (only when `reply_all` is true)
- Threading headers (`In-Reply-To`, `References`) set automatically from original email

### `update_draft`

Replace an existing draft. Takes the same parameters as `create_draft`, plus:

| Parameter | Type   | Required | Description                          |
|-----------|--------|----------|--------------------------------------|
| uid       | number | yes      | UID of the existing draft to replace |

Safety constraint: rejects with error if the provided UID is not in the Drafts folder. Error message: "You can only update drafts. The email you provided is not in the drafts folder."

### Return Value

All three tools return `{ uid, subject, to, date }`.

## Architecture

### New file: `src/imap/drafts.ts`

Three exported functions:

**`findDraftsFolder(imapClient)`** — Lists mailboxes, finds the one with `\Drafts` special-use attribute (RFC 6154). Falls back to `"Drafts"` if no special-use attribute found. Throws if no Drafts folder can be identified.

**`createDraft(imapClient, options)`** — Builds an RFC 2822 message using `nodemailer`'s `MailComposer`. If `in_reply_to` UID is provided, fetches the original email's `Message-ID` header and sets `In-Reply-To` + `References`. Appends to the Drafts folder with the `\Draft` flag via ImapFlow's `append()`. Returns `{ uid, subject, to, date }`.

**`updateDraft(imapClient, uid, options)`** — Opens the Drafts folder, verifies the UID exists there. If not, throws. Otherwise appends the new version, deletes the old UID (`\Deleted` flag + expunge), returns the new draft's `{ uid, subject, to, date }`.

### Drafts folder detection

Auto-detected via `\Drafts` special-use attribute. Fallback to `"Drafts"`. No parameter exposed to the agent.

### Message composition

Uses `nodemailer`'s `MailComposer` to build raw RFC 2822 messages. No transport is configured — we never send. This keeps the "no sending" guarantee structural.

### `draft_reply` flow

Implemented in the tool handler (not the IMAP layer):
1. Fetch original email via existing `fetchEmailContent`
2. Derive `to`, `subject`, `cc` from original email fields
3. Call `createDraft` with `in_reply_to` set

### Error handling

- `findDraftsFolder`: throws `"Could not find Drafts folder. Available folders can be listed with list_folders."`
- `updateDraft`: throws `"You can only update drafts. The email you provided is not in the drafts folder."`
- `draft_reply`: throws `"Email with UID {uid} not found."` if original email doesn't exist
- All errors caught by existing `server.ts` handler, returned as `{ isError: true }`

### Mailbox locking

All operations use `imapClient.openMailbox()` with locks, same as existing code.

## Files to Change

**New files:**
- `src/imap/drafts.ts` — draft IMAP operations
- `src/imap/drafts.test.ts` — tests for draft operations

**Modified files:**
- `src/imap/index.ts` — export drafts module
- `src/tools/index.ts` — add 3 tool definitions + dispatch handlers
- `src/tools/index.test.ts` — tool metadata and dispatch tests
- `package.json` — add `nodemailer` + `@types/nodemailer`

## Test Plan

### `drafts.test.ts` (mocked ImapFlow)

- `findDraftsFolder`: finds folder with `\Drafts` attribute; falls back to `"Drafts"`; throws when no Drafts folder exists
- `createDraft`: appends message with `\Draft` flag; sets `In-Reply-To`/`References` when `in_reply_to` provided; prepends `Re:` to subject for replies
- `updateDraft`: replaces draft and returns new UID; rejects when UID is not in Drafts folder

### `tools/index.test.ts`

- Tool metadata: validates `create_draft`, `draft_reply`, `update_draft` schemas with correct required fields
- Dispatch: `draft_reply` derives `to`/`subject`/`cc` correctly; `reply_all` includes recipients minus current user; no double `Re: Re:` prefix
