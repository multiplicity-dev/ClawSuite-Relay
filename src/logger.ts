export function logRelay(event: string, data: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    source: "clawsuite-relay",
    event,
    ...data
  };
  // structured JSON logs for grep/jq tooling
  console.log(JSON.stringify(payload));
}
