import { relay_dispatch } from "./index.js";
import { isValidDispatchId } from "./state.js";
import type { RelayTransport } from "./transport.js";

export function createRelayDispatchTool(transport: RelayTransport) {
  return {
    name: "relay_dispatch",
    description:
      "Dispatch work from orchestrator to a mapped subagent channel via relay bridge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetAgentId: { type: "string" },
        task: { type: "string" },
        requestId: { type: "string" },
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            priority: { type: "string" },
            replyMode: { type: "string" }
          }
        }
      },
      required: ["targetAgentId", "task"]
    },
    async execute(args: any) {
      const result = await relay_dispatch(args, { transport });

      // Hard fail if accepted without a real dispatchId.
      if (result.status === "accepted" && (!result.dispatchId || !isValidDispatchId(result.dispatchId))) {
        return {
          status: "failed",
          dispatchId: null,
          targetAgentId: args?.targetAgentId ?? null,
          code: "INVALID_DISPATCH_ID",
          message:
            "relay_dispatch returned accepted without a valid dispatchId; treating as failure",
          retryable: false
        };
      }

      return {
        status: result.status,
        dispatchId: result.dispatchId ?? null,
        targetAgentId: args?.targetAgentId ?? null,
        code: result.code ?? null,
        message: result.message,
        retryable: result.retryable
      };
    }
  };
}
