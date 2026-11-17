/*
 * <dispatch-book-install> Dispatch v2: Book install from the job's Install
 * row (item 4 on the Go-or-Park page; picture approved by Shaun 16 Nov 2026,
 * "i like it all"). Backend contract: secureworks-backend
 * docs/dispatch-v2-board-contract.md, section 3h.
 *
 * What it draws under the Install row, by step:
 *   1. Not booked: a Book install button, with the earliest install day
 *      Dispatch already works out shown beside it.
 *   2. The form (opens under the row): first day (the earliest day filled
 *      in), days (default 1, one booking per working day, weekends skipped),
 *      the lead crew and helpers (the Calendar's own crew list, several
 *      people) and a note. "Book as tentative": nobody is texted.
 *   3. Booked: the day(s), the crew and a Tentative / Confirmed chip, with
 *      Confirm (texts the crew "New job assigned", asks first), Move (every
 *      day together, nobody texted) and Remove (asks first).
 *
 * Every press is one ops-api call (dispatch_v2_install_book / _confirm /
 * _move / _remove), and the server runs the Calendar's own booking
 * functions. Nothing here moves a job stage, texts the client, warns about
 * clashes or checks materials. Desktop only, like the rest of Dispatch.
 *
 * modules/ops-dispatch.js calls OpsDispatchBookInstall.html(row, ctx) from its
 * install row and load(jobId) when a job opens. This file listens for its own
 * clicks and typing (data-dpc-bi), so ops-dispatch.js needs no other hook.
 * </dispatch-book-install>
 */
(function (global) {
  'use strict';

  var MAX_DAYS = 20;
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Per job: { status: 'loading'|'ok'|'error', install, form, move, ask, busy, msg, err }
  var jobs = {};
  // The latest hooks ops-dispatch.js handed in (repaint, refresh, currentJobId).
  var hooks = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isDay(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function utc(day) { return new Date(day + 'T00:00:00Z'); }
  function ymd(d) { return d.toISOString().slice(0, 10); }
  function addDays(day, n) { var d = utc(day); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
  function weekend(day) { var w = utc(day).getUTCDay(); return w === 0 || w === 6; }
  function dayText(day) {
    if (!isDay(day)) return '';
    var d = utc(day);
    return DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()];
  }
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // The working days a booking lands on, as the server lays them.
  function workingDays(first, n) {
    var out = [];
    if (!isDay(first)) return out;
    var day = first;
    var guard = 0;
    while (out.length < n && guard < 400) {
      if (!weekend(day)) out.push(day);
      day = addDays(day, 1);
      guard++;
    }
    return out;
  }
  // "Fri 20 Nov", or "Fri 20 Nov to Tue 24 Nov (3 days)" for a longer one.
  function daysText(days) {
    if (!days || !days.length) return '';
    if (days.length === 1) return dayText(days[0]);
    return dayText(days[0]) + ' to ' + dayText(days[days.length - 1]) + ' (' + days.length + ' days)';
  }
  function crewList() {
    var list = global._crewList;
    return Array.isArray(list) ? list : [];
  }
  function namesOf(people) {
    return (people || []).map(function (p) { return p && p.name ? p.name : 'Name not on record'; });
  }
  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function entry(jobId) { return jobs[jobId] || null; }
  function repaint() { if (hooks && typeof hooks.repaint === 'function') hooks.repaint(); }
  function currentJobId() { return hooks && typeof hooks.currentJobId === 'function' ? hooks.currentJobId() : null; }

  // ── The read ────────────────────────────────────────────────────────────
  // keepErr: a refused press reads the booking again, and its reason stays
  // on screen above the latest booking.
  function load(jobId, keepErr) {
    if (!jobId) return;
    var prev = jobs[jobId];
    var e = { status: 'loading', install: prev ? prev.install : null, form: null, move: null, ask: null, busy: false, msg: prev ? prev.msg : null, err: keepErr && prev ? prev.err : null };
    jobs[jobId] = e;
    Promise.resolve().then(function () {
      return global.opsFetch('dispatch_v2_install', { job_id: jobId });
    }).then(function (resp) {
      if (jobs[jobId] !== e) return;
      // An ops-api from before Book install answers without the install
      // block: the row then shows no booking part at all, as it did before.
      if (!resp || !resp.install || typeof resp.install !== 'object') { e.status = 'absent'; e.install = null; repaint(); return; }
      e.status = 'ok';
      e.install = resp.install;
      repaint();
    }).catch(function (err) {
      if (jobs[jobId] !== e) return;
      // The same for an ops-api that does not know the action yet.
      e.status = err && err.status === 400 && /unknown action/i.test(String(err.message || '')) ? 'absent' : 'error';
      repaint();
    });
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  function btn(attr, label, cls, extra) {
    return '<button type="button" data-dpc-bi="' + attr + '"' + (cls ? ' class="' + cls + '"' : '') + (extra || '') + '>' + esc(label) + '</button>';
  }

  function msgHtml(e) {
    var h = '';
    if (e.msg) h += '<p class="dpc-bi-msg" role="status">' + esc(e.msg) + '</p>';
    if (e.err) h += '<p class="dpc-bi-msg dpc-bi-err" role="alert">' + esc(e.err) + '</p>';
    return h;
  }

  function crewOptions(selected, exclude) {
    var h = '<option value="">Pick the lead...</option>';
    crewList().forEach(function (u) {
      if (exclude && u.id === exclude) return;
      h += '<option value="' + esc(u.id) + '"' + (u.id === selected ? ' selected' : '') + '>' + esc(u.name) + '</option>';
    });
    return h;
  }

  function formHtml(e, jobId) {
    var f = e.form;
    var list = crewList();
    var days = workingDays(f.first, f.days);
    var h = '<div class="dpc-bi-form" data-dpc-bi-job="' + esc(jobId) + '">';
    h += '<div class="dpc-bi-head"><span>Book install</span><span>Tentative, nobody is texted</span></div>';
    h += '<label class="dpc-bi-fld"><span>First day</span><input type="date" data-dpc-bi-field="first" value="' + esc(f.first) + '"' + (e.busy ? ' disabled' : '') + '></label>';
    h += '<label class="dpc-bi-fld"><span>Days</span><input type="number" min="1" max="' + MAX_DAYS + '" step="1" data-dpc-bi-field="days" value="' + esc(f.days) + '"' + (e.busy ? ' disabled' : '') + '>' +
      '<small>one booking per working day, weekends skipped' + (days.length ? ': ' + esc(days.map(dayText).join(', ')) : '') + '</small></label>';
    if (!list.length) {
      h += '<p class="dpc-bi-msg">' + (f.crewFailed ? 'The crew list did not load. ' + btn('crew-retry', 'Retry', 'dpc-retry') : 'Loading the crew list...') + '</p>';
    } else {
      h += '<label class="dpc-bi-fld"><span>Lead crew</span><select data-dpc-bi-field="lead"' + (e.busy ? ' disabled' : '') + '>' + crewOptions(f.lead) + '</select></label>';
      h += '<div class="dpc-bi-fld"><span>Helpers</span><div class="dpc-bi-helpers">';
      list.forEach(function (u) {
        if (u.id === f.lead) return;
        var on = f.helpers.indexOf(u.id) !== -1;
        h += '<label class="dpc-bi-helper' + (on ? ' on' : '') + '"><input type="checkbox" data-dpc-bi-field="helper" value="' + esc(u.id) + '"' + (on ? ' checked' : '') + (e.busy ? ' disabled' : '') + '> ' + esc(u.name) + '</label>';
      });
      h += '</div></div>';
    }
    h += '<label class="dpc-bi-fld"><span>Note</span><input type="text" maxlength="2000" data-dpc-bi-field="note" value="' + esc(f.note) + '" placeholder="For the crew, e.g. Colorbond 1.8m, side gate"' + (e.busy ? ' disabled' : '') + '></label>';
    var ready = isDay(f.first) && f.days >= 1 && f.days <= MAX_DAYS && !!f.lead;
    h += '<div class="dpc-bi-acts">' + btn('book-go', e.busy ? 'Booking...' : 'Book as tentative', 'dpc-primary', (ready && !e.busy ? '' : ' disabled')) + btn('book-cancel', 'Cancel', '', e.busy ? ' disabled' : '') + '</div>';
    h += msgHtml(e);
    return h + '</div>';
  }

  function chip(state) {
    if (state === 'confirmed') return '<span class="dpc-bi-chip dpc-bi-chip-c">Confirmed</span>';
    if (state === 'mixed') return '<span class="dpc-bi-chip dpc-bi-chip-t">Partly confirmed</span>';
    return '<span class="dpc-bi-chip dpc-bi-chip-t">Tentative</span>';
  }

  function bookedAtText(iso) {
    var t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    var d = new Date(t);
    var h = d.getHours();
    var m = String(d.getMinutes()).padStart(2, '0');
    return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()] + ', ' + ((h % 12) || 12) + ':' + m + (h < 12 ? 'am' : 'pm');
  }

  function bookedHtml(e, jobId) {
    var ins = e.install;
    var names = namesOf(ins.people);
    var h = '<div class="dpc-bi-booked" data-dpc-bi-job="' + esc(jobId) + '">';
    h += '<div class="dpc-bi-line"><strong>' + esc(daysText(ins.days)) + '</strong> · ' + esc(names.join(', ')) + ' ' + chip(ins.state) + '</div>';
    if (ins.booked_at) h += '<small class="dpc-bi-sub">Booked ' + esc(bookedAtText(ins.booked_at)) + '</small>';
    if (e.ask === 'confirm') {
      h += '<p class="dpc-bi-ask">Confirm the install and text ' + esc(joinNames(names)) + ' "New job assigned"? The client is not texted.</p>';
      h += '<div class="dpc-bi-acts">' + btn('confirm-go', e.busy ? 'Confirming...' : 'Confirm and text crew', 'dpc-primary', e.busy ? ' disabled' : '') + btn('ask-no', 'Cancel', '', e.busy ? ' disabled' : '') + '</div>';
    } else if (e.ask === 'remove') {
      h += '<p class="dpc-bi-ask">Remove every day of this install from the Calendar? Nobody is texted.</p>';
      h += '<div class="dpc-bi-acts">' + btn('remove-go', e.busy ? 'Removing...' : 'Remove install', 'dpc-bi-red', e.busy ? ' disabled' : '') + btn('ask-no', 'Keep it', '', e.busy ? ' disabled' : '') + '</div>';
    } else if (e.move) {
      var shift = isDay(e.move.first) && isDay(ins.first_day) ? e.move.first : '';
      h += '<div class="dpc-bi-move"><label class="dpc-bi-fld"><span>New first day</span><input type="date" data-dpc-bi-field="move-first" value="' + esc(e.move.first) + '"' + (e.busy ? ' disabled' : '') + '></label>';
      h += '<small>Every day and every person moves together. Nobody is texted.' + (ins.state !== 'tentative' ? ' A confirmed booking goes back to Tentative, so Confirm texts the new days.' : '') + '</small>';
      h += '<div class="dpc-bi-acts">' + btn('move-go', e.busy ? 'Moving...' : 'Move install', 'dpc-primary', (shift && shift !== ins.first_day && !e.busy ? '' : ' disabled')) + btn('move-cancel', 'Cancel', '', e.busy ? ' disabled' : '') + '</div></div>';
    } else {
      h += '<div class="dpc-bi-acts">';
      if (ins.state !== 'confirmed') h += btn('confirm', 'Confirm (texts crew)', 'dpc-primary');
      h += btn('move', 'Move') + btn('remove', 'Remove', 'dpc-bi-red') + '</div>';
    }
    h += msgHtml(e);
    return h + '</div>';
  }

  /**
   * The booking block for the Install row. ctx: { earliest: 'YYYY-MM-DD' or
   * null, repaint: fn, refresh: fn(jobId), currentJobId: fn }.
   */
  function html(row, ctx) {
    if (!row || !row.id) return '';
    hooks = ctx || hooks;
    var jobId = row.id;
    var e = entry(jobId);
    if (!e) { load(jobId); e = entry(jobId); }
    if (e.status === 'absent') return '';
    if (e.status === 'loading' && !e.install) return '<div class="dpc-bi"><p class="dpc-bi-msg">Loading the booking...</p></div>';
    if (e.status === 'error' && !e.install) {
      return '<div class="dpc-bi"><p class="dpc-bi-msg dpc-bi-err" role="alert">Could not load the booking. ' + btn('read-retry', 'Retry', 'dpc-retry') + '</p></div>';
    }
    var ins = e.install;
    var h = '<div class="dpc-bi">';
    if (ins && ins.booked) {
      h += bookedHtml(e, jobId);
    } else if (e.form) {
      h += formHtml(e, jobId);
    } else {
      var early = ctx && isDay(ctx.earliest) ? ctx.earliest : null;
      h += '<div class="dpc-bi-none" data-dpc-bi-job="' + esc(jobId) + '">';
      if (early) h += '<small class="dpc-bi-sub">Earliest install: ' + esc(dayText(early)) + ' (the working day after the last delivery)</small>';
      h += '<div class="dpc-bi-acts">' + btn('book', 'Book install', 'dpc-primary') + '</div>' + msgHtml(e) + '</div>';
    }
    if (hooks) hooks.lastEarliest = ctx && isDay(ctx.earliest) ? ctx.earliest : null;
    return h + '</div>';
  }

  // ── Presses ─────────────────────────────────────────────────────────────
  function jobOf(t) {
    var holder = t.closest('[data-dpc-bi-job]');
    return holder ? holder.getAttribute('data-dpc-bi-job') : currentJobId();
  }

  function ensureCrew(e) {
    if (crewList().length || typeof global.loadCrewList !== 'function') {
      if (!crewList().length) e.form.crewFailed = true;
      return;
    }
    Promise.resolve().then(function () { return global.loadCrewList(); }).then(function () {
      if (e.form && !crewList().length) e.form.crewFailed = true;
      repaint();
    }, function () { if (e.form) e.form.crewFailed = true; repaint(); });
  }

  function failText(err, fallback) {
    var m = err && err.message ? String(err.message) : '';
    return m ? fallback + ': ' + m : fallback + '.';
  }

  // One press: busy while it runs, the answer's install drawn after, the
  // board and the Arrival line read again so the rest of the row follows.
  function press(jobId, e, action, body, done) {
    e.busy = true;
    e.err = null;
    e.msg = null;
    repaint();
    Promise.resolve().then(function () {
      return global.opsPost(action, Object.assign({ job_id: jobId }, body));
    }).then(function (resp) {
      if (jobs[jobId] !== e) return;
      e.busy = false;
      if (resp && resp.install) { e.install = resp.install; e.status = 'ok'; }
      done(resp || {});
      repaint();
      if (hooks && typeof hooks.refresh === 'function') hooks.refresh(jobId);
    }).catch(function (err) {
      if (jobs[jobId] !== e) return;
      e.busy = false;
      e.err = failText(err, 'Not saved');
      repaint();
      // The booking may have changed under us: read it again.
      if (err && /already|booked|changed|not_booked/i.test(String(err.message || ''))) load(jobId, true);
    });
  }

  function onClick(ev) {
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-dpc-bi]') : null;
    if (!t || t.disabled || !t.closest('.dpc')) return;
    var verb = t.getAttribute('data-dpc-bi');
    var jobId = jobOf(t);
    if (!jobId) return;
    var e = entry(jobId);
    if (verb === 'read-retry') { load(jobId); repaint(); return; }
    if (!e) return;
    if (verb === 'book') {
      var early = hooks && isDay(hooks.lastEarliest) ? hooks.lastEarliest : null;
      var first = early && early >= todayLocal() ? early : '';
      e.form = { first: first, days: 1, lead: '', helpers: [], note: '', crewFailed: false };
      e.msg = null; e.err = null;
      ensureCrew(e);
      repaint();
      focusField(jobId, first ? 'lead' : 'first');
      return;
    }
    if (verb === 'crew-retry' && e.form) { e.form.crewFailed = false; ensureCrew(e); repaint(); return; }
    if (verb === 'book-cancel') { e.form = null; e.err = null; repaint(); return; }
    if (verb === 'book-go' && e.form) {
      var f = e.form;
      var names = {};
      crewList().forEach(function (u) { names[u.id] = u.name; });
      press(jobId, e, 'dispatch_v2_install_book', {
        first_day: f.first,
        days: f.days,
        lead: { user_id: f.lead, name: names[f.lead] || null },
        helpers: f.helpers.filter(function (id) { return id !== f.lead; }).map(function (id) { return { user_id: id, name: names[id] || null }; }),
        note: f.note || null,
      }, function (resp) {
        e.form = null;
        e.msg = 'Booked as tentative: ' + daysText(resp.booked_days || []) + '. Nobody was texted.';
      });
      return;
    }
    if (verb === 'confirm') { e.ask = 'confirm'; e.msg = null; e.err = null; repaint(); return; }
    if (verb === 'remove') { e.ask = 'remove'; e.msg = null; e.err = null; repaint(); return; }
    if (verb === 'ask-no') { e.ask = null; repaint(); return; }
    if (verb === 'confirm-go') {
      press(jobId, e, 'dispatch_v2_install_confirm', {}, function (resp) {
        e.ask = null;
        var parts = ['Confirmed'];
        if (resp.texted && resp.texted.length) parts.push('Texted "New job assigned": ' + resp.texted.join(', '));
        if (resp.no_phone && resp.no_phone.length) parts.push('No phone on file, not texted: ' + resp.no_phone.join(', '));
        if (resp.text_failed && resp.text_failed.length) parts.push('Text failed: ' + resp.text_failed.join(', '));
        if (resp.failed && resp.failed.length) parts.push('Not confirmed: ' + resp.failed.join('; '));
        e.msg = parts.join('. ') + '.';
      });
      return;
    }
    if (verb === 'remove-go') {
      press(jobId, e, 'dispatch_v2_install_remove', {}, function (resp) {
        e.ask = null;
        e.msg = resp.failed && resp.failed.length
          ? 'Some days could not be removed: ' + resp.failed.join('; ')
          : 'Install removed. Nobody was texted.';
      });
      return;
    }
    if (verb === 'move' && e.install) { e.move = { first: e.install.first_day || '' }; e.msg = null; e.err = null; repaint(); focusField(jobId, 'move-first'); return; }
    if (verb === 'move-cancel') { e.move = null; repaint(); return; }
    if (verb === 'move-go' && e.move) {
      press(jobId, e, 'dispatch_v2_install_move', { new_start: e.move.first }, function (resp) {
        e.move = null;
        e.msg = resp.changed
          ? 'Moved: ' + daysText(resp.install && resp.install.days) + '. Nobody was texted.' + (resp.back_to_tentative ? ' Back to Tentative: press Confirm to text the crew the new days.' : '')
          : 'Not moved: the Calendar found nothing to move.';
      });
    }
  }

  function focusField(jobId, field) {
    setTimeout(function () {
      var el = document.querySelector('.dpc [data-dpc-bi-job="' + jobId + '"] [data-dpc-bi-field="' + field + '"]');
      if (el && !el.disabled) el.focus();
    }, 0);
  }

  // Typing keeps the form in state, so a repaint never loses it. Only a
  // change that alters what is drawn (days, lead, helpers, move day) repaints.
  function onField(ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || !t.hasAttribute('data-dpc-bi-field')) return;
    var jobId = jobOf(t);
    var e = jobId ? entry(jobId) : null;
    if (!e) return;
    var field = t.getAttribute('data-dpc-bi-field');
    var redraw = false;
    if (field === 'move-first' && e.move) { e.move.first = t.value; redraw = ev.type === 'change'; }
    else if (e.form) {
      var f = e.form;
      if (field === 'first') { f.first = t.value; redraw = ev.type === 'change'; }
      else if (field === 'days') {
        var n = parseInt(t.value, 10);
        f.days = Number.isFinite(n) ? Math.max(1, Math.min(MAX_DAYS, n)) : 1;
        redraw = ev.type === 'change';
      } else if (field === 'lead') {
        f.lead = t.value;
        f.helpers = f.helpers.filter(function (id) { return id !== f.lead; });
        redraw = true;
      } else if (field === 'helper') {
        var id = t.value;
        f.helpers = f.helpers.filter(function (x) { return x !== id; });
        if (t.checked) f.helpers.push(id);
        redraw = ev.type === 'change';
      } else if (field === 'note') { f.note = t.value; }
    }
    if (redraw) {
      repaint();
      focusField(jobId, field === 'helper' ? 'note' : field);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onField);
    document.addEventListener('change', onField);
  }

  global.OpsDispatchBookInstall = {
    html: html,
    load: load,
    // For tests.
    _workingDays: workingDays,
    _reset: function () { jobs = {}; hooks = null; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
