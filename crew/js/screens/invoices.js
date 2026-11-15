// Invoices and earnings: every invoice by pay week, then what has been
// earned, paid and is still owing month by month, as the office system counts
// it. Every figure on this screen is the server's.
import { html } from '../lib/h.js';
import { go, back } from '../lib/router.js';
import { fmtMonth } from '../lib/dates.js';
import { Page, Section, KV, Button, SkelRows, Empty, LoadError } from '../ui/kit.js';
import { cash, num, plural } from '../ui/paybits.js';
import { InvoiceRow, useMoney } from './pay.js';

const monthName = (ym, label) => (/^\d{4}-\d{2}$/.test(ym || '') ? fmtMonth(ym + '-01') : label || '');
function shortMonth(m) {
  const [mon, year] = monthName(m.month, m.label).split(' ');
  return mon && year ? `${mon.slice(0, 3)} ${year}` : monthName(m.month, m.label);
}
function yearLabel(d) {
  const m = /(\d{4})/.exec(d.fy_start || '');
  return m ? `Since 1 July ${m[1]}` : d.fy_label ? d.fy_label + ' so far' : 'This financial year';
}

export function Invoices() {
  const q = useMoney();
  const d = q.data;
  if (!d) {
    return html`<${Page} title="Invoices" back="Pay" onBack=${() => back('/pay')}>
      ${q.loading ? html`<${SkelRows} n=${4} />` : html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your invoices" />`}
    <//>`;
  }
  const profile = d.profile || {};
  const gstReg = profile.gst_registered === true;
  const fy = d.fytd || {};
  const months = d.months || [];
  // A row's `payable` is already after the weekly deduction and any office change, so it is the figure to show.
  const rows = (d.invoices || []).map((r) => ({ ...r, payable_after_xero: null, trade_payable: r.payable != null ? r.payable : r.trade_payable, paid: r.status === 'paid' || r.paid === true || String(r.xero_bill_status || '').toUpperCase() === 'PAID' }));
  const left = rows.filter((r) => r.counts === false).length;

  return html`<${Page} title="Invoices" back="Pay" onBack=${() => back('/pay')}>
    <${Section} label="Invoices by pay week" right=${rows.length ? html`<span class="t-small t-num">${rows.length}</span>` : null}>
      ${!rows.length ? html`<${Empty} title="No invoices yet" action=${html`<${Button} kind="line" small onClick=${() => go('/pay')}>Go to this pay week<//>`}>When you send your first invoice it shows here, with what you earned and what you have been paid.<//>`
        : html`<div class="block card">${rows.map((r) => html`<${InvoiceRow} key=${r.id} inv=${r} from="invoices" note=${r.counts === false ? 'Not counted in the totals' : ''} />`)}</div>`}
      ${left ? html`<p class="block t-small pay-note">Drafts, invoices sent back to you and cancelled bills are listed but never added up.</p>` : null}
    <//>

    ${rows.length ? html`<${Section} label="Earnings by month">
      <div class="block card pay-months">
        <div class="pay-mrow head" aria-hidden="true"><span>Month</span><span>Earned</span><span>Paid</span><span>Owing</span></div>
        ${months.map((m) => html`<div class="pay-mrow" key=${m.month}><b>${shortMonth(m)}</b><span>${cash(m.gross_earned || 0)}</span><span>${cash(m.paid_total || 0)}</span><span class="owing">${cash(m.outstanding || 0)}</span></div>`)}
        ${!months.length ? html`<p class="pay-empty">No months to show yet.</p>` : null}
        <div class="pay-mtotal"><span>Financial year to date</span><span class="t-num">${cash(fy.gross_earned || 0)}</span></div>
      </div>
    <//>

    <${Section} label=${yearLabel(d)} right=${fy.invoices != null ? html`<span class="t-small t-num">${plural(fy.invoices, 'invoice')}</span>` : null}>
      <div class="block card">
        <${KV} k="Earned before super" v=${cash(fy.gross_earned || 0)} />
        <${KV} k="Paid to you" v=${cash(fy.paid_total || 0)} />
        <${KV} k="Still owing to you" v=${cash(fy.outstanding || 0)} />
        <${KV} k="Into your super" v=${cash(fy.super_amount || 0)} />
        ${gstReg ? html`<${KV} k="GST" v=${cash(fy.gst || 0)} />` : null}
      </div>
      ${num(fy.figures_incomplete) ? html`<p class="block t-small pay-note">${fy.figures_incomplete} older ${fy.figures_incomplete === 1 ? 'invoice has' : 'invoices have'} no super split, so earned and super leave ${fy.figures_incomplete === 1 ? 'it' : 'them'} out. Paid and owing count ${fy.figures_incomplete === 1 ? 'it' : 'them'}.</p>` : null}
      <p class="block t-small pay-note">Super is 12%. Half is held from what you earn and the company pays the other half. Paid shows once the bookkeeper marks your bill paid.</p>
      <p class="block t-small pay-note">${profile.abn ? 'ABN ' + profile.abn : 'No ABN on file'} · ${gstReg ? 'Registered for GST' : 'Not registered for GST'}</p>
    <//>` : null}
  <//>`;
}
