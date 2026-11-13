// Shared interface pieces. Every screen is built from these.
import { html, cx, useEffect, useRef, useState, useLayoutEffect, useCallback } from '../lib/h.js';
import { Icon } from './icons.js';
import { back, saveScroll, savedScroll, useRoute } from '../lib/router.js';
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

// ---------- Page & TopBar ----------
/** A scrolling page. Animates in by direction, remembers its scroll for Back. */
export function Page({ children, class: cls, title, onBack, right, noBar }) {
  const route = useRoute();
  const ref = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (route.dir === 'pop') el.scrollTop = savedScroll(route.key);
  }, []);
  const onScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop;
    saveScroll(route.key, top);
    setScrolled(top > 44);
  }, [route.key]);
  const anim = route.dir === 'pop' ? 'enter-pop' : route.dir === 'tab' ? 'enter-tab' : 'enter-push';
  return html`<main ref=${ref} class=${cx('page', anim, cls)} onScroll=${onScroll}>
    ${noBar ? null : html`<div class=${cx('topbar', scrolled && 'scrolled')}>
      <${IconButton} name="back" label="Back" onClick=${onBack || (() => back())} />
      <div class="grow clip topbar-title">${title}</div>
      ${right || null}
    </div>`}
    ${children}
  </main>`;
}

// ---------- Tag, chips, avatars ----------
export function Tag({ vertical, children }) {
  return html`<span class=${cx('tag', 'jt-' + (vertical || 'other'))}>${children || VERTICAL_LABEL[vertical] || 'Job'}</span>`;
}
export function Chip({ kind, icon, children }) {
  return html`<span class=${cx('chip', kind)}>${icon ? html`<${Icon} name=${icon} size=${14} stroke=${2.4} />` : null}${children}</span>`;
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

// ---------- slide to confirm ----------
/** A deliberate action: drag the knob across. Enter or Space also confirms. */
export function Slide({ label, onConfirm, icon = 'right', kind, busy }) {
  const track = useRef(null); const knob = useRef(null); const fill = useRef(null);
  const st = useRef({ x: 0, max: 0, active: false });
  const [done, setDone] = useState(false);
  const paint = (x) => {
    knob.current.style.transform = `translate3d(${x}px,0,0)`;
    fill.current.style.transform = `scaleX(${st.current.max ? (x + 56) / (st.current.max + 61) : 0})`;
  };
  const fire = () => { setDone(true); buzz([12, 40, 24]); Promise.resolve(onConfirm()).finally(() => setTimeout(() => { setDone(false); if (knob.current) { track.current.classList.add('settle'); paint(0); } }, 500)); };
  const down = (e) => {
    if (done || busy) return;
    st.current = { x: 0, start: e.clientX, max: track.current.clientWidth - 66, active: true };
    track.current.classList.remove('settle');
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    const s = st.current; if (!s.active) return;
    s.x = Math.min(s.max, Math.max(0, e.clientX - s.start));
    paint(s.x);
  };
  const up = () => {
    const s = st.current; if (!s.active) return; s.active = false;
    track.current.classList.add('settle');
    if (s.x >= s.max * 0.86) { paint(s.max); fire(); } else paint(0);
  };
  const key = (e) => { if ((e.key === 'Enter' || e.key === ' ') && !done && !busy) { e.preventDefault(); st.current.max = track.current.clientWidth - 66; track.current.classList.add('settle'); paint(st.current.max); fire(); } };
  return html`<div ref=${track} class=${cx('slide', kind, done && 'done')} role="button" tabindex="0" aria-label=${label} onKeyDown=${key}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
    <div ref=${fill} class="fill" />
    <div class="label"><i>${done || busy ? 'One moment' : label}</i></div>
    <div ref=${knob} class="knob">${done || busy ? html`<i class="spin" style="width:20px;height:20px;border-radius:50%;border:2.5px solid currentColor;border-right-color:transparent;animation:spin 700ms linear infinite" />` : html`<${Icon} name=${icon} size=${26} stroke=${2.4} />`}</div>
  </div>`;
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
