import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

// Legacy inputs (panel-*, group-*) and operation names stay accepted so pinned
// v1 workflows keep working; they map onto the canonical Study/Audience fields.
const LEGACY_OPERATIONS = {
  "list-groups": "list-audiences",
  "ask-group": "ask-audience",
  "get-panel-status": "get-study-status",
  "get-panel-summary": "get-study-summary",
};

function pickTarget(idInputs, nameInputs) {
  const id = idInputs.map(input).find(Boolean) || "";
  const name = nameInputs.map(input).find(Boolean) || "";
  const [idName, nameName] = [idInputs[0], nameInputs[0]].map((value) =>
    value.toLowerCase(),
  );
  if (id && name) throw new Error(`Use ${idName} or ${nameName}, not both`);
  if (!id && !name)
    throw new Error(`${idName} or ${nameName} is required for this operation`);
  return id ? { id } : { name };
}

function studyTarget() {
  return pickTarget(["STUDY-ID", "PANEL-ID"], ["STUDY-NAME", "PANEL-NAME"]);
}

function audienceTarget() {
  return pickTarget(
    ["AUDIENCE-ID", "GROUP-ID"],
    ["AUDIENCE-NAME", "GROUP-NAME"],
  );
}

export function canonicalOperation(operation) {
  return LEGACY_OPERATIONS[operation] || operation;
}

export async function buildCall(requestedOperation) {
  const operation = canonicalOperation(requestedOperation);
  switch (operation) {
    case "list-audiences": {
      const searchQuery = input("SEARCH-QUERY");
      return {
        tool: "list_audiences",
        args: searchQuery ? { searchQuery } : {},
      };
    }
    case "plan-study": {
      const args = { study: studyTarget(), request: required("REQUEST") };
      const locale = input("STUDY-LOCALE");
      if (locale) args.policy = { studyLocale: locale };
      const stimulus = await loadStimulus();
      if (stimulus) {
        args.stimulus = {
          source: {
            kind: "prompt",
            label: stimulus.label,
            content: stimulus.content,
          },
        };
      }
      return { tool: "plan_study_questions", args };
    }
    case "ask-audience":
      return {
        tool: "ask_audience",
        args: { audience: audienceTarget(), question: required("QUESTION") },
      };
    case "get-study-status":
      return { tool: "get_study_status", args: { study: studyTarget() } };
    case "get-study-summary": {
      const length = input("SUMMARY-LENGTH") || "standard";
      if (!["short", "standard", "detailed"].includes(length)) {
        throw new Error("summary-length must be short, standard, or detailed");
      }
      return {
        tool: "get_study_summary",
        args: {
          study: studyTarget(),
          refresh: booleanInput("REFRESH-SUMMARY"),
          length,
        },
      };
    }
    default:
      throw new Error(`Unsupported operation: ${requestedOperation}`);
  }
}

const STUDY_ID_KEYS = ["studyId", "study_id", "panelId", "panel_id"];
const WORKSPACE_URL_KEYS = [
  "workspaceUrl",
  "workspace_url",
  "studyUrl",
  "study_url",
  "panelUrl",
  "panel_url",
];

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
  const studyId = findValue(result, STUDY_ID_KEYS);
  const workspaceUrl = findValue(result, WORKSPACE_URL_KEYS);
  let body = `# Minds research review\n\n- Operation: \`${operation}\`\n- MCP tool: \`${tool}\`\n`;
  if (studyId) body += `- Study ID: \`${studyId}\`\n`;
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

async function run() {
  const apiKey = required("API-KEY");
  mask(apiKey);
  const operation = canonicalOperation(input("OPERATION") || "plan-study");
  const endpoint = input("ENDPOINT") || "https://getminds.ai/mcp";
  const { tool, args } = await buildCall(operation);
  const client = new McpClient({ endpoint, apiKey });
  await client.initialize();
  const result = await client.callTool(tool, args);

  const studyId = findValue(result, STUDY_ID_KEYS);
  const values = {
    "result-json": resultForOutput(result),
    "study-id": studyId,
    // Deprecated alias of study-id, kept for v1 workflows.
    "panel-id": studyId,
    "draft-plan-id": findValue(result, ["draftPlanId", "draft_plan_id"]),
    revision: findValue(result, ["revision"]),
    "workspace-url": findValue(result, WORKSPACE_URL_KEYS),
  };
  await Promise.all(
    Object.entries(values).map(([name, value]) => setOutput(name, value)),
  );
  await writeSummary(operation, tool, result);
  console.log(`Minds operation ${operation} completed with ${tool}.`);
}

// Run only as the action entry point, so tests can import buildCall.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run();
  } catch (error) {
    process.stderr.write(
      `::error::${String(error.message || error).replace(/\r?\n/g, "%0A")}\n`,
    );
    process.exitCode = 1;
  }
}
