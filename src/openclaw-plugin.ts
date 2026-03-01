import { transportFromEnv } from "./transport-discord.js";
import { createRelayDispatchToolFactory } from "./relay-dispatch-tool.js";
import { clearArmedDispatch, getArmedDispatch, loadDispatch, updateDispatch } from "./state.js";
import { GatewayForwardTransport } from "./transport-gateway.js";

interface PluginApi {
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void };
  on: (hookName: string, handler: (event: any, ctx: any) => Promise<any> | any) => void;
  registerTool: (tool: any, opts?: { optional?: boolean }) => void;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export default function register(api: PluginApi) {
  const relayEnabled = process.env.CLAWSUITE_RELAY_ENABLED !== "0";

  let relayTransport;
  try {
    relayTransport = transportFromEnv();
  } catch (err) {
    api.logger.warn?.(`clawsuite-relay: relay transport not configured (${String(err)})`);
    relayTransport = undefined;
  }

  // Build webhook map for target-agent membership checks (used by llm_output hook).
  let webhookMap: Record<string, string> = {};
  try {
    const rawWebhooks = process.env.CLAWSUITE_RELAY_WEBHOOK_MAP_JSON;
    if (rawWebhooks) {
      webhookMap = JSON.parse(rawWebhooks) as Record<string, string>;
    }
  } catch {
    // webhook map parsing handled by transportFromEnv; no-op here
  }

  // Register relay_dispatch as a tool factory — the factory receives
  // OpenClawPluginToolContext (including the orchestrator's sessionKey)
  // so we can store it in the armed dispatch for later internal delivery.
  api.registerTool(createRelayDispatchToolFactory(relayTransport));

  const armTtlMs = Number(process.env.CLAWSUITE_RELAY_ARM_TTL_MS || 1800000);

  async function disarmDispatch(agentId: string, dispatchId?: string) {
    if (!dispatchId) {
      await clearArmedDispatch(agentId);
      return;
    }
    const armed = await getArmedDispatch(agentId);
    if (!armed) return;
    if (armed.dispatchId === dispatchId) {
      await clearArmedDispatch(agentId);
    }
  }

  // Primary capture + delivery path: llm_output fires once per agent run
  // (after agent_end) with pre-extracted assistantTexts[]. We take the LAST
  // entry only, matching what the completion announce delivers.
  //
  // Delivery is INTERNAL ONLY via gateway injection (path b). The subagent's
  // response still posts to its own Discord channel via normal OpenClaw
  // message_sending (path a). We do NOT mirror to #general — that was the
  // "wrong vehicle" identified in layer-disambiguation.md.
  api.on("llm_output", async (event, ctx) => {
    if (!relayEnabled) return;
    const targetAgentId = asString(ctx?.agentId);
    if (!targetAgentId) return;
    if (!Object.prototype.hasOwnProperty.call(webhookMap, targetAgentId)) return;

    const armed = await getArmedDispatch(targetAgentId);
    if (!armed) return;

    // TTL check
    const ts = Date.parse(armed.armedAt || "");
    if (!Number.isNaN(ts) && Date.now() - ts > armTtlMs) {
      await clearArmedDispatch(targetAgentId);
      return;
    }

    const armedDispatchId = armed.dispatchId;

    const texts = Array.isArray((event as any)?.assistantTexts)
      ? ((event as any).assistantTexts as string[])
      : [];
    const lastText = texts.length > 0 ? texts[texts.length - 1] : "";
    if (!lastText?.trim()) return;

    api.logger.info?.(
      `clawsuite-relay: llm_output fired for ${targetAgentId} dispatch=${armedDispatchId} texts=${texts.length} lastLen=${lastText.length}`
    );

    try {
      // Path (b): Gateway internal delivery to orchestrator session.
      // This is the sole delivery mechanism — no Discord mirror.
      if (armed.orchestratorSessionKey) {
        const gatewayTransport = new GatewayForwardTransport({
          orchestratorSessionKey: armed.orchestratorSessionKey,
          orchestratorAgentId: armed.orchestratorAgentId
        });
        const gwResult = await gatewayTransport.forwardToOrchestrator({
          dispatchId: armedDispatchId,
          targetAgentId,
          subagentMessageId: armedDispatchId,
          content: lastText,
          subagentSessionKey: asString(ctx?.sessionKey)
        });
        api.logger.info?.(
          `clawsuite-relay: llm_output gateway delivery dispatch=${armedDispatchId} id=${gwResult.messageId}`
        );
      } else {
        api.logger.warn?.(
          `clawsuite-relay: llm_output no orchestratorSessionKey for dispatch=${armedDispatchId}, skipping gateway delivery`
        );
      }

      // Update dispatch state to completed and disarm.
      const dispatch = await loadDispatch(armedDispatchId);
      if (dispatch && (dispatch.state === "POSTED_TO_CHANNEL" || dispatch.state === "SUBAGENT_RESPONDED")) {
        await updateDispatch({ ...dispatch, state: "COMPLETED" });
      }
      await disarmDispatch(targetAgentId, armedDispatchId);
    } catch (err) {
      api.logger.warn?.(
        `clawsuite-relay: llm_output capture error (${String(err)})`
      );
    }
  });
}
