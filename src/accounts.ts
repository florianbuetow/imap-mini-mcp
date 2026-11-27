import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClientFromSettings } from "./imap/index.js";
import type { ImapClient } from "./imap/index.js";

/** Several IMAP accounts, keyed by account name. */
export type ImapAccounts = Map<string, ImapClient>;

/** Allowed account names: letters, digits, "-" and "_", at most 64 characters. */
const ACCOUNT_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parse an account file: one KEY=value per line. The value is everything after
 * the first "=", taken verbatim (no quotes, no inline comments), so passwords
 * may contain any character. Blank lines and lines starting with "#" are
 * skipped.
 */
export function parseAccountFile(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key !== "") settings[key] = line.slice(eq + 1);
  }
  return settings;
}

/**
 * Load every account in `dir` (multi-account mode, IMAP_ACCOUNTS_DIR).
 *
 * Each file defines one account and holds the same IMAP_* settings as the
 * single-account environment. The account name is the file name without an
 * optional ".env" suffix. Files whose names start with "." and anything that
 * is not a file are skipped.
 */
export function loadAccounts(dir: string): ImapAccounts {
  const accounts: ImapAccounts = new Map();

  for (const file of readdirSync(dir).sort()) {
    if (file.startsWith(".")) continue;
    const path = join(dir, file);
    if (!statSync(path).isFile()) continue;

    const name = file.endsWith(".env") ? file.slice(0, -".env".length) : file;
    if (!ACCOUNT_NAME.test(name)) {
      throw new Error(
        `Invalid account file name "${file}" in ${dir}: use letters, digits, "-" and "_" (optionally ending in ".env")`
      );
    }
    if (accounts.has(name)) {
      throw new Error(`Account "${name}" is defined twice in ${dir}`);
    }

    const settings = parseAccountFile(readFileSync(path, "utf8"));
    accounts.set(
      name,
      createClientFromSettings(settings, (key) => `${key} in account file "${file}"`)
    );
  }

  if (accounts.size === 0) {
    throw new Error(`No account files found in IMAP_ACCOUNTS_DIR (${dir})`);
  }
  return accounts;
}
