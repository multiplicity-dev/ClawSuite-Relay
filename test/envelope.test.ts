import test from "node:test";
import assert from "node:assert/strict";
import { type RelayEnvelope, serializeForGateway, serializeForDiscord } from "../src/envelope.js";

const baseEnvelope: RelayEnvelope = {
  source: "systems-eng",
  target: "ceo",
  dispatchId: "d-test-1",
  createdAt: "2026-02-28T10:00:00.000Z",
  type: "result",
  content: "The analysis is complete."
};

test("serializeForGateway includes source → target provenance", () => {
  const msg = serializeForGateway(baseEnvelope);
  assert.match(msg, /from systems-eng → ceo/);
});

test("serializeForGateway includes dispatch marker", () => {
  const msg = serializeForGateway(baseEnvelope);
  assert.match(msg, /\[relay_dispatch_id:d-test-1\]/);
});

test("serializeForGateway includes content", () => {
  const msg = serializeForGateway(baseEnvelope);
  assert.ok(msg.includes("The analysis is complete."));
});

test("serializeForGateway appends session key when provided", () => {
  const msg = serializeForGateway(baseEnvelope, {
    subagentSessionKey: "agent:systems-eng:discord:channel:123"
  });
  assert.match(msg, /\[relay_subagent_session_key:agent:systems-eng:discord:channel:123\]/);
});

test("serializeForGateway omits session key when not provided", () => {
  const msg = serializeForGateway(baseEnvelope);
  assert.ok(!msg.includes("relay_subagent_session_key"));
});

test("serializeForGateway appends reply instruction when provided", () => {
  const msg = serializeForGateway(baseEnvelope, {
    replyInstruction: "Convert this to user voice."
  });
  assert.ok(msg.includes("Convert this to user voice."));
});

test("serializeForDiscord includes task content prominently", () => {
  const dispatch: RelayEnvelope = {
    source: "ceo",
    target: "systems-eng",
    dispatchId: "d-test-2",
    createdAt: "2026-02-28T10:00:00.000Z",
    type: "dispatch",
    content: "Please audit the codebase."
  };
  const msg = serializeForDiscord(dispatch);
  assert.ok(msg.startsWith("Please audit the codebase."));
});

test("serializeForDiscord includes footer with source provenance", () => {
  const dispatch: RelayEnvelope = {
    source: "ceo",
    target: "systems-eng",
    dispatchId: "d-test-3",
    createdAt: "2026-02-28T10:00:00.000Z",
    type: "dispatch",
    content: "Task here."
  };
  const msg = serializeForDiscord(dispatch);
  assert.match(msg, /from ceo/);
  assert.ok(!msg.includes("relay_dispatch_id"), "dispatch ID marker should not appear in Discord footer");
});

test("serializeForDiscord omits @mentions", () => {
  const dispatch: RelayEnvelope = {
    source: "ceo",
    target: "systems-eng",
    dispatchId: "d-test-4",
    createdAt: "2026-02-28T10:00:00.000Z",
    type: "dispatch",
    content: "Task here."
  };
  const msg = serializeForDiscord(dispatch);
  assert.ok(!msg.includes("<@"));
});
