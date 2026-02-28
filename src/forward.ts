export interface ForwardRequest {
  dispatchId: string;
  targetAgentId: string;
  subagentMessageId: string;
  content: string;
  subagentSessionKey?: string;
}

export interface ForwardResult {
  messageId: string;
}

export interface ForwardTransport {
  forwardToOrchestrator(request: ForwardRequest): Promise<ForwardResult>;
}

export class UnconfiguredForwardTransport implements ForwardTransport {
  async forwardToOrchestrator(_request: ForwardRequest): Promise<ForwardResult> {
    throw new Error("Forward transport is not configured");
  }
}
