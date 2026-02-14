# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repository does not currently use release tags, so entries are grouped by date and major update scope.

## 2026-02-14

### Added
- `list_emails_n_hours` tool — list emails from the last N hours
- `list_emails_n_minutes` tool — list emails from the last N minutes
- `list_n_recent_emails` tool — list the N most recent emails from the inbox
- `hoursAgo()` and `minutesAgo()` helper functions for flexible time-based queries

## 2026-02-13

### Added
- `list_inbox_messages` tool — list the most recent N messages in the inbox
- `mark_read` and `mark_unread` tools — toggle the read/unread flag on emails
- `bulk_move_by_sender_email` tool — move all emails from a sender address
- `bulk_move_by_sender_domain` tool — move all emails from a sender domain
- Connection error handling with structured stderr logging
- Mailbox lock retry logic for transient IMAP failures
- Integration test that exercises tools against a real IMAP server

### Fixed
- Server no longer crashes on unexpected IMAP errors (graceful error propagation)

## 2026-02-12

### Added
- Initial IMAP MCP server with stdio transport
- Email listing tools: `list_emails_24h`, `list_emails_7days`, `list_emails_month`, `list_emails_quarter`, `list_emails_year`, `list_emails_all`
- `list_emails_from_domain` and `list_emails_from_sender` tools
- `list_starred_emails` tool — starred emails across all folders, grouped by folder
- `fetch_email_content` and `fetch_email_attachment` tools
- `list_folders` and `create_folder` tools
- `move_email` tool
- `star_email` and `unstar_email` tools
- `create_draft`, `draft_reply`, and `update_draft` tools
- Globally unique composite email identifiers (`YYYY-MM-DDTHH:mm:ss.<Message-ID>`)
- Configurable TLS, STARTTLS, and certificate validation via environment variables
- ProtonMail Bridge support (non-TLS localhost connections)
- README with setup instructions, tool reference, and troubleshooting guide
