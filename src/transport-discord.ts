import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";

interface DiscordRelayConfig {
  botToken: string;
  channelsByAgent: Record<string, string>;
  mentionsByAgent?: Record<string, string>;
}

export class DiscordRelayTransport implements RelayTransport {
  constructor(private readonly cfg: DiscordRelayConfig) {}

  async postToChannel(request: RelayPostRequest): Promise<RelayPostResult> {
    const channelId = this.cfg.channelsByAgent[request.targetAgentId];
    if (!channelId) throw new Error(`No channel mapping for ${request.targetAgentId}`);

    const mentionUserId = this.cfg.mentionsByAgent?.[request.targetAgentId];
    const mention = mentionUserId ? `<@${mentionUserId}>\n` : "";
    const content = `${mention}${request.task}`;

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

export function transportFromEnv(): DiscordRelayTransport {
  const botToken = process.env.CLAWSUITE_RELAY_BOT_TOKEN;
  const rawChannels = process.env.CLAWSUITE_RELAY_CHANNEL_MAP_JSON;
  const rawMentions = process.env.CLAWSUITE_RELAY_MENTION_MAP_JSON;

  if (!botToken) throw new Error("Missing CLAWSUITE_RELAY_BOT_TOKEN");
  if (!rawChannels) throw new Error("Missing CLAWSUITE_RELAY_CHANNEL_MAP_JSON");

  const channelsByAgent = JSON.parse(rawChannels) as Record<string, string>;
  const mentionsByAgent = rawMentions
    ? (JSON.parse(rawMentions) as Record<string, string>)
    : undefined;

  return new DiscordRelayTransport({ botToken, channelsByAgent, mentionsByAgent });
}
