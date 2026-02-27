export function logRelay(event: string, data: Record<string, unknown>) {
  if (process.env.CLAWSUITE_RELAY_SILENT_LOGS === "1") return;
  const payload = {
    ts: new Date().toISOString(),
    source: "clawsuite-relay",
    event,
    ...data
  };
  // structured JSON logs for grep/jq tooling
  console.log(JSON.stringify(payload));
}
