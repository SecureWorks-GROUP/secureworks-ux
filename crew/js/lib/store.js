// App state and a small read cache.
// - getState / setState / useStore: one global object for who is signed in,
//   online state and the running clock.
// - useQuery: stale-while-revalidate reads keyed by a string. A cached answer
//   paints at once and is refreshed behind it. Selected reads are also kept in
//   localStorage so the app opens with no signal.
import { useEffect, useRef, useState } from './h.js';

let state = { user: null, ready: false, online: typeof navigator === 'undefined' ? true : navigator.onLine, clock: null, outbox: 0, demo: false };
const subs = new Set();

export function getState() { return state; }
export function setState(patch) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  subs.forEach((fn) => fn(state));
}
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function useStore(select = (s) => s) {
  const [value, setValue] = useState(() => select(state));
  const sel = useRef(select); sel.current = select;
  useEffect(() => {
    const check = (s) => setValue(() => sel.current(s));
    check(state);
    return subscribe(check);
  }, []);
  return value;
}

// ---------- storage (namespaced, never throws) ----------
const NS = 'crew:';
export const local = {
  get(key, fallback = null) {
    try { const raw = localStorage.getItem(NS + key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch { /* full or blocked */ } },
  del(key) { try { localStorage.removeItem(NS + key); } catch { /* blocked */ } },
  clear(prefix) {
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(NS + prefix)) drop.push(k); }
      drop.forEach((k) => localStorage.removeItem(k));
    } catch { /* blocked */ }
  }
};

// ---------- query cache ----------
const entries = new Map(); // key -> { data, error, ts, promise, listeners:Set }
function entry(key) {
  let e = entries.get(key);
  if (!e) { e = { data: undefined, error: null, ts: 0, promise: null, listeners: new Set() }; entries.set(key, e); }
  return e;
}
function uidKey(key) { return `q:${(state.user && state.user.id) || 'anon'}:${key}`; }
function emit(e) { e.listeners.forEach((fn) => fn()); }

export function peekQuery(key) { const e = entries.get(key); return e ? e.data : undefined; }
export function primeQuery(key, data, { persist = false } = {}) {
  const e = entry(key); e.data = data; e.error = null; e.ts = Date.now();
  if (persist) local.set(uidKey(key), { ts: e.ts, data });
  emit(e);
}
/** Change a cached answer in place (optimistic updates). */
export function mutateQuery(key, fn) {
  const e = entries.get(key);
  if (!e || e.data === undefined) return;
  e.data = fn(e.data);
  emit(e);
}
/** Mark matching reads stale and refetch any that are on screen. */
export function invalidate(match) {
  const test = typeof match === 'string' ? (k) => k.startsWith(match) : match;
  entries.forEach((e, key) => {
    if (!test(key)) return;
    e.ts = 0;
    if (e.listeners.size && e.fetcher) run(key, e);
  });
}
export function clearQueries() { entries.clear(); }

function run(key, e, persist) {
  if (e.promise) return e.promise;
  const p = Promise.resolve().then(() => e.fetcher()).then((data) => {
    if (e.promise !== p) return;
    e.data = data; e.error = null; e.ts = Date.now(); e.promise = null;
    if (e.persist || persist) local.set(uidKey(key), { ts: e.ts, data });
    emit(e);
  }).catch((err) => {
    if (e.promise !== p) return;
    e.error = err; e.promise = null;
    emit(e);
  });
  e.promise = p;
  emit(e);
  return p;
}

/**
 * useQuery(key, fetcher, { ttl, persist, enabled })
 * -> { data, error, loading, refreshing, refetch }
 * `loading` is true only while there is nothing to show yet.
 */
export function useQuery(key, fetcher, { ttl = 45000, persist = false, enabled = true } = {}) {
  const [, tick] = useState(0);
  const live = enabled && key != null;
  const e = live ? entry(key) : null;
  if (e) { e.fetcher = fetcher; e.persist = persist; }

  useEffect(() => {
    if (!e) return undefined;
    const fn = () => tick((n) => n + 1);
    e.listeners.add(fn);
    if (e.data === undefined && persist) {
      const saved = local.get(uidKey(key));
      if (saved && saved.data !== undefined) { e.data = saved.data; e.ts = 0; fn(); }
    }
    if (!e.promise && (e.data === undefined || Date.now() - e.ts > ttl)) run(key, e, persist);
    return () => e.listeners.delete(fn);
  }, [key, live]);

  if (!e) return { data: undefined, error: null, loading: false, refreshing: false, refetch: () => Promise.resolve() };
  return {
    data: e.data,
    error: e.error,
    loading: e.data === undefined && !e.error,
    refreshing: Boolean(e.promise) && e.data !== undefined,
    refetch: () => { e.ts = 0; return run(key, e, persist); }
  };
}
