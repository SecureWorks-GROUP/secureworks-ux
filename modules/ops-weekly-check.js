// P4-10.3: office reads of the retained weekly sample. No job or money writes.
(function () {
  'use strict';
  var problems = {
    'Not supported by the job': 'unsupported', 'Wrong money': 'wrong_money',
    'Should be closed': 'wrongly_open', 'Should be open': 'wrongly_closed', 'Never happened': 'made_up'
  };
  var storyChoices = ['Not supported by the job', 'Wrong money'];
  var noteChoices = ['Should be closed', 'Should be open', 'Never happened'];
  function buildRead(job, ticks, missing) {
    var marks = (ticks || []).map(function (tick) {
      var why = String(tick.why || '').trim();
      if (!why) throw new Error('reason_needed');
      if (why.length < 3 || why.length > 300) throw new Error('reason_length');
      if (tick.target !== 'story' && tick.target !== 'note') throw new Error('line_needed');
      var list = tick.target === 'story' ? job.story : job.notes;
      var choices = tick.target === 'story' ? storyChoices : noteChoices;
      var problem = problems[tick.problem] || tick.problem;
      if (!list || !list.some(function (line) { return (tick.target === 'story' ? line.ref : line.item_key) === tick.ref; }) ||
          !choices.some(function (label) { return problems[label] === problem; })) throw new Error('line_needed');
      return { target: tick.target, ref: tick.ref, problem: problem, why: why };
    });
    var lines = (missing || []).map(function (line) { return String(line).trim(); });
    if (lines.length > 20 || lines.some(function (line) { return line.length < 3 || line.length > 300; })) throw new Error('missing_length');
    return { week: job.week, job_id: job.job_id, marks: marks, missing: lines };
  }
  if (typeof window !== 'undefined') {

  var root, data, busy = false, sequence = 0, drafts = {}, open = {}, message = '', loadError = false;
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(value) { return value == null || !Number.isFinite(Number(value)) ? 'Not known' : (Number(value) * 100).toFixed(1) + '%'; }
  function count(value) { return value == null ? 'Not known' : String(value); }
  function time(value, week) {
    if (!value) return 'Not known';
    var date = new Date(week ? value + 'T00:00:00+08:00' : value);
    if (!Number.isFinite(date.getTime())) return 'Not known';
    return date.toLocaleString('en-AU', week ? { timeZone: 'Australia/Perth', day: 'numeric', month: 'short' } :
      { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  function enabled() { return typeof window.weeklyCheckEnabled === 'function' && window.weeklyCheckEnabled(); }
  function reveal(on) { document.querySelectorAll('[data-weekly-check-nav]').forEach(function (el) { el.style.display = on ? '' : 'none'; }); }
  function draft(index) {
    if (!drafts[index]) {
      var job = data.jobs[index];
      drafts[index] = { ticks: (job.marks || []).map(function (mark) { return Object.assign({}, mark); }), missing: (job.missing || []).slice(), error: '', saved: false };
    }
    return drafts[index];
  }
  function lineHtml(line, target, index, lineIndex) {
    var ref = target === 'story' ? line.ref : line.item_key;
    var d = draft(index), tick = d.ticks.find(function (mark) { return mark.target === target && mark.ref === ref; });
    var choices = target === 'story' ? storyChoices : noteChoices;
    var state = { open: 'Open', closed: 'Closed', declined: 'Declined', disputed: 'Disputed' }[line.status] || 'State not known';
    var how = { record: 'by a record', words_two_models: 'on words, two AI readers agreed', words_one_model: 'on words, one AI reader', person: 'by a person' }[line.closed_how];
    var labelId = 'wc-line-' + index + '-' + target + '-' + lineIndex;
    return '<div class="wc-line" data-target="' + target + '" data-ref="' + esc(ref) + '">' +
      '<div class="wc-line-top"><div id="' + labelId + '">' + esc(target === 'story' ? line.text : line.what) +
      (target === 'note' ? '<div class="wc-muted">' + esc(state + (how ? ' · ' + how : '')) + '</div>' : '') + '</div>' +
      '<label class="wc-wrong"><span>Wrong</span><input type="checkbox" data-wrong aria-describedby="' + labelId + '"' + (tick ? ' checked' : '') + (busy ? ' disabled' : '') + '></label></div>' +
      (tick ? '<div class="wc-reason"><label>What is wrong?<select data-problem' + (busy ? ' disabled' : '') + '>' + choices.map(function (label) {
        return '<option value="' + problems[label] + '"' + (problems[label] === tick.problem ? ' selected' : '') + '>' + label + '</option>';
      }).join('') + '</select></label><label>Why? (a few words)<input data-why type="text" maxlength="300" value="' + esc(tick.why) + '"' + (busy ? ' disabled' : '') + '></label></div>' : '') + '</div>';
  }
  function jobHtml(job, index) {
    var d = draft(index);
    var link = 'ops.html#job/' + encodeURIComponent(job.job_id);
    return '<details class="wc-job" data-job="' + index + '"' + (open[index] ? ' open' : '') + '><summary><strong>Job ' + esc(job.job_number || 'number not known') +
      '</strong><span class="wc-muted">As at ' + esc(time(job.as_at)) + '</span><span>' + (job.read ? 'Read' : 'To read') + '</span></summary><div class="wc-job-body">' +
      '<a class="wc-job-link" href="' + esc(link) + '" target="_blank" rel="noopener">Open the job page</a>' +
      '<h3>The story</h3>' + (job.story_source === 'candidate' ? '<p class="wc-candidate">New story, not live yet</p>' : '') +
      job.story.map(function (line, i) { return lineHtml(line, 'story', index, i); }).join('') + (job.story.length ? '' : '<p>No story in this sample.</p>') +
      '<h3>The notes</h3>' + (job.notes_source === 'candidate' ? '<p class="wc-candidate">New notes, not live yet</p>' : '') +
      job.notes.map(function (line, i) { return lineHtml(line, 'note', index, i); }).join('') + (job.notes.length ? '' : '<p>No notes in this sample.</p>') +
      '<h3>Anything missing?</h3><div class="wc-missing">' + d.missing.map(function (line, i) { return '<div><label>Missing line ' + (i + 1) +
        '<input type="text" data-missing="' + i + '" maxlength="300" value="' + esc(line) + '"' + (busy ? ' disabled' : '') + '></label><button type="button" data-remove="' + i + '"' + (busy ? ' disabled' : '') + '>Remove</button></div>'; }).join('') +
      '</div><button type="button" data-add' + (d.missing.length >= 20 || busy ? ' disabled' : '') + '>Add a line</button>' +
      '<div class="wc-save"><button class="wc-primary" type="button" data-save' + (busy ? ' disabled' : '') + '>' + (d.ticks.length || d.missing.length ? 'Save this job' : 'All correct: save') +
      '</button><p role="status"' + (d.error ? ' class="wc-error"' : '') + '>' + esc(d.error || (d.saved ? 'Saved.' : '')) + '</p></div></div></details>';
  }
  function render() {
    if (!root) return;
    var html = '<div class="wc-toolbar"><h1>Weekly check' + (data && data.week ? ': ' + esc(count(data.this_week.drawn)) + ' jobs drawn at random' : '') +
      '</h1><button type="button" data-refresh' + (busy ? ' disabled' : '') + '>Refresh</button></div>';
    if (message) html += '<p role="status">' + esc(message) + '</p>';
    if (loadError) html += '<p class="wc-error" role="alert">Could not load. Try again.</p>';
    if (data && !data.week) html += '<p>This week\'s jobs have not been drawn yet. They are drawn on Monday morning.</p>';
    if (data && data.week) {
      var score = data.this_week, shares = data.close_shares;
      html += '<p class="wc-muted">Week of ' + esc(time(data.week, true)) + '. ' + esc(count(score.read)) + ' of ' + esc(count(score.drawn)) + ' read.</p>' +
        '<div class="wc-numbers"><p><strong>This week: ' + (score.complete ? esc(pct(score.score)) : 'Not finished') + '</strong>' +
        (score.complete && score.score != null ? (Number(score.score) >= 0.98 ? ' <svg aria-label="At least 98%" role="img" width="18" height="18" viewBox="0 0 20 20"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" stroke-width="2"/></svg>' : ' <span class="wc-error">Below 98%</span>') : '') +
        '</p><p>Stories with a miss: ' + esc(count(score.stories_with_miss)) + ' of ' + esc(count(score.read)) + '</p>' +
        '<p>Last 4 weeks: ' + (data.scores.filter(function (s) { return s.week < data.week; }).slice(0, 4).map(function (s) { return s.complete ? esc(pct(s.score)) : 'Not finished'; }).join(', ') || 'None read yet') + '</p></div>' +
        '<p>Open items this week: ' + (shares ? 'closed by a record ' + esc(pct(shares.share_record)) + ', on words ' + esc(pct(shares.share_words)) +
        ', by a person ' + esc(pct(shares.share_person)) + ', still open past 14 days ' + esc(pct(shares.share_open_past_14)) + ' (' + esc(count(shares.open_past_14_days)) + ')' : 'Not known') + '</p>' +
        '<p>Closes on words read this week: ' + (score.word_closes_read === 0 ? 'none read yet' : esc(count(score.word_closes_read)) + ', right ' + esc(pct(score.word_close_accuracy))) + '</p>' +
        '<div class="wc-jobs">' + data.jobs.map(jobHtml).join('') + '</div><h2>Misses this week</h2>' +
        ((score.misses || []).length ? '<ul class="wc-misses">' + score.misses.map(function (miss) {
          return '<li><strong>Job ' + esc(miss.job_number || 'number not known') + '</strong><p>' + esc(miss.text || (miss.target === 'missing' ? 'Missing line' : 'Line not available')) +
            '</p><p>' + esc(Object.keys(problems).find(function (label) { return problems[label] === miss.problem; }) || '') + (miss.problem ? ': ' : '') + esc(miss.why) + '</p></li>';
        }).join('') + '</ul>' : '<p>No misses recorded.</p>');
    }
    root.innerHTML = html;
  }
  function rememberOpen() { if (root) root.querySelectorAll('[data-job]').forEach(function (el) { open[el.dataset.job] = el.open; }); }
  async function refresh() {
    if (!root || !enabled() || busy) return;
    var generation = ++sequence;
    busy = true;
    message = 'Loading'; loadError = false; rememberOpen(); render();
    try {
      var result = await window.opsFetch('weekly_check_list');
      if (generation !== sequence || !enabled()) { busy = false; return; }
      if (!result || !Array.isArray(result.jobs) || !Array.isArray(result.scores) ||
          (result.week && (!result.this_week || !Array.isArray(result.this_week.misses) || result.jobs.some(function (job) { return !Array.isArray(job.story) || !Array.isArray(job.notes); })))) throw new Error('unreadable');
      data = result; drafts = {}; message = ''; reveal(true);
    } catch (error) {
      if (generation !== sequence) return;
      message = ''; loadError = true;
      if (error.status === 401 || error.status === 403) { data = null; drafts = {}; reveal(false); }
    }
    busy = false;
    render();
  }
  async function save(index) {
    if (busy || !enabled()) return;
    var d = draft(index), job = data.jobs[index], body;
    d.error = ''; d.saved = false;
    try { body = buildRead(Object.assign({ week: data.week }, job), d.ticks, d.missing); }
    catch (error) {
      d.error = { reason_needed: 'Add a reason for each ticked line.', reason_length: 'Each reason needs 3 to 300 characters.', missing_length: 'Each missing line needs 3 to 300 characters, at most 20 lines.', line_needed: 'That sentence or note is not on this job\'s list.' }[error.message] || 'Could not save. Try again.';
      rememberOpen(); render(); return;
    }
    busy = true; rememberOpen(); render();
    try {
      var result = await window.opsPost('weekly_check_record', body);
      if (!result || result.outcome !== 'recorded') throw new Error('not_recorded');
      busy = false;
      await refresh();
      if (data && data.week === body.week) {
        var savedIndex = data.jobs.findIndex(function (row) { return row.job_id === body.job_id; });
        if (savedIndex >= 0) draft(savedIndex).saved = true;
      }
    } catch (error) {
      d.error = error.status === 400 ? error.message : 'Could not save. Try again.';
      busy = false;
    }
    render();
  }
  function mount(el) {
    if (!el || !enabled()) return;
    if (root !== el) {
      root = el; root.classList.add('wc');
      root.addEventListener('click', function (event) {
        var button = event.target.closest('button');
        if (!button || busy) return;
        if (button.hasAttribute('data-refresh')) { refresh(); return; }
        var row = button.closest('[data-job]');
        if (!row) return;
        var index = Number(row.dataset.job), d = draft(index);
        rememberOpen();
        if (button.hasAttribute('data-save')) { save(index); return; }
        if (button.hasAttribute('data-add') && d.missing.length < 20) d.missing.push('');
        if (button.hasAttribute('data-remove')) d.missing.splice(Number(button.dataset.remove), 1);
        d.saved = false; render();
      });
      function edit(event) {
        if (busy) return;
        var row = event.target.closest('[data-job]');
        if (!row) return;
        var index = Number(row.dataset.job), d = draft(index), line = event.target.closest('[data-target]');
        d.saved = false; d.error = '';
        var status = row.querySelector('.wc-save [role=status]');
        if (status) { status.textContent = ''; status.className = ''; }
        if (event.target.hasAttribute('data-missing')) d.missing[Number(event.target.dataset.missing)] = event.target.value;
        if (line) {
          var tick = d.ticks.find(function (mark) { return mark.target === line.dataset.target && mark.ref === line.dataset.ref; });
          if (event.target.hasAttribute('data-wrong')) {
            if (event.target.checked && !tick) d.ticks.push({ target: line.dataset.target, ref: line.dataset.ref, problem: line.dataset.target === 'story' ? 'unsupported' : 'wrongly_open', why: '' });
            if (!event.target.checked) d.ticks = d.ticks.filter(function (mark) { return mark !== tick; });
            rememberOpen(); render();
          } else if (tick && event.target.hasAttribute('data-problem')) tick.problem = event.target.value;
          else if (tick && event.target.hasAttribute('data-why')) tick.why = event.target.value;
        }
        var saveButton = root.querySelector('[data-job="' + index + '"] [data-save]');
        var saveLabel = d.ticks.length || d.missing.length ? 'Save this job' : 'All correct: save';
        if (saveButton && saveButton.textContent !== saveLabel) saveButton.textContent = saveLabel;
      }
      root.addEventListener('change', edit);
      root.addEventListener('input', function (event) { if (!event.target.hasAttribute('data-wrong') && !event.target.hasAttribute('data-problem')) edit(event); });
      if (!document.getElementById('weekly-check-style')) {
        var style = document.createElement('style'); style.id = 'weekly-check-style';
        style.textContent = '.wc{max-width:1080px;margin:0 auto;padding:28px 20px 100px;color:var(--sw-text,#26353e);font:14px/1.55 var(--sw-font,Arial,sans-serif)}.wc *{box-sizing:border-box}.wc h1{font-size:24px;line-height:1.3;margin:0;text-wrap:balance}.wc h2{font-size:20px;margin:32px 0 12px}.wc h3{font-size:16px;margin:28px 0 8px}.wc p{margin:8px 0}.wc-toolbar,.wc-numbers,.wc-job summary,.wc-line-top{display:flex;align-items:center;gap:16px}.wc-toolbar{justify-content:space-between;margin-bottom:10px}.wc-numbers{flex-wrap:wrap;gap:8px 28px;font-variant-numeric:tabular-nums;padding:12px 0}.wc-numbers p{display:flex;align-items:center;gap:6px}.wc-muted{color:#52616d;font-size:13px}.wc-error{color:#a02f2f}.wc-candidate{color:#345b76;font-weight:600}.wc-jobs{margin-top:24px;border-top:1px solid #cbd2d7}.wc-job{border-bottom:1px solid #cbd2d7;background:#fff}.wc-job summary{cursor:pointer;padding:18px 16px;flex-wrap:wrap}.wc-job summary strong{margin-right:auto}.wc-job summary::before{content:"+";font-size:18px}.wc-job[open] summary::before{content:"−"}.wc-job-body{padding:0 20px 20px}.wc-job-link{display:inline-block;margin-top:8px;color:#345b76;text-underline-offset:3px}.wc-line{padding:14px 0;border-bottom:1px solid #e1e6e9}.wc-line-top{align-items:flex-start}.wc-line-top>div{flex:1;min-width:0;max-width:75ch;overflow-wrap:anywhere}.wc-wrong{display:flex;align-items:center;gap:8px;margin-left:auto;flex-shrink:0;cursor:pointer;min-height:44px}.wc input[type=checkbox]{width:22px;height:22px;accent-color:#345b76}.wc-reason{display:grid;grid-template-columns:minmax(190px,1fr) 2fr;gap:12px;margin-top:12px}.wc label{font-weight:500}.wc-reason label,.wc-missing label{display:grid;gap:4px}.wc input[type=text],.wc select{font:inherit;width:100%;padding:10px;border:1px solid #97a6b0;border-radius:4px;background:#fff;color:inherit}.wc button{font:inherit;min-height:44px;padding:9px 14px;border:1px solid #97a6b0;border-radius:4px;color:inherit;background:#fff;cursor:pointer}.wc button:hover{background:#edf2f5}.wc button:disabled{opacity:.6;cursor:default}.wc button.wc-primary{background:#345b76;border-color:#345b76;color:#fff}.wc button.wc-primary:hover{background:#29485e}.wc :focus-visible{outline:2px solid #345b76;outline-offset:3px}.wc ::selection{background:#c9dfed;color:#203947}.wc input{caret-color:#345b76}.wc-missing>div{display:flex;align-items:flex-end;gap:12px;margin-bottom:12px}.wc-missing label{flex:1;min-width:0}.wc-save{margin-top:24px}.wc-misses{padding:0;list-style:none}.wc-misses li{padding:16px 0;border-top:1px solid #cbd2d7;overflow-wrap:anywhere}@media(max-width:600px){.wc{padding:20px 12px 110px}.wc h1{font-size:21px}.wc-toolbar{align-items:flex-start}.wc-numbers{display:block}.wc-job summary{gap:6px 12px;padding:14px 10px}.wc-job summary .wc-muted{order:3;width:100%;padding-left:24px}.wc-job-body{padding:0 12px 18px}.wc-reason{grid-template-columns:1fr}.wc-wrong{gap:6px}.wc-line-top{gap:12px}}';
        document.head.appendChild(style);
      }
    }
    return refresh();
  }
  window.WeeklyCheck = { mount: mount, refresh: refresh };
  }
  if (typeof module !== 'undefined') module.exports = { buildRead: buildRead };
})();
