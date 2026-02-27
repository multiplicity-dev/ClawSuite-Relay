import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relay_dispatch } from "../src/index.js";
import { getDispatchDir, loadDispatch } from "../src/state.js";

test("rejects unmapped target", async () => {
  const res = await relay_dispatch({ targetAgentId: "ceo", task: "hello" });
  assert.equal(res.status, "rejected");
  assert.equal(res.code, "TARGET_UNMAPPED");
});

test("rejects missing task", async () => {
  const res = await relay_dispatch({ targetAgentId: "systems-eng", task: "" });
  assert.equal(res.status, "rejected");
  assert.equal(res.code, "INVALID_PAYLOAD");
});

test("accepted dispatch is persisted", async () => {
  const res = await relay_dispatch({ targetAgentId: "systems-eng", task: "run check" });
  assert.equal(res.status, "accepted");
  assert.ok(res.dispatchId);

  const stored = await loadDispatch(res.dispatchId!);
  assert.ok(stored);
  assert.equal(stored?.targetAgentId, "systems-eng");
  assert.equal(stored?.state, "CREATED");
});
