// A slow board read must never be joined by more reads from the same browser.
// This extracts and EXECUTES the REAL shipped ops.html loadJobs(),
// retryLoadJobs() and the five-minute auto-refresh timer in a VM harness, so the
// no-stack guard cannot drift away from ops.html.
//
// Incident 2026-09-21: the ops make-safe board (a ~767KB feed that has run 5-11s
// for weeks) tipped over. One browser produced 136 board calls in 5 hours at 52s
// average with 38 x 504, while every other operator saw 0.7-1.3s. Nothing
// stopped the background tick, a Retry press or a second window from stacking
// another 150s read on the ones already running, and that operator's own
// Fencing-to-Patio switches then queued behind them at 16s.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
// Normalise EOLs: the working tree is CRLF on Windows and LF in CI, and a source
// marker containing a newline must match in both.
const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8').replace(/\r\n/g, '\n');

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

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log('  ok  ' + name);
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

// Run the REAL loadJobs/retryLoadJobs over stubbed reads.
function harness(options) {
  const opts = options || {};
  const calls = { pipeline: [], board: 0, render: 0, toasts: [] };
  const ctx = {
    console: { error() {}, warn() {}, log() {} },
    Promise,
    setTimeout: (fn) => fn(),
    _pipelineTab: opts.tab || 'fencing',
    _jobView: 'kanban',
    _pipelineData: null,
    _jobFilter: opts.jobFilter || 'fencing',
    _jobSearch: '',
    makesafeReviewOverlayIsOpen: () => false,
    jobDetailIsOpen: () => false,
    updateJobsDate() {},
    renderJobs() { calls.render += 1; },
    showToast(message, type, actions) { calls.toasts.push({ message, type, actions }); },
    failMakesafeArchiveLoadIfPending() {},
    loadMakesafeBoardIntakeDrafts() {},
    loadMakesafeBoardStory() {},
    loadMakesafeBoardReviewAffordances() {},
    loadMakesafeBoardPackChips() {},
    fetchMakesafeBoardData() {
      calls.board += 1;
      return opts.board ? opts.board() : Promise.resolve({ columns: {} });
    },
    opsFetch(action, params) {
      calls.pipeline.push({ action, params });
      return opts.pipeline ? opts.pipeline() : Promise.resolve({ columns: {} });
    },
  };
  vm.createContext(ctx);
  // The claim flag ships immediately above loadJobs; take it with the function.
  vm.runInContext('var _loadJobsInFlight = false;', ctx);
  vm.runInContext(extractFunction(ops, 'async function loadJobs(opts)'), ctx);
  vm.runInContext(extractFunction(ops, 'function retryLoadJobs()'), ctx);
  return { ctx, calls };
}

async function main() {
  await check('a background tick stands down while a read is already in flight', async () => {
    const slow = deferred();
    const { ctx, calls } = harness({ tab: 'makesafes', board: () => slow.promise });
    const first = ctx.loadJobs();
    assert.equal(calls.board, 1, 'the first load issues its read');
    assert.equal(ctx._loadJobsInFlight, true, 'the first load holds the claim');
    // Three ticks land while the first read is open: none may issue a read.
    await ctx.loadJobs({ background: true });
    await ctx.loadJobs({ background: true });
    await ctx.loadJobs({ background: true });
    assert.equal(calls.board, 1, 'background ticks did NOT stack reads on the in-flight one');
    slow.resolve({ columns: {} });
    await first;
    assert.equal(ctx._loadJobsInFlight, false, 'the claim is released once the read lands');
  });

  await check('a tick after the read lands is allowed through again', async () => {
    const { ctx, calls } = harness({ tab: 'makesafes' });
    await ctx.loadJobs();
    await ctx.loadJobs({ background: true });
    assert.equal(calls.board, 2, 'the guard frees up once nothing is in flight');
  });

  await check('a failed read still releases the claim', async () => {
    const { ctx, calls } = harness({ pipeline: () => Promise.reject(new Error('API error: 504')) });
    await ctx.loadJobs();
    assert.equal(ctx._loadJobsInFlight, false, 'a 504 must not strand the claim');
    assert.equal(calls.toasts.length, 1, 'the operator is told');
    // A stranded claim would silently kill the refresh for the rest of the session.
    const before = calls.pipeline.length;
    await ctx.loadJobs({ background: true });
    assert.ok(calls.pipeline.length > before, 'the background refresh still works after a failure');
  });

  await check('the failure toast retries through the no-stack door', async () => {
    const { ctx, calls } = harness({ pipeline: () => Promise.reject(new Error('API error: 504')) });
    await ctx.loadJobs();
    const retry = calls.toasts[0].actions.find((a) => a.label === 'Retry');
    assert.equal(retry.onclick, 'retryLoadJobs()', 'Retry must not call loadJobs() directly');
  });

  await check('pressing Retry while a read is in flight issues no second read', async () => {
    const slow = deferred();
    const { ctx, calls } = harness({ tab: 'makesafes', board: () => slow.promise });
    const first = ctx.loadJobs();
    assert.equal(calls.board, 1);
    ctx.retryLoadJobs();
    ctx.retryLoadJobs();
    ctx.retryLoadJobs();
    assert.equal(calls.board, 1, 'mashing Retry did NOT stack reads');
    assert.equal(calls.toasts.length, 3, 'each press still answers the operator');
    slow.resolve({ columns: {} });
    await first;
  });

  await check('pressing Retry once idle does load', async () => {
    const { ctx, calls } = harness({ tab: 'makesafes' });
    await ctx.retryLoadJobs();
    assert.equal(calls.board, 1, 'Retry is a real retry when nothing is running');
  });

  await check('a press is still served while a read is in flight', async () => {
    // A tab switch asks for a DIFFERENT vertical and must not be answered with
    // the in-flight load's data, so presses are deliberately not coalesced.
    const slow = deferred();
    const { ctx, calls } = harness({ jobFilter: 'fencing', pipeline: () => slow.promise });
    const first = ctx.loadJobs();
    ctx._jobFilter = 'patio';
    ctx.loadJobs();
    assert.equal(calls.pipeline.length, 2, 'the tab switch was served');
    assert.equal(calls.pipeline[1].params.type, 'patio', 'and it asked for the vertical pressed');
    slow.resolve({ columns: {} });
    await first;
  });

  await check('the in-flight silent retry is not blocked by its own claim', async () => {
    let attempts = 0;
    const { ctx, calls } = harness({
      pipeline: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('transient blip'))
          : Promise.resolve({ columns: {} });
      },
    });
    // Background: the guard sees the claim this very load holds. Exempting
    // `retried` is what keeps the one silent retry alive.
    await ctx.loadJobs({ background: true });
    assert.equal(attempts, 2, 'the single silent retry still runs');
    assert.equal(calls.toasts.length, 0, 'a recovered blip stays silent');
    assert.equal(ctx._loadJobsInFlight, false, 'and the claim is released after it');
  });

  await check('the five-minute timer stands down on a hidden tab', () => {
    const marker = 'setInterval(function() {\n  if (!_opsAppStarted) return;';
    // The timer is a setInterval CALL, not a function declaration: its body
    // is followed by the period argument, so slice through to that tail.
    const tail = '}, 300000); // 5 minutes';
    const start = ops.indexOf(marker);
    assert.ok(start >= 0, 'the five-minute timer is still in ops.html');
    const end = ops.indexOf(tail, start);
    assert.ok(end >= 0, 'the five-minute timer still ends where this test expects');
    const timerSrc = ops.slice(start, end + tail.length);
    const build = (hidden) => {
      const hits = { jobs: 0 };
      const ctx = {
        _opsAppStarted: true,
        _jarvisLastUpdate: 0,
        Date,
        document: { hidden },
        localStorage: { getItem: () => 'jobs' },
        setInterval: (fn) => { ctx.__tick = fn; },
        loadToday() {}, loadCalendar() {}, loadFinancials() {},
        loadMaterials() {}, loadInbox() {},
        loadJobs(o) { hits.jobs += 1; ctx.__opts = o; },
      };
      vm.createContext(ctx);
      vm.runInContext(timerSrc, ctx);
      ctx.__tick();
      return { hits, ctx };
    };
    const hiddenRun = build(true);
    assert.equal(hiddenRun.hits.jobs, 0, 'a background window does not poll the board');
    const visibleRun = build(false);
    assert.equal(visibleRun.hits.jobs, 1, 'the visible window still refreshes');
    assert.equal(visibleRun.ctx.__opts.background, true, 'and still marks itself a background load');
  });

  console.log('');
  console.log(passed + ' checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
