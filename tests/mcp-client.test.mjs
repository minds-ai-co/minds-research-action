import assert from "node:assert/strict";
import test from "node:test";
import { McpClient, decodeMcpPayload, findValue } from "../src/mcp-client.mjs";

test("decodes JSON and SSE MCP responses", () => {
  assert.deepEqual(decodeMcpPayload('{"jsonrpc":"2.0","id":1,"result":{}}'), {
    jsonrpc: "2.0",
    id: 1,
    result: {},
  });
  assert.equal(
    decodeMcpPayload(
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n',
    ).result.ok,
    true,
  );
});

test("initializes and calls an MCP tool with a bearer key", async () => {
  const requests = [];
  const responses = [
    new Response(
      '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}',
      {
        status: 200,
        headers: { "mcp-session-id": "session-1" },
      },
    ),
    new Response("", { status: 202 }),
    new Response(
      '{"jsonrpc":"2.0","id":2,"result":{"structuredContent":{"groups":[]}}}',
      {
        status: 200,
      },
    ),
  ];
  const client = new McpClient({
    endpoint: "https://getminds.ai/mcp",
    apiKey: "minds_test",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return responses.shift();
    },
  });
  await client.initialize();
  const result = await client.callTool("list_groups", {});
  assert.deepEqual(result.structuredContent.groups, []);
  assert.equal(requests[0].options.headers.Authorization, "Bearer minds_test");
  assert.equal(requests[2].options.headers["Mcp-Session-Id"], "session-1");
  assert.equal(JSON.parse(requests[2].options.body).params.name, "list_groups");
});

test("rejects non-HTTPS endpoints", () => {
  assert.throws(
    () =>
      new McpClient({
        endpoint: "http://example.test/mcp",
        apiKey: "minds_test",
      }),
    /HTTPS/,
  );
});

test("finds nested output values", () => {
  const result = {
    structuredContent: {
      panel: { panelId: "panel-1", workspaceUrl: "https://example.test" },
    },
  };
  assert.equal(findValue(result, ["panelId"]), "panel-1");
  assert.equal(findValue(result, ["workspaceUrl"]), "https://example.test");
});
