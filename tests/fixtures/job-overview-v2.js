// Synthetic job_detail and job_overview payloads for the job page Overview v2
// (modules/ops-job-overview-v2.js, docs/job-overview-v2.md). Every person, phone,
// email, address and amount here is invented. Times are built from today's Perth
// date at run time (perthIso), so "Today" and "Yesterday" never rot; a time of day
// is fixed, so the screen's Perth clock text is predictable in any test time zone.
//
// The job is shaped on a real case: a shared rear fence, a quote accepted yesterday,
// a deposit invoice left as a Xero DRAFT (it cannot be paid), an older invoice deleted
// in Xero, three quote versions, texts, an email and a short call.

const PERTH_MS = 8 * 3600 * 1000;

function perthToday(now = Date.now()) {
  const t = new Date(now + PERTH_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
}
// An ISO instant for hh:mm Perth time, daysAgo days before today (Perth).
function perthIso(daysAgo, hh, mm, ss = 0, now = Date.now()) {
  const p = perthToday(now);
  return new Date(Date.UTC(p.y, p.m, p.d - daysAgo, hh, mm, ss) - PERTH_MS).toISOString();
}
// A Perth calendar date (YYYY-MM-DD), daysAgo days before today; negative is the future.
function perthDate(daysAgo, now = Date.now()) {
  const p = perthToday(now);
  return new Date(Date.UTC(p.y, p.m, p.d - daysAgo)).toISOString().slice(0, 10);
}
// Perth midnight as an instant, the way Xero dates reach the story card.
function perthMidnightIso(daysAgo, now = Date.now()) {
  return perthIso(daysAgo, 0, 0, 0, now);
}

const EM = '\u2014'; // stored text can hold long dashes; the screen must never show one
const EN = '\u2013';

const JOB_ID = '7d1c2e3f-0000-4000-8000-00000000a001';
const OTHER_JOB_ID = '7d1c2e3f-0000-4000-8000-00000000a999';
const IDS = {
  q1: '0a9e0000-0000-4000-8000-000000000001',
  q2: '0a9e0000-0000-4000-8000-000000000002',
  q3: '0a9e0000-0000-4000-8000-000000000003',
  inv1: '1b9e0000-0000-4000-8000-000000000001',
  inv2: '1b9e0000-0000-4000-8000-000000000002',
  xero1: 'xero-0000-0000-0000-000000000001',
  xero2: 'xero-0000-0000-0000-000000000002',
  msgAcceptAndPay: '2c9e0000-0000-4000-8000-000000000006',
};

function job(now) {
  return {
    id: JOB_ID,
    job_number: 'SWF-990101',
    type: 'fencing',
    status: 'awaiting_deposit',
    client_name: 'Avery Lin',
    client_phone: '0400 000 001',
    client_email: 'avery@example.test',
    site_address: '12 Sample Street, Testville WA 6000, Australia',
    site_suburb: 'Testville',
    ghl_contact_id: 'ghl-contact-e2e-001',
    ghl_opportunity_id: 'ghl-opp-e2e-001',
    created_at: perthIso(38, 9, 33, 0, now),
    quoted_at: perthIso(35, 13, 48, 0, now),
    accepted_at: perthIso(1, 14, 1, 58, now),
    pricing_json: {
      totalIncGST: 7065.85,
      total: 7065.85,
      job_description: `23m Colorbond Fencing ${EM} 1800mm Wilderness ${EM} Testville`,
      neighbour_splits: {
        method: 'by_run',
        client_portion_inc_gst: 3794.72,
        neighbours: [{ id: 'nb-1', name: 'Jordan Pike', portion_inc_gst: 3271.13 }],
      },
    },
    scope_json: {
      job: {
        scoper: 'Sam',
        date: perthDate(38, now),
        profile: 'Ridgeside',
        colour: 'Wilderness',
        runs: [{ name: 'Rear', length: 20.5 }, { name: 'Right side', length: 2.4 }],
        removal: { removalRequired: true, existingFenceType: 'asbestos' },
        siteNotes: '',
      },
    },
  };
}

// The job_detail payload (ops-api job_detail), shaped like the backend's jobDetail().
function buildJobDetail(opts = {}) {
  const now = opts.now || Date.now();
  const detail = {
    job: job(now),
    assignments: [],
    documents: [
      { id: IDS.q3, name: 'quote v3', type: 'quote', version: 3, quote_number: 'Q-9003', sent_to_client: true, accepted_at: perthIso(1, 14, 1, 57, now), share_token: 'tok-q3', pdf_url: 'https://example.test/quotes/q-9003.pdf', created_at: perthIso(1, 6, 55, 0, now) },
      { id: IDS.q2, name: 'quote v2', type: 'quote', version: 2, quote_number: 'Q-9002', sent_to_client: true, accepted_at: null, share_token: 'tok-q2', pdf_url: 'https://example.test/quotes/q-9002.pdf', created_at: perthIso(21, 17, 10, 0, now) },
      { id: IDS.q1, name: 'quote v1', type: 'quote', version: 1, quote_number: 'Q-9001', sent_to_client: true, accepted_at: null, share_token: 'tok-q1', pdf_url: null, created_at: perthIso(35, 13, 47, 0, now) },
    ],
    events: [],
    media: Array.from({ length: 10 }, (_, i) => ({ id: `media-${i + 1}`, phase: 'scope', type: 'photo', storage_url: `https://example.test/photos/${i + 1}.jpg`, created_at: perthIso(35, 13, 0, i, now) })),
    purchase_orders: [],
    work_orders: [],
    xero_project: null,
    invoices: [
      { id: IDS.inv2, xero_invoice_id: IDS.xero2, invoice_number: 'INV-9002', invoice_type: 'ACCREC', status: 'DRAFT', reference: 'SWF-990101-DEP50', contact_name: 'Avery Lin', total: 3571.43, amount_due: 3571.43, amount_paid: 0, invoice_date: perthDate(7, now), due_date: perthDate(-7, now), job_id: JOB_ID },
      { id: IDS.inv1, xero_invoice_id: IDS.xero1, invoice_number: 'INV-9001', invoice_type: 'ACCREC', status: 'DELETED', reference: 'SWF-990101-DEP50', contact_name: 'Avery Lin', total: 3571.43, amount_due: 0, amount_paid: 0, invoice_date: perthDate(7, now), due_date: perthDate(-7, now), job_id: JOB_ID },
    ],
    job_contacts: [],
    // job_detail's own summary counts drafts; the screen must never use it.
    invoice_summary: { quoted_total: 7065.85, invoiced_total: 3571.43, paid_total: 0, remaining_to_invoice: 3494.42 },
    business_events: [
      { id: 'be-r-09', event_type: 'client.reply', occurred_at: perthIso(0, 9, 33, 0, now), event_at: perthIso(0, 9, 26, 0, now), payload: { direction: 'inbound', message_text: 'Will do.' } },
      { id: 'be-r-08', event_type: 'event_listener.reaction', occurred_at: perthIso(0, 9, 40, 0, now), payload: { reaction: 'paused' } },
      { id: 'be-r-07', event_type: 'client.sms_out', occurred_at: perthIso(0, 9, 33, 0, now), event_at: perthIso(0, 9, 22, 0, now), payload: { direction: 'outbound', message_text: 'Hi Avery, payment details as follows. Please use the job reference when paying.' } },
      { id: 'be-r-06', event_type: 'client.reply', occurred_at: perthIso(0, 9, 33, 0, now), event_at: perthIso(0, 9, 20, 0, now), payload: { direction: 'inbound', message_text: '' } },
      { id: 'be-r-05', event_type: 'conversation.synced', occurred_at: perthIso(0, 8, 0, 0, now), payload: {} },
      { id: 'be-r-04', event_type: 'client.email_in', occurred_at: perthIso(1, 13, 47, 0, now), event_at: perthIso(1, 13, 36, 0, now), payload: { subject: 'Re: Quote SWF-990101', body: 'Thank you for sending the revised quote, which all looks good.' } },
      { id: 'be-r-03', event_type: 'call.transcript_completed', occurred_at: perthIso(1, 8, 31, 0, now), event_at: perthIso(1, 8, 3, 20, now), payload: { direction: 'outbound', duration_seconds: 7, transcript: 'TRANSCRIPT WORDS MUST NEVER SHOW' } },
      { id: 'be-r-02', event_type: 'client.call_logged', occurred_at: perthIso(1, 8, 18, 0, now), event_at: perthIso(1, 8, 3, 20, now), payload: { direction: 'outbound', duration_seconds: 7 } },
      { id: 'be-r-01', event_type: 'document.text_extracted', occurred_at: perthIso(7, 9, 50, 0, now), event_at: perthIso(7, 7, 57, 0, now), payload: { document: { source_kind: 'email_attachment', file_name: 'Quote_Avery_Lin_Rear_Fence.pdf', page_count: 6 }, text: 'DOCUMENT TEXT MUST NEVER SHOW' } },
    ],
    service_reports: [],
    chase_logs: [],
    readiness: null,
  };
  if (opts.nameMatchedOnly) {
    // job_detail falls back to matching the client name when no invoice carries this job id.
    detail.invoices = [
      { id: '1b9e0000-0000-4000-8000-000000000077', xero_invoice_id: 'xero-other-77', invoice_number: 'INV-7701', invoice_type: 'ACCREC', status: 'AUTHORISED', reference: 'SWP-880001', contact_name: 'Avery Lin', total: 1200, amount_due: 1200, amount_paid: 0, invoice_date: perthDate(60, now), due_date: perthDate(46, now), job_id: OTHER_JOB_ID },
    ];
  }
  return detail;
}

function storyTimeline(now) {
  const at = (d, h, m, s = 0) => perthIso(d, h, m, s, now);
  const row = (a, kind, what, extra = {}) => Object.assign({ at: a, date: a.slice(0, 10), kind, what, phase: null, state: null, amount: null, source_table: 'business_events', source_id: `src-${kind}-${a}` }, extra);
  return [
    row(at(44, 11, 41), 'first_contact', 'First message with the customer on record (sms, from us)'),
    row(at(38, 9, 33), 'job_created', 'Job created (fencing)', { source_table: 'jobs' }),
    row(at(38, 9, 34), 'site_visit', 'Scope first saved in the scoping tool', { source_table: 'job_events' }),
    row(at(35, 13, 48, 1), 'quote', 'Quote Q-9001 v1 sent, value $8,296.75 inc GST', { state: 'superseded', amount: 8296.75, source_table: 'job_documents', source_id: IDS.q1 }),
    row(at(35, 13, 48, 2), 'quote', 'App recorded quote Q-9001 v1 sent to the customer', { state: 'quote_sent', source_table: 'job_events' }),
    row(at(35, 13, 48, 3), 'status', 'Status set to quoted (from draft)'),
    row(at(35, 13, 48, 5), 'system_email', 'Our system emailed the customer (quote, delivered): Your fencing quote from SecureWorks Group - 12 Sample Street', { state: 'delivered', source_table: 'email_events' }),
    row(at(35, 13, 51), 'quote', 'Quote Q-9001 v1 viewed', { state: 'superseded', source_table: 'job_documents', source_id: IDS.q1 }),
    row(at(21, 17, 11), 'document', 'Document read: Quote'),
    row(at(21, 17, 11, 28), 'quote', 'Quote Q-9002 v2 sent, value not recorded (not recorded on the sent quote)', { state: 'superseded', source_table: 'job_documents', source_id: IDS.q2 }),
    row(at(21, 17, 11, 29), 'quote', 'App recorded quote Q-9002 v2 sent to the customer', { state: 'quote_sent', source_table: 'job_events' }),
    row(at(21, 17, 11, 30), 'quote', 'Quote Q-9001 v1 superseded', { state: 'superseded', source_table: 'job_documents', source_id: IDS.q1 }),
    row(at(21, 17, 11, 31), 'system_email', 'Our system emailed the customer (quote, delivered): Your fencing quote from SecureWorks Group - 12 Sample Street', { state: 'delivered', source_table: 'email_events' }),
    row(at(21, 17, 19), 'quote', 'Quote Q-9002 v2 viewed', { state: 'superseded', source_table: 'job_documents', source_id: IDS.q2 }),
    row(perthMidnightIso(7, now), 'invoice', 'Invoice INV-9001 (SWF-990101-DEP50) to Avery Lin: total $3,571.43, deleted in Xero (never counted)', { state: 'voided', amount: 3571.43, source_table: 'xero_invoices', source_id: IDS.inv1 }),
    row(perthMidnightIso(7, now), 'invoice', 'Draft invoice INV-9002 (SWF-990101-DEP50) to Avery Lin: total $3,571.43, not issued (a draft cannot be paid)', { state: 'draft', amount: 3571.43, source_table: 'xero_invoices', source_id: IDS.inv2 }),
    row(at(7, 7, 57), 'document', 'Document read: Quote_Avery_Lin_Rear_Fence.pdf'),
    row(at(1, 6, 56, 47), 'quote', 'Quote Q-9003 v3 sent, value not recorded (not recorded on the sent quote)', { state: 'accepted', source_table: 'job_documents', source_id: IDS.q3 }),
    row(at(1, 6, 56, 48), 'quote', 'App recorded quote Q-9003 v3 sent to the customer', { state: 'quote_sent', source_table: 'job_events' }),
    row(at(1, 6, 56, 49), 'quote', 'Quote Q-9002 v2 superseded', { state: 'superseded', source_table: 'job_documents', source_id: IDS.q2 }),
    row(at(1, 6, 56, 50), 'system_email', 'Our system emailed the customer (quote, delivered): Your fencing quote from SecureWorks Group - 12 Sample Street', { state: 'delivered', source_table: 'email_events' }),
    row(at(1, 12, 3), 'quote', 'Quote Q-9003 v3 viewed', { state: 'accepted', source_table: 'job_documents', source_id: IDS.q3 }),
    row(at(1, 14, 1, 57), 'quote', 'Quote Q-9003 v3 accepted', { state: 'accepted', source_table: 'job_documents', source_id: IDS.q3 }),
    row(at(1, 14, 1, 58), 'status', 'Job record stamp: entered accepted (the job row keeps only the last time it entered this stage)', { source_table: 'jobs' }),
    row(at(1, 14, 1, 59), 'system_email', 'Our system emailed another address (notification, failed): Client update: quote_accepted', { state: 'failed', source_table: 'email_events' }),
    row(at(0, 9, 59), 'status', 'Status set to awaiting deposit', { source_table: 'job_events' }),
  ];
}

// The job_overview payload (ops-api job_overview) as the contract describes it.
function buildJobOverview(opts = {}) {
  const now = opts.now || Date.now();
  const at = (d, h, m, s = 0) => perthIso(d, h, m, s, now);
  const overview = {
    story: {
      version: 'job-story-v1',
      as_of: at(0, 10, 50),
      job: { id: JOB_ID, type: 'fencing', status: 'awaiting_deposit', job_number: 'SWF-990101', client_name: 'Avery Lin', site_suburb: 'Testville' },
      now: {
        line: `Deposit stage since today. 1 draft invoice not issued. Our move, we owe: Avery reports that pressing accept and pay on quote Q-9003 did not lead to a payment link.`,
        next: {
          what: 'Avery reports that pressing accept and pay on quote Q-9003 did not lead to a payment link. Records show Q-9003 accepted but nothing paid.',
          when: null,
          cites: [{ t: 'business_events', id: IDS.msgAcceptAndPay }],
        },
        phase: 'deposit',
        phase_since: perthDate(0, now),
        whose_move: 'us',
        blockers: [],
        monitored: true,
      },
      who: [
        { name: 'Avery Lin', role: 'customer', contact_ref: 'ghl-contact-e2e-001' },
        { name: 'Sam', role: 'us', contact_ref: null },
        { name: 'rear neighbour', role: 'third_party', contact_ref: null },
      ],
      loops: [
        { key: 'issue:quote:q-9003:a1', rank: 1, rule: 'issue', owner: 'us', owner_name: null, counterparty: 'customer', status: 'open', source: 'ledger', what: 'Avery reports that pressing accept and pay on quote Q-9003 did not lead to a payment link.', why: '"We pressed accept and pay but it did not take us to a payment link."', since: at(1, 14, 20), blocks: 'deposit', closes_when: 'A reply that answers it', cites: [{ t: 'business_events', id: IDS.msgAcceptAndPay }] },
        { key: `R3_draft:${IDS.inv2}`, rank: 2, rule: 'R3_draft', owner: 'us', owner_name: null, counterparty: 'customer', status: 'open', source: 'record', what: 'Draft invoice INV-9002 $3,571.43 to Avery Lin not issued (INV-9001 deleted on the same reference)', why: 'A draft in Xero cannot be paid; it is more than a day old', since: perthMidnightIso(7, now), blocks: null, closes_when: 'Approved (issued), voided or deleted in Xero', cites: [{ t: 'xero_invoices', id: IDS.inv2 }] },
        { key: 'request:payment:deposit:b2', rank: 3, rule: 'request', owner: 'customer', owner_name: 'Avery Lin', counterparty: 'us', status: 'open', source: 'ledger', what: 'We asked Avery to let us know once the deposit is paid. Records show nothing paid.', why: '"let me know when it is paid"', since: at(7, 9, 4), blocks: 'booking', closes_when: 'The payment is received', cites: [] },
        { key: 'dependency:payment:neighbour-share:c3', rank: 4, rule: 'dependency', owner: 'third_party', owner_name: null, counterparty: 'us', status: 'open', source: 'ledger', what: 'The job waits on the rear neighbour agreeing to pay half of the rear fence.', why: '"they do want to go ahead with it"', since: at(2, 10, 17), blocks: null, closes_when: 'A reply that answers it', cites: [] },
        { key: 'constraint:booking:tenants:d4', rank: 5, rule: 'constraint', owner: 'us', owner_name: null, counterparty: 'customer', status: 'open', source: 'ledger', what: `The tenants are away for about two and a half weeks ${EM} Avery wants the fence done while they are away.`, why: '"while they are away"', since: at(7, 15, 41), blocks: 'booking', closes_when: null, cites: [] },
        { key: 'R8_not_yet_invoiced', rank: 6, rule: 'R8_not_yet_invoiced', owner: 'us', owner_name: null, counterparty: 'customer', status: 'not_due', source: 'record', what: '$7,065.85 of the job value not yet invoiced.', why: 'The job value is not fully invoiced yet', since: at(1, 14, 1), blocks: null, closes_when: 'Invoiced in full', cites: [] },
      ],
      money: {
        line: 'Invoiced $0.00, paid $0.00, owing $0.00; 1 draft invoice of $3,571.43 not issued.',
        parties: [{ party: 'Avery Lin', invoiced: 0, paid: 0, owing: 0, overdue: 0, drafts: 1, draft_total: 3571.43, invoices: [{ id: IDS.inv2, number: 'INV-9002', status: 'DRAFT', total: 3571.43, paid: 0, owing: 0 }] }],
        job_value: { basis: 'pricing_json.totalIncGST', amount: 7065.85 },
        not_yet_invoiced: { amount: 7065.85 },
        supplier_bills: [],
      },
      timeline: storyTimeline(now),
      events: [
        { at: at(18, 15, 1), key: 'event:quote:q-9002:e5', what: 'On a call, Avery said they would go ahead with us. No acceptance record existed then and the job was still quoted.', cites: [] },
        { at: at(1, 14, 20, 5), key: 'event:quote:q-9003:f6', what: 'Avery said they had forwarded quote Q-9003 to the rear neighbours.', cites: [{ t: 'business_events', id: IDS.msgAcceptAndPay }] },
      ],
      phase_notes: [],
      agreements: [],
      not_known: [],
      meta: {
        ledger: { status: 'live', items: 12, stale: false, unread_rows: 0, needs_rebuild: false, evidence_until: at(0, 9, 33) },
        built_at: at(0, 10, 50),
        evidence_rows: 40,
      },
    },
    notes: { status: 'live', items: [
      { id: 'note-1', item_type: 'request', status: 'open', from_role: 'us', from_name: 'Sam', to_role: 'customer', to_name: 'Avery Lin', what: 'We asked Avery to let us know once the deposit is paid.', due_date: null, blocks: 'booking', opened_at: at(7, 9, 4), closed_at: null, quote: 'let me know when it is paid' },
    ] },
    messages: [
      { id: '2c9e0000-0000-4000-8000-000000000001', at: at(2, 10, 17), channel: 'sms', direction: 'inbound', who: 'Avery Lin', text: 'Morning Sam, the neighbour wants to go ahead but would like the asbestos metres on their part corrected first.', kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000002', at: at(2, 10, 24), channel: 'sms', direction: 'outbound', who: 'Sam', text: 'Hi Avery, I will review it this evening and send it back to you.', kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000003', at: at(1, 6, 58), channel: 'sms', direction: 'outbound', who: 'Sam', text: `Hi Avery, I have gone back over the quote ${EM} the rear is 6m of Hardie and 14.5m of asbestos, 2${EN}3 days of work.`, kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000004', at: at(1, 8, 3, 20), channel: 'call', direction: 'outbound', who: 'Sam', text: '', kind: 'call', call_seconds: 7 },
      // A transcript row the backend should already have merged; the screen merges it again and never shows its words.
      { id: '2c9e0000-0000-4000-8000-000000000044', at: at(1, 8, 3, 21), channel: 'call', direction: 'outbound', who: 'Sam', text: 'TRANSCRIPT WORDS MUST NEVER SHOW', kind: 'transcript', event_type: 'call.transcript_completed', call_seconds: 7 },
      { id: '2c9e0000-0000-4000-8000-000000000005', at: at(1, 13, 36), channel: 'email', direction: 'inbound', who: 'Avery Lin', text: 'Subject: Re: Quote SWF-990101. Thank you for sending the revised quote, which all looks good. We will pay the deposit this afternoon.', kind: 'message' },
      { id: IDS.msgAcceptAndPay, at: at(1, 14, 20), channel: 'sms', direction: 'inbound', who: 'Avery Lin', text: 'Thanks Sam. We pressed accept and pay but it did not take us to a payment link.', kind: 'message' },
      // Machine rows the backend should have hidden; the screen drops them again.
      { id: '2c9e0000-0000-4000-8000-000000000090', at: at(0, 9, 10), channel: null, direction: null, who: null, text: 'event listener reaction', kind: 'event_listener.reaction', event_type: 'event_listener.reaction' },
      { id: '2c9e0000-0000-4000-8000-000000000091', at: at(0, 9, 11), channel: 'sms', direction: 'inbound', who: 'Avery Lin', text: '', kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000007', at: at(0, 9, 22), channel: 'sms', direction: 'outbound', who: 'Sam', text: 'Hi Avery, payment details as follows. Please use the job reference when paying.', kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000008', at: at(0, 9, 23), channel: 'sms', direction: 'inbound', who: 'Avery Lin', text: 'Thanks Sam.', kind: 'message' },
      { id: '2c9e0000-0000-4000-8000-000000000009', at: at(0, 9, 26), channel: 'sms', direction: 'inbound', who: 'Avery Lin', text: 'Will do.', kind: 'message' },
    ],
    files: {
      quotes: [
        { id: IDS.q3, quote_number: 'Q-9003', version: 3, sent_at: at(1, 6, 56, 47), first_viewed_at: at(1, 12, 3), accepted_at: at(1, 14, 1, 57), superseded_at: null, view_count: 15, value_inc_gst: null },
        { id: IDS.q2, quote_number: 'Q-9002', version: 2, sent_at: at(21, 17, 11, 28), first_viewed_at: at(21, 17, 19), accepted_at: null, superseded_at: at(1, 6, 56, 49), view_count: 7, value_inc_gst: null },
        { id: IDS.q1, quote_number: 'Q-9001', version: 1, sent_at: at(35, 13, 48, 1), first_viewed_at: at(35, 13, 51), accepted_at: null, superseded_at: at(21, 17, 11, 30), view_count: 6, value_inc_gst: 8296.75 },
      ],
      invoices: [
        { id: IDS.inv2, invoice_number: 'INV-9002', invoice_type: 'ACCREC', reference: 'SWF-990101-DEP50', status: 'DRAFT', total: 3571.43, amount_paid: 0, amount_due: 3571.43, invoice_date: perthDate(7, now), due_date: perthDate(-7, now) },
        // Deleted in Xero; a false "paid" event once claimed it was paid. It never counts.
        { id: IDS.inv1, invoice_number: 'INV-9001', invoice_type: 'ACCREC', reference: 'SWF-990101-DEP50', status: 'DELETED', total: 3571.43, amount_paid: 3571.43, amount_due: 0, invoice_date: perthDate(7, now), due_date: perthDate(-7, now) },
      ],
      attachments: [
        { file_name: 'Quote_Avery_Lin_Rear_Fence.pdf', at: at(7, 7, 57), page_count: 6 },
        { file_name: 'Quote_Avery_Lin_Rear_Fence.pdf', at: at(7, 9, 44), page_count: 6 },
        { file_name: `Site plan ${EN} rear.pdf`, at: at(7, 9, 44), page_count: 1 },
      ],
      media_count: 10,
      scope: true,
    },
    story_text: { status: 'none', writer: { on: true, open_request: null } },
  };
  if (opts.writtenStory) {
    overview.story_text = {
      status: 'fresh',
      text: {
        written_at: at(0, 10, 52),
        evidence_until: at(0, 9, 33),
        sections: {
          headline: 'Avery has accepted the quote and wants to pay, but there is still no invoice they can pay.',
          the_job: `Replace the 23m back and side fence ${EM} the old asbestos fence comes out and Colorbond goes in. The rear neighbour pays half of the rear section.`,
          how_we_got_here: 'Sam scoped it and quoted $8,296.75, then revised it twice. Avery accepted the third version yesterday.',
          where_it_is_at: 'Avery said they would pay the deposit, but the only deposit invoice in Xero is a draft.',
          watch_out: 'A draft in Xero cannot be paid.',
        },
      },
    };
  }
  if (opts.staleStory) overview.story_text.status = 'stale';
  return overview;
}

module.exports = { JOB_ID, OTHER_JOB_ID, IDS, perthIso, perthDate, perthMidnightIso, buildJobDetail, buildJobOverview };
