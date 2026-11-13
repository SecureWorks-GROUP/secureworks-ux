// One job: where it is, what to build, photos, notes, files and who is on it.
// Any trade can open any job. What you can do on it depends on whether you
// are on it yet, and adding yourself is one tap.
import { html, cx, useEffect, useMemo, useState } from '../lib/h.js';
import { api, apiText, ghl, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, invalidate, mutateQuery } from '../lib/store.js';
import { useJob, jobStub, bookMyself, unbookMyself, noteBody, optimisticNote, useMyBookings } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, addDays, fmtDay, fmtDow, fmtDom, fmtDate, fmtTime, fmtTs, fmtHours, fmtRelDay, tsToDate } from '../lib/dates.js';
import {
  verticalOf, isReportJob, jobTitle, jobAddress, mapsUrl, jobStatusLabel, jobIsClosed, jobNotOpenYet, tradeNotes, noteText, noteAuthor, splitMedia, PHASES, noPrices
} from '../lib/model.js';
import { queueWrite, outboxItems, onOutbox } from '../lib/outbox.js';
import { uploadPhoto, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import {
  Page, Tag, Chip, Button, Sheet, Slide, Skel, Empty, LoadError, PhotoGrid, Avatar, Field, Picks, toast, openOverlay, ask, buzz, openLightbox
} from '../ui/kit.js';
import { clockOn, openClockOff, useElapsed } from './clock.js';

const TABS = [['scope', 'Scope'], ['photos', 'Photos'], ['notes', 'Notes'], ['files', 'Files'], ['crew', 'Crew']];

export function Job({ jobId, tab: tabParam }) {
  const user = useStore((s) => s.user);
  const clock = useStore((s) => s.clock);
  const q = useJob(jobId);
  const { bookings } = useMyBookings();
  const [tab, setTab] = useState(TABS.some((t) => t[0] === tabParam) ? tabParam : 'scope');
  const data = q.data;
  const stub = jobStub(jobId) || (bookings.find((b) => b.jobId === jobId) || {}).job || null;
  const job = (data && data.job) || stub;

  const vertical = verticalOf(job, data || {});
  const today = todayISO();
  const tier = data ? data.access_tier : null;
  const viewOnly = q.locked || tier === 'company_view';
  const crew = ((data && data.crew) || []).filter((c) => String(c.status).toLowerCase() !== 'cancelled' && c.role !== 'observer');
  const myRows = useMemo(() => {
    const fromCrew = crew.filter((c) => c.user_id === user.id).map((c) => ({ id: c.id, date: (c.scheduled_date || '').slice(0, 10), status: String(c.status || '').toLowerCase(), clockOn: c.clocked_on_at, clockOff: c.clocked_off_at, hours: c.hours_worked, start: c.start_time }));
    if (fromCrew.length) return fromCrew;
    return bookings.filter((b) => b.jobId === jobId && b.mine).map((b) => ({ id: b.id, date: b.date, status: b.status, clockOn: b.clockOn, clockOff: b.clockOff, hours: b.hours, start: b.start }));
  }, [data, bookings, jobId, user.id]);
  const onJob = myRows.length > 0;
  const notOpen = job ? jobNotOpenYet(job.status) : false;
  const closed = job ? jobIsClosed(job.status) || notOpen : false;
  const { photos, videos } = useMemo(() => splitMedia(data && data.media), [data]);
  const notes = useMemo(() => tradeNotes(data && data.notes), [data]);
  const pendingNotes = usePendingNotes(jobId);
  const phone = job && !viewOnly ? job.client_phone : null;
  const canText = Boolean(job && !viewOnly && job.ghl_contact_id && (user.manager || Number(user.trade_tier) >= 2));

  const counts = { photos: photos.length, notes: notes.length + pendingNotes.length, crew: new Set(crew.map((c) => c.user_id)).size };

  if (!job && q.loading) return html`<${Page} title=""><div class="page-pad" style="display:grid;gap:14px"><${Skel} w="30%" h=${12} /><${Skel} w="70%" h=${40} /><${Skel} w="90%" /><${Skel} h=${72} r=${14} style="margin-top:10px" /><${Skel} h=${180} r=${14} /></div><//>`;
  if (!job) return html`<${Page} title="">${q.locked ? html`<${Empty} title="Job not found">It may have been removed, or the link is old. Search for it by suburb or job number.<//>` : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this job" />`}<//>`;

  return html`<${Page} title=${jobTitle(job)} right=${html`<button type="button" class="iconbtn" aria-label="Refresh" onClick=${() => { q.refetch(); buzz(6); }}><${Icon} name="refresh" size=${20} class=${q.refreshing ? 'spin-slow' : ''} /></button>`}>
    <header class="jobhero">
      <div class="ref"><${Tag} vertical=${vertical} />${job.job_number ? html`<span class="t-small t-num t-mute">${job.job_number}</span>` : null}
        ${closed && jobStatusLabel(job.status) ? html`<${Chip}>${jobStatusLabel(job.status)}<//>` : null}
        ${onJob ? html`<${Chip} kind="ok" icon="check">You are on it<//>` : null}</div>
      <h1 class="t-display">${jobTitle(job)}</h1>
      ${jobAddress(job) ? html`<a class="addr" href=${mapsUrl(job)} target="_blank" rel="noopener"><${Icon} name="pin" size=${18} /><span>${jobAddress(job)}</span></a>` : null}
      ${job.client_name ? html`<p class="t-small">For ${job.client_name}</p>` : null}
    </header>

    <div class="block actions" style="margin-top:16px">
      <a class="action" href=${mapsUrl(job)} target="_blank" rel="noopener"><${Icon} name="navigate" size=${22} />Navigate</a>
      ${phone ? html`<a class="action" href=${'tel:' + phone}><${Icon} name="phone" size=${22} />Call</a>`
        : html`<button type="button" class="action off" onClick=${() => toast(viewOnly ? 'Add yourself to this job to see the customer number.' : 'No phone number on this job. Ask the office.')}><${Icon} name="phone" size=${22} />Call</button>`}
      ${canText ? html`<button type="button" class="action" onClick=${() => openText(job)}><${Icon} name="message" size=${22} />Text</button>` : null}
      <button type="button" class="action" onClick=${() => (viewOnly ? toast('Add yourself to this job first.') : openProblem(job))}><${Icon} name="alert" size=${22} />Problem</button>
    </div>

    ${viewOnly && !closed ? html`<div class="block note-banner plain" style="margin-top:14px"><${Icon} name="info" size=${18} /><span>You are looking at this job. Add yourself to clock on, add photos and notes, and see the customer's number.</span></div>` : null}
    ${isReportJob(vertical) && !viewOnly ? html`<${ReportCard} jobId=${jobId} data=${data} vertical=${vertical} />` : null}
    ${q.error && data ? html`<div class="block note-banner" style="margin-top:14px">Showing the last saved copy. ${q.error.offline ? 'No signal.' : ''}</div>` : null}

    <div class="tabs" role="tablist">
      ${TABS.map(([id, label]) => html`<button type="button" role="tab" aria-selected=${String(tab === id)} onClick=${() => { setTab(id); buzz(5); }}>${label}${counts[id] ? html`<span class="n">${counts[id]}</span>` : null}</button>`)}
    </div>

    <div key=${tab} class="rise" style="padding-top:18px;min-height:46vh">
      ${q.locked ? (notOpen ? html`<${Empty} title="Not a live job yet">This one is still being quoted. It opens up for the crew once the customer says yes.<//>`
          : closed ? html`<${Empty} title="This job is closed">Ask the office if you need something from it.<//>`
          : html`<${Empty} title="Add yourself to open this job">The scope, photos and notes open up once you are on the job.<//>`)
        : !data ? html`<div class="page-pad" style="display:grid;gap:12px"><${Skel} h=${90} r=${14} /><${Skel} w="80%" /><${Skel} w="60%" /></div>`
        : tab === 'scope' ? html`<${ScopeTab} data=${data} job=${job} vertical=${vertical} videos=${videos} user=${user} viewOnly=${viewOnly} onJob=${onJob} />`
        : tab === 'photos' ? html`<${PhotosTab} jobId=${jobId} photos=${photos} viewOnly=${viewOnly} live=${Boolean(clock && clock.jobId === jobId)} started=${myRows.some((r) => r.clockOn)} />`
        : tab === 'notes' ? html`<${NotesTab} jobId=${jobId} job=${job} notes=${notes} pending=${pendingNotes} user=${user} viewOnly=${viewOnly} />`
        : tab === 'files' ? html`<${FilesTab} jobId=${jobId} data=${data} user=${user} viewOnly=${viewOnly} />`
        : html`<${CrewTab} jobId=${jobId} job=${job} crew=${crew} lead=${data.leadInstaller} user=${user} myRows=${myRows} vertical=${vertical} />`}
    </div>

    <${Dock} job=${job} jobId=${jobId} clock=${clock} myRows=${myRows} today=${today} closed=${closed} vertical=${vertical} />
  <//>`;
}

// ---------------------------------------------------------------- dock ----
function Dock({ job, jobId, clock, myRows, today, closed, vertical }) {
  const [busy, setBusy] = useState(false);
  const liveHere = clock && clock.jobId === jobId;
  const t = useElapsed(liveHere ? clock.since : null, liveHere ? clock.breakMin : 0);
  const todayRow = myRows.find((r) => r.date === today);
  const doneToday = todayRow && (todayRow.clockOff || ['complete', 'completed', 'submitted', 'verified'].includes(todayRow.status));
  const ahead = myRows.filter((r) => r.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const canFinish = !closed && !isReportJob(vertical);

  if (liveHere) {
    return html`<div class="dock">
      <div style="display:flex;align-items:baseline;justify-content:space-between"><span class="t-label" style="color:var(--hi);display:flex;gap:8px;align-items:center"><i class="pulse" />On the clock</span><span class="t-num" style="font-size:26px">${t.h}:${t.m}<small class="t-mute" style="font-size:15px">:${t.s}</small></span></div>
      <div class="btnrow"><${Button} onClick=${() => openClockOff()}>Clock off<//>${canFinish ? html`<${Button} kind="line" onClick=${() => go(`/job/${jobId}/finish`)}>Job finished<//>` : null}</div>
    </div>`;
  }
  if (closed && !myRows.length) return null;
  if (todayRow && !doneToday && !closed) {
    return html`<div class="dock"><${Slide} label="Slide to clock on" busy=${busy} onConfirm=${async () => { setBusy(true); await clockOn({ id: todayRow.id, jobId, job }); setBusy(false); }} /></div>`;
  }
  if (doneToday) {
    return html`<div class="dock"><div class="inset" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span><span class="t-strong">Done for today</span>${todayRow.hours ? html`<span class="t-small" style="display:block">${fmtHours(Number(todayRow.hours))} on the clock</span>` : null}</span>
      ${canFinish ? html`<${Button} kind="line" small onClick=${() => go(`/job/${jobId}/finish`)}>Job finished<//>` : html`<${Icon} name="check" size=${24} class="t-ok" />`}
    </div></div>`;
  }
  if (closed) return null;
  if (ahead) {
    return html`<div class="dock"><div class="inset" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
      <span><span class="t-strong">You are on ${fmtRelDay(ahead.date) === 'Tomorrow' ? 'tomorrow' : fmtDay(ahead.date)}</span><span class="t-small" style="display:block">Here today instead?</span></span>
      <${Button} small busy=${busy} onClick=${async () => { setBusy(true); const r = await bookMyself(jobId, [today]); setBusy(false); if (!r.ok) toast(r.message, { kind: 'bad' }); else buzz(12); }}>I am here today<//>
    </div></div>`;
  }
  return html`<div class="dock"><${Button} block icon="plus" onClick=${() => openBook(jobId, job, myRows)}>I am on this job<//></div>`;
}

// ------------------------------------------------------------- booking ----
export function openBook(jobId, job, myRows = []) {
  openOverlay((close) => html`<${BookSheet} jobId=${jobId} job=${job} taken=${new Set(myRows.map((r) => r.date))} onClose=${close} />`);
}
function BookSheet({ jobId, job, taken, onClose }) {
  const today = todayISO();
  const [picked, setPicked] = useState(() => (taken.has(today) ? [] : [today]));
  const [past, setPast] = useState(false);
  const [busy, setBusy] = useState(false);
  const days = past ? Array.from({ length: 14 }, (_, i) => addDays(today, -(i + 1))) : Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const toggle = (d) => { buzz(6); setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d])); };
  const save = async (shut) => {
    setBusy(true);
    const r = await bookMyself(jobId, picked);
    setBusy(false);
    if (r.message) toast(r.message, { kind: r.ok ? '' : 'bad', ms: 6000 });
    if (r.ok) { if (!r.message) toast(picked.length === 1 ? `You are on ${jobTitle(job)}, ${fmtRelDay(picked[0]).toLowerCase()}.` : `You are on ${jobTitle(job)} for ${picked.length} days.`, { kind: 'ok' }); buzz([12, 40, 20]); shut(); }
  };
  return html`<${Sheet} title="Which days?" sub=${`${jobTitle(job)}. It goes on the office calendar. The customer is not texted.`} onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!picked.length} onClick=${() => save(shut)}>${picked.length > 1 ? `Add me for ${picked.length} days` : 'Add me'}<//>`}>
    <div class="stack">
      <div class="daypicks">
        ${days.map((d) => html`<button type="button" key=${d} class=${cx('daypick', d === today && 'today')} aria-pressed=${String(picked.includes(d))} disabled=${taken.has(d)} onClick=${() => toggle(d)}>
          <span class="dow">${d === today ? 'Today' : fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>${taken.has(d) ? html`<span class="t-small">On it</span>` : null}
        </button>`)}
      </div>
      <${Button} kind="quiet" onClick=${() => { setPast(!past); setPicked([]); }}>${past ? 'Pick days coming up' : 'I already worked on this job'}<//>
    </div>
  <//>`;
}

// -------------------------------------------------------------- report ----
function ReportCard({ jobId, data, vertical }) {
  const ms = (data && data.makesafe_details) || {};
  const report = data && data.serviceReport;
  const submitted = report && String(report.status || '').toLowerCase() === 'submitted';
  const reportType = ms.report_type;
  return html`<button type="button" class="block panel" style="margin-top:14px;padding:16px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px;width:calc(100% - 2 * var(--gut));text-align:left" onClick=${() => go(`/job/${jobId}/report`)}>
    <span><span class="t-label">${vertical === 'restoration' ? 'Restoration report' : reportType ? 'Builder report' : 'Make safe report'}</span>
      <span class="t-head" style="display:block;margin-top:3px">${submitted ? 'Report sent' : report ? 'Finish your report' : 'Write the report'}</span></span>
    ${submitted ? html`<${Chip} kind="ok" icon="check">Done<//>` : html`<${Icon} name="right" size=${20} />`}
  </button>`;
}

// --------------------------------------------------------------- scope ----
function ScopeTab({ data, job, vertical, videos, user, viewOnly, onJob }) {
  const money = user.seesMoney;
  const eligible = (vertical === 'fencing' || vertical === 'patio');
  const jwo = useQuery(eligible ? 'jwo:' + job.id : null, () => api('my_job_work_order', { job_id: job.id }, null, { keepSession: true }), { ttl: 120000 });
  const wo = jwo.data && jwo.data.work_order;
  const legacyWo = data.workOrder || data.work_order || null;
  const packs = data.quote_packs || data.quotePacks || [];
  const mainPack = packs.find((p) => p.status === 'accepted' || p.accepted === true) || packs[0] || null;
  const otherPacks = packs.filter((p) => p !== mainPack);
  const scope = job.scope_json || {};
  const sealed = data.crew_scope_of_works || null;
  const instructions = (wo && wo.special_instructions) || (legacyWo && legacyWo.special_instructions) || (scope.notes && scope.notes.noteWorkOrder) || '';
  const spec = sealed || scope.tool === 'patio-scoper' ? [] : buildSpec(scope, vertical);
  const scoperNotes = vertical === 'fencing' && scope.job ? [scope.job.siteNotes, scope.job.checklist && scope.job.checklist.finalNotes, scope.job.removal && scope.job.removal.notes].filter(Boolean) : [];
  const clientNote = scope.client && scope.client.notes;
  const tasks = wo && wo.scope_items && wo.scope_items.length ? wo.scope_items.map(taskFromItem)
    : mainPack && mainPack.quote_lines && mainPack.quote_lines.length ? mainPack.quote_lines.map(taskFromItem)
    : legacyWo && legacyWo.scope_items && legacyWo.scope_items.length ? legacyWo.scope_items.map(taskFromItem)
    : mainPack && mainPack.items ? mainPack.items.filter((i) => i.kind !== 'note').map(taskFromItem) : [];
  const quoteNotes = mainPack ? [...(mainPack.quote_notes || []), ...(mainPack.items || []).filter((i) => i.kind === 'note').map((i) => i.description), mainPack.notes].filter(Boolean) : [];
  const extract = (data.quote_extracts || data.quoteExtracts || []).find((x) => x.action === 'trade_quote_extract' && x.quote_number);
  const summary = data.scopeSummary || job.notes || '';
  const nothing = !instructions && !tasks.length && !spec.length && !sealed && !scoperNotes.length && !quoteNotes.length && !summary && !videos.length;

  return html`<div class="stack loose page-pad">
    ${instructions ? html`<section class="note-banner"><${Icon} name="info" size=${18} /><div><span class="t-label" style="color:inherit;opacity:.7">From the office</span><p class="prose" style="margin-top:2px">${noPrices(instructions, money)}</p></div></section>` : null}

    ${tasks.length ? html`<section>
      <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="t-head">What to do</h2>${wo && wo.wo_number ? html`<span class="t-small t-mute t-num">${wo.wo_number}</span>` : mainPack && mainPack.quote_number ? html`<span class="t-small t-mute t-num">Quote ${mainPack.quote_number}</span>` : null}</div>
      <div class="tasks" style="margin-top:6px">${tasks.map((t) => html`<div class=${cx('task', t.variation && 'var')}><span><span class="prose">${noPrices(t.text, money)}</span>${t.variation ? html`<span class="t-small" style="display:block;color:var(--warn);font-weight:650">Variation${t.variation === true ? '' : ' ' + t.variation}</span>` : null}</span><span class="q">${t.qty}</span></div>`)}</div>
      ${wo && (wo.addenda || []).map((ad) => html`<div style="margin-top:14px"><span class="t-label" style="color:var(--warn)">${ad.label || 'Variation ' + (ad.variation_number || '')}</span>
        ${ad.description ? html`<p class="prose" style="margin-top:4px">${noPrices(ad.description, money)}</p>` : null}
        <div class="tasks">${(ad.scope_items || ad.lines || []).map(taskFromItem).map((t) => html`<div class="task var"><span class="prose">${noPrices(t.text, money)}</span><span class="q">${t.qty}</span></div>`)}</div></div>`)}
    </section>` : null}

    ${sealed ? html`<${SealedScope} sealed=${sealed} />` : null}

    ${spec.length ? html`<section><h2 class="t-head" style="margin-bottom:10px">Build details</h2>
      <dl class="kv">${spec.map(([k, v, wide]) => html`<div class=${wide ? 'wide' : ''}><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></section>` : null}

    ${scoperNotes.length || clientNote ? html`<section><h2 class="t-head" style="margin-bottom:8px">Notes from the site visit</h2>
      <div class="stack tight">${[...scoperNotes, clientNote].filter(Boolean).map((n) => html`<p class="prose quote-note">${noPrices(n, money)}</p>`)}</div></section>` : null}

    ${quoteNotes.length ? html`<section><h2 class="t-head" style="margin-bottom:8px">From the quote</h2>
      <div class="stack tight">${quoteNotes.map((n) => html`<p class="prose quote-note">${noPrices(n, money)}</p>`)}</div></section>` : null}

    ${!tasks.length && summary ? html`<section><h2 class="t-head" style="margin-bottom:8px">About this job</h2><p class="prose">${noPrices(typeof summary === 'string' ? summary : '', money)}</p></section>` : null}

    ${videos.length ? html`<section><h2 class="t-head" style="margin-bottom:10px">Site video${videos.length > 1 ? 's' : ''}</h2>
      <div class="stack tight">${videos.map((v) => html`<div><video class="clip-video" controls playsinline preload="metadata" src=${v.url} />${v.label ? html`<p class="t-small" style="margin-top:4px">${v.label}</p>` : null}</div>`)}</div></section>` : null}

    ${extract ? html`<${Button} kind="line" block icon="file" onClick=${() => openQuote(job.id, extract)}>Open the full quote (no prices)<//>` : null}
    ${otherPacks.length ? html`<p class="t-small t-mute">${otherPacks.length} earlier quote${otherPacks.length > 1 ? 's' : ''} on this job. This shows the ${mainPack && (mainPack.status === 'accepted' || mainPack.accepted) ? 'accepted' : 'latest'} one.</p>` : null}

    ${nothing ? html`<${Empty} title="No scope on this job yet">The office has not attached a scope of works. Check the notes and files, or call the office.<//>` : null}

    ${onJob && !viewOnly ? html`<section style="margin-top:6px"><${Button} kind="soft" block icon="plus" onClick=${() => openVariation(job)}>Extra work? Ask for a variation<//></section>` : null}
  </div>`;
}
function taskFromItem(item) {
  if (typeof item === 'string') return { text: item, qty: '' };
  const text = item.description || item.item || item.name || '';
  const unit = item.unit || '';
  const n = item.qty != null ? item.qty : item.quantity;
  let qty = '';
  if (item.hours != null && item.hours !== '') qty = `${item.hours} h`;
  else if (n != null && n !== '' && !(Number(n) === 1 && !unit)) qty = `${n}${unit ? ' ' + unit : ''}`;
  return { text, qty, variation: item.is_variation || item.variation_number ? (item.variation_label || item.variation_number || true) : false };
}
function num(v) { const n = Number(v); return v != null && v !== '' && !isNaN(n) ? n : null; }
function buildSpec(scope, vertical) {
  const cfg = scope.config || scope; const j = scope.job || {};
  const rows = [];
  const add = (k, v, wide) => { if (v != null && v !== '' && v !== false) rows.push([k, String(v), wide]); };
  if (vertical === 'fencing') {
    const runs = Array.isArray(j.runs) ? j.runs : [];
    const total = runs.reduce((s, r) => s + (num(r.length) || num(r.lengthM) || num(r.totalLength) || 0), 0) || num(cfg.totalLength) || num(cfg.length);
    add('Length', total ? `${Math.round(total * 10) / 10} m` : null);
    const h = num(j.sheetHeight) || num(cfg.height); add('Height', h ? `${h} mm` : null);
    add('Material', j.profile || j.material || cfg.material);
    add('Colour', j.colour || j.color || cfg.colour || cfg.color);
    const gates = Array.isArray(j.gates) ? j.gates : [];
    add('Gates', gates.length ? gates.map((g) => [g.type, g.width ? g.width + ' mm' : ''].filter(Boolean).join(' ')).join(', ') : num(cfg.gateCount), gates.length > 0);
    add('Plinths', cfg.plinths === true ? 'Yes' : cfg.plinths); add('Retaining', cfg.retaining === true ? 'Yes' : cfg.retaining);
    if (runs.length > 1) add('Runs', runs.map((r, i) => `${r.name || r.label || 'Run ' + (i + 1)}: ${num(r.length) || num(r.lengthM) || num(r.totalLength) || '?'} m`).join('\n'), true);
  } else {
    const l = num(cfg.length); const p = num(cfg.projection);
    add('Size', l && p ? `${l} x ${p} m` : null); add('Height', num(cfg.height) ? `${cfg.height} m` : cfg.height);
    add('Roof style', cfg.roofStyle); add('Roofing', cfg.roofing); add('Sheet colour', cfg.sheetColor || cfg.colour); add('Steel colour', cfg.steelColor);
    add('Fixing', cfg.connection); add('Posts', [cfg.posts, cfg.postSize].filter(Boolean).join(' x ')); add('Beams', [cfg.beams, cfg.beamSize].filter(Boolean).join(' x '));
  }
  return rows;
}
function SealedScope({ sealed }) {
  const [state, setState] = useState('checking');
  useEffect(() => {
    let on = true;
    if (sealed.status !== 'accepted' || !sealed.page) { setState('not-proved'); return undefined; }
    const text = JSON.stringify(String(sealed.page));
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then((buf) => {
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (on) setState(hex === sealed.content_hash ? 'ok' : 'differs');
    }).catch(() => on && setState('differs'));
    return () => { on = false; };
  }, [sealed]);
  if (state === 'checking') return html`<${Skel} h=${220} r=${14} />`;
  if (state !== 'ok') return html`<section class="note-banner"><${Icon} name="alert" size=${18} /><span>${state === 'not-proved' ? (sealed.reason || 'Which version the customer accepted could not be confirmed.') : 'The scope page on this phone does not match the sealed one.'} So it is not shown here. Ask the office for it.</span></section>`;
  return html`<section><h2 class="t-head" style="margin-bottom:10px">Scope of works</h2>
    <iframe title="Scope of works" sandbox="" srcdoc=${sealed.page} style="width:100%;height:70vh;border:0;border-radius:var(--r-m);background:white" />
    <p class="t-small t-mute" style="margin-top:6px">The version the customer accepted. Same page the office sees.</p></section>`;
}
function openQuote(jobId, extract) {
  openOverlay((close) => html`<${QuoteSheet} jobId=${jobId} extract=${extract} onClose=${close} />`);
}
function QuoteSheet({ jobId, extract, onClose }) {
  const [page, setPage] = useState(null); const [err, setErr] = useState(null);
  useEffect(() => { apiText('trade_quote_extract', { format: 'html', jobId, document_id: extract.job_document_id }).then(setPage).catch(setErr); }, []);
  return html`<${Sheet} title=${'Quote ' + extract.quote_number} sub="Prices are left out." onClose=${onClose} tall>
    ${err ? html`<${Empty} title="Could not open the quote">${friendly(err)}<//>` : page == null ? html`<${Skel} h=${300} r=${14} />` : html`<iframe title="Quote" sandbox="" srcdoc=${page} style="width:100%;height:100%;min-height:60vh;border:0;border-radius:var(--r-m);background:white" />`}
  <//>`;
}

// -------------------------------------------------------------- photos ----
function PhotosTab({ jobId, photos, viewOnly, live, started }) {
  const [pending, setPending] = useState([]);
  const defaultPhase = live ? 'in_progress' : started ? 'completion' : 'scope';
  const add = async (phase) => {
    const files = await pickPhotos({ multiple: true });
    if (!files.length) return;
    const batch = files.map((f, i) => ({ key: Date.now() + '-' + i, file: f, preview: URL.createObjectURL(f), phase, state: 'sending' }));
    setPending((p) => [...batch, ...p]);
    let queued = 0; let failed = 0;
    for (const item of batch) {
      try {
        const r = await uploadPhoto(jobId, item.file, { phase });
        if (r.queued) { queued += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'queued' } : x))); } else setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) { failed += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x))); toast(friendly(err), { kind: 'bad' }); }
    }
    invalidate('job:' + jobId);
    if (queued) toast(`${queued} photo${queued > 1 ? 's' : ''} saved on your phone. They will send when you have signal.`);
    else if (!failed) { toast(`${batch.length} photo${batch.length > 1 ? 's' : ''} added.`, { kind: 'ok' }); buzz(10); }
  };
  const groups = PHASES.map(([phase, label]) => ({ phase, label, items: photos.filter((p) => (p.phase || 'scope') === phase), pend: pending.filter((p) => p.phase === phase) }));
  const other = photos.filter((p) => !PHASES.some(([ph]) => ph === (p.phase || 'scope')));
  return html`<div class="stack loose page-pad">
    ${viewOnly ? null : html`<${Button} block icon="camera" onClick=${() => add(defaultPhase)}>Add ${defaultPhase === 'scope' ? 'before' : defaultPhase === 'in_progress' ? 'progress' : 'finished'} photos<//>`}
    ${groups.map((g) => (g.items.length || g.pend.length || !viewOnly) ? html`<section key=${g.phase}>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><h2 class="t-head">${g.label}</h2><span class="t-small t-mute t-num">${g.items.length || ''}</span></div>
      <${PhotoGrid} photos=${g.items} pending=${g.pend} onAdd=${viewOnly ? null : () => add(g.phase)} addLabel="Add" />
    </section>` : null)}
    ${other.length ? html`<section><h2 class="t-head" style="margin-bottom:8px">Other</h2><${PhotoGrid} photos=${other} /></section>` : null}
    ${viewOnly && !photos.length ? html`<${Empty} title="No photos yet" />` : null}
  </div>`;
}

// --------------------------------------------------------------- notes ----
function usePendingNotes(jobId) {
  const read = () => outboxItems().filter((i) => i.kind === 'api' && i.action === 'add_note' && i.jobId === jobId);
  const [items, setItems] = useState(read);
  useEffect(() => onOutbox(() => setItems(read())), [jobId]);
  return items;
}
function NotesTab({ jobId, job, notes, pending, user, viewOnly }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = text.trim(); if (!t) return;
    setBusy(true);
    const body = noteBody(jobId, t, user);
    try {
      await api('add_note', null, body);
      optimisticNote(jobId, t, user);
      invalidate('job:' + jobId);
      setText(''); buzz(8);
    } catch (err) {
      if (err instanceof ApiError && err.refused) toast(friendly(err), { kind: 'bad' });
      else { queueWrite({ action: 'add_note', body, jobId, label: 'Note on ' + jobTitle(job) }); setText(''); toast('Note saved on your phone. It will send when you have signal.'); }
    }
    setBusy(false);
  };
  return html`<div class="stack loose page-pad">
    ${viewOnly ? null : html`<div><div class="composer">
      <textarea class="input" rows="1" placeholder="Write a note for the office and crew" value=${text} onInput=${(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(140, e.currentTarget.scrollHeight) + 'px'; }} />
      <button type="button" class="send" aria-label="Send note" disabled=${!text.trim() || busy} onClick=${send}><${Icon} name="send" size=${22} stroke=${2.4} /></button>
    </div><p class="t-small t-mute" style="margin-top:6px">Notes go to the office and crew. The customer does not see them.</p></div>`}
    ${notes.length || pending.length ? html`<div class="notes">
      ${pending.map((p) => html`<div class="note pending" key=${p.id}><${Avatar} name=${user.name} me /><div><div class="who"><b>You</b> · waiting for signal</div><div class="bubble prose">${p.body.text}</div></div></div>`).reverse()}
      ${[...notes].reverse().map((n) => { const who = noteAuthor(n); const office = who === 'Office'; return html`<div class=${cx('note', office && 'office')} key=${n.id}>
        <${Avatar} name=${who} me=${n._mine || (n.users && n.users.name === user.name)} /><div><div class="who"><b>${who}</b> · ${fmtTs(n.created_at)}</div><div class="bubble prose">${noPrices(noteText(n), user.seesMoney)}</div></div></div>`; })}
    </div>` : html`<${Empty} title="No notes yet">${viewOnly ? '' : 'Anything the next person should know? Gate codes, dogs, where the materials are.'}<//>`}
  </div>`;
}

// --------------------------------------------------------------- files ----
const DOC_LABEL = { council_plans: 'Council plans', engineering: 'Engineering', work_order: 'Work order', roof_report: 'Roof report', makesafe_report: 'Make safe report', swms: 'Safe work statement', approval: 'Approval', supplier_quote: 'Supplier quote', quote: 'Quote', other: 'Document' };
function docUrl(d) { return [d.pdf_url, d.public_url, d.signed_url, d.download_url, d.url, d.file_url, d.storage_url].find((u) => typeof u === 'string' && /^https?:/.test(u)); }
function FilesTab({ jobId, data, user, viewOnly }) {
  // Priced paperwork (quotes, invoices, work orders, supplier quotes) is for the office only.
  const priced = ['quote', 'invoice', 'work_order', 'supplier_work_order', 'supplier_quote', 'purchase_order'];
  const docs = (data.documents || []).filter((d) => d.visible_to_trades !== false && d.type !== 'site_photo' && docUrl(d) && (user.seesMoney || !priced.includes(String(d.type || '').toLowerCase())));
  const pos = data.purchaseOrders || [];
  const receipts = (data.media || []).filter((m) => m.phase === 'receipt');
  const [busyPo, setBusyPo] = useState(null);
  const addReceipt = async (po) => {
    const files = await pickPhotos({ multiple: false, camera: true });
    if (!files.length) return;
    setBusyPo(po.id);
    try {
      const r = await uploadPhoto(jobId, files[0], { phase: 'receipt', poId: po.id, label: 'Receipt - ' + (po.supplier_name || po.contact_name || 'supplier') });
      toast(r.queued ? 'Receipt saved on your phone. It will send when you have signal.' : 'Receipt added.', { kind: r.queued ? '' : 'ok' });
      invalidate('job:' + jobId);
    } catch (err) { toast(friendly(err), { kind: 'bad' }); }
    setBusyPo(null);
  };
  return html`<div class="stack loose page-pad">
    ${pos.length ? html`<section><h2 class="t-head" style="margin-bottom:10px">Materials</h2><div class="stack tight">
      ${pos.map((po) => { const approved = ['authorised', 'billed', 'sent', 'confirmed', 'delivered', 'submitted'].includes(String(po.status).toLowerCase()); const mine = receipts.filter((r) => r.po_id === po.id); const when = po.confirmed_delivery_date || po.delivery_date;
        return html`<div class="inset" key=${po.id}>
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><span><span class="t-strong">${po.supplier_name || po.contact_name || 'Supplier'}</span><span class="t-small t-num" style="display:block">${po.po_number || ''}</span></span>
            ${!approved ? html`<${Chip} kind="warn">Not approved yet<//>` : when ? html`<${Chip} kind="ok" icon="truck">${fmtDate(when)}<//>` : html`<${Chip}>Pick up<//>`}</div>
          ${(po.line_items || []).length ? html`<ul style="margin:10px 0 0;padding-left:18px;color:var(--ink-2);font-size:15px">${po.line_items.map((li) => html`<li>${li.quantity || li.Quantity ? (li.quantity || li.Quantity) + ' x ' : ''}${noPrices(li.description || li.Description || '', user.seesMoney)}</li>`)}</ul>` : null}
          ${!approved ? html`<p class="t-small" style="margin-top:8px">Do not buy against this order until the office approves it.</p>` : null}
          ${mine.length ? html`<div style="margin-top:10px"><${PhotoGrid} four photos=${mine.map((m) => ({ ...m, url: m.storage_url, thumb: m.thumbnail_url || m.storage_url }))} /></div>` : null}
          ${approved && !viewOnly ? html`<${Button} kind="line" small icon="receipt" busy=${busyPo === po.id} style="margin-top:12px" onClick=${() => addReceipt(po)}>Add receipt photo<//>` : null}
        </div>`; })}
    </div></section>` : null}
    ${docs.length ? html`<section><h2 class="t-head" style="margin-bottom:4px">Documents</h2>
      ${docs.map((d) => html`<a class="filerow" href=${docUrl(d)} target="_blank" rel="noopener"><span class="ico"><${Icon} name="file" size=${20} /></span>
        <span style="min-width:0"><b class="clip">${d.label || d.file_name || d.name || d.filename || DOC_LABEL[d.type] || 'Document'}</b><span>${DOC_LABEL[d.type] || 'Document'}</span></span><${Icon} name="external" size=${18} class="t-mute" /></a>`)}</section>` : null}
    ${!pos.length && !docs.length ? html`<${Empty} title="No files on this job">Plans, approvals and material orders show here when the office adds them.<//>` : null}
    ${viewOnly ? null : html`<${Button} kind="soft" block icon="receipt" onClick=${() => go('/pay/receipt?job=' + jobId)}>Bought something for this job? Add the receipt<//>`}
  </div>`;
}

// ---------------------------------------------------------------- crew ----
function CrewTab({ jobId, job, crew, lead, user, myRows, vertical }) {
  const today = todayISO();
  const people = useMemo(() => {
    const map = new Map();
    for (const c of crew) {
      const id = c.user_id || c.name;
      const p = map.get(id) || { id, name: c.name || (c.users && c.users.name) || c.crew_name || 'Crew', phone: (c.users && c.users.phone) || c.phone || null, days: [], lead: false };
      p.days.push({ id: c.id, date: (c.scheduled_date || '').slice(0, 10), status: String(c.status || '').toLowerCase() });
      if (c.is_lead || (lead && lead.user_id === c.user_id)) p.lead = true;
      map.set(id, p);
    }
    return [...map.values()].map((p) => ({ ...p, days: p.days.sort((a, b) => a.date.localeCompare(b.date)) })).sort((a, b) => (b.lead - a.lead) || (a.id === user.id ? -1 : 1));
  }, [crew, lead, user.id]);
  const remove = async (day) => {
    if (!(await ask({ title: `Take yourself off ${fmtDay(day.date)}?`, body: 'The office will see you are no longer booked that day.', yes: 'Take me off', danger: true }))) return;
    const r = await unbookMyself(day.id, jobId);
    if (r.ok) toast('Done. You are off that day.', { kind: 'ok' }); else toast(r.message, { kind: 'bad' });
  };
  const canAllocate = user.office || user.managed.includes(vertical);
  return html`<div class="stack loose page-pad">
    ${people.length ? html`<div class="stack">${people.map((p) => html`<div key=${p.id} style="display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:start">
      <${Avatar} name=${p.name} me=${p.id === user.id} lg />
      <div><div class="t-strong" style="font-size:17px">${p.id === user.id ? 'You' : p.name}${p.lead ? html` <${Chip} kind="solid">Lead<//>` : null}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${p.days.map((d) => html`<${DayChip} day=${d} today=${today} mine=${p.id === user.id} onRemove=${() => remove(d)} />`)}</div></div>
      ${p.phone && p.id !== user.id ? html`<a class="iconbtn" href=${'tel:' + p.phone} aria-label=${'Call ' + p.name}><${Icon} name="phone" size=${20} /></a>` : html`<span />`}
    </div>`)}</div>` : html`<${Empty} title="Nobody is booked yet">Be the first. Add yourself and it shows on the office calendar.<//>`}
    <div class="btnrow">
      <${Button} kind="line" icon="plus" onClick=${() => openBook(jobId, job, myRows)}>${myRows.length ? 'Add another day' : 'Add myself'}<//>
      ${canAllocate ? html`<${Button} kind="soft" icon="users" onClick=${() => import('./allocate.js').then((m) => m.openAllocate(job, vertical)).catch(() => toast('Could not open that. Check your signal.', { kind: 'bad' }))}>Book crew<//>` : null}
    </div>
  </div>`;
}
function DayChip({ day, today, mine, onRemove }) {
  const done = ['complete', 'completed', 'submitted', 'verified'].includes(day.status);
  const removable = mine && !done && day.date >= today && day.status !== 'in_progress';
  return html`<span class=${cx('chip', done && 'ok', day.date === today && !done && 'hi')}>${done ? html`<${Icon} name="check" size=${13} stroke=${2.6} />` : null}${day.date ? fmtDay(day.date) : 'No date'}
    ${removable ? html`<button type="button" aria-label="Take me off this day" onClick=${onRemove} style="margin:-4px -6px -4px 0;padding:4px"><${Icon} name="close" size=${13} stroke=${2.6} /></button>` : null}</span>`;
}

// ------------------------------------------------- problem, text, variation
const PROBLEMS = ['Materials missing', 'Site access issue', 'Client not home', 'Damage found', 'Other'];
function openProblem(job) { openOverlay((close) => html`<${ProblemSheet} job=${job} onClose=${close} />`); }
function ProblemSheet({ job, onClose }) {
  const [type, setType] = useState(null); const [detail, setDetail] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    const body = { jobId: job.id, issueType: type, detail: detail.trim() || null, notify_telegram: true };
    try { await api('create_trade_alert', null, body); toast('Sent to the office.', { kind: 'ok' }); } catch (err) {
      if (err instanceof ApiError && err.refused) { toast(friendly(err), { kind: 'bad' }); setBusy(false); return; }
      queueWrite({ action: 'create_trade_alert', body, jobId: job.id, label: 'Problem on ' + jobTitle(job) });
      toast('Saved. It will reach the office when you have signal. If it is urgent, call them.');
    }
    setBusy(false); shut();
  };
  return html`<${Sheet} title="Tell the office" sub=${jobTitle(job)} onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!type} onClick=${() => send(shut)}>Send to the office<//>`}>
    <div class="stack">
      <${Field} label="What is wrong?"><${Picks} value=${type} options=${PROBLEMS.map((p) => [p, p])} onChange=${setType} /><//>
      <${Field} label="Anything to add?"><textarea class="input" placeholder="What you can see, what you need" value=${detail} onInput=${(e) => setDetail(e.currentTarget.value)} /><//>
    </div>
  <//>`;
}
function openText(job) { openOverlay((close) => html`<${TextSheet} job=${job} onClose=${close} />`); }
function TextSheet({ job, onClose }) {
  const first = String(job.client_name || '').split(' ')[0] || 'there';
  const quick = [`Hi ${first}, it is SecureWorks. I am on my way to you now.`, `Hi ${first}, it is SecureWorks. I am running a bit late, sorry. I will be there soon.`, `Hi ${first}, SecureWorks here. We are finished for today and will be back to carry on.`];
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    try { await ghl('send_sms', null, { contactId: job.ghl_contact_id, message: msg.trim(), jobId: job.id }); toast('Text sent to the customer.', { kind: 'ok' }); shut(); } catch (err) { toast(friendly(err), { kind: 'bad' }); }
    setBusy(false);
  };
  return html`<${Sheet} title="Text the customer" sub="Sent from the SecureWorks number, so replies go to the office." onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!msg.trim()} onClick=${() => send(shut)}>Send text<//>`}>
    <div class="stack">
      <div class="stack tight">${quick.map((qm) => html`<button type="button" class="inset" style="text-align:left" onClick=${() => { setMsg(qm); buzz(6); }}>${qm}</button>`)}</div>
      <${Field} label="Your message"><textarea class="input" value=${msg} onInput=${(e) => setMsg(e.currentTarget.value)} placeholder="Pick one above or write your own" /><//>
    </div>
  <//>`;
}
function openVariation(job) { openOverlay((close) => html`<${VariationSheet} job=${job} onClose=${close} />`); }
function VariationSheet({ job, onClose }) {
  const [desc, setDesc] = useState(''); const [cost, setCost] = useState(''); const [photo, setPhoto] = useState(null); const [busy, setBusy] = useState(false);
  const send = async (shut) => {
    setBusy(true);
    try {
      let photoUrl;
      if (photo) { const r = await uploadPhoto(job.id, photo, { phase: 'in_progress', label: 'Variation request photo' }); photoUrl = r.media && (r.media.url || r.media.publicUrl); }
      const body = { job_id: job.id, description: desc.trim() };
      if (cost !== '' && Number(cost) >= 0) body.estimated_cost = Number(cost);
      if (photoUrl) body.photo_url = photoUrl;
      const res = await api('create_variation', null, body);
      if (!res || res.success !== true) throw new ApiError((res && res.error) || 'The request was not saved.', { status: 409, body: res });
      toast(res.auto_approved ? (res.message || 'Variation approved.') : 'Sent. The office will approve it before the extra work goes ahead.', { kind: 'ok', ms: 5000 });
      invalidate('job:' + job.id); shut();
    } catch (err) {
      toast(err.offline ? 'No signal. A variation needs a connection, try again in range.' : (err.body && err.body.code) === 'variation_requires_assignment' ? 'Add yourself to this job first.' : friendly(err), { kind: 'bad', ms: 6000 });
    }
    setBusy(false);
  };
  return html`<${Sheet} title="Ask for a variation" sub="Extra work the customer wants, or something the scope missed. The office approves it first." onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${desc.trim().length < 4} onClick=${() => send(shut)}>Send to the office<//>`}>
    <div class="stack">
      <${Field} label="What is the extra work?"><textarea class="input" value=${desc} onInput=${(e) => setDesc(e.currentTarget.value)} placeholder="e.g. Extra 3 m of fence down the left side, customer asked on site" /><//>
      <${Field} label="Your guess at the cost (optional)"><input class="input" type="number" inputmode="decimal" min="0" value=${cost} onInput=${(e) => setCost(e.currentTarget.value)} placeholder="$" /><//>
      <${Button} kind="line" icon="camera" onClick=${async () => { const f = await pickPhotos({ multiple: false }); if (f[0]) setPhoto(f[0]); }}>${photo ? 'Photo added. Change it' : 'Add a photo'}<//>
    </div>
  <//>`;
}
