import { captureSubagentResponse, captureOutboundResponse } from "./capture.js";
import { shouldSuppressTransientGeneralAnnounce } from "./announce-filter.js";
import { transportFromEnv, forwardTransportFromEnv } from "./transport-discord.js";
import { createRelayDispatchTool } from "./relay-dispatch-tool.js";

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

function resolveMessageId(event: any): string | undefined {
  return asString(event?.metadata?.messageId) ?? asString(event?.id) ?? asString(event?.messageId);
}

function resolveReferencedMessageId(event: any): string | undefined {
  return (
    asString(event?.metadata?.referencedMessageId) ??
    asString(event?.metadata?.replyToMessageId) ??
    asString(event?.replyToMessageId)
  );
}

function resolveRelatedSubagentMessageId(event: any): string | undefined {
  return asString(event?.metadata?.relatedSubagentMessageId) ?? asString(event?.relatedSubagentMessageId);
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

  let forwardTransport;
  try {
    forwardTransport = forwardTransportFromEnv();
  } catch (err) {
    api.logger.warn?.(`clawsuite-relay: forward transport not configured (${String(err)})`);
    forwardTransport = undefined;
  }

  // Build reverse channel map for outbound response capture.
  let reverseChannelMap: Record<string, string> = {};
  try {
    const rawChannels = process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON;
    if (rawChannels) {
      const channelMap = JSON.parse(rawChannels) as Record<string, string>;
      for (const [agentId, channelId] of Object.entries(channelMap)) {
        reverseChannelMap[channelId] = agentId;
      }
    }
  } catch {
    // channel map parsing handled by transportFromEnv; no-op here
  }

  // Register relay_dispatch as a tool the orchestrator can call.
  api.registerTool(createRelayDispatchTool(relayTransport));

  // Capture subagent responses from outgoing messages (message_sent).
  // This is the primary capture path: when OpenClaw posts a subagent's response
  // in a relay channel, we forward it to the orchestrator.
  api.on("message_sent", async (event, ctx) => {
    if (ctx.channelId !== "discord") return;
    if (!relayEnabled) return;
    if (event?.success === false) return;

    const targetChannelId = asString(event?.to) ?? asString(ctx?.conversationId);
    if (!targetChannelId) return;

    const targetAgentId = reverseChannelMap[targetChannelId];
    if (!targetAgentId) return;

    const content = asString(event?.content);
    if (!content) return;

    try {
      const result = await captureOutboundResponse(
        { targetAgentId, content },
        { forwardTransport }
      );

      if (result.status === "processed") {
        api.logger.info?.(`clawsuite-relay: captured outbound response for dispatch ${result.dispatchId}`);
      }
    } catch (err) {
      api.logger.warn?.(`clawsuite-relay: outbound capture exception (${String(err)})`);
    }
  });

  // Capture subagent replies from Discord inbound messages (fallback path).
  api.on("message_received", async (event, ctx) => {
    if (ctx.channelId !== "discord") return;
    if (!relayEnabled) return;

    const channelId = resolveChannelId(event, ctx);
    const messageId = resolveMessageId(event);
    const content = asString(event?.content) ?? "";
    if (!channelId || !messageId || !content) return;

    try {
      const result = await captureSubagentResponse(
        {
          channelId,
          messageId,
          content,
          referencedMessageId: resolveReferencedMessageId(event)
        },
        { forwardTransport }
      );

      if (result.status === "processed") {
        api.logger.info?.(`clawsuite-relay: captured dispatch ${result.dispatchId}`);
      }
      if (result.status === "failed") {
        api.logger.warn?.(`clawsuite-relay: capture failed for dispatch ${result.dispatchId}`);
      }
    } catch (err) {
      api.logger.warn?.(`clawsuite-relay: unexpected capture exception (${String(err)})`);
    }
  });

  // Suppress transient redundant announces in orchestrator channel when relay mode is active.
  api.on("message_sending", async (event, ctx) => {
    if (ctx.channelId !== "discord") return;

    const channelId = resolveChannelId(event, ctx);
    const content = asString(event?.content) ?? "";
    if (!channelId || !content) return;

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
