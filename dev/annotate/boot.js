// The agentation note toolbar for ops.html (dev/annotate/README.md). Dev only:
// ops.html loads this file only on localhost or 127.0.0.1 with ?annotate in the
// address (search `<ops-annotate-gate>`); staff on the live site never fetch it.
//
// A note carries the text of what was clicked and the agentation server keeps
// notes on disk, so while this runs the page shows sample data only:
//  1. a Content-Security-Policy lets the page connect to itself and the
//     agentation server on this Mac (port 4747), nowhere else;
//  2. Supabase is replaced by an in-memory stand-in with a made-up session, so
//     there is no real sign-in and no real token to read anything with;
//  3. fetch answers ops-api reads from dev/annotate/sample-data.js, refuses every
//     write, and refuses any other host.
// Loaded synchronously from the <head> of ops.html, before Supabase and cloud.js.
(function () {
  'use strict';

  var ENDPOINT = 'http://localhost:4747';
  var AGENT_ORIGINS = ['http://localhost:4747', 'http://127.0.0.1:4747'];
  var here = document.currentScript && document.currentScript.src;
  var base = here ? here.replace(/boot\.js(\?.*)?$/, '') : 'dev/annotate/';
  window.__SW_ANNOTATE = { on: true, toolbar: 'starting' };

  // 1. Network wall.
  var csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "connect-src 'self' " + AGENT_ORIGINS.join(' ');
  document.head.appendChild(csp);

  // 2. Supabase stand-in (the same shape tests/helpers/ops-auth.js gives the suite).
  var user = {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'sample-ops@example.test',
    aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
  };
  var session = {
    access_token: 'annotate-sample-token', refresh_token: 'annotate-sample-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 24 * 3600, user: user,
  };
  var listeners = [];
  var auth = {
    getSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
    getUser: function () { return Promise.resolve({ data: { user: session && session.user }, error: null }); },
    refreshSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
    signInWithPassword: function () { return Promise.resolve({ data: { user: user, session: session }, error: null }); },
    signInWithOtp: function () { return Promise.resolve({ data: {}, error: null }); },
    signOut: function () {
      session = null;
      listeners.forEach(function (l) { l('SIGNED_OUT', null); });
      return Promise.resolve({ error: null });
    },
    onAuthStateChange: function (l) {
      listeners.push(l);
      setTimeout(function () { l('INITIAL_SESSION', session); }, 0);
      return { data: { subscription: { unsubscribe: function () {} } } };
    },
  };
  var query = {};
  ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'or', 'not', 'match', 'order', 'limit', 'range']
    .forEach(function (m) { query[m] = function () { return query; }; });
  query.single = query.maybeSingle = function () { return Promise.resolve({ data: null, error: null }); };
  query.then = function (ok, bad) { return Promise.resolve({ data: [], error: null }).then(ok, bad); };
  var stand = {
    createClient: function () {
      return {
        auth: auth,
        from: function () { return query; },
        rpc: function () { return Promise.resolve({ data: null, error: null }); },
        channel: function () { return { on: function () { return this; }, subscribe: function () { return this; }, unsubscribe: function () {} }; },
        removeChannel: function () {},
        storage: { from: function () { return { createSignedUrl: function () { return Promise.resolve({ data: null, error: { message: 'Sample data only' } }); } }; } },
        functions: { invoke: function () { return Promise.resolve({ data: null, error: { message: 'Sample data only' } }); } },
      };
    },
  };
  // The real library still loads from its CDN and assigns window.supabase; the
  // setter drops that so every createClient call gets the stand-in.
  Object.defineProperty(window, 'supabase', { configurable: true, get: function () { return stand; }, set: function () {} });

  // 3. fetch: sample reads, no writes, no other hosts.
  var realFetch = window.fetch.bind(window);
  function answer(status, body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }));
  }
  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : (input && input.url) || String(input), location.href); }
    catch (e) { return Promise.reject(e); }
    if (url.origin === location.origin || AGENT_ORIGINS.indexOf(url.origin) !== -1) return realFetch(input, init);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (/\.supabase\.co$/.test(url.hostname)) {
      var action = url.searchParams.get('action') || '';
      if (/\/functions\/v1\/ghl-proxy$/.test(url.pathname) && action === 'get_profile') {
        return answer(200, { profile: { id: user.id, email: user.email, name: 'Sample Ops', role: 'admin', org_id: '00000000-0000-0000-0000-000000000001' } });
      }
      if (method !== 'GET') return answer(403, { error: 'Sample data only while notes are on: nothing is saved or sent.' });
      var reads = (window.__SW_ANNOTATE_SAMPLE && window.__SW_ANNOTATE_SAMPLE.reads) || {};
      if (/\/functions\/v1\/ops-api$/.test(url.pathname) && reads[action]) {
        var params = {};
        url.searchParams.forEach(function (v, k) { params[k] = v; });
        return answer(200, reads[action](params));
      }
      return answer(200, {});
    }
    return Promise.reject(new TypeError('Sample data only while notes are on: ' + url.host + ' is not reached.'));
  };

  // Load the sample before ops.html's own scripts run.
  document.write('<script src="' + base + 'sample-data.js"><\/script>');

  // Real data left in this browser by an earlier real sign-in on the same address
  // could still be read from storage, so the toolbar refuses to start there.
  function storedRealData() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        if (/^sb-.*-auth-token$/.test(k) || k.indexOf('sw_job_') === 0 || k === 'sw_offline_queue') return k;
      }
    } catch (e) { return 'unreadable storage'; }
    return null;
  }

  function banner(text) {
    var b = document.createElement('div');
    b.id = 'swAnnotateBanner';
    b.setAttribute('data-feedback-toolbar', '');
    b.style.cssText = 'position:fixed;left:12px;bottom:60px;z-index:99998;max-width:420px;padding:8px 12px;border-radius:8px;background:#293C46;color:#fff;font:12px/1.4 Helvetica,Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);';
    b.textContent = text;
    document.body.appendChild(b);
  }

  function script(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function start() {
    var held = storedRealData();
    if (held) {
      window.__SW_ANNOTATE.toolbar = 'refused';
      banner('Notes are off: this address holds data from a real sign-in (' + held + '). Open ops.html?annotate on a port you have never signed in on.');
      return;
    }
    banner('Sample data only. Notes go to the coding agent; nothing is saved or sent.');
    // The toolbar reads process.env.NODE_ENV.
    window.process = window.process || { env: { NODE_ENV: 'production' } };
    // Its default corner sits under the Jarvis bar (48px, top of the stack), so
    // the first open places it just above; a drag after that is kept.
    try {
      if (!localStorage.getItem('feedback-toolbar-position')) {
        localStorage.setItem('feedback-toolbar-position', JSON.stringify({ x: window.innerWidth - 357, y: window.innerHeight - 120 }));
      }
    } catch (e) { /* storage blocked: the toolbar uses its own corner */ }
    script(base + 'vendor/react.production.min.js')
      .then(function () { return script(base + 'vendor/react-dom.production.min.js'); })
      .then(function () { return import(base + 'vendor/agentation.js'); })
      .then(function (mod) {
        var box = document.createElement('div');
        box.id = 'swAgentation';
        document.body.appendChild(box);
        window.ReactDOM.createRoot(box).render(window.React.createElement(mod.Agentation, {
          endpoint: ENDPOINT, appName: 'SecureSuite Ops', useHashLocation: true,
        }));
        window.__SW_ANNOTATE.toolbar = 'on';
      })
      .catch(function (e) {
        window.__SW_ANNOTATE.toolbar = 'failed';
        console.warn('[annotate] toolbar did not load', e);
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
