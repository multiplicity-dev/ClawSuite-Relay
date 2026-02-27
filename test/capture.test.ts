import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-capture-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";

const { relay_dispatch } = await import("../src/index.js");
const { captureSubagentResponse, captureOutboundResponse, extractDispatchId } = await import("../src/capture.js");
const { loadDispatch, saveDispatch } = await import("../src/state.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("extractDispatchId parses marker", () => {
  const id = extractDispatchId("hello\n[relay_dispatch_id:abc-123]");
  assert.equal(id, "abc-123");
});

test("capture ignores unrelated message", async () => {
  const res = await captureSubagentResponse({
    channelId: "c1",
    messageId: "m1",
    content: "plain response"
  });

  assert.equal(res.status, "ignored");
  assert.equal(res.reason, "no_dispatch_match");
});

test("capture by referencedMessageId forwards and completes dispatch", async () => {
  const dispatchTransport = {
    async postToChannel() {
      return { messageId: "posted-1" };
    }
  };

  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "do work", requestId: "capture-ref-1" },
    { transport: dispatchTransport }
  );

  const forwardCalls: Array<{ dispatchId: string; content: string }> = [];
  const forwardTransport = {
    async forwardToOrchestrator(req: { dispatchId: string; content: string; subagentMessageId: string; targetAgentId: string }) {
      forwardCalls.push({ dispatchId: req.dispatchId, content: req.content });
      return { messageId: "fwd-1" };
    }
  };

  const result = await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-1",
      referencedMessageId: "posted-1",
      content: "done"
    },
    { forwardTransport }
  );

  assert.equal(result.status, "processed");
  assert.equal(result.dispatchId, dispatch.dispatchId);
  assert.equal(forwardCalls.length, 1);

  const updated = await loadDispatch(dispatch.dispatchId!);
  assert.equal(updated?.state, "COMPLETED");
  assert.equal(updated?.subagentResponseMessageId, "sub-msg-1");
  assert.equal(updated?.forwardedMessageId, "fwd-1");
});

test("capture falls back to marker when no message reference", async () => {
  const dispatchTransport = {
    async postToChannel() {
      return { messageId: "posted-2" };
    }
  };

  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "do work2", requestId: "capture-marker-1" },
    { transport: dispatchTransport }
  );

  const forwardTransport = {
    async forwardToOrchestrator() {
      return { messageId: "fwd-2" };
    }
  };

  const result = await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-2",
      content: `result text\n[relay_dispatch_id:${dispatch.dispatchId}]`
    },
    { forwardTransport }
  );

  assert.equal(result.status, "processed");
  const updated = await loadDispatch(dispatch.dispatchId!);
  assert.equal(updated?.state, "COMPLETED");
});

test("capture ignores relay bot's own outbound message", async () => {
  const dispatchTransport = {
    async postToChannel() {
      return { messageId: "posted-self-1" };
    }
  };

  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "self-test", requestId: "capture-self-1" },
    { transport: dispatchTransport }
  );

  const forwardTransport = {
    async forwardToOrchestrator() {
      return { messageId: "should-not-be-called" };
    }
  };

  // Simulate the relay bot's own outbound message being received back via the gateway.
  // The messageId matches the dispatch's postedMessageId.
  const result = await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "posted-self-1",
      content: `self-test\n\n[relay_dispatch_id:${dispatch.dispatchId}]`
    },
    { forwardTransport }
  );

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "own_relay_message");

  // Dispatch should still be in POSTED_TO_CHANNEL, not captured.
  const unchanged = await loadDispatch(dispatch.dispatchId!);
  assert.equal(unchanged?.state, "POSTED_TO_CHANNEL");
});

test("forward failure leaves dispatch in SUBAGENT_RESPONDED for retry", async () => {
  const dispatchTransport = {
    async postToChannel() {
      return { messageId: "posted-3" };
    }
  };

  const dispatch = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "do work3", requestId: "capture-fwd-fail-1" },
    { transport: dispatchTransport }
  );

  const failingForwardTransport = {
    async forwardToOrchestrator() {
      throw new Error("orchestrator channel unavailable");
    }
  };

  const failed = await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-3",
      referencedMessageId: "posted-3",
      content: "attempt 1"
    },
    { forwardTransport: failingForwardTransport }
  );

  assert.equal(failed.status, "failed");
  const mid = await loadDispatch(dispatch.dispatchId!);
  assert.equal(mid?.state, "SUBAGENT_RESPONDED");
  assert.equal(mid?.subagentResponseMessageId, "sub-msg-3");

  const recoveryForwardTransport = {
    async forwardToOrchestrator() {
      return { messageId: "fwd-3" };
    }
  };

  const recovered = await captureSubagentResponse(
    {
      channelId: "systems-eng-channel",
      messageId: "sub-msg-3b",
      referencedMessageId: "posted-3",
      content: "attempt 2"
    },
    { forwardTransport: recoveryForwardTransport }
  );

  assert.equal(recovered.status, "processed");
  const finalState = await loadDispatch(dispatch.dispatchId!);
  assert.equal(finalState?.state, "COMPLETED");
  assert.equal(finalState?.forwardedMessageId, "fwd-3");
});

test("captureOutboundResponse forwards when pending dispatch exists for agent", async () => {
  // Create dispatch directly to avoid V1 target agent validation and stale dispatch collisions.
  const dispatchId = "00000000-0000-1000-8000-000000000099";
  await saveDispatch({
    dispatchId,
    targetAgentId: "outbound-test-agent",
    task: "outbound test",
    state: "POSTED_TO_CHANNEL",
    postedMessageId: "posted-outbound-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const forwardCalls: Array<{ dispatchId: string; content: string }> = [];
  const forwardTransport = {
    async forwardToOrchestrator(req: { dispatchId: string; content: string; subagentMessageId: string; targetAgentId: string }) {
      forwardCalls.push({ dispatchId: req.dispatchId, content: req.content });
      return { messageId: "fwd-outbound-1" };
    }
  };

  const result = await captureOutboundResponse(
    { targetAgentId: "outbound-test-agent", content: "thumbs up" },
    { forwardTransport }
  );

  assert.equal(result.status, "processed");
  assert.equal(result.dispatchId, dispatchId);
  assert.equal(forwardCalls.length, 1);
  assert.equal(forwardCalls[0].content, "thumbs up");

  const updated = await loadDispatch(dispatchId);
  assert.equal(updated?.state, "COMPLETED");
  assert.equal(updated?.forwardedMessageId, "fwd-outbound-1");
});

test("captureOutboundResponse ignores when no pending dispatch for agent", async () => {
  const result = await captureOutboundResponse(
    { targetAgentId: "unknown-agent", content: "no dispatch" },
    {}
  );

  assert.equal(result.status, "ignored");
  assert.equal(result.reason, "no_pending_dispatch");
});
