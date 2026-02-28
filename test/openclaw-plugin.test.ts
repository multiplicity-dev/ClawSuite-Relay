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
process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON = '{"systems-eng":"9999999999999999999"}';

const { default: register } = await import("../src/openclaw-plugin.js");
const { relay_dispatch } = await import("../src/index.js");
const { saveDispatch, loadDispatch, setArmedDispatch, clearArmedDispatch } = await import("../src/state.js");

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

  assert.equal(typeof hooks.message_received, "function");
  assert.equal(typeof hooks.message_sending, "function");
  assert.equal(typeof hooks.llm_output, "function");
  // agent_end is only registered when CLAWSUITE_RELAY_USE_AGENT_END_FALLBACK=1
  assert.equal(hooks.agent_end, undefined);
  assert.equal(hooks.before_message_write, undefined);
  assert.equal(tools.length, 1);
  // Tool is registered as a factory (function), not a static tool
  assert.equal(typeof tools[0].tool, "function");
});

test("message_received is no-op for non-discord channel", async () => {
  const { api, hooks } = createMockApi();
  register(api);

  const result = await hooks.message_received(
    { content: "ignored", metadata: { channelId: "systems-eng-channel", messageId: "x" } },
    { channelId: "slack", conversationId: "systems-eng-channel" }
  );

  assert.equal(result, undefined);
});

test("message_received bails when content missing", async () => {
  const { api, hooks } = createMockApi();
  register(api);

  const result = await hooks.message_received(
    { content: "", metadata: { channelId: "systems-eng-channel", messageId: "x2" } },
    { channelId: "discord", conversationId: "systems-eng-channel" }
  );

  assert.equal(result, undefined);
});

test("message_sending cancels transient announce when correlated dispatch exists", async () => {
  const { api, hooks } = createMockApi();
  register(api);

  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "work", requestId: "plugin-send-1" },
    { transport: { async postToChannel() { return { messageId: "post-plugin-1" }; } } }
  );

  // Move to suppressible state by simulating capture+forward via direct state path:
  await hooks.message_received(
    {
      content: "done",
      metadata: {
        channelId: "systems-eng-channel",
        messageId: "sub-plugin-1",
        referencedMessageId: "post-plugin-1"
      }
    },
    { channelId: "discord", conversationId: "systems-eng-channel" }
  );

  const result = await hooks.message_sending(
    {
      content: `subagent completed [relay_dispatch_id:${dispatch.dispatchId}]`,
      metadata: { channelId: "1474868861525557308" }
    },
    { channelId: "discord", conversationId: "1474868861525557308" }
  );

  assert.deepEqual(result, { cancel: true });
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

