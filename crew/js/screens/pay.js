// Pay: this week's invoice up top, then what has been sent and paid.
import { html, useMemo } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore, local } from '../lib/store.js';
import { go } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtWeek, fmtMoney, fmtHours, fmtDate, dowOf } from '../lib/dates.js';
import { invoiceForWeek, sentBackForWeek, invoiceState, invoicePays, buildLines, estimate, isLiveInvoice } from '../lib/invoice.js';
import { Icon } from '../ui/icons.js';
import { Chip, SkelRows, Skel, Empty, LoadError, Button } from '../ui/kit.js';
import { useCharges, needsCheck } from './charges.js';

export function useInvoices() { return useQuery('invoices', () => api('my_trade_invoices'), { persist: true, ttl: 60000 }); }
export function useHours(monday) {
  return useQuery('hours:' + monday, () => api('my_hours', { week_ending: addDays(monday, 6) }), { persist: true, ttl: 45000 });
}
export function loadDraft(monday) { return local.get('week:' + monday, { edits: {}, added: [], gst: null, notes: '' }); }

export function Pay() {
  const user = useStore((s) => s.user);
  const today = todayISO();
  const monday = mondayOf(today);
  const lastMonday = addDays(monday, -7);
  const invoices = useInvoices();
  const hours = useHours(monday);
  const lastHours = useHours(lastMonday);
  const charges = useCharges();
  const toCheck = ((charges.data && charges.data.charges) || []).filter(needsCheck).length;
  const groups = useQuery('groups', () => api('my_group_work_orders', null, null, { keepSession: true }), { ttl: 120000 });
  const list = (invoices.data && invoices.data.invoices) || [];
  const thisInv = invoiceForWeek(list, monday);
  const lastInv = invoiceForWeek(list, lastMonday);
  const lastBack = sentBackForWeek(list, lastMonday);
  const thisBack = sentBackForWeek(list, monday);

  const est = useMemo(() => {
    if (!hours.data) return null;
    const draft = loadDraft(monday);
    return estimate(buildLines(hours.data, draft, { perMetre: user.perMetre }), { gstOn: draft.gst == null ? user.gstDefault : draft.gst, deduction: hours.data.recurring_deduction_week });
  }, [hours.data, monday]);
  const lastCount = lastHours.data ? ((lastHours.data.assignments || []).length + ((lastHours.data.group_route_jobs || []).length ? 0 : 0)) : 0;
  const lastOwing = !lastInv && lastCount > 0;
  const groupList = (groups.data && groups.data.enabled !== false && groups.data.groups) || [];
  const sentRows = list.filter((i) => isLiveInvoice(i) || String(i.status) === 'ops-reject').slice(0, 12);
  const endOfWeek = dowOf(today) === 0 || dowOf(today) >= 5;

  return html`<main class="page enter-tab">
    <header class="page-pad" style="padding-top:4px"><h1 class="t-display">Pay</h1></header>

    <div class="payhero rise" role="button" tabindex="0" onKeyDown=${(e) => { if (e.key === 'Enter') e.currentTarget.click(); }} onClick=${() => (thisInv ? go('/pay/invoice/' + thisInv.id) : go('/pay/week/' + monday))}>
      <span style="display:flex;justify-content:space-between;align-items:center"><span class="t-label">This week · ${fmtWeek(monday)}</span>
        ${thisInv ? html`<${Chip} kind="ok" icon="check">Sent<//>` : thisBack ? html`<${Chip} kind="bad">Sent back<//>` : null}</span>
      ${thisInv ? html`<span><span class="money xl">${fmtMoney(invoicePays(thisInv), { cents: true }) || 'Sent'}</span><span class="sub" style="display:block;margin-top:8px">${invoiceState(thisInv)[0]}. Tap to see it.</span></span>`
        : hours.loading || !est ? html`<${Skel} w="60%" h=${52} style="opacity:.3" />`
        : html`<span><span class="money xl">${est.gross ? fmtMoney(est.gross) : fmtHours(est.hours) || '$0'}</span>
            <span class="sub" style="display:block;margin-top:8px">${est.count === 0 ? 'Nothing on it yet. Clock on to a job or add one.' : est.unfinished ? `${est.unfinished} ${est.unfinished === 1 ? 'job needs' : 'jobs need'} your times` : `${fmtHours(est.hours)} ready so far, before super and GST`}</span></span>`}
      ${thisInv ? null : html`<span class="btn primary block" style="pointer-events:none">${thisBack ? 'Fix and send again' : endOfWeek && est && est.count ? 'Check and send invoice' : 'Open this week'}</span>`}
    </div>

    ${lastOwing || lastBack ? html`<button type="button" class="block note-banner ${lastBack ? 'bad' : ''}" style="margin-top:12px;width:calc(100% - 2 * var(--gut));text-align:left" onClick=${() => go('/pay/week/' + lastMonday)}>
      <${Icon} name="alert" size=${18} /><span><span class="t-strong">${lastBack ? 'Last week was sent back' : 'Last week is not invoiced'}</span><span style="display:block">${fmtWeek(lastMonday)}. Tap to ${lastBack ? 'fix it' : 'send it'}.</span></span></button>` : null}

    <div class="block actions" style="margin-top:14px">
      <button type="button" class="action" onClick=${() => go('/pay/receipt')}><${Icon} name="receipt" size=${22} />Add receipt</button>
      <button type="button" class="action" onClick=${() => go('/pay/money')}><${Icon} name="wallet" size=${22} />My money</button>
      ${user.perMetre ? html`<button type="button" class="action" onClick=${() => go('/pay/work-orders')}><${Icon} name="tools" size=${22} />Work orders</button>` : null}
      ${toCheck ? html`<button type="button" class="action" onClick=${() => go('/pay/charges')}><${Icon} name="users" size=${22} />Check crew (${toCheck})</button>` : null}
    </div>

    ${groupList.length ? html`<section class="section"><span class="t-label">Paid as a crew</span><div class="list ruled">
      ${groupList.slice(0, 6).map((g) => html`<button type="button" class="row" key=${g.group_id || g.job_id} onClick=${() => go('/pay/group/' + g.job_id)}>
        <span class="main" style="grid-column:1 / span 2"><b>${g.site_suburb || g.client_name || g.job_number}</b><span>${groupWords(g)}</span></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>`)}
    </div></section>` : null}

    <section class="section">
      <div class="section-head"><span class="t-label">Sent invoices</span></div>
      ${invoices.loading ? html`<${SkelRows} n=${3} />` : invoices.error && !list.length ? html`<${LoadError} error=${invoices.error} onRetry=${invoices.refetch} what="your invoices" />`
        : !sentRows.length ? html`<${Empty} title="No invoices yet">When you send a week, it shows here with what you get paid and when.<//>`
        : html`<div class="list ruled">${sentRows.map((inv) => html`<${InvoiceRow} key=${inv.id} inv=${inv} />`)}</div>`}
      ${list.length > sentRows.length ? html`<div class="block" style="margin-top:8px"><${Button} kind="quiet" onClick=${() => go('/pay/money')}>See all of them<//></div>` : null}
    </section>
  </main>`;
}

export function groupWords(g) {
  const a = g.awaiting;
  if (g.submitted) return 'Your share is invoiced';
  if (a === 'needs_hours') return 'Add your hours';
  if (a === 'awaiting_signoff') return 'Waiting for the customer to sign';
  if (a === 'awaiting_others') return 'Waiting on the rest of the crew';
  if (a === 'awaiting_rate') return 'Waiting on the office';
  if (a === 'ready') return 'Ready to lock in';
  if (a === 'frozen') return 'Your share is ready to invoice';
  return (g.discovery && g.discovery.message) || 'Open to see what is next';
}

export function InvoiceRow({ inv }) {
  const [words, kind] = invoiceState(inv);
  const pays = invoicePays(inv);
  const week = (inv.week_start || '').slice(0, 10);
  return html`<button type="button" class="row" onClick=${() => go('/pay/invoice/' + inv.id)}>
    <span class="main" style="grid-column:1"><b>${week ? fmtWeek(week) : inv.invoice_source === 'work_order' ? 'Work order' : 'One-off invoice'}</b>
      <span>${inv.invoice_number || ''}${inv.paid_at ? ' · paid ' + fmtDate(inv.paid_at.slice(0, 10)) : ''}</span></span>
    <span style="text-align:right;display:grid;gap:4px;justify-items:end"><span class="t-num" style="font-size:20px">${pays == null ? '' : fmtMoney(pays, { cents: true })}</span><${Chip} kind=${kind}>${words}<//></span>
    <span class="trail"><${Icon} name="right" size=${18} /></span>
  </button>`;
}
