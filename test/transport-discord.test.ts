import test from "node:test";
import assert from "node:assert/strict";
import { buildRelayContent, splitText, DiscordRelayTransport } from "../src/transport-discord.js";

test("buildRelayContent includes source but not dispatch ID marker or mention", () => {
  const content = buildRelayContent(
    { dispatchId: "d-1", targetAgentId: "systems-eng", task: "hello" },
    { sourceAgentId: "ceo" }
  );
  assert.match(content, /from ceo/);
  assert.ok(!content.includes("<@"), "mention should not appear");
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
  const sleepCalls: number[] = [];
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];

  globalThis.fetch = (async (input, init) => {
    urls.push(String(input));
    bodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>);
    callCount++;
    if (callCount === 1) {
      return { ok: false, status: 502, text: async () => "Bad Gateway", headers: new Headers() };
    }
    return { ok: true, json: async () => ({ id: "msg-123" }) };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      webhooksByAgent: { "systems-eng": "https://discord.com/api/webhooks/12345678901234567890/fake-hook-token" },
      sourceProfilesByAgent: { ceo: { username: "CEO", avatarUrl: "https://example.com/ceo.png" } },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    const result = await transport.postToChannel({
      dispatchId: "d-retry-1",
      targetAgentId: "systems-eng",
      task: "test task"
    });
    assert.equal(result.messageId, "msg-123");
    assert.equal(callCount, 2, "should have retried once after 502");
    assert.deepEqual(sleepCalls, [2000], "should use 2s server-error backoff");
    assert.equal(urls[0], "https://discord.com/api/webhooks/12345678901234567890/fake-hook-token?wait=true");
    assert.equal(bodies[0]?.username, "relay", "source fallback should be relay");
    assert.deepEqual(bodies[0]?.allowed_mentions, { parse: [] });
    assert.equal(bodies[0]?.avatar_url, undefined);

    const profiled = await transport.postToChannel({
      dispatchId: "d-retry-1b",
      targetAgentId: "systems-eng",
      task: "profiled task",
      sourceAgentId: "ceo"
    });
    assert.equal(profiled.messageId, "msg-123");
    assert.equal(bodies[2]?.username, "CEO");
    assert.equal(bodies[2]?.avatar_url, "https://example.com/ceo.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postToChannel does not retry on non-transient 403", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const sleepCalls: number[] = [];

  globalThis.fetch = (async () => {
    callCount++;
    return { ok: false, status: 403, text: async () => "Forbidden", headers: new Headers() };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      webhooksByAgent: { "systems-eng": "https://discord.com/api/webhooks/12345678901234567890/fake-hook-token" },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    await assert.rejects(
      () => transport.postToChannel({ dispatchId: "d-retry-2", targetAgentId: "systems-eng", task: "test" }),
      /Discord post failed \(403\)/
    );
    assert.equal(callCount, 1, "should not retry on 403");
    assert.equal(sleepCalls.length, 0, "should not back off on non-transient errors");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postToChannel retries on thrown network error then succeeds", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const sleepCalls: number[] = [];

  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) {
      throw new Error("socket hang up");
    }
    return { ok: true, json: async () => ({ id: "msg-456" }) };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      webhooksByAgent: { "systems-eng": "https://discord.com/api/webhooks/12345678901234567890/fake-hook-token" },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    const result = await transport.postToChannel({
      dispatchId: "d-retry-3",
      targetAgentId: "systems-eng",
      task: "test"
    });
    assert.equal(result.messageId, "msg-456");
    assert.equal(callCount, 2, "should retry once after network error");
    assert.deepEqual(sleepCalls, [2000], "should use server-error backoff for network errors");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postToChannel uses fallback Retry-After when header is invalid", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const sleepCalls: number[] = [];

  globalThis.fetch = (async () => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: false,
        status: 429,
        text: async () => "Rate limited",
        headers: new Headers([["Retry-After", "not-a-number"]])
      };
    }
    return { ok: true, json: async () => ({ id: "msg-789" }) };
  }) as typeof fetch;

  try {
    const transport = new DiscordRelayTransport({
      webhooksByAgent: { "systems-eng": "https://discord.com/api/webhooks/12345678901234567890/fake-hook-token" },
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      }
    });
    const result = await transport.postToChannel({
      dispatchId: "d-retry-4",
      targetAgentId: "systems-eng",
      task: "test"
    });
    assert.equal(result.messageId, "msg-789");
    assert.equal(callCount, 2, "should retry once after 429");
    assert.deepEqual(sleepCalls, [2000], "should fall back to default Retry-After");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postToChannel rejects invalid webhook URL", async () => {
  const transport = new DiscordRelayTransport({
    webhooksByAgent: { "systems-eng": "not-a-webhook-url" }
  });
  await assert.rejects(
    () => transport.postToChannel({ dispatchId: "d-invalid-webhook", targetAgentId: "systems-eng", task: "test" }),
    /Invalid Discord webhook URL/
  );
});
