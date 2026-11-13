// Hash router with a sense of direction, so pages can slide the right way.
// Paths look like #/today, #/job/<id>, #/pay/week/2026-11-09.
import { useEffect, useState } from './h.js';

// Memory mode keeps the route in the page only (no address bar, no browser
// history). Used where the app is shown inside another page's frame.
const MEM = Boolean(window.CREW_CONFIG && window.CREW_CONFIG.memoryRoutes);
const memStack = ['/today'];
let depth = MEM ? 0 : (history.state && history.state.d) || 0;
let current = read('tab');
const subs = new Set();
const scrolls = new Map();

function read(dir) {
  const raw = MEM ? memStack[memStack.length - 1] : location.hash.replace(/^#/, '') || '/today';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  return { path, parts, query, dir, key: path, depth };
}
function apply(dir) { current = read(dir); subs.forEach((fn) => fn(current)); }

window.addEventListener('popstate', (e) => {
  const d = (e.state && e.state.d) || 0;
  const dir = d < depth ? 'pop' : 'push';
  depth = d;
  apply(dir);
});
window.addEventListener('hashchange', () => { if (read('').path !== current.path) apply('push'); });

export const ROOTS = ['today', 'jobs', 'pay', 'me'];

/** Go to a path. `replace` swaps the current entry; tabs animate differently. */
export function go(path, { replace = false, tab = false } = {}) {
  if (MEM) {
    if (path === memStack[memStack.length - 1]) return;
    if (replace) memStack[memStack.length - 1] = path; else memStack.push(path);
    depth = memStack.length - 1;
    apply(tab || replace ? 'tab' : 'push');
    return;
  }
  if ('#' + path === location.hash) return;
  if (replace) history.replaceState({ d: depth }, '', '#' + path);
  else { depth += 1; history.pushState({ d: depth }, '', '#' + path); }
  apply(tab ? 'tab' : replace ? 'tab' : 'push');
}
/** Go back; when there is nothing behind (opened from a link), go to `fallback`. */
export function back(fallback = '/today') {
  if (MEM) {
    if (memStack.length > 1) memStack.pop(); else memStack[0] = fallback;
    depth = memStack.length - 1;
    apply('pop');
    return;
  }
  if (depth > 0) history.back();
  else { history.replaceState({ d: 0 }, '', '#' + fallback); apply('pop'); }
}
export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => { subs.add(setRoute); return () => subs.delete(setRoute); }, []);
  return route;
}
export function currentRoute() { return current; }

export function saveScroll(key, top) { scrolls.set(key, top); }
export function savedScroll(key) { return scrolls.get(key) || 0; }
