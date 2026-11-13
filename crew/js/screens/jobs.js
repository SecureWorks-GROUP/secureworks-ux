// Jobs: find any job. Type a suburb, a name, a street or a job number.
// With nothing typed it shows the trade's own jobs, soonest first.
import { html, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore, local } from '../lib/store.js';
import { useMyBookings, rememberJobStub } from '../lib/data.js';
import { go } from '../lib/router.js';
import { todayISO, fmtDay, fmtRelDay } from '../lib/dates.js';
import { jobTitle, jobAddress, verticalOf, jobStatusLabel, bookingState } from '../lib/model.js';
import { Icon } from '../ui/icons.js';
import { Tag, Chip, SkelRows, Empty, LoadError, IconButton } from '../ui/kit.js';

/** 'swf 26168' -> 'SWF-26168', as the server matches job numbers. */
function tidyQuery(q) {
  const t = q.trim();
  const m = /^(SW[A-Z]{0,5})\s*[-_.\/]?\s*(\d{3,})$/i.exec(t);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : t;
}
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const id = setTimeout(() => setV(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}

export function Jobs() {
  const user = useStore((s) => s.user);
  const [q, setQ] = useState(() => local.get('jobs:q', ''));
  const input = useRef(null);
  const term = useDebounced(tidyQuery(q), 280);
  const searching = term.length >= 2;
  useEffect(() => { local.set('jobs:q', q); }, [q]);

  const search = useQuery(searching ? 'search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const { bookings, loading, error, refetch } = useMyBookings();
  const today = todayISO();

  const mine = useMemo(() => {
    const byJob = new Map();
    for (const b of bookings) {
      if (!b.jobId) continue;
      const cur = byJob.get(b.jobId) || { job: b.job, vertical: b.vertical, jobId: b.jobId, dates: [], live: false };
      cur.dates.push(b.date); if (bookingState(b) === 'live') cur.live = true;
      byJob.set(b.jobId, cur);
    }
    const all = [...byJob.values()].map((j) => {
      const ahead = j.dates.filter((d) => d >= today).sort();
      const behind = j.dates.filter((d) => d && d < today).sort();
      return { ...j, next: ahead[0] || null, last: behind[behind.length - 1] || null, days: j.dates.length };
    });
    return {
      coming: all.filter((j) => j.next).sort((a, b) => a.next.localeCompare(b.next)),
      recent: all.filter((j) => !j.next).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 30)
    };
  }, [bookings, today]);

  const results = (search.data && search.data.jobs) || [];
  const myJobIds = useMemo(() => new Set(bookings.map((b) => b.jobId)), [bookings]);

  return html`<main class="page enter-tab">
    <header class="page-pad" style="padding-top:4px"><h1 class="t-display">Jobs</h1></header>
    <div class="page-pad" style="position:sticky;top:calc(-1 * var(--safe-t) - 4px);z-index:4;padding-top:calc(var(--safe-t) + 12px);padding-bottom:10px;margin-top:2px;background:linear-gradient(var(--paper) 80%, transparent)">
      <div class="search">
        <${Icon} name="jobs" size=${20} />
        <input ref=${input} class="input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck=${false}
          placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Search every job" />
        ${q ? html`<span class="clear"><${IconButton} name="close" label="Clear search" size=${18} onClick=${() => { setQ(''); input.current && input.current.focus(); }} /></span>` : null}
      </div>
    </div>

    ${user.manager && !searching ? html`<div class="block btnrow" style="margin-top:4px">
      <button type="button" class="action" onClick=${() => go('/team')}><${Icon} name="users" size=${22} />Team week</button>
      <button type="button" class="action" onClick=${() => go('/board')}><${Icon} name="board" size=${22} />Job board</button>
    </div>` : null}

    ${searching ? html`<section class="section" style="margin-top:10px">
      ${search.loading ? html`<${SkelRows} n=${4} />` : search.error ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="the search" />`
        : !results.length ? html`<${Empty} title="No job found">Nothing matches "${term}". Try the suburb or the job number. If it is a brand new job the office may not have set it up yet.<//>`
        : html`<span class="t-label">${results.length}${search.data.next_offset ? '+' : ''} found</span><div class="list ruled rise">${results.map((job) => html`<${JobRow} key=${job.id} job=${job} mine=${job.assigned_to_me === true || myJobIds.has(job.id)} />`)}</div>`}
    </section>` : loading ? html`<${SkelRows} n=${4} />` : error && !bookings.length ? html`<${LoadError} error=${error} onRetry=${refetch} what="your jobs" />` : html`
      ${mine.coming.length ? html`<section class="section"><span class="t-label">Your jobs coming up</span>
        <div class="list ruled rise">${mine.coming.map((j) => html`<${JobRow} key=${j.jobId} job=${j.job} vertical=${j.vertical} mine sub=${`${fmtRelDay(j.next)}${j.days > 1 ? ` · ${j.days} days booked` : ''}`} live=${j.live} />`)}</div></section>` : null}
      ${mine.recent.length ? html`<section class="section"><span class="t-label">Your recent jobs</span>
        <div class="list ruled">${mine.recent.map((j) => html`<${JobRow} key=${j.jobId} job=${j.job} vertical=${j.vertical} mine sub=${j.last ? 'Last there ' + fmtDay(j.last) : ''} />`)}</div></section>` : null}
      ${!mine.coming.length && !mine.recent.length ? html`<${Empty} title="Search for any job">You are not booked on anything yet. Type a suburb, a customer name or a job number above to find a job, then add yourself to it.<//>` : null}
    `}
  </main>`;
}

function JobRow({ job, vertical, mine, sub, live }) {
  const v = vertical || verticalOf(job);
  const status = jobStatusLabel(job.status);
  return html`<button type="button" class="row" onClick=${() => { rememberJobStub(job); go('/job/' + job.id); }}>
    <span class="main" style="grid-column:1 / span 2">
      <b>${jobTitle(job)}</b>
      <span>${[jobAddress(job) !== jobTitle(job) ? jobAddress(job) : '', job.client_name].filter(Boolean).join(' · ')}</span>
      <span style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;margin-top:7px">
        <${Tag} vertical=${v} />
        ${job.job_number ? html`<span class="t-small t-mute t-num">${job.job_number}</span>` : null}
        ${live ? html`<${Chip} kind="hi">On the clock<//>` : sub ? html`<span class="t-small">${sub}</span>` : null}
        ${!sub && mine ? html`<${Chip} kind="ok" icon="check">You are on it<//>` : null}
        ${!sub && !mine && status ? html`<span class="t-small t-mute">${status}</span>` : null}
      </span>
    </span>
    <span class="trail"><${Icon} name="right" size=${18} /></span>
  </button>`;
}
