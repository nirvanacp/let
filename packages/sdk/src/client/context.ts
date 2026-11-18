import {
  type ActivityLevel,
  matchesGuard,
  validateGuards,
  validateReadSpec,
  type ActionResult,
  type AttachVia,
  type ContextBound,
  type ContextNavigated,
  type ElementState,
  type ErrorBody,
  type ErrorCode,
  type Evidence,
  type GrantEnded,
  type GrantKind,
  type GrantResult,
  type InputOptions,
  type InspectResult,
  type Locator,
  type NavigateMode,
  type PageEmitEvent,
  type PageInfo,
  type PageOp,
  type Step,
  type ReadSpec,
  type ScrollPosition,
  type ScrollTo,
  type UrlGuard,
  type ViewId,
} from "@let/core";
import { GenesisError } from "../bridge.js";
import { AnswerTimeout, type Session } from "./session.js";
import { debug } from "./debug.js";
import { batchNotifications, createWatchStore, SNAPSHOT_SLICE_MIN, type WatchStore, type WatchValue } from "./watch.js";

/** What the UI knows about one context. */
export interface ContextState {
  id: string;
  /** The URL of the last committed navigation, or the start URL. */
  url: string;
  /** The generation of the last bound document; every call goes to it. 0 before the first. */
  generation: number;
  /** The latest page the agent reported in a watch, or null. */
  view: ViewId | null;
  /** A page agent in the current document accepts calls. */
  bound: boolean;
  /** A navigation started and has not committed yet. */
  loading: boolean;
  /** Position in the context's back-forward list. */
  index: number;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the context's document is gone, until the next one binds. */
  error: ErrorBody | null;
}

/** How an input's destination is judged when it leaves the page. */
export interface Expect {
  /** The destination must match one of these. Any URL does when absent. */
  url?: UrlGuard[];
  /** A destination matching one of these means the website refused: `failed` with `REJECTED`. */
  notUrl?: UrlGuard[];
  /** Read on the destination; it must be truthy. */
  read?: ReadSpec;
}

export interface CallOptions {
  /** How long the call may take, capped by the host. */
  timeoutMs?: number;
}

export interface InputCallOptions extends InputOptions {
  /** Judges the destination when the input leaves the page. Without it, a navigation answers `unknown`. */
  expect?: Expect;
  /** The input is meant to navigate even though it is not `submit`. */
  navigates?: boolean;
}

/** An input that has not settled yet, for optimistic display. */
export interface PendingInput {
  op: PageOp;
  args: Readonly<Record<string, unknown>>;
}

export interface WatchOptions {
  /** The watch reads only while the URL matches one of these. */
  when?: UrlGuard[];
  /**
   * Genesis also keeps the watch's last value on the phone, for up to 7 days, and shows it, marked
   * `stale`, when the applet starts again, until the page reads. Part of the watch's specification.
   */
  persist?: boolean;
}

/** One open watch: its value follows the page, and survives navigations as described in `watch.ts`. */
export interface Watch<V = unknown, R = unknown> {
  readonly id: string;
  get(): WatchValue<V, R>;
  subscribe(listener: () => void): () => void;
  /** Asks the page for a fresh snapshot. */
  resync(): void;
  /** Closes this handle; the watch closes when every handle that opened it is closed. */
  close(): void;
}

/** One context of the applet: its state, its navigation, and the page agent in its current document. */
export interface ContextHandle {
  readonly id: string;
  readonly state: ContextState;
  subscribe(listener: () => void): () => void;
  /** The last committed navigation, or null before the first. */
  readonly navigation: ContextNavigated | null;
  /** Runs after each committed navigation, once `state` reflects it. */
  onNavigated(listener: (navigation: ContextNavigated) => void): () => void;

  /** Navigations reject with a `GenesisError` when Genesis refuses them, such as a URL outside the declared origins. */
  navigate(url: string, options?: { mode?: NavigateMode }): Promise<void>;
  back(steps?: number): Promise<void>;
  forward(): Promise<void>;
  reload(): Promise<void>;

  /** One operation of the page agent, as is: rejects with the host's error. */
  call<T = unknown>(op: PageOp, args?: Record<string, unknown>, options?: CallOptions): Promise<T>;

  info(options?: CallOptions): Promise<PageInfo>;
  read<T = unknown>(spec: ReadSpec, options?: CallOptions): Promise<T>;
  inspect(target: Locator, options?: CallOptions): Promise<InspectResult>;
  /** Waits for an element state, a URL or a truthy read. Rejects with `DEADLINE`. */
  wait(condition: { target: Locator; state: ElementState } | { url: UrlGuard } | { read: ReadSpec }, timeoutMs: number): Promise<void>;
  scroll(to: ScrollTo, options?: { target?: Locator } & CallOptions): Promise<ScrollPosition>;

  click(target: Locator, options?: InputCallOptions & { gesture?: "click" | "tap" | "mouse"; count?: 1 | 2 }): Promise<ActionResult>;
  longPress(target: Locator, options?: InputCallOptions & { ms?: number }): Promise<ActionResult>;
  hover(target: Locator, options?: InputCallOptions): Promise<ActionResult>;
  unhover(options?: InputCallOptions): Promise<ActionResult>;
  focus(target: Locator, options?: InputCallOptions): Promise<ActionResult>;
  blur(target: Locator, options?: InputCallOptions): Promise<ActionResult>;
  fill(target: Locator, value: string, options?: InputCallOptions): Promise<ActionResult>;
  type(target: Locator, text: string, options?: InputCallOptions): Promise<ActionResult>;
  press(key: string, options?: InputCallOptions & { target?: Locator; modifiers?: string[] }): Promise<ActionResult>;
  select(target: Locator, choice: { values?: string[]; labels?: string[] }, options?: InputCallOptions): Promise<ActionResult>;
  check(target: Locator, checked: boolean, options?: InputCallOptions): Promise<ActionResult>;
  submit(target: Locator, options?: Omit<InputCallOptions, "navigates">): Promise<ActionResult>;
  /**
   * Hands files from `genesis.files.pick` to the website: sets an `<input type="file">`'s files
   * (`via: "input"`, the default) or drops or pastes them on the target. The bytes go from Genesis
   * straight to the page. Needs `limits.userActions`.
   */
  attachFiles(target: Locator, files: ReadonlyArray<string | { id: string }>, options?: InputCallOptions & { via?: AttachVia }): Promise<ActionResult>;
  /** Steps in order inside the page; `navigate` and `submit` may only be last. */
  run(steps: Step[], options?: { until?: Evidence; navigates?: boolean; expect?: Expect; deadlineMs?: number; timeoutMs?: number }): Promise<ActionResult>;
  /** A page module command. A command that returns a value answers `observed` with `value`. */
  invoke<T = unknown>(command: string, args?: unknown, options?: { target?: Locator; expect?: Expect; navigates?: boolean; timeoutMs?: number }): Promise<ActionResult & { value?: T }>;

  /** Inputs that have not settled, in call order; with `target`, only those whose target equals it. Stable until it changes. */
  pending(target?: Locator): readonly PendingInput[];
  subscribePending(listener: () => void): () => void;
  /** Cancels the inputs that have not reached the page yet. */
  cancel(): void;

  /**
   * Lets this hidden page use one website feature once within `GRANT_MS` (5 s): enter fullscreen,
   * start a download, open a window, hand a link to another app or ask for the location. Call it
   * from the user's tap, then make the page do it, for example
   * `await ctx.allow("fullscreen"); await ctx.click(playButton, { input: "trusted" })`. A revealed
   * context needs no grant and answers `expiresInMs: 0`. Rejects with `USER_ACTION_REQUIRED`
   * without a fresh tap. Needs `limits.grants`.
   */
  allow(grant: GrantKind): Promise<GrantResult>;
  /** Runs when a grant of this context ends: `used`, or expired or cleared unused. */
  onGrantEnded(listener: (ended: GrantEnded) => void): () => void;

  /**
   * Asks Genesis to keep this covered website running: "running" keeps scripts and media going
   * without drawing; "awake" is full speed for at most 30 s. Returns the release function. Calls
   * and inputs wake the page by themselves; hold only for work the page does on its own.
   * Does nothing without `limits.activity`.
   */
  hold(level?: ActivityLevel): () => void;

  /**
   * Opens a watch. The same `id` with an equal specification returns the same watch; another
   * specification throws `CONFLICT` while the watch is open. A closed watch keeps its copies of
   * this context's history entries, so opening it again shows them at once, marked stale.
   */
  watch<V = unknown, R = unknown>(id: string, spec: ReadSpec, options?: WatchOptions): Watch<V, R>;
  /** Asks every open watch for a fresh snapshot. */
  resync(): void;
  /**
   * Forgets every copy the watches and Genesis kept of this context's pages, so none shows after
   * the account changed; with `current`, also the data shown now. Pending inputs settle as `unknown` with
   * `CONTEXT_REPLACED`, unless `keepInputs` is set.
   */
  forget(options?: { current?: boolean; keepInputs?: boolean }): void;
}

/** The handle and the event entry points the session calls. */
export interface ContextControl {
  handle: ContextHandle;
  bound(data: ContextBound): void;
  navigated(data: ContextNavigated): void;
  started(url: string): void;
  gone(data: { code?: string; message?: string }): void;
  emit(data: PageEmitEvent): void;
  grantEnded(data: GrantEnded): void;
  resumed(): void;
  retired(): void;
}

/** Runs one subscriber, so a subscriber that throws does not stop the others. */
function call(listener: () => void) {
  try {
    listener();
  } catch (error) {
    console.error("Genesis context listener failed", error);
  }
}

/** Answers that mean "try again on the next document". */
const RETRY = new Set(["CONTEXT_REPLACED", "NOT_READY"]);
/** The shortest time between two resyncs of one watch. */
const RESYNC_GAP_MS = 1000;
/** Closed watches kept per context for their history copies; the oldest closed one goes first. */
const CLOSED_WATCHES_MAX = 32;
/** How long the host keeps an "awake" hold at full speed before it counts as "running". */
const HOLD_AWAKE_MAX_MS = 30_000;
/** With the debug log on, applying one emit that takes longer than this is logged. */
const EMIT_SLOW_MS = 8;
/** Emits wait for the next animation frame, or this long when no frame comes. */
const EMIT_FRAME_FALLBACK_MS = 100;

/** `scheduler.yield`, where the engine has it. */
function yielder(): (() => Promise<unknown>) | null {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<unknown> } }).scheduler;
  return typeof scheduler?.yield === "function" ? () => scheduler.yield!() : null;
}

/**
 * Runs `run` at the next animation frame, or after a short timeout without one. A hidden
 * document, such as the applet's page behind a revealed website, has no frames and slow timers,
 * and draws nothing to batch for: there `run` follows the current task.
 */
function nextFrame(run: () => void) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    queueMicrotask(run);
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    run();
  };
  const timer = setTimeout(once, typeof requestAnimationFrame === "function" ? EMIT_FRAME_FALLBACK_MS : 0);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(once);
}

/** A list snapshot large enough to compare in slices. */
function large(event: PageEmitEvent) {
  if (event.kind !== "snapshot") return false;
  const records = (event.data as { records?: unknown } | null)?.records;
  return typeof records === "object" && records !== null && Object.keys(records).length > SNAPSHOT_SLICE_MIN;
}

interface InputRecord {
  key: string;
  op: PageOp;
  args: Record<string, unknown>;
  target: string | null;
  promise: Promise<ActionResult>;
  resolve(result: ActionResult): void;
  /** Set while the client judges the destination; an app navigation settles it as unknown. */
  judging: boolean;
  /** Ends the wait for the destination. */
  abort: (() => void) | null;
  /** `Date.now()` when the call started, for the debug log; 0 while the log is off. */
  started: number;
}

interface WatchEntry {
  id: string;
  specJson: string;
  spec: ReadSpec;
  when?: UrlGuard[];
  persist: boolean;
  store: WatchStore;
  handle: Watch;
  refs: number;
  /** The host holds a subscription for this watch and opens it in each bound page. */
  subscribed: boolean;
  lastResync: number;
  /** A resync that came within `RESYNC_GAP_MS` of the last one, sent when the gap is over. */
  resyncTimer: ReturnType<typeof setTimeout> | null;
  /** The last reference closed in this task; the page hears of it unless the watch opens again first. */
  closing: boolean;
  /** `Date.now()` when the watch last subscribed while the debug log is on, until its first value; 0 otherwise. */
  openedAt: number;
}

export function createContext(id: string, startUrl: string, session: Session): ContextControl {
  const { limits } = session.bound;
  let state: ContextState = {
    id, url: startUrl, generation: 0, view: null, bound: false, loading: false,
    index: 0, canGoBack: false, canGoForward: false, error: null,
  };
  /** Counts `context.bound` events, so a retry can wait for the next one. */
  let boundCount = 0;
  /** The generation of the latest committed document, bound or not. */
  let latest = 0;
  const listeners = new Set<() => void>();
  let lastNavigation: ContextNavigated | null = null;
  /** Clears `loading` when a started navigation never commits, such as a download or a cancelled load. */
  let loadingTimer: ReturnType<typeof setTimeout> | null = null;
  const navigationListeners = new Set<(navigation: ContextNavigated) => void>();
  const grantListeners = new Set<(ended: GrantEnded) => void>();
  function set(patch: Partial<ContextState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(patch) as (keyof ContextState)[]).every(key => next[key] === state[key])) return;
    state = next;
    for (const listener of [...listeners]) call(listener);
  }

  /** Resolves true once `condition` holds, false after `ms` or on `abort`. */
  function until(condition: () => boolean, ms: number, onAbort?: (abort: () => void) => void): Promise<boolean> {
    if (condition()) return Promise.resolve(true);
    return new Promise(resolve => {
      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        off();
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), Math.max(0, ms));
      const off = subscribe(() => { if (condition()) finish(true); });
      onAbort?.(() => finish(false));
    });
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  // ---- Calls ------------------------------------------------------------------------------------

  /** The host's own budget for a page call. */
  const budget = (timeoutMs?: number) => Math.min(timeoutMs ?? limits.rpcDeadlineMs, limits.actionTimeoutMs);

  function send<T>(op: PageOp, args: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const ms = budget(timeoutMs);
    const params = { context: id, generation: state.generation, op, args, timeoutMs: ms };
    return session.request<T>("page.call", params, { timeoutMs: ms });
  }

  /** A call that is safe to repeat: on `CONTEXT_REPLACED` or `NOT_READY` it goes again to the next bound document, until its time is up. */
  async function repeating<T>(op: PageOp, args: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    const deadline = Date.now() + budget(timeoutMs);
    for (;;) {
      const seen = boundCount;
      if (!state.bound && !(await until(() => state.bound, deadline - Date.now()))) {
        throw new GenesisError("NOT_READY", "The page did not load in time");
      }
      try {
        return await send<T>(op, args, Math.max(1, deadline - Date.now()));
      } catch (error) {
        if (!(error instanceof GenesisError) || !RETRY.has(error.code)) throw error;
        if (!(await until(() => boundCount > seen && state.bound, deadline - Date.now()))) throw error;
      }
    }
  }

  // ---- Inputs -----------------------------------------------------------------------------------

  const inputs = new Map<string, InputRecord>();
  const pendingListeners = new Set<() => void>();
  let pendingCache = new Map<string, readonly PendingInput[]>();

  function pendingChanged() {
    pendingCache = new Map();
    for (const listener of [...pendingListeners]) call(listener);
  }

  function pending(target?: Locator): readonly PendingInput[] {
    const key = target === undefined ? "" : JSON.stringify(target);
    const old = pendingCache.get(key);
    if (old) return old;
    const list: PendingInput[] = [];
    for (const record of inputs.values()) {
      if (target === undefined || record.target === key) list.push({ op: record.op, args: record.args });
    }
    const result = Object.freeze(list);
    pendingCache.set(key, result);
    return result;
  }

  function settle(record: InputRecord, result: ActionResult) {
    if (inputs.get(record.key) !== record) return;
    inputs.delete(record.key);
    if (debug.on) debug.add("input", { context: id, op: record.op, ms: record.started ? Date.now() - record.started : null, outcome: result.outcome, code: result.code });
    record.resolve(result);
    pendingChanged();
  }

  /** The context is leaving its page for another reason: inputs judging a destination can no longer be judged. */
  function leftBy() {
    for (const record of [...inputs.values()]) {
      if (record.judging) {
        record.abort?.();
        settle(record, { outcome: "unknown", message: "The page changed before the input finished" });
      }
    }
  }

  /**
   * Runs an input operation. Identical pending calls share one promise; the promise never
   * rejects. A call that leaves the page is judged by its destination.
   */
  function input(op: PageOp, args: Record<string, unknown>, options: { expect?: Expect; navigates?: boolean; timeoutMs?: number } = {}): Promise<ActionResult> {
    const { expect, navigates, timeoutMs } = options;
    const key = JSON.stringify([op, args, expect ?? null, navigates ?? false]);
    const existing = inputs.get(key);
    if (existing) return existing.promise;
    if (!state.bound) return Promise.resolve({ outcome: "failed", code: "NOT_READY", message: "The page is not ready" });
    try {
      if (expect?.url) validateGuards(expect.url, "expect.url");
      if (expect?.notUrl) validateGuards(expect.notUrl, "expect.notUrl");
      if (expect?.read) validateReadSpec(expect.read, "expect.read");
    } catch (error) {
      return Promise.resolve({ outcome: "failed", code: "INVALID_ARGUMENT", message: messageOf(error) });
    }

    let resolve!: (result: ActionResult) => void;
    const promise = new Promise<ActionResult>(done => { resolve = done; });
    const target = args.target === undefined ? null : JSON.stringify(args.target);
    const record: InputRecord = { key, op, args, target, promise, resolve, judging: false, abort: null, started: debug.on ? Date.now() : 0 };
    inputs.set(key, record);
    pendingChanged();

    const from = { generation: latest, url: state.url };
    const leaves = navigates === true || expect !== undefined || op === "submit" || leavesBySteps(op, args);
    const judge = () => {
      record.judging = true;
      void judgeDestination(record, from, expect).then(result => settle(record, result));
    };
    // The agent must know the input leaves the page, or a click that never navigates answers
    // `observed` and the destination is never judged against `expect`.
    send<unknown>(op, leaves ? { ...args, navigates: true } : args, timeoutMs).then(
      value => {
        const result = asResult(op, value);
        if (result.outcome === "unknown" && !result.code && leaves) judge();
        else settle(record, result);
      },
      error => {
        const code: ErrorCode | undefined = error instanceof GenesisError ? error.code as ErrorCode : undefined;
        const message = error instanceof Error ? error.message : "The input failed";
        const details = error instanceof GenesisError ? error.details : undefined;
        if (details?.navigating) judge();
        // No answer in time from the client's side: the input may have run.
        else if (details?.dispatched || code === "RETIRED" || error instanceof AnswerTimeout) settle(record, { outcome: "unknown", code, message });
        else settle(record, { outcome: "failed", code, message, ...(details?.reason ? { reason: details.reason } : {}) });
      },
    );
    return promise;
  }

  /**
   * Waits for the input's destination: a newer bound document, or a new URL in the same one.
   * Without `expect` the outcome stays unknown; a destination matching `notUrl` is `REJECTED`;
   * one matching `url` (any, when absent) whose `read` is truthy is `observed`.
   */
  async function judgeDestination(record: InputRecord, from: { generation: number; url: string }, expect?: Expect): Promise<ActionResult> {
    const arrived = await until(
      () => (state.bound && state.generation > from.generation) || (latest === from.generation && state.url !== from.url),
      limits.actionTimeoutMs,
      abort => { record.abort = abort; },
    );
    if (!arrived) return { outcome: "unknown", code: "DEADLINE", message: "The destination did not load in time" };
    if (!expect) return { outcome: "unknown", message: "The input led to another page" };
    const url = state.url;
    if (expect.notUrl && matchesGuard(url, expect.notUrl)) return { outcome: "failed", code: "REJECTED", message: "The website did not accept the input" };
    if (expect.url && !matchesGuard(url, expect.url)) return { outcome: "unknown", message: "The input led to another page" };
    if (expect.read) {
      try {
        const value = await repeating<unknown>("read", { spec: expect.read });
        if (!truthy(value)) return { outcome: "unknown", message: "The destination does not show the effect" };
      } catch {
        return { outcome: "unknown", message: "The destination could not be read" };
      }
    }
    return { outcome: "observed" };
  }

  const inputArgs = (target: Locator | undefined, extra: Record<string, unknown>, options: InputCallOptions = {}) => {
    const { expect, navigates, ...rest } = options;
    const args: Record<string, unknown> = { ...rest, ...extra };
    if (target !== undefined) args.target = target;
    return { args, expect, navigates };
  };
  const run = (op: PageOp, target: Locator | undefined, extra: Record<string, unknown>, options?: InputCallOptions) => {
    const { args, ...rest } = inputArgs(target, extra, options);
    return input(op, args, rest);
  };

  // ---- Holds ------------------------------------------------------------------------------------

  const holds: Record<ActivityLevel, number> = { running: 0, awake: 0 };
  /** The level last sent to the host. */
  let held: ActivityLevel | null = null;
  /** Ends the awake holds' full speed when the host does, so both agree on the level. */
  let awakeTimer: ReturnType<typeof setTimeout> | null = null;
  let awakeSpent = false;

  function sendHold() {
    const level = holds.awake > 0 && !awakeSpent ? "awake" : holds.awake + holds.running > 0 ? "running" : null;
    if (level === held) return;
    held = level;
    if (debug.on) debug.add("hold", { context: id, level });
    // A hold is advice: a failed send changes nothing the applet can act on.
    session.request("context.hold", { id, level }).catch(() => {});
  }

  function hold(level: ActivityLevel = "running"): () => void {
    if (!limits.activity) return () => {};
    if (level === "awake" && holds.awake === 0) {
      awakeSpent = false;
      awakeTimer = setTimeout(() => { awakeTimer = null; awakeSpent = true; sendHold(); }, HOLD_AWAKE_MAX_MS);
    }
    holds[level]++;
    sendHold();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds[level]--;
      if (level === "awake" && holds.awake === 0 && awakeTimer) {
        clearTimeout(awakeTimer);
        awakeTimer = null;
      }
      sendHold();
    };
  }

  // ---- Watches ----------------------------------------------------------------------------------

  const watches = new Map<string, WatchEntry>();
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Subscribes to the watch in the host, which opens it in the context's bound page and in every
   * page that binds after it, until `watch.unsubscribe`. An open that fails there arrives as an
   * error status.
   */
  function subscribeWatch(entry: WatchEntry) {
    if (entry.refs === 0 || entry.subscribed) return;
    entry.subscribed = true;
    entry.store.restart();
    if (debug.on) {
      entry.openedAt = Date.now();
      debug.add("watch.subscribe", { context: id, watch: entry.id });
    }
    const params: Record<string, unknown> = { context: id, id: entry.id, spec: entry.spec };
    if (entry.when) params.when = entry.when;
    if (entry.persist) params.persist = true;
    session.request("watch.subscribe", params).catch(error => {
      if (error instanceof GenesisError && error.code === "RETIRED") return;
      entry.subscribed = false;
      entry.store.failed({ code: (error?.code ?? "NOT_READY") as ErrorCode, message: messageOf(error) });
    });
    continueWatch(entry);
  }

  /**
   * Back or Forward loaded a new document, whose page agent has none of the rows the website no
   * longer renders. A virtualized list there continues from the copy this client kept of the
   * history entry, so the screen keeps its length and scroll position. The copy is sent once the
   * watch is open in the bound page.
   */
  function continueWatch(entry: WatchEntry) {
    // The page agent decides whether the watch reads a virtualized list: a page-module reader
    // carries that flag in the page, not in the spec this client holds.
    if (!state.bound || !entry.subscribed || entry.refs === 0) return;
    const kept = entry.store.takeReturned();
    if (!kept) return;
    if (debug.on) debug.add("watch.continue", { context: id, watch: entry.id, records: kept.length });
    // Advice: without it the list starts over with the rows on the page.
    send("watch.resync", { id: entry.id, kept }).catch(() => {});
  }

  function resyncWatch(entry: WatchEntry, force = false) {
    const now = Date.now();
    if (!force && now - entry.lastResync < RESYNC_GAP_MS) {
      // Too soon after the last one: send it once the gap is over, so the request is not lost.
      entry.resyncTimer ??= setTimeout(() => {
        entry.resyncTimer = null;
        if (entry.refs > 0) resyncWatch(entry);
      }, entry.lastResync + RESYNC_GAP_MS - now);
      return;
    }
    if (entry.resyncTimer) clearTimeout(entry.resyncTimer);
    entry.resyncTimer = null;
    entry.lastResync = now;
    if (!entry.subscribed) return subscribeWatch(entry);
    // An unbound context sends a snapshot once its page binds and the host opens the watch.
    if (!state.bound) return;
    send("watch.resync", { id: entry.id }).catch(error => {
      // The page has no such watch: its open failed. Subscribing again has the host open it.
      if (!(error instanceof GenesisError && error.code === "NOT_FOUND") || !entry.subscribed) return;
      entry.subscribed = false;
      subscribeWatch(entry);
    });
  }

  function watch(watchId: string, spec: ReadSpec, options: WatchOptions = {}): Watch {
    validateReadSpec(spec, "spec");
    if (options.when) validateGuards(options.when, "when");
    const specJson = JSON.stringify([spec, options.when ?? null, options.persist === true]);
    // Another specification under a closing id: the page closes the old watch before it opens the new one.
    if (watches.get(watchId)?.closing && watches.get(watchId)!.specJson !== specJson) closeWatches();
    const existing = watches.get(watchId);
    if (existing && (existing.refs > 0 || existing.specJson === specJson)) {
      if (existing.specJson !== specJson) throw new GenesisError("CONFLICT", `The watch ${watchId} is open with another specification`);
      if (existing.refs++ === 0) {
        // Opened again: its kept copy shows at once, marked stale, until the page sends a snapshot.
        // A screen change that closed it in this same task never closed the page's watch, so its data is current.
        if (!existing.closing) existing.store.reopened();
        existing.closing = false;
        subscribeWatch(existing);
      }
      return existing.handle;
    }
    const store = createWatchStore({ historyEntriesMax: limits.historyEntriesMax, emptyHoldMs: limits.documentReadyMs });
    if (lastNavigation) store.at(lastNavigation);
    const entry: WatchEntry = {
      id: watchId, specJson, spec, when: options.when, persist: options.persist === true, store, refs: 1, subscribed: false, lastResync: 0, resyncTimer: null, closing: false, openedAt: 0,
      handle: {
        id: watchId,
        get: store.get,
        subscribe: store.subscribe,
        resync: () => resyncWatch(entry, true),
        close() {
          if (entry.refs === 0 || --entry.refs > 0) return;
          // The page hears of it after this task, so a screen that opens the same watch keeps it.
          entry.closing = true;
          closeTimer ??= setTimeout(closeWatches, 0);
        },
      },
    };
    watches.set(watchId, entry);
    subscribeWatch(entry);
    return entry.handle;
  }

  /** Closes, in the page too, every watch whose last reference closed and that no one opened again. */
  function closeWatches() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    for (const entry of [...watches.values()]) {
      if (!entry.closing) continue;
      entry.closing = false;
      if (entry.subscribed) session.request("watch.unsubscribe", { context: id, id: entry.id }).catch(() => {});
      entry.subscribed = false;
      if (entry.resyncTimer) clearTimeout(entry.resyncTimer);
      entry.resyncTimer = null;
      // The closed watch stays, following navigations, so its history copies outlive the screen.
      watches.delete(entry.id);
      watches.set(entry.id, entry);
    }
    dropClosedWatches();
  }

  /** Keeps at most `CLOSED_WATCHES_MAX` closed watches, dropping the ones closed longest ago. */
  function dropClosedWatches() {
    const closed = [...watches.values()].filter(entry => entry.refs === 0);
    for (const entry of closed.slice(0, Math.max(0, closed.length - CLOSED_WATCHES_MAX))) watches.delete(entry.id);
  }

  function forget(options: { current?: boolean; keepInputs?: boolean } = {}) {
    drainEmits();
    for (const entry of watches.values()) entry.store.forget(options.current === true);
    // Genesis's own copies of the pages, too, so none shows on the next start.
    session.request("store.forget", { context: id }).catch(fail("store.forget"));
    if (options.keepInputs) return;
    for (const record of [...inputs.values()]) {
      record.abort?.();
      settle(record, { outcome: "unknown", code: "CONTEXT_REPLACED", message: "The account changed before the input finished" });
    }
  }

  /** Applies a page's emit to its watch, when it is for the current document and an open watch. */
  function applyEmit(data: PageEmitEvent) {
    if (data.cached) {
      // A value Genesis kept, sent before the page has bound: it belongs to no document.
      const entry = watches.get(data.stream);
      if (entry?.subscribed) entry.store.emit(data);
      return;
    }
    if (data.generation !== state.generation) return;
    if (!state.view || state.view.n !== data.view.n || state.view.url !== data.view.url || state.view.generation !== data.view.generation) set({ view: data.view });
    const entry = watches.get(data.stream);
    if (!entry || !entry.subscribed) return;
    if (entry.store.emit(data) === "resync") resyncWatch(entry);
    if (debug.on && entry.openedAt) {
      debug.add("watch.first", { context: id, watch: entry.id, ms: Date.now() - entry.openedAt });
      entry.openedAt = 0;
    }
  }

  // ---- Emit queue -------------------------------------------------------------------------------

  /**
   * Emits wait here for the next animation frame, then apply together, so each watch's listeners
   * run once per frame. A large snapshot is compared in slices that yield to input first. Every
   * other context event applies the waiting emits before it, so the order stays the host's.
   */
  const emitQueue: PageEmitEvent[] = [];
  let flushScheduled = false;
  let flushing = false;

  function queueEmit(data: PageEmitEvent) {
    emitQueue.push(data);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushScheduled || flushing) return;
    flushScheduled = true;
    nextFrame(() => {
      flushScheduled = false;
      void flushEmits();
    });
  }

  async function flushEmits() {
    flushing = true;
    const pause = yielder();
    try {
      while (emitQueue.length) {
        const next = emitQueue[0]!;
        if (pause && large(next)) {
          await watches.get(next.stream)?.store.prepare(next, pause);
          // Another context event applied it meanwhile.
          if (emitQueue[0] !== next) continue;
        }
        batchNotifications(() => {
          let first = true;
          while (emitQueue.length) {
            const event = emitQueue[0]!;
            if (!first && pause && large(event)) break;
            first = false;
            emitQueue.shift();
            applyTimed(event);
          }
        });
      }
    } finally {
      flushing = false;
      if (emitQueue.length) scheduleFlush();
    }
  }

  /** Applies every waiting emit now. */
  function drainEmits() {
    if (!emitQueue.length) return;
    batchNotifications(() => {
      while (emitQueue.length) applyTimed(emitQueue.shift()!);
    });
  }

  function applyTimed(data: PageEmitEvent) {
    if (!debug.on) return applyEmit(data);
    const start = performance.now();
    applyEmit(data);
    const end = performance.now();
    performance.measure(`genesis.emit ${id}/${data.stream}`, { start, end });
    if (end - start > EMIT_SLOW_MS) debug.add("emit.apply", { context: id, watch: data.stream, kind: data.kind, ms: Math.round(end - start) });
  }

  function resyncAll() {
    if (state.bound && [...watches.values()].some(entry => entry.refs > 0)) send("watch.resync", {}).catch(() => {});
  }

  function stopLoading() {
    if (loadingTimer) clearTimeout(loadingTimer);
    loadingTimer = null;
  }

  // ---- Handle -----------------------------------------------------------------------------------

  const fail = (method: string) => (error: unknown) => {
    if (!(error instanceof GenesisError && error.code === "RETIRED")) console.error(`Genesis ${method} failed`, error);
  };
  /** Rejects with the host's `GenesisError` when Genesis refuses the navigation. */
  const navigation = (method: "context.navigate" | "context.back" | "context.forward" | "context.reload", params: Record<string, unknown>) => {
    leftBy();
    return session.request(method, { id, ...params }).then(() => {});
  };

  const handle: ContextHandle = {
    id,
    get state() { return state; },
    subscribe,
    get navigation() { return lastNavigation; },
    onNavigated(listener) {
      navigationListeners.add(listener);
      return () => { navigationListeners.delete(listener); };
    },
    navigate(url, options = {}) {
      let absolute: string;
      try { absolute = new URL(url, state.url).href; } catch { return Promise.reject(new GenesisError("INVALID_ARGUMENT", `Not a URL: ${url}`)); }
      return navigation("context.navigate", { url: absolute, mode: options.mode ?? "push" });
    },
    back: steps => navigation("context.back", steps === undefined ? {} : { steps }),
    forward: () => navigation("context.forward", {}),
    reload: () => navigation("context.reload", {}),

    call: (op, args = {}, options = {}) => send(op, args, options.timeoutMs),

    info: (options = {}) => repeating("info", {}, options.timeoutMs),
    read: (spec, options = {}) => repeating("read", { spec }, options.timeoutMs),
    inspect: (target, options = {}) => repeating("inspect", { target }, options.timeoutMs),
    wait: async (condition, timeoutMs) => {
      await repeating("wait", { for: condition, timeoutMs }, timeoutMs);
    },
    scroll: (to, options = {}) => {
      const args: Record<string, unknown> = { to };
      if (options.target !== undefined) args.target = options.target;
      return send("scroll", args, options.timeoutMs);
    },

    click: (target, options = {}) => {
      const { gesture, count, ...rest } = options;
      return run("click", target, defined({ gesture, count }), rest);
    },
    longPress: (target, options = {}) => {
      const { ms, ...rest } = options;
      return run("longPress", target, defined({ ms }), rest);
    },
    hover: (target, options) => run("hover", target, {}, options),
    unhover: options => run("unhover", undefined, {}, options),
    focus: (target, options) => run("focus", target, {}, options),
    blur: (target, options) => run("blur", target, {}, options),
    fill: (target, value, options) => run("fill", target, { value }, options),
    type: (target, text, options) => run("type", target, { text }, options),
    press: (key, options = {}) => {
      const { target, modifiers, ...rest } = options;
      return run("press", target, defined({ key, modifiers }), rest);
    },
    select: (target, choice, options) => run("select", target, defined({ values: choice.values, labels: choice.labels }), options),
    check: (target, checked, options) => run("check", target, { checked }, options),
    submit: (target, options) => run("submit", target, {}, options),
    attachFiles: (target, files, options = {}) => {
      const { via, ...rest } = options;
      const ids = files.map(file => typeof file === "string" ? file : file.id);
      return run("attachFiles", target, defined({ files: ids, via }), rest);
    },
    run: (steps, options = {}) => {
      const { expect, navigates, timeoutMs, until: evidence, deadlineMs } = options;
      return input("run", defined({ steps, until: evidence, navigates, deadlineMs }), { expect, navigates, timeoutMs });
    },
    invoke: (command, args, options = {}) => {
      const { target, expect, navigates, timeoutMs } = options;
      return input("invoke", defined({ command, args, target }), { expect, navigates, timeoutMs }) as Promise<ActionResult & { value?: never }>;
    },

    pending,
    subscribePending(listener) {
      pendingListeners.add(listener);
      return () => { pendingListeners.delete(listener); };
    },
    cancel() {
      session.request("page.cancel", { context: id }).catch(fail("page.cancel"));
    },

    allow: grant => session.request("context.grant", { id, grant }) as Promise<GrantResult>,
    onGrantEnded(listener) {
      grantListeners.add(listener);
      return () => { grantListeners.delete(listener); };
    },

    hold,

    watch: watch as ContextHandle["watch"],
    resync: resyncAll,
    forget,
  };

  return {
    handle,
    bound(data) {
      drainEmits();
      if (data.generation < latest) return;
      latest = data.generation;
      boundCount++;
      stopLoading();
      set({ generation: data.generation, url: data.url, bound: true, loading: false, error: null });
      for (const entry of watches.values()) continueWatch(entry);
    },
    navigated(data) {
      drainEmits();
      if (data.generation < latest) return;
      // A new document: calls wait for its `context.bound`, which brings its generation.
      const newer = data.generation > latest;
      latest = data.generation;
      for (const entry of watches.values()) entry.store.navigated(data);
      stopLoading();
      set({
        url: data.url, index: data.index, canGoBack: data.canGoBack, canGoForward: data.canGoForward, loading: false,
        ...(newer ? { bound: false, view: null } : {}),
      });
      lastNavigation = data;
      // The document may have bound before its navigation was reported.
      for (const entry of watches.values()) continueWatch(entry);
      for (const listener of [...navigationListeners]) call(() => listener(data));
    },
    started() {
      stopLoading();
      loadingTimer = setTimeout(() => { loadingTimer = null; set({ loading: false }); }, limits.actionTimeoutMs);
      set({ loading: true });
    },
    gone(data) {
      drainEmits();
      const error: ErrorBody = { code: (data.code ?? "NOT_READY") as ErrorCode, message: data.message ?? "The page is gone" };
      leftBy();
      for (const entry of watches.values()) entry.store.gone(error);
      stopLoading();
      set({ bound: false, loading: false, error });
    },
    emit: queueEmit,
    grantEnded(data) {
      if (data.id !== id) return;
      for (const listener of [...grantListeners]) {
        try { listener(data); } catch (error) { console.error("Genesis grantEnded listener failed", error); }
      }
    },
    resumed: resyncAll,
    retired() {
      for (const record of [...inputs.values()]) {
        record.abort?.();
        settle(record, { outcome: "unknown", code: "RETIRED", message: "This page was closed" });
      }
    },
  };
}

/** The value of an input call as an outcome; a command's own value answers `observed` with `value`. */
function asResult(op: PageOp, value: unknown): ActionResult & { value?: unknown } {
  if (isObject(value) && typeof value.outcome === "string") return value as unknown as ActionResult;
  if (op === "invoke") return { outcome: "observed", value };
  return { outcome: "observed" };
}

/** True when `run` steps end in a navigation. */
function leavesBySteps(op: PageOp, args: Record<string, unknown>) {
  if (op !== "run" || !Array.isArray(args.steps)) return false;
  const last = args.steps.at(-1) as { op?: string } | undefined;
  return last?.op === "navigate" || last?.op === "submit";
}

/** A read's value is truthy when it is truthy; a list, when it has records. */
function truthy(value: unknown) {
  if (isObject(value) && Array.isArray(value.order)) return value.order.length > 0;
  return Boolean(value);
}

function defined(value: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = item;
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
