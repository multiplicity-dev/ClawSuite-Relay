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

const { default: register } = await import("../src/openclaw-plugin.js");
const { relay_dispatch } = await import("../src/index.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("registers message_received and message_sending hooks", () => {
  const hooks: Record<string, Function> = {};
  register({
    logger: {},
    on: (name, fn) => {
      hooks[name] = fn;
    }
  });

  assert.equal(typeof hooks.message_received, "function");
  assert.equal(typeof hooks.message_sending, "function");
});

test("message_received is no-op for non-discord channel", async () => {
  const hooks: Record<string, Function> = {};
  const logger = { info: () => {}, warn: () => {} };
  register({
    logger,
    on: (name, fn) => {
      hooks[name] = fn;
    }
  });

  const result = await hooks.message_received(
    { content: "ignored", metadata: { channelId: "systems-eng-channel", messageId: "x" } },
    { channelId: "slack", conversationId: "systems-eng-channel" }
  );

  assert.equal(result, undefined);
});

test("message_received bails when content missing", async () => {
  const hooks: Record<string, Function> = {};
  register({
    logger: {},
    on: (name, fn) => {
      hooks[name] = fn;
    }
  });

  const result = await hooks.message_received(
    { content: "", metadata: { channelId: "systems-eng-channel", messageId: "x2" } },
    { channelId: "discord", conversationId: "systems-eng-channel" }
  );

  assert.equal(result, undefined);
});

test("message_sending cancels transient announce when correlated dispatch exists", async () => {
  const hooks: Record<string, Function> = {};
  register({
    logger: {},
    on: (name, fn) => {
      hooks[name] = fn;
    }
  });

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

