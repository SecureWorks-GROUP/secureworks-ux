// Shared reads and writes used by more than one screen.
import { useEffect, useMemo } from './h.js';
import { api, ApiError, friendly } from './api.js';
import { useQuery, useStore, invalidate, mutateQuery, primeQuery, peekQuery } from './store.js';
import { bookingsFromMyJobs, findRunningClock, verticalOf } from './model.js';
import { todayISO } from './dates.js';
import { syncClock } from '../screens/clock.js';

/** The signed-in trade's own bookings (past month, today and everything ahead). */
export function useMyBookings() {
  const user = useStore((s) => s.user);
  const q = useQuery('myjobs', () => api('my_jobs', user && user.manager ? { mode: 'mine' } : null), { persist: true, ttl: 60000 });
  const bookings = useMemo(() => (q.data && user ? bookingsFromMyJobs(q.data, user.id) : []), [q.data, user && user.id]);
  // Only a fresh answer may start or stop the clock on screen: a saved copy
  // from an earlier visit says nothing about now.
  useEffect(() => { if (q.data && !q.refreshing && !q.error) syncClock(findRunningClock(bookings)); }, [q.data, q.refreshing, q.error]);
  return { ...q, bookings };
}

/** One job, everything on it. A refusal ("not on this job") comes back as `locked`. */
export function useJob(jobId) {
  const q = useQuery(jobId ? 'job:' + jobId : null, () => api('trade_job_detail', { jobId }), { persist: true, ttl: 30000 });
  const locked = Boolean(q.error && q.error instanceof ApiError && (q.error.refused || q.error.status === 404));
  return { ...q, locked };
}
/** Remember the little we know about a job from a list, so its page can open instantly. */
export function rememberJobStub(job) { if (job && job.id) primeQuery('stub:' + job.id, job); }
export function jobStub(jobId) { return peekQuery('stub:' + jobId) || null; }

/**
 * Add the signed-in trade to a job for one or more days.
 * Uses the planned-booking door when the server has it; otherwise falls back to
 * the invoice door, which takes today or a past day only.
 * Resolves { ok, message }.
 */
export async function bookMyself(jobId, dates) {
  const today = todayISO();
  const sorted = [...new Set(dates)].sort();
  const ahead = sorted.filter((d) => d >= today);
  const past = sorted.filter((d) => d < today);
  let plannedOff = false;
  if (ahead.length) {
    try {
      const r = await api('self_book_job', null, { job_id: jobId, dates: ahead });
      if (r && r.ok === false) throw new ApiError(r.error || 'Could not add you', { status: 409, code: r.code, body: r });
    } catch (err) {
      const code = (err.body && err.body.code) || err.code;
      const missing = err instanceof ApiError && (code === 'self_booking_disabled' || code === 'operator_access_required' || /unknown action/i.test(err.message));
      if (!missing) return { ok: false, message: friendly(err) };
      plannedOff = true;
    }
  }
  const viaInvoiceDoor = plannedOff ? [...past, ...ahead.filter((d) => d === today)] : past;
  for (const d of viaInvoiceDoor) {
    try {
      const r = await api('self_allocate_for_invoice', null, { job_id: jobId, work_date: d });
      if (r && r.ok === false) throw new ApiError(r.error || 'Could not add you', { status: 409, code: r.code, body: r });
    } catch (err) { return { ok: false, message: friendly(err) }; }
  }
  invalidate('myjobs'); invalidate('job:' + jobId); invalidate('hours'); invalidate('search');
  if (plannedOff && ahead.some((d) => d > today)) {
    const didToday = viaInvoiceDoor.length > 0;
    return { ok: didToday, partial: true, message: didToday ? 'You are on it for today. Booking ahead is not switched on yet, so add the other days as they come.' : 'Booking ahead is not switched on yet. Add yourself on the day, or ask the office to book you.' };
  }
  return { ok: true, message: '' };
}
export async function unbookMyself(assignmentId, jobId) {
  try {
    const r = await api('self_unbook_job', null, { assignment_id: assignmentId });
    if (r && r.ok === false) throw new ApiError(r.error || 'Could not remove', { status: 409, code: r.code, body: r });
  } catch (err) {
    const code = (err.body && err.body.code) || err.code;
    if (code === 'self_booking_disabled' || code === 'operator_access_required') return { ok: false, message: 'Ask the office to take you off this day.' };
    return { ok: false, message: friendly(err) };
  }
  invalidate('myjobs'); invalidate('job:' + jobId); invalidate('hours');
  return { ok: true };
}

/** Add a note to a job. Always office-only: nothing here goes to the customer. */
export function noteBody(jobId, text, user) {
  return { jobId, text, userId: user.id, visibility: 'internal_only', eventType: 'site_note', metadata: { user_id: user.id, user_name: user.name } };
}
export function optimisticNote(jobId, text, user) {
  mutateQuery('job:' + jobId, (d) => ({ ...d, notes: [...(d.notes || []), { id: 'local-' + Date.now(), event_type: 'site_note', created_at: new Date().toISOString(), users: { name: user.name }, detail_json: { text }, _mine: true }] }));
}
export { verticalOf };
