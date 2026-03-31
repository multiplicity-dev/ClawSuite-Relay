import { Type } from "@sinclair/typebox";
import { relay_dispatch } from "./index.js";
import type { RelayTransport } from "./transport.js";

const parameters = Type.Object({
  targetAgentId: Type.String({
    description:
      "The relay-bound agent to dispatch to (must have a webhook mapping configured)."
  }),
  task: Type.String({
    description:
      "The full task prompt to relay to the target subagent's channel."
  }),
  requestId: Type.Optional(
    Type.String({
      description:
        "Optional idempotency key. Reusing a live requestId is blocked with DISPATCH_IN_FLIGHT; use a fresh unique value for each intended new dispatch."
    })
  )
});

/**
 * Returns an OpenClawPluginToolFactory — a function that receives
 * OpenClawPluginToolContext (including the caller's sessionKey) and
 * produces the relay_dispatch tool. This lets us capture the
 * orchestrator's sessionKey at dispatch time for later internal delivery.
 */
export function createRelayDispatchToolFactory(transport: RelayTransport | undefined) {
  return (ctx: { sessionKey?: string; agentId?: string }) => {
    const orchestratorSessionKey = ctx.sessionKey;
    return {
      name: "relay_dispatch",
      label: "Relay Dispatch",
      description:
        "Dispatch a task to a relay-bound agent via their dedicated Discord channel. " +
        "The task is posted to the agent channel, and the agent's response is automatically " +
        "captured and forwarded back. Use this for relay-bound agent tasks that benefit " +
        "from persistent channel context and visible prompt/response audit trails.",
      parameters,

      async execute(
        _toolCallId: string,
        params: Record<string, unknown>
      ): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
        const targetAgentId =
          typeof params.targetAgentId === "string" ? params.targetAgentId : "";
        const task = typeof params.task === "string" ? params.task : "";
        const requestId =
          typeof params.requestId === "string" ? params.requestId : undefined;

        const result = await relay_dispatch(
          { targetAgentId, task, requestId },
          { transport, orchestratorSessionKey, orchestratorAgentId: ctx.agentId }
        );

        const text =
          result.status === "accepted"
            ? /idempotent replay/i.test(result.message)
              ? `Relay dispatch accepted as idempotent replay (dispatchId: ${result.dispatchId}). No new message was posted to ${targetAgentId}; this reused a previously completed dispatch for the same requestId.`
              : `Relay dispatch accepted (dispatchId: ${result.dispatchId}). Task posted to ${targetAgentId} channel. Response will be forwarded automatically.`
            : result.code === "DISPATCH_IN_FLIGHT"
              ? `Relay dispatch blocked: a dispatch with this requestId is already in flight for ${targetAgentId} (dispatchId: ${result.dispatchId}). No new message was posted. Wait for that result, or retry with a fresh unique requestId if you intend a new dispatch.`
              : `Relay dispatch ${result.status}: ${result.message}${result.code ? ` [${result.code}]` : ""}${result.retryable ? " (retryable)" : ""}`;

        return {
          content: [{ type: "text", text }],
          details: {
            status: result.status,
            dispatchId: result.dispatchId,
            code: result.code,
            retryable: result.retryable
          }
        };
      }
    };
  };
}
