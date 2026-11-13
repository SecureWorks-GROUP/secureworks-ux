// Turns the server's rows into the few shapes the screens use, in one place.
// The server sends assignments (one person, one job, one day) with the job
// nested inside; a "booking" here is that row, flattened and named plainly.
import { todayISO, addDays, tsToDate } from './dates.js';

const VERTICALS = ['fencing', 'patio', 'makesafe', 'repair', 'decking', 'restoration'];
export const VERTICAL_LABEL = { fencing: 'Fencing', patio: 'Patio', makesafe: 'Make safe', repair: 'Repair', decking: 'Decking', restoration: 'Restoration', other: 'Job' };

function familyOf(job, extra) {
  const md = (job && job.metadata) || {};
  return String((extra && (extra.vertical || extra.job_family)) || (job && job.job_family) || md.job_family || md.ses_family || md.makesafe_job_family || '').toLowerCase();
}
/** Which kind of work a job is. Repair wins over the stored type, as on the server. */
export function verticalOf(job, extra) {
  if (!job) return 'other';
  const type = String(job.type || job.job_type || '').toLowerCase();
  const fam = familyOf(job, extra);
  if (type === 'repair' || fam === 'repair') return 'repair';
  if (fam === 'restoration' || /^SWRESTO-/i.test(job.job_number || '')) return 'restoration';
  if (type === 'makesafe' || type === 'makesafes' || /^SWMS-/i.test(job.job_number || '')) return 'makesafe';
  if (VERTICALS.includes(type)) return type;
  return 'other';
}
export function isReportJob(v) { return v === 'makesafe' || v === 'restoration'; }

/** What to call a job on screen: the suburb first, because that is how trades name jobs. */
export function jobTitle(job) {
  if (!job) return 'Job';
  return job.site_suburb || job.suburb || shortAddress(job.site_address) || job.client_name || job.job_number || 'Job';
}
function shortAddress(a) { return a ? String(a).split(',')[0] : ''; }
export function jobAddress(job) {
  if (!job) return '';
  const addr = job.site_address || '';
  const sub = job.site_suburb || '';
  if (!addr) return sub;
  return sub && !addr.toLowerCase().includes(sub.toLowerCase()) ? `${addr}, ${sub}` : addr;
}
export function mapsUrl(job) {
  const dest = job && job.site_lat && job.site_lng ? `${job.site_lat},${job.site_lng}` : encodeURIComponent(`${jobAddress(job)} WA`);
  const apple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  return apple ? `https://maps.apple.com/?daddr=${dest}` : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

const JOB_STATUS = {
  draft: 'Draft', lead: 'Lead', new: 'New', quoted: 'Quoted', accepted: 'Accepted', processing: 'Getting ready', order_materials: 'Ordering materials',
  scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold', rectification: 'Fix-up', complete: 'Finished', completed: 'Finished',
  invoiced: 'Finished', final_payment: 'Finished', get_review: 'Finished', paid: 'Finished', closed: 'Closed', archived: 'Archived', cancelled: 'Cancelled', lost: 'Lost'
};
export function jobStatusLabel(status) { return JOB_STATUS[String(status || '').toLowerCase()] || ''; }
export function jobIsClosed(status) { return ['complete', 'completed', 'invoiced', 'final_payment', 'get_review', 'paid', 'closed', 'archived', 'cancelled', 'lost'].includes(String(status || '').toLowerCase()); }

const DONE = ['complete', 'completed', 'submitted', 'verified', 'disputed'];
/** Still being quoted or sold: not a job the crew can be on yet. */
export function jobNotOpenYet(status) { return ['lead', 'new', 'draft', 'quoted'].includes(String(status || '').toLowerCase()); }

/** booked | live (clocked on now) | done */
export function bookingState(b) {
  if (b.clockOn && !b.clockOff && !DONE.includes(b.status)) return 'live';
  if (DONE.includes(b.status) || b.clockOff) return 'done';
  return 'booked';
}

function fromAssignment(a, meId) {
  const job = a.jobs || a.job || {};
  const uid = (a.user && a.user.id) || a.user_id || null;
  return {
    id: a.id,
    jobId: job.id || a.job_id,
    date: (a.scheduled_date || '').slice(0, 10),
    end: (a.scheduled_end || '').slice(0, 10) || null,
    start: a.start_time || null,
    status: String(a.status || 'scheduled').toLowerCase(),
    role: a.role || '',
    userId: uid,
    userName: (a.user && a.user.name) || a.crew_name || a.assigned_to || a.trade_name || '',
    mine: uid ? uid === meId : true,
    clockOn: a.clocked_on_at || null,
    clockOff: a.clocked_off_at || null,
    breakMin: Number(a.break_minutes) || 0,
    hours: a.hours_worked == null ? null : Number(a.hours_worked),
    note: a.notes || a.label || '',
    job,
    vertical: verticalOf(job, a)
  };
}
/** my_jobs answers in buckets; this is every booking once, watcher rows dropped. */
export function bookingsFromMyJobs(res, meId) {
  const seen = new Map();
  for (const bucket of ['today', 'thisWeek', 'upcoming', 'recent', 'recentCompleted', 'unscheduled']) {
    for (const a of (res && res[bucket]) || []) {
      if (!a || !a.id || seen.has(a.id)) continue;
      if (String(a.role || '').toLowerCase() === 'observer') continue;
      if (String(a.status || '').toLowerCase() === 'cancelled') continue;
      seen.set(a.id, fromAssignment(a, meId));
    }
  }
  return [...seen.values()];
}
/** trade_calendar rows -> bookings (a span becomes one booking per day, 31 at most). */
export function bookingsFromCalendar(events, meId) {
  const out = [];
  for (const ev of events || []) {
    const startDate = (ev.scheduled_date || '').slice(0, 10);
    if (!startDate) continue;
    const endDate = (ev.scheduled_end || '').slice(0, 10);
    const days = endDate && endDate > startDate ? Math.min(31, Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1) : 1;
    for (let i = 0; i < days; i++) {
      const job = { id: ev.job_id, type: ev.job_type, job_family: ev.job_family, job_number: ev.job_number, client_name: ev.client_name, site_address: ev.site_address, site_suburb: ev.site_suburb };
      out.push({
        id: ev.assignment_id + (i ? ':' + i : ''), assignmentId: ev.assignment_id, jobId: ev.job_id, date: addDays(startDate, i), end: null,
        start: ev.start_time || null, status: String(ev.assignment_status || 'scheduled').toLowerCase(), role: '', userId: ev.user_id || null,
        userName: ev.assigned_to || ev.crew_name || '', mine: ev.user_id ? ev.user_id === meId : false,
        clockOn: null, clockOff: null, breakMin: 0, hours: null, note: ev.label || ev.assignment_notes || '', job, vertical: verticalOf(job, ev)
      });
    }
  }
  return out;
}
export function sortBookings(list) {
  return [...list].sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || String(a.start || '99').localeCompare(String(b.start || '99')) || jobTitle(a.job).localeCompare(jobTitle(b.job)));
}
export function bookingsByDate(list) {
  const map = new Map();
  for (const b of list) { if (!b.date) continue; if (!map.has(b.date)) map.set(b.date, []); map.get(b.date).push(b); }
  map.forEach((v, k) => map.set(k, sortBookings(v)));
  return map;
}
/** The clock that is running now, if the trade's own rows show one from today or yesterday. */
export function findRunningClock(bookings) {
  const today = todayISO(); const yesterday = addDays(today, -1);
  return bookings.find((b) => b.mine && b.clockOn && !b.clockOff && !DONE.includes(b.status) && !jobIsClosed(b.job.status) && [today, yesterday].includes(tsToDate(b.clockOn))) || null;
}

/** Notes a trade should read: real notes only, newest last. */
export function tradeNotes(notes) {
  return (notes || []).filter((n) => ['note', 'note_added', 'site_note'].includes(n.event_type) && !/^MAKESAFE_(PACK_SENT|AGENT_REPLY)/.test(noteText(n)))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
export function noteText(n) { const d = n.detail_json || {}; return d.text || d.note || d.note_text || ''; }
export function noteAuthor(n) { const d = n.detail_json || {}; return d.from_ops ? 'Office' : (n.users && n.users.name) || 'Crew'; }

/** Media rows a trade may see, split into photos and videos. */
export function splitMedia(media) {
  const photos = []; const videos = [];
  for (const m of media || []) {
    if ('visible_to_trades' in m && !m.visible_to_trades) continue;
    const url = m.playable_url || m.signed_url || m.public_url || m.url || m.file_url || m.download_url || m.storage_url;
    if (!url) continue;
    const mime = String(m.mime_type || m.content_type || '');
    const isVideo = m.is_video === true || /^video\//.test(mime) || ['video', 'walkthrough'].includes(String(m.type || m.kind || '').toLowerCase()) || /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(url);
    if (isVideo) { videos.push({ ...m, url }); continue; }
    if (['voice_note', 'signature', 'receipt', 'neighbour_signoff'].includes(m.phase)) continue;
    photos.push({ ...m, url: m.storage_url || url, thumb: m.thumbnail_url || m.storage_url || url });
  }
  return { photos, videos };
}
export const PHASES = [['scope', 'Before'], ['in_progress', 'During'], ['completion', 'After'], ['issue', 'Problems']];

/** Strip dollar amounts from free text shown to trades (mirrors the current app's rule). */
export function noPrices(text, seesMoney) {
  if (seesMoney || !text) return text || '';
  return String(text)
    .replace(/\(?\s*(?:AUD\s*)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:\+|inc\.?|ex\.?|incl\.?)\s*GST)?\s*(?:\/\s*\w+)?\s*\)?/gi, '')
    .replace(/\b(?:total|price|rate|cost|quoted?)\s*[:=]\s*\d[\d,.]*/gi, '')
    .replace(/[ \t]{2,}/g, ' ').trim();
}
