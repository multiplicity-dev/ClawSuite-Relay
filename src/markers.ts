const RELAY_DISPATCH_ID_RE = /\[relay_dispatch_id:([a-zA-Z0-9-]+)\]/;

export function extractRelayDispatchId(content: string): string | null {
  const m = content.match(RELAY_DISPATCH_ID_RE);
  return m?.[1] ?? null;
}

/** Detect relay machinery messages to prevent echo loops. */
export function isRelayMachinery(content: string): boolean {
  return (
    content.includes("[relay_subagent_message_id:") ||
    content.startsWith("Subagent response received for ")
  );
}
