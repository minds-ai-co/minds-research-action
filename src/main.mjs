import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { McpClient, extractMarkdown, findValue } from "./mcp-client.mjs";

const input = (name) =>
  (process.env[`INPUT_${name.toUpperCase()}`] || "").trim();
const required = (name) => {
  const value = input(name);
  if (!value)
    throw new Error(
      `Input ${name.toLowerCase()} is required for this operation`,
    );
  return value;
};
const booleanInput = (name) =>
  ["true", "1", "yes"].includes(input(name).toLowerCase());

function mask(value) {
  if (value) process.stdout.write(`::add-mask::${value}\n`);
}

async function setOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const delimiter = `minds_${randomUUID()}`;
  await appendFile(
    outputPath,
    `${name}<<${delimiter}\n${value}\n${delimiter}\n`,
    "utf8",
  );
}

async function loadStimulus() {
  const inline = input("STIMULUS");
  const fileInput = input("STIMULUS-FILE");
  if (inline && fileInput)
    throw new Error("Use stimulus or stimulus-file, not both");
  if (inline) {
    if (inline.length > 20_000)
      throw new Error("stimulus exceeds the 20,000 character limit");
    return {
      content: inline,
      label: input("STIMULUS-LABEL") || "Workflow stimulus",
    };
  }
  if (!fileInput) return null;

  const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const resolved = path.resolve(workspace, fileInput);
  if (
    resolved !== workspace &&
    !resolved.startsWith(`${workspace}${path.sep}`)
  ) {
    throw new Error("stimulus-file must stay inside GITHUB_WORKSPACE");
  }
  const fileStat = await stat(resolved);
  if (!fileStat.isFile())
    throw new Error("stimulus-file must point to a regular file");
  if (fileStat.size > 20_000)
    throw new Error("stimulus-file exceeds the 20,000 byte limit");
  return {
    content: await readFile(resolved, "utf8"),
    label: input("STIMULUS-LABEL") || path.basename(resolved),
  };
}

function panelSelector() {
  const panelId = input("PANEL-ID");
  const panelName = input("PANEL-NAME");
  if (panelId && panelName)
    throw new Error("Use panel-id or panel-name, not both");
  if (!panelId && !panelName)
    throw new Error("panel-id or panel-name is required for this operation");
  return panelId ? { panelId } : { panelName };
}

function groupSelector() {
  const groupId = input("GROUP-ID");
  const groupName = input("GROUP-NAME");
  if (groupId && groupName)
    throw new Error("Use group-id or group-name, not both");
  if (!groupId && !groupName)
    throw new Error("group-id or group-name is required for ask-group");
  return groupId ? { groupId } : { groupName };
}

async function buildCall(operation) {
  switch (operation) {
    case "list-groups": {
      const searchQuery = input("SEARCH-QUERY");
      return { tool: "list_groups", args: searchQuery ? { searchQuery } : {} };
    }
    case "plan-study": {
      const args = { ...panelSelector(), request: required("REQUEST") };
      const locale = input("STUDY-LOCALE");
      if (locale) args.studyLocale = locale;
      const stimulus = await loadStimulus();
      if (stimulus) {
        args.source = {
          kind: "prompt",
          label: stimulus.label,
          content: stimulus.content,
        };
      }
      return { tool: "plan_panel_study", args };
    }
    case "ask-group":
      return {
        tool: "ask_group",
        args: { ...groupSelector(), question: required("QUESTION") },
      };
    case "get-panel-status":
      return { tool: "get_panel_status", args: panelSelector() };
    case "get-panel-summary": {
      const length = input("SUMMARY-LENGTH") || "standard";
      if (!["short", "standard", "detailed"].includes(length)) {
        throw new Error("summary-length must be short, standard, or detailed");
      }
      return {
        tool: "get_panel_summary",
        args: {
          ...panelSelector(),
          refresh: booleanInput("REFRESH-SUMMARY"),
          length,
        },
      };
    }
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
}

function resultForOutput(result) {
  const serialized = JSON.stringify(result);
  if (serialized.length > 500_000)
    throw new Error("MCP result is too large for a GitHub Actions output");
  return serialized;
}

async function writeSummary(operation, tool, result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const markdown = extractMarkdown(result);
  const panelId = findValue(result, ["panelId", "panel_id"]);
  const workspaceUrl = findValue(result, [
    "workspaceUrl",
    "workspace_url",
    "panelUrl",
    "panel_url",
  ]);
  let body = `# Minds research review\n\n- Operation: \`${operation}\`\n- MCP tool: \`${tool}\`\n`;
  if (panelId) body += `- Panel ID: \`${panelId}\`\n`;
  if (workspaceUrl && /^https:\/\//.test(workspaceUrl))
    body += `- [Open the result in Minds](${workspaceUrl})\n`;
  body += "\n";
  if (markdown) {
    body += `${markdown}\n`;
  } else {
    const preview = JSON.stringify(result, null, 2).slice(0, 50_000);
    body += `<details><summary>MCP result</summary>\n\n\`\`\`json\n${preview}\n\`\`\`\n\n</details>\n`;
  }
  body += "\n[Minds MCP setup](https://getminds.ai/mcp/setup)\n";
  await appendFile(summaryPath, body, "utf8");
}

try {
  const apiKey = required("API-KEY");
  mask(apiKey);
  const operation = input("OPERATION") || "plan-study";
  const endpoint = input("ENDPOINT") || "https://getminds.ai/mcp";
  const { tool, args } = await buildCall(operation);
  const client = new McpClient({ endpoint, apiKey });
  await client.initialize();
  const result = await client.callTool(tool, args);

  const values = {
    "result-json": resultForOutput(result),
    "panel-id": findValue(result, ["panelId", "panel_id"]),
    "draft-plan-id": findValue(result, ["draftPlanId", "draft_plan_id"]),
    revision: findValue(result, ["revision"]),
    "workspace-url": findValue(result, [
      "workspaceUrl",
      "workspace_url",
      "panelUrl",
      "panel_url",
    ]),
  };
  await Promise.all(
    Object.entries(values).map(([name, value]) => setOutput(name, value)),
  );
  await writeSummary(operation, tool, result);
  console.log(`Minds operation ${operation} completed with ${tool}.`);
} catch (error) {
  process.stderr.write(
    `::error::${String(error.message || error).replace(/\r?\n/g, "%0A")}\n`,
  );
  process.exitCode = 1;
}
