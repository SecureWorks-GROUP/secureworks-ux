/**
 * Dispatch v2 test helpers: the board answer (pipeline&dispatch=1&board=v2)
 * built from a v1-shaped stub answer, and the empty answers of the v2 reads
 * (the Arrival line, Supplier replies, the Unmatched tray and Materials).
 *
 * Shared by ops-tab-set.spec.js, ops-dispatch-panel.spec.js and
 * ops-dispatch-v2.spec.js so each spec keeps its own job rows.
 */
// ── Dispatch v2: the board answer (pipeline&dispatch=1&board=v2) ──
// The tab reads only the v2 board. V2_ANSWER turns a v1-shaped stub answer
// ({ columns, total }) into the v2 one, so the slice 1, 4 and 5 tests keep
// their own rows: each row gets a board block (its stage from its status,
// Order Materials when the status is not a board stage; the install day from
// next_scheduled_date / last_scheduled_date) and the stage groups list them
// newest first. A row may carry its own `board` (merged over the made one).
// The v2 behaviour itself is tested in ops-dispatch-v2.spec.js.
// An answer marked `v1: true` is passed through untouched: an ops-api that
// does not know board=v2 yet.
const V2_STAGES = {
  pipeline: [['order_materials', 'Order Materials'], ['awaiting_supplier', 'Awaiting Supplier'], ['order_confirmed', 'Order Confirmed'], ['schedule_install', 'Schedule Install'], ['scheduled', 'Scheduled']],
  repairs: [['materials', 'Materials'], ['scheduled', 'Scheduled']],
};
const PERTH_TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
function V2_BOARD_ROW(row, view) {
  const track = row.type === 'repair' ? 'repairs' : 'pipeline';
  const stages = V2_STAGES[track];
  const own = stages.find((s) => s[0] === row.status);
  const key = own ? own[0] : stages[0][0];
  const label = (own || stages[0])[1];
  const next = row.next_scheduled_date || null;
  const last = row.last_scheduled_date || null;
  const day = next || last;
  const made = {
    view, track, stage_key: key, stage_label: label, stage_order: stages.findIndex((s) => s[0] === key) + 1, stage_phase: 'window',
    real_status: row.status, repair_stage: track === 'repairs' ? key : null,
    // The screen prints the board's title as it comes. These older tests keep
    // their number and suburb titles; ops-dispatch-v2.spec.js uses the real
    // "SWF-xxxxx · Full Name" form.
    title: row.site_suburb ? `${row.job_number} · ${row.site_suburb}` : row.job_number, job_number: row.job_number, client_name: row.client_name, suburb: row.site_suburb || null,
    work_type: row.work_type || null, days_in_stage: null, in_stage_since: null, days_in_stage_source: null,
    install: day ? { booked: true, day, first_day: day, last_day: day, archive_on: null, passed: !next, tentative: false } : { booked: false, day: null, first_day: null, last_day: null, archive_on: null, passed: false, tentative: false },
    deposit: track === 'repairs' ? { required: false, paid: null, state: 'not_required' } : { required: true, paid: true, state: 'paid' },
    flags: { deposit_not_paid: false, no_install_booked: false, install_date_passed: false },
    moves: track === 'repairs'
      ? { action: 'update_repair_stage', field: 'repair_stage', current: key, targets: stages.filter((s) => s[0] !== key).map((s) => ({ key: s[0], label: s[1], direction: 'forward' })) }
      : { action: 'update_job_status', field: 'status', current: key, targets: stages.filter((s) => s[0] !== key).map((s, i) => ({ key: s[0], label: s[1], direction: i < stages.findIndex((x) => x[0] === key) ? 'back' : 'forward' })) },
    arrival: { today: PERTH_TODAY, install_day: next, orders: [], counts: { orders: 0, sent: 0, confirmed: 0, late: 0 }, all_confirmed_in_time: false },
  };
  return Object.assign(made, row.board || {});
}
function V2_ANSWER(resp, view = 'active') {
  if (!resp || typeof resp !== 'object' || !resp.columns || resp.v1 === true || (resp.board && resp.board.version === 'v2')) return resp;
  const rows = [];
  Object.keys(resp.columns).forEach((c) => (resp.columns[c] || []).forEach((r) => rows.push(Object.assign({}, r, { board: V2_BOARD_ROW(r, view) }))));
  rows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const groups = [];
  ['pipeline', 'repairs'].forEach((track) => V2_STAGES[track].forEach(([key, label]) => {
    const ids = rows.filter((r) => r.board.track === track && r.board.stage_key === key).map((r) => r.id);
    groups.push({ key: track === 'repairs' ? 'repair_' + key : key, track, label: track === 'repairs' ? 'Repairs: ' + label : label, count: ids.length, job_ids: ids });
  }));
  const stages = {};
  Object.keys(V2_STAGES).forEach((t) => { stages[t] = V2_STAGES[t].map(([key, label], i) => ({ track: t, key, label, order: i + 1 })); });
  const out = Object.assign({}, resp, { columns: { [view]: rows } });
  out.board = Object.assign({ version: 'v2', view, today: PERTH_TODAY, stages, reads: { installs: 'ok', days_in_stage: 'ok', deposits: 'ok', arrival: 'ok' },
    groups, total: rows.length, archive_days: 30 }, resp.board || {});
  return out;
}

// The v2 reads beside the board, each empty: what a job with no supplier
// order and no supplier email answers.
const V2_EMPTY_READS = {
  dispatch_arrival: (url) => ({ job_id: url.searchParams.get('job_id'), install: null, installs: [], arrival: null, arrival_read: 'ok' }),
  dispatch_v2_replies: (url) => ({ ok: true, job_id: url.searchParams.get('job_id'), emails: [], suggestions: [], orders: [], orders_wired: true, scan: { enabled: true } }),
  dispatch_v2_replies_unmatched: () => ({ ok: true, include_other: false, emails: [], counts: { needs_confirmation: 0, unmatched_order_desk: 0, unmatched_other: 0 } }),
  // Materials (slices 5 and 6): an empty Draft list and no supplier boxes.
  dispatch_v2_materials: (url) => ({
    job_id: url.searchParams.get('job_id'), job_number: null, work_type: 'fencing', team_cc: { email: 'fencing@secureworkswa.com.au', open_question: null },
    from: 'admin@secureworkswa.com.au', test_send_done: false, main_supplier_id: null, main_supplier_ticked: false, can_suggest: false,
    draft_list: { lines: [], photos: [] }, suppliers: [],
  }),
  // Kept from v1 (the working out pad, Deliveries and old purchase orders):
  // an empty pad, no orders and no deliveries.
  dispatch_materials: () => ({
    suppliers: [], lines: [], counts: { total: 0, ready: 0 }, can_suggest: false,
    workings: { working_out: '', working_out_updated_at: null, sketch_png: null, sketch_updated_at: null },
    orders_status: 'ok', orders: [], deliveries: { rows: [], counted: 0, sighted: 0, all_sighted: false },
  }),
};

module.exports = { V2_STAGES, PERTH_TODAY, V2_BOARD_ROW, V2_ANSWER, V2_EMPTY_READS };
