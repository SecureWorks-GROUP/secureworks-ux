// Demo server: answers the app's requests from made-up data, in the browser.
// It follows the real server's request and response shapes closely enough that
// every screen runs unchanged. Extra screens register their own handlers
// through `registerDemo` (see demo/extra-*.js).
import { ApiError } from '../lib/api.js';
import { todayISO, addDays, mondayOf, hoursBetween, tsToDate } from '../lib/dates.js';
import { createDb, PEOPLE, tile } from './db.js';

export function demoProfile(persona) { return PEOPLE[persona] || PEOPLE.crew; }

const extra = [];
/** registerDemo((db, helpers) => ({ action_name: (params, body) => result })) */
export function registerDemo(factory) { extra.push(factory); }

export function fail(status, body) { throw new ApiError(body.userMessage || body.error || 'Refused', { status, code: body.code || '', body }); }
const round2 = (n) => Math.round(n * 100) / 100;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createDemoServer(persona) {
  const db = createDb(persona);
  const me = db.me;
  const isOffice = me.role === 'ops_manager' || me.role === 'admin';
  const live = (a) => a.status !== 'cancelled';
  const mine = (a) => a.user_id === me.id && live(a);
  const onJob = (jobId) => db.assignments.some((a) => a.job_id === jobId && mine(a));
  const person = (uid) => (uid === me.id ? me : db.others.find((o) => o.id === uid) || { id: uid, name: 'Crew' });
  const manages = (job) => isOffice || (me.managed_verticals || []).includes(job.type);
  const nest = (a) => { const j = db.job(a.job_id); const { scope_json, ghl_contact_id, ...light } = j; return { ...a, user: { id: a.user_id, name: person(a.user_id).name }, jobs: light }; };
  const need = (jobId) => { const j = db.job(jobId); if (!j) fail(404, { error: 'Job not found', code: 'job_not_found' }); if (!onJob(jobId) && !manages(j)) fail(500, { error: 'You are not assigned to this job' }); return j; };
  const loggedFor = (a) => db.logged.find((l) => l.assignment_id === a.id) || null;

  function money(gross, { gstOn, commission = 0 }) {
    const base = Math.max(0, gross - commission);
    const super_amount = round2(base * 0.12); const worker_withhold = round2(base * 0.06);
    const net_pay = round2(gross - worker_withhold); const gst = gstOn ? round2(gross * 0.1) : 0;
    return { gst_on: Boolean(gstOn), gross_earned: round2(gross), super_rate: 0.12, super_amount, worker_withhold, company_contribution: round2(super_amount - worker_withhold), net_pay, amount_payable: net_pay, gst, total_inc: round2(gross + gst), trade_payable: round2(net_pay + gst) };
  }
  function modeOf(job) {
    if (db.groups.some((g) => g.job_id === job.id)) return 'group_work_order';
    if (me.invoice_type === 'per_metre') return 'work_order';
    if (job.type === 'patio') return 'group_work_order';
    if (job.type === 'fencing') return 'work_order';
    return 'hourly';
  }
  function modeRow(job) {
    const mode = modeOf(job); const wo = db.jobWorkOrders[job.id];
    return { job_id: job.id, invoice_mode: mode, invoice_mode_reason: mode === 'hourly' ? 'other_job' : mode === 'work_order' ? 'fencing_job' : 'patio_job', can_claim_commission: manages(job), work_order_agreed_ex: mode === 'work_order' && wo && wo.agreed_labour_ex ? wo.agreed_labour_ex : null, job_work_order_id: wo ? wo.id : null };
  }
  const liveInvoice = (monday) => db.invoices.find((i) => i.week_start === monday && !['draft', 'ops-reject'].includes(i.status));

  const ops = {
    my_jobs(p) {
      const today = todayISO(); const weekEnd = addDays(mondayOf(today), 6);
      const all = p.mode === 'all' && (isOffice || (me.managed_verticals || []).length);
      const rows = db.assignments.filter((a) => (all ? live(a) && (isOffice || (me.managed_verticals || []).includes(db.job(a.job_id).type)) : mine(a))).map(nest);
      const sort = (l) => l.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || String(a.start_time).localeCompare(String(b.start_time)));
      return {
        today: sort(rows.filter((a) => a.scheduled_date === today)),
        thisWeek: sort(rows.filter((a) => a.scheduled_date > today && a.scheduled_date <= weekEnd)),
        upcoming: sort(rows.filter((a) => a.scheduled_date > weekEnd)),
        recent: sort(rows.filter((a) => a.scheduled_date < today && a.status !== 'complete')),
        recentCompleted: sort(rows.filter((a) => a.scheduled_date < today && a.status === 'complete')),
        unscheduled: [], ...(all ? { _adminView: true } : {})
      };
    },
    search_all_jobs(p) {
      const q = String(p.q || '').toLowerCase().replace(/[-\s]/g, '');
      const hit = (j) => !q || [j.job_number, j.client_name, j.site_suburb, j.site_address, (j.metadata || {}).external_ref].some((v) => String(v || '').toLowerCase().replace(/[-\s]/g, '').includes(q));
      const jobs = db.jobs.filter((j) => hit(j) && (db.flags.companyView || onJob(j.id) || manages(j))).map((j) => {
        const assigned = onJob(j.id);
        const row = { id: j.id, type: j.type, status: j.status, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb, site_address: j.site_address, assigned_to_me: assigned, external_ref: (j.metadata || {}).external_ref };
        if (assigned) row.client_phone = j.client_phone;
        return row;
      });
      return { jobs, lens: 'company', total: jobs.length, page_size: 200, offset: 0, truncated: false, next_offset: null };
    },
    trade_job_detail(p) {
      const j = db.job(p.jobId);
      if (!j) fail(404, { error: 'Job not found', code: 'job_not_found' });
      const assigned = onJob(j.id); const mgr = manages(j);
      if (!assigned && !mgr && !db.flags.companyView) fail(500, { error: 'You are not assigned to this job' });
      const view = !assigned && !mgr;
      const job = { ...j };
      if (view) { delete job.client_phone; delete job.client_email; delete job.ghl_contact_id; }
      const crew = db.assignments.filter((a) => a.job_id === j.id && live(a)).map((a) => {
        const pr = person(a.user_id);
        const row = { id: a.id, user_id: a.user_id, name: pr.name, status: a.status, is_lead: a.is_lead, scheduled_date: a.scheduled_date, start_time: a.start_time };
        return view ? row : { ...row, users: { name: pr.name, phone: pr.phone || null }, clocked_on_at: a.clocked_on_at, clocked_off_at: a.clocked_off_at, started_at: a.started_at, hours_worked: a.hours_worked, break_minutes: a.break_minutes, job_phase: a.job_phase };
      });
      const lead = crew.find((c) => c.is_lead);
      const packs = db.quotePacks[j.id] || [];
      return {
        job, access_tier: mgr ? (isOffice ? 'office' : 'division_manager') : assigned ? 'allocated' : 'company_view', quote_visible: mgr, job_family: null, vertical: j.type,
        documents: db.documents.filter((d) => d.job_id === j.id), media: db.media.filter((m) => m.job_id === j.id), notes: db.notes.filter((n) => n.job_id === j.id),
        serviceReport: view ? null : (db.reports || {})[j.id] || null, serviceReports: [], workOrder: null, workOrders: [], crew, leadInstaller: lead ? { assignment_id: lead.id, user_id: lead.user_id, name: lead.name } : null,
        purchaseOrders: db.purchaseOrders.filter((po) => po.job_id === j.id), makesafe_details: j.type === 'makesafe' ? { external_ref: (j.metadata || {}).external_ref, requesting_company_name: (j.metadata || {}).requesting_company_name, report_type: j.id === 'j-hill' ? 'roof_report' : null, substatus: 'allocated' } : null,
        quote_packs: packs, quote_extracts: packs.length ? [{ action: 'trade_quote_extract', quote_number: packs[0].quote_number, job_document_id: 'doc-' + j.id }] : [], crew_scope_of_works: null,
        scopeSummary: j.notes || '', completion_evidence: j.type === 'fencing' ? { applies: true, signoffs_required: 1, waived: false } : null
      };
    },
    my_job_work_order(p) {
      const j = db.job(p.job_id); if (!j) fail(404, { error: 'Job not found' });
      const wo = db.jobWorkOrders[j.id] || null;
      return { schema: 'trade-job-work-order.v1', job_id: j.id, work_order: wo ? { ...wo, agreed_labour_ex: undefined } : null, reason: wo ? null : 'no_approved_work_order', can_report_variation: onJob(j.id), my_variations: [] };
    },
    clock_event(p, b) {
      const a = db.assignments.find((x) => x.id === b.assignment_id);
      if (!a) fail(404, { error: 'Assignment not found' });
      if (a.user_id !== me.id) fail(500, { error: 'Not your assignment' });
      const now = db.now().toISOString();
      if (b.event === 'clock_on') Object.assign(a, { clocked_on_at: now, arrived_at: now, status: 'in_progress', job_phase: 'working', started_at: a.started_at || now, clocked_off_at: null });
      else if (b.event === 'clock_off') {
        const mins = (Date.parse(now) - Date.parse(a.clocked_on_at || a.started_at || now)) / 60000 - (b.break_minutes || 0);
        Object.assign(a, { clocked_off_at: now, status: 'complete', job_phase: 'complete', completed_at: a.completed_at || now, break_minutes: b.break_minutes || 0, hours_worked: round2(Math.max(0, mins / 60)) });
      } else if (!['pause', 'resume', 'arrived', 'start_travel', 'materials_check', 'manual_override'].includes(b.event)) fail(400, { error: 'Invalid event: ' + b.event });
      return { success: true, assignment: { ...a }, event_id: null, net_hours: a.hours_worked };
    },
    log_my_job_hours(p, b) {
      const jobId = b.jobId || b.job_id; need(jobId);
      const a = db.assignments.find((x) => x.id === (b.assignmentId || b.assignment_id)) || db.assignments.find((x) => x.job_id === jobId && mine(x) && x.scheduled_date === b.work_date);
      if (!a) fail(409, { ok: false, error: 'No booking found for that day.' });
      const hours = b.start_time ? hoursBetween(b.start_time, b.finish_time, b.break_minutes || 0) : Number(b.hours);
      Object.assign(a, { hours_worked: hours, status: 'complete' });
      db.logged = db.logged.filter((l) => l.assignment_id !== a.id);
      if (b.start_time) db.logged.push({ assignment_id: a.id, user_id: me.id, work_date: b.work_date, start_time: b.start_time, finish_time: b.finish_time, break_minutes: b.break_minutes || 0, hours });
      return { ok: true, hours, assignment: { id: a.id, status: a.status, scheduled_date: a.scheduled_date } };
    },
    update_my_assignment(p, b) {
      const a = db.assignments.find((x) => x.id === b.assignmentId); if (!a || a.user_id !== me.id) fail(500, { error: 'Not your assignment' });
      if (!['confirmed', 'in_progress', 'complete', 'submitted'].includes(b.status)) fail(500, { error: 'Invalid status' });
      a.status = b.status; return { assignment: { ...a } };
    },
    update_job_phase(p, b) {
      const a = db.assignments.find((x) => x.id === b.assignmentId); if (!a || a.user_id !== me.id) fail(500, { error: 'Not your assignment' });
      a.job_phase = b.phase; if (b.phase === 'travelling' && a.status === 'scheduled') a.status = 'confirmed';
      return { assignment: { ...a }, changed: true };
    },
    add_note(p, b) {
      need(b.jobId);
      const n = { id: db.id('n'), job_id: b.jobId, event_type: b.eventType || 'note', created_at: db.now().toISOString(), users: { name: me.name }, detail_json: { text: b.text } };
      db.notes.push(n); return { success: true, event: n };
    },
    get_upload_url(p, b) {
      if (b.jobId) need(b.jobId);
      const key = 'demo-upload-' + db.id('f');
      return { uploadUrl: key, token: 'demo', path: key, publicUrl: key, bucket: 'job-photos', purpose: b.purpose || 'job_media' };
    },
    confirm_upload(p, b) {
      need(b.jobId);
      const url = (window.__demoUploads && window.__demoUploads[b.path]) || tile(b.label || 'Photo', Math.floor(Math.random() * 360));
      const m = { id: db.id('m'), job_id: b.jobId, type: 'photo', phase: b.phase || 'completion', label: b.label || '', storage_url: url, po_id: b.po_id || null, created_at: db.now().toISOString() };
      db.media.push(m); return { id: m.id, url, attendance_cycle_id: null };
    },
    create_trade_alert(p, b) { need(b.jobId || b.job_id); return { success: true }; },
    create_variation(p, b) {
      if (!onJob(b.job_id)) fail(403, { error: 'You need to be on this job to request a variation.', code: 'variation_requires_assignment' });
      return { success: true, auto_approved: false, variation_number: 1, message: 'Variation sent to the office for approval.' };
    },
    self_book_job(p, b) {
      if (!db.flags.selfBooking) fail(409, { ok: false, code: 'self_booking_disabled', error: 'Booking yourself ahead is not switched on yet.' });
      const j = db.job(b.job_id); if (!j) fail(404, { ok: false, code: 'self_allocate_job_not_found', error: 'That job could not be found.' });
      if (['complete', 'completed', 'invoiced', 'archived', 'cancelled', 'lost', 'draft', 'quoted'].includes(j.status)) fail(409, { ok: false, code: 'self_book_job_not_open', error: 'That job is not open for booking.' });
      const bookings = (b.dates || [b.work_date]).map((d) => {
        const ex = db.assignments.find((a) => a.job_id === j.id && a.user_id === me.id && a.scheduled_date === d);
        if (ex && live(ex)) return { work_date: d, mode: 'existing', assignment: ex };
        if (ex) { ex.status = 'confirmed'; return { work_date: d, mode: 'revived', assignment: ex }; }
        const a = { id: db.id('a'), job_id: j.id, user_id: me.id, scheduled_date: d, start_time: null, status: 'confirmed', role: 'lead_installer', assignment_type: 'install', is_lead: false, self_made: true, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, notes: 'Added themselves in the app' };
        db.assignments.push(a); return { work_date: d, mode: 'created', assignment: a };
      });
      return { ok: true, bookings };
    },
    self_allocate_for_invoice(p, b) {
      const d = b.work_date || b.scheduled_date;
      if (d > todayISO()) fail(400, { ok: false, code: 'self_allocate_future_date', error: 'You can only add yourself for a day you have already worked (today or earlier).' });
      const j = db.job(b.job_id || b.jobId); if (!j) fail(404, { ok: false, code: 'self_allocate_job_not_found', error: 'That job could not be found.' });
      const ex = db.assignments.find((a) => a.job_id === j.id && mine(a) && a.scheduled_date === d);
      if (ex) return { ok: true, mode: 'existing', assignment: ex };
      const a = { id: db.id('a'), job_id: j.id, user_id: me.id, scheduled_date: d, start_time: null, status: 'confirmed', role: 'lead_installer', assignment_type: 'install', is_lead: false, self_made: true, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, notes: 'Added themselves from their invoice' };
      db.assignments.push(a); return { ok: true, mode: 'created', assignment: a };
    },
    self_unbook_job(p, b) {
      const a = db.assignments.find((x) => x.id === b.assignment_id && x.user_id === me.id);
      if (!a) fail(404, { ok: false, code: 'self_unbook_not_found', error: 'That booking could not be found.' });
      if (!a.self_made) fail(403, { ok: false, code: 'self_unbook_not_self_made', error: 'The office booked you on this day. Ask them to change it.' });
      if (a.clocked_on_at) fail(409, { ok: false, code: 'self_unbook_started', error: 'You have already clocked on for that day.' });
      a.status = 'cancelled'; return { ok: true };
    },

    // ---------------------------------------------------------------- pay
    my_hours(p) {
      const sunday = p.week_ending || addDays(mondayOf(todayISO()), 6); const monday = addDays(sunday, -6);
      const groupJobIds = new Set(db.groups.map((g) => g.job_id));
      const rows = db.assignments.filter((a) => mine(a) && a.scheduled_date >= monday && a.scheduled_date <= sunday && !(a.invoiced_in && db.invoices.some((i) => i.id === a.invoiced_in && !['draft', 'ops-reject'].includes(i.status))));
      const cards = []; const groupRoute = new Map();
      for (const a of rows) {
        const j = db.job(a.job_id);
        if (groupJobIds.has(j.id) || (j.type === 'patio' && me.invoice_type !== 'per_metre')) {
          const g = db.groups.find((x) => x.job_id === j.id);
          const cur = groupRoute.get(j.id) || { job_id: j.id, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb, booked_dates: [], route: g ? 'group' : 'group_setup_required', group_id: g ? g.group_id : null, setup_reason: g ? null : 'group_missing', discovery: { state: g ? 'member' : 'create' }, next_step: g ? 'Add your hours on the crew work order for this job.' : 'This job is paid as a crew. Start the crew work order to add your hours.' };
          cur.booked_dates.push(a.scheduled_date); groupRoute.set(j.id, cur); continue;
        }
        const m = modeRow(j); const hours = a.hours_worked != null ? a.hours_worked : 0;
        cards.push({ id: a.id, scheduled_date: a.scheduled_date, start_time: a.start_time, status: a.status, role: a.role, assignment_type: a.assignment_type, started_at: a.started_at, completed_at: a.completed_at, hours_worked: a.hours_worked, break_minutes: a.break_minutes, clocked_on_at: a.clocked_on_at, clocked_off_at: a.clocked_off_at, invoiced_in: a.invoiced_in || null,
          jobs: { id: j.id, type: j.type, job_number: j.job_number, client_name: j.client_name, site_address: j.site_address, site_suburb: j.site_suburb }, hours, amount: round2(hours * db.rate), logged_time_entry: loggedFor(a), previous_entry: null,
          invoice_mode: m.invoice_mode, invoice_mode_reason: m.invoice_mode_reason, can_claim_commission: m.can_claim_commission, work_order_agreed_ex: m.work_order_agreed_ex, job_work_order_id: m.job_work_order_id });
      }
      const total_hours = round2(cards.reduce((s, c) => s + c.hours, 0)); const subtotal = round2(total_hours * db.rate);
      return { assignments: cards, rate: db.rate, rate_resolved: db.rate > 0, is_per_metre: me.invoice_type === 'per_metre', week_ending: sunday, week_start: monday, total_hours, subtotal, ...money(subtotal, { gstOn: me.trade_details.gstRegistered === true }),
        already_submitted: Boolean(liveInvoice(monday)), running_invoice_draft: true, group_route_jobs: [...groupRoute.values()], ...(db.flags.rateEditable ? { trade_rate_editable: true } : {}) };
    },
    trade_invoice_job_modes(p) { const ids = String(p.job_ids || '').split(',').filter(Boolean); return { ok: true, jobs: ids.map((i) => db.job(i)).filter(Boolean).map(modeRow), not_found: ids.filter((i) => !db.job(i)) }; },
    my_trade_invoices() { return { invoices: [...db.invoices].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(({ lines, ...row }) => ({ ...row, week_ending: row.week_end, paid: row.status === 'paid' })) }; },
    get_trade_invoice(p) { const inv = db.invoices.find((i) => i.id === p.invoice_id); if (!inv) fail(404, { error: 'Invoice not found' }); return { invoice: { ...inv } }; },
    generate_trade_invoice(p, b) {
      if (typeof b.gst_on !== 'boolean') fail(422, { ok: false, code: 'GST_CHOICE_REQUIRED', userMessage: 'Say whether to add GST.' });
      const monday = b.week_start;
      const held = liveInvoice(monday);
      if (held) fail(409, { ok: false, success: false, saved: false, code: 'WEEK_ALREADY_INVOICED', already_submitted: true, invoice_id: held.id, invoice_number: held.invoice_number, userMessage: 'You already have an invoice for that week.' });
      const lines = []; let gross = 0; let commission = 0; let hoursTotal = 0; let heldLine = false;
      for (const m of b.manual_assignments || []) {
        const a = db.assignments.find((x) => x.id === m.assignment_id && x.user_id === me.id);
        if (!a) fail(422, { ok: false, userMessage: 'One of your job cards could not be found. Reload and try again.' });
        if (!m.work_date || !m.start_time || !m.finish_time) fail(422, { ok: false, success: false, saved: false, code: 'time_entry_required', userMessage: 'Every line of hours needs the date you worked, a start time and a finish time.' });
        const hrs = hoursBetween(m.start_time, m.finish_time, m.break_minutes || 0);
        const typed = db.flags.rateEditable && m.rate_source === 'client_entered' && m.rate > 0;
        const rate = typed ? m.rate : db.rate;
        if (!(rate > 0)) fail(422, { ok: false, code: 'RATE_NOT_CONFIGURED', userMessage: 'No pay rate is set for you yet.' });
        if (typed && rate > db.rate) heldLine = true;
        const j = db.job(a.job_id);
        lines.push({ id: db.id('l'), line_date: m.work_date, work_date: m.work_date, start_time: m.start_time, finish_time: m.finish_time, break_minutes: m.break_minutes || 0, job_number: j.job_number, client_name: j.client_name, description: m.description || 'Labour', line_type: 'labour', total_hours: hrs, hourly_rate: rate, line_total_ex: round2(hrs * rate), office_review_status: typed && rate > db.rate ? 'awaiting' : null });
        gross += hrs * rate; hoursTotal += hrs;
      }
      const notBooked = (b.extra_items || []).filter((x) => x.job_id && !onJob(x.job_id) && !manages(db.job(x.job_id) || {}));
      if (notBooked.length) fail(403, { ok: false, code: 'extra_job_not_allowed', jobs: notBooked.map((x) => x.job_number), error: 'You are not booked on one of these jobs.' });
      for (const x of b.extra_items || []) {
        const amt = round2(Number(x.quantity) * Number(x.rate));
        if (String(x.type).toLowerCase() === 'commission') commission += amt;
        if (x.unit === 'hr') hoursTotal += Number(x.quantity);
        lines.push({ id: db.id('l'), line_date: x.date, work_date: x.work_date || null, start_time: x.start_time || null, finish_time: x.finish_time || null, break_minutes: x.break_minutes || null, job_number: x.job_number, client_name: x.client_name, description: x.description, line_type: String(x.type).toLowerCase(), quantity: x.quantity, unit: x.unit, unit_rate: x.rate, total_hours: x.unit === 'hr' ? x.quantity : null, hourly_rate: x.unit === 'hr' ? x.rate : null, line_total_ex: amt, office_review_status: 'awaiting' });
        gross += amt; if (String(x.type).toLowerCase() !== 'work order' || true) heldLine = heldLine || ['travel', 'materials', 'equipment', 'other'].includes(String(x.type).toLowerCase());
      }
      if (!lines.length) fail(400, { ok: false, userMessage: 'Nothing to invoice yet.' });
      const m = money(round2(gross), { gstOn: b.gst_on, commission });
      const n = db.invoices.length + 418;
      const inv = { id: db.id('inv'), user_id: me.id, week_start: monday, week_end: addDays(monday, 6), invoice_number: 'SW-INV-' + me.name.split(' ').map((w) => w[0]).join('') + '-0' + n, status: heldLine ? 'pending_acknowledgment' : 'pushed_to_xero', invoice_source: 'hourly', notes: b.notes || '', ...m, total_hours: round2(hoursTotal), xero_bill_id: heldLine ? null : 'xb-' + n, submitted_at: db.now().toISOString(), created_at: db.now().toISOString(), paid_at: null, lines };
      db.invoices.push(inv);
      (b.manual_assignments || []).forEach((x) => { const a = db.assignments.find((y) => y.id === x.assignment_id); if (a) a.invoiced_in = inv.id; });
      return { ok: true, success: true, invoice_id: inv.id, invoice_number: inv.invoice_number, total_hours: inv.total_hours, line_count: lines.length, ...m, ...(heldLine ? { office_review: 'held', code: 'lines_awaiting_office_review', xero_bill_id: null } : { xero_bill_id: inv.xero_bill_id, xero_bill_number: inv.invoice_number }), pending_ops_review: false };
    },
    delete_trade_invoice(p, b) { db.invoices = db.invoices.filter((i) => !(i.id === b.invoice_id && i.status === 'draft')); return { success: true }; },
    my_money() {
      const rows = db.invoices.map(({ lines, ...i }) => ({ ...i, bucket: (i.week_end || '').slice(0, 7), counts: !['draft', 'ops-reject'].includes(i.status), payable: i.trade_payable, paid: i.status === 'paid' ? i.trade_payable : 0, outstanding: i.status === 'paid' ? 0 : i.trade_payable, figures_ok: true }));
      const sum = (list) => ({ invoices: list.length, gross_earned: round2(list.reduce((s, r) => s + r.gross_earned, 0)), super_amount: round2(list.reduce((s, r) => s + r.super_amount, 0)), gst: round2(list.reduce((s, r) => s + r.gst, 0)), payable: round2(list.reduce((s, r) => s + r.payable, 0)), paid_total: round2(list.reduce((s, r) => s + r.paid, 0)), outstanding: round2(list.reduce((s, r) => s + r.outstanding, 0)), figures_incomplete: false });
      const counted = rows.filter((r) => r.counts); const today = todayISO(); const ym = today.slice(0, 7);
      const fyStart = (Number(today.slice(5, 7)) >= 7 ? today.slice(0, 4) : String(Number(today.slice(0, 4)) - 1)) + '-07-01';
      const months = [...new Set(counted.map((r) => r.bucket))].sort().reverse().map((b) => ({ month: b, label: b, ...sum(counted.filter((r) => r.bucket === b)) }));
      return { today, fy_start: fyStart, fy_label: `FY ${fyStart.slice(0, 4)}-${String(Number(fyStart.slice(2, 4)) + 1)}`, month: { month: ym, label: ym, ...sum(counted.filter((r) => r.bucket === ym)) }, fytd: sum(counted.filter((r) => r.week_end >= fyStart)), all_time: sum(counted), months, invoices: rows, profile: { name: me.name, abn: me.trade_details.abn, gst_registered: me.trade_details.gstRegistered === true, invoice_type: me.invoice_type, xero_linked: true } };
    },
    my_group_work_orders() { return { enabled: true, group_job_ids: db.groups.map((g) => g.job_id), groups: db.groups.map(({ entries, ...g }) => g), payable_routes: [] }; },
    my_work_orders() { return { schema: 'trade-work-orders.v1', mode: 'mine', work_orders: [], total: 0, offset: 0, page_size: 30, truncated: false, next_offset: null }; },
    update_trade_profile(p, b) { me.trade_details = { ...me.trade_details, ...b }; if (b.abn) me.abn = b.abn; return { profile: { ...me } }; }
  };
  const ghl = {
    get_profile() { return { profile: me }; },
    send_sms() { return { success: true }; },
    get_conversation() { return { messages: [] }; }
  };
  const helpers = { fail, need, onJob, manages, mine, live, person, nest, money, round2, isOffice };
  for (const factory of extra) Object.assign(ops, factory(db, helpers));

  const handler = async (kind, action, params, body) => {
    await wait(140 + Math.random() * 220);
    if (kind === 'ops-text') return `<!doctype html><meta charset="utf-8"><body style="font:16px/1.5 system-ui;padding:24px;color:#223"><h2>Quote (no prices)</h2><p>The customer's quote, with every price left out.</p><ul>${((db.quotePacks[params.jobId] || [])[0] || { quote_lines: [] }).quote_lines.map((l) => `<li>${l.description} (${l.quantity} ${l.unit})</li>`).join('')}</ul></body>`;
    const table = kind === 'ghl' ? ghl : ops;
    const fn = table[action];
    if (!fn) fail(403, { error: 'An authorised operator session is required.', code: 'operator_access_required' });
    const out = fn(params || {}, body || {});
    return JSON.parse(JSON.stringify(out === undefined ? null : out));
  };
  handler.db = db;
  handler.register = (more) => Object.assign(ops, more(db, helpers));
  window.__crewDemo = { db, ops };
  return handler;
}
