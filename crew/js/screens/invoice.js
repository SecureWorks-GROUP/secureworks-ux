// One invoice: where it is up to, every line on it by pay type, and what it
// pays. Every money figure here is the server's own. Nothing is worked out.
import { html, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, invalidate, local } from '../lib/store.js';
import { go, back, useRoute } from '../lib/router.js';
import { fmtDow, fmtDom, fmtDate, fmtDayLong, mondayOf, tsToDate } from '../lib/dates.js';
import { invoicePays } from '../lib/invoice.js';
import { Page, Button, Badge, SkelRows, Empty, LoadError, toast, ask } from '../ui/kit.js';
import { PayRows, PayGroup, PayLine, InvoiceBadge, superNote, whenWords, weekWords, cash, hrs, num } from '../ui/paybits.js';
import { heldWords, heldState, isHeldInvoice, isFollowOn, heldCounts } from '../lib/held.js';

const LINE_KIND = {
  reimbursement: 'Reimbursement (receipt)', travel: 'Travel', materials: 'Materials', equipment: 'Equipment', commission: 'Commission', 'work order': 'Work order', work_order: 'Work order',
  'group share': 'Your share', group_share: 'Your share', crew_work_order_deduction: 'Crew paid separately', labour_deduction: 'Crew labour paid separately',
  'final payout deduction': 'Adjustment', final_payout_deduction: 'Adjustment', deduction: 'Adjustment', lump_sum: 'Adjustment', adjustment: 'Adjustment', other: 'Other'
};
// The pay type each line sits under, in the order they are listed.
const GROUPS = [['hourly', 'Hourly'], ['work_order', 'Work order'], ['group', 'Group work order'], ['commission', 'Commission'], ['reimbursement', 'Reimbursements'], ['other', 'Other items'], ['off', 'Adjustment']];
const typeOf = (l) => String(l.line_type || 'labour').toLowerCase();
const isLabour = (l) => typeOf(l) === 'labour';
function groupOf(l) {
  const t = typeOf(l);
  if (t === 'labour') return 'hourly';
  if (/group.?share/.test(t) || l.group_share_id) return 'group';
  if (t === 'work order' || t === 'work_order') return 'work_order';
  if (t === 'commission') return 'commission';
  if (t === 'reimbursement') return 'reimbursement';
  if (/deduction|lump/.test(t)) return 'off';
  return 'other';
}
const lineDay = (l) => String(l.work_date || l.line_date || l.scheduled_date || '').slice(0, 10);

export function Invoice({ invoiceId }) {
  const route = useRoute();
  const q = useQuery('invoice:' + invoiceId, () => api('get_trade_invoice', { invoice_id: invoiceId }), { persist: true, ttl: 30000 });
  const [busy, setBusy] = useState(false);
  const inv = q.data && q.data.invoice;
  const fromList = route.query && route.query.from === 'invoices';
  const backWord = fromList ? 'Invoices' : 'Pay';
  const goBack = () => back(fromList ? '/pay/invoices' : '/pay');

  if (!inv) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return html`<${Page} title="Invoice" back=${backWord} onBack=${goBack}>
      ${q.loading ? html`<${SkelRows} n=${4} />`
        : gone ? html`<${Empty} title="That invoice is not here" action=${html`<${Button} kind="line" small onClick=${() => go('/pay', { replace: true })}>Back to Pay<//>`}>It may have been deleted, or it belongs to someone else.<//>`
        : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="this invoice" />`}
    <//>`;
  }

  const status = String(inv.status || '').toLowerCase();
  const week = (inv.week_start || '').slice(0, 10);
  const lines = inv.lines || [];
  const isShare = lines.some((l) => groupOf(l) === 'group');
  const what = week ? 'Pay week ' + weekWords(week) : inv.invoice_source === 'work_order' ? 'Work order invoice' : isShare ? 'Group work order share' : 'Invoice';
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
  const payLabel = paid ? 'You were paid' : draft ? 'This draft adds up to' : sentBack || voided ? 'It added up to' : 'You are paid';

  const sorted = [...lines].sort((a, b) => lineDay(a).localeCompare(lineDay(b)));
  // A send's lines that wait on the office (trade_line_hold_v1). Their own screen; never a pay figure.
  if (isHeldInvoice(inv)) return html`<${HeldInvoice} inv=${inv} lines=${sorted} what=${what} backWord=${backWord} goBack=${goBack} />`;
  const reopen = () => (week ? go('/pay/week/' + mondayOf(week)) : go('/pay/work-orders'));
  const remove = async () => {
    if (!(await ask({ title: 'Delete this draft?', body: 'It was never sent, so nothing is lost at the office. You can start the invoice again any time.', yes: 'Delete draft', danger: true }))) return;
    setBusy(true);
    try {
      const res = await api('delete_trade_invoice', null, { invoice_id: inv.id });
      if (res && res.success === false) throw new ApiError(res.error || 'Could not delete it', { status: 409, body: res });
      // The saved weekly draft for that week went with it, so the phone's copy goes too.
      if (week) local.del('week:' + mondayOf(week));
      invalidate('invoices'); invalidate('money'); invalidate('hours');
      toast('Draft deleted.', { kind: 'ok' });
      goBack();
    } catch (err) { setBusy(false); toast(friendly(err), { kind: 'bad', ms: 6000 }); }
  };
  const foot = sentBack ? html`<${Button} block class="big" onClick=${reopen}>${week ? 'Fix and send this week again' : 'Open work orders'}<//>`
    : draft ? html`${week ? html`<${Button} block class="big" onClick=${reopen}>Open timesheet<//>` : null}<${Button} kind="danger" block busy=${busy} onClick=${remove}>Delete draft<//>`
    : null;

  return html`<${Page} title="Invoice" back=${backWord} onBack=${goBack} flush foot=${foot}
    right=${html`<${InvoiceBadge} inv=${inv} />`}>
    <div class="pay-who t-num">${[what, inv.invoice_number].filter(Boolean).join(' · ')}</div>
    <div class=${'block note-banner pay-gap0 ' + (sentBack || voided ? 'bad' : paid ? 'ok' : 'plain')}><span>${figures ? where : 'The office system did not send the figures for this one. Ask the office for them. ' + where}</span></div>
    ${isFollowOn(inv) ? html`<div class="block note-banner plain pay-gap" data-held-follow-on><span>The office approved these lines after you sent your week. They are paid on this invoice.</span></div>` : null}
    ${sentBack || inv.office_note ? html`<div class=${'block note-banner pay-gap ' + (sentBack ? 'bad' : 'plain')}><span><span class="t-strong">From the office</span><span class="pay-noticesub">${inv.office_note || 'Check each line, fix what is wrong and send it again.'}</span></span></div>` : null}

    <div class="pay-rows pay-gap">
      ${!sorted.length ? html`<p class="pay-empty">No lines came back for this invoice.</p>` : null}
      ${GROUPS.map(([id, label]) => {
        const items = sorted.filter((l) => groupOf(l) === id);
        if (!items.length) return null;
        const h = id === 'hourly' ? Math.round(items.reduce((s, l) => s + (Number(l.total_hours) || 0), 0) * 100) / 100 : 0;
        return html`<${PayGroup} key=${id} label=${h ? `${label} · ${hrs(h)}` : label}>${items.map((l) => html`<${LineItem} key=${l.id} line=${l} />`)}<//>`;
      })}
    </div>

    ${figures ? html`<div class="block card pay-gap"><${PayRows} m=${inv} hours=${hours || null} totalLabel=${payLabel} /></div>
      ${superNote(inv) ? html`<p class="block t-small pay-note">${superNote(inv)}</p>` : null}
      ${adjusted ? html`<p class="block t-small pay-note">The office changed this bill after you sent it. Ask them about any change you do not expect.</p>` : null}
      ${xeroGap ? html`<p class="block t-small pay-note">The bookkeeper's bill for this invoice is ${cash(inv.xero_pays)}, not ${cash(pays)}. Ask the office which is right.</p>` : null}
      ${paidGap ? html`<p class="block t-small pay-note">The bookkeeper recorded ${cash(inv.amount_paid)} paid.</p>` : null}` : null}

    ${inv.notes ? html`<div class="block card pad pay-gap"><span class="t-cap">Your note to the office</span><p class="prose pay-prose">${inv.notes}</p></div>` : null}
    ${inv.submitted_at && !draft ? html`<p class="block t-small pay-note t-num">Sent ${fmtDate(tsToDate(inv.submitted_at))}</p>` : null}
  <//>`;
}

function HeldInvoice({ inv, lines, what, backWord, goBack }) {
  const c = heldCounts(inv);
  const waiting = lines.filter((l) => heldState(l) === 'waiting');
  const notApproved = lines.filter((l) => heldState(l) === 'not_approved');
  const lead = c.waiting ? 'These lines are waiting on the office. They are not in your pay until the office approves them.'
    : c.notApproved ? 'The office did not approve these lines, so they are not paid.'
    : 'The office has decided every line. Approved lines are paid on their own invoice in your invoices.';
  return html`<${Page} title="With the office" back=${backWord} onBack=${goBack} flush>
    <div class="pay-who t-num">${[what, inv.invoice_number].filter(Boolean).join(' · ')}</div>
    <div class=${'block note-banner pay-gap0 ' + (c.waiting ? 'plain' : c.notApproved ? 'bad' : 'ok')} data-held-invoice><span>${lead}</span></div>
    <div class="pay-rows pay-gap">
      ${waiting.length ? html`<${PayGroup} label="Waiting on office">${waiting.map((l) => html`<${LineItem} key=${l.id} line=${l} held />`)}<//>` : null}
      ${notApproved.length ? html`<${PayGroup} label="Not approved">${notApproved.map((l) => html`<${LineItem} key=${l.id} line=${l} held />`)}<//>` : null}
    </div>
    <p class="block t-small pay-note">Amounts are before GST and super. Only your own lines are shown.</p>
  <//>`;
}

function reviewOf(l) {
  const s = String(l.office_review_status || '').toLowerCase();
  if (['awaiting', 'held', 'pending', 'queried'].includes(s)) return 'checking';
  if (['rejected', 'declined', 'not_approved'].includes(s)) return 'no';
  return '';
}

function LineItem({ line: l, held = false }) {
  const labour = isLabour(l);
  const kind = labour ? '' : LINE_KIND[typeOf(l)] || 'Other';
  const desc = l.description && !/^labour$/i.test(l.description.trim()) && l.description.trim() !== kind ? l.description.trim() : '';
  const sameStart = Boolean(kind && desc && desc.toLowerCase().startsWith(kind.toLowerCase()));
  const review = reviewOf(l);
  const leadAsked = String(l.acknowledgment_status || '').toLowerCase() === 'queried';
  const rate = num(l.hourly_rate != null ? l.hourly_rate : l.unit_rate);
  const day = lineDay(l);
  const priced = labour && num(l.total_hours) ? `${hrs(l.total_hours)}${rate ? ' at ' + cash(rate) : ''}` : !labour && num(l.quantity) > 1 ? `${l.quantity} ${l.unit || ''}`.trim() : '';
  const detail = [day ? `${fmtDow(day)} ${fmtDom(day)}` : '', sameStart ? '' : kind.toLowerCase(), priced].filter(Boolean).join(' · ');
  // A held line (hold_reason set) says why it waits, and what the office changed or decided. Absent fields add nothing.
  const state = l.hold_reason ? heldState(l) : '';
  const changed = state === 'approved' && l.office_change_reason ? 'The office changed this line: ' + l.office_change_reason : '';
  const sentWas = state === 'approved' && num(l.sent_amount_ex) != null && num(l.line_total_ex) != null && Math.abs(l.sent_amount_ex - l.line_total_ex) > 0.005 ? 'You sent ' + cash(l.sent_amount_ex) : '';
  const notes = [labour ? whenWords(l) : '', desc, l.external_ref || '', state === 'waiting' ? heldWords(l.hold_reason) : '', review && l.office_review_note ? 'Office: ' + l.office_review_note : '', changed, sentWas].filter(Boolean);
  const badge = held && review === 'checking' ? html`<${Badge} kind="warn">Waiting on office<//>` : held && review === 'no' ? html`<${Badge} kind="bad">Not approved<//>`
    : review === 'checking' ? html`<${Badge} kind="warn">Office is checking this line<//>` : review === 'no' ? html`<${Badge} kind="bad">Not accepted by the office<//>` : leadAsked ? html`<${Badge} kind="warn">The job lead asked about this line<//>` : null;
  return html`<${PayLine} title=${typeOf(l) === 'reimbursement' ? kind : l.site_suburb || l.client_name || l.job_number || kind || 'Line'} number=${l.job_number} detail=${detail}
    note=${notes.length ? notes.join(' · ') : ''} badge=${badge ? html`<span class="pay-linebadge">${badge}</span>` : null} amount=${num(l.line_total_ex) != null ? cash(l.line_total_ex) : ''} />`;
}
