export function decodeMcpPayload(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);

  const payloads = [];
  let data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    } else if (line === "" && data.length) {
      payloads.push(JSON.parse(data.join("\n")));
      data = [];
    }
  }
  if (data.length) payloads.push(JSON.parse(data.join("\n")));
  if (!payloads.length)
    throw new Error("MCP response was neither JSON nor a JSON SSE event");
  return payloads.at(-1);
}

export class McpClient {
  constructor({ endpoint, apiKey, fetchImpl = fetch }) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:")
      throw new Error("Minds MCP endpoint must use HTTPS");
    if (!apiKey) throw new Error("A Minds API key is required");
    this.endpoint = url.toString();
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.sessionId = null;
    this.nextId = 1;
  }

  async request(method, params, notification = false) {
    const id = notification ? undefined : this.nextId++;
    const body = { jsonrpc: "2.0", method };
    if (!notification) body.id = id;
    if (params !== undefined) body.params = params;

    const headers = {
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const response = await this.fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `MCP request failed with HTTP ${response.status}: ${raw.slice(0, 500)}`,
      );
    }
    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession) this.sessionId = returnedSession;
    if (notification && !raw.trim()) return null;

    const payload = decodeMcpPayload(raw);
    if (payload?.error) {
      throw new Error(
        `MCP ${method} failed: ${payload.error.message || JSON.stringify(payload.error)}`,
      );
    }
    return payload?.result;
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "minds-research-action", version: "1.0.0" },
    });
    if (!this.sessionId)
      throw new Error("MCP initialize response did not include Mcp-Session-Id");
    await this.request("notifications/initialized", undefined, true);
    return result;
  }

  async callTool(name, args) {
    const result = await this.request("tools/call", { name, arguments: args });
    if (result?.isError) {
      const text = result.content
        ?.map((item) => item.text)
        .filter(Boolean)
        .join("\n");
      throw new Error(text || `${name} returned an MCP tool error`);
    }
    return result;
  }
}

export function findValue(root, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (
        wanted.has(key.toLowerCase()) &&
        ["string", "number"].includes(typeof child)
      ) {
        return String(child);
      }
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return "";
}

export function extractMarkdown(root) {
  return findValue(root, ["markdown", "summaryMarkdown", "summary_markdown"]);
}
