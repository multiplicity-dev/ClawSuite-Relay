import { findDispatchBySubagentResponseMessageId, loadDispatch } from "./state.js";

const MARKER_RE = /\[relay_dispatch_id:([a-zA-Z0-9-]+)\]/;

export interface GeneralAnnounceEvent {
  channelId: string;
  content: string;
  relatedSubagentMessageId?: string;
}

export interface AnnounceFilterConfig {
  relayEnabled: boolean;
  orchestratorChannelId?: string;
}

function extractDispatchId(content: string): string | null {
  const m = content.match(MARKER_RE);
  return m?.[1] ?? null;
}

export async function shouldSuppressTransientGeneralAnnounce(
  event: GeneralAnnounceEvent,
  cfg: AnnounceFilterConfig
): Promise<boolean> {
  if (!cfg.relayEnabled) return false;
  if (!cfg.orchestratorChannelId) return false;
  if (event.channelId !== cfg.orchestratorChannelId) return false;

  if (event.relatedSubagentMessageId) {
    const byMessageId = await findDispatchBySubagentResponseMessageId(event.relatedSubagentMessageId);
    if (byMessageId) return true;
  }

  const dispatchId = extractDispatchId(event.content);
  if (!dispatchId) return false;

  const dispatch = await loadDispatch(dispatchId);
  return Boolean(dispatch);
}
