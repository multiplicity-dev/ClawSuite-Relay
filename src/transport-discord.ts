import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";
import type { ForwardRequest, ForwardResult, ForwardTransport } from "./forward.js";

interface DiscordRelayConfig {
  botToken: string;
  channelsByAgent: Record<string, string>;
  mentionsByAgent?: Record<string, string>;
  orchestratorChannelId?: string;
}

const DISCORD_MAX_CONTENT = 2000;
const SNOWFLAKE_RE = /^\d{17,20}$/;

function validateSnowflake(value: string | undefined, label: string) {
  if (!value || !SNOWFLAKE_RE.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

async function postDiscordMessage(
  botToken: string,
  channelId: string,
  content: string
): Promise<{ id: string }> {
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ content })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord post failed (${response.status}): ${text}`);
  }

  return (await response.json()) as { id: string };
}

export function buildRelayContent(request: RelayPostRequest, mentionUserId?: string): string {
  const mention = mentionUserId ? `<@${mentionUserId}>\n` : "";
  const marker = `\n\n[relay_dispatch_id:${request.dispatchId}]`;
  return `${mention}${request.task}${marker}`;
}

export function buildForwardContent(request: ForwardRequest): string {
  return [
    `Subagent response received for ${request.targetAgentId}.`,
    "",
    request.content,
    "",
    `[relay_dispatch_id:${request.dispatchId}]`,
    `[relay_subagent_message_id:${request.subagentMessageId}]`
  ].join("\n");
}

export class DiscordRelayTransport implements RelayTransport {
  constructor(private readonly cfg: DiscordRelayConfig) {}

  async postToChannel(request: RelayPostRequest): Promise<RelayPostResult> {
    const channelId = this.cfg.channelsByAgent[request.targetAgentId];
    if (!channelId) throw new Error(`No channel mapping for ${request.targetAgentId}`);
    validateSnowflake(channelId, `Discord channel id for ${request.targetAgentId}`);

    const mentionUserId = this.cfg.mentionsByAgent?.[request.targetAgentId];
    if (mentionUserId) validateSnowflake(mentionUserId, `mention user id for ${request.targetAgentId}`);

    const content = buildRelayContent(request, mentionUserId);
    if (content.length > DISCORD_MAX_CONTENT) {
      throw new Error(`Payload too long for Discord (${content.length} > ${DISCORD_MAX_CONTENT})`);
    }

    const json = await postDiscordMessage(this.cfg.botToken, channelId, content);
    return { messageId: json.id };
  }
}

export class DiscordForwardTransport implements ForwardTransport {
  constructor(private readonly cfg: DiscordRelayConfig) {}

  async forwardToOrchestrator(request: ForwardRequest): Promise<ForwardResult> {
    const channelId = this.cfg.orchestratorChannelId;
    if (!channelId) throw new Error("Missing orchestrator channel id");
    validateSnowflake(channelId, "orchestrator channel id");

    const content = buildForwardContent(request);
    if (content.length > DISCORD_MAX_CONTENT) {
      throw new Error(`Forward payload too long for Discord (${content.length} > ${DISCORD_MAX_CONTENT})`);
    }

    const json = await postDiscordMessage(this.cfg.botToken, channelId, content);
    return { messageId: json.id };
  }
}

function parseJsonEnv<T>(raw: string, envName: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in ${envName}`);
  }
}

export function transportFromEnv(): DiscordRelayTransport {
  const botToken = process.env.CLAWSUITE_RELAY_BOT_TOKEN;
  const rawChannels = process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON;
  const rawMentions = process.env.CLAWSUITE_RELAY_MENTION_MAP_JSON;

  if (!botToken) throw new Error("Missing CLAWSUITE_RELAY_BOT_TOKEN");
  if (!rawChannels) throw new Error("Missing CLAWSUITE_RELAY_CHANNEL_MAP_JSON");

  const channelsByAgent = parseJsonEnv<Record<string, string>>(
    rawChannels,
    "CLAWSUITE_RELAY_CHANNEL_MAP_JSON"
  );
  const mentionsByAgent = rawMentions
    ? parseJsonEnv<Record<string, string>>(rawMentions, "CLAWSUITE_RELAY_MENTION_MAP_JSON")
    : undefined;

  return new DiscordRelayTransport({ botToken, channelsByAgent, mentionsByAgent });
}

export function forwardTransportFromEnv(): DiscordForwardTransport {
  const botToken = process.env.CLAWSUITE_RELAY_BOT_TOKEN;
  const orchestratorChannelId = process.env.CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID;

  if (!botToken) throw new Error("Missing CLAWSUITE_RELAY_BOT_TOKEN");
  if (!orchestratorChannelId) throw new Error("Missing CLAWSUITE_RELAY_ORCHESTRATOR_CHANNEL_ID");

  return new DiscordForwardTransport({
    botToken,
    channelsByAgent: {},
    orchestratorChannelId
  });
}
