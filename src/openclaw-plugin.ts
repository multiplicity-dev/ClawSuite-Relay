import { captureSubagentResponse } from "./capture.js";
import { shouldSuppressTransientGeneralAnnounce } from "./announce-filter.js";
import { forwardTransportFromEnv } from "./transport-discord.js";

interface PluginApi {
  logger: { info?: (msg: string) => void; warn?: (msg: string) => void };
  on: (hookName: string, handler: (event: any, ctx: any) => Promise<any> | any) => void;
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

  let forwardTransport;
  try {
    forwardTransport = forwardTransportFromEnv();
  } catch (err) {
    api.logger.warn?.(`clawsuite-relay: forward transport not configured (${String(err)})`);
    forwardTransport = undefined;
  }

  // Capture subagent replies from Discord inbound messages.
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
