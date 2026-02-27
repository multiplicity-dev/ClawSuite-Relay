import { logRelay } from "./logger.js";
import { loadDispatch, findDispatchByPostedMessageId, updateDispatch } from "./state.js";
import { type ForwardTransport, UnconfiguredForwardTransport } from "./forward.js";
import { extractRelayDispatchId } from "./markers.js";
import type { DispatchRecord } from "./types.js";

export interface SubagentMessageEvent {
  channelId: string;
  messageId: string;
  content: string;
  referencedMessageId?: string;
}

export interface CaptureDeps {
  forwardTransport?: ForwardTransport;
}

export interface CaptureResult {
  status: "ignored" | "processed" | "failed";
  dispatchId?: string;
  reason?: string;
}

function canCaptureFromState(state: DispatchRecord["state"]): boolean {
  return state === "POSTED_TO_CHANNEL" || state === "SUBAGENT_RESPONDED";
}

export function extractDispatchId(content: string): string | null {
  return extractRelayDispatchId(content);
}

export async function captureSubagentResponse(
  event: SubagentMessageEvent,
  deps: CaptureDeps = {}
): Promise<CaptureResult> {
  const forwardTransport = deps.forwardTransport ?? new UnconfiguredForwardTransport();

  let dispatch = event.referencedMessageId
    ? await findDispatchByPostedMessageId(event.referencedMessageId)
    : null;

  if (!dispatch) {
    const markerDispatchId = extractDispatchId(event.content);
    if (markerDispatchId) dispatch = await loadDispatch(markerDispatchId);
  }

  if (!dispatch) return { status: "ignored", reason: "no_dispatch_match" };
  if (!canCaptureFromState(dispatch.state)) {
    return { status: "ignored", dispatchId: dispatch.dispatchId, reason: `state_${dispatch.state}` };
  }

  try {
    await updateDispatch({
      ...dispatch,
      state: "SUBAGENT_RESPONDED",
      subagentResponseMessageId: event.messageId
    });

    const forwarded = await forwardTransport.forwardToOrchestrator({
      dispatchId: dispatch.dispatchId,
      targetAgentId: dispatch.targetAgentId,
      subagentMessageId: event.messageId,
      content: event.content
    });

    await updateDispatch({
      ...dispatch,
      state: "COMPLETED",
      subagentResponseMessageId: event.messageId,
      forwardedMessageId: forwarded.messageId
    });

    logRelay("dispatch.forwarded", {
      dispatchId: dispatch.dispatchId,
      targetAgentId: dispatch.targetAgentId,
      subagentMessageId: event.messageId,
      forwardedMessageId: forwarded.messageId
    });

    return { status: "processed", dispatchId: dispatch.dispatchId };
  } catch (error) {
    logRelay("dispatch.capture_failed", {
      dispatchId: dispatch.dispatchId,
      error: String(error)
    });
    return { status: "failed", dispatchId: dispatch.dispatchId, reason: "forward_failed" };
  }
}
