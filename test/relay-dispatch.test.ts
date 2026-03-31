import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-test-"));
const armedDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-armed-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_ARMED_DIR = armedDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";

const { relay_dispatch } = await import("../src/index.js");
const { loadDispatch, saveDispatch, updateDispatch } = await import("../src/state.js");
const { createRelayDispatchToolFactory } = await import("../src/relay-dispatch-tool.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
  await rm(armedDir, { recursive: true, force: true });
});

test("unmapped target fails at transport with RELAY_UNAVAILABLE", async () => {
  const res = await relay_dispatch({ targetAgentId: "orchestrator", task: "hello" });
  assert.equal(res.status, "failed");
  assert.equal(res.code, "RELAY_UNAVAILABLE");
});

test("rejects missing task", async () => {
  const res = await relay_dispatch({ targetAgentId: "systems-eng", task: "" });
  assert.equal(res.status, "rejected");
  assert.equal(res.code, "INVALID_PAYLOAD");
});

test("accepted dispatch is persisted and posted", async () => {
  const calls: Array<{ dispatchId: string; targetAgentId: string; task: string }> = [];
  const mockTransport = {
    async postToChannel(req: { dispatchId: string; targetAgentId: string; task: string }) {
      calls.push(req);
      return { messageId: "m-1" };
    }
  };

  const res = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "run check" },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );
  assert.equal(res.status, "accepted");
  assert.ok(res.dispatchId);

  const stored = await loadDispatch(res.dispatchId!);
  assert.ok(stored);
  assert.equal(stored?.targetAgentId, "systems-eng");
  assert.equal(stored?.state, "POSTED_TO_CHANNEL");
  assert.equal(stored?.postedMessageId, "m-1");

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.targetAgentId, "systems-eng");
});

test("dispatch to second agent succeeds (multi-agent)", async () => {
  const calls: Array<{ targetAgentId: string }> = [];
  const mockTransport = {
    async postToChannel(req: { dispatchId: string; targetAgentId: string; task: string }) {
      calls.push(req);
      return { messageId: "m-clo" };
    }
  };

  const res = await relay_dispatch(
    { targetAgentId: "clo", task: "review contract" },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );
  assert.equal(res.status, "accepted");
  assert.ok(res.dispatchId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.targetAgentId, "clo");
});

test("duplicate requestId returns existing dispatch", async () => {
  const mockTransport = {
    async postToChannel() {
      return { messageId: "m-idem" };
    }
  };

  const first = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "same",
      requestId: "req-123"
    },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );
  const firstRecord = await loadDispatch(first.dispatchId!);
  assert.ok(firstRecord);
  await updateDispatch({
    ...firstRecord!,
    state: "COMPLETED"
  });
  const second = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "same",
      requestId: "req-123"
    },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );

  assert.equal(first.status, "accepted");
  assert.equal(second.status, "accepted");
  assert.equal(first.dispatchId, second.dispatchId);
  assert.match(second.message, /idempotent/i);
});

test("tool text distinguishes idempotent replay from a fresh post", async () => {
  const mockTransport = {
    async postToChannel() {
      return { messageId: "m-idem-tool" };
    }
  };

  const first = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "same",
      requestId: "req-123-tool"
    },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );
  const firstRecord = await loadDispatch(first.dispatchId!);
  assert.ok(firstRecord);
  await updateDispatch({
    ...firstRecord!,
    state: "COMPLETED"
  });

  const tool = createRelayDispatchToolFactory(mockTransport)({
    agentId: "ceo",
    sessionKey: "agent:ceo:discord:channel:test"
  });
  const executed = await tool.execute("call-1", {
    targetAgentId: "systems-eng",
    task: "same",
    requestId: "req-123-tool"
  });
  const text = executed.content[0]?.text ?? "";
  assert.match(text, /idempotent replay/i);
  assert.match(text, /No new message was posted/i);
});

test("duplicate requestId does not re-accept while dispatch is still in flight", async () => {
  let callCount = 0;
  const mockTransport = {
    async postToChannel() {
      callCount++;
      return { messageId: "m-inflight" };
    }
  };

  const first = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "same",
      requestId: "req-inflight-1"
    },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );
  assert.equal(first.status, "accepted");

  const second = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "same",
      requestId: "req-inflight-1"
    },
    { transport: mockTransport, orchestratorAgentId: "ceo" }
  );

  assert.equal(second.status, "failed");
  assert.equal(second.code, "DISPATCH_IN_FLIGHT");
  assert.equal(second.dispatchId, first.dispatchId);
  assert.match(second.message, /already in flight/i);
  assert.equal(callCount, 1, "should not post a second in-flight duplicate");
});

test("transport failure marks dispatch failed and does not idempotent-replay", async () => {
  const throwingTransport = {
    async postToChannel() {
      throw new Error("transport down");
    }
  };

  const first = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "run", requestId: "req-fail-1" },
    { transport: throwingTransport, orchestratorAgentId: "ceo" }
  );
  assert.equal(first.status, "failed");

  const failedRecord = await loadDispatch(first.dispatchId!);
  assert.equal(failedRecord?.state, "FAILED");

  const recoveryTransport = {
    async postToChannel() {
      return { messageId: "m-recovery" };
    }
  };

  const second = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "run",
      requestId: "req-fail-1"
    },
    { transport: recoveryTransport, orchestratorAgentId: "ceo" }
  );

  assert.equal(second.status, "accepted");
  assert.notEqual(second.dispatchId, first.dispatchId);
});

test("unconfigured transport fails loudly", async () => {
  const res = await relay_dispatch(
    {
      targetAgentId: "systems-eng",
      task: "no transport configured",
      requestId: "req-unconfigured"
    },
    { orchestratorAgentId: "ceo" }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.code, "RELAY_UNAVAILABLE");
  assert.ok(res.dispatchId);
});

test("missing orchestrator identity fails loudly", async () => {
  const mockTransport = {
    async postToChannel() {
      return { messageId: "m-unused" };
    }
  };
  const res = await relay_dispatch(
    { targetAgentId: "systems-eng", task: "test identity guard" },
    { transport: mockTransport }
  );
  assert.equal(res.status, "failed");
  assert.equal(res.code, "RELAY_UNAVAILABLE");
  assert.match(res.message, /missing orchestrator agent identity/i);
});

test("stale replayable dispatch expires instead of matching forever", async () => {
  const staleTransport = {
    async postToChannel() {
      return { messageId: "m-stale-new" };
    }
  };

  process.env.CLAWSUITE_RELAY_REPLAYABLE_TTL_MS = "1000";
  try {
    const old = await relay_dispatch(
      {
        targetAgentId: "systems-eng",
        task: "old stale dispatch",
        requestId: "req-stale-1"
      },
      { transport: staleTransport, orchestratorAgentId: "ceo" }
    );
    assert.equal(old.status, "accepted");
    const oldRecord = await loadDispatch(old.dispatchId!);
    assert.ok(oldRecord);
    await saveDispatch({
      ...oldRecord!,
      state: "POSTED_TO_CHANNEL",
      updatedAt: new Date(Date.now() - 10_000).toISOString()
    });

    const next = await relay_dispatch(
      {
        targetAgentId: "systems-eng",
        task: "fresh dispatch after stale replayable",
        requestId: "req-stale-1"
      },
      { transport: staleTransport, orchestratorAgentId: "ceo" }
    );
    assert.equal(next.status, "accepted");
    assert.notEqual(next.dispatchId, old.dispatchId);

    const expired = await loadDispatch(old.dispatchId!);
    assert.equal(expired?.state, "FAILED");
    assert.match(expired?.lastError ?? "", /stale replayable dispatch expired/i);
  } finally {
    delete process.env.CLAWSUITE_RELAY_REPLAYABLE_TTL_MS;
  }
});

test("invalid dispatchId path traversal is rejected", async () => {
  const traversal = await loadDispatch("../../etc/passwd");
  assert.equal(traversal, null);
});
