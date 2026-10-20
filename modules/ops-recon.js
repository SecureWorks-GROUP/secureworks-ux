// Matching: the Context reconciliation daily list (secureworks-backend migration
// 20261020160000_context_recon_daily_list, ops-api actions recon_daily_list and
// recon_record_decision). One list of what needs a person, most at stake first:
//   1. owed invoices with no job, largest first;
//   2. messages from a contact who owes us money;
//   3. recent customer messages from someone with a live job.
// Find by job reads ops-api recon_job_items (secureworks-backend 20261020170000): every
// queued message that offers one job, including the ones the daily list leaves out (no
// identity, never asked), so a person who knows the job can still answer them. A message that
// belongs to more than one of its suggested jobs can be recorded on all of them (split).
// Each card is answered by a person's tap, confirmed once, then recorded against the
// evidence the card was shown with (shown_hash). A choice says which job something belongs
// to. It never moves money, sends anything, changes an invoice or writes a job.
//
// The tab is hidden unless ?recon=1 or localStorage sw_recon = '1'. The server decides who
// may use it (admin, owner, ops manager); anyone else gets the refusal in words.
// Every rule the screen applies lives in the pure ReconCore between the sentinels below.
// Guards: npm run test:recon (in test:e2e) and tests/e2e/ops-recon.spec.js.

// <recon-core>
var ReconCore = (function () {
  var BANDS = {
    1: { title: 'Owed invoices with no job', note: 'Money owed to us that is not on any job.' },
    2: { title: 'Messages from someone who owes us', note: 'They owe money and their message is not on a job yet.' },
    3: { title: 'Recent customer messages', note: 'From a customer with a live job, not placed on a job yet.' }
  };
  var REFUSALS = {
    evidence_changed: 'This item changed since you opened the list. The list has been read again, please choose again.',
    not_staff: 'Only an admin, owner or ops manager can record a match.',
    operator_access_required: 'Only an admin, owner or ops manager can use this list.',
    person_session_required: 'Please sign in again. A match is recorded against your own sign in.',
    user_jwt_required: 'Please sign in again. A match is recorded against your own sign in.',
    subject_not_found: 'That item is no longer there. The list has been read again.',
    job_not_found: 'That job was not found.',
    job_not_offered: 'That job was not one of the suggested jobs. Pick it from Another job instead.',
    action_not_allowed: 'That choice is not available for this item.',
    decision_not_recorded: 'The match was not recorded. Please try again.',
    daily_list_unreadable: 'The list could not be read just now.',
    invalid_request: 'The match was not recorded. Please reload and try again.',
    job_number_ambiguous: 'More than one job carries that number.',
    read_failed: 'That job could not be read just now.'
  };

  function tabVisible(search, stored) {
    if (/[?&]recon=1(&|$)/.test(String(search || ''))) return true;
    return stored === '1';
  }
  function bandOf(item) { return BANDS[item && item.band] || { title: 'Other', note: '' }; }
  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '';
    return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function waitWords(days) {
    var d = Math.floor(Number(days));
    if (!isFinite(d) || d < 0) return '';
    if (d === 0) return 'under a day';
    return d === 1 ? '1 day' : d + ' days';
  }
  function jobWords(job) {
    if (!job) return '';
    var bits = [job.suburb, job.status].filter(function (x) { return x; });
    return (job.job_number || 'Job') + (bits.length ? ' (' + bits.join(', ') + ')' : '');
  }
  function isOffered(item, jobId) {
    return (item.offered_jobs || []).some(function (j) { return j.job_id === jobId; });
  }
  // Who a card can be passed to. An invoice only to Finance; a message to Finance or Sales.
  function passTargets(item) { return item.subject_kind === 'invoice' ? ['finance'] : ['finance', 'sales']; }
  // The default when a pass names no one: money questions to Finance, the rest to Sales.
  function escalateTo(item) { return item.subject_kind === 'invoice' || item.band === 2 ? 'finance' : 'sales'; }
  function teamWords(team) { return team === 'finance' ? 'Finance' : team === 'sales' ? 'Sales' : team === 'owner' ? 'the owner' : String(team || ''); }
  // A choice is { kind: 'job', job_id } | { kind: 'unrelated' } | { kind: 'unresolved' } | { kind: 'escalate', to }.
  function actionFor(item, choice) {
    if (choice.kind === 'split') return 'split';
    if (choice.kind === 'job') {
      if (item.subject_kind === 'invoice') return 'correct';
      return isOffered(item, choice.job_id) ? 'confirm' : 'correct';
    }
    return choice.kind;
  }
  function bodyFor(item, choice) {
    var action = actionFor(item, choice);
    var body = {
      subject_kind: item.subject_kind,
      subject_id: item.subject_id,
      shown_hash: item.evidence_hash,
      action: action,
      job_ids: choice.kind === 'job' ? [choice.job_id] : choice.kind === 'split' ? splitIds(item) : [],
      cause: item.cause
    };
    if (action === 'escalate') body.escalate_to = passTargets(item).indexOf(choice.to) >= 0 ? choice.to : escalateTo(item);
    return body;
  }
  // A split records every suggested job, never a job the card did not offer.
  function splitIds(item) { return (item.offered_jobs || []).map(function (j) { return j.job_id; }); }
  function canSplit(item) { return item.subject_kind === 'event' && splitIds(item).length > 1; }
  function splitLabel(item) {
    var nums = (item.offered_jobs || []).map(function (j) { return j.job_number || 'Job'; });
    return nums.length === 2 ? 'It is both ' + nums[0] + ' and ' + nums[1] : 'It is all of ' + nums.join(', ');
  }
  function findJob(item, jobId) {
    return (item.offered_jobs || []).concat(item.other_jobs || []).filter(function (j) { return j.job_id === jobId; })[0] || null;
  }
  function confirmWords(item, choice) {
    var invoice = item.subject_kind === 'invoice';
    var what = invoice ? 'this invoice' : 'this message';
    if (choice.kind === 'job') {
      if (invoice) return 'Record that this invoice is for ' + jobWords(findJob(item, choice.job_id)) + '? Finance will link it in Xero. Nothing changes in Xero from here.';
      return 'Record that this message belongs to ' + jobWords(findJob(item, choice.job_id)) + '?';
    }
    if (choice.kind === 'split') {
      return 'Record that this message belongs to ' + (item.offered_jobs || []).map(jobWords).join(' and ') + '? It will show on each of them.';
    }
    if (choice.kind === 'unrelated') {
      if (invoice) return 'Record that this invoice is not for any job? Finance will confirm. The money stays owed.';
      return 'Record that this message is not for any job?';
    }
    if (choice.kind === 'unresolved') return 'Record that you cannot tell yet? It stays on the list.';
    var to = passTargets(item).indexOf(choice.to) >= 0 ? choice.to : escalateTo(item);
    return 'Pass ' + what + ' to ' + teamWords(to) + '? It stays on the list with them.';
  }
  function heldWith(item) {
    if (item.decision_state === 'decided' && item.last_action === 'escalate' && item.owner && item.owner !== 'context_resolver') {
      return 'With ' + teamWords(item.owner);
    }
    if (item.subject_kind === 'invoice' && item.decision_state === 'decided' && item.owner === 'finance') {
      if (item.last_action === 'unrelated') return 'With Finance, not for any job';
      if (item.last_action === 'correct') {
        var nums = ((item.summary && item.summary.decided_jobs) || []).map(function (j) { return j && j.job_number; }).filter(Boolean);
        return 'With Finance' + (nums.length ? ': ' + nums.join(', ') : '');
      }
    }
    if (item.decision_state === 'decided' && item.last_action === 'unresolved') return 'Could not tell last time';
    if (item.decision_state === 'evidence_changed') return 'Changed since the last choice';
    return '';
  }
  function refusalWords(err) {
    var code = err && (err.code || (err.body && err.body.code));
    if (code && REFUSALS[code]) return REFUSALS[code];
    if (err && /unknown action/i.test(String(err.message || ''))) return 'This list is not switched on yet.';
    return 'Something went wrong. Please try again.';
  }
  function mustReread(err) {
    var code = err && (err.code || (err.body && err.body.code));
    return code === 'evidence_changed' || code === 'subject_not_found';
  }
  function grouped(items) {
    var out = [];
    (items || []).forEach(function (it) {
      var last = out[out.length - 1];
      if (!last || last.band !== it.band) out.push({ band: it.band, items: [it] });
      else last.items.push(it);
    });
    return out;
  }
  // Find by job: a job number is matched whole by the server; the screen only trims it.
  function jobNumberOk(s) { return /^[A-Za-z0-9-]{1,40}$/.test(String(s || '').trim()); }
  // One recon_job_items row as a list card. The cause words stay the server's.
  function fromJobItem(it) {
    return {
      band: null, subject_kind: 'event', subject_id: it.event_id, evidence_hash: it.shown_hash,
      cause: it.cause, decision_state: it.decision_state || 'none', last_action: it.last_action || null,
      owner: 'context_resolver', waiting_days: null,
      offered_jobs: (it.offered || []).map(function (j) { return { job_id: j.job_id, job_number: j.job_number }; }),
      other_jobs: [],
      summary: { channel: it.channel, direction: it.direction, occurred_at: it.occurred_at, from: it.from_address, subject: it.subject, preview: it.preview }
    };
  }
  function causeWords(cause) {
    return {
      'defect:no_identity': 'No contact on this message, so it was never matched',
      'defect:backfill_never_asked': 'Loaded from history and never matched',
      'ambiguity:several_candidates': 'Could be more than one job',
      'ambiguity:one_candidate': 'One likely job, not confirmed',
      'ambiguity:no_candidate': 'No likely job'
    }[cause] || '';
  }
  function hasBanned(s) { return /[\u2013\u2014]/.test(String(s)) || /\p{Extended_Pictographic}/u.test(String(s)); }
  return {
    tabVisible: tabVisible, bandOf: bandOf, money: money, waitWords: waitWords, jobWords: jobWords,
    actionFor: actionFor, bodyFor: bodyFor, confirmWords: confirmWords, heldWith: heldWith,
    refusalWords: refusalWords, mustReread: mustReread, grouped: grouped, escalateTo: escalateTo,
    passTargets: passTargets, teamWords: teamWords,
    canSplit: canSplit, splitLabel: splitLabel, jobNumberOk: jobNumberOk, fromJobItem: fromJobItem, causeWords: causeWords,
    hasBanned: hasBanned
  };
})();
// </recon-core>

var RC = { items: null, err: null, loading: false, gen: 0, pick: null, saving: false, msg: null,
  job: null /* { number, items, err, loading, gen } for Find by job */ };

function rcEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function rcRoot() { return document.getElementById('reconRoot'); }
function rcToast(msg, type) { if (typeof showToast === 'function') showToast(rcEsc(msg), type); }

function reconReveal(on) {
  document.querySelectorAll('[data-recon-nav]').forEach(function (b) { b.style.display = on ? '' : 'none'; });
}
function reconProbeVisibility() {
  var stored = null;
  try { stored = localStorage.getItem('sw_recon'); } catch (e) {}
  var on = ReconCore.tabVisible(window.location ? window.location.search : '', stored);
  reconReveal(on);
  return on;
}

function rcCss() {
  if (document.getElementById('reconCss')) return;
  var st = document.createElement('style');
  st.id = 'reconCss';
  st.textContent = [
    '#viewRecon .rc-wrap{max-width:880px;margin:0 auto;padding:16px;}',
    '#viewRecon .rc-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;}',
    '#viewRecon .rc-head h2{margin:0;font-size:20px;}',
    '#viewRecon .rc-lede{color:var(--sw-text-sec);font-size:13px;margin:4px 0 16px;}',
    '#viewRecon .rc-band{margin:20px 0 8px;font-size:15px;font-weight:600;}',
    '#viewRecon .rc-band small{display:block;font-weight:400;color:var(--sw-text-sec);font-size:12px;}',
    '#viewRecon .rc-card{background:var(--sw-card,#fff);border:1px solid var(--sw-border,#e3e3e3);border-radius:10px;padding:12px 14px;margin-bottom:10px;}',
    '#viewRecon .rc-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-weight:600;}',
    '#viewRecon .rc-meta{color:var(--sw-text-sec);font-size:12px;margin-top:2px;}',
    '#viewRecon .rc-preview{font-size:13px;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere;}',
    '#viewRecon .rc-held{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#fff4d6;color:#7a5b00;margin-left:6px;font-weight:500;}',
    '#viewRecon .rc-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}',
    '#viewRecon .rc-acts button,#viewRecon .rc-acts select{font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--sw-border,#d0d0d0);background:var(--sw-bg,#fafafa);cursor:pointer;max-width:100%;}',
    '#viewRecon .rc-acts .rc-job{background:#eef5ff;border-color:#b9d3f5;}',
    '#viewRecon .rc-confirm{margin-top:10px;padding:10px;border-radius:8px;background:#f3f7ff;font-size:13px;}',
    '#viewRecon .rc-confirm button{margin:8px 6px 0 0;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid #9bb8e6;background:#fff;cursor:pointer;}',
    '#viewRecon .rc-confirm .rc-yes{background:#1f5fbf;color:#fff;border-color:#1f5fbf;}',
    '#viewRecon .rc-msg{margin:10px 0;padding:10px;border-radius:8px;background:#fdecec;color:#8a1c1c;font-size:13px;}',
    '#viewRecon .rc-empty{color:var(--sw-text-sec);padding:24px 0;}',
    '#viewRecon .rc-find{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:4px 0 8px;font-size:13px;}',
    '#viewRecon .rc-find input{font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--sw-border,#d0d0d0);min-width:0;flex:1 1 180px;max-width:260px;}',
    '#viewRecon .rc-find button{font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--sw-border,#d0d0d0);background:var(--sw-bg,#fafafa);cursor:pointer;}'
  ].join('\n');
  document.head.appendChild(st);
}

// showView('recon') calls this.
function loadRecon() {
  rcCss();
  if (!rcRoot()) return;
  rcBind();
  rcRead(!!RC.items);
}

async function rcRead(quiet) {
  var gen = ++RC.gen;
  if (!quiet || !RC.items) { RC.loading = true; rcRender(); }
  var res = null, err = null;
  try { res = await opsFetch('recon_daily_list', { limit: 50 }); } catch (e) { err = e; }
  if (gen !== RC.gen) return;
  RC.loading = false;
  if (err) {
    if (!quiet || !RC.items) { RC.items = null; RC.err = err; }
  } else {
    RC.items = (res && res.items) || []; RC.err = null;
  }
  rcRender();
}

function rcCard(item) {
  var band = item.band;
  var s = item.summary || {};
  var h = '<div class="rc-card" data-rc-subject="' + rcEsc(item.subject_id) + '">';
  var held = ReconCore.heldWith(item);
  if (item.subject_kind === 'invoice') {
    h += '<div class="rc-top"><span>' + rcEsc(s.invoice_number || 'Invoice') + ' &middot; ' + rcEsc(s.contact_name || 'No contact name') +
      (held ? '<span class="rc-held">' + rcEsc(held) + '</span>' : '') + '</span>' +
      '<span>' + rcEsc(ReconCore.money(item.amount)) + ' owed</span></div>';
    h += '<div class="rc-meta">' + rcEsc([s.reference ? 'Ref ' + s.reference : '', s.invoice_date ? 'Dated ' + s.invoice_date : '',
      s.due_date ? 'Due ' + s.due_date : '', 'Waiting ' + ReconCore.waitWords(item.waiting_days)].filter(Boolean).join(' · ')) + '</div>';
  } else {
    h += '<div class="rc-top"><span>' + rcEsc((s.channel || 'Message') + (s.from ? ' from ' + s.from : '')) +
      (held ? '<span class="rc-held">' + rcEsc(held) + '</span>' : '') + '</span>' +
      (band === 2 ? '<span>They owe ' + rcEsc(ReconCore.money(item.amount)) + '</span>' : '') + '</div>';
    h += '<div class="rc-meta">' + rcEsc([s.occurred_at ? String(s.occurred_at).slice(0, 10) : '', item.waiting_days == null ? '' : 'Waiting ' + ReconCore.waitWords(item.waiting_days),
      item.band == null ? ReconCore.causeWords(item.cause) : ''].filter(Boolean).join(' · ')) + '</div>';
    if (s.subject) h += '<div class="rc-preview"><strong>' + rcEsc(s.subject) + '</strong></div>';
    if (s.preview) h += '<div class="rc-preview">' + rcEsc(s.preview) + '</div>';
  }
  var picking = RC.pick && RC.pick.subject_id === item.subject_id;
  if (picking) {
    h += '<div class="rc-confirm">' + rcEsc(ReconCore.confirmWords(item, RC.pick.choice)) + '<br>' +
      '<button type="button" class="rc-yes" data-rc-yes ' + (RC.saving ? 'disabled' : '') + '>' + (RC.saving ? 'Recording...' : 'Yes, record it') + '</button>' +
      '<button type="button" data-rc-back ' + (RC.saving ? 'disabled' : '') + '>Back</button></div>';
  } else {
    h += '<div class="rc-acts">';
    (item.offered_jobs || []).forEach(function (j) {
      h += '<button type="button" class="rc-job" data-rc-job="' + rcEsc(j.job_id) + '">It is ' + rcEsc(ReconCore.jobWords(j)) + '</button>';
    });
    if (ReconCore.canSplit(item)) {
      h += '<button type="button" class="rc-job" data-rc-kind="split">' + rcEsc(ReconCore.splitLabel(item)) + '</button>';
    }
    var others = item.other_jobs || [];
    if (others.length) {
      h += '<select data-rc-other aria-label="Another job of theirs"><option value="">Another job of theirs...</option>' +
        others.map(function (j) { return '<option value="' + rcEsc(j.job_id) + '">' + rcEsc(ReconCore.jobWords(j)) + '</option>'; }).join('') + '</select>';
    }
    h += '<button type="button" data-rc-kind="unrelated">Not for any job</button>';
    h += '<button type="button" data-rc-kind="unresolved">Cannot tell yet</button>';
    ReconCore.passTargets(item).forEach(function (to) {
      h += '<button type="button" data-rc-kind="escalate" data-rc-to="' + rcEsc(to) + '">Pass to ' + rcEsc(ReconCore.teamWords(to)) + '</button>';
    });
    h += '</div>';
  }
  return h + '</div>';
}

function rcRender() {
  var root = rcRoot();
  if (!root) return;
  var h = '<div class="rc-wrap"><div class="rc-head"><h2>Matching</h2>' +
    '<button type="button" data-rc-reload class="btn btn-sm">Read again</button></div>' +
    '<div class="rc-lede">What needs a person to say which job it belongs to, most at stake first. ' +
    'A choice here is recorded under your name. It never moves money, sends anything or changes an invoice.</div>';
  if (RC.msg) h += '<div class="rc-msg" data-rc-msg>' + rcEsc(RC.msg) + '</div>';
  h += rcJobSection();
  if (RC.loading && !RC.items) {
    h += '<div class="rc-empty">Reading the list...</div>';
  } else if (RC.err) {
    h += '<div class="rc-msg" data-rc-err>' + rcEsc(ReconCore.refusalWords(RC.err)) + '</div>';
  } else if (!RC.items || !RC.items.length) {
    h += '<div class="rc-empty">Nothing needs matching right now.</div>';
  } else {
    ReconCore.grouped(RC.items).forEach(function (g) {
      var b = ReconCore.bandOf(g.items[0]);
      h += '<div class="rc-band" data-rc-band="' + rcEsc(g.band) + '">' + rcEsc(b.title) + ' (' + g.items.length + ')<small>' + rcEsc(b.note) + '</small></div>';
      g.items.forEach(function (it) { h += rcCard(it); });
    });
  }
  root.innerHTML = h + '</div>';
}

function rcJobSection() {
  var j = RC.job;
  var h = '<form class="rc-find" data-rc-find><label for="rcJobNo">Find by job</label> ' +
    '<input id="rcJobNo" name="job" autocomplete="off" placeholder="Job number, e.g. SWP-26376" value="' + rcEsc(j ? j.number : '') + '"> ' +
    '<button type="submit">Find</button>' + (j ? ' <button type="button" data-rc-clear>Clear</button>' : '') + '</form>';
  if (!j) return h;
  h += '<div class="rc-band" data-rc-jobband>Waiting on ' + rcEsc(j.number) + (j.items ? ' (' + j.items.length + ')' : '') +
    '<small>Every message that could belong to this job and still needs a person, including ones the list below leaves out.</small></div>';
  if (j.loading && !j.items) h += '<div class="rc-empty">Reading that job...</div>';
  else if (j.err) h += '<div class="rc-msg" data-rc-joberr>' + rcEsc(ReconCore.refusalWords(j.err)) + '</div>';
  else if (!j.items.length) h += '<div class="rc-empty" data-rc-jobempty>Nothing on ' + rcEsc(j.number) + ' needs matching.</div>';
  else j.items.forEach(function (it) { h += rcCard(it); });
  return h;
}

async function rcReadJob(number, quiet) {
  if (!RC.job || RC.job.number !== number) RC.job = { number: number, items: null, err: null, loading: false, gen: 0 };
  var j = RC.job, gen = ++j.gen;
  if (!quiet || !j.items) { j.loading = true; rcRender(); }
  var res = null, err = null;
  try { res = await opsFetch('recon_job_items', { job_number: number }); } catch (e) { err = e; }
  if (RC.job !== j || gen !== j.gen) return;
  j.loading = false;
  if (err) { if (!quiet || !j.items) { j.items = null; j.err = err; } }
  else { j.items = ((res && res.items) || []).map(ReconCore.fromJobItem); j.err = null; }
  rcRender();
}

function rcItem(id) {
  var all = (RC.job && RC.job.items || []).concat(RC.items || []);
  return all.filter(function (i) { return i.subject_id === id; })[0] || null;
}

function rcChoose(subjectId, choice) {
  RC.pick = { subject_id: subjectId, choice: choice };
  RC.msg = null;
  rcRender();
}

async function rcRecord() {
  if (!RC.pick || RC.saving) return;
  var item = rcItem(RC.pick.subject_id);
  if (!item) { RC.pick = null; rcRender(); return; }
  RC.saving = true; rcRender();
  try {
    await opsPost('recon_record_decision', ReconCore.bodyFor(item, RC.pick.choice));
    RC.saving = false; RC.pick = null; RC.msg = null;
    rcToast('Recorded', 'success');
    if (RC.job) await rcReadJob(RC.job.number, true);
    await rcRead(true);
  } catch (e) {
    RC.saving = false;
    RC.msg = ReconCore.refusalWords(e);
    if (ReconCore.mustReread(e)) { RC.pick = null; if (RC.job) await rcReadJob(RC.job.number, true); await rcRead(true); return; }
    rcRender();
  }
}

function rcBind() {
  var root = rcRoot();
  if (!root || root.__rcBound) return;
  root.__rcBound = true;
  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button');
    if (!t || !root.contains(t)) return;
    var card = t.closest('[data-rc-subject]');
    var id = card && card.getAttribute('data-rc-subject');
    if (t.hasAttribute('data-rc-reload')) { RC.msg = null; RC.pick = null; rcRead(false); return; }
    if (t.hasAttribute('data-rc-yes')) { rcRecord(); return; }
    if (t.hasAttribute('data-rc-back')) { RC.pick = null; rcRender(); return; }
    if (t.hasAttribute('data-rc-clear')) { RC.job = null; RC.pick = null; rcRender(); return; }
    if (!id) return;
    if (t.hasAttribute('data-rc-job')) { rcChoose(id, { kind: 'job', job_id: t.getAttribute('data-rc-job') }); return; }
    if (t.hasAttribute('data-rc-kind')) {
      var choice = { kind: t.getAttribute('data-rc-kind') };
      if (t.hasAttribute('data-rc-to')) choice.to = t.getAttribute('data-rc-to');
      rcChoose(id, choice);
    }
  });
  root.addEventListener('submit', function (ev) {
    var f = ev.target;
    if (!f || !f.hasAttribute || !f.hasAttribute('data-rc-find')) return;
    ev.preventDefault();
    var input = f.querySelector('input[name="job"]');
    var number = String(input ? input.value : '').trim().toUpperCase();
    if (!ReconCore.jobNumberOk(number)) { RC.msg = 'Type a job number, for example SWP-26376.'; rcRender(); return; }
    RC.msg = null; RC.pick = null;
    rcReadJob(number, false);
  });
  root.addEventListener('change', function (ev) {
    var sel = ev.target;
    if (!sel || !sel.hasAttribute || !sel.hasAttribute('data-rc-other') || !sel.value) return;
    var card = sel.closest('[data-rc-subject]');
    if (card) rcChoose(card.getAttribute('data-rc-subject'), { kind: 'job', job_id: sel.value });
  });
}

if (typeof document !== 'undefined' && document.addEventListener) {
  var rcStart = function () { if (rcRoot()) rcBind(); reconProbeVisibility(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rcStart);
  else rcStart();
}
