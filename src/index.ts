import { randomUUID } from "node:crypto";
import { logRelay } from "./logger.js";
import { findDispatchByRequestId, saveDispatch } from "./state.js";
import {
  RELAY_CODES,
  V1_TARGET_AGENT,
  type DispatchRecord,
  type RelayDispatchRequest,
  type RelayDispatchResponse
} from "./types.js";

function invalid(message: string): RelayDispatchResponse {
  return {
    status: "rejected",
    code: RELAY_CODES.INVALID_PAYLOAD,
    message,
    retryable: false
  };
}

export async function relay_dispatch(
  request: RelayDispatchRequest
): Promise<RelayDispatchResponse> {
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
    if (existing) {
      logRelay("dispatch.idempotent_hit", {
        dispatchId: existing.dispatchId,
        requestId: request.requestId,
        targetAgentId: existing.targetAgentId
      });
      return {
        status: "accepted",
        dispatchId: existing.dispatchId,
        message: "dispatch accepted (idempotent replay)",
        retryable: false
      };
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

    return {
      status: "accepted",
      dispatchId,
      message: "dispatch accepted",
      retryable: false
    };
  } catch (error) {
    logRelay("dispatch.failed", {
      dispatchId,
      targetAgentId: request.targetAgentId,
      error: String(error)
    });
    return {
      status: "failed",
      code: RELAY_CODES.RELAY_UNAVAILABLE,
      message: "failed to persist dispatch",
      retryable: true
    };
  }
}
