// Add job photos: one small page for putting site photos on a job from a phone,
// without opening the Trade app (job-photos.html?jobId=<job uuid>).
//
// It is the Trade app's own photo upload and nothing else: the same sign-in,
// the same three ops-api calls (get_upload_url, a PUT to storage,
// confirm_upload) and the same picture size, so a photo added here is the same
// photo the Trade app would have added, on the same attendance. It reads
// trade_job_detail once to name the job and count the photos already on this
// visit. It files no report and sends nothing. The report needs 5 photos.
(function (root) {
  'use strict';

  // <job-photos-core>
  var Core = {};
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  Core.REPORT_MIN_PHOTOS = 5;
  Core.MAX_DIMENSION = 1600;
  Core.JPEG_QUALITY = 0.7;
  Core.SKIP_COMPRESS_BELOW_BYTES = 500 * 1024;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  // The job this link is for. Only a job UUID is accepted: the page never
  // searches for a job by words, so a wrong link cannot land photos elsewhere.
  Core.jobIdFromSearch = function (search) {
    var match = /[?&]jobId=([^&#]*)/.exec(String(search || ''));
    var raw = match ? decodeURIComponent(match[1]) : '';
    return UUID.test(raw) ? raw.toLowerCase() : '';
  };

  Core.jobTitle = function (detail) {
    var job = (detail && detail.job) || {};
    var place = [text(job.site_address), text(job.site_suburb)].filter(Boolean);
    // An address that already ends in its suburb is not said twice.
    if (place.length === 2 && place[0].toLowerCase().slice(-place[1].length) === place[1].toLowerCase()) place.pop();
    return [text(job.job_number), place.join(', ')].filter(Boolean).join(' · ');
  };

  // Photos already on this visit, counted as the Trade app's report screen
  // counts them: photos only, and on a job with an attendance cycle only those
  // bound to the current one.
  Core.visitPhotoCount = function (detail) {
    var media = (detail && Array.isArray(detail.media)) ? detail.media : [];
    var cycle = text(detail && detail.makesafe_details && String(detail.makesafe_details.attendance_cycle_id || ''));
    return media.filter(function (m) {
      if (!m || (m.type && m.type !== 'photo')) return false;
      if (m.phase === 'receipt') return false;
      if (!cycle) return true;
      return String(m.attendance_cycle_id || '') === cycle && String(m.cycle_attribution || '') === 'bound';
    }).length;
  };

  Core.countLine = function (count) {
    var n = Number(count) || 0;
    var have = n + ' photo' + (n === 1 ? '' : 's') + ' on this visit.';
    if (n >= Core.REPORT_MIN_PHOTOS) return have + ' Enough for the report.';
    var more = Core.REPORT_MIN_PHOTOS - n;
    return have + ' The report needs ' + Core.REPORT_MIN_PHOTOS + ': ' + more + ' more.';
  };

  // What to say when a batch finishes. A failed photo is never hidden behind
  // the ones that made it.
  Core.outcomeLine = function (uploaded, failed) {
    var up = Number(uploaded) || 0;
    var lost = Number(failed) || 0;
    if (!up && !lost) return '';
    if (!lost) return up + ' photo' + (up === 1 ? '' : 's') + ' added.';
    if (!up) return 'None of the ' + lost + ' photo' + (lost === 1 ? '' : 's') + ' went up. Check your signal and try again.';
    return up + ' added, ' + lost + ' did not go up. Pick the missing one' + (lost === 1 ? '' : 's') + ' again.';
  };

  // The size a picture is drawn at before upload: the Trade app's rule, longest side 1600.
  Core.scaledSize = function (width, height) {
    var w = Number(width) || 0;
    var h = Number(height) || 0;
    var max = Core.MAX_DIMENSION;
    if (w <= max && h <= max) return { width: w, height: h };
    if (w > h) return { width: max, height: Math.round(h * max / w) };
    return { width: Math.round(w * max / h), height: max };
  };

  // Words for a failed read or upload. A refusal says what the server said.
  Core.errorLine = function (err) {
    var status = err && err.status;
    var message = text(err && err.message);
    if (status === 401) return 'Your sign-in has run out. Sign in again.';
    if (status === 403) return message || 'You are not on this job, so photos cannot be added to it from here.';
    if (status === 404) return 'That job could not be found.';
    return message || 'Something went wrong. Check your signal and try again.';
  };
  // </job-photos-core>

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Core;
    return;
  }

  var doc = root.document;
  var sb = null;
  var jobId = '';
  var visitCount = 0;
  var busy = false;

  function el(id) { return doc.getElementById(id); }
  function show(id, on) { var n = el(id); if (n) n.style.display = on ? '' : 'none'; }
  function say(id, message) { var n = el(id); if (n) n.textContent = message || ''; }

  function token() {
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      return session && session.access_token ? session.access_token : null;
    });
  }

  function api(action, params, body) {
    return token().then(function (accessToken) {
      if (!accessToken) { var gone = new Error('Sign in required'); gone.status = 401; throw gone; }
      var url = root.SUPABASE_URL + '/functions/v1/ops-api?action=' + encodeURIComponent(action);
      Object.keys(params || {}).forEach(function (k) {
        if (params[k] != null) url += '&' + k + '=' + encodeURIComponent(params[k]);
      });
      var opts = { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken } };
      if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
      return fetch(url, opts).then(function (r) {
        return r.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
          if (!r.ok) {
            var failure = new Error((data && (data.error || data.message)) || '');
            failure.status = r.status;
            throw failure;
          }
          return data || {};
        });
      });
    });
  }

  function compress(file) {
    return new Promise(function (resolve) {
      if (file.size < Core.SKIP_COMPRESS_BELOW_BYTES) { resolve(file); return; }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var size = Core.scaledSize(img.width, img.height);
        var canvas = doc.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
        canvas.toBlob(function (blob) {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], String(file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', Core.JPEG_QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  function uploadOne(file, label) {
    var ready;
    return compress(file).then(function (f) {
      ready = f;
      return api('get_upload_url', null, { jobId: jobId, fileName: ready.name || 'photo.jpg', contentType: ready.type || 'image/jpeg' });
    }).then(function (target) {
      return fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': ready.type || 'image/jpeg', Authorization: 'Bearer ' + target.token },
        body: ready
      }).then(function (r) {
        if (!r.ok) throw new Error('The photo did not reach storage (status ' + r.status + ').');
        return target;
      });
    }).then(function (target) {
      return api('confirm_upload', null, { jobId: jobId, publicUrl: target.publicUrl, path: target.path, label: label || '', phase: 'completion' });
    });
  }

  function thumb(file) {
    var wrap = doc.createElement('div');
    wrap.className = 'jp-thumb';
    var img = doc.createElement('img');
    img.alt = '';
    try { img.src = URL.createObjectURL(file); } catch (e) { /* no preview */ }
    var badge = doc.createElement('span');
    badge.className = 'jp-badge';
    badge.textContent = '...';
    wrap.appendChild(img);
    wrap.appendChild(badge);
    el('jpGrid').appendChild(wrap);
    return { wrap: wrap, badge: badge };
  }

  function paintCount() {
    say('jpCount', Core.countLine(visitCount));
    var line = el('jpCount');
    if (line) line.className = 'jp-count' + (visitCount >= Core.REPORT_MIN_PHOTOS ? ' ok' : '');
  }

  function addFiles(files) {
    if (busy || !files.length) return;
    busy = true;
    el('jpPick').disabled = true;
    var label = text(el('jpLabel').value).slice(0, 160);
    var uploaded = 0;
    var failed = 0;
    var firstError = null;
    var tiles = files.map(thumb);
    say('jpOutcome', '');
    var i = 0;
    function next() {
      if (i >= files.length) return Promise.resolve();
      var index = i++;
      say('jpProgress', 'Adding photo ' + (index + 1) + ' of ' + files.length + '...');
      return uploadOne(files[index], label).then(function () {
        uploaded += 1;
        visitCount += 1;
        tiles[index].wrap.className = 'jp-thumb done';
        tiles[index].badge.textContent = '✓';
        paintCount();
      }, function (err) {
        failed += 1;
        if (!firstError) firstError = err;
        tiles[index].wrap.className = 'jp-thumb failed';
        tiles[index].badge.textContent = '✗';
        // A sign-in that has run out fails every photo after it the same way.
        if (err && err.status === 401) i = files.length;
      }).then(next);
    }
    next().then(function () {
      busy = false;
      el('jpPick').disabled = false;
      el('jpInput').value = '';
      say('jpProgress', '');
      var line = Core.outcomeLine(uploaded, failed + (files.length - uploaded - failed));
      if (failed && firstError) line += ' ' + Core.errorLine(firstError);
      say('jpOutcome', line);
      el('jpOutcome').className = 'jp-outcome' + (failed ? ' bad' : ' good');
    });
  }

  function loadJob() {
    show('jpSignIn', false);
    show('jpMain', true);
    say('jpJob', 'Loading the job...');
    api('trade_job_detail', { jobId: jobId }).then(function (detail) {
      say('jpJob', Core.jobTitle(detail) || 'Job');
      visitCount = Core.visitPhotoCount(detail);
      paintCount();
      show('jpUpload', true);
    }).catch(function (err) {
      if (err && err.status === 401) { showSignIn(''); return; }
      say('jpJob', Core.errorLine(err));
      show('jpUpload', false);
    });
  }

  function showSignIn(message) {
    show('jpMain', false);
    show('jpSignIn', true);
    say('jpSignInError', message);
  }

  function signIn(ev) {
    ev.preventDefault();
    var email = text(el('jpEmail').value);
    var password = el('jpPassword').value;
    if (!email || !password) { say('jpSignInError', 'Enter your email and password.'); return; }
    el('jpSignInButton').disabled = true;
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      el('jpSignInButton').disabled = false;
      if (res && res.error) { say('jpSignInError', res.error.message || 'That sign-in did not work.'); return; }
      loadJob();
    }).catch(function () {
      el('jpSignInButton').disabled = false;
      say('jpSignInError', 'That sign-in did not work. Check your signal and try again.');
    });
  }

  function start() {
    jobId = Core.jobIdFromSearch(root.location.search);
    if (!jobId) {
      show('jpSignIn', false);
      show('jpMain', true);
      show('jpUpload', false);
      say('jpJob', 'This link does not name a job. Ask for a new photo link.');
      return;
    }
    if (!root.supabase || !root.supabase.createClient) {
      show('jpMain', true);
      say('jpJob', 'This page could not start. Check your signal and reload.');
      return;
    }
    // The same client settings as the Trade app, so its sign-in is used as it stands.
    sb = root.supabase.createClient(root.SUPABASE_URL, root.SUPABASE_ANON_KEY);
    el('jpSignInForm').addEventListener('submit', signIn);
    el('jpPick').addEventListener('click', function () { el('jpInput').click(); });
    el('jpInput').addEventListener('change', function () { addFiles(Array.prototype.slice.call(el('jpInput').files || [])); });
    token().then(function (accessToken) {
      if (accessToken) loadJob(); else showSignIn('');
    }).catch(function () { showSignIn(''); });
  }

  root.JobPhotosCore = Core;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
