// ════════════════════════════════════════════════════════════
// Paid close-out tags and the Get Review ladder (fencing and patio)
// ════════════════════════════════════════════════════════════
// Contract: docs/job-closeout-screens.md. Backend: secureworks-backend
// docs/job-closeout-v1.md (a paid fencing or patio job goes to Get Review, one
// review text goes out, and the card archives 24 hours later).
//
// Preview: off unless ?closeout=preview or localStorage sw_closeout_preview = '1'
// (?closeout=live turns it off again). With it off, the board, the job page and
// the status buttons stay exactly as they were.
//
// Reads only. Each fencing and patio row of `pipeline` (and `job_detail`) may
// carry one read-only block:
//   closeout: { paid_less_than_quoted, shortfall_inc,
//               review: { status, reason } | null,
//               get_review_entered_at, archive_due_at,
//               held: 'rectification' | 'callback' | null }
// No block, no tags: nothing is ever worked out in the browser.
// ════════════════════════════════════════════════════════════

// <job-closeout-core>
var JobCloseoutCore = (function () {
  'use strict';

  var TYPES = ['fencing', 'patio'];
  var HOUR = 3600000;

  function str(v) { return v == null ? '' : String(v); }
  function lower(v) { return str(v).trim().toLowerCase(); }
  function esc(v) {
    return str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // The URL wins and is remembered; otherwise the browser setting decides.
  function previewState(search, stored) {
    var m = /[?&]closeout=([^&#]*)/.exec(str(search));
    if (m) {
      var v = lower(m[1].replace(/%20|\+/g, ''));
      if (v === 'preview') return { on: true, persist: '1' };
      if (v === 'live') return { on: false, persist: '0' };
    }
    return { on: str(stored) === '1', persist: null };
  }

  function eligibleType(type) { return TYPES.indexOf(lower(type)) >= 0; }

  // The block, only on a fencing or patio job and only when it is an object.
  function blockOf(job) {
    if (!job || !eligibleType(job.type)) return null;
    var b = job.closeout;
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  }

  var REASON_WORDS = {
    asked_recently: 'asked in the last 90 days',
    no_contact: 'no contact linked',
    paid_too_long_ago: 'paid over 30 days ago',
    refused: 'text refused',
    stuck_claim: 'send not confirmed',
    facts_unreadable: 'quote could not be read',
    quote_unreadable: 'quote could not be read',
    lookback_unreadable: 'past texts could not be read',
    claim_failed: 'could not record the send',
    sender_off: 'review sender off',
    switch_off: 'review sender off',
    dry_run: 'trial run only',
    held: 'job on hold',
    not_paid: 'not fully paid'
  };

  function reasonWords(reason) {
    var r = lower(reason);
    if (!r) return '';
    return REASON_WORDS[r] || r.replace(/_+/g, ' ');
  }

  function money(n) {
    var v = Number(n);
    if (n == null || n === '' || !isFinite(v)) return '';
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function timeOf(v) {
    if (!v) return NaN;
    var t = Date.parse(str(v));
    return isFinite(t) ? t : NaN;
  }

  function reviewTag(review) {
    if (!review || typeof review !== 'object') return null;
    var status = lower(review.status);
    var reason = reasonWords(review.reason);
    if (status === 'sent') {
      return { kind: 'review_sent', tone: 'good', text: 'Review sent', title: 'The review text went out' };
    }
    if (status === 'claimed') {
      return { kind: 'review_sending', tone: 'info', text: 'Review sending', title: 'The review text is being sent now' };
    }
    if (status === 'unconfirmed') {
      return {
        kind: 'review_unconfirmed', tone: 'warn', text: 'Review not confirmed',
        title: 'A review text could not be confirmed as sent. It is never sent again.'
      };
    }
    return {
      kind: 'review_not_sent', tone: 'warn',
      text: 'Review not sent' + (reason ? ': ' + reason : ''),
      title: 'No review text went out' + (reason ? ' (' + reason + ')' : '')
    };
  }

  // The small tags for one job, in the order they are drawn.
  function tags(job, status, nowMs) {
    var b = blockOf(job);
    if (!b) return [];
    var st = lower(status != null ? status : job.status);
    var out = [];
    var held = lower(b.held);
    if (b.paid_less_than_quoted === true) {
      var short = money(b.shortfall_inc);
      out.push({
        kind: 'paid_less_than_quoted', tone: 'bad', text: 'Paid less than quoted',
        title: 'Every invoice is paid but the money is short of the quote plus agreed variations' +
          (short ? ' by ' + short : '') + '. The card stays here until it is moved by hand.'
      });
    }
    // Rectification already has its RECT badge on a Rectification card.
    if ((held === 'callback') || (held === 'rectification' && st !== 'rectification')) {
      out.push({
        kind: 'held', tone: 'warn', text: 'Held: ' + held,
        title: 'Close-out is on hold (' + held + '): no review text and no archive'
      });
    }
    var rt = reviewTag(b.review);
    if (rt) out.push(rt);
    if (st === 'get_review' && !held) {
      var due = timeOf(b.archive_due_at);
      if (isFinite(due)) {
        var left = due - Number(nowMs);
        var entered = timeOf(b.get_review_entered_at);
        var why = isFinite(entered)
          ? 'In Get Review since ' + new Date(entered).toISOString().slice(0, 16).replace('T', ' ') + ' UTC. '
          : '';
        out.push(left > 0
          ? {
            kind: 'archive_in', tone: 'info',
            text: left < HOUR ? 'Archives in under 1h' : 'Archives in ' + Math.ceil(left / HOUR) + 'h',
            title: why + 'The card archives on its own after 24 hours in Get Review.'
          }
          : {
            kind: 'archive_due', tone: 'info', text: 'Archive due',
            title: why + 'The card archives at the next close-out sweep (every 30 minutes).'
          });
      }
    }
    return out;
  }

  var TONE_STYLE = {
    good: 'background:rgba(39,174,96,0.12);color:#1E8449;',
    info: 'background:rgba(155,89,182,0.12);color:#7D3C98;',
    warn: 'background:rgba(230,126,34,0.14);color:#B9590F;',
    bad: 'background:rgba(231,76,60,0.12);color:#C0392B;'
  };

  function tagsHtml(list) {
    if (!list || !list.length) return '';
    return '<div class="kanban-closeout-tags" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">' +
      list.map(function (t) {
        return '<span class="kanban-meta-badge closeout-tag" data-closeout-tag="' + esc(t.kind) + '" style="' +
          (TONE_STYLE[t.tone] || '') + 'font-weight:600;" title="' + esc(t.title) + '">' + esc(t.text) + '</span>';
      }).join('') + '</div>';
  }

  // The status buttons for a fencing or patio job with the preview on: the tail
  // of the ladder follows the board, invoiced -> get_review -> archived. Answers
  // null for every other job, and with the preview off, so the old ladder stands.
  var LADDER = {
    fencing: {
      final_payment: ['invoiced'],
      complete: ['invoiced', 'archived'],
      invoiced: ['get_review'],
      get_review: ['archived']
    },
    patio: {
      complete: ['invoiced'],
      invoiced: ['get_review'],
      get_review: ['archived']
    }
  };

  function nextStatuses(current, type, previewOn) {
    if (!previewOn || !eligibleType(type)) return null;
    var row = LADDER[lower(type)][lower(current)];
    return row ? row.slice() : null;
  }

  return {
    previewState: previewState,
    eligibleType: eligibleType,
    blockOf: blockOf,
    reasonWords: reasonWords,
    tags: tags,
    tagsHtml: tagsHtml,
    nextStatuses: nextStatuses
  };
})();
// </job-closeout-core>

var JobCloseoutOps = (function () {
  'use strict';

  var STORE_KEY = 'sw_closeout_preview';
  var _preview = null;

  function previewOn() {
    if (_preview !== null) return _preview;
    var stored = null;
    try { stored = localStorage.getItem(STORE_KEY); } catch (e) { stored = null; }
    var st = JobCloseoutCore.previewState(location.search, stored);
    if (st.persist) {
      try {
        if (st.persist === '1') localStorage.setItem(STORE_KEY, '1');
        else localStorage.removeItem(STORE_KEY);
      } catch (e) { /* private window: the URL still decides this load */ }
    }
    _preview = st.on;
    return _preview;
  }

  // A tag must never break a card: any throw draws nothing.
  function cardTagsHtml(job, status) {
    try {
      if (!previewOn()) return '';
      return JobCloseoutCore.tagsHtml(JobCloseoutCore.tags(job, status, Date.now()));
    } catch (e) { return ''; }
  }

  // job_detail: the block beside the job, or on it.
  function detailTagsHtml(data) {
    try {
      if (!previewOn() || !data || !data.job) return '';
      var job = data.job;
      var block = data.closeout !== undefined ? data.closeout : job.closeout;
      var view = { type: job.type, status: job.status, closeout: block };
      return JobCloseoutCore.tagsHtml(JobCloseoutCore.tags(view, job.status, Date.now()));
    } catch (e) { return ''; }
  }

  function nextStatuses(current, type) {
    try { return JobCloseoutCore.nextStatuses(current, type, previewOn()); } catch (e) { return null; }
  }

  return {
    previewOn: previewOn,
    cardTagsHtml: cardTagsHtml,
    detailTagsHtml: detailTagsHtml,
    nextStatuses: nextStatuses
  };
})();

if (typeof window !== 'undefined') {
  window.JobCloseoutCore = JobCloseoutCore;
  window.JobCloseoutOps = JobCloseoutOps;
}
