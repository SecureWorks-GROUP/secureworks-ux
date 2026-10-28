// Stand-ins for ops-api job_bookings and reschedule_job_bookings in the
// calendar specs.
//
// ops-api plans a whole-job move or stretch with a port of the calendar's own
// planner (secureworks-backend supabase/functions/ops-api/job_bookings.ts is
// a port of CalOpsCore.planJobMove / planJobStretch), so this stub plans with
// the REAL CalOpsCore read out of ops.html between its sentinels, the way
// tests/e2e/cal-workdays.spec.js does. It never re-declares the date rules.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const OPS_HTML = resolve(__dirname, '../../ops.html');
const OPEN = '// <calendar-ops-core>';
const CLOSE = '// </calendar-ops-core>';

let core = null;
function calOpsCore() {
  if (core) return core;
  const html = readFileSync(OPS_HTML, 'utf8');
  const a = html.indexOf(OPEN);
  const b = html.indexOf(CLOSE);
  if (a < 0 || b < 0 || b <= a) throw new Error(`calendar-ops-core sentinels not found in ${OPS_HTML}`);
  // eslint-disable-next-line no-new-func
  core = new Function(html.slice(a + OPEN.length, b) + '\n;return CalOpsCore;')();
  return core;
}

const idOf = (row) => row.assignment_id || row.id;
const statusOf = (row) => row.status || row.assignment_status || null;

// The light read's shape: a job's non-cancelled bookings, these fields only.
function jobBookingsAnswer(jobId, rows) {
  return {
    job_id: jobId,
    bookings: rows
      .filter((row) => row.job_id === jobId && String(statusOf(row) || '').toLowerCase() !== 'cancelled')
      .map((row) => ({
        id: idOf(row),
        user_id: row.user_id || null,
        role: row.role || null,
        status: statusOf(row),
        is_ghost: row.is_ghost === true,
        scheduled_date: row.scheduled_date,
        scheduled_end: row.scheduled_end || null,
      })),
  };
}

// Plans a reschedule_job_bookings body over the job's live rows. `rows` are
// calendar-feed shaped (assignment_id); rows carrying only `id` are given one.
function planReschedule(rows, body) {
  const C = calOpsCore();
  const live = rows
    .filter((row) => row.job_id === body.job_id)
    .map((row) => (row.assignment_id ? row : { ...row, assignment_id: row.id }))
    .filter(C.isLiveJobRow);
  return body.mode === 'move'
    ? C.planJobMove(live, body.new_start)
    : C.planJobStretch(live, body.edge, body.target);
}

// Writes a plan onto `rows` in place: updates move, deletes go, creates are
// added from `makeRow(create, template)`. Answers the ops-api success shape.
function applyReschedule(rows, body, plan, makeRow) {
  const byId = (id) => rows.find((row) => idOf(row) === id);
  const updated = [], created = [], deleted = [];
  for (const d of plan.deletes) {
    const index = rows.findIndex((row) => idOf(row) === d.ev.assignment_id);
    if (index !== -1) { rows.splice(index, 1); deleted.push(d.ev.assignment_id); }
  }
  for (const u of plan.updates) {
    const row = byId(u.ev.assignment_id);
    if (!row) continue;
    if (u.update.scheduled_date) row.scheduled_date = u.update.scheduled_date;
    if (u.update.scheduled_end) row.scheduled_end = u.update.scheduled_end;
    if (u.update.duration_days != null) row.duration_days = u.update.duration_days;
    updated.push({ id: idOf(row), user_id: row.user_id, scheduled_date: row.scheduled_date, scheduled_end: row.scheduled_end });
  }
  for (const c of plan.creates) {
    const row = makeRow(c.create, c.template);
    rows.push(row);
    created.push({ id: idOf(row), user_id: row.user_id, scheduled_date: row.scheduled_date, scheduled_end: row.scheduled_end });
  }
  return {
    ok: true,
    changed: true,
    job_id: body.job_id,
    kind: plan.kind,
    ...(plan.edge ? { edge: plan.edge } : {}),
    from: plan.from,
    to: plan.to,
    updated,
    created,
    deleted,
    bookings: jobBookingsAnswer(body.job_id, rows).bookings,
    follow_up_failures: [],
  };
}

module.exports = { calOpsCore, jobBookingsAnswer, planReschedule, applyReschedule };
