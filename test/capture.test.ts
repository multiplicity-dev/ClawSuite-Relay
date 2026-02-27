import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-capture-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";

const { relay_dispatch } = await import("../src/index.js");
const { captureSubagentResponse, extractDispatchId } = await import("../src/capture.js");
const { loadDispatch } = await import("../src/state.js");

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
