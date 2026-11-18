import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import type { ActionResult, ActivityLevel, FilesPick, GrantKind, GrantResult, Locator, ReadSpec } from "@let/core";
import type { PickedFile } from "./client/actions.js";
import type { ContextHandle, ContextState, Expect, PendingInput, Watch, WatchOptions } from "./client/context.js";
import { connect, type ConnectOptions, type Genesis } from "./client/session.js";
import { emptyWatchValue, watchStatus, type DataStatus, type WatchValue } from "./client/watch.js";
import { createRouter, type CurrentScreen, type NavigateTarget, type Router, type RouterOptions, type RouteStatus } from "./router/router.js";
import type { Storage, StorageBatch, StoredDocument } from "./types.js";

/**
 * `@let/sdk/react`: React bindings over the client. Every hook reads the client of the
 * surrounding `GenesisProvider`; `mount` connects and renders in one call.
 */

interface Runtime {
  genesis: Genesis;
  router: Router | null;
  /** Watches opened by `useWatch`, by context and id, so `useRecord` can read them. */
  watches: Registry;
  /** Scroll positions by screen key. */
  scroll: Map<string, number>;
}

const RuntimeContext = createContext<Runtime | null>(null);

export function GenesisProvider({ genesis, router, children }: { genesis: Genesis; router?: Router | null; children?: ReactNode }) {
  const runtime = useMemo<Runtime>(() => ({ genesis, router: router ?? null, watches: createRegistry(), scroll: new Map() }), [genesis, router]);
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("Genesis hooks need mount or GenesisProvider");
  return runtime;
}

/** The connected client of the surrounding `GenesisProvider`. */
export function useGenesis(): Genesis {
  return useRuntime().genesis;
}

/** Reports `ui.ready` after the first committed layout has been painted. */
function Ready({ genesis, children }: { genesis: Genesis; children?: ReactNode }) {
  useLayoutEffect(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => genesis.ready()));
  }, [genesis]);
  return children;
}

export interface MountOptions extends ConnectOptions {
  /** `#root` by default. */
  container?: HTMLElement;
  /** Creates the router helper with these options; `useRouter` then returns it. */
  router?: RouterOptions;
}

/**
 * Connects to Genesis, renders `element` into `#root` (or `container`), reports the first layout,
 * and unmounts when Genesis retires the document.
 */
export async function mount(element: ReactNode, options: MountOptions = {}): Promise<{ genesis: Genesis; router: Router | null }> {
  const { container, router: routerOptions, ...connectOptions } = options;
  const target = container ?? document.getElementById("root") ?? document.body.appendChild(document.createElement("div"));
  const genesis = await connect(connectOptions);
  const router = routerOptions ? createRouter(genesis, routerOptions) : null;
  const root = createRoot(target);
  genesis.onRetired(() => {
    router?.destroy();
    root.unmount();
  });
  root.render(
    <GenesisProvider genesis={genesis} router={router}>
      <Ready genesis={genesis}>{element}</Ready>
    </GenesisProvider>,
  );
  return { genesis, router };
}

// ---- Contexts -----------------------------------------------------------------------------------

const noSubscribe = () => () => {};

/** The router's version, so a hook re-renders on its changes; 0 without a router. */
function useRouterVersion(router: Router | null): number {
  return useSyncExternalStore(router ? router.subscribe : noSubscribe, () => router?.version ?? 0);
}

/** The context a hook reads: the given one, else the router's active context, else the first. */
function useContextHandle(contextId?: string): ContextHandle {
  const { genesis, router } = useRuntime();
  useRouterVersion(contextId === undefined ? router : null);
  return genesis.context(contextId ?? router?.state.active);
}

/** The context handle a call uses: the given one, else the active one at call time. */
function handleAt(runtime: Runtime, contextId?: string): ContextHandle {
  return runtime.genesis.context(contextId ?? runtime.router?.state.active);
}

/** A context's state, the active context by default. */
export function useContextState(contextId?: string): ContextState {
  const handle = useContextHandle(contextId);
  return useSyncExternalStore(handle.subscribe, () => handle.state);
}

// ---- Watches ------------------------------------------------------------------------------------

interface Registry {
  get(context: string, id: string): Watch | undefined;
  add(context: string, watch: Watch): () => void;
  subscribe(listener: () => void): () => void;
}

function createRegistry(): Registry {
  const watches = new Map<string, { watch: Watch; refs: number }>();
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  const key = (context: string, id: string) => `${context}\n${id}`;
  return {
    get: (context, id) => watches.get(key(context, id))?.watch,
    add(context, watch) {
      const k = key(context, watch.id);
      const entry = watches.get(k);
      if (entry) entry.refs++;
      else {
        watches.set(k, { watch, refs: 1 });
        changed();
      }
      return () => {
        const current = watches.get(k);
        if (!current || --current.refs > 0) return;
        watches.delete(k);
        changed();
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const EMPTY = emptyWatchValue();

/**
 * Opens a watch while the component is mounted and returns its value: an empty `loading` value
 * until it opens. The same `id` with the same specification shares one watch.
 */
export function useWatch<V = unknown, R = unknown>(id: string, spec: ReadSpec, options: WatchOptions & { context?: string } = {}): WatchValue<V, R> {
  const { watches } = useRuntime();
  const handle = useContextHandle(options.context);
  const json = JSON.stringify([spec, options.when ?? null, options.persist === true]);
  const [watch, setWatch] = useState<Watch | null>(null);
  useEffect(() => {
    const [parsedSpec, when, persist] = JSON.parse(json) as [ReadSpec, WatchOptions["when"] | null, boolean];
    const opened = handle.watch(id, parsedSpec, { ...(when ? { when } : {}), ...(persist ? { persist } : {}) });
    const remove = watches.add(handle.id, opened);
    setWatch(opened);
    return () => {
      remove();
      opened.close();
      setWatch(current => (current === opened ? null : current));
    };
  }, [handle, id, json, watches]);
  const value = useSyncExternalStore(watch ? watch.subscribe : noSubscribe, () => watch?.get() ?? EMPTY);
  return value as WatchValue<V, R>;
}

/**
 * The status of a watch, to pick what a screen shows: a skeleton for `loading`, the empty state
 * for `empty`, the data for `fresh` and `stale` (with a quiet refreshing mark for `stale`), and the
 * error view for `failed`. It opens the watch as `useWatch` does and shares it with a `useWatch`
 * of the same id and specification; `watchStatus(value)` gives the same for a value in hand.
 */
export function useWatchStatus(id: string, spec: ReadSpec, options: WatchOptions & { context?: string } = {}): DataStatus {
  return watchStatus(useWatch(id, spec, options));
}

/**
 * One record of a list watch that a `useWatch` in this provider has open, or undefined. It
 * re-renders only when that record changes.
 */
export function useRecord<R = unknown>(watchId: string, key: string, contextId?: string): R | undefined {
  const { watches } = useRuntime();
  const handle = useContextHandle(contextId);
  const subscribe = useCallback((listener: () => void) => {
    let stopWatch = () => {};
    const follow = () => {
      stopWatch();
      stopWatch = watches.get(handle.id, watchId)?.subscribe(listener) ?? (() => {});
    };
    const stopRegistry = watches.subscribe(() => { follow(); listener(); });
    follow();
    return () => { stopRegistry(); stopWatch(); };
  }, [watches, handle, watchId]);
  return useSyncExternalStore(subscribe, () => watches.get(handle.id, watchId)?.get().records[key] as R | undefined);
}

export interface CommandOptions {
  target?: Locator;
  expect?: Expect;
  navigates?: boolean;
  timeoutMs?: number;
}

/**
 * Runs a page module command in a context, the active one at call time by default. The promise
 * never rejects; identical pending calls share it.
 */
export function useCommand<A = unknown, T = unknown>(name: string, contextId?: string) {
  const runtime = useRuntime();
  return useCallback((args?: A, options?: CommandOptions): Promise<ActionResult & { value?: T }> =>
    handleAt(runtime, contextId).invoke<T>(name, args, options), [runtime, name, contextId]);
}

/** The inputs that have not settled in a context, only those on `target` when given; for optimistic display. */
export function usePending(target?: Locator, contextId?: string): readonly PendingInput[] {
  const handle = useContextHandle(contextId);
  return useSyncExternalStore(handle.subscribePending, () => handle.pending(target));
}

// ---- Router -------------------------------------------------------------------------------------

export interface RouterView {
  /** The active context. */
  active: string;
  /** The screen to render, or null when the active context shows a URL without a route. */
  screen: CurrentScreen | null;
  /** The context whose website is shown, or null. */
  revealed: string | null;
  status(contextId?: string): RouteStatus;
  presentation(contextId?: string): ReturnType<Router["presentation"]>;
  state: Router["state"];
  navigate(target: NavigateTarget): void;
  back(): void;
  select(contextId: string): void;
  reload(contextId?: string): void;
  viewWebsite(contextId?: string): void;
  done(contextId?: string): void;
  setLeaveGuard(message: string | null): void;
  onConfirmLeave: Router["onConfirmLeave"];
}

/** The router helper given to `mount` or `GenesisProvider`, re-rendering on its changes. */
export function useRouter(): RouterView {
  const { router } = useRuntime();
  if (!router) throw new Error("useRouter needs a router: pass `router` to mount or GenesisProvider");
  const version = useRouterVersion(router);
  return useMemo(() => ({
    active: router.state.active,
    screen: router.screen(),
    revealed: router.revealed(),
    status: router.status,
    presentation: router.presentation,
    state: router.state,
    navigate: router.navigate,
    back: router.back,
    select: router.select,
    reload: router.reload,
    viewWebsite: router.viewWebsite,
    done: router.done,
    setLeaveGuard: router.setLeaveGuard,
    onConfirmLeave: router.onConfirmLeave,
  }), [router, version]);
}

// ---- Storage, services, scroll, resume ----------------------------------------------------------

/**
 * Every document in `collection`, reloaded after each change to it. `storage` defaults to the
 * host's storage; pass an applet's own implementation, such as one over its backend, to use that.
 *
 * Every write is checked against a revision, so it fails with `CONFLICT` when the document
 * changed since it was read. `put(key, value)` and `remove(key)` check against the revision the
 * hook last loaded (absent for a key it has not loaded); `put(key, value, expectedRevision)`
 * checks against the one given, `null` meaning the document must not exist yet. `commit` sends
 * the batch as it is, so it must carry a check for each document it changes.
 */
export function useRecords<T>(collection: string, options: { storage?: Storage } = {}) {
  const genesis = useGenesis();
  const storage = options.storage ?? genesis.storage;
  const [state, setState] = useState<{ records: StoredDocument<T>[]; loading: boolean; error: unknown }>(
    { records: [], loading: true, error: null });

  useEffect(() => {
    let active = true;
    let serial = 0;
    async function load() {
      const current = ++serial;
      try {
        const records: StoredDocument<T>[] = [];
        let afterKey: string | undefined;
        do {
          const page = await storage.list<T>(collection, afterKey === undefined ? {} : { afterKey });
          records.push(...page.entries);
          afterKey = page.nextAfterKey ?? undefined;
        } while (afterKey !== undefined);
        if (active && current === serial) setState({ records, loading: false, error: null });
      } catch (error) {
        if (active && current === serial) setState(previous => ({ ...previous, loading: false, error }));
      }
    }
    void load();
    const stop = storage.onChanged(change => {
      if (change.changes.some(entry => entry.collection === collection)) void load();
    });
    return () => { active = false; stop(); };
  }, [storage, collection]);

  // The revisions last loaded, read when a write runs rather than when it was created.
  const loaded = useRef(state.records);
  loaded.current = state.records;
  const revisionOf = useCallback((key: string) => loaded.current.find(record => record.key === key)?.revision ?? null, []);

  const commit = useCallback((batch: StorageBatch) => storage.commit(batch), [storage]);
  const put = useCallback((key: string, value: T, expectedRevision?: number | null) =>
    storage.commit({
      checks: [{ collection, key, expectedRevision: expectedRevision === undefined ? revisionOf(key) : expectedRevision }],
      puts: [{ collection, key, value }],
    }), [storage, collection, revisionOf]);
  const remove = useCallback((key: string) =>
    storage.commit({ checks: [{ collection, key, expectedRevision: revisionOf(key) }], deletes: [{ collection, key }] }),
  [storage, collection, revisionOf]);
  return { ...state, put, remove, commit };
}

/** `request(path, options)` for a declared service. Shell failures throw `ServiceError`. */
export function useService(serviceId: string) {
  const genesis = useGenesis();
  return useCallback(<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}) =>
    genesis.services.request<T>(serviceId, path, options), [genesis, serviceId]);
}

/**
 * One-time grants of a context (see `ContextHandle.allow`): `allow(kind)` asks for one from the
 * user's tap, and `grant` is the kind the hidden page may use now, or null once it ended.
 */
export function useGrant(contextId?: string): { grant: GrantKind | null; allow(kind: GrantKind): Promise<GrantResult> } {
  const handle = useContextHandle(contextId);
  const [grant, setGrant] = useState<GrantKind | null>(null);
  useEffect(() => {
    setGrant(null);
    return handle.onGrantEnded(ended => setGrant(current => (current === ended.grant ? null : current)));
  }, [handle]);
  const allow = useCallback(async (kind: GrantKind) => {
    const result = await handle.allow(kind);
    if (result.expiresInMs > 0) setGrant(kind);
    return result;
  }, [handle]);
  return { grant, allow };
}

/**
 * Keeps a covered website running while `active` is true (see `ContextHandle.hold`), for work the
 * page does on its own, such as playing music. The level is "running" unless `options.level` says "awake".
 */
export function useHold(active: boolean, options: { context?: string; level?: ActivityLevel } = {}): void {
  const handle = useContextHandle(options.context);
  const level = options.level ?? "running";
  useEffect(() => (active ? handle.hold(level) : undefined), [handle, active, level]);
}

/** `post(input)` notifies the user; see `Genesis["notifications"]`. */
export function useNotifications() {
  return useGenesis().notifications;
}

/**
 * Files the user picks, held until removed or until the component unmounts, which releases them.
 * `pick` is a user action: call it straight from a tap's handler. Each file has a `previewUrl` for
 * an `<img>` or `<video>`, and its `id` goes to `attachFiles`. Never store the ids.
 */
export function useFilePicker() {
  const genesis = useGenesis();
  const [files, setFiles] = useState<readonly PickedFile[]>([]);
  const held = useRef<readonly PickedFile[]>([]);
  held.current = files;
  const release = useCallback((ids: string[]) => {
    genesis.files.release(ids).catch(error => console.error("Genesis files.release failed", error));
  }, [genesis]);

  useEffect(() => () => release(held.current.map(file => file.id)), [release]);

  const pick = useCallback(async (options?: FilesPick) => {
    const picked = await genesis.files.pick(options);
    if (!picked.length) return picked;
    const replaced = options?.multiple ? [] : held.current.map(file => file.id);
    const next = options?.multiple ? [...held.current, ...picked] : picked;
    held.current = next;
    setFiles(next);
    if (replaced.length) release(replaced);
    return picked;
  }, [genesis, release]);
  const remove = useCallback((id: string) => {
    if (!held.current.some(file => file.id === id)) return;
    const next = held.current.filter(file => file.id !== id);
    held.current = next;
    setFiles(next);
    release([id]);
  }, [release]);
  const clear = useCallback(() => {
    const ids = held.current.map(file => file.id);
    held.current = [];
    setFiles([]);
    if (ids.length) release(ids);
  }, [release]);
  return { files, pick, remove, clear };
}

/**
 * Restoring waits this long for the content to grow tall enough, since a screen's data can
 * arrive seconds after it shows; it stops earlier once the position is reached or as soon as the
 * person scrolls.
 */
const RESTORE_MS = 10_000;
const SCROLL_ENTRIES_MAX = 64;

/**
 * A ref callback for the current screen's scroll container. Positions are kept per screen: per
 * context history entry and per overlay screen with the router, per history entry of the context
 * without it. Back returns to where the person was; with the router, selecting the shown tab
 * again on its start page scrolls to top.
 */
export function useScrollMemory() {
  const { router, scroll } = useRuntime();
  useRouterVersion(router);
  const state = useContextState();
  const screen = router?.screen() ?? null;
  const key = router ? screen?.key ?? `${router.state.active}:none` : `${state.id}:${state.index}`;
  const context = router ? (screen && !screen.overlay ? screen.context : null) : state.id;
  return useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const target = scroll.get(key) ?? 0;
    let restoring = target > 0;
    const started = performance.now();
    let frame = 0;
    const restore = () => {
      if (!restoring) return;
      element.scrollTop = target;
      if (Math.abs(element.scrollTop - target) < 2 || performance.now() - started > RESTORE_MS) restoring = false;
      else frame = requestAnimationFrame(restore);
    };
    const stopRestoring = () => { restoring = false; };
    const record = () => {
      if (restoring) return;
      scroll.delete(key);
      scroll.set(key, element.scrollTop);
      while (scroll.size > SCROLL_ENTRIES_MAX) scroll.delete(scroll.keys().next().value!);
    };
    const stopTop = router?.onScrollToTop(id => {
      if (id !== context) return;
      restoring = false;
      element.scrollTo({ top: 0, behavior: "smooth" });
    });
    restore();
    element.addEventListener("scroll", record, { passive: true });
    element.addEventListener("touchstart", stopRestoring, { passive: true });
    element.addEventListener("wheel", stopRestoring, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      stopTop?.();
      element.removeEventListener("scroll", record);
      element.removeEventListener("touchstart", stopRestoring);
      element.removeEventListener("wheel", stopRestoring);
    };
  }, [scroll, router, key, context]);
}

// ---- Virtual list -------------------------------------------------------------------------------

export interface VirtualListProps {
  /** The rows' keys in order, such as a list watch's `order`. */
  keys: readonly string[];
  /** A row's expected height in pixels, used until the row has been measured. */
  estimateHeight: number;
  /**
   * Renders one row. Keep it stable (`useCallback`) and let the row read its own record with
   * `useRecord`, so scrolling and other rows' changes do not render it again.
   */
  renderItem(key: string): ReactNode;
  /** Rows rendered beyond each edge of the visible area; 8 by default. */
  overscan?: number;
  className?: string;
  /**
   * Names the list, such as `"saved"` or `"feed:" + tab`. A named list keeps its measured row
   * heights when it unmounts, so going Back to it restores the same scroll position even when
   * rows differ in height. Without an id, heights are measured again on every mount.
   */
  id?: string;
}

/** Measured row heights of named lists, kept across mounts. The oldest list is dropped first. */
const listHeights = new Map<string, Map<string, number>>();
const LIST_HEIGHTS_MAX = 16;
const LIST_ROWS_MAX = 2000;

function keptHeights(id: string | undefined): Map<string, number> {
  if (id === undefined) return new Map();
  let heights = listHeights.get(id);
  if (heights) listHeights.delete(id);
  else heights = new Map();
  listHeights.set(id, heights);
  if (listHeights.size > LIST_HEIGHTS_MAX) listHeights.delete(listHeights.keys().next().value!);
  return heights;
}

/**
 * A long list that renders only the rows near the visible area, with spacers for the rest. It
 * scrolls with its nearest scrolling ancestor, such as a `ScrollMemory` container, or the page.
 * Rows are measured once rendered and skip their painting while off screen
 * (`content-visibility: auto`).
 */
export function VirtualList({ keys, estimateHeight, renderItem, overscan = 8, className, id }: VirtualListProps) {
  const list = useRef<HTMLDivElement>(null);
  // The heights of the list `id` names now: a mounted list given another id reads that list's.
  const heights = useMemo(() => keptHeights(id), [id]);
  const [range, setRange] = useState(() => ({ start: 0, end: Math.min(keys.length, overscan * 2 + 16) }));
  const [measured, setMeasured] = useState(0);
  const heightOf = useCallback((key: string) => heights.get(key) ?? estimateHeight, [heights, estimateHeight]);

  const update = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollParent(element);
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
    const viewHeight = scroller ? scroller.clientHeight : innerHeight;
    const top = viewTop - element.getBoundingClientRect().top;
    let start = 0;
    let offset = 0;
    while (start < keys.length && offset + heightOf(keys[start]!) < top) offset += heightOf(keys[start++]!);
    let end = start;
    while (end < keys.length && offset < top + viewHeight) offset += heightOf(keys[end++]!);
    const next = { start: Math.max(0, start - overscan), end: Math.min(keys.length, end + overscan) };
    setRange(current => (current.start === next.start && current.end === next.end ? current : next));
  }, [keys, heightOf, overscan]);

  useLayoutEffect(update, [update, measured]);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollParent(element);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const target: EventTarget = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [update]);

  // Rows report their real heights, so the spacers and the range follow them. Another list's
  // heights get their own observer, which measures the rendered rows again.
  const observer = useMemo(() => typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    let changed = false;
    for (const entry of entries) {
      const key = (entry.target as HTMLElement).dataset.key;
      const height = entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight;
      if (key === undefined || height === 0 || heights.get(key) === height) continue;
      if (heights.size >= LIST_ROWS_MAX && !heights.has(key)) heights.delete(heights.keys().next().value!);
      heights.set(key, height);
      changed = true;
    }
    if (changed) setMeasured(count => count + 1);
  }), [heights]);
  useEffect(() => () => observer?.disconnect(), [observer]);

  let before = 0;
  for (let i = 0; i < range.start && i < keys.length; i++) before += heightOf(keys[i]!);
  let after = 0;
  for (let i = Math.min(range.end, keys.length); i < keys.length; i++) after += heightOf(keys[i]!);
  return (
    <div ref={list} className={className}>
      <div style={{ height: before }} aria-hidden="true" />
      {keys.slice(range.start, range.end).map(key =>
        <VirtualRow key={key} rowKey={key} render={renderItem} estimate={estimateHeight} observer={observer} />)}
      <div style={{ height: after }} aria-hidden="true" />
    </div>
  );
}

const VirtualRow = memo(function VirtualRow({ rowKey, render, estimate, observer }: {
  rowKey: string;
  render(key: string): ReactNode;
  estimate: number;
  observer: ResizeObserver | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !observer) return;
    observer.observe(element);
    return () => observer.unobserve(element);
  }, [observer]);
  return (
    <div ref={ref} data-key={rowKey} style={{ contentVisibility: "auto", containIntrinsicSize: `auto ${estimate}px` }}>
      {render(rowKey)}
    </div>
  );
});

/** The nearest ancestor that scrolls vertically, or null for the page. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return node;
  }
  return null;
}

/** A scroll container that keeps its position per screen. */
export function ScrollMemory(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} ref={useScrollMemory()} />;
}

/** Runs `callback` when the applet returns from the background and, with the router, when the person leaves the website with Done. */
export function useAppResume(callback: () => void) {
  const { genesis, router } = useRuntime();
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const stopResume = genesis.onResume(() => latest.current());
    const stopDone = router?.onDone(() => latest.current());
    return () => { stopResume(); stopDone?.(); };
  }, [genesis, router]);
}

export { createRouter } from "./router/router.js";
export type { CurrentScreen, NavigateTarget, Router, RouterOptions, RouterRoute, RouteStatus } from "./router/router.js";
export type { ContextHandle, ContextState, Expect, PendingInput, Watch, WatchOptions } from "./client/context.js";
export type { Genesis } from "./client/session.js";
export { watchStatus } from "./client/watch.js";
export type { DataStatus, WatchValue } from "./client/watch.js";
