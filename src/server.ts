import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ImapClient } from "./imap/index.js";
import type { ImapAccounts } from "./accounts.js";
import { tools, handleToolCall } from "./tools/index.js";

type Tool = (typeof tools)[number];

function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

/**
 * Multi-account mode: add the required "account" parameter to a tool.
 */
function withAccountParam(tool: Tool, accountNames: string[]): Tool {
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        account: {
          type: "string",
          enum: accountNames,
          description:
            "Required in every call: the mail account to use. Email ids are unique " +
            "only within one account, so keep each id together with its account " +
            "and pass that account in follow-up calls.",
        },
        ...tool.inputSchema.properties,
      },
      required: ["account", ...(tool.inputSchema.required ?? [])],
    },
  };
}

async function dispatch(
  imapClient: ImapClient,
  name: string,
  args: Record<string, unknown>,
  label: string
) {
  try {
    return await handleToolCall(imapClient, name, args);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    return errorResult(`Error executing ${label}: ${message}`);
  }
}

/**
 * Create and configure the MCP server.
 *
 * Pass one ImapClient for a single account, or several accounts by name (see
 * loadAccounts). With several accounts, every tool takes a required "account"
 * parameter that selects the mailbox.
 */
export function createServer(imap: ImapClient | ImapAccounts): Server {
  const accounts = imap instanceof Map ? imap : null;
  const accountNames = accounts ? [...accounts.keys()] : [];

  const server = new Server(
    {
      name: "imap-mini-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!accounts) {
      return { tools: [...tools] };
    }
    return {
      tools: tools.map((tool) => withAccountParam(tool, accountNames)),
    };
  });

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const { account, ...rest }: Record<string, unknown> = args ?? {};

    if (!accounts) {
      // A client with a stale multi-account schema must not silently act on
      // this server's only mailbox.
      if (account !== undefined) {
        return errorResult(
          'Error: this server has a single account; call the tool without "account".'
        );
      }
      return dispatch(imap as ImapClient, name, args || {}, name);
    }

    const imapClient =
      typeof account === "string" ? accounts.get(account) : undefined;
    if (!imapClient) {
      return errorResult(
        `Error: "account" must be one of: ${accountNames.join(", ")}`
      );
    }
    return dispatch(imapClient, name, rest, `${name} (account "${account}")`);
  });

  return server;
}
