import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = await mkdtemp(join(tmpdir(), "clawsuite-relay-test-"));
process.env.CLAWSUITE_RELAY_DISPATCH_DIR = testDir;
process.env.CLAWSUITE_RELAY_SILENT_LOGS = "1";

const { relay_dispatch } = await import("../src/index.js");
const { loadDispatch } = await import("../src/state.js");

test.after(async () => {
  await rm(testDir, { recursive: true, force: true });
});

test("rejects unmapped target", async () => {
  const res = await relay_dispatch({ targetAgentId: "orchestrator", task: "hello" });
  assert.equal(res.status, "rejected");
  assert.equal(res.code, "TARGET_UNMAPPED");
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
    { transport: mockTransport }
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

test("duplicate requestId returns existing dispatch", async () => {
  const first = await relay_dispatch({
    targetAgentId: "systems-eng",
    task: "same",
    requestId: "req-123"
  });
  const second = await relay_dispatch({
    targetAgentId: "systems-eng",
    task: "same",
    requestId: "req-123"
  });

  assert.equal(first.status, "accepted");
  assert.equal(second.status, "accepted");
  assert.equal(first.dispatchId, second.dispatchId);
  assert.match(second.message, /idempotent/i);
});

test("invalid dispatchId path traversal is rejected", async () => {
  const traversal = await loadDispatch("../../etc/passwd");
  assert.equal(traversal, null);
});
