// The Ops five-minute board refresh must not repaint the MakeSafe pipeline while
// the full-page job detail owns the screen. This extracts and EXECUTES the REAL
// shipped ops.html callbacks (the auto-refresh timer, the auth-state handler, the
// ai_alerts realtime handler, the comms poll, loadJobs() and every late MakeSafe
// enricher) in a VM harness, asserting the calls/effects each one actually makes
// so the guard cannot drift away from ops.html.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');

function extractFunction(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('function not found: ' + signature);
  const open = src.indexOf('{', start + signature.length);
  if (open < 0) throw new Error('function body not found: ' + signature);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced function body: ' + signature);
}

function sliceBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('source markers not found');
  return src.slice(start, end);
}

// Run a real shipped source snippet inside a fresh sandbox and hand back the
// sandbox so the test can invoke whatever callback the snippet registered.
function runSnippet(source, context) {
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ok  ' + name);
}

// A set of navigation/render sentinels shared by the handler checks: none of the
// background handlers may reach the board or tear down an open detail, so any
// call to these is a failure. Counting (not string-matching) proves it.
function navSentinels(hits) {
  return {
    showView() { hits.nav += 1; },
    loadJobs() { hits.nav += 1; },
    renderJobs() { hits.nav += 1; },
    closeJobDetail() { hits.nav += 1; },
  };
}

// ── Diagnosis, executed: of the reported candidates only the five-minute timer
// routes the jobs tab to the board loader. Auth caches the operator email,
// realtime updates Jarvis/toasts, and the comms interval refreshes only the open
// conversation thread. Each is proven by running the real callback. ────────────

check('the five-minute jobs timer calls the background board loader', () => {
  const timerSrc = sliceBetween(
    ops,
    '// Auto-refresh active tab data every 5 minutes',
    'function clearChat()',
  );
  const loaders = { today: 0, calendar: 0, financials: 0, materials: 0, inbox: 0 };
  const loadJobsArgs = [];
  let currentView = 'jobs';
  const captured = {};
  runSnippet(timerSrc, {
    console,
    setInterval: (fn) => { captured.tick = fn; },
    _opsAppStarted: true,
    _jarvisLastUpdate: 0,
    localStorage: { getItem: (k) => (k === 'sw_ops_tab' ? currentView : null) },
    loadToday() { loaders.today += 1; },
    loadCalendar() { loaders.calendar += 1; },
    loadJobs(opts) { loadJobsArgs.push(opts); },
    loadFinancials() { loaders.financials += 1; },
    loadMaterials() { loaders.materials += 1; },
    loadInbox() { loaders.inbox += 1; },
  });
  assert.equal(typeof captured.tick, 'function', 'timer callback was registered');

  currentView = 'jobs';
  captured.tick();
  assert.equal(loadJobsArgs.length, 1, 'jobs tab drove exactly one board load');
  assert.equal(loadJobsArgs[0] && loadJobsArgs[0].background, true, 'the jobs load is marked background');
  assert.deepEqual(Object.keys(loadJobsArgs[0]), ['background'], 'the jobs load carries only the background flag');
  assert.equal(loaders.today + loaders.calendar + loaders.financials + loaders.materials + loaders.inbox, 0);

  currentView = 'today';
  captured.tick();
  assert.equal(loaders.today, 1, 'today tab drove loadToday, not the board');
  assert.equal(loadJobsArgs.length, 1, 'the today tick did not touch the board loader');
});

check('the page auth-state handler caches the email and never navigates', () => {
  const authSrc = sliceBetween(
    ops,
    '\n    if (cloud && cloud.supabase && cloud.supabase.auth) {',
    "} catch (e) { console.log('[ops] operator email cache failed:",
  );
  const hits = { nav: 0 };
  let rerenders = 0;
  const captured = {};
  const ctx = runSnippet(authSrc, {
    console,
    cloud: { supabase: { auth: {
      getUser: () => ({
        then: (cb) => { cb({ data: { user: { email: 'getuser@ops' } } }); return { catch() {} }; },
      }),
      onAuthStateChange: (fn) => { captured.auth = fn; },
    } } },
    _opsUserEmail: 'seed@ops',
    rerenderJobDetailOverviewIfMakesafe() { rerenders += 1; },
    ...navSentinels(hits),
  });
  // The getUser() resolution ran during the snippet: email cached, detail re-render offered.
  assert.equal(ctx._opsUserEmail, 'getuser@ops');
  assert.equal(rerenders, 1);
  assert.equal(typeof captured.auth, 'function', 'auth-state callback was registered');

  captured.auth('SIGNED_IN', { user: { email: 'auth@ops' } });
  assert.equal(ctx._opsUserEmail, 'auth@ops', 'the auth handler only updates the cached email');
  captured.auth('SIGNED_OUT', null);
  assert.equal(ctx._opsUserEmail, 'auth@ops', 'a null session keeps the prior email, does not clear it');
  assert.equal(hits.nav, 0, 'the auth handler never navigated or repainted');
});

check('the ai_alerts realtime handler only nudges Jarvis and toasts', () => {
  const alertSrc = sliceBetween(
    ops,
    'var _supabase = (cloud && cloud.supabase)',
    "} catch (e) {\n    console.log('[ops] Realtime subscription failed:",
  );
  const hits = { nav: 0 };
  let jarvis = 0;
  let pulses = 0;
  const toasts = [];
  const captured = {};
  runSnippet(alertSrc, {
    console,
    cloud: { supabase: { channel: () => ({
      on: (_evt, _opts, fn) => { captured.alert = fn; return { subscribe() { captured.subscribed = true; } }; },
    }) } },
    document: { getElementById: (id) => (id === 'jarvisIcon' ? { classList: { add() { pulses += 1; } } } : null) },
    updateJarvisSummary() { jarvis += 1; },
    showToast(msg, level) { toasts.push({ msg, level }); },
    ...navSentinels(hits),
  });
  assert.equal(captured.subscribed, true, 'the alerts channel was subscribed');
  assert.equal(typeof captured.alert, 'function', 'the alerts INSERT callback was registered');

  captured.alert({ new: { severity: 'red', title: 'Roof collapse' } });
  assert.equal(jarvis, 1);
  assert.equal(pulses, 1);
  assert.deepEqual(toasts[0], { msg: 'Critical alert: Roof collapse', level: 'error' });

  captured.alert({ new: { severity: 'amber' } });
  assert.equal(jarvis, 2);
  assert.deepEqual(toasts[1], { msg: 'New alert detected', level: 'info' });
  assert.equal(hits.nav, 0, 'the alert handler never navigated or repainted the board');
});

check('the comms poll refreshes only the conversation', () => {
  const pollSrc = extractFunction(ops, 'function startCommsPoll(contactId)');
  const hits = { nav: 0 };
  const conversationLoads = [];
  const captured = {};
  const ctx = runSnippet(pollSrc + '\nthis.startCommsPoll = startCommsPoll;', {
    console,
    setInterval: (fn) => { captured.poll = fn; return 1; },
    _commsPollContactId: null,
    stopCommsPoll() { captured.stopped = true; },
    loadConversation(id, silent) { conversationLoads.push({ id, silent }); },
    ...navSentinels(hits),
  });
  ctx.startCommsPoll('contact-9');
  assert.equal(captured.stopped, true, 'startCommsPoll reset any prior poll');
  assert.equal(typeof captured.poll, 'function', 'the poll interval callback was registered');

  captured.poll();
  assert.deepEqual(conversationLoads, [{ id: 'contact-9', silent: true }]);
  assert.equal(hits.nav, 0, 'the comms poll never navigated or repainted the board');
});

// ── Every late MakeSafe enricher is gated by the real makesafeBoardCanRepaint():
// with a detail open it must NOT repaint; with the board owned and no detail it
// must. Each enricher is executed for real against both states. ────────────────

const enricherSource = [
  extractFunction(ops, 'function jobDetailIsOpen()'),
  extractFunction(ops, 'function makesafeBoardCanRepaint()'),
  extractFunction(ops, 'async function loadMakesafeBoardReviewAffordances()'),
  extractFunction(ops, 'async function loadMakesafeBoardPackChips()'),
  extractFunction(ops, 'async function loadMakesafeBoardIntakeDrafts()'),
  extractFunction(ops, 'async function loadMakesafeBoardStory()'),
  'this.__enrichers = {',
  '  loadMakesafeBoardReviewAffordances,',
  '  loadMakesafeBoardPackChips,',
  '  loadMakesafeBoardIntakeDrafts,',
  '  loadMakesafeBoardStory,',
  '};',
].join('\n');

async function runEnricher(name, detailActive) {
  const calls = { render: 0 };
  const detail = { classList: { contains: (n) => n === 'active' && detailActive } };
  const ctx = runSnippet(enricherSource, {
    console,
    document: { getElementById: (id) => (id === 'jobDetailView' ? detail : null) },
    _pipelineTab: 'makesafes',
    _jobView: 'kanban',
    _pipelineData: { columns: { report_ready: [{ id: 'j1', report_pack: { docket_revision_id: 'd1' } }] } },
    renderJobs() { calls.render += 1; },
    opsFetch: async (action) => {
      if (action === 'list_intake_drafts') return { drafts: [{ id: 'd1', status: 'draft', created_at: '2026-01-01' }] };
      if (action === 'makesafe_audit') return { jobs: [], story: { verdict_counts: {}, total: 0 } };
      if (action === 'get_ses_reviewable_pack') return { ok: true };
      return {};
    },
    // review-affordance enricher deps
    _msSesReviewQueue: {},
    _msSesRefreshReviewQueue: async () => {},
    _msSesReviewQueueStale: () => true,
    // pack-chip enricher deps (arranged so a chip is minted → a repaint is wanted)
    makesafeHasDraftedPack: () => true,
    makesafeChipFactsFromSesPack: () => ({ ok: true }),
    _makesafePackChipById: {},
    _makesafeCanonicalPackMetaById: {},
    // intake-draft enricher deps
    _makesafeIntakeDrafts: [],
    _makesafeIntakeDraftsLoaded: false,
    _msCockpitDraftCache: {},
  });
  await ctx.__enrichers[name]();
  return calls.render;
}

const enricherNames = [
  'loadMakesafeBoardReviewAffordances',
  'loadMakesafeBoardPackChips',
  'loadMakesafeBoardIntakeDrafts',
  'loadMakesafeBoardStory',
];

// ── The existing loadJobs() behavioral regression (unchanged): the guard fires on
// the early return, the post-fetch in-flight re-check, and the enricher fan-out.

const source = [
  extractFunction(ops, 'function jobDetailIsOpen()'),
  extractFunction(ops, 'function makesafeReviewOverlayIsOpen()'),
  extractFunction(ops, 'function makesafeBoardCanRepaint()'),
  extractFunction(ops, 'async function loadJobs(opts)'),
  'this.runLoadJobs = loadJobs;',
].join('\n');

async function runLoad({ detailActive, background }) {
  const calls = { fetch: 0, render: 0, intake: 0, story: 0, reviews: 0, chips: 0 };
  const detail = {
    classList: { contains: (name) => name === 'active' && detailActive },
  };
  const context = {
    console,
    document: {
      getElementById(id) {
        if (id === 'jobDetailView') return detail;
        return null;
      },
    },
    _pipelineTab: 'makesafes',
    _jobView: 'kanban',
    _pipelineData: null,
    updateJobsDate() {},
    fetchMakesafeBoardData: async () => {
      calls.fetch += 1;
      return { _canonical: {}, columns: {} };
    },
    renderJobs() { calls.render += 1; },
    loadMakesafeBoardIntakeDrafts() { calls.intake += 1; },
    loadMakesafeBoardStory() { calls.story += 1; },
    loadMakesafeBoardReviewAffordances() { calls.reviews += 1; },
    loadMakesafeBoardPackChips() { calls.chips += 1; },
    failMakesafeArchiveLoadIfPending() {},
    showToast() {},
    opsFetch() { throw new Error('unexpected non-MakeSafe fetch'); },
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await context.runLoadJobs({ background });
  return calls;
}

async function runInFlightLoad() {
  let detailActive = false;
  let finishFetch;
  const calls = { fetch: 0, render: 0 };
  const detail = {
    classList: { contains: (name) => name === 'active' && detailActive },
  };
  const pendingBoard = new Promise((resolve) => { finishFetch = resolve; });
  const context = {
    console,
    document: {
      getElementById(id) {
        if (id === 'jobDetailView') return detail;
        return null;
      },
    },
    _pipelineTab: 'makesafes',
    _jobView: 'kanban',
    _pipelineData: null,
    updateJobsDate() {},
    fetchMakesafeBoardData: () => { calls.fetch += 1; return pendingBoard; },
    renderJobs() { calls.render += 1; },
    loadMakesafeBoardIntakeDrafts() {},
    loadMakesafeBoardStory() {},
    loadMakesafeBoardReviewAffordances() {},
    loadMakesafeBoardPackChips() {},
    failMakesafeArchiveLoadIfPending() {},
    showToast() {},
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const load = context.runLoadJobs({ background: true });
  detailActive = true;
  finishFetch({ _canonical: {}, columns: {} });
  await load;
  return calls;
}

Promise.all([
  ...enricherNames.map((name) => Promise.all([
    runEnricher(name, true),
    runEnricher(name, false),
  ]).then(([openRender, closedRender]) => {
    check(name + ' does not repaint under an open detail but does when the board is open', () => {
      assert.equal(openRender, 0, name + ' repainted underneath an open job detail');
      assert.ok(closedRender >= 1, name + ' failed to repaint the open make-safe board');
    });
  })),
  runLoad({ detailActive: true, background: true }).then((calls) => {
    check('a periodic refresh does not repaint underneath an open job detail', () => {
      assert.deepEqual(calls, { fetch: 0, render: 0, intake: 0, story: 0, reviews: 0, chips: 0 });
    });
  }),
  runLoad({ detailActive: false, background: true }).then((calls) => {
    check('the periodic board refresh still runs when no job detail is open', () => {
      assert.equal(calls.fetch, 1);
      assert.equal(calls.render, 1);
      assert.equal(calls.intake, 1);
      assert.equal(calls.story, 1);
      assert.equal(calls.reviews, 1);
      assert.equal(calls.chips, 1);
    });
  }),
  runLoad({ detailActive: true, background: false }).then((calls) => {
    check('an explicit board load is not suppressed by the background-only guard', () => {
      assert.equal(calls.fetch, 1);
      assert.equal(calls.render, 1);
    });
  }),
  runInFlightLoad().then((calls) => {
    check('a background response cannot repaint after a detail opens in flight', () => {
      assert.equal(calls.fetch, 1);
      assert.equal(calls.render, 0);
    });
  }),
]).then(
  () => console.log('\nOps job-detail auto-refresh guard: ' + passed + ' passed, 0 failed.'),
  (error) => {
    console.error('\nFAILED:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  },
);
