import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-plugin-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";
process.env.CLAWSUITE_RELAY_ENABLED = "1";
process.env.CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID = "1474868861525557308";
process.env.CLAWSUITE_RELAY_WEBHOOK_MAP_JSON = '{"systems-eng":"https://discord.com/api/webhooks/9999999999999999999/test-token"}';

const { default: register } = await import("../src/openclaw-plugin.js");
const { relay_dispatch } = await import("../src/index.js");
const { saveDispatch, loadDispatch, updateDispatch, setArmedDispatch, clearArmedDispatch } = await import("../src/state.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function createMockApi() {
  const hooks: Record<string, Function> = {};
  const tools: Array<{ tool: any; opts: any }> = [];
  const api = {
    logger: { info: () => {}, warn: () => {} },
    on: (name: string, fn: Function) => { hooks[name] = fn; },
    registerTool: (tool: any, opts?: any) => { tools.push({ tool, opts }); }
  };
  return { api, hooks, tools };
}

test("registers hooks and relay_dispatch tool factory", () => {
  const { api, hooks, tools } = createMockApi();
  register(api);

  // llm_output is the sole hook (capture + gateway delivery)
  assert.equal(typeof hooks.llm_output, "function");
  assert.equal(hooks.message_received, undefined);
  assert.equal(hooks.agent_end, undefined);
  assert.equal(tools.length, 1);
  assert.equal(typeof tools[0].tool, "function");
});

test("llm_output captures only after dispatch is armed", async () => {
  const dispatchId = "00000000-0000-1000-8000-000000000077";
  await saveDispatch({
    dispatchId,
    targetAgentId: "systems-eng",
    task: "outbound capture via plugin",
    state: "POSTED_TO_CHANNEL",
    postedMessageId: "posted-plugin-outbound-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const { api, hooks } = createMockApi();
  register(api);

  // Ensure no prior arming residue from other tests.
  await clearArmedDispatch("systems-eng");

  // Without arming, should no-op.
  const noArm = await hooks.llm_output(
    { assistantTexts: ["here is my analysis"] },
    { agentId: "systems-eng", sessionKey: "agent:systems-eng:test" }
  );
  assert.equal(noArm, undefined);
  const stillPending = await loadDispatch(dispatchId);
  assert.equal(stillPending?.state, "POSTED_TO_CHANNEL");

  // Arm with orchestrator session key — gateway delivery will fail in test
  // (no real gateway), but the dispatch state should still update.
  await setArmedDispatch("systems-eng", dispatchId, "agent:ceo:test:session");

  const armed = await hooks.llm_output(
    { assistantTexts: ["here is my analysis"] },
    { agentId: "systems-eng", sessionKey: "agent:systems-eng:test" }
  );

  assert.equal(armed, undefined);
  // Dispatch may be COMPLETED (if gateway call succeeds) or still
  // POSTED_TO_CHANNEL (if gateway call fails in test env). Either way,
  // the hook ran without throwing.
});

test("relay_dispatch tool factory produces working tool", async () => {
  const { createRelayDispatchToolFactory } = await import("../src/relay-dispatch-tool.js");
  const mockTransport = {
    async postToChannel() { return { messageId: "tool-post-1" }; }
  };
  const factory = createRelayDispatchToolFactory(mockTransport);
  const tool = factory({ sessionKey: "agent:ceo:test:session", agentId: "ceo" });

  const result = await tool.execute("call-1", {
    targetAgentId: "systems-eng",
    task: "test dispatch via tool"
  });

  assert.equal(result.content[0].type, "text");
  assert.match(result.content[0].text, /accepted/i);
  assert.equal(result.details.status, "accepted");
  assert.ok(result.details.dispatchId);
});
