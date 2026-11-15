// The invoice for one pay week: the timesheet priced by each job's pay type.
// Checked here, then sent once. Every figure on this screen is an estimate
// until the office system answers the send with its own.
import { html, useEffect, useRef, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { local, invalidate } from '../lib/store.js';
import { go, back, useRoute } from '../lib/router.js';
import { fmtWeek, fmtDow, fmtDom, fmtDate, addDays, hoursBetween, tsToDate } from '../lib/dates.js';
import { lineHours, lineAmount, lineProblem, buildSubmit, invoiceForWeek, helpersTotal, UNKNOWN_MODE_WORDS } from '../lib/invoice.js';
import { bookMyself } from '../lib/data.js';
import { Page, Button, StatusBadge, Field, Toggle, SkelRows, LoadError, toast, ask, buzz } from '../ui/kit.js';
import { cash, hrs, plural, weekWords, PayGroup, PayLine, PayRows, DoneScreen, superNote, num } from '../ui/paybits.js';
import { useWeek, openAddOther } from './timesheet.js';
import { useExpenses, groupWords } from './pay.js';

const round2 = (n) => Math.round(n * 100) / 100;
const dayWords = (d) => (d ? `${fmtDow(d)} ${fmtDom(d)}` : '');
const EXPENSE_STATE = { pending_extraction: 'being read', pending: 'with the office', approved: 'approved', queried: 'the office has a question', rejected: 'not accepted', pushed_to_xero: 'approved' };

export function Review({ monday: mondayParam }) {
  const w = useWeek(mondayParam);
  const route = useRoute();
  const { user, monday, hours, data, live, sentBack, lines, groups, gstOn, deduction, est, ctx, problems, draft, setDraft } = w;
  const expenses = useExpenses();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const done = useRef(false);
  // One invoice a week: a week that is already sent opens the invoice itself.
  useEffect(() => { if (live && !done.current) go('/pay/invoice/' + live.id, { replace: true }); }, [live && live.id]);

  const send = async () => {
    if (problems.length || !est.count || w.foreign) return;
    const left = est.ahead + est.unknown;
    const ok = await ask({ title: `Send your invoice for ${fmtWeek(monday)}?`, body: `About ${cash(est.pay)} to you. You can send one invoice a week, and you cannot change it after it is sent, so check it is all there.${est.ahead ? ` ${est.ahead === 1 ? 'One job later this week is' : est.ahead + ' jobs later this week are'} not on it. If you work ${est.ahead === 1 ? 'it' : 'them'}, send after that instead, or add ${est.ahead === 1 ? 'it' : 'them'} to next week.` : ''}${est.unknown ? ` ${plural(est.unknown, 'job')} ${est.unknown === 1 ? 'is' : 'are'} left off until the office says how ${est.unknown === 1 ? 'it is' : 'they are'} billed.` : ''}`, yes: left ? 'Send it without them' : 'Send invoice' });
    if (!ok) return;
    setSending(true);
    const body = buildSubmit(lines, { monday, gstOn, notes: draft.notes, rateEditable: w.rateEditable });
    try {
      const res = await api('generate_trade_invoice', null, body, { timeout: 45000 });
      if (res && res.already_submitted) throw new ApiError(res.userMessage || 'This week already has an invoice.', { status: 409, code: 'WEEK_ALREADY_INVOICED', body: res });
      if (!res || (res.success !== true && res.ok !== true)) throw new ApiError((res && (res.userMessage || res.error)) || 'The invoice was not saved.', { status: 422, code: res && res.code, body: res });
      done.current = true;
      w.sent();
      invalidate('invoices'); invalidate('hours'); invalidate('money');
      buzz([14, 60, 14, 60, 30]);
      setResult(res);
    } catch (err) { await sendFailed(err, body); }
    setSending(false);
  };
  const sendFailed = async (err, body) => {
    const code = (err.body && err.body.code) || err.code;
    if (!(err instanceof ApiError) || err.offline || !err.status || err.status >= 500 && !err.refused) {
      // We do not know if it landed. Never send twice: look for it.
      try {
        const again = await api('my_trade_invoices');
        const landed = invoiceForWeek(again.invoices || [], monday);
        invalidate('invoices');
        if (landed) { done.current = true; w.sent(); local.del('week:' + monday); toast('It did go through. Here it is.', { kind: 'ok' }); go('/pay/invoice/' + landed.id, { replace: true }); return; }
        toast('It did not send. Check your signal and press Send again.', { kind: 'bad', ms: 6000 });
      } catch { toast('No signal, so we cannot tell if it sent. Check Pay when you are back in range before sending again.', { kind: 'bad', ms: 8000 }); }
      return;
    }
    if (code === 'WEEK_ALREADY_INVOICED') { invalidate('invoices'); toast('This week already has an invoice, so this one was not saved.', { kind: 'bad', ms: 6000 }); return; }
    if (code === 'extra_job_not_allowed') {
      const names = (err.body.jobs || []).join(', ');
      const pairs = body.extra_items.filter((x) => x.job_id && (err.body.jobs || []).some((j) => String(j).toLowerCase() === String(x.job_number || x.job_id).toLowerCase())).map((x) => [x.job_id, x.work_date || x.date]);
      if (pairs.length && await ask({ title: `Add yourself to ${names}?`, body: 'You are not booked on it, so the invoice was not sent. Add yourself for the day you worked and it will send. The office will see you added yourself.', yes: 'Add me and send' })) {
        for (const [jobId, d] of pairs) { const r = await bookMyself(jobId, [d]); if (!r.ok) { toast(r.message, { kind: 'bad' }); return; } }
        await hours.refetch(); toast('You are on it now. Check the invoice and press Send again.');
      } else if (!pairs.length) toast(`You are not booked on ${names}. Ask the office to add you, then send again.`, { kind: 'bad', ms: 7000 });
      return;
    }
    if (code === 'work_order_amount_not_agreed') { await hours.refetch(); invalidate('jobmodes'); toast('A work order amount changed at the office. We have read it again: check and send again.', { kind: 'bad', ms: 7000 }); return; }
    if (code === 'RATE_NOT_CONFIGURED') { toast('No pay rate is set for you yet. Call the office to have it set, then send.', { kind: 'bad', ms: 7000 }); return; }
    toast(friendly(err) + ' Nothing was sent.', { kind: 'bad', ms: 7000 });
  };

  if (result) return html`<${Sent} res=${result} monday=${monday} />`;

  const on = lines.filter((l) => !l.off && !l.ahead && !l.unknown);
  const of = (kind) => on.filter((l) => l.kind === kind);
  const sub = (list) => { const amounts = list.map(lineAmount); return amounts.some((a) => a == null) ? '' : cash(round2(amounts.reduce((s, a) => s + a, 0))); };
  const hourly = of('hours'); const wo = of('work_order'); const co = of('commission'); const other = of('other'); const off = of('deduction');
  const hourlyHours = round2(hourly.reduce((s, l) => s + (lineHours(l) || 0), 0));
  const unknown = lines.filter((l) => l.unknown && !l.ahead);
  const leftOff = lines.filter((l) => l.off);
  const sunday = addDays(monday, 6);
  // Receipts the trade paid for themselves this week. Each is its own record, paid back on its own, never part of this invoice.
  const repaid = ((expenses.data && expenses.data.expenses) || []).filter((e) => e.submitted_by === user.id && e.payment_method === 'personal_card' && String(e.status || '').toLowerCase() !== 'rejected')
    .filter((e) => { const d = String(e.receipt_date || tsToDate(e.created_at) || '').slice(0, 10); return d >= monday && d <= sunday; });
  const line = (l) => {
    const problem = l.kind === 'hours' && !l.off && (!l.start || !l.finish) ? 'Add start and finish times' : lineProblem(l, ctx); const amt = lineAmount(l);
    let detail = '';
    if (l.kind === 'hours') detail = `${dayWords(l.date)} · ${isNaN(lineHours(l)) ? 'no times yet' : `${hrs(lineHours(l))} at ${cash(l.rate)}`}`;
    else if (l.kind === 'work_order') {
      const rec = round2((l.dayCards || []).reduce((s, d) => s + (d.saved ? hoursBetween(d.saved.start, d.saved.finish, d.saved.breakMin) || 0 : d.clocked || 0), 0));
      detail = [l.agreed != null ? 'agreed labour' : l.amountLocked ? `work order ${l.woNumber || ''}`.trim() : 'your amount, checked by the office', helpersTotal(l) ? 'after crew' : '', rec ? `${hrs(rec)} recorded` : ''].filter(Boolean).join(' · ');
    } else if (l.kind === 'commission') detail = 'commission, no super on it';
    else if (l.kind === 'other') detail = l.type || 'Other';
    else if (l.kind === 'deduction') detail = 'taken off this invoice';
    return html`<${PayLine} key=${l.key} title=${l.kind === 'other' || l.kind === 'deduction' ? l.description || l.title : l.title} number=${l.jobNumber} detail=${detail}
      tone=${problem ? 'todo' : ''} note=${problem || ''} amount=${problem || amt == null ? '' : cash(amt)} onClick=${() => w.edit(l)} />`;
  };

  return html`<${Page} title="Invoice" back="Timesheet" onBack=${() => (route.query && route.query.from === 'pay' ? go('/pay/week/' + monday, { replace: true }) : back('/pay/week/' + monday))} right=${html`<${StatusBadge} status=${sentBack ? 'sent_back' : 'draft'} />`} flush
    foot=${html`${w.foreign ? html`<p class="t-small">This week has lines from the Trade App that cannot be sent from here.</p>`
        : problems.length ? html`<p class="t-small">${problems.length === 1 ? `${problems[0].title}: ${lineProblem(problems[0], ctx).toLowerCase()}` : `${problems.length} lines still need something`}</p>` : null}
      <${Button} block class="big" busy=${sending} disabled=${!est.count || problems.length > 0 || w.foreign > 0} onClick=${send}>Send invoice<//>`}>
    <div class="pay-who t-num">Pay week ${weekWords(monday)} · ${user.name}</div>
    ${sentBack ? html`<div class="block note-banner bad pay-gap"><span><span class="t-strong">The office sent this back.</span> ${sentBack.office_note || 'Check each line, fix what is wrong and send it again.'}</span></div>` : null}
    ${hours.loading ? html`<${SkelRows} n=${3} />` : hours.error && !data ? html`<${LoadError} error=${hours.error} onRetry=${hours.refetch} what="this week" />` : html`
      ${data && data.rate_resolved === false && !w.rateEditable ? html`<div class="block note-banner pay-gap"><span>No pay rate is set for you yet. Call the office to have it set before you send.</span></div>` : null}
      ${w.foreign ? html`<div class="block note-banner pay-gap"><span>${plural(w.foreign, 'line')} on this week ${w.foreign === 1 ? 'was' : 'were'} added in the Trade App and cannot be shown here. Send this week from the Trade App, or remove ${w.foreign === 1 ? 'it' : 'them'} there.</span></div>` : null}
      <div class="pay-rows">
        ${!on.length ? html`<p class="pay-empty">Nothing to invoice yet. Add your times on the timesheet first.</p>` : null}
        ${hourly.length ? html`<${PayGroup} label=${`Hourly${hourlyHours ? ' · ' + hrs(hourlyHours) : ''}`} right=${sub(hourly)}>${hourly.map(line)}<//>` : null}
        ${wo.length ? html`<${PayGroup} label="Work order" right=${sub(wo)}>${wo.map(line)}<//>` : null}
        ${co.length ? html`<${PayGroup} label="Commission" right=${sub(co)}>${co.map(line)}<//>` : null}
        ${other.length ? html`<${PayGroup} label="Other items" right=${sub(other)}>${other.map(line)}<//>` : null}
        ${off.length ? html`<${PayGroup} label="Taken off" right=${sub(off)}>${off.map(line)}<//>` : null}
        <button type="button" class="pay-add" onClick=${() => openAddOther({ monday, lines, addLine: w.addLine })}>Add another item</button>
      </div>

      ${est.count ? html`<div class="block card pay-sum pay-gap">
        <div class="pay-sumrow"><span>Gross earned${est.hours ? ` · ${hrs(est.hours)}` : ''}</span><span>${cash(est.gross)}</span></div>
        <div class="pay-sumrow"><span>Super withheld, 6% of ${cash(est.superBase)}</span><span>-${cash(est.superHeld)}</span></div>
        ${gstOn ? html`<div class="pay-sumrow"><span>GST</span><span>${cash(est.gst)}</span></div>` : null}
        ${deduction && deduction.amount ? html`<div class="pay-sumrow"><span>${deduction.label || 'Weekly deduction'}</span><span>${est.takeOff ? '-' + cash(est.takeOff) : 'Not taken'}</span></div>` : null}
        <div class="pay-sumrow total"><span>You are paid, about</span><span>${cash(est.pay)}</span></div>
      </div>
      <p class="block t-small pay-note">An estimate. The office system works out the exact figures when you send. The company pays another 6% super on top.</p>` : null}

      ${groups.length || unknown.length || leftOff.length || repaid.length ? html`<div class="pay-rows pay-gap">
        ${groups.length ? html`<${PayGroup} label="Group work order" right="Sent on its own">${groups.map((g) => {
          const s = g.share || {}; const h = round2((g.days || []).filter((d) => d.work_date >= monday && d.work_date <= sunday).reduce((t, d) => t + (Number(d.hours) || hoursBetween(d.start_time, d.finish_time, d.break_minutes || 0) || 0), 0));
          const amount = num(s.my_share) != null ? cash(s.my_share) : num(s.projected_my_share) != null ? 'about ' + cash(s.projected_my_share) : '';
          return html`<${PayLine} key=${g.job_id} title=${g.site_suburb || g.client_name || g.job_number || 'Job'} number=${g.job_number} detail=${['your share', h ? `${hrs(h)} this week` : ''].filter(Boolean).join(' · ')}
            note=${g.next_step || (g.share ? groupWords(s) : 'Open it to see where it is up to')} amount=${amount} onClick=${() => go('/pay/group/' + g.job_id)} />`;
        })}<//>` : null}
        ${unknown.length ? html`<${PayGroup} label="Not on this invoice">${unknown.map((l) => html`<${PayLine} key=${l.key} title=${l.title} number=${l.jobNumber} detail=${dayWords(l.date)} tone="mute"
          note=${l.viaGroup ? 'Paid through the group work order' : l.modeFailed ? 'Could not check how this job is billed' : l.modePending ? 'Checking how this job is billed' : UNKNOWN_MODE_WORDS} amount="" onClick=${() => w.edit(l)} />`)}<//>` : null}
        ${leftOff.length ? html`<${PayGroup} label="Left off this invoice">${leftOff.map((l) => html`<${PayLine} key=${l.key} title=${l.title} number=${l.jobNumber} detail=${dayWords(l.date)} tone="mute" amount="" onClick=${() => w.edit(l)} />`)}<//>` : null}
        ${repaid.length ? html`<${PayGroup} label="Expenses, repaid separately">${repaid.map((e) => html`<${PayLine} key=${e.id} title=${e.vendor_name || 'Receipt'} number=${e.jobs && e.jobs.job_number} detail=${[e.receipt_date ? fmtDate(e.receipt_date.slice(0, 10)) : '', EXPENSE_STATE[String(e.status || '').toLowerCase()] || 'with the office'].filter(Boolean).join(' · ')}
          tone="mute" amount=${num(e.total_amount) != null ? cash(e.total_amount) : ''} onClick=${() => go('/pay/receipts')} />`)}<//>` : null}
      </div>
      ${repaid.length ? html`<p class="block t-small pay-note">Expenses are their own records. The office pays them back separately, so they are not in what this invoice pays.</p>` : null}` : null}

      <div class="block card pad pay-gap pay-opts">
        <${Toggle} label="Add GST" hint="Only if you are registered for GST." checked=${gstOn} onChange=${(v) => setDraft((d) => ({ ...d, gst: v }))} />
        <${Field} label="Note for the office (optional)"><textarea class="input pay-notebox" value=${draft.notes || ''} onInput=${(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, notes: v })); }} /><//>
      </div>
      ${w.syncWords ? html`<p class="block t-small pay-note" role="status">${w.syncWords}</p>` : null}
    `}
  <//>`;
}

// ------------------------------------------------------------------ sent
function Sent({ res, monday }) {
  const held = res.office_review === 'held' || res.code === 'lines_awaiting_office_review';
  const xeroLater = res.code === 'XERO_PUSH_FAILED';
  const dedNote = res.recurring_deduction_week && res.recurring_deduction_week.note;
  const figures = num(res.trade_payable) != null || num(res.gross_earned) != null;
  return html`<${DoneScreen} bar="Invoice" title="Invoice sent"
    lead=${held ? 'The office is checking a line on it. You are paid once they approve it.' : xeroLater ? 'It is saved. The office will finish sending it to the bookkeeper. You do not need to do anything.' : 'It is with the bookkeeper. You are paid on the usual pay run.'}
    foot=${html`<${Button} block class="big" onClick=${() => go('/pay', { replace: true })}>Done<//>
      ${res.invoice_id ? html`<${Button} kind="line" block onClick=${() => go('/pay/invoice/' + res.invoice_id, { replace: true })}>View invoice<//>` : null}`}>
    ${figures ? html`<div class="card"><${PayRows} m=${{ ...res, trade_payable: res.trade_payable != null ? res.trade_payable : res.amount_payable != null ? res.amount_payable : res.net_pay }} /></div>` : html`<p class="t-small">The office system did not send the figures back. Open the invoice to see them.</p>`}
    ${superNote(res) ? html`<p class="t-small">${superNote(res)}</p>` : null}
    ${dedNote ? html`<p class="t-small">${dedNote}</p>` : null}
    ${(res.wo_labour_payouts || []).map((p) => html`<p class="t-small">${cash(p.total_ex)} for ${p.name} was taken off your invoice. They bill SecureWorks themselves.</p>`)}
    <p class="t-small t-num">${[res.invoice_number, 'Pay week ' + weekWords(monday)].filter(Boolean).join(' · ')}</p>
  <//>`;
}
