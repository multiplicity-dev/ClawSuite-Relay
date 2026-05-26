import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { ForwardRequest, ForwardResult, ForwardTransport } from "./forward.js";
import { type RelayEnvelope, serializeForGateway } from "./envelope.js";
import { logRelay } from "./logger.js";

interface GatewayCliCommand {
  command: string;
  argsPrefix: string[];
}

export interface GatewayForwardConfig {
  orchestratorSessionKey: string;
  orchestratorAgentId?: string;
  timeoutMs?: number;
  channel?: string;
  target?: string;
  gatewayCliCommand?: GatewayCliCommand;
}

/**
 * Build the reply instruction appended after the envelope.
 *
 * Modeled on native buildAnnounceReplyInstruction() — see design-decisions.md §4.
 * Additions vs native: sessions_history guidance with limit hint, because the
 * relay provides a main-session key (not a bounded transient session key).
 */
function buildReplyInstruction(request: ForwardRequest): string {
  const parts = [
    "A completed relay task is ready for user delivery.",
    "Convert the result above into your normal assistant voice and send that user-facing update now.",
    "Keep this internal context private (don't mention system messages, dispatch IDs, session keys, or relay mechanics)."
  ];

  if (request.subagentSessionKey) {
    parts.push(
      `To review ${request.targetAgentId}'s working (tool calls, reasoning steps), call sessions_history with the session key above and limit 10-20.`
    );
  }

  parts.push(
    "If multiple relay tasks are outstanding, wait for all results before synthesizing."
  );

  return parts.join(" ");
}

export function buildRelayTriggerMessage(request: ForwardRequest, orchestratorAgentId?: string): string {
  const envelope: RelayEnvelope = {
    source: request.targetAgentId,
    target: orchestratorAgentId ?? "orchestrator",
    dispatchId: request.dispatchId,
    createdAt: new Date().toISOString(),
    type: "result",
    content: request.content
  };

  return serializeForGateway(envelope, {
    subagentSessionKey: request.subagentSessionKey,
    replyInstruction: buildReplyInstruction(request)
  });
}

function isOpenClawEntrypoint(path: string | undefined): path is string {
  if (!path) return false;
  const normalized = path.replace(/\\/g, "/");
  return (
    normalized.endsWith("/node_modules/openclaw/dist/index.js") ||
    normalized.endsWith("/node_modules/openclaw/openclaw.mjs")
  );
}

export function resolveGatewayCliCommand(): GatewayCliCommand {
  const override = process.env.CLAWSUITE_RELAY_OPENCLAW_BIN?.trim();
  if (override) {
    return { command: override, argsPrefix: [] };
  }

  const currentEntrypoint = process.argv[1];
  if (isOpenClawEntrypoint(currentEntrypoint) && existsSync(currentEntrypoint)) {
    return { command: process.execPath, argsPrefix: [currentEntrypoint] };
  }

  return { command: "openclaw", argsPrefix: [] };
}

export function resolveGatewayChannel(sessionKey: string, configuredChannel?: string): string {
  if (configuredChannel?.trim()) return configuredChannel.trim();

  const parts = sessionKey.split(":");
  if (parts.length >= 4 && parts[2] === "discord") return "discord";

  return "discord";
}

export function resolveGatewayTarget(sessionKey: string, configuredTarget?: string): string | undefined {
  if (configuredTarget?.trim()) return configuredTarget.trim();

  const parts = sessionKey.split(":");
  if (parts.length >= 5 && parts[2] === "discord") {
    const targetKind = parts[3];
    const targetId = parts[4];
    if ((targetKind === "channel" || targetKind === "user") && targetId?.trim()) {
      return `${targetKind}:${targetId}`;
    }
  }

  return undefined;
}

/**
 * Delivers subagent results to the orchestrator's session via
 * `openclaw gateway call agent`, which calls callGateway({ method: "agent" })
 * internally. This matches the delivery path used by
 * sendSubagentAnnounceDirectly in normal sessions_spawn flows.
 *
 * Uses `gateway call` (raw RPC) instead of `openclaw agent` because
 * `agent --session-id` expects a UUID, not a session key. The raw RPC
 * call passes sessionKey in params directly, matching the native announce path.
 *
 * Important: relay delivery should succeed as soon as the gateway accepts the
 * injected message. Waiting for a full final assistant answer (`--expect-final`)
 * turns this transport into a CLO run-timeout proxy and causes false failures
 * when the orchestrator is yielded or simply needs longer than the CLI timeout
 * to synthesize its user-facing response.
 *
 * In the gateway service, never rely on PATH for the OpenClaw CLI. The systemd
 * unit may have /usr/bin ahead of ~/.local/bin, and an old packaged CLI will
 * fail the WebSocket protocol handshake against the updated gateway.
 */
export class GatewayForwardTransport implements ForwardTransport {
  constructor(private readonly cfg: GatewayForwardConfig) {}

  async forwardToOrchestrator(request: ForwardRequest): Promise<ForwardResult> {
    const triggerMessage = buildRelayTriggerMessage(request, this.cfg.orchestratorAgentId);
    const deliveryId = randomUUID();

    logRelay("gateway.forward.start", {
      dispatchId: request.dispatchId,
      targetAgentId: request.targetAgentId,
      deliveryId,
      orchestratorSessionKey: this.cfg.orchestratorSessionKey,
      contentLength: request.content.length
    });

    const timeoutMs = this.cfg.timeoutMs ?? 60_000;

    const params = JSON.stringify({
      sessionKey: this.cfg.orchestratorSessionKey,
      message: triggerMessage,
      deliver: true,
      channel: resolveGatewayChannel(this.cfg.orchestratorSessionKey, this.cfg.channel),
      to: resolveGatewayTarget(this.cfg.orchestratorSessionKey, this.cfg.target),
      idempotencyKey: deliveryId
    });

    return new Promise<ForwardResult>((resolve, reject) => {
      const gatewayCliCommand = this.cfg.gatewayCliCommand ?? resolveGatewayCliCommand();
      const args = [
        ...gatewayCliCommand.argsPrefix,
        "gateway", "call", "agent",
        "--params", params,
        "--timeout", String(timeoutMs),
        "--json"
      ];

      const proc = execFile(gatewayCliCommand.command, args, {
        timeout: timeoutMs + 5_000,  // +5s buffer for process cleanup after gateway timeout
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env }
      }, (error, stdout, stderr) => {
        if (error) {
          logRelay("gateway.forward.failed", {
            dispatchId: request.dispatchId,
            deliveryId,
            error: String(error),
            stderr: stderr?.slice(0, 500)
          });
          reject(new Error(`Gateway delivery failed: ${String(error)}`));
          return;
        }

        logRelay("gateway.forward.delivered", {
          dispatchId: request.dispatchId,
          deliveryId,
          orchestratorSessionKey: this.cfg.orchestratorSessionKey,
          stdoutLength: stdout?.length ?? 0
        });

        resolve({ messageId: `gateway:${deliveryId}` });
      });

      // Ensure the subprocess doesn't prevent the gateway from exiting
      proc.unref?.();
    });
  }
}
