import test from "node:test";
import assert from "node:assert/strict";
import { buildRelayContent, DiscordRelayTransport } from "../src/transport-discord.js";

test("buildRelayContent includes dispatch marker", () => {
  const content = buildRelayContent(
    { dispatchId: "d-1", targetAgentId: "systems-eng", task: "hello" },
    "123456789012345678"
  );
  assert.match(content, /\[relay_dispatch_id:d-1\]/);
  assert.match(content, /^<@123456789012345678>/);
});

test("Discord transport rejects overlong content before API call", async () => {
  const transport = new DiscordRelayTransport({
    botToken: "fake",
    channelsByAgent: { "systems-eng": "1474868861525557308" }
  });

  await assert.rejects(
    () =>
      transport.postToChannel({
        dispatchId: "d-2",
        targetAgentId: "systems-eng",
        task: "x".repeat(2100)
      }),
    /Payload too long/
  );
});
