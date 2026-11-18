import type { LogEntry } from "@let/core";

/** Entries wait this long for more before they go to the host together. */
const SEND_MS = 1000;
/** A batch this large goes at once. */
const SEND_AT = 200;
/** The longest text an entry keeps, such as an error message. */
const TEXT_MAX = 300;

/**
 * The document's debug log, on while the user has the applet's log on (`limits.debugLog`).
 * Call sites check `debug.on` before they build an event, so a log that is off costs one
 * property read. Events carry names, counts, durations and error codes, never page text, stored
 * data, typed text, cookies or query strings.
 */
export interface DebugLog {
  on: boolean;
  add(ev: string, d?: Record<string, unknown>): void;
}

let queue: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sender: ((entries: LogEntry[]) => void) | null = null;
let listening = false;

export const debug: DebugLog = {
  on: false,
  add(ev, d) {
    if (!debug.on) return;
    queue.push(d === undefined ? { t: Date.now(), ev } : { t: Date.now(), ev, d });
    if (queue.length >= SEND_AT) flush();
    else timer ??= setTimeout(flush, SEND_MS);
  },
};

/** Sends what is waiting. */
export function flush(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  if (queue.length === 0 || !sender) return;
  const entries = queue;
  queue = [];
  sender(entries);
}

/** Turns the log on for this document. `send` delivers each batch; a document leaving sends what is left. */
export function startDebug(send: (entries: LogEntry[]) => void): void {
  sender = send;
  debug.on = true;
  if (listening || typeof addEventListener !== "function") return;
  listening = true;
  addEventListener("pagehide", flush);
}

/** A string cut to the length the log keeps. */
export function cut(text: unknown): string {
  const value = String(text);
  return value.length > TEXT_MAX ? value.slice(0, TEXT_MAX) : value;
}

/** A URL as its origin and path, without query or fragment. */
export function originPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return "";
  }
}
