import type { ContextNavigated, ErrorBody, PageEmitEvent, ViewId, WatchPatch, WatchSnapshot, WatchStatus } from "@let/core";

/**
 * The value of one watch. `get()` returns the same object until something in it changes, and a
 * list record keeps its object while its data is unchanged, so a UI can compare by reference.
 */
export interface WatchValue<V = unknown, R = unknown> {
  /** `loading` until the first snapshot of the current page, `error` when the read failed. */
  status: "loading" | "ready" | "error";
  /** The page's URL matches none of the watch's `when` guards, so the agent is not reading it. */
  idle: boolean;
  /** The data comes from an earlier copy of this page: Back, a reload, or a page that failed after it was ready. */
  stale: boolean;
  /** A single read's value; null for a list. */
  value: V | null;
  /** A list's keys in page order. */
  order: readonly string[];
  /** A list's records by key. */
  records: Readonly<Record<string, R>>;
  error: ErrorBody | null;
  /** The list has more items than the read keeps. */
  truncated: boolean;
  /** A list whose reader names a "more" link: false while the page offers more items. */
  complete: boolean | undefined;
  /** The page the data was read from, or null before the first snapshot. */
  view: ViewId | null;
  /**
   * Epoch milliseconds when the data last changed, or null without data. A value Genesis kept from
   * an earlier visit shows, marked `stale`, with the time it was read, until the page's snapshot.
   */
  updatedAt: number | null;
}

/** What the caller does after `emit`: `resync` means a patch could not be applied and a fresh snapshot is needed. */
export type EmitResult = "applied" | "ignored" | "resync";

export interface WatchStore {
  get(): WatchValue;
  subscribe(listener: () => void): () => void;
  emit(event: PageEmitEvent): EmitResult;
  /** A committed navigation of the context. */
  navigated(navigation: ContextNavigated): void;
  /** The context's document is gone. */
  gone(error: ErrorBody): void;
  /** The watch could not be opened. */
  failed(error: ErrorBody): void;
  /** Forgets the stream, so the next snapshot starts it again; the data stays. */
  restart(): void;
  /** Places a new store at the context's current history entry, without changing its data. */
  at(navigation: ContextNavigated): void;
  /** A UI opens the watch again: the data it kept is shown, marked stale, until the page's snapshot. */
  reopened(): void;
  /** Forgets every kept copy; with `current`, also the data shown now. */
  forget(current: boolean): void;
  /**
   * Compares a large snapshot's records with the current ones ahead of `emit`, awaiting `pause`
   * between slices, so the work yields to input. `emit` uses the result while the data it was
   * compared with is still current.
   */
  prepare(event: PageEmitEvent, pause: () => Promise<unknown>): Promise<void>;
}

/** The status a screen renders from: a skeleton, the data, the data marked as refreshing, or an error. */
export type DataStatus = "empty" | "loading" | "fresh" | "stale" | "failed";

/**
 * One status for a watch value. `loading`: no data yet, show a skeleton. `empty`: the page has
 * nothing to show, or the watch is idle on this page. `fresh`: current data. `stale`: data from an
 * earlier read, shown while the page reads again or after a failed read. `failed`: an error and no data.
 */
export function watchStatus(value: WatchValue): DataStatus {
  if (hasData(value)) return value.status === "ready" && !value.stale ? "fresh" : "stale";
  if (value.status === "error") return "failed";
  if (value.idle || (value.status === "ready" && !value.stale)) return "empty";
  return "loading";
}

/** A snapshot with more records than this is compared in slices when the caller can yield. */
export const SNAPSHOT_SLICE_MIN = 100;
const SNAPSHOT_SLICE = 50;

export interface WatchStoreOptions {
  /** History entries whose last ready copy the store keeps. */
  historyEntriesMax: number;
  /**
   * How long a cached value stays on show after the page's own read came back empty. A website
   * often renders its content after the first read, and no message says that an empty page is
   * done, so a context passes the time a page has to become ready (`limits.documentReadyMs`).
   * Without it, an empty read shows at once.
   */
  emptyHoldMs?: number;
}

let batchDepth = 0;
const heldNotifications = new Set<() => void>();

/**
 * Runs `apply`, and calls each store's listeners once after it, however many times its value
 * changed meanwhile.
 */
export function batchNotifications(apply: () => void): void {
  batchDepth++;
  try {
    apply();
  } finally {
    if (--batchDepth === 0) {
      const notifications = [...heldNotifications];
      heldNotifications.clear();
      for (const notify of notifications) notify();
    }
  }
}

type Data = Pick<WatchValue, "value" | "order" | "records" | "truncated" | "complete" | "view" | "updatedAt">;

const EMPTY_ORDER: readonly string[] = Object.freeze([]);
const EMPTY_RECORDS: Readonly<Record<string, unknown>> = Object.freeze(Object.create(null));

export function emptyWatchValue(): WatchValue {
  return {
    status: "loading", idle: false, stale: false, value: null, order: EMPTY_ORDER, records: EMPTY_RECORDS,
    error: null, truncated: false, complete: undefined, view: null, updatedAt: null,
  };
}

/**
 * The client side of one watch stream. It applies snapshots, statuses and in-order patches, and
 * keeps the last ready copy of each history entry (at most `historyEntriesMax`), so Back shows
 * the entry at once, marked `stale`, until the new document sends its snapshot.
 *
 * A cached value stays on show while the page's own read is empty: until that read has data, the
 * watch goes idle or fails, the page changes, or `emptyHoldMs` pass.
 */
export function createWatchStore(options: WatchStoreOptions): WatchStore {
  const emptyHoldMs = options.emptyHoldMs ?? 0;
  /** The watch's own state. `get()` returns `held` instead while a cached value is on show. */
  let current = emptyWatchValue();
  /** The value of the last cached snapshot, until the page's stream replaces it. */
  let cached: WatchValue | null = null;
  /** The cached value on show while `current`, the page's own read, is still empty. */
  let held: WatchValue | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The stream position of the last applied message; null until a snapshot starts it. */
  let stream: { generation: number; n: number; seq: number } | null = null;
  /** The context's current history entry, from the last committed navigation. */
  let entry: { index: number; url: string } | null = null;
  /** The last ready data per history index, validated by URL. */
  const history = new Map<number, Data>();
  /** The URL the current data belongs to. */
  let url: string | null = null;
  const listeners = new Set<() => void>();
  /** The records of a large snapshot, compared ahead of `emit` with `base`. */
  let prepared: { body: unknown; base: Readonly<Record<string, unknown>>; records: Record<string, unknown> } | null = null;

  const notify = () => { for (const listener of [...listeners]) listener(); };

  function set(next: WatchValue) {
    if (same(next, current)) return;
    // An empty read of a page that may not have rendered yet does not replace cached data.
    const hold = emptyHoldMs > 0 && emptyRead(next) && (held !== null || showsCached());
    const shown = held ?? current;
    if (!next.stale) cached = null;
    current = next;
    remember();
    if (hold) {
      held = shown;
      holdTimer ??= setTimeout(settle, emptyHoldMs);
      return;
    }
    release();
    if (batchDepth > 0) heldNotifications.add(notify);
    else notify();
  }

  /** `current` still shows the data of the last cached snapshot, whatever happened to its status. */
  function showsCached() {
    return cached !== null && current.stale && hasData(current)
      && current.order === cached.order && current.records === cached.records && current.value === cached.value;
  }

  function release() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    held = null;
  }

  /** The page had its time to render: its empty read is the value. */
  function settle() {
    release();
    notify();
  }

  /** Keeps the current data as the history entry of the current index, when they agree. */
  function remember() {
    if (current.status !== "ready" || current.stale || current.idle || !entry || !sameUrl(entry.url, url)) return;
    history.delete(entry.index);
    history.set(entry.index, data(current));
    while (history.size > options.historyEntriesMax) history.delete(history.keys().next().value!);
  }

  function snapshot(event: PageEmitEvent, body: WatchSnapshot): WatchValue {
    const list = Array.isArray(body.order);
    const ready = prepared && prepared.body === body && prepared.base === current.records ? prepared.records : null;
    prepared = null;
    const records = list ? ready ?? reuse(current.records, body.records ?? {}) : EMPTY_RECORDS;
    const order = list ? sameArray(current.order, body.order!) ? current.order : Object.freeze([...body.order!]) : EMPTY_ORDER;
    url = event.url;
    if (body.status === "error") {
      // A failed read keeps the last data of this URL, marked stale.
      const kept = current.view && sameUrl(current.view.url, event.url) && hasData(current);
      return kept
        ? { ...current, status: "error", idle: false, stale: true, error: body.error ?? null }
        : { ...emptyWatchValue(), status: "error", error: body.error ?? null, view: event.view };
    }
    return {
      status: "ready", idle: false, stale: false, error: null,
      value: list ? null : keep(current.value, body.value ?? null),
      order, records,
      truncated: body.truncated === true,
      complete: body.complete,
      view: sameView(current.view, event.view) ? current.view : event.view,
      updatedAt: event.at ?? Date.now(),
    };
  }

  function patch(body: WatchPatch): WatchValue {
    let records = current.records;
    if (body.upsert || body.remove) {
      records = Object.assign(Object.create(null), current.records);
      for (const key of body.remove ?? []) delete (records as Record<string, unknown>)[key];
      const upserted = reuse(current.records, body.upsert ?? {});
      for (const key of Object.keys(body.upsert ?? {})) (records as Record<string, unknown>)[key] = upserted[key];
      Object.freeze(records);
    }
    const order = body.order && !sameArray(current.order, body.order) ? Object.freeze([...body.order]) : current.order;
    const complete = "complete" in body ? body.complete : current.complete;
    return { ...current, order, records, complete, updatedAt: Date.now() };
  }

  function status(event: PageEmitEvent, body: WatchStatus): WatchValue {
    let next = current;
    if (body.idle !== undefined) next = { ...next, idle: body.idle };
    if (body.status === "error") next = { ...next, status: "error", error: body.error ?? null, stale: hasData(next) };
    if (body.status === "ready") next = { ...next, status: "ready", error: null };
    if (body.idle) url = event.url;
    return next;
  }

  return {
    get: () => held ?? current,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    emit(event) {
      const { kind, seq, view } = event;
      if (event.cached) {
        // A kept value fills in only until the page's own stream starts, and stays stale.
        if (kind !== "snapshot" || stream || (current.status === "ready" && !current.stale)) return "ignored";
        const value = { ...snapshot(event, event.data as WatchSnapshot), stale: true };
        set(value);
        cached = value;
        return "applied";
      }
      if (kind === "patch") {
        if (!stream || stream.generation !== view.generation || stream.n !== view.n || seq !== stream.seq + 1) return "resync";
        stream.seq = seq;
        set(patch(event.data as WatchPatch));
        return "applied";
      }
      if (stream && stream.generation === view.generation && seq <= stream.seq) return "ignored";
      stream = { generation: view.generation, n: view.n, seq };
      set(kind === "snapshot" ? snapshot(event, event.data as WatchSnapshot) : status(event, event.data as WatchStatus));
      return "applied";
    },

    navigated(navigation) {
      for (const index of [...history.keys()]) {
        const kept = history.get(index)!;
        const keptUrl = kept.view?.url ?? null;
        if (index >= navigation.size || (index === navigation.index && !sameUrl(keptUrl, navigation.url))) history.delete(index);
      }
      entry = { index: navigation.index, url: navigation.url };
      if (navigation.sameDocument) {
        // The agent sends a snapshot for the new view; until then the data belongs to the old one.
        if (!sameUrl(url, navigation.url)) restore(navigation);
        return;
      }
      stream = null;
      if (sameUrl(url, navigation.url)) {
        // The same URL in a new document, such as a reload: the data stays, stale, until it sends a snapshot.
        set({ ...current, status: "loading", error: null, stale: hasData(current) });
      } else {
        restore(navigation);
      }
    },

    gone(error) {
      stream = null;
      set({ ...current, status: "error", error, stale: hasData(current) });
    },

    failed(error) {
      set({ ...current, status: "error", error, stale: hasData(current) });
    },

    restart() {
      stream = null;
    },

    at(navigation) {
      entry = { index: navigation.index, url: navigation.url };
    },

    reopened() {
      stream = null;
      if (hasData(current)) set({ ...current, status: "loading", error: null, stale: true });
    },

    forget(all) {
      history.clear();
      if (!all) return;
      url = null;
      set(emptyWatchValue());
    },

    async prepare(event, pause) {
      const body = event.data as WatchSnapshot;
      if (event.kind !== "snapshot" || !Array.isArray(body.order) || !body.records) return;
      const keys = Object.keys(body.records);
      if (keys.length <= SNAPSHOT_SLICE_MIN) return;
      const base = current.records;
      const out: Record<string, unknown> = Object.create(null);
      let changed = keys.length !== Object.keys(base).length;
      for (let start = 0; start < keys.length; start += SNAPSHOT_SLICE) {
        if (start > 0) await pause();
        for (const key of keys.slice(start, start + SNAPSHOT_SLICE)) {
          if (reuseOne(base, body.records, out, key)) changed = true;
        }
      }
      prepared = { body, base, records: changed ? Object.freeze(out) : base };
    },
  };

  /** Shows the history copy of the entry, marked stale, or nothing until the page's snapshot arrives. */
  function restore(navigation: ContextNavigated) {
    const kept = history.get(navigation.index);
    url = navigation.url;
    set(kept
      ? { ...emptyWatchValue(), ...kept, status: "loading", stale: true }
      : emptyWatchValue());
  }
}

function data(value: WatchValue): Data {
  const { value: v, order, records, truncated, complete, view, updatedAt } = value;
  return { value: v, order, records, truncated, complete, view, updatedAt };
}

function hasData(value: WatchValue) {
  return value.value !== null || value.order.length > 0;
}

/** A read of the page itself that found nothing: a list without items, or a null value. */
function emptyRead(value: WatchValue) {
  return value.status === "ready" && !value.stale && !value.idle && !hasData(value);
}

function sameUrl(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  try { return new URL(a).href === new URL(b).href; } catch { return false; }
}

function sameView(a: ViewId | null, b: ViewId) {
  return a !== null && a.generation === b.generation && a.n === b.n && a.url === b.url;
}

function sameArray(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** `next`, or `previous` when both have the same JSON. */
function keep(previous: unknown, next: unknown) {
  return previous !== null && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

/** New records by key, each keeping its previous object when its JSON did not change. */
function reuse(previous: Readonly<Record<string, unknown>>, next: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  const keys = Object.keys(next);
  let changed = keys.length !== Object.keys(previous).length;
  for (const key of keys) if (reuseOne(previous, next, out, key)) changed = true;
  return changed ? Object.freeze(out) : previous;
}

/** Sets `out[key]` to the previous record when its JSON is unchanged; true when it changed. */
function reuseOne(previous: Readonly<Record<string, unknown>>, next: Record<string, unknown>, out: Record<string, unknown>, key: string) {
  const old = previous[key];
  out[key] = old === undefined ? next[key] : keep(old, next[key]);
  return out[key] !== old;
}

/** True when nothing a UI reads changed, so `get()` keeps returning the same object; `updatedAt` follows the data. */
function same(a: WatchValue, b: WatchValue) {
  return a.status === b.status && a.idle === b.idle && a.stale === b.stale && a.value === b.value
    && a.order === b.order && a.records === b.records && a.error === b.error && a.truncated === b.truncated
    && a.complete === b.complete && a.view === b.view;
}
