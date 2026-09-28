// Notifications + heartbeat, stored as JSON in agent/data/ (gitignored).
import * as fs from "fs";
import { DATA_DIR, HEARTBEAT_PATH, NOTIFICATIONS_PATH } from "./config";

export interface Notification {
  id: number;
  time: string; // ISO
  type: "reminder" | "missed" | "grace" | "confirmation" | "confirmed" | "released" | "active" | "tx" | "hash" | "error";
  title: string; // e.g. "⚠️ LEGACYVAULT REMINDER"
  message: string;
  txHash?: string;
  explorerUrl?: string;
}

const MAX_STORED = 200;

fs.mkdirSync(DATA_DIR, { recursive: true });

/** Write JSON via a temp file + rename, so readers never see a half-written file. */
function writeJson(file: string, data: unknown) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Save a notification and print it to the console. */
export function notify(n: Omit<Notification, "id" | "time">): Notification {
  const all = readJson<Notification[]>(NOTIFICATIONS_PATH, []);
  const full: Notification = { id: (all[all.length - 1]?.id ?? 0) + 1, time: new Date().toISOString(), ...n };
  all.push(full);
  writeJson(NOTIFICATIONS_PATH, all.slice(-MAX_STORED));

  console.log(`\n${full.title}\n  ${full.message}${full.explorerUrl ? `\n  ${full.explorerUrl}` : ""}\n`);
  return full;
}

/** Latest notifications, newest first. */
export function latestNotifications(limit = 50): Notification[] {
  return readJson<Notification[]>(NOTIFICATIONS_PATH, []).slice(-limit).reverse();
}

export function writeHeartbeat(hb: Record<string, unknown>) {
  writeJson(HEARTBEAT_PATH, hb);
}

export function readHeartbeat(): Record<string, any> | null {
  return readJson<Record<string, any> | null>(HEARTBEAT_PATH, null);
}
