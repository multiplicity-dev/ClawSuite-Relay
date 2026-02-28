import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";
import { type RelayEnvelope, serializeForDiscord } from "./envelope.js";

interface DiscordRelayConfig {
  botToken: string;
  channelsByAgent: Record<string, string>;
  mentionsByAgent?: Record<string, string>;
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

export function buildRelayContent(request: RelayPostRequest, opts?: { mentionUserId?: string; sourceAgentId?: string }): string {
  const envelope: RelayEnvelope = {
    source: opts?.sourceAgentId ?? "relay",
    target: request.targetAgentId,
    dispatchId: request.dispatchId,
    createdAt: new Date().toISOString(),
    type: "dispatch",
    content: request.task
  };

  return serializeForDiscord(envelope, { mentionUserId: opts?.mentionUserId });
}

/**
 * Split text into chunks that each fit within maxLen characters.
 * Prefers splitting at paragraph boundaries (\n\n), falls back to
 * line breaks (\n), then hard-splits at maxLen.
 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n\n", maxLen);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.trim()) chunks.push(remaining);
  return chunks;
}

export class DiscordRelayTransport implements RelayTransport {
  constructor(private readonly cfg: DiscordRelayConfig) {}

  async postToChannel(request: RelayPostRequest): Promise<RelayPostResult> {
    const channelId = this.cfg.channelsByAgent[request.targetAgentId];
    if (!channelId) throw new Error(`No channel mapping for ${request.targetAgentId}`);
    validateSnowflake(channelId, `Discord channel id for ${request.targetAgentId}`);

    const mentionUserId = this.cfg.mentionsByAgent?.[request.targetAgentId];
    if (mentionUserId) validateSnowflake(mentionUserId, `mention user id for ${request.targetAgentId}`);

    const content = buildRelayContent(request, { mentionUserId, sourceAgentId: request.sourceAgentId });

    // Single message if it fits
    if (content.length <= DISCORD_MAX_CONTENT) {
      const json = await postDiscordMessage(this.cfg.botToken, channelId, content);
      return { messageId: json.id };
    }

    // Multi-message: split the task content, prepend mention to first chunk,
    // append envelope footer to last chunk.
    const mentionPrefix = mentionUserId ? `<@${mentionUserId}>\n` : "";
    const footer = `\n\n[relay_dispatch_id:${request.dispatchId}] from ${request.sourceAgentId ?? "relay"}`;

    // Reserve space for mention/footer in first/last chunk
    const firstMaxLen = DISCORD_MAX_CONTENT - mentionPrefix.length;
    const lastMaxLen = DISCORD_MAX_CONTENT - footer.length;
    const middleMaxLen = DISCORD_MAX_CONTENT;

    // Split the raw task text
    const taskChunks = splitText(request.task, Math.min(firstMaxLen, lastMaxLen, middleMaxLen));

    let lastMessageId = "";
    for (let i = 0; i < taskChunks.length; i++) {
      let msg = taskChunks[i];
      if (i === 0) msg = mentionPrefix + msg;
      if (i === taskChunks.length - 1) msg = msg + footer;

      const json = await postDiscordMessage(this.cfg.botToken, channelId, msg);
      lastMessageId = json.id;
    }

    return { messageId: lastMessageId };
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

