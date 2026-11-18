/**
 * Dispatch v2 item 19 (Shaun, 18 Nov 2026): the Read now button, in the
 * corner where "Switch back to v1" used to be (ops.html, <dispatch-version>).
 *
 * Backend contract: secureworks-backend docs/dispatch-v2-board-contract.md,
 * section 3j (ops-api dispatch_v2_read_now, dispatch_v2_read_now.ts).
 *
 * One press:
 *   1. The ops-api reads Outlook now (what the five minute cron does), then
 *      matches new supplier replies to their jobs (the replies cron).
 *   2. Then this page reloads the board, the Needs you now bar, the tray and
 *      the open job, with no page refresh (OpsDispatch.reloadAll).
 *   3. One plain line says what happened, e.g.
 *      "Read 2:32pm. 2 new supplier emails."
 *
 * The button is off while it runs. The screen never waits more than
 * SCREEN_CAP_MS: slow Outlook, a failed read or an ops-api that does not know
 * Read now yet all end in a plain line, and the board is reloaded anyway.
 *
 * Read now reads mail only. It never sends, and never moves a job stage.
 *
 * Exposes window.OpsDispatchReadNow = { press(), lineFor(answer), clock(iso), capMs }.
 * The press is wired on any [data-dispatch-read-now] button.
 */
(function (global) {
  'use strict';

  var ACTION = 'dispatch_v2_read_now';
  /** The ops-api waits up to 25 s for Outlook, then matches replies. */
  var SCREEN_CAP_MS = 60000;
  var PERTH_OFFSET_MS = 8 * 3600 * 1000;

  var busy = false;

  function isObj(v) { return !!v && typeof v === 'object'; }
  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? Math.floor(n) : null; }

  /** "2:32pm", Perth time (WA has no daylight saving). '' when unreadable. */
  function clock(iso) {
    var t = Date.parse(typeof iso === 'string' ? iso : '');
    if (!isFinite(t)) return '';
    var p = new Date(t + PERTH_OFFSET_MS);
    var h = p.getUTCHours();
    var m = p.getUTCMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h < 12 ? 'am' : 'pm');
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /** The one line after a press, from the ops-api answer (section 3j.1). */
  function lineFor(answer) {
    if (!isObj(answer) || answer.ok !== true) return 'Could not read the email just now. The board is reloaded with what was already read.';
    var at = clock(answer.read_at);
    var head = at ? 'Read ' + at + '.' : 'Read.';
    if (answer.lane === 'paused') return head + ' Email reading is paused, so nothing new was read.';
    var parts = [head];
    var rep = isObj(answer.replies) ? answer.replies : null;
    if (rep && rep.status === 'scanned') {
      var n = num(rep.stored) || 0;
      parts.push(n ? plural(n, 'new supplier email', 'new supplier emails') + '.' : 'No new supplier emails.');
    } else if (rep && rep.status === 'off') {
      parts.push('Supplier email matching is switched off.');
    } else {
      parts.push('Could not match supplier emails just now.');
    }
    var mail = isObj(answer.mail) ? answer.mail : null;
    if (mail && mail.status === 'slow') parts.push('Outlook was slow, so some new mail may only show at the next read.');
    else if (mail && mail.status === 'off') parts.push('Outlook reading is switched off.');
    else if (mail && mail.status === 'failed') parts.push('Could not reach Outlook just now.');
    else if (mail && mail.status === 'read' && num(mail.mailboxes_not_read)) parts.push(plural(num(mail.mailboxes_not_read), 'mailbox', 'mailboxes') + ' will be read at the next run.');
    var left = num(answer.left_to_sort);
    if (left) parts.push(plural(left, 'email', 'emails') + ' to sort.');
    return parts.join(' ');
  }

  function bar() { return typeof document !== 'undefined' ? document.getElementById('dispatchVersionBar') : null; }

  function paint(state, words) {
    var b = bar();
    if (!b) return;
    var btn = b.querySelector('[data-dispatch-read-now]');
    var line = b.querySelector('[data-dispatch-read-line]');
    if (btn) {
      btn.disabled = state === 'busy';
      btn.textContent = state === 'busy' ? 'Reading...' : 'Read now';
      btn.setAttribute('aria-busy', state === 'busy' ? 'true' : 'false');
    }
    if (line) {
      line.textContent = words || '';
      line.setAttribute('data-state', state);
    }
  }

  function reload() {
    var d = global.OpsDispatch;
    if (d && typeof d.reloadAll === 'function') {
      try { d.reloadAll(); } catch (e) { /* the line already says what happened */ }
    }
  }

  /** One press. Resolves when the line is painted and the board reload sent. */
  function press() {
    if (busy) return Promise.resolve(null);
    busy = true;
    paint('busy', 'Reading Outlook and matching supplier emails...');
    var timer = null;
    var cap = new Promise(function (resolve) {
      timer = setTimeout(function () { resolve({ slowScreen: true }); }, api.capMs);
    });
    var call = Promise.resolve().then(function () {
      if (typeof global.opsPost !== 'function') throw new Error('not signed in');
      return global.opsPost(ACTION, {});
    }).then(function (answer) { return { answer: answer }; }, function (err) { return { err: err }; });
    return Promise.race([call, cap]).then(function (got) {
      clearTimeout(timer);
      var words;
      if (got.slowScreen) words = 'Outlook is slow. The board is reloaded; try Read now again in a minute.';
      else if (got.err) words = 'Could not read the email just now. The board is reloaded with what was already read.';
      else words = lineFor(got.answer);
      busy = false;
      paint(got.answer && !got.err ? 'done' : 'failed', words);
      reload();
      return words;
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-dispatch-read-now]') : null;
      if (!t || t.disabled) return;
      e.preventDefault();
      press();
    });
  }

  // capMs: how long the screen waits (a test may shorten it).
  var api = { press: press, lineFor: lineFor, clock: clock, capMs: SCREEN_CAP_MS };
  global.OpsDispatchReadNow = api;
})(typeof window !== 'undefined' ? window : globalThis);
