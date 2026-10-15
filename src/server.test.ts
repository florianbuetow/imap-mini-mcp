import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ImapClient } from "./imap/index.js";
import { createServer } from "./server.js";

vi.mock("./tools/index.js", async () => {
  const actual = await vi.importActual<typeof import("./tools/index.js")>(
    "./tools/index.js"
  );
  return { ...actual, handleToolCall: vi.fn() };
});

import { tools, handleToolCall } from "./tools/index.js";

const mockHandleToolCall = vi.mocked(handleToolCall);
const imapClient = {} as ImapClient;

type TextContent = Array<{ type: string; text: string }>;

describe("createServer", () => {
  let server: ReturnType<typeof createServer>;
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createServer(imapClient);
    client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("identifies itself as imap-mini-mcp and advertises the tools capability", () => {
    expect(client.getServerVersion()).toMatchObject({
      name: "imap-mini-mcp",
      version: "0.1.0",
    });
    expect(client.getServerCapabilities()?.tools).toBeDefined();
  });

  it("lists every registered tool", async () => {
    const result = await client.listTools();

    expect(result.tools.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it("dispatches a tool call with its arguments to handleToolCall", async () => {
    mockHandleToolCall.mockResolvedValue({
      content: [{ type: "text", text: "folders listed" }],
    });

    const result = await client.callTool({
      name: "list_folders",
      arguments: { verbose: true },
    });

    expect(mockHandleToolCall).toHaveBeenCalledWith(imapClient, "list_folders", {
      verbose: true,
    });
    expect((result.content as TextContent)[0].text).toBe("folders listed");
    expect(result.isError).toBeFalsy();
  });

  it("passes an empty object when the call has no arguments", async () => {
    mockHandleToolCall.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    await client.callTool({ name: "list_folders" });

    expect(mockHandleToolCall).toHaveBeenCalledWith(imapClient, "list_folders", {});
  });

  it("returns a handler-reported error result unchanged", async () => {
    mockHandleToolCall.mockResolvedValue({
      content: [{ type: "text", text: "Error: id is required." }],
      isError: true,
    });

    const result = await client.callTool({ name: "star_email", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toBe("Error: id is required.");
  });

  it("converts a thrown Error into an error result naming the tool", async () => {
    mockHandleToolCall.mockRejectedValue(new Error("connection lost"));

    const result = await client.callTool({ name: "list_folders", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toBe(
      "Error executing list_folders: connection lost"
    );
  });

  it("converts a thrown non-Error value into an error result", async () => {
    mockHandleToolCall.mockRejectedValue("plain string failure");

    const result = await client.callTool({ name: "list_folders", arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toBe(
      "Error executing list_folders: plain string failure"
    );
  });
});
