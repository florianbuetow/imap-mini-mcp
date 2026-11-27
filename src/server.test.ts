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

describe("createServer with several accounts", () => {
  const work = { user: "me@work.test" } as ImapClient;
  const home = { user: "me@home.test" } as ImapClient;
  let server: ReturnType<typeof createServer>;
  let client: Client;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createServer(
      new Map([
        ["work", work],
        ["home", home],
      ])
    );
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

  it("adds a required account parameter to every tool", async () => {
    const result = await client.listTools();

    expect(result.tools.map((t) => t.name)).toEqual(tools.map((t) => t.name));
    for (const tool of result.tools) {
      expect(tool.inputSchema.properties?.account).toMatchObject({
        type: "string",
        enum: ["work", "home"],
      });
      expect(tool.inputSchema.required?.[0]).toBe("account");
    }
  });

  it("keeps each tool's own parameters and required fields", async () => {
    const result = await client.listTools();

    for (const original of tools) {
      const listed = result.tools.find((t) => t.name === original.name)!;
      expect(Object.keys(listed.inputSchema.properties ?? {})).toEqual([
        "account",
        ...Object.keys(original.inputSchema.properties ?? {}),
      ]);
      expect(listed.inputSchema.required).toEqual([
        "account",
        ...(original.inputSchema.required ?? []),
      ]);
    }
  });

  it("dispatches to the chosen account without the account argument", async () => {
    mockHandleToolCall.mockResolvedValue({
      content: [{ type: "text", text: "folders listed" }],
    });

    const result = await client.callTool({
      name: "list_folders",
      arguments: { account: "home", verbose: true },
    });

    expect(mockHandleToolCall).toHaveBeenCalledWith(home, "list_folders", {
      verbose: true,
    });
    expect((result.content as TextContent)[0].text).toBe("folders listed");
  });

  it.each([
    ["no", {}],
    ["an unknown", { account: "other" }],
    ["a non-string", { account: 1 }],
  ])("refuses a call with %s account", async (_case, args) => {
    const result = await client.callTool({ name: "list_folders", arguments: args });

    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toBe(
      'Error: "account" must be one of: work, home'
    );
    expect(mockHandleToolCall).not.toHaveBeenCalled();
  });

  it("names the account when a tool call throws", async () => {
    mockHandleToolCall.mockRejectedValue(new Error("IMAP authentication failed"));

    const result = await client.callTool({
      name: "list_folders",
      arguments: { account: "work" },
    });

    expect(result.isError).toBe(true);
    expect((result.content as TextContent)[0].text).toBe(
      'Error executing list_folders (account "work"): IMAP authentication failed'
    );
  });
});
