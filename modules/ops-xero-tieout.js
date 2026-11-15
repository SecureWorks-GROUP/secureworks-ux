// Tie to Xero (Financials > Job profit > Tie to Xero).
//
// By month, every supplier bill dollar in our copy of Xero (ex GST), sorted
// into on a job, trade-app labour, overhead / not job related, or not placed
// yet, with the share not placed and whether the month's parts add up to the
// bills read directly. It is the proof that Job Profit and Xero agree.
//
// Read only. It calls ops-api xero_tieout (secureworks-backend
// supabase/functions/ops-api/xero_tieout.ts, SQL xero_tieout_monthly) and
// writes nothing. Every figure is the server's: this page sorts no bill and
// adds up no bucket. A part the server has not read yet (card spend) is
// shown as not read, never as $0. A failed read says so in words and never
// draws an empty table. Same viewers as Job profit; ops-api enforces it.
//
// The same answer may carry a second read, spend_revenue (SQL
// xero_spend_revenue_monthly): card and bank spend sorted by Xero account,
// and customer invoices against what Job Profit counts on jobs. It is drawn
// beside the bills, never added to them. Without it, or when it could not be
// read, the page is the bills page and says what is missing.
(function (root) {
  'use strict';

  // <xero-tieout-core>
  var Core = {};

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // A number, or null when the server sent none. Null is unknown, never 0.
  Core.num = function (value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  };

  Core.money = function (value) {
    var n = Core.num(value);
    if (n == null) return '';
    var s = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + s;
  };

  // A share from the server (0.0494) as a percentage to two places.
  Core.pct = function (share) {
    var n = Core.num(share);
    if (n == null) return '';
    return (n * 100).toFixed(2) + '%';
  };

  Core.monthLabel = function (month) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(month == null ? '' : month));
    if (!m) return String(month == null ? '' : month);
    return (MONTHS[Number(m[2]) - 1] || m[2]) + ' ' + m[1];
  };

  // Why a bill dollar is not placed yet, in the order the server sorts them.
  Core.REASONS = [
    { key: 'waiting_in_bills_to_place', label: 'Waiting in Bills to place', help: 'Nobody has placed or filed the bill yet.', action: 'bills_to_place' },
    { key: 'installer_awaiting_confirmation', label: 'Installer bill waiting for a person to confirm it', help: 'Not counted as job cost until a person confirms it.' },
    { key: 'holding_job', label: 'Parked on the holding job', help: 'Linked to the holding job, so it is on no real job.' },
    { key: 'not_in_intake', label: 'Never reached the bill intake', help: 'No Bills to place entry, no cost line and no bookkeeping evidence.' },
    { key: 'rows_short_of_bill', label: 'Placed for less than the bill', help: 'Some lines are on a job or ruled overhead. The rest of the bill is not.' }
  ];

  // The four parts of a month, in the order they are drawn.
  Core.PARTS = [
    { key: 'on_job', label: 'On a job' },
    { key: 'trade', label: 'Trade-app labour' },
    { key: 'overhead', label: 'Overhead' },
    { key: 'unplaced', label: 'Not placed yet' }
  ];

  // The answer is usable only when it carries its months. Anything else is a
  // failed read, never "nothing to show".
  Core.readable = function (answer) {
    var t = answer && answer.tieout;
    return !!(t && typeof t === 'object' && Array.isArray(t.months));
  };

  // One month of the server's answer, flattened for the page. Server figures
  // only: nothing here is worked out from another figure.
  Core.month = function (m) {
    m = m || {};
    var b = m.bills || {};
    var nonJob = b.non_job || {};
    var basis = nonJob.by_basis || {};
    var why = b.unplaced_by_reason || {};
    var over = b.over_allocated || {};
    var neg = b.negative_bill || {};
    var nc = m.not_counted || {};
    var spend = m.spend || {};
    var partial = spend.bank_copy_partial || {};
    var cn = m.credit_notes || {};
    var reasons = [];
    Core.REASONS.forEach(function (r) {
      var ex = Core.num(why[r.key]);
      if (ex != null && ex !== 0) reasons.push({ key: r.key, label: r.label, help: r.help, action: r.action || null, ex: ex });
    });
    return {
      month: String(m.month == null ? '' : m.month),
      label: Core.monthLabel(m.month),
      bills: Core.num(b.count),
      amountUnknown: Core.num(b.amount_unknown_count) || 0,
      total: Core.num(b.total_ex),
      onJob: Core.num(b.on_job_ex),
      trade: Core.num(b.trade_app_labour_ex),
      overhead: Core.num(nonJob.overhead_not_job_related_ex),
      overheadFiled: Core.num(basis.filed_in_bills_to_place_ex),
      overheadEvidence: Core.num(basis.bookkeeping_evidence_ex),
      unplaced: Core.num(b.unplaced_ex),
      share: Core.num(b.unplaced_share),
      addsUp: b.parts_add_up === true ? true : (b.parts_add_up === false ? false : null),
      reasons: reasons,
      over: { bills: Core.num(over.bills) || 0, ex: Core.num(over.ex) },
      negative: { bills: Core.num(neg.bills) || 0, ex: Core.num(neg.ex) },
      notCounted: { bills: Core.num(nc.draft_or_submitted_bills) || 0, ex: Core.num(nc.draft_or_submitted_ex) },
      spend: {
        read: spend.status === 'read',
        ex: Core.num(spend.amount_ex),
        partialRows: Core.num(partial.rows) || 0,
        partialEx: Core.num(partial.ex)
      },
      credit: {
        read: cn.status === 'read',
        notes: Core.num(cn.notes) || 0,
        totalEx: Core.num(cn.total_ex),
        onJobEx: Core.num((cn.on_job_ex || {}).counted_from_credit_note_ex),
        notPlacedInc: Core.num(cn.not_placed_inc),
        unallocatedInc: Core.num(cn.unallocated_inc),
        addsUp: cn.parts_add_up === true ? true : (cn.parts_add_up === false ? false : null)
      }
    };
  };

  // The width of each part of a month's bar, as a percentage of the month's
  // total. Drawing only: the figures beside the bar are the server's.
  Core.barParts = function (row) {
    var total = row && row.total;
    var values = { on_job: row && row.onJob, trade: row && row.trade, overhead: row && row.overhead, unplaced: row && row.unplaced };
    return Core.PARTS.map(function (p) {
      var v = Core.num(values[p.key]);
      var w = total && total > 0 && v != null && v > 0 ? Math.min(100, v / total * 100) : 0;
      return { key: p.key, label: p.label, ex: v, width: Math.round(w * 100) / 100 };
    });
  };

  // The six-month line and whether every month shown adds up.
  Core.headline = function (tieout) {
    var t = tieout || {};
    var six = t.last_6_months || {};
    var months = Array.isArray(t.months) ? t.months.map(Core.month) : [];
    var ok = 0, bad = 0, unknown = 0;
    months.forEach(function (m) {
      if (m.addsUp === true) ok += 1; else if (m.addsUp === false) bad += 1; else unknown += 1;
    });
    return {
      from: String(six.from == null ? '' : six.from),
      to: String(six.to == null ? '' : six.to),
      total: Core.num(six.bills_total_ex),
      unplaced: Core.num(six.unplaced_ex),
      unplacedShare: Core.num(six.unplaced_share_of_bills),
      accountedShare: Core.num(six.accounted_share_of_bills),
      monthsShown: months.length,
      monthsAddUp: ok,
      monthsDoNotAddUp: bad,
      monthsUnknown: unknown
    };
  };

  // Parts the server says it has not read yet, in its own words. skip names
  // parts another read on this page now covers.
  Core.notYetRead = function (tieout, skip) {
    var list = tieout && Array.isArray(tieout.not_yet_read) ? tieout.not_yet_read : [];
    var out = Array.isArray(skip) ? skip : [];
    return list.filter(function (x) { return out.indexOf(x && x.part) === -1; })
      .map(function (x) { return String((x && x.why) || '').trim(); }).filter(Boolean);
  };

  function bool3(v) { return v === true ? true : (v === false ? false : null); }

  // What a spend line was coded to, by Xero's own account type, in the order drawn.
  Core.SPEND_KINDS = [
    { key: 'direct_cost', label: 'Direct cost accounts' },
    { key: 'overhead', label: 'Overhead accounts' },
    { key: 'not_a_cost', label: 'Not a cost' },
    { key: 'income_account', label: 'Coded to an income account' },
    { key: 'account_unknown', label: 'Account not in our copy of the chart' },
    { key: 'paid_ahead', label: 'Paid ahead to suppliers' }
  ];

  // One month of card and bank spend. sorted is true only when the server
  // sorted the lines by account; otherwise the sorted figures are unknown.
  Core.spendMonth = function (sp) {
    sp = sp || {};
    var status = ['read', 'partial', 'not_yet_read', 'not_in_copy'].indexOf(sp.status) === -1 ? 'unknown' : sp.status;
    var direct = sp.direct_cost || {};
    var list = function (v) { return Array.isArray(v) ? v : []; };
    return {
      status: status,
      sorted: status === 'read' || status === 'partial',
      transactions: Core.num(sp.transactions) || 0,
      withLines: Core.num(sp.with_line_detail) || 0,
      amountUnknown: Core.num(sp.amount_unknown_count) || 0,
      total: Core.num(sp.total_ex),
      direct: Core.num(direct.ex),
      directOnJob: Core.num(direct.on_job_ex),
      overhead: Core.num(sp.overhead_ex),
      notACost: Core.num(sp.not_a_cost_ex),
      income: Core.num(sp.income_account_ex),
      unknownAccount: Core.num(sp.account_unknown_ex),
      unknownLines: Core.num(sp.account_unknown_lines) || 0,
      paidAhead: Core.num(sp.paid_ahead_ex),
      paidAheadLines: Core.num(sp.paid_ahead_lines) || 0,
      noDetail: Core.num(sp.no_line_detail_ex),
      differ: Core.num(sp.lines_differ_ex),
      differPayments: Core.num(sp.lines_differ_transactions) || 0,
      unreadLines: Core.num(sp.unread_lines) || 0,
      addsUp: bool3(sp.parts_add_up),
      accounts: list(sp.by_account).map(function (a) {
        a = a || {};
        return { code: a.code == null ? '' : String(a.code), name: a.name == null ? '' : String(a.name), kind: String(a.kind || ''), lines: Core.num(a.lines) || 0, ex: Core.num(a.ex) };
      }),
      tracking: list(direct.by_tracking).map(function (t) {
        t = t || {};
        return { tracking: t.tracking == null ? '' : String(t.tracking), lines: Core.num(t.lines) || 0, ex: Core.num(t.ex) };
      })
    };
  };

  // One month of customer invoices against Job Profit.
  Core.revenueMonth = function (rv) {
    rv = rv || {};
    var over = rv.over_counted || {};
    var nc = rv.not_counted || {};
    return {
      invoices: Core.num(rv.invoices) || 0,
      amountUnknown: Core.num(rv.amount_unknown_count) || 0,
      total: Core.num(rv.total_ex),
      onJob: Core.num(rv.on_job_ex),
      holding: Core.num(rv.holding_job_ex),
      notOnJob: Core.num(rv.not_on_job_ex),
      notOnJobInvoices: Core.num(rv.not_on_job_invoices) || 0,
      share: Core.num(rv.not_on_job_share),
      over: { invoices: Core.num(over.invoices) || 0, ex: Core.num(over.ex) },
      drafts: { invoices: Core.num(nc.draft_or_submitted_invoices) || 0, ex: Core.num(nc.draft_or_submitted_ex) },
      addsUp: bool3(rv.parts_add_up)
    };
  };

  // The second read as the page uses it. present: the server sent the key.
  // ok: it carried its months. A read that failed keeps the server's reason.
  Core.spendRevenue = function (answer) {
    var sr = answer && answer.spend_revenue;
    var none = { present: false, ok: false, reason: '', byMonth: {}, six: null, anySorted: false };
    if (!sr || typeof sr !== 'object') return none;
    var a = sr.ok === true && sr.answer && typeof sr.answer === 'object' && Array.isArray(sr.answer.months) ? sr.answer : null;
    if (!a) {
      none.present = true;
      none.reason = String(sr.reason || 'no answer');
      return none;
    }
    var by = {}, any = false;
    a.months.forEach(function (m) {
      if (!m || m.month == null) return;
      var spend = Core.spendMonth(m.spend);
      if (spend.sorted) any = true;
      by[String(m.month)] = { spend: spend, revenue: Core.revenueMonth(m.revenue) };
    });
    var six = a.last_6_months || {};
    return {
      present: true, ok: true, reason: '', byMonth: by, anySorted: any,
      six: {
        from: String(six.from == null ? '' : six.from),
        to: String(six.to == null ? '' : six.to),
        revenueTotal: Core.num(six.revenue_total_ex),
        revenueNotOnJob: Core.num(six.revenue_not_on_job_ex),
        revenueOnJobShare: Core.num(six.revenue_on_job_share),
        spendMonthsRead: Core.num(six.spend_months_read) || 0,
        spendTotal: Core.num(six.spend_total_ex),
        spendDirect: Core.num(six.spend_direct_cost_ex)
      }
    };
  };
  // </xero-tieout-core>

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  var state = { months: 12, seq: 0, open: {}, tieout: null, extra: Core.spendRevenue(null) };

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function host() { return document.getElementById('jpTieout'); }
  function unknown() { return '<span class="jp-unk">Unknown</span>'; }
  function money(v) { var s = Core.money(v); return s ? esc(s) : unknown(); }
  function pct(v) { var s = Core.pct(v); return s ? esc(s) : unknown(); }

  function injectStyles() {
    if (document.getElementById('xtStyles')) return;
    var css = ''
      + '.xt-top{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin:4px 0 12px;}'
      + '.xt-top h3{margin:0;font-size:16px;}'
      + '.xt-top .xt-lede{flex:1;min-width:240px;font-size:12px;color:var(--sw-text-sec);line-height:1.5;}'
      + '.xt-top select{font-size:12px;padding:4px 8px;width:auto;}'
      + '.xt-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px;}'
      + '.xt-card{background:var(--sw-card,#fff);border:1px solid var(--sw-border,#e2e8f0);border-radius:8px;padding:12px 14px;}'
      + '.xt-card .k{font-size:10px;text-transform:uppercase;letter-spacing:0.3px;font-weight:600;color:var(--sw-text-sec);}'
      + '.xt-card .v{font-size:22px;font-weight:700;font-family:var(--sw-font-num);margin-top:4px;line-height:1.15;}'
      + '.xt-card .s{font-size:11px;color:var(--sw-text-sec);margin-top:4px;line-height:1.4;}'
      + '.xt-card.good .v{color:var(--sw-green,#27ae60);}'
      + '.xt-card.warn .v{color:var(--sw-orange,#F15A29);}'
      + '.xt-card.bad{border-color:rgba(231,76,60,0.5);}'
      + '.xt-card.bad .v{color:var(--sw-red,#e74c3c);}'
      + '.xt-legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--sw-text-sec);margin:0 0 8px;}'
      + '.xt-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px;}'
      + '.xt-on_job{background:var(--sw-green,#27ae60);}'
      + '.xt-trade{background:var(--sw-mid,#4C6A7C);}'
      + '.xt-overhead{background:#b8c2c9;}'
      + '.xt-unplaced{background:var(--sw-orange,#F15A29);}'
      + '.xt-bar{display:flex;height:10px;min-width:120px;border-radius:5px;overflow:hidden;background:var(--sw-light,#eef1f4);}'
      + '.xt-bar span{display:block;height:100%;}'
      + '.jp-table tr.xt-row{cursor:pointer;}'
      + '.jp-table tr.xt-row:hover td{background:rgba(241,90,41,0.04);}'
      + '.jp-table tr.xt-row td:first-child{font-weight:700;white-space:nowrap;}'
      + '.xt-caret{display:inline-block;width:14px;color:var(--sw-text-sec);}'
      + '.xt-caret::before{content:"\\25B8";}'
      + '.xt-row[aria-expanded="true"] .xt-caret::before{content:"\\25BE";}'
      + '.jp-table tr.xt-detail>td{background:var(--sw-light,#f6f8fa);padding:10px 14px 12px;}'
      + '.xt-detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:6px 24px;}'
      + '.xt-detail h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.3px;color:var(--sw-text-sec);}'
      + '.xt-list{list-style:none;margin:0;padding:0;font-size:12px;}'
      + '.xt-list li{display:grid;grid-template-columns:1fr auto;gap:0 12px;padding:4px 0;border-bottom:1px solid var(--sw-border,#e6eaee);}'
      + '.xt-list li:last-child{border-bottom:none;}'
      + '.xt-list .jp-sub{grid-column:1 / -1;}'
      + '.xt-list .amt{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;}'
      + '.xt-ok{color:var(--sw-green,#27ae60);font-weight:700;}'
      + '.xt-bad{color:var(--sw-red,#e74c3c);font-weight:700;}'
      + '.xt-foot{font-size:11px;color:var(--sw-text-sec);margin-top:14px;line-height:1.55;max-width:980px;}'
      + '.xt-foot div+div{margin-top:4px;}'
      + '.xt-cards.xt-cards-2{margin-top:-4px;}'
      + '.xt-accounts{margin-top:6px;font-size:11px;color:var(--sw-text-sec);line-height:1.5;}'
      + '#subJobprofit .jp-bar[data-jp-mode-now="tieout"] select,#subJobprofit .jp-bar[data-jp-mode-now="tieout"] input{display:none;}'
      + '#subJobprofit .jp-bar[data-jp-mode-now="tieout"] [data-jp-open-number]{display:none;}'
      + '@media (max-width:600px){'
      + '.xt-card .v{font-size:19px;}'
      + '.jp-table.jp-stack tr.xt-row td.xt-bar-cell{grid-column:1 / -1;}'
      + '.jp-table.jp-stack tr.xt-detail{display:block;}'
      + '.jp-table.jp-stack tr.xt-detail[hidden]{display:none;}'
      + '.jp-table.jp-stack tr.xt-detail>td{font-weight:400;padding:8px 10px;}'
      + '}';
    var el = document.createElement('style');
    el.id = 'xtStyles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  function card(cls, k, v, s) {
    return '<div class="xt-card' + (cls ? ' ' + cls : '') + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>';
  }

  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
  }

  function headlineHtml(t) {
    var h = Core.headline(t);
    var span = h.from && h.to ? esc(day(h.from)) + ' to ' + esc(day(h.to)) : 'the last 6 months';
    var addCls = h.monthsDoNotAddUp > 0 ? 'bad' : (h.monthsUnknown > 0 ? 'warn' : 'good');
    var addText = h.monthsDoNotAddUp > 0
      ? esc(h.monthsDoNotAddUp) + ' month' + (h.monthsDoNotAddUp === 1 ? ' does' : 's do') + ' not add up to the bills in Xero. Do not rely on those months.'
      : (h.monthsUnknown > 0 ? 'Some months could not be checked.' : 'Each month\'s four parts equal the bills read straight from Xero\'s copy.');
    return '<div class="xt-cards" data-xt-headline>'
      + card('', 'Supplier bills in Xero', money(h.total), span + ', ex GST')
      + card('good', 'Accounted for', pct(h.accountedShare), 'On a job, trade-app labour or overhead')
      + card(h.unplaced ? 'warn' : 'good', 'Not placed yet', money(h.unplaced), pct(h.unplacedShare) + ' of those bills, rounded up')
      + card(addCls, 'Months that add up', esc(h.monthsAddUp) + ' of ' + esc(h.monthsShown), addText)
      + '</div>';
  }

  function legendHtml() {
    return '<div class="xt-legend">' + Core.PARTS.map(function (p) {
      return '<span><span class="xt-dot xt-' + p.key + '"></span>' + esc(p.label) + '</span>';
    }).join('') + '</div>';
  }

  function barHtml(row) {
    return '<div class="xt-bar" role="img" aria-label="' + esc(row.label) + ' bills by part">' + Core.barParts(row).map(function (p) {
      return p.width > 0 ? '<span class="xt-' + p.key + '" style="width:' + p.width + '%" title="' + esc(p.label + ' ' + Core.money(p.ex)) + '"></span>' : '';
    }).join('') + '</div>';
  }

  function addsUpHtml(v) {
    if (v === true) return '<span class="xt-ok" title="The four parts equal the bills read straight from the copy of Xero">Yes</span>';
    if (v === false) return '<span class="xt-bad" title="The parts do not equal the bills read straight from the copy of Xero">No</span>';
    return unknown();
  }

  function yesNo(v) {
    if (v === true) return '<span class="xt-ok">Yes</span>';
    if (v === false) return '<span class="xt-bad">No</span>';
    return unknown();
  }

  function plural(n, one, many) { return esc(n.toLocaleString()) + ' ' + (n === 1 ? one : many); }

  // The six-month line of the second read: customer invoices and card spend.
  function headline2Html(x) {
    if (!x.ok || !x.six) return '';
    var six = x.six;
    var share = six.revenueOnJobShare;
    var revCls = share == null ? '' : (share >= 0.995 ? 'good' : 'warn');
    var h = '<div class="xt-cards xt-cards-2" data-xt-headline2>';
    h += card(revCls, 'Customer invoices on a job', pct(share),
      money(six.revenueTotal) + ' invoiced in the last 6 months, ex GST. ' + money(six.revenueNotOnJob) + ' not on a job.');
    if (six.spendMonthsRead > 0) {
      h += card('', 'Card and bank spend', money(six.spendTotal),
        money(six.spendDirect) + ' on direct cost accounts, on no job yet. ' + esc(six.spendMonthsRead) + ' of the last 6 months read.');
    } else {
      h += card('', 'Card and bank spend', '<span class="jp-unk">Not read yet</span>', 'The lines are not copied from Xero yet, so this is unknown, not $0.');
    }
    return h + '</div>';
  }

  function spendBlockHtml(sp) {
    var h = '<div><h4>Card and bank spend, no bill</h4><ul class="xt-list" data-xt-spend>';
    var after = '';
    if (sp.status === 'not_in_copy') {
      h += li('Card and bank spend', '<span class="jp-unk">Not in our copy</span>', 'Before the first payment our copy of Xero holds, so this is unknown, not $0.');
    } else if (!sp.sorted) {
      h += li('Card and bank spend', '<span class="jp-unk">Not read yet</span>',
        (sp.transactions > 0 ? plural(sp.transactions, 'payment', 'payments') + (sp.total != null ? ', ' + esc(Core.money(sp.total)) : '') + ' in the bank copy. ' : '')
        + 'The lines are not read yet, so nothing is sorted and this is unknown, not $0.');
    } else {
      h += li('Spent, ex GST', money(sp.total), plural(sp.transactions, 'payment', 'payments') + ' reconciled in Xero, each line sorted by the account it was coded to.');
      h += li('Direct cost accounts', money(sp.direct), 'Materials, hire and outside labour paid straight from the bank or card. On no job yet: Job Profit does not read card spend.');
      h += li('Overhead accounts', money(sp.overhead), '');
      h += li('Not a cost', money(sp.notACost), 'Loan repayments, tax, wages payable, drawings and assets.');
      if (sp.income) h += li('Coded to an income account', money(sp.income), 'Money out against a sales account. Worth a look.');
      if (sp.unknownAccount || sp.unknownLines > 0) h += li('Account not in our copy of the chart', money(sp.unknownAccount), plural(sp.unknownLines, 'line', 'lines') + ' we cannot sort.');
      if (sp.paidAhead || sp.paidAheadLines > 0) h += li('Paid ahead to suppliers', money(sp.paidAhead), 'Prepayments and overpayments. The cost usually arrives again on a supplier bill, so it is not counted as a cost here.');
      if (sp.noDetail) h += li('Lines not read yet', money(sp.noDetail), esc(sp.transactions - sp.withLines) + ' of ' + plural(sp.transactions, 'payment', 'payments') + '. Unknown account, not $0.');
      if (sp.amountUnknown > 0) h += li('Payments with no amount in the copy', esc(sp.amountUnknown), 'Their dollars are unknown, not $0.');
      if (sp.unreadLines > 0) h += li('Lines with no amount we can read', esc(sp.unreadLines), 'Their dollars are in no part above. Unknown, not $0.');
      if (sp.differPayments > 0) h += li('Payments whose lines do not match their total', esc(sp.differPayments), 'Each is out by more than 5 cents' + (sp.differ != null ? ', ' + esc(Core.money(sp.differ)) + ' in all once they are netted' : '') + '.');
      h += li('Adds up to the payments', yesNo(sp.addsUp), sp.addsUp === false ? 'The sorted lines do not equal the payments read straight from the copy. Do not rely on this month.' : '');
      var top = sp.accounts.slice(0, 6).map(function (a) {
        return esc((a.code ? a.code + ' ' : '') + (a.name || 'not in the chart')) + ' ' + money(a.ex);
      });
      if (top.length) after = '<div class="xt-accounts" data-xt-accounts>Largest accounts: ' + top.join(', ') + (sp.accounts.length > 6 ? ', and ' + esc(sp.accounts.length - 6) + ' more' : '') + '.</div>';
    }
    return h + '</ul>' + after + '</div>';
  }

  function revenueBlockHtml(rv) {
    var h = '<div><h4>Customer invoices</h4><ul class="xt-list" data-xt-revenue>';
    h += li('Invoiced, ex GST', money(rv.total), plural(rv.invoices, 'invoice', 'invoices') + ' approved or paid in Xero.');
    h += li('On a job', money(rv.onJob), 'What Job Profit counts as invoiced on a real job.');
    if (rv.holding) h += li('On the holding job', money(rv.holding), 'Linked to the holding job, so it is on no real job.');
    h += li('Not on a job', money(rv.notOnJob), rv.notOnJobInvoices > 0 ? plural(rv.notOnJobInvoices, 'invoice', 'invoices') + ' with dollars Job Profit does not count on any job.' : 'Every invoice dollar is on a job.');
    if (rv.over.invoices > 0) h += li('Counted above the invoice', money(rv.over.ex), plural(rv.over.invoices, 'invoice', 'invoices') + ' where the job lines add to more than the invoice. Shown, never netted.');
    if (rv.drafts.invoices > 0) h += li('Draft or submitted invoices', money(rv.drafts.ex), plural(rv.drafts.invoices, 'invoice', 'invoices') + ' not yet approved in Xero, so not counted.');
    if (rv.amountUnknown > 0) h += li('Invoices with no amount in the copy', esc(rv.amountUnknown), 'Their dollars are unknown, not $0.');
    h += li('Adds up to the invoices', yesNo(rv.addsUp), rv.addsUp === false ? 'The parts do not equal the invoices read straight from the copy. Do not rely on this month.' : '');
    return h + '</ul></div>';
  }

  function li(label, amount, sub) {
    return '<li><span>' + label + '</span><span class="amt">' + amount + '</span>' + (sub ? '<span class="jp-sub">' + sub + '</span>' : '') + '</li>';
  }

  function detailHtml(row, more) {
    var h = '<div class="xt-detail-grid">';
    h += '<div><h4>Not placed yet, by reason</h4><ul class="xt-list" data-xt-reasons>';
    if (!row.reasons.length) {
      h += li(row.unplaced === 0 ? 'Nothing waiting. Every bill dollar this month is accounted for.' : 'No reason was given by the server.', '', '');
    } else {
      row.reasons.forEach(function (r) {
        var sub = esc(r.help) + (r.action === 'bills_to_place' ? ' <a href="#" data-xt-bills-to-place>Open Bills to place</a>' : '');
        h += li(esc(r.label), money(r.ex), sub);
      });
    }
    h += '</ul></div>';

    h += '<div><h4>Overhead and not job related</h4><ul class="xt-list">';
    h += li('Filed by a person in Bills to place', money(row.overheadFiled), '');
    h += li('Ruled by bookkeeping\'s line evidence', money(row.overheadEvidence), 'A line both name is counted once.');
    h += '</ul></div>';

    h += '<div><h4>Beside the total, not in it</h4><ul class="xt-list" data-xt-beside>';
    if (row.over.bills > 0) h += li('Placed for more than the bill', money(row.over.ex), esc(row.over.bills) + ' bill' + (row.over.bills === 1 ? '' : 's') + ' where the job lines and the not-a-job ruling add to more than the bill. Worth a look.');
    if (row.negative.bills > 0) h += li('Bills below $0', money(row.negative.ex), esc(row.negative.bills) + ' bill' + (row.negative.bills === 1 ? '' : 's') + ', shown only here.');
    if (row.notCounted.bills > 0) h += li('Draft or submitted bills', money(row.notCounted.ex), esc(row.notCounted.bills) + ' not yet approved in Xero, so not counted.');
    if (row.amountUnknown > 0) h += li('Bills with no amount in the copy', esc(row.amountUnknown), 'Their dollars are unknown, not $0.');
    if (row.credit.read) {
      h += li('Supplier credit notes', money(row.credit.totalEx), esc(row.credit.notes) + ' note' + (row.credit.notes === 1 ? '' : 's') + ', ex GST. Job Profit takes ' + money(row.credit.onJobEx) + ' off job cost. Shown beside the bills, never netted from them.'
        + (row.credit.addsUp === false ? ' <span class="xt-bad">These notes do not add up.</span>' : ''));
    } else {
      h += li('Supplier credit notes', '<span class="jp-unk">Not read yet</span>', 'Not copied from Xero yet, so this is unknown, not $0.');
    }
    if (more && more.spend.sorted) {
      h += li('Card and bank spend', money(more.spend.total), 'Money spent from the bank or card with no bill. Sorted by Xero account in the next panel, and not part of the bills total.');
    } else if (row.spend.read) {
      h += li('Card and spend money', money(row.spend.ex), 'Money spent from the bank with no bill.');
    } else {
      h += li('Card and spend money', '<span class="jp-unk">Not read yet</span>', 'Not in the cost intake yet, so this is unknown, not $0.'
        + (row.spend.partialRows > 0 ? ' A partial look at the bank copy: ' + esc(row.spend.partialRows) + ' reconciled payment' + (row.spend.partialRows === 1 ? '' : 's') + (row.spend.partialEx != null ? ', ' + esc(Core.money(row.spend.partialEx)) : '') + ', not sorted and not counted.' : ''));
    }
    h += '</ul></div>';
    if (more) h += spendBlockHtml(more.spend) + revenueBlockHtml(more.revenue);
    return h + '</div>';
  }

  function tableHtml(t) {
    var rows = t.months.map(Core.month);
    var h = '<div class="jp-wrap"><table class="jp-table jp-stack" data-xt-months><thead><tr>'
      + '<th>Month</th><th class="num">Bills</th><th class="num">In Xero, ex GST</th><th class="num">On a job</th><th class="num">Trade-app labour</th>'
      + '<th class="num">Overhead</th><th class="num">Not placed yet</th><th class="num">Not placed</th><th>Adds up</th><th class="jp-bar-cell">Split</th>'
      + '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="10"><div class="jp-note">The server returned no months for this range.</div></td></tr>';
    rows.forEach(function (r) {
      var open = !!state.open[r.month];
      h += '<tr class="xt-row" data-xt-month="' + esc(r.month) + '" tabindex="0" role="button" aria-expanded="' + (open ? 'true' : 'false') + '">'
        + '<td><span class="xt-caret" aria-hidden="true"></span>' + esc(r.label) + '</td>'
        + '<td class="num" data-label="Bills">' + (r.bills != null ? esc(r.bills.toLocaleString()) : unknown()) + '</td>'
        + '<td class="num" data-label="In Xero, ex GST">' + money(r.total) + '</td>'
        + '<td class="num" data-label="On a job">' + money(r.onJob) + '</td>'
        + '<td class="num" data-label="Trade-app labour">' + money(r.trade) + '</td>'
        + '<td class="num" data-label="Overhead">' + money(r.overhead) + '</td>'
        + '<td class="num" data-label="Not placed yet">' + money(r.unplaced) + '</td>'
        + '<td class="num" data-label="Not placed">' + (r.total ? pct(r.share) : '<span class="jp-unk">No bills</span>') + '</td>'
        + '<td data-label="Adds up">' + addsUpHtml(r.addsUp) + '</td>'
        + '<td class="jp-bar-cell xt-bar-cell">' + barHtml(r) + '</td>'
        + '</tr>';
      h += '<tr class="xt-detail" data-xt-detail="' + esc(r.month) + '"' + (open ? '' : ' hidden') + '><td colspan="10">' + detailHtml(r, state.extra.ok ? state.extra.byMonth[r.month] : null) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function footHtml(t) {
    var h = '<div class="xt-foot" data-xt-foot>';
    h += '<div>On a job is what Job Profit counts for the bill today: its cost lines on a real job, capped at the bill. A bill Job Profit holds back, such as an installer bill nobody has confirmed, is not on a job.</div>';
    h += '<div>Supplier bills approved or paid in Xero, by invoice date, ex GST, to the cent. Trade-app labour is a crew bill the trade app already counts on jobs.</div>';
    h += '<div>The date range only picks the months. Placements, Bills to place and bookkeeping rulings are read as they stand today.</div>';
    var x = state.extra;
    Core.notYetRead(t, x.ok && x.anySorted ? ['spend_money'] : []).forEach(function (why) { h += '<div>Not read yet: ' + esc(why) + '</div>'; });
    if (x.ok) {
      h += '<div>Card and bank spend is money paid straight from the bank or card with no supplier bill, reconciled in Xero, ex GST, by payment date. Each line is sorted by Xero\'s own account type. None of it is on a job yet. Transfers between our own accounts and money received are not spend.</div>';
      h += '<div>Customer invoices are sales invoices approved or paid in Xero, by invoice date, ex GST. On a job is what Job Profit counts as invoiced for that invoice today.</div>';
    } else if (x.present) {
      h += '<div data-xt-extra-failed>Card spend and customer invoices could not be read just now (' + esc(x.reason) + '), so they are not shown. The bills above are not affected.</div>';
    }
    if (t.copy_synced_at) {
      var d = new Date(t.copy_synced_at);
      if (!isNaN(d.getTime())) h += '<div>Our copy of Xero\'s bills was last refreshed ' + esc(d.toLocaleString('en-AU', { timeZone: 'Australia/Perth' })) + ' (Perth).</div>';
    }
    return h + '</div>';
  }

  function topHtml() {
    return '<div class="xt-top"><h3>Tie to Xero</h3>'
      + '<div class="xt-lede">Every supplier bill dollar in Xero, by month: on a job, trade-app labour, overhead, or not placed yet. Tap a month for the reasons' + (state.extra.ok ? ', card and bank spend, and customer invoices' : '') + '.</div>'
      + '<select class="form-input" id="xtMonths" title="How many months to show">'
      + [6, 12, 24].map(function (n) { return '<option value="' + n + '"' + (state.months === n ? ' selected' : '') + '>Last ' + n + ' months</option>'; }).join('')
      + '</select></div>';
  }

  function paint() {
    var el = host();
    if (!el || !state.tieout) return;
    var t = state.tieout;
    el.innerHTML = topHtml() + headlineHtml(t) + headline2Html(state.extra) + legendHtml() + tableHtml(t) + footHtml(t);
  }

  function toggle(month) {
    state.open[month] = !state.open[month];
    paint();
    var row = host() && host().querySelector('[data-xt-month="' + month + '"]');
    if (row && row.focus) row.focus();
  }

  function wire(el) {
    if (el.__xtWired) return;
    el.__xtWired = true;
    el.addEventListener('click', function (ev) {
      var link = ev.target.closest && ev.target.closest('[data-xt-bills-to-place]');
      if (link) {
        ev.preventDefault();
        if (typeof root.jpOpenBillsToPlace === 'function') root.jpOpenBillsToPlace();
        return;
      }
      var retry = ev.target.closest && ev.target.closest('[data-xt-retry]');
      if (retry) { load(); return; }
      var row = ev.target.closest && ev.target.closest('tr.xt-row');
      if (row) toggle(row.getAttribute('data-xt-month'));
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var row = ev.target.closest && ev.target.closest('tr.xt-row');
      if (row) { ev.preventDefault(); toggle(row.getAttribute('data-xt-month')); }
    });
    el.addEventListener('change', function (ev) {
      if (ev.target && ev.target.id === 'xtMonths') {
        var n = Number(ev.target.value);
        state.months = n === 6 || n === 24 ? n : 12;
        load();
      }
    });
  }

  function failed(message, status) {
    var el = host();
    if (!el) return;
    state.tieout = null;
    el.innerHTML = topHtml() + '<div class="jp-note err" data-xt-error>The tie to Xero could not be read, so no month is shown: ' + esc(message || 'unknown error')
      + (status === 403 ? ' (owner, admin or office-staff sign-in required)' : '') + '. <button class="btn btn-secondary btn-sm sw-tap" data-xt-retry>Retry</button></div>';
  }

  function load() {
    var el = host();
    if (!el) return Promise.resolve();
    injectStyles();
    wire(el);
    var seq = ++state.seq;
    if (!state.tieout) el.innerHTML = topHtml() + '<div class="jp-sub" style="padding:16px;" data-xt-loading>Reading the bills against Job Profit...</div>';
    if (typeof root.opsFetch !== 'function') { failed('this page cannot reach the server'); return Promise.resolve(); }
    return root.opsFetch('xero_tieout', { months: state.months }).then(function (answer) {
      if (seq !== state.seq) return;
      if (!Core.readable(answer)) { failed('the server answered without its months'); return; }
      state.tieout = answer.tieout;
      state.extra = Core.spendRevenue(answer);
      paint();
    }).catch(function (e) {
      if (seq !== state.seq) return;
      failed((e && e.message) || 'unknown error', e && e.status);
    });
  }

  root.XeroTieoutCore = Core;
  root.XeroTieout = { load: load };
})(typeof window !== 'undefined' ? window : this);
