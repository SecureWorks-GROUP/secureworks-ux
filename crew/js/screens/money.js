// My money: what has been earned, paid and is still to come, as the office
// system counts it. Every total on this screen is the server's.
import { html } from '../lib/h.js';
import { api } from '../lib/api.js';
import { useQuery } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { fmtMonth, fmtMoney } from '../lib/dates.js';
import { Page, Button, Skel, SkelRows, Empty, LoadError } from '../ui/kit.js';
import { cash, num } from '../ui/paybits.js';
import { InvoiceRow } from './pay.js';

const monthName = (ym, label) => (/^\d{4}-\d{2}$/.test(ym || '') ? fmtMonth(ym + '-01') : label || '');
const count = (n) => `${n} ${n === 1 ? 'invoice' : 'invoices'}`;

export function Money() {
  const q = useQuery('money', () => api('my_money', { months: 12 }), { persist: true, ttl: 60000 });
  const d = q.data;

  if (!d) {
    return html`<${Page} title="My money" onBack=${() => back('/pay')}>
      <header class="block"><h1 class="t-display">My money</h1></header>
      ${q.loading ? html`<div class="block" style="display:grid;gap:12px;margin-top:20px"><${Skel} h=${150} r=${22} /><${Skel} h=${110} r=${14} /></div><${SkelRows} n=${3} />`
        : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your money" />`}
    <//>`;
  }

  const profile = d.profile || {};
  const gstReg = profile.gst_registered === true;
  const month = d.month || {};
  const fy = d.fytd || {};
  const months = d.months || [];
  // A row's `payable` is already after the weekly deduction and any office change, so it is the figure to show.
  const rows = (d.invoices || []).map((r) => ({ ...r, payable_after_xero: null, trade_payable: r.payable != null ? r.payable : r.trade_payable, paid: r.status === 'paid' || r.paid === true || String(r.xero_bill_status || '').toUpperCase() === 'PAID',
    bill_status_label: r.bill_status_label || (['VOIDED', 'DELETED'].includes(String(r.xero_bill_status || '').toUpperCase()) ? 'Cancelled' : undefined) }));
  const left = rows.filter((r) => r.counts === false).length;

  return html`<${Page} title="My money" onBack=${() => back('/pay')}>
    <header class="block"><h1 class="t-display">My money</h1>
      <p class="t-small" style="margin-top:8px">${profile.abn ? 'ABN ' + profile.abn : 'No ABN on file'} · ${gstReg ? 'Registered for GST' : 'Not registered for GST'}</p></header>

    ${!rows.length ? html`<${Empty} title="Nothing here yet" action=${html`<${Button} kind="line" small onClick=${() => go('/pay')}>Go to this week<//>`}>When you send your first invoice, what you earned and what you have been paid shows here.<//>` : html`
      <section class="block period night rise">
        <span class="t-label">This month · ${monthName(month.month, month.label)}</span>
        <span class="money xl">${fmtMoney(month.gross_earned || 0)}</span>
        <span class="sub">Earned before super${month.invoices != null ? ', on ' + count(month.invoices) : ''}</span>
        <div class="pair">
          <div><span class="t-label">Paid to you</span><span class="money md">${cash(month.paid_total || 0)}</span></div>
          <div><span class="t-label">Still to come</span><span class="money md">${cash(month.outstanding || 0)}</span></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><span class="t-label">${yearLabel(d)}</span><span class="t-small t-mute">${fy.invoices != null ? count(fy.invoices) : ''}</span></div>
        <div class="block stats">
          <div class="stat wide"><span class="t-label">Earned</span><span class="money lg">${cash(fy.gross_earned || 0)}</span></div>
          <div class="stat"><span class="t-label">Paid to you</span><span class="money md">${cash(fy.paid_total || 0)}</span></div>
          <div class="stat"><span class="t-label">Still to come</span><span class="money md">${cash(fy.outstanding || 0)}</span></div>
          <div class=${gstReg ? 'stat' : 'stat wide'}><span class="t-label">Into your super</span><span class="money md">${cash(fy.super_amount || 0)}</span></div>
          ${gstReg ? html`<div class="stat"><span class="t-label">GST</span><span class="money md">${cash(fy.gst || 0)}</span></div>` : null}
        </div>
        ${num(fy.figures_incomplete) ? html`<p class="block t-small" style="margin-top:10px">${fy.figures_incomplete} older ${fy.figures_incomplete === 1 ? 'invoice has' : 'invoices have'} no super split, so earned and super leave ${fy.figures_incomplete === 1 ? 'it' : 'them'} out. Paid and still to come count ${fy.figures_incomplete === 1 ? 'it' : 'them'}.</p>` : null}
        <p class="block t-small t-mute" style="margin-top:10px">Super is 12%. Half is held from what you earn and the company pays the other half. Paid shows once the bookkeeper marks your bill paid.</p>
      </section>

      ${months.length ? html`<section class="section"><span class="t-label">Month by month</span>
        <div class="block months">
          <div class="mrow head"><span>Month</span><span>Earned</span><span>Paid</span><span>To come</span></div>
          ${months.map((m) => html`<div class="mrow" key=${m.month}><b>${shortMonth(m)}</b><span>${fmtMoney(m.gross_earned || 0)}</span><span>${fmtMoney(m.paid_total || 0)}</span><span class=${num(m.outstanding) ? 'due' : ''}>${num(m.outstanding) ? fmtMoney(m.outstanding) : 'Nil'}</span></div>`)}
        </div></section>` : null}

      <section class="section">
        <div class="section-head"><span class="t-label">Every invoice</span><span class="t-small t-mute">${rows.length}</span></div>
        <div class="list ruled">${rows.map((r) => (r.counts === false
          ? html`<div class="uncounted" key=${r.id}><${InvoiceRow} inv=${r} /><span class="uncounted-tag">Not counted in the totals</span></div>`
          : html`<${InvoiceRow} key=${r.id} inv=${r} />`))}</div>
        ${left ? html`<p class="block t-small t-mute" style="margin-top:12px">Drafts, invoices sent back to you and cancelled bills are listed but never added up.</p>` : null}
      </section>
    `}
  <//>`;
}

function yearLabel(d) {
  const m = /(\d{4})/.exec(d.fy_start || '');
  if (!m) return d.fy_label ? d.fy_label + ' so far' : 'This financial year';
  return `Since 1 July ${m[1]}`;
}
function shortMonth(m) {
  const name = monthName(m.month, m.label);
  const [mon, year] = name.split(' ');
  return mon && year ? `${mon.slice(0, 3)} ${year.slice(2)}` : name;
}
