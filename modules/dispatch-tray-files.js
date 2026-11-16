/**
 * Dispatch v2 item 16 part 1 (Shaun, 16 Nov 2026): the files on an email in
 * the Unmatched supplier emails tray.
 *
 * Backend contract: secureworks-backend docs/dispatch-v2-board-contract.md,
 * section 3i (dispatch_v2_tray_attachments.ts).
 *
 *  - Each tray card lists the email's files, every type, as
 *    "PDF: name, size, Open". A file the capture reader did not keep shows
 *    its reason instead of Open.
 *  - Open shows the file in a new tab through a link that works for two
 *    minutes (dispatch_v2_tray_attachment_open). The tab is opened at the
 *    press, so the browser does not block it, and pointed at the link once
 *    it comes back.
 *  - After Put on job, the done line says how many files were saved to the
 *    job's documents (office only) and how many were already there.
 *
 * An ops-api from before item 16 sends no attachments field: the card is
 * drawn exactly as before.
 *
 * Exposes window.OpsDispatchTrayFiles = { html(email), doneWords(resp) }.
 * The Open press is handled here, on any [data-dpc-tf-open] inside .dpc.
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function text(v) { return typeof v === 'string' ? v.trim() : ''; }

  /** The file list for one tray card, or '' when there is nothing to draw. */
  function html(email) {
    if (!email || typeof email !== 'object' || !('attachments' in email)) return '';
    var list = email.attachments;
    if (list === null) return '<p class="dpc-tf-msg">Could not read the files on this email.</p>';
    if (!Array.isArray(list) || !list.length) return '';
    var h = '<ul class="dpc-tf" aria-label="Files on this email">';
    list.forEach(function (a) {
      if (!a || typeof a !== 'object' || !a.id) return;
      var kind = text(a.kind_label) || 'File';
      var size = text(a.size_label);
      h += '<li class="dpc-tf-row"><span class="dpc-tf-kind">' + esc(kind) + ':</span> <span class="dpc-tf-name">' + esc(text(a.file_name) || 'Unnamed file') + '</span>' +
        (size ? '<span class="dpc-tf-size">, ' + esc(size) + '</span>' : '');
      if (a.openable === true) {
        h += ' <button type="button" class="dpc-textbtn dpc-tf-open" data-dpc-tf-open="' + esc(email.id) + '" data-att="' + esc(a.id) + '" aria-label="Open ' + esc(text(a.file_name) || 'the file') + '">Open</button>' +
          '<span class="dpc-tf-err" role="status" aria-live="polite"></span>';
      } else {
        h += ' <span class="dpc-tf-why">' + esc(text(a.not_kept_reason) || 'Not saved') + '</span>';
      }
      h += '</li>';
    });
    return h + '</ul>';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /** The words added to "Put on SWF-x." for the files, or ''. */
  function doneWords(resp) {
    var d = resp && resp.documents;
    if (!d || typeof d !== 'object') return '';
    if (d.read === 'failed') return ' The files on the email could not be saved to the job. Open the email in admin@ to get them.';
    var saved = Array.isArray(d.saved) ? d.saved.length : 0;
    var skipped = Array.isArray(d.skipped) ? d.skipped : [];
    var already = skipped.filter(function (s) { return s && s.reason === 'already_on_job'; }).length;
    var failed = skipped.filter(function (s) { return s && s.reason !== 'already_on_job' && s.reason !== 'same_file_twice' && s.reason !== 'not_kept'; }).length;
    var out = '';
    if (saved) out += ' ' + plural(saved, 'file', 'files') + ' saved to the job\'s documents, office only.';
    if (already) out += ' ' + plural(already, 'file was', 'files were') + ' already on the job.';
    if (failed) out += ' ' + plural(failed, 'file', 'files') + ' could not be saved.';
    return out;
  }

  // ── Open ────────────────────────────────────────────────────────────────

  function say(btn, words) {
    var spot = btn && btn.nextElementSibling;
    if (spot && spot.classList.contains('dpc-tf-err')) spot.textContent = words;
  }

  function errWords(err) {
    var m = err && err.message ? String(err.message) : '';
    return 'Could not open the file' + (m ? ': ' + m : '.');
  }

  function open(btn) {
    var emailId = btn.getAttribute('data-dpc-tf-open');
    var attId = btn.getAttribute('data-att');
    if (!emailId || !attId || btn.disabled) return;
    // The tab opens now, at the press, or the browser blocks it.
    var tab = null;
    try { tab = global.open('', '_blank'); } catch (_) { tab = null; }
    if (tab) {
      try { tab.opener = null; tab.document.title = 'Opening the file'; tab.document.body.textContent = 'Opening the file...'; } catch (_) { /* a tab we cannot write to still works */ }
    }
    btn.disabled = true;
    btn.textContent = 'Opening...';
    say(btn, '');
    Promise.resolve().then(function () {
      return global.opsFetch('dispatch_v2_tray_attachment_open', { email_id: emailId, attachment_id: attId });
    }).then(function (resp) {
      var url = resp && resp.ok === true && typeof resp.url === 'string' ? resp.url : '';
      if (!/^https:\/\//i.test(url)) throw new Error('No link came back');
      btn.disabled = false;
      btn.textContent = 'Open';
      if (tab && !tab.closed) {
        tab.location.replace(url);
      } else {
        // The browser blocked the tab: offer the link itself (it works for
        // two minutes).
        var spot = btn.nextElementSibling;
        if (spot && spot.classList.contains('dpc-tf-err')) {
          spot.innerHTML = ' The browser blocked the new tab. <a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open the file</a> (works for 2 minutes).';
        }
      }
    }).catch(function (err) {
      if (tab && !tab.closed) { try { tab.close(); } catch (_) { /* nothing to close */ } }
      btn.disabled = false;
      btn.textContent = 'Open';
      say(btn, ' ' + errWords(err));
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-dpc-tf-open]') : null;
      if (!btn || !btn.closest('.dpc')) return;
      ev.preventDefault();
      open(btn);
    });
  }

  global.OpsDispatchTrayFiles = { html: html, doneWords: doneWords };
})(typeof window !== 'undefined' ? window : globalThis);
