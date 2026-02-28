import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ForwardRequest, ForwardResult, ForwardTransport } from "./forward.js";
import { type RelayEnvelope, serializeForGateway } from "./envelope.js";
import { logRelay } from "./logger.js";

export interface GatewayForwardConfig {
  orchestratorSessionKey: string;
  orchestratorAgentId?: string;
  timeoutMs?: number;
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

/**
 * Delivers subagent results to the orchestrator's session via
 * `openclaw gateway call agent`, which calls callGateway({ method: "agent" })
 * internally. This matches the delivery path used by
 * sendSubagentAnnounceDirectly in normal sessions_spawn flows.
 *
 * Uses `gateway call` (raw RPC) instead of `openclaw agent` because
 * `agent --session-id` expects a UUID, not a session key. The raw RPC
 * call passes sessionKey in params directly, matching the native announce path.
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
      idempotencyKey: deliveryId
    });

    return new Promise<ForwardResult>((resolve, reject) => {
      const args = [
        "gateway", "call", "agent",
        "--params", params,
        "--expect-final",
        "--timeout", String(timeoutMs),
        "--json"
      ];

      const proc = execFile("openclaw", args, {
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
