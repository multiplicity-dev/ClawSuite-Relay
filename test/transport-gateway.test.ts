import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveGatewayChannel, resolveGatewayCliCommand, resolveGatewayTarget } from "../src/transport-gateway.js";

test("resolveGatewayCliCommand uses the running OpenClaw node entrypoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "clawsuite-relay-openclaw-entry-"));
  const entrypoint = join(root, "node_modules", "openclaw", "dist", "index.js");
  const originalArgv1 = process.argv[1];
  const originalOverride = process.env.CLAWSUITE_RELAY_OPENCLAW_BIN;

  try {
    await mkdir(dirname(entrypoint), { recursive: true });
    await writeFile(entrypoint, "", "utf8");
    delete process.env.CLAWSUITE_RELAY_OPENCLAW_BIN;
    process.argv[1] = entrypoint;

    const command = resolveGatewayCliCommand();

    assert.equal(command.command, process.execPath);
    assert.deepEqual(command.argsPrefix, [entrypoint]);
  } finally {
    process.argv[1] = originalArgv1;
    if (originalOverride === undefined) {
      delete process.env.CLAWSUITE_RELAY_OPENCLAW_BIN;
    } else {
      process.env.CLAWSUITE_RELAY_OPENCLAW_BIN = originalOverride;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("resolveGatewayCliCommand honors explicit CLI override", () => {
  const originalOverride = process.env.CLAWSUITE_RELAY_OPENCLAW_BIN;
  try {
    process.env.CLAWSUITE_RELAY_OPENCLAW_BIN = "/custom/openclaw";
    assert.deepEqual(resolveGatewayCliCommand(), {
      command: "/custom/openclaw",
      argsPrefix: []
    });
  } finally {
    if (originalOverride === undefined) {
      delete process.env.CLAWSUITE_RELAY_OPENCLAW_BIN;
    } else {
      process.env.CLAWSUITE_RELAY_OPENCLAW_BIN = originalOverride;
    }
  }
});

test("resolveGatewayChannel preserves the Discord wake channel for relay replies", () => {
  assert.equal(
    resolveGatewayChannel("agent:legal-assistant:discord:channel:1486679413415481415"),
    "discord"
  );
  assert.equal(resolveGatewayChannel("agent:legal-assistant:main"), "discord");
  assert.equal(resolveGatewayChannel("agent:legal-assistant:main", "telegram"), "telegram");
});

test("resolveGatewayTarget derives the Discord delivery target from the session key", () => {
  assert.equal(
    resolveGatewayTarget("agent:legal-assistant:discord:channel:1486679413415481415"),
    "channel:1486679413415481415"
  );
  assert.equal(resolveGatewayTarget("agent:legal-assistant:discord:user:123456"), "user:123456");
  assert.equal(resolveGatewayTarget("agent:legal-assistant:main"), undefined);
  assert.equal(resolveGatewayTarget("agent:legal-assistant:main", "channel:999"), "channel:999");
});
