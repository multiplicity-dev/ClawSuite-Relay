import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { buildRelayContent, splitText, DiscordRelayTransport } from "../src/transport-discord.js";

test("buildRelayContent includes mention and source but not dispatch ID marker", () => {
  const content = buildRelayContent(
    { dispatchId: "d-1", targetAgentId: "systems-eng", task: "hello" },
    { mentionUserId: "123456789012345678", sourceAgentId: "ceo" }
  );
  assert.match(content, /^<@123456789012345678>/);
  assert.match(content, /from ceo/);
  assert.ok(!content.includes("relay_dispatch_id"), "dispatch ID marker should not appear");
});

test("splitText returns single chunk when within limit", () => {
  const chunks = splitText("short text", 100);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], "short text");
});

test("splitText splits at paragraph boundary", () => {
  const text = "paragraph one\n\nparagraph two\n\nparagraph three";
  const chunks = splitText(text, 25);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0], "paragraph one");
});

test("splitText falls back to line break", () => {
  const text = "line one\nline two\nline three";
  const chunks = splitText(text, 15);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0], "line one");
});

test("splitText hard-splits when no natural boundary", () => {
  const text = "x".repeat(50);
  const chunks = splitText(text, 20);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= 20));
});

test("postToChannel retries on transient 502 then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 502, text: async () => "Bad Gateway", headers: new Headers() };
    }
    return { ok: true, json: async () => ({ id: "msg-123" }) };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      botToken: "fake-token",
      channelsByAgent: { "systems-eng": "12345678901234567890" }
    });
    const result = await transport.postToChannel({
      dispatchId: "d-retry-1",
      targetAgentId: "systems-eng",
      task: "test task"
    });
    assert.equal(result.messageId, "msg-123");
    assert.equal(callCount, 2, "should have retried once after 502");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postToChannel does not retry on non-transient 403", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount++;
    return { ok: false, status: 403, text: async () => "Forbidden", headers: new Headers() };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      botToken: "fake-token",
      channelsByAgent: { "systems-eng": "12345678901234567890" }
    });
    await assert.rejects(
      () => transport.postToChannel({ dispatchId: "d-retry-2", targetAgentId: "systems-eng", task: "test" }),
      /Discord post failed \(403\)/
    );
    assert.equal(callCount, 1, "should not retry on 403");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
