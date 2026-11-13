// Finishing a job (fencing, patio, decking and the rest; make safes use the
// report instead). A short walk: clock off, finished photos, the neighbour's
// okay on a fence, the customer's sign-off and their say, the crew's own say
// on how the job went, a tidy-up check, then send.
// Everything is kept on the phone until it has landed, so a refresh or a
// dropped signal part-way loses nothing and Retry carries on where it stopped.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useStore, local, invalidate } from '../lib/store.js';
import { useJob, jobStub, noteBody } from '../lib/data.js';
import { go, back } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtHours, firstName } from '../lib/dates.js';
import { verticalOf, isReportJob, jobTitle, jobIsClosed, VERTICAL_LABEL } from '../lib/model.js';
import { queueWrite, sendPhoto } from '../lib/outbox.js';
import { pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Sheet, Slide, Skel, Empty, LoadError, Field, Toggle, toast, openOverlay, buzz } from '../ui/kit.js';
import { plain, isRefusal, stash, keepPhoto, useSaved, BlobImg, SignaturePad, Stars, CheckRow, StepBar, StepHead } from '../ui/report-kit.js';
import { openClockOff, useElapsed } from './clock.js';

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 12;
const PROMPTS = {
  fencing: ['Full fence run', 'Gate working', 'Post bases and plinths', 'Colour and finish close up'],
  decking: ['Overall view', 'Subframe', 'Board pattern', 'Edge detail'],
  patio: ['Front view, whole patio', 'Underside, beams and fixings', 'Gutter and downpipes', 'Any detail worth showing'],
  other: ['The finished work', 'Wide view of the area', 'A close up', 'Anything else worth showing']
};
const TICKS = [
  ['cleaned', 'Site is clean', 'Offcuts, packaging and concrete are gone.'],
  ['tools', 'Tools and leftover materials are off site', ''],
  ['noDamage', 'Nothing of the customer\'s is damaged', 'Paving, garden, retic, the neighbour\'s side.'],
  ['maintenance', 'The customer knows how to look after it', '']
];
const OUTCOMES = [['good', 'Went well', 'No real hold-ups.'], ['some_problems', 'Had some problems', 'Got there, but something got in the way.'], ['rough', 'Rough one', 'A lot went wrong on this job.']];
const blank = () => ({ step: null, hadClock: false, photos: [], nbrs: [], waive: false, waiveReason: '', absent: false, signing: false, rating: 0, comment: '', name: '', sig: null, outcome: null, slowed: '', better: '', ticks: {}, sent: {}, result: null });
const newKey = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function Finish({ jobId }) {
  const user = useStore((s) => s.user);
  const q = useJob(jobId);
  const data = q.data;
  const job = (data && data.job) || jobStub(jobId);
  const toJob = () => back('/job/' + jobId);

  if (!data && q.loading) return html`<${Page} title="Finish job" onBack=${toJob}><div class="page-pad" style="display:grid;gap:14px"><${Skel} h=${4} r=${4} /><${Skel} w="60%" h=${30} style="margin-top:14px" /><${Skel} w="85%" /><${Skel} h=${220} r=${14} style="margin-top:8px" /></div><//>`;
  if (!data) {
    return html`<${Page} title="Finish job" onBack=${toJob}>${q.locked
      ? html`<${Empty} title="Add yourself to this job first" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>Only someone booked on a job can finish it.<//>`
      : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this job" />`}<//>`;
  }
  const vertical = verticalOf(job, data);
  const saved = local.get('finish:' + jobId);
  const finishedHere = Boolean(saved && saved.result);
  if (isReportJob(vertical)) {
    return html`<${Page} title="Finish job" onBack=${toJob}><${Empty} title="This job is finished with its report" action=${html`<${Button} small onClick=${() => go(`/job/${jobId}/report`, { replace: true })}>Open the report<//>`}>
      A ${VERTICAL_LABEL[vertical].toLowerCase()} job is closed off by sending its report, not from here.<//><//>`;
  }
  if (data.access_tier === 'company_view') {
    return html`<${Page} title="Finish job" onBack=${toJob}><${Empty} title="Add yourself to this job first" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Open the job<//>`}>Only someone booked on a job can finish it.<//><//>`;
  }
  if (jobIsClosed(job.status) && !finishedHere) {
    return html`<${Page} title="Finish job" onBack=${toJob}><${Empty} title="This job is already finished" action=${html`<${Button} kind="line" small onClick=${() => go('/job/' + jobId, { replace: true })}>Back to the job<//>`}>
      Someone has already marked it finished. If something is missing, add a photo or a note on the job.<//><//>`;
  }
  return html`<${Flow} key=${jobId} jobId=${jobId} job=${job} data=${data} user=${user} />`;
}

function neighbourNames(job) {
  const rows = (job.scope_json && job.scope_json.job && job.scope_json.job.neighbours) || [];
  return (Array.isArray(rows) ? rows : []).map((n) => (n ? [n.firstName, n.lastName].filter(Boolean).join(' ').trim() || String(n.name || '').trim() || String(n.address || '').trim() : '')).filter(Boolean);
}

function Flow({ jobId, job, data, user }) {
  const clock = useStore((st) => st.clock);
  const [s, set, clearSaved, latest] = useSaved('finish:' + jobId, blank);
  const [blobs, setBlobs] = useState({});
  const [ready, setReady] = useState(false);
  const [run, setRun] = useState({ at: null, error: null, active: false });
  const running = useRef(false);

  const type = String(job.type || '').toLowerCase();
  const vertical = verticalOf(job, data);
  const prompts = PROMPTS[type] || (vertical === 'patio' ? PROMPTS.patio : PROMPTS.other);
  const ev = data.completion_evidence || null;
  const needNbr = type === 'fencing' && !(ev && (ev.applies === false || ev.satisfied === true || ev.waived === true));
  const names = useMemo(() => neighbourNames(job), [job.id]);
  const slots = needNbr ? (ev && typeof ev.signoffs_required === 'number' && !ev.waived ? Math.max(1, ev.signoffs_required) : Math.max(1, names.length)) : 0;
  const liveHere = Boolean(clock && clock.jobId === jobId);
  const steps = [(s.hadClock || liveHere) && 'clock', 'photos', needNbr && 'neighbours', 'customer', 'feedback', 'tidy', 'send'].filter(Boolean);
  const step = liveHere ? 'clock' : steps.includes(s.step) && s.step !== 'clock' ? s.step : 'photos';
  const index = steps.indexOf(step);
  const sk = (k) => jobId + '/' + k;

  // Bring back anything taken before a refresh.
  useEffect(() => {
    let on = true;
    (async () => {
      const cur = latest();
      const keys = [...cur.photos.map((p) => p.key), ...cur.nbrs.map((n) => n.key), cur.sig && cur.sig.key].filter(Boolean);
      const got = {};
      for (const k of keys) { const b = await stash.get(sk(k)); if (b) got[k] = b; }
      if (!on) return;
      setBlobs(got);
      set((c) => ({ ...c,
        photos: c.photos.filter((p) => got[p.key] || c.sent[p.key]),
        nbrs: c.nbrs.map((n) => (n.key && !got[n.key] && !c.sent[n.key] ? { ...n, key: null } : n)),
        sig: c.sig && (got[c.sig.key] || c.sent[c.sig.key]) ? c.sig : null }));
      setReady(true);
    })();
    return () => { on = false; };
  }, []);
  useEffect(() => { if (liveHere && !s.hadClock) set({ hadClock: true }); }, [liveHere]);
  useEffect(() => {
    if (!needNbr) return;
    if (s.nbrs.length === slots) return;
    set((c) => ({ ...c, nbrs: Array.from({ length: slots }, (_, i) => c.nbrs[i] || { label: names[i] || (slots > 1 ? `Neighbour ${i + 1}` : 'The neighbour'), key: null }) }));
  }, [needNbr, slots]);

  const goStep = (name) => { set({ step: name }); const page = document.querySelector('.page'); if (page) page.scrollTop = 0; };
  const next = () => goStep(steps[Math.min(steps.length - 1, index + 1)]);
  const prev = () => {
    if (run.active) return;
    if (run.error) setRun({ at: null, error: null, active: false });
    if (step === 'customer' && s.signing && !s.absent) { set({ signing: false }); return; }
    const before = steps[index - 1];
    if (!before || before === 'clock') back('/job/' + jobId); else goStep(before);
  };

  // ---- photos ----
  const addPhotos = async ({ label, library }) => {
    const files = await pickPhotos({ multiple: Boolean(library), camera: !library });
    if (!files.length) return;
    const have = latest().photos;
    const free = prompts.filter((p) => !have.some((x) => x.label === p));
    const room = Math.max(0, MAX_PHOTOS - have.length);
    const added = []; const got = {};
    for (const [i, file] of files.slice(0, room).entries()) {
      const key = newKey('p');
      got[key] = await keepPhoto(sk(key), file);
      added.push({ key, label: i === 0 && label ? label : free.filter((p) => p !== label)[label ? i - 1 : i] || 'Finished work' });
    }
    setBlobs((b) => ({ ...b, ...got }));
    set((c) => ({ ...c, photos: [...c.photos, ...added] }));
    buzz(10);
    if (files.length > room) toast(`That is plenty. ${MAX_PHOTOS} photos is the most for one job.`);
  };
  const retake = async (photo) => {
    const files = await pickPhotos({ multiple: false, camera: true });
    if (!files.length) return;
    const blob = await keepPhoto(sk(photo.key), files[0]);
    setBlobs((b) => ({ ...b, [photo.key]: blob })); buzz(10);
  };
  const removePhoto = (photo) => { stash.del(sk(photo.key)); set((c) => ({ ...c, photos: c.photos.filter((p) => p.key !== photo.key) })); setBlobs((b) => { const n = { ...b }; delete n[photo.key]; return n; }); };
  const openPhoto = (photo) => openOverlay((close) => html`<${Sheet} title=${photo.label} onClose=${close}
      foot=${(shut) => html`<${Button} block icon="camera" onClick=${() => { shut(); retake(photo); }}>Take it again<//><${Button} kind="quiet" block onClick=${() => { removePhoto(photo); shut(); }}>Remove this photo<//>`}>
      <${BlobImg} blob=${blobs[photo.key]} alt=${photo.label} class="shot-large" /><//>`);

  // ---- neighbours ----
  const addEvidence = async (i) => {
    const files = await pickPhotos({ multiple: false });
    if (!files.length) return;
    const old = latest().nbrs[i];
    const key = old && old.key && !latest().sent[old.key] ? old.key : newKey('n');
    const blob = await keepPhoto(sk(key), files[0]);
    setBlobs((b) => ({ ...b, [key]: blob }));
    set((c) => ({ ...c, nbrs: c.nbrs.map((n, idx) => (idx === i ? { ...n, key } : n)) }));
    buzz(10);
  };
  const nbrOk = !needNbr || (s.waive ? s.waiveReason.trim().length >= 3 : s.nbrs.length > 0 && s.nbrs.every((n) => n.key));

  // ---- customer ----
  const onSign = async (blob) => {
    const cur = latest();
    if (!blob) { if (cur.sig && !cur.sent[cur.sig.key]) stash.del(sk(cur.sig.key)); set({ sig: null }); return; }
    const key = cur.sig && !cur.sent[cur.sig.key] ? cur.sig.key : newKey('s');
    await stash.put(sk(key), blob);
    setBlobs((b) => ({ ...b, [key]: blob }));
    set({ sig: { key } });
  };
  const customerOk = s.absent || (s.rating > 0 && s.name.trim().length > 1 && Boolean(s.sig));
  const ticks = TICKS.filter(([k]) => !(s.absent && k === 'maintenance'));
  const tidyOk = ticks.every(([k]) => s.ticks[k]);

  // ---- send ----
  const items = useMemo(() => [
    ...s.photos.map((p) => ({ id: p.key, kind: 'photo', label: p.label, phase: 'completion', mediaLabel: p.label })),
    ...(needNbr && !s.waive ? s.nbrs.filter((n) => n.key).map((n) => ({ id: n.key, kind: 'photo', label: `Sign-off from ${n.label.replace(/^The /, 'the ')}`, phase: 'neighbour_signoff', mediaLabel: 'Neighbour sign-off: ' + n.label.replace(/^The neighbour$/, 'Neighbour') })) : []),
    ...(needNbr && s.waive ? [{ id: 'waiver', kind: 'waiver', label: 'Why there is no neighbour sign-off' }] : []),
    ...(!s.absent && s.sig ? [{ id: s.sig.key, kind: 'photo', label: 'Customer signature', phase: 'signature', mediaLabel: 'Client signature - ' + s.name.trim(), png: true }] : []),
    { id: 'complete', kind: 'complete', label: 'Mark the job finished' }
  ], [s.photos, s.nbrs, s.waive, s.absent, s.sig, s.name, needNbr]);

  const send = async () => {
    if (running.current) return;
    running.current = true;
    const sent = { ...latest().sent };
    const mark = (id, v) => { sent[id] = v; set((c) => ({ ...c, sent: { ...c.sent, [id]: v } })); };
    const finishUp = async (res, already) => {
      mark('complete', true);
      const cur = latest();
      const note = async (id, eventType, text, metadata) => {
        if (sent[id]) return;
        const base = noteBody(jobId, text, user);
        const body = { ...base, eventType, metadata: { ...base.metadata, ...(metadata || {}) } };
        try { await api('add_note', null, body); mark(id, true); } catch (err) {
          if (isRefusal(err)) mark(id, 'refused'); else { queueWrite({ action: 'add_note', body, jobId, label: 'Note on ' + jobTitle(job) }); mark(id, 'queued'); }
        }
      };
      if (cur.absent) await note('noteAbsent', 'completion.client_absent', 'Customer was not on site when the job was finished. No sign-off was taken.');
      if (!cur.absent && cur.rating > 0 && cur.rating < 4) await note('noteLow', 'completion.low_satisfaction', `Customer gave ${cur.rating}/5 at completion. Follow up needed.`);
      if (!cur.absent && cur.comment.trim()) await note('noteCustomer', 'completion.client_feedback', `Customer feedback (${cur.rating} ${cur.rating === 1 ? 'star' : 'stars'}): ${cur.comment.trim()}`, { rating: cur.rating, signer: cur.name.trim() });
      const crewSay = crewFeedbackText(cur);
      if (crewSay) await note('noteCrew', 'completion.trade_feedback', crewSay, { outcome: cur.outcome });
      [...cur.photos.map((p) => p.key), ...cur.nbrs.map((n) => n.key), cur.sig && cur.sig.key].filter(Boolean).forEach((k) => stash.del(sk(k)));
      set((c) => ({ ...c, result: { queue: (res && res.invoice_queue) || null, already: Boolean(already), absent: c.absent, photos: c.photos.length, signer: c.absent ? '' : c.name.trim(), rating: c.absent ? 0 : c.rating, signed: !c.absent && Boolean(c.sig && c.sent[c.sig.key]), neighbour: needNbr ? (c.waive ? 'waived' : 'shown') : '', feedback: Boolean(crewSay), at: Date.now() } }));
      invalidate('job:' + jobId); invalidate('myjobs'); invalidate('hours'); invalidate('search');
      buzz([14, 60, 14, 60, 30]);
    };
    let at = null;
    try {
      for (const item of items) {
        if (sent[item.id]) continue;
        at = item.id;
        setRun({ at, error: null, active: true });
        if (item.kind === 'photo') {
          const blob = blobs[item.id] || await stash.get(sk(item.id));
          if (!blob) throw new Error('That picture is no longer on this phone. Go back and take it again.');
          const media = await sendPhoto({ jobId, blob, name: item.png ? `signature-${Date.now()}.png` : `finish-${item.id}.jpg`, type: item.png ? 'image/png' : blob.type || 'image/jpeg', phase: item.phase, label: item.mediaLabel });
          mark(item.id, (media && media.id) || true);
        } else if (item.kind === 'waiver') {
          await api('waive_neighbour_signoff', null, { jobId, reason: latest().waiveReason.trim() });
          mark('waiver', true);
        } else {
          const cur = latest();
          const body = { jobId, signatureName: cur.absent ? '' : cur.name.trim() };
          if (!cur.absent && cur.rating) body.satisfaction_rating = cur.rating;
          const sigId = cur.sig && sent[cur.sig.key];
          if (!cur.absent && typeof sigId === 'string') body.signature_media_id = sigId;
          let res = null;
          try { res = await api('complete_my_job', null, body, { timeout: 45000 }); } catch (err) {
            // Did it land anyway? Read the job before saying it failed.
            const closedAlready = /cannot complete a job with status "?(complete|completed|invoiced|final_payment|get_review)/i.test(err.message || '');
            let landed = closedAlready;
            if (!landed && !isRefusal(err)) { try { const again = await api('trade_job_detail', { jobId }); landed = Boolean(again && again.job && jobIsClosed(again.job.status)); } catch { /* still unknown */ } }
            if (!landed) throw err;
            await finishUp(null, closedAlready);
            running.current = false; setRun({ at: null, error: null, active: false });
            return;
          }
          await finishUp(res, false);
        }
      }
      setRun({ at: null, error: null, active: false });
    } catch (err) {
      setRun({ at, error: err, active: false });
      buzz([20, 60, 20]);
    }
    running.current = false;
  };

  if (s.result) return html`<${Done} result=${s.result} job=${job} user=${user} onLeave=${(path) => { clearSaved(); go(path, { replace: true }); }} />`;
  if (!ready) return html`<${Page} title="Finish job"><div class="page-pad" style="display:grid;gap:14px"><${Skel} h=${4} r=${4} /><${Skel} w="60%" h=${30} style="margin-top:14px" /><${Skel} h=${220} r=${14} /></div><//>`;

  const sending = run.active || run.error || Object.keys(s.sent).length > 0;
  const photoCount = s.photos.length;
  const nextPrompt = prompts.find((p) => !s.photos.some((x) => x.label === p));
  const place = jobTitle(job);

  return html`<${Page} class="steppage" title=${'Finish ' + jobTitle(job)} onBack=${prev}>
    <${StepBar} index=${index} total=${steps.length} />

    ${step === 'clock' ? html`<${ClockStep} place=${place} clock=${clock} onDone=${({ hours }) => { toast(hours ? `Clocked off. ${fmtHours(hours)} saved for your invoice.` : 'Clocked off.', { kind: 'ok' }); goStep('photos'); }} />` : null}

    ${step === 'photos' ? html`<div class="rise">
      <${StepHead} kicker=${place} title="Photos of the finished job">At least ${MIN_PHOTOS}. They go to the office and the customer's file.<//>
      <div class="shots block">
        ${prompts.map((p) => { const ph = s.photos.find((x) => x.label === p); return ph
          ? html`<${Shot} key=${ph.key} photo=${ph} blob=${blobs[ph.key]} sent=${Boolean(s.sent[ph.key])} onOpen=${() => openPhoto(ph)} />`
          : html`<button type="button" class="shot empty" key=${p} onClick=${() => addPhotos({ label: p })}><${Icon} name="camera" size=${28} /><span>${p}</span></button>`; })}
        ${s.photos.filter((x) => !prompts.includes(x.label)).map((ph) => html`<${Shot} key=${ph.key} photo=${ph} blob=${blobs[ph.key]} sent=${Boolean(s.sent[ph.key])} onOpen=${() => openPhoto(ph)} />`)}
        ${!nextPrompt && photoCount < MAX_PHOTOS ? html`<button type="button" class="shot empty" onClick=${() => addPhotos({})}><${Icon} name="plus" size=${28} /><span>Another photo</span></button>` : null}
      </div>
      <div class="stepfoot">
        <p class="footnote">${photoCount >= MIN_PHOTOS ? `${photoCount} photos taken` : photoCount ? `${photoCount} of ${MIN_PHOTOS} taken` : 'Tap a square, or use the button'}</p>
        ${photoCount >= MIN_PHOTOS
          ? html`<${Button} block onClick=${next}>Continue<//>`
          : html`<${Button} block icon="camera" onClick=${() => addPhotos({ label: nextPrompt })}>Take: ${nextPrompt || 'another photo'}<//>`}
        <${Button} kind="quiet" block onClick=${() => addPhotos({ library: true })}>Choose photos already on this phone<//>
      </div>
    </div>` : null}

    ${step === 'neighbours' ? html`<div class="rise">
      <${StepHead} kicker=${place} title="The neighbour's okay">A fence on a shared boundary needs the neighbour's okay on file. Add a photo or screenshot of it: a text, an email or a signed note.<//>
      <div class="block stack">
        ${s.waive ? null : s.nbrs.map((n, i) => html`<div class="evid" key=${i}>
          ${n.key && blobs[n.key] ? html`<${BlobImg} blob=${blobs[n.key]} alt="" class="evid-pic" />` : html`<span class="evid-pic"><${Icon} name="image" size=${24} /></span>`}
          <span class="grow"><b>${n.label}</b><span class="t-small">${n.key ? (s.sent[n.key] ? 'Sent' : 'Sign-off added') : 'Nothing added yet'}</span></span>
          ${s.sent[n.key] ? html`<${Icon} name="check" size=${22} class="t-ok" />` : html`<${Button} kind=${n.key ? 'line' : 'primary'} small onClick=${() => addEvidence(i)}>${n.key ? 'Change' : 'Add'}<//>`}
        </div>`)}
        <${Toggle} label="I have no sign-off to show" hint="Say why, and the office will sort it out." checked=${s.waive} onChange=${(v) => set({ waive: v })} />
        ${s.waive ? html`<${Field} label="Why is there no sign-off?" hint="The office reads this before the job is paid.">
          <textarea class="input" value=${s.waiveReason} placeholder="e.g. Neighbour agreed on site but would not sign. The owner has it in an email." onInput=${(e) => set({ waiveReason: e.currentTarget.value })} /><//>` : null}
      </div>
      <div class="stepfoot"><${Button} block disabled=${!nbrOk} onClick=${next}>Continue<//></div>
    </div>` : null}

    ${step === 'customer' ? html`<div class="rise" key=${s.absent ? 'absent' : s.signing ? 'sign' : 'rate'}>
      ${s.absent ? html`<${StepHead} kicker=${place} title="No customer sign-off">That is fine. The office is told the customer was not on site and follows up with them. Nothing is sent to the customer from here.<//>
        <div class="block"><${Button} kind="line" block onClick=${() => set({ absent: false })}>The customer is here after all<//></div>`
      : !s.signing ? html`<section class="handover">
          <span class="t-label">Hand the phone to the customer</span>
          <h1 class="t-display">How did we go?</h1>
          <p>${job.client_name ? `Hi ${firstName(job.client_name)}. ` : ''}Your ${THING[vertical] || 'job'} is finished. Tap a star to tell us.</p>
          <${Stars} big value=${s.rating} onChange=${(n) => set({ rating: n })} />
        </section>
        <div class="block" style="margin-top:20px">
          <${Field} label="Anything you would like to tell us? (optional)"><textarea class="input" style="min-height:112px" value=${s.comment} placeholder="Good or bad, we read every one." onInput=${(e) => set({ comment: e.currentTarget.value })} /><//>
        </div>`
      : html`<${StepHead} kicker="For the customer" title=${s.rating >= 4 ? `Thank you${job.client_name ? ', ' + firstName(job.client_name) : ''}` : 'One last thing'}>Sign to say you have seen the finished work. Your name and signature go on the job file.<//>
        <div class="block stack">
          <${Field} label="Your name"><input class="input" autocomplete="off" autocapitalize="words" value=${s.name} placeholder="Full name" onInput=${(e) => set({ name: e.currentTarget.value })} /><//>
          ${job.client_name && s.name.trim() !== job.client_name ? html`<div class="picks" style="margin-top:-6px"><button type="button" class="pick" onClick=${() => { set({ name: job.client_name }); buzz(6); }}>${job.client_name}</button></div>` : null}
          <${Field} label="Your signature"><${SignaturePad} initial=${s.sig ? blobs[s.sig.key] : null} onChange=${onSign} /><//>
        </div>`}
      <div class="stepfoot">
        ${s.absent ? html`<${Button} block onClick=${next}>Continue<//>`
          : !s.signing ? html`${!s.rating ? html`<p class="footnote">Tap a star</p>` : null}
            <${Button} block disabled=${!s.rating} onClick=${() => { set({ signing: true }); const page = document.querySelector('.page'); if (page) page.scrollTop = 0; }}>Next: sign<//>
            <${Button} kind="quiet" block onClick=${() => set({ absent: true })}>The customer is not here<//>`
          : html`${!customerOk ? html`<p class="footnote">${s.name.trim().length < 2 ? 'Add your name' : 'Sign in the box'}</p>` : null}
            <${Button} block disabled=${!customerOk} onClick=${next}>Done, hand the phone back<//>`}
      </div>
    </div>` : null}

    ${step === 'feedback' ? html`<div class="rise">
      <${StepHead} kicker=${place} title="How did this job go?">For the office only, so the next job runs better. The customer does not see it.<//>
      <div class="block choices" role="radiogroup" aria-label="How the job went">
        ${OUTCOMES.map(([v, label, sub]) => html`<button type="button" class="choice" role="radio" aria-checked=${String(s.outcome === v)} key=${v} onClick=${() => { buzz(6); set({ outcome: s.outcome === v ? null : v }); }}>
          <span class="ring" /><span><b>${label}</b><span>${sub}</span></span></button>`)}
      </div>
      <div class="block stack" style="margin-top:18px">
        <${Field} label="What slowed you down? (optional)"><textarea class="input short" value=${s.slowed} placeholder="e.g. Wrong materials, access, waiting on someone" onInput=${(e) => set({ slowed: e.currentTarget.value })} /><//>
        <${Field} label="What should we do better next time? (optional)"><textarea class="input short" value=${s.better} placeholder="e.g. The scope missed the retaining" onInput=${(e) => set({ better: e.currentTarget.value })} /><//>
      </div>
      <div class="stepfoot">${crewFeedbackText(s)
        ? html`<${Button} block onClick=${next}>Continue<//>`
        : html`<${Button} kind="line" block onClick=${next}>Skip this<//>`}</div>
    </div>` : null}

    ${step === 'tidy' ? html`<div class="rise">
      <${StepHead} kicker=${place} title="Before you go">Tick each one once it is true.<//>
      <div class="block">${ticks.map(([k, label, sub]) => html`<${CheckRow} key=${k} label=${label} sub=${sub} checked=${Boolean(s.ticks[k])} onChange=${(v) => set((c) => ({ ...c, ticks: { ...c.ticks, [k]: v } }))} />`)}</div>
      <div class="stepfoot"><${Button} block disabled=${!tidyOk} onClick=${next}>Continue<//></div>
    </div>` : null}

    ${step === 'send' ? html`<div class="rise">
      ${run.error ? html`<${StepHead} kicker=${place} title="It stopped part-way">Nothing is lost. What did not send is still on this phone.<//>`
        : run.active ? html`<${StepHead} kicker=${place} title="Sending">Keep the app open until this finishes.<//>`
        : sending ? html`<${StepHead} kicker=${place} title="Not finished sending">Some of it has gone. Carry on to send the rest.<//>`
        : html`<${StepHead} kicker=${place} title="Ready to send">This marks the whole job finished, for everyone booked on it.<//>`}
      <ul class="sendlist block">
        ${items.map((it) => { const state = s.sent[it.id] ? 'sent' : run.error && run.at === it.id ? 'failed' : run.active && run.at === it.id ? 'sending' : 'waiting';
          return html`<li key=${it.id} class=${state}>
            <span class="dot">${state === 'sent' ? html`<${Icon} name="check" size=${15} stroke=${3} />` : state === 'failed' ? html`<${Icon} name="close" size=${14} stroke=${3} />` : state === 'sending' ? html`<i class="spin" />` : null}</span>
            <span class="what">${it.label}</span>
            <span class="t-small">${state === 'sent' ? 'Sent' : state === 'failed' ? 'Not sent' : state === 'sending' ? 'Sending' : sending ? 'Waiting' : ''}</span>
          </li>`; })}
      </ul>
      ${!sending ? html`<p class="block t-small" style="margin-top:14px">${s.absent ? 'The customer was not on site, so there is no sign-off. The office will follow up.' : `Signed by ${s.name.trim()}, ${s.rating} out of 5.`}${crewFeedbackText(s) ? ' Your notes on the job go to the office too.' : ''}</p>` : null}
      ${run.error ? html`<div class="block note-banner bad" style="margin-top:16px"><${Icon} name="alert" size=${18} /><span><span class="t-strong">${(items.find((i) => i.id === run.at) || {}).label || 'Sending'} did not go through.</span> ${plain(run.error)}</span></div>` : null}
      <div class="stepfoot">
        ${run.error ? html`<${Button} block icon="refresh" onClick=${send}>Try again<//><p class="footnote">It carries on from where it stopped. Nothing is sent twice.</p>`
          : run.active ? html`<${Button} block busy disabled>Sending<//>`
          : sending ? html`<${Button} block onClick=${send}>Carry on sending<//>`
          : html`<${Slide} label="Slide to finish the job" icon="check" onConfirm=${send} />`}
      </div>
    </div>` : null}
  <//>`;
}

function Shot({ photo, blob, sent, onOpen }) {
  return html`<button type="button" class=${cx('shot', sent && 'sent')} disabled=${sent} onClick=${onOpen}>
    ${blob ? html`<${BlobImg} blob=${blob} alt=${photo.label} />` : null}
    <span class="cap">${photo.label}</span>
    <span class="tick"><${Icon} name="check" size=${14} stroke=${3} /></span>
  </button>`;
}

function ClockStep({ clock, place, onDone }) {
  const t = useElapsed(clock && clock.since, clock ? clock.breakMin : 0);
  return html`<div class="rise">
    <${StepHead} kicker=${place} title="Clock off first">You are still on the clock for this job. Clock off so your hours are right, then finish it.<//>
    <div class="block hoursout" style="margin-top:4px"><span class="t-label" style="color:var(--hi);display:flex;gap:8px;align-items:center"><i class="pulse" />On the clock</span><b>${t.h}:${t.m}</b></div>
    <div class="stepfoot"><${Button} block icon="clock" onClick=${() => openClockOff({ onDone })}>Clock off<//></div>
  </div>`;
}

function Done({ result, job, user, onLeave }) {
  const queue = result.queue || {};
  const wos = (Array.isArray(queue.work_orders) ? queue.work_orders : []).filter((w) => w && w.priced !== false);
  const thisWeek = mondayOf(todayISO());
  let line = null; let week = thisWeek; let cta = "See this week's invoice";
  if (queue.lane === 'weekly_work_order' && wos.length) {
    week = wos[0].week_end ? addDays(String(wos[0].week_end).slice(0, 10), -6) : thisWeek;
    line = wos.length === 1 ? `Work order ${wos[0].wo_number || ''} is finished and ready for your invoice.`.replace('  ', ' ') : `${wos.length} work orders are finished and ready for your invoice.`;
  } else if (queue.lane === 'hours' || queue.lane === 'weekly_work_order') {
    if (queue.hours_logged != null && Number(queue.hours_logged) > 0) line = `Your hours are on this week's invoice. ${fmtHours(Number(queue.hours_logged))} saved for this job.`;
    else { line = 'No hours are saved for this job yet. Add your times on this week\'s invoice.'; cta = 'Add my times'; }
  }
  const n = Number(result.photos) || 0;
  const photos = n ? `${n} ${n === 1 ? 'photo' : 'photos'}` : 'your photos';
  const sentLine = result.signed ? `Sent to the office with ${photos} and the customer's signature.` : `Sent to the office with ${photos}.`;
  return html`<main class="page enter-push page-pad" style="display:grid;align-content:start;gap:20px;padding-top:calc(var(--safe-t) + 44px)">
    <div class="done-mark"><${Icon} name="check" size=${44} stroke=${3} /></div>
    <div><h1 class="t-display">Job finished</h1>
      <p style="margin-top:10px;color:var(--ink-2)">${result.already ? `${jobTitle(job)} was already marked finished. Your photos are on it.` : `Good work, ${firstName(user.name)}. ${jobTitle(job)} is done.`}</p></div>
    <section class="inset nextlist">
      <span class="t-label">The sign-off</span>
      <p><${Icon} name="image" size=${18} /><span>${sentLine}</span></p>
      ${result.absent ? html`<p><${Icon} name="phone" size=${18} /><span>Customer not on site. The office will follow up with them.</span></p>`
        : result.signer ? html`<p><${Icon} name="pen" size=${18} /><span>Signed by ${result.signer}${result.rating ? `, ${result.rating} out of 5` : ''}.${result.rating >= 4 ? ' A happy customer.' : ''}</span></p>` : null}
      ${result.neighbour ? html`<p><${Icon} name="users" size=${18} /><span>${result.neighbour === 'waived' ? 'No neighbour sign-off. The office has your reason.' : 'The neighbour\'s okay is on file.'}</span></p>` : null}
      ${result.feedback ? html`<p><${Icon} name="note" size=${18} /><span>Your notes on how it went are with the office. Thanks for telling us.</span></p>` : null}
      ${line ? html`<p><${Icon} name="pay" size=${18} /><span>${line}</span></p>` : null}
    </section>
    <div class="stack tight">
      ${line ? html`<${Button} block onClick=${() => onLeave('/pay/week/' + week)}>${cta}<//>` : null}
      <${Button} kind=${line ? 'quiet' : 'primary'} block onClick=${() => onLeave('/today')}>Back to today<//>
    </div>
  </main>`;
}

const THING = { fencing: 'fence', patio: 'patio', decking: 'deck', repair: 'repair' };
function crewFeedbackText(c) {
  const tidy = (t) => String(t || '').trim().replace(/[.\s]+$/, '');
  const slowed = tidy(c.slowed); const better = tidy(c.better);
  if (!c.outcome && !slowed && !better) return '';
  const label = (OUTCOMES.find((o) => o[0] === c.outcome) || [])[1];
  return ['Crew feedback' + (label ? ': ' + label : ''), slowed && 'Slowed down by: ' + slowed, better && 'Next time: ' + better].filter(Boolean).join('. ') + '.';
}
