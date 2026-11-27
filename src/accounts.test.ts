import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadAccounts, parseAccountFile } from "./accounts.js";
import type { ImapClient, ImapConfig } from "./imap/index.js";

// Creating symlinks needs extra rights on Windows, so the link tests let
// realpathSync report where an entry points instead.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) };
});
const { realpathSync: actualRealpathSync } =
  await vi.importActual<typeof import("node:fs")>("node:fs");

/** Make realpathSync resolve the entry `name` to `target`. */
function linkEntry(name: string, target: string) {
  vi.mocked(realpathSync).mockImplementation(((path: string) =>
    basename(path) === name ? target : actualRealpathSync(path)) as typeof realpathSync);
}

const configOf = (client: ImapClient | undefined) =>
  (client as unknown as { config: ImapConfig }).config;

const BASIC =
  "IMAP_HOST=imap.example.com\nIMAP_USER=me@example.com\nIMAP_PASS=secret\n";

let dir: string;

function writeAccount(file: string, text = BASIC) {
  writeFileSync(join(dir, file), text);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "imap-accounts-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.mocked(realpathSync).mockImplementation(actualRealpathSync);
});

// ---------------------------------------------------------------------------
// parseAccountFile
// ---------------------------------------------------------------------------

describe("parseAccountFile", () => {
  it("takes the value verbatim after the first '='", () => {
    expect(parseAccountFile(`IMAP_PASS=a b#c=d "e' \n`)).toEqual({
      IMAP_PASS: `a b#c=d "e' `,
    });
  });

  it("skips blank lines and comments", () => {
    const text = "# comment\n\n   # indented comment\nIMAP_HOST=h\n";

    expect(parseAccountFile(text)).toEqual({ IMAP_HOST: "h" });
  });

  it("rejects a line without a key, naming the line but not its content", () => {
    const text = "IMAP_HOST=h\nIMAP_PASS=first part\nsecond part\n";

    expect(() => parseAccountFile(text, 'account file "work"')).toThrow(
      'Line 3 of account file "work": expected KEY=value'
    );
    expect(() => parseAccountFile(text)).not.toThrow(/second part/);
    expect(() => parseAccountFile("=value\n")).toThrow("Line 1 of account file");
  });

  it("accepts CRLF line endings and spaces around the key", () => {
    expect(parseAccountFile("IMAP_HOST=h\r\n  IMAP_USER =u\r\n")).toEqual({
      IMAP_HOST: "h",
      IMAP_USER: "u",
    });
  });
});

// ---------------------------------------------------------------------------
// loadAccounts
// ---------------------------------------------------------------------------

describe("loadAccounts", () => {
  it("loads every file as an account named after the file, without .env", () => {
    writeAccount("work.env");
    writeAccount("home");

    const accounts = loadAccounts(dir);

    expect([...accounts.keys()]).toEqual(["home", "work"]);
    expect(configOf(accounts.get("work")).host).toBe("imap.example.com");
    expect(accounts.get("work")?.user).toBe("me@example.com");
  });

  it("defaults to TLS with certificate checks, like single-account mode", () => {
    writeAccount("work");

    expect(configOf(loadAccounts(dir).get("work"))).toMatchObject({
      port: 993,
      secure: true,
      starttls: true,
      tlsRejectUnauthorized: true,
    });
  });

  it("reads the optional connection settings per account", () => {
    writeAccount(
      "proton",
      [
        "IMAP_HOST=127.0.0.1",
        "IMAP_PORT=1143",
        "IMAP_SECURE=false",
        "IMAP_STARTTLS=false",
        "IMAP_TLS_REJECT_UNAUTHORIZED=false",
        "IMAP_USER=me@proton.me",
        "IMAP_PASS=bridge-pass",
      ].join("\n")
    );
    writeAccount("work");

    const accounts = loadAccounts(dir);

    expect(configOf(accounts.get("proton"))).toMatchObject({
      port: 1143,
      secure: false,
      starttls: false,
      tlsRejectUnauthorized: false,
    });
    expect(configOf(accounts.get("work"))).toMatchObject({
      secure: true,
      tlsRejectUnauthorized: true,
    });
  });

  it("ignores IMAP_* environment variables", () => {
    vi.stubEnv("IMAP_HOST", "env.example.com");
    vi.stubEnv("IMAP_PORT", "143");
    vi.stubEnv("IMAP_TLS_REJECT_UNAUTHORIZED", "false");
    writeAccount("work");

    expect(configOf(loadAccounts(dir).get("work"))).toMatchObject({
      host: "imap.example.com",
      port: 993,
      tlsRejectUnauthorized: true,
    });
  });

  it("skips dot files and directories", () => {
    writeAccount("work");
    writeAccount(".hidden");
    mkdirSync(join(dir, "subdir"));
    mkdirSync(join(dir, "..data"));

    expect([...loadAccounts(dir).keys()]).toEqual(["work"]);
  });

  it("follows a link that stays inside the directory (Kubernetes ..data layout)", () => {
    mkdirSync(join(dir, "..data"));
    writeAccount(join("..data", "work"));
    writeAccount("work", "IMAP_HOST=not-the-link-target\n");
    linkEntry("work", join(actualRealpathSync(dir), "..data", "work"));

    expect(configOf(loadAccounts(dir).get("work")).host).toBe("imap.example.com");
  });

  it("rejects a link to a file outside the directory", () => {
    const outside = mkdtempSync(join(tmpdir(), "imap-outside-"));
    try {
      writeFileSync(join(outside, "other"), BASIC);
      writeAccount("work", "IMAP_HOST=not-the-link-target\n");
      linkEntry("work", join(actualRealpathSync(outside), "other"));

      expect(() => loadAccounts(dir)).toThrow(
        'Account file "work" in ' + dir + " links to a file outside that directory"
      );
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a file name that is not a valid account name", () => {
    writeAccount("work.txt");

    expect(() => loadAccounts(dir)).toThrow(
      'Invalid account file name "work.txt"'
    );
  });

  it("rejects an account that is defined twice", () => {
    writeAccount("work");
    writeAccount("work.env");

    expect(() => loadAccounts(dir)).toThrow('Account "work" is defined twice');
  });

  it("names the file when a required setting is missing", () => {
    writeAccount("work.env", "IMAP_HOST=imap.example.com\nIMAP_USER=me\n");

    expect(() => loadAccounts(dir)).toThrow(
      'IMAP_PASS in account file "work.env" is required'
    );
  });

  it("fails when the directory has no account files", () => {
    writeAccount(".hidden");

    expect(() => loadAccounts(dir)).toThrow(
      "No account files found in IMAP_ACCOUNTS_DIR"
    );
  });

  it("fails when the directory does not exist", () => {
    expect(() => loadAccounts(join(dir, "missing"))).toThrow(/ENOENT/);
  });
});
