import { randomUUID } from "node:crypto";
import { logRelay } from "./logger.js";
import { findDispatchByRequestId, saveDispatch, updateDispatch } from "./state.js";
import { UnconfiguredRelayTransport, type RelayTransport } from "./transport.js";
import {
  RELAY_CODES,
  V1_TARGET_AGENT,
  type DispatchRecord,
  type RelayDispatchRequest,
  type RelayDispatchResponse
} from "./types.js";

export interface RelayDispatchDeps {
  transport?: RelayTransport;
}

function invalid(message: string): RelayDispatchResponse {
  return {
    status: "rejected",
    code: RELAY_CODES.INVALID_PAYLOAD,
    message,
    retryable: false
  };
}

function isReplayableState(state: DispatchRecord["state"]): boolean {
  return (
    state === "POSTED_TO_CHANNEL" ||
    state === "SUBAGENT_RESPONDED" ||
    state === "FORWARDED_TO_ORCHESTRATOR" ||
    state === "COMPLETED"
  );
}

export async function relay_dispatch(
  request: RelayDispatchRequest,
  deps: RelayDispatchDeps = {}
): Promise<RelayDispatchResponse> {
  const transport = deps.transport ?? new UnconfiguredRelayTransport();

  if (!request?.targetAgentId?.trim()) return invalid("targetAgentId is required");
  if (!request?.task?.trim()) return invalid("task is required");

  if (request.targetAgentId !== V1_TARGET_AGENT) {
    return {
      status: "rejected",
      code: RELAY_CODES.TARGET_UNMAPPED,
      message: `v1 only supports targetAgentId=${V1_TARGET_AGENT}`,
      retryable: false
    };
  }

  if (request.requestId?.trim()) {
    const existing = await findDispatchByRequestId(request.requestId);
    if (existing && isReplayableState(existing.state)) {
      logRelay("dispatch.idempotent_hit", {
        dispatchId: existing.dispatchId,
        requestId: request.requestId,
        targetAgentId: existing.targetAgentId,
        state: existing.state
      });
      return {
        status: "accepted",
        dispatchId: existing.dispatchId,
        message: "dispatch accepted (idempotent replay)",
        retryable: false
      };
    }

    if (existing) {
      logRelay("dispatch.idempotent_stale", {
        dispatchId: existing.dispatchId,
        requestId: request.requestId,
        state: existing.state,
        action: "new_dispatch_created"
      });
    }
  }

  const now = new Date().toISOString();
  const dispatchId = randomUUID();

  const record: DispatchRecord = {
    dispatchId,
    requestId: request.requestId,
    targetAgentId: request.targetAgentId,
    task: request.task,
    state: "CREATED",
    createdAt: now,
    updatedAt: now
  };

  try {
    await saveDispatch(record);
    logRelay("dispatch.created", {
      dispatchId,
      targetAgentId: request.targetAgentId,
      state: record.state
    });

    const post = await transport.postToChannel({
      dispatchId,
      targetAgentId: request.targetAgentId,
      task: request.task
    });

    await updateDispatch({
      ...record,
      state: "POSTED_TO_CHANNEL",
      postedMessageId: post.messageId
    });

    logRelay("dispatch.posted", {
      dispatchId,
      targetAgentId: request.targetAgentId,
      postedMessageId: post.messageId,
      state: "POSTED_TO_CHANNEL"
    });

    return {
      status: "accepted",
      dispatchId,
      message: "dispatch accepted",
      retryable: false
    };
  } catch (error) {
    try {
      await updateDispatch({
        ...record,
        state: "FAILED"
      });
    } catch {
      // best-effort only
    }

    const errText = String(error);
    const payloadTooLong = errText.includes("Payload too long for Discord");

    logRelay("dispatch.failed", {
      dispatchId,
      targetAgentId: request.targetAgentId,
      error: errText
    });
    return {
      status: payloadTooLong ? "rejected" : "failed",
      dispatchId,
      code: payloadTooLong ? RELAY_CODES.INVALID_PAYLOAD : RELAY_CODES.RELAY_UNAVAILABLE,
      message: payloadTooLong ? "dispatch payload exceeds Discord message limit" : "failed to persist or post dispatch",
      retryable: !payloadTooLong
    };
  }
}
