import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DispatchRecord } from "./types.js";

const DEFAULT_BASE_DIR = join(
  homedir(),
  ".openclaw",
  "extensions",
  "relay-bridge",
  "dispatches"
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getDispatchDir(): string {
  return process.env.CLAWSUITE_RELAY_DISPATCH_DIR || DEFAULT_BASE_DIR;
}

export function isValidDispatchId(dispatchId: string): boolean {
  return UUID_RE.test(dispatchId);
}

export async function ensureDispatchDir() {
  await mkdir(getDispatchDir(), { recursive: true });
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

export async function findDispatchByPostedMessageId(
  postedMessageId: string
): Promise<DispatchRecord | null> {
  if (!postedMessageId?.trim()) return null;
  await ensureDispatchDir();
  const files = await readdir(getDispatchDir());
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(getDispatchDir(), file), "utf8");
      const parsed = JSON.parse(raw) as DispatchRecord;
      if (parsed.postedMessageId === postedMessageId) return parsed;
    } catch {
      // ignore malformed/unreadable files in v1
    }
  }
  return null;
}

export async function findDispatchBySubagentResponseMessageId(
  subagentResponseMessageId: string
): Promise<DispatchRecord | null> {
  if (!subagentResponseMessageId?.trim()) return null;
  await ensureDispatchDir();
  const files = await readdir(getDispatchDir());
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(getDispatchDir(), file), "utf8");
      const parsed = JSON.parse(raw) as DispatchRecord;
      if (parsed.subagentResponseMessageId === subagentResponseMessageId) return parsed;
    } catch {
      // ignore malformed/unreadable files in v1
    }
  }
  return null;
}

export async function findDispatchByRequestId(
  requestId: string
): Promise<DispatchRecord | null> {
  if (!requestId?.trim()) return null;
  await ensureDispatchDir();
  const files = await readdir(getDispatchDir());
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(getDispatchDir(), file), "utf8");
      const parsed = JSON.parse(raw) as DispatchRecord;
      if (parsed.requestId === requestId) return parsed;
    } catch {
      // ignore malformed/unreadable files in v1
    }
  }
  return null;
}
