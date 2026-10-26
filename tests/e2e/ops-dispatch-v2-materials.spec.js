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
// An approved entry no Xero contact is linked to yet: listed, never addable.
const UNLINKED = { approved_id: 'ap-9', approved_name: 'Coastal Fencing', used_for: 'fencing', to: ['yard@coastal.example'], cc: [], has_approved_email: true, supplier_id: null, name: null, can_add: false, note: null };
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
  const fake = { jobs: {}, testDone: false, fail: {}, sendOutcome: [], uploads: [], n: { photo: 0, email: 0 } };
  const NUMS = { 'job-f1': 'SWF-920001', 'job-p1': 'SWP-920002' };
  const TYPES = { 'job-f1': 'fencing', 'job-p1': 'patio' };
  const SCOPE = {
    'job-f1': [['1800H standard width panels with 2400H posts', 14], ['2400H posts', 15]],
    'job-p1': [['Solarspan 75mm roof panels', 8]],
  };
  const job = (id) => fake.jobs[id] || (fake.jobs[id] = { work_type: TYPES[id], job_number: NUMS[id], boxes: [], lines: [], photos: [], emails: [], main: null });
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
      draft_list: { lines: j.lines.filter((l) => l.supplier_id === null).map(lineOut), photos: j.photos.filter((p) => p.supplier_id === null) },
      suppliers: j.boxes.map((sid, i) => {
        const s = SUPPLIERS[sid];
        const open = j.emails.find((m) => m.supplier_id === sid && isOpen(m));
        return {
          supplier_id: sid, name: s.name, active: true, position: i + 1, is_main: sid === main,
          approved_email: s.approved, send_blocked: s.approved ? null : { code: 'no_approved_email', message: BLOCK_MSG },
          lines: j.lines.filter((l) => l.supplier_id === sid).map(lineOut), photos: j.photos.filter((p) => p.supplier_id === sid),
          open_email: open ? emailOut(open) : null, sent_emails: j.emails.filter((m) => m.supplier_id === sid && m.status === 'sent').map(emailOut),
        };
      }),
    };
  };
  const bodyOf = (j, sid, lines, date) => {
    const main = j.work_type === 'fencing' && mainOf(j) === sid;
    const items = lines.map((l) => [`${l.quantity != null ? l.quantity + (l.unit ? ' ' + l.unit : '') + ' x ' : ''}${l.description}`]
      .concat(l.detail ? [l.detail] : [], l.profile ? ['Profile: ' + l.profile] : [], l.colour ? ['Colour: ' + l.colour] : []).join('\n'));
    if (main) items.push('4 x bags of quickset', 'Fixings, Post Caps and Screws as necessary');
    return {
      main, count: items.length,
      text: 'Hi Team, could we please order the following for delivery:\n\nDate: ' + longDate(date) + '\nAddress: 12 Example Street, Gwelup\nContact: 0400 000 000 (Jane)\n\nMaterials Needed:\n\n' +
        items.map((t, i) => `${i + 1}. ${t}`).join('\n\n') + '\n\n\nPlease confirm when you can, thank you.',
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
      const approved = Object.keys(SUPPLIERS).filter((sid) => SUPPLIERS[sid].approved).map((sid) => {
        const a = SUPPLIERS[sid].approved;
        return { approved_id: a.id, approved_name: a.name, used_for: a.used_for, to: a.to, cc: a.cc, has_approved_email: true, supplier_id: sid, name: SUPPLIERS[sid].name, can_add: true, note: null };
      }).concat([UNLINKED]).filter((r) => hit(r.name) || hit(r.approved_name));
      const others = Object.keys(SUPPLIERS).filter((sid) => !SUPPLIERS[sid].approved).map((sid) => ({
        supplier_id: sid, name: SUPPLIERS[sid].name, approved_id: null, approved_name: null, used_for: null, to: [], cc: [], has_approved_email: false, can_add: true,
        note: 'No approved order email: Dispatch will not send to this supplier',
      })).filter((r) => hit(r.name));
      return { q: q || null, approved, others };
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
      if (j.lines.length) return no(409, 'lines_exist');
      const added = (SCOPE[b.job_id] || []).map(([d, q], i) => ({ id: LID(800 + i), supplier_id: null, description: d, quantity: q, unit: null, detail: null, profile: null, colour: null,
        status: 'not_reviewed', source: 'scope', sent_on_email_id: null, updated_at: stamp() }));
      j.lines.push(...added);
      return { success: true, added: added.length, lines: added.map(lineOut), notes: ['1 panel is marked long width in the scope. Check the panel line with the supplier.'] };
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
    dispatch_v2_remove_supplier: (url, b) => {
      const j = job(b.job_id);
      if (j.lines.some((l) => l.supplier_id === b.supplier_id) || j.photos.some((p) => p.supplier_id === b.supplier_id)) return no(409, 'supplier_has_lines');
      j.boxes = j.boxes.filter((x) => x !== b.supplier_id);
      return { success: true };
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
      const lines = j.lines.filter((l) => l.supplier_id === b.supplier_id && !l.sent_on_email_id && l.status !== 'in_stock');
      if (!lines.length) return no(409, 'no_lines_to_order');
      const date = b.delivery_date || null;
      const built = bodyOf(j, b.supplier_id, lines, date);
      const team = TEAM[j.work_type] || null;
      const m = open || { id: EID(++fake.n.email), job_id: b.job_id, supplier_id: b.supplier_id, supplier_name: s.name, from: ADMIN, test: null, sent: null };
      Object.assign(m, {
        status: 'draft', to: s.approved.to.slice(), cc: s.approved.cc.concat(team ? [team] : []), team_cc: team,
        subject: 'Material Order Ref ' + j.job_number, body_text: built.text, edited: false, delivery_date: date,
        is_main_supplier: built.main, standing_lines_included: built.main, line_count: built.count, line_ids: lines.map((l) => l.id),
        photo_ids: j.photos.filter((p) => p.supplier_id === b.supplier_id).slice(0, 3).map((p) => p.id),
        empty_detail_lines: date ? [] : ['date'], last_error: null, updated_at: stamp(),
      });
      if (!open) j.emails.push(m);
      return { success: true, email: emailOut(m), missing: m.empty_detail_lines, team_cc_open_question: null, rebuilt: !!b.rebuild || undefined };
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

  test('Add supplier lists the approved order emails first, then every other supplier; one without an approved email is added with sending blocked', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes, of } = await boot(page, fake);
    await mat.locator('[data-dpc-v2="find"]').click();
    const find = mat.locator('.dpc-v2-find');
    await expect(find.locator('[data-dpc-v2-q]')).toBeFocused();
    await expect(find.locator('.dpc-mat-h4')).toHaveText(['Approved order emails', 'All other suppliers']);
    await expect(find.locator('.dpc-v2-res strong')).toHaveText(['Acacia Steel Pty Ltd', 'Banksia Roofing', 'Coastal Fencing', 'Plain Hardware']);
    // On the job already, and an approved entry with no Xero contact, cannot be pressed.
    await expect(find.locator('.dpc-v2-res', { hasText: 'Acacia Steel Pty Ltd' })).toBeDisabled();
    await expect(find.locator('.dpc-v2-res', { hasText: 'Acacia Steel Pty Ltd' })).toContainText('On this job');
    await expect(find.locator('.dpc-v2-res', { hasText: 'Coastal Fencing' })).toBeDisabled();
    await expect(find.locator('.dpc-v2-res', { hasText: 'Coastal Fencing' })).toContainText('Not linked to a Xero contact yet. Ask Shaun to name the contact.');
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

  test('a box with nothing in it can be taken off; a box with a line has no cross', async ({ page }) => {
    const fake = fakeV2(SPLIT());
    const { mat, writes } = await boot(page, fake);
    await expect(boxOf(mat, 'Acacia Steel').locator('[data-dpc-v2="remove-sup"]')).toHaveCount(0);
    await boxOf(mat, 'Banksia Roofing').locator('[data-dpc-v2="remove-sup"]').click();
    await expect(boxOf(mat, 'Banksia Roofing')).toHaveCount(0);
    expect(writes().map((c) => [c.action, c.body.supplier_id])).toEqual([['dispatch_v2_remove_supplier', SID(2)]]);
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
    expect(writes().map((c) => [c.action, c.body])).toEqual([['dispatch_v2_make_email', { job_id: 'job-f1', supplier_id: SID(1), delivery_date: '2026-11-04', rebuild: false, operator_email: expect.any(String) }]]);
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
    await expect(acacia).toContainText('Every line here has gone. Add a line to order more.');
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
