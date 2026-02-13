/**
 * Integration test: spawns the MCP server as a child process and
 * sends real JSON-RPC requests over stdio to exercise all list_* tools.
 */
import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  env: {
    ...process.env,
  } as Record<string, string>,
});

const client = new Client({ name: "integration-test", version: "0.0.1" });
await client.connect(transport);

async function callTool(name: string, args: Record<string, unknown> = {}) {
  console.log(`\n--- ${name} ---`);
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text;
  const parsed = JSON.parse(text);
  // Print summary, not full emails
  if (parsed.count !== undefined) {
    console.log(`  count: ${parsed.count}`);
    if (parsed.emails?.length > 0) {
      console.log(`  first: ${parsed.emails[0].subject}`);
    }
  } else if (parsed.totalCount !== undefined) {
    console.log(`  totalCount: ${parsed.totalCount}`);
    for (const f of parsed.folders) {
      console.log(`  ${f.folder}: ${f.count} emails`);
    }
  } else if (parsed.folders) {
    console.log(`  folders: ${parsed.count}`);
    for (const f of parsed.folders.slice(0, 5)) {
      console.log(`    ${f.path}`);
    }
    if (parsed.count > 5) console.log(`    ... and ${parsed.count - 5} more`);
  } else {
    console.log(JSON.stringify(parsed, null, 2));
  }
}

try {
  const result = await client.callTool({ name: "list_emails_24h", arguments: {} });
  const data = JSON.parse((result.content as any)[0].text);
  console.error(`Fetching content for ${data.count} emails...\n`);

  for (const e of data.emails) {
    const content = await client.callTool({ name: "fetch_email_content", arguments: { id: e.id } });
    const body = JSON.parse((content.content as any)[0].text);
    if (e.subject.includes("Backend Software Engineer Amsterdam") && e.subject.includes("Message replied")) {
      console.log(`Subject: ${body.subject}`);
      console.log(`From: ${body.from}`);
      console.log(`To: ${body.to}`);
      console.log(`Date: ${body.date}`);
      console.log(`\nFull body:\n${body.body}`);
    }
  }
} catch (err) {
  console.error("\n!!! FAILED !!!", err);
  process.exit(1);
} finally {
  await client.close();
}
