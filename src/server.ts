import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ImapClient } from "./imap/index.js";
import { tools, handleToolCall } from "./tools/index.js";

/**
 * Create and configure the MCP server.
 */
export function createServer(imapClient: ImapClient): Server {
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
    return { tools: [...tools] };
  });

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      return await handleToolCall(imapClient, name, args || {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error executing ${name}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
