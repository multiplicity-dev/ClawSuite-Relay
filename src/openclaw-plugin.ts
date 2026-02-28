import { shouldSuppressTransientGeneralAnnounce } from "./announce-filter.js";
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

function resolveChannelId(event: any, ctx: any): string | undefined {
  return asString(event?.metadata?.channelId) ?? asString(ctx?.conversationId) ?? asString(event?.to);
}

function isDiscordHookContext(event: any, ctx: any): boolean {
  const candidates = [
    asString(ctx?.channelId),
    asString(event?.channel),
    asString(event?.metadata?.channel),
    asString(event?.metadata?.provider)
  ];
  return candidates.some((c) => c === "discord");
}

function resolveRelatedSubagentMessageId(event: any): string | undefined {
  return asString(event?.metadata?.relatedSubagentMessageId) ?? asString(event?.relatedSubagentMessageId);
}

function resolveOutboundContent(event: any): string {
  const candidates = [
    asString(event?.content),
    asString(event?.text),
    asString(event?.metadata?.content),
    asString(event?.payload?.content),
    asString(event?.message?.content),
    asString(event?.components?.text)
  ].filter(Boolean) as string[];

  if (candidates.length > 0) return candidates[0]!;

  const texts = event?.components?.texts;
  if (Array.isArray(texts)) {
    const joined = texts.map((t: unknown) => asString(t)).filter(Boolean).join("\n");
    if (joined.trim()) return joined;
  }

  return "";
}

export default function register(api: PluginApi) {
  const relayEnabled = process.env.CLAWSUITE_RELAY_ENABLED !== "0";
  const orchestratorChannelId = process.env.CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID;

  let relayTransport;
  try {
    relayTransport = transportFromEnv();
  } catch (err) {
    api.logger.warn?.(`clawsuite-relay: relay transport not configured (${String(err)})`);
    relayTransport = undefined;
  }

  // Build channel map for agent ID → channel ID lookups (used by llm_output hook).
  let channelMap: Record<string, string> = {};
  try {
    const rawChannels = process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON;
    if (rawChannels) {
      channelMap = JSON.parse(rawChannels) as Record<string, string>;
    }
  } catch {
    // channel map parsing handled by transportFromEnv; no-op here
  }

  // Register relay_dispatch as a tool factory — the factory receives
  // OpenClawPluginToolContext (including the orchestrator's sessionKey)
  // so we can store it in the armed dispatch for later internal delivery.
  api.registerTool(createRelayDispatchToolFactory(relayTransport));

  const armTtlMs = Number(process.env.CLAWSUITE_RELAY_ARM_TTL_MS || 300000);

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
    if (!Object.prototype.hasOwnProperty.call(channelMap, targetAgentId)) return;

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

  // Announce suppression: cancel transient redundant announces in orchestrator channel.
  api.on("message_sending", async (event, ctx) => {
    if (!isDiscordHookContext(event, ctx)) return;

    const channelId = resolveChannelId(event, ctx);
    if (!channelId) return;

    const content = resolveOutboundContent(event);

    const suppress = await shouldSuppressTransientGeneralAnnounce(
      {
        channelId,
        content,
        relatedSubagentMessageId: resolveRelatedSubagentMessageId(event)
      },
      {
        relayEnabled,
        orchestratorChannelId
      }
    );

    if (suppress) {
      api.logger.info?.("clawsuite-relay: suppressed transient orchestrator announce");
      return { cancel: true };
    }
  });
}
