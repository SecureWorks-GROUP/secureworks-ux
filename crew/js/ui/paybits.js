// Pieces the pay screens share: figures and words in one format, the rows of a
// timesheet, the lines of an invoice, the done screen, money rows as the
// server sent them, a signature pad and star ratings. No reads or writes here.
import { html, cx, useEffect, useRef } from '../lib/h.js';
import { fmtMoney, fmtWeek, fmtDow, fmtDom, fmtDowLong, addDays, todayISO, hoursBetween } from '../lib/dates.js';
import { lineHours, lineProblem, invoiceBadge, UNKNOWN_MODE_WORDS } from '../lib/invoice.js';
import { Icon } from './icons.js';
import { JobTag, Badge } from './kit.js';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const cash = (n) => fmtMoney(n, { cents: true });
export const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

// ---------- words and figures ----------
/** 8 -> '8.0 h', 7.25 -> '7.25 h'. Always with its unit. */
export function hrs(n) {
  if (n == null || n === '' || isNaN(Number(n))) return '';
  const r = Math.round(Number(n) * 100) / 100;
  return `${Number.isInteger(r * 10) ? r.toFixed(1) : r.toFixed(2)} h`;
}
/** '07:00' -> '7:00 am' */
export function clock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  let h = Number(m[1]); const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m[2]} ${ap}`;
}
/** '7:00 am to 3:30 pm · 30 min break' */
export function timeLine(start, finish, breakMin) {
  if (!start || !finish) return '';
  const b = Number(breakMin) || 0;
  return `${clock(start)} to ${clock(finish)} · ${b ? b + ' min break' : 'no break'}`;
}
/** The same, from a server row with start_time, finish_time, break_minutes. */
export function whenWords(row) {
  if (!row || !row.start_time || !row.finish_time) return '';
  return timeLine(row.start_time, row.finish_time, row.break_minutes);
}
/** '9 to 15 Nov 2026' */
export function weekWords(monday) { return `${fmtWeek(monday)} ${addDays(monday, 6).slice(0, 4)}`; }
export function plural(n, one, many) { return `${n} ${n === 1 ? one : many || one + 's'}`; }
function listWords(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** How a line is paid, in the words used on every pay screen. The server decides which. */
export const PAY_TYPE = { hours: 'Hourly', work_order: 'Work order', commission: 'Commission', group: 'Group work order', other: 'Other item', deduction: 'Adjustment', unknown: '' };

// ---------- the timesheet ----------
/** My days on a group work order: what the server sent, else the days saved on this phone. */
export function groupDays(share, saved) {
  const server = share && (share.my_entries || share.entries || share.time_entries);
  return (Array.isArray(server) ? server : saved || []).filter((d) => d && d.work_date);
}
/**
 * One row for one job on one day worked. `groups` is
 * [{ job_id, job_number, site_suburb, client_name, booked_dates, days: [...] }].
 * Days booked but not reached yet are counted, not listed.
 */
export function sheetRows(lines, groups, { monday, rateEditable }) {
  const today = todayISO(); const sunday = addDays(monday, 6);
  const rows = []; let ahead = 0;
  for (const l of lines) {
    if (l.kind === 'other' || l.kind === 'deduction') continue;
    const head = { title: l.title, jobNumber: l.jobNumber, line: l, open: 'line' };
    if (l.kind === 'hours' || l.kind === 'unknown') {
      if (l.ahead) { ahead += 1; continue; }
      if (l.unknown) { rows.push({ ...head, key: l.key, date: l.date, type: '', tone: 'mute', timeText: l.viaGroup ? 'Paid through the group work order' : l.modePending ? 'Checking how this job is billed' : UNKNOWN_MODE_WORDS, hours: null }); continue; }
      if (l.off) { rows.push({ ...head, key: l.key, date: l.date, type: PAY_TYPE.hours, tone: 'off', timeText: 'Left off this invoice', hours: null }); continue; }
      const problem = lineProblem(l, { monday, rateEditable });
      const h = lineHours(l);
      rows.push({ ...head, key: l.key, date: l.date, type: PAY_TYPE.hours, tone: problem ? 'todo' : '', problem,
        timeText: !l.start || !l.finish ? 'Add start and finish times' : problem || timeLine(l.start, l.finish, l.breakMin), hours: problem || isNaN(h) ? null : h });
      continue;
    }
    // Work order and commission: the hours are a record, the amount is the job's.
    const days = l.dayCards && l.dayCards.length ? l.dayCards : [{ key: l.key, date: l.date, saved: null, clocked: null }];
    for (const d of days) {
      if (d.date > today) { ahead += 1; continue; }
      const h = d.saved ? hoursBetween(d.saved.start, d.saved.finish, d.saved.breakMin) : d.clocked;
      rows.push({ ...head, key: l.key + ':' + d.key, date: d.date, type: PAY_TYPE[l.kind], tone: l.off ? 'off' : '',
        timeText: l.off ? 'Left off this invoice' : d.saved ? timeLine(d.saved.start, d.saved.finish, d.saved.breakMin) : h > 0 ? 'From the clock' : 'No times recorded', hours: l.off || !(h > 0) ? null : h });
    }
  }
  for (const g of groups || []) {
    const head = { title: g.site_suburb || g.client_name || g.job_number || 'Job', jobNumber: g.job_number || '', open: 'group', jobId: g.job_id, type: PAY_TYPE.group };
    const days = (g.days || []).filter((d) => d.work_date >= monday && d.work_date <= sunday);
    for (const d of days) {
      const h = d.hours != null ? Number(d.hours) : hoursBetween(d.start_time, d.finish_time, d.break_minutes || 0);
      rows.push({ ...head, key: 'g:' + g.job_id + ':' + d.work_date, date: d.work_date, tone: '', timeText: whenWords(d) || 'Recorded on the group work order', hours: h > 0 ? h : null });
    }
    for (const d of g.booked_dates || []) {
      const day = String(d).slice(0, 10);
      if (days.some((x) => x.work_date === day)) continue;
      if (day > today) { ahead += 1; continue; }
      rows.push({ ...head, key: 'g:' + g.job_id + ':' + day, date: day, tone: 'mute', timeText: 'Add your hours on the group work order', hours: null });
    }
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.title.localeCompare(b.title));
  return { rows, ahead };
}
/** What the timesheet adds up to, and what it still needs, in words. */
export function sheetSummary(rows) {
  const live = rows.filter((r) => r.tone !== 'off' && r.tone !== 'mute');
  const todo = live.filter((r) => r.tone === 'todo');
  const hours = Math.round(live.reduce((s, r) => s + (r.hours || 0), 0) * 100) / 100;
  const days = [...new Set(live.map((r) => r.date))];
  const openDays = [...new Set(todo.map((r) => r.date))];
  const names = openDays.map((d) => fmtDowLong(d));
  const needs = !todo.length ? '' : names.length > 3 ? `${names.length} days still need their times` : `${listWords(names)} still ${names.length === 1 ? 'needs its' : 'need their'} times`;
  return { hours, todo: todo.length, days: days.length, daysDone: days.length - openDays.length, needs, count: live.length };
}

/** The day cell of a table row: 'Mon' over '9'. */
export function DayCell({ date }) {
  return html`<span class="pay-day"><span class="dow">${date ? fmtDow(date) : ''}</span><span class="dom">${date ? fmtDom(date) : ''}</span></span>`;
}

// ---------- the lines of an invoice ----------
/** A group of lines under a tinted caption with its subtotal. */
export function PayGroup({ label, right, children }) {
  return html`<div class="pay-cap"><span>${label}</span>${right != null && right !== '' ? html`<span class="t-num">${right}</span>` : null}</div>${children}`;
}
/** One line: the suburb, the job tag with how it is priced, and the amount. */
export function PayLine({ title, number, detail, amount, tone, note, badge, onClick }) {
  const body = html`<span class="main"><b>${title}</b>
      <span class="pay-detail"><${JobTag} number=${number} />${detail ? html`<span>${detail}</span>` : null}</span>
      ${note ? html`<span class="pay-linenote">${note}</span>` : null}
      ${badge || null}</span>
    <span class="pay-amt">${amount}</span>`;
  if (onClick) return html`<button type="button" class=${cx('pay-line', tone)} onClick=${onClick}>${body}</button>`;
  return html`<div class=${cx('pay-line', tone)}>${body}</div>`;
}

/** An invoice's state as a badge. The words are the server's (or invoiceState's), never made up here. */
export function InvoiceBadge({ inv }) {
  const [words, kind] = invoiceBadge(inv);
  return html`<${Badge} kind=${kind}>${words}<//>`;
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

/** The end of a flow: the bar with its name, a mark, a heading, a sentence, then whatever follows. */
export function DoneScreen({ bar, title, lead, wait, children, foot }) {
  return html`<div class="screen enter-push">
    <header class="appbar"><span class="pay-barpad" /><h1>${bar || ''}</h1><span /></header>
    <main class="page"><div class="block pay-done">
      <div class=${cx('pay-mark', wait && 'wait')}><${Icon} name=${wait ? 'clock' : 'check'} size=${30} stroke=${wait ? 2.2 : 2.8} /></div>
      <div><h2 class="t-title">${title}</h2>${lead ? html`<p class="pay-lead">${lead}</p>` : null}</div>
      ${children}
    </div></main>
    ${foot ? html`<div class="foot">${foot}</div>` : html`<span />`}
  </div>`;
}

/**
 * What an invoice pays, exactly as the server sent it. `m` is an invoice or a
 * send result. Nothing is worked out here: a figure that was not sent is left out.
 */
export function PayRows({ m, totalLabel = 'You are paid', hours, workOrder = false }) {
  if (m.pay_view) {
    const v = m.pay_view;
    const hasWorkOrder = workOrder || m.invoice_source === 'work_order' || (m.lines || []).some((l) => /^(work[ _]order|group[ _]share)$/.test(l.line_type || ''));
    const row = (label, value, total = false, note = '') => html`<div class=${cx('pay-sumrow', total && 'total')}><span>${label}${note ? html`<small class="t-small" style="display:block">${note}</small>` : null}</span><span>${value}</span></div>`;
    return html`<div class="pay-sum">
      ${row(hasWorkOrder ? 'Work order total (includes super)' : 'Total (includes super)', cash(v.total_inc_super))}
      ${row('Paid to your super fund', cash(v.paid_to_super))}
      ${row('Paid to you', cash(v.paid_to_you), true)}
      ${v.reimbursements > 0 ? row('Reimbursement (receipt)', cash(v.reimbursements)) : null}
      ${v.gst > 0 ? row('GST', cash(v.gst), false, 'Set this aside for your BAS.') : null}
      ${v.repayment ? row('Repayment: ' + v.repayment.label, '-' + cash(v.repayment.amount), false, 'Balance left ' + cash(v.repayment.balance_left)) : null}
      ${num(v.into_bank) !== num(v.paid_to_you) ? row('Into your bank account', cash(v.into_bank)) : null}
      ${v.tax_set_aside ? row('Suggested to set aside for tax', cash(v.tax_set_aside.amount), false, 'A guide only, not tax advice.') : null}
    </div>`;
  }
  const gst = num(m.gst != null ? m.gst : m.gst_amount);
  const ded = m.recurring_deduction && num(m.recurring_deduction.amount) ? m.recurring_deduction : null;
  const adj = m.xero_adjustments && Array.isArray(m.xero_adjustments.lines) ? m.xero_adjustments.lines.filter((l) => num(l.amount)) : [];
  const before = num(m.trade_payable);
  const after = num(m.payable_after_xero);
  const withheld = num(m.worker_withhold);
  const pays = adj.length && after != null ? after : before != null ? before : num(m.payable);
  const h = hours != null ? hours : num(m.total_hours);
  return html`<div class="pay-sum">
    ${num(m.grand_total) != null ? html`<div class="pay-sumrow"><span>Work orders</span><span>${cash(m.grand_total)}</span></div>` : null}
    ${num(m.final_deductions_total) ? html`<div class="pay-sumrow"><span>Adjustments</span><span>-${cash(Math.abs(m.final_deductions_total))}</span></div>` : null}
    ${num(m.gross_earned) != null ? html`<div class="pay-sumrow"><span>Gross earned${h ? ` · ${hrs(h)}` : ''}</span><span>${cash(m.gross_earned)}</span></div>` : null}
    ${withheld ? html`<div class="pay-sumrow"><span>Paid to your super fund</span><span>-${cash(withheld)}</span></div>` : null}
    ${gst ? html`<div class="pay-sumrow"><span>GST</span><span>${cash(gst)}</span></div>` : null}
    ${ded ? html`<div class="pay-sumrow"><span>${ded.label || 'Weekly repayment'}</span><span>-${cash(ded.amount)}</span></div>` : null}
    ${adj.length && before != null ? html`<div class="pay-sumrow"><span>Before the office changed it</span><span>${cash(before)}</span></div>` : null}
    ${adj.map((l) => html`<div class="pay-sumrow"><span>${l.description || 'Changed by the office'}</span><span>${cash(l.amount)}</span></div>`)}
    <div class="pay-sumrow total"><span>${totalLabel}</span><span>${pays != null ? cash(pays) : 'Ask the office'}</span></div>
  </div>`;
}

/** One sentence on where the super goes, from the server's own figures. */
export function superNote(m) {
  if (m.super_basis === 'inclusive_12_112_v1' || m.pay_view && m.pay_view.basis === 'inclusive_12_112_v1') return 'Your total includes super. 12/112 of it goes to your super fund.';
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
  return html`<div class="pay-sig">
    <canvas ref=${ref} class="pay-sigpad" aria-label="Sign here" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up} />
    <button type="button" class="pay-sigclear" onClick=${clear}>Clear</button>
  </div>`;
}

/** One to five stars. */
export function Stars({ value, onChange, label }) {
  return html`<div class="pay-starrow"><span class="t-strong">${label}</span>
    <div class="pay-stars" role="group" aria-label=${label}>${[1, 2, 3, 4, 5].map((n) => html`<button type="button" class=${cx(value >= n && 'on')} aria-label=${`${n} out of 5`} aria-pressed=${String(value === n)} onClick=${() => onChange(n)}><${Icon} name="star" size=${28} fill=${value >= n} /></button>`)}</div>
  </div>`;
}
