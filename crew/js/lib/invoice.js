// The weekly invoice, as plain data. The server decides how each job is paid
// (hours, work order, group, commission) and owns every money figure; this
// module turns the week's job cards into lines, checks them, and builds the
// exact request the server expects. No screen code in here.
import { hoursBetween, todayISO, addDays, fmtDay, fmtTime } from './dates.js';
import { verticalOf, jobTitle } from './model.js';

const LIVE_OFF = ['draft', 'failed', 'ops-reject'];
/** An invoice that holds its week (cannot send another for that week). */
export function isLiveInvoice(inv) { return inv && !LIVE_OFF.includes(String(inv.status || '').toLowerCase()); }
export function invoiceForWeek(invoices, monday) {
  const rows = (invoices || []).filter((i) => (i.week_start || '').slice(0, 10) === monday);
  return rows.find(isLiveInvoice) || null;
}
export function sentBackForWeek(invoices, monday) {
  return (invoices || []).find((i) => (i.week_start || '').slice(0, 10) === monday && String(i.status).toLowerCase() === 'ops-reject') || null;
}
/** What a trade should read for an invoice's state: [words, chip kind]. */
export function invoiceState(inv) {
  if (inv.bill_status_label) return [inv.bill_status_label, inv.paid || String(inv.status) === 'paid' ? 'ok' : ''];
  const s = String(inv.status || '').toLowerCase();
  if (s === 'paid' || inv.paid === true) return ['Paid', 'ok'];
  if (s === 'pushed_to_xero') return ['With the bookkeeper', 'hi'];
  if (s === 'approved' || s === 'pending_acknowledgment' || s === 'acknowledged' || s === 'queried' || s === 'pending_ops_review') return ['With the office', 'warn'];
  if (s === 'ops-reject') return ['Sent back to you', 'bad'];
  if (s === 'draft') return ['Not sent', ''];
  return [s || 'Sent', ''];
}
/** invoiceState for a badge: [words, badge kind]. The words are never changed here; only the colour is picked. */
export function invoiceBadge(inv) {
  if (['VOIDED', 'DELETED'].includes(String(inv.xero_bill_status || '').toUpperCase()) && !inv.bill_status_label) return ['Cancelled', 'bad'];
  const [words, kind] = invoiceState(inv);
  return [words, kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : ''];
}
/** The amount this invoice pays the trade, straight from the server (null when it sent none). */
export function invoicePays(inv) {
  if (inv.pay_view) return num(inv.pay_view.into_bank);
  // `payable` (my_money rows) is already after the office's changes in Xero.
  if (inv.payable_after_xero != null) return Number(inv.payable_after_xero);
  if (inv.payable != null) return Number(inv.payable);
  if (inv.trade_payable != null) return Number(inv.trade_payable);
  return null;
}

// ---- how a job is billed: the server's answer, never a guess ----
const MODES = ['hourly', 'work_order', 'group_work_order'];
export function normMode(mode) { const m = String(mode == null ? '' : mode).trim().toLowerCase(); return MODES.includes(m) ? m : null; }
/**
 * One server row (a my_hours card or a trade_invoice_job_modes job).
 * A null mode means not known: the line asks the trade to call the office and
 * stays off the invoice. Commission only where the server says true.
 */
export function readMode(row, unavailable) {
  if (!row || unavailable === true) return { mode: null, canCommission: null, agreed: null };
  const mode = normMode(row.invoice_mode);
  const raw = row.work_order_agreed_ex;
  const n = Number(raw);
  const agreed = mode === 'work_order' && raw != null && raw !== '' && isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  return { mode, canCommission: row.can_claim_commission === true ? true : row.can_claim_commission === false ? false : null, agreed };
}
export const UNKNOWN_MODE_WORDS = 'Ask the office how this job is billed';
/** Jobs this week that are paid through a group work order: never a line on the weekly invoice. */
export function groupRouteJobs(hours) {
  const out = []; const seen = new Set();
  const add = (jobId, f) => {
    if (jobId == null) return;
    const id = String(jobId);
    if (seen.has(id)) { const cur = out.find((x) => String(x.job_id) === id); (f.booked_dates || []).forEach((d) => { if (d && !cur.booked_dates.includes(d)) cur.booked_dates.push(d); }); return; }
    seen.add(id); out.push({ job_id: jobId, route: 'group', ...f, booked_dates: [...(f.booked_dates || [])] });
  };
  for (const g of (hours && hours.group_route_jobs) || []) add(g.job_id, g);
  if (hours && hours.invoice_mode_unavailable !== true) {
    for (const a of hours.assignments || []) {
      if (!a || normMode(a.invoice_mode) !== 'group_work_order') continue;
      const job = a.jobs || {};
      add(a.job_id || job.id, { job_number: job.job_number || '', client_name: job.client_name || '', site_suburb: job.site_suburb || '', booked_dates: a.scheduled_date ? [String(a.scheduled_date).slice(0, 10)] : [] });
    }
  }
  return out;
}

function entryOf(card) {
  const e = card.logged_time_entry || (card.previous_entry && card.previous_entry.start_time ? card.previous_entry : null);
  if (!e || !e.start_time || !e.finish_time) return null;
  return { date: (e.work_date || '').slice(0, 10), start: String(e.start_time).slice(0, 5), finish: String(e.finish_time).slice(0, 5), breakMin: Number(e.break_minutes) || 0 };
}

/**
 * Lines for a week from my_hours, the trade's saved edits and anything they added.
 * draft = { edits: { [key]: {...} }, added: [line], lumps: [{ id, description, amount }], gst, notes }
 * `jobModes` is { [jobId]: row } from trade_invoice_job_modes, for jobs the trade added themselves.
 */
export function buildLines(hours, draft, { workOrders = [], perMetre = false, jobModes = null } = {}) {
  const edits = (draft && draft.edits) || {};
  const usualRate = hours && hours.rate_resolved !== false && Number(hours.rate) > 0 ? Number(hours.rate) : 0;
  const unavailable = Boolean(hours && hours.invoice_mode_unavailable === true);
  const lines = [];
  const woByJob = new Map();
  for (const card of (hours && hours.assignments) || []) {
    if (!card.scheduled_date) continue;
    const job = card.jobs || {};
    const key = 'as:' + card.id;
    const edit = edits[key] || {};
    const m = readMode(card, unavailable);
    // Paid through the group work order: see groupRouteJobs.
    if (m.mode === 'group_work_order') continue;
    const bookedDate = card.scheduled_date.slice(0, 10);
    const saved = entryOf(card);
    const clocked = card.hours_worked != null ? Number(card.hours_worked) : null;
    const base = {
      jobId: job.id, jobNumber: job.job_number || '', title: jobTitle(job), suburb: job.site_suburb || '', client: job.client_name || '', vertical: verticalOf(job), jobType: job.type || '',
      mode: m.mode, canCommission: m.canCommission, agreed: m.agreed, bookedDate, sentBack: card.previous_entry || null
    };
    if (!m.mode) {
      // Not known how this job is billed. Never opened as hours, never sent.
      lines.push({ ...base, key, kind: 'unknown', unknown: true, assignmentId: card.id, date: bookedDate, saved, clocked, off: false, ahead: bookedDate > todayISO() });
      continue;
    }
    const hasCrewWo = workOrders.some((w) => w.job_id === job.id && (w.can_add_to_weekly_invoice || w.can_invoice));
    // The trade's own switch counts only where the job allows it.
    const picked = edit.kind === 'commission' ? (m.canCommission === true ? 'commission' : null)
      : edit.kind === 'work_order' ? (m.mode === 'work_order' ? 'work_order' : null)
      : edit.kind === 'hours' ? 'hours' : null;
    // A work order job opens as a work order when there is an amount to bill:
    // an agreed one, the trade's own crew work order, or a per-metre trade.
    // An hourly helper on that job opens on hours and can switch.
    const kind = picked || (m.mode === 'work_order' && (m.agreed != null || hasCrewWo || perMetre) ? 'work_order' : 'hours');
    if (kind === 'work_order' || kind === 'commission') {
      const k = (kind === 'work_order' ? 'wo:' : 'co:') + job.id;
      let line = woByJob.get(k);
      if (!line) {
        const e2 = edits[k] || {};
        const bound = kind === 'work_order' ? workOrders.find((w) => w.job_id === job.id && (w.can_add_to_weekly_invoice || w.can_invoice)) : null;
        line = { ...base, key: k, kind, assignmentIds: [], cardKeys: [], date: bookedDate, days: [], dayCards: [],
          workOrderId: bound ? bound.id : null, woNumber: bound ? bound.wo_number : '',
          amount: kind === 'work_order' ? (base.agreed != null ? base.agreed : bound ? Number(bound.subtotal) || 0 : num(e2.amount)) : num(e2.amount),
          amountLocked: kind === 'work_order' && (base.agreed != null || Boolean(bound)),
          helpers: e2.helpers || [], charges: bound ? (bound.negative_charges || []) : [], chargeIds: e2.chargeIds || [],
          description: e2.description || '', off: Boolean(e2.off), picked: Boolean(picked) };
        woByJob.set(k, line); lines.push(line);
      }
      line.assignmentIds.push(card.id); line.cardKeys.push(key); line.days.push(bookedDate);
      // The hours on a work order job are a record only. The amount is the work order's.
      line.dayCards.push({ assignmentId: card.id, key, date: bookedDate, saved, clocked });
      if (bookedDate < line.date) line.date = bookedDate;
      continue;
    }
    lines.push({
      ...base, key, kind: 'hours', assignmentId: card.id, picked: Boolean(picked),
      date: edit.date || (saved && saved.date) || bookedDate,
      start: edit.start != null ? edit.start : saved ? saved.start : '',
      finish: edit.finish != null ? edit.finish : saved ? saved.finish : '',
      breakMin: edit.breakMin != null ? edit.breakMin : saved ? saved.breakMin : null,
      fromSaved: Boolean(saved) && edit.start == null && edit.finish == null,
      clocked,
      usualRate, rate: edit.rate != null && edit.rate !== '' ? Number(edit.rate) : usualRate,
      description: edit.description != null ? edit.description : (card.previous_entry && card.previous_entry.description) || '',
      justification: edit.justification || '', off: Boolean(edit.off),
      // Booked for a day that has not come yet: not on this invoice until it is worked.
      ahead: bookedDate > todayISO() && !(edit.start || edit.finish)
    });
  }
  for (const a of (draft && draft.added) || []) {
    const edit = edits[a.key] || {};
    const merged = { ...a, ...edit, usualRate, rate: edit.rate != null && edit.rate !== '' ? Number(edit.rate) : a.rate != null ? a.rate : usualRate, added: true, off: false };
    if (a.kind !== 'other') {
      // A job the trade added: how it is billed is asked of the server every time.
      const m = jobModes ? readMode(jobModes[a.jobId] || null, false) : { mode: null, canCommission: null, agreed: null };
      merged.mode = m.mode; merged.canCommission = m.canCommission; merged.agreed = m.agreed;
      if (!m.mode || m.mode === 'group_work_order') { lines.push({ ...merged, kind: 'unknown', unknown: true, viaGroup: m.mode === 'group_work_order', modePending: !jobModes }); continue; }
      const want = edit.kind || a.kind;
      const kind = want === 'commission' ? (m.canCommission === true ? 'commission' : null) : want === 'work_order' ? (m.mode === 'work_order' ? 'work_order' : null) : null;
      merged.kind = kind || (m.mode === 'work_order' && (m.agreed != null || perMetre) && want !== 'hours' ? 'work_order' : 'hours');
      if (merged.kind === 'work_order') {
        merged.amount = m.agreed != null ? m.agreed : num(merged.amount);
        merged.amountLocked = m.agreed != null;
        merged.helpers = merged.helpers || []; merged.charges = []; merged.chargeIds = [];
      } else if (merged.kind === 'commission') merged.amount = num(merged.amount);
    }
    lines.push(merged);
  }
  // Amounts the trade takes off the whole invoice (made in the current Trade App).
  for (const lp of (draft && draft.lumps) || []) {
    if (!lp) continue;
    lines.push({ key: 'lump:' + lp.id, lumpId: lp.id, kind: 'deduction', title: String(lp.description || '').trim() || 'Adjustment amount', description: String(lp.description || '').trim(), amount: Math.abs(Number(lp.amount) || 0), date: '', added: true, off: false });
  }
  return lines.sort((x, y) => String(x.date || '9').localeCompare(String(y.date || '9')) || x.title.localeCompare(y.title));
}
function num(v) { const n = Number(v); return v === '' || v == null || isNaN(n) ? null : n; }

export function lineHours(line) { return line.kind === 'hours' ? hoursBetween(line.start, line.finish, line.breakMin || 0) : NaN; }
export function helpersTotal(line) {
  const helpers = (line.helpers || []).reduce((s, h) => s + (Number(h.hours) || 0) * (Number(h.rate) || 0), 0);
  const charges = (line.charges || []).filter((c) => (line.chargeIds || []).includes(c.line_id)).reduce((s, c) => s + Math.abs(Number(c.amount_ex) || 0), 0);
  return Math.round((helpers + charges) * 100) / 100;
}
/** Ex GST value of a line, or null while it is unfinished. */
export function lineAmount(line) {
  if (line.off || line.ahead || line.unknown) return 0;
  if (line.kind === 'deduction') return line.amount > 0 ? -Number(line.amount) : null;
  if (line.kind === 'hours') { const h = lineHours(line); return isNaN(h) || !(line.rate > 0) ? null : Math.round(h * line.rate * 100) / 100; }
  if (line.kind === 'work_order') { if (!(line.amount > 0)) return null; const net = Math.round((line.amount - helpersTotal(line)) * 100) / 100; return net > 0 ? net : null; }
  return line.amount > 0 ? Number(line.amount) : null;
}
/** Plain words for what is still missing on a line, or '' when it is ready. */
export function lineProblem(line, { monday, rateEditable }) {
  if (line.off || line.ahead || line.unknown) return '';
  if (line.kind === 'deduction') return !line.description ? 'Say what it is for' : line.amount > 0 ? '' : 'Add the amount';
  const today = todayISO(); const sunday = addDays(monday, 6);
  if (line.kind === 'hours') {
    if (!line.start || !line.finish) return 'Add your start and finish times';
    if (line.breakMin == null) return 'Say if you had a break';
    if (!line.date) return 'Pick the day you worked';
    if (line.date > today) return 'That day has not happened yet';
    if (line.assignmentId && (line.date < monday || line.date > sunday)) return 'The day is outside this week';
    if (!line.assignmentId && line.date > sunday) return 'The day is after this week';
    const h = lineHours(line);
    if (isNaN(h)) return 'Finish must be after start';
    if (h > 24) return 'Check the times';
    if (!(line.rate > 0)) return rateEditable ? 'Add your rate' : 'Your rate is not set. Call the office';
    if (!line.assignmentId && !String(line.description || '').trim()) return 'Say what you did';
    return '';
  }
  if (line.kind === 'work_order') {
    if (!(line.amount > 0)) return 'Add the work order amount';
    if ((line.helpers || []).some((h) => !String(h.name || '').trim() || !(Number(h.hours) > 0) || !(Number(h.rate) > 0))) return 'Finish the helper line';
    if (lineAmount(line) == null) return 'Helpers add up to more than the job';
    return '';
  }
  if (line.kind === 'commission') return line.amount > 0 ? '' : 'Add the commission amount';
  if (!String(line.description || '').trim()) return 'Say what it is for';
  return line.amount > 0 ? '' : 'Add the amount';
}
export function lineSummary(line) {
  if (line.kind === 'hours') {
    if (!line.start || !line.finish) return '';
    const brk = line.breakMin ? `, ${line.breakMin} min break` : '';
    return `${fmtTime(line.start)} to ${fmtTime(line.finish)}${brk}`;
  }
  if (line.kind === 'work_order') return line.amountLocked ? 'Work order, agreed with the office' : 'Work order';
  if (line.kind === 'commission') return 'Commission';
  if (line.kind === 'unknown') return UNKNOWN_MODE_WORDS;
  if (line.kind === 'deduction') return 'Adjustment';
  return line.type || 'Other';
}

/** Estimate only. The server works out the real figures when the invoice is sent. */
export function estimate(lines, { gstOn, deduction, basis }) {
  let gross = 0; let commission = 0; let reimb = 0; let hours = 0; let unfinished = 0;
  for (const l of lines) {
    if (l.off || l.ahead || l.unknown) continue;
    const amt = lineAmount(l);
    if (amt == null) { unfinished += 1; continue; }
    gross += amt; if (l.kind === 'commission') commission += amt;
    if (l.type === 'reimbursement') reimb += amt;
    if (l.kind === 'hours') hours += lineHours(l) || 0;
  }
  if (basis === 'inclusive_12_112_v1') {
    gross = round2(gross); reimb = round2(reimb);
    const base = round2(gross - reimb);
    const superCents = Math.floor((Math.round(base * 100) * 6 + 28) / 56);
    const superPaid = superCents / 100;
    const paidToYou = round2(base - superPaid);
    const gst = gstOn ? Math.floor((Math.round(base * 100) + 5) / 10) / 100 : 0;
    const takeOff = Number(deduction && deduction.amount) || 0;
    const intoBank = round2(paidToYou + reimb + gst - takeOff);
    return { gross, base, superPaid, paidToYou, reimb, gst, intoBank, takeOff, pay: intoBank,
      hours: round2(hours), unfinished,
      count: lines.filter((l) => !l.off && !l.ahead && !l.unknown).length,
      ahead: lines.filter((l) => l.ahead && !l.off && !l.unknown).length,
      unknown: lines.filter((l) => l.unknown && !l.ahead).length };
  }
  const superHeld = Math.round(Math.max(0, gross - commission) * 0.06 * 100) / 100;
  const gst = gstOn ? Math.round(gross * 0.1 * 100) / 100 : 0;
  let pay = gross - superHeld + gst;
  const takeOff = deduction && deduction.amount > 0 && pay >= deduction.amount ? Number(deduction.amount) : 0;
  pay -= takeOff;
  const superBase = round2(Math.max(0, gross - commission));
  return { gross: round2(gross), superBase, superHeld, gst, takeOff, pay: round2(pay), hours: round2(hours), unfinished,
    count: lines.filter((l) => !l.off && !l.ahead && !l.unknown).length, ahead: lines.filter((l) => l.ahead && !l.off && !l.unknown).length, unknown: lines.filter((l) => l.unknown && !l.ahead).length };
}
function round2(n) { return Math.round(n * 100) / 100; }

/** The request body for generate_trade_invoice. Only call with every line ready. */
export function buildSubmit(lines, { monday, gstOn, notes, rateEditable }) {
  const manual_assignments = []; const extra_items = [];
  for (const l of lines) {
    if (l.off || l.ahead || l.unknown) continue;
    if (l.kind === 'deduction') {
      // Same row the current Trade App sends for an amount taken off the invoice.
      extra_items.push({ type: 'Deduction', row_type: 'lump_sum', line_kind: 'lump_sum', description: l.description, quantity: 1, unit: 'ea', hours: 1, rate: -Math.abs(Number(l.amount)),
        job_id: null, job_number: '', assignment_id: null, scheduled_date: null, date: null, division: '', client_name: '', manually_added: true, source: 'invoice_final_deduction', rate_source: 'client_entered', client_rate_entered: true });
      continue;
    }
    const jobRef = { job_id: l.jobId || null, job_number: l.jobNumber || '', division: l.jobType || '', client_name: l.client || '' };
    if (l.kind === 'hours') {
      const hours = lineHours(l);
      const overMs = l.vertical === 'makesafe' && hours > 2;
      if (l.assignmentId) {
        const typed = rateEditable && l.rate > 0 && Math.abs(l.rate - l.usualRate) > 0.004;
        const item = { assignment_id: l.assignmentId, hours, work_date: l.date, start_time: l.start, finish_time: l.finish, break_minutes: l.breakMin || 0,
          rate: l.rate, rate_source: typed ? 'client_entered' : 'server_resolved', description: (l.description || '').trim(), manually_added: false };
        if (overMs) item.justification = (l.justification || '').trim();
        manual_assignments.push(item);
      } else {
        const item = { type: 'Labour', row_type: 'labour', description: (l.description || '').trim(), quantity: hours, unit: 'hr', rate: l.rate,
          date: l.date, work_date: l.date, start_time: l.start, finish_time: l.finish, break_minutes: l.breakMin || 0, ...jobRef,
          manually_added: true, source: 'manual_job_search', rate_source: 'client_entered', client_rate_entered: true };
        if (overMs) item.justification = (l.justification || '').trim();
        extra_items.push(item);
      }
    } else if (l.kind === 'work_order') {
      const helperLines = (l.helpers || []).map((h) => ({ trade_name: String(h.name).trim(), hours: Number(h.hours), rate: Number(h.rate), amount: round2(Number(h.hours) * Number(h.rate)) }));
      const chargeLines = (l.charges || []).filter((c) => (l.chargeIds || []).includes(c.line_id)).map((c) => ({ trade_name: c.trade_name, hours: 1, rate: Math.abs(Number(c.amount_ex)), amount: Math.abs(Number(c.amount_ex)), line_source: 'wo_pass_through', source_line_id: c.line_id, server_owned: true }));
      const off = helpersTotal(l); const net = round2(l.amount - off);
      const audit = off > 0 ? `WO $${l.amount} less crew $${off} = net $${net}` : `Work order ${l.woNumber || l.jobNumber}`.trim();
      extra_items.push({ type: 'Work Order', row_type: 'work_order', description: (l.description || '').trim() ? `${audit}. ${l.description.trim()}` : audit,
        quantity: 1, unit: 'ea', rate: net, wo_allocated: l.amount, work_order_id: l.workOrderId || null, wo_labour_deduction: off, wo_labour_lines: [...helperLines, ...chargeLines],
        date: l.date, ...jobRef, manually_added: Boolean(l.added), source: l.added ? 'manual_job_search' : 'assigned_card', rate_source: 'client_entered', client_rate_entered: true });
    } else if (l.kind === 'commission') {
      extra_items.push({ type: 'Commission', row_type: 'commission', description: `Commission, ${[l.jobNumber, l.client].filter(Boolean).join(', ')}`, quantity: 1, unit: 'ea', rate: Number(l.amount), commission_amount: Number(l.amount),
        date: l.date, ...jobRef, manually_added: Boolean(l.added), source: l.added ? 'manual_job_search' : 'assigned_card', rate_source: 'client_entered', client_rate_entered: true });
    } else {
      extra_items.push({ type: l.type || 'Other', row_type: String(l.type || 'other').toLowerCase(), description: (l.description || '').trim(), quantity: 1, unit: 'ea', rate: Number(l.amount),
        date: l.date, ...jobRef, manually_added: true, source: 'manual', rate_source: 'client_entered', client_rate_entered: true });
    }
  }
  return { week_start: monday, manual_assignments, extra_items, notes: (notes || '').trim(), gst_on: Boolean(gstOn) };
}

/** Days of the week a line may sit on: Monday up to today (never ahead). */
export function pickableDays(monday) {
  const today = todayISO();
  return [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(monday, n)).filter((d) => d <= today);
}
export function dayLabel(iso) { return fmtDay(iso); }


// ------------------------------------------------------------------------
// The saved weekly draft. The server keeps one draft a person a week
// (get_running_invoice_draft / save_running_invoice_draft) in the shape the
// current Trade App writes: draft_builder = { version, jobCards, invRows,
// invLumpLines, dismissedKeys, notes, gst_on, weekStart, weekEnd, manualLock,
// groupIds }. One job card is one booking (or one job the trade added) on one
// day. These two functions turn that shape into this app's draft and back, so
// a week started in either app opens the same in the other. A draft bills
// nothing: GST, super and deductions are worked out only when it is sent.
// ------------------------------------------------------------------------
const hm = (t) => (t ? String(t).slice(0, 5) : '');
const cardTimes = (c) => Boolean(c && c.start_time && c.finish_time);
/** The key the server and the current Trade App give a draft line. */
export function draftSourceKey(card) {
  if (!card || typeof card !== 'object') return '';
  if (card.source_key) return String(card.source_key);
  if (card.work_order_id) return 'wo:' + card.work_order_id;
  if (card.assignment_id) return 'as:' + card.assignment_id;
  const day = card.work_date || card.scheduled_date || card.line_date || '';
  if (card.job_id && day) return 'job:' + card.job_id + ':' + String(day).slice(0, 10);
  return '';
}
const crewRow = (r) => r && r._source === 'crew_app';
/** Lines in a saved draft that this app cannot show or send (made in the current Trade App). */
export function foreignDraftLines(builder) {
  if (!builder) return 0;
  const rows = (builder.invRows || []).filter((r) => r && !crewRow(r) && r._source !== 'clock' && r._source !== 'server_labour' && (Number(r.hours) > 0 || r.description || r.job_text || r.start_time)).length;
  const cards = (builder.jobCards || []).filter((c) => c && c.included !== false && ((Array.isArray(c.wo_lump_lines) && c.wo_lump_lines.some((l) => l && Number(l.amount) > 0)) || Number(c.travel_amount) > 0)).length;
  return rows + cards;
}

/** Server draft -> this app's draft. `hours` is my_hours for the same week. */
export function draftFromBuilder(builder, hours) {
  const out = { edits: {}, added: [], lumps: [], gst: typeof builder.gst_on === 'boolean' ? builder.gst_on : null, notes: builder.notes || '' };
  const mine = new Map(((hours && hours.assignments) || []).map((a) => [String(a.id), a]));
  const dismissed = new Set((builder.dismissedKeys || []).map(String));
  const grouped = {}; // 'wo:<job>' | 'co:<job>' -> cards in that mode
  for (const c of builder.jobCards || []) {
    if (!c || typeof c !== 'object') continue;
    const times = cardTimes(c);
    const wantsCo = c.commission_mode === true && (c.mode_picked === true || Number(c.commission_amount) > 0);
    const wantsWo = !wantsCo && c.wo_mode === true && (c.mode_picked === true || Number(c.wo_allocated) > 0 || (Array.isArray(c.wo_labour_lines) && c.wo_labour_lines.length > 0));
    const helpers = (Array.isArray(c.wo_labour_lines) ? c.wo_labour_lines : []).filter((l) => l && l.line_kind !== 'wo_pass_through').map((l) => ({ name: l.trade_name || '', hours: l.hours == null ? '' : l.hours, rate: l.rate == null ? '' : l.rate }));
    const chargeIds = (Array.isArray(c.wo_labour_lines) ? c.wo_labour_lines : []).filter((l) => l && l.line_kind === 'wo_pass_through' && l.source_line_id).map((l) => String(l.source_line_id));
    if (c.assignment_id && mine.has(String(c.assignment_id))) {
      const a = mine.get(String(c.assignment_id));
      const jobId = (a.jobs && a.jobs.id) || a.job_id || c.job_id;
      const key = 'as:' + c.assignment_id;
      const e = {};
      if (wantsCo || wantsWo) {
        e.kind = wantsCo ? 'commission' : 'work_order';
        const gk = (wantsCo ? 'co:' : 'wo:') + jobId;
        (grouped[gk] = grouped[gk] || []).push(c);
      } else {
        if (c.included === false) e.off = true;
        if (!c.commission_mode && !c.wo_mode && (c.mode_picked === true || times || c.hours_user_edited === true)) e.kind = 'hours';
        if (c.work_date) e.date = String(c.work_date).slice(0, 10);
        if (c.start_time) e.start = hm(c.start_time);
        if (c.finish_time) e.finish = hm(c.finish_time);
        if (times && c.crew_break_unset !== true) e.breakMin = Number(c.break_minutes) || 0;
        if (c.typed_rate != null && Number(c.typed_rate) > 0) e.rate = Number(c.typed_rate);
        if (c.description) e.description = String(c.description);
        if (c.justification) e.justification = String(c.justification);
      }
      if (Object.keys(e).length) out.edits[key] = e;
      continue;
    }
    // A job the trade added themselves (no booking behind it).
    if (!c.assignment_id && !c.work_order_id && c.job_id && c.included !== false) {
      const kind = wantsCo ? 'commission' : wantsWo ? 'work_order' : 'hours';
      const line = { key: c.crew_key || 'add:' + draftSourceKey(c), kind, jobId: c.job_id, jobNumber: c.job_number || '', title: c.crew_title || c.site_suburb || c.client_name || c.job_number || 'Job', suburb: c.site_suburb || '', client: c.client_name || '',
        vertical: verticalOf({ type: c.job_type, job_number: c.job_number }), jobType: c.job_type || '', date: String(c.work_date || c.scheduled_date || '').slice(0, 10), description: c.description || '' };
      if (kind === 'hours') {
        Object.assign(line, { start: hm(c.start_time), finish: hm(c.finish_time), breakMin: times && c.crew_break_unset !== true ? Number(c.break_minutes) || 0 : null });
        if (Number(c.typed_rate) > 0) line.rate = Number(c.typed_rate); else if (c.rate_source === 'client_entered' && Number(c.rate) > 0) line.rate = Number(c.rate);
        if (c.justification) line.justification = String(c.justification);
      } else if (kind === 'work_order') Object.assign(line, { amount: num(c.wo_allocated), helpers });
      else line.amount = num(c.commission_amount);
      out.added.push(line);
    }
  }
  for (const [gk, cards] of Object.entries(grouped)) {
    const first = cards.find((c) => c.included !== false) || cards[0];
    const e = { off: cards.every((c) => c.included === false) };
    if (gk.startsWith('co:')) e.amount = num(first.commission_amount);
    else {
      e.amount = num(first.wo_allocated);
      e.helpers = (Array.isArray(first.wo_labour_lines) ? first.wo_labour_lines : []).filter((l) => l && l.line_kind !== 'wo_pass_through').map((l) => ({ name: l.trade_name || '', hours: l.hours == null ? '' : l.hours, rate: l.rate == null ? '' : l.rate }));
      e.chargeIds = (Array.isArray(first.wo_labour_lines) ? first.wo_labour_lines : []).filter((l) => l && l.line_kind === 'wo_pass_through' && l.source_line_id).map((l) => String(l.source_line_id));
      e.description = first.description || '';
    }
    out.edits[gk] = e;
  }
  // A line the trade removed in the current Trade App stays off here too.
  for (const k of dismissed) if (k.startsWith('as:') && mine.has(k.slice(3))) out.edits[k] = { ...(out.edits[k] || {}), off: true };
  // Extra amounts this app added (travel, materials, equipment, other).
  for (const r of builder.invRows || []) {
    if (!crewRow(r)) continue;
    const x = r.crew_line || {};
    out.added.push({ key: x.key || 'add:row:' + out.added.length, kind: 'other', type: x.type || 'Other', jobId: r.job_id || null, jobNumber: r.job_text || '', title: x.title || r.job_text || 'Job', suburb: x.suburb || '', client: r.client_name || '', vertical: x.vertical || 'other', jobType: r.division || '', date: r.date || '', amount: Number(r.amount) || 0, description: r.description || '' });
  }
  for (const lp of builder.invLumpLines || []) if (lp && (lp.description || Number(lp.amount))) out.lumps.push({ id: lp.id || 'il-' + out.lumps.length, description: lp.description || '', amount: Math.abs(Number(lp.amount) || 0) });
  return out;
}

/**
 * This app's week -> the draft_builder to save. `lines` are buildLines for the
 * same hours and draft. `base` is the builder last read from the server: cards
 * and rows this app does not manage are kept exactly as they were.
 */
export function builderFromDraft(hours, draft, lines, { monday, gstOn }) {
  const base = (draft && draft.base) || {};
  const edits = (draft && draft.edits) || {};
  const prior = new Map();
  for (const c of base.jobCards || []) { const k = draftSourceKey(c); if (k && !prior.has(k)) prior.set(k, c); }
  const dismissed = new Set((base.dismissedKeys || []).map(String));
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const ofCard = new Map();
  for (const l of lines) (l.cardKeys || []).forEach((k, i) => ofCard.set(k, { line: l, first: i === 0 }));
  const unavailable = Boolean(hours && hours.invoice_mode_unavailable === true);
  const cards = []; const used = new Set();
  for (const a of (hours && hours.assignments) || []) {
    if (!a || !a.scheduled_date) continue;
    const m = readMode(a, unavailable);
    if (m.mode === 'group_work_order') continue;
    const job = a.jobs || {}; const key = 'as:' + a.id;
    const own = byKey.get(key); const part = ofCard.get(key); const edit = edits[key] || {};
    const off = own ? Boolean(own.off) : part ? Boolean(part.line.off) : false;
    used.add(key);
    if (dismissed.has(key)) { if (off) continue; dismissed.delete(key); }
    const card = { ...(prior.get(key) || {}), assignment_id: a.id, job_id: job.id || a.job_id || null, job_number: job.job_number || '', client_name: job.client_name || '', site_suburb: job.site_suburb || '', job_type: job.type || '', scheduled_date: String(a.scheduled_date).slice(0, 10), source_key: key };
    if (card.included == null) card.included = true;
    if (m.mode) Object.assign(card, { invoice_mode: m.mode, can_claim_commission: m.canCommission, invoice_mode_checked: true });
    if (own && own.kind === 'hours') {
      const h = lineHours(own);
      const typed = own.usualRate > 0 ? own.rate > 0 && Math.abs(own.rate - own.usualRate) > 0.004 : edit.rate != null && edit.rate !== '';
      Object.assign(card, { included: !own.off, wo_mode: false, commission_mode: false, work_date: own.start || own.finish || edit.date ? own.date || '' : '', start_time: own.start || '', finish_time: own.finish || '', break_minutes: own.breakMin == null ? 0 : own.breakMin,
        hours: isNaN(h) ? null : h, rate: own.rate || 0, rate_source: typed ? 'client_entered' : 'server_resolved', typed_rate: typed ? own.rate : null, description: own.description || '' });
      if ((own.start || own.finish) && own.breakMin == null) card.crew_break_unset = true; else delete card.crew_break_unset;
      if (own.justification) card.justification = own.justification;
      if (edit.kind) card.mode_picked = true;
      if (edit.start != null || edit.finish != null) { card.hours_user_edited = true; card.owner_edited = true; }
    } else if (part) {
      const l = part.line;
      Object.assign(card, { wo_mode: l.kind === 'work_order', commission_mode: l.kind === 'commission', included: part.first ? !l.off : false });
      if (edit.kind) card.mode_picked = true;
      if (l.kind === 'work_order') {
        card.wo_allocated = l.amount > 0 ? Number(l.amount) : null;
        if (part.first) {
          const picked = (l.charges || []).filter((c) => (l.chargeIds || []).includes(c.line_id));
          card.wo_labour_lines = [
            ...(l.helpers || []).map((h) => ({ trade_name: h.name || '', hours: h.hours === '' || h.hours == null ? null : Number(h.hours), rate: h.rate === '' || h.rate == null ? null : Number(h.rate) })),
            ...picked.map((c) => ({ trade_name: c.trade_name || '', line_kind: 'wo_pass_through', amount: Math.abs(Number(c.amount_ex) || 0), hours: null, source_line_id: String(c.line_id), server_owned: true }))
          ];
          card.work_order_id = l.workOrderId || ''; card.wo_number = l.woNumber || ''; card.description = l.description || '';
        }
      } else if (part.first) card.commission_amount = l.amount > 0 ? Number(l.amount) : null;
    }
    cards.push(card);
  }
  // Cards this app does not manage stay as they were: another week's booking, a work order the server suggested.
  for (const c of base.jobCards || []) {
    const k = draftSourceKey(c);
    if (k && used.has(k)) continue;
    const manual = c && !c.assignment_id && !c.work_order_id;
    if (manual && c.included !== false) continue; // replaced by the added lines below
    cards.push(c);
  }
  const rows = (base.invRows || []).filter((r) => !crewRow(r));
  for (const a of (draft && draft.added) || []) {
    const l = byKey.get(a.key) || { ...a, ...(edits[a.key] || {}) };
    if (a.kind === 'other') {
      rows.push({ date: l.date || '', job_id: l.jobId || null, job_text: l.jobNumber || '', description: l.description || '', division: l.jobType || '', hours: 0, rate: 0, amount: Number(l.amount) || 0, start_time: '', finish_time: '', break_minutes: 0, client_name: l.client || '', _source: 'crew_app',
        crew_line: { key: a.key, type: l.type || 'Other', title: l.title || '', suburb: l.suburb || '', vertical: l.vertical || 'other' } });
      continue;
    }
    const want = l.unknown ? (edits[a.key] && edits[a.key].kind) || a.kind : l.kind;
    const h = want === 'hours' ? hoursBetween(l.start, l.finish, l.breakMin || 0) : NaN;
    const was = prior.get('job:' + l.jobId + ':' + String(l.date || '').slice(0, 10)) || {};
    const card = { ...was, assignment_id: null, manually_added: true, job_id: l.jobId || null, job_number: l.jobNumber || '', client_name: l.client || '', site_suburb: l.suburb || '', job_type: l.jobType || '', scheduled_date: l.date || '', included: true,
      wo_mode: want === 'work_order', commission_mode: want === 'commission', mode_picked: want !== 'hours', description: l.description || '', crew_key: a.key, crew_title: l.title || '' };
    delete card.source_key;
    if (want === 'hours') {
      Object.assign(card, { work_date: l.date || '', start_time: l.start || '', finish_time: l.finish || '', break_minutes: l.breakMin == null ? 0 : l.breakMin, hours: isNaN(h) ? null : h, rate: l.rate || 0, rate_source: 'client_entered', typed_rate: l.rate > 0 ? l.rate : null });
      if ((l.start || l.finish) && l.breakMin == null) card.crew_break_unset = true; else delete card.crew_break_unset;
      if (l.justification) card.justification = l.justification;
    } else if (want === 'work_order') {
      card.wo_allocated = l.amount > 0 ? Number(l.amount) : null;
      card.wo_labour_lines = (l.helpers || []).map((x) => ({ trade_name: x.name || '', hours: x.hours === '' || x.hours == null ? null : Number(x.hours), rate: x.rate === '' || x.rate == null ? null : Number(x.rate) }));
    } else card.commission_amount = l.amount > 0 ? Number(l.amount) : null;
    cards.push(card);
  }
  const touched = Object.keys(edits).length > 0 || ((draft && draft.added) || []).length > 0;
  const snap = { version: 1 };
  if (Array.isArray(base.groupIds) && base.groupIds.length) snap.groupIds = base.groupIds.map(String);
  Object.assign(snap, {
    jobCards: cards, invRows: rows,
    invLumpLines: ((draft && draft.lumps) || []).map((lp) => ({ id: lp.id, description: lp.description || '', amount: Math.abs(Number(lp.amount) || 0) })),
    dismissedKeys: [...dismissed], notes: (draft && draft.notes) || '', gst_on: Boolean(gstOn), weekStart: monday, weekEnd: addDays(monday, 6)
  });
  if (base.manualLock === true || touched) snap.manualLock = true;
  return snap;
}
/** The request body for save_running_invoice_draft (the same body the current Trade App posts). */
export function draftSaveBody(snap, draftId) {
  const body = { week_start: snap.weekStart || '', notes: snap.notes || '', gst_on: Boolean(snap.gst_on), draft_builder: snap, dismissed_source_keys: snap.dismissedKeys || [] };
  if (draftId) body.draft_id = draftId;
  return body;
}
