// Demo answers for the reports screens (finish a job, make safe report, roof
// report, service report). See demo/server.js (registerDemo). Shapes follow
// ops-api: same field names in, same field names out, same refusals.
import { registerDemo } from './server.js';
import { todayISO, addDays, mondayOf } from '../lib/dates.js';

const CLOSED = ['cancelled', 'archived', 'lost', 'deleted', 'complete', 'completed', 'invoiced', 'paid', 'closed'];
const NOT_PACK_PHOTO = ['receipt', 'signature', 'voice_note', 'neighbour_signoff', 'quote_builder'];
const CHECKLIST = {
  fencing: ['All posts plumb and concreted', 'Rails level and securely fastened', 'Sheets fixed with no gaps or rattling', 'Gates swing freely and latch correctly', 'Exposed cuts and edges capped or trimmed', 'Site cleaned: offcuts, packaging, concrete removed', 'Client walkthrough completed'],
  patio: ['All posts plumb and footings backfilled', 'Beams and rafters secured, no loose bolts', 'Roof sheets fixed and sealed (no visible gaps)', 'Gutters and downpipes connected and draining', 'Flashings installed and sealed to house wall', 'All steelwork touched up, no scratches or chips', 'Site cleaned: offcuts, packaging, concrete removed', 'Client walkthrough completed']
};
const ROOF_SECTIONS = [
  { key: 'inspection', title: 'Inspection Details' }, { key: 'property', title: 'Property Details' }, { key: 'findings', title: 'Roof Findings' },
  { key: 'maintenance', title: 'Maintenance' }, { key: 'summary', title: 'Summary' }, { key: 'photos', title: 'Photo Evidence' }
];
const ROOF_FIELDS = [
  { key: 'inspection_date', label: 'Date of inspection', type: 'date', section: 'inspection', required: true },
  { key: 'inspection_time', label: 'Time of inspection', type: 'time', section: 'inspection' },
  { key: 'inspected_by', label: 'Inspected by', type: 'text', section: 'inspection', required: true, placeholder: 'Trade / inspector name' },
  { key: 'weather', label: 'Weather at time of inspection', type: 'select', section: 'inspection', options: ['Sunny / Fine', 'Overcast', 'Light rain', 'Heavy rain', 'Windy'] },
  { key: 'construction_type', label: 'Construction type', type: 'select', section: 'property', options: ['Double Brick', 'Brick Veneer', 'Stone', 'Render', 'Weatherboard', 'Other'] },
  { key: 'storeys', label: 'Number of storeys', type: 'select', section: 'property', required: true, options: ['Single Storey', 'Double Storey'], pricingDriver: true, help: 'Sets the report fee: Single Storey $275 inc GST, Double Storey $385 inc GST. Access or scope beyond a plain double storey is scaled manually at release.' },
  { key: 'property_condition', label: 'Property condition', type: 'select', section: 'property', options: ['Good', 'Fair', 'Poor'] },
  { key: 'roof_type', label: 'Roof type', type: 'select', section: 'property', options: ['Terracotta Tiles', 'Concrete Tiles', 'Colorbond', 'Zincalume', 'Asbestos', 'Other'] },
  { key: 'roof_pitch', label: 'Roof pitch', type: 'text', section: 'property', placeholder: 'e.g. 22.5 degrees' },
  { key: 'roof_profile_correct', label: 'Roof profile correct', type: 'toggle', section: 'property' },
  { key: 'gutters_serviceable', label: 'Gutters, valleys and downpipes serviceable', type: 'toggle', section: 'property' },
  { key: 'gutters_notes', label: 'Gutters, valleys and downpipes: comments', type: 'textarea', section: 'property', placeholder: 'What you saw: blockages, rust, sagging, missing sections, downpipes disconnected.' },
  { key: 'roof_condition', label: 'Roof condition', type: 'select', section: 'property', options: ['Good', 'Fair', 'Poor'] },
  { key: 'services_penetrations', label: 'Services / penetrations present on roof', type: 'text', section: 'property', placeholder: 'e.g. solar, hot water, whirlybirds, aerials' },
  { key: 'storm_openings', label: 'Storm-created openings in the roof', type: 'toggle', section: 'findings' },
  { key: 'storm_openings_notes', label: 'Storm-created openings: details', type: 'textarea', section: 'findings', placeholder: 'Where, how big, what was done to make it safe.' },
  { key: 'water_leak', label: 'Water leak through the roof', type: 'toggle', section: 'findings' },
  { key: 'leak_cause', label: 'Cause of water leak', type: 'text', section: 'findings', placeholder: 'Only if a leak was found' },
  { key: 'overall_findings', label: 'Roof condition and findings', type: 'textarea', section: 'findings', placeholder: 'What was inspected and the condition observed.' },
  { key: 'maintenance_issues', label: 'Maintenance issues present', type: 'textarea', section: 'maintenance', placeholder: 'None found and/or remaining, or describe the issues.' },
  { key: 'maintenance_recommendation', label: 'Maintenance recommended and/or required', type: 'select', section: 'maintenance', options: ['N/a', 'Recommended', 'Required'], help: 'Recommended: works that would improve the roof but are not driven by the claim event. Required: works needed to make the roof serviceable.' },
  { key: 'maintenance_details', label: 'Details of recommended / required maintenance', type: 'textarea', section: 'maintenance' },
  { key: 'scope_summary', label: 'Scope of inspection', type: 'textarea', section: 'summary', placeholder: 'What the inspection covered.' },
  { key: 'photos', label: 'Photo evidence', type: 'photos', section: 'photos', help: 'Attach roof photos. Each photo can carry a label / caption.' }
];

registerDemo((db, h) => {
  const { fail, need, onJob, manages, isOffice, round2 } = h;
  const me = db.me;
  const nowIso = () => db.now().toISOString();
  db.reports = db.reports || {};      // job_service_reports: the current report for each job
  db.reportHistory = {};              // earlier visits' reports on a make safe
  db.roofDrafts = {};
  db.neighbourWaivers = {};

  // What makesafe_job_details carries beyond the few fields the base job read
  // sends. Kept on the job row, which the base read passes through whole.
  for (const j of db.jobs.filter((x) => x.type === 'makesafe')) {
    j.makesafe_details = { attendance_cycle_id: `cyc-${j.id}-1`, cycle_number: 1, reattend_count: 0, last_reattend_reason: null, report_sent_at: null, report_received_at: null, portal_verified_at: null, portal_verified_cycle: null, portal_captures: [], roof_report_draft_status: null, completion_handoff: 'physical', builder_portal_url: null };
  }
  const hill = db.job('j-hill');
  if (hill) {
    hill.metadata = { ...hill.metadata, makesafe_job_family: 'roof_report', external_links: [
      { label: 'Company logo', kind: 'builder_portal', url: 'https://documents.example.test/branding/logo.png' },
      { label: 'Roof report', kind: 'roof_report', url: 'https://builder.example.test/share/roof/8f3k2l' },
      { label: 'Site photos', kind: 'photos', url: 'https://builder.example.test/share/photos/8f3k2l' },
      { label: 'Open in browser', kind: 'builder_portal', url: 'https://x.awstrack.me/L0/https:%2F%2Fbuilder.example.test%2Fshare%2Froof%2F8f3k2l/1/abc' },
      { label: 'Work order email', kind: 'source_email', url: 'https://mail.example.test/message/991' }
    ] };
    Object.assign(hill.makesafe_details, { makesafe_job_family: 'roof_report', completion_handoff: 'builder_portal', builder_portal_url: 'https://builder.example.test/share/roof/8f3k2l' });
  }
  // The server stamps every make safe photo with the visit it belongs to.
  const stamp = (m) => { const j = db.job(m.job_id); if (j && j.makesafe_details && !m.attendance_cycle_id) { m.attendance_cycle_id = j.makesafe_details.attendance_cycle_id; m.cycle_attribution = 'bound'; } return m; };
  db.media.forEach(stamp);
  const push = db.media.push.bind(db.media);
  db.media.push = (...rows) => push(...rows.map(stamp));

  const msJob = (jobId) => { if (!jobId) fail(400, { error: 'job_id required' }); const j = need(jobId); if (j.type !== 'makesafe') fail(500, { error: 'MakeSafe job required' }); return j; };
  const visitPhotos = (j) => db.media.filter((m) => m.job_id === j.id && (!m.type || m.type === 'photo') && !NOT_PACK_PHOTO.includes(m.phase) && m.attendance_cycle_id === j.makesafe_details.attendance_cycle_id);
  const family = (j) => String((j.makesafe_details && j.makesafe_details.makesafe_job_family) || (j.metadata || {}).makesafe_job_family || '').toLowerCase();
  const reportRow = (j, patch, existing) => ({
    id: existing ? existing.id : db.id('rep'), job_id: j.id, submitted_by: me.id, checklist_json: {}, notes: null, signature_data: null, signature_name: null, status: 'draft', submitted_at: null,
    created_at: existing ? existing.created_at : nowIso(), updated_at: nowIso(), weather: null, start_time: null, end_time: null, variations: null,
    cycle_number: j.makesafe_details ? j.makesafe_details.cycle_number : 1, attendance_cycle_id: j.makesafe_details ? j.makesafe_details.attendance_cycle_id : null, cycle_attribution: 'bound', ...(existing || {}), ...patch, updated_at: nowIso()
  });

  return {
    // ------------------------------------------------------ finishing a job
    complete_my_job(p, b) {
      const jobId = b.jobId || b.job_id; if (!jobId) fail(400, { error: 'jobId required' });
      const j = need(jobId);
      if (!onJob(jobId) && !manages(j)) fail(500, { error: 'You are not assigned to this job' });
      const fencing = j.type === 'fencing';
      const shown = db.media.filter((m) => m.job_id === jobId && m.phase === 'neighbour_signoff').length;
      const waived = Boolean(db.neighbourWaivers[jobId]);
      const photos = db.media.filter((m) => m.job_id === jobId && m.phase === 'completion').length;
      const evidence = fencing ? { applies: true, signoffs_required: 1, signoffs_on_file: shown, waived, completion_photos: photos, satisfied: photos > 0 && (waived || shown >= 1) } : { applies: false };
      if (fencing && !evidence.satisfied) fail(422, { error: photos ? 'This fencing job cannot be marked complete yet: it needs the neighbour sign-off on file, or a waiver with a reason.' : 'This fencing job cannot be marked complete yet: it needs completion photos on file.' });
      if (!['in_progress', 'scheduled', 'processing', 'accepted'].includes(j.status)) fail(500, { error: `Cannot complete a job with status "${j.status}"` });
      j.status = 'complete';
      const now = nowIso();
      db.assignments.filter((a) => a.job_id === jobId && a.status !== 'cancelled' && a.status !== 'complete').forEach((a) => Object.assign(a, { status: 'complete', job_phase: 'complete', completed_at: a.completed_at || now, clocked_off_at: a.clocked_on_at && !a.clocked_off_at ? now : a.clocked_off_at }));
      const mine = db.assignments.filter((a) => a.job_id === jobId && a.user_id === me.id && a.status !== 'cancelled').sort((x, y) => String(y.scheduled_date).localeCompare(String(x.scheduled_date)));
      const withHours = mine.find((a) => a.hours_worked != null) || mine[0] || null;
      const wo = db.jobWorkOrders[jobId];
      const perMetre = me.invoice_type === 'per_metre';
      const today = todayISO();
      const signature = db.media.find((m) => m.job_id === jobId && m.phase === 'signature' && (!b.signature_media_id || m.id === b.signature_media_id));
      const signed = String(b.signatureName || '').trim();
      return {
        success: true, job: { id: j.id, status: j.status }, completion_evidence: evidence,
        invoice_queue: { lane: perMetre ? 'weekly_work_order' : 'hours', work_orders: perMetre && wo ? [{ id: wo.id, wo_number: wo.wo_number, completed_at: now, business_date: today, week_end: addDays(mondayOf(today), 6), priced: true, already_complete: false }] : [], hours_logged: withHours && withHours.hours_worked != null ? Number(withHours.hours_worked) : null, assignment_id: withHours ? withHours.id : null },
        client_signoff: !signed ? { recorded: false, reason: 'no_signed_name' } : !signature ? { recorded: false, reason: 'no_signature' } : { recorded: true, signoff_id: db.id('so'), counts: true }
      };
    },
    waive_neighbour_signoff(p, b) {
      const jobId = b.jobId || b.job_id; if (!jobId) fail(400, { error: 'jobId required' });
      need(jobId);
      const reason = String(b.reason || '').replace(/\s+/g, ' ').trim();
      if (reason.length < 3) fail(400, { error: 'Give a reason for the waiver (at least a few words).' });
      db.neighbourWaivers[jobId] = { reason, by: me.id, at: nowIso() };
      return { ok: true, event_id: db.id('ev'), completion_evidence: { applies: true, signoffs_required: 1, waived: true, satisfied: true } };
    },

    // ----------------------------------------------------- make safe report
    submit_makesafe_report(p, b) {
      const j = msJob(b.job_id || b.jobId);
      const d = j.makesafe_details;
      const status = String(b.status || 'submitted').trim().toLowerCase();
      if (!['draft', 'submitted'].includes(status)) fail(400, { error: 'MakeSafe report status must be draft or submitted' });
      const final = status !== 'draft';
      if (final && CLOSED.includes(j.status)) fail(409, { error: `cannot submit a final MakeSafe report for a ${j.status} job` });
      const existing = db.reports[j.id] || null;
      if (existing && existing.status === 'approved') fail(500, { error: 'Report already approved' });
      if (!final && existing && existing.status === 'submitted') fail(409, { error: 'A submitted MakeSafe report cannot be downgraded to draft' });
      if (final && existing && existing.status === 'submitted') fail(500, { error: 'Report already submitted' });
      if (final) { const n = visitPhotos(j).length; if (n < 5) fail(400, { error: `MakeSafe report needs at least 5${d.reattend_count ? ' current-visit' : ''} photos (found ${n})` }); }
      const report = reportRow(j, {
        checklist_json: { arrival_time: b.arrival_time || '', damage_description: b.damage_description || '', job_type: b.job_type || '', job_type_detail: b.job_type_detail || b.makesafe_type_detail || '', makesafe_type_detail: b.makesafe_type_detail || b.job_type_detail || '', damage_cause: b.damage_cause || '', work_done: b.work_done || '', materials_used: b.materials_used || [], labour_hours: b.labour_hours || 0, trade_count: b.trade_count || 1, access_issues: b.access_issues || '', follow_up_required: b.follow_up_required || false, invoice_notes: b.invoice_notes || '' },
        notes: b.work_done || null, status, submitted_by: me.id, submitted_at: final ? nowIso() : null,
        ...(b.start_time !== undefined ? { start_time: b.start_time || null } : {}), ...(b.end_time !== undefined ? { end_time: b.end_time || null } : {})
      }, existing);
      db.reports[j.id] = report;
      if (!final) return { ok: true, report, board_sync: null, event_sync: null, warnings: [] };
      const cancelled = [];
      db.assignments.filter((a) => a.job_id === j.id && a.user_id !== me.id && a.status !== 'cancelled' && !a.invoiced_in).forEach((a) => { a.status = 'cancelled'; cancelled.push({ assignment_id: a.id, user_id: a.user_id }); });
      Object.assign(d, { substatus: 'admin_to_send_report', report_received_at: nowIso() });
      return { ok: true, report, board_sync: { ok: true, substatus: 'admin_to_send_report', report_received_at: d.report_received_at, auto_assignment: null, allocation_override: { cancelled, blocked: [] } }, event_sync: { ok: true }, warnings: [] };
    },
    unlock_makesafe_report(p, b) {
      const j = msJob(b.job_id || b.jobId);
      const r = db.reports[j.id];
      if (!r) fail(404, { error: 'No report on this visit to unlock' });
      if (r.status === 'approved') fail(409, { error: 'This report has been approved and can no longer be unlocked.' });
      if (r.status === 'draft') return { ok: true, already: true, report_id: r.id, substatus: 'waiting_on_trade_report' };
      if (j.makesafe_details.report_sent_at) fail(409, { error: 'The office has already sent this report to the builder, so it can no longer be changed here.' });
      if (r.submitted_by !== me.id && !manages(j)) fail(403, { error: 'Only the trade who submitted this report, or the office, can unlock it' });
      Object.assign(r, { status: 'draft', submitted_at: null, updated_at: nowIso() });
      Object.assign(j.makesafe_details, { substatus: 'waiting_on_trade_report', report_received_at: null });
      return { ok: true, report_id: r.id, substatus: 'waiting_on_trade_report' };
    },
    reattend_makesafe(p, b) {
      const j = msJob(b.job_id || b.jobId);
      const reason = String(b.reason || '').trim();
      if (!reason) fail(400, { error: 'reason required (why the job is being re-attended)' });
      if (CLOSED.includes(j.status) && j.status !== 'complete') fail(409, { error: `cannot re-attend a ${j.status} make-safe` });
      const r = db.reports[j.id];
      if (!r || !['submitted', 'approved'].includes(r.status)) fail(409, { error: 'this job has no submitted report to re-attend (allocate it normally instead)' });
      const d = j.makesafe_details;
      (db.reportHistory[j.id] = db.reportHistory[j.id] || []).unshift(r);
      db.reports[j.id] = null;
      Object.assign(d, { cycle_number: d.cycle_number + 1, reattend_count: d.reattend_count + 1, attendance_cycle_id: `cyc-${j.id}-${d.cycle_number + 1}`, last_reattend_reason: reason, last_reattend_at: nowIso(), substatus: 'allocated', report_received_at: null, report_sent_at: null });
      const today = todayISO();
      if (!db.assignments.some((a) => a.job_id === j.id && a.user_id === me.id && a.scheduled_date === today && a.status !== 'cancelled')) {
        db.assignments.push({ id: db.id('a'), job_id: j.id, user_id: me.id, scheduled_date: today, start_time: null, status: 'confirmed', role: 'lead_installer', assignment_type: 'install', is_lead: false, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, job_phase: 'assigned', notes: 'Went back: ' + reason });
      }
      return { ok: true, job_id: j.id, cycle_number: d.cycle_number, reattend_count: d.reattend_count, bill_reattend_manually: false, prior_pack_sent: false };
    },
    cancel_makesafe(p, b) {
      const j = db.job(b.job_id || b.jobId); if (!j) fail(404, { error: 'job not found' });
      if (!manages(j)) fail(403, { error: 'Not authorized to cancel makesafe jobs' });
      if (!String(b.note || '').trim()) fail(400, { error: 'note required' });
      if (j.status === 'cancelled') return { ok: true, cancelled: true, idempotent: true, job_id: j.id, reason_code: b.reason_code, note: b.note };
      if (['complete', 'invoiced', 'archived'].includes(j.status)) fail(409, { error: `cannot cancel a ${j.status} make-safe` });
      const previous = j.status; j.status = 'cancelled'; j.previous_status = previous;
      let closed = 0;
      db.assignments.filter((a) => a.job_id === j.id && a.status !== 'cancelled' && a.status !== 'complete').forEach((a) => { a.status = 'cancelled'; closed += 1; });
      return { ok: true, cancelled: true, job_id: j.id, reason_code: b.reason_code, note: b.note, previous_status: previous, operator: me.name, assignments_closed: closed };
    },
    reopen_makesafe(p, b) {
      const j = db.job(b.job_id || b.jobId); if (!j) fail(404, { error: 'job not found' });
      if (!manages(j)) fail(403, { error: 'Not authorized to reopen this make-safe' });
      if (!String(b.reason || '').trim()) fail(400, { error: 'reason required' });
      if (j.status !== 'cancelled') return { ok: true, reopened: false, idempotent: true, job_id: j.id, status: j.status };
      j.status = j.previous_status && j.previous_status !== 'cancelled' ? j.previous_status : 'accepted';
      return { ok: true, reopened: true, job_id: j.id, status: j.status };
    },
    mark_makesafe_portal_report_done(p, b) {
      if (!isOffice) fail(403, { error: 'An authorised operator session is required.', code: 'operator_access_required' });
      const j = msJob(b.job_id || b.jobId); const d = j.makesafe_details;
      if (!['roof_report', 'assessment_report_quote'].includes(family(j))) fail(409, { error: 'This make-safe is not a report-type job.' });
      const already = Boolean(d.portal_verified_at) && d.portal_verified_cycle === d.cycle_number;
      if (!already) Object.assign(d, { portal_verified_at: nowIso(), portal_verified_cycle: d.cycle_number, substatus: 'ready_to_invoice' });
      return already ? { ok: true, already_done: true, substatus: d.substatus, portal_link_added: false, verification_recorded: true } : { ok: true, already_done: false, verification_recorded: true };
    },
    confirm_roof_report_done(p, b) {
      const jobId = b.job_id || b.jobId; if (!jobId) fail(400, { error: 'job_id required', code: 'ses_roof_confirmation_invalid' });
      const j = db.job(jobId); if (!j) fail(404, { error: 'job not found', code: 'ses_roof_confirmation_not_found' });
      if (!onJob(jobId)) fail(403, { error: 'Only a trade assigned to this job can confirm its roof report.', code: 'ses_roof_confirmation_forbidden' });
      const d = j.makesafe_details;
      if (!d || family(j) !== 'roof_report') fail(409, { error: 'This card is not a roof report job, so there is no roof report to confirm.', code: 'ses_roof_confirmation_not_a_roof_card' });
      if (!d.builder_portal_url) fail(409, { error: 'This card has no builder roof report link yet — ask the office to chase the builder for it.', code: 'ses_roof_confirmation_no_portal_roof_link' });
      const had = d.portal_captures.find((c) => c.attendance_cycle_id === d.attendance_cycle_id && c.capture_result === 'done');
      const row = had || { attendance_cycle_id: d.attendance_cycle_id, role: 'roof_report', capture_result: 'done', status: 'verified', capture_producer: 'trade_portal_confirmation/v1', attested_producer: 'trade_portal_confirmation/v1', screenshot_object_key: null, captured_by: me.id, captured_at: nowIso() };
      if (!had) d.portal_captures.push(row);
      return { success: true, job_id: j.id, already_confirmed: Boolean(had), question: 'Is the roof report done on the builder portal?', role: 'roof_report', attendance_cycle_id: d.attendance_cycle_id, cycle_number: d.cycle_number, producer: 'trade_portal_confirmation/v1', confirmed_by: row.captured_by, confirmed_at: row.captured_at, revision_id: db.id('rev'), stage_written: false };
    },

    // ---------------------------------------------------------- roof report
    roof_report_template(p) {
      const j = msJob(p.job_id || p.jobId);
      const quoteVisible = manages(j);
      const fields = ROOF_FIELDS.map((f) => { if (f.key !== 'storeys' || quoteVisible) return { ...f }; const { pricingDriver, ...rest } = f; return { ...rest, help: 'Single Storey or Double Storey as observed on site.' }; });
      const pricing = quoteVisible ? { single: { ex_gst: 250, inc_gst: 275 }, double: { ex_gst: 350, inc_gst: 385 }, storey_field: 'storeys', note: 'Storey sets the fee. Single Storey $275 inc GST, Double Storey $385 inc GST.' } : { storey_field: 'storeys' };
      return { template: { version: 3, pack_kind: 'roof', sections: ROOF_SECTIONS, fields, pricing }, job: { ref: (j.metadata || {}).external_ref || null, address: j.site_address, contact: j.client_phone, client: j.client_name, job_number: j.job_number }, draft: db.roofDrafts[j.id] || null };
    },
    save_roof_report(p, b) {
      const j = msJob(b.job_id || b.jobId || p.job_id);
      const cur = db.roofDrafts[j.id];
      if (cur && cur.status === 'submitted') return { ok: true, status: 'submitted', already_submitted: true, saved: false, draft_id: cur.id };
      const fields_json = { ...(cur ? cur.fields_json : {}), ...(b.fields || {}) };
      db.roofDrafts[j.id] = { id: cur ? cur.id : db.id('rr'), fields_json, storey: /double/i.test(fields_json.storeys || '') ? 'double' : fields_json.storeys ? 'single' : null, status: 'draft', report_doc_id: null, submitted_at: null, template_version: 3, updated_at: nowIso() };
      Object.assign(j.makesafe_details, { roof_report_draft_status: 'draft', completion_handoff: 'own_template' });
      return { ok: true, status: 'draft', saved: true, draft_id: db.roofDrafts[j.id].id, storey: db.roofDrafts[j.id].storey };
    },
    submit_roof_report(p, b) {
      const j = msJob(b.job_id || b.jobId || p.job_id);
      const cur = db.roofDrafts[j.id];
      const photoCount = db.media.filter((m) => m.job_id === j.id && (!m.type || m.type === 'photo') && !NOT_PACK_PHOTO.includes(m.phase)).length;
      if (b.force_render) {
        if (!cur || cur.status !== 'submitted') fail(400, { error: 'There is no submitted roof report to rebuild.' });
        return { ok: true, already_submitted: true, rerendered: true, status: 'submitted', report_doc_id: cur.report_doc_id, file_name: `Roof Report - ${j.job_number}.pdf`, render_hash: 'sha256:demo-' + photoCount, photo_count: photoCount, board_sync: { ok: true, skipped: true, reason: 'rerender_only' } };
      }
      if (cur && cur.status === 'submitted') return { ok: true, already_submitted: true, status: 'submitted', draft_id: cur.id, report_doc_id: cur.report_doc_id };
      const fields_json = { ...(cur ? cur.fields_json : {}), ...(b.fields || {}) };
      const missing = ROOF_FIELDS.filter((f) => f.required && !String(fields_json[f.key] == null ? '' : fields_json[f.key]).trim()).map((f) => `${f.label} is required`);
      if (missing.length) fail(400, { error: 'Roof report incomplete: ' + missing.join('; ') });
      const doc = { id: db.id('d'), job_id: j.id, type: 'roof_report', file_name: `Roof Report - ${j.job_number}.pdf`, visible_to_trades: true, pdf_url: 'https://example.test/roof-report.pdf', created_at: nowIso() };
      db.documents.push(doc);
      db.roofDrafts[j.id] = { id: cur ? cur.id : db.id('rr'), fields_json, storey: /double/i.test(fields_json.storeys) ? 'double' : 'single', status: 'submitted', report_doc_id: doc.id, submitted_at: nowIso(), template_version: 3, updated_at: nowIso() };
      const reportType = family(j) === 'roof_report';
      Object.assign(j.makesafe_details, { roof_report_draft_status: 'submitted', completion_handoff: 'own_template', ...(reportType ? { substatus: 'ready_to_invoice' } : {}) });
      return { ok: true, status: 'submitted', draft_id: db.roofDrafts[j.id].id, report_doc_id: doc.id, file_name: doc.file_name, render_hash: 'sha256:demo-' + photoCount, board_sync: reportType ? { ok: true, substatus: 'ready_to_invoice' } : { ok: true, skipped: true, reason: 'not_report_type' }, event_sync: { ok: true },
        ...(manages(j) ? { price: { storey: db.roofDrafts[j.id].storey, ex_gst: db.roofDrafts[j.id].storey === 'double' ? 350 : 250, inc_gst: db.roofDrafts[j.id].storey === 'double' ? 385 : 275 } } : {}) };
    },

    // ------------------------------------------------------- service report
    get_service_report(p) {
      const jobId = p.jobId || p.job_id; if (!jobId) fail(500, { error: 'jobId required' });
      const j = need(jobId);
      return { report: db.reports[jobId] || null, checklistTemplate: j.type === 'fencing' ? CHECKLIST.fencing : CHECKLIST.patio };
    },
    submit_service_report(p, b) {
      const jobId = b.jobId || b.job_id; if (!jobId) fail(500, { error: 'jobId required' });
      const j = need(jobId);
      const existing = db.reports[jobId] || null;
      if (existing && existing.status === 'approved') fail(500, { error: 'This report has been approved and cannot be modified' });
      const status = b.status === 'draft' ? 'draft' : 'submitted';
      const report = reportRow(j, { checklist_json: b.checklist || [], notes: b.notes || null, signature_data: b.signatureData || (existing && existing.signature_data) || null, signature_name: b.signatureName || null, weather: b.weather || null, start_time: b.start_time || null, end_time: b.end_time || null, variations: b.variations || null, status, submitted_by: me.id, submitted_at: status === 'submitted' ? nowIso() : null, cycle_number: 1, attendance_cycle_id: null, cycle_attribution: null }, existing);
      // The live trade read leaves share_token out; the demo sends one so the share button can be seen.
      if (status === 'submitted') report.share_token = 'demo-' + report.id;
      db.reports[jobId] = report;
      return { report };
    }
  };
});
