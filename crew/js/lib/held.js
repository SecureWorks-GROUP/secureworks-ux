// Lines a trade sent that wait on the office (P1-05.13 / F1, behind ops-api's
// trade_line_hold_v1). Pure rules only: no reads, no writes, no rendering.
//
// Everything here is the signed-in trade's own: the send answer and the
// trade's own invoices (get_trade_invoice is filtered to the caller by the
// server). A line's hold reason is put into the app's own words from its code,
// never the server's sentence and never hold_detail, which can carry a job's
// work order amount. No figure is worked out: every amount is the server's.
// While the switch is off none of these fields arrive, and nothing changes.

/** Why a line is waiting on the office, from its hold_reason code. */
export const HELD_WORDS = {
  no_work_order: 'This job has no work order yet, so the office checks the line first.',
  no_amount: 'This job\'s work order has no amount yet, so the office checks the line first.',
  over_amount: 'This line is more than the job\'s work order has left, so the office checks it first.',
  hourly_no_maximum: 'This job has no limit for hourly work yet, so the office checks the line first.',
  no_job: 'This line is not on a job, so the office checks it first.',
  not_job_work: 'Work that is not on a job waits for the office to approve it.',
  reimbursement: 'This receipt waits for the office to approve it.',
  not_on_crew: 'You added yourself to this job, and that is not accepted yet.',
  commission_no_figure: 'The commission on this job has no figure yet.',
  rate_above_rule: 'This amount is above the usual rate, so the office checks it first.'
};
const ANY_REASON = 'The office is checking this line before it is paid.';

export function heldWords(reason) {
  return Object.prototype.hasOwnProperty.call(HELD_WORDS, reason) ? HELD_WORDS[reason] : ANY_REASON;
}

const amount = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The three parts of a send, as the server answered them: in pay, waiting on
 * the office, not approved. Only when the send split (something is waiting or
 * not approved), and only when every part is a number; otherwise null.
 */
export function sendSplit(res) {
  const s = res && res.send;
  if (!s || typeof s !== 'object') return null;
  const inPay = amount(s.in_pay_ex), waiting = amount(s.held_ex), notApproved = amount(s.declined_ex);
  if (inPay == null || waiting == null || notApproved == null) return null;
  if (!(waiting > 0) && !(notApproved > 0)) return null;
  return { inPay, waiting, notApproved };
}

/** The send answer's held lines: job number, reason code and the line's own amount. */
export function sendHeldLines(res) {
  const list = res && Array.isArray(res.held_lines) ? res.held_lines : [];
  return list.filter((l) => l && typeof l === 'object').map((l, i) => ({
    key: String(l.line_id || i),
    jobNumber: typeof l.job_number === 'string' && l.job_number ? l.job_number : '',
    words: heldWords(l.reason),
    amount: amount(l.amount_ex)
  }));
}

/** Every line of this send waits on the office: no pay invoice was made. */
export function allHeld(res) {
  return Boolean(res && !res.invoice_id && (sendHeldLines(res).length > 0 || sendSplit(res)));
}

/** A line's office state: waiting, not_approved, approved, or '' when it was never held. */
export function heldState(l) {
  const s = String((l && l.office_review_status) || '').toLowerCase();
  if (s === 'awaiting' || s === 'queried') return 'waiting';
  if (s === 'rejected') return 'not_approved';
  if (s === 'approved') return 'approved';
  return '';
}

export const isHeldInvoice = (inv) => Boolean(inv && inv.invoice_kind === 'held');
export const isFollowOn = (inv) => Boolean(inv && inv.invoice_kind === 'follow_on');

/** Counts (never sums) of a holding invoice's lines by state. */
export function heldCounts(inv) {
  const lines = (inv && Array.isArray(inv.lines) ? inv.lines : []);
  return {
    waiting: lines.filter((l) => heldState(l) === 'waiting').length,
    notApproved: lines.filter((l) => heldState(l) === 'not_approved').length
  };
}

// ---------- where this phone remembers a send's holding invoice ----------
// my_trade_invoices lists no holding invoice, so the send's held_invoice_id is
// kept per trade so Pay can open it again. Only the id and the pay week are
// kept; what it shows is read again from the server each time.
const KEEP_DAYS = 56;
const KEEP_MAX = 10;
export const heldKey = (userId) => 'held:' + String(userId || '');

export function addPointer(list, id, monday, at) {
  const rows = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.id !== id);
  return [{ id: String(id), monday: monday || '', at }, ...rows].slice(0, KEEP_MAX);
}

export function livePointers(list, nowMs) {
  return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.id === 'string' && p.id && Number.isFinite(p.at) && nowMs - p.at < KEEP_DAYS * 86400000);
}
