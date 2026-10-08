// Offline fixture for the Debt Workshop screen (docs/debt-workshop.md).
// Shapes follow the build contract, secureworks-wiki coding/capabilities/debt-follow-up/
// debt-workshop-spec.md section 8: debt_ws_overview, debt_ws_job (plus flags[] and the
// overview's flag_count), debt_ws_document, debt_ws_statement_preview and debt_ws_jan_list.
// Every name, address, phone and email is made up. Dates are derived from today's Perth date
// at run time, so days and "today" never rot as the real calendar moves on.
const { perthDate, addIsoDays } = require('../helpers/feed-stub');

function uuid(n) { return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }

// A one-page PDF and a 1 x 1 PNG, enough for the document modal.
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 300]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n').toString('base64');
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function buildDebtWorkshopFixture(today = perthDate(), opts = {}) {
  const d = (n) => addIsoDays(today, n);
  const at = (n, hm) => d(n) + 'T' + hm + ':00+08:00';
  const settings = Object.assign({ tab_visible: false, sending_on: false, agent_on: false, viewer_is_owner: true }, opts.settings || {});

  const row = (n, o) => Object.assign({
    share_key: uuid(9000 + n), xero_invoice_id: uuid(9000 + n), invoice_number: 'INV-' + (9000 + n),
    reference: (o.job_type === 'patio' ? 'SWP-' : 'SWF-') + (90000 + n) + '-FINBAL', job_id: uuid(500 + n),
    job_number: (o.job_type === 'patio' ? 'SWP-' : 'SWF-') + (90000 + n), lane: 'homeowner', neighbour_of: null, kind: 'final',
    invoice_date: d(-(o.day || 0)), due_date: d(-(o.day || 0)), step_due: null, next_step: null, paused_until: null,
    suggestion: null, ghl_linked: true, last_touch: null, on_jan_list: false, flag_count: 0,
  }, o, { payer_label: o.payer_label || o.payer_name });

  const rows = [
    row(1, { payer_name: 'Avery Lin', job_type: 'fencing', amount_due: 1351.63, day: 2, category: 'active', step_due: { step: 'd1', label: 'Day 1 text' }, ghl_linked: false }),
    row(2, { payer_name: 'Jordan Pike', job_type: 'patio', kind: 'progress', reference: 'SWP-90002-MAT', amount_due: 3932.06, day: 4, invoice_date: d(-11), category: 'active', next_step: { step: 'd7', date: d(3) } }),
    row(3, { payer_name: 'Casey Morgan', job_type: 'fencing', amount_due: 1420.37, day: 12, category: 'escalating', step_due: { step: 'd12', label: 'Day 12 text' }, suggestion: { id: 'sug-casey-d12', source: 'template', status: 'pending' }, flag_count: 1, last_touch: { kind: 'text_sent', at: at(-5, '12:35'), label: 'Day 7 text sent' } }),
    row(4, { payer_name: 'Riley Shaw', payer_label: 'Riley Shaw (neighbour of Taylor Brooks)', neighbour_of: 'Taylor Brooks', reference: 'SWF-90004-B-FINBAL', job_type: 'fencing', amount_due: 1025.06, day: 9, category: 'escalating', next_step: { step: 'd12', date: d(3) } }),
    row(5, { payer_name: 'Sasha Cole', job_type: 'patio', amount_due: 2101, day: 8, category: 'escalating', suggestion: { id: 'sug-sasha-move', source: 'agent', status: 'pending' } }),
    row(6, { payer_name: 'Quinn Harper', job_type: 'patio', amount_due: 1973.13, day: 28, category: 'bad_debt', step_due: { step: 'd21', label: 'Jan\'s visit list' }, on_jan_list: true }),
    row(7, { payer_name: 'Drew Ellis', job_type: 'fencing', amount_due: 1256.75, day: 35, category: 'bad_debt', on_jan_list: true }),
    row(8, { payer_name: 'Jamie Fox', job_type: 'fencing', amount_due: 2433.75, day: 5, category: 'says_paid' }),
    row(9, { payer_name: 'Morgan Reid', job_type: 'patio', amount_due: 1650, day: 15, category: 'rectification' }),
    row(10, { payer_name: 'Lee Park', job_type: 'fencing', amount_due: 5900, day: -6, category: null, due_date: d(6), invoice_date: d(-1) }),
  ];
  const companies = [
    { company_key: uuid(701), name: 'Harbour Restoration Pty Ltd', past_due: { count: 3, amount: 2413.1, oldest_days: 31 }, in_grace: { count: 1, amount: 561 }, category: 'bad_debt', statement: { week_start: d(0), status: 'ready' } },
    { company_key: uuid(702), name: 'Coastline Building Group', past_due: { count: 1, amount: 583, oldest_days: 12 }, in_grace: { count: 0, amount: 0 }, category: 'escalating', statement: { week_start: d(0), status: 'no_email' } },
    { company_key: uuid(703), name: 'Northside Strata Services', past_due: { count: 0, amount: 0, oldest_days: 0 }, in_grace: { count: 1, amount: 300 }, category: null, statement: { week_start: d(0), status: 'nothing_due' } },
  ];
  const categories = {};
  ['active', 'escalating', 'bad_debt', 'says_paid', 'rectification'].forEach((k) => { categories[k] = { count: 0, amount: 0 }; });
  rows.forEach((r) => { if (r.category) { categories[r.category].count += 1; categories[r.category].amount += r.amount_due; } });
  companies.forEach((c) => { if (c.category) { categories[c.category].count += c.past_due.count; categories[c.category].amount += c.past_due.amount; } });

  const overview = {
    ok: true, version: 'debt-ws/v1', perth_date: today, read_at: at(0, '07:02'),
    settings, categories, rows, companies,
    not_due: { count: 2, amount: 6200 },
    not_chased: [{ name: 'Example Trade Services', amount: 305.25, count: 1 }],
    needs_a_look: [
      { xero_invoice_id: uuid(9201), invoice_number: 'INV-9201', payer_name: 'Robin Vale', amount_due: 880, reason: 'looks like a duplicate' },
      { xero_invoice_id: uuid(9202), invoice_number: 'INV-9202', payer_name: 'Pat Kim', amount_due: 412.5, reason: 'not linked to a job' },
    ],
    paid_this_week: { count: 3, amount: 4210.4, items: [
      { invoice_number: 'INV-8101', payer_name: 'Alex Stone', amount: 1840, paid_on: d(-1) },
      { invoice_number: 'INV-8102', payer_name: 'Charlie Webb', amount: 1500.4, paid_on: d(-2) },
      { invoice_number: 'INV-8103', payer_name: 'Harbour Restoration Pty Ltd', amount: 870, paid_on: d(-3) },
    ] },
    jan_list: { visit_date: d(4), status: 'open', count: 2 },
  };

  const findRow = (n) => rows.find((r) => r.xero_invoice_id === uuid(9000 + n));
  const job = (r, o = {}) => Object.assign({
    ok: true, version: 'debt-ws/v1', row: r,
    job: { id: r.job_id, job_number: r.job_number, type: r.job_type, status: r.category === 'rectification' ? 'rectification' : 'complete', client_name: r.neighbour_of || r.payer_name, client_phone: '0400 000 0' + String(r.invoice_number).slice(-2), site_address: (Number(String(r.invoice_number).slice(-1)) + 10) + ' Example Street', site_suburb: 'Sampleton', ghl_contact_id: r.ghl_linked ? 'ghl-' + r.invoice_number : null },
    story: { version: 'job-story-v1', now: { line: 'Complete. The final invoice went out ' + r.invoice_date + ' and nothing has been paid on it yet.', blockers: [] }, timeline: [], money: { job_value: { amount: r.amount_due * 3 } } },
    story_status: 'ok',
    invoices: [{ xero_invoice_id: r.xero_invoice_id, invoice_number: r.invoice_number, kind: r.kind, total: r.amount_due, amount_due: r.amount_due, status: 'AUTHORISED', date: r.invoice_date }],
    documents: [], conversation: { messages: [] }, notes: [], ladder: [], suggestion: null, flags: [], possible_payments: [],
    contact: { ghl_contact_id: r.ghl_linked ? 'ghl-' + r.invoice_number : null, candidates: [] }, pay_link: null,
  }, o);

  const casey = findRow(3);
  // "Tuesday the 13th of October", the way the templates write a date.
  const longDate = (iso) => {
    const x = new Date(iso + 'T00:00:00Z'), n = x.getUTCDate();
    const th = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return x.toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' }) + ' the ' + n + th + ' of ' + x.toLocaleDateString('en-AU', { month: 'long', timeZone: 'UTC' });
  };
  const caseyText = 'Hi Casey,\n\nFollowing up again on the final invoice for Example Street. The $1,420.37 is now 12 days overdue.\n\nPlease get this paid by ' + longDate(d(5)) + ': https://in.xero.com/example\n\nIf there\'s a problem with the job, just reply here and I\'ll give you a call.\n\nCheers,\nShaun';
  const jobs = {};
  jobs[casey.xero_invoice_id] = job(casey, {
    story: {
      version: 'job-story-v1',
      now: { line: 'Complete since the walkthrough. Final invoice sent, nothing paid on it yet.', next: null, blockers: [] },
      timeline: [
        { date: d(-20), what: 'Install started, 24 m Colorbond fence with one gate' },
        { date: d(-19), what: 'Install finished and walkthrough done, client happy' },
        { date: d(-12), what: 'Final invoice INV-9003 issued' },
        { date: d(-5), what: 'Day 7 call, no answer' },
      ],
      money: { line: 'Invoiced $4,840.00, paid $3,419.63, owing $1,420.37.', job_value: { amount: 4840 } },
    },
    invoices: [
      { xero_invoice_id: uuid(8003), invoice_number: 'INV-8003', kind: 'deposit', total: 3419.63, amount_due: 0, status: 'PAID', date: d(-40) },
      { xero_invoice_id: casey.xero_invoice_id, invoice_number: 'INV-9003', kind: 'final', total: 1420.37, amount_due: 1420.37, status: 'AUTHORISED', date: d(-12) },
    ],
    documents: [
      { id: 'doc-quote', name: 'Quote QT-9003.pdf', mime: 'application/pdf', kind: 'quote' },
      { id: 'doc-photo', name: 'Completion photo.png', mime: 'image/png', kind: 'completion_photo' },
    ],
    conversation: { messages: [
      { id: 'ghl:m1', channel: 'sms', direction: 'inbound', occurred_at: at(-14, '10:05'), author: 'Casey Morgan', body: 'Fence looks great, thanks to the boys.' },
      { id: 'ghl:m2', channel: 'sms', direction: 'outbound', occurred_at: at(-11, '09:00'), author: 'Shaun', body: 'Hi Casey,\n\nHope you\'re well! Hope you\'re enjoying the new fence at Example Street.\n\nI\'ve sent through the final invoice by email. If you could get that sorted when you get a chance, that would be great.\n\nCheers,\nShaun' },
      { id: 'ghl:m3', channel: 'sms', direction: 'outbound', occurred_at: at(-9, '09:00'), author: 'Shaun', body: 'Hi Casey,\n\nHope you\'re well! Just checking the final invoice for Example Street came through OK.\n\nCheers,\nShaun' },
      { id: 'ghl:m4', channel: 'call', direction: 'outbound', occurred_at: at(-5, '12:31'), author: 'Shaun', body: 'Voicemail greeting. No message left.', call_duration: 31, call_status: 'no_answer' },
      { id: 'ghl:m5', channel: 'sms', direction: 'outbound', occurred_at: at(-5, '12:35'), author: 'Shaun', body: 'Hi Casey,\n\nI tried giving you a call today about the final invoice for the fence at Example Street. There\'s $1,420.37 still outstanding.\n\nCheers,\nShaun' },
      { id: 'inbox:e1', channel: 'email', direction: 'inbound', occurred_at: at(-4, '18:20'), author: 'Casey Morgan', subject: 'Re: Final invoice', body: 'Got it. The gate still drags a little when it rains, can someone take a look when they are passing?' },
    ] },
    notes: [
      { id: 'n1', kind: 'note', body: 'Called at lunch, voicemail. Try later in the day.', created_by_name: 'Shaun', created_at: at(-5, '12:40') },
      { id: 'n2', kind: 'text_sent', step: 'd7', body: '', created_by_name: 'Shaun', created_at: at(-5, '12:35') },
      { id: 'n3', kind: 'text_sent', step: 'd3', body: '', created_by_name: 'Shaun', created_at: at(-9, '09:00') },
      { id: 'n4', kind: 'text_sent', step: 'd1', body: '', created_by_name: 'Shaun', created_at: at(-11, '09:00') },
    ],
    ladder: [
      { step: 'd1', label: 'Day 1 text', day: 1, date: d(-11), status: 'done' },
      { step: 'd3', label: 'Day 3 text', day: 3, date: d(-9), status: 'done' },
      { step: 'd7', label: 'Day 7 text + call', day: 7, date: d(-5), status: 'done' },
      { step: 'd12', label: 'Day 12 text', day: 12, date: d(0), status: 'due' },
      { step: 'd17', label: 'Day 17 final text', day: 17, date: d(5), status: 'upcoming' },
      { step: 'd21', label: 'Site visit', day: 21, date: d(9), status: 'upcoming' },
    ],
    suggestion: { id: 'sug-casey-d12', step: 'd12', kind: 'draft', channel: 'sms', text: caseyText, why: 'No reply to the day 1, 3 or 7 texts, and the day 7 call went to voicemail. Nothing in the thread says they will not pay, so the firmer day 12 text with a pay-by date.', source: 'template', proposed_category: null },
    flags: [{ id: 'flag-casey-1', text: 'Client sounds unsure about the gate, call rather than text', why: 'Their last email says the gate drags when it rains.', created_at: at(0, '07:40') }],
    pay_link: 'https://in.xero.com/example',
  });

  const sasha = findRow(5);
  jobs[sasha.xero_invoice_id] = job(sasha, {
    conversation: { messages: [
      { id: 'ghl:s1', channel: 'sms', direction: 'outbound', occurred_at: at(-7, '09:00'), author: 'Shaun', body: 'Hi Sasha,\n\nHope you\'re well! Hope you\'re enjoying the new patio at Example Street.\n\nCheers,\nShaun' },
      { id: 'ghl:s2', channel: 'sms', direction: 'inbound', occurred_at: at(0, '09:12'), author: 'Sasha Cole', body: 'Sorry, been meaning to say, the gutter at the back corner is still leaking. Once someone sorts that I will pay straight away.' },
    ] },
    ladder: [
      { step: 'd1', label: 'Day 1 text', day: 1, date: d(-7), status: 'done' },
      { step: 'd3', label: 'Day 3 text', day: 3, date: d(-5), status: 'skipped' },
      { step: 'd7', label: 'Day 7 text + call', day: 7, date: d(-1), status: 'upcoming' },
      { step: 'd12', label: 'Day 12 text', day: 12, date: d(4), status: 'upcoming' },
    ],
    suggestion: { id: 'sug-sasha-move', step: null, kind: 'move', channel: 'sms', proposed_category: 'rectification', text: 'Thanks Sasha, sorry about that. I\'ll get someone out to sort the gutter and I\'ll text you a time shortly.\n\nCheers,\nShaun', why: 'Sasha says the gutter at the back corner is still leaking and will pay once it is fixed.', source: 'agent' },
  });

  const avery = findRow(1);
  jobs[avery.xero_invoice_id] = job(avery, {
    contact: { ghl_contact_id: null, candidates: [
      { id: 'ghl-avery-1', name: 'Avery Lin', phone: '0400 000 001', email: 'avery@example.test', match: 'phone matches the job' },
      { id: 'ghl-avery-2', name: 'A Lin', phone: null, email: 'a.lin@example.test', match: 'name only' },
    ] },
    ladder: [{ step: 'd1', label: 'Day 1 text', day: 1, date: d(-1), status: 'due' }, { step: 'd3', label: 'Day 3 text', day: 3, date: d(1), status: 'upcoming' }],
    suggestion: { id: null, step: 'd1', kind: 'draft', channel: 'sms', text: 'Hi Avery,\n\nHope you\'re well! Hope you\'re enjoying the new fence at Example Street.\n\nCheers,\nShaun', why: 'Day 1 of the final invoice.', source: 'template', proposed_category: null },
  });
  // Every other row opens a plain job.
  rows.forEach((r) => { if (!jobs[r.xero_invoice_id]) jobs[r.xero_invoice_id] = job(r); });

  const janList = {
    ok: true, visit_date: d(4), status: 'open', locked_at: null, sent_at: null,
    items: [
      { share_key: uuid(9007), xero_invoice_id: uuid(9007), name: 'Drew Ellis', site_address: '17 Example Street, Sampleton', phone: '0400 000 007', amount: 1256.75, history: 'Texted 1st, 3rd, 7th, 12th, 17th · called 7th' },
      { share_key: uuid(9006), xero_invoice_id: uuid(9006), name: 'Quinn Harper', site_address: '16 Example Street, Sampleton', phone: '0400 000 006', amount: 1973.13, history: 'Texted 1st, 3rd, 7th, 12th, 17th' },
    ],
  };
  const statements = {};
  statements[uuid(701)] = { ok: true, company_key: uuid(701), to_email: 'accounts@harbour.example', total: 2413.1,
    invoices: [{ invoice_number: 'INV-9301', amount: 1332.1 }, { invoice_number: 'INV-9302', amount: 561 }, { invoice_number: 'INV-9303', amount: 520 }],
    html: '<html><body style="font-family:Helvetica,Arial,sans-serif;padding:24px"><h2>Statement for Harbour Restoration Pty Ltd</h2><table cellpadding="6"><tr><th>Invoice</th><th>Amount</th></tr><tr><td>INV-9301</td><td>$1,332.10</td></tr><tr><td>INV-9302</td><td>$561.00</td></tr><tr><td>INV-9303</td><td>$520.00</td></tr></table><p><b>Total $2,413.10</b></p></body></html>' };
  statements[uuid(702)] = { ok: true, company_key: uuid(702), to_email: null, total: 583, invoices: [{ invoice_number: 'INV-9304', amount: 583 }], html: '<html><body><h2>Statement for Coastline Building Group</h2></body></html>' };
  const documents = {
    'doc-quote': { ok: true, document: { id: 'doc-quote', name: 'Quote QT-9003.pdf' }, content: { base64: PDF_B64, mime_type: 'application/pdf' } },
    'doc-photo': { ok: true, document: { id: 'doc-photo', name: 'Completion photo.png' }, content: { base64: PNG_B64, mime_type: 'image/png' } },
  };
  return { overview, jobs, janList, statements, documents, invoicePdf: { success: true, pdf_base64: PDF_B64, filename: 'invoice.pdf' }, ids: { avery: avery.xero_invoice_id, casey: casey.xero_invoice_id, sasha: sasha.xero_invoice_id, riley: uuid(9004), harbour: uuid(701), coastline: uuid(702), drew: uuid(9007) } };
}

module.exports = { buildDebtWorkshopFixture, PDF_B64, PNG_B64 };
