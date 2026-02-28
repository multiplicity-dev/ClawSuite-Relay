import test from "node:test";
import assert from "node:assert/strict";
import { buildRelayContent, splitText } from "../src/transport-discord.js";

test("buildRelayContent includes dispatch marker and source", () => {
  const content = buildRelayContent(
    { dispatchId: "d-1", targetAgentId: "systems-eng", task: "hello" },
    { mentionUserId: "123456789012345678", sourceAgentId: "ceo" }
  );
  assert.match(content, /\[relay_dispatch_id:d-1\]/);
  assert.match(content, /^<@123456789012345678>/);
  assert.match(content, /from ceo/);
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
