// Shared interface pieces. Every screen is built from these.
import { html, cx, useEffect, useRef, useState, useLayoutEffect, useCallback } from '../lib/h.js';
import { Icon } from './icons.js';
import { back as back_, saveScroll, savedScroll, useRoute } from '../lib/router.js';
import { Mark } from './logo.js';
import { initials } from '../lib/dates.js';
import { VERTICAL_LABEL } from '../lib/model.js';

// ---------- haptics ----------
export function buzz(pattern = 10) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* not supported */ } }

// ---------- Button ----------
export function Button({ kind = 'primary', block, small, busy, icon, class: cls, children, disabled, ...rest }) {
  return html`<button type="button" class=${cx('btn', kind, block && 'block', small && 'small', cls)} disabled=${disabled || busy} ...${rest}>
    ${busy ? html`<i class="spin" />` : icon ? html`<${Icon} name=${icon} size=${20} />` : null}${children}
  </button>`;
}
export function IconButton({ name, label, size = 24, ...rest }) {
  return html`<button type="button" class="iconbtn" aria-label=${label} ...${rest}><${Icon} name=${name} size=${size} /></button>`;
}

// ---------- Page & AppBar ----------
/** The slate bar. `root` screens (the five tabs) show a big title, the orange
 *  accent line and the SecureWorks mark; inner screens show Back and a title. */
export function AppBar({ title, root, back = 'Back', onBack, right }) {
  if (root) {
    return html`<header class="appbar root">
      <div class="bar-title"><h1>${title}</h1><i class="accent" aria-hidden="true" /></div>
      <div class="bar-right"><${Mark} height=${26} />${right || null}</div>
    </header>`;
  }
  return html`<header class="appbar">
    <button type="button" class="bar-back" onClick=${onBack || (() => back_())}><${Icon} name="back" size=${20} stroke=${2.4} />${back}</button>
    <h1>${title}</h1>
    <div class="bar-right">${right || null}</div>
  </header>`;
}
/** A screen: the bar, a scrolling page that remembers its place for Back, and
 *  an optional foot that holds the screen's one strong button. */
export function Page({ children, class: cls, title, root, back, onBack, right, noBar, foot, flush }) {
  const route = useRoute();
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (route.dir === 'pop') el.scrollTop = savedScroll(route.key);
  }, []);
  const onScroll = useCallback((e) => { saveScroll(route.key, e.currentTarget.scrollTop); }, [route.key]);
  const anim = route.dir === 'pop' ? 'enter-pop' : route.dir === 'tab' ? 'enter-tab' : 'enter-push';
  return html`<div class=${cx('screen', anim)}>
    ${noBar ? html`<span />` : html`<${AppBar} title=${title} root=${root} back=${back} onBack=${onBack} right=${right} />`}
    <main ref=${ref} class=${cx('page', flush && 'flush', cls)} onScroll=${onScroll}>${children}</main>
    ${foot ? html`<div class="foot">${foot}</div>` : html`<span />`}
  </div>`;
}

// ---------- job tag, type, status ----------
/** The job number, drawn the same on every screen. */
export function JobTag({ number }) { return number ? html`<span class="jobtag">${number}</span>` : null; }
/** Job tag plus the kind of work: "[SWF-26767] Fencing". */
export function JobLine({ job, vertical, children }) {
  const kind = children || VERTICAL_LABEL[vertical] || '';
  return html`<span class="jobline"><${JobTag} number=${job && job.job_number} />${kind ? html`<span>${kind}</span>` : null}</span>`;
}
export function Tag({ vertical, children }) {
  return html`<span class="tag">${children || VERTICAL_LABEL[vertical] || 'Job'}</span>`;
}
/** A square status word. kind: ok | warn | bad | live | line | '' (quiet). */
export function Badge({ kind, children }) { return html`<span class=${cx('badge', kind)}>${children}</span>`; }
export function Chip({ kind, children }) { return html`<span class=${cx('badge', kind === 'hi' ? 'warn' : kind === 'solid' ? 'live' : kind)}>${children}</span>`; }
// One fixed vocabulary. Amber needs you, slate is happening now, green is settled, grey is plain.
export const STATUS = {
  to_confirm: ['warn', 'To confirm'], confirmed: ['ok', 'Confirmed'], on_site: ['live', 'On site'], done: ['', 'Done'], unavailable: ['', 'Unavailable'], cannot: ['bad', 'Cannot make it'],
  to_schedule: ['warn', 'To schedule'], scheduled: ['ok', 'Scheduled'], in_progress: ['live', 'In progress'], complete: ['', 'Complete'], on_hold: ['warn', 'On hold'], closed: ['', 'Closed'],
  draft: ['', 'Draft'], not_sent: ['', 'Not sent'], needs_times: ['warn', 'Needs times'], sent: ['', 'Sent'], approved: ['', 'Approved'], paid: ['ok', 'Paid'], sent_back: ['bad', 'Sent back'], waiting: ['', 'Waiting']
};
export function StatusBadge({ status, label }) {
  const s = STATUS[status] || ['', label || status];
  return html`<span class=${cx('badge', s[0])}>${label || s[1]}</span>`;
}
/** A group of things under a small caption. `right` is a link or count. */
export function Section({ label, right, children, class: cls }) {
  return html`<section class=${cx('sec', cls)}>
    ${label || right ? html`<div class="sec-h"><h2 class="t-cap">${label}</h2>${right || null}</div>` : null}
    ${children}
  </section>`;
}
/** A label and its value on one line of a card. Give onClick for a row that opens something. */
export function KV({ k, v, onClick, nav }) {
  const cls = cx('kvrow', nav && 'nav-row');
  if (onClick) return html`<button type="button" class=${cls} onClick=${onClick}><span class="k">${k}</span><span class="v">${v}</span></button>`;
  return html`<div class=${cls}><span class="k">${k}</span><span class="v">${v}</span></div>`;
}
export function Avatar({ name, me, lg }) { return html`<span class=${cx('av', me && 'me', lg && 'lg')} title=${name}>${initials(name)}</span>`; }
export function Avatars({ people, max = 4 }) {
  const shown = people.slice(0, max);
  return html`<span class="avs">${shown.map((p) => html`<${Avatar} name=${p.name} me=${p.me} />`)}${people.length > max ? html`<span class="av">+${people.length - max}</span>` : null}</span>`;
}

// ---------- form bits ----------
export function Field({ label, error, hint, children }) {
  // A real <label> only around a single text control. Around a group of
  // buttons a label would send every stray tap to the first button.
  const single = children && !Array.isArray(children) && ['input', 'textarea', 'select'].includes(children.type);
  const foot = error ? html`<span class="err">${error}</span>` : hint ? html`<span class="hint">${hint}</span>` : null;
  if (single) return html`<label class="field"><span>${label}</span>${children}${foot}</label>`;
  return html`<div class="field" role="group" aria-label=${label}><span>${label}</span>${children}${foot}</div>`;
}
export function Seg({ value, options, onChange }) {
  return html`<div class="seg" role="group">${options.map(([v, label]) => html`<button type="button" aria-pressed=${String(v === value)} onClick=${() => { if (v !== value) { buzz(6); onChange(v); } }}>${label}</button>`)}</div>`;
}
export function Picks({ value, options, onChange }) {
  return html`<div class="picks">${options.map(([v, label]) => html`<button type="button" class="pick" aria-pressed=${String(v === value)} onClick=${() => { buzz(6); onChange(v); }}>${label}</button>`)}</div>`;
}
export function Toggle({ label, hint, checked, onChange }) {
  return html`<button type="button" class="toggle" role="switch" aria-checked=${String(Boolean(checked))} onClick=${() => { buzz(6); onChange(!checked); }}>
    <span style="text-align:left"><span class="t-strong">${label}</span>${hint ? html`<span class="t-small" style="display:block">${hint}</span>` : null}</span><i class="switch" />
  </button>`;
}

// ---------- Sheet ----------
/** Bottom sheet. Closes on scrim tap, the close button, Escape, or a swipe down on its handle. */
export function Sheet({ title, sub, onClose, children, foot, tall }) {
  const [out, setOut] = useState(false);
  const el = useRef(null);
  const close = useCallback(() => { setOut(true); setTimeout(onClose, 200); }, [onClose]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [close]);
  const drag = useRef(null);
  const onDown = (e) => { drag.current = { y: e.clientY, dy: 0 }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    if (!drag.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    el.current.style.transform = `translate(-50%, ${drag.current.dy}px)`; el.current.style.transition = 'none';
  };
  const onUp = () => {
    if (!drag.current) return;
    const { dy } = drag.current; drag.current = null;
    el.current.style.transition = 'transform 260ms cubic-bezier(0.16,1,0.3,1)';
    if (dy > 110) { el.current.style.transform = 'translate(-50%, 100%)'; setTimeout(onClose, 180); } else el.current.style.transform = '';
  };
  return html`<div>
    <div class=${cx('scrim', out && 'out')} onClick=${close} />
    <section ref=${el} class=${cx('sheet', out && 'out')} role="dialog" aria-modal="true" aria-label=${title} style=${tall ? 'height: calc(100% - var(--safe-t) - 28px)' : ''}>
      <div>
        <div class="sheet-grab" onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp} style="touch-action:none" />
        <div class="sheet-head">
          <div style="min-width:0"><h2 class="t-title">${title}</h2>${sub ? html`<p class="t-small" style="margin-top:4px">${sub}</p>` : null}</div>
          <${IconButton} name="close" label="Close" onClick=${close} />
        </div>
      </div>
      <div class="sheet-body">${typeof children === 'function' ? children(close) : children}</div>
      ${foot ? html`<div class="sheet-foot">${typeof foot === 'function' ? foot(close) : foot}</div>` : null}
    </section>
  </div>`;
}

// ---------- overlays opened from anywhere (sheets, confirm, lightbox) ----------
let overlayId = 0;
let overlays = [];
const overlaySubs = new Set();
function setOverlays(next) { overlays = next; overlaySubs.forEach((fn) => fn(overlays)); }
/** openOverlay((close) => vnode). Returns a function that closes it. */
export function openOverlay(renderFn) {
  const id = ++overlayId;
  const close = () => setOverlays(overlays.filter((o) => o.id !== id));
  setOverlays([...overlays, { id, renderFn, close }]);
  return close;
}
export function Overlays() {
  const [list, setList] = useState(overlays);
  useEffect(() => { overlaySubs.add(setList); return () => overlaySubs.delete(setList); }, []);
  return html`<div>${list.map((o) => html`<div key=${o.id}>${o.renderFn(o.close)}</div>`)}</div>`;
}
/** Ask a yes/no question in a sheet. Resolves true or false. */
export function ask({ title, body, yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v, close) => { if (!answered) { answered = true; resolve(v); } close(); };
    openOverlay((close) => html`<${Sheet} title=${title} onClose=${() => done(false, close)}
      foot=${(shut) => html`<${Button} kind=${danger ? 'ink' : 'primary'} block onClick=${() => { answered = true; resolve(true); shut(); }}>${yes}<//>
        <${Button} kind="quiet" block onClick=${shut}>${no}<//>`}>
      ${body ? html`<p class="prose" style="color:var(--ink-2)">${body}</p>` : null}
    <//>`);
  });
}

// ---------- toasts ----------
let toastId = 0;
let toasts = [];
const toastSubs = new Set();
function setToasts(next) { toasts = next; toastSubs.forEach((fn) => fn(toasts)); }
export function toast(message, { kind = '', action = null, ms = 3200 } = {}) {
  const id = ++toastId;
  setToasts([...toasts.slice(-2), { id, message, kind, action }]);
  if (kind === 'bad') buzz([20, 60, 20]);
  setTimeout(() => {
    setToasts(toasts.map((t) => (t.id === id ? { ...t, out: true } : t)));
    setTimeout(() => setToasts(toasts.filter((t) => t.id !== id)), 220);
  }, action ? Math.max(ms, 5200) : ms);
}
export function Toasts() {
  const [list, setList] = useState(toasts);
  useEffect(() => { toastSubs.add(setList); return () => toastSubs.delete(setList); }, []);
  return html`<div class="toasts" role="status" aria-live="polite">${list.map((t) => html`<div key=${t.id} class=${cx('toast', t.kind, t.out && 'out')}>
    ${t.kind === 'ok' ? html`<${Icon} name="check" size=${20} stroke=${2.6} />` : t.kind === 'bad' ? html`<${Icon} name="alert" size=${20} />` : null}
    <span>${t.message}</span>
    ${t.action ? html`<button type="button" onClick=${() => { t.action.run(); setToasts(toasts.filter((x) => x.id !== t.id)); }}>${t.action.label}</button>` : null}
  </div>`)}</div>`;
}

// ---------- the big confirm button ----------
/** A deliberate action as one large strong button. (It was a slide; callers keep the same props.) */
export function Slide({ label, onConfirm, kind, busy }) {
  const [going, setGoing] = useState(false);
  const fire = () => { if (going || busy) return; setGoing(true); buzz([12, 40, 24]); Promise.resolve(onConfirm()).finally(() => setGoing(false)); };
  return html`<button type="button" class=${cx('slide', kind)} disabled=${going || busy} onClick=${fire}>${going || busy ? html`<i class="spin" />` : label}</button>`;
}

// ---------- photos ----------
export function openLightbox(photos, index = 0) {
  openOverlay((close) => html`<${Lightbox} photos=${photos} index=${index} onClose=${close} />`);
}
function Lightbox({ photos, index, onClose }) {
  const stage = useRef(null);
  const [i, setI] = useState(index);
  useLayoutEffect(() => { stage.current.scrollLeft = stage.current.clientWidth * index; }, []);
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const p = photos[i] || {};
  return html`<div class="lightbox">
    <div class="lb-top"><span class="t-num">${i + 1} / ${photos.length}</span><${IconButton} name="close" label="Close" onClick=${onClose} /></div>
    <div ref=${stage} class="lb-stage" onScroll=${(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
      ${photos.map((ph) => html`<div><img src=${ph.url} alt=${ph.label || 'Job photo'} loading="lazy" /></div>`)}
    </div>
    <div class="lb-cap">${p.label || ''}</div>
  </div>`;
}
/** Grid of thumbnails. `pending` are local previews still sending. */
export function PhotoGrid({ photos, pending = [], onAdd, addLabel = 'Add', max, four }) {
  const shown = max ? photos.slice(0, max) : photos;
  const extra = photos.length - shown.length;
  return html`<div class=${cx('photos', four && 'four')}>
    ${onAdd ? html`<button type="button" class="photo add" onClick=${onAdd}><${Icon} name="camera" size=${24} /><span>${addLabel}</span></button>` : null}
    ${pending.map((p) => html`<div class="photo" key=${p.key}><img src=${p.preview} alt="" /><span class="state">${p.state === 'queued' ? 'Waiting' : p.state === 'failed' ? 'Failed' : 'Sending'}</span></div>`)}
    ${shown.map((p, idx) => html`<button type="button" class="photo" key=${p.id || p.url} onClick=${() => openLightbox(photos, idx)}>
      <img src=${p.thumb || p.url} alt=${p.label || 'Job photo'} loading="lazy" />
      ${extra > 0 && idx === shown.length - 1 ? html`<span class="more">+${extra}</span>` : null}
    </button>`)}
  </div>`;
}

// ---------- loading & empty ----------
export function Skel({ w = '100%', h = 16, r = 8, style = '' }) { return html`<div class="skel" style=${`width:${typeof w === 'number' ? w + 'px' : w};height:${h}px;border-radius:${r}px;${style}`} />`; }
export function SkelRows({ n = 3 }) {
  return html`<div class="list">${Array.from({ length: n }, () => html`<div class="row"><${Skel} w=${46} h=${22} /><div class="main" style="display:grid;gap:8px"><${Skel} w="62%" h=${20} /><${Skel} w="84%" h=${13} /></div><span /></div>`)}</div>`;
}
export function Empty({ title, children, action }) {
  return html`<div class="empty"><h3 class="t-title">${title}</h3>${children ? html`<p>${children}</p>` : null}${action || null}</div>`;
}
/** A read that failed and has nothing cached to show. */
export function LoadError({ error, onRetry, what = 'this' }) {
  const offline = error && error.offline;
  return html`<${Empty} title=${offline ? 'No signal' : 'Could not load ' + what} action=${html`<${Button} kind="line" small icon="refresh" onClick=${onRetry}>Try again<//>`}>
    ${offline ? 'It will load when you are back in range.' : (error && error.message) || 'Something went wrong.'}
  <//>`;
}

/** Time field. Native time input: the phone shows its own wheel or clock. */
export function TimeInput({ value, onInput, label, bad }) {
  return html`<label class="field"><span>${label}</span><input class=${cx('input big', bad && 'bad')} type="time" step="300" value=${value || ''} onInput=${(e) => onInput(e.currentTarget.value)} /></label>`;
}
export const BREAKS = [[0, 'No break'], [15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour']];
