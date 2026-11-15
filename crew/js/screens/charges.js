// For the person leading a job: what other crew billed on it. Approve it,
// change the amount, or say something is not right. What is approved can then
// come off the lead's own work order for that job.
import { html, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, invalidate } from '../lib/store.js';
import { back } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtDay } from '../lib/dates.js';
import { Page, Section, JobLine, StatusBadge, Button, Sheet, Field, SkelRows, Empty, LoadError, toast, openOverlay, buzz } from '../ui/kit.js';
import { whenWords, cash, hrs, num } from '../ui/paybits.js';

/** The last four weeks, from a Monday (the server matches on the Monday). */
export function useCharges() {
  return useQuery('charges', () => api('crew_charges_on_my_jobs', { week_start: addDays(mondayOf(todayISO()), -28) }, null, { keepSession: true }), { ttl: 60000 });
}
const stateOf = (c) => String(c.acknowledgment_status || 'pending').toLowerCase();
export const needsCheck = (c) => !['acknowledged', 'queried'].includes(stateOf(c));
const dayOf = (c) => String(c.work_date || c.line_date || '').slice(0, 10);
const billed = (c) => (num(c.override_amount) != null ? num(c.override_amount) : num(c.line_total_ex));

export function Charges() {
  const q = useCharges();
  const all = ((q.data && q.data.charges) || []).slice().sort((a, b) => dayOf(b).localeCompare(dayOf(a)));
  const todo = all.filter(needsCheck);
  const done = all.filter((c) => !needsCheck(c));
  const open = (c) => openOverlay((close) => html`<${ChargeSheet} charge=${c} onClose=${close} />`);
  const row = (c) => {
    const s = stateOf(c);
    return html`<button type="button" class="item pay-inv" key=${c.line_id} onClick=${() => open(c)}>
      <span class="main"><b>${c.trade_name || 'Crew'}</b>
        <span class="sub t-num">${[dayOf(c) ? fmtDay(dayOf(c)) : '', whenWords(c)].filter(Boolean).join(' · ')}</span>
        <${JobLine} job=${c}>${c.description && !/^labour$/i.test(c.description) ? c.description : ''}<//>
        ${s === 'acknowledged' && num(c.override_amount) != null ? html`<span class="sub">You changed the amount</span>` : s === 'queried' ? html`<span class="sub">With the office to sort out</span>` : null}</span>
      <span class="side"><span class="pay-figure">${billed(c) != null ? cash(billed(c)) : num(c.total_hours) ? hrs(c.total_hours) : ''}</span>
        ${billed(c) != null && num(c.total_hours) ? html`<span class="t-small t-num">${hrs(c.total_hours)}</span>` : null}
        <${StatusBadge} status=${s === 'acknowledged' ? 'approved' : s === 'queried' ? 'waiting' : 'to_confirm'} /></span>
    </button>`;
  };
  return html`<${Page} title="Crew hours to check" back="Pay" onBack=${() => back('/pay')}>
    <p class="block t-small pay-intro">What other crew billed on jobs you lead. Check each one. What you approve can come off your work order for that job.</p>
    ${q.loading ? html`<${SkelRows} n=${3} />` : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="the crew lines" />`
      : !all.length ? html`<${Empty} title="Nothing to check">When someone bills time on a job you lead, it shows here for you to check.<//>` : html`
        ${todo.length ? html`<${Section} label="To check" right=${html`<span class="t-small t-num">${todo.length}</span>`}><div class="block card">${todo.map(row)}</div><//>`
          : html`<div class="block note-banner ok pay-gap"><span>All checked. Nothing is waiting on you.</span></div>`}
        ${done.length ? html`<${Section} label="Checked"><div class="block card">${done.map(row)}</div><//>` : null}`}
  <//>`;
}

function ChargeSheet({ charge: c, onClose }) {
  const [mode, setMode] = useState('view'); // view | adjust | ask
  const [amount, setAmount] = useState(billed(c) != null ? String(billed(c)) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const s = stateOf(c);
  const send = async (action, shut) => {
    const body = { line_id: c.line_id, action };
    if (action === 'adjust') { body.override_amount = Number(amount); if (note.trim()) body.note = note.trim(); }
    if (action === 'reject') body.note = note.trim();
    setBusy(action);
    try {
      const res = await api('review_crew_charge', null, body);
      if (res && res.success === false) throw new ApiError(res.error || 'Not saved', { status: 409, body: res });
      invalidate('charges'); invalidate('wos');
      buzz(10);
      toast(action === 'approve' ? 'Approved.' : action === 'adjust' ? `Approved at ${cash(Number(amount))}.` : 'Sent to the office to sort out.', { kind: 'ok' });
      shut();
    } catch (err) { setBusy(''); toast(friendly(err), { kind: 'bad', ms: 6500 }); }
  };
  const amountOk = amount !== '' && Number(amount) >= 0 && !isNaN(Number(amount));
  return html`<${Sheet} title=${c.trade_name || 'Crew'} sub=${dayOf(c) ? fmtDay(dayOf(c)) : ''} onClose=${onClose}
    foot=${(shut) => (mode === 'adjust' ? html`<${Button} block busy=${busy === 'adjust'} disabled=${!amountOk} onClick=${() => send('adjust', shut)}>${amountOk ? `Approve at ${cash(Number(amount))}` : 'Approve at this amount'}<//><${Button} kind="quiet" block onClick=${() => setMode('view')}>Back<//>`
      : mode === 'ask' ? html`<${Button} block busy=${busy === 'reject'} disabled=${note.trim().length < 3} onClick=${() => send('reject', shut)}>Send to the office<//><${Button} kind="quiet" block onClick=${() => setMode('view')}>Back<//>`
      : html`<${Button} block busy=${busy === 'approve'} onClick=${() => send('approve', shut)}>${s === 'acknowledged' ? 'Approve as billed' : 'Approve'}<//>
        <div class="btnrow">${num(c.line_total_ex) != null ? html`<${Button} kind="line" onClick=${() => setMode('adjust')}>Change amount<//>` : null}<${Button} kind="line" onClick=${() => setMode('ask')}>Not right<//></div>`)}>
    <div class="stack">
      ${s === 'acknowledged' ? html`<div class="note-banner ok"><span>You approved this${num(c.override_amount) != null ? ` at ${cash(c.override_amount)}` : ''}. You can change your answer below.</span></div>` : s === 'queried' ? html`<div class="note-banner"><span>You said this was not right${c.override_note ? `: "${c.override_note}"` : ''}. The office is sorting it out.</span></div>` : null}
      <${JobLine} job=${c} />
      <div class="card pay-sum">
        ${whenWords(c) ? html`<div class="pay-sumrow words"><span>Times</span><span>${whenWords(c)}</span></div>` : null}
        ${num(c.total_hours) ? html`<div class="pay-sumrow"><span>Hours</span><span>${hrs(c.total_hours)}</span></div>` : null}
        ${num(c.line_total_ex) != null ? html`<div class="pay-sumrow"><span>They billed</span><span>${cash(c.line_total_ex)}</span></div>` : null}
        ${num(c.override_amount) != null ? html`<div class="pay-sumrow"><span>You changed it to</span><span>${cash(c.override_amount)}</span></div>` : null}
      </div>
      ${c.description && !/^labour$/i.test(c.description) ? html`<p>${c.description}</p>` : null}
      ${mode === 'adjust' ? html`
        <${Field} label="Amount to approve (before GST)"><input class="input big" type="number" inputmode="decimal" min="0" step="0.01" autofocus value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} /><//>
        <${Field} label="Why (optional)"><input class="input" value=${note} placeholder="e.g. Left at lunch" onInput=${(e) => setNote(e.currentTarget.value)} /><//>` : null}
      ${mode === 'ask' ? html`<${Field} label="What is not right?" hint="This goes to the office, and the line is held until it is sorted."><textarea class="input" autofocus placeholder="e.g. They were not on site that day" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} /><//>` : null}
    </div>
  <//>`;
}
