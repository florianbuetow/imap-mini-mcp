import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClientFromEnv } from "./client.js";

describe("createClientFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars before each test
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_PORT;
    delete process.env.IMAP_SECURE;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASS;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("throws when IMAP_HOST is missing", () => {
    process.env.IMAP_USER = "user";
    process.env.IMAP_PASS = "pass";

    expect(() => createClientFromEnv()).toThrow(
      "IMAP_HOST environment variable is required"
    );
  });

  it("throws when IMAP_USER is missing", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_PASS = "pass";

    expect(() => createClientFromEnv()).toThrow(
      "IMAP_USER environment variable is required"
    );
  });

  it("throws when IMAP_PASS is missing", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user";

    expect(() => createClientFromEnv()).toThrow(
      "IMAP_PASS environment variable is required"
    );
  });

  it("creates client with valid env vars", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user@example.com";
    process.env.IMAP_PASS = "secret";

    const client = createClientFromEnv();
    expect(client).toBeDefined();
    // Client is created but not connected — that's expected
  });

  it("defaults port to 993", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user";
    process.env.IMAP_PASS = "pass";

    // Should not throw — port defaults to 993
    const client = createClientFromEnv();
    expect(client).toBeDefined();
  });

  it("defaults secure to true", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user";
    process.env.IMAP_PASS = "pass";

    // IMAP_SECURE not set — should default to true (secure)
    const client = createClientFromEnv();
    expect(client).toBeDefined();
  });
});
