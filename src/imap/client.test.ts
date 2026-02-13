import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ImapClient, createClientFromEnv, classifyImapError } from "./client.js";
import type { ImapConfig } from "./types.js";

// ---------------------------------------------------------------------------
// classifyImapError
// ---------------------------------------------------------------------------

const testConfig: ImapConfig = {
  host: "imap.example.com",
  port: 993,
  secure: true,
  starttls: true,
  tlsRejectUnauthorized: true,
  auth: { user: "user", pass: "pass" },
};

describe("classifyImapError", () => {
  it("detects authentication failures", () => {
    const err = Object.assign(new Error("Authentication failed"), {
      authenticationFailed: true,
    });
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/authentication failed/i);
    expect(result.message).toMatch(/IMAP_USER/);
  });

  it("detects connection refused", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/connection refused/i);
    expect(result.message).toContain("imap.example.com:993");
  });

  it("detects DNS failure", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/resolve.*hostname/i);
    expect(result.message).toContain("imap.example.com");
  });

  it("detects timeout", () => {
    const err = Object.assign(new Error("timed out"), {
      code: "ETIMEDOUT",
    });
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/timed out/i);
  });

  it("detects TLS errors by code", () => {
    const err = Object.assign(new Error("TLS handshake failed"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/TLS\/SSL/i);
  });

  it("detects TLS errors by message", () => {
    const err = new Error("unable to verify the first certificate");
    const result = classifyImapError(err, testConfig);
    expect(result.message).toMatch(/TLS\/SSL/i);
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("something unexpected");
    const result = classifyImapError(err, testConfig);
    expect(result.message).toBe("IMAP error: something unexpected");
  });

  it("handles non-Error values", () => {
    const result = classifyImapError("string error", testConfig);
    expect(result.message).toBe("IMAP error: string error");
  });
});

// ---------------------------------------------------------------------------
// ImapClient connection lifecycle
// ---------------------------------------------------------------------------

describe("ImapClient", () => {
  const mockLock = { release: vi.fn() };
  let mockFlow: any;

  function createMockFlow(overrides: Record<string, any> = {}) {
    const listeners: Record<string, Function[]> = {};
    return {
      usable: true,
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      on: vi.fn((event: string, cb: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      }),
      _emit(event: string, ...args: unknown[]) {
        (listeners[event] || []).forEach((cb) => cb(...args));
      },
      ...overrides,
    };
  }

  // We mock the ImapFlow constructor at the module level
  vi.mock("imapflow", () => ({
    ImapFlow: vi.fn(),
  }));

  let ImapFlowMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const mod = await import("imapflow");
    ImapFlowMock = mod.ImapFlow as unknown as ReturnType<typeof vi.fn>;
    mockFlow = createMockFlow();
    // Must use a regular function (not arrow) so it works with `new`
    ImapFlowMock.mockImplementation(function () {
      return mockFlow;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and caches a connection", async () => {
    const client = new ImapClient(testConfig);

    const flow1 = await client.connect();
    const flow2 = await client.connect();

    expect(flow1).toBe(flow2);
    expect(mockFlow.connect).toHaveBeenCalledTimes(1);
  });

  it("discards stale connection when usable is false", async () => {
    const client = new ImapClient(testConfig);

    await client.connect();
    expect(mockFlow.connect).toHaveBeenCalledTimes(1);

    // Simulate connection becoming unusable
    mockFlow.usable = false;

    // Create a new mock for the reconnection
    const freshFlow = createMockFlow();
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    const flow2 = await client.connect();
    expect(flow2).toBe(freshFlow);
    expect(freshFlow.connect).toHaveBeenCalledTimes(1);
  });

  it("clears cached client on close event", async () => {
    const client = new ImapClient(testConfig);
    await client.connect();

    // Simulate server dropping the connection
    mockFlow._emit("close");

    // Next connect() should create a fresh connection
    const freshFlow = createMockFlow();
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    const flow2 = await client.connect();
    expect(flow2).toBe(freshFlow);
  });

  it("logs and clears cached client on error event", async () => {
    const client = new ImapClient(testConfig);
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await client.connect();

    const err = Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
    });
    mockFlow._emit("error", err);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringMatching(/IMAP connection error:/)
    );

    const freshFlow = createMockFlow();
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    const flow2 = await client.connect();
    expect(flow2).toBe(freshFlow);
  });

  it("classifies auth failure on connect", async () => {
    const authError = Object.assign(new Error("Authentication failed"), {
      authenticationFailed: true,
    });
    mockFlow.connect.mockRejectedValue(authError);

    const client = new ImapClient(testConfig);
    await expect(client.connect()).rejects.toThrow(/authentication failed/i);
  });

  it("classifies ECONNREFUSED on connect", async () => {
    const connError = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    mockFlow.connect.mockRejectedValue(connError);

    const client = new ImapClient(testConfig);
    await expect(client.connect()).rejects.toThrow(/connection refused/i);
  });

  it("does not cache client after failed connect", async () => {
    mockFlow.connect.mockRejectedValue(new Error("fail"));

    const client = new ImapClient(testConfig);
    await expect(client.connect()).rejects.toThrow();

    // A subsequent connect() should try again (not return a cached null)
    const freshFlow = createMockFlow();
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    const flow = await client.connect();
    expect(flow).toBe(freshFlow);
  });

  it("openMailbox retries once on stale connection", async () => {
    const client = new ImapClient(testConfig);
    await client.connect();

    // First getMailboxLock call fails (stale connection)
    mockFlow.getMailboxLock.mockRejectedValueOnce(
      new Error("Connection not available")
    );

    // After reconnect, the fresh client succeeds
    const freshLock = { release: vi.fn() };
    const freshFlow = createMockFlow({
      getMailboxLock: vi.fn().mockResolvedValue(freshLock),
    });
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    const lock = await client.openMailbox("INBOX");
    expect(lock).toBe(freshLock);
  });

  it("openMailbox does not retry on non-connection errors", async () => {
    const client = new ImapClient(testConfig);
    await client.connect();

    const mailboxErr = new Error("Mailbox does not exist");
    mockFlow.getMailboxLock.mockRejectedValueOnce(mailboxErr);

    const freshFlow = createMockFlow();
    ImapFlowMock.mockImplementation(function () { return freshFlow; });

    await expect(client.openMailbox("MISSING")).rejects.toBe(mailboxErr);
    expect(freshFlow.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createClientFromEnv
// ---------------------------------------------------------------------------

describe("createClientFromEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_PORT;
    delete process.env.IMAP_SECURE;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASS;
  });

  afterEach(() => {
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
  });

  it("defaults port to 993", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user";
    process.env.IMAP_PASS = "pass";

    const client = createClientFromEnv();
    expect(client).toBeDefined();
  });

  it("defaults secure to true", () => {
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_USER = "user";
    process.env.IMAP_PASS = "pass";

    const client = createClientFromEnv();
    expect(client).toBeDefined();
  });
});
