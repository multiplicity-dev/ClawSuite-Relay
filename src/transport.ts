export interface RelayPostRequest {
  dispatchId: string;
  targetAgentId: string;
  task: string;
  sourceAgentId?: string;
}

export interface RelayPostResult {
  messageId: string;
}

export interface RelayTransport {
  postToChannel(request: RelayPostRequest): Promise<RelayPostResult>;
}

export class UnconfiguredRelayTransport implements RelayTransport {
  async postToChannel(_request: RelayPostRequest): Promise<RelayPostResult> {
    throw new Error("Relay transport is not configured");
  }
}
