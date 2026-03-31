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
