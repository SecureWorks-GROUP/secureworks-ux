// The make safe (and restoration) report.
// A job that is reported on the builder's website gets a short panel: the
// link, "I have done it", and the option to write our own roof report.
// Every other make safe gets the form: the visit, what happened, what was
// done, materials, anything still unsafe and photos. Once sent it shows as a
// summary, with change, went-back-again and the hours row.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, ApiError } from '../lib/api.js';
import { useStore, local, invalidate, mutateQuery } from '../lib/store.js';
import { useJob, jobStub, noteBody } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, fmtDay, fmtTime, fmtTs, fmtHours, hoursBetween, hmToMinutes, tsToDate, tsToHM } from '../lib/dates.js';
import { verticalOf, isReportJob, jobTitle, splitMedia, noPrices } from '../lib/model.js';
import { queueWrite } from '../lib/outbox.js';
import { uploadPhoto, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Tag, Chip, Button, Sheet, Skel, Empty, LoadError, PhotoGrid, Field, Picks, Toggle, IconButton, toast, openOverlay, ask, buzz } from '../ui/kit.js';
import { plain, isRefusal, Counter, MultiPicks, DayPick, TimesBlock, HoursCard, roundHM, timesProblem } from '../ui/report-kit.js';

const MIN_PHOTOS = 5;
// Values are what the office system stores; the second word is what the trade reads.
const TYPES = [['Temporary fencing', 'Temporary fencing'], ['Roof / tarp', 'Roof or tarp'], ['Ceiling / water ingress', 'Ceiling or water coming in'], ['Fence damage', 'Fence damage'], ['Patio / structure', 'Patio or structure'], ['Debris / cleanup', 'Debris clean-up'], ['Other', 'Something else']];
const CAUSES = [['Storm / wind', 'Storm or wind'], ['Vehicle / tree impact', 'Vehicle or tree hit it'], ['Water ingress', 'Water getting in'], ['Fire', 'Fire'], ['Existing damage / wear', 'Old damage or wear'], ['Unknown', 'Not sure'], ['Other', 'Something else']];
const MATERIALS = ['Heavy-duty tarp', 'Sandbags', 'Rope or tie-downs', 'Timber battens', 'Screws and fixings', 'Plastic sheeting', 'Sealant', 'Temporary fence panels', 'Fence blocks', 'Star pickets', 'Caution tape'];
const HAZARDS = ['Live power', 'Asbestos suspected', 'Unstable structure', 'Water still getting in', 'Sharp debris', 'Open hole or drop'];
const HAZARD_LEAD = 'Still unsafe on site: ';
const QUICK = {
  'Temporary fencing': ['Put up temporary fencing', 'Removed the damaged panels', 'Made the area safe'],
  'Roof / tarp': ['Tarped the damaged roof', 'Secured the loose sheets', 'Cleared debris off the roof'],
  'Ceiling / water ingress': ['Propped the ceiling', 'Took down the wet ceiling', 'Put down plastic sheeting'],
  'Fence damage': ['Removed the damaged panels', 'Braced the leaning fence', 'Made the boundary safe'],
  'Patio / structure': ['Propped the structure', 'Removed the loose sheets', 'Taped off the area'],
  'Debris / cleanup': ['Cut up and stacked the debris', 'Cleared the access', 'Removed the hazards']
};
const REPORT_FAMILY = { roof_report: 'Roof report', assessment_report_quote: 'Assessment and quote report' };
const CANCEL_REASONS = [['builder_recalled', 'Builder called it off'], ['reallocated', 'Given to another trade'], ['sent_in_error', 'Sent by mistake'], ['duplicate', 'Duplicate'], ['other', 'Other']];
const labelOf = (list, v) => (list.find((x) => x[0] === v) || [null, v])[1];

// ------------------------------------------------- builder's website links --
const ASSET = /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i;
/** Only a real share or report page. Never a picture, a tracking link or anything else. */
export function isShareLink(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'awstrack.me' || host.endsWith('.awstrack.me')) return false;
    if (ASSET.test(u.pathname)) return false;
    return /\/(share|report|reports|portal|s|r)\//i.test(u.pathname);
  } catch { return false; }
}
const PORTAL_KINDS = ['builder_portal', 'roof_report', 'assessment_report', 'photos', 'quote'];
const KIND_WORD = { builder_portal: "The builder's website", roof_report: 'Roof report', assessment_report: 'Assessment report', photos: 'Photos', quote: 'Quote' };
const kindOf = (l) => String((l && l.kind) || '').toLowerCase().replace(/[\s-]+/g, '_');
/** The link to open, then any others worth offering. */
export function portalLinks(ms, metadata, seesMoney) {
  const md = metadata || {};
  const list = Array.isArray(ms.external_links) ? ms.external_links : Array.isArray(md.external_links) ? md.external_links : [];
  const good = list.filter((l) => l && kindOf(l) !== 'source_email' && isShareLink(l.url) && (seesMoney || !/work[\s_-]*order|invoice|purchase[\s_-]*order/i.test(`${l.label || ''} ${l.kind || ''}`)));
  const first = good.find((l) => PORTAL_KINDS.includes(kindOf(l))) || good.find((l) => /builder\s*portal/i.test(l.label || ''));
  const legacy = [ms.external_links && !Array.isArray(ms.external_links) && ms.external_links.builder_portal_url, md.external_links && !Array.isArray(md.external_links) && md.external_links.builder_portal_url, ms.builder_portal_url, md.builder_portal_url].find(isShareLink);
  const main = first ? first.url : legacy || '';
  const seen = new Set([main]);
  const others = [];
  for (const l of good) { if (seen.has(l.url) || !PORTAL_KINDS.includes(kindOf(l))) continue; seen.add(l.url); others.push({ url: l.url, label: KIND_WORD[kindOf(l)] || 'Link' }); }
  return { main, mainLabel: first ? KIND_WORD[kindOf(first)] || '' : '', others };
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

// ------------------------------------------------------------ the screen ---
export function Report({ jobId }) {
  const user = useStore((s) => s.user);
  const q = useJob(jobId);
  const data = q.data;
  const job = (data && data.job) || jobStub(jobId);
  const toJob = () => back('/job/' + jobId);

  if (!data && q.loading) return html`<${Page} title="Report" onBack=${toJob}><div class="page-pad" style="display:grid;gap:14px"><${Skel} w="30%" h=${12} /><${Skel} w="70%" h=${30} /><${Skel} w="90%" /><${Skel} h=${120} r=${14} style="margin-top:10px" /><${Skel} h=${180} r=${14} /></div><//>`;
  if (!data) {
    return html`<${Page} title="Report" onBack=${toJob}>${q.locked
      ? html`<${Empty} title="Add yourself to this job first" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>The report opens once you are on the job.<//>`
      : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this report" />`}<//>`;
  }
  const vertical = verticalOf(job, data);
  // The office system sends make safe details beside the job; an older read keeps them on the job itself.
  const ms = { ...(job.makesafe_details || {}), ...(data.makesafe_details || {}) };
  const md = job.metadata || {};
  const family = String(ms.makesafe_job_family || ms.makesafeJobFamily || job.makesafe_job_family || md.makesafe_job_family || md.makesafeJobFamily || ms.report_type || '').toLowerCase().trim();
  const reportFamily = REPORT_FAMILY[family] ? family : REPORT_FAMILY[String(ms.report_type || '').toLowerCase()] ? String(ms.report_type).toLowerCase() : '';
  const handoff = ms.completion_handoff || (reportFamily ? 'builder_portal' : 'physical');
  const manager = user.office || user.managed.includes('makesafe');
  const title = vertical === 'restoration' ? 'Restoration report' : handoff === 'physical' ? 'Make safe report' : REPORT_FAMILY[reportFamily] || 'Roof report';
  const visit = Number(ms.cycle_number) || (Number(ms.reattend_count) || 0) + 1;
  const report = data.serviceReport || null;
  const status = report ? String(report.status || '').toLowerCase() : '';
  const sent = status === 'submitted' || status === 'approved';

  const head = html`<header class="jobhero">
    <div class="ref"><${Tag} vertical=${vertical} />${job.job_number ? html`<span class="t-small t-num t-mute">${job.job_number}</span>` : null}${visit > 1 ? html`<${Chip} kind="hi">Visit ${visit}<//>` : null}</div>
    <h1 class="t-title" style="font-size:30px">${title}</h1>
    <p class="t-small">${[jobTitle(job), ms.requesting_company_name || md.requesting_company_name, ms.external_ref || md.external_ref].filter(Boolean).join(' · ')}</p>
  </header>`;
  const wrap = (body) => html`<${Page} title=${title} onBack=${toJob}>${head}${body}<//>`;

  if (!isReportJob(vertical)) {
    return wrap(html`<${Empty} title="This job has no report like this" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Back to the job<//>`}>Reports here are for make safe and restoration jobs. Finish other jobs from the job page.<//>`);
  }
  if (data.access_tier === 'company_view') {
    return wrap(html`<${Empty} title="Add yourself to this job first" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>The report opens once you are on the job.<//>`);
  }
  if (String(job.status).toLowerCase() === 'cancelled') {
    return wrap(html`<div class="block note-banner" style="margin-top:18px"><${Icon} name="info" size=${18} /><span><span class="t-strong">This job was cancelled.</span> There is no report to write.</span></div>
      ${manager ? html`<div class="block"><${ManagerBox} jobId=${jobId} job=${job} user=${user} /></div>` : null}`);
  }

  const common = { jobId, job, data, ms, user, visit };
  const managerBox = manager ? html`<div class="block"><${ManagerBox} jobId=${jobId} job=${job} user=${user} /></div>` : null;
  const writing = handoff === 'physical' && !sent;
  return wrap(html`
    ${visit > 1 && ms.last_reattend_reason && !sent ? html`<div class="block note-banner plain" style="margin-top:14px"><${Icon} name="refresh" size=${18} /><span>You went back: ${noPrices(ms.last_reattend_reason, user.seesMoney)}. This report is for this visit only.</span></div>` : null}
    ${q.error ? html`<div class="block note-banner" style="margin-top:14px">Showing the last saved copy. ${q.error.offline ? 'No signal.' : ''}</div>` : null}
    ${handoff === 'physical'
      ? (sent ? html`<${Submitted} ...${common} report=${report} />` : html`<${ReportForm} key=${ms.attendance_cycle_id || visit} ...${common} report=${report} tail=${managerBox} />`)
      : html`<${BuilderReport} ...${common} handoff=${handoff} family=${reportFamily} />`}
    ${writing ? null : managerBox}
  `);
}

// -------------------------------------------------------------- the form ---
const blankForm = () => ({ date: '', start: '', finish: '', breakMin: null, crew: null, type: '', typeOther: '', cause: '', causeOther: '', damage: '', work: '', mats: [], noMats: false, hazards: [], followUp: false, notes: '', seeded: '', at: 0 });

/** Turn a saved report back into the form. */
function fromServer(report) {
  const cl = (report && report.checklist_json && !Array.isArray(report.checklist_json) ? report.checklist_json : {}) || {};
  const f = blankForm();
  const arrival = String(cl.arrival_time || '');
  f.date = (/\d{4}-\d{2}-\d{2}/.exec(arrival) || [''])[0];
  f.start = (/\b\d{2}:\d{2}\b/.exec(arrival) || [''])[0];
  f.finish = String(report.end_time || '').slice(0, 5);
  const hrs = Number(cl.labour_hours) || 0;
  if (f.start && f.finish && hrs > 0) { const span = hmToMinutes(f.finish) - hmToMinutes(f.start); const brk = Math.round(span - hrs * 60); if (brk >= 0 && brk < span) f.breakMin = brk; }
  const count = Number(cl.trade_count) || 0;
  f.crew = count > 1 || (count === 1 && hrs > 0) ? count : null;
  const dd = /^Make-safe type:\s*(.*)\nDamage:\s*([\s\S]*)$/.exec(String(cl.damage_description || ''));
  f.damage = dd ? dd[2] : String(cl.damage_description || '');
  let type = String(cl.job_type || (dd ? dd[1] : '') || '');
  f.typeOther = String(cl.job_type_detail || cl.makesafe_type_detail || '');
  if (/^Other:/i.test(type)) { f.typeOther = f.typeOther || type.replace(/^Other:\s*/i, ''); type = 'Other'; }
  if (type && !TYPES.some((t) => t[0] === type)) { f.typeOther = f.typeOther || type; type = 'Other'; }
  f.type = type;
  let cause = String(cl.damage_cause || '');
  if (/^Other:/i.test(cause)) { f.causeOther = cause.replace(/^Other:\s*/i, ''); cause = 'Other'; } else if (cause && !CAUSES.some((c) => c[0] === cause)) { f.causeOther = cause; cause = 'Other'; }
  f.cause = cause;
  f.work = String(cl.work_done || '');
  const mats = Array.isArray(cl.materials_used) ? cl.materials_used : String(cl.materials_used || '').split(',');
  for (const raw of mats) {
    const text = String(raw || '').trim(); if (!text) continue;
    if (/^none$/i.test(text)) { f.noMats = true; continue; }
    const m = /^(.*?)\s+(?:x|qty)\s*(\d+(?:\.\d+)?)$/i.exec(text);
    f.mats.push(m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: text, qty: null });
  }
  const extra = String(cl.extra_notes || cl.access_issues || cl.invoice_notes || '');
  const lines = extra.split('\n');
  if (lines[0] && lines[0].startsWith(HAZARD_LEAD)) { f.hazards = lines.shift().slice(HAZARD_LEAD.length).replace(/\.$/, '').split(',').map((x) => x.trim()).filter(Boolean); }
  f.notes = lines.join('\n').trim();
  f.followUp = cl.follow_up_required === true;
  return f;
}
/** The exact body submit_makesafe_report takes. */
function reportBody(f, { jobId, userId, cycleId, status }) {
  const hrs = hoursBetween(f.start, f.finish, f.breakMin || 0);
  const detail = f.type === 'Other' ? f.typeOther.trim() : '';
  const shownType = f.type === 'Other' ? 'Other: ' + detail : f.type;
  const notes = f.notes.trim();
  const hazards = f.hazards.length ? HAZARD_LEAD + f.hazards.join(', ') + '.' : '';
  const body = {
    job_id: jobId,
    userId,
    arrival_time: [f.date, f.start].filter(Boolean).join(' '),
    damage_description: f.type || f.damage.trim() ? `Make-safe type: ${shownType}\nDamage: ${f.damage.trim()}` : '',
    job_type: f.type,
    job_type_detail: detail,
    makesafe_type_detail: detail,
    damage_cause: f.cause === 'Other' ? 'Other: ' + f.causeOther.trim() : f.cause,
    work_done: f.work.trim(),
    materials_used: f.noMats ? ['None'] : f.mats.filter((m) => m.name.trim()).map((m) => m.name.trim() + (m.qty ? ' x ' + m.qty : '')),
    labour_hours: isNaN(hrs) ? 0 : hrs,
    access_issues: [hazards, notes].filter(Boolean).join('\n'),
    follow_up_required: Boolean(f.followUp),
    invoice_notes: notes,
    start_time: f.start || '',
    end_time: f.finish || '',
    status
  };
  if (f.crew) body.trade_count = f.crew;
  if (cycleId) body.attendance_cycle_id = cycleId;
  return body;
}
function stillNeeded(f, photoCount) {
  const out = [];
  const t = timesProblem(f);
  if (t) out.push(['sec-visit', t.replace(/^Pick the day$/, 'the day').replace(/^Add a /, 'a ').replace(/^Pick a break$/, 'the break').toLowerCase()]);
  if (!f.crew) out.push(['sec-visit', 'how many on site']);
  if (!f.type || (f.type === 'Other' && !f.typeOther.trim())) out.push(['sec-what', 'the kind of job']);
  if (!f.cause || (f.cause === 'Other' && !f.causeOther.trim())) out.push(['sec-what', 'what caused it']);
  if (!f.damage.trim()) out.push(['sec-what', 'what was damaged']);
  if (!f.work.trim()) out.push(['sec-work', 'what you did']);
  if (!f.noMats && !f.mats.some((m) => m.name.trim())) out.push(['sec-mats', 'materials, or none used']);
  if (photoCount < MIN_PHOTOS) out.push(['sec-photos', `${MIN_PHOTOS - photoCount} more ${MIN_PHOTOS - photoCount === 1 ? 'photo' : 'photos'}`]);
  return out;
}
/** Photos that count for this visit's report, by the office system's own rule. */
function visitPhotos(data, cycleId) {
  const pool = Array.isArray(data.currentCycleMedia) && data.currentCycleMedia.length ? data.currentCycleMedia : data.media || [];
  const counted = pool.filter((m) => !(m.type && m.type !== 'photo') && !['receipt', 'signature', 'voice_note', 'neighbour_signoff', 'quote_builder'].includes(m.phase)
    && (!cycleId || (String(m.attendance_cycle_id) === String(cycleId) && m.cycle_attribution === 'bound')));
  return splitMedia(counted).photos;
}

function ReportForm({ jobId, job, data, ms, user, visit, report, tail }) {
  const cycleId = ms.attendance_cycle_id || '';
  const key = `msr:${jobId}:${cycleId || visit}`;
  const crewRows = (data.crew || []).filter((c) => String(c.status).toLowerCase() !== 'cancelled' && c.role !== 'observer');
  const init = useMemo(() => {
    const saved = local.get(key);
    const serverAt = report ? Date.parse(report.updated_at || report.created_at || '') || 0 : 0;
    if (saved && typeof saved === 'object' && (!report || (saved.at || 0) + 60000 >= serverAt)) return { ...blankForm(), ...saved };
    if (report) return { ...fromServer(report), at: serverAt };
    const f = blankForm();
    const typed = [ms.makesafe_type, ms.damage_type, job.makesafe_type].find((t) => TYPES.some((x) => x[0] === t));
    if (typed) f.type = typed;
    const since = visit > 1 ? ms.last_reattend_at || '9999' : '';
    const clocked = crewRows.filter((c) => c.user_id === user.id && c.clocked_on_at && c.clocked_off_at && String(c.clocked_on_at) > since).sort((a, b) => String(b.clocked_on_at).localeCompare(String(a.clocked_on_at)))[0];
    if (clocked) Object.assign(f, { date: tsToDate(clocked.clocked_on_at), start: roundHM(tsToHM(clocked.clocked_on_at)), finish: roundHM(tsToHM(clocked.clocked_off_at)), breakMin: Number(clocked.break_minutes) || 0, seeded: 'clock' });
    return f;
  }, []);
  const [f, setF] = useState(init);
  const fref = useRef(init);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState(report ? 'server' : local.get(key) ? 'phone' : '');
  const draft = useRef({ timer: 0, flying: false, again: false, off: false });

  const pushDraft = async () => {
    const d = draft.current;
    if (d.off || !navigator.onLine) return;
    if (d.flying) { d.again = true; return; }
    const cur = fref.current;
    if (!(cur.type || cur.damage.trim() || cur.work.trim())) return;
    d.flying = true; setSaveState('saving');
    try {
      await api('submit_makesafe_report', null, reportBody(cur, { jobId, userId: user.id, cycleId, status: 'draft' }));
      if (!d.off) setSaveState('server');
    } catch (err) {
      if (isRefusal(err)) d.off = true; // the office system will not take a draft here; the copy on this phone still stands
      setSaveState('phone');
    }
    d.flying = false;
    if (d.again && !d.off) { d.again = false; pushDraft(); }
  };
  const patch = (change) => {
    const next = { ...fref.current, ...change, at: Date.now() };
    if ('date' in change || 'start' in change || 'finish' in change || 'breakMin' in change) next.seeded = '';
    fref.current = next; local.set(key, next); setF(next); setSaveState('phone');
    clearTimeout(draft.current.timer);
    draft.current.timer = setTimeout(pushDraft, 3000);
  };
  useEffect(() => () => { clearTimeout(draft.current.timer); }, []);

  const photos = visitPhotos(data, cycleId);
  const need = stillNeeded(f, photos.length);
  const hours = hoursBetween(f.start, f.finish, f.breakMin || 0);
  const booked = f.date ? new Set(crewRows.filter((c) => String(c.scheduled_date || '').slice(0, 10) === f.date).map((c) => c.user_id)).size : 0;
  const others = [...new Set(crewRows.filter((c) => c.user_id !== user.id && !['complete', 'completed', 'submitted', 'verified'].includes(String(c.status).toLowerCase())).map((c) => c.name || (c.users && c.users.name) || c.crew_name).filter(Boolean))];

  const addPhotos = async () => {
    const files = await pickPhotos({ multiple: true });
    if (!files.length) return;
    const batch = files.map((file, i) => ({ key: Date.now() + '-' + i, file, preview: URL.createObjectURL(file), state: 'sending' }));
    setPending((p) => [...batch, ...p]);
    let queued = 0; let failed = 0;
    for (const item of batch) {
      try {
        const r = await uploadPhoto(jobId, item.file, { phase: 'completion' });
        if (r.queued) { queued += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'queued' } : x))); } else setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) { failed += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x))); toast(plain(err), { kind: 'bad' }); }
    }
    invalidate('job:' + jobId);
    if (queued) toast(`${queued} ${queued === 1 ? 'photo is' : 'photos are'} saved on your phone and will send when you have signal. The report needs them sent first.`, { ms: 6000 });
    else if (!failed) buzz(10);
  };
  const setMat = (i, change) => patch({ mats: f.mats.map((m, idx) => (idx === i ? { ...m, ...change } : m)) });
  const toggleMat = (name) => patch(f.mats.some((m) => m.name === name) ? { mats: f.mats.filter((m) => m.name !== name) } : { mats: [...f.mats, { name, qty: null }], noMats: false });
  const jump = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const send = async () => {
    if (need.length) return;
    const ok = await ask({ title: 'Send the report?', body: `It goes to the office now. ${others.length ? `Sending the final report takes ${others.join(' and ')} off this visit, so make sure it covers their work too.` : 'If anyone else is booked on this visit, sending the final report takes them off it.'} You can still change it until the office sends it on to the builder.`, yes: 'Send report' });
    if (!ok) return;
    setBusy(true);
    clearTimeout(draft.current.timer); draft.current.off = true;
    try {
      const res = await api('submit_makesafe_report', null, reportBody(fref.current, { jobId, userId: user.id, cycleId, status: 'submitted' }), { timeout: 45000 });
      local.del(key);
      const off = res && res.board_sync && res.board_sync.allocation_override ? (res.board_sync.allocation_override.cancelled || []).length : 0;
      if (res && res.report) mutateQuery('job:' + jobId, (d) => ({ ...d, serviceReport: res.report }));
      invalidate('job:' + jobId); invalidate('myjobs'); invalidate('hours');
      buzz([14, 60, 14, 60, 30]);
      toast(off ? `Report sent. ${off === 1 ? 'The other person' : 'The others'} booked on this visit ${off === 1 ? 'has' : 'have'} been taken off it.` : 'Report sent to the office.', { kind: 'ok', ms: 5000 });
    } catch (err) {
      draft.current.off = false;
      if (/already submitted/i.test(err.message || '')) { local.del(key); invalidate('job:' + jobId); toast('This report has already been sent.', { kind: 'ok' }); } else toast(plain(err) + (isRefusal(err) ? '' : ' Your report is still here. Try again.'), { kind: 'bad', ms: 7000 });
    }
    setBusy(false);
  };

  const quick = QUICK[f.type] || [];
  const customMats = f.mats.map((m, i) => ({ ...m, i })).filter((m) => !MATERIALS.includes(m.name));
  return html`
    <div class="form rise" style="margin-top:20px">
      <section id="sec-visit">
        <h2 class="t-head">The visit</h2>
        ${f.seeded === 'clock' ? html`<div class="note-banner plain"><${Icon} name="clock" size=${18} /><span>Times from your clock on ${fmtDay(f.date)}. Change them if they are not right.</span></div>` : null}
        <${DayPick} label="Day you were there" value=${f.date} onChange=${(v) => patch({ date: v })} />
        <${TimesBlock} value=${f} onChange=${patch} outLabel="Hours each" />
        <${Field} label="How many of you on site" hint=${booked ? `${booked} booked that day.` : ''}>
          <${Counter} label="People on site" value=${f.crew} min=${1} max=${12} blank="Tap plus" onChange=${(v) => patch({ crew: v })} />
        <//>
      </section>

      <section id="sec-what">
        <h2 class="t-head">What happened</h2>
        <${Field} label="What kind of job"><${Picks} value=${f.type} options=${TYPES} onChange=${(v) => patch({ type: v })} /><//>
        ${f.type === 'Other' ? html`<${Field} label="What kind?"><input class="input" value=${f.typeOther} onInput=${(e) => patch({ typeOther: e.currentTarget.value })} /><//>` : null}
        <${Field} label="What caused it"><${Picks} value=${f.cause} options=${CAUSES} onChange=${(v) => patch({ cause: v })} /><//>
        ${f.cause === 'Other' ? html`<${Field} label="What was the cause?"><input class="input" value=${f.causeOther} onInput=${(e) => patch({ causeOther: e.currentTarget.value })} /><//>` : null}
        <${Field} label="What was damaged"><textarea class="input short" value=${f.damage} placeholder="e.g. Tree through the rear fence, three panels down. Patio roof sheet lifted." onInput=${(e) => patch({ damage: e.currentTarget.value })} /><//>
      </section>

      <section id="sec-work">
        <h2 class="t-head">What you did</h2>
        ${quick.length ? html`<div class="picks">${quick.map((line) => html`<button type="button" class="pick" disabled=${f.work.includes(line)} onClick=${() => { buzz(6); patch({ work: (f.work.trim() ? f.work.trim().replace(/[.]?$/, '. ') : '') + line + '.' }); }}><${Icon} name="plus" size=${14} stroke=${2.6} /> ${line}</button>`)}</div>` : null}
        <${Field} label="In your words" hint="A sentence or two. It goes into the report for the builder."><textarea class="input" value=${f.work} placeholder="What you did to make it safe" onInput=${(e) => patch({ work: e.currentTarget.value })} /><//>
      </section>

      <section id="sec-mats">
        <h2 class="t-head">Materials used<small>Tap what you used, then say how many.</small></h2>
        <div class="picks">
          ${MATERIALS.map((name) => html`<button type="button" class="pick" aria-pressed=${String(f.mats.some((m) => m.name === name))} onClick=${() => { buzz(6); toggleMat(name); }}>${name}</button>`)}
          <button type="button" class="pick" onClick=${() => patch({ mats: [...f.mats, { name: '', qty: null, custom: true }], noMats: false })}><${Icon} name="plus" size=${14} stroke=${2.6} /> Something else</button>
          <button type="button" class="pick" aria-pressed=${String(f.noMats)} onClick=${() => { buzz(6); patch(f.noMats ? { noMats: false } : { noMats: true, mats: [] }); }}>None used</button>
        </div>
        ${f.mats.length ? html`<div class="stack tight">
          ${f.mats.map((m, i) => (MATERIALS.includes(m.name) ? html`<div class="matrow" key=${m.name}><b>${m.name}</b>
            <${Counter} label=${'How many ' + m.name} value=${m.qty} min=${1} max=${999} blank="How many" onChange=${(v) => setMat(i, { qty: v })} />
            <${IconButton} name="close" label=${'Remove ' + m.name} size=${18} onClick=${() => patch({ mats: f.mats.filter((_, idx) => idx !== i) })} /></div>` : null))}
          ${customMats.map((m) => html`<div class="matrow" key=${'c' + m.i}><input class="input" value=${m.name} placeholder="What was it?" aria-label="Material" onInput=${(e) => setMat(m.i, { name: e.currentTarget.value })} />
            <${Counter} label="How many" value=${m.qty} min=${1} max=${999} blank="How many" onChange=${(v) => setMat(m.i, { qty: v })} />
            <${IconButton} name="close" label="Remove this material" size=${18} onClick=${() => patch({ mats: f.mats.filter((_, idx) => idx !== m.i) })} /></div>`)}
        </div>` : null}
      </section>

      <section id="sec-safe">
        <h2 class="t-head">Anything still unsafe?<small>Leave it blank if the site is safe.</small></h2>
        <${MultiPicks} value=${f.hazards} options=${HAZARDS} onChange=${(v) => patch({ hazards: v })} />
        <${Toggle} label="This job needs more work" hint="Tick it and the office will follow up." checked=${f.followUp} onChange=${(v) => patch({ followUp: v })} />
        <${Field} label="Anything else the office should know (optional)"><textarea class="input short" value=${f.notes} placeholder="Access, what the customer said, what is needed next" onInput=${(e) => patch({ notes: e.currentTarget.value })} /><//>
      </section>

      <section id="sec-photos">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="t-head">Photos of this visit</h2><span class=${cx('t-num', photos.length >= MIN_PHOTOS ? 't-ok' : 't-mute')}>${photos.length} of ${MIN_PHOTOS}</span></div>
        <${PhotoGrid} photos=${photos} pending=${pending} onAdd=${addPhotos} addLabel="Add photos" />
        <p class="t-small t-mute">At least ${MIN_PHOTOS}: the damage, what you did, and the site as you left it.</p>
      </section>

      ${job.type === 'makesafe' || verticalOf(job, data) === 'makesafe' ? html`<section><${RoofRow} jobId=${jobId} status=${ms.roof_report_draft_status} offer /></section>` : null}
    </div>
    ${tail || null}
    <div class="dock">
      ${need.length ? html`<button type="button" class="need" onClick=${() => jump(need[0][0])}>Still needed: ${need.slice(0, 2).map((n) => n[1]).join(', ')}${need.length > 2 ? ` and ${need.length - 2} more` : ''}</button>`
        : html`<p class="footnote">${isNaN(hours) ? '' : `${fmtHours(hours)} each, ${f.crew} on site, ${photos.length} photos`}</p>`}
      <${Button} block busy=${busy} disabled=${need.length > 0} onClick=${send}>Send report<//>
      ${saveState ? html`<p class="footnote" style="font-weight:520;color:var(--ink-3)">${saveState === 'saving' ? 'Saving your draft' : saveState === 'server' ? 'Draft saved. You can come back to it.' : 'Draft saved on this phone.'}</p>` : null}
    </div>`;
}

// ------------------------------------------------------------- once sent ---
function Submitted({ jobId, job, data, ms, user, visit, report }) {
  const [busy, setBusy] = useState(false);
  const f = useMemo(() => fromServer(report), [report]);
  const cl = (report.checklist_json && !Array.isArray(report.checklist_json) ? report.checklist_json : {}) || {};
  const approved = String(report.status).toLowerCase() === 'approved';
  const canChange = !approved && !ms.report_sent_at;
  const hrs = Number(cl.labour_hours) || 0;
  const mats = f.noMats ? ['None used'] : f.mats.map((m) => m.name + (m.qty ? ` x ${m.qty}` : ''));
  const text = (t) => noPrices(t, user.seesMoney);
  const earlier = (data.serviceReports || []).filter((r) => r && r.id !== report.id && ['submitted', 'approved'].includes(String(r.status).toLowerCase()));

  const change = async () => {
    if (!(await ask({ title: 'Open the report to change it?', body: 'It comes back as a draft. The office does not have it again until you send it again.', yes: 'Open it' }))) return;
    setBusy(true);
    try {
      const res = await api('unlock_makesafe_report', null, { job_id: jobId });
      if (!res || res.ok !== true) throw new ApiError((res && (res.error || res.message)) || 'The report could not be opened.', { status: 409, body: res });
      local.del(`msr:${jobId}:${ms.attendance_cycle_id || visit}`);
      mutateQuery('job:' + jobId, (d) => ({ ...d, serviceReport: { ...d.serviceReport, status: 'draft', submitted_at: null } }));
      invalidate('job:' + jobId); invalidate('myjobs');
      toast(res.already ? 'The report is already open to change.' : 'The report is open. Change it, then send it again.', { ms: 4500 });
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };

  return html`<div class="block stack loose rise" style="margin-top:18px">
    <div class="note-banner ok"><${Icon} name="check" size=${18} stroke=${2.6} /><span><span class="t-strong">${approved ? 'Report approved by the office.' : 'Report sent to the office.'}</span>${report.submitted_at ? ` ${fmtTs(report.submitted_at)}.` : ''}${ms.report_sent_at ? ' It has gone to the builder.' : ''}</span></div>

    <section class="sumlist">
      <div><span class="t-label">The visit</span><p>${[f.date ? fmtDay(f.date) : '', f.start ? fmtTime(f.start) + (f.finish ? ' to ' + fmtTime(f.finish) : '') : ''].filter(Boolean).join(', ') || 'No time given'}</p>
        <p class="t-small">${hrs ? `${fmtHours(hrs)} each` : ''}${cl.trade_count ? `${hrs ? ', ' : ''}${cl.trade_count} on site` : ''}</p></div>
      ${f.type ? html`<div><span class="t-label">Kind of job</span><p>${f.type === 'Other' ? text(f.typeOther) : labelOf(TYPES, f.type)}${f.cause ? `. Cause: ${f.cause === 'Other' ? text(f.causeOther) : labelOf(CAUSES, f.cause).toLowerCase()}` : ''}</p></div>` : null}
      ${f.damage ? html`<div><span class="t-label">What was damaged</span><p class="prose">${text(f.damage)}</p></div>` : null}
      ${f.work ? html`<div><span class="t-label">What was done</span><p class="prose">${text(f.work)}</p></div>` : null}
      ${mats.length ? html`<div><span class="t-label">Materials</span><ul>${mats.map((m) => html`<li>${text(m)}</li>`)}</ul></div>` : null}
      ${f.hazards.length ? html`<div><span class="t-label">Still unsafe</span><p>${f.hazards.join(', ')}</p></div>` : null}
      ${f.followUp ? html`<div><span class="t-label">More work needed</span><p>Yes. The office will follow up.</p></div>` : null}
      ${f.notes ? html`<div><span class="t-label">Notes</span><p class="prose">${text(f.notes)}</p></div>` : null}
    </section>

    <div class="stack tight">
      ${canChange ? html`<${Button} kind="line" block icon="note" busy=${busy} onClick=${change}>Change the report<//>` : html`<p class="t-small t-mute">${approved ? 'The office has approved it, so it can no longer be changed here.' : 'The office has sent it to the builder, so it can no longer be changed here.'} Call the office if something is wrong.</p>`}
      <${Button} kind="soft" block icon="refresh" onClick=${() => openReattend(jobId, job, visit)}>Went back again? Start a new visit<//>
    </div>

    <${HoursCard} jobId=${jobId} crew=${data.crew} userId=${user.id} seed=${f.start && f.finish ? { date: f.date, start: f.start, finish: f.finish, breakMin: f.breakMin, from: 'Times from your report' } : null} />

    ${verticalOf(job, data) === 'makesafe' ? html`<${RoofRow} jobId=${jobId} status=${ms.roof_report_draft_status} offer />` : null}

    ${earlier.length ? html`<section><h2 class="t-head" style="margin-bottom:8px">Earlier visits</h2><div class="stack tight">${earlier.map((r) => { const c = (r.checklist_json && !Array.isArray(r.checklist_json) ? r.checklist_json : {}) || {}; return html`<div class="inset" key=${r.id}>
      <span class="t-label">${r.cycle_number ? `Visit ${r.cycle_number}` : 'Earlier visit'}${r.submitted_at ? ` · sent ${fmtDay(tsToDate(r.submitted_at))}` : ''}</span>
      <p class="prose" style="margin-top:4px">${text(c.work_done || r.notes || 'No details kept.')}</p></div>`; })}</div></section>` : null}
  </div>`;
}

function openReattend(jobId, job, visit) { openOverlay((close) => html`<${ReattendSheet} jobId=${jobId} job=${job} visit=${visit} onClose=${close} />`); }
function ReattendSheet({ jobId, job, visit, onClose }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const start = async (shut) => {
    setBusy(true);
    try {
      const res = await api('reattend_makesafe', null, { job_id: jobId, reason: reason.trim() });
      const n = Number(res && res.cycle_number) || (Number(res && res.reattend_count) || visit) + 1;
      invalidate('job:' + jobId); invalidate('myjobs');
      buzz([12, 40, 20]);
      toast(`Visit ${n} started. Write a new report for this visit, with its own photos.`, { kind: 'ok', ms: 5500 });
      shut();
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };
  return html`<${Sheet} title="Went back again?" sub=${`${jobTitle(job)}. This starts a new visit with its own report and photos. The one you already sent stays as it is.`} onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${reason.trim().length < 3} onClick=${() => start(shut)}>Start a new visit<//>`}>
    <${Field} label="Why did you go back?"><textarea class="input" value=${reason} placeholder="e.g. Tarp came loose in last night's wind" onInput=${(e) => setReason(e.currentTarget.value)} /><//>
  <//>`;
}

/** The way to our own roof report, on SecureWorks letterhead. */
function RoofRow({ jobId, status, offer }) {
  const s = String(status || '').toLowerCase();
  return html`<button type="button" class="linkrow" onClick=${() => go(`/job/${jobId}/roof`)}>
    <span class="ico"><${Icon} name="file" size=${20} /></span>
    <span style="min-width:0"><b>${s === 'submitted' ? 'Roof report sent' : s === 'draft' ? 'Carry on with the roof report' : offer ? 'Need a roof report too?' : 'Write the roof report here'}</b><span>${s === 'submitted' ? 'Open it, or rebuild it with new photos' : 'On SecureWorks letterhead, written here'}</span></span>
    ${s === 'submitted' ? html`<${Icon} name="check" size=${20} class="t-ok" />` : html`<${Icon} name="right" size=${18} class="t-mute" />`}
  </button>`;
}

// --------------------------------------- reports done on the builder's site -
function portalIsDone(ms, jobId) {
  const cycle = Number(ms.cycle_number == null ? 1 : ms.cycle_number);
  if (ms.portal_verified_at && Number(ms.portal_verified_cycle) === cycle) return 'recorded';
  const id = ms.attendance_cycle_id;
  if (id && (ms.portal_captures || []).some((c) => c && String(c.attendance_cycle_id) === String(id) && c.capture_result === 'done' && c.status === 'verified' && (c.screenshot_object_key || c.attested_producer))) return 'recorded';
  const mark = local.get('builder-report-done:' + jobId);
  return mark && String(mark.visit) === String(id || cycle) ? (mark.told ? 'told' : 'recorded') : '';
}
function BuilderReport({ jobId, job, data, ms, user, handoff, family }) {
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const links = useMemo(() => portalLinks(ms, job.metadata, user.seesMoney), [data]);
  const roofStatus = String(ms.roof_report_draft_status || '').toLowerCase();
  const ours = handoff === 'own_template';
  const done = portalIsDone(ms, jobId);
  const what = family === 'assessment_report_quote' ? 'report' : 'roof report';

  const tellOffice = async (text, okWords) => {
    const body = noteBody(jobId, text, user);
    try { await api('add_note', null, body); } catch (err) {
      if (isRefusal(err)) throw err;
      queueWrite({ action: 'add_note', body, jobId, label: 'Note on ' + jobTitle(job) });
    }
    invalidate('job:' + jobId);
    if (okWords) toast(okWords, { kind: 'ok', ms: 4500 });
  };
  const markDone = async () => {
    if (!(await ask({ title: `Is the ${what} done on the builder's website?`, body: 'Only say yes once you have filled it in and sent it there. The office takes it from here.', yes: 'Yes, it is done' }))) return;
    setBusy(true);
    const visitKey = ms.attendance_cycle_id || Number(ms.cycle_number == null ? 1 : ms.cycle_number);
    const remember = (told) => { local.set('builder-report-done:' + jobId, { visit: visitKey, told, at: Date.now() }); invalidate('job:' + jobId); invalidate('myjobs'); bump((n) => n + 1); buzz([12, 40, 20]); };
    try {
      let res = null; let viaOffice = false;
      if (!user.office && family === 'roof_report') {
        // The crew's own tick: one question, answered by someone booked on the job.
        try { res = await api('confirm_roof_report_done', null, { job_id: jobId }); } catch (err) {
          if (!isRefusal(err) || err.status === 403 || err.status === 404) throw err;
          viaOffice = true; // this job cannot take the tick; the office marks it instead
        }
      } else {
        try { res = await api('mark_makesafe_portal_report_done', null, { job_id: jobId }); } catch (err) {
          if (user.office || !(err instanceof ApiError) || err.status !== 403) throw err;
          viaOffice = true; // marking it is an office action; tell them it is done
        }
      }
      if (viaOffice) {
        await tellOffice(`${user.name} says the ${what} is done on the builder's website. Please mark it off.`);
        remember(true);
        toast('The office has been told it is done.', { kind: 'ok', ms: 4500 });
      } else {
        if (!res || !(res.ok === true || res.success === true)) throw new ApiError((res && (res.error || res.message)) || 'That did not save.', { status: 409, body: res });
        const already = res.already || res.already_done || res.already_confirmed || res.deduped || res.idempotent || res.mode === 'idempotent';
        remember(false);
        toast(already ? 'It was already marked as done.' : 'Marked as done. The office takes it from here.', { kind: 'ok', ms: 4500 });
      }
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };

  if (ours || roofStatus === 'submitted') {
    return html`<div class="block stack loose rise" style="margin-top:18px">
      ${roofStatus === 'submitted' ? html`<div class="note-banner ok"><${Icon} name="check" size=${18} stroke=${2.6} /><span><span class="t-strong">Roof report sent.</span> The office has it.</span></div>`
        : html`<p style="color:var(--ink-2)">This ${what} is written here in the app, on SecureWorks letterhead. It takes about ten minutes on site.</p>`}
      <${RoofRow} jobId=${jobId} status=${roofStatus} />
      ${roofStatus === 'submitted' ? html`<${HoursCard} jobId=${jobId} crew=${data.crew} userId=${user.id} title="Your hours for this report" />` : null}
      ${links.main ? html`<section><h2 class="t-head" style="margin-bottom:4px">From the builder</h2><${LinkList} links=${[{ url: links.main, label: links.mainLabel || "The builder's website" }, ...links.others]} /></section>` : null}
    </div>`;
  }
  if (done) {
    return html`<div class="block stack loose rise" style="margin-top:18px">
      <div class="note-banner ok"><${Icon} name="check" size=${18} stroke=${2.6} /><span><span class="t-strong">${done === 'told' ? 'The office has been told it is done.' : 'Marked as done.'}</span> Nothing more to do on the ${what}.</span></div>
      <${HoursCard} jobId=${jobId} crew=${data.crew} userId=${user.id} title="Your hours for this report" />
      ${links.main ? html`<section><h2 class="t-head" style="margin-bottom:4px">From the builder</h2><${LinkList} links=${[{ url: links.main, label: links.mainLabel || "The builder's website" }, ...links.others]} /></section>` : null}
    </div>`;
  }
  return html`<div class="block stack loose rise" style="margin-top:18px">
    <p style="color:var(--ink-2)">${handoff === 'unknown'
      ? `The office has not said yet where this ${what} is written. Write it here, or call the office if the builder wants it on their own website.`
      : `This ${what} is filled in on the builder's website. Do it there, then come back and tell us it is done.`}</p>
    ${links.main ? html`<div class="stack tight">
      <a class="btn primary block" href=${links.main} target="_blank" rel="noopener noreferrer"><${Icon} name="external" size=${20} />Open the builder's website</a>
      <p class="t-small t-mute" style="text-align:center">${hostOf(links.main)}</p>
      ${links.others.length ? html`<${LinkList} links=${links.others} />` : null}
      <div class="note-banner plain"><${Icon} name="info" size=${18} /><span>If the page says the link has expired, the job is an older one and the app is not at fault. <button type="button" class="t-strong" style="text-decoration:underline" onClick=${() => tellOffice("The builder's link on this job has expired. Please ask the builder for a new one.", 'The office has been asked for a new link.').catch((err) => toast(plain(err), { kind: 'bad' }))}>Ask the office for a new link</button></span></div>
    </div>` : handoff === 'unknown' ? null : html`<div class="note-banner"><${Icon} name="alert" size=${18} /><span>There is no link to the builder's website on this job. Use the link in the builder's work order or email, or <button type="button" class="t-strong" style="text-decoration:underline" onClick=${() => tellOffice("There is no link to the builder's website on this job. Please add it.", 'The office has been asked for the link.').catch((err) => toast(plain(err), { kind: 'bad' }))}>ask the office for it</button>.</span></div>`}
    <div class="stack tight">
      ${handoff === 'unknown' ? html`<${Button} block icon="file" onClick=${() => go(`/job/${jobId}/roof`)}>${roofStatus === 'draft' ? 'Carry on with the roof report' : 'Write the roof report here'}<//>`
        : html`<${Button} kind=${links.main ? 'ink' : 'primary'} block icon="check" busy=${busy} onClick=${markDone}>I have done the builder's report<//>`}
      ${handoff === 'unknown' || family === 'assessment_report_quote' ? null : html`<${RoofRow} jobId=${jobId} status=${roofStatus} />`}
    </div>
  </div>`;
}
function LinkList({ links }) {
  return html`<div>${links.map((l) => html`<a class="linkrow" key=${l.url} href=${l.url} target="_blank" rel="noopener noreferrer"><span class="ico"><${Icon} name="external" size=${20} /></span><span style="min-width:0"><b>${l.label}</b><span>${hostOf(l.url)}</span></span><${Icon} name="right" size=${18} class="t-mute" /></a>`)}</div>`;
}

// --------------------------------------------------------------- managers --
function ManagerBox({ jobId, job, user }) {
  const [busy, setBusy] = useState(false);
  const cancelled = String(job.status).toLowerCase() === 'cancelled';
  const reopen = async () => {
    if (!(await ask({ title: 'Put this job back on the board?', body: 'It goes back to new, ready to be given to a trade.', yes: 'Reopen the job' }))) return;
    setBusy(true);
    try {
      const res = await api('reopen_makesafe', null, { job_id: jobId, reason: 'reopen after cancel' });
      if (res && res.ok === false) throw new ApiError(res.error || 'Could not reopen', { status: 409, body: res });
      invalidate('job:' + jobId); invalidate('myjobs'); invalidate('board'); invalidate('search');
      toast('Job reopened. It is back in new.', { kind: 'ok' });
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };
  return html`<section class="managerbox">
    <span class="t-label">Manager</span>
    ${cancelled ? html`<${Button} kind="line" block busy=${busy} onClick=${reopen}>Reopen this job<//>`
      : html`<${Button} kind="danger" block onClick=${() => openOverlay((close) => html`<${CancelSheet} jobId=${jobId} job=${job} user=${user} onClose=${close} />`)}>Cancel this job<//>`}
  </section>`;
}
function CancelSheet({ jobId, job, user, onClose }) {
  const [code, setCode] = useState(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const cancel = async (shut) => {
    if (!(await ask({ title: `${user.name}, cancel ${jobTitle(job)}?`, body: 'It comes off the board and everyone booked on it is taken off. Your name goes on the cancellation.', yes: 'Yes, cancel the job', no: 'Keep the job', danger: true }))) return;
    setBusy(true);
    try {
      const res = await api('cancel_makesafe', null, { job_id: jobId, reason_code: code, note: note.trim() });
      if (res && res.ok === false) throw new ApiError(res.error || 'Could not cancel', { status: 409, code: res.code, body: res });
      invalidate('job:' + jobId); invalidate('myjobs'); invalidate('board'); invalidate('search');
      toast('Job cancelled.', { kind: 'ok' });
      shut();
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };
  return html`<${Sheet} title="Cancel this job" sub=${[jobTitle(job), job.job_number].filter(Boolean).join(' · ')} onClose=${onClose}
    foot=${(shut) => html`<${Button} kind="ink" block busy=${busy} disabled=${!code || note.trim().length < 3} onClick=${() => cancel(shut)}>Cancel the job<//>`}>
    <div class="stack">
      <${Field} label="Why?"><${Picks} value=${code} options=${CANCEL_REASONS} onChange=${setCode} /><//>
      <${Field} label="What happened"><textarea class="input" value=${note} placeholder="A line for the record" onInput=${(e) => setNote(e.currentTarget.value)} /><//>
    </div>
  <//>`;
}
