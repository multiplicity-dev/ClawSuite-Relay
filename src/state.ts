import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DispatchRecord } from "./types.js";

const BASE_DIR = join(homedir(), ".openclaw", "extensions", "relay-bridge", "dispatches");

export function getDispatchDir(): string {
  return BASE_DIR;
}

export async function ensureDispatchDir() {
  await mkdir(BASE_DIR, { recursive: true });
}

export async function saveDispatch(record: DispatchRecord) {
  await ensureDispatchDir();
  const path = join(BASE_DIR, `${record.dispatchId}.json`);
  await writeFile(path, JSON.stringify(record, null, 2), "utf8");
  return path;
}

export async function loadDispatch(dispatchId: string): Promise<DispatchRecord | null> {
  try {
    const path = join(BASE_DIR, `${dispatchId}.json`);
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as DispatchRecord;
  } catch {
    return null;
  }
}
