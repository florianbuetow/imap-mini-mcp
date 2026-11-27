import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { createClientFromSettings } from "./imap/index.js";
import type { ImapClient } from "./imap/index.js";

/** Several IMAP accounts, keyed by account name. */
export type ImapAccounts = Map<string, ImapClient>;

/** Allowed account names: letters, digits, "-" and "_", at most 64 characters. */
const ACCOUNT_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parse an account file: one KEY=value per line. The value is everything after
 * the first "=" up to the end of the line, taken verbatim (no quotes, no inline
 * comments), so a password may contain any character except a line break.
 * Blank lines and lines starting with "#" are skipped; any other line without
 * a key is an error.
 */
export function parseAccountFile(
  text: string,
  source = "account file"
): Record<string, string> {
  const settings: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    const key = eq < 0 ? "" : line.slice(0, eq).trim();
    if (key === "") {
      // Don't quote the line: it may contain part of a password.
      throw new Error(`Line ${i + 1} of ${source}: expected KEY=value`);
    }
    settings[key] = line.slice(eq + 1);
  }
  return settings;
}

/**
 * Load every account in `dir` (multi-account mode, IMAP_ACCOUNTS_DIR).
 *
 * Each file defines one account and holds the same IMAP_* settings as the
 * single-account environment. The account name is the file name without an
 * optional ".env" suffix. Files whose names start with "." and anything that
 * is not a file are skipped. Links are followed only within the directory
 * (e.g. the "..data" links of Kubernetes secret volumes).
 */
export function loadAccounts(dir: string): ImapAccounts {
  const accounts: ImapAccounts = new Map();
  const root = realpathSync(dir);
  const inside = root.endsWith(sep) ? root : root + sep;

  for (const file of readdirSync(root).sort()) {
    if (file.startsWith(".")) continue;
    const path = realpathSync(join(root, file));
    if (!statSync(path).isFile()) continue;
    if (!path.startsWith(inside)) {
      throw new Error(
        `Account file "${file}" in ${dir} links to a file outside that directory`
      );
    }

    const name = file.endsWith(".env") ? file.slice(0, -".env".length) : file;
    if (!ACCOUNT_NAME.test(name)) {
      throw new Error(
        `Invalid account file name "${file}" in ${dir}: use letters, digits, "-" and "_" (optionally ending in ".env")`
      );
    }
    if (accounts.has(name)) {
      throw new Error(`Account "${name}" is defined twice in ${dir}`);
    }

    const source = `account file "${file}"`;
    const settings = parseAccountFile(readFileSync(path, "utf8"), source);
    accounts.set(
      name,
      createClientFromSettings(settings, (key) => `${key} in ${source}`)
    );
  }

  if (accounts.size === 0) {
    throw new Error(`No account files found in IMAP_ACCOUNTS_DIR (${dir})`);
  }
  return accounts;
}
