// One invoice: what it pays, where it is up to, and every line on it.
// Every money figure here is the server's own. Nothing is worked out.
import { html, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, invalidate } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { fmtWeek, fmtDay, fmtDate, fmtDayLong, fmtMoney, fmtHours, mondayOf, tsToDate } from '../lib/dates.js';
import { invoiceState, invoicePays } from '../lib/invoice.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Chip, Skel, SkelRows, Empty, LoadError, toast, ask } from '../ui/kit.js';
import { PayRows, superNote, whenWords, cash, num } from '../ui/paybits.js';

const LINE_KIND = {
  travel: 'Travel', materials: 'Materials', equipment: 'Equipment', commission: 'Commission', 'work order': 'Work order', work_order: 'Work order',
  'group share': 'Crew share', group_share: 'Crew share', crew_work_order_deduction: 'Crew taken off', labour_deduction: 'Crew labour taken off',
  'final payout deduction': 'Taken off', final_payout_deduction: 'Taken off', adjustment: 'Adjustment', other: 'Other'
};
const isLabour = (l) => !l.line_type || String(l.line_type).toLowerCase() === 'labour';
const lineDay = (l) => String(l.work_date || l.line_date || l.scheduled_date || '').slice(0, 10);

export function Invoice({ invoiceId }) {
  const q = useQuery('invoice:' + invoiceId, () => api('get_trade_invoice', { invoice_id: invoiceId }), { persist: true, ttl: 30000 });
  const [busy, setBusy] = useState(false);
  const inv = q.data && q.data.invoice;

  if (!inv) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return html`<${Page} title="Invoice" onBack=${() => back('/pay')}>
      ${q.loading ? html`<div class="block" style="display:grid;gap:14px;margin-top:6px"><${Skel} w="48%" h=${30} /><${Skel} w="70%" h=${60} r=${14} /><${Skel} h=${150} r=${14} /></div><${SkelRows} n=${3} />`
        : gone ? html`<${Empty} title="That invoice is not here" action=${html`<${Button} kind="line" small onClick=${() => go('/pay', { replace: true })}>Back to Pay<//>`}>It may have been deleted, or it belongs to someone else.<//>`
        : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this invoice" />`}
    <//>`;
  }

  const status = String(inv.status || '').toLowerCase();
  const [words, kind] = invoiceState(inv);
  const week = (inv.week_start || '').slice(0, 10);
  const lines = inv.lines || [];
  const isShare = lines.some((l) => /group.?share/i.test(l.line_type || '') || l.group_share_id);
  const title = week ? fmtWeek(week) : inv.invoice_source === 'work_order' ? 'Work order' : isShare ? 'Crew share' : 'Invoice';
  const pays = invoicePays(inv);
  const figures = !inv.figures_error && pays != null;
  const paid = status === 'paid' || inv.paid === true;
  const voided = ['VOIDED', 'DELETED'].includes(String(inv.xero_bill_status || '').toUpperCase());
  const sentBack = status === 'ops-reject';
  const draft = status === 'draft';
  const adjusted = inv.xero_adjustments && (inv.xero_adjustments.lines || []).some((l) => num(l.amount));
  const xeroGap = adjusted && num(inv.xero_pays) != null && pays != null && Math.abs(inv.xero_pays - pays) > 0.005;
  const paidGap = paid && num(inv.amount_paid) != null && pays != null && Math.abs(inv.amount_paid - pays) > 0.005;
  const checking = lines.filter((l) => reviewOf(l) === 'checking').length;
  const hours = Math.round(lines.reduce((s, l) => s + (isLabour(l) ? Number(l.total_hours) || 0 : 0), 0) * 100) / 100;

  const where = paid ? `Paid${inv.paid_at ? ' on ' + fmtDayLong(tsToDate(inv.paid_at)) : ''}.`
    : voided ? 'The bookkeeper cancelled this bill. Ask the office what happens next.'
    : sentBack ? 'The office sent this back, so it is not being paid yet.'
    : draft ? 'Not sent yet. Nothing is paid from a draft.'
    : status === 'pushed_to_xero' ? 'With the bookkeeper. You are paid on the usual pay run.'
    : checking ? `The office is checking ${checking === 1 ? 'a line' : checking + ' lines'} on it. You are paid once they approve.`
    : 'With the office. You are paid once they approve it.';

  const payLabel = paid ? 'You were paid' : draft ? 'This draft adds up to' : sentBack || voided ? 'It added up to' : 'You get paid';

  const byDay = [];
  for (const l of [...lines].sort((a, b) => lineDay(a).localeCompare(lineDay(b)))) {
    const d = lineDay(l);
    const last = byDay[byDay.length - 1];
    if (last && last[0] === d) last[1].push(l); else byDay.push([d, [l]]);
  }

  const reopen = () => (week ? go('/pay/week/' + mondayOf(week)) : go('/pay/work-orders'));
  const remove = async () => {
    if (!(await ask({ title: 'Delete this draft?', body: 'It was never sent, so nothing is lost at the office. You can start the invoice again any time.', yes: 'Delete draft', danger: true }))) return;
    setBusy(true);
    try {
      const res = await api('delete_trade_invoice', null, { invoice_id: inv.id });
      if (res && res.success === false) throw new ApiError(res.error || 'Could not delete it', { status: 409, body: res });
      invalidate('invoices'); invalidate('money'); invalidate('hours');
      toast('Draft deleted.', { kind: 'ok' });
      back('/pay');
    } catch (err) { setBusy(false); toast(friendly(err), { kind: 'bad', ms: 6000 }); }
  };

  return html`<${Page} title=${title} onBack=${() => back('/pay')}>
    <header class="block invhead">
      <div><span class="t-label">${week ? 'Week' : 'Invoice'}</span><h1 class="t-title invtitle">${title}</h1></div>
      <${Chip} kind=${voided ? 'bad' : kind}>${voided ? 'Cancelled' : words}<//>
    </header>

    <section class="block paytop">
      <span class="t-label">${payLabel}</span>
      ${figures ? html`<span class="money xl">${cash(pays)}</span>` : html`<span class="t-title">Figures not available</span>`}
      <p>${figures ? where : 'The office system did not send the figures for this one. Ask the office for them. ' + where}</p>
    </section>

    ${sentBack ? html`<div class="block note-banner bad" style="margin-top:16px"><${Icon} name="alert" size=${18} /><span><span class="t-strong">From the office</span><span style="display:block;margin-top:2px">${inv.office_note || 'Check each line, fix what is wrong and send it again.'}</span></span></div>
      <div class="block" style="margin-top:10px"><${Button} block onClick=${reopen}>${week ? 'Fix and send this week again' : 'Open work orders'}<//></div>`
      : inv.office_note ? html`<div class="block note-banner plain" style="margin-top:16px"><${Icon} name="message" size=${18} /><span><span class="t-strong">From the office</span><span style="display:block;margin-top:2px">${inv.office_note}</span></span></div>` : null}

    ${figures ? html`<section class="block inset" style="margin-top:18px">
      <${PayRows} m=${inv} hours=${hours || null} totalLabel=${payLabel} />
      ${superNote(inv) ? html`<p class="t-small t-mute" style="margin-top:10px">${superNote(inv)}</p>` : null}
      ${adjusted ? html`<p class="t-small" style="margin-top:8px">The office changed this bill after you sent it. Ask them about any change you do not expect.</p>` : null}
      ${xeroGap ? html`<p class="t-small" style="margin-top:8px">The bookkeeper's bill for this invoice is ${cash(inv.xero_pays)}, not ${cash(pays)}. Ask the office which is right.</p>` : null}
      ${paidGap ? html`<p class="t-small" style="margin-top:8px">The bookkeeper recorded ${cash(inv.amount_paid)} paid.</p>` : null}
    </section>` : null}

    ${draft ? html`<div class="block btnrow" style="margin-top:14px">
      ${week ? html`<${Button} kind="line" onClick=${reopen}>Open this week<//>` : null}
      <${Button} kind="danger" icon="trash" busy=${busy} onClick=${remove}>Delete draft<//>
    </div>` : null}

    ${byDay.length ? html`<div class="rise">${byDay.map(([day, items]) => {
      const hrs = Math.round(items.reduce((s, l) => s + (isLabour(l) ? Number(l.total_hours) || 0 : 0), 0) * 100) / 100;
      return html`<section class="daygroup" key=${day || 'none'}>
        <span class="t-label"><span>${day ? fmtDay(day) : 'No day'}</span><span>${hrs ? fmtHours(hrs) : ''}</span></span>
        ${items.map((l) => html`<${LineItem} key=${l.id} line=${l} />`)}
      </section>`;
    })}</div>` : html`<p class="block t-small t-mute" style="margin-top:22px">No lines came back for this invoice.</p>`}

    ${inv.notes ? html`<section class="block" style="margin-top:22px"><span class="t-label">Your note to the office</span><p class="prose" style="margin-top:4px;color:var(--ink-2)">${inv.notes}</p></section>` : null}
    <p class="block t-small t-mute t-num" style="margin-top:22px">${[inv.invoice_number, inv.submitted_at && !draft ? 'sent ' + fmtDate(tsToDate(inv.submitted_at)) : ''].filter(Boolean).join(' · ')}</p>
  <//>`;
}

function reviewOf(l) {
  const s = String(l.office_review_status || '').toLowerCase();
  if (['awaiting', 'held', 'pending', 'queried'].includes(s)) return 'checking';
  if (['rejected', 'declined', 'not_approved'].includes(s)) return 'no';
  return '';
}

function LineItem({ line: l }) {
  const labour = isLabour(l);
  const kind = labour ? '' : LINE_KIND[String(l.line_type).toLowerCase()] || 'Other';
  const when = labour ? whenWords(l) : '';
  const desc = l.description && !/^labour$/i.test(l.description.trim()) && l.description.trim() !== kind ? l.description.trim() : '';
  const sameStart = Boolean(kind && desc && desc.toLowerCase().startsWith(kind.toLowerCase()));
  const review = reviewOf(l);
  const leadAsked = String(l.acknowledgment_status || '').toLowerCase() === 'queried';
  const rate = num(l.hourly_rate != null ? l.hourly_rate : l.unit_rate);
  const small = labour && num(l.total_hours) ? `${fmtHours(l.total_hours)}${rate ? ' at ' + fmtMoney(rate) : ''}` : !labour && num(l.quantity) > 1 ? `${l.quantity} ${l.unit || ''}`.trim() : '';
  return html`<div class="line still">
    <span><b>${l.site_suburb || l.client_name || l.job_number || kind || 'Line'}</b>
      ${when || (kind && !sameStart) ? html`<span class="how">${[sameStart ? '' : kind, when].filter(Boolean).join(' · ')}</span>` : null}
      ${desc ? html`<span class="how">${desc}</span>` : null}
      ${l.job_number ? html`<span class="how t-num" style="font-size:13px;color:var(--ink-3)">${[l.job_number, l.external_ref].filter(Boolean).join(' · ')}</span>` : null}
      ${review === 'checking' ? html`<span class="linechip"><${Chip} kind="warn">Office is checking this line<//></span>` : null}
      ${review === 'no' ? html`<span class="linechip"><${Chip} kind="bad">Not accepted by the office<//></span>` : null}
      ${review && l.office_review_note ? html`<span class="how">Office: ${l.office_review_note}</span>` : null}
      ${leadAsked && !review ? html`<span class="linechip"><${Chip} kind="warn">The job lead asked about this line<//></span>` : null}
    </span>
    <span class="amt">${num(l.line_total_ex) != null ? cash(l.line_total_ex) : ''}${small ? html`<small>${small}</small>` : null}</span>
  </div>`;
}
