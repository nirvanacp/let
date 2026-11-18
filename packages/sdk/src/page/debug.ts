import type { Connection } from "../bridge.js";
import { debug, flush, startDebug } from "../debug.js";

export { debug } from "../debug.js";

/**
 * Starts this website page's debug log when the user has the applet's log on: batches go to the
 * host with `debug.log`. The connection retires on `pagehide`, so what is left goes just before.
 */
export function startPageDebug(connection: Connection): void {
  debug.on = connection.bound.limits.debugLog === true;
  if (!debug.on) return;
  startDebug(entries => { connection.request("debug.log", { entries }).catch(() => {}); });
  connection.on("pagehide", flush);
}
