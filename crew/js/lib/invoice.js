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
/** The amount this invoice pays the trade, straight from the server (null when it sent none). */
export function invoicePays(inv) {
  // `payable` (my_money rows) is already after the office's changes in Xero.
  if (inv.payable_after_xero != null) return Number(inv.payable_after_xero);
  if (inv.payable != null) return Number(inv.payable);
  if (inv.trade_payable != null) return Number(inv.trade_payable);
  return null;
}

function entryOf(card) {
  const e = card.logged_time_entry || (card.previous_entry && card.previous_entry.start_time ? card.previous_entry : null);
  if (!e || !e.start_time || !e.finish_time) return null;
  return { date: (e.work_date || '').slice(0, 10), start: String(e.start_time).slice(0, 5), finish: String(e.finish_time).slice(0, 5), breakMin: Number(e.break_minutes) || 0 };
}

/**
 * Lines for a week from my_hours, the trade's saved edits and anything they added.
 * draft = { edits: { [key]: {...} }, added: [line], gst, notes }
 */
export function buildLines(hours, draft, { workOrders = [], perMetre = false } = {}) {
  const edits = (draft && draft.edits) || {};
  const usualRate = hours && hours.rate_resolved !== false && Number(hours.rate) > 0 ? Number(hours.rate) : 0;
  const lines = [];
  const woByJob = new Map();
  for (const card of (hours && hours.assignments) || []) {
    if (!card.scheduled_date) continue;
    const job = card.jobs || {};
    const key = 'as:' + card.id;
    const edit = edits[key] || {};
    const mode = card.invoice_mode || null;
    const agreedEx = card.work_order_agreed_ex != null && Number(card.work_order_agreed_ex) > 0;
    const hasCrewWo = workOrders.some((w) => w.job_id === job.id && (w.can_add_to_weekly_invoice || w.can_invoice));
    // A work order job opens as a work order when there is an amount to bill:
    // an agreed one, the trade's own crew work order, or a per-metre trade.
    // An hourly helper on that job opens on hours and can switch.
    const kind = edit.kind || (mode === 'work_order' && (agreedEx || hasCrewWo || perMetre) ? 'work_order' : 'hours');
    const base = {
      jobId: job.id, jobNumber: job.job_number || '', title: jobTitle(job), client: job.client_name || '', vertical: verticalOf(job), jobType: job.type || '',
      mode, canCommission: card.can_claim_commission === true ? true : card.can_claim_commission === false ? false : null,
      agreed: card.work_order_agreed_ex != null && Number(card.work_order_agreed_ex) > 0 ? Number(card.work_order_agreed_ex) : null,
      bookedDate: card.scheduled_date.slice(0, 10), sentBack: card.previous_entry || null
    };
    if (kind === 'work_order' || kind === 'commission') {
      const k = (kind === 'work_order' ? 'wo:' : 'co:') + job.id;
      let line = woByJob.get(k);
      if (!line) {
        const e2 = edits[k] || {};
        const bound = kind === 'work_order' ? workOrders.find((w) => w.job_id === job.id && (w.can_add_to_weekly_invoice || w.can_invoice)) : null;
        line = { ...base, key: k, kind, assignmentIds: [], cardKeys: [], date: base.bookedDate, days: [],
          workOrderId: bound ? bound.id : null, woNumber: bound ? bound.wo_number : '',
          amount: kind === 'work_order' ? (base.agreed != null ? base.agreed : bound ? Number(bound.subtotal) || 0 : num(e2.amount)) : num(e2.amount),
          amountLocked: kind === 'work_order' && (base.agreed != null || Boolean(bound)),
          helpers: e2.helpers || [], charges: bound ? (bound.negative_charges || []) : [], chargeIds: e2.chargeIds || [],
          description: e2.description || '', off: Boolean(e2.off) };
        woByJob.set(k, line); lines.push(line);
      }
      line.assignmentIds.push(card.id); line.cardKeys.push(key); line.days.push(base.bookedDate);
      if (base.bookedDate < line.date) line.date = base.bookedDate;
      continue;
    }
    const saved = entryOf(card);
    lines.push({
      ...base, key, kind: 'hours', assignmentId: card.id,
      date: edit.date || (saved && saved.date) || base.bookedDate,
      start: edit.start != null ? edit.start : saved ? saved.start : '',
      finish: edit.finish != null ? edit.finish : saved ? saved.finish : '',
      breakMin: edit.breakMin != null ? edit.breakMin : saved ? saved.breakMin : null,
      fromSaved: Boolean(saved) && edit.start == null && edit.finish == null,
      clocked: card.hours_worked != null ? Number(card.hours_worked) : null,
      usualRate, rate: edit.rate != null && edit.rate !== '' ? Number(edit.rate) : usualRate,
      description: edit.description != null ? edit.description : (card.previous_entry && card.previous_entry.description) || '',
      justification: edit.justification || '', off: Boolean(edit.off),
      // Booked for a day that has not come yet: not on this invoice until it is worked.
      ahead: base.bookedDate > todayISO() && !(edit.start || edit.finish)
    });
  }
  for (const a of (draft && draft.added) || []) {
    const edit = edits[a.key] || {};
    lines.push({ ...a, ...edit, usualRate, rate: edit.rate != null && edit.rate !== '' ? Number(edit.rate) : a.rate != null ? a.rate : usualRate, added: true, off: false });
  }
  return lines.sort((x, y) => String(x.date).localeCompare(String(y.date)) || x.title.localeCompare(y.title));
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
  if (line.off || line.ahead) return 0;
  if (line.kind === 'hours') { const h = lineHours(line); return isNaN(h) || !(line.rate > 0) ? null : Math.round(h * line.rate * 100) / 100; }
  if (line.kind === 'work_order') { if (!(line.amount > 0)) return null; const net = Math.round((line.amount - helpersTotal(line)) * 100) / 100; return net > 0 ? net : null; }
  return line.amount > 0 ? Number(line.amount) : null;
}
/** Plain words for what is still missing on a line, or '' when it is ready. */
export function lineProblem(line, { monday, rateEditable }) {
  if (line.off || line.ahead) return '';
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
  return line.type || 'Other';
}

/** Estimate only. The server works out the real figures when the invoice is sent. */
export function estimate(lines, { gstOn, deduction }) {
  let gross = 0; let commission = 0; let hours = 0; let unfinished = 0;
  for (const l of lines) {
    if (l.off || l.ahead) continue;
    const amt = lineAmount(l);
    if (amt == null) { unfinished += 1; continue; }
    gross += amt; if (l.kind === 'commission') commission += amt;
    if (l.kind === 'hours') hours += lineHours(l) || 0;
  }
  const superHeld = Math.round(Math.max(0, gross - commission) * 0.06 * 100) / 100;
  const gst = gstOn ? Math.round(gross * 0.1 * 100) / 100 : 0;
  let pay = gross - superHeld + gst;
  const takeOff = deduction && deduction.amount > 0 && pay >= deduction.amount ? Number(deduction.amount) : 0;
  pay -= takeOff;
  return { gross: round2(gross), superHeld, gst, takeOff, pay: round2(pay), hours: round2(hours), unfinished, count: lines.filter((l) => !l.off && !l.ahead).length, ahead: lines.filter((l) => l.ahead && !l.off).length };
}
function round2(n) { return Math.round(n * 100) / 100; }

/** The request body for generate_trade_invoice. Only call with every line ready. */
export function buildSubmit(lines, { monday, gstOn, notes, rateEditable }) {
  const manual_assignments = []; const extra_items = [];
  for (const l of lines) {
    if (l.off || l.ahead) continue;
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
