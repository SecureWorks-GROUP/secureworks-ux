/**
 * Dispatch v2 payment step test fixtures (backend contract section 3c,
 * secureworks-backend branch dispatch/payment-step-a): one repair job with
 * two pay-first supplier orders (Lysaght and Twinside Retaining, as on the
 * job that started it) and, when asked, one on-account order (Stratco WA).
 *
 * fakePayment() keeps its own state and answers the board, dispatch_arrival,
 * dispatch_v2_materials and the payment presses the way the contract says.
 * With { old: true } every new field is left out: what today's live backend
 * sends, so the screen must behave exactly as it does now.
 *
 * The job number and the client are made up.
 */
const { PERTH_TODAY } = require('./dispatch-v2-board');

const JOB_ID = 'job-pay1';
const JOB_NUMBER = 'SWR-930001';
const SID = (n) => `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BOX = (n) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LID = (n) => `1e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EID = (n) => `ee000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// A Perth day n days from today, as YYYY-MM-DD.
const dayFrom = (n) => new Date(Date.parse(PERTH_TODAY + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The page's own short day words: "Mon 2/11" (this year).
const dayWords = (iso) => { const d = new Date(iso + 'T00:00:00Z'); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };

const STAGE_LABELS = {
  order_materials: 'Order materials', sent: 'Sent to supplier', quote_received: 'Quote received', awaiting_payment: 'Awaiting payment',
  order_confirmed: 'Order confirmed', manufacturing: 'Manufacturing', ready: 'Materials ready', delivered: 'Delivered',
};

// The boxes on the job. Each: supplier, terms, delivery or pickup, the date
// on the box and whether it is confirmed, the stage it would show without a
// payment stamp (and how it got there), and the stamps.
function seedBoxes(opts = {}) {
  const boxes = [
    {
      n: 1, name: 'Lysaght', terms: 'pay_first', fulfilment: 'pickup', date: dayFrom(4), confirmed: true, dateMode: 'asap',
      stage: 'awaiting_payment', stageSource: 'reply', stageAt: null, stageBy: null,
      reply: { email_id: EID(91), received_at: '2026-10-29T04:58:00Z', rung: 'thread' }, paid: null, payOn: null,
    },
    {
      n: 2, name: 'Twinside Retaining', terms: 'pay_first', fulfilment: 'pickup', date: null, confirmed: false, dateMode: 'asap',
      stage: 'awaiting_payment', stageSource: 'reply', stageAt: null, stageBy: null,
      reply: { email_id: EID(92), received_at: '2026-10-29T06:16:00Z', rung: 'thread' }, paid: null, payOn: null,
    },
  ];
  if (opts.onAccount) {
    boxes.push({
      n: 3, name: 'Stratco WA', terms: 'on_account', fulfilment: 'delivery', date: dayFrom(6), confirmed: true, dateMode: 'date',
      stage: 'order_confirmed', stageSource: 'worked_out', stageAt: null, stageBy: null, reply: null, paid: null, payOn: null,
    });
  }
  return boxes;
}

function fakePayment(opts = {}) {
  const old = opts.old === true;
  let clock = Date.parse('2026-10-29T06:40:00.000Z');
  const stamp = () => new Date((clock += 60000)).toISOString();
  const fake = { boxes: seedBoxes(opts), fail: {}, install: opts.install || null, accept: null };
  Object.assign(fake.boxes[0], opts.lysaght || {});
  if (opts.twinside) Object.assign(fake.boxes[1], opts.twinside);
  const forced = (action) => { const q = fake.fail[action]; return q && q.length ? q.shift() : null; };
  const no = (status, code, extra) => ({ status, body: Object.assign({ error: 'e2e refusal: ' + code, code }, extra) });
  const boxBy = (b) => fake.boxes.find((x) => (b.box_id && BOX(x.n) === b.box_id) || (!b.box_id && SID(x.n) === b.supplier_id));

  // The payment object (DispatchV2Payment), from the box's stamps.
  const payment = (bx) => {
    const pf = bx.terms === 'pay_first';
    const state = bx.paid ? 'paid' : bx.payOn ? 'pay_on_' + bx.payOn.v : pf ? 'unpaid' : 'not_needed';
    const counts = !!bx.paid || !!bx.payOn;
    return {
      terms: bx.terms, state, paid: !!bx.paid,
      paid_at: bx.paid ? bx.paid.at : null, paid_by_email: bx.paid ? bx.paid.by : null,
      pay_on: bx.payOn ? bx.payOn.v : null, pay_on_set_at: bx.payOn ? bx.payOn.at : null, pay_on_set_by_email: bx.payOn ? bx.payOn.by : null,
      earlier_order_paid_at: bx.earlierPaidAt || null, earlier_order_pay_on_set_at: null,
      holds_stage: pf && !counts && bx.confirmed, blocks_job_move: pf && !counts && bx.stage !== 'delivered',
      can_mark_paid: pf && !bx.paid, can_undo_paid: !!bx.paid, can_set_pay_on: true,
      guard: { paid_at: bx.paid ? bx.paid.at : bx.earlierPaidAt || null, pay_on_set_at: bx.payOn ? bx.payOn.at : null },
    };
  };
  const pickup = (bx) => bx.fulfilment === 'pickup';
  const skipsReady = (bx) => pickup(bx) && !!fake.install && bx.date === fake.install;
  // The stage shown: a counting paid or Pay on stamp moves it to Order
  // confirmed (newer than the reply), else what the box says.
  const stageOf = (bx) => {
    if (!old && (bx.paid || bx.payOn) && !['manufacturing', 'ready', 'delivered'].includes(bx.stage)) {
      const at = bx.paid ? bx.paid.at : bx.payOn.at;
      return { key: 'order_confirmed', source: 'payment', set_at: null, set_by_email: null, at };
    }
    if (old && bx.stageSource !== 'set') return { key: bx.stage === 'awaiting_payment' ? 'sent' : bx.stage, source: 'worked_out', set_at: null, set_by_email: null };
    return { key: bx.stage, source: bx.stageSource, set_at: bx.stageAt, set_by_email: bx.stageBy };
  };
  const labelOf = (bx, key) => (key === 'delivered' && pickup(bx) && !old ? 'Picked up' : STAGE_LABELS[key]);
  const waitingOf = (bx, key) => {
    if (['order_materials', 'quote_received', 'awaiting_payment', 'ready'].includes(key)) return 'us';
    if (key === 'order_confirmed') return !bx.date && !old ? 'supplier' : fake.install ? 'supplier' : 'us';
    if (key === 'delivered') return 'nobody';
    return 'supplier';
  };
  const todoOf = (bx, key) => {
    if (key === 'awaiting_payment') return 'Pay ' + bx.name;
    if (key === 'quote_received') return 'Check the quote from ' + bx.name;
    if (key === 'order_confirmed') return !bx.date && !old ? 'Waiting on ' + bx.name + ' for a date' : fake.install ? 'Waiting on ' + bx.name + ' for the materials' : 'Book the install and tell the client';
    if (key === 'ready') return pickup(bx) && !old ? 'Materials ready to be picked up' + (bx.date ? ', ' + dayWords(bx.date) : '') : 'Arrange delivery or pickup from ' + bx.name;
    if (key === 'manufacturing') return bx.name + ' is making it';
    if (key === 'sent') return 'Waiting on ' + bx.name + ' to reply';
    return null;
  };

  // One Arrival line order (board.arrival.orders[] and dispatch_arrival).
  const order = (bx) => {
    const st = stageOf(bx);
    const o = {
      key: 'box:' + SID(bx.n), source: 'supplier_box', supplier_id: SID(bx.n), supplier_name: bx.name, order_sent: true, sent_at: '2026-10-29T04:28:00Z',
      delivery_date: bx.date, date_source: bx.date ? 'box' : null, date_confirmed: bx.confirmed, box_id: BOX(bx.n),
      box_date_source: bx.date ? 'supplier_reply' : null, box_date_set_at: bx.date ? '2026-10-29T05:26:00Z' : null, box_date_set_by_email: bx.date ? 'shaun@ops.test' : null,
      fulfilment: bx.fulfilment, mark: bx.confirmed ? 'solid' : bx.date ? 'ring' : 'none',
      flag: bx.date ? null : old || bx.dateMode !== 'asap' ? 'no_date' : 'asap',
      material_stage: st.key, material_stage_label: labelOf(bx, st.key), material_stage_source: st.source,
      material_stage_set_at: st.set_at, material_stage_set_by_email: st.set_by_email,
      waiting_on: waitingOf(bx, st.key), todo: waitingOf(bx, st.key) === 'us' || !old ? todoOf(bx, st.key) : null, extra: false,
    };
    if (old) return o;
    return Object.assign(o, {
      material_stage_reply: st.source === 'reply' ? bx.reply : null,
      held_by_payment: payment(bx).holds_stage && ['awaiting_payment'].includes(st.key),
      skips_ready: skipsReady(bx), payment: payment(bx), date_mode: bx.dateMode,
    });
  };

  const arrival = () => {
    const orders = fake.boxes.map(order);
    const onUs = orders.filter((o) => o.waiting_on === 'us' && o.todo).map((o) => o.todo);
    const a = {
      today: PERTH_TODAY, install_day: fake.install, orders,
      counts: {
        orders: orders.length, sent: orders.length, confirmed: orders.filter((o) => o.mark === 'solid').length,
        late: orders.filter((o) => o.flag === 'no_date' || o.flag === 'after_install').length,
        open: orders.filter((o) => o.material_stage !== 'delivered').length, on_us: onUs.length, extra_open: 0,
      },
      all_confirmed_in_time: orders.every((o) => o.mark === 'solid' && !o.flag),
      waiting_on_us: onUs,
    };
    if (old) return a;
    const unpaid = fake.boxes.filter((bx) => payment(bx).blocks_job_move).map((bx) => bx.name);
    Object.assign(a.counts, {
      unpaid: unpaid.length, held_by_payment: orders.filter((o) => o.held_by_payment).length,
      asap_waiting: orders.filter((o) => o.flag === 'asap').length,
    });
    a.payment = { any_unpaid: unpaid.length > 0, unpaid_suppliers: unpaid };
    a.earliest_install = null;
    return a;
  };
  const waiting = () => { const a = arrival(); return { on_us: a.waiting_on_us.length > 0, todo: a.waiting_on_us }; };
  const paymentHold = () => (old ? undefined : arrival().payment.any_unpaid);

  // The list row (a v1-shaped pipeline row with its own board block).
  fake.row = () => {
    const b = { title: JOB_NUMBER + ' · Peter Example', suburb: 'Willagee', install: fake.install ? { booked: true, day: fake.install, first_day: fake.install, last_day: fake.install, archive_on: null, passed: false, tentative: true } : { booked: false, day: null, first_day: null, last_day: null, archive_on: null, passed: false, tentative: false }, days_in_stage: 1, arrival: arrival(), waiting: waiting() };
    if (!old) b.payment_hold = paymentHold();
    return {
      id: JOB_ID, job_number: JOB_NUMBER, client_name: 'Peter Example', site_suburb: 'Willagee', type: 'repair', work_type: 'repair', status: 'materials',
      site_address: '1 Example Street', value: 1800, value_inc_gst: true, description: 'Retaining wall repair', next_scheduled_date: fake.install, last_scheduled_date: null,
      council_status: null, council_required: false, po_count: 0, dispatch_next_step: null, ghl_contact_id: null, updated_at: '2026-10-29T05:00:00+00:00',
      board: b,
    };
  };
  fake.arrivalAnswer = () => {
    const out = { job_id: JOB_ID, job_number: JOB_NUMBER, work_type: 'repair', stage: { track: 'repairs', key: 'materials', label: 'Materials', order: 1, phase: 'window' }, install: null, installs: 'ok', arrival: arrival(), arrival_read: 'ok', waiting: waiting() };
    if (!old) Object.assign(out, { payment_hold: paymentHold(), accounts_read: 'ok', replies_read: 'ok' });
    return out;
  };
  const stageObj = (bx) => {
    const st = stageOf(bx);
    const o = { box_id: BOX(bx.n), key: st.key, label: labelOf(bx, st.key), source: st.source, set_at: st.set_at, set_by_email: st.set_by_email };
    if (old) return o;
    return Object.assign(o, { reply: st.source === 'reply' ? bx.reply : null, held_by_payment: order(bx).held_by_payment, skips_ready: skipsReady(bx) });
  };
  fake.materials = () => ({
    job_id: JOB_ID, job_number: JOB_NUMBER, work_type: 'repair', team_cc: { email: 'ses@secureworkswa.com.au', open_question: null },
    from: 'admin@secureworkswa.com.au', test_send_done: true, main_supplier_id: null, main_supplier_ticked: false, can_suggest: false,
    draft_list: { lines: [], photos: [] },
    suppliers: fake.boxes.map((bx, i) => {
      const s = {
        supplier_id: SID(bx.n), name: bx.name, active: true, position: i + 1, is_main: false,
        approved_email: { id: 'ap-' + bx.n, name: bx.name, used_for: 'fencing', to: ['orders@' + bx.name.split(' ')[0].toLowerCase() + '.example'], cc: ['ses@secureworkswa.com.au'] },
        send_blocked: null,
        lines: [{ id: LID(bx.n), supplier_id: SID(bx.n), description: bx.n === 1 ? '1800H standard width panels' : 'Sleepers 200 x 75', quantity: 2, unit: null, detail: null, profile: null, colour: null,
          status: 'to_order', source: 'manual', sent_on_email_id: EID(bx.n), locked: true, position: 0, updated_at: '2026-10-29T04:00:00Z' }],
        photos: [], open_email: null,
        sent_emails: [{ id: EID(bx.n), supplier_id: SID(bx.n), supplier_name: bx.name, status: 'sent', from: 'admin@secureworkswa.com.au', to: ['orders@example.test'], cc: [],
          subject: 'Material Order Ref ' + JOB_NUMBER, body_text: 'Hi Team, could we please order the following for ' + bx.fulfilment + ':', delivery_date: null, fulfilment: bx.fulfilment,
          line_count: 1, photo_ids: [], empty_detail_lines: [], sent: { sent_at: '2026-10-29T04:28:00Z', sent_by_email: 'shaun@ops.test' }, updated_at: '2026-10-29T04:28:00Z' }],
        fulfilment: bx.fulfilment, material_stage: stageObj(bx),
      };
      if (!old) {
        s.payment = payment(bx);
        s.approved_email.on_account = bx.terms === 'on_account';
      }
      return s;
    }),
  });

  const boxAnswer = (bx, unchanged) => ({
    success: true, unchanged: !!unchanged, job_status_changed: false,
    box: { box_id: BOX(bx.n), job_id: JOB_ID, supplier_id: SID(bx.n), supplier_name: bx.name, material_stage: stageOf(bx).key, material_stage_label: labelOf(bx, stageOf(bx).key), payment: payment(bx) },
    arrival: fake.arrivalAnswer(),
  });

  fake.api = {
    pipeline: () => ({ columns: { accepted: [fake.row()] }, total: 1, dispatch_materials: 'ok' }),
    dispatch_arrival: () => fake.arrivalAnswer(),
    dispatch_v2_materials: () => forced('dispatch_v2_materials') || fake.materials(),
    dispatch_v2_mark_paid: (url, b) => {
      const f = forced('dispatch_v2_mark_paid');
      if (f) return f;
      const bx = boxBy(b);
      if (!bx) return no(404, 'box_not_found');
      if (bx.terms === 'on_account') return no(409, 'on_account');
      if ((b.expected_paid_at || null) !== payment(bx).guard.paid_at) return no(409, 'paid_changed', { box: boxAnswer(bx).box });
      if (bx.paid) return boxAnswer(bx, true);
      bx.paid = { at: stamp(), by: 'shaun@ops.test' };
      bx.earlierPaidAt = null;
      return boxAnswer(bx);
    },
    dispatch_v2_undo_paid: (url, b) => {
      const f = forced('dispatch_v2_undo_paid');
      if (f) return f;
      const bx = boxBy(b);
      if (!bx) return no(404, 'box_not_found');
      if (!b.expected_paid_at) return no(400, 'invalid_request');
      if (!bx.paid) return boxAnswer(bx, true);
      if (b.expected_paid_at !== bx.paid.at) return no(409, 'paid_changed', { box: boxAnswer(bx).box });
      bx.paid = null;
      return boxAnswer(bx);
    },
    dispatch_v2_set_pay_on: (url, b) => {
      const f = forced('dispatch_v2_set_pay_on');
      if (f) return f;
      const bx = boxBy(b);
      if (!bx) return no(404, 'box_not_found');
      if (![null, 'pickup', 'delivery'].includes(b.pay_on)) return no(400, 'invalid_request');
      if ((b.expected_set_at || null) !== payment(bx).guard.pay_on_set_at) return no(409, 'pay_on_changed', { box: boxAnswer(bx).box });
      if ((bx.payOn ? bx.payOn.v : null) === b.pay_on) return boxAnswer(bx, true);
      bx.payOn = b.pay_on ? { v: b.pay_on, at: stamp(), by: 'shaun@ops.test' } : null;
      return boxAnswer(bx);
    },
    dispatch_v2_set_material_stage: (url, b) => {
      const bx = boxBy(b);
      if (!bx) return no(404, 'box_not_found');
      bx.stage = b.material_stage;
      bx.stageSource = 'set';
      bx.stageAt = stamp();
      bx.stageBy = 'shaun@ops.test';
      // A hand pick of Awaiting payment re-opens the payment (the stamp stays, from an earlier moment).
      if (b.material_stage === 'awaiting_payment' && bx.paid) { bx.earlierPaidAt = bx.paid.at; bx.paid = null; }
      return Object.assign(boxAnswer(bx), { box: Object.assign(boxAnswer(bx).box, { set_at: bx.stageAt, set_by_email: bx.stageBy }) });
    },
    dispatch_v2_set_date_mode: (url, b) => {
      const f = forced('dispatch_v2_set_date_mode');
      if (f) return f;
      const bx = boxBy(b);
      if (!bx) return no(404, 'box_not_found');
      if (!['asap', 'date'].includes(b.date_mode)) return no(400, 'invalid_request');
      if (bx.dateMode === b.date_mode) return boxAnswer(bx, true);
      bx.dateMode = b.date_mode;
      return boxAnswer(bx);
    },
  };
  fake.payment = payment;
  return fake;
}

module.exports = { JOB_ID, JOB_NUMBER, SID, BOX, EID, dayFrom, dayWords, fakePayment };
