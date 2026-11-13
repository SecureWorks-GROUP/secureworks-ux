// Work orders: a set amount for a job, agreed with the office. See each one,
// what it pays, and send the invoice for one that is finished. The office
// system prices it; nothing typed here changes the amount.
import { html, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, invalidate, primeQuery } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { mondayOf, fmtDate, fmtMoney, tsToDate } from '../lib/dates.js';
import { verticalOf } from '../lib/model.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Chip, Tag, Toggle, Skel, SkelRows, Empty, LoadError, toast, ask, buzz } from '../ui/kit.js';
import { DoneScreen, PayRows, superNote, sendLanded, cash, num } from '../ui/paybits.js';
import { useCharges, needsCheck } from './charges.js';

const STATUS = { draft: 'Being set up', sent: 'Sent to you', accepted: 'Accepted', approved: 'Agreed', in_progress: 'In progress', complete: 'Finished', completed: 'Finished', cancelled: 'Cancelled' };
const fetchMine = () => api('my_work_orders', { mode: 'mine' });
const titleOf = (w) => w.site_suburb || (w.site_address ? String(w.site_address).split(',')[0] : '') || w.client_name || w.job_number || 'Work order';
const chargeId = (c) => c.line_id || c.source_line_id || c.id;
const chargeAmt = (c) => Math.abs(Number(c.amount_ex != null ? c.amount_ex : c.amount) || 0);

function facts(w, user) {
  const own = !w.assigned_user_id || w.assigned_user_id === user.id;
  const money = num(w.subtotal) != null && (own || user.seesMoney);
  const ready = money && own && w.can_invoice === true && w.can_invoice_direct !== false && w.already_invoiced !== true;
  return { own, money, ready };
}
/** [short words, chip kind, a sentence that says what to do] */
function stateOf(w, user) {
  const { own, money, ready } = facts(w, user);
  const block = w.invoice_block_reason; const direct = w.direct_invoice_block_reason;
  if (w.already_invoiced === true || block === 'invoiced') return ['Invoiced', 'ok', 'This work order is already invoiced.'];
  if (ready) return ['Ready to invoice', 'hi', ''];
  if (!own) return [`${w.assigned_user_name || 'Someone else'}'s`, '', 'This work order belongs to someone else. Its pay is between them and the office.'];
  if (!money) return ['Agreed for the job', '', 'This is what is agreed for the job. It is not invoiced from here: bill your time on your weekly invoice or the crew work order.'];
  if (block === 'weekly_draft') return ['On your weekly invoice', 'warn', 'This one is already on a weekly invoice you started. Send it from there.'];
  if (block === 'other_trade_draft') return ['On another invoice', 'warn', 'Someone else has this work order on their invoice. Ask the office to sort it out.'];
  if (block === 'completion_evidence') return ['Needs finish photos', 'warn', 'Add the finished photos on the job, then it can be invoiced.'];
  if (block === 'client_signoff') return ['Needs a signature', 'warn', 'The customer has to sign the job off before this can be invoiced.'];
  if (direct === 'work_order_not_complete') return ['Not finished yet', '', 'It can be invoiced once it is marked finished. Ask the office to mark it finished when the job is done.'];
  if (direct === 'work_order_no_finish_date') return ['No finish day', '', 'It has no finish day yet. Ask the office to add one, then it can be invoiced.'];
  if (w.can_add_to_weekly_invoice === true) return ['On your weekly invoice', 'hi', 'This one goes on your weekly invoice, not by itself.'];
  return [STATUS[String(w.status || '').toLowerCase()] || 'Not ready yet', '', 'Not ready to invoice yet. The job is not finished.'];
}

export function WorkOrders({ openId }) {
  const user = useStore((s) => s.user);
  const q = useQuery('wos', fetchMine, { ttl: 60000 });
  const charges = useCharges();
  const [off, setOff] = useState([]); // crew amounts the lead chose NOT to take off
  const [gst, setGst] = useState(user.gstDefault);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const list = (q.data && q.data.work_orders) || [];
  const toCheck = ((charges.data && charges.data.charges) || []).filter(needsCheck).length;
  const anyCharges = ((charges.data && charges.data.charges) || []).length > 0;

  if (result) return html`<${WoSent} res=${result.res} wo=${result.wo} />`;

  // ------------------------------------------------------------- the list
  if (!openId) {
    const rows = list.map((w) => ({ w, f: facts(w, user), s: stateOf(w, user) }));
    const ready = rows.filter((r) => r.f.ready);
    const paid = rows.filter((r) => !r.f.ready && r.f.money);
    const plain = rows.filter((r) => !r.f.money);
    const row = ({ w, f, s }) => html`<button type="button" class="row" key=${w.id} onClick=${() => go('/pay/work-orders/' + w.id)}>
      <span class="main" style="grid-column:1"><b>${titleOf(w)}</b><span>${[w.wo_number, w.client_name].filter(Boolean).join(' · ')}</span></span>
      <span style="text-align:right;display:grid;gap:4px;justify-items:end">${f.money ? html`<span class="t-num" style="font-size:20px">${cash(w.subtotal)}</span>` : null}<${Chip} kind=${s[1]}>${s[0]}<//></span>
      <span class="trail"><${Icon} name="right" size=${18} /></span></button>`;
    return html`<${Page} title="Work orders" onBack=${() => back('/pay')}>
      <header class="block"><h1 class="t-display">Work orders</h1>
        <p class="t-small" style="margin-top:8px">A set amount for a job, agreed with the office. Amounts are before GST.</p></header>
      ${anyCharges ? html`<button type="button" class=${'block note-banner linkbanner ' + (toCheck ? '' : 'plain')} onClick=${() => go('/pay/charges')}>
        <${Icon} name="users" size=${18} /><span><span class="t-strong">Crew on my jobs</span><span style="display:block">${toCheck ? `${toCheck} ${toCheck === 1 ? 'line' : 'lines'} from other crew to check` : 'What other crew billed on jobs you lead'}</span></span><${Icon} name="right" size=${18} /></button>` : null}
      ${q.loading ? html`<${SkelRows} n=${3} />` : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your work orders" />`
        : !list.length ? html`<${Empty} title="No work orders yet">When the office sets up a work order for a job you are on, it shows here with what it pays and when you can invoice it.<//>` : html`
          ${ready.length ? html`<section class="section"><span class="t-label">Ready to invoice</span><div class="list ruled">${ready.map(row)}</div></section>` : null}
          ${paid.length ? html`<section class="section"><span class="t-label">${ready.length ? 'The rest' : 'Your work orders'}</span><div class="list ruled">${paid.map(row)}</div></section>` : null}
          ${plain.length ? html`<section class="section"><span class="t-label">What is agreed for each job</span><div class="list ruled">${plain.map(row)}</div></section>` : null}
          ${q.data && (q.data.truncated || q.data.next_offset) ? html`<p class="block t-small t-mute" style="margin-top:12px">Showing your newest ${list.length}. Ask the office about an older one.</p>` : null}`}
    <//>`;
  }

  // ------------------------------------------------------------ one of them
  const w = list.find((x) => x.id === openId) || null;
  if (!w) {
    return html`<${Page} title="Work order" onBack=${() => back('/pay/work-orders')}>
      ${q.loading ? html`<div class="block" style="display:grid;gap:14px;margin-top:6px"><${Skel} w="50%" h=${40} /><${Skel} w="70%" h=${60} r=${14} /></div><${SkelRows} n=${3} />`
        : q.error && !q.data ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this work order" />`
        : html`<${Empty} title="That work order is not here" action=${html`<${Button} kind="line" small onClick=${() => go('/pay/work-orders', { replace: true })}>See your work orders<//>`}>It may have been changed at the office.<//>`}
    <//>`;
  }

  const f = facts(w, user);
  const [words, kind, sentence] = stateOf(w, user);
  const items = w.scope_items || [];
  const crewLines = f.ready ? (w.negative_charges || []).filter((c) => chargeId(c) && chargeAmt(c) > 0) : [];
  const taken = crewLines.filter((c) => !off.includes(chargeId(c)));
  const takenTotal = Math.round(taken.reduce((s, c) => s + chargeAmt(c), 0) * 100) / 100;
  const estimate = Math.round((Number(w.subtotal) - takenTotal) * 100) / 100;
  const doneDay = w.completed_at || w.completed_date || w.scheduled_date;

  const send = async () => {
    if (busy) return;
    if (!navigator.onLine) { toast('No signal. Send it when you are back in range.', { kind: 'bad' }); return; }
    const ok = await ask({ title: `Invoice ${w.wo_number || 'this work order'}?`, body: `${taken.length ? 'About ' + cash(estimate) : cash(w.subtotal)} before super and GST, for ${titleOf(w)}. It cannot be changed after it is sent.`, yes: 'Send invoice' });
    if (!ok) return;
    setBusy(true);
    const find = (res) => ((res && res.work_orders) || []).find((x) => x.id === w.id) || null;
    // Read it again first, so we never invoice an amount the office has since changed.
    let fresh;
    try { const again = await fetchMine(); primeQuery('wos', again); fresh = find(again); } catch (err) { setBusy(false); toast(friendly(err) + ' Nothing was sent.', { kind: 'bad', ms: 6500 }); return; }
    const ids = taken.map(chargeId);
    const still = fresh ? (fresh.negative_charges || []).map(chargeId) : [];
    if (!fresh || !facts(fresh, user).ready || Number(fresh.subtotal) !== Number(w.subtotal) || ids.some((id) => !still.includes(id))) {
      setBusy(false); toast('This work order changed at the office. We have read it again: check it and send again.', { kind: 'bad', ms: 7000 }); return;
    }
    try {
      const res = await api('submit_work_order_invoice', null, { work_order_id: w.id, gst_on: Boolean(gst), negative_charge_line_ids: ids }, { timeout: 45000 });
      if (!sendLanded(res)) throw new ApiError((res && (res.userMessage || res.error)) || 'The invoice was not saved.', { status: 422, code: res && res.code, body: res || {} });
      invalidate('wos'); invalidate('invoices'); invalidate('money'); invalidate('hours'); invalidate('charges');
      buzz([14, 60, 14, 60, 30]);
      setResult({ res, wo: w });
    } catch (err) {
      if (err instanceof ApiError && err.refused) toast(friendly(err) + ' Nothing was sent.', { kind: 'bad', ms: 7000 });
      else {
        // We do not know if it landed. Never send twice: look for it.
        try {
          const again = await fetchMine(); primeQuery('wos', again);
          const now = find(again);
          invalidate('invoices'); invalidate('money');
          if (now && now.already_invoiced === true) toast('It did go through. It shows as invoiced now.', { kind: 'ok', ms: 5000 });
          else toast('It did not send. Check your signal and try again.', { kind: 'bad', ms: 6000 });
        } catch { toast('No signal, so we cannot tell if it sent. Check this work order when you are back in range before sending again.', { kind: 'bad', ms: 8000 }); }
      }
    }
    setBusy(false);
  };

  return html`<${Page} title=${titleOf(w)} class="paycol" onBack=${() => back('/pay/work-orders')}>
    <header class="block invhead">
      <div><span class="t-label">Work order${w.wo_number ? ' ' + w.wo_number : ''}</span><h1 class="t-title invtitle">${titleOf(w)}</h1>
        <p class="t-small" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center"><${Tag} vertical=${verticalOf({ type: w.job_type, job_family: w.job_family, job_number: w.job_number }, w)} /><span>${[w.job_number, w.client_name].filter(Boolean).join(' · ')}</span></p></div>
      <${Chip} kind=${kind}>${words}<//>
    </header>

    ${f.money ? html`<section class="block paytop">
      <span class="t-label">This work order pays</span>
      <span class="money xl">${cash(w.subtotal)}</span>
      <p>Before GST and super${doneDay && /complete/.test(String(w.status)) ? `. Finished ${fmtDate(tsToDate(doneDay) || String(doneDay).slice(0, 10))}` : ''}.</p>
    </section>` : null}

    ${!f.ready ? html`<div class="block note-banner plain" style="margin-top:16px"><${Icon} name="info" size=${18} /><span>${w.direct_invoice_block_message || sentence}</span></div>` : null}
    ${!f.ready && f.own && f.money && (w.can_add_to_weekly_invoice === true || w.invoice_block_reason === 'weekly_draft') ? html`<div class="block" style="margin-top:10px"><${Button} kind="line" block onClick=${() => go('/pay/week/' + mondayOf(String(w.hours_week_ending || doneDay || '').slice(0, 10) || tsToDate(new Date())))}>Open the weekly invoice<//></div>` : null}
    ${!f.ready && f.own && w.job_id && ['completion_evidence', 'client_signoff'].includes(w.invoice_block_reason) ? html`<div class="block" style="margin-top:10px"><${Button} kind="line" block onClick=${() => go('/job/' + w.job_id)}>Open the job<//></div>` : null}

    ${items.length ? html`<section class="daygroup"><span class="t-label"><span>What it covers</span></span>
      ${items.map((it, i) => { const qty = it.quantity != null ? it.quantity : it.qty; const amt = num(it.total != null ? it.total : it.amount); return html`<div class="line still" key=${i}>
        <span><b>${it.description || it.name || 'Item'}</b>
          <span class="how">${[[qty != null ? `${qty} ${it.unit || ''}`.trim() : '', f.money && num(it.rate) ? 'at ' + fmtMoney(it.rate) : ''].filter(Boolean).join(' '), !f.money && num(it.hours) ? `about ${it.hours} h` : ''].filter(Boolean).join(', ')}</span></span>
        <span class="amt">${f.money && amt != null ? cash(amt) : ''}</span></div>`; })}
    </section>` : null}

    ${crewLines.length ? html`<section class="block" style="margin-top:22px;display:grid;gap:6px">
      <span class="t-label">Crew already billed on this job</span>
      <p class="t-small">You approved these. Leave one on and it comes off this work order: they bill the company themselves, so nobody is paid twice.</p>
      ${crewLines.map((c) => html`<${Toggle} key=${chargeId(c)} label=${`${c.trade_name || 'Crew'} · ${cash(chargeAmt(c))}`} hint=${c.description || 'Take this off my work order'} checked=${!off.includes(chargeId(c))} onChange=${(on) => setOff((cur) => (on ? cur.filter((x) => x !== chargeId(c)) : [...cur, chargeId(c)]))} />`)}
    </section>` : null}

    ${f.ready ? html`<section class="block" style="margin-top:18px;display:grid;gap:16px">
      <${Toggle} label="Add GST" hint="Only if you are registered for GST." checked=${gst} onChange=${setGst} />
      ${taken.length ? html`<div class="inset"><div class="sumrows">
        <div class="sumrow"><span>Work order</span><span>${cash(w.subtotal)}</span></div>
        <div class="sumrow"><span>Crew taken off</span><span>-${cash(takenTotal)}</span></div>
        <div class="sumrow total"><span>You invoice about</span><span>${cash(estimate)}</span></div>
      </div><p class="t-small t-mute" style="margin-top:10px">An estimate, before super and GST. The office system works out the exact figures when you send.</p></div>` : null}
    </section>
    <div class="dock"><${Button} block busy=${busy} onClick=${send}>Invoice this work order · ${taken.length ? 'about ' : ''}${cash(taken.length ? estimate : w.subtotal)}<//></div>` : null}
  <//>`;
}

function WoSent({ res, wo }) {
  const held = res.office_review === 'held';
  const later = res.code === 'XERO_PUSH_FAILED';
  const off = num(res.negative_charge_total_ex);
  return html`<${DoneScreen} title=${later ? 'Invoice saved' : 'Invoice sent'}
    lead=${held ? 'The office is checking a line on it. You are paid once they approve it.' : later ? 'It is saved. The office will finish sending it to the bookkeeper. You do not need to do anything.' : 'It is with the bookkeeper. You are paid on the usual pay run.'}>
    ${num(res.trade_payable) != null || num(res.gross_earned) != null ? html`<section class="inset"><${PayRows} m=${res} />
      ${superNote(res) ? html`<p class="t-small t-mute" style="margin-top:10px">${superNote(res)}</p>` : null}</section>` : null}
    ${off ? html`<p class="t-small">${cash(Math.abs(off))} of crew pay was taken off this work order. They bill the company themselves.</p>` : null}
    <p class="t-small t-mute t-num">${[res.xero_bill_number || res.invoice_number, wo.wo_number, titleOf(wo)].filter(Boolean).join(' · ')}</p>
    <${Button} block onClick=${() => go('/pay', { replace: true })}>Done<//>
  <//>`;
}
