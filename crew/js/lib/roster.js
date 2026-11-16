// Shared reads for the manager screens (team week, job board, booking crew):
// everyone's bookings, the people list and days off. Each read keeps only the
// fields the screens draw, so no price, rate or cost is ever held or shown.
import { api, ApiError } from './api.js';
import { useQuery } from './store.js';
import { bookingsFromMyJobs, verticalOf, noPrices } from './model.js';
import { addDays, diffDays, fmtDay } from './dates.js';

const BUCKETS = ['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled', 'makesafePool'];
const FAMILY_KEYS = ['job_family', 'ses_family', 'makesafe_job_family'];

/** A job waiting for a crew: the server sends these with nobody on them. */
function isOpenRow(a) {
  return String(a.status || '').toLowerCase() === 'available' || /_open$/.test(String(a.assignment_type || '')) || /-open-/.test(String(a.id || ''));
}
/** The little a list needs to name a job. Nothing else is kept. */
export function slimJob(job) {
  const j = job || {};
  const md = j.metadata && typeof j.metadata === 'object' ? j.metadata : {};
  const metadata = {};
  for (const k of FAMILY_KEYS) if (md[k]) metadata[k] = md[k];
  return {
    id: j.id, type: j.type || j.job_type || '', status: j.status || '', job_number: j.job_number || '', client_name: j.client_name || '',
    site_address: j.site_address || '', site_suburb: j.site_suburb || '', job_family: j.job_family || '', vertical: j.vertical || '', metadata
  };
}

/** Hours between clock on and clock off, less the break. null while the clock runs or was never used. */
export function clockHours(on, off, breakMin = 0) {
  if (!on || !off) return null;
  const mins = (Date.parse(off) - Date.parse(on)) / 60000 - (Number(breakMin) || 0);
  return mins > 0 ? Math.round((mins / 60) * 100) / 100 : null;
}

/** my_jobs (everyone) -> { bookings, open }. Other companies' rows and watcher rows are dropped. */
export function teamFromMyJobs(res, user) {
  const org = user.org_id || null;
  const foreign = (a) => { const o = a.org_id || (a.jobs && a.jobs.org_id); return Boolean(org && o && o !== org); };
  const kept = {};
  const open = new Map();
  for (const bucket of BUCKETS) {
    const list = [];
    for (const a of (res && res[bucket]) || []) {
      if (!a || foreign(a)) continue;
      if (bucket === 'makesafePool' || isOpenRow(a)) {
        const job = a.jobs || a.job || {};
        const jobId = job.id || a.job_id;
        const dead = /cancelled/.test(String(a.id || '')) || ['cancelled', 'lost', 'archived'].includes(String(job.status || '').toLowerCase());
        if (jobId && !dead && !open.has(jobId)) open.set(jobId, { jobId, job: slimJob(job), vertical: verticalOf(job, a) });
        continue;
      }
      list.push(a);
    }
    if (bucket !== 'makesafePool') kept[bucket] = list;
  }
  // The shared converter drops two things the team view reads: the phase a
  // trade is in (on the way, working) and, when the server sends no hours, the
  // hours the clock shows.
  const raw = new Map();
  for (const list of Object.values(kept)) for (const a of list) if (a && a.id) raw.set(a.id, a);
  const bookings = bookingsFromMyJobs(kept, user.id).map((b) => {
    const a = raw.get(b.id) || {};
    return {
      ...b, job: slimJob(b.job), mine: Boolean(b.userId) && b.userId === user.id, note: noPrices(b.note, user.seesMoney),
      phase: String(a.job_phase || '').toLowerCase(), hours: b.hours != null ? b.hours : clockHours(b.clockOn, b.clockOff, b.breakMin)
    };
  });
  const booked = new Set(bookings.map((b) => b.jobId));
  return { bookings, open: [...open.values()].filter((o) => !booked.has(o.jobId)) };
}

/** Everyone's bookings for the job types this manager looks after. */
export function useTeam(user) {
  const on = Boolean(user && user.manager);
  return useQuery(on ? 'team:all' : null, () => api('my_jobs', { mode: 'all' }).then((res) => teamFromMyJobs(res, user)), { ttl: 60000 });
}

const BOOKABLE = ['crew', 'lead_installer', 'installer', 'admin', 'ops_manager'];
/** The people list. Only managers may read it; a "no" comes back as an empty list marked `refused`. */
export function useUsers(on = true) {
  return useQuery(on ? 'users' : null, async () => {
    try {
      const res = await api('list_users', {});
      const raw = (res && res.users) || (Array.isArray(res) ? res : []);
      const users = raw.filter((u) => u && u.id && u.name).map((u) => ({ id: u.id, name: u.name, phone: u.phone || null, role: String(u.role || '').toLowerCase() }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { users, refused: false };
    } catch (err) {
      if (err instanceof ApiError && err.refused) return { users: [], refused: true };
      throw err;
    }
  }, { ttl: 300000 });
}
/** People a manager can put on a job. */
export function bookable(users, meId) { return (users || []).filter((u) => u.id === meId || BOOKABLE.includes(u.role)); }
/** People who do the work on site (the office is left out of "free" lists). */
export function fieldCrew(users) { return (users || []).filter((u) => ['crew', 'lead_installer', 'installer'].includes(u.role)); }

/** Days off between two dates, for everyone. The server caps one answer, so long spans are read a month at a time. */
export async function loadAvailability(from, to) {
  const spans = [];
  for (let start = from; start <= to; start = addDays(start, 30)) spans.push([start, addDays(start, 29) > to ? to : addDays(start, 29)]);
  const parts = await Promise.all(spans.map(([a, b]) => api('get_crew_availability', { start_date: a, end_date: b })));
  const seen = new Map();
  for (const part of parts) {
    for (const r of (part && part.availability) || []) {
      const date = String(r.date || '').slice(0, 10);
      if (!r.user_id || !date) continue;
      seen.set(r.user_id + '|' + date, { user_id: r.user_id, date, status: String(r.status || 'available').toLowerCase(), note: r.note || '' });
    }
  }
  return [...seen.values()];
}
export function useAvailability(from, to, on = true) {
  return useQuery(on && from && to ? `avail:${from}:${to}` : null, () => loadAvailability(from, to), { ttl: 120000 });
}
/** user id -> date -> row, for the days somebody cannot work. */
export function awayIndex(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (r.status !== 'unavailable' && r.status !== 'leave') continue;
    if (!map.has(r.user_id)) map.set(r.user_id, new Map());
    map.get(r.user_id).set(r.date, r);
  }
  return map;
}
export function awayWord(status) { return status === 'leave' ? 'On leave' : 'Not working'; }

/** 'Mon 16 Nov' for one day, 'Mon 16 to Wed 18 Nov' style lists kept short. */
export function daysWords(dates, max = 3) {
  const list = [...new Set(dates)].sort();
  if (!list.length) return '';
  const run = list.every((d, i) => i === 0 || diffDays(d, list[i - 1]) === 1);
  if (list.length > 2 && run) return `${fmtDay(list[0])} to ${fmtDay(list[list.length - 1])}`;
  const shown = list.slice(0, max).map(fmtDay);
  return shown.join(', ') + (list.length > max ? ` and ${list.length - max} more` : '');
}

/** Which boards this person runs: make safe for the office and its managers, then each job type they manage. */
export function boardsFor(user) {
  if (!user || !user.manager) return [];
  const list = [];
  if (user.office || user.managed.includes('makesafe')) list.push('makesafe');
  for (const v of user.managed) if (v !== 'makesafe' && !list.includes(v)) list.push(v);
  return list;
}
