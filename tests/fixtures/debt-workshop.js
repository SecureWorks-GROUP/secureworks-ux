// Offline fixture for the Debt Workshop screen (docs/debt-workshop.md).
// Shapes follow the build contract, secureworks-wiki coding/capabilities/debt-follow-up/
// debt-workshop-spec.md section 8: debt_ws_overview, debt_ws_job (plus flags[] and the
// overview's flag_count), debt_ws_document, debt_ws_statement_preview and debt_ws_jan_list.
// Field names, ids and steps follow what the backend really sends (secureworks-backend
// supabase/functions/ops-api/debt_ws_actions.ts and debt_ws_book.ts): job invoices carry
// `number`, every id is a UUID, GoHighLevel contact ids are 10 to 40 letters and digits (the
// backend's GHL_ID), and a move suggestion carries its reply step (reply_problem).
// Every name, address, phone and email is made up. Dates are derived from today's Perth date
// at run time, so days and "today" never rot as the real calendar moves on.
const { perthDate, addIsoDays } = require('../helpers/feed-stub');

function uuid(n) { return '00000000-0000-4000-8000-' + String(n).padStart(12, '0'); }
// A GoHighLevel contact id: letters and digits only, no hyphens (backend GHL_ID).
function ghlId(n) { return 'Ct7Qw' + String(n).padStart(9, '0') + 'xRz'; }

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
    open: true, says_paid_since: null, not_chased: false,
  }, o, { payer_label: o.payer_label || o.payer_name });

  const rows = [
    row(1, { payer_name: 'Avery Lin', job_type: 'fencing', amount_due: 1351.63, day: 2, category: 'active', step_due: { step: 'd1', label: 'Day 1 text' }, ghl_linked: false }),
    row(2, { payer_name: 'Jordan Pike', job_type: 'patio', kind: 'progress', reference: 'SWP-90002-MAT', amount_due: 3932.06, day: 4, invoice_date: d(-11), category: 'active', next_step: { step: 'd7', date: d(3) } }),
    row(3, { payer_name: 'Casey Morgan', job_type: 'fencing', amount_due: 1420.37, day: 12, category: 'escalating', step_due: { step: 'd12', label: 'Day 12 text' }, suggestion: { id: uuid(601), source: 'template', status: 'pending' }, flag_count: 1, last_touch: { kind: 'text_sent', at: at(-5, '12:35'), label: 'Day 7 text sent' } }),
    row(4, { payer_name: 'Riley Shaw', payer_label: 'Riley Shaw (neighbour of Taylor Brooks)', neighbour_of: 'Taylor Brooks', reference: 'SWF-90004-B-FINBAL', job_type: 'fencing', amount_due: 1025.06, day: 9, category: 'escalating', next_step: { step: 'd12', date: d(3) } }),
    row(5, { payer_name: 'Sasha Cole', job_type: 'patio', amount_due: 2101, day: 8, category: 'escalating', suggestion: { id: uuid(605), source: 'agent', status: 'pending' } }),
    row(6, { payer_name: 'Quinn Harper', job_type: 'patio', amount_due: 1973.13, day: 28, category: 'bad_debt', step_due: { step: 'd21', label: 'Jan\'s visit list' }, on_jan_list: true }),
    row(7, { payer_name: 'Drew Ellis', job_type: 'fencing', amount_due: 1256.75, day: 35, category: 'bad_debt', on_jan_list: true }),
    row(8, { payer_name: 'Jamie Fox', job_type: 'fencing', amount_due: 2433.75, day: 5, category: 'says_paid', says_paid_since: d(-2) }),
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

  // "Total owed to us" (debt_ws_overview.total_owed, backend debt_ws_report.ts totalOwedFrom):
  // every open invoice, broken down so the lines add up to the total. Debt is the chart's own
  // figure (the categories above); the rest come from the same fixture's footer figures.
  const inv = (n, payer, amount, detail, o = {}) => Object.assign({ xero_invoice_id: uuid(n), invoice_number: 'INV-' + n, payer, job_number: null, amount, detail }, o);
  const debtInvoices = rows.filter((r) => r.category).map((r) => inv(Number(String(r.invoice_number).slice(4)), r.payer_label, r.amount_due, r.category.replace('_', ' ') + ', day ' + r.day, { xero_invoice_id: r.xero_invoice_id, job_number: r.job_number }))
    .concat([inv(9301, 'Harbour Restoration Pty Ltd', 1000, 'Bad debt, day 31'), inv(9302, 'Harbour Restoration Pty Ltd', 800, 'Bad debt, day 22'), inv(9303, 'Harbour Restoration Pty Ltd', 613.1, 'Escalating, day 9'), inv(9311, 'Coastline Building Group', 583, 'Escalating, day 12')]);
  const owedLine = (key, name, sub, invoices) => ({ key, name, sub, count: invoices.length, amount: Math.round(invoices.reduce((s, i) => s + Math.round(i.amount * 100), 0)) / 100, invoices });
  const owedLines = [
    owedLine('debt', 'Debt', 'Past due and followed up: the figure above', debtInvoices),
    owedLine('not_due', 'Not due yet', 'Before the tab\'s due date', [inv(9010, 'Lee Park', 5900, 'Due ' + d(6))]),
    owedLine('progress', 'Progress payments', 'Not due yet', []),
    owedLine('companies', 'Companies on statements', 'Not due yet', [inv(9304, 'Harbour Restoration Pty Ltd', 561, 'Due ' + d(4)), inv(9321, 'Northside Strata Services', 300, 'Due ' + d(8))]),
    owedLine('deposits', 'Deposits', 'Go-ahead payments: the job starts when paid', [inv(9401, 'Kim Taylor', 2500, 'Invoiced ' + d(-3))]),
    owedLine('not_chased', 'Not chased', 'Example Trade Services', [inv(9501, 'Example Trade Services', 305.25, 'On the not-chased list: never chased or put on a statement')]),
    owedLine('needs_a_look', 'Needs a look', 'The rules could not place it', [inv(9201, 'Robin Vale', 880, 'Needs a look: looks like a duplicate'), inv(9202, 'Pat Kim', 412.5, 'Needs a look: not linked to a job')]),
  ];
  overview.total_owed = {
    count: owedLines.reduce((s, l) => s + l.count, 0),
    amount: Math.round(owedLines.reduce((s, l) => s + Math.round(l.amount * 100), 0)) / 100,
    lines: owedLines, adds_up: true,
  };
  // Whether our Xero copy matched Xero at the last hourly check (debt_ws_xero_check.ts).
  overview.xero_check = Object.assign({
    status: 'matches', words: 'Matches Xero', checked_at: at(0, '06:49'), stale: false,
    xero: { count: overview.total_owed.count, amount: overview.total_owed.amount },
    copy: { count: overview.total_owed.count, amount: overview.total_owed.amount },
    differ_count: 0, differences: [], drafts: { count: 3, amount: 4120 }, last_failed: null,
  }, opts.xeroCheck || {});

  const findRow = (n) => rows.find((r) => r.xero_invoice_id === uuid(9000 + n));
  // debt_ws_job. A single-payer job's payer is the job's client (payer_contact mirrors the job);
  // a shared fence's neighbour gets their own payer_contact (see Riley below).
  const job = (r, o = {}) => {
    const out = jobBase(r, o);
    if (!out.payer_contact) {
      out.payer_contact = { name: r.payer_name, phone: out.job.client_phone, email: null, ghl_contact_id: out.job.ghl_contact_id, contact_row_id: null, label: 'main', is_primary: true, resolved_by: 'single_payer_job' };
    }
    if (!('send_block' in out)) out.send_block = out.payer_contact.ghl_contact_id ? null : { code: 'payer_not_linked', message: 'Link ' + r.payer_name.split(' ')[0] + '\'s GoHighLevel contact first' };
    return out;
  };
  const jobBase = (r, o = {}) => Object.assign({
    ok: true, version: 'debt-ws/v1', row: r,
    job: { id: r.job_id, job_number: r.job_number, type: r.job_type, status: r.category === 'rectification' ? 'rectification' : 'complete', client_name: r.neighbour_of || r.payer_name, client_phone: '0400 000 0' + String(r.invoice_number).slice(-2), site_address: (Number(String(r.invoice_number).slice(-1)) + 10) + ' Example Street', site_suburb: 'Sampleton', ghl_contact_id: r.ghl_linked ? ghlId(9000 + Number(String(r.invoice_number).slice(-2))) : null },
    story: { version: 'job-story-v1', now: { line: 'Complete. The final invoice went out ' + r.invoice_date + ' and nothing has been paid on it yet.', blockers: [] }, timeline: [], money: { job_value: { amount: r.amount_due * 3 } } },
    story_status: 'ok',
    invoices: [{ xero_invoice_id: r.xero_invoice_id, number: r.invoice_number, reference: r.reference, kind: r.kind, total: r.amount_due, amount_due: r.amount_due, status: 'AUTHORISED', date: r.invoice_date }],
    documents: [], conversation: { messages: [] }, notes: [], ladder: [], suggestion: null, flags: [], possible_payments: [],
    contact: { ghl_contact_id: r.ghl_linked ? ghlId(9000 + Number(String(r.invoice_number).slice(-2))) : null, candidates: [] }, pay_link: null,
    manual_text: manualText(r),
  }, o);
  // debt_ws_job.manual_text: may Shaun type his own text here (ops-api manualTextBlock)?
  function manualText(r) {
    const no = (code, reason) => ({ allowed: false, code, reason });
    if (r.lane === 'account') return no('not_chased_by_text', 'Company invoices go on the Monday statement, not a text');
    if (r.not_chased) return no('not_chased_by_text', 'This contact is never chased');
    // Paused chasing (says paid, rectification, a promise, Jan's list) still allows Shaun's own
    // text (Shaun, 16 Oct 2026): only the planned steps wait.
    return { allowed: true, code: null, reason: null };
  }

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
      { xero_invoice_id: uuid(8003), number: 'INV-8003', reference: 'SWF-90003-DEP', kind: 'deposit', total: 3419.63, amount_due: 0, status: 'PAID', date: d(-40) },
      { xero_invoice_id: casey.xero_invoice_id, number: 'INV-9003', reference: 'SWF-90003-FINBAL', kind: 'final', total: 1420.37, amount_due: 1420.37, status: 'AUTHORISED', date: d(-12) },
    ],
    documents: [
      { id: uuid(621), name: 'Quote QT-9003.pdf', mime: 'application/pdf', kind: 'quote', created_at: at(-30, '10:00') },
      { id: uuid(622), name: 'Completion photo.png', mime: 'image/png', kind: 'completion_photo', created_at: at(-19, '15:10') },
    ],
    conversation: { messages: [
      { id: 'ghl:m1', channel: 'sms', direction: 'inbound', occurred_at: at(-14, '10:05'), author: 'Casey Morgan', body: 'Fence looks great, thanks to the boys.' },
      { id: 'ghl:m2', channel: 'sms', direction: 'outbound', occurred_at: at(-11, '09:00'), author: 'Shaun', body: 'Hi Casey,\n\nHope you\'re well! Hope you\'re enjoying the new fence at Example Street.\n\nI\'ve sent through the final invoice by email. If you could get that sorted when you get a chance, that would be great.\n\nCheers,\nShaun' },
      { id: 'ghl:m3', channel: 'sms', direction: 'outbound', occurred_at: at(-9, '09:00'), author: 'Shaun', body: 'Hi Casey,\n\nHope you\'re well! Just checking the final invoice for Example Street came through OK.\n\nCheers,\nShaun' },
      { id: 'ghl:m4', channel: 'call', direction: 'outbound', occurred_at: at(-5, '12:31'), author: 'Shaun', body: 'Voicemail greeting. No message left.', call_duration: 31, call_status: 'no_answer' },
      { id: 'ghl:m5', channel: 'sms', direction: 'outbound', occurred_at: at(-5, '12:35'), author: 'Shaun', body: 'Hi Casey,\n\nI tried giving you a call today about the final invoice for the fence at Example Street. There\'s $1,420.37 still outstanding.\n\nCheers,\nShaun' },
      // Held on no job by the backend (Casey has another job it could be on), from Casey's own contact.
      { id: 'bev:u1', channel: 'sms', direction: 'outbound', occurred_at: at(-4, '09:15'), author: 'Shaun', body: 'Hi Casey,\n\nSo sorry to bother you, just a quick reminder about the final invoice.\n\nCheers,\nShaun', unplaced: true, candidate_job_count: 2 },
      { id: 'inbox:e1', channel: 'email', direction: 'inbound', occurred_at: at(-4, '18:20'), author: 'Casey Morgan', subject: 'Re: Final invoice', body: 'Got it. The gate still drags a little when it rains, can someone take a look when they are passing?' },
    ] },
    notes: [
      { id: uuid(631), kind: 'note', body: 'Called at lunch, voicemail. Try later in the day.', created_by_name: 'Shaun', created_at: at(-5, '12:40') },
      { id: uuid(632), kind: 'text_sent', step: 'd7', body: '', created_by_name: 'Shaun', created_at: at(-5, '12:35') },
      { id: uuid(633), kind: 'text_sent', step: 'd3', body: '', created_by_name: 'Shaun', created_at: at(-9, '09:00') },
      { id: uuid(634), kind: 'text_sent', step: 'd1', body: '', created_by_name: 'Shaun', created_at: at(-11, '09:00') },
    ],
    ladder: [
      { step: 'd1', label: 'Day 1 text', day: 1, date: d(-11), status: 'done' },
      { step: 'd3', label: 'Day 3 text', day: 3, date: d(-9), status: 'done' },
      { step: 'd7', label: 'Day 7 text + call', day: 7, date: d(-5), status: 'done' },
      { step: 'd12', label: 'Day 12 text', day: 12, date: d(0), status: 'due' },
      { step: 'd17', label: 'Day 17 final text', day: 17, date: d(5), status: 'upcoming' },
      { step: 'd21', label: 'Site visit', day: 21, date: d(9), status: 'upcoming' },
    ],
    suggestion: { id: uuid(601), step: 'd12', kind: 'draft', channel: 'sms', amount: 1420.37, text: caseyText, why: 'No reply to the day 1, 3 or 7 texts, and the day 7 call went to voicemail. Nothing in the thread says they will not pay, so the firmer day 12 text with a pay-by date.', source: 'template', proposed_category: null },
    flags: [{ id: uuid(611), text: 'Client sounds unsure about the gate, call rather than text', why: 'Their last email says the gate drags when it rains.', created_at: at(0, '07:40') }],
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
    suggestion: { id: uuid(605), step: 'reply_problem', kind: 'move', channel: 'sms', amount: 2101, proposed_category: 'rectification', text: 'Thanks Sasha, sorry about that. I\'ll get someone out to sort the gutter and I\'ll text you a time shortly.\n\nCheers,\nShaun', why: 'Sasha says the gutter at the back corner is still leaking and will pay once it is fixed.', source: 'agent' },
  });

  const avery = findRow(1);
  jobs[avery.xero_invoice_id] = job(avery, {
    contact: { ghl_contact_id: null, candidates: [
      { id: ghlId(1), name: 'Avery Lin', phone: '0400 000 001', email: 'avery@example.test', match: 'phone matches the job' },
      { id: ghlId(2), name: 'A Lin', phone: null, email: 'a.lin@example.test', match: 'name only' },
    ] },
    ladder: [{ step: 'd1', label: 'Day 1 text', day: 1, date: d(-1), status: 'due' }, { step: 'd3', label: 'Day 3 text', day: 3, date: d(1), status: 'upcoming' }],
    suggestion: { id: null, step: 'd1', kind: 'draft', channel: 'sms', amount: 1351.63, text: 'Hi Avery,\n\nHope you\'re well! Hope you\'re enjoying the new fence at Example Street.\n\nCheers,\nShaun', why: 'Day 1 of the final invoice.', source: 'template', proposed_category: null },
  });
  // A shared fence (the SWF-26624 shape): Riley Shaw owes share B; the job is Taylor Brooks's
  // (share A, paid, linked in GoHighLevel). Riley has their own phone, email and contact row but
  // no GoHighLevel contact yet, so there is no conversation with Riley and nothing to text. The
  // job's thread is all Taylor's.
  const riley = findRow(4);
  const taylorGhl = ghlId(9004);
  const rileyPayer = { name: 'Riley Shaw', phone: '0400 000 404', email: 'riley@example.test', ghl_contact_id: null, contact_row_id: uuid(804), label: 'B', is_primary: false, resolved_by: 'xero_contact' };
  riley.ghl_linked = false;
  riley.payer_contact = rileyPayer;
  const taylorThread = [
    { id: 'bev:t1', channel: 'sms', direction: 'outbound', occurred_at: at(-12, '09:00'), author: 'Shaun', body: 'Hi Taylor,\n\nJust spoke to Riley again about their half.\n\nCheers,\nShaun', contact_id: taylorGhl, is_payer: false, party_name: 'Taylor Brooks' },
    { id: 'bev:t2', channel: 'sms', direction: 'inbound', occurred_at: at(-10, '14:20'), author: 'Taylor Brooks', body: 'No problem, I have paid my half now.', contact_id: taylorGhl, is_payer: false, party_name: 'Taylor Brooks' },
    { id: 'note:t3', channel: 'note', direction: 'internal', occurred_at: at(-9, '08:00'), author: 'Shaun', body: 'Neighbour still to pay share B.', is_payer: false, party_name: null },
  ];
  const rileyJob = (conversation) => job(riley, {
    job: { id: riley.job_id, job_number: riley.job_number, type: 'fencing', status: 'final_payment', client_name: 'Taylor Brooks', client_phone: '0400 000 004', site_address: '14 Example Street', site_suburb: 'Sampleton', ghl_contact_id: taylorGhl,
      shares: [{ label: 'A', payer_name: 'Taylor Brooks', is_primary: true, owing: 0, paid: true, invoice_count: 2 }, { label: 'B', payer_name: 'Riley Shaw', is_primary: false, owing: 1025.06, paid: false, invoice_count: 2 }] },
    payer_contact: rileyPayer,
    invoices: [
      { xero_invoice_id: uuid(8041), number: 'INV-8041', reference: 'SWF-90004-A-FINBAL', kind: 'final', total: 1025.06, amount_due: 0, status: 'PAID', date: d(-20) },
      { xero_invoice_id: riley.xero_invoice_id, number: riley.invoice_number, reference: riley.reference, kind: 'final', total: 1025.06, amount_due: 1025.06, status: 'AUTHORISED', date: riley.invoice_date },
    ],
    conversation,
    contact: { ghl_contact_id: null, linkable: true, payer_name: 'Riley Shaw', candidates: [
      { id: ghlId(404), name: 'Riley Shaw', phone: '0400 000 404', email: 'riley@example.test', match: 'phone' },
    ] },
    send_block: { code: 'payer_not_linked', message: 'Link Riley\'s GoHighLevel contact first: there is no contact to text' },
    suggestion: { id: null, step: 'd12', kind: 'draft', channel: 'sms', amount: 1025.06, text: 'Hi Riley,\n\nJust following up on your half of the fence at Example Street. There\'s $1,025.06 still outstanding.\n\nCheers,\nShaun', why: 'Day 12 of the final invoice.', source: 'template', proposed_category: null },
  });
  jobs[riley.xero_invoice_id] = rileyJob({ messages: [], mode: 'payer', all_job_messages_count: taylorThread.length, payer_messages_count: 0, reason: 'payer_not_linked' });
  // debt_ws_job?conversation=all for the same invoice: the whole job's thread, marked by party.
  const jobsAll = {};
  jobsAll[riley.xero_invoice_id] = rileyJob({ messages: taylorThread, mode: 'all', all_job_messages_count: taylorThread.length, payer_messages_count: 0, reason: 'payer_not_linked' });
  // Every other row opens a plain job.
  rows.forEach((r) => { if (!jobs[r.xero_invoice_id]) jobs[r.xero_invoice_id] = job(r); });

  const janList = {
    ok: true, version: 'debt-ws/v1', visit_date: d(4), status: 'open', live: true, count: 2, amount: 3229.88, locked_at: null, sent_at: null, error: null, removed_share_keys: [],
    items: [
      { share_key: uuid(9007), xero_invoice_id: uuid(9007), invoice_number: 'INV-9007', name: 'Drew Ellis', site_address: '17 Example Street, Sampleton', phone: '0400 000 007', amount: 1256.75, history: 'Texted 1st, 3rd, 7th, 12th, 17th · called 7th' },
      { share_key: uuid(9006), xero_invoice_id: uuid(9006), invoice_number: 'INV-9006', name: 'Quinn Harper', site_address: '16 Example Street, Sampleton', phone: '0400 000 006', amount: 1973.13, history: 'Texted 1st, 3rd, 7th, 12th, 17th' },
    ],
  };
  const statements = {};
  statements[uuid(701)] = { ok: true, company_key: uuid(701), to_email: 'accounts@harbour.example', total: 2413.1,
    invoices: [{ xero_invoice_id: uuid(9301), invoice_number: 'INV-9301', amount: 1332.1, days_overdue: 31 }, { xero_invoice_id: uuid(9302), invoice_number: 'INV-9302', amount: 561, days_overdue: 9 }, { xero_invoice_id: uuid(9303), invoice_number: 'INV-9303', amount: 520, days_overdue: 4 }],
    html: '<html><body style="font-family:Helvetica,Arial,sans-serif;padding:24px"><h2>Statement for Harbour Restoration Pty Ltd</h2><table cellpadding="6"><tr><th>Invoice</th><th>Amount</th></tr><tr><td>INV-9301</td><td>$1,332.10</td></tr><tr><td>INV-9302</td><td>$561.00</td></tr><tr><td>INV-9303</td><td>$520.00</td></tr></table><p><b>Total $2,413.10</b></p></body></html>' };
  statements[uuid(702)] = { ok: true, company_key: uuid(702), to_email: null, total: 583, invoices: [{ xero_invoice_id: uuid(9304), invoice_number: 'INV-9304', amount: 583, days_overdue: 12 }], html: '<html><body><h2>Statement for Coastline Building Group</h2></body></html>' };
  const documents = {
    [uuid(621)]: { ok: true, document: { id: uuid(621), file_name: 'Quote QT-9003.pdf' }, file_name: 'Quote QT-9003.pdf', content: { base64: PDF_B64, mime_type: 'application/pdf' } },
    [uuid(622)]: { ok: true, document: { id: uuid(622), file_name: 'Completion photo.png' }, file_name: 'Completion photo.png', content: { base64: PNG_B64, mime_type: 'image/png' } },
  };
  // debt_ws_report: the live report (its HTML is the backend's; this is a small stand-in) and
  // who it goes to. The gate follows the settings: owner and sending on means it can send.
  const owner = !!settings.viewer_is_owner, sendingOn = !!settings.sending_on;
  const report = {
    ok: true, version: 'debt-ws/v1', perth_date: today, read_at: at(0, '09:15'),
    report: { version: 'debt-report/v1', today, as_at: '9:15am Perth time, today', debt: { count: 12, amount: 21456.82 }, xero_open: { count: 20, amount: 41890.4 }, total_owed: { count: 20, amount: 41890.4 }, tie: { ok: true } },
    html: '<!doctype html><html><head><meta charset="utf-8"><title>Debt position</title></head><body style="font-family:Helvetica,Arial,sans-serif;padding:20px">' +
      '<h1>Debt position</h1><p>As at 9:15am Perth time, today</p><table><tr><td>Total debt</td><td>$21,456.82</td></tr>' +
      '<tr><td>Adds up to total owed to us</td><td>$41,890.40</td></tr></table><p>Check: $41,890.40 equals the total owed in our Xero copy to the cent.</p><p>Check against Xero: our Xero copy matched Xero.</p></body></html>',
    delivery: {
      from: 'admin@secureworkswa.com.au', to: ['marnin@secureworkswa.com.au'], cc: ['shaun@secureworkswa.com.au'], auto_send: !!settings.report_auto_send,
      sending_on: sendingOn, viewer_is_owner: owner, can_send: owner && sendingOn,
      why_not: !owner ? 'Only the workshop owner (Shaun) can send the report' : !sendingOn ? 'Sending is off until you switch it on' : null,
    },
    last_sent: opts.reportLastSent || null,
    last_attempt: opts.reportLastSent || null,
  };
  const reportPdf = { ok: true, filename: 'Debt position ' + today + '.pdf', content_type: 'application/pdf', pdf_base64: PDF_B64, page_count: 1 };
  return { overview, jobs, jobsAll, janList, statements, documents, report, reportPdf, invoicePdf: { success: true, pdf_base64: PDF_B64, filename: 'invoice.pdf' }, ids: {
    avery: avery.xero_invoice_id, casey: casey.xero_invoice_id, sasha: sasha.xero_invoice_id, riley: uuid(9004), harbour: uuid(701), coastline: uuid(702), drew: uuid(9007),
    jamie: uuid(9008), caseySuggestion: uuid(601), caseyFlag: uuid(611), sashaSuggestion: uuid(605), averyContact: ghlId(1), harbourInvoice: uuid(9301),
    rileyContact: ghlId(404), taylorContact: taylorGhl,
  } };
}

module.exports = { buildDebtWorkshopFixture, PDF_B64, PNG_B64, uuid, ghlId };
