import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ImapClient } from "./imap/index.js";
import { tools, handleToolCall } from "./tools/index.js";

/**
 * Create and configure the MCP server.
 *
 * Exposes 7 read-only tools:
 *   - list_emails_7days
 *   - list_emails_month
 *   - list_emails_quarter
 *   - list_emails_year
 *   - list_emails_all
 *   - fetch_email_content
 *   - fetch_email_attachment
 */
export function createServer(imapClient: ImapClient): Server {
  const server = new Server(
    {
      name: "imap-mcp",
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
