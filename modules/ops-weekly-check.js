// P4-10.3: the retained weekly sample. Only explicit Save presses record a read.
(function () {
  'use strict';
  var problems = {
    'Not supported by the job': 'unsupported', 'Wrong money': 'wrong_money',
    'Should be closed': 'wrongly_open', 'Should be open': 'wrongly_closed', 'Never happened': 'made_up'
  };
  function buildRead(job, ticks, missing) {
    var marks = (ticks || []).map(function (tick) {
      var why = String(tick.why || '').trim();
      if (!why) throw new Error('reason_needed');
      return { target: tick.target, ref: tick.ref, problem: problems[tick.problem] || tick.problem, why: why };
    });
    return { week: job.week, job_id: job.job_id, marks: marks,
      missing: (missing || []).map(function (line) { return String(line).trim(); }).filter(Boolean) };
  }
  if (typeof module !== 'undefined') module.exports = { buildRead: buildRead };
  if (typeof window === 'undefined') return;

  var root, data, loading = false, generation = 0, saving = null;
  var drafts = {}, messages = {}, error = false, openJobs = {};
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function percent(value) { return value == null || !isFinite(Number(value)) ? 'Not known' : (Number(value) * 100).toFixed(1) + '%'; }
  function count(value) { return value == null ? 'Not known' : esc(value); }
  function when(value, dateOnly) {
    if (!value) return 'Not known';
    var at = new Date(dateOnly ? value + 'T00:00:00+08:00' : value);
    if (!isFinite(at.getTime())) return 'Not known';
    return at.toLocaleString('en-AU', dateOnly
      ? { timeZone: 'Australia/Perth', day: 'numeric', month: 'short' }
      : { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function reveal(on) {
    document.querySelectorAll('[data-weekly-check-nav]').forEach(function (el) { el.style.display = on ? '' : 'none'; });
  }
  function style() {
    if (document.getElementById('weeklyCheckStyle')) return;
    var el = document.createElement('style');
    el.id = 'weeklyCheckStyle';
    el.textContent = '.wc{max-width:960px;margin:0 auto;padding:24px;color:var(--sw-text,#222);font-size:15px;line-height:1.5}' +
      '.wc h1{font-size:24px;line-height:1.25;margin:0 0 8px}.wc h2{font-size:19px;margin:24px 0 8px}.wc p{margin:8px 0}.wc button,.wc input,.wc select,.wc textarea{font:inherit}' +
      '.wc button,.wc a{min-height:44px}.wc button{padding:9px 14px;border:1px solid var(--sw-border,#ccc);border-radius:8px;background:var(--sw-surface,#fff);color:inherit;cursor:pointer}' +
      '.wc button:hover{background:var(--sw-bg,#f5f5f5)}.wc button:disabled{opacity:.55;cursor:default}.wc :focus-visible{outline:2px solid var(--sw-orange,#b74900);outline-offset:3px}' +
      '.wc-head{display:flex;justify-content:space-between;align-items:start;gap:16px}.wc-numbers{display:flex;flex-wrap:wrap;gap:8px 28px;padding:16px 0;border-block:1px solid var(--sw-border,#ddd);font-variant-numeric:tabular-nums}' +
      '.wc-summary{padding:12px 0}.wc-job{border-top:1px solid var(--sw-border,#ddd)}.wc-job summary{padding:16px 0;cursor:pointer;display:flex;gap:8px 20px;flex-wrap:wrap;align-items:center}.wc-job summary strong{margin-right:auto}' +
      '.wc form{padding-bottom:24px}.wc a{display:inline-flex;align-items:center;color:var(--sw-text,#222);text-underline-offset:3px}.wc-lines{padding:0;margin:0;list-style:none}.wc-line{padding:14px 0;border-bottom:1px solid var(--sw-border,#eee)}' +
      '.wc-line-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start}.wc-words{max-width:72ch;overflow-wrap:anywhere}.wc-wrong{display:flex;align-items:center;gap:8px;min-height:44px;white-space:nowrap}.wc input[type=checkbox]{width:20px;height:20px;accent-color:var(--sw-orange,#b74900)}' +
      '.wc-edit{margin-top:8px;max-width:650px}.wc-edit label{display:block;margin:8px 0}.wc select,.wc textarea{display:block;width:100%;box-sizing:border-box;border:1px solid var(--sw-border,#bbb);border-radius:6px;padding:10px;background:var(--sw-surface,#fff);color:inherit}' +
      '.wc small{display:block;color:var(--sw-mid,#4C6A7C)}.wc-candidate{font-weight:600}.wc-missing{display:flex;align-items:start;gap:8px;margin:8px 0}.wc-missing textarea{flex:1;min-width:0}.wc-save{margin-top:20px}.wc button.wc-primary,.wc button.wc-primary:hover{background:var(--sw-text,#222);color:var(--sw-surface,#fff)}' +
      '.wc-message{min-height:24px;overflow-wrap:anywhere}.wc-misses{padding-left:20px}.wc-misses li{margin:12px 0;overflow-wrap:anywhere}.wc [hidden]{display:none!important}' +
      '@media(max-width:600px){.wc{padding:16px}.wc h1{font-size:21px}.wc-head{flex-wrap:wrap}.wc-job summary{gap:4px 12px}.wc-job summary small{width:100%}.wc-line-top{gap:10px}.wc-numbers{display:block}.wc-numbers>div{margin:8px 0}}';
    document.head.appendChild(el);
  }
  function summary() {
    if (!data.jobs.length && !data.this_week) return '<div class="wc-head"><h1>Weekly check</h1><button type="button" data-wc-refresh>Refresh</button></div>';
    var week = data.this_week || {}, drawn = week.drawn == null ? data.jobs.length : week.drawn;
    var h = '<div class="wc-head"><div><h1>Weekly check: ' + count(drawn) + ' jobs drawn at random</h1><p>Week of ' + when(data.week, true) + '. ' + count(week.read) + ' of ' + count(drawn) + ' read.</p></div><button type="button" data-wc-refresh>Refresh</button></div>';
    h += '<div class="wc-numbers"><div><strong>This week: ' + (week.complete ? percent(week.score) : 'Not finished') + '</strong>';
    if (week.complete && week.score != null) h += Number(week.score) >= 0.98 ? ' <span aria-label="At least 98%">&#10003;</span>' : ' <span>Below 98%</span>';
    h += '</div><div>Stories with a miss: ' + count(week.stories_with_miss) + ' of ' + count(week.read) + '</div><div>Last 4 weeks: ';
    h += (data.scores || []).slice(0, 4).map(function (s) { return '<span title="Week of ' + esc(when(s.week, true)) + '">' + (s.complete ? percent(s.score) : 'Not finished') + '</span>'; }).join(', ') || 'None read yet';
    h += '</div></div><div class="wc-summary">';
    var shares = data.close_shares;
    h += '<p>Open items this week: ' + (shares ? 'closed by a record ' + percent(shares.share_record) + ', on words ' + percent(shares.share_words) + ', by a person ' + percent(shares.share_person) + ', still open past 14 days ' + percent(shares.share_open_past_14) + ' (' + count(shares.open_past_14_days) + ')' : 'Not known') + '</p>';
    h += '<p>Closes on words read this week: ' + (week.word_closes_read === 0 ? 'none read yet' : count(week.word_closes_read) + ', right ' + percent(week.word_close_accuracy)) + '</p></div>';
    return h;
  }
  function lines(job, target, marks) {
    var list = target === 'story' ? job.story : job.notes;
    var h = '<h2>' + (target === 'story' ? 'The story' : 'The notes') + '</h2>';
    if (job[target === 'story' ? 'story_source' : 'notes_source'] === 'candidate') h += '<p class="wc-candidate">New ' + (target === 'story' ? 'story' : 'notes') + ', not live yet</p>';
    h += '<ul class="wc-lines">';
    (list || []).forEach(function (line) {
      var ref = target === 'story' ? line.ref : line.item_key;
      var mark = marks.find(function (m) { return m.target === target && m.ref === ref; });
      var choices = target === 'story' ? ['Not supported by the job', 'Wrong money'] : ['Should be closed', 'Should be open', 'Never happened'];
      h += '<li class="wc-line" data-target="' + target + '" data-ref="' + esc(ref) + '"><div class="wc-line-top"><div class="wc-words">' + esc(target === 'story' ? line.text : line.what);
      if (target === 'note') {
        var state = { open: 'Open', closed: 'Closed', declined: 'Declined', disputed: 'Disputed' }[line.status] || 'State not known';
        var how = { record: 'by a record', words_two_models: 'on words, two AI readers agreed', words_one_model: 'on words, one AI reader', person: 'by a person' }[line.closed_how];
        h += '<small>' + state + (how ? ' · ' + how : '') + '</small>';
      }
      h += '</div><label class="wc-wrong"><input type="checkbox" data-wc-wrong' + (mark ? ' checked' : '') + '> Wrong</label></div>';
      h += '<div class="wc-edit"' + (mark ? '' : ' hidden') + '><label>What is wrong?<select data-wc-problem>';
      choices.forEach(function (choice) { h += '<option value="' + problems[choice] + '"' + (mark && mark.problem === problems[choice] ? ' selected' : '') + '>' + choice + '</option>'; });
      h += '</select></label><label>Why? (a few words)<textarea data-wc-why rows="2" minlength="3" maxlength="300"' + (mark ? ' required' : ' disabled') + '>' + esc(mark && mark.why) + '</textarea></label></div></li>';
    });
    return h + '</ul>' + (!(list || []).length ? '<p>No ' + (target === 'story' ? 'story sentences' : 'notes') + ' in this sample.</p>' : '');
  }
  function missingLine(value) {
    return '<div class="wc-missing"><textarea data-wc-missing aria-label="Missing line" rows="2" minlength="3" maxlength="300">' + esc(value) + '</textarea><button type="button" data-wc-remove>Remove</button></div>';
  }
  function jobHtml(job) {
    var draft = drafts[job.job_id] || { marks: job.marks || [], missing: job.missing || [] };
    var h = '<details class="wc-job" data-job="' + esc(job.job_id) + '"' + (openJobs[job.job_id] ? ' open' : '') + '><summary><strong>Job ' + esc(job.job_number || 'number not known') + '</strong><span>' + (job.read ? 'Read' : 'To read') + '</span><small>As at ' + when(job.as_at) + '</small></summary>';
    h += '<form data-wc-form><fieldset style="border:0;padding:0;margin:0;min-width:0"' + (saving ? ' disabled' : '') + '><a target="_blank" rel="noopener" href="ops.html#job/' + encodeURIComponent(job.job_id) + '">Open the job page</a>';
    h += lines(job, 'story', draft.marks) + lines(job, 'note', draft.marks);
    h += '<h2>Anything missing?</h2><div data-wc-missing-list>' + draft.missing.map(missingLine).join('') + '</div><button type="button" data-wc-add' + (draft.missing.length >= 20 ? ' disabled' : '') + '>Add a line</button>';
    h += '<div class="wc-save"><button class="wc-primary" type="submit" data-wc-save>' + (saving === job.job_id ? 'Saving' : draft.marks.length || draft.missing.some(function (s) { return s.trim(); }) ? 'Save this job' : 'All correct: save') + '</button><p class="wc-message" role="status">' + esc(messages[job.job_id]) + '</p></div></fieldset></form></details>';
    return h;
  }
  function render() {
    if (!root) return;
    var h = '<div class="wc">';
    if (!data) h += loading ? '<p role="status">Loading</p>' : error ? '<p>Could not load. Try again.</p><button data-wc-refresh>Try again</button>' : '';
    else {
      h += summary();
      if (error) h += '<p role="alert">Could not load. Try again.</p>';
      if (!data.jobs.length) h += '<p>This week\'s jobs have not been drawn yet. They are drawn on Monday morning.</p>';
      else h += data.jobs.map(jobHtml).join('');
      h += '<h2>Misses this week</h2>';
      var misses = (data.this_week && data.this_week.misses) || [];
      h += misses.length ? '<ol class="wc-misses">' + misses.map(function (m) {
        return '<li><strong>Job ' + esc(m.job_number || 'number not known') + '</strong><div>' + esc(m.text || (m.target === 'missing' ? 'Missing line' : 'Text not known')) + '</div><div>' + esc(m.why) + '</div></li>';
      }).join('') + '</ol>' : '<p>No misses recorded.</p>';
    }
    root.innerHTML = h + '</div>';
  }
  function readForm(form) {
    var ticks = [];
    form.querySelectorAll('.wc-line').forEach(function (line) {
      if (line.querySelector('[data-wc-wrong]').checked) ticks.push({ target: line.dataset.target, ref: line.dataset.ref,
        problem: line.querySelector('[data-wc-problem]').value, why: line.querySelector('[data-wc-why]').value });
    });
    return { marks: ticks, missing: Array.from(form.querySelectorAll('[data-wc-missing]')).map(function (el) { return el.value; }) };
  }
  function remember() {
    if (!root || !data) return;
    root.querySelectorAll('[data-job]').forEach(function (el) { openJobs[el.dataset.job] = el.open; drafts[el.dataset.job] = readForm(el.querySelector('form')); });
  }
  async function refresh() {
    if (!root || saving) return;
    remember();
    var gen = ++generation;
    loading = true; error = false;
    if (!data) render();
    try {
      var answer = await window.opsFetch('weekly_check_list');
      if (gen !== generation) return;
      if (!answer || !Array.isArray(answer.jobs)) throw new Error('unreadable');
      if (data && data.week !== answer.week) { drafts = {}; messages = {}; openJobs = {}; }
      data = answer;
      reveal(true);
    } catch (err) {
      if (gen !== generation) return;
      if (err.status === 401 || err.status === 403 || /unknown action/i.test(err.message || '')) { data = null; error = false; reveal(false); }
      else error = true;
    }
    loading = false; render();
  }
  function changed(form) {
    var draft = readForm(form), button = form.querySelector('[data-wc-save]');
    var id = form.closest('[data-job]').dataset.job;
    drafts[id] = draft; messages[id] = '';
    var words = draft.marks.length || draft.missing.some(function (s) { return s.trim(); }) ? 'Save this job' : 'All correct: save';
    // Keep the pressed button's text node while a reason field blurs in WebKit.
    if (button.textContent !== words) button.textContent = words;
    form.querySelector('.wc-message').textContent = '';
  }
  async function save(form) {
    if (saving || !data) return;
    var id = form.closest('[data-job]').dataset.job;
    var job = data.jobs.find(function (j) { return j.job_id === id; });
    var draft = readForm(form), body;
    try { body = buildRead(Object.assign({ week: data.week }, job), draft.marks, draft.missing); }
    catch (err) { form.querySelector('.wc-message').textContent = 'Add a reason for each ticked line.'; return; }
    remember(); ++generation; loading = false; saving = id; messages[id] = ''; render();
    try {
      var result = await window.opsPost('weekly_check_record', body);
      if (!result || result.outcome !== 'recorded') throw new Error('unrecorded');
      messages[id] = 'Saved.';
      job.read = true; job.marks = body.marks; job.missing = body.missing;
      drafts[id] = { marks: body.marks, missing: body.missing };
      saving = null;
      // Re-read the server's score and misses; the browser never works them out.
      await refresh();
    } catch (err) {
      saving = null;
      messages[id] = err.status === 400 ? err.message : 'Could not save. Try again.';
      render();
    }
  }
  function mount(el) {
    if (!el) return;
    if (root === el) return;
    root = el; style();
    root.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || saving || button.type === 'submit') return;
      if (button.hasAttribute('data-wc-refresh')) { refresh(); return; }
      var form = button.closest('form');
      if (!form) return;
      if (button.hasAttribute('data-wc-add')) {
        var list = form.querySelector('[data-wc-missing-list]');
        if (list.children.length < 20) { list.insertAdjacentHTML('beforeend', missingLine('')); list.lastElementChild.querySelector('textarea').focus(); }
        button.disabled = list.children.length >= 20;
      }
      if (button.hasAttribute('data-wc-remove')) { button.closest('.wc-missing').remove(); form.querySelector('[data-wc-add]').disabled = false; }
      changed(form);
    });
    root.addEventListener('change', function (event) {
      var form = event.target.closest('form');
      if (!form) return;
      if (event.target.hasAttribute('data-wc-wrong')) {
        var edit = event.target.closest('.wc-line').querySelector('.wc-edit');
        edit.hidden = !event.target.checked;
        edit.querySelector('textarea').required = event.target.checked;
        edit.querySelector('textarea').disabled = !event.target.checked;
      }
      changed(form);
    });
    root.addEventListener('input', function (event) { var form = event.target.closest('form'); if (form) changed(form); });
    root.addEventListener('submit', function (event) { event.preventDefault(); save(event.target); });
    refresh();
  }
  window.WeeklyCheck = { mount: mount, refresh: refresh };
})();
