import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ForwardRequest, ForwardResult, ForwardTransport } from "./forward.js";
import { logRelay } from "./logger.js";

export interface GatewayForwardConfig {
  orchestratorSessionKey: string;
  timeoutMs?: number;
}

export function buildRelayTriggerMessage(request: ForwardRequest): string {
  return [
    `[System Message] [relay-dispatch: ${request.dispatchId}] Relay task for ${request.targetAgentId} completed.`,
    "",
    "Result:",
    request.content,
    "",
    `[relay_dispatch_id:${request.dispatchId}]`,
    `[relay_subagent_message_id:${request.subagentMessageId}]`,
    "",
    "Reply based on the result above. If multiple relay tasks are outstanding, wait for all to complete before synthesizing."
  ].join("\n");
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
    const triggerMessage = buildRelayTriggerMessage(request);
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
      deliver: false,
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
        timeout: timeoutMs + 5_000,
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
