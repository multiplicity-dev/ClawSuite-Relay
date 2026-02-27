export interface RelayPostRequest {
  dispatchId: string;
  targetAgentId: string;
  task: string;
}

export interface RelayPostResult {
  messageId: string;
}

export interface RelayTransport {
  postToChannel(request: RelayPostRequest): Promise<RelayPostResult>;
}

export class NoopRelayTransport implements RelayTransport {
  async postToChannel(_request: RelayPostRequest): Promise<RelayPostResult> {
    return { messageId: "noop" };
  }
}
