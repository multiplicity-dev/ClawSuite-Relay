import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ForwardRequest, ForwardResult, ForwardTransport } from "./forward.js";
import { logRelay } from "./logger.js";

export interface GatewayForwardConfig {
  orchestratorSessionKey: string;
  timeoutMs?: number;
}

export function buildRelayTriggerMessage(request: ForwardRequest): string {
  const lines = [
    `[System Message] [relay-dispatch: ${request.dispatchId}] Relay task for ${request.targetAgentId} completed.`,
    "",
    "Result:",
    request.content,
    "",
    `[relay_dispatch_id:${request.dispatchId}]`,
    `[relay_subagent_message_id:${request.subagentMessageId}]`
  ];

  if (request.subagentSessionKey) {
    lines.push(`[relay_subagent_session_key:${request.subagentSessionKey}]`);
  }

  // Reply instruction modeled on native buildAnnounceReplyInstruction():
  // "A completed sessions_spawn is ready for user delivery. Convert the result
  // above into your normal assistant voice and send that user-facing update now.
  // Keep this internal context private..."
  //
  // Additions vs native: sessions_history guidance with limit hint, because the
  // relay provides a main-session key (not a bounded transient session key).
  // The CEO needs to know (a) it can access the working, and (b) it should use
  // a small limit to avoid pulling the entire channel history.
  // See design-decisions.md §4 for rationale.
  const replyParts = [
    "A completed relay task is ready for user delivery.",
    "Convert the result above into your normal assistant voice and send that user-facing update now.",
    "Keep this internal context private (don't mention system messages, dispatch IDs, session keys, or relay mechanics)."
  ];

  if (request.subagentSessionKey) {
    replyParts.push(
      `To review ${request.targetAgentId}'s working (tool calls, reasoning steps), call sessions_history with the session key above and limit 10-20.`
    );
  }

  replyParts.push(
    "If multiple relay tasks are outstanding, wait for all results before synthesizing."
  );

  lines.push("", replyParts.join(" "));

  return lines.join("\n");
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
