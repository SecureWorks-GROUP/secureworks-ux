// Receipts. Photo first, then only what the office needs: how it was paid, what
// it was for, and which job (or division stock once spend_capture_v2 is on).
// Nothing here waits in a queue: with no signal the photo stays on screen until
// it can be sent.
import { html, cx, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, putFile, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, invalidate, primeQuery } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { todayISO, addDays, fmtDate, fmtDay, tsToDate, isISODate } from '../lib/dates.js';
import { jobTitle, verticalOf } from '../lib/model.js';
import { useMyBookings, useJob, jobStub } from '../lib/data.js';
import { receiptsEnabled } from '../lib/reimbursements.js';
import { compressImage, pickPhotos } from '../lib/upload.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Sheet, Field, Picks, StatusBadge, JobLine, JobTag, KV, SkelRows, Empty, LoadError, toast, openOverlay, openLightbox, buzz } from '../ui/kit.js';
import { DoneScreen, cash, num } from '../ui/paybits.js';
import { useExpenses } from './pay.js';

const PAID_WITH = [['personal_card', 'I paid, pay me back'], ['company_card', 'Company card'], ['cash', 'Company cash'], ['supplier_invoice', 'Supplier account']];
const PAID_WORDS = { personal_card: 'You paid, to be paid back', company_card: 'Company card', cash: 'Company cash', supplier_invoice: 'Supplier account' };
const WHAT_FOR = [['materials', 'Materials'], ['fuel', 'Fuel'], ['tools', 'Tools'], ['consumables', 'Consumables'], ['parking', 'Parking'], ['meals', 'Meals'], ['vehicle_maintenance', 'Vehicle'], ['other', 'Other']];
// Kept for the legacy no-job path while spend_capture_v2 is off on the server.
const NO_JOB_HEADING = { materials: 'general_stock', tools: 'general_stock', consumables: 'general_stock', fuel: 'vehicle', parking: 'vehicle', vehicle_maintenance: 'vehicle', meals: 'overhead', other: 'other' };
const STOCK_DIVISIONS = [['patios', 'Patio stock'], ['fencing', 'Fencing stock'], ['insurance', 'Insurance stock']];
const STOCK_LABEL = { patios: 'Patio stock', fencing: 'Fencing stock', insurance: 'Insurance stock' };
const STOCK_SAVED = { patios: 'patio stock', fencing: 'fencing stock', insurance: 'insurance stock' };

// One of the fixed status words for a receipt, and the few words that say more.
const STATUS = {
  pending_extraction: ['waiting', 'Reading the photo'], pending: ['waiting', 'With the office'], approved: ['approved', 'Approved'],
  queried: ['on_hold', 'The office has a question'], rejected: ['sent_back', 'Not accepted'], pushed_to_xero: ['approved', 'With the bookkeeper']
};
const statusOf = (e) => STATUS[String(e.status || '').toLowerCase()] || ['waiting', 'With the office'];
const who = (name) => (name ? String(name)[0].toUpperCase() + String(name).slice(1) : 'The office');

export function spendCaptureEnabled({ expense, suggestData, expensesData } = {}) {
  for (const src of [expense, suggestData, expensesData]) {
    if (src && typeof src.spend_capture_v2 === 'boolean') return src.spend_capture_v2;
  }
  return false;
}

export function reimbursementSwitchOn(expensesData, res) {
  if (res && typeof res.trade_reimbursement_line_v1 === 'boolean') return res.trade_reimbursement_line_v1;
  if (expensesData && typeof expensesData.trade_reimbursement_line_v1 === 'boolean') return expensesData.trade_reimbursement_line_v1;
  return receiptsEnabled(expensesData && expensesData.expenses);
}

export function savedReceiptReimbursedOnInvoice({ expensesData, expenseId, res, hasPhoto } = {}) {
  const rows = expensesData && Array.isArray(expensesData.expenses) ? expensesData.expenses : null;
  if (rows && expenseId) {
    const row = rows.find((r) => r && r.id === expenseId);
    if (row) return Boolean(row.reimbursement && row.reimbursement.claimable === true);
  }
  if (res && typeof res.trade_reimbursement_line_v1 === 'boolean') return res.trade_reimbursement_line_v1 && Boolean(hasPhoto);
  return Boolean(hasPhoto) && reimbursementSwitchOn(expensesData, res);
}

export function stockDivisionOfVertical(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'patio' || v === 'patios' || v === 'decking' || v === 'deck') return 'patios';
  if (v === 'fencing' || v === 'fence') return 'fencing';
  if (v === 'insurance' || v === 'makesafe' || v === 'makesafes' || v === 'repair' || v === 'restoration') return 'insurance';
  return null;
}

export function stockDivisionOfJob(job, extra) {
  if (!job) return null;
  const rawType = String(job.type || job.job_type || '').trim().toLowerCase();
  if (rawType === 'granny_flat') return null;
  const fromVert = stockDivisionOfVertical(verticalOf(job, extra)) || stockDivisionOfVertical(rawType) || stockDivisionOfVertical(job.division);
  if (fromVert) return fromVert;
  const numStr = String(job.job_number || '').trim().toUpperCase();
  if (/^(SWP|SWD)-/.test(numStr)) return 'patios';
  if (/^SWF-/.test(numStr)) return 'fencing';
  if (/^(SWI-|SWMS-|SWRESTO-|AJBR|MS1|BWCWA|WB6)/.test(numStr)) return 'insurance';
  return null;
}

export function divisionsForUser(user, ownBookings) {
  if (!user) return [];
  if (user.office) return STOCK_DIVISIONS;
  const set = new Set();
  const lists = [user.divisions, user.verticals, user.managed, user.managed_verticals, user.details && user.details.divisions, user.details && user.details.verticals];
  for (const arr of lists) {
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) { const d = stockDivisionOfVertical(raw); if (d) set.add(d); }
  }
  for (const b of ownBookings || []) {
    const d = stockDivisionOfJob(b && b.job, b);
    if (d) set.add(d);
  }
  return STOCK_DIVISIONS.filter(([k]) => set.has(k));
}

export function nextStepWords(nextStep, { jobNumber = '', stockDivision = '', reimbursementOn = false } = {}) {
  if (nextStep === 'reimbursed_on_next_invoice') {
    return reimbursementOn
      ? 'Saved. It will be on your next invoice as a reimbursement.'
      : 'Saved. The office will see it.';
  }
  if (nextStep === 'saved_against_job') return `Saved against ${jobNumber || 'the job'}.`;
  if (nextStep === 'saved_to_stock') return `Saved to ${STOCK_SAVED[stockDivision] || 'stock'}.`;
  if (nextStep === 'draft_bill') return 'Saved. The office will see it.';
  if (nextStep === 'evidence_for_supplier_bill') return "Saved. It will be matched to the supplier's bill.";
  return 'Saved. The office will see it.';
}

export function serverWordsOf(err) {
  if (err && err.offline) return 'No signal. Nothing is lost: press Save receipt again when you are back in range.';
  const b = (err && err.body) || {};
  if (typeof b.userMessage === 'string' && b.userMessage.trim()) return b.userMessage.trim();
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim();
  if (typeof b.error === 'string' && b.error.trim() && !/^[a-z0-9_]+$/.test(b.error.trim())) return b.error.trim();
  return friendly(err);
}

export function missingReceiptField(opts = {}) {
  const { v2, vendor, total, date, paid, what, dest, jobAllowed } = opts;
  const validDest = Boolean(dest && (dest.kind === 'stock' || (!v2 && dest.kind === 'no_job') || (dest.kind === 'job' && jobAllowed)));
  if (v2) {
    if (!validDest) return 'Pick the job or the stock this was for';
    if (!String(vendor || '').trim()) return 'Add the shop name';
    if (!(total > 0)) return 'Add the total';
    if (!date) return 'Pick the date on the receipt';
    if (!paid) return 'Say how it was paid';
    if (!what) return 'Say what it was for';
    return '';
  }
  if (!String(vendor || '').trim()) return 'Add the shop name';
  if (!(total > 0)) return 'Add the total';
  if (!date) return 'Pick the date on the receipt';
  if (!paid) return 'Say how it was paid';
  if (!what) return 'Say what it was for';
  if (!validDest) return 'Pick the job, or no job';
  return '';
}

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
  const myBookings = useMyBookings();
  const expensesQ = useExpenses();
  const jobQ = useJob(jobId || null);

  const today = todayISO();
  const ownBookings = useMemo(() => (myBookings.bookings || []).filter((b) => b.mine && b.jobId && b.job), [myBookings.bookings]);
  const ownJobIds = useMemo(() => new Set(ownBookings.map((b) => b.jobId)), [ownBookings]);
  const ownJobs = useMemo(() => {
    const byId = new Map();
    for (const b of ownBookings) {
      const j = b.job;
      const rank = b.clockOn && !b.clockOff ? 0 : b.date === today ? 1 : b.date < today ? 2 : 3;
      const cur = byId.get(b.jobId);
      if (!cur || rank < cur.rank || (rank === cur.rank && String(b.date || '') > String(cur.date || ''))) {
        byId.set(b.jobId, {
          id: b.jobId, job_id: b.jobId, job_number: j.job_number || '', client_name: j.client_name || '',
          site_suburb: j.site_suburb || '', site_address: j.site_address || '', type: j.type || j.job_type || '',
          status: j.status || '', job_family: j.job_family || '', metadata: j.metadata,
          reason: rank === 0 ? 'You are clocked on there' : rank === 1 ? 'You are booked there today' : '',
          rank, date: b.date || ''
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.rank - b.rank || String(b.date).localeCompare(String(a.date)));
  }, [ownBookings, today]);

  const bookingsMalformed = Boolean(myBookings.data && !Array.isArray(myBookings.data.today));
  const bookingsFailed = Boolean(!user.office && ((myBookings.error && (!myBookings.data || !myBookings.error.offline)) || bookingsMalformed));
  const bookingsLoading = Boolean(!user.office && myBookings.loading && !myBookings.data);
  const allowPropJob = Boolean(jobId && !jobQ.locked && (user.office || ownJobIds.has(jobId)));
  const propJob = allowPropJob ? (jobQ.data && jobQ.data.job) || ownJobs.find((j) => j.id === jobId) || jobStub(jobId) || { id: jobId } : null;

  const [step, setStep] = useState('shoot'); // shoot | sending | check | done
  const [photo, setPhoto] = useState(null); // { blob, preview }
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState(null);
  const [expense, setExpense] = useState(null);
  const [suggestMeta, setSuggestMeta] = useState(null);
  const [f, setF] = useState({ vendor: '', date: '', total: '', gst: '', paid: null, what: null });
  const [dest, setDest] = useState(jobId ? { kind: 'job', id: jobId, via: 'manual_search' } : null);
  const [found, setFound] = useState([]); // jobs suggested by the server or picked in search
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedStep, setSavedStep] = useState('');
  const [savedV2, setSavedV2] = useState(false);
  const [savedReimbOn, setSavedReimbOn] = useState(false);
  const upload = useRef(null); const unsure = useRef(false); const picked = useRef(Boolean(jobId)); const suggested = useRef([]); const pickedOwnIds = useRef(new Set());
  const set = (k, v) => { setSaveError(''); setF((p) => ({ ...p, [k]: v })); };
  const v2 = spendCaptureEnabled({ expense, suggestData: suggestMeta, expensesData: expensesQ.data });

  useEffect(() => () => { if (photo && photo.preview) URL.revokeObjectURL(photo.preview); }, [photo]);
  useEffect(() => {
    if (dest && dest.kind === 'job' && dest.id === jobId && !pickedOwnIds.current.has(jobId) && (jobQ.locked || (!user.office && (bookingsFailed || (myBookings.data && !ownJobIds.has(jobId)))))) {
      picked.current = false;
      setDest(null);
    }
  }, [jobId, jobQ.locked, user.office, bookingsFailed, myBookings.data, ownJobIds, dest]);
  useEffect(() => {
    if (v2 && dest && dest.kind === 'no_job') setDest(null);
  }, [v2, dest]);

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
    return row ? { expense_id: row.id, extraction: { vendor_name: row.vendor_name, receipt_date: row.receipt_date, total_amount: row.total_amount, gst_amount: row.gst_amount, line_items: row.line_items }, routed_to: row.routed_to, status: row.status, spend_capture_v2: res && res.spend_capture_v2 } : null;
  };

  const send = async (shot, why) => {
    setStep('sending'); setProblem(null); setSaveError(''); setSuggestMeta(null);
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
        if (allowPropJob) body.job_id = jobId;
        if (poId) body.po_id = poId;
        try { made = await api('submit_expense', null, body, { timeout: 45000 }); } catch (err) { unsure.current = !(err instanceof ApiError && err.refused); throw err; }
      }
      if (!made || !made.expense_id) throw new ApiError('The receipt was not saved.', { status: 422, body: made || {} });
      unsure.current = false;
      const x = made.extraction || {};
      const parsedTotal = num(x.total_amount);
      setExpense({ ...made, hadJob: Boolean(allowPropJob) });
      setF({
        vendor: x.vendor_name || '',
        date: isISODate(x.receipt_date || '') && x.receipt_date.slice(0, 10) <= today ? x.receipt_date.slice(0, 10) : '',
        total: parsedTotal != null && parsedTotal > 0 ? String(x.total_amount) : '',
        gst: num(x.gst_amount) != null ? String(x.gst_amount) : '',
        paid: null,
        what: null
      });
      invalidate('expenses');
      setStep('check');
      api('suggest_job_for_expense', null, { merchant: x.vendor_name || '', receipt_date: x.receipt_date || '', total_amount: parsedTotal }).then((res) => {
        setSuggestMeta(res || null);
        const list = ((res && res.suggestions) || []).slice(0, 6);
        suggested.current = list;
        setFound((cur) => [...cur, ...list.filter((s) => s && s.job_id && !cur.some((c) => c.job_id === s.job_id))]);
        const v2Now = spendCaptureEnabled({ expense: made, suggestData: res, expensesData: expensesQ.data });
        const firstOwn = list.find((s) => s && (user.office || ownJobIds.has(s.job_id)));
        if (!v2Now && !picked.current && firstOwn) setDest({ kind: 'job', id: firstOwn.job_id, via: 'jarvis_top' });
      }).catch(() => {});
    } catch (err) {
      setProblem(err);
      setStep('shoot');
    }
  };

  const noReceipt = () => openOverlay((close) => html`<${NoReceiptSheet} onClose=${close} onSend=${(why) => { setPhoto(null); upload.current = null; unsure.current = false; setReason(why); send(null, why); }} />`);
  const findJob = () => openOverlay((close) => html`<${FindJobSheet} user=${user} ownJobIds=${ownJobIds} ownJobs=${ownJobs} onClose=${close} onPick=${(j) => {
    pickedOwnIds.current.add(j.id);
    setFound((cur) => (cur.some((c) => c.job_id === j.id) ? cur : [...cur, { job_id: j.id, job_number: j.job_number, client_name: j.client_name, site_suburb: j.site_suburb }]));
    picked.current = true; setSaveError(''); setDest({ kind: 'job', id: j.id, via: 'manual_search' });
  }} />`);

  const allowedJob = (jid) => Boolean(jid && (user.office || ownJobIds.has(jid) || pickedOwnIds.current.has(jid)));
  const options = [];
  if (propJob && allowedJob(propJob.id)) {
    options.push({ job_id: propJob.id, job_number: propJob.job_number, client_name: propJob.client_name, site_suburb: propJob.site_suburb, reason: 'The job you came from' });
  }
  for (const s of found) {
    if (!s || !allowedJob(s.job_id) || options.some((o) => o.job_id === s.job_id)) continue;
    const own = ownJobs.find((j) => j.id === s.job_id);
    options.push({
      job_id: s.job_id,
      job_number: s.job_number || (own && own.job_number) || '',
      client_name: s.client_name || (own && own.client_name) || '',
      site_suburb: s.site_suburb || (own && own.site_suburb) || '',
      reason: s.reason || (own && own.reason) || ''
    });
  }
  for (const own of ownJobs) {
    if (options.length >= 4) break;
    if (!options.some((o) => o.job_id === own.job_id)) options.push(own);
  }
  const divisions = useMemo(() => divisionsForUser(user, ownBookings), [user, ownBookings]);
  const chosen = dest && dest.kind === 'job' ? options.find((o) => o.job_id === dest.id) || ownJobs.find((o) => o.job_id === dest.id) || null : null;
  const total = num(f.total);
  const missing = missingReceiptField({
    v2,
    vendor: f.vendor,
    total,
    date: f.date,
    paid: f.paid,
    what: f.what,
    dest,
    jobAllowed: Boolean(dest && dest.kind === 'job' && allowedJob(dest.id))
  });

  const save = async () => {
    if (missing || saving) return;
    setSaving(true); setSaveError('');
    const items = ((expense.extraction && expense.extraction.line_items) || []).filter((li) => li && li.description);
    const sum = items.reduce((s, li) => s + (Number(li.total != null ? li.total : li.amount) || 0), 0);
    const label = (WHAT_FOR.find(([v]) => v === f.what) || [])[1] || 'Purchase';
    const ownSuggestions = user.office ? suggested.current : suggested.current.filter((s) => s && allowedJob(s.job_id));
    const hasJob = dest.kind === 'job';
    const body = v2
      ? {
          expense_id: expense.expense_id, vendor_name: f.vendor.trim(), receipt_date: f.date, total_amount: total, gst_amount: num(f.gst),
          line_items: items.length && Math.abs(sum - total) <= 1 ? items : [{ description: `${label}, ${f.vendor.trim()}`, quantity: 1, unit_price: total, total }],
          category: f.what, payment_method: f.paid, capture_version: 2,
          ...(hasJob ? { job_id: dest.id } : { stock_division: dest.division }),
          jarvis_job_suggestion: {
            suggestions: ownSuggestions,
            chosen: hasJob ? dest.id : '',
            chosen_via: hasJob ? dest.via : 'stock_' + dest.division
          }
        }
      : {
          expense_id: expense.expense_id, vendor_name: f.vendor.trim(), receipt_date: f.date, total_amount: total, gst_amount: num(f.gst),
          line_items: items.length && Math.abs(sum - total) <= 1 ? items : [{ description: `${label}, ${f.vendor.trim()}`, quantity: 1, unit_price: total, total }],
          category: f.what, payment_method: f.paid, job_id: hasJob ? dest.id : null,
          business_category: hasJob ? null : NO_JOB_HEADING[f.what] || 'other',
          jarvis_job_suggestion: {
            suggestions: ownSuggestions,
            chosen: hasJob ? dest.id : '',
            chosen_via: hasJob ? dest.via : 'general_business'
          }
        };
    try {
      const res = await api('update_expense', null, body);
      if (res && res.success === false) throw new ApiError(res.message || res.error || 'Not saved', { status: 409, body: res });
      let reimbOn = false;
      if (f.paid === 'personal_card') {
        const listed = await api('list_expenses', { limit: 100 }).catch(() => null);
        if (listed) primeQuery('expenses', listed, { persist: true });
        else invalidate('expenses');
        reimbOn = savedReceiptReimbursedOnInvoice({
          expensesData: listed,
          expenseId: expense.expense_id,
          res,
          hasPhoto: Boolean(photo || upload.current)
        });
      } else {
        invalidate('expenses');
      }
      setSavedV2(v2);
      setSavedReimbOn(Boolean(reimbOn));
      setSavedStep((res && res.next_step) || '');
      buzz([14, 60, 14, 60, 30]);
      setStep('done');
    } catch (err) {
      const words = serverWordsOf(err);
      setSaveError(words);
      if (!v2 || (err instanceof ApiError && err.offline)) toast(words, { kind: 'bad', ms: 6500 });
    }
    setSaving(false);
  };
  const again = () => {
    setPhoto(null); setReason(''); setExpense(null); setSuggestMeta(null); setProblem(null); setFound([]); setSaveError(''); setSavedStep(''); setSavedV2(false); setSavedReimbOn(false);
    upload.current = null; unsure.current = false; picked.current = Boolean(allowPropJob); suggested.current = []; pickedOwnIds.current = new Set();
    setDest(allowPropJob ? { kind: 'job', id: jobId, via: 'manual_search' } : null);
    setStep('shoot');
  };

  if (step === 'done') {
    const hasJob = Boolean(dest && dest.kind === 'job');
    const stockDiv = dest && dest.kind === 'stock' ? dest.division : '';
    const jobNum = chosen && chosen.job_number ? chosen.job_number : '';
    const sameRoute = expense.hadJob === hasJob;
    const checker = sameRoute ? who(expense.routed_to) : 'The office';
    const title = savedV2 ? 'Receipt saved' : 'Receipt sent';
    const lead = savedV2
      ? nextStepWords(savedStep, { jobNumber: jobNum || (chosen ? jobTitle(chosen) : ''), stockDivision: stockDiv, reimbursementOn: savedReimbOn })
      : f.paid === 'personal_card' && savedReimbOn
        ? 'Saved. It will be on your next invoice as a reimbursement.'
        : `${checker} checks it${chosen ? ` against ${jobTitle(chosen)}` : ''}. Nothing more for you to do.`;
    const showOutsideAppBanner = f.paid === 'personal_card' && !savedReimbOn;
    return html`<${DoneScreen} bar="Expenses" title=${title} lead=${lead}
      foot=${html`<${Button} block class="big" onClick=${() => back('/pay')}>Done<//>
        <${Button} kind="line" block onClick=${again}>Add another receipt<//>`}>
      <div class="card">
        <${KV} k=${f.vendor.trim()} v=${cash(total)} />
        <${KV} k="Paid with" v=${PAID_WORDS[f.paid]} />
        <${KV} k=${stockDiv ? 'Stock' : 'Job'} v=${stockDiv ? STOCK_LABEL[stockDiv] : chosen ? jobTitle(chosen) : 'No job'} />
      </div>
      ${showOutsideAppBanner ? html`<div class="note-banner plain"><span><span class="t-strong">Getting your money back.</span> Once it is approved, the office pays you back. That happens outside this app and is not part of your weekly invoice, so ask the office if it has not come through.</span></div>` : null}
      <button type="button" class="link tap pay-linkrow" onClick=${() => go('/pay/receipts', { replace: true })}>See the receipts you have sent</button>
    <//>`;
  }

  if (step === 'check') {
    const read = expense.extraction && (expense.extraction.vendor_name || num(expense.extraction.total_amount) != null);
    const yesterday = addDays(today, -1);
    const dateMode = f.date === today ? 'today' : f.date === yesterday ? 'yesterday' : f.date || f.otherDate ? 'other' : null;
    const foot = v2
      ? html`<${Button} block class="big" busy=${saving} disabled=${Boolean(missing)} onClick=${save}>Save receipt<//>
          ${saveError ? html`<p class="t-small t-bad" role="alert">${saveError}</p>`
            : missing ? html`<p class="t-small">${missing}</p>` : null}`
      : html`${saveError ? html`<p class="t-small t-bad" role="alert">${saveError}</p>`
          : missing ? html`<p class="t-small">${missing}</p>` : null}
          <${Button} block class="big" busy=${saving} disabled=${Boolean(missing)} onClick=${save}>Send receipt<//>`;
    return html`<${Page} title="Check the receipt" back="Back" onBack=${() => back('/pay')} foot=${foot}>
      <p class="block t-small pay-intro">${!photo ? 'No photo, so fill in what you paid.' : read ? 'This is what we read off your photo. Fix anything that is wrong.' : 'We could not read the photo. Fill in what you can see on it.'}</p>
      <div class="form pay-gap">
        ${photo ? html`<button type="button" class="card pay-shotrow" onClick=${() => openLightbox([{ url: photo.preview, label: 'Your receipt' }])}><img src=${photo.preview} alt="Your receipt" /><span><span class="t-strong">Your photo is saved</span><span class="t-small pay-noticesub">Tap to look at it</span></span></button>`
          : html`<div class="note-banner plain"><span>No receipt: ${reason}</span></div>`}
        <${Field} label="Shop"><input class="input" value=${f.vendor} placeholder="e.g. Bunnings" onInput=${(e) => set('vendor', e.currentTarget.value)} /><//>
        <div class="formgrid">
          <${Field} label="Total paid"><input class="input big" type="number" inputmode="decimal" min="0" step="0.01" placeholder="$" value=${f.total} onInput=${(e) => set('total', e.currentTarget.value)} /><//>
          <${Field} label="GST in that"><input class="input big" type="number" inputmode="decimal" min="0" step="0.01" placeholder="$" value=${f.gst} onInput=${(e) => set('gst', e.currentTarget.value)} /><//>
        </div>
        <${Field} label=${photo ? 'Date on the receipt' : 'Date you paid'}>
          <${Picks} value=${dateMode} options=${[['today', 'Today'], ['yesterday', 'Yesterday'], ['other', dateMode === 'other' && f.date ? fmtDay(f.date) : 'Another day']]} onChange=${(v) => { setSaveError(''); setF((p) => ({ ...p, otherDate: v === 'other', date: v === 'today' ? today : v === 'yesterday' ? yesterday : p.date === today || p.date === yesterday ? '' : p.date })); }} />
          ${dateMode === 'other' ? html`<input class="input" type="date" max=${today} value=${f.date} aria-label="Date on the receipt" onInput=${(e) => set('date', e.currentTarget.value > today ? '' : e.currentTarget.value)} />` : null}
        <//>
        <${Field} label="How was it paid?"><${Picks} value=${f.paid} options=${PAID_WITH} onChange=${(v) => set('paid', v)} /><//>
        <${Field} label="What was it for?"><${Picks} value=${f.what} options=${WHAT_FOR} onChange=${(v) => set('what', v)} /><//>
        <${Field} label="Which job?">
          ${bookingsLoading ? html`<${SkelRows} n=${2} />`
            : bookingsFailed ? html`<${LoadError} error=${myBookings.error || new Error('Could not load your jobs.')} onRetry=${myBookings.refetch} what="your jobs" />`
            : null}
          ${!v2 || options.length || user.office || !user.manager || bookingsFailed || bookingsLoading ? html`<div class="picks">
            ${options.map((o) => html`<button type="button" class="pick" key=${o.job_id} aria-pressed=${String(Boolean(dest && dest.kind === 'job' && dest.id === o.job_id))} onClick=${() => { picked.current = true; setSaveError(''); buzz(6); setDest({ kind: 'job', id: o.job_id, via: suggested.current[0] && suggested.current[0].job_id === o.job_id ? 'jarvis_top' : suggested.current.some((s) => s.job_id === o.job_id) ? 'jarvis_alt' : 'manual_search' }); }}>${jobTitle(o)}</button>`)}
            ${!v2 ? html`<button type="button" class="pick" aria-pressed=${String(Boolean(dest && dest.kind === 'no_job'))} onClick=${() => { picked.current = true; setSaveError(''); buzz(6); setDest({ kind: 'no_job', via: 'general_business' }); }}>No job, general business</button>` : null}
            <button type="button" class="pick" onClick=${findJob}>Another job</button>
          </div>` : html`<p class="t-small">You are not booked on a job yet.</p>`}
          ${chosen ? html`<span class="pay-chosen"><${JobTag} number=${chosen.job_number} /><span>${[chosen.client_name, chosen.reason].filter(Boolean).join(' · ')}</span></span>` : null}
        <//>
        ${v2 ? (divisions.length ? html`<${Field} label="Not for one job? Pick the stock:">
          <div class="picks">
            ${divisions.map(([div, label]) => html`<button type="button" class="pick" key=${div} aria-pressed=${String(Boolean(dest && dest.kind === 'stock' && dest.division === div))} onClick=${() => { picked.current = true; setSaveError(''); buzz(6); setDest({ kind: 'stock', division: div }); }}>${label}</button>`)}
          </div>
        <//>` : !ownJobs.length && !bookingsFailed && !bookingsLoading ? html`<div class="note-banner plain"><span>No jobs or divisions are set on your account yet. Ask the office to add you first.</span></div>` : null) : null}
      </div>
    <//>`;
  }

  const sending = step === 'sending';
  const offline = problem && problem.offline;
  const idle = !photo && !sending;
  return html`<${Page} title="Add a receipt" back="Back" onBack=${() => back('/pay')}
    foot=${idle ? html`<${Button} block class="big" onClick=${() => take(true)}>Take a photo of the receipt<//>`
      : problem && !sending ? html`<${Button} block class="big" onClick=${() => send(photo, reason)}>Try again<//>
          ${photo && !unsure.current ? html`<${Button} kind="line" block onClick=${() => take(true)}>Take the photo again<//>` : null}` : null}>
    <p class="block pay-intro">${propJob && propJob.id && jobTitle(propJob) !== 'Job' ? `For ${jobTitle(propJob)}. ` : ''}Bought something for work? Take a photo of the receipt and we read it for you. Get the whole receipt in, flat and in good light.</p>

    <div class="block pay-gap pay-stackgap">
      ${photo ? html`<div class=${cx('pay-shot', sending && 'busy')}><img src=${photo.preview} alt="Your receipt" />
          ${sending ? html`<span class="pay-shotstate"><i class="spin" />Reading your receipt</span>` : null}</div>`
        : sending ? html`<div class="pay-shot busy empty"><span class="pay-shotstate"><i class="spin" />Saving</span></div>` : null}
      ${problem && !sending ? html`<div class=${cx('note-banner', offline ? '' : 'bad')}><span><span class="t-strong">${offline ? 'No signal, so it has not sent.' : 'That did not send.'}</span> ${offline ? (photo ? 'Your photo is still here. Try again when you are back in range.' : 'Try again when you are back in range.') : friendly(problem)}</span></div>` : null}
      ${!online && !problem && !sending ? html`<p class="t-small">You have no signal right now. You can take the photo, and send it when you are back in range.</p>` : null}
    </div>

    ${idle ? html`<div class="block card pay-gap">
      <${KV} nav k="Use a photo I already took" v="" onClick=${() => take(false)} />
      <${KV} nav k="I do not have a receipt" v="" onClick=${noReceipt} />
      <${KV} nav k="Receipts I have sent" v="" onClick=${() => go('/pay/receipts')} />
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

function FindJobSheet({ user, ownJobIds, ownJobs, onPick, onClose }) {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 280); return () => clearTimeout(id); }, [q]);
  const search = useQuery(term.length >= 2 ? 'receipt-search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const results = useMemo(() => {
    const raw = (search.data && search.data.jobs) || [];
    const lens = search.data && search.data.lens;
    const kept = user.office
      ? raw
      : raw.filter((j) => {
          if (!j || !j.id) return false;
          if ('assigned_to_me' in j) return j.assigned_to_me === true;
          if (user.manager || lens === 'company') return ownJobIds.has(j.id);
          return true;
        });
    const seen = new Set(kept.map((j) => j.id));
    if (term.length >= 2) {
      const needle = term.toLowerCase().replace(/[\s-]+/g, '');
      for (const own of ownJobs || []) {
        if (seen.has(own.id)) continue;
        if ([own.job_number, own.client_name, own.site_suburb, own.site_address].some((v) => String(v || '').toLowerCase().replace(/[\s-]+/g, '').includes(needle))) {
          kept.push(own); seen.add(own.id);
        }
      }
    }
    return kept.slice(0, 12);
  }, [search.data, user, ownJobIds, ownJobs, term]);
  return html`<${Sheet} title="Which job was it for?" onClose=${onClose} tall>
    ${(shut) => html`<div class="stack">
      <div class="search"><${Icon} name="jobs" size=${20} /><input class="input" type="search" autofocus placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${term.length < 2 ? html`<p class="t-small">${user.office ? 'Search for the job. Finished jobs show too.' : 'Search your jobs. Finished jobs show too.'}</p>`
        : search.loading ? html`<${SkelRows} n=${3} />`
        : search.error && !results.length ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="your jobs" />`
        : !results.length ? html`<${Empty} title="No job found">Try the suburb or the job number.<//>`
        : html`<div class="pay-sheetlist">${results.map((j) => html`<button type="button" class="item" key=${j.id} onClick=${() => { onPick(j); buzz(6); shut(); }}>
            <span class="main"><b>${jobTitle(j)}</b><span class="sub">${j.client_name || ''}</span><${JobLine} job=${j} vertical=${verticalOf(j)} /></span></button>`)}</div>`}
    </div>`}
  <//>`;
}

// ------------------------------------------------------ receipts I have sent
export function Receipts() {
  const user = useStore((s) => s.user);
  const q = useExpenses();
  const reimbOn = reimbursementSwitchOn(q.data);
  const bad = (q.error && (!q.data || !q.error.offline)) || (q.data && !Array.isArray(q.data.expenses));
  const rows = mine(q.data && q.data.expenses, user).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const open = (e) => openOverlay((close) => html`<${ReceiptSheet} expense=${e} reimbOn=${reimbOn} onClose=${close} />`);
  return html`<${Page} title="Expenses" back="Pay" onBack=${() => back('/pay')}
    foot=${html`<${Button} block class="big" onClick=${() => go('/pay/receipt')}>Add a receipt<//>`}>
    <p class="block t-small pay-intro">Receipts you have sent, newest first. Each one is its own record.${reimbOn ? '' : ' What you paid for yourself is paid back separately, not on your invoice.'}</p>
    ${q.loading ? html`<${SkelRows} n=${4} />` : bad ? html`<${LoadError} error=${q.error || new Error('Could not load your receipts.')} onRetry=${q.refetch} what="your receipts" />`
      : !rows.length ? html`<${Empty} title="No receipts yet">When you buy something for work, take a photo of the receipt here and the office takes it from there.<//>`
      : html`<div class="block card pay-gap">${rows.map((e) => { const [status, words] = statusOf(e); return html`<button type="button" class="item pay-inv" key=${e.id} onClick=${() => open(e)}>
          <span class="main"><b>${e.vendor_name || 'Receipt'}</b>
            <span class="sub t-num">${[e.receipt_date ? fmtDate(e.receipt_date.slice(0, 10)) : e.created_at ? fmtDate(tsToDate(e.created_at)) : '', words].filter(Boolean).join(' · ')}</span>
            ${e.jobs ? html`<${JobLine} job=${e.jobs}>${e.jobs.site_suburb || e.jobs.client_name || ''}<//>` : html`<span class="sub">${STOCK_LABEL[e.stock_division] || 'No job'}</span>`}</span>
          <span class="side"><span class="pay-figure">${num(e.total_amount) != null ? cash(e.total_amount) : 'Not read'}</span><${StatusBadge} status=${status} /></span></button>`; })}</div>`}
  <//>`;
}

function ReceiptSheet({ expense: e, reimbOn = false, onClose }) {
  const [badge] = statusOf(e);
  const status = String(e.status || '').toLowerCase();
  const say = status === 'queried' ? e.query_reason : status === 'rejected' ? e.rejection_reason : '';
  const next = status === 'queried' ? 'The office needs something from you before they can approve it. Give them a call.'
    : status === 'rejected' ? 'The office did not accept this one. Call them if you think that is wrong.'
    : status === 'pending_extraction' ? 'We are still reading the photo. Nothing for you to do.'
    : status === 'approved' || status === 'pushed_to_xero' ? (e.payment_method === 'personal_card' && !reimbOn ? 'Approved. The office pays you back outside this app, so ask them if it has not come through.' : 'Approved. Nothing more for you to do.')
    : `${who(e.routed_to)} is checking it. Nothing for you to do.`;
  return html`<${Sheet} title=${e.vendor_name || 'Receipt'} sub=${e.created_at ? 'Sent ' + fmtDate(tsToDate(e.created_at)) : ''} onClose=${onClose}>
    <div class="stack">
      <div class="card pay-out"><${StatusBadge} status=${badge} /><b class="t-figure">${num(e.total_amount) != null ? cash(e.total_amount) : 'No total'}</b></div>
      <p>${next}</p>
      ${say ? html`<div class="note-banner bad"><span><span class="t-strong">From the office</span><span class="pay-noticesub">${say}</span></span></div>` : null}
      <div class="card">
        <${KV} k="Date on it" v=${e.receipt_date ? fmtDate(e.receipt_date.slice(0, 10)) : 'Not known'} />
        <${KV} k=${e.stock_division ? 'Stock' : 'Job'} v=${e.jobs ? html`<${JobLine} job=${e.jobs}>${e.jobs.site_suburb || e.jobs.client_name || ''}<//>` : STOCK_LABEL[e.stock_division] || 'No job'} />
        <${KV} k="Paid with" v=${PAID_WORDS[e.payment_method] || 'Not said'} />
        ${num(e.gst_amount) ? html`<${KV} k="GST in it" v=${cash(e.gst_amount)} />` : null}
      </div>
      ${e.receipt_photo_url ? html`<button type="button" class="card pay-shotrow" onClick=${() => openLightbox([{ url: e.receipt_photo_url, label: e.vendor_name || 'Receipt' }])}><img src=${e.receipt_photo_url} alt="Receipt" /><span><span class="t-strong">The photo you sent</span><span class="t-small pay-noticesub">Tap to look at it</span></span></button>`
        : e.no_receipt_reason ? html`<p class="t-small">No receipt: ${e.no_receipt_reason}</p>` : null}
    </div>
  <//>`;
}
