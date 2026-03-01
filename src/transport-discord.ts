import type { RelayPostRequest, RelayPostResult, RelayTransport } from "./transport.js";
import { type RelayEnvelope, serializeForDiscord } from "./envelope.js";

interface DiscordRelayConfig {
  webhooksByAgent: Record<string, string>;
  sourceProfilesByAgent?: Record<string, { username?: string; avatarUrl?: string }>;
  sleepFn?: (ms: number) => Promise<void>;
}

export const DISCORD_MAX_CONTENT = 2000;
const DISCORD_WEBHOOK_URL_RE = /^https:\/\/(?:canary\.|ptb\.)?discord\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]+$/;

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

export async function postDiscordMessage(
  webhookUrl: string,
  payload: Record<string, unknown>,
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<{ id: string }> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${webhookUrl}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
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
    const webhookUrl = this.cfg.webhooksByAgent[request.targetAgentId];
    if (!webhookUrl) throw new Error(`No webhook mapping for ${request.targetAgentId}`);
    if (!DISCORD_WEBHOOK_URL_RE.test(webhookUrl)) {
      throw new Error(`Invalid Discord webhook URL for ${request.targetAgentId}`);
    }

    const sourceAgentId = request.sourceAgentId ?? "relay";
    const sourceProfile = this.cfg.sourceProfilesByAgent?.[sourceAgentId];
    const username = sourceProfile?.username || sourceAgentId;
    const avatarUrl = sourceProfile?.avatarUrl;
    const payloadBase: Record<string, unknown> = {
      username,
      allowed_mentions: { parse: [] as string[] }
    };
    if (avatarUrl) payloadBase.avatar_url = avatarUrl;

    const content = buildRelayContent(request, { sourceAgentId: request.sourceAgentId });

    // Single message if it fits
    if (content.length <= DISCORD_MAX_CONTENT) {
      const json = await postDiscordMessage(
        webhookUrl,
        { ...payloadBase, content },
        this.cfg.sleepFn
      );
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

      const json = await postDiscordMessage(
        webhookUrl,
        { ...payloadBase, content: msg },
        this.cfg.sleepFn
      );
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
  const rawWebhooks = process.env.CLAWSUITE_RELAY_WEBHOOK_MAP_JSON;
  const rawSourceProfiles = process.env.CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON;

  if (!rawWebhooks) throw new Error("Missing CLAWSUITE_RELAY_WEBHOOK_MAP_JSON");

  const webhooksByAgent = parseJsonEnv<Record<string, string>>(
    rawWebhooks,
    "CLAWSUITE_RELAY_WEBHOOK_MAP_JSON"
  );
  const sourceProfilesByAgent = rawSourceProfiles
    ? parseJsonEnv<Record<string, { username?: string; avatarUrl?: string }>>(
      rawSourceProfiles,
      "CLAWSUITE_RELAY_SOURCE_PROFILE_MAP_JSON"
    )
    : undefined;
  return new DiscordRelayTransport({ webhooksByAgent, sourceProfilesByAgent });
}
