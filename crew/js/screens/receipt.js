// Receipts. Photo first, then only what the office needs: how it was paid, what
// it was for and which job. Nothing here waits in a queue: with no signal the
// photo stays on screen until it can be sent.
import { html, cx, useEffect, useRef, useState } from '../lib/h.js';
import { api, putFile, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, invalidate } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { todayISO, addDays, fmtDate, fmtDay, tsToDate, isISODate } from '../lib/dates.js';
import { jobTitle, verticalOf } from '../lib/model.js';
import { useJob, jobStub } from '../lib/data.js';
import { compressImage, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Sheet, Field, Picks, Chip, Tag, SkelRows, Empty, LoadError, toast, openOverlay, openLightbox, buzz } from '../ui/kit.js';
import { DoneScreen, cash, num } from '../ui/paybits.js';

const PAID_WITH = [['personal_card', 'I paid, pay me back'], ['company_card', 'Company card'], ['cash', 'Company cash'], ['supplier_invoice', 'Supplier account']];
const PAID_WORDS = { personal_card: 'You paid, to be paid back', company_card: 'Company card', cash: 'Company cash', supplier_invoice: 'Supplier account' };
const WHAT_FOR = [['materials', 'Materials'], ['fuel', 'Fuel'], ['tools', 'Tools'], ['consumables', 'Consumables'], ['parking', 'Parking'], ['meals', 'Meals'], ['vehicle_maintenance', 'Vehicle'], ['other', 'Other']];
// With no job the office files it under a business heading. It follows from what it was for.
const NO_JOB_HEADING = { materials: 'general_stock', tools: 'general_stock', consumables: 'general_stock', fuel: 'vehicle', parking: 'vehicle', vehicle_maintenance: 'vehicle', meals: 'overhead', other: 'other' };
const STATUS = {
  pending_extraction: ['Reading the photo', ''], pending: ['With the office', 'warn'], approved: ['Approved', 'ok'],
  queried: ['Office has a question', 'bad'], rejected: ['Not accepted', 'bad'], pushed_to_xero: ['With the bookkeeper', 'hi']
};
const statusOf = (e) => STATUS[String(e.status || '').toLowerCase()] || ['With the office', 'warn'];
const who = (name) => (name ? String(name)[0].toUpperCase() + String(name).slice(1) : 'The office');

async function sha256(blob) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
const mine = (list, user) => (list || []).filter((e) => e.submitted_by === user.id);

// ------------------------------------------------------------ add a receipt
export function Receipt({ jobId, poId }) {
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const jobQ = useJob(jobId || null);
  const propJob = jobId ? (jobQ.data && jobQ.data.job) || jobStub(jobId) || { id: jobId } : null;

  const [step, setStep] = useState('shoot'); // shoot | sending | check | done
  const [photo, setPhoto] = useState(null); // { blob, preview }
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(null);
  const [expense, setExpense] = useState(null);
  const [f, setF] = useState({ vendor: '', date: '', total: '', gst: '', paid: null, what: null });
  const [job, setJob] = useState(jobId ? { id: jobId, via: 'manual_search' } : null); // { id | null, via }
  const [found, setFound] = useState([]); // jobs the server suggested or the trade searched for
  const [saving, setSaving] = useState(false);
  const upload = useRef(null); const unsure = useRef(false); const picked = useRef(Boolean(jobId)); const suggested = useRef([]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => () => { if (photo && photo.preview) URL.revokeObjectURL(photo.preview); }, [photo]);

  const take = async (camera) => {
    const files = await pickPhotos({ multiple: false, camera });
    if (!files.length) return;
    const blob = await compressImage(files[0]);
    const next = { blob, preview: URL.createObjectURL(blob) };
    upload.current = null; unsure.current = false;
    setPhoto(next); buzz(8);
    send(next, '');
  };

  // Look for one that already landed before ever sending the same receipt twice.
  const findLanded = async (why) => {
    const res = await api('list_expenses', { limit: 30 });
    const up = upload.current;
    const row = mine(res && res.expenses, user).find((e) => (up ? e.receipt_storage_path === up.path || e.receipt_photo_url === up.publicUrl : e.no_receipt_reason === why && Date.now() - Date.parse(e.created_at) < 15 * 60000));
    return row ? { expense_id: row.id, extraction: { vendor_name: row.vendor_name, receipt_date: row.receipt_date, total_amount: row.total_amount, gst_amount: row.gst_amount, line_items: row.line_items }, routed_to: row.routed_to, status: row.status } : null;
  };

  const send = async (shot, why) => {
    setStep('sending'); setProblem(null);
    try {
      if (shot && !upload.current) {
        const type = shot.blob.type || 'image/jpeg';
        const up = await api('get_upload_url', null, { fileName: `receipt-${Date.now()}.jpg`, contentType: type, purpose: 'expense_receipt' });
        await putFile(up.uploadUrl, up.token, shot.blob, type);
        upload.current = { ...up, sha: await sha256(shot.blob) };
      }
      const up = upload.current;
      let made = unsure.current ? await findLanded(why) : null;
      if (!made) {
        const body = up ? { receipt_photo_url: up.publicUrl, receipt_storage_path: up.path, receipt_storage_bucket: up.bucket, receipt_sha256: up.sha || undefined } : { no_receipt_reason: why };
        if (jobId) body.job_id = jobId;
        if (poId) body.po_id = poId;
        try { made = await api('submit_expense', null, body, { timeout: 45000 }); } catch (err) { unsure.current = !(err instanceof ApiError && err.refused); throw err; }
      }
      if (!made || !made.expense_id) throw new ApiError('The receipt was not saved.', { status: 422, body: made || {} });
      unsure.current = false;
      const x = made.extraction || {};
      const today = todayISO();
      setExpense({ ...made, hadJob: Boolean(jobId) });
      setF({ vendor: x.vendor_name || '', date: isISODate(x.receipt_date || '') && x.receipt_date.slice(0, 10) <= today ? x.receipt_date.slice(0, 10) : '', total: num(x.total_amount) != null ? String(x.total_amount) : '', gst: num(x.gst_amount) != null ? String(x.gst_amount) : '', paid: null, what: null });
      invalidate('expenses');
      setStep('check');
      api('suggest_job_for_expense', null, { merchant: x.vendor_name || '', receipt_date: x.receipt_date || '', total_amount: num(x.total_amount) }).then((res) => {
        const list = ((res && res.suggestions) || []).slice(0, 4);
        setFound((cur) => [...cur, ...list.filter((s) => !cur.some((c) => c.job_id === s.job_id))]);
        if (!picked.current && list[0]) setJob({ id: list[0].job_id, via: 'jarvis_top' });
        suggested.current = list;
      }).catch(() => {});
    } catch (err) {
      setProblem(err);
      setStep('shoot');
    }
  };

  const noReceipt = () => openOverlay((close) => html`<${NoReceiptSheet} onClose=${close} onSend=${(why) => { setPhoto(null); upload.current = null; unsure.current = false; setReason(why); send(null, why); }} />`);
  const findJob = () => openOverlay((close) => html`<${FindJobSheet} onClose=${close} onPick=${(j) => {
    setFound((cur) => (cur.some((c) => c.job_id === j.id) ? cur : [...cur, { job_id: j.id, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb }]));
    picked.current = true; setJob({ id: j.id, via: 'manual_search' });
  }} />`);

  const options = [];
  if (propJob) options.push({ job_id: propJob.id, job_number: propJob.job_number, client_name: propJob.client_name, site_suburb: propJob.site_suburb, reason: 'The job you came from' });
  for (const s of found) if (!options.some((o) => o.job_id === s.job_id)) options.push(s);
  const chosen = job && job.id ? options.find((o) => o.job_id === job.id) : null;
  const total = num(f.total);
  const missing = !f.vendor.trim() ? 'Add the shop name' : !(total > 0) ? 'Add the total' : !f.date ? 'Pick the date on the receipt' : !f.paid ? 'Say how it was paid' : !f.what ? 'Say what it was for' : !job ? 'Pick the job, or no job' : '';

  const save = async () => {
    if (missing || saving) return;
    setSaving(true);
    const items = ((expense.extraction && expense.extraction.line_items) || []).filter((li) => li && li.description);
    const sum = items.reduce((s, li) => s + (Number(li.total != null ? li.total : li.amount) || 0), 0);
    const label = (WHAT_FOR.find(([v]) => v === f.what) || [])[1] || 'Purchase';
    const body = {
      expense_id: expense.expense_id, vendor_name: f.vendor.trim(), receipt_date: f.date, total_amount: total, gst_amount: num(f.gst),
      line_items: items.length && Math.abs(sum - total) <= 1 ? items : [{ description: `${label}, ${f.vendor.trim()}`, quantity: 1, unit_price: total, total }],
      category: f.what, payment_method: f.paid, job_id: job.id || null, business_category: job.id ? null : NO_JOB_HEADING[f.what] || 'other',
      jarvis_job_suggestion: { suggestions: suggested.current, chosen: job.id || '', chosen_via: job.id ? job.via : 'general_business' }
    };
    try {
      const res = await api('update_expense', null, body);
      if (res && res.success === false) throw new ApiError(res.error || 'Not saved', { status: 409, body: res });
      invalidate('expenses');
      buzz([14, 60, 14, 60, 30]);
      setStep('done');
    } catch (err) {
      toast(err instanceof ApiError && err.offline ? 'No signal. Nothing is lost: press Send again when you are back in range.' : friendly(err), { kind: 'bad', ms: 6500 });
    }
    setSaving(false);
  };
  const again = () => { setPhoto(null); setReason(''); setExpense(null); setProblem(null); setFound([]); upload.current = null; unsure.current = false; picked.current = Boolean(jobId); suggested.current = []; setJob(jobId ? { id: jobId, via: 'manual_search' } : null); setStep('shoot'); };

  if (step === 'done') {
    const sameRoute = expense.hadJob === Boolean(job.id);
    const checker = sameRoute ? who(expense.routed_to) : 'The office';
    return html`<${DoneScreen} title="Receipt sent" lead=${`${checker} checks it${chosen ? ` against ${jobTitle(chosen)}` : ''}. Nothing more for you to do.`}>
      <section class="inset"><div class="sumrows">
        <div class="sumrow"><span>${f.vendor.trim()}</span><span>${cash(total)}</span></div>
        <div class="sumrow"><span>${PAID_WORDS[f.paid]}</span><span class="plainval">${chosen ? jobTitle(chosen) : 'No job'}</span></div>
      </div></section>
      ${f.paid === 'personal_card' ? html`<div class="note-banner plain"><${Icon} name="info" size=${18} /><span><span class="t-strong">Getting your money back.</span> Once it is approved, the office pays you back. That happens outside this app and is not part of your weekly invoice, so ask the office if it has not come through.</span></div>` : null}
      <div style="display:grid;gap:8px"><${Button} block onClick=${() => back('/pay')}>Done<//>
        <${Button} kind="line" block icon="camera" onClick=${again}>Add another receipt<//>
        <${Button} kind="quiet" block onClick=${() => go('/pay/receipts', { replace: true })}>See the receipts you have sent<//></div>
    <//>`;
  }

  if (step === 'check') {
    const read = expense.extraction && (expense.extraction.vendor_name || num(expense.extraction.total_amount) != null);
    const today = todayISO(); const yesterday = addDays(today, -1);
    const dateMode = f.date === today ? 'today' : f.date === yesterday ? 'yesterday' : f.date || f.otherDate ? 'other' : null;
    return html`<${Page} title="Check the receipt" class="paycol" onBack=${() => back('/pay')}>
      <header class="block"><h1 class="t-title" style="font-size:30px">Check the receipt</h1>
        <p class="t-small" style="margin-top:6px">${!photo ? 'No photo, so fill in what you paid.' : read ? 'This is what we read off your photo. Fix anything that is wrong.' : 'We could not read the photo. Fill in what you can see on it.'}</p></header>
      <div class="form" style="margin-top:18px">
        ${photo ? html`<button type="button" class="shotrow" onClick=${() => openLightbox([{ url: photo.preview, label: 'Your receipt' }])}><img src=${photo.preview} alt="Your receipt" /><span><span class="t-strong">Your photo is saved</span><span class="t-small" style="display:block">Tap to look at it</span></span><${Icon} name="right" size=${18} class="t-mute" /></button>`
          : html`<div class="note-banner plain"><${Icon} name="info" size=${18} /><span>No receipt: ${reason}</span></div>`}
        <${Field} label="Shop"><input class="input" value=${f.vendor} placeholder="e.g. Bunnings" onInput=${(e) => set('vendor', e.currentTarget.value)} /><//>
        <div class="formgrid">
          <${Field} label="Total paid"><input class="input big" type="number" inputmode="decimal" min="0" step="0.01" placeholder="$" value=${f.total} onInput=${(e) => set('total', e.currentTarget.value)} /><//>
          <${Field} label="GST in that"><input class="input big" type="number" inputmode="decimal" min="0" step="0.01" placeholder="$" value=${f.gst} onInput=${(e) => set('gst', e.currentTarget.value)} /><//>
        </div>
        <${Field} label=${photo ? 'Date on the receipt' : 'Date you paid'}>
          <${Picks} value=${dateMode} options=${[['today', 'Today'], ['yesterday', 'Yesterday'], ['other', dateMode === 'other' && f.date ? fmtDay(f.date) : 'Another day']]} onChange=${(v) => setF((p) => ({ ...p, otherDate: v === 'other', date: v === 'today' ? today : v === 'yesterday' ? yesterday : p.date === today || p.date === yesterday ? '' : p.date }))} />
          ${dateMode === 'other' ? html`<input class="input" type="date" max=${today} value=${f.date} aria-label="Date on the receipt" onInput=${(e) => set('date', e.currentTarget.value > today ? '' : e.currentTarget.value)} />` : null}
        <//>
        <${Field} label="How was it paid?"><${Picks} value=${f.paid} options=${PAID_WITH} onChange=${(v) => set('paid', v)} /><//>
        <${Field} label="What was it for?"><${Picks} value=${f.what} options=${WHAT_FOR} onChange=${(v) => set('what', v)} /><//>
        <${Field} label="Which job?">
          <div class="picks">
            ${options.map((o) => html`<button type="button" class="pick" key=${o.job_id} aria-pressed=${String(Boolean(job && job.id === o.job_id))} onClick=${() => { picked.current = true; buzz(6); setJob({ id: o.job_id, via: suggested.current[0] && suggested.current[0].job_id === o.job_id ? 'jarvis_top' : suggested.current.some((s) => s.job_id === o.job_id) ? 'jarvis_alt' : 'manual_search' }); }}>${jobTitle(o)}</button>`)}
            <button type="button" class="pick" aria-pressed=${String(Boolean(job && !job.id))} onClick=${() => { picked.current = true; buzz(6); setJob({ id: null, via: 'general_business' }); }}>No job, general business</button>
            <button type="button" class="pick ghost" onClick=${findJob}><${Icon} name="jobs" size=${16} />Another job</button>
          </div>
          ${chosen ? html`<span class="t-small" style="text-transform:none;letter-spacing:0;font-weight:440;font-stretch:100%">${[chosen.job_number, chosen.client_name, chosen.reason].filter(Boolean).join(' · ')}</span>` : null}
        <//>
      </div>
      <div class="dock">
        ${missing ? html`<p class="t-small" style="text-align:center;color:var(--hi);font-weight:650">${missing}</p>` : null}
        <${Button} block busy=${saving} disabled=${Boolean(missing)} onClick=${save}>Send receipt${!missing ? ' · ' + cash(total) : ''}<//>
      </div>
    <//>`;
  }

  const sending = step === 'sending';
  const offline = problem && problem.offline;
  return html`<${Page} title="Add a receipt" onBack=${() => back('/pay')}>
    <header class="block"><h1 class="t-display">Add a receipt</h1>
      <p style="margin-top:10px;color:var(--ink-2)">${propJob && propJob.id && jobTitle(propJob) !== 'Job' ? `For ${jobTitle(propJob)}. ` : ''}Bought something for work? Take a photo of the receipt and we read it for you.</p></header>

    <div class="block" style="margin-top:20px;display:grid;gap:12px">
      ${photo ? html`<div class=${cx('shot', sending && 'busy')}><img class="receipt-shot" src=${photo.preview} alt="Your receipt" />
          ${sending ? html`<span class="shotstate"><i class="spin" />Reading your receipt</span>` : null}</div>`
        : sending ? html`<div class="shot busy" style="min-height:120px"><span class="shotstate"><i class="spin" />Saving</span></div>`
        : html`<button type="button" class="bigadd shoot" onClick=${() => take(true)}><span class="shootmark"><${Icon} name="camera" size=${34} /></span><span>Take a photo of the receipt</span><span class="t-small">Get the whole receipt in, flat and in good light</span></button>`}

      ${problem && !sending ? html`<div class=${cx('note-banner', offline ? '' : 'bad')}><${Icon} name=${offline ? 'cloudoff' : 'alert'} size=${18} /><span><span class="t-strong">${offline ? 'No signal, so it has not sent.' : 'That did not send.'}</span> ${offline ? (photo ? 'Your photo is still here. Try again when you are back in range.' : 'Try again when you are back in range.') : friendly(problem)}</span></div>
        <${Button} block icon="refresh" onClick=${() => send(photo, reason)}>Try again<//>
        ${photo ? html`<${Button} kind="quiet" block onClick=${() => take(true)}>Take the photo again<//>` : null}` : null}
      ${!online && !problem && !sending ? html`<p class="t-small t-mute">You have no signal right now. You can take the photo, and send it when you are back in range.</p>` : null}
    </div>

    ${!photo && !sending ? html`<div class="list ruled" style="margin-top:18px">
      <button type="button" class="row" onClick=${() => take(false)}><span class="lead quiet"><${Icon} name="image" size=${22} /></span><span class="main"><b>Use a photo I already took</b></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>
      <button type="button" class="row" onClick=${noReceipt}><span class="lead quiet"><${Icon} name="file" size=${22} /></span><span class="main"><b>I do not have a receipt</b></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>
      <button type="button" class="row" onClick=${() => go('/pay/receipts')}><span class="lead quiet"><${Icon} name="receipt" size=${22} /></span><span class="main"><b>Receipts I have sent</b></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>
    </div>` : null}
  <//>`;
}

function NoReceiptSheet({ onSend, onClose }) {
  const [why, setWhy] = useState('');
  return html`<${Sheet} title="No receipt" sub="Tell the office why, then fill in what you paid." onClose=${onClose}
    foot=${(shut) => html`<${Button} block disabled=${why.trim().length < 4} onClick=${() => { onSend(why.trim()); shut(); }}>Carry on<//>`}>
    <${Field} label="Why is there no receipt?"><textarea class="input" autofocus placeholder="e.g. Lost it, the machine was out of paper" value=${why} onInput=${(e) => setWhy(e.currentTarget.value)} /><//>
  <//>`;
}

function FindJobSheet({ onPick, onClose }) {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 280); return () => clearTimeout(id); }, [q]);
  const search = useQuery(term.length >= 2 ? 'search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const results = ((search.data && search.data.jobs) || []).slice(0, 12);
  return html`<${Sheet} title="Which job was it for?" onClose=${onClose} tall>
    ${(shut) => html`<div class="stack">
      <div class="search"><${Icon} name="jobs" size=${20} /><input class="input" type="search" autofocus placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${term.length < 2 ? html`<p class="t-small t-mute">Search for the job. Finished jobs show too.</p>`
        : search.loading ? html`<${SkelRows} n=${3} />`
        : search.error && !results.length ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="the jobs" />`
        : !results.length ? html`<${Empty} title="No job found">Try the suburb or the job number.<//>`
        : html`<div class="list ruled" style="margin:0 calc(-1 * var(--gut))">${results.map((j) => html`<button type="button" class="row" key=${j.id} onClick=${() => { onPick(j); buzz(6); shut(); }}>
            <span class="main" style="grid-column:1 / span 2"><b>${jobTitle(j)}</b><span>${[j.client_name, j.job_number].filter(Boolean).join(' · ')}</span><span style="display:block;margin-top:6px"><${Tag} vertical=${verticalOf(j)} /></span></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>`)}</div>`}
    </div>`}
  <//>`;
}

// ------------------------------------------------------ receipts I have sent
export function Receipts() {
  const user = useStore((s) => s.user);
  const q = useQuery('expenses', () => api('list_expenses', { limit: 100 }), { persist: true, ttl: 60000 });
  const rows = mine(q.data && q.data.expenses, user).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const open = (e) => openOverlay((close) => html`<${ReceiptSheet} expense=${e} onClose=${close} />`);
  return html`<${Page} title="Receipts" class="paycol" onBack=${() => back('/pay')}>
    <header class="block"><h1 class="t-display">Receipts</h1><p class="t-small" style="margin-top:8px">The ones you have sent, newest first.</p></header>
    ${q.loading ? html`<${SkelRows} n=${4} />` : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your receipts" />`
      : !rows.length ? html`<${Empty} title="No receipts yet">When you buy something for work, take a photo of the receipt here and the office takes it from there.<//>`
      : html`<div class="list ruled" style="margin-top:14px">${rows.map((e) => { const [words, kind] = statusOf(e); return html`<button type="button" class="row" key=${e.id} onClick=${() => open(e)}>
          <span class="main" style="grid-column:1"><b>${e.vendor_name || 'Receipt'}</b>
            <span>${[e.receipt_date ? fmtDate(e.receipt_date.slice(0, 10)) : e.created_at ? fmtDate(tsToDate(e.created_at)) : '', e.jobs ? e.jobs.site_suburb || e.jobs.client_name || e.jobs.job_number : 'No job'].filter(Boolean).join(' · ')}</span></span>
          <span style="text-align:right;display:grid;gap:4px;justify-items:end"><span class="t-num" style="font-size:20px">${num(e.total_amount) != null ? cash(e.total_amount) : ''}</span><${Chip} kind=${kind}>${words}<//></span>
          <span class="trail"><${Icon} name="right" size=${18} /></span></button>`; })}</div>`}
    <div class="dock"><${Button} block icon="camera" onClick=${() => go('/pay/receipt')}>Add a receipt<//></div>
  <//>`;
}

function ReceiptSheet({ expense: e, onClose }) {
  const [words, kind] = statusOf(e);
  const status = String(e.status || '').toLowerCase();
  const say = status === 'queried' ? e.query_reason : status === 'rejected' ? e.rejection_reason : '';
  const next = status === 'queried' ? 'The office needs something from you before they can approve it. Give them a call.'
    : status === 'rejected' ? 'The office did not accept this one. Call them if you think that is wrong.'
    : status === 'pending_extraction' ? 'We are still reading the photo. Nothing for you to do.'
    : status === 'approved' || status === 'pushed_to_xero' ? (e.payment_method === 'personal_card' ? 'Approved. The office pays you back outside this app, so ask them if it has not come through.' : 'Approved. Nothing more for you to do.')
    : `${who(e.routed_to)} is checking it. Nothing for you to do.`;
  return html`<${Sheet} title=${e.vendor_name || 'Receipt'} sub=${e.created_at ? 'Sent ' + fmtDate(tsToDate(e.created_at)) : ''} onClose=${onClose}>
    <div class="stack">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><span class="money lg">${num(e.total_amount) != null ? cash(e.total_amount) : 'No total'}</span><${Chip} kind=${kind}>${words}<//></div>
      <p style="color:var(--ink-2)">${next}</p>
      ${say ? html`<div class="note-banner bad"><${Icon} name="message" size=${18} /><span><span class="t-strong">From the office</span><span style="display:block;margin-top:2px">${say}</span></span></div>` : null}
      <div class="inset"><div class="sumrows">
        <div class="sumrow"><span>Date on it</span><span>${e.receipt_date ? fmtDate(e.receipt_date.slice(0, 10)) : 'Not known'}</span></div>
        <div class="sumrow"><span>Job</span><span class="plainval">${e.jobs ? [e.jobs.site_suburb || e.jobs.client_name, e.jobs.job_number].filter(Boolean).join(' · ') : 'No job'}</span></div>
        <div class="sumrow"><span>Paid with</span><span class="plainval">${PAID_WORDS[e.payment_method] || 'Not said'}</span></div>
        ${num(e.gst_amount) ? html`<div class="sumrow"><span>GST in it</span><span>${cash(e.gst_amount)}</span></div>` : null}
      </div></div>
      ${e.receipt_photo_url ? html`<button type="button" class="shotrow" onClick=${() => openLightbox([{ url: e.receipt_photo_url, label: e.vendor_name || 'Receipt' }])}><img src=${e.receipt_photo_url} alt="Receipt" /><span><span class="t-strong">The photo you sent</span><span class="t-small" style="display:block">Tap to look at it</span></span><${Icon} name="right" size=${18} class="t-mute" /></button>`
        : e.no_receipt_reason ? html`<p class="t-small">No receipt: ${e.no_receipt_reason}</p>` : null}
    </div>
  <//>`;
}
