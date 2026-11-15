// The service report for jobs that are not make safes: a completion checklist
// for the kind of job, the weather and times, notes, photos and the customer's
// signature. It saves as you go, on this phone and as a draft with the office,
// and once sent it is read-only.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore, local, invalidate, primeQuery } from '../lib/store.js';
import { useJob, jobStub } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { fmtTs, fmtTime } from '../lib/dates.js';
import { verticalOf, isReportJob, jobTitle, jobAddress, splitMedia, noPrices } from '../lib/model.js';
import { uploadPhoto, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Section, JobLine, Badge, Button, Skel, Empty, LoadError, PhotoGrid, Field, Picks, TimeInput, toast, ask, buzz } from '../ui/kit.js';
import { plain, isRefusal, stash, SignaturePad, CheckRow } from '../ui/report-kit.js';

const WEATHER = [['sunny', 'Sunny'], ['overcast', 'Overcast'], ['rain', 'Rain'], ['hot', 'Hot'], ['windy', 'Windy']];
const blank = () => ({ ticks: {}, weather: '', start: '', finish: '', notes: '', variations: '', name: '', at: 0 });
const toDataUrl = (blob) => new Promise((resolve) => { if (!blob) { resolve(null); return; } const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
const opsBase = () => (window.CREW_CONFIG || {}).supabaseUrl + '/functions/v1/ops-api';

export function ServiceReport({ jobId }) {
  const user = useStore((s) => s.user);
  const q = useQuery('service:' + jobId, () => api('get_service_report', { jobId }), { ttl: 20000 });
  const jobQ = useJob(jobId);
  const job = (jobQ.data && jobQ.data.job) || (q.data && q.data.job) || jobStub(jobId);
  const toJob = () => back('/job/' + jobId);
  const vertical = job ? verticalOf(job, jobQ.data || {}) : 'other';

  if (job && isReportJob(vertical)) {
    return html`<${Page} title="Service report" back="Job" onBack=${toJob}><${Empty} title="This job uses the make safe report" action=${html`<${Button} kind="line" small onClick=${() => go(`/job/${jobId}/report`, { replace: true })}>Open the report<//>`}>A service report is for fencing, patio and other building jobs.<//><//>`;
  }
  if (q.loading || (!job && jobQ.loading)) return html`<${Page} title="Service report" back="Job" onBack=${toJob}><div class="block" style="display:grid;gap:12px"><${Skel} w="40%" h=${14} /><${Skel} w="70%" h=${24} /><${Skel} h=${52} /><${Skel} h=${52} /><${Skel} h=${52} /><${Skel} h=${52} /></div><//>`;
  if (!q.data) {
    const refused = q.error && isRefusal(q.error);
    return html`<${Page} title="Service report" back="Job" onBack=${toJob}>${refused
      ? html`<${Empty} title="Add yourself to this job first" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>${plain(q.error)}<//>`
      : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="the service report" />`}<//>`;
  }
  const report = q.data.report || null;
  const status = report ? String(report.status || '').toLowerCase() : '';
  const sent = status === 'submitted' || status === 'approved';
  const head = html`<header class="rp-head">
    <div class="rp-headline">${job ? html`<${JobLine} job=${job} vertical=${vertical} />` : null}${sent ? html`<${Badge} kind="ok">${status === 'approved' ? 'Approved' : 'Sent'}<//>` : null}</div>
    ${job ? html`<h2 class="t-head">${jobAddress(job) || jobTitle(job)}</h2><p>${job.client_name || ''}</p>` : null}
  </header>`;
  const frame = (body, foot) => html`<${Page} flush title="Service report" back="Job" onBack=${toJob} foot=${foot || null}>${head}<div class="rp-body rp-form">${body}</div><//>`;
  return sent
    ? html`<${Sent} report=${report} user=${user} jobId=${jobId} frame=${frame} />`
    : html`<${Form} key=${jobId} jobId=${jobId} job=${job} report=${report} template=${Array.isArray(q.data.checklistTemplate) ? q.data.checklistTemplate : []} media=${jobQ.data && jobQ.data.media} user=${user} frame=${frame} />`;
}

function Form({ jobId, job, report, template, media, user, frame }) {
  const key = 'svc:' + jobId;
  const sigKey = 'svc/' + jobId + '/sig';
  const init = useMemo(() => {
    const saved = local.get(key);
    const serverAt = report ? Date.parse(report.updated_at || report.created_at || '') || 0 : 0;
    if (saved && typeof saved === 'object' && (!report || (saved.at || 0) + 60000 >= serverAt)) return { ...blank(), ...saved };
    if (!report) return blank();
    const ticks = {};
    (Array.isArray(report.checklist_json) ? report.checklist_json : []).forEach((c) => { if (c && c.label && c.checked) ticks[c.label] = true; });
    return { ...blank(), ticks, weather: report.weather || '', start: String(report.start_time || '').slice(0, 5), finish: String(report.end_time || '').slice(0, 5), notes: report.notes || '', variations: report.variations || '', name: report.signature_name || '', at: serverAt };
  }, []);
  const [f, setF] = useState(init);
  const [sig, setSig] = useState(null);
  const [sigReady, setSigReady] = useState(false);
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState(report ? 'server' : local.get(key) ? 'phone' : '');
  const ref = useRef({ f: init, sig: null, timer: 0, flying: false, again: false, off: false });

  useEffect(() => { let on = true; stash.get(sigKey).then((b) => { if (!on) return; ref.current.sig = b || null; setSig(b || null); setSigReady(true); }); return () => { on = false; clearTimeout(ref.current.timer); }; }, []);

  const body = async (status) => {
    const cur = ref.current.f;
    return {
      jobId,
      checklist: template.map((label) => ({ label, checked: Boolean(cur.ticks[label]) })),
      notes: cur.notes.trim(),
      signatureData: await toDataUrl(ref.current.sig),
      signatureName: cur.name.trim(),
      weather: cur.weather || '',
      start_time: cur.start || '',
      end_time: cur.finish || '',
      variations: cur.variations.trim(),
      status
    };
  };
  const pushDraft = async (loud) => {
    const r = ref.current;
    if (r.off) return;
    if (!navigator.onLine) { if (loud) toast('Saved on this phone. It will go to the office when you send it.'); return; }
    if (r.flying) { r.again = true; return; }
    r.flying = true; setSaveState('saving');
    try {
      await api('submit_service_report', null, await body('draft'));
      setSaveState('server');
      if (loud) toast('Draft saved. You can come back to it.', { kind: 'ok' });
    } catch (err) {
      if (isRefusal(err)) r.off = true;
      setSaveState('phone');
      if (loud) toast(isRefusal(err) ? plain(err) : 'Saved on this phone. No signal to save it with the office yet.', { kind: isRefusal(err) ? 'bad' : '' });
    }
    r.flying = false;
    if (r.again && !r.off) { r.again = false; pushDraft(); }
  };
  const patch = (change) => {
    const next = { ...ref.current.f, ...change, at: Date.now() };
    ref.current.f = next; local.set(key, next); setF(next); setSaveState('phone');
    clearTimeout(ref.current.timer);
    ref.current.timer = setTimeout(() => pushDraft(false), 3000);
  };
  const onSign = async (blob) => {
    ref.current.sig = blob; setSig(blob);
    if (blob) await stash.put(sigKey, blob); else stash.del(sigKey);
  };

  const photos = useMemo(() => splitMedia(media).photos.filter((p) => p.phase === 'completion'), [media]);
  const addPhotos = async () => {
    const files = await pickPhotos({ multiple: true });
    if (!files.length) return;
    const batch = files.map((file, i) => ({ key: Date.now() + '-' + i, file, preview: URL.createObjectURL(file), state: 'sending' }));
    setPending((p) => [...batch, ...p]);
    let queued = 0;
    for (const item of batch) {
      try {
        const r = await uploadPhoto(jobId, item.file, { phase: 'completion' });
        if (r.queued) { queued += 1; setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'queued' } : x))); } else setPending((p) => p.filter((x) => x.key !== item.key));
      } catch (err) { setPending((p) => p.map((x) => (x.key === item.key ? { ...x, state: 'failed' } : x))); toast(plain(err), { kind: 'bad' }); }
    }
    invalidate('job:' + jobId);
    if (queued) toast(`${queued} ${queued === 1 ? 'photo is' : 'photos are'} saved on your phone and will send when you have signal.`, { ms: 5000 });
    else buzz(10);
  };

  const unticked = template.filter((label) => !f.ticks[label]).length;
  const need = !f.name.trim() ? 'The customer\'s name is needed' : !sig ? 'The customer\'s signature is needed' : '';
  const send = async () => {
    if (need) return;
    const ok = await ask({ title: 'Send the service report?', body: `${unticked ? `${unticked} of the checks ${unticked === 1 ? 'is' : 'are'} not ticked. ` : ''}It goes to the office and cannot be changed after it is sent.`, yes: 'Send report' });
    if (!ok) return;
    setBusy(true);
    clearTimeout(ref.current.timer); ref.current.off = true;
    try {
      const res = await api('submit_service_report', null, await body('submitted'), { timeout: 45000 });
      local.del(key); stash.del(sigKey);
      if (res && res.report) primeQuery('service:' + jobId, { report: res.report, checklistTemplate: template });
      else invalidate('service:' + jobId);
      invalidate('job:' + jobId); invalidate('myjobs');
      buzz([14, 60, 14, 60, 30]);
      toast('Service report sent to the office.', { kind: 'ok', ms: 4500 });
    } catch (err) {
      ref.current.off = false;
      toast(plain(err) + (isRefusal(err) ? '' : ' Your report is still here. Try again.'), { kind: 'bad', ms: 7000 });
    }
    setBusy(false);
  };

  return frame(html`
      <${Section} label="Checks before you leave">
        ${template.length ? html`<div class="block card rp-rows">${template.map((label) => html`<${CheckRow} key=${label} label=${noPrices(label, user.seesMoney)} checked=${Boolean(f.ticks[label])} onChange=${(v) => patch({ ticks: { ...f.ticks, [label]: v } })} />`)}</div>
          <p class="block t-small" style="margin-top:6px">Tick each one that is done.</p>`
          : html`<p class="block t-small">No checklist is set for this kind of job. Use the notes below.</p>`}
      <//>
      <${Section} label="The day"><div class="block card pad stack">
        <${Field} label="Weather"><${Picks} value=${f.weather || null} options=${WEATHER} onChange=${(v) => patch({ weather: v === f.weather ? '' : v })} /><//>
        <div class="rp-times"><${TimeInput} label="Started" value=${f.start} onInput=${(v) => patch({ start: v })} /><${TimeInput} label="Finished" value=${f.finish} onInput=${(v) => patch({ finish: v })} /></div>
      </div><//>
      <${Section} label="Notes"><div class="block card pad stack">
        <${Field} label="How the job finished up (optional)"><textarea class="input rp-short" value=${f.notes} placeholder="Anything the office should know about the finished job" onInput=${(e) => patch({ notes: e.currentTarget.value })} /><//>
        <${Field} label="Anything different from the plan, or any problems (optional)"><textarea class="input rp-short" value=${f.variations} placeholder="e.g. Customer asked for the gate on the other side" onInput=${(e) => patch({ variations: e.currentTarget.value })} /><//>
      </div><//>
      <${Section} label="Finished photos" right=${photos.length ? html`<span class="t-small t-num">${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}</span>` : null}>
        <div class="block"><${PhotoGrid} photos=${photos} pending=${pending} onAdd=${addPhotos} addLabel="Add photos" /></div>
      <//>
      <${Section} label="Customer sign-off"><div class="block card pad stack">
        <p class="t-small">Hand the phone to the customer to sign.</p>
        <${Field} label="Customer's full name"><input class="input" autocomplete="off" autocapitalize="words" value=${f.name} onInput=${(e) => patch({ name: e.currentTarget.value })} /><//>
        ${job && job.client_name && f.name.trim() !== job.client_name ? html`<div class="picks"><button type="button" class="pick" onClick=${() => { patch({ name: job.client_name }); buzz(6); }}>${job.client_name}</button></div>` : null}
        <${Field} label="Signature">${sigReady ? html`<${SignaturePad} initial=${sig} onChange=${onSign} />` : html`<${Skel} h=${180} />`}<//>
      </div><//>`,
    html`${need ? html`<p class="rp-footnote warn">${need}</p>` : null}
      <${Button} block class="big" busy=${busy} disabled=${Boolean(need)} onClick=${send}>Send report<//>
      <${Button} kind="quiet" block disabled=${busy} onClick=${() => { clearTimeout(ref.current.timer); pushDraft(true); }}>${saveState === 'saving' ? 'Saving' : saveState === 'server' ? 'Draft saved. Save again' : 'Save for later'}<//>`);
}

function Sent({ report, user, jobId, frame }) {
  const approved = String(report.status).toLowerCase() === 'approved';
  const checklist = Array.isArray(report.checklist_json) ? report.checklist_json.filter((c) => c && c.label) : [];
  const text = (t) => noPrices(t, user.seesMoney);
  const sigSrc = typeof report.signature_data === 'string' && /^(https?:|data:image\/)/.test(report.signature_data) ? report.signature_data : '';
  const share = async () => {
    const url = `${opsBase()}?action=view_shared_report&token=${encodeURIComponent(report.share_token)}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Service report from SecureWorks', text: 'Your service report is ready to view', url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied. Paste it into a text or email to the customer.', { kind: 'ok', ms: 4500 });
    } catch (err) { if (!err || err.name !== 'AbortError') toast('Could not share the link from this phone.', { kind: 'bad' }); }
  };
  return frame(html`
    <div class="block note-banner ok"><span><span class="t-strong">${approved ? 'Report approved by the office.' : 'Report sent to the office.'}</span>${report.submitted_at ? ` ${fmtTs(report.submitted_at)}.` : ''} It can no longer be changed here.</span></div>
    ${report.share_token ? html`<div class="block" style="margin-top:12px"><${Button} kind="line" block onClick=${share}>Share it with the customer<//></div>` : null}
    <${Section} label="What was sent">
      <div class="block card rp-sum">
        ${checklist.length ? html`<div><span class="t-cap">Checks</span>${checklist.map((c) => html`<p class=${cx('rp-tickline', !c.checked && 'off')}><${Icon} name=${c.checked ? 'check' : 'close'} size=${18} stroke=${2.6} /><span>${text(c.label)}${c.checked ? '' : ' (not ticked)'}</span></p>`)}</div>` : null}
        ${report.weather || report.start_time || report.end_time ? html`<div><span class="t-cap">The day</span><p>${[report.weather ? (WEATHER.find((w) => w[0] === report.weather) || [0, report.weather])[1] : '', report.start_time ? fmtTime(report.start_time) + (report.end_time ? ' to ' + fmtTime(report.end_time) : '') : ''].filter(Boolean).join(', ')}</p></div>` : null}
        ${report.notes ? html`<div><span class="t-cap">Notes</span><p class="rp-para">${text(report.notes)}</p></div>` : null}
        ${report.variations ? html`<div><span class="t-cap">Different from the plan</span><p class="rp-para">${text(report.variations)}</p></div>` : null}
        <div><span class="t-cap">Signed by</span><p class="t-strong">${report.signature_name || 'No name given'}</p>
          ${sigSrc ? html`<img class="rp-sigshown" src=${sigSrc} alt=${'Signature of ' + (report.signature_name || 'the customer')} />` : null}</div>
      </div>
    <//>
    <div class="block" style="margin-top:24px"><${Button} kind="quiet" block onClick=${() => go('/job/' + jobId, { replace: true })}>Back to the job<//></div>`);
}
