import { findDispatchBySubagentResponseMessageId, loadDispatch } from "./state.js";
import { extractRelayDispatchId } from "./markers.js";
import { logRelay } from "./logger.js";

export interface GeneralAnnounceEvent {
  channelId: string;
  content: string;
  relatedSubagentMessageId?: string;
}

export interface AnnounceFilterConfig {
  relayEnabled: boolean;
  orchestratorChannelId?: string;
}

function isSuppressibleState(state: string): boolean {
  return state === "SUBAGENT_RESPONDED" || state === "FORWARDED_TO_ORCHESTRATOR" || state === "COMPLETED";
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
    if (byMessageId && isSuppressibleState(byMessageId.state)) {
      logRelay("announce.suppressed", {
        dispatchId: byMessageId.dispatchId,
        correlationPath: "related_subagent_message_id",
        channelId: event.channelId
      });
      return true;
    }
  }

  const dispatchId = extractRelayDispatchId(event.content);
  if (!dispatchId) return false;

  const dispatch = await loadDispatch(dispatchId);
  if (dispatch && isSuppressibleState(dispatch.state)) {
    logRelay("announce.suppressed", {
      dispatchId: dispatch.dispatchId,
      correlationPath: "marker",
      channelId: event.channelId
    });
    return true;
  }

  return false;
}
