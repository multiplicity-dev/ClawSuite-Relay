export const RELAY_CODES = {
  /** Transport or persistence failure (retryable). */
  RELAY_UNAVAILABLE: "RELAY_UNAVAILABLE",
  /** Request validation failure — bad or missing fields, payload too large. */
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  // Reserved for future phases (Phase 4: reliability & hardening):
  MENTION_POLICY_BLOCKED: "MENTION_POLICY_BLOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  SUBAGENT_TIMEOUT: "SUBAGENT_TIMEOUT"
} as const;

export type RelayCode = (typeof RELAY_CODES)[keyof typeof RELAY_CODES];

export type RelayDispatchStatus = "accepted" | "rejected" | "failed";

export interface RelayDispatchRequest {
  targetAgentId: string;
  task: string;
  requestId?: string;
}

export interface RelayDispatchResponse {
  status: RelayDispatchStatus;
  dispatchId?: string;
  code?: RelayCode;
  message: string;
  retryable: boolean;
}

/**
 * Dispatch lifecycle: CREATED → POSTED_TO_CHANNEL → COMPLETED (or FAILED).
 * SUBAGENT_RESPONDED is an intermediate state set when capture fires
 * before gateway delivery completes.
 */
export type DispatchState =
  | "CREATED"
  | "POSTED_TO_CHANNEL"
  | "SUBAGENT_RESPONDED"
  | "COMPLETED"
  | "FAILED";

export interface DispatchRecord {
  dispatchId: string;
  requestId?: string;
  targetAgentId: string;
  task: string;
  state: DispatchState;
  postedMessageId?: string;
  subagentResponseMessageId?: string;
  forwardedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}
