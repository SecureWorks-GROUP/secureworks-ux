// The Ops five-minute board refresh must not repaint the MakeSafe pipeline while
// the full-page job detail owns the screen. This extracts and executes the REAL
// shipped loadJobs() function so the guard cannot drift away from ops.html.
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

function check(name, fn) {
  fn();
  console.log('  ok  ' + name);
}

// Diagnosis: of the reported candidates, only the five-minute timer reaches a
// board render. Auth caches the operator email, realtime updates Jarvis/toasts,
// and the comms interval refreshes only the open conversation thread.
check('the five-minute jobs timer calls the background board loader', () => {
  const timer = sliceBetween(
    ops,
    '// Auto-refresh active tab data every 5 minutes',
    'function clearChat()',
  );
  assert.match(timer, /else if \(view === 'jobs'\) loadJobs\(\{ background: true \}\)/);
});

check('the page auth-state handler does not navigate or render', () => {
  const handler = sliceBetween(
    ops,
    'cloud.supabase.auth.onAuthStateChange(function(_event, session)',
    '    }\n  } catch (e) { console.log(\'[ops] operator email cache failed:',
  );
  assert.doesNotMatch(handler, /showView|loadJobs|renderJobs|closeJobDetail/);
  assert.match(handler, /_opsUserEmail\s*=/);
});

check('the ai_alerts realtime handler does not navigate or render', () => {
  const handler = sliceBetween(
    ops,
    "_supabase.channel('alerts')",
    '    }).subscribe();',
  );
  assert.doesNotMatch(handler, /showView|loadJobs|renderJobs|closeJobDetail/);
  assert.match(handler, /updateJarvisSummary\(\)/);
});

check('the comms poll refreshes only the conversation', () => {
  const poll = extractFunction(ops, 'function startCommsPoll(contactId)');
  assert.match(poll, /loadConversation\(_commsPollContactId, true\)/);
  assert.doesNotMatch(poll, /showView|loadJobs|renderJobs|closeJobDetail/);
});

check('every async MakeSafe enricher uses the detail-aware repaint guard', () => {
  [
    'async function loadMakesafeBoardReviewAffordances()',
    'async function loadMakesafeBoardPackChips()',
    'async function loadMakesafeBoardIntakeDrafts()',
    'async function loadMakesafeBoardStory()',
  ].forEach((signature) => {
    const fn = extractFunction(ops, signature);
    assert.match(fn, /makesafeBoardCanRepaint\(\)/, signature);
  });
});

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
  () => console.log('\nOps job-detail auto-refresh guard: 9 passed, 0 failed.'),
  (error) => {
    console.error('\nFAILED:', error && error.stack ? error.stack : error);
    process.exitCode = 1;
  },
);
