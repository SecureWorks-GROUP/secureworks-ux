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
//
// The Review text switch (same preview): fencing and patio cards in Complete,
// Invoiced, Final Payment and Get Review carry a small on/off switch. On (the
// default) means the review text sends; off calls ops-api `set_review_opt_out`.
// It reads `review_opt_out` and `review_claim_status` off the closeout block,
// and who and when (`review_opt_out_by`, `review_opt_out_at`) off the row (on
// `job_detail`, off its job). No `review_opt_out` boolean on the block, no
// switch: the back end has not shipped it. Once `review_claim_status` is set the text has gone (or is going)
// and the switch is locked.
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

  // ── Review text switch ──
  var TOGGLE_STAGES = ['complete', 'invoiced', 'final_payment', 'get_review'];

  function perthWhen(v) {
    var t = timeOf(v);
    if (!isFinite(t)) return '';
    var d = new Date(t + 8 * HOUR);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var h = d.getUTCHours();
    var m = d.getUTCMinutes();
    return d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' +
      ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }

  // The switch's facts: off and any claim from the closeout block, who and when
  // from the job's own columns.
  function reviewState(job) {
    var b = blockOf(job);
    return {
      optOut: b ? b.review_opt_out : undefined,
      claim: b ? str(b.review_claim_status).trim() : '',
      by: job ? str(job.review_opt_out_by).trim() : '',
      at: job ? job.review_opt_out_at : null
    };
  }

  function claimWords(claim) {
    var c = lower(claim);
    if (c === 'sent') return 'Review text sent';
    if (c === 'claimed') return 'Review text sending';
    if (c === 'unconfirmed') return 'Review text not confirmed';
    return '';
  }

  // The switch for one job, or null when it is not drawn.
  function reviewToggle(job, status) {
    if (!job || !eligibleType(job.type)) return null;
    var st = lower(status != null ? status : job.status);
    if (TOGGLE_STAGES.indexOf(st) < 0) return null;
    var rs = reviewState(job);
    var optOut = rs.optOut;
    if (typeof optOut !== 'boolean') return null;
    var claim = rs.claim;
    var by = rs.by;
    var when = perthWhen(rs.at);
    var offBy = optOut
      ? 'Turned off' + (by ? ' by ' + by : '') + (when ? ' on ' + when : '')
      : '';
    if (claim) {
      var words = claimWords(claim);
      return {
        on: !optOut, locked: true, claim: claim, offBy: offBy,
        text: words || 'Review text: ' + lower(claim).replace(/_+/g, ' '),
        title: words
          ? words + '. It can no longer be stopped.'
          : 'Review text: ' + lower(claim).replace(/_+/g, ' ') + '. The switch is locked.'
      };
    }
    return {
      on: !optOut, locked: false, claim: '', offBy: offBy,
      text: optOut ? 'Review text off' : 'Review text on',
      title: optOut
        ? offBy + '. No review text goes out. Click to turn it back on.'
        : 'The review text goes out once the job is fully paid. Click to turn it off for this job.'
    };
  }

  function reviewToggleHtml(t, jobId, opts) {
    if (!t) return '';
    var detail = !!(opts && opts.detail);
    var on = t.on && !t.locked;
    var track = t.locked ? '#BDC3C7' : (t.on ? '#27AE60' : '#95A5A6');
    var knob = '<span aria-hidden="true" style="display:inline-block;position:relative;width:22px;height:12px;border-radius:6px;background:' +
      track + ';flex:none;"><span style="position:absolute;top:2px;' + (t.on ? 'left:12px' : 'left:2px') +
      ';width:8px;height:8px;border-radius:50%;background:#fff;"></span></span>';
    var html = '<div class="closeout-review-toggle-wrap" data-review-job="' + esc(jobId) + '" data-review-detail="' + (detail ? '1' : '0') + '" style="margin-top:4px;">' +
      '<button type="button" class="closeout-review-toggle" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      ' data-review-toggle="' + esc(jobId) + '" data-review-state="' + (t.locked ? 'locked' : (t.on ? 'on' : 'off')) + '"' +
      (t.locked ? ' disabled aria-disabled="true"' : '') +
      ' title="' + esc(t.title) + '"' +
      ' onclick="event.stopPropagation();JobCloseoutOps.toggleReview(this)" onmousedown="event.stopPropagation()"' +
      ' style="display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;padding:0;font:inherit;font-size:11px;font-weight:600;color:' +
      (t.locked ? '#7F8C8D' : (t.on ? '#1E8449' : '#7F8C8D')) + ';cursor:' + (t.locked ? 'default' : 'pointer') + ';">' +
      knob + '<span>' + esc(t.text) + '</span></button>';
    if (detail && t.offBy) {
      html += '<div class="closeout-review-offby" style="font-size:11px;color:var(--sw-mid,#7F8C8D);margin-top:2px;">' + esc(t.offBy) + '</div>';
    }
    return html + '</div>';
  }

  // set_review_opt_out refused because the review text has already gone.
  function isAlreadySent(err) {
    if (!err) return false;
    return lower(err.code) === 'review_already_sent' ||
      lower(err.body && err.body.error) === 'review_already_sent';
  }

  // A refusal from set_review_opt_out, in words.
  function refusalWords(err) {
    if (isAlreadySent(err)) {
      return 'The review text has already gone out, so it can no longer be stopped.';
    }
    return 'The review text switch could not be changed. Nothing was changed.';
  }

  return {
    previewState: previewState,
    eligibleType: eligibleType,
    blockOf: blockOf,
    reasonWords: reasonWords,
    tags: tags,
    tagsHtml: tagsHtml,
    nextStatuses: nextStatuses,
    reviewState: reviewState,
    reviewToggle: reviewToggle,
    reviewToggleHtml: reviewToggleHtml,
    isAlreadySent: isAlreadySent,
    refusalWords: refusalWords
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

  // Answers from set_review_opt_out, by job id, laid over the feed until a read
  // of the job agrees with them (the board is not re-read after a press).
  var _review = {};

  function withReview(job) {
    var o = job && _review[job.id];
    if (!o) return job;
    var rs = JobCloseoutCore.reviewState(job);
    if (rs.optOut === o.optOut && !rs.claim === !o.claim) {
      delete _review[job.id];
      return job;
    }
    var block = Object.assign({}, JobCloseoutCore.blockOf(job));
    var view = Object.assign({}, job, { closeout: block });
    if (o.optOut !== undefined) {
      block.review_opt_out = o.optOut;
      view.review_opt_out_at = o.at;
      view.review_opt_out_by = o.by;
    }
    if (!rs.claim && o.claim) block.review_claim_status = o.claim;
    return view;
  }

  // The last job each switch was drawn from, so a press can redraw it.
  var _drawn = {};

  function toggleHtml(job, status, opts) {
    var view = withReview(job);
    var t = JobCloseoutCore.reviewToggle(view, status);
    if (!t) return '';
    _drawn[job.id] = { job: job, status: status };
    return JobCloseoutCore.reviewToggleHtml(t, job.id, opts);
  }

  // A tag must never break a card: any throw draws nothing.
  function cardTagsHtml(job, status) {
    try {
      if (!previewOn()) return '';
      return JobCloseoutCore.tagsHtml(JobCloseoutCore.tags(job, status, Date.now())) + toggleHtml(job, status);
    } catch (e) { return ''; }
  }

  // job_detail: the block beside the job, or on it.
  function detailTagsHtml(data) {
    try {
      if (!previewOn() || !data || !data.job) return '';
      var job = data.job;
      var block = data.closeout !== undefined ? data.closeout : job.closeout;
      var view = {
        id: job.id, type: job.type, status: job.status, closeout: block,
        review_opt_out_at: job.review_opt_out_at, review_opt_out_by: job.review_opt_out_by
      };
      return JobCloseoutCore.tagsHtml(JobCloseoutCore.tags(view, job.status, Date.now())) +
        toggleHtml(view, job.status, { detail: true });
    } catch (e) { return ''; }
  }

  function redraw(jobId) {
    var d = _drawn[jobId];
    if (!d) return;
    var t = JobCloseoutCore.reviewToggle(withReview(d.job), d.status);
    document.querySelectorAll('.closeout-review-toggle-wrap').forEach(function (wrap) {
      if (wrap.getAttribute('data-review-job') !== String(jobId)) return;
      var tmp = document.createElement('div');
      tmp.innerHTML = JobCloseoutCore.reviewToggleHtml(t, jobId, { detail: wrap.getAttribute('data-review-detail') === '1' });
      if (tmp.firstChild) wrap.replaceWith(tmp.firstChild); else wrap.remove();
    });
  }

  function say(message, type) {
    try { if (typeof showToast === 'function') showToast(message, type); } catch (e) { /* no toast host */ }
  }

  // One press: ask ops-api, then draw what it answered. Never optimistic.
  function toggleReview(btn) {
    try {
      if (!btn || btn.disabled) return Promise.resolve(null);
      var jobId = btn.getAttribute('data-review-toggle');
      var optOut = btn.getAttribute('data-review-state') === 'on';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      return Promise.resolve()
        .then(function () { return opsPost('set_review_opt_out', { job_id: jobId, opt_out: optOut }); })
        .then(function (res) {
          if (!res || res.success !== true || typeof res.review_opt_out !== 'boolean') {
            throw new Error('unexpected answer');
          }
          _review[jobId] = {
            optOut: res.review_opt_out,
            at: res.review_opt_out_at || null,
            by: res.review_opt_out_by || null
          };
          redraw(jobId);
          say(res.review_opt_out ? 'Review text turned off for this job.' : 'Review text turned back on for this job.', 'success');
          return res;
        })
        .catch(function (err) {
          if (JobCloseoutCore.isAlreadySent(err)) {
            var claim = err.body && typeof err.body.review_claim_status === 'string' ? err.body.review_claim_status.trim() : '';
            _review[jobId] = Object.assign({}, _review[jobId], { claim: claim || 'sent' });
          }
          redraw(jobId);
          say(JobCloseoutCore.refusalWords(err), 'warning');
          return null;
        });
    } catch (e) { return Promise.resolve(null); }
  }

  function nextStatuses(current, type) {
    try { return JobCloseoutCore.nextStatuses(current, type, previewOn()); } catch (e) { return null; }
  }

  return {
    previewOn: previewOn,
    cardTagsHtml: cardTagsHtml,
    detailTagsHtml: detailTagsHtml,
    nextStatuses: nextStatuses,
    toggleReview: toggleReview
  };
})();

if (typeof window !== 'undefined') {
  window.JobCloseoutCore = JobCloseoutCore;
  window.JobCloseoutOps = JobCloseoutOps;
}
