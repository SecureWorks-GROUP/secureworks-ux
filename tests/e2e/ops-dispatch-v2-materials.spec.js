// Dispatch v2 slices 5 and 6 (approved build, Oct 2026): Materials in the
// Dispatch job, against a stubbed ops-api that keeps its own state the way
// the dispatch_v2_* contract says (secureworks-backend branch
// be-dispatch-supplier-order-emails). Nothing leaves: every read and write is
// answered by the stub, and each write is checked for its exact body.
//
//  - Slice 6: the Draft list on top (free typing, Fill from the scope, photo
//    upload with the 413 photo_too_large and HEIC refusals said plainly),
//    Add supplier (approved list first, then every supplier; no approved
//    email = a box whose sending is blocked), lines moved by drag or by the
//    Move to box, and the main supplier tick on a fencing job.
//  - Slice 5: Make email holds an editable email (From fixed as admin@),
//    one open email per box, an optional TEST copy, Send now behind a confirm,
//    a send that may have gone needing confirm_resend, a sent-but-not-noted
//    email never offered again, and sent lines locked.
//  - The phone width (390) has no sideways scroll.
// Supplier names, addresses and job numbers are made up.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');
const { V2_ANSWER, V2_EMPTY_READS } = require('../helpers/dispatch-v2-board');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const ADMIN = 'admin@secureworkswa.com.au';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const SID = (n) => `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LID = (n) => `1e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PID = (n) => `9f000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EID = (n) => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The supplier contacts, and the approved order emails linked to them.
const SUPPLIERS = {
  [SID(1)]: { name: 'Acacia Steel Pty Ltd', approved: { id: 'ap-1', name: 'Acacia Steel', used_for: 'fencing+patio', to: ['orders@acacia.example'], cc: ['tony@acacia.example'] } },
  [SID(2)]: { name: 'Banksia Roofing', approved: { id: 'ap-2', name: 'Banksia', used_for: 'patio', to: ['sales@banksia.example'], cc: [] } },
  [SID(3)]: { name: 'Plain Hardware', approved: null },
};
// An approved entry no Xero contact is linked to yet: listed greyed, never addable (Tweak 4).
const UNLINKED = { approved_id: 'ap-9', approved_name: 'Coastal Fencing', used_for: 'fencing', to: ['yard@coastal.example'], cc: [], has_approved_email: true,
  supplier_id: null, name: 'Coastal Fencing', xero_name: null, main_reason: null, other_contacts: 0, can_add: false, note: 'Add to Xero first: this supplier has no Xero contact yet' };
const BLOCK_MSG = 'This supplier has no approved order email. Ask Shaun to add one before sending.';
const TEAM = { fencing: 'fencing@secureworkswa.com.au', patio: 'patios@secureworkswa.com.au', repair: 'ses@secureworkswa.com.au' };

const ROW = (over) => Object.assign({
  site_address: '12 Example Street', value: 12000, value_inc_gst: true, description: null,
  next_scheduled_date: null, last_scheduled_date: null, council_status: null, council_required: false, po_count: 0,
  dispatch_next_step: null, ghl_contact_id: null,
}, over);
const JOBS = {
  f1: ROW({ id: 'job-f1', job_number: 'SWF-920001', client_name: 'Jane Smith', site_suburb: 'Gwelup', type: 'fencing', work_type: 'fencing',
    status: 'order_materials', updated_at: '2026-10-22T05:00:00+00:00', materials_lines_total: 3, materials_lines_ready: 1,
    board: { title: 'SWF-920001 · Jane Smith' } }),
  p1: ROW({ id: 'job-p1', job_number: 'SWP-920002', client_name: 'Tom Lee', site_suburb: 'Yokine', type: 'patio', work_type: 'patio',
    status: 'order_materials', updated_at: '2026-10-21T05:00:00+00:00', board: { title: 'SWP-920002 · Tom Lee' } }),
};
// dispatch_materials 'ok': the list's line counts are real (read by the header pill).
const ACTIVE = () => ({ columns: { accepted: [JOBS.f1, JOBS.p1].map((r) => JSON.parse(JSON.stringify(r))) }, total: 2, dispatch_materials: 'ok' });
const DETAIL = (id) => {
  const r = Object.values(JOBS).find((j) => j.id === id);
  return r ? { job: { id, job_number: r.job_number, type: r.type, scope_json: null, ghl_contact_id: null }, media: [], documents: [], invoices: [] } : { status: 404, body: { error: 'Job not found' } };
};

const LINE = (n, supplierId, description, over) => Object.assign({
  id: LID(n), supplier_id: supplierId, description, quantity: 14, unit: null, detail: null, profile: null, colour: null,
  status: 'to_order', source: 'manual', sent_on_email_id: null, updated_at: `2026-10-23T00:00:0${n}.000Z`,
}, over);

// The materials of a job split across two boxes: panels with Acacia, plinths
// and hinges still on the Draft list, and an empty Banksia box.
const SPLIT = () => ({
  'job-f1': {
    boxes: [SID(1), SID(2)],
    lines: [
      LINE(1, SID(1), '1800H standard width panels with 2400H posts', { profile: 'Neetascreen', colour: 'Monument' }),
      LINE(2, null, '150mm standard width plinths', { colour: 'Monument' }),
      LINE(3, null, 'Gate hinges', { quantity: 2, unit: 'pairs' }),
    ],
  },
});

const longDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

// The stubbed dispatch_v2_* actions, with their state. fake.fail[action] is a
// list of { status, body } answers given before the real one.
function fakeV2(seed = {}) {
  let clock = Date.parse('2026-10-23T01:00:00.000Z');
  const stamp = () => new Date((clock += 1000)).toISOString();
  // autoFill: the server's auto_fill answer is on (backend #1168). scopeSupplier[job]
  // is the supplier the job's scope names, when it has an approved order email.
  const fake = { jobs: {}, testDone: false, fail: {}, sendOutcome: [], uploads: [], n: { photo: 0, email: 0 }, autoFill: false, scopeSupplier: {}, filled: {} };
  const NUMS = { 'job-f1': 'SWF-920001', 'job-p1': 'SWP-920002' };
  const TYPES = { 'job-f1': 'fencing', 'job-p1': 'patio' };
  const SCOPE = {
    'job-f1': [['1800H standard width panels with 2400H posts', 14], ['2400H posts', 15]],
    'job-p1': [['Solarspan 75mm roof panels', 8]],
  };
  const job = (id) => fake.jobs[id] || (fake.jobs[id] = { work_type: TYPES[id], job_number: NUMS[id], boxes: [], lines: [], photos: [], emails: [], main: null, stages: {} });
  const STAGE_LABELS = { order_materials: 'Order materials', sent: 'Sent to supplier', quote_received: 'Quote received', awaiting_payment: 'Awaiting payment',
    order_confirmed: 'Order confirmed', manufacturing: 'Manufacturing', ready: 'Materials ready', delivered: 'Delivered' };
  // A box's material stage: the one a person set, else Sent once an email went, else Order materials.
  const stageOut = (j, sid) => {
    const set = (j.stages || {})[sid];
    const sent = j.emails.some((m) => m.supplier_id === sid && m.status === 'sent');
    const key = set ? set.key : sent ? 'sent' : 'order_materials';
    return { box_id: 'box-' + sid, key, label: STAGE_LABELS[key], source: set ? 'set' : 'worked_out', set_at: set ? set.set_at : null, set_by_email: set ? set.set_by_email : null };
  };
  Object.keys(seed).forEach((id) => Object.assign(job(id), JSON.parse(JSON.stringify(seed[id]))));
  const forced = (action) => { const q = fake.fail[action]; return q && q.length ? q.shift() : null; };
  const no = (status, code, extra) => ({ status, body: Object.assign({ error: 'e2e refusal: ' + code, code }, extra) });
  const lineOut = (l) => Object.assign({}, l, { locked: !!l.sent_on_email_id, position: 0 });
  const isOpen = (m) => ['draft', 'sending', 'send_unknown'].includes(m.status);
  const mainOf = (j) => {
    if (j.work_type !== 'fencing' || !j.boxes.length) return null;
    if (j.main && j.boxes.includes(j.main)) return j.main;
    return j.boxes.find((sid) => j.lines.some((l) => l.supplier_id === sid && /panel|sheet/i.test(l.description))) || j.boxes[0];
  };
  const emailOut = (m) => JSON.parse(JSON.stringify(m));
  fake.materials = (id) => {
    const j = job(id);
    const main = mainOf(j);
    return {
      job_id: id, job_number: j.job_number, work_type: j.work_type,
      team_cc: { email: TEAM[j.work_type] || null, open_question: null }, from: ADMIN, test_send_done: fake.testDone,
      main_supplier_id: main, main_supplier_ticked: !!(j.main && j.boxes.includes(j.main)),
      can_suggest: ['fencing', 'patio'].includes(j.work_type) && !j.lines.length,
      auto_fill: fake.autoFill && j.work_type === 'fencing' && !j.lines.length && !fake.filled[id],
      draft_list: { lines: j.lines.filter((l) => l.supplier_id === null).map(lineOut), photos: j.photos.filter((p) => p.supplier_id === null) },
      suppliers: j.boxes.map((sid, i) => {
        const s = SUPPLIERS[sid];
        const open = j.emails.find((m) => m.supplier_id === sid && isOpen(m));
        return {
          supplier_id: sid, name: s.name, active: true, position: i + 1, is_main: sid === main,
          approved_email: s.approved, send_blocked: s.approved ? null : { code: 'no_approved_email', message: BLOCK_MSG },
          lines: j.lines.filter((l) => l.supplier_id === sid).map(lineOut), photos: j.photos.filter((p) => p.supplier_id === sid),
          open_email: open ? emailOut(open) : null, sent_emails: j.emails.filter((m) => m.supplier_id === sid && m.status === 'sent').map(emailOut),
          // Delivery or pickup: the open email's, else the newest sent one's.
          fulfilment: open ? open.fulfilment : (j.emails.filter((m) => m.supplier_id === sid && m.status === 'sent').pop() || {}).fulfilment || null,
          material_stage: stageOut(j, sid),
        };
      }),
      unboxed_sent_emails: j.emails.filter((m) => m.status === 'sent' && !j.boxes.includes(m.supplier_id))
        .map((m) => ({ supplier_id: m.supplier_id, supplier_name: m.supplier_name, email: emailOut(m) })),
    };
  };
  const bodyOf = (j, sid, lines, date, fulfilment, photos = 0) => {
    const pickup = fulfilment === 'pickup';
    const photoOnly = !lines.length && photos > 0;
    const main = j.work_type === 'fencing' && mainOf(j) === sid;
    const items = lines.map((l) => [`${l.quantity != null ? l.quantity + (l.unit ? ' ' + l.unit : '') + ' x ' : ''}${l.description}`]
      .concat(l.detail ? [l.detail] : [], l.profile ? ['Profile: ' + l.profile] : [], l.colour ? ['Colour: ' + l.colour] : []).join('\n'));
    // A photo-only order gets no standing lines (Tweak 5).
    const standing = main && !photoOnly;
    if (standing) items.push('4 x bags of quickset', 'Fixings, Post Caps and Screws as necessary');
    const materials = photoOnly ? 'Please see attached for materials needed.'
      : items.map((t, i) => `${i + 1}. ${t}`).join('\n\n') + (photos ? '\n\nPlease also see attached.' : '');
    return {
      main, standing, photoOnly, count: items.length,
      // A pickup has no Address and no Contact line (Tweak 6).
      text: 'Hi Team, could we please order the following for ' + (pickup ? 'pickup' : 'delivery') + ':\n\nDate: ' + longDate(date) +
        (pickup ? '' : '\nAddress: 12 Example Street, Gwelup\nContact: 0400 000 000 (Jane)') + '\n\nMaterials Needed:\n\n' +
        materials + '\n\n\nPlease confirm when you can, thank you.',
    };
  };
  const findEmail = (id) => {
    for (const jid of Object.keys(fake.jobs)) { const m = fake.jobs[jid].emails.find((x) => x.id === id); if (m) return { j: fake.jobs[jid], m }; }
    return {};
  };
  const ADDR = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
  fake.api = {
    dispatch_v2_materials: (url) => forced('dispatch_v2_materials') || fake.materials(url.searchParams.get('job_id')),
    dispatch_v2_supplier_search: (url) => {
      const f = forced('dispatch_v2_supplier_search');
      if (f) return f;
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const hit = (n) => !q || String(n || '').toLowerCase().includes(q);
      // Tweak 4: one row per approved entry under its approved name, on its (only) Xero contact.
      const approved = Object.keys(SUPPLIERS).filter((sid) => SUPPLIERS[sid].approved).map((sid) => {
        const a = SUPPLIERS[sid].approved;
        return { approved_id: a.id, approved_name: a.name, used_for: a.used_for, to: a.to, cc: a.cc, has_approved_email: true, supplier_id: sid,
          name: a.name, xero_name: SUPPLIERS[sid].name, main_reason: 'only_contact', other_contacts: 0, can_add: true, note: null };
      }).concat([UNLINKED]).filter((r) => hit(r.xero_name) || hit(r.approved_name));
      const others = Object.keys(SUPPLIERS).filter((sid) => !SUPPLIERS[sid].approved).map((sid) => ({
        supplier_id: sid, name: SUPPLIERS[sid].name, approved_id: null, approved_name: null, used_for: null, to: [], cc: [], has_approved_email: false, can_add: true,
        note: 'No approved order email: Dispatch will not send to this supplier',
      })).filter((r) => hit(r.name));
      return { q: q || null, ranking: 'bills', approved, more_approved: [], others };
    },
    dispatch_v2_photo_url: () => ({ url: 'https://media.example.test/photo.jpg', expires_in_seconds: 600 }),
    dispatch_v2_save_line: (url, b) => {
      const f = forced('dispatch_v2_save_line');
      if (f) return f;
      const j = job(b.job_id);
      const was = j.lines.find((l) => l.id === b.line.id);
      const fields = ['description', 'quantity', 'unit', 'detail', 'profile', 'colour', 'status'];
      if (!b.expected_updated_at) {
        if (was) return { success: true, unchanged: true, line: lineOut(was) };
        if (b.line.supplier_id && !j.boxes.includes(b.line.supplier_id)) return no(409, 'supplier_not_on_job');
        const l = { id: b.line.id, supplier_id: b.line.supplier_id || null, source: 'manual', sent_on_email_id: null };
        fields.forEach((k) => { l[k] = b.line[k] === undefined ? null : b.line[k]; });
        l.updated_at = stamp();
        j.lines.push(l);
        return { success: true, line: lineOut(l) };
      }
      if (!was) return no(409, 'line_not_on_job');
      if (was.sent_on_email_id) return no(409, 'line_locked');
      if (was.updated_at !== b.expected_updated_at) return no(409, 'line_changed', { line: lineOut(was) });
      fields.forEach((k) => { if (b.line[k] !== undefined) was[k] = b.line[k]; });
      was.updated_at = stamp();
      return { success: true, line: lineOut(was) };
    },
    dispatch_v2_move_line: (url, b) => {
      const f = forced('dispatch_v2_move_line');
      if (f) return f;
      const j = job(b.job_id);
      const l = j.lines.find((x) => x.id === b.id);
      if (!l) return no(409, 'line_not_on_job');
      if (l.sent_on_email_id) return no(409, 'line_locked');
      if (l.updated_at !== b.expected_updated_at) return no(409, 'line_changed', { line: lineOut(l) });
      if (b.supplier_id && !j.boxes.includes(b.supplier_id)) return no(409, 'supplier_not_on_job');
      j.lines = j.lines.filter((x) => x !== l).concat([l]);
      l.supplier_id = b.supplier_id || null;
      l.updated_at = stamp();
      return { success: true, line: lineOut(l) };
    },
    dispatch_v2_delete_line: (url, b) => {
      const j = job(b.job_id);
      j.lines = j.lines.filter((x) => x.id !== b.id);
      return { success: true };
    },
    dispatch_v2_suggest_draft: (url, b) => {
      const f = forced('dispatch_v2_suggest_draft');
      if (f) return f;
      const j = job(b.job_id);
      if (b.auto === true && j.work_type !== 'fencing') return no(409, 'no_auto_fill');
      if (b.auto === true && fake.filled[b.job_id]) return no(409, 'already_filled');
      if (j.lines.length) return no(409, 'lines_exist');
      // The scope's supplier gets a box, and the lines go straight into it.
      const sid = fake.scopeSupplier[b.job_id] || null;
      if (sid && !j.boxes.includes(sid)) j.boxes.push(sid);
      const added = (SCOPE[b.job_id] || []).map(([d, q], i) => ({ id: LID(800 + i), supplier_id: sid, description: d, quantity: q, unit: null, detail: null, profile: null, colour: null,
        status: 'not_reviewed', source: 'scope', sent_on_email_id: null, updated_at: stamp() }));
      j.lines.push(...added);
      fake.filled[b.job_id] = true;
      return { success: true, added: added.length, lines: added.map(lineOut), notes: ['1 panel is marked long width in the scope. Check the panel line with the supplier.'],
        supplier: sid ? { supplier_id: sid, name: SUPPLIERS[sid].name } : null };
    },
    dispatch_v2_add_supplier: (url, b) => {
      const f = forced('dispatch_v2_add_supplier');
      if (f) return f;
      const j = job(b.job_id);
      const s = SUPPLIERS[b.supplier_id];
      if (!s) return no(404, 'supplier_not_found');
      const out = { supplier_id: b.supplier_id, name: s.name, approved_email: s.approved, send_blocked: s.approved ? null : { code: 'no_approved_email', message: BLOCK_MSG } };
      if (j.boxes.includes(b.supplier_id)) return { success: true, unchanged: true, supplier: out };
      j.boxes.push(b.supplier_id);
      return { success: true, supplier: Object.assign(out, { position: j.boxes.length }) };
    },
    // The X (Shaun, 12 Nov 2026): the box goes with its lines, photos and held
    // email; a sent email is kept. Refused only while an email is sending.
    dispatch_v2_remove_supplier: (url, b) => {
      const f = forced('dispatch_v2_remove_supplier');
      if (f) return f;
      const j = job(b.job_id);
      if (!j.boxes.includes(b.supplier_id)) return { success: true, unchanged: true };
      const mine = (x) => x.supplier_id === b.supplier_id;
      if (j.emails.some((m) => mine(m) && ['sending', 'send_unknown'].includes(m.status))) return no(409, 'supplier_email_sending');
      const held = j.emails.filter((m) => mine(m) && m.status === 'draft');
      held.forEach((m) => { m.status = 'discarded'; });
      const lines = j.lines.filter(mine).length;
      j.lines = j.lines.filter((l) => !mine(l));
      j.photos = j.photos.filter((p) => !mine(p));
      j.boxes = j.boxes.filter((x) => x !== b.supplier_id);
      return { success: true, removed: { lines, held_emails_discarded: held.length } };
    },
    // The stage press: refused when the screen's stamp is not the box's.
    dispatch_v2_set_material_stage: (url, b) => {
      const f = forced('dispatch_v2_set_material_stage');
      if (f) return f;
      const id = Object.keys(fake.jobs).find((jid) => fake.jobs[jid].boxes.some((sid) => 'box-' + sid === b.box_id));
      if (!id) return no(404, 'box_not_found');
      const j = fake.jobs[id];
      const sid = j.boxes.find((x) => 'box-' + x === b.box_id);
      const now = stageOut(j, sid);
      if (now.set_at !== b.expected_set_at) return no(409, 'stage_changed', { box: now });
      j.stages[sid] = { key: b.material_stage, set_at: stamp(), set_by_email: 'shaun@ops.test' };
      return { success: true, job_status_changed: false, box: stageOut(j, sid), arrival: null };
    },
    dispatch_v2_set_main_supplier: (url, b) => {
      const j = job(b.job_id);
      j.main = b.supplier_id || null;
      return { success: true, main_supplier_id: mainOf(j), main_supplier_ticked: !!j.main };
    },
    dispatch_v2_upload_photo: (url, b) => {
      fake.uploads.push({ file_name: b.file_name, head: String(b.data_base64).slice(0, 23) });
      const f = forced('dispatch_v2_upload_photo');
      if (f) return f;
      const j = job(b.job_id);
      const b64 = String(b.data_base64).slice(String(b.data_base64).indexOf(',') + 1);
      const p = { id: PID(++fake.n.photo), supplier_id: b.supplier_id || null, file_name: b.file_name, content_type: 'image/jpeg', size_bytes: Math.floor(b64.length * 3 / 4), added_at: stamp() };
      j.photos.push(p);
      return { success: true, photo: p };
    },
    dispatch_v2_move_photo: (url, b) => {
      const j = job(b.job_id);
      const p = j.photos.find((x) => x.id === b.photo_id);
      p.supplier_id = b.supplier_id || null;
      return { success: true, photo: p };
    },
    dispatch_v2_delete_photo: (url, b) => {
      const j = job(b.job_id);
      j.photos = j.photos.filter((x) => x.id !== b.photo_id);
      return { success: true };
    },
    dispatch_v2_make_email: (url, b) => {
      const f = forced('dispatch_v2_make_email');
      if (f) return f;
      const j = job(b.job_id);
      const s = SUPPLIERS[b.supplier_id];
      const open = j.emails.find((m) => m.supplier_id === b.supplier_id && isOpen(m));
      if (open && !b.rebuild) return { success: true, unchanged: true, email: emailOut(open) };
      if (!s.approved) return no(409, 'no_approved_email');
      const lines = j.lines.filter((l) => l.supplier_id === b.supplier_id && !l.sent_on_email_id && l.status !== 'in_stock' && String(l.description || '').trim());
      // The box's photos not already sent, three at most (Tweak 5).
      const gone = new Set(j.emails.filter((x) => ['sent', 'sending', 'send_unknown'].includes(x.status)).flatMap((x) => x.photo_ids));
      const photoIds = j.photos.filter((p) => p.supplier_id === b.supplier_id && !gone.has(p.id)).slice(0, 3).map((p) => p.id);
      if (!lines.length && !photoIds.length) return no(409, 'no_lines_to_order');
      if (b.fulfilment !== undefined && b.fulfilment !== null && !['delivery', 'pickup'].includes(b.fulfilment)) return no(400, 'invalid_request');
      const date = b.delivery_date || null;
      // A rebuild without a choice keeps the held email's own.
      const fulfilment = b.fulfilment || (open && open.fulfilment) || 'delivery';
      const built = bodyOf(j, b.supplier_id, lines, date, fulfilment, photoIds.length);
      const team = TEAM[j.work_type] || null;
      const m = open || { id: EID(++fake.n.email), job_id: b.job_id, supplier_id: b.supplier_id, supplier_name: s.name, from: ADMIN, test: null, sent: null };
      Object.assign(m, {
        status: 'draft', to: s.approved.to.slice(), cc: s.approved.cc.concat(team ? [team] : []), team_cc: team,
        subject: 'Material Order Ref ' + j.job_number, body_text: built.text, edited: false, delivery_date: date, fulfilment,
        is_main_supplier: built.main, standing_lines_included: built.standing, line_count: built.count, line_ids: lines.map((l) => l.id),
        photo_ids: photoIds,
        empty_detail_lines: date ? [] : ['date'], last_error: null, updated_at: stamp(),
      });
      if (!open) j.emails.push(m);
      return { success: true, email: emailOut(m), missing: m.empty_detail_lines, photo_only: built.photoOnly, team_cc_open_question: null, rebuilt: !!b.rebuild || undefined };
    },
    dispatch_v2_save_email: (url, b) => {
      const f = forced('dispatch_v2_save_email');
      if (f) return f;
      const { m } = findEmail(b.email_id);
      if (!m || m.status !== 'draft') return no(409, 'email_not_editable');
      if (m.updated_at !== b.expected_updated_at) return no(409, 'email_changed', { email: emailOut(m) });
      const bad = [].concat(b.to || [], b.cc || []).filter((a) => !ADDR.test(a));
      if (bad.length) return no(400, 'invalid_request');
      if (b.to) m.to = b.to;
      if (b.cc) m.cc = b.cc;
      if (b.subject !== undefined) m.subject = b.subject;
      if (b.body_text !== undefined) { m.body_text = b.body_text; m.edited = true; }
      if (b.photo_ids) m.photo_ids = b.photo_ids;
      m.updated_at = stamp();
      return { success: true, email: emailOut(m) };
    },
    dispatch_v2_discard_email: (url, b) => {
      const { m } = findEmail(b.email_id);
      if (!m || m.status !== 'draft') return no(409, 'email_not_discardable');
      if (m.updated_at !== b.expected_updated_at) return no(409, 'email_changed');
      m.status = 'discarded';
      m.updated_at = stamp();
      return { success: true };
    },
    dispatch_v2_send_email: (url, b) => {
      const f = forced('dispatch_v2_send_email');
      if (f) return f;
      const { j, m } = findEmail(b.email_id);
      if (!m) return no(409, 'email_not_sendable');
      if (m.updated_at !== b.expected_updated_at) return no(409, 'email_changed');
      if (m.status === 'send_unknown' && !b.confirm_resend) return no(409, 'send_unknown');
      if (m.status !== 'draft' && !(m.status === 'send_unknown' && b.confirm_resend)) return no(409, 'email_not_sendable');
      // An email needs a line or a photo (Tweak 5).
      if (!m.line_ids.length && !m.photo_ids.length) return no(409, 'nothing_to_order');
      if (m.empty_detail_lines.length) return no(409, 'email_details_missing', { missing: m.empty_detail_lines });
      if (b.test) {
        fake.testDone = true;
        m.test = { sent_at: new Date(clock + 500).toISOString(), sent_to: ADMIN, sent_by_email: 'shaun@secureworkswa.com.au' };
        return { success: true, test: true, sent_to: ADMIN, recorded: true, email: emailOut(m) };
      }
      // The test copy is optional (Shaun's ruling, 23 Oct): no refusal here.
      const outcome = fake.sendOutcome.shift() || 'sent';
      if (outcome === 'unknown') {
        m.status = 'send_unknown';
        m.updated_at = stamp();
        return { status: 502, body: { error: 'We could not tell whether the email went.', code: 'send_unknown' } };
      }
      if (outcome === 'unrecorded') {
        m.status = 'sending';
        return { success: true, test: false, recorded: false, email: emailOut(m) };
      }
      m.status = 'sent';
      m.sent = { sent_at: stamp(), sent_by_email: 'shaun@secureworkswa.com.au', from: ADMIN, to: m.to, cc: m.cc, internet_message_id: '<e2e@outlook.example>', conversation_id: 'AAQ-e2e' };
      j.lines.forEach((l) => { if (m.line_ids.includes(l.id)) { l.sent_on_email_id = m.id; l.updated_at = stamp(); } });
      m.updated_at = stamp();
      return { success: true, test: false, recorded: true, email: emailOut(m) };
    },
  };
  return fake;
}

// Boots Ops on Dispatch with ops-api stubbed; the first job (SWF-920001,
// fencing) opens on its own.
async function boot(page, fake, { viewport = { width: 1440, height: 900 }, api = {} } = {}) {
  const calls = [];
  const handlers = Object.assign({
    pipeline: () => ACTIVE(),
    job_detail: (url) => DETAIL(url.searchParams.get('jobId')),
    job_notes: (url) => ({ job_id: url.searchParams.get('jobId'), total: 0, notes: [] }),
    list_pos: () => ({ purchase_orders: [] }),
    ...V2_EMPTY_READS,
  }, fake.api, api);
  await page.setViewportSize(viewport);
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const raw = request.url();
    if (raw.startsWith('file://')) return route.continue();
    const url = new URL(raw);
    const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
    if (!action) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
    calls.push({ action, method: request.method(), url, body });
    const view = url.searchParams.get('view') || 'active';
    const key = action === 'pipeline' && view === 'archive' ? 'archive' : action;
    const out = key === 'archive' ? { columns: {}, total: 0 } : handlers[key] ? await handlers[key](url, body) : {};
    const wrapped = out && typeof out === 'object' && typeof out.status === 'number' && 'body' in out;
    let reply = wrapped ? out.body : out;
    if (action === 'pipeline' && (!wrapped || out.status < 300)) reply = V2_ANSWER(reply, view);
    return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  await page.goto(OPS_FILE + '#dispatch');
  await expect(page.locator('#viewDispatch')).toHaveClass(/active/);
  const root = page.locator('#dispatchRoot');
  const mat = root.locator('[data-dpc-region="v2mat"]');
  await expect(mat.locator('.dpc-v2-draft')).toBeVisible();
  const of = (action) => calls.filter((c) => c.action === action);
  const writes = () => calls.filter((c) => c.method === 'POST' && /^dispatch_/.test(c.action));
  return { calls, of, root, mat, writes, modal: root.locator('.dpc-v2-modal') };
}

const boxOf = (mat, name) => mat.locator('.dpc-v2-box', { has: mat.page().locator('.dpc-suphead strong', { hasText: name }) });
const draftOf = (mat) => mat.locator('.dpc-v2-draft');
const cellOf = (mat, n, field) => mat.locator(`[data-dpc-v2-id="${LID(n)}"][data-dpc-v2-cell="${field}"]`);
const rowOf = (mat, n) => mat.locator(`[data-dpc-v2-row="${LID(n)}"]`);

// A box with its lines and a held email made from them (no date yet unless given).
async function makeHeld(mat, name, date) {
  const box = boxOf(mat, name);
  if (date) await box.locator('[data-dpc-v2-date]').fill(date);
  await box.locator('[data-dpc-v2="make"]').click();
  await expect(box.locator('.dpc-v2-mail')).toBeVisible();
  return box;
}

// ── Slice 6: the Draft list and the supplier boxes ────────────────────────────

test.describe('Dispatch v2 Materials: Draft list and supplier boxes', () => {
  test('Materials reads dispatch_v2_materials once per job open, the Draft list is on top, and no v1 read is made', async ({ page }) => {
    const fake = fakeV2();
    const { root, mat, of, calls } = await boot(page, fake);
    await expect(mat.locator('h3')).toHaveText('Materials');
    await expect(mat.locator('.dpc-supcard').first()).toHaveClass(/dpc-v2-draft/);
    await expect(draftOf(mat).locator('.dpc-suphead strong')).toHaveText('Draft list');
    await expect(draftOf(mat)).toContainText('No lines yet. Add one, or fill the list from the scope.');
    await expect(mat).toContainText('No supplier boxes yet. Press Add supplier to make one, then move lines into it.');
    await expect(draftOf(mat).locator('[data-dpc-v2="suggest"]')).toHaveText('Fill from the scope');
    // The job's sections, as the approved page keeps them: Emails holds the v2
    // order emails and supplier replies, Deliveries keeps the v1 table.
    await expect(root.locator('.dpc-sec h3')).toHaveText(['Scope and notes', 'Materials', 'Emails', 'Deliveries and install']);
    // The header pill is the list row's own count.
    await expect(root.locator('.dpc-jobhead .dpc-pill', { hasText: 'items ready' })).toHaveText('1 of 3 items ready');
    expect(of('dispatch_v2_materials').map((c) => c.url.searchParams.get('job_id'))).toEqual(['job-f1']);
    await root.locator('.dpc-job', { hasText: 'SWP-920002' }).click();
    await expect(root.locator('.dpc-jobhead h2')).toContainText('SWP-920002');
    await expect(draftOf(mat)).toBeVisible();
    expect(of('dispatch_v2_materials').map((c) => c.url.searchParams.get('job_id'))).toEqual(['job-f1', 'job-p1']);
    // The v1 materials read is kept for the working out pad, Deliveries and old
    // purchase orders, once per job open; the other v1 reads are gone.
    expect(of('dispatch_materials').map((c) => c.url.searchParams.get('job_id'))).toEqual(['job-f1', 'job-p1']);
    expect(calls.filter((c) => ['dispatch_order_emails', 'dispatch_deliveries', 'list_suppliers'].includes(c.action))).toEqual([]);
    expect(calls.filter((c) => c.method === 'POST' && c.action !== 'operator_heartbeat')).toEqual([]);
    expect(await mat.innerText()).not.toMatch(/[–—]/);
  });

  test('a failed materials read says so with Retry, never an empty Draft list', async ({ page }) => {
    const fake = fakeV2();
    fake.fail.dispatch_v2_materials = [{ status: 500, body: { error: 'e2e' } }];
    const calls = [];
    await page.setViewportSize({ width: 1440, height: 900 });
    // Booted by hand: the first read fails, so the Draft list is not there to wait for.
    await installOpsSessionStub(page);
    await page.route('**/*', async (route) => {
      const raw = route.request().url();
      if (raw.startsWith('file://')) return route.continue();
      const url = new URL(raw);
      const action = /\/functions\/v1\/ops-api$/.test(url.pathname) ? url.searchParams.get('action') : null;
      calls.push(action);
      const h = Object.assign({ pipeline: () => ACTIVE(), job_detail: (u) => DETAIL(u.searchParams.get('jobId')), job_notes: () => ({ total: 0, notes: [] }), list_pos: () => ({ purchase_orders: [] }) }, V2_EMPTY_READS, fake.api)[action];
      const out = h ? await h(url, null) : {};
      const wrapped = out && typeof out.status === 'number' && 'body' in out;
      let reply = wrapped ? out.body : out;
      if (action === 'pipeline') reply = V2_ANSWER(reply, url.searchParams.get('view') || 'active');
      return route.fulfill({ status: wrapped ? out.status : 200, contentType: 'application/json', body: JSON.stringify(reply) });
    });
    await page.goto(OPS_FILE + '#dispatch');
    const mat = page.locator('#dispatchRoot [data-dpc-region="v2mat"]');
    await expect(mat.locator('[role="alert"]')).toContainText('Could not load the materials.');
    await expect(mat.locator('.dpc-v2-draft')).toHaveCount(0);
    await mat.locator('[data-dpc-v2="retry"]').click();
    await expect(mat.locator('.dpc-v2-draft')).toBeVisible();
    expect(calls.filter((a) => a === 'dispatch_v2_materials')).toHaveLength(2);
  });

  test('a fencing job fills itself from the scope once when it opens, into the box of the supplier the scope names', async ({ page }) => {
    const fake = fakeV2();
    fake.autoFill = true;
    fake.scopeSupplier['job-f1'] = SID(1);
    const { root, mat, writes } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel Pty Ltd');
    await expect(acacia.locator('[data-dpc-v2-cell="description"]')).toHaveCount(2);
    await expect(draftOf(mat)).toContainText('2 lines filled in from the scope into the Acacia Steel Pty Ltd box. Check each one, then press Make email on that box.');
    await expect(draftOf(mat).locator('.dpc-msg-notes li')).toHaveText(['1 panel is marked long width in the scope. Check the panel line with the supplier.']);
    await expect(draftOf(mat).locator('[data-dpc-v2-cell="description"]')).toHaveCount(0);
    await expect(draftOf(mat).locator('[data-dpc-v2="suggest"]')).toHaveCount(0);
    await expect(acacia.locator('[data-dpc-v2="make"]')).toBeVisible();
    expect(writes().map((c) => [c.action, c.body.job_id, c.body.auto])).toEqual([['dispatch_v2_suggest_draft', 'job-f1', true]]);
    // A patio job never fills itself, and going back to the fencing job does not fill it again.
    await root.locator('.dpc-job', { hasText: 'SWP-920002' }).click();
    await expect(draftOf(mat).locator('[data-dpc-v2="suggest"]')).toHaveText('Fill from the scope');
    await root.locator('.dpc-job', { hasText: 'SWF-920001' }).click();
    await expect(acacia.locator('[data-dpc-v2-cell="description"]')).toHaveCount(2);
    expect(writes()).toHaveLength(1);
  });

  test('an auto fill the server says was done before shows the latest with no message, and the button still fills', async ({ page }) => {
    const fake = fakeV2();
    fake.autoFill = true;
    fake.fail.dispatch_v2_suggest_draft = [{ status: 409, body: { error: 'This job was filled from the scope before', code: 'already_filled' } }];
    const { mat, of, writes } = await boot(page, fake);
    await expect.poll(() => of('dispatch_v2_materials').length).toBe(2);
    await expect(draftOf(mat).locator('.dpc-card-msg')).toHaveCount(0);
    expect(writes().map((c) => ({ job_id: c.body.job_id, auto: c.body.auto }))).toEqual([{ job_id: 'job-f1', auto: true }]);
    await draftOf(mat).locator('[data-dpc-v2="suggest"]').click();
    await expect(draftOf(mat)).toContainText('2 lines filled in from the scope. Check each one before ordering.');
    await expect(draftOf(mat).locator('[data-dpc-v2-cell="description"]')).toHaveCount(2);
    expect(writes().map((c) => ({ job_id: c.body.job_id, auto: c.body.auto }))).toEqual([{ job_id: 'job-f1', auto: true }, { job_id: 'job-f1' }]);
  });

  test('Fill from the scope sends one suggest; a typed line saves once with a new id and no stamp; an edit sends its stamp', async ({ page }) => {
    const fake = fakeV2();
    const { mat, writes } = await boot(page, fake);
    await draftOf(mat).locator('[data-dpc-v2="suggest"]').click();
    await expect(draftOf(mat)).toContainText('2 lines filled in from the scope. Check each one before ordering.');
    await expect(draftOf(mat).locator('.dpc-msg-notes li')).toHaveText(['1 panel is marked long width in the scope. Check the panel line with the supplier.']);
    await expect(draftOf(mat).locator('[data-dpc-v2-cell="description"]')).toHaveCount(2);
    await expect(draftOf(mat).locator('[data-dpc-v2="suggest"]')).toHaveCount(0);
    expect(writes().map((c) => [c.action, c.body.job_id])).toEqual([['dispatch_v2_suggest_draft', 'job-f1']]);

    // + Add line sends nothing until the item has a name and the box is left.
    await draftOf(mat).locator('[data-dpc-v2="addline"]').click();
    await expect(draftOf(mat).locator('[data-dpc-v2-cell="description"]')).toHaveCount(3);
    expect(writes()).toHaveLength(1);
    const desc = draftOf(mat).locator('[data-dpc-v2-cell="description"]').nth(2);
    await expect(desc).toBeFocused();
    await desc.fill('Gate hinges');
    await page.keyboard.press('Tab');
    await page.keyboard.type('2');
    await page.keyboard.press('Tab');
    await page.keyboard.type('pairs');
    await page.keyboard.press('Tab');
    await expect.poll(() => {
      const l = fake.jobs['job-f1'].lines.find((x) => x.description === 'Gate hinges');
      return l ? [l.quantity, l.unit] : null;
    }).toEqual([2, 'pairs']);
    const saves = writes().filter((c) => c.action === 'dispatch_v2_save_line');
    const first = saves[0].body;
    expect(first.line.id).toMatch(UUID_RE);
    expect(first.expected_updated_at).toBeUndefined();
    expect(first.line).toMatchObject({ supplier_id: null, description: 'Gate hinges', status: 'to_order' });
    // Every later save of that line is an edit on its stamp, never a second insert.
    saves.slice(1).forEach((c) => { expect(c.body.line.id).toBe(first.line.id); expect(typeof c.body.expected_updated_at).toBe('string'); });
    expect(fake.jobs['job-f1'].lines.filter((l) => l.description === 'Gate hinges')).toHaveLength(1);

    // An edit of a saved line sends the line's stamp.
    const before = writes().length;
    const stampWas = fake.jobs['job-f1'].lines[0].updated_at;
    await cellOf(mat, 800, 'quantity').fill('16');
    await cellOf(mat, 800, 'quantity').blur();
    await expect.poll(() => writes().length).toBe(before + 1);
    expect(writes()[before].body).toMatchObject({ job_id: 'job-f1', expected_updated_at: stampWas, line: { id: LID(800), quantity: 16 } });
    expect(writes()[before].body.line.supplier_id).toBeUndefined();
    // Leaving a cell that did not change sends nothing.
    await cellOf(mat, 800, 'unit').focus();
    await cellOf(mat, 800, 'unit').blur();
    await page.waitForTimeout(100);
    expect(writes()).toHaveLength(before + 1);
  });

  test('a Qty that is not a number says so and sends nothing; a line changed elsewhere shows the latest', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes, of } = await boot(page, fake);
    await cellOf(mat, 2, 'quantity').fill('lots');
    await cellOf(mat, 2, 'quantity').blur();
    await expect(rowOf(mat, 2)).toContainText('For example 14 or 2.5.');
    expect(writes()).toEqual([]);
    // Someone else changed the line: the save is refused and the latest is read once.
    fake.jobs['job-f1'].lines[1].updated_at = '2026-10-23T09:00:00.000Z';
    fake.jobs['job-f1'].lines[1].description = '150mm plinths, changed elsewhere';
    const reads = of('dispatch_v2_materials').length;
    await cellOf(mat, 2, 'quantity').fill('15');
    await cellOf(mat, 2, 'quantity').blur();
    await expect(mat.locator('.dpc-mat-notice')).toHaveText('This changed somewhere else. Showing the latest.');
    await expect(cellOf(mat, 2, 'description')).toHaveValue('150mm plinths, changed elsewhere');
    expect(of('dispatch_v2_materials')).toHaveLength(reads + 1);
  });

  test('Add supplier lists the approved suppliers first, every other supplier under Show more; one without an approved email is added with sending blocked', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes, of } = await boot(page, fake);
    await mat.locator('[data-dpc-v2="find"]').click();
    const find = mat.locator('.dpc-v2-find');
    await expect(find.locator('[data-dpc-v2-q]')).toBeFocused();
    // Tweak 4: approved suppliers under their approved names; the rest behind Show more.
    await expect(find.locator('.dpc-mat-h4')).toHaveText(['Approved suppliers']);
    await expect(find.locator('.dpc-v2-res strong')).toHaveText(['Acacia Steel', 'Banksia', 'Coastal Fencing']);
    await expect(find.locator('.dpc-v2-res', { hasText: 'Acacia Steel' })).toContainText('Xero: Acacia Steel Pty Ltd');
    // On the job already, and an approved entry with no Xero contact, cannot be pressed.
    await expect(find.locator('.dpc-v2-res', { hasText: 'Acacia Steel' })).toBeDisabled();
    await expect(find.locator('.dpc-v2-res', { hasText: 'Acacia Steel' })).toContainText('On this job');
    await expect(find.locator('.dpc-v2-res', { hasText: 'Coastal Fencing' })).toBeDisabled();
    await expect(find.locator('.dpc-v2-res', { hasText: 'Coastal Fencing' })).toHaveClass(/dpc-v2-res-noxero/);
    await expect(find.locator('.dpc-v2-res', { hasText: 'Coastal Fencing' })).toContainText('Add to Xero first: this supplier has no Xero contact yet');
    await find.locator('[data-dpc-v2="find-more"]').click();
    await expect(find.locator('.dpc-mat-h4')).toHaveText(['Approved suppliers', 'All other suppliers']);
    await expect(find.locator('.dpc-v2-res', { hasText: 'Plain Hardware' })).toContainText('No approved order email: Dispatch will not send to this supplier');
    expect(of('dispatch_v2_supplier_search')[0].url.searchParams.get('limit')).toBe('25');

    // Typing narrows the search, read once after typing stops.
    await find.locator('[data-dpc-v2-q]').pressSequentially('plain');
    await expect(find.locator('.dpc-v2-res strong')).toHaveText(['Plain Hardware']);
    expect(of('dispatch_v2_supplier_search').map((c) => c.url.searchParams.get('q'))).toEqual([null, 'plain']);

    await find.locator('.dpc-v2-res', { hasText: 'Plain Hardware' }).click();
    const plain = boxOf(mat, 'Plain Hardware');
    await expect(plain).toBeVisible();
    await expect(mat.locator('.dpc-v2-find')).toHaveCount(0);
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_add_supplier', { job_id: 'job-f1', supplier_id: SID(3), operator_email: expect.any(String) }]]);
    await expect(plain.locator('.dpc-suphead')).toContainText('No approved order email');
    await expect(plain.locator('.dpc-v2-blocked')).toHaveText('Send blocked. ' + BLOCK_MSG + ' You can still split lines to it.');
    await expect(plain).toContainText('Added. This supplier has no approved order email, so you can split lines to it but Dispatch will not send to it.');
    await expect(plain.locator('[data-dpc-v2="make"]')).toBeDisabled();
    await expect(plain).toContainText('Make email and Send now are off: this supplier has no approved order email.');
    // Lines can still be split to it.
    await rowOf(mat, 3).locator('[data-dpc-v2-move]').selectOption(SID(3));
    await expect(plain.locator(`[data-dpc-v2-row="${LID(3)}"]`)).toBeVisible();
    await expect(plain.locator('[data-dpc-v2="make"]')).toBeDisabled();
    await expect(plain.locator('[data-dpc-v2="send"], [data-dpc-v2="test"]')).toHaveCount(0);
  });

  test('every box has a cross; it asks first, Cancel keeps the box, Remove takes it off with its lines', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const banksia = boxOf(mat, 'Banksia Roofing');
    await banksia.locator('[data-dpc-v2="remove-sup"]').click();
    await expect(banksia.locator('.dpc-v2-rmask')).toContainText('Remove Banksia Roofing? Nothing is sent to Banksia Roofing.');
    await banksia.locator('[data-dpc-v2="remove-sup-no"]').click();
    await expect(banksia.locator('.dpc-v2-rmask')).toHaveCount(0);
    expect(writes()).toEqual([]);
    await banksia.locator('[data-dpc-v2="remove-sup"]').click();
    await banksia.locator('[data-dpc-v2="remove-sup-yes"]').click();
    await expect(boxOf(mat, 'Banksia Roofing')).toHaveCount(0);
    // A box with a line has its cross too, and says what goes with it.
    const acacia = boxOf(mat, 'Acacia Steel');
    await acacia.locator('[data-dpc-v2="remove-sup"]').click();
    await expect(acacia.locator('.dpc-v2-rmask')).toContainText('Remove Acacia Steel Pty Ltd and its 1 line? Nothing is sent to Acacia Steel Pty Ltd.');
    await acacia.locator('[data-dpc-v2="remove-sup-yes"]').click();
    await expect(boxOf(mat, 'Acacia Steel')).toHaveCount(0);
    await expect(mat.locator('.dpc-mat-notice')).toHaveText('Acacia Steel Pty Ltd was taken off this job. Nothing was sent to them.');
    await expect(mat.locator(`[data-dpc-v2-row="${LID(1)}"]`)).toHaveCount(0);
    expect(writes().map((c) => [c.action, c.body.supplier_id])).toEqual([
      ['dispatch_v2_remove_supplier', SID(2)],
      ['dispatch_v2_remove_supplier', SID(1)],
    ]);
  });

  test('taking off a box with a sent order keeps the sent email in Emails', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    fake.jobs['job-f1'].emails.push({
      id: EID(90), job_id: 'job-f1', supplier_id: SID(1), supplier_name: SUPPLIERS[SID(1)].name, from: ADMIN, test: null,
      status: 'sent', sent: { sent_at: '2026-10-28T01:00:00.000Z', sent_by_email: 'shaun@example.test', from: ADMIN, to: ['orders@acacia.example'], cc: [] },
      to: ['orders@acacia.example'], cc: [], subject: 'Material Order Ref SWF-920001', body_text: 'Hi Team', edited: false,
      delivery_date: '2026-11-04', fulfilment: 'delivery', line_count: 1, line_ids: [LID(1)], photo_ids: [], empty_detail_lines: [], last_error: null,
      updated_at: '2026-10-28T01:00:00.000Z',
    });
    const { mat } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    await acacia.locator('[data-dpc-v2="remove-sup"]').click();
    await expect(acacia.locator('.dpc-v2-rmask')).toContainText("The order already sent stays in this job's Emails.");
    await acacia.locator('[data-dpc-v2="remove-sup-yes"]').click();
    await expect(boxOf(mat, 'Acacia Steel')).toHaveCount(0);
    const item = page.locator('.dpc-mail-item', { hasText: 'Material Order Ref SWF-920001' });
    if (!(await item.count())) await page.locator('[data-dpc-mail-toggle]').click();
    await expect(item).toHaveCount(1);
    await item.click();
    await expect(page.locator('.dpc-mail-view')).toContainText('Acacia Steel Pty Ltd was taken off this job in Materials. This sent email is kept.');
    await expect(page.locator('.dpc-mail-view [data-dpc-mail-goto]')).toHaveCount(0);
  });

  test('a line is dragged into a box, between boxes and back to the Draft list, one move each; Move to does the same on a phone; a refused move goes back', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    // Tall enough that every box is on screen: a drag cannot scroll the page.
    const { mat, writes } = await boot(page, fake, { viewport: { width: 1440, height: 2200 } });
    const acacia = boxOf(mat, 'Acacia Steel');
    const banksia = boxOf(mat, 'Banksia Roofing');
    const stamp2 = fake.jobs['job-f1'].lines[1].updated_at;
    await mat.locator(`[data-dpc-v2-grip="${LID(2)}"]`).dragTo(acacia.locator('.dpc-suphead'));
    await expect(acacia.locator(`[data-dpc-v2-row="${LID(2)}"]`)).toBeVisible();
    await expect(draftOf(mat).locator(`[data-dpc-v2-row="${LID(2)}"]`)).toHaveCount(0);
    await expect.poll(() => writes().length).toBe(1);
    // The next move waits until this one has landed (the line's Move to is back on).
    await expect(rowOf(mat, 2).locator('[data-dpc-v2-move]')).toBeEnabled();
    expect(writes()[0].body).toEqual({ job_id: 'job-f1', id: LID(2), supplier_id: SID(1), expected_updated_at: stamp2, operator_email: expect.any(String) });
    // Between boxes.
    await mat.locator(`[data-dpc-v2-grip="${LID(2)}"]`).dragTo(banksia.locator('.dpc-suphead'));
    await expect(banksia.locator(`[data-dpc-v2-row="${LID(2)}"]`)).toBeVisible();
    await expect.poll(() => writes().length).toBe(2);
    await expect(rowOf(mat, 2).locator('[data-dpc-v2-move]')).toBeEnabled();
    expect(writes()[1].body.supplier_id).toBe(SID(2));
    // Back to the Draft list.
    await mat.locator(`[data-dpc-v2-grip="${LID(2)}"]`).dragTo(draftOf(mat).locator('.dpc-suphead'));
    await expect(draftOf(mat).locator(`[data-dpc-v2-row="${LID(2)}"]`)).toBeVisible();
    await expect.poll(() => writes().length).toBe(3);
    await expect(rowOf(mat, 2).locator('[data-dpc-v2-move]')).toBeEnabled();
    expect(writes()[2].body.supplier_id).toBeNull();
    // A drop on the box it is already in sends nothing.
    await mat.locator(`[data-dpc-v2-grip="${LID(2)}"]`).dragTo(draftOf(mat).locator('.dpc-v2-lines'));
    await page.waitForTimeout(100);
    expect(writes()).toHaveLength(3);
    await expect(mat.locator('.dpc-v2-over')).toHaveCount(0);

    // The Move to box: the way to move on a phone.
    await expect(rowOf(mat, 3).locator('[data-dpc-v2-move] option')).toHaveText(['Draft list', 'Acacia Steel Pty Ltd', 'Banksia Roofing']);
    await rowOf(mat, 3).locator('[data-dpc-v2-move]').selectOption(SID(2));
    await expect(banksia.locator(`[data-dpc-v2-row="${LID(3)}"]`)).toBeVisible();
    await expect.poll(() => writes().length).toBe(4);
    await expect(rowOf(mat, 3).locator('[data-dpc-v2-move]')).toBeEnabled();
    expect(writes()[3].body).toMatchObject({ id: LID(3), supplier_id: SID(2) });

    // Refused: the line goes back to where it was and says so, with no Retry.
    fake.fail.dispatch_v2_move_line = [{ status: 500, body: { error: 'e2e failure' } }];
    await rowOf(mat, 3).locator('[data-dpc-v2-move]').selectOption(SID(1));
    await expect(banksia.locator(`[data-dpc-v2-row="${LID(3)}"]`)).toContainText('Not moved. Move it again.');
    await expect(acacia.locator(`[data-dpc-v2-row="${LID(3)}"]`)).toHaveCount(0);
    await expect(rowOf(mat, 3).locator('.dpc-retry')).toHaveCount(0);
  });

  test('the main supplier tick on a fencing job sends one set_main_supplier, and the standing lines follow it; a patio job has no tick', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { root, mat, writes } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    const banksia = boxOf(mat, 'Banksia Roofing');
    // The default: the box with the panels.
    await expect(acacia.locator('.dpc-v2-main')).toContainText('Main supplier (default)');
    await expect(acacia.locator('[data-dpc-v2-main]')).toBeChecked();
    await expect(acacia.locator('.dpc-v2-standing .dpc-v2-rotext')).toHaveText(['4 x bags of quickset', 'Fixings, Post Caps and Screws as necessary']);
    await expect(banksia.locator('.dpc-v2-standing')).toHaveCount(0);
    await expect(banksia.locator('[data-dpc-v2-main]')).not.toBeChecked();
    await banksia.locator('[data-dpc-v2-main]').check();
    await expect(banksia.locator('.dpc-v2-standing')).toHaveCount(2);
    await expect(acacia.locator('.dpc-v2-standing')).toHaveCount(0);
    await expect(banksia.locator('.dpc-v2-main')).not.toContainText('(default)');
    expect(writes().map((c) => [c.action, c.body.supplier_id])).toEqual([['dispatch_v2_set_main_supplier', SID(2)]]);
    // Unticking the ticked box clears the tick: the default applies again.
    await banksia.locator('[data-dpc-v2-main]').uncheck();
    await expect(acacia.locator('.dpc-v2-standing')).toHaveCount(2);
    expect(writes().map((c) => [c.action, c.body.supplier_id])).toEqual([['dispatch_v2_set_main_supplier', SID(2)], ['dispatch_v2_set_main_supplier', null]]);
    // The standing lines are never editable or movable.
    await expect(acacia.locator('.dpc-v2-standing input, .dpc-v2-standing select')).toHaveCount(0);

    await root.locator('.dpc-job', { hasText: 'SWP-920002' }).click();
    await expect(root.locator('.dpc-jobhead h2')).toContainText('SWP-920002');
    await mat.locator('[data-dpc-v2="find"]').click();
    await mat.locator('.dpc-v2-res', { hasText: 'Banksia Roofing' }).click();
    await expect(boxOf(mat, 'Banksia Roofing')).toBeVisible();
    await expect(mat.locator('.dpc-v2-main, [data-dpc-v2-main], .dpc-v2-standing')).toHaveCount(0);
  });

  test('a supplier box shows its material stage; a pick sends one set_material_stage with the guard; a stage changed elsewhere shows the latest', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    const pick = acacia.locator('[data-dpc-v2-stage]');
    await expect(pick).toHaveValue('order_materials');
    await expect(pick.locator('option')).toHaveText(['Order materials', 'Sent to supplier', 'Quote received', 'Awaiting payment', 'Order confirmed', 'Manufacturing', 'Materials ready', 'Delivered']);
    await expect(acacia.locator('.dpc-v2-stage-who')).toHaveText('Worked out from the emails and lines');
    await pick.selectOption('awaiting_payment');
    await expect(acacia.locator('.dpc-card-msg')).toHaveText('Stage saved: Acacia Steel, Awaiting payment.');
    await expect(pick).toHaveValue('awaiting_payment');
    await expect(acacia.locator('.dpc-v2-stage-who')).toContainText('Set by shaun@ops.test');
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_set_material_stage', { box_id: 'box-' + SID(1), material_stage: 'awaiting_payment', expected_set_at: null, operator_email: expect.any(String) }]]);

    // Someone else marks it ready; this screen still shows Awaiting payment.
    const mine = fake.jobs['job-f1'].stages[SID(1)].set_at;
    fake.jobs['job-f1'].stages[SID(1)] = { key: 'ready', set_at: '2026-10-23T09:00:00.000Z', set_by_email: 'hugo@ops.test' };
    await pick.selectOption('delivered');
    await expect(mat).toContainText('This order\'s stage was changed somewhere else. Showing the latest.');
    await expect(pick).toHaveValue('ready');
    await expect(acacia.locator('.dpc-v2-stage-who')).toContainText('Set by hugo@ops.test');
    expect(writes().map((c) => c.body.expected_set_at)).toEqual([null, mine]);
    expect(writes().filter((c) => c.action !== 'dispatch_v2_set_material_stage')).toEqual([]);
  });

  test('a photo is shrunk to a JPEG and added; a photo too big and an iPhone HEIC photo are refused in plain words', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat } = await boot(page, fake);
    const input = mat.locator('input[data-dpc-v2-file="draft"]');
    await input.setInputFiles({ name: 'nithin-list.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(draftOf(mat)).toContainText('Photo added: nithin-list.jpg, 0.1 MB.');
    await expect(draftOf(mat).locator('.dpc-v2-photo')).toContainText('nithin-list.jpg');
    expect(fake.uploads[0]).toEqual({ file_name: 'nithin-list.jpg', head: 'data:image/jpeg;base64,' });

    fake.fail.dispatch_v2_upload_photo = [{ status: 413, body: { error: 'This photo is 4.2 MB.', code: 'photo_too_large', size_bytes: 4200000 } }];
    await input.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: PNG_1PX });
    await expect(draftOf(mat).locator('[role="alert"]')).toHaveText('This photo is too big to send (4.2 MB). Outlook takes 3 MB at most. Take a smaller photo, or a screenshot of it, and add that.');

    // A file the browser cannot open as a picture goes as it is; the server says why it cannot take it.
    fake.fail.dispatch_v2_upload_photo = [{ status: 400, body: { error: 'Only JPEG, PNG or WebP.', code: 'photo_type_not_allowed' } }];
    await input.setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not a picture a browser can open') });
    await expect(draftOf(mat).locator('[role="alert"]')).toHaveText('Dispatch can only send JPEG, PNG or WebP photos, and this file is another kind (an iPhone HEIC photo or a PDF, for example). ' +
      'Take a screenshot of it and add that, or on the iPhone set Camera, Formats to Most Compatible.');
    expect(fake.uploads[2]).toEqual({ file_name: 'IMG_0001.HEIC', head: 'data:image/heic;base64,' });
    // The refused photos were not added.
    await expect(draftOf(mat).locator('.dpc-v2-photo')).toHaveCount(1);
  });
});

// ── Slice 5: the order email ──────────────────────────────────────────────────

test.describe('Dispatch v2 Materials: order emails', () => {
  test('Make email holds an email: From fixed as admin@, To, CC, subject and body editable, nothing sent', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    await expect(acacia).toContainText('1 line to order. The email is held for you to check; nothing is sent until you press Send now and confirm.');
    await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_make_email', { job_id: 'job-f1', supplier_id: SID(1), delivery_date: '2026-11-04', rebuild: false, fulfilment: 'delivery', operator_email: expect.any(String) }]]);
    const mail = acacia.locator('.dpc-v2-mail');
    await expect(acacia).toContainText('Held email made. Nothing has been sent. Check it, then send.');
    await expect(mail.locator('.dpc-v2-mailhead')).toContainText('Held email, nothing sent yet');
    await expect(mail.locator('.dpc-field').first()).toContainText(ADMIN + ' Fixed. Sent through Outlook.');
    await expect(mail.locator('.dpc-field').first().locator('input')).toHaveCount(0);
    await expect(mail.locator('[data-dpc-v2-mf="to"]')).toHaveValue('orders@acacia.example');
    await expect(mail.locator('[data-dpc-v2-mf="cc"]')).toHaveValue('tony@acacia.example, fencing@secureworkswa.com.au');
    await expect(mail).toContainText('Team mailbox on the CC: fencing@secureworkswa.com.au.');
    await expect(mail.locator('[data-dpc-v2-mf="subject"]')).toHaveValue('Material Order Ref SWF-920001');
    const body = await mail.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(body).toContain('Hi Team, could we please order the following for delivery:');
    expect(body).toContain('Date: 4 November 2026');
    expect(body).toContain('1. 14 x 1800H standard width panels with 2400H posts\nProfile: Neetascreen\nColour: Monument');
    expect(body).toContain('2. 4 x bags of quickset\n\n3. Fixings, Post Caps and Screws as necessary');
    expect(body).not.toMatch(/[–—]/);
    // The Make email button is gone while the email is held.
    await expect(acacia.locator('[data-dpc-v2="make"]')).toHaveCount(0);

    // Leaving an edited field saves it once, on the email's stamp.
    const stamp = fake.jobs['job-f1'].emails[0].updated_at;
    await mail.locator('[data-dpc-v2-mf="subject"]').fill('Material Order Ref SWF-920001, Gwelup');
    await mail.locator('[data-dpc-v2-mf="subject"]').blur();
    await expect(mail).toContainText('Saved.');
    expect(writes()[1].body).toEqual({ email_id: EID(1), expected_updated_at: stamp, subject: 'Material Order Ref SWF-920001, Gwelup', operator_email: expect.any(String) });
    // A CC that is not an address is not saved and says so.
    await mail.locator('[data-dpc-v2-mf="cc"]').fill('tony@acacia.example, not-an-address');
    await mail.locator('[data-dpc-v2-mf="cc"]').blur();
    await expect(mail).toContainText('Not saved: not-an-address is not an email address.');
    expect(writes()).toHaveLength(2);
    expect(writes().filter((c) => c.action === 'dispatch_v2_send_email')).toEqual([]);
  });

  test('Delivery or pickup: Pickup flips the date label, sends fulfilment pickup, and a rebuild keeps it', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    const choice = acacia.locator('[data-dpc-v2-fulfil]');
    await expect(choice).toHaveValue('delivery');
    await expect(acacia.locator('.dpc-v2-date span').nth(1)).toHaveText('Delivery date');
    await choice.selectOption('pickup');
    await expect(acacia.locator('.dpc-v2-date span').nth(1)).toHaveText('Pickup date');
    // Picking sends nothing.
    expect(writes()).toHaveLength(0);
    await makeHeld(mat, 'Acacia Steel', '2026-11-02');
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_make_email', { job_id: 'job-f1', supplier_id: SID(1), delivery_date: '2026-11-02', rebuild: false, fulfilment: 'pickup', operator_email: expect.any(String) }]]);
    const body = await acacia.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(body).toContain('Hi Team, could we please order the following for pickup:');
    expect(body).not.toContain('Address:');
    // Rebuild keeps pickup.
    await acacia.locator('[data-dpc-v2="rebuild"]').click();
    await acacia.locator('[data-dpc-v2="rebuild-go"]').click();
    await expect(acacia).toContainText('Rebuilt from the lines. Your edits to it were lost.');
    expect(writes()[1].body).toMatchObject({ supplier_id: SID(1), rebuild: true, fulfilment: 'pickup' });
    // Discarded, the box keeps Pickup from the server's read.
    await acacia.locator('[data-dpc-v2="discard"]').click();
    await acacia.locator('[data-dpc-v2="discard-go"]').click();
    await expect(acacia).toContainText('Email discarded. Nothing was sent.');
    await expect(acacia.locator('[data-dpc-v2-fulfil]')).toHaveValue('pickup');
  });

  test('Delivery or pickup: a box the server says is a pickup opens on Pickup', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    // An earlier pickup order went to Acacia.
    await fake.api.dispatch_v2_make_email(null, { job_id: 'job-f1', supplier_id: SID(1), delivery_date: '2026-11-02', rebuild: false, fulfilment: 'pickup' });
    Object.assign(fake.jobs['job-f1'].emails[0], { status: 'sent', sent: { sent_at: '2026-10-28T01:00:00.000Z', sent_by_email: 'shaun@example.test', from: ADMIN, to: ['orders@acacia.example'], cc: [] } });
    const { mat } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    await expect(acacia.locator('[data-dpc-v2-fulfil]')).toHaveValue('pickup');
    await expect(acacia.locator('.dpc-v2-date span').nth(1)).toHaveText('Pickup date');
  });

  test('one open email per box: a second Make email is explained plainly and shows the email already waiting', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    // Another screen made Acacia's email after this one read the job.
    await fake.api.dispatch_v2_make_email(null, { job_id: 'job-f1', supplier_id: SID(1), delivery_date: '2026-11-04', rebuild: false });
    await boxOf(mat, 'Acacia Steel').locator('[data-dpc-v2="make"]').click();
    const acacia = boxOf(mat, 'Acacia Steel');
    await expect(acacia).toContainText('One email per supplier at a time. Acacia Steel already has an email waiting on this job: send it or discard it, then make the next one.');
    await expect(acacia.locator('.dpc-v2-mail')).toHaveCount(1);
    await expect(acacia).toContainText('One email per supplier at a time. Lines added to this box now need Rebuild from the lines, or go on the next email.');
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_make_email']);
    expect(fake.jobs['job-f1'].emails).toHaveLength(1);
  });

  test('Discard and Rebuild each ask first; Keep it sends nothing', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const acacia = await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    await acacia.locator('[data-dpc-v2="discard"]').click();
    await expect(acacia.locator('.dpc-v2-ask')).toContainText('Discard this email? Nothing has been sent.');
    await acacia.locator('[data-dpc-v2="ask-no"]').click();
    await expect(acacia.locator('.dpc-v2-ask')).toHaveCount(0);
    await acacia.locator('[data-dpc-v2="rebuild"]').click();
    await expect(acacia.locator('.dpc-v2-ask')).toContainText('Rebuild this email from the lines? Any edits to it are lost.');
    await acacia.locator('[data-dpc-v2="rebuild-go"]').click();
    await expect(acacia).toContainText('Rebuilt from the lines. Your edits to it were lost.');
    expect(writes()[1].body).toMatchObject({ supplier_id: SID(1), rebuild: true, delivery_date: '2026-11-04' });
    await acacia.locator('[data-dpc-v2="discard"]').click();
    await acacia.locator('[data-dpc-v2="discard-go"]').click();
    await expect(acacia).toContainText('Email discarded. Nothing was sent.');
    await expect(acacia.locator('[data-dpc-v2="make"]')).toBeEnabled();
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_make_email', 'dispatch_v2_make_email', 'dispatch_v2_discard_email']);
  });

  test('Send now is open straight away; the optional test confirm is marked TEST ONLY and sends test:true once, to admin@ only', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes, modal } = await boot(page, fake);
    const acacia = await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    // No test copy has gone, and Send now is still open (Shaun's ruling: the test is not compulsory).
    await expect(acacia.locator('[data-dpc-v2="send"]')).toBeEnabled();
    await expect(acacia).not.toContainText('Test first.');
    await expect(acacia.locator('.dpc-v2-hint', { hasText: 'A test copy is optional.' })).toHaveText('A test copy is optional. It goes to admin@ only, marked TEST ONLY; the supplier gets nothing.');
    await expect(acacia.locator('[data-dpc-v2="test"] .dpc-v2-testtag')).toHaveText('Test');

    await acacia.locator('[data-dpc-v2="test"]').click();
    await expect(modal).toBeVisible();
    await expect(modal).toHaveClass(/dpc-v2-modal-test/);
    await expect(modal.locator('.dpc-v2-testtag-big')).toHaveText('TEST ONLY');
    await expect(modal.locator('h3')).toHaveText('Send a test copy to admin@?');
    await expect(modal.locator('.dpc-v2-mfields')).toHaveText(['From', ADMIN, 'To', ADMIN, 'CC', 'None', 'Subject', 'TEST ONLY: Material Order Ref SWF-920001', 'Lines', '3 lines, no photo'].join(''));
    await expect(modal).toContainText('Only admin@ gets this copy, marked TEST ONLY. Acacia Steel gets nothing.');
    // Back to the email sends nothing; Escape closes it too.
    await modal.locator('[data-dpc-v2="modal-no"]').click();
    await expect(modal).toHaveCount(0);
    await acacia.locator('[data-dpc-v2="test"]').click();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    expect(writes().filter((c) => c.action === 'dispatch_v2_send_email')).toEqual([]);

    await acacia.locator('[data-dpc-v2="test"]').click();
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal).toHaveCount(0);
    const sends = writes().filter((c) => c.action === 'dispatch_v2_send_email');
    expect(sends.map((c) => c.body)).toEqual([{ email_id: EID(1), expected_updated_at: fake.jobs['job-f1'].emails[0].updated_at, test: true, confirm_resend: false, operator_email: expect.any(String) }]);
    await expect(acacia).toContainText('Test copy sent to admin@secureworkswa.com.au only. Check it in admin@, then press Send now when it looks right.');
    await expect(acacia.locator('[data-dpc-v2="send"]')).toBeEnabled();
    await expect(acacia.locator('.dpc-v2-hint', { hasText: 'A test copy is optional.' })).toHaveCount(0);
    await expect(acacia.locator('.dpc-v2-hint', { hasText: 'Test copy sent to' })).toBeVisible();
    // The email is still held: the test sent nothing to the supplier.
    expect(fake.jobs['job-f1'].emails[0].status).toBe('draft');
  });

  test('Send now asks "Send this order to Acacia Steel?" with From, To, CC, lines and photo, sends once, and the sent lines lock', async ({ page }) => {
    const seed = SPLIT();
    seed['job-f1'].photos = [{ id: PID(50), supplier_id: SID(1), file_name: 'site-list.jpg', content_type: 'image/jpeg', size_bytes: 812345, added_at: '2026-10-23T00:00:00.000Z' }];
    const fake = fakeV2(seed);
    // No test copy first: the send does not need one.
    fake.n.photo = 50;
    const { mat, writes, modal } = await boot(page, fake);
    const acacia = await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    await expect(acacia.locator('[data-dpc-v2-attach]')).toBeChecked();
    await acacia.locator('[data-dpc-v2="send"]').click();
    await expect(modal.locator('h3')).toHaveText('Send this order to Acacia Steel?');
    await expect(modal).not.toHaveClass(/dpc-v2-modal-test/);
    await expect(modal.locator('.dpc-v2-testtag-big')).toHaveCount(0);
    await expect(modal.locator('.dpc-v2-mfields')).toHaveText(['From', ADMIN, 'To', 'orders@acacia.example', 'CC', 'tony@acacia.example, fencing@secureworkswa.com.au',
      'Subject', 'Material Order Ref SWF-920001', 'Lines', '3 lines, 1 photo'].join(''));
    await expect(modal.locator('[data-dpc-v2="modal-go"]')).toBeFocused();
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal).toHaveCount(0);
    const sends = writes().filter((c) => c.action === 'dispatch_v2_send_email');
    expect(sends.map((c) => [c.body.test, c.body.confirm_resend])).toEqual([[false, false]]);
    await expect(acacia).toContainText('Sent to Acacia Steel from admin@. A copy is in admin@ Sent Items. Its lines are now locked.');
    // The line that went is a plain label, with no box, Move to or cross.
    const sent = acacia.locator(`[data-dpc-v2-row="${LID(1)}"]`);
    await expect(sent.locator('input, select, button')).toHaveCount(0);
    await expect(sent.locator('.dpc-v2-grip-off')).toHaveCount(1);
    await expect(sent.locator('.dpc-status')).toContainText('Sent');
    await expect(sent).toContainText('14 x 1800H standard width panels with 2400H posts');
    await expect(acacia.locator('.dpc-v2-sentitem summary')).toContainText('Material Order Ref SWF-920001');
    await expect(acacia).toContainText('Everything here has gone. Add a line or a photo to order more.');
    await expect(acacia.locator('[data-dpc-v2="make"]')).toBeDisabled();
    // A photo that went is kept on the box, with no Move to or cross.
    await expect(acacia.locator('.dpc-v2-photo')).toContainText('Sent');
    await expect(acacia.locator('.dpc-v2-photo [data-dpc-v2="photo-del"]')).toHaveCount(0);
    // Every write was a dispatch_v2_* action; only the one press sent.
    expect(writes().every((c) => /^dispatch_v2_/.test(c.action))).toBe(true);
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_make_email', 'dispatch_v2_send_email']);
  });

  test('a send that may have gone asks for a check of Sent Items, and goes again only with confirm_resend; a send not noted is never offered again', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    fake.testDone = true;
    fake.sendOutcome = ['unknown'];
    const { mat, writes, modal } = await boot(page, fake);
    const acacia = await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    await acacia.locator('[data-dpc-v2="send"]').click();
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal).toHaveCount(0);
    await expect(acacia.locator('.dpc-v2-callout.dpc-v2-bad')).toContainText('This email may have gone. We could not tell whether it reached Acacia Steel. Look in admin@ Sent Items for "Material Order Ref SWF-920001".');
    await expect(acacia.locator('[data-dpc-v2="send"], [data-dpc-v2="test"], .dpc-v2-mail')).toHaveCount(0);
    await acacia.locator('[data-dpc-v2="resend"]').click();
    await expect(modal.locator('h3')).toHaveText('Send this order to Acacia Steel again?');
    await expect(modal).toContainText('Only send again if the email is not in admin@ Sent Items. If it did go, Acacia Steel gets it twice.');
    fake.sendOutcome = ['unrecorded'];
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal).toHaveCount(0);
    const sends = writes().filter((c) => c.action === 'dispatch_v2_send_email');
    expect(sends.map((c) => [c.body.test, c.body.confirm_resend])).toEqual([[false, false], [false, true]]);
    // It went but was not noted: said plainly, and no button sends it again.
    await expect(acacia.locator('.dpc-v2-callout.dpc-v2-bad')).toHaveText('This email went to Acacia Steel, but Dispatch could not note it. Do not send it again.');
    await expect(acacia).toContainText('Do not send it again. Tell Shaun so it can be put right.');
    await expect(acacia.locator('[data-dpc-v2="send"], [data-dpc-v2="resend"], [data-dpc-v2="test"], [data-dpc-v2="make"]')).toHaveCount(0);
  });

  test('a refused send stays in the confirm and says what to do; a blank Date line stops the send before the confirm', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    fake.testDone = true;
    const { mat, writes, modal } = await boot(page, fake);
    // No delivery date: the Date line is blank.
    const acacia = await makeHeld(mat, 'Acacia Steel');
    await expect(acacia.locator('.dpc-v2-warn', { hasText: 'Date line' })).toHaveText('The Date line is blank. Fill it in before sending.');
    await acacia.locator('[data-dpc-v2="send"]').click();
    await expect(acacia).toContainText('Fill in the Date line in the email first. Dispatch will not send it with a blank one.');
    await expect(modal).toHaveCount(0);
    // The date is filled in (here, in the stub) and the page opened again.
    fake.jobs['job-f1'].emails[0].empty_detail_lines = [];
    fake.fail.dispatch_v2_send_email = [{ status: 409, body: { error: 'Lines changed.', code: 'order_lines_changed' } }];
    await page.reload();
    await expect(mat.locator('.dpc-v2-draft')).toBeVisible();
    await boxOf(mat, 'Acacia Steel').locator('[data-dpc-v2="send"]').click();
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal.locator('[role="alert"]')).toHaveText('The lines in this box changed after the email was made. Go back, press Rebuild from the lines, check the email, then send.');
    await expect(modal.locator('[data-dpc-v2="modal-go"]')).toBeEnabled();
    expect(writes().filter((c) => c.action === 'dispatch_v2_send_email')).toHaveLength(1);
    expect(fake.jobs['job-f1'].emails[0].status).toBe('draft');
  });
});

// ── Tweak 5: an order that is just a photo; Tweak 6: no Contact on a pickup ──

// A photo already on a supplier box (made up), for the photo-only order.
const BOX_PHOTO = (n, supplierId) => ({ id: PID(n), supplier_id: supplierId, file_name: `drawing-${n}.jpg`, content_type: 'image/jpeg', size_bytes: 120000, added_at: '2026-10-23T00:30:00.000Z' });
const SHOT = (name) => (process.env.DPC_SHOT ? process.env.DPC_SHOT + '-' + name + '.png' : null);

test.describe('Dispatch v2 Materials: photo-only orders and pickups (Tweaks 5 and 6)', () => {
  test('a box with no line and no photo keeps Make email off and says to add a line or a photo', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    const banksia = boxOf(mat, 'Banksia');
    await expect(banksia.locator('[data-dpc-v2="make"]')).toBeDisabled();
    await expect(banksia.locator('.dpc-v2-make + .dpc-v2-hint')).toHaveText('Add a line or a photo to make an email.');
    expect(writes()).toHaveLength(0);
  });

  test('a box with only a photo makes a photo-only email: Please see attached, no numbered line, no standing lines; sent, it does not light up again', async ({ page }) => {
    const seed = SPLIT();
    seed['job-f1'].photos = [BOX_PHOTO(1, SID(2))];
    const fake = fakeV2(seed);
    fake.n.photo = 1;
    const { mat, writes, modal } = await boot(page, fake);
    const banksia = boxOf(mat, 'Banksia');
    const make = banksia.locator('[data-dpc-v2="make"]');
    await expect(make).toBeEnabled();
    await expect(banksia.locator('.dpc-v2-photoonly')).toHaveText('Photos only: the email will say Please see attached for materials needed.');
    if (SHOT('photo-only-box')) await banksia.screenshot({ path: SHOT('photo-only-box') });
    await makeHeld(mat, 'Banksia', '2026-11-10');
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_make_email', { job_id: 'job-f1', supplier_id: SID(2), delivery_date: '2026-11-10', rebuild: false, fulfilment: 'delivery', operator_email: expect.any(String) }]]);
    const body = await banksia.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(body).toBe([
      'Hi Team, could we please order the following for delivery:',
      '',
      'Date: 10 November 2026',
      'Address: 12 Example Street, Gwelup',
      'Contact: 0400 000 000 (Jane)',
      '',
      'Materials Needed:',
      '',
      'Please see attached for materials needed.',
      '',
      '',
      'Please confirm when you can, thank you.',
    ].join('\n'));
    expect(body).not.toMatch(/^\d+\. /m);
    expect(body).not.toContain('quickset');
    await expect(banksia.locator(`[data-dpc-v2-attach="${PID(1)}"]`)).toBeChecked();
    if (SHOT('photo-only-email')) await banksia.locator('.dpc-v2-mail').screenshot({ path: SHOT('photo-only-email') });
    // Send it: the confirm says no lines and one photo.
    await banksia.locator('[data-dpc-v2="send"]').click();
    await expect(modal.locator('h3')).toHaveText('Send this order to Banksia?');
    await expect(modal.locator('.dpc-v2-mfields')).toContainText('0 lines, 1 photo');
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal).toHaveCount(0);
    await expect(banksia).toContainText('Sent to Banksia');
    // The photo went: nothing left to order until a line or a new photo is added.
    await expect(banksia.locator('[data-dpc-v2="make"]')).toBeDisabled();
    await expect(banksia).toContainText('Everything here has gone. Add a line or a photo to order more.');
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_make_email', 'dispatch_v2_send_email']);
    expect(await mat.innerText()).not.toMatch(/[\u2013\u2014]/);
  });

  test('photos with lines: the lines are numbered, then Please also see attached; the hint counts the photo', async ({ page }) => {
    const seed = SPLIT();
    seed['job-f1'].photos = [BOX_PHOTO(1, SID(1))];
    const fake = fakeV2(seed);
    fake.n.photo = 1;
    const { mat } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    await expect(acacia.locator('.dpc-v2-make + .dpc-v2-hint')).toContainText('1 line to order, with 1 photo attached.');
    await makeHeld(mat, 'Acacia Steel', '2026-11-04');
    const body = await acacia.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(body).toContain('3. Fixings, Post Caps and Screws as necessary\n\nPlease also see attached.\n\n\nPlease confirm');
  });

  test('a photo-only email with its photo taken off says so, and the refused send stays in the confirm', async ({ page }) => {
    const seed = SPLIT();
    seed['job-f1'].photos = [BOX_PHOTO(1, SID(2))];
    const fake = fakeV2(seed);
    fake.n.photo = 1;
    const { mat, writes, modal } = await boot(page, fake);
    const banksia = await makeHeld(mat, 'Banksia', '2026-11-10');
    await banksia.locator(`[data-dpc-v2-attach="${PID(1)}"]`).uncheck();
    await expect(banksia).toContainText('Saved.');
    await expect(banksia.locator('.dpc-v2-warn', { hasText: 'no lines and no photo' })).toHaveText('This email has no lines and no photo. Tick a photo, or discard it.');
    await banksia.locator('[data-dpc-v2="send"]').click();
    await modal.locator('[data-dpc-v2="modal-go"]').click();
    await expect(modal.locator('[role="alert"]')).toHaveText('This email has no lines and no photo. Go back and tick a photo on it, or discard it.');
    expect(fake.jobs['job-f1'].emails[0].status).toBe('draft');
    expect(writes().map((c) => c.action)).toEqual(['dispatch_v2_make_email', 'dispatch_v2_save_email', 'dispatch_v2_send_email']);
  });

  test('Tweak 6: a pickup email has no Contact line and no Address line; a delivery keeps both', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat } = await boot(page, fake);
    const acacia = boxOf(mat, 'Acacia Steel');
    await acacia.locator('[data-dpc-v2-fulfil]').selectOption('pickup');
    await makeHeld(mat, 'Acacia Steel', '2026-11-02');
    const body = await acacia.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(body.split('\n').slice(0, 5)).toEqual([
      'Hi Team, could we please order the following for pickup:',
      '',
      'Date: 2 November 2026',
      '',
      'Materials Needed:',
    ]);
    expect(body).not.toContain('Contact:');
    expect(body).not.toContain('Address:');
    await expect(acacia.locator('.dpc-v2-warn')).toHaveCount(0);
    if (SHOT('pickup-email')) await acacia.locator('.dpc-v2-mail').screenshot({ path: SHOT('pickup-email') });
    // Discarded and made again as a delivery: the Address and Contact lines are back.
    await acacia.locator('[data-dpc-v2="discard"]').click();
    await acacia.locator('[data-dpc-v2="discard-go"]').click();
    await expect(acacia).toContainText('Email discarded. Nothing was sent.');
    await acacia.locator('[data-dpc-v2-fulfil]').selectOption('delivery');
    await makeHeld(mat, 'Acacia Steel', '2026-11-02');
    const delivery = await acacia.locator('[data-dpc-v2-mf="body"]').inputValue();
    expect(delivery).toContain('\nAddress: 12 Example Street, Gwelup\nContact: 0400 000 000 (Jane)\n');
  });
});

// ── The phone width ───────────────────────────────────────────────────────────

test('at 390 the Draft list, the boxes, the held email and the confirm have no sideways scroll, and the buttons are finger sized', async ({ page }) => {
  const fake = fakeV2(SPLIT());
  fake.testDone = true;
  const { root, mat, modal } = await boot(page, fake, { viewport: { width: 390, height: 844 } });
  const acacia = await makeHeld(mat, 'Acacia Steel', '2026-11-04');
  const wide = () => root.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await wide()).toBeLessThanOrEqual(0);
  const sec = await mat.boundingBox();
  expect(sec.x).toBeGreaterThanOrEqual(0);
  expect(sec.x + sec.width).toBeLessThanOrEqual(390);
  // Each line control is inside the section.
  for (const sel of ['[data-dpc-v2-move]', '[data-dpc-v2-cell="description"]', '[data-dpc-v2="del"]', '[data-dpc-v2="send"]', '[data-dpc-v2-mf="body"]']) {
    const b = await mat.locator(sel).first().boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(sec.x + sec.width + 0.5);
  }
  expect((await rowOf(mat, 2).locator('[data-dpc-v2-move]').boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await acacia.locator('[data-dpc-v2="send"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await acacia.locator('[data-dpc-v2="send"]').click();
  const m = await modal.boundingBox();
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(390);
  expect(await wide()).toBeLessThanOrEqual(0);
  expect(await mat.innerText()).not.toMatch(/[–—]/);
  expect(await modal.innerText()).not.toMatch(/[–—]/);
});

// ── Tweak 4 (5 Nov 2026): a simpler supplier picker ─────────────────────────
// Shaun: "when I search B&D Metals I see 3 of them. Show me the one we use
// most, and put the other ones under Show more." The stub answers the way
// ops-api dispatch_v2_supplier_search does after Tweak 4 (backend
// dispatch_v2_supplier_picker.ts): one row per approved supplier on its main
// Xero contact, the other contacts and every other supplier under Show more,
// and a search that ignores case, punctuation, "&" and "and". Desktop only.
const T4_SHOTS = path.resolve(__dirname, '..', '..', 'test-results', 'dispatch-tweak4');
const T4 = { bd1: SID(41), bd2: SID(42), bd3: SID(43), rr1: SID(44), rr2: SID(45), oneOff: SID(46) };

// The same search key as the backend: "B&D", "b and d", "bnd" and "bd" are all "bd".
const t4Key = (v) => {
  const w = String(v || '').toLowerCase().replace(/[&+]/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < w.length; i++) {
    if (w[i].length === 1 && i + 2 < w.length && (w[i + 1] === 'and' || w[i + 1] === 'n') && w[i + 2].length === 1) {
      out.push(w[i] + w[i + 2]);
      i += 2;
      continue;
    }
    const m = /^([b-df-hj-np-tv-z])n([b-df-hj-np-tv-z])$/.exec(w[i]);
    out.push(m ? m[1] + m[2] : w[i]);
  }
  return out.join('');
};

// Three approved suppliers: BD Metals (three Xero contacts, the busiest is the
// main one), RnR Fencing (two) and Unique Laser (none yet), plus a one-off.
const T4_ENTRIES = [
  { id: 'ap-bd', name: 'BD Metals', used_for: 'fencing', to: ['orders@bd.example'], contacts: [
    { sid: T4.bd1, name: 'Jaiama Investments Pty Ltd T/A B&D Metals Group Pty', bills: 36 },
    { sid: T4.bd2, name: 'Jaiama Investments T/a B&D Metals', bills: 0 },
    { sid: T4.bd3, name: 'Jaiaina Investments Pty Ltd T/A B&D Metals Group Pty', bills: 0 },
  ] },
  { id: 'ap-rr', name: 'RnR Fencing', used_for: 'fencing', to: ['orders@rr.example'], contacts: [
    { sid: T4.rr1, name: 'R&R FENCING', bills: 217 },
    { sid: T4.rr2, name: 'R&R Fencing (KVS (WA) Pty Ltd)', bills: 0 },
  ] },
  { id: 'ap-ul', name: 'Unique Laser', used_for: 'any', to: ['orders@unique-laser.example'], contacts: [] },
];
const T4_OTHERS = [{ sid: T4.oneOff, name: 'B and D Steel Supplies' }];

function t4Search(url) {
  const q = t4Key(url.searchParams.get('q'));
  const hit = (n) => !q || t4Key(n).includes(q);
  const approved = [];
  const more = [];
  for (const e of T4_ENTRIES) {
    if (!hit(e.name) && !e.contacts.some((c) => hit(c.name))) continue;
    const base = { approved_id: e.id, approved_name: e.name, used_for: e.used_for, to: e.to, cc: [], on_account: false, has_approved_email: true };
    const [main, ...rest] = e.contacts;
    approved.push(Object.assign({}, base, main
      ? { name: e.name, supplier_id: main.sid, xero_name: main.name, main_reason: 'most_bills', bills_12m: main.bills, other_contacts: rest.length, can_add: true, note: null }
      : { name: e.name, supplier_id: null, xero_name: null, main_reason: null, bills_12m: null, other_contacts: 0, can_add: false, note: 'Add to Xero first: this supplier has no Xero contact yet' }));
    for (const c of rest) more.push(Object.assign({}, base, { name: c.name, supplier_id: c.sid, xero_name: c.name, bills_12m: c.bills, can_add: true, note: null }));
  }
  const others = T4_OTHERS.filter((o) => hit(o.name)).map((o) => ({
    supplier_id: o.sid, name: o.name, approved_id: null, approved_name: null, used_for: null, to: [], cc: [],
    has_approved_email: false, can_add: true, note: 'No approved order email: Dispatch will not send to this supplier',
  }));
  return { q: url.searchParams.get('q'), ranking: 'bills', approved, more_approved: more, others };
}

test.describe('Dispatch v2 Tweak 4: the simpler supplier picker', () => {
  const openFind = async (page) => {
    const booted = await boot(page, fakeV2(SPLIT()), {
      api: {
        dispatch_v2_supplier_search: t4Search,
        // Only the contact the pick sends matters here, so the add is refused.
        dispatch_v2_add_supplier: () => ({ status: 409, body: { error: 'Stub: not added', code: 'stub' } }),
      },
    });
    await booted.mat.locator('[data-dpc-v2="find"]').click();
    const find = booted.mat.locator('.dpc-v2-find');
    await expect(find.locator('[data-dpc-v2-q]')).toBeFocused();
    await expect.poll(() => booted.of('dispatch_v2_supplier_search').length).toBe(1);
    return Object.assign(booted, { find });
  };
  // Types a search and waits for its read.
  const search = async (find, of, q) => {
    const before = of('dispatch_v2_supplier_search').length;
    await find.locator('[data-dpc-v2-q]').fill(q);
    await expect.poll(() => of('dispatch_v2_supplier_search').length).toBeGreaterThan(before);
  };

  test('b&d, bd and "b and d" all show one BD Metals row on its busiest Xero contact; the rest is under Show more', async ({ page }) => {
    const { find, of } = await openFind(page);
    for (const q of ['bd', 'b and d', 'b&d']) {
      await search(find, of, q);
      await expect(find.locator('.dpc-v2-res strong')).toHaveText(['BD Metals']);
    }
    const row = find.locator('.dpc-v2-res', { hasText: 'BD Metals' }).first();
    await expect(row).toContainText('Xero: Jaiama Investments Pty Ltd T/A B&D Metals Group Pty');
    await expect(row).toContainText('2 more Xero contacts under Show more');
    await expect(row).toBeEnabled();
    await expect(find.locator('[data-dpc-v2="find-more"]')).toHaveText('Show more (3)');
    await page.screenshot({ path: path.join(T4_SHOTS, 'search-b-and-d-one-row.png') });

    await find.locator('[data-dpc-v2="find-more"]').click();
    await expect(find.locator('.dpc-mat-h4')).toHaveText(['Approved suppliers', 'Other Xero contacts of approved suppliers', 'All other suppliers']);
    await expect(find.locator('.dpc-v2-res strong')).toHaveText([
      'BD Metals',
      'Jaiama Investments T/a B&D Metals',
      'Jaiaina Investments Pty Ltd T/A B&D Metals Group Pty',
      'B and D Steel Supplies',
    ]);
    await expect(find.locator('.dpc-v2-res', { hasText: 'Jaiama Investments T/a B&D Metals' })).toContainText('Another Xero contact of BD Metals');
    await expect(find.locator('.dpc-v2-res', { hasText: 'B and D Steel Supplies' })).toContainText('No approved order email');
    await page.screenshot({ path: path.join(T4_SHOTS, 'search-b-and-d-show-more.png') });
    await find.locator('[data-dpc-v2="find-more"]').click();
    await expect(find.locator('[data-dpc-v2="find-more"]')).toHaveText('Show more (3)');
    expect(await find.innerText()).not.toMatch(/[\u2013\u2014]/);

    // Picking the row makes the box on the main contact.
    await find.locator('.dpc-v2-res', { hasText: 'BD Metals' }).first().click();
    await expect.poll(() => of('dispatch_v2_add_supplier').length).toBe(1);
    expect(of('dispatch_v2_add_supplier')[0].body.supplier_id).toBe(T4.bd1);
  });

  test('rnr, r&r and "r and r" all find RnR Fencing', async ({ page }) => {
    const { find, of } = await openFind(page);
    for (const q of ['r&r', 'r and r', 'rnr']) {
      await search(find, of, q);
      await expect(find.locator('.dpc-v2-res strong')).toHaveText(['RnR Fencing']);
    }
    await expect(find.locator('.dpc-v2-res', { hasText: 'RnR Fencing' })).toContainText('Xero: R&R FENCING');
    await expect(find.locator('.dpc-v2-res', { hasText: 'RnR Fencing' })).toContainText('1 more Xero contact under Show more');
    await expect(find.locator('[data-dpc-v2="find-more"]')).toHaveText('Show more (1)');
    await page.screenshot({ path: path.join(T4_SHOTS, 'search-rnr.png') });
  });

  test('an approved supplier with no Xero contact shows greyed with Add to Xero first; a one-off is found by typing', async ({ page }) => {
    const { find, of } = await openFind(page);
    await search(find, of, 'unique');
    const row = find.locator('.dpc-v2-res', { hasText: 'Unique Laser' });
    await expect(row).toBeDisabled();
    await expect(row).toHaveClass(/dpc-v2-res-noxero/);
    await expect(row).toContainText('Add to Xero first: this supplier has no Xero contact yet');
    await page.screenshot({ path: path.join(T4_SHOTS, 'greyed-no-xero.png') });
    // No approved supplier matches: Show more opens by itself.
    await search(find, of, 'steel');
    await expect(find.locator('.dpc-mat-h4')).toHaveText(['Approved suppliers', 'All other suppliers']);
    await expect(find.locator('.dpc-v2-res strong')).toHaveText(['B and D Steel Supplies']);
    await expect(find.locator('[data-dpc-v2="find-more"]')).toHaveCount(0);
  });
});
