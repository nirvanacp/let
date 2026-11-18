import { cut, debug, originPath, startDebug } from "../debug.js";
import type { Session } from "./session.js";

export { debug } from "../debug.js";

/** An animation frame longer than this is logged. */
const LONG_FRAME_MS = 100;

/**
 * Starts the UI document's debug log when the user has the applet's log on: batches go to the
 * host with `debug.log`, and the log records uncaught errors, unhandled rejections and long
 * animation frames. With the log off nothing is installed.
 */
export function startClientDebug(session: Session): void {
  if (session.bound.limits.debugLog !== true) return;
  startDebug(entries => { session.request("debug.log", { entries }).catch(() => {}); });
  if (typeof addEventListener !== "function") return;
  addEventListener("error", event => {
    debug.add("error", { message: cut(event.message), source: originPath(event.filename ?? ""), line: event.lineno });
  });
  addEventListener("unhandledrejection", event => {
    const reason: unknown = event.reason;
    debug.add("rejection", { message: cut(reason instanceof Error ? reason.message : reason), code: (reason as { code?: unknown } | null)?.code });
  });
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) return;
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      if (entry.duration <= LONG_FRAME_MS) continue;
      const blocking = (entry as PerformanceEntry & { blockingDuration?: number }).blockingDuration;
      debug.add("frame.long", { ms: Math.round(entry.duration), ...(blocking === undefined ? {} : { blockingMs: Math.round(blocking) }) });
    }
  }).observe({ type: "long-animation-frame" });
}
