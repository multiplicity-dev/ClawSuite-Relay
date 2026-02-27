import { captureSubagentResponse, captureOutboundResponse } from "./capture.js";
import { shouldSuppressTransientGeneralAnnounce } from "./announce-filter.js";
import { transportFromEnv, forwardTransportFromEnv } from "./transport-discord.js";
import { createRelayDispatchTool } from "./relay-dispatch-tool.js";
import { clearArmedDispatch, getArmedDispatch } from "./state.js";

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

function resolveAuthorId(event: any): string | undefined {
  return (
    asString(event?.metadata?.authorId) ??
    asString(event?.authorId) ??
    asString(event?.author?.id)
  );
}

function deriveDiscordBotUserIdFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const head = token.split(".")[0];
  if (!head) return undefined;
  try {
    const normalized = head.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return /^\d+$/.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
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

function previewEventShape(event: any): string {
  const obj = {
    topKeys: Object.keys(event || {}),
    hasContent: typeof event?.content === "string",
    hasText: typeof event?.text === "string",
    metadataKeys: event?.metadata ? Object.keys(event.metadata) : [],
    componentKeys: event?.components ? Object.keys(event.components) : []
  };
  return JSON.stringify(obj);
}

function extractAssistantTextFromAgentMessage(message: any): string {
  const direct = asString(message?.content) ?? asString(message?.text);
  if (direct) return direct;

  if (Array.isArray(message?.content)) {
    const joined = message.content
      .map((part: any) => asString(part?.text) ?? asString(part?.content) ?? asString(part))
      .filter(Boolean)
      .join("\n");
    if (joined.trim()) return joined;
  }

  if (Array.isArray(message?.parts)) {
    const joined = message.parts
      .map((part: any) => asString(part?.text) ?? asString(part?.content))
      .filter(Boolean)
      .join("\n");
    if (joined.trim()) return joined;
  }

  return "";
}

function extractCurrentTurnContent(messages: any[]): string {
  // Find the start of the current turn: walk backward to the last plain user
  // message (the relay prompt). Everything after it is the current turn.
  let turnStart = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = asString(messages[i]?.role);
    if (role === "user") {
      turnStart = i + 1;
      break;
    }
  }

  const sections: string[] = [];
  for (let i = turnStart; i < messages.length; i++) {
    const msg = messages[i];
    const role = asString(msg?.role);

    // OpenClaw uses "toolResult", OpenAI uses "tool". Content can be string or array.
    if (role === "toolResult" || role === "tool") {
      const text = extractAssistantTextFromAgentMessage(msg);
      if (text) sections.push(text);
      continue;
    }

    if (role === "assistant") {
      const text = extractAssistantTextFromAgentMessage(msg);
      if (text) sections.push(text);
      continue;
    }
  }

  return sections.join("\n\n");
}

export default function register(api: PluginApi) {
  const relayEnabled = process.env.CLAWSUITE_RELAY_ENABLED !== "0";
  const debugOutbound = process.env.CLAWSUITE_RELAY_DEBUG_OUTBOUND === "1";
  const orchestratorChannelId = process.env.CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID;
  const relayBotUserId = deriveDiscordBotUserIdFromToken(process.env.CLAWSUITE_RELAY_BOT_TOKEN);

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

  // Build channel maps for outbound response capture.
  let channelMap: Record<string, string> = {};
  let reverseChannelMap: Record<string, string> = {};
  try {
    const rawChannels = process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON;
    if (rawChannels) {
      channelMap = JSON.parse(rawChannels) as Record<string, string>;
      for (const [agentId, channelId] of Object.entries(channelMap)) {
        reverseChannelMap[channelId] = agentId;
      }
    }
  } catch {
    // channel map parsing handled by transportFromEnv; no-op here
  }

  // Register relay_dispatch as a tool the orchestrator can call.
  api.registerTool(createRelayDispatchTool(relayTransport));

  api.logger.info?.(`clawsuite-relay: reverse channel map: ${JSON.stringify(reverseChannelMap)}`);

  const armTtlMs = Number(process.env.CLAWSUITE_RELAY_ARM_TTL_MS || 300000);

  async function getArmedDispatchId(agentId: string): Promise<string | undefined> {
    const armed = await getArmedDispatch(agentId);
    if (!armed) return undefined;
    const ts = Date.parse(armed.armedAt || "");
    if (!Number.isNaN(ts) && Date.now() - ts > armTtlMs) {
      await clearArmedDispatch(agentId);
      return undefined;
    }
    return armed.dispatchId;
  }

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

  // Capture subagent replies from Discord inbound messages (fallback path for external bots).
  api.on("message_received", async (event, ctx) => {
    if (!isDiscordHookContext(event, ctx)) return;
    if (!relayEnabled) return;

    if (debugOutbound) {
      api.logger.info?.(`clawsuite-relay: message_received ctx=${JSON.stringify({ channelId: ctx?.channelId, conversationId: ctx?.conversationId, eventChannel: event?.channel, metaChannel: event?.metadata?.channel, metaProvider: event?.metadata?.provider })}`);
    }

    const channelId = resolveChannelId(event, ctx);
    const messageId = resolveMessageId(event);
    const content = asString(event?.content) ?? "";
    if (!channelId || !messageId || !content) return;

    // Ignore relay bot authored messages and forwarded envelopes to avoid echo loops.
    const authorId = resolveAuthorId(event);
    if (relayBotUserId && authorId === relayBotUserId) return;
    if (content.includes("[relay_subagent_message_id:")) return;
    if (content.startsWith("Subagent response received for ")) return;

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

  // Primary capture path: agent_end fires once per agent turn with the full
  // message array. Extracts ALL session content (tool results + assistant text),
  // not just the final Discord-visible response.
  api.on("agent_end", async (event, ctx) => {
    if (!relayEnabled) return;
    const targetAgentId = asString(ctx?.agentId);
    if (!targetAgentId) return;
    if (!Object.prototype.hasOwnProperty.call(channelMap, targetAgentId)) return;

    const armedDispatchId = await getArmedDispatchId(targetAgentId);
    if (!armedDispatchId) return;

    const msgs = Array.isArray((event as any)?.messages) ? ((event as any).messages as any[]) : [];
    const content = extractCurrentTurnContent(msgs);
    if (!content) return;

    try {
      const result = await captureOutboundResponse(
        { targetAgentId, content, dispatchId: armedDispatchId },
        { forwardTransport }
      );
      if (result.status === "processed") {
        api.logger.info?.(`clawsuite-relay: agent_end captured dispatch ${result.dispatchId} content_len=${content.length}`);
        await disarmDispatch(targetAgentId, result.dispatchId);
      }
      if (result.status === "failed") {
        api.logger.warn?.(`clawsuite-relay: agent_end capture failed for dispatch ${result.dispatchId}`);
      }
    } catch (err) {
      api.logger.warn?.(`clawsuite-relay: agent_end capture error (${String(err)})`);
    }
  });

  // Outbound capture + announce suppression (single modifying hook).
  api.on("message_sending", async (event, ctx) => {
    if (!isDiscordHookContext(event, ctx)) return;

    const channelId = resolveChannelId(event, ctx);
    if (!channelId) return;

    const content = resolveOutboundContent(event);

    if (debugOutbound) {
      api.logger.info?.(
        `clawsuite-relay: message_sending debug channel=${channelId} content_len=${content.length} shape=${previewEventShape(event)}`
      );
    }

    // Outbound capture: if this message is going to a subagent channel with
    // a pending dispatch, capture the response and forward to orchestrator.
    // We do NOT cancel — the subagent's message still posts normally.
    if (relayEnabled) {
      const targetAgentId = reverseChannelMap[channelId];
      if (targetAgentId) {
        if (!content) {
          api.logger.warn?.(
            `clawsuite-relay: outbound candidate for ${targetAgentId} had empty content (channel=${channelId})`
          );
        } else {
          try {
            const result = await captureOutboundResponse(
              { targetAgentId, content },
              { forwardTransport }
            );
            if (result.status === "processed") {
              api.logger.info?.(`clawsuite-relay: outbound capture forwarded dispatch ${result.dispatchId}`);
            }
            if (result.status === "failed") {
              api.logger.warn?.(`clawsuite-relay: outbound capture failed for dispatch ${result.dispatchId}`);
            }
          } catch (err) {
            api.logger.warn?.(`clawsuite-relay: outbound capture error (${String(err)})`);
          }
        }
      }
    }

    // Suppress transient redundant announces in orchestrator channel.
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
