export const V1_TARGET_AGENT = "systems-eng" as const;

export const RELAY_CODES = {
  TARGET_UNMAPPED: "TARGET_UNMAPPED",
  RELAY_UNAVAILABLE: "RELAY_UNAVAILABLE",
  MENTION_POLICY_BLOCKED: "MENTION_POLICY_BLOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  SUBAGENT_TIMEOUT: "SUBAGENT_TIMEOUT"
} as const;

export type RelayCode = (typeof RELAY_CODES)[keyof typeof RELAY_CODES];

export type RelayDispatchStatus = "accepted" | "rejected" | "failed";

export interface RelayDispatchRequest {
  targetAgentId: string;
  task: string;
  requestId?: string;
  options?: {
    priority?: "normal";
    replyMode?: "auto-forward";
  };
}

export interface RelayDispatchResponse {
  status: RelayDispatchStatus;
  dispatchId?: string;
  code?: RelayCode;
  message: string;
  retryable: boolean;
}

export type DispatchState =
  | "CREATED"
  | "POSTED_TO_CHANNEL"
  | "SUBAGENT_RESPONDED"
  | "FORWARDED_TO_ORCHESTRATOR"
  | "COMPLETED"
  | "FAILED";

export interface DispatchRecord {
  dispatchId: string;
  requestId?: string;
  targetAgentId: string;
  task: string;
  state: DispatchState;
  postedMessageId?: string;
  createdAt: string;
  updatedAt: string;
}
