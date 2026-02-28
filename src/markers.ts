const RELAY_DISPATCH_ID_RE = /\[relay_dispatch_id:([a-zA-Z0-9-]+)\]/;

export function extractRelayDispatchId(content: string): string | null {
  const m = content.match(RELAY_DISPATCH_ID_RE);
  return m?.[1] ?? null;
}
