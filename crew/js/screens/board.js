// Job board for managers. Make safe comes from the server's own board, with the
// columns exactly as it sends them. Every other job type a manager looks after
// is built from everyone's bookings: waiting for a crew first, then the week.
import { html, cx, useMemo, useState } from '../lib/h.js';
import { api, ApiError } from '../lib/api.js';
import { useQuery, useStore } from '../lib/store.js';
import { rememberJobStub } from '../lib/data.js';
import { manages } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { todayISO, addDays, mondayOf, fmtDow, fmtTime, fmtWeek, fmtRelDay, firstName, tsToDate } from '../lib/dates.js';
import { jobTitle, jobAddress, VERTICAL_LABEL } from '../lib/model.js';
import { useTeam, boardsFor } from '../lib/roster.js';
import { Icon } from '../ui/icons.js';
import { Page, Tag, Chip, Button, IconButton, Seg, Avatars, Skel, Empty, LoadError, toast, buzz } from '../ui/kit.js';

const PAGE = 8;
const book = (job, vertical) => import('./allocate.js').then((m) => m.openAllocate(job, vertical)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }));
const openJob = (job) => { rememberJobStub(job); go('/job/' + job.id); };
const fold = (s) => String(s || '').toLowerCase().replace(/[\s-]+/g, '');

export function Board({ vertical }) {
  const user = useStore((s) => s.user);
  const boards = boardsFor(user);
  const [q, setQ] = useState('');
  const current = boards.includes(vertical) ? vertical : boards[0];

  if (!boards.length) {
    return html`<${Page} title="Job board"><${Empty} title="This is for managers" action=${html`<${Button} kind="line" small icon="jobs" onClick=${() => go('/jobs', { tab: true })}>Back to jobs<//>`}>
      The job board is where managers book crew onto jobs. You can find any job from Jobs.
    <//><//>`;
  }
  return html`<${Page} title="Job board">
    <header class="page-pad" style="padding-top:2px"><h1 class="t-display">Job board</h1></header>
    <div class="page-pad stack tight" style="margin-top:14px">
      ${boards.length > 1 ? html`<${Seg} value=${current} options=${boards.map((v) => [v, VERTICAL_LABEL[v] || 'Jobs'])} onChange=${(v) => go('/board/' + v, { replace: true })} />` : null}
      <div class="search">
        <${Icon} name="jobs" size=${20} />
        <input class="input" type="search" enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck=${false} placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Filter the board" />
        ${q ? html`<span class="clear"><${IconButton} name="close" label="Clear" size=${18} onClick=${() => setQ('')} /></span>` : null}
      </div>
    </div>
    ${current === 'makesafe' ? html`<${MakesafeBoard} key="makesafe" q=${q} />` : html`<${WeekBoard} key=${current} vertical=${current} user=${user} q=${q} />`}
  <//>`;
}

// ------------------------------------------------------------ make safe ----
const KNOWN = ['New', 'Allocated', 'Complete', 'Archive'];
function suburbOf(address) {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = (parts[parts.length - 1] || '').replace(/\b(WA|Western Australia|Australia)\b/gi, '').replace(/\b\d{4}\b/g, '').trim();
  return last || (parts.length > 1 ? parts[parts.length - 2] : '') || parts[0] || '';
}
/** Check the answer is the board we know, then keep only what a card shows. */
function readBoard(res) {
  const wrong = () => new ApiError('The board came back in a shape this app does not know. Try again, and tell the office if it keeps happening.', { status: 0 });
  if (!res || res.projection !== 'trade' || !/^makesafe-board\.v1(\.|$)/.test(String(res.contract_version || ''))) throw wrong();
  if (!res.parity || res.parity.ok !== true || !res.columns || typeof res.columns !== 'object') throw wrong();
  const names = [...KNOWN.filter((k) => k in res.columns), ...Object.keys(res.columns).filter((k) => !KNOWN.includes(k))];
  const columns = names.map((name) => {
    if (!Array.isArray(res.columns[name])) throw wrong();
    return { name, cards: res.columns[name].filter((r) => r && r.id).map((r) => {
      const c = r.contact || {}; const b = r.builder || {}; const rep = r.report || {}; const age = r.age || {}; const lin = r.lineage || {};
      return {
        id: r.id, column: r.column || name, number: r.job_number || '', family: r.ses_family_label || r.makesafe_type || '', kind: r.makesafe_type || '',
        suburb: suburbOf(c.address), address: c.address || '', client: c.client_name || '',
        builder: b.name || '', ref: b.external_ref || lin.builder_work_order_number || '', po: lin.builder_po_number || '',
        crew: (Array.isArray(r.assignments) ? r.assignments : []).map((a) => ({ id: a.assignment_id, userId: a.user_id, name: a.name || a.crew_name || 'Crew', date: String(a.scheduled_date || '').slice(0, 10), start: a.start_time || null }))
          .sort((x, y) => (x.date || '9').localeCompare(y.date || '9') || String(x.start || '99').localeCompare(String(y.start || '99'))),
        reportAt: rep.submitted_at || null, photos: Number(rep.photo_count) || 0,
        ageHours: age.age_hours == null ? null : Number(age.age_hours), ageDays: age.age_days == null ? null : Number(age.age_days),
        warning: r.projection_warning ? String(r.projection_warning) : ''
      };
    }) };
  });
  const p = res.permissions || {};
  return { columns, canBook: p.can_allocate === true, seesAll: p.sees_all_makesafes === true, unmapped: Array.isArray(res.unmapped_stage_job_ids) ? res.unmapped_stage_job_ids.length : 0 };
}

function MakesafeBoard({ q }) {
  const board = useQuery('board:makesafe', () => api('makesafe_board', { projection: 'trade' }, null, { keepSession: true }).then(readBoard), { ttl: 90000 });
  const term = fold(q);
  const columns = useMemo(() => {
    if (!board.data) return [];
    if (!term) return board.data.columns;
    return board.data.columns.map((c) => ({ ...c, cards: c.cards.filter((k) => [k.number, k.suburb, k.address, k.client, k.builder, k.ref, k.po, k.family, k.kind, ...k.crew.map((p) => p.name)].some((v) => fold(v).includes(term))) }));
  }, [board.data, term]);

  if (board.loading) return html`<${BoardSkeleton} />`;
  if (board.error && !board.data) {
    const e = board.error;
    if (e.status === 403) return html`<${Empty} title="This board is not open to you">${e.message || 'Ask the office to check your access.'}<//>`;
    return html`<${LoadError} error=${e} onRetry=${board.refetch} what="the make safe board" />`;
  }
  const { canBook, seesAll, unmapped } = board.data;
  const total = board.data.columns.reduce((n, c) => n + c.cards.length, 0);
  const found = columns.reduce((n, c) => n + c.cards.length, 0);
  if (!total) return html`<${Empty} title="No make safe jobs yet">${seesAll ? 'New make safes show here as soon as they come in.' : 'Make safes you are booked on show here.'}<//>`;

  return html`<div style="margin-top:14px">
    ${unmapped ? html`<div class="block note-banner" style="margin-bottom:12px"><${Icon} name="alert" size=${18} /><span>${unmapped === 1 ? 'One job came through without a clear stage.' : `${unmapped} jobs came through without a clear stage.`} Let the office know.</span></div>` : null}
    ${term && !found ? html`<${Empty} title="Nothing on the board matches">Nothing matches "${q.trim()}". Check the spelling, or look it up in Jobs.<//>` : html`<div class="board" role="list" aria-label="Make safe board">
      ${columns.map((col) => html`<${Column} key=${col.name} name=${col.name} hot=${col.name === 'New'} count=${col.cards.length} cards=${col.cards} empty=${term ? 'No match here' : 'Nothing here'}
        render=${(k) => html`<${MakesafeCard} key=${k.id} card=${k} canBook=${canBook && (k.column === 'New' || k.column === 'Allocated')} />`} />`)}
    </div>`}
    <p class="t-small t-mute block boardfoot">${canBook ? 'Swipe sideways for the other columns. The stage of each job is set by the office system.' : 'You can look at these jobs. The office books the crew.'}
      <button type="button" onClick=${() => { buzz(6); board.refetch(); }}>${board.refreshing ? 'Checking' : 'Refresh'}</button></p>
  </div>`;
}

function ageWords(card) {
  if (card.ageHours == null) return '';
  if (card.ageHours < 1) return 'Just in';
  if (card.ageHours < 24) return `${Math.round(card.ageHours)} h ago`;
  const d = card.ageDays != null ? card.ageDays : Math.floor(card.ageHours / 24);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
function MakesafeCard({ card, canBook }) {
  const job = { id: card.id, type: 'makesafe', job_number: card.number, site_suburb: card.suburb, site_address: card.address.split(',')[0] || '', client_name: card.client };
  const first = card.crew[0];
  const names = [...new Set(card.crew.map((p) => p.name))];
  const isNew = card.column === 'New';
  return html`<div class="card jt-makesafe" role="listitem">
    <button type="button" class="cardmain" onClick=${() => openJob(job)}>
      <span class="cardtop"><b>${card.suburb || card.client || card.number || 'Make safe'}</b>
        ${isNew && card.ageHours != null ? html`<${Chip} kind=${card.ageHours >= 24 ? 'hi' : ''}>${ageWords(card)}<//>` : null}</span>
      <span class="cardsub">${[card.address.split(',')[0], card.client].filter(Boolean).join(' · ')}</span>
      <span class="cardmeta"><${Tag} vertical="makesafe">${card.family || 'Make safe'}<//>${card.number ? html`<span class="t-small t-mute t-num">${card.number}</span>` : null}</span>
      ${card.builder || card.ref ? html`<span class="cardsub">${[card.builder, card.ref].filter(Boolean).join(' · ')}</span>` : null}
      ${names.length ? html`<span class="cardwho"><${Avatars} people=${names.map((n) => ({ name: n }))} max=${3} />
          <span>${names.length === 1 ? names[0] : names.length === 2 ? names.map(firstName).join(' and ') : `${firstName(names[0])} and ${names.length - 1} more`}${first && first.date ? html`<small>${fmtRelDay(first.date)}${first.start ? ' at ' + fmtTime(first.start) : ''}</small>` : null}</span></span>`
        : card.column === 'New' || card.column === 'Allocated' ? html`<span class="cardwho none"><${Icon} name="users" size=${16} />Nobody booked yet</span>` : null}
      ${card.reportAt ? html`<span><${Chip} kind="ok" icon="check">Report in ${fmtRelDay(tsToDate(card.reportAt)).toLowerCase()}${card.photos ? ` · ${card.photos} ${card.photos === 1 ? 'photo' : 'photos'}` : ''}<//></span>` : null}
      ${card.warning ? html`<span class="cardsub t-hi">The office system could not place this job. It may be in the wrong column.</span>` : null}
    </button>
    ${canBook ? html`<${Button} kind=${isNew && !names.length ? 'primary' : 'soft'} small block icon="users" onClick=${() => book(job, 'makesafe')}>${names.length ? 'Change crew' : 'Book crew'}<//>` : null}
  </div>`;
}

// ------------------------------------------- every other managed job type ----
const DONE_JOB = ['complete', 'completed', 'invoiced', 'paid', 'closed', 'archived', 'final_payment', 'get_review'];
const DEAD_JOB = ['cancelled', 'lost', 'deleted', 'duplicate', 'duplicated', 'void', 'voided'];
const RANK = { in_progress: 6, disputed: 5, submitted: 4, verified: 4, confirmed: 3, scheduled: 3, draft: 2, complete: 2 };
function columnOf(status, jobStatus) {
  const js = String(jobStatus || '').toLowerCase();
  if (DEAD_JOB.includes(js)) return 'cancelled';
  if (DONE_JOB.includes(js)) return 'done';
  if (['scheduled', 'confirmed', 'draft'].includes(status)) return 'scheduled';
  if (status === 'in_progress') return 'onsite';
  if (['complete', 'completed', 'submitted', 'verified'].includes(status)) return 'done';
  if (status === 'cancelled') return 'cancelled';
  return 'attention';
}
const COLS = [['ready', 'Ready'], ['scheduled', 'Scheduled'], ['onsite', 'On site'], ['done', 'Done'], ['attention', 'Attention'], ['cancelled', 'Cancelled']];

function WeekBoard({ vertical, user, q }) {
  const team = useTeam(user);
  const today = todayISO();
  const [monday, setMonday] = useState(mondayOf(today));
  const sunday = addDays(monday, 6);
  const canBook = manages(user, vertical);
  const label = (VERTICAL_LABEL[vertical] || 'job').toLowerCase();
  const term = fold(q);

  const cols = useMemo(() => {
    const out = { ready: [], scheduled: [], onsite: [], done: [], attention: [], cancelled: [] };
    if (!team.data) return out;
    const rows = team.data.bookings.filter((b) => b.vertical === vertical);
    const card = (job, list, extra) => ({ id: job.id, job, days: [...new Set(list.map((b) => b.date).filter(Boolean))].sort(), people: [...new Set(list.map((b) => b.userName).filter(Boolean))], ...extra });
    const group = (list) => { const m = new Map(); for (const b of list) { if (!m.has(b.jobId)) m.set(b.jobId, []); m.get(b.jobId).push(b); } return m; };
    // No day yet: jobs waiting for a crew, and bookings with no date.
    for (const o of team.data.open.filter((x) => x.vertical === vertical)) out.ready.push(card(o.job, [], { waiting: true }));
    group(rows.filter((b) => !b.date)).forEach((list) => out.ready.push(card(list[0].job, list, { noDay: true })));
    // This week: one card per job, placed by its most telling booking.
    group(rows.filter((b) => b.date >= monday && b.date <= sunday)).forEach((list) => {
      const top = [...list].sort((a, b) => (RANK[b.status] || 1) - (RANK[a.status] || 1))[0];
      out[columnOf(top.status, top.job.status)].push(card(top.job, list, {}));
    });
    const hit = (k) => !term || [k.job.job_number, k.job.client_name, k.job.site_suburb, k.job.site_address, ...k.people].some((v) => fold(v).includes(term));
    for (const key of Object.keys(out)) out[key] = out[key].filter(hit).sort((a, b) => (a.days[0] || '').localeCompare(b.days[0] || '') || jobTitle(a.job).localeCompare(jobTitle(b.job)));
    return out;
  }, [team.data, vertical, monday, term]);

  if (team.loading) return html`<${BoardSkeleton} />`;
  if (team.error && !team.data) return html`<${LoadError} error=${team.error} onRetry=${team.refetch} what=${`the ${label} board`} />`;
  const any = team.data.bookings.some((b) => b.vertical === vertical) || team.data.open.some((o) => o.vertical === vertical);
  const found = Object.values(cols).reduce((n, l) => n + l.length, 0);
  const shownCols = COLS.filter(([key]) => !['attention', 'cancelled'].includes(key) || cols[key].length);
  const thisWeek = monday === mondayOf(today);

  return html`<div style="margin-top:6px">
    <div class="weeknav" style="margin-top:8px">
      <span class="t-label">${thisWeek ? 'This week' : monday === addDays(mondayOf(today), 7) ? 'Next week' : monday === addDays(mondayOf(today), -7) ? 'Last week' : 'Week'} · ${fmtWeek(monday)}</span>
      <span style="display:flex;align-items:center">
        ${!thisWeek ? html`<${Button} kind="quiet" small onClick=${() => setMonday(mondayOf(today))}>This week<//>` : null}
        <${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => setMonday(addDays(monday, -7))} />
        <${IconButton} name="right" label="Later week" size=${20} onClick=${() => setMonday(addDays(monday, 7))} />
      </span>
    </div>
    ${!any ? html`<${Empty} title=${`No ${label} jobs to show`}>Jobs show here once they are ready for a crew or somebody is booked on them.<//>`
      : term && !found ? html`<${Empty} title="Nothing on the board matches">Nothing matches "${q.trim()}" this week. Try another week, or look it up in Jobs.<//>`
      : html`<div class="board" role="list" aria-label=${`${label} board`}>
        ${shownCols.map(([key, name]) => html`<${Column} key=${key} name=${name} hot=${key === 'ready'} count=${cols[key].length} cards=${cols[key]}
          empty=${key === 'ready' ? 'Every job has a crew' : key === 'scheduled' ? 'Nothing booked this week' : key === 'onsite' ? 'Nobody on site right now' : 'Nothing yet this week'}
          render=${(k) => html`<${WeekCard} key=${k.id + key} card=${k} vertical=${vertical} today=${today} canBook=${canBook && (key === 'ready' || key === 'scheduled' || key === 'onsite')} hot=${key === 'ready' && k.waiting} />`} />`)}
      </div>`}
    <p class="t-small t-mute block boardfoot">Ready is every ${label} job still waiting for a crew or a day. The other columns are the week above.
      <button type="button" onClick=${() => { buzz(6); team.refetch(); }}>${team.refreshing ? 'Checking' : 'Refresh'}</button></p>
  </div>`;
}

function WeekCard({ card, vertical, today, canBook, hot }) {
  const job = card.job;
  const title = jobTitle(job);
  const addr = jobAddress(job);
  return html`<div class=${cx('card', 'jt-' + vertical)} role="listitem">
    <button type="button" class="cardmain" onClick=${() => openJob(job)}>
      <span class="cardtop"><b>${title}</b></span>
      <span class="cardsub">${[addr !== title ? addr.replace(new RegExp(',\\s*' + title + '$'), '') : '', job.client_name].filter(Boolean).join(' · ')}</span>
      <span class="cardmeta"><${Tag} vertical=${vertical} />${job.job_number ? html`<span class="t-small t-mute t-num">${job.job_number}</span>` : null}</span>
      ${card.days.length ? html`<span class="carddays">${card.days.map((d) => html`<i class=${cx(d === today && 'today')}>${d === today ? 'Today' : fmtDow(d)}</i>`)}</span>` : card.noDay ? html`<span class="cardsub">Booked, but no day set</span>` : null}
      ${card.people.length ? html`<span class="cardwho"><${Avatars} people=${card.people.map((n) => ({ name: n }))} max=${3} />
          <span>${card.people.length === 1 ? card.people[0] : card.people.length === 2 ? card.people.map(firstName).join(' and ') : `${firstName(card.people[0])} and ${card.people.length - 1} more`}</span></span>`
        : html`<span class="cardwho none"><${Icon} name="users" size=${16} />Nobody booked yet</span>`}
    </button>
    ${canBook ? html`<${Button} kind=${hot ? 'primary' : 'soft'} small block icon="users" onClick=${() => book(job, vertical)}>${card.people.length ? 'Change crew' : 'Book crew'}<//>` : null}
  </div>`;
}

// ---------------------------------------------------------------- shared ----
function Column({ name, count, cards, render, empty, hot }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, PAGE);
  return html`<section class=${cx('col', hot && count > 0 && 'hot')} aria-label=${`${name}, ${count}`}>
    <span class="t-label"><span>${name}</span><span class="t-num">${count}</span></span>
    ${shown.map(render)}
    ${!cards.length ? html`<p class="colnone">${empty}</p>` : null}
    ${cards.length > PAGE ? html`<${Button} kind="quiet" small block onClick=${() => setAll(!all)}>${all ? 'Show fewer' : `Show ${cards.length - PAGE} more`}<//>` : null}
  </section>`;
}
function BoardSkeleton() {
  return html`<div class="board" style="margin-top:14px" aria-hidden="true">${[0, 1].map(() => html`<div class="col"><span class="t-label"><${Skel} w=${90} h=${12} /></span>
    ${[0, 1, 2].map(() => html`<div class="card"><${Skel} w="60%" h=${20} /><${Skel} w="85%" h=${13} /><${Skel} w="45%" h=${13} /></div>`)}</div>`)}</div>`;
}

