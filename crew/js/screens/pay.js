// Pay: this pay week in two steps (timesheet, then the invoice made from it),
// the latest invoices, and the records behind them.
import { html, useMemo } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery, useStore, local } from '../lib/store.js';
import { go } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtWeek, fmtDate, fmtMonth, tsToDate } from '../lib/dates.js';
import { invoiceForWeek, sentBackForWeek, invoicePays, buildLines, isLiveInvoice, groupRouteJobs } from '../lib/invoice.js';
import { Page, Section, KV, StatusBadge, JobLine, Button, Sheet, SkelRows, LoadError, openOverlay } from '../ui/kit.js';
import { cash, hrs, plural, sheetRows, sheetSummary, groupDays, InvoiceBadge } from '../ui/paybits.js';
import { useCharges, needsCheck } from './charges.js';

// ---------- reads the pay screens share ----------
export function useInvoices() { return useQuery('invoices', () => api('my_trade_invoices'), { persist: true, ttl: 60000 }); }
export function useHours(monday) {
  return useQuery('hours:' + monday, () => api('my_hours', { week_ending: addDays(monday, 6) }), { persist: true, ttl: 45000 });
}
/** The week's draft as kept on this phone. The timesheet also keeps it on the trade's account. */
export function loadDraft(monday) {
  const d = local.get('week:' + monday, null) || {};
  return { ...d, edits: d.edits || {}, added: d.added || [], lumps: d.lumps || [], gst: d.gst == null ? null : d.gst, notes: d.notes || '' };
}
export function useMoney() { return useQuery('money', () => api('my_money', { months: 12 }), { persist: true, ttl: 60000 }); }
export function useExpenses() { return useQuery('expenses', () => api('list_expenses', { limit: 100 }), { persist: true, ttl: 60000 }); }
export function useGroups() { return useQuery('groups', () => api('my_group_work_orders', null, null, { keepSession: true }), { ttl: 120000 }); }
/**
 * The jobs this week that are paid through a group work order, each with the
 * days the trade has put on it. One read a job; a failed read leaves the days empty.
 */
export function useGroupWeek(hoursData) {
  const user = useStore((s) => s.user);
  const jobs = useMemo(() => groupRouteJobs(hoursData), [hoursData]);
  const ids = jobs.map((g) => String(g.job_id)).sort();
  const q = useQuery(ids.length ? 'groups:week:' + ids.join(',') : null, () => Promise.all(ids.map((id) => api('group_work_order_my_share', null, { job_id: id }, { keepSession: true }).then((r) => [id, r]).catch(() => [id, null]))).then(Object.fromEntries), { ttl: 30000 });
  return useMemo(() => jobs.map((g) => {
    const share = (q.data && q.data[String(g.job_id)]) || null;
    return { ...g, share, days: groupDays(share, local.get(`group-days:${user.id}:${g.job_id}`, [])) };
  }), [jobs, q.data]);
}

export function Pay() {
  const user = useStore((s) => s.user);
  const today = todayISO();
  const monday = mondayOf(today);
  const lastMonday = addDays(monday, -7);
  const invoices = useInvoices();
  const hours = useHours(monday);
  const lastHours = useHours(lastMonday);
  const charges = useCharges();
  const money = useMoney();
  const expenses = useExpenses();
  const groups = useGroups();
  const wos = useQuery(user.perMetre ? 'wos' : null, () => api('my_work_orders', { mode: 'mine' }), { ttl: 60000 });
  const groupWeek = useGroupWeek(hours.data);

  const list = (invoices.data && invoices.data.invoices) || [];
  const thisInv = invoiceForWeek(list, monday);
  const lastInv = invoiceForWeek(list, lastMonday);
  const lastBack = sentBackForWeek(list, lastMonday);
  const thisBack = sentBackForWeek(list, monday);

  const sheet = useMemo(() => {
    if (!hours.data) return null;
    const ctx = { monday, rateEditable: hours.data.trade_rate_editable === true };
    const lines = buildLines(hours.data, loadDraft(monday), { workOrders: (wos.data && wos.data.work_orders) || [], perMetre: user.perMetre });
    const { rows } = sheetRows(lines, groupWeek, ctx);
    return sheetSummary(rows);
  }, [hours.data, wos.data, groupWeek, monday]);

  const lastCount = lastHours.data ? (lastHours.data.assignments || []).filter((a) => a.invoice_mode !== 'group_work_order').length : 0;
  const lastOwing = !lastInv && lastCount > 0;
  const groupList = (groups.data && groups.data.enabled !== false && groups.data.groups) || [];
  const sentRows = list.filter((i) => isLiveInvoice(i) || String(i.status) === 'ops-reject').slice(0, 3);
  const toCheck = ((charges.data && charges.data.charges) || []).filter(needsCheck).length;
  const waiting = ((expenses.data && expenses.data.expenses) || []).filter((e) => e.submitted_by === user.id && ['pending', 'pending_extraction', 'queried'].includes(String(e.status || '').toLowerCase())).length;
  const openWos = ((wos.data && wos.data.work_orders) || []).filter((w) => w.already_invoiced !== true).length;
  const month = money.data && money.data.month;
  const h = hours.data;
  const rate = h && h.rate_resolved !== false && Number(h.rate) > 0 ? Number(h.rate) : 0;
  const basis = user.perMetre ? 'Paid by work order' : rate ? `Hourly · ${cash(rate)}/h` : '';

  const ready = sheet && sheet.count > 0 && !sheet.todo;
  const sheetWords = thisInv ? 'On the invoice you sent' : !sheet ? '' : !sheet.count ? 'Nothing recorded yet' : `${sheet.daysDone} of ${plural(sheet.days, 'day')} done · ${hrs(sheet.hours)}`;
  const sheetStatus = thisInv ? 'sent' : !sheet || !sheet.count ? 'draft' : sheet.todo ? 'needs_times' : 'complete';
  const openGroups = () => (groupList.length === 1 ? go('/pay/group/' + groupList[0].job_id) : openOverlay((close) => html`<${GroupsSheet} groups=${groupList} onClose=${close} />`));
  const toDo = groupList.filter((g) => ['needs_hours', 'ready', 'frozen'].includes(g.awaiting) && !g.submitted).length;

  return html`<${Page} root title="Pay" right=${basis ? html`<span class="t-num">${basis}</span>` : null}>
    <div class="block card pad pay-weekcard">
      <h2 class="t-cap">Pay week ${fmtWeek(monday)}</h2>
      <div class="pay-steps">
        <button type="button" class="pay-step" onClick=${() => go('/pay/week/' + monday)}>
          <span class=${'pay-stepno ' + (thisInv || ready ? 'done' : 'now')}>1</span>
          <span class="main"><b>Timesheet</b><span class="sub t-num">${hours.loading && !sheet ? 'Loading' : hours.error && !sheet ? 'Could not load this week' : sheetWords}</span></span>
          <${StatusBadge} status=${sheetStatus} />
        </button>
        <button type="button" class="pay-step" onClick=${() => (thisInv ? go('/pay/invoice/' + thisInv.id) : go('/pay/week/' + monday + '/invoice'))}>
          <span class=${'pay-stepno ' + (thisInv ? 'done' : ready ? 'now' : '')}>2</span>
          <span class="main"><b>Invoice</b><span class="sub t-num">${thisInv ? thisInv.invoice_number || 'Sent' : 'Made from your timesheet'}</span></span>
          ${thisInv ? html`<${InvoiceBadge} inv=${thisInv} />` : html`<${StatusBadge} status=${thisBack ? 'sent_back' : 'not_sent'} />`}
        </button>
      </div>
      ${thisInv ? html`<${Button} kind="line" block onClick=${() => go('/pay/invoice/' + thisInv.id)}>View invoice<//>`
        : html`<${Button} block class="pay-go" onClick=${() => go(ready && !thisBack ? '/pay/week/' + monday + '/invoice' : '/pay/week/' + monday)}>${thisBack ? 'Fix and send again' : ready ? 'Review invoice' : 'Open timesheet'}<//>`}
    </div>

    ${lastOwing || lastBack ? html`<button type="button" class=${'block note-banner pay-notice ' + (lastBack ? 'bad' : '')} onClick=${() => go('/pay/week/' + lastMonday)}>
      <span><span class="t-strong">${lastBack ? 'Last week was sent back' : 'Last week is not invoiced'}</span><span class="pay-noticesub">Pay week ${fmtWeek(lastMonday)}. Open it to ${lastBack ? 'fix it' : 'send it'}.</span></span></button>` : null}

    <${Section} label="Invoices" right=${html`<button type="button" class="link tap" onClick=${() => go('/pay/invoices')}>All invoices</button>`}>
      ${invoices.loading ? html`<${SkelRows} n=${2} />` : invoices.error && !list.length ? html`<${LoadError} error=${invoices.error} onRetry=${invoices.refetch} what="your invoices" />`
        : !sentRows.length ? html`<div class="block card pad"><p class="t-small">No invoices yet. When you send a pay week it shows here with what you are paid.</p></div>`
        : html`<div class="block card">${sentRows.map((inv) => html`<${InvoiceRow} key=${inv.id} inv=${inv} />`)}</div>`}
    <//>

    <${Section} label="Records">
      <div class="block card">
        <${KV} nav k="Earnings" v=${month && month.gross_earned != null ? html`<span class="t-num">${/^\d{4}-\d{2}$/.test(month.month || '') ? fmtMonth(month.month + '-01').split(' ')[0] : 'This month'} to date ${cash(month.gross_earned)}</span>` : ''} onClick=${() => go('/pay/invoices')} />
        <${KV} nav k="Expenses" v=${waiting ? `${waiting} waiting` : 'Add a receipt'} onClick=${() => go('/pay/receipts')} />
        ${user.perMetre ? html`<${KV} nav k="Work orders" v=${wos.data ? `${openWos} open` : ''} onClick=${() => go('/pay/work-orders')} />` : null}
        ${groupList.length ? html`<${KV} nav k="Group work orders" v=${toDo ? `${toDo} to do` : `${groupList.length} open`} onClick=${openGroups} />` : null}
        ${user.manager && toCheck ? html`<${KV} nav k="Crew hours to check" v=${`${toCheck} to check`} onClick=${() => go('/pay/charges')} />` : null}
      </div>
    <//>
  <//>`;
}

function GroupsSheet({ groups, onClose }) {
  return html`<${Sheet} title="Group work orders" sub="A job that pays the crew one amount, shared by hours." onClose=${onClose}>
    ${(shut) => html`<div class="pay-sheetlist">${groups.map((g) => html`<button type="button" class="item" key=${g.group_id || g.job_id} onClick=${() => { shut(); go('/pay/group/' + g.job_id); }}>
      <span class="main"><b>${g.site_suburb || g.client_name || g.job_number}</b><${JobLine} job=${g}>${groupWords(g)}<//></span></button>`)}</div>`}
  <//>`;
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

/** One invoice in a list: the pay week, its number and date, its state and what it pays. */
export function InvoiceRow({ inv, from, note }) {
  const pays = invoicePays(inv);
  const week = (inv.week_start || '').slice(0, 10);
  const day = inv.paid_at ? 'paid ' + fmtDate(tsToDate(inv.paid_at)) : inv.submitted_at ? fmtDate(tsToDate(inv.submitted_at)) : '';
  return html`<button type="button" class="item pay-inv" onClick=${() => go('/pay/invoice/' + inv.id + (from ? '?from=' + from : ''))}>
    <span class="main"><b>${week ? fmtWeek(week) : inv.invoice_source === 'work_order' ? 'Work order' : 'One-off invoice'}</b>
      <span class="sub t-num">${[inv.invoice_number, day].filter(Boolean).join(' · ')}</span>
      ${note ? html`<span class="sub">${note}</span>` : null}</span>
    <span class="side"><span class="pay-figure">${pays == null ? '' : cash(pays)}</span><${InvoiceBadge} inv=${inv} /></span>
  </button>`;
}
