// Our own roof report, on SecureWorks letterhead. The office system sends the
// form (sections and fields); this screen draws whatever it sends, one section
// at a time, saves as you go and hands back the finished PDF.
// What is typed here goes onto the report word for word. No prices are shown.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, ApiError } from '../lib/api.js';
import { useQuery, useStore, local, invalidate } from '../lib/store.js';
import { useJob } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, fmtTs, fmtDay, fmtTime } from '../lib/dates.js';
import { jobTitle, splitMedia } from '../lib/model.js';
import { uploadPhoto, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Skel, Empty, LoadError, PhotoGrid, Field, Picks, toast, ask, buzz } from '../ui/kit.js';
import { plain, isRefusal, StepBar, StepHead, HoursCard } from '../ui/report-kit.js';

const docUrl = (d) => [d.pdf_url, d.public_url, d.signed_url, d.download_url, d.url, d.file_url, d.storage_url].find((u) => typeof u === 'string' && /^https?:/.test(u));
const blankValue = (v) => v == null || (typeof v === 'string' && v.trim() === '');

export function RoofReport({ jobId }) {
  const user = useStore((s) => s.user);
  const q = useQuery('roof:' + jobId, () => api('roof_report_template', { job_id: jobId }), { ttl: 20000 });
  const jobQ = useJob(jobId);
  const toBack = () => back(`/job/${jobId}/report`);

  if (q.loading) return html`<${Page} title="Roof report" onBack=${toBack}><div class="page-pad" style="display:grid;gap:14px"><${Skel} h=${4} r=${4} /><${Skel} w="55%" h=${30} style="margin-top:14px" /><${Skel} w="85%" /><${Skel} h=${64} r=${14} style="margin-top:8px" /><${Skel} h=${64} r=${14} /><${Skel} h=${64} r=${14} /></div><//>`;
  if (!q.data || !q.data.template) {
    const refused = q.error && isRefusal(q.error);
    return html`<${Page} title="Roof report" onBack=${toBack}>${refused
      ? html`<${Empty} title="No roof report on this job" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>${plain(q.error)}<//>`
      : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="the roof report" />`}<//>`;
  }
  return html`<${RoofFlow} key=${jobId} jobId=${jobId} template=${q.data.template} draft=${q.data.draft || null} jobData=${jobQ.data || null} refetchJob=${jobQ.refetch} user=${user} />`;
}

/** What goes to the office system: blanks left out, unless they wipe something already saved. */
function collect(fields, values, savedBefore) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'photos') continue;
    const v = values[f.key];
    if (f.type === 'toggle') { if (v === true || v === false) out[f.key] = v; else if (savedBefore && (savedBefore[f.key] === true || savedBefore[f.key] === false)) out[f.key] = null; continue; }
    const text = v == null ? '' : String(v).trim();
    if (text) out[f.key] = text; else if (savedBefore && !blankValue(savedBefore[f.key])) out[f.key] = '';
  }
  return out;
}

function RoofFlow({ jobId, template, draft, jobData, refetchJob, user }) {
  const key = 'roof:' + jobId;
  const fields = useMemo(() => (template.fields || []).filter((f) => f && f.key), [template]);
  const steps = useMemo(() => {
    const known = (template.sections || []).map((s) => ({ ...s, fields: fields.filter((f) => f.section === s.key) }));
    const loose = fields.filter((f) => !(template.sections || []).some((s) => s.key === f.section));
    const all = known.filter((s) => s.fields.length);
    if (loose.length) all.push({ key: '_more', title: 'More', fields: loose });
    return all;
  }, [template]);
  const init = useMemo(() => {
    const saved = local.get(key);
    const serverAt = draft ? Date.parse(draft.updated_at || '') || 0 : 0;
    const base = saved && saved.values && (!draft || (saved.at || 0) + 60000 >= serverAt) ? saved : { values: { ...((draft && draft.fields_json) || {}) }, step: 0, at: serverAt };
    const values = { ...base.values };
    // The two things the app already knows. Everything else stays blank until it is given.
    if (fields.some((f) => f.key === 'inspection_date') && blankValue(values.inspection_date)) values.inspection_date = todayISO();
    if (fields.some((f) => f.key === 'inspected_by') && blankValue(values.inspected_by)) values.inspected_by = user.name || '';
    return { values, step: Math.min(Math.max(0, base.step || 0), Math.max(0, steps.length - 1)) };
  }, []);
  const [values, setValues] = useState(init.values);
  const [step, setStepState] = useState(init.step);
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState(draft ? 'saved' : '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(draft && draft.status === 'submitted' ? { fresh: false } : null);
  const [pending, setPending] = useState([]);
  const ref = useRef({ values: init.values, step: init.step, timer: 0, flying: false, again: false, saved: (draft && draft.fields_json) || null });

  const save = async () => {
    const r = ref.current;
    if (r.flying) { r.again = true; return; }
    r.flying = true; setSaveState('saving');
    try {
      const sentValues = { ...r.values };
      const res = await api('save_roof_report', null, { job_id: jobId, fields: collect(fields, sentValues, r.saved) });
      r.saved = sentValues;
      if (res && res.already_submitted) setDone({ fresh: false }); else setSaveState('saved');
    } catch (err) { setSaveState(err.offline || !isRefusal(err) ? 'phone' : 'failed'); r.lastError = err; }
    r.flying = false;
    if (r.again) { r.again = false; save(); }
  };
  const keep = () => local.set(key, { values: ref.current.values, step: ref.current.step, at: Date.now() });
  const change = (k, v) => {
    const next = { ...ref.current.values, [k]: v };
    ref.current.values = next; setValues(next); keep();
    clearTimeout(ref.current.timer);
    ref.current.timer = setTimeout(save, 1200);
  };
  const setStep = (n) => { ref.current.step = n; setStepState(n); keep(); setShowErrors(false); const page = document.querySelector('.page'); if (page) page.scrollTop = 0; };
  useEffect(() => () => { clearTimeout(ref.current.timer); }, []);

  const photos = useMemo(() => splitMedia(jobData && jobData.media).photos, [jobData]);
  const addPhotos = async () => {
    const files = await pickPhotos({ multiple: true });
    if (!files.length) return;
    const batch = files.map((file, i) => ({ key: Date.now() + '-' + i, file, preview: URL.createObjectURL(file), state: 'sending' }));
    setPending((p) => [...batch, ...p]);
    let queued = 0;
    for (const item of batch) {
      try {
        const r = await uploadPhoto(jobId, item.file, { phase: 'completion', label: 'Roof report photo' });
        if (r.queued) { queued += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'queued' } : x))); } else setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) { setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x))); toast(plain(err), { kind: 'bad' }); }
    }
    invalidate('job:' + jobId);
    if (queued) toast(`${queued} ${queued === 1 ? 'photo is' : 'photos are'} saved on your phone and will send when you have signal.`, { ms: 5000 });
    else buzz(10);
  };

  const missing = (list) => list.filter((f) => f.required && f.type !== 'photos' && blankValue(values[f.key]) && values[f.key] !== false);
  const send = async () => {
    const gaps = missing(fields);
    if (gaps.length) {
      const at = steps.findIndex((s) => s.fields.some((f) => f.key === gaps[0].key));
      if (at >= 0 && at !== step) setStep(at);
      setShowErrors(true);
      toast(gaps.length === 1 ? `${gaps[0].label} is needed.` : `${gaps.length} things are still needed: ${gaps.slice(0, 2).map((g) => g.label.toLowerCase()).join(', ')}${gaps.length > 2 ? ' and more' : ''}.`, { kind: 'bad', ms: 5000 });
      return;
    }
    if (!(await ask({ title: 'Send the roof report?', body: `It is made into a PDF on SecureWorks letterhead with the ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'} on this job. Exactly what you typed goes onto it.`, yes: 'Send roof report' }))) return;
    setBusy(true);
    clearTimeout(ref.current.timer);
    try {
      const res = await api('submit_roof_report', null, { job_id: jobId, fields: collect(fields, ref.current.values, ref.current.saved) }, { timeout: 60000 });
      if (!res || !(res.ok === true || res.success === true || res.status === 'submitted' || res.saved === true)) throw new ApiError((res && (res.error || res.message)) || 'The roof report was not saved.', { status: 409, body: res });
      local.del(key);
      invalidate('job:' + jobId); invalidate('roof:' + jobId); invalidate('myjobs');
      buzz([14, 60, 14, 60, 30]);
      setDone({ fresh: true, docId: res.report_doc_id || null });
    } catch (err) { toast(plain(err) + (isRefusal(err) ? '' : ' Your report is still here. Try again.'), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };

  if (done) return html`<${RoofDone} jobId=${jobId} fresh=${done.fresh} draft=${draft} values=${values} steps=${steps} jobData=${jobData} refetchJob=${refetchJob} photos=${photos} pending=${pending} addPhotos=${addPhotos} user=${user} />`;
  if (!steps.length) return html`<${Page} title="Roof report" onBack=${() => back(`/job/${jobId}/report`)}><${Empty} title="The roof report form did not load">Go back and open it again. If it keeps happening, tell the office.<//><//>`;

  const cur = steps[step];
  const last = step === steps.length - 1;
  const gapsHere = showErrors ? missing(cur.fields).map((f) => f.key) : [];
  const next = () => { if (missing(cur.fields).length) { setShowErrors(true); buzz([20, 60, 20]); return; } setStep(step + 1); };
  const place = jobData && jobData.job ? jobTitle(jobData.job) : 'Roof report';
  const stateWord = saveState === 'saving' ? 'Saving' : saveState === 'saved' ? 'Saved' : saveState === 'phone' ? 'Saved on this phone' : saveState === 'failed' ? 'Not saved' : '';

  return html`<${Page} class="steppage" title="Roof report" onBack=${() => (step > 0 ? setStep(step - 1) : back(`/job/${jobId}/report`))}
      right=${stateWord ? html`<span class=${cx('savestate', saveState === 'failed' && 'bad')}>${saveState === 'saved' ? html`<${Icon} name="check" size=${14} stroke=${2.6} />` : null}${stateWord}</span>` : null}>
    <${StepBar} index=${step} total=${steps.length} />
    <div class="rise" key=${cur.key}>
      <${StepHead} kicker=${`${place} · roof report`} title=${cur.title}>${step === 0 ? 'Word for word: exactly what you type here goes onto the report the builder receives.' : null}<//>
      ${saveState === 'failed' && ref.current.lastError ? html`<div class="block note-banner bad" style="margin-bottom:14px"><${Icon} name="alert" size=${18} /><span>${plain(ref.current.lastError)}</span></div>` : null}
      <div class="block stack">
        ${cur.fields.map((f) => html`<${RoofField} key=${f.key} field=${f} value=${values[f.key]} bad=${gapsHere.includes(f.key)} seesMoney=${user.seesMoney} onChange=${(v) => change(f.key, v)}
          photos=${photos} pending=${pending} addPhotos=${addPhotos} />`)}
      </div>
      <div class="stepfoot">
        ${last ? html`<${Button} block busy=${busy} onClick=${send}>Send roof report<//>` : html`<${Button} block onClick=${next}>Continue<//>`}
      </div>
    </div>
  <//>`;
}

function helpFor(field, seesMoney) {
  const text = field.help || '';
  if (!text) return '';
  if (!seesMoney && /\$|\bfee\b|\bprice|inc\.? ?gst|ex\.? ?gst/i.test(text)) return '';
  return text;
}
function RoofField({ field, value, bad, seesMoney, onChange, photos, pending, addPhotos }) {
  const help = helpFor(field, seesMoney);
  const error = bad ? 'Needed for the report' : '';
  const label = field.label || field.key;
  if (field.type === 'photos') {
    return html`<div class="stack tight">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="t-label">${label}</span><span class="t-num t-mute">${photos.length}</span></div>
      <${PhotoGrid} photos=${photos} pending=${pending} onAdd=${addPhotos} addLabel="Add photos" />
      <p class="t-small t-mute">${photos.length ? `The ${photos.length === 1 ? 'photo' : `${photos.length} photos`} already on this job ${photos.length === 1 ? 'goes' : 'go'} into the report. Add more if the roof needs them.` : 'Photos on this job go into the report. Add the roof photos here.'}</p>
    </div>`;
  }
  if (field.type === 'toggle') {
    return html`<${Field} label=${label} error=${error} hint=${help}><div class="yn" role="group" aria-label=${label}>
      <button type="button" aria-pressed=${String(value === true)} onClick=${() => { buzz(6); onChange(value === true ? null : true); }}>Yes</button>
      <button type="button" aria-pressed=${String(value === false)} onClick=${() => { buzz(6); onChange(value === false ? null : false); }}>No</button>
    </div><//>`;
  }
  if (field.type === 'select') {
    const options = Array.isArray(field.options) ? field.options : [];
    if (options.length <= 6) return html`<${Field} label=${label} error=${error} hint=${help}><${Picks} value=${value || null} options=${options.map((o) => [o, o])} onChange=${(v) => onChange(v === value ? '' : v)} /><//>`;
    return html`<${Field} label=${label} error=${error} hint=${help}><select class=${cx('input', bad && 'bad')} value=${value || ''} onChange=${(e) => onChange(e.currentTarget.value)}><option value="">Choose</option>${options.map((o) => html`<option value=${o}>${o}</option>`)}</select><//>`;
  }
  if (field.type === 'textarea') return html`<${Field} label=${label} error=${error} hint=${help}><textarea class=${cx('input', bad && 'bad')} value=${value || ''} placeholder=${field.placeholder || ''} onInput=${(e) => onChange(e.currentTarget.value)} /><//>`;
  if (field.type === 'date') return html`<${Field} label=${label} error=${error} hint=${help}><input class=${cx('input', bad && 'bad')} type="date" max=${todayISO()} value=${value || ''} onInput=${(e) => onChange(e.currentTarget.value)} /><//>`;
  if (field.type === 'time') return html`<${Field} label=${label} error=${error} hint=${help}><input class=${cx('input', bad && 'bad')} type="time" step="300" value=${value || ''} onInput=${(e) => onChange(e.currentTarget.value)} /><//>`;
  return html`<${Field} label=${label} error=${error} hint=${help}><input class=${cx('input', bad && 'bad')} value=${value || ''} placeholder=${field.placeholder || ''} onInput=${(e) => onChange(e.currentTarget.value)} /><//>`;
}

function shown(field, v) {
  if (field.type === 'toggle') return v === true ? 'Yes' : v === false ? 'No' : '';
  if (blankValue(v)) return '';
  if (field.type === 'date') return fmtDay(String(v));
  if (field.type === 'time') return fmtTime(String(v));
  return String(v);
}
function RoofDone({ jobId, fresh, draft, values, steps, jobData, refetchJob, photos, pending, addPhotos, user }) {
  const [busy, setBusy] = useState(false);
  const docs = ((jobData && jobData.documents) || []).filter((d) => d.type === 'roof_report' && docUrl(d));
  const pdf = docs.length ? docUrl(docs[docs.length - 1]) : '';
  useEffect(() => { if (fresh && !pdf) { const id = setTimeout(() => refetchJob && refetchJob(), 1500); return () => clearTimeout(id); } return undefined; }, [fresh, pdf]);

  const rebuild = async () => {
    setBusy(true);
    try {
      const res = await api('submit_roof_report', null, { job_id: jobId, force_render: true }, { timeout: 60000 });
      if (!res || res.ok !== true) throw new ApiError((res && (res.error || res.message)) || 'The report was not rebuilt.', { status: 409, body: res });
      invalidate('job:' + jobId);
      toast(res.photo_count != null ? `Report rebuilt with ${res.photo_count} ${Number(res.photo_count) === 1 ? 'photo' : 'photos'}.` : 'Report rebuilt.', { kind: 'ok', ms: 4500 });
    } catch (err) { toast(plain(err), { kind: 'bad', ms: 7000 }); }
    setBusy(false);
  };

  return html`<${Page} title="Roof report" onBack=${() => back(`/job/${jobId}/report`)}>
    <div class="page-pad stack loose rise" style="padding-top:8px">
      ${fresh ? html`<div class="done-mark"><${Icon} name="check" size=${44} stroke=${3} /></div>` : null}
      <div><h1 class=${fresh ? 't-display' : 't-title'} style=${fresh ? '' : 'font-size:30px'}>Roof report sent</h1>
        <p style="margin-top:8px;color:var(--ink-2)">${fresh ? 'It is on SecureWorks letterhead and with the office now.' : `The office has it${draft && draft.submitted_at ? `, sent ${fmtTs(draft.submitted_at).toLowerCase()}` : ''}.`}</p></div>
      <div class="stack tight">
        ${pdf ? html`<a class="btn primary block" href=${pdf} target="_blank" rel="noopener noreferrer"><${Icon} name="file" size=${20} />Open the roof report</a>`
          : html`<div class="note-banner plain"><${Icon} name="clock" size=${18} /><span>The PDF is being put together. It shows here and under Files on the job in a moment.</span></div>`}
      </div>
      <section class="stack tight">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><h2 class="t-head">Photos on this job</h2><span class="t-num t-mute">${photos.length}</span></div>
        <${PhotoGrid} photos=${photos} pending=${pending} onAdd=${addPhotos} addLabel="Add photos" max=${8} />
        <${Button} kind="line" block icon="refresh" busy=${busy} onClick=${rebuild}>Rebuild the report with these ${photos.length || ''} photos<//>
        <p class="t-small t-mute">Added photos after sending? Rebuild puts them into the PDF. The words stay as you sent them.</p>
      </section>
      <${HoursCard} jobId=${jobId} crew=${jobData && jobData.crew} userId=${user.id} title="Your hours for this report" />
      <section class="sumlist">
        ${steps.map((s) => { const rows = s.fields.filter((f) => f.type !== 'photos').map((f) => [f, shown(f, values[f.key])]).filter(([, v]) => v); return rows.length ? html`<div key=${s.key}><h2 class="t-head" style="margin-bottom:8px">${s.title}</h2>
          <div class="stack tight">${rows.map(([f, v]) => html`<div><span class="t-label">${f.label}</span><p class="prose">${v}</p></div>`)}</div></div>` : null; })}
      </section>
      <${Button} kind="quiet" block onClick=${() => go('/job/' + jobId, { replace: true })}>Back to the job<//>
    </div>
  <//>`;
}
