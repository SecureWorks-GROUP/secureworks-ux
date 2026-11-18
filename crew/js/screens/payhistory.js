// My pay (#/pay/history): the signed-in trade's own earned, super and paid
// totals across weeks, months and financial years, this year beside the same
// point last year, super status per invoice and rate history. Every figure is
// the server's; missing or unreadable data shows the error state, never zero.
import { html, cx, useState } from '../lib/h.js';
import { go, back } from '../lib/router.js';
import { addDays, fmtDay, fmtMonth, isISODate } from '../lib/dates.js';
import { Page, Section, KV, Button, SkelRows, buzz } from '../ui/kit.js';
import { cash, num, plural, weekWords } from '../ui/paybits.js';
import { usePayHistory } from './pay.js';

const TABS = [
  ['weeks', 'Weeks'],
  ['months', 'Months'],
  ['years', 'Years']
];

function isAmount(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isCount(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function validSuperInvoice(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.status === 'not_recorded' || r.status === 'not_in_xero') return r.amount === 0;
  if (r.status === 'marked_paid_by_office') return isAmount(r.amount) && isISODate(r.marked_paid_on);
  if (r.status === 'paid_to_fund' || r.status === 'to_be_paid') return isAmount(r.amount);
  return false;
}

// The office marked a run's super paid (ops-api 'marked_paid_by_office', with
// the Perth day it did). My pay never says the super reached the fund. An older
// ops-api still sends 'paid_to_fund' for the same fact, with no day.
const MARKED_PAID = new Set(['marked_paid_by_office', 'paid_to_fund']);

export function superStateWords(inv) {
  if (inv.status === 'to_be_paid') return 'To be paid to your fund';
  if (inv.status === 'marked_paid_by_office') return `Marked paid by the office on ${fmtDateYear(inv.marked_paid_on)}`;
  if (inv.status === 'paid_to_fund') return 'Marked paid by the office';
  return null;
}

export function superNotRecordedCount(d) {
  const n = d && d.super && d.super.not_recorded_count;
  return isCount(n) ? n : 0;
}

export function notInXeroCount(d) {
  const n = d && d.super && d.super.not_in_xero_count;
  return isCount(n) ? n : 0;
}

function fyLabelOf(iso) {
  const y = Number(iso.slice(5, 7)) >= 7 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1;
  return `FY ${y}/${String(y + 1).slice(2)}`;
}

function periodBucketsOf(weekStart, kind) {
  if (kind === 'weeks') return [weekStart, weekStart];
  const weekEnd = addDays(weekStart, 6);
  if (kind === 'months') return [weekStart.slice(0, 7), weekEnd.slice(0, 7)];
  return [fyLabelOf(weekStart), fyLabelOf(weekEnd)];
}

export function unrecordedPeriodSet(kind, periodRows, byInvoice, totalNotRecorded) {
  const out = new Set();
  if (!Array.isArray(periodRows) || !periodRows.length || !(totalNotRecorded > 0) || !Array.isArray(byInvoice)) return out;
  const keyOf = (r) => (kind === 'weeks' ? r.week_start : kind === 'months' ? r.month : r.fy_label);
  const rowMap = new Map(periodRows.map((r) => [keyOf(r), r]));
  const oldestSlicedMonth = kind === 'months' && periodRows.length >= 24 ? periodRows[periodRows.length - 1].month : null;
  const counted = byInvoice.filter((inv) => inv && isISODate(inv.week_start) &&
    (inv.status === 'not_recorded' || inv.status === 'to_be_paid' || MARKED_PAID.has(inv.status)));

  const canHold = (k, inv) => {
    if (!rowMap.has(k)) return Boolean(oldestSlicedMonth && k < oldestSlicedMonth);
    const amt = num(inv.amount) || 0;
    return amt > 0 ? num(rowMap.get(k).paid_to_super) >= amt : true;
  };

  const certain = new Map();
  const candidates = new Map();
  const pushTo = (map, k, inv) => {
    let list = map.get(k);
    if (!list) { list = []; map.set(k, list); }
    list.push(inv);
  };

  const straddlers = [];
  for (const inv of counted) {
    const [k0, k1] = periodBucketsOf(inv.week_start, kind);
    const uniq = k0 === k1 ? [k0] : [k0, k1];
    const possible = uniq.filter((k) => canHold(k, inv));
    if (possible.length === 1) {
      pushTo(certain, possible[0], inv);
      pushTo(candidates, possible[0], inv);
    } else if (possible.length === 2) {
      straddlers.push([inv, possible[0], possible[1]]);
    }
  }

  const isFull = (k) => {
    const r = rowMap.get(k);
    if (!r || !isCount(r.invoices)) return false;
    return (certain.get(k) || []).length >= r.invoices;
  };

  for (const [inv, k0, k1] of straddlers) {
    const full0 = isFull(k0);
    const full1 = isFull(k1);
    if (full0 && !full1) pushTo(candidates, k1, inv);
    else if (full1 && !full0) pushTo(candidates, k0, inv);
    else if (!full0 && !full1) {
      pushTo(candidates, k0, inv);
      pushTo(candidates, k1, inv);
    }
  }

  for (const r of periodRows) {
    if (num(r.paid_to_super) !== 0) continue;
    const k = keyOf(r);
    const invs = candidates.get(k) || [];
    if (invs.length > 0 && invs.every((inv) => inv.status === 'not_recorded')) out.add(k);
  }
  return out;
}

function validTotals(t) {
  return Boolean(t && typeof t === 'object' && isAmount(t.total_inc_super) && isAmount(t.paid_to_you) && isAmount(t.paid_to_super));
}

export function validPayHistory(d) {
  if (!d || typeof d !== 'object') return false;
  if (!Array.isArray(d.weeks) || !Array.isArray(d.months) || !Array.isArray(d.years) || !Array.isArray(d.rate_history)) return false;
  if (!d.weeks.every((r) => r && isISODate(r.week_start) && validTotals(r))) return false;
  if (!d.months.every((r) => r && typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) && validTotals(r))) return false;
  if (!d.years.every((r) => r && typeof r.fy_label === 'string' && r.fy_label.trim() && validTotals(r))) return false;
  const cmp = d.this_year_vs_last;
  if (!cmp || typeof cmp !== 'object' || !cmp.this_fy || !cmp.last_fy_same_point) return false;
  if (!isAmount(cmp.this_fy.paid_to_you) || !isAmount(cmp.this_fy.paid_to_super) ||
      !isAmount(cmp.last_fy_same_point.paid_to_you) || !isAmount(cmp.last_fy_same_point.paid_to_super)) return false;
  const sup = d.super;
  if (!sup || typeof sup !== 'object' || !isAmount(sup.this_fy) || !isAmount(sup.since_start) ||
      !isCount(sup.not_recorded_count) || !isCount(sup.not_in_xero_count) || !Array.isArray(sup.by_invoice)) return false;
  if (!sup.by_invoice.every(validSuperInvoice)) return false;
  if (sup.not_recorded_count < sup.by_invoice.filter((r) => r.status === 'not_recorded').length) return false;
  if (sup.not_in_xero_count < sup.by_invoice.filter((r) => r.status === 'not_in_xero').length) return false;
  if (!d.rate_history.every((r) => r && isISODate(r.effective_from) && isAmount(r.hourly_rate))) return false;
  return true;
}

function fmtDateYear(iso) {
  const parts = fmtDay(iso).split(' ');
  return `${parts[1]} ${parts[2]} ${String(iso).slice(0, 4)}`;
}

function RateSection({ rates }) {
  return html`<${Section} label="Your rate">
    ${!rates.length
      ? html`<div class="block card pad"><p class="t-small">No hourly rate on file. Work order jobs pay the agreed amount.</p></div>`
      : html`<div class="block card">${rates.map((r, idx) => html`<${KV} key=${`${r.effective_from}:${idx}`} k=${fmtDateYear(r.effective_from)} v=${`${cash(r.hourly_rate)}/h`} />`)}</div>`}
  <//>`;
}

export function PayHistory() {
  const q = usePayHistory();
  const [tab, setTab] = useState('weeks');
  const d = q.data;

  if (q.loading) {
    return html`<${Page} title="My pay" back="Pay" onBack=${() => back('/pay')}>
      <${SkelRows} n=${4} />
    <//>`;
  }

  const serverFailed = Boolean(q.error && !q.error.offline);
  if (serverFailed || !validPayHistory(d)) {
    return html`<${Page} title="My pay" back="Pay" onBack=${() => back('/pay')}>
      <div class="empty" role="alert">
        <p class="t-strong">Could not load your pay. Check your signal and try again.</p>
        <${Button} kind="line" small icon="refresh" onClick=${q.refetch}>Retry<//>
      </div>
    <//>`;
  }

  const rates = [...d.rate_history].sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)));
  const cmp = d.this_year_vs_last;
  const sup = d.super;
  const unrecorded = superNotRecordedCount(d);
  const unprocessed = notInXeroCount(d);
  const hasPay = d.weeks.length > 0 || d.months.length > 0 || d.years.length > 0 || sup.by_invoice.length > 0 ||
    num(sup.since_start) > 0 || unrecorded > 0 || unprocessed > 0 ||
    num(cmp.last_fy_same_point.paid_to_you) > 0 || num(cmp.last_fy_same_point.paid_to_super) > 0;

  if (!hasPay) {
    return html`<${Page} title="My pay" back="Pay" onBack=${() => back('/pay')}>
      <div class="block card pad"><p>Nothing paid yet. Your first invoice will show here.</p></div>
      <${RateSection} rates=${rates} />
    <//>`;
  }

  const rows = tab === 'weeks' ? d.weeks : tab === 'months' ? d.months : d.years;
  const unrecordedPeriods = unrecordedPeriodSet(tab, rows, sup.by_invoice, unrecorded);
  const unrecordedYears = tab === 'years' ? unrecordedPeriods : unrecordedPeriodSet('years', d.years, sup.by_invoice, unrecorded);
  const thisFyHasRows = num(cmp.this_fy.paid_to_you) > 0 || num(cmp.this_fy.paid_to_super) > 0;
  const thisFyUnrecorded = num(cmp.this_fy.paid_to_you) > 0 && num(cmp.this_fy.paid_to_super) === 0 &&
    d.years.length > 0 && unrecordedYears.has(d.years[0].fy_label);
  const lastFyRow = d.years[thisFyHasRows ? 1 : 0];
  const lastFyUnrecorded = num(cmp.last_fy_same_point.paid_to_you) > 0 && num(cmp.last_fy_same_point.paid_to_super) === 0 &&
    Boolean(lastFyRow && unrecordedYears.has(lastFyRow.fy_label));
  const maxTotal = rows.reduce((m, r) => Math.max(m, num(r.total_inc_super)), 0);
  const supRows = [...sup.by_invoice]
    .sort((a, b) => String(b.week_start || '').localeCompare(String(a.week_start || '')) || String(b.invoice_id || '').localeCompare(String(a.invoice_id || '')))
    .slice(0, 10);

  return html`<${Page} title="My pay" back="Pay" onBack=${() => back('/pay')} flush>
    <div class="tabs" role="tablist" aria-label="Pay periods">
      ${TABS.map(([id, label]) => html`<button type="button" role="tab" aria-selected=${String(tab === id)} onClick=${() => { setTab(id); buzz(5); }}>${label}</button>`)}
    </div>

    <div class="block card pay-hlist pay-gap">
      ${!rows.length ? html`<p class="pay-empty">Nothing in this period.</p>` : rows.map((r) => {
        const key = tab === 'weeks' ? r.week_start : tab === 'months' ? r.month : r.fy_label;
        const label = tab === 'weeks' ? weekWords(r.week_start) : tab === 'months' ? (r.label || fmtMonth(r.month + '-01')) : r.fy_label;
        const pct = maxTotal > 0 ? Math.max(0, Math.min(100, Math.round((num(r.total_inc_super) / maxTotal) * 1000) / 10)) : 0;
        const superUnrecorded = unrecordedPeriods.has(key);
        const body = html`
          <div class="pay-hhead"><b>${label}</b></div>
          <div class="pay-hbar" aria-hidden="true"><div class="pay-hbar-fill" style=${`width:${pct}%`} /></div>
          <div class="pay-hnums">
            <div class="pay-hkv"><span>Total (includes super)</span><span class="t-num">${cash(r.total_inc_super)}</span></div>
            <div class="pay-hkv strong"><span>Paid to you</span><span class="t-num">${cash(r.paid_to_you)}</span></div>
            <div class="pay-hkv"><span>Paid to your super fund</span>${superUnrecorded ? html`<span class="t-small nowrap">not recorded</span>` : html`<span class="t-num">${cash(r.paid_to_super)}</span>`}</div>
          </div>`;
        if (tab === 'weeks') {
          return html`<button type="button" class="pay-hrow tap" key=${key} onClick=${() => go('/pay/week/' + r.week_start)}>${body}</button>`;
        }
        return html`<div class="pay-hrow" key=${key}>${body}</div>`;
      })}
    </div>
    ${unprocessed > 0 ? html`<p class="block t-small pay-note">${plural(unprocessed, 'invoice')} not yet processed</p>` : null}

    <${Section} label="This year and last year">
      <div class="block card pay-hcompare">
        <div class="pay-hcol">
          <h3 class="t-cap">So far this financial year</h3>
          <div class="pay-hstat"><span>Paid to you</span><b class="t-num">${cash(cmp.this_fy.paid_to_you)}</b></div>
          <div class="pay-hstat"><span>Paid to your super fund</span>${thisFyUnrecorded ? html`<span class="t-small">not recorded</span>` : html`<b class="t-num">${cash(cmp.this_fy.paid_to_super)}</b>`}</div>
        </div>
        <div class="pay-hcol">
          <h3 class="t-cap">Same point last year</h3>
          <div class="pay-hstat"><span>Paid to you</span><b class="t-num">${cash(cmp.last_fy_same_point.paid_to_you)}</b></div>
          <div class="pay-hstat"><span>Paid to your super fund</span>${lastFyUnrecorded ? html`<span class="t-small">not recorded</span>` : html`<b class="t-num">${cash(cmp.last_fy_same_point.paid_to_super)}</b>`}</div>
        </div>
      </div>
    <//>

    <${Section} label="Super">
      <div class="block card">
        <${KV} k="This financial year" v=${cash(sup.this_fy)} />
        <${KV} k="Since you started" v=${cash(sup.since_start)} />
        ${supRows.map((inv, idx) => html`<div class="item pay-hsuper" key=${inv.invoice_id || idx}>
          <span class="main">
            <b>${isISODate(inv.week_start) ? weekWords(inv.week_start) : inv.invoice_number || 'Invoice'}</b>
            ${inv.invoice_number && isISODate(inv.week_start) ? html`<span class="sub t-num">${inv.invoice_number}</span>` : null}
            ${superStateWords(inv)
              ? html`<span class=${cx('sub pay-fundstate', MARKED_PAID.has(inv.status) && 'ok')}>${superStateWords(inv)}</span>`
              : null}
          </span>
          <span class="side">${inv.status === 'not_recorded'
            ? html`<span class="t-small nowrap">not recorded</span>`
            : inv.status === 'not_in_xero'
              ? html`<span class="t-small nowrap">Not yet processed</span>`
              : html`<span class="pay-figure">${cash(inv.amount)}</span>`}</span>
        </div>`)}
      </div>
      ${unrecorded > 0 ? html`<p class="block t-small pay-note">Super not recorded on ${plural(unrecorded, 'invoice')}</p>` : null}
    <//>

    <${RateSection} rates=${rates} />
  <//>`;
}
