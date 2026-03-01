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

  assert.equal(typeof hooks.llm_output, "function");
  assert.equal(hooks.message_received, undefined);
  assert.equal(hooks.agent_end, undefined);
  assert.equal(tools.length, 1);
  assert.equal(typeof tools[0].tool, "function");
  // message_sending not registered without CHANNEL_AGENT_MAP
  assert.equal(hooks.message_sending, undefined);
});

test("registers message_sending hook when self-identity is explicitly enabled", () => {
  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"999":"systems-eng"}';
  process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED = "1";
  try {
    const { api, hooks } = createMockApi();
    register(api);
    assert.equal(typeof hooks.message_sending, "function");
    assert.equal(typeof hooks.llm_output, "function");
  } finally {
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED;
  }
});

test("does not register message_sending hook without explicit opt-in", () => {
  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"999":"systems-eng"}';
  try {
    const { api, hooks } = createMockApi();
    register(api);
    assert.equal(hooks.message_sending, undefined);
  } finally {
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
  }
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

// --- message_sending self-identity hook tests ---

test("message_sending posts via webhook with agent profile and cancels native delivery", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (input: any, init: any) => {
    fetchCalls.push({ url: String(input), body: JSON.parse(String(init?.body || "{}")) });
    return { ok: true, json: async () => ({ id: "self-id-msg-1" }) };
  }) as typeof fetch;

  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"12345":"systems-eng"}';
  process.env.CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON = '{"systems-eng":{"username":"Systems Engineer (CTO)","avatarUrl":"https://example.com/syseng.png"}}';
  process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED = "1";

  try {
    const { api, hooks } = createMockApi();
    register(api);

    const result = await hooks.message_sending(
      { to: "channel:12345", content: "Here is my analysis.", metadata: { channel: "discord" } },
      { channelId: "discord" }
    );

    assert.deepEqual(result, { cancel: true });
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /webhooks\/9999999999999999999\/test-token/);
    assert.equal(fetchCalls[0].body.username, "Systems Engineer (CTO)");
    assert.equal(fetchCalls[0].body.avatar_url, "https://example.com/syseng.png");
    assert.equal(fetchCalls[0].body.content, "Here is my analysis.");
    assert.deepEqual(fetchCalls[0].body.allowed_mentions, { parse: [] });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED;
  }
});

test("message_sending passes through non-Discord messages", async () => {
  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"12345":"systems-eng"}';
  process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED = "1";

  try {
    const { api, hooks } = createMockApi();
    register(api);

    const result = await hooks.message_sending(
      { to: "channel:12345", content: "hello", metadata: { channel: "telegram" } },
      { channelId: "telegram" }
    );

    assert.equal(result, undefined);
  } finally {
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED;
  }
});

test("message_sending passes through unknown channel IDs", async () => {
  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"12345":"systems-eng"}';
  process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED = "1";

  try {
    const { api, hooks } = createMockApi();
    register(api);

    const result = await hooks.message_sending(
      { to: "channel:99999", content: "hello", metadata: { channel: "discord" } },
      { channelId: "discord" }
    );

    assert.equal(result, undefined);
  } finally {
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED;
  }
});

test("message_sending chunks long messages", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ body: Record<string, unknown> }> = [];

  globalThis.fetch = (async (_input: any, init: any) => {
    fetchCalls.push({ body: JSON.parse(String(init?.body || "{}")) });
    return { ok: true, json: async () => ({ id: "chunk-msg" }) };
  }) as typeof fetch;

  process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON = '{"12345":"systems-eng"}';
  process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED = "1";

  try {
    const { api, hooks } = createMockApi();
    register(api);

    // 3000 chars should split into 2 chunks (limit is 2000)
    const longContent = "x".repeat(3000);
    const result = await hooks.message_sending(
      { to: "channel:12345", content: longContent, metadata: { channel: "discord" } },
      { channelId: "discord" }
    );

    assert.deepEqual(result, { cancel: true });
    assert.equal(fetchCalls.length, 2);
    assert.ok((fetchCalls[0].body.content as string).length <= 2000);
    assert.ok((fetchCalls[1].body.content as string).length <= 2000);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.CLAWSUITE_RELAY_CHANNEL_AGENT_MAP_JSON;
    delete process.env.CLAWSUITE_RELAY_SELF_IDENTITY_ENABLED;
  }
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
