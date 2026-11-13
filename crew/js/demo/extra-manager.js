// Demo answers for the manager screens. See demo/server.js (registerDemo).
// Shapes follow ops-api: makesafe_board (trade projection), my_jobs (everyone),
// list_users, crew availability, and the booking writes.
import { registerDemo } from './server.js';
import { todayISO, addDays, mondayOf } from '../lib/dates.js';

const CLOSED = ['cancelled', 'archived', 'lost', 'deleted', 'complete', 'completed', 'invoiced', 'paid', 'closed', 'duplicate', 'duplicated', 'void', 'voided'];
const CREW_READY = ['order_confirmed', 'schedule_install', 'scheduled'];

registerDemo((db, h) => {
  const me = db.me;
  const today = todayISO();
  const staff = h.isOffice;
  const managed = me.managed_verticals || [];
  const hoursAgo = (n) => new Date(db.now().getTime() - n * 3600000).toISOString();

  // ---- a few more make safes and one fencing job waiting for a crew ----
  db.jobs.push(
    { id: 'j-balc', type: 'makesafe', status: 'new', job_number: 'SWMS-261352', client_name: 'Peter Havel', client_phone: '0411 202 303', site_address: '14 Amelia Street', site_suburb: 'Balcatta', notes: 'Fence panels down across the driveway after the storm.', metadata: { external_ref: 'MLB-40511', requesting_company_name: 'ML Builders' } },
    { id: 'j-elle', type: 'makesafe', status: 'new', job_number: 'SWMS-261347', client_name: 'Shreya Pillai', client_phone: '0422 404 505', site_address: '9 Brookmount Drive', site_suburb: 'Ellenbrook', notes: 'Ceiling water damage. Tarp the roof and check the manhole.', metadata: { external_ref: 'AJBR-71020', requesting_company_name: 'AJ Building & Restoration' } },
    { id: 'j-karr', type: 'makesafe', status: 'scheduled', job_number: 'SWMS-261344', client_name: 'Lou Ferraro', client_phone: '0433 606 707', site_address: '31 Davenport Road', site_suburb: 'Karrinyup', notes: 'Board up the broken sliding door.', metadata: { external_ref: 'MLB-40498', requesting_company_name: 'ML Builders' } },
    { id: 'j-dian', type: 'makesafe', status: 'archived', job_number: 'SWMS-261201', client_name: 'Helen Brandt', client_phone: '0444 808 909', site_address: '6 Waverley Street', site_suburb: 'Dianella', notes: '', metadata: { external_ref: 'MLB-40102', requesting_company_name: 'ML Builders' } },
    { id: 'j-ocea', type: 'fencing', status: 'scheduled', job_number: 'SWF-26811', client_name: 'Dee Marlow', client_phone: '0455 010 121', site_address: '27 Marina Boulevard', site_suburb: 'Ocean Reef', notes: '', scope_json: { job: { runs: [{ length: 24 }], sheetHeight: 1800, profile: 'Colorbond Trimclad', colour: 'Surfmist' } } }
  );
  const board = {
    'j-balc': { column: 'New', family: 'Make safe', type: 'Fence make safe', hours: 5 },
    'j-elle': { column: 'New', family: 'Roof report', type: 'Roof report', hours: 52 },
    'j-karr': { column: 'Allocated', family: 'Make safe', type: 'Board up', hours: 20 },
    'j-hill': { column: 'Allocated', family: 'Roof report', type: 'Roof report', hours: 30 },
    'j-morl': { column: 'Complete', family: 'Make safe', type: 'Storm make safe', hours: 70, report: { submitted_at: hoursAgo(18), photo_count: 6 } },
    'j-dian': { column: 'Archive', family: 'Make safe', type: 'Fence make safe', hours: 24 * 16, report: { submitted_at: hoursAgo(24 * 14), photo_count: 9 } }
  };

  // ---- the rest of the crew's week, so the team view has something to show ----
  const row = (jid, uid, date, start, extra = {}) => db.assignments.push({ id: db.id('a'), job_id: jid, user_id: uid, scheduled_date: date, start_time: start, status: 'confirmed', role: 'lead_installer', assignment_type: 'install', is_lead: false, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, job_phase: 'assigned', notes: '', ...extra });
  row('j-karr', 'u-jo', addDays(today, 1), '08:00');
  row('j-bays', 'u-israel', today, '07:00', { is_lead: true });
  row('j-bays', 'u-jo', today, '07:00');
  row('j-bays', 'u-israel', addDays(today, 1), '07:00', { is_lead: true });
  row('j-wemb', 'u-tendo', addDays(today, 2), '07:00');
  row('j-joon', 'u-israel', addDays(today, 5), '07:00');
  if (db.persona === 'office') {
    row('j-joon', 'u-tendo', today, '07:00', { is_lead: true });
    row('j-joon', 'u-tendo', addDays(today, 1), '07:00', { is_lead: true });
    row('j-morl', 'u-jo', addDays(today, -1), '13:00', { status: 'complete', clocked_on_at: db.at(addDays(today, -1), '13:05'), clocked_off_at: db.at(addDays(today, -1), '15:40'), hours_worked: 2.58 });
  }

  // ---- days off ----
  const off = (uid, date, status, note) => db.availability.push({ id: db.id('av'), user_id: uid, date, status, note: note || null, created_at: db.now().toISOString() });
  off('u-jo', addDays(today, 2), 'unavailable', 'Dentist');
  off('u-israel', addDays(today, 8), 'leave', 'Family trip');
  off('u-israel', addDays(today, 9), 'leave', 'Family trip');
  off('u-tendo', addDays(today, 3), 'unavailable', '');
  if (!staff) off(me.id, addDays(today, 12), 'leave', 'Long weekend away');

  const live = (a) => a.status !== 'cancelled';
  const light = (j) => { const { scope_json, ghl_contact_id, ...rest } = j; return rest; };
  const vertical = (j) => (j.type === 'makesafe' ? 'makesafe' : j.type);
  const mayAllocate = (j) => staff || managed.includes(vertical(j));
  const noAuth = (j) => h.fail(403, { error: `Not authorized to allocate ${vertical(j)} jobs` });
  const phoneHref = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? '+61' + d.replace(/^0/, '') : ''; };

  function boardRow(j, seesAll) {
    const meta = board[j.id] || { column: 'New', family: 'Make safe', type: 'Make safe', hours: 1 };
    const md = j.metadata || {};
    const tel = phoneHref(j.client_phone);
    const address = `${j.site_address}, ${j.site_suburb} WA`;
    const assignments = db.assignments.filter((a) => a.job_id === j.id && live(a) && (seesAll || a.user_id === me.id))
      .map((a) => ({ assignment_id: a.id, user_id: a.user_id, name: h.person(a.user_id).name, crew_name: h.person(a.user_id).name, status: a.status, scheduled_date: a.scheduled_date, start_time: a.start_time, arrived_at: a.arrived_at || null, started_at: a.started_at || null }));
    // The stage is the server's to decide. In this demo a new job that gains a crew moves to Allocated.
    const column = meta.column === 'New' && db.assignments.some((a) => a.job_id === j.id && live(a)) ? 'Allocated' : meta.column;
    return {
      contract_version: 'makesafe-board.v1.2', id: j.id, job_number: j.job_number, type: 'makesafe', makesafe_type: meta.type, ses_family: meta.family.toLowerCase().replace(/\s+/g, '_'), ses_family_label: meta.family,
      column, canonical_stage: column.toLowerCase(), projection_warning: null,
      builder: { name: md.requesting_company_name || null, external_ref: md.external_ref || null },
      contact: { client_name: j.client_name, phone: j.client_phone, address, actions: {
        call: tel ? { available: true, href: 'tel:' + tel } : { available: false, href: null, unavailable_reason: 'No phone number on the job' },
        text: tel ? { available: true, href: 'sms:' + tel } : { available: false, href: null, unavailable_reason: 'No phone number on the job' },
        navigate: { available: true, href: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(address) } } },
      assignments, report: meta.report || { submitted_at: null, photo_count: 0 },
      notes: db.notes.filter((n) => n.job_id === j.id).map((n) => ({ author: n.users.name, text: n.detail_json.text, created_at: n.created_at })),
      lineage: { builder_work_order_number: md.external_ref || null, builder_po_number: null },
      age: { age_hours: meta.hours, age_days: Math.floor(meta.hours / 24), created_at: hoursAgo(meta.hours) }
    };
  }

  return {
    // Same answer as the base demo, plus the jobs waiting for a crew that a manager is sent.
    my_jobs(p) {
      const weekEnd = addDays(mondayOf(today), 6);
      const all = p.mode === 'all' && (staff || managed.length > 0);
      const inView = (j) => staff || managed.includes(vertical(j));
      const rows = db.assignments.filter((a) => (all ? live(a) && inView(db.job(a.job_id)) : h.mine(a))).map((a) => (all ? { ...h.nest(a), org_id: db.org } : h.nest(a)));
      const sort = (l) => l.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || String(a.start_time).localeCompare(String(b.start_time)));
      const out = {
        today: sort(rows.filter((a) => a.scheduled_date === today)),
        thisWeek: sort(rows.filter((a) => a.scheduled_date > today && a.scheduled_date <= weekEnd)),
        upcoming: sort(rows.filter((a) => a.scheduled_date > weekEnd)),
        recent: sort(rows.filter((a) => a.scheduled_date < today && a.status !== 'complete')),
        recentCompleted: sort(rows.filter((a) => a.scheduled_date < today && a.status === 'complete')),
        unscheduled: []
      };
      if (!all) return out;
      const empty = (j) => !db.assignments.some((a) => a.job_id === j.id && live(a));
      const waiting = db.jobs.filter((j) => inView(j) && empty(j));
      out.unscheduled = waiting.filter((j) => j.type !== 'makesafe' && CREW_READY.includes(j.status))
        .map((j) => ({ id: `${j.type}-open-${j.id}`, user_id: null, status: 'available', role: '', assignment_type: j.type + '_open', scheduled_date: today, start_time: null, crew_name: null, jobs: light(j) }));
      out.makesafePool = waiting.filter((j) => j.type === 'makesafe' && (board[j.id] || {}).column === 'New')
        .map((j) => ({ id: `makesafe-open-${j.id}`, user_id: null, status: 'available', role: '', assignment_type: 'makesafe_open', scheduled_date: today, start_time: null, crew_name: null, jobs: light(j) }));
      out._adminView = true;
      return out;
    },

    makesafe_board(p) {
      if (p.projection !== 'trade') h.fail(403, { error: 'ops projection requires ops access' });
      const seesAll = staff || managed.includes('makesafe');
      const jobs = db.jobs.filter((j) => j.type === 'makesafe' && (seesAll || h.onJob(j.id)));
      const rows = jobs.map((j) => boardRow(j, seesAll));
      const columns = { New: [], Allocated: [], Complete: [], Archive: [] };
      rows.forEach((r) => columns[r.column].push(r));
      return {
        contract_version: 'makesafe-board.v1.2', projection: 'trade', generated_at: db.now().toISOString(), columns, rows,
        permissions: { visibility: seesAll ? 'all_makesafes' : 'allocated_only', sees_all_makesafes: seesAll, fencing_view_only: false, can_allocate: seesAll },
        unmapped_stage_job_ids: [], parity: { ok: true, contract_version: 'makesafe-board.v1.2' }
      };
    },

    list_users() {
      if (!staff && !(me.role === 'lead_installer' && managed.length)) h.fail(403, { error: 'An authorised operator session is required.', code: 'operator_access_required' });
      const users = [me, ...db.others].map((u) => ({ id: u.id, name: u.name, email: u.email || `${u.id.slice(2)}@example.test`, phone: u.phone || null, role: u.role, avatar_url: null }));
      return { users: users.sort((a, b) => a.name.localeCompare(b.name)) };
    },

    get_crew_availability(p) {
      const from = p.start_date || p.from || p.date || today;
      const to = p.end_date || p.to || addDays(from, 14);
      const rows = db.availability.filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 200);
      return { availability: rows.map((r) => { const u = h.person(r.user_id); return { ...r, user: { name: u.name, email: u.email || null, phone: u.phone || null } }; }) };
    },
    set_availability(p, b) {
      const uid = b.userId || b.user_id;
      if (!uid) h.fail(500, { error: 'userId required' });
      if (!Array.isArray(b.dates) || !b.dates.length) h.fail(500, { error: 'dates array required' });
      for (const d of b.dates) {
        const cur = db.availability.find((r) => r.user_id === uid && r.date === d.date);
        if (cur) Object.assign(cur, { status: d.status || 'available', note: d.note || null });
        else db.availability.push({ id: db.id('av'), user_id: uid, date: d.date, status: d.status || 'available', note: d.note || null, created_at: db.now().toISOString() });
      }
      return { success: true, updated: b.dates.length };
    },

    allocate_job(p, b) {
      const moveId = b.assignmentId || b.assignment_id || null;
      const source = moveId ? db.assignments.find((a) => a.id === moveId) : null;
      if (moveId && !source) h.fail(404, { error: 'assignment not found' });
      const jobId = source ? source.job_id : b.jobId || b.job_id;
      if (!jobId) h.fail(400, { error: 'jobId (new allocation) or assignmentId (reassignment) required' });
      const j = db.job(jobId);
      if (!j) h.fail(404, { error: 'job not found' });
      if (CLOSED.includes(j.status)) h.fail(409, { error: `cannot allocate a ${j.status} job` });
      if (!mayAllocate(j)) noAuth(j);
      const userId = b.userId || b.user_id || b.toUserId || b.to_user_id;
      if (!userId) h.fail(400, { error: 'target installer (userId) required' });
      if (userId !== me.id && !db.others.some((o) => o.id === userId)) h.fail(404, { error: 'target installer not found' });
      if (source) { source.user_id = userId; return { ok: true, mode: 'reassign', assignment: { ...source } }; }
      const date = b.scheduledDate || b.scheduled_date || b.date;
      if (!date) h.fail(400, { error: 'scheduledDate required for a new allocation' });
      const dup = db.assignments.find((a) => a.job_id === jobId && a.user_id === userId && a.scheduled_date === date && live(a));
      if (dup) return { ok: true, mode: 'idempotent', deduped: true, assignment: { id: dup.id, scheduled_date: dup.scheduled_date, user_id: dup.user_id, status: dup.status, assignment_type: dup.assignment_type } };
      const a = { id: db.id('a'), job_id: jobId, user_id: userId, scheduled_date: date, start_time: b.startTime || b.start_time || null, end_time: b.endTime || b.end_time || null, status: 'scheduled', role: 'lead_installer', assignment_type: 'install', is_lead: false, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, job_phase: 'assigned', notes: b.notes || '' };
      db.assignments.push(a);
      if (j.status === 'accepted') j.status = 'processing';
      return { ok: true, mode: 'create', assignment: { ...a } };
    },

    update_assignment(p, b) {
      const a = db.assignments.find((x) => x.id === (b.assignment_id || b.assignmentId || b.id));
      if (!a) h.fail(404, { error: 'Assignment not found' });
      const j = db.job(a.job_id);
      if (!mayAllocate(j)) h.fail(403, { error: 'Not authorized: you can only allocate jobs in a vertical you manage' });
      if (b.scheduled_date) a.scheduled_date = b.scheduled_date;
      if (b.start_time) a.start_time = b.start_time;
      if (b.end_time) a.end_time = b.end_time;
      return { assignment: { ...a }, all_complete: false, suggest_status: null, job_id: a.job_id };
    },

    delete_assignment(p, b) {
      const id = b.assignmentId || b.assignment_id || b.id;
      const a = db.assignments.find((x) => x.id === id);
      if (!a) h.fail(404, { error: 'Assignment not found' });
      if (!mayAllocate(db.job(a.job_id))) h.fail(403, { error: 'Not authorized: you can only allocate jobs in a vertical you manage' });
      if (a.invoiced_in) {
        const inv = db.invoices.find((i) => i.id === a.invoiced_in && !['draft', 'ops-reject'].includes(i.status));
        if (inv) h.fail(409, { error: `This crew member has already invoiced this job (${inv.invoice_number}). The office must adjust the invoice before the allocation can be removed.` });
      }
      db.assignments.splice(db.assignments.indexOf(a), 1);
      return { success: true };
    },

    set_job_lead(p, b) {
      const jobId = b.jobId || b.job_id;
      if (!jobId) h.fail(400, { error: 'jobId required' });
      const j = db.job(jobId);
      if (!j) h.fail(404, { error: 'job not found' });
      if (!mayAllocate(j)) h.fail(403, { error: 'Not authorized: you can only allocate jobs in a vertical you manage' });
      const rows = db.assignments.filter((a) => a.job_id === jobId && live(a));
      const clear = b.clear === true || b.is_lead === false;
      let target = null;
      if (!clear) {
        target = rows.find((a) => a.id === (b.assignmentId || b.assignment_id)) || rows.find((a) => a.user_id === (b.userId || b.user_id));
        if (!target) h.fail(409, { error: 'That person is not an active crew member on this job' });
      }
      db.assignments.forEach((a) => { if (a.job_id === jobId) a.is_lead = false; });
      if (target) target.is_lead = true;
      return { success: true, job_id: jobId, lead: target ? { assignment_id: target.id, user_id: target.user_id, name: h.person(target.user_id).name } : null };
    }
  };
});
