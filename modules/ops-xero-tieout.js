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

  // Parts the server says it has not read yet, in its own words.
  Core.notYetRead = function (tieout) {
    var list = tieout && Array.isArray(tieout.not_yet_read) ? tieout.not_yet_read : [];
    return list.map(function (x) { return String((x && x.why) || '').trim(); }).filter(Boolean);
  };
  // </xero-tieout-core>

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  var state = { months: 12, seq: 0, open: {}, tieout: null };

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

  function li(label, amount, sub) {
    return '<li><span>' + label + '</span><span class="amt">' + amount + '</span>' + (sub ? '<span class="jp-sub">' + sub + '</span>' : '') + '</li>';
  }

  function detailHtml(row) {
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
    if (row.spend.read) {
      h += li('Card and spend money', money(row.spend.ex), 'Money spent from the bank with no bill.');
    } else {
      h += li('Card and spend money', '<span class="jp-unk">Not read yet</span>', 'Not in the cost intake yet, so this is unknown, not $0.'
        + (row.spend.partialRows > 0 ? ' A partial look at the bank copy: ' + esc(row.spend.partialRows) + ' reconciled payment' + (row.spend.partialRows === 1 ? '' : 's') + (row.spend.partialEx != null ? ', ' + esc(Core.money(row.spend.partialEx)) : '') + ', not sorted and not counted.' : ''));
    }
    h += '</ul></div>';
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
      h += '<tr class="xt-detail" data-xt-detail="' + esc(r.month) + '"' + (open ? '' : ' hidden') + '><td colspan="10">' + detailHtml(r) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function footHtml(t) {
    var h = '<div class="xt-foot" data-xt-foot>';
    h += '<div>On a job is what Job Profit counts for the bill today: its cost lines on a real job, capped at the bill. A bill Job Profit holds back, such as an installer bill nobody has confirmed, is not on a job.</div>';
    h += '<div>Supplier bills approved or paid in Xero, by invoice date, ex GST, to the cent. Trade-app labour is a crew bill the trade app already counts on jobs.</div>';
    h += '<div>The date range only picks the months. Placements, Bills to place and bookkeeping rulings are read as they stand today.</div>';
    Core.notYetRead(t).forEach(function (why) { h += '<div>Not read yet: ' + esc(why) + '</div>'; });
    if (t.copy_synced_at) {
      var d = new Date(t.copy_synced_at);
      if (!isNaN(d.getTime())) h += '<div>Our copy of Xero\'s bills was last refreshed ' + esc(d.toLocaleString('en-AU', { timeZone: 'Australia/Perth' })) + ' (Perth).</div>';
    }
    return h + '</div>';
  }

  function topHtml() {
    return '<div class="xt-top"><h3>Tie to Xero</h3>'
      + '<div class="xt-lede">Every supplier bill dollar in Xero, by month: on a job, trade-app labour, overhead, or not placed yet. Tap a month for the reasons.</div>'
      + '<select class="form-input" id="xtMonths" title="How many months to show">'
      + [6, 12, 24].map(function (n) { return '<option value="' + n + '"' + (state.months === n ? ' selected' : '') + '>Last ' + n + ' months</option>'; }).join('')
      + '</select></div>';
  }

  function paint() {
    var el = host();
    if (!el || !state.tieout) return;
    var t = state.tieout;
    el.innerHTML = topHtml() + headlineHtml(t) + legendHtml() + tableHtml(t) + footHtml(t);
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
      paint();
    }).catch(function (e) {
      if (seq !== state.seq) return;
      failed((e && e.message) || 'unknown error', e && e.status);
    });
  }

  root.XeroTieoutCore = Core;
  root.XeroTieout = { load: load };
})(typeof window !== 'undefined' ? window : this);
