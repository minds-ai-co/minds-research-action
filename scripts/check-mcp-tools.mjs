// Fails when the action calls an MCP tool the live Minds server does not
// advertise. Source of truth: the code-generated server card, plus the public
// MCP metadata endpoint (aliases, hidden tools) when it is available.
import { buildCall } from "../src/main.mjs";

const CARD_URL = "https://getminds.ai/.well-known/mcp/server-card.json";
const PUBLIC_URL = "https://getminds.ai/api/public/mcp";

const card = await (await fetch(CARD_URL)).json();
const advertised = new Set((card.tools || []).map((tool) => tool.name));
if (!advertised.size) throw new Error(`No tools in ${CARD_URL}`);

const callableOnly = new Set();
try {
  const response = await fetch(PUBLIC_URL);
  if (response.ok) {
    const meta = await response.json();
    for (const name of Object.keys(meta.aliases || meta.toolAliases || {}))
      callableOnly.add(name);
    for (const entry of meta.hiddenTools || [])
      callableOnly.add(typeof entry === "string" ? entry : entry?.name);
  }
} catch {
  // Optional endpoint; the server card alone is authoritative.
}

const inputs = {
  "STUDY-ID": "00000000-0000-0000-0000-000000000000",
  "AUDIENCE-ID": "00000000-0000-0000-0000-000000000000",
  REQUEST: "check",
  QUESTION: "check",
};
for (const [key, value] of Object.entries(inputs))
  process.env[`INPUT_${key}`] = value;

const operations = [
  "list-audiences",
  "plan-study",
  "ask-audience",
  "get-study-status",
  "get-study-summary",
];
const failures = [];
for (const operation of operations) {
  const { tool } = await buildCall(operation);
  if (advertised.has(tool)) {
    console.log(`ok   ${operation} -> ${tool}`);
  } else if (callableOnly.has(tool)) {
    console.log(`warn ${operation} -> ${tool} (alias/hidden, not advertised)`);
  } else {
    failures.push(`${operation} -> ${tool}`);
  }
}
if (failures.length) {
  console.error(`Not on the live MCP surface:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
