import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromEnv: vi.fn(),
  createServer: vi.fn(),
  safeStderrWrite: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class StdioServerTransport {},
}));
vi.mock("./imap/index.js", () => ({
  createClientFromEnv: mocks.createClientFromEnv,
}));
vi.mock("./server.js", () => ({ createServer: mocks.createServer }));
vi.mock("./stderr.js", () => ({ safeStderrWrite: mocks.safeStderrWrite }));

type Handler = (...args: unknown[]) => void;

let processHandlers: Record<string, Handler[]>;
let stdinHandlers: Record<string, Handler[]>;
let exitSpy: ReturnType<typeof vi.spyOn>;
let disconnect: ReturnType<typeof vi.fn>;
let connect: ReturnType<typeof vi.fn>;

function recordHandlers(store: Record<string, Handler[]>) {
  return (event: string, handler: Handler) => {
    (store[event] ||= []).push(handler);
  };
}

/** Import src/index.ts fresh; main() runs on import. */
async function loadEntrypoint() {
  vi.resetModules();
  await import("./index.js");
}

async function loadAndWaitForStartup() {
  await loadEntrypoint();
  await vi.waitFor(() => expect(connect).toHaveBeenCalled());
}

function logged(): string {
  return mocks.safeStderrWrite.mock.calls.map((c) => String(c[0])).join("\n");
}

function fire(store: Record<string, Handler[]>, event: string, ...args: unknown[]) {
  const handlers = store[event];
  expect(handlers, `no handler registered for ${event}`).toBeDefined();
  handlers.forEach((h) => h(...args));
}

describe("entrypoint (src/index.ts)", () => {
  beforeEach(() => {
    processHandlers = {};
    stdinHandlers = {};
    disconnect = vi.fn().mockResolvedValue(undefined);
    connect = vi.fn().mockResolvedValue(undefined);

    mocks.createClientFromEnv.mockReset().mockReturnValue({ disconnect });
    mocks.createServer.mockReset().mockReturnValue({ connect });
    mocks.safeStderrWrite.mockReset();

    // Capture handlers instead of registering them, so a fired "signal" cannot
    // reach the real test process.
    vi.spyOn(process, "on").mockImplementation(
      recordHandlers(processHandlers) as unknown as typeof process.on
    );
    vi.spyOn(process.stdin, "on").mockImplementation(
      recordHandlers(stdinHandlers) as unknown as typeof process.stdin.on
    );
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("startup", () => {
    it("creates the IMAP client from the environment and connects the server over stdio", async () => {
      await loadAndWaitForStartup();

      expect(mocks.createClientFromEnv).toHaveBeenCalledTimes(1);
      expect(mocks.createServer).toHaveBeenCalledWith({ disconnect });
      expect(connect).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("registers shutdown handlers for client disconnect and termination signals", async () => {
      await loadAndWaitForStartup();

      expect(Object.keys(stdinHandlers).sort()).toEqual(["close", "end"]);
      expect(Object.keys(processHandlers).sort()).toEqual(
        ["SIGHUP", "SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"].sort()
      );
    });

    it("logs a fatal error and exits 1 when the IMAP environment is invalid", async () => {
      mocks.createClientFromEnv.mockImplementation(() => {
        throw new Error("IMAP_HOST environment variable is required");
      });

      await loadEntrypoint();
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

      expect(logged()).toContain("FATAL ERROR");
      expect(logged()).toContain("IMAP_HOST environment variable is required");
      expect(connect).not.toHaveBeenCalled();
    });

    it("logs a fatal error and exits 1 when the server cannot connect", async () => {
      connect.mockRejectedValue(new Error("transport failed"));

      await loadEntrypoint();
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));

      expect(logged()).toContain("FATAL ERROR");
      expect(logged()).toContain("transport failed");
    });
  });

  describe("graceful shutdown", () => {
    it.each([
      ["stdin end", () => fire(stdinHandlers, "end")],
      ["stdin close", () => fire(stdinHandlers, "close")],
      ["SIGHUP", () => fire(processHandlers, "SIGHUP")],
      ["SIGINT", () => fire(processHandlers, "SIGINT")],
      ["SIGTERM", () => fire(processHandlers, "SIGTERM")],
    ])("disconnects from IMAP and exits 0 on %s", async (_name, trigger) => {
      await loadAndWaitForStartup();

      trigger();

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(logged()).toBe("");
    });

    it("shuts down only once when several triggers fire together", async () => {
      await loadAndWaitForStartup();

      fire(stdinHandlers, "end");
      fire(stdinHandlers, "close");
      fire(processHandlers, "SIGTERM");

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("logs a shutdown error and exits 1 when the IMAP logout fails", async () => {
      disconnect.mockRejectedValue(new Error("logout failed"));
      await loadAndWaitForStartup();

      fire(processHandlers, "SIGTERM");

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(logged()).toContain("SHUTDOWN ERROR");
      expect(logged()).toContain("logout failed");
    });
  });

  describe("fatal process errors", () => {
    it("logs an uncaught exception, disconnects and exits 1", async () => {
      await loadAndWaitForStartup();

      fire(processHandlers, "uncaughtException", new Error("boom"));

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(logged()).toContain("[imap-mini-mcp] UNCAUGHT EXCEPTION");
      expect(logged()).toContain("Message: boom");
      expect(logged()).toContain("Name:    Error");
    });

    it("logs an unhandled rejection with a non-Error reason and exits 1", async () => {
      await loadAndWaitForStartup();

      fire(processHandlers, "unhandledRejection", "nope");

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(logged()).toContain("[imap-mini-mcp] UNHANDLED REJECTION");
      expect(logged()).toContain('Value: "nope"');
    });

    it("includes the error code and cause in the log", async () => {
      await loadAndWaitForStartup();

      fire(
        processHandlers,
        "uncaughtException",
        Object.assign(new Error("write failed"), { code: "EPIPE", cause: { reason: "pipe" } })
      );

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(logged()).toContain("Code:    EPIPE");
      expect(logged()).toContain('Cause:   {"reason":"pipe"}');
    });

    it("logs the process context (pid, node version, IMAP env) without the password", async () => {
      vi.stubEnv("IMAP_HOST", "imap.example.com");
      vi.stubEnv("IMAP_PASS", "super-secret-password");
      await loadAndWaitForStartup();

      fire(processHandlers, "uncaughtException", new Error("boom"));

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(logged()).toContain(`PID:   ${process.pid}`);
      expect(logged()).toContain(`Node:  ${process.version}`);
      expect(logged()).toContain("IMAP_HOST=imap.example.com");
      expect(logged()).not.toContain("super-secret-password");
      vi.unstubAllEnvs();
    });

    it("exits only once when a fatal error fires during an in-progress shutdown", async () => {
      await loadAndWaitForStartup();

      fire(processHandlers, "SIGTERM");
      fire(processHandlers, "uncaughtException", new Error("late"));

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));

      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
