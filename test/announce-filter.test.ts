import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-announce-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";

const { relay_dispatch } = await import("../src/index.js");
const { captureSubagentResponse } = await import("../src/capture.js");
const { shouldSuppressTransientGeneralAnnounce } = await import("../src/announce-filter.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("does not suppress when relay disabled", async () => {
  const suppress = await shouldSuppressTransientGeneralAnnounce(
    { channelId: "general", content: "any" },
    { relayEnabled: false, orchestratorChannelId: "general" }
  );
  assert.equal(suppress, false);
});

test("does not suppress when channel does not match orchestrator channel", async () => {
  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "work", requestId: "ann-1" },
    { transport: { async postToChannel() { return { messageId: "post-a" }; } } }
  );

  const suppress = await shouldSuppressTransientGeneralAnnounce(
    {
      channelId: "other",
      content: `subagent completed [relay_dispatch_id:${dispatch.dispatchId}]`
    },
    { relayEnabled: true, orchestratorChannelId: "general" }
  );

  assert.equal(suppress, false);
});

test("suppresses when marker references known dispatch in orchestrator channel", async () => {
  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "work-2", requestId: "ann-1b" },
    { transport: { async postToChannel() { return { messageId: "post-a2" }; } } }
  );

  await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-marker-ready",
      referencedMessageId: "post-a2",
      content: "done marker"
    },
    { forwardTransport: { async forwardToOrchestrator() { return { messageId: "fwd-marker-ready" }; } } }
  );

  const suppress = await shouldSuppressTransientGeneralAnnounce(
    {
      channelId: "general",
      content: `subagent completed [relay_dispatch_id:${dispatch.dispatchId}]`
    },
    { relayEnabled: true, orchestratorChannelId: "general" }
  );

  assert.equal(suppress, true);
});

test("does not suppress when marker points to unknown dispatch", async () => {
  const suppress = await shouldSuppressTransientGeneralAnnounce(
    {
      channelId: "general",
      content: "unknown [relay_dispatch_id:11111111-1111-4111-8111-111111111111]"
    },
    { relayEnabled: true, orchestratorChannelId: "general" }
  );

  assert.equal(suppress, false);
});

test("does not suppress marker for failed dispatch state", async () => {
  const failed = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "will fail", requestId: "ann-failed" },
    { transport: { async postToChannel() { throw new Error("nope"); } } }
  );

  const suppress = await shouldSuppressTransientGeneralAnnounce(
    {
      channelId: "general",
      content: `failed [relay_dispatch_id:${failed.dispatchId}]`
    },
    { relayEnabled: true, orchestratorChannelId: "general" }
  );

  assert.equal(suppress, false);
});

test("suppresses when related subagent message id maps to dispatch", async () => {
  await relay_dispatch(
    { targetAgentId: "systems-eng", task: "work2", requestId: "ann-2" },
    { transport: { async postToChannel() { return { messageId: "post-b" }; } } }
  );

  await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-ann",
      referencedMessageId: "post-b",
      content: "done"
    },
    { forwardTransport: { async forwardToOrchestrator() { return { messageId: "fwd-ann" }; } } }
  );

  const suppress = await shouldSuppressTransientGeneralAnnounce(
    {
      channelId: "general",
      content: "transient done",
      relatedSubagentMessageId: "sub-msg-ann"
    },
    { relayEnabled: true, orchestratorChannelId: "general" }
  );

  assert.equal(suppress, true);
});
