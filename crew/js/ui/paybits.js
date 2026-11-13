// Pieces the pay screens share: the done state, money rows as the server sent
// them, a signature pad and star ratings. No reads or writes in here.
import { html, cx, useEffect, useRef } from '../lib/h.js';
import { fmtMoney, fmtTime, fmtHours } from '../lib/dates.js';
import { Icon } from './icons.js';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const cash = (n) => fmtMoney(n, { cents: true });
export const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

/** '7am to 3:30pm, 30 min break' from a row with start_time, finish_time, break_minutes. */
export function whenWords(row) {
  if (!row || !row.start_time || !row.finish_time) return '';
  const brk = Number(row.break_minutes) || 0;
  return `${fmtTime(row.start_time)} to ${fmtTime(row.finish_time)}${brk ? `, ${brk} min break` : ''}`;
}

/** The server says yes: the same test for every invoice send. */
export function sendLanded(res) {
  if (!res || res.error) return false;
  const named = Boolean(res.invoice_id || res.invoice_number || res.xero_bill_id || res.xero_bill_number);
  if (res.code === 'XERO_PUSH_FAILED') return res.success === true && named;
  if (res.office_review === 'held') return res.success === true || named;
  if (res.success === false || res.ok === false) return false;
  return res.success === true || res.ok === true || named;
}

/** The full-screen end of a flow: a mark, a heading, a sentence, then whatever follows. */
export function DoneScreen({ title, lead, wait, children }) {
  return html`<main class="page enter-push page-pad donescreen">
    <div class=${cx('done-mark', wait && 'wait')}><${Icon} name=${wait ? 'clock' : 'check'} size=${44} stroke=${wait ? 2.4 : 3} /></div>
    <div><h1 class="t-display">${title}</h1>${lead ? html`<p class="donelead">${lead}</p>` : null}</div>
    ${children}
  </main>`;
}

/**
 * What an invoice pays, exactly as the server sent it. `m` is an invoice or a
 * send result. Nothing is worked out here: a figure that was not sent is left out.
 */
export function PayRows({ m, totalLabel = 'You get paid', hours }) {
  const gst = num(m.gst != null ? m.gst : m.gst_amount);
  const ded = m.recurring_deduction && num(m.recurring_deduction.amount) ? m.recurring_deduction : null;
  const adj = m.xero_adjustments && Array.isArray(m.xero_adjustments.lines) ? m.xero_adjustments.lines.filter((l) => num(l.amount)) : [];
  const before = num(m.trade_payable);
  const after = num(m.payable_after_xero);
  const withheld = num(m.worker_withhold);
  const pays = adj.length && after != null ? after : before != null ? before : num(m.payable);
  const hrs = hours != null ? hours : num(m.total_hours);
  return html`<div class="sumrows">
    ${num(m.grand_total) != null ? html`<div class="sumrow"><span>Work orders</span><span>${cash(m.grand_total)}</span></div>` : null}
    ${num(m.final_deductions_total) ? html`<div class="sumrow"><span>Taken off</span><span>-${cash(Math.abs(m.final_deductions_total))}</span></div>` : null}
    ${num(m.gross_earned) != null ? html`<div class="sumrow"><span>Earned${hrs ? ` (${fmtHours(hrs)})` : ''}</span><span>${cash(m.gross_earned)}</span></div>` : null}
    ${withheld ? html`<div class="sumrow"><span>Super held from you</span><span>-${cash(withheld)}</span></div>` : null}
    ${gst ? html`<div class="sumrow"><span>GST</span><span>${cash(gst)}</span></div>` : null}
    ${ded ? html`<div class="sumrow"><span>${ded.label || 'Weekly deduction'}</span><span>-${cash(ded.amount)}</span></div>` : null}
    ${adj.length && before != null ? html`<div class="sumrow"><span>Before the office changed it</span><span>${cash(before)}</span></div>` : null}
    ${adj.map((l) => html`<div class="sumrow"><span>${l.description || 'Changed by the office'}</span><span>${cash(l.amount)}</span></div>`)}
    <div class="sumrow total"><span>${totalLabel}</span><span>${pays != null ? cash(pays) : 'Ask the office'}</span></div>
  </div>`;
}

/** One sentence on where the super goes, from the server's own figures. */
export function superNote(m) {
  const total = num(m.super_amount);
  if (!total) return '';
  return num(m.worker_withhold) ? `${cash(total)} goes to your super in total (yours plus the company's share).` : `${cash(total)} goes to your super, paid by the company on top.`;
}

/** Draw-with-a-finger signature. Calls onChange with a PNG data URL, or null when cleared. */
export function SigPad({ onChange }) {
  const ref = useRef(null);
  const st = useRef({ on: false, x: 0, y: 0, ctx: null });
  useEffect(() => {
    const c = ref.current; const r = c.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr); ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#16222b';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
    st.current.ctx = ctx;
  }, []);
  const at = (e) => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const down = (e) => { e.preventDefault(); const [x, y] = at(e); st.current.on = true; st.current.x = x; st.current.y = y; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fine */ } };
  const move = (e) => {
    const s = st.current; if (!s.on) return;
    const [x, y] = at(e);
    s.ctx.beginPath(); s.ctx.moveTo(s.x, s.y); s.ctx.lineTo(x, y); s.ctx.stroke();
    s.x = x; s.y = y; s.drawn = true;
  };
  const up = () => { const s = st.current; if (!s.on) return; s.on = false; if (s.drawn) onChange(ref.current.toDataURL('image/png')); };
  const clear = () => { const c = ref.current; const r = c.getBoundingClientRect(); st.current.ctx.fillRect(0, 0, r.width, r.height); st.current.drawn = false; onChange(null); };
  return html`<div class="sigwrap">
    <canvas ref=${ref} class="sigpad" aria-label="Sign here" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} />
    <button type="button" class="sigclear" onClick=${clear}>Clear</button>
  </div>`;
}

/** One to five stars. */
export function Stars({ value, onChange, label }) {
  return html`<div class="starrow"><span class="t-strong">${label}</span>
    <div class="stars" role="group" aria-label=${label}>${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class=${cx(value >= n && 'on')} aria-label=${`${n} out of 5`} aria-pressed=${String(value === n)} onClick=${() => onChange(n)}><${Icon} name="star" size=${30} fill=${value >= n} /></button>`)}</div>
  </div>`;
}
