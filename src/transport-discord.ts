import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";
import { type RelayEnvelope, serializeForDiscord } from "./envelope.js";

interface DiscordRelayConfig {
  botToken: string;
  channelsByAgent: Record<string, string>;
  sleepFn?: (ms: number) => Promise<void>;
}

const DISCORD_MAX_CONTENT = 2000;
const SNOWFLAKE_RE = /^\d{17,20}$/;

function validateSnowflake(value: string | undefined, label: string) {
  if (!value || !SNOWFLAKE_RE.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

// Transient retry for the single write boundary to Discord.
// 429: respect Retry-After header. 500/502/503: fixed 2s backoff.
// Non-transient (400/403/404) fail immediately — zero chance of success on retry.
const MAX_ATTEMPTS = 3;
const SERVER_ERROR_BACKOFF_MS = 2000;
const DEFAULT_RETRY_AFTER_MS = 2000;
const MIN_RETRY_AFTER_MS = 500;
const MAX_RETRY_AFTER_MS = 30000;
const TRANSIENT_STATUS = new Set([429, 500, 502, 503]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue: string | null): number {
  const seconds = Number(headerValue);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const ms = seconds * 1000;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, ms));
}

async function postDiscordMessage(
  botToken: string,
  channelId: string,
  content: string,
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<{ id: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${botToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content })
      });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`Discord post failed (network): ${String(err)}`);
      }
      await sleepFn(SERVER_ERROR_BACKOFF_MS);
      continue;
    }

    if (response.ok) {
      return (await response.json()) as { id: string };
    }

    const text = await response.text();

    if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(`Discord post failed (${response.status}): ${text}`);
    }

    // 429: use Discord-provided Retry-After (seconds). 5xx: fixed backoff.
    if (response.status === 429) {
      await sleepFn(parseRetryAfterMs(response.headers.get("Retry-After")));
    } else {
      await sleepFn(SERVER_ERROR_BACKOFF_MS);
    }
  }

  // Unreachable — loop always returns or throws — but satisfies TypeScript.
  throw new Error("Discord post failed: retry budget exhausted");
}

export function buildRelayContent(request: RelayPostRequest, opts?: { sourceAgentId?: string }): string {
  const envelope: RelayEnvelope = {
    source: opts?.sourceAgentId ?? "relay",
    target: request.targetAgentId,
    dispatchId: request.dispatchId,
    createdAt: new Date().toISOString(),
    type: "dispatch",
    content: request.task
  };

  return serializeForDiscord(envelope);
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

    const content = buildRelayContent(request, { sourceAgentId: request.sourceAgentId });

    // Single message if it fits
    if (content.length <= DISCORD_MAX_CONTENT) {
      const json = await postDiscordMessage(this.cfg.botToken, channelId, content, this.cfg.sleepFn);
      return { messageId: json.id };
    }

    // Multi-message: split the task content and append envelope footer to last chunk.
    const footer = `\n\nfrom ${request.sourceAgentId ?? "relay"}`;

    // Reserve space for footer in last chunk.
    const firstMaxLen = DISCORD_MAX_CONTENT;
    const lastMaxLen = DISCORD_MAX_CONTENT - footer.length;
    const middleMaxLen = DISCORD_MAX_CONTENT;

    // Split the raw task text
    const taskChunks = splitText(request.task, Math.min(firstMaxLen, lastMaxLen, middleMaxLen));

    let lastMessageId = "";
    for (let i = 0; i < taskChunks.length; i++) {
      let msg = taskChunks[i];
      if (i === taskChunks.length - 1) msg = msg + footer;

      const json = await postDiscordMessage(this.cfg.botToken, channelId, msg, this.cfg.sleepFn);
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

  if (!botToken) throw new Error("Missing CLAWSUITE_RELAY_BOT_TOKEN");
  if (!rawChannels) throw new Error("Missing CLAWSUITE_RELAY_CHANNEL_MAP_JSON");

  const channelsByAgent = parseJsonEnv<Record<string, string>>(
    rawChannels,
    "CLAWSUITE_RELAY_CHANNEL_MAP_JSON"
  );
  return new DiscordRelayTransport({ botToken, channelsByAgent });
}
