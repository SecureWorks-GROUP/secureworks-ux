// Demo answers for the pay screens. See demo/server.js (registerDemo).
// Invoices with office changes, receipts, the crew work order from first hours
// to invoiced share, work orders for the per-metre lead and crew lines to check.
import { registerDemo } from './server.js';
import { tile } from './db.js';
import { todayISO, addDays, mondayOf, hoursBetween } from '../lib/dates.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

registerDemo((db, h) => {
  const { fail, onJob, manages, person, money, round2 } = h;
  const me = db.me; const today = todayISO(); const mon = mondayOf(today);
  const staff = me.role === 'ops_manager' || me.role === 'admin';
  const lead = db.persona === 'lead';
  const nowIso = () => db.now().toISOString();
  const jobRef = (j) => ({ job_id: j.id, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb, job_type: j.type });

  // ------------------------------------------------------- older invoices
  if (!staff && db.persona !== 'new') {
    const w3 = addDays(mon, -21); const w4 = addDays(mon, -28); const w5 = addDays(mon, -35);
    const day = (wk, n, hrs, extra = {}) => ({ id: db.id('l'), line_date: addDays(wk, n), work_date: addDays(wk, n), start_time: '07:00', finish_time: hrs === 9 ? '16:30' : hrs === 11 ? '18:30' : '15:30', break_minutes: 30, job_number: n < 2 ? 'SWD-26088' : 'SWF-26168', client_name: n < 2 ? 'Marcus Lim' : 'Priya Nair', description: 'Labour', line_type: 'labour', total_hours: hrs, hourly_rate: 55, line_total_ex: hrs * 55, ...extra });
    db.invoices.push(
      { id: 'inv-adj', user_id: me.id, week_start: w3, week_end: addDays(w3, 6), invoice_number: 'SW-INV-ST-0401', status: 'paid', invoice_source: 'hourly', notes: 'Thursday ran late to finish the oiling.', ...money(1980, { gstOn: false }), total_hours: 36, xero_bill_id: 'xb-a', xero_bill_status: 'PAID',
        xero_adjustments: { total: -86.5, lines: [{ description: 'Fuel card, October', amount: -86.5, account_code: '449', kind: 'deduction' }] }, payable_after_xero: 1774.7, xero_pays: 1774.7,
        submitted_at: db.at(addDays(w3, 6), '16:20'), created_at: db.at(addDays(w3, 6), '16:20'), paid_at: db.at(addDays(w3, 11), '09:00'), amount_paid: 1774.7, lines: [0, 1, 2, 3].map((n) => day(w3, n, 9)) },
      { id: 'inv-back', user_id: me.id, week_start: w4, week_end: addDays(w4, 6), invoice_number: 'SW-INV-ST-0396', status: 'ops-reject', invoice_source: 'hourly', notes: '', ...money(1485, { gstOn: false }), total_hours: 27, xero_bill_id: null,
        office_note: 'Tuesday shows 11 hours at Wembley, but the clock had you off at 3pm. Fix the finish time and send it again.',
        submitted_at: db.at(addDays(w4, 6), '17:45'), created_at: db.at(addDays(w4, 6), '17:45'), paid_at: null,
        lines: [day(w4, 0, 8), day(w4, 1, 11, { office_review_status: 'rejected', office_review_note: 'Clocked off at 3pm that day.' }), day(w4, 2, 8)] },
      { id: 'inv-draft', user_id: me.id, week_start: w5, week_end: addDays(w5, 6), invoice_number: 'SW-INV-ST-0388', status: 'draft', invoice_source: 'hourly', notes: '', ...money(880, { gstOn: false }), total_hours: 16, xero_bill_id: null,
        submitted_at: null, created_at: db.at(addDays(w5, 5), '12:10'), paid_at: null, lines: [day(w5, 3, 8), day(w5, 4, 8)] }
    );
  }

  // ------------------------------------------------------------- receipts
  const jobsJoin = (id) => { const j = id && db.job(id); return j ? { client_name: j.client_name, job_number: j.job_number } : null; };
  if (!staff) {
    db.expenses.push(
      { id: 'ex-1', submitted_by: me.id, vendor_name: 'Bunnings Joondalup', receipt_date: addDays(today, -3), total_amount: 84.6, gst_amount: 7.69, status: 'approved', category: 'materials', payment_method: 'personal_card', flow: 'reimbursement', routed_to: 'shaun', job_id: 'j-joon', receipt_photo_url: tile('Bunnings receipt', 38), created_at: db.at(addDays(today, -3), '12:40') },
      { id: 'ex-2', submitted_by: me.id, vendor_name: 'Ampol Wangara', receipt_date: addDays(today, -8), total_amount: 96.4, gst_amount: 8.76, status: 'pushed_to_xero', category: 'fuel', payment_method: 'company_card', flow: 'company_expense', routed_to: 'jan', job_id: null, business_category: 'vehicle', receipt_photo_url: tile('Fuel receipt', 205), created_at: db.at(addDays(today, -8), '06:35') },
      { id: 'ex-3', submitted_by: me.id, vendor_name: 'Stratco Osborne Park', receipt_date: addDays(today, -1), total_amount: 42.9, gst_amount: 3.9, status: 'queried', query_reason: 'Which job were the brackets for? Duncraig or Kinross?', category: 'materials', payment_method: 'personal_card', flow: 'reimbursement', routed_to: 'jan', job_id: null, receipt_photo_url: tile('Stratco receipt', 150), created_at: db.at(addDays(today, -1), '14:15') },
      { id: 'ex-9', submitted_by: 'u-tendo', vendor_name: 'Total Tools Malaga', receipt_date: addDays(today, -2), total_amount: 219, gst_amount: 19.91, status: 'pending', category: 'tools', payment_method: 'personal_card', routed_to: 'jan', job_id: null, receipt_photo_url: tile('Not yours', 300), created_at: db.at(addDays(today, -2), '10:00') }
    );
  }
  const READS = [
    { vendor_name: 'Bunnings Joondalup', total_amount: 86.42, gst_amount: 7.86, line_items: [{ description: 'Rapid set concrete 20 kg', quantity: 6, unit_price: 8.98, total: 53.88 }, { description: 'Tek screws 12g, box of 50', quantity: 2, unit_price: 16.27, total: 32.54 }] },
    { vendor_name: 'Ampol Joondalup', total_amount: 104.15, gst_amount: 9.47, line_items: [{ description: 'Diesel 54.2 L', quantity: 1, unit_price: 104.15, total: 104.15 }] },
    { vendor_name: 'Stratco Joondalup', total_amount: 61.3, gst_amount: 5.57, line_items: [{ description: 'Post cap Monument', quantity: 10, unit_price: 6.13, total: 61.3 }] }
  ];
  let reads = 0;

  // ------------------------------------------------- crew lines on my jobs
  const crewLine = (id, uid, jid, date, start, finish, brk, rate, state = 'pending') => { const j = db.job(jid); const hrs = hoursBetween(start, finish, brk); return { line_id: id, user_id: uid, trade_name: person(uid).name, job_id: jid, job_number: j.job_number, division: j.type, total_hours: hrs, hourly_rate: rate, line_total_ex: round2(hrs * rate), acknowledgment_status: state, override_amount: null, override_note: null, line_date: date, work_date: date, start_time: start, finish_time: finish, break_minutes: brk, description: 'Labour', invoice_status: 'pending_acknowledgment' }; };
  db.crewCharges = staff ? [] : [
    crewLine('cc-1', 'u-tendo', 'j-joon', addDays(today, -1), '07:00', '15:30', 30, 45),
    crewLine('cc-2', 'u-jo', 'j-joon', addDays(today, -2), '07:00', '12:30', 0, 42),
    crewLine('cc-3', 'u-tendo', 'j-joon', addDays(today, -8), '07:00', '15:30', 30, 45, 'acknowledged')
  ];
  if (lead) {
    db.assignments.filter((a) => a.job_id === 'j-sper' && a.user_id === me.id).forEach((a) => { a.is_lead = true; });
    db.crewCharges.push(crewLine('cc-4', 'u-israel', 'j-sper', addDays(today, -4), '07:00', '13:30', 30, 45, 'acknowledged'));
  }
  const leads = (jobId) => db.assignments.some((a) => a.job_id === jobId && a.user_id === me.id && a.is_lead && a.status !== 'cancelled');

  // ----------------------------------------------------------- work orders
  const item = (description, quantity, unit, rate) => ({ description, quantity, unit, rate, total: round2(quantity * rate) });
  db.workOrders = lead ? [
    { id: 'wo-h1', wo_number: 'WO-26168-H', kind: 'crew', job_id: 'j-sper', status: 'complete', completed_at: db.at(addDays(today, -2), '15:00'), scope_items: [item('Strip and take away the old fence', 9.5, 'm', 14), item('Posts, plinths and sheets, 1800 high', 9.5, 'm', 46), item('Retaining to 300 mm', 4, 'm', 35), item('Load and tip run', 1, 'ea', 90)] },
    { id: 'wo-h2', wo_number: 'WO-26767-H', kind: 'crew', job_id: 'j-joon', status: 'accepted', completed_at: null, scope_items: [item('Strip old fence, rear and left', 39.4, 'm', 14), item('Posts, plinths and sheets, 1800 high', 45.6, 'm', 46), item('Retaining to 300 mm, left run', 6, 'm', 35), item('Hang gate and latch', 1, 'ea', 120)] },
    { id: 'wo-h3', wo_number: 'WO-25990-H', kind: 'crew', job_id: null, job: { job_number: 'SWF-25990', client_name: 'Lena Fox', site_suburb: 'Karrinyup', site_address: '8 Burroughs Road', type: 'fencing', status: 'complete' }, status: 'complete', completed_at: db.at(addDays(today, -16), '14:00'), already_invoiced: true, scope_items: [item('Posts, plinths and sheets, 1800 high', 27, 'm', 46), item('Strip and take away the old fence', 27, 'm', 14)] }
  ] : [];
  const woCard = (w) => {
    const j = w.job || db.job(w.job_id) || {};
    const subtotal = round2(w.scope_items.reduce((s, i) => s + i.total, 0));
    const done = w.status === 'complete' && Boolean(w.completed_at);
    const charges = w.already_invoiced || !w.job_id ? [] : db.crewCharges.filter((c) => c.job_id === w.job_id && c.acknowledgment_status === 'acknowledged' && !c.used).map((c) => { const amt = c.override_amount != null ? c.override_amount : c.line_total_ex; return { line_id: c.line_id, job_id: c.job_id, trade_name: c.trade_name, description: `${c.total_hours} h labour`, source_line_type: 'labour', quantity: c.total_hours, unit: 'hr', source_unit_rate: c.hourly_rate, source_amount_ex: c.line_total_ex, amount_ex: -amt, override_applied: c.override_amount != null, invoice_status: c.invoice_status }; });
    return { id: w.id, wo_number: w.wo_number, kind: w.kind, job_id: w.job_id, job_number: j.job_number, client_name: j.client_name, job_type: j.type, job_family: null, vertical: j.type, job_status: j.status, assigned_user_id: me.id, assigned_user_name: me.name, status: w.status, site_address: j.site_address, site_suburb: j.site_suburb, scheduled_date: null, completed_at: w.completed_at,
      scope_items: w.scope_items, subtotal, gst: round2(subtotal * 0.1), total: round2(subtotal * 1.1), negative_charges: charges, available_negative_charge_total_ex: round2(charges.reduce((s, c) => s + c.amount_ex, 0)),
      already_invoiced: Boolean(w.already_invoiced), invoice_block_reason: w.already_invoiced ? 'invoiced' : null, weekly_draft_id: null, can_add_to_weekly_invoice: done && !w.already_invoiced, can_invoice: done && !w.already_invoiced, can_invoice_direct: done && !w.already_invoiced,
      direct_invoice_block_reason: done ? null : w.completed_at ? 'work_order_not_complete' : 'work_order_not_complete', direct_invoice_block_message: done ? null : 'This work order cannot be invoiced on its own yet. Ask the office to mark it complete.' };
  };
  // What a trade who is not the assignee sees: the job's agreed work order, no money on it.
  const agreedCards = () => Object.entries(db.jobWorkOrders).filter(([jid]) => onJob(jid)).map(([jid, wo]) => { const j = db.job(jid); return { id: wo.id, wo_number: wo.wo_number, kind: 'job', job_id: jid, job_number: j.job_number, client_name: j.client_name, job_type: j.type, vertical: j.type, job_status: j.status, status: wo.status, site_address: j.site_address, site_suburb: j.site_suburb, scope_items: wo.scope_items.map((s) => ({ description: s.description, quantity: s.qty, unit: s.unit, hours: s.hours })), negative_charges: [], already_invoiced: false, invoice_block_reason: null, can_add_to_weekly_invoice: false, can_invoice: false, can_invoice_direct: false, direct_invoice_block_reason: null, direct_invoice_block_message: null }; });

  // ------------------------------------------------------ crew work orders
  const RATES = { 'u-sam': 55, 'u-henry': 60, 'u-israel': 58, 'u-jo': 48, 'u-tendo': 45 };
  const g0 = db.groups.find((g) => g.group_id === 'g-dunc');
  if (g0) Object.assign(g0, { _pot: 2400, _people: ['u-israel', me.id], _frozen: false, _submitted: null, _signoff: null, entries: [{ user_id: 'u-israel', work_date: addDays(today, -1), start_time: '07:00', finish_time: '15:00', break_minutes: 30, hours: 7.5 }] });
  if (!staff) db.groups.push({ group_id: 'g-kinr', ...jobRef(db.job('j-kinr')), pay_basis: 'all_in_12_v2', client_signed: false, _pot: 1900, _people: ['u-israel', 'u-jo'], _frozen: false, _submitted: null, _signoff: null, entries: [] });
  const groupFor = (b) => db.groups.find((g) => (b.group_id && g.group_id === b.group_id) || (b.job_id && g.job_id === b.job_id));
  const hoursOf = (g, uid) => round2(g.entries.filter((e) => e.user_id === uid).reduce((s, e) => s + e.hours, 0));
  const inCrew = (g) => g._people.includes(me.id);
  function split(g) {
    const weights = g._people.map((uid) => hoursOf(g, uid) * (RATES[uid] || 50));
    const sum = weights.reduce((s, w) => s + w, 0);
    if (!sum) return null;
    const cuts = weights.map((w) => Math.floor((g._pot * w / sum) * 100) / 100);
    const rest = round2(g._pot - cuts.reduce((s, c) => s + c, 0));
    cuts[cuts.indexOf(Math.max(...cuts))] = round2(Math.max(...cuts) + rest);
    const budget = cuts[g._people.indexOf(me.id)];
    const cashPay = round2(budget / 1.12);
    return { my_budget: budget, my_share: cashPay, my_cash_pay: cashPay, my_super: round2(budget - cashPay), budget_remainder: 0 };
  }
  function awaitingOf(g) {
    if (g._frozen) return 'frozen';
    if (!hoursOf(g, me.id)) return 'needs_hours';
    if (g._people.some((uid) => !hoursOf(g, uid))) return 'awaiting_others';
    return g.client_signed ? 'ready' : 'awaiting_signoff';
  }
  function shareOf(g) {
    const awaiting = awaitingOf(g); const s = awaiting === 'needs_hours' ? null : split(g);
    const out = { enabled: true, group_id: g.group_id, job_id: g.job_id, participant: true, discovery: { state: 'member' }, awaiting, needs_hours: awaiting === 'needs_hours', pot_total: awaiting === 'needs_hours' ? null : g._pot, my_share: null, client_signed: g.client_signed, client_not_happy: Boolean(g._signoff && g._signoff.happy === false), pay_basis: g.pay_basis, budget_includes_super: true, group_share_office_review_required: true,
      my_entries: g.entries.filter((e) => e.user_id === me.id).map(({ user_id, ...e }) => e) };
    if (g._frozen && s) Object.assign(out, s);
    else if (s) Object.assign(out, { projected_my_share: s.my_share, projected_my_budget: s.my_budget, projected_cash_pay: s.my_cash_pay, projected_super: s.my_super });
    return out;
  }
  function rowOf(g) {
    const { my_entries, ...share } = shareOf(g);
    const others = g._people.filter((uid) => uid !== me.id);
    const invoiced = (g._frozen ? others.length : 0) + (g._submitted ? 1 : 0);
    return { ...share, job_number: g.job_number, client_name: g.client_name, site_suburb: g.site_suburb, job_type: g.job_type, crew_approval_required: false, hours_office_approved: false,
      crew_hours: g._people.map((uid) => ({ name: person(uid).name, me: uid === me.id, hours: hoursOf(g, uid), approved: hoursOf(g, uid) > 0, approved_by_office: false })), my_hours_approved: hoursOf(g, me.id) > 0,
      client_signoff: g._signoff, ...(g._submitted ? { submitted: g._submitted } : {}),
      crew_status: g._frozen ? g._people.map((uid) => ({ name: person(uid).name, me: uid === me.id, state: uid === me.id ? (g._submitted ? 'submitted' : 'not_invoiced') : 'submitted' })) : [],
      release: { released: false, ready: false, signoff: g.client_signed, total: g._people.length, invoiced, approved: 0, hold: g._submitted ? ['The office checks every share before the crew is paid.'] : [] } };
  }
  const groupOff = () => { if (db.flags.groupOff) fail(409, { ok: false, code: 'group_work_order_disabled', error: 'Crew work orders are not switched on.' }); };
  const mustBeIn = (b) => { groupOff(); const g = groupFor(b); if (!g) fail(404, { ok: false, code: 'group_not_found', error: 'That crew work order could not be found.' }); if (!inCrew(g)) fail(403, { ok: false, code: 'group_not_participant', error: 'You are not part of this crew work order.' }); return g; };
  const hoursChanged = (g) => { if (g.client_signed) { g.client_signed = false; g._signoff = null; } };

  function invoiceShare(b) {
    const extras = b.extra_items || [];
    if (b.week_start || (b.manual_assignments || []).length || extras.length !== 1) fail(409, { ok: false, code: 'group_share_separate_invoice', userMessage: 'A crew share is sent on its own, not with other lines.' });
    if (typeof b.gst_on !== 'boolean') fail(422, { ok: false, code: 'GST_CHOICE_REQUIRED', userMessage: 'Say whether to add GST.' });
    const g = mustBeIn(extras[0]);
    if (!g._frozen) fail(409, { ok: false, code: 'group_split_not_frozen', userMessage: 'The shares are not locked in yet.' });
    if (g._submitted) fail(409, { ok: false, code: 'group_share_already_invoiced', userMessage: 'Your share for this job is already invoiced.' });
    const s = split(g); const gst = b.gst_on ? round2(s.my_share * 0.1) : 0;
    const m = { gst_on: b.gst_on, gross_earned: s.my_share, super_rate: 0.12, super_basis: 'employer_12_v2', super_amount: s.my_super, worker_withhold: 0, company_contribution: s.my_super, net_pay: s.my_share, amount_payable: s.my_share, gst, total_inc: round2(s.my_share + gst), trade_payable: round2(s.my_share + gst) };
    const n = db.invoices.length + 418;
    const inv = { id: db.id('inv'), user_id: me.id, week_start: null, week_end: null, invoice_number: 'SW-INV-' + me.name.split(' ').map((w) => w[0]).join('') + '-0' + n, status: 'pending_acknowledgment', invoice_source: 'hourly', notes: b.notes || '', ...m, xero_bill_id: null, submitted_at: nowIso(), created_at: nowIso(), paid_at: null,
      lines: [{ id: db.id('l'), line_date: today, job_number: g.job_number, client_name: g.client_name, site_suburb: g.site_suburb, description: `Crew share, ${hoursOf(g, me.id)} h`, line_type: 'group share', group_share_id: g.group_id + ':' + me.id, quantity: 1, unit: 'ea', unit_rate: s.my_share, line_total_ex: s.my_share, office_review_status: 'awaiting' }] };
    db.invoices.push(inv);
    g._submitted = { invoice_id: inv.id, invoice_number: inv.invoice_number, status: inv.status, review: 'awaiting' };
    return { ok: true, success: true, invoice_id: inv.id, invoice_number: inv.invoice_number, line_count: 1, ...m, office_review: 'held', code: 'lines_awaiting_office_review', xero_bill_id: null, group_release: { released: false, invoiced: g._people.length, total: g._people.length } };
  }
  // The weekly invoice door also takes a crew share sent on its own. Wrap it once the server is built.
  queueMicrotask(() => {
    const ops = window.__crewDemo && window.__crewDemo.ops; if (!ops) return;
    const weekly = ops.generate_trade_invoice;
    ops.generate_trade_invoice = (p, b) => ((b.extra_items || []).some((x) => /group.?share/i.test(x.type || '')) ? invoiceShare(b) : weekly(p, b));
  });

  return {
    // ---- money
    my_money() {
      const rows = db.invoices.map(({ lines, ...i }) => {
        const voided = ['VOIDED', 'DELETED'].includes(i.xero_bill_status); const counts = !['draft', 'failed', 'ops-reject'].includes(i.status) && !voided;
        const payable = i.payable_after_xero != null ? i.payable_after_xero : i.trade_payable; const paid = i.status === 'paid' ? (i.amount_paid != null ? i.amount_paid : payable) : 0;
        return { ...i, bucket: ((i.week_end || (i.created_at || '').slice(0, 10)) || '').slice(0, 7), counts, payable, paid, outstanding: counts ? round2(payable - paid) : 0, figures_ok: true };
      }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const add = (list, k) => round2(list.reduce((s, r) => s + (Number(r[k]) || 0), 0));
      const sum = (list) => ({ invoices: list.length, gross_earned: add(list, 'gross_earned'), super_amount: add(list, 'super_amount'), gst: add(list, 'gst'), payable: add(list, 'payable'), paid_total: add(list, 'paid'), outstanding: add(list, 'outstanding'), figures_incomplete: 0 });
      const counted = rows.filter((r) => r.counts); const ym = today.slice(0, 7);
      const fyYear = Number(today.slice(5, 7)) >= 7 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1; const fyStart = `${fyYear}-07-01`;
      const label = (b) => `${MON[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}`;
      const months = [...new Set(counted.map((r) => r.bucket))].sort().reverse().map((b) => ({ month: b, label: label(b), ...sum(counted.filter((r) => r.bucket === b)) }));
      return { today, fy_start: fyStart, fy_label: `FY ${fyYear}/${String(fyYear + 1).slice(2)}`, month: { month: ym, label: label(ym), ...sum(counted.filter((r) => r.bucket === ym)) }, fytd: sum(counted.filter((r) => r.bucket + '-01' >= fyStart)), all_time: sum(counted), months, invoices: rows,
        profile: { name: me.name, abn: me.trade_details.abn, gst_registered: me.trade_details.gstRegistered === true, invoice_type: me.invoice_type, xero_linked: true } };
    },

    // ---- receipts
    submit_expense(p, b) {
      if (!b.receipt_photo_url && !b.no_receipt_reason) fail(400, { error: 'A receipt photo or a reason for no receipt is required.' });
      const read = b.receipt_photo_url ? { ...READS[reads++ % READS.length], receipt_date: today } : null;
      const e = { id: db.id('ex'), submitted_by: me.id, status: 'pending', vendor_name: read ? read.vendor_name : null, receipt_date: read ? read.receipt_date : null, total_amount: read ? read.total_amount : null, gst_amount: read ? read.gst_amount : null, line_items: read ? read.line_items : [],
        job_id: b.job_id || null, po_id: b.po_id || null, receipt_photo_url: b.receipt_photo_url ? (window.__demoUploads && window.__demoUploads[b.receipt_photo_url]) || tile('Receipt', 40) : null, receipt_storage_path: b.receipt_storage_path || null, receipt_sha256: b.receipt_sha256 || null, no_receipt_reason: b.no_receipt_reason || null,
        routed_to: b.job_id ? 'shaun' : 'jan', flow: 'unknown', created_at: nowIso() };
      db.expenses.push(e);
      return { expense_id: e.id, extraction: read, status: e.status, routed_to: e.routed_to, flow: e.flow };
    },
    update_expense(p, b) {
      const e = db.expenses.find((x) => x.id === b.expense_id); if (!e) fail(404, { error: 'Expense not found' });
      if (e.submitted_by !== me.id && !staff) fail(403, { error: 'Only the person who sent this receipt can change it.' });
      if (e.status === 'pushed_to_xero') fail(409, { error: 'This receipt is already with the bookkeeper and cannot be changed.' });
      const fields = ['vendor_name', 'receipt_date', 'total_amount', 'gst_amount', 'line_items', 'job_id', 'flow', 'category', 'payment_method', 'business_category', 'gst_status', 'no_receipt_reason', 'jarvis_job_suggestion', 'field_confidence'].filter((k) => k in b);
      fields.forEach((k) => { e[k] = b[k]; });
      if (b.payment_method) e.flow = { supplier_invoice: 'supplier_bill', company_card: 'company_expense', cash: 'company_expense', personal_card: 'reimbursement' }[b.payment_method] || 'unknown';
      return { success: true, expense_id: e.id, updated_fields: fields };
    },
    suggest_job_for_expense() {
      const seen = new Set(); const out = [];
      const push = (jid, score, reason) => { if (seen.has(jid) || out.length >= 5) return; seen.add(jid); const j = db.job(jid); out.push({ job_id: j.id, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb, score, reason }); };
      const mineRows = db.assignments.filter((a) => a.user_id === me.id && a.status !== 'cancelled');
      mineRows.filter((a) => a.clocked_on_at && !a.clocked_off_at).forEach((a) => push(a.job_id, 0.95, 'You are clocked on there'));
      mineRows.filter((a) => a.scheduled_date === today).forEach((a) => push(a.job_id, 0.8, 'You are booked there today'));
      mineRows.filter((a) => a.scheduled_date < today && a.scheduled_date >= addDays(today, -6)).sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).forEach((a) => push(a.job_id, 0.5, 'You were there this week'));
      return { suggestions: out, fallback: { label: 'General business (no job)', score: 0.3 }, generated_at: nowIso() };
    },
    list_expenses(p) {
      let rows = db.expenses.filter((e) => (!p.job_id || e.job_id === p.job_id) && (!p.status || e.status === p.status));
      rows = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, Number(p.limit) || 50);
      return { expenses: rows.map((e) => ({ ...e, jobs: jobsJoin(e.job_id) })) };
    },

    // ---- work orders
    my_work_orders() {
      const cards = [...db.workOrders.map(woCard), ...(lead ? [] : agreedCards())];
      return { schema: 'trade-work-orders.v1', mode: 'mine', work_orders: cards, total: cards.length, offset: 0, page_size: 30, truncated: false, next_offset: null };
    },
    submit_work_order_invoice(p, b) {
      const w = db.workOrders.find((x) => x.id === b.work_order_id);
      if (!w) { if (Object.values(db.jobWorkOrders).some((x) => x.id === b.work_order_id)) fail(409, { ok: false, code: 'job_work_order_not_crew_invoice', error: 'That is the work order for the whole job. It is not invoiced on its own.' }); fail(404, { ok: false, error: 'Work order not found' }); }
      if (typeof b.gst_on !== 'boolean') fail(422, { ok: false, code: 'GST_CHOICE_REQUIRED', userMessage: 'Say whether to add GST.' });
      const card = woCard(w);
      if (card.already_invoiced) fail(409, { ok: false, error: 'This work order is already invoiced.' });
      if (!card.can_invoice_direct) fail(409, { ok: false, code: 'work_order_not_complete', error: card.direct_invoice_block_message });
      const ids = b.negative_charge_line_ids || b.charge_line_ids || [];
      const picked = ids.map((id) => card.negative_charges.find((c) => c.line_id === id));
      if (picked.some((c) => !c)) fail(422, { ok: false, error: 'One of the crew amounts you picked has changed. Open the work order again.' });
      const takeOff = round2(picked.reduce((s, c) => s + Math.abs(c.amount_ex), 0)); const gross = round2(card.subtotal - takeOff);
      if (!(gross > 0)) fail(422, { ok: false, error: 'The crew amounts take this work order to zero. Check them with the office.' });
      const m = money(gross, { gstOn: b.gst_on }); const n = db.invoices.length + 418;
      const inv = { id: db.id('inv'), user_id: me.id, week_start: null, week_end: null, invoice_number: 'SW-INV-' + me.name.split(' ').map((x) => x[0]).join('') + '-0' + n, status: 'pushed_to_xero', invoice_source: 'work_order', work_order_id: w.id, notes: '', ...m, xero_bill_id: 'xb-' + n, submitted_at: nowIso(), created_at: nowIso(), paid_at: null,
        lines: [{ id: db.id('l'), line_date: today, job_number: card.job_number, client_name: card.client_name, site_suburb: card.site_suburb, description: `Work order ${card.wo_number}`, line_type: 'work order', quantity: 1, unit: 'ea', unit_rate: card.subtotal, line_total_ex: card.subtotal },
          ...picked.map((c) => ({ id: db.id('l'), line_date: today, job_number: card.job_number, client_name: card.client_name, site_suburb: card.site_suburb, description: `${c.trade_name}, ${c.description}`, line_type: 'crew_work_order_deduction', quantity: 1, unit: 'ea', unit_rate: c.amount_ex, line_total_ex: c.amount_ex }))] };
      db.invoices.push(inv); w.already_invoiced = true;
      ids.forEach((id) => { const c = db.crewCharges.find((x) => x.line_id === id); if (c) c.used = true; });
      return { ok: true, success: true, invoice_id: inv.id, invoice_number: inv.invoice_number, xero_bill_id: inv.xero_bill_id, xero_bill_number: inv.invoice_number, total: m.total_inc, ...m, negative_charge_total_ex: takeOff, pdf_attached: false };
    },
    crew_charges_on_my_jobs(p) {
      const from = p.week_start || '';
      return { charges: db.crewCharges.filter((c) => leads(c.job_id) && c.user_id !== me.id && (!from || c.line_date >= from)).map(({ user_id, used, ...c }) => c) };
    },
    review_crew_charge(p, b) {
      const c = db.crewCharges.find((x) => x.line_id === b.line_id); if (!c) fail(404, { error: 'That line could not be found.' });
      if (!leads(c.job_id) && !staff) fail(403, { error: 'Only the lead on that job can check this line.' });
      if (c.used) fail(409, { error: 'That line is already taken off an invoice, so it cannot be changed.' });
      if (b.action === 'approve') Object.assign(c, { acknowledgment_status: 'acknowledged', override_amount: null, override_note: null });
      else if (b.action === 'adjust') { if (!(Number(b.override_amount) >= 0)) fail(400, { error: 'Give the amount to approve.' }); Object.assign(c, { acknowledgment_status: 'acknowledged', override_amount: round2(Number(b.override_amount)), override_note: b.note || null }); }
      else if (b.action === 'reject') { if (!String(b.note || '').trim()) fail(400, { error: 'Say what is not right.' }); Object.assign(c, { acknowledgment_status: 'queried', override_note: b.note }); }
      else fail(400, { error: 'Unknown action' });
      return { success: true };
    },

    // ---- crew work orders
    my_group_work_orders() {
      if (db.flags.groupOff) return { enabled: false, group_job_ids: [], groups: [], payable_routes: [] };
      const mineGroups = db.groups.filter(inCrew);
      const jobIds = [...new Set(db.assignments.filter((a) => a.user_id === me.id && a.status !== 'cancelled').map((a) => a.job_id))];
      return { enabled: true, group_job_ids: mineGroups.map((g) => g.job_id), groups: mineGroups.map(rowOf),
        payable_routes: jobIds.map((jid) => { const g = db.groups.find((x) => x.job_id === jid); const patio = db.job(jid).type === 'patio'; return g ? { job_id: jid, route: 'group', group_id: g.group_id, discovery: { state: inCrew(g) ? 'member' : 'join' } } : patio ? { job_id: jid, route: 'group_setup_required', group_id: null, setup_reason: 'group_missing', discovery: { state: 'create' } } : { job_id: jid, route: 'hours', group_id: null }; }) };
    },
    group_work_order_my_share(p, b) {
      if (db.flags.groupOff) return { enabled: false };
      const g = groupFor(b); const j = db.job(b.job_id || (g && g.job_id));
      if (g && inCrew(g)) return shareOf(g);
      if (!j) fail(404, { ok: false, code: 'group_job_not_found', error: 'That job could not be found.' });
      const on = onJob(j.id);
      if (g) return { enabled: true, job_id: j.id, group_id: g.group_id, participant: false, discovery: on ? { state: 'join', reason: 'not_participant', message: 'The crew work order for this job is open. Join it to add your hours.' } : { state: 'not_assigned', reason: 'not_assigned', message: 'You are not booked on this job. If you worked on it, add yourself to the job first.' } };
      if (j.type !== 'patio') return { enabled: true, job_id: j.id, group_id: null, participant: false, discovery: { state: 'hours', reason: 'not_group_job', message: 'This job is paid by the hour. Bill it on your weekly invoice.' } };
      return { enabled: true, job_id: j.id, group_id: null, participant: false, discovery: on ? { state: 'create', reason: 'group_missing', message: 'This job is paid as a crew. Nobody has started the crew work order yet, so you can.' } : { state: 'not_assigned', reason: 'not_assigned', message: 'You are not booked on this job. If you worked on it, add yourself to the job first.' } };
    },
    create_group_work_order(p, b) {
      groupOff();
      const j = db.job(b.job_id); if (!b.job_id) fail(400, { ok: false, code: 'group_job_required', error: 'Pick the job first.' }); if (!j) fail(404, { ok: false, code: 'group_job_not_found', error: 'That job could not be found.' });
      if (!onJob(j.id)) fail(403, { ok: false, code: 'group_work_order_not_assigned', error: 'You need to be booked on this job to start its crew work order.' });
      if (db.groups.some((g) => g.job_id === j.id)) fail(409, { ok: false, code: 'group_work_order_exists', error: 'This job already has a crew work order. Join it.' });
      const people = [...new Set([me.id, ...db.assignments.filter((a) => a.job_id === j.id && a.status !== 'cancelled').map((a) => a.user_id)])];
      const g = { group_id: db.id('g'), ...jobRef(j), pay_basis: 'all_in_12_v2', client_signed: false, _pot: 1900, _people: people, _frozen: false, _submitted: null, _signoff: null, entries: [] };
      db.groups.push(g);
      return { ok: true, group_id: g.group_id, job_id: j.id, status: 'open', client_signed: false };
    },
    join_group_work_order(p, b) {
      groupOff();
      const g = groupFor(b); if (!g) fail(404, { ok: false, code: 'group_not_found', error: 'That crew work order could not be found.' });
      if (g._frozen) fail(409, { ok: false, code: 'group_split_frozen', error: 'The shares are already locked in for this job. Call the office.' });
      if (!onJob(g.job_id)) fail(403, { ok: false, code: 'group_work_order_not_assigned', error: 'You need to be booked on this job to join its crew work order.' });
      if (!inCrew(g)) g._people.push(me.id);
      return { ok: true, group_id: g.group_id, job_id: g.job_id, status: 'open', client_signed: g.client_signed };
    },
    submit_group_work_order_hours(p, b) {
      const g = mustBeIn(b);
      if (g._frozen) fail(409, { ok: false, code: 'group_split_frozen', error: 'The shares are locked in, so hours can no longer change.' });
      if (!b.work_date || !b.start_time || !b.finish_time) fail(422, { ok: false, code: 'time_entry_required', error: 'Give the day, a start time and a finish time.' });
      if (b.work_date > today) fail(422, { ok: false, code: 'time_entry_future', error: 'That day has not happened yet.' });
      const hours = hoursBetween(b.start_time, b.finish_time, b.break_minutes || 0);
      if (isNaN(hours)) fail(422, { ok: false, code: 'time_entry_invalid', error: 'The finish time must be after the start time.' });
      g.entries = g.entries.filter((e) => !(e.user_id === me.id && e.work_date === b.work_date));
      g.entries.push({ user_id: me.id, work_date: b.work_date, start_time: b.start_time, finish_time: b.finish_time, break_minutes: b.break_minutes || 0, hours });
      hoursChanged(g);
      return shareOf(g);
    },
    delete_group_work_order_hours(p, b) {
      const g = mustBeIn(b);
      if (g._frozen) fail(409, { ok: false, code: 'group_split_frozen', error: 'The shares are locked in, so hours can no longer change.' });
      g.entries = g.entries.filter((e) => !(e.user_id === me.id && e.work_date === b.work_date));
      hoursChanged(g);
      return shareOf(g);
    },
    capture_group_client_signoff(p, b) {
      const g = mustBeIn(b);
      if (!String(b.signer_name || '').trim()) fail(422, { ok: false, error: 'The customer name is needed.' });
      if (!/^data:image\/(png|jpeg)/.test(b.signature_png || '')) fail(422, { ok: false, error: 'The signature did not come through. Ask the customer to sign again.' });
      if (!b.capture_id) fail(422, { ok: false, error: 'capture_id required' });
      if (b.happy === false && !String(b.outstanding_items || '').trim()) fail(422, { ok: false, error: 'List what needs fixing.' });
      g._signoff = { kind: 'on_site', name: b.signer_name, at: nowIso(), happy: b.happy !== false };
      g.client_signed = b.happy !== false;
      return { ok: true, client_signed: g.client_signed, happy: b.happy !== false, capture_id: b.capture_id };
    },
    freeze_group_work_order(p, b) {
      const g = mustBeIn(b);
      if (g._frozen) return shareOf(g);
      if (awaitingOf(g) !== 'ready') fail(409, { ok: false, code: 'group_not_ready', error: 'Not everything is in yet. Hours and the customer signature come first.' });
      g._frozen = true;
      return shareOf(g);
    }
  };
});
