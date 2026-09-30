import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCall, canonicalOperation } from "../src/main.mjs";

function withInputs(inputs, fn) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("INPUT_")) delete process.env[key];
  }
  for (const [key, value] of Object.entries(inputs)) {
    process.env[`INPUT_${key.toUpperCase()}`] = value;
  }
  return Promise.resolve(fn()).finally(() => {
    process.env = saved;
  });
}

test("maps deprecated operation names to canonical ones", () => {
  assert.equal(canonicalOperation("list-groups"), "list-audiences");
  assert.equal(canonicalOperation("ask-group"), "ask-audience");
  assert.equal(canonicalOperation("get-panel-status"), "get-study-status");
  assert.equal(canonicalOperation("get-panel-summary"), "get-study-summary");
  assert.equal(canonicalOperation("plan-study"), "plan-study");
});

test("list-audiences calls list_audiences", () =>
  withInputs({ "search-query": "founders" }, async () => {
    assert.deepEqual(await buildCall("list-audiences"), {
      tool: "list_audiences",
      args: { searchQuery: "founders" },
    });
    assert.equal((await buildCall("list-groups")).tool, "list_audiences");
  }));

test("plan-study uses nested plan_study_questions arguments", () =>
  withInputs(
    {
      "study-id": "s-1",
      request: "Test the concept",
      "study-locale": "de",
      stimulus: "Copy",
      "stimulus-label": "Hero",
    },
    async () => {
      assert.deepEqual(await buildCall("plan-study"), {
        tool: "plan_study_questions",
        args: {
          study: { id: "s-1" },
          request: "Test the concept",
          policy: { studyLocale: "de" },
          stimulus: {
            source: { kind: "prompt", label: "Hero", content: "Copy" },
          },
        },
      });
    },
  ));

test("ask-audience accepts audience and deprecated group inputs", async () => {
  await withInputs({ "audience-name": "Founders", question: "Q?" }, async () => {
    assert.deepEqual(await buildCall("ask-audience"), {
      tool: "ask_audience",
      args: { audience: { name: "Founders" }, question: "Q?" },
    });
  });
  await withInputs({ "group-id": "g-1", question: "Q?" }, async () => {
    assert.deepEqual(await buildCall("ask-group"), {
      tool: "ask_audience",
      args: { audience: { id: "g-1" }, question: "Q?" },
    });
  });
});

test("study status and summary accept deprecated panel inputs", async () => {
  await withInputs({ "panel-name": "Launch" }, async () => {
    assert.deepEqual(await buildCall("get-panel-status"), {
      tool: "get_study_status",
      args: { study: { name: "Launch" } },
    });
  });
  await withInputs({ "study-id": "s-2", "refresh-summary": "true" }, async () => {
    assert.deepEqual(await buildCall("get-study-summary"), {
      tool: "get_study_summary",
      args: { study: { id: "s-2" }, refresh: true, length: "standard" },
    });
  });
});

test("rejects both an id and a name", () =>
  withInputs({ "study-id": "s-1", "panel-name": "x" }, async () => {
    await assert.rejects(buildCall("get-study-status"), /study-id or study-name/);
  }));
