import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DispatchRecord } from "./types.js";

const RELAY_BASE_DIR = join(homedir(), ".openclaw", "extensions", "relay-bridge");

const DEFAULT_BASE_DIR = join(RELAY_BASE_DIR, "dispatches");
const DEFAULT_ARMED_DIR = join(RELAY_BASE_DIR, "armed");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getDispatchDir(): string {
  return process.env.CLAWSUITE_RELAY_DISPATCH_DIR || DEFAULT_BASE_DIR;
}

export function getArmedDir(): string {
  return process.env.CLAWSUITE_RELAY_ARMED_DIR || DEFAULT_ARMED_DIR;
}

export function isValidDispatchId(dispatchId: string): boolean {
  return UUID_RE.test(dispatchId);
}

export async function ensureDispatchDir() {
  await mkdir(getDispatchDir(), { recursive: true });
}

export async function ensureArmedDir() {
  await mkdir(getArmedDir(), { recursive: true });
}

export async function saveDispatch(record: DispatchRecord) {
  await ensureDispatchDir();
  const path = join(getDispatchDir(), `${record.dispatchId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2), "utf8");
  return path;
}

export async function loadDispatch(dispatchId: string): Promise<DispatchRecord | null> {
  if (!isValidDispatchId(dispatchId)) return null;
  try {
    const path = join(getDispatchDir(), `${dispatchId}.json`);
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as DispatchRecord;
  } catch {
    return null;
  }
}

export async function updateDispatch(record: DispatchRecord) {
  return saveDispatch({
    ...record,
    updatedAt: new Date().toISOString()
  });
}

async function findDispatchRecord(
  predicate: (record: DispatchRecord) => boolean
): Promise<DispatchRecord | null> {
  await ensureDispatchDir();
  const files = await readdir(getDispatchDir());
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(getDispatchDir(), file), "utf8");
      const parsed = JSON.parse(raw) as DispatchRecord;
      if (predicate(parsed)) return parsed;
    } catch {
      // ignore malformed files
    }
  }
  return null;
}

export function findDispatchByPostedMessageId(
  postedMessageId: string
): Promise<DispatchRecord | null> {
  if (!postedMessageId?.trim()) return Promise.resolve(null);
  return findDispatchRecord((r) => r.postedMessageId === postedMessageId);
}

export function findDispatchBySubagentResponseMessageId(
  subagentResponseMessageId: string
): Promise<DispatchRecord | null> {
  if (!subagentResponseMessageId?.trim()) return Promise.resolve(null);
  return findDispatchRecord((r) => r.subagentResponseMessageId === subagentResponseMessageId);
}

export async function findPendingDispatchForAgent(
  targetAgentId: string,
  opts: { maxAgeMs?: number } = {}
): Promise<DispatchRecord | null> {
  if (!targetAgentId?.trim()) return null;
  const now = Date.now();
  const maxAgeMs = opts.maxAgeMs;

  // Uses a manual scan (not findDispatchRecord) because we need to pick
  // the most-recently-updated match, not just the first match.
  await ensureDispatchDir();
  const files = await readdir(getDispatchDir());
  let best: DispatchRecord | null = null;

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(getDispatchDir(), file), "utf8");
      const parsed = JSON.parse(raw) as DispatchRecord;
      if (parsed.targetAgentId !== targetAgentId) continue;
      if (parsed.state !== "POSTED_TO_CHANNEL") continue;

      if (typeof maxAgeMs === "number") {
        const ts = Date.parse(parsed.updatedAt || parsed.createdAt || "");
        if (!Number.isNaN(ts) && now - ts > maxAgeMs) continue;
      }

      if (!best) {
        best = parsed;
      } else {
        const a = Date.parse(parsed.updatedAt || parsed.createdAt || "") || 0;
        const b = Date.parse(best.updatedAt || best.createdAt || "") || 0;
        if (a > b) best = parsed;
      }
    } catch {
      // ignore malformed files
    }
  }
  return best;
}

export interface ArmedDispatchRecord {
  targetAgentId: string;
  dispatchId: string;
  armedAt: string;
  orchestratorSessionKey?: string;
  orchestratorAgentId?: string;
}

export async function setArmedDispatch(
  targetAgentId: string,
  dispatchId: string,
  orchestratorSessionKey?: string,
  orchestratorAgentId?: string
) {
  await ensureArmedDir();
  const rec: ArmedDispatchRecord = {
    targetAgentId,
    dispatchId,
    armedAt: new Date().toISOString(),
    ...(orchestratorSessionKey ? { orchestratorSessionKey } : {}),
    ...(orchestratorAgentId ? { orchestratorAgentId } : {})
  };
  const p = join(getArmedDir(), `${targetAgentId}.json`);
  await writeFile(p, JSON.stringify(rec, null, 2), "utf8");
}

export async function getArmedDispatch(targetAgentId: string): Promise<ArmedDispatchRecord | null> {
  if (!targetAgentId?.trim()) return null;
  try {
    const p = join(getArmedDir(), `${targetAgentId}.json`);
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as ArmedDispatchRecord;
  } catch {
    return null;
  }
}

export async function clearArmedDispatch(targetAgentId: string) {
  if (!targetAgentId?.trim()) return;
  const p = join(getArmedDir(), `${targetAgentId}.json`);
  await rm(p, { force: true });
}

export function findDispatchByRequestId(
  requestId: string
): Promise<DispatchRecord | null> {
  if (!requestId?.trim()) return Promise.resolve(null);
  return findDispatchRecord((r) => r.requestId === requestId);
}
