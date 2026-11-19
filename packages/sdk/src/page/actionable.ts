import type { Locator } from "@nirvanacp/core";
import { PageError } from "./errors.js";
import { locate, type RecordLookup } from "./locate.js";
import { isVisible } from "./read.js";

/**
 * How long the agent's waits sleep between looks, by how long the wait has run: a target that is
 * about to appear is found quickly, and a long wait costs little. Genesis keeps the page awake
 * during a call; timers, unlike animation frames, also run if it is not.
 */
export function pollMs(waitedMs: number): number {
  return waitedMs < 500 ? 50 : waitedMs < 2000 ? 100 : 250;
}

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Why an element cannot take input now, or null when it can. */
export function blocker(element: Element, wait: { scrolledAt?: string } = {}): "detached" | "hidden" | "disabled" | "covered" | null {
  if (!element.isConnected) return "detached";
  if (!isVisible(element)) return "hidden";
  if ((element as HTMLButtonElement).disabled === true || element.closest("fieldset:disabled") && element.matches("input, select, textarea, button")) return "disabled";
  if (element.getAttribute("aria-disabled") === "true") return "disabled";
  let rect = element.getBoundingClientRect();
  // Scrolling lays the page out again, so it happens only for a target whose middle is outside the viewport, and
  // once per wait unless the target moved since.
  const [midX, midY] = [rect.left + rect.width / 2, rect.top + rect.height / 2];
  const outside = midX < 0 || midY < 0 || midX >= innerWidth || midY >= innerHeight;
  const at = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  if (outside && wait.scrolledAt !== at) {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    rect = element.getBoundingClientRect();
    wait.scrolledAt = `${rect.left},${rect.top},${rect.width},${rect.height}`;
  }
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const root = element.getRootNode() as Document | ShadowRoot;
  const hit = root.elementFromPoint?.(x, y) ?? null;
  // Outside the viewport (an element larger than it, say) elementFromPoint says nothing; do not call that covered.
  if (hit === null) return null;
  if (hit === element || element.contains(hit)) return null;
  if (hit.localName === "label" && (hit as HTMLLabelElement).control === element) return null;
  return "covered";
}

/**
 * Finds the target and waits up to `timeoutMs` for it to exist and take input. With `force`, only
 * existence is waited for. Fails with the locate error, or `NOT_ACTIONABLE` and the reason.
 */
export async function actionable(locator: Locator, records: RecordLookup, options: { timeoutMs?: number; force?: boolean }, stop: () => boolean): Promise<Element> {
  const started = Date.now();
  const deadline = started + Math.max(0, options.timeoutMs ?? 0);
  const wait = {};
  for (;;) {
    let failure: PageError;
    try {
      const element = locate(locator, records);
      const reason = options.force ? null : blocker(element, wait);
      if (reason === null) return element;
      failure = new PageError("NOT_ACTIONABLE", `The target is ${reason}`, { reason });
    } catch (error) {
      if (!(error instanceof PageError) || error.code === "AMBIGUOUS_TARGET" || error.details?.reason) throw error;
      failure = error;
    }
    const pause = pollMs(Date.now() - started);
    if (stop() || Date.now() + pause > deadline) throw failure;
    await sleep(pause);
  }
}

/** Resolves once `condition` holds (a throw counts as not yet) or `stop` does; false after `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs: number, stop: () => boolean): Promise<boolean> {
  const started = Date.now();
  const deadline = started + Math.max(0, timeoutMs);
  for (;;) {
    let holds = false;
    try { holds = condition(); } catch { holds = false; }
    if (holds) return true;
    if (stop() || Date.now() >= deadline) return false;
    await sleep(Math.min(pollMs(Date.now() - started), Math.max(0, deadline - Date.now())));
  }
}
