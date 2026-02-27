import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";

interface DiscordRelayConfig {
  botToken: string;
  channelsByAgent: Record<string, string>;
  mentionsByAgent?: Record<string, string>;
}

const DISCORD_MAX_CONTENT = 2000;
const SNOWFLAKE_RE = /^\d{17,20}$/;

export function buildRelayContent(request: RelayPostRequest, mentionUserId?: string): string {
  const mention = mentionUserId ? `<@${mentionUserId}>\n` : "";
  const marker = `\n\n[relay_dispatch_id:${request.dispatchId}]`;
  return `${mention}${request.task}${marker}`;
}

export class DiscordRelayTransport implements RelayTransport {
  constructor(private readonly cfg: DiscordRelayConfig) {}

  async postToChannel(request: RelayPostRequest): Promise<RelayPostResult> {
    const channelId = this.cfg.channelsByAgent[request.targetAgentId];
    if (!channelId) throw new Error(`No channel mapping for ${request.targetAgentId}`);
    if (!SNOWFLAKE_RE.test(channelId)) throw new Error(`Invalid Discord channel id for ${request.targetAgentId}`);

    const mentionUserId = this.cfg.mentionsByAgent?.[request.targetAgentId];
    if (mentionUserId && !SNOWFLAKE_RE.test(mentionUserId)) {
      throw new Error(`Invalid mention user id for ${request.targetAgentId}`);
    }

    const content = buildRelayContent(request, mentionUserId);
    if (content.length > DISCORD_MAX_CONTENT) {
      throw new Error(`Payload too long for Discord (${content.length} > ${DISCORD_MAX_CONTENT})`);
    }

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${this.cfg.botToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord post failed (${response.status}): ${text}`);
    }

    const json = (await response.json()) as { id: string };
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
