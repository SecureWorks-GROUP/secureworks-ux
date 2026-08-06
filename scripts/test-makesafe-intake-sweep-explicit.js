// Viewing the make-safe board must never approve an intake draft.
//
// Approving a draft CREATES A LIVE MAKE-SAFE JOB. Until 2026-08-06 `loadJobs()`
// awaited `auto_approve_clean_intake_drafts` (triggered_by 'ops_board_autoload')
// before fetching the board, so opening the board ran a privileged batch approval
// nobody asked for — and, since every reviewable draft currently duplicates an
// existing card, spent ~28.6s failing to approve them while the board waited.
//
// This asserts against the REAL shipped ops.html rather than a copy, so a
// reintroduction breaks CI:
//   1. the board render path posts NOTHING privileged;
//   2. the render-path trigger name is gone from the file entirely;
//   3. the replacement sweep exists, is explicit, and names an allow-listed trigger;
//   4. a server that withholds the run is reported as withheld, never as "0 advanced".
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('  ok  ' + name);
}

function extractFunction(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('function not found: ' + signature);
  // Walk braces from the first '{' after the signature to find the real end.
  const open = src.indexOf('{', start + signature.length);
  if (open < 0) throw new Error('function body not found: ' + signature);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced function body: ' + signature);
}

// ── 1 + 2: the render path is a pure read ────────────────────────────────────

check('loadJobs no longer awaits any approval sweep', () => {
  const loadJobs = extractFunction(ops, 'async function loadJobs()');
  assert.ok(
    !/auto_approve_clean_intake_drafts/.test(loadJobs),
    'loadJobs must not call the approval action',
  );
  assert.ok(
    !/autoApproveClean/.test(loadJobs),
    'loadJobs must not call an auto-approval helper',
  );
  // Guard the general shape too: the only thing loadJobs may POST is nothing.
  assert.ok(!/opsPost\(/.test(loadJobs), 'loadJobs must issue no POST at all');
});

check('the render-path trigger name is gone from the shipped page', () => {
  assert.ok(
    !ops.includes("'ops_board_autoload'"),
    "ops.html must not send triggered_by 'ops_board_autoload'",
  );
});

check('no other render/paint path posts the approval action', () => {
  // Every remaining occurrence of the action must sit inside the explicit sweep.
  const sweep = extractFunction(ops, 'async function runMakesafeCleanIntakeSweep()');
  const total = ops.split('auto_approve_clean_intake_drafts').length - 1;
  const inSweep = sweep.split('auto_approve_clean_intake_drafts').length - 1;
  assert.strictEqual(inSweep, 1, 'the explicit sweep should call the action exactly once');
  assert.strictEqual(
    total,
    inSweep,
    'the approval action may only be called from the explicit sweep',
  );
});

check('the INTAKE column offers the explicit control only when drafts exist', () => {
  const render = extractFunction(ops, 'function renderMakesafeIntakeColumn()');
  assert.ok(
    render.includes('runMakesafeCleanIntakeSweep()'),
    'the INTAKE column must expose the explicit sweep',
  );
  assert.ok(
    /if \(drafts\.length > 0\)/.test(render),
    'the control should not render against an empty intake pile',
  );
});

// ── 3 + 4: the explicit sweep behaves ────────────────────────────────────────

function runSweep(postResult, opts) {
  opts = opts || {};
  const calls = { posts: [], toasts: [], loadJobs: 0 };
  const button = { disabled: false, textContent: 'Advance clean' };
  const ctx = {
    console,
    document: { getElementById: () => (opts.noButton ? null : button) },
    opsPost: (action, body) => {
      calls.posts.push({ action, body });
      return postResult instanceof Error
        ? Promise.reject(postResult)
        : Promise.resolve(postResult);
    },
    showToast: (message, type) => calls.toasts.push({ message, type }),
    loadJobs: () => { calls.loadJobs += 1; },
  };
  vm.createContext(ctx);
  vm.runInContext(
    'var _makesafeIntakeSweepInFlight = false;\n' +
      extractFunction(ops, 'async function runMakesafeCleanIntakeSweep()') +
      '\nthis.run = runMakesafeCleanIntakeSweep;',
    ctx,
  );
  return ctx.run().then(() => ({ calls, button }));
}

const cases = [];

cases.push(
  runSweep({ live_approval_authorised: true, auto_approved_count: 3, eligible_count: 3 })
    .then(({ calls }) => {
      check('the explicit sweep names an allow-listed, explicit trigger', () => {
        assert.strictEqual(calls.posts.length, 1);
        assert.strictEqual(calls.posts[0].action, 'auto_approve_clean_intake_drafts');
        assert.strictEqual(calls.posts[0].body.triggered_by, 'ops_intake_review_sweep');
      });
      check('a successful sweep reports the count and refreshes the board', () => {
        assert.match(calls.toasts[0].message, /Advanced 3 clean MakeSafe intake drafts/);
        assert.strictEqual(calls.toasts[0].type, 'success');
        assert.strictEqual(calls.loadJobs, 1);
      });
    }),
);

cases.push(
  runSweep({ live_approval_authorised: false, trigger_refusal: 'preview only: trigger x', eligible_count: 48, auto_approved_count: 0 })
    .then(({ calls }) => {
      check('a server-withheld run is reported as withheld, not as an empty backlog', () => {
        assert.strictEqual(calls.toasts.length, 1);
        assert.strictEqual(calls.toasts[0].message, 'preview only: trigger x');
        assert.strictEqual(calls.toasts[0].type, 'warning');
        assert.ok(
          !/No clean drafts/.test(calls.toasts[0].message),
          'a withheld run must never read as "nothing to do"',
        );
      });
    }),
);

cases.push(
  runSweep({ live_approval_authorised: true, auto_approved_count: 0, eligible_count: 48 })
    .then(({ calls }) => {
      check('eligible-but-refused drafts are distinguished from an empty backlog', () => {
        assert.match(calls.toasts[0].message, /48 passed the clean gate but were refused/);
      });
    }),
);

cases.push(
  runSweep({ live_approval_authorised: true, auto_approved_count: 0, eligible_count: 0 })
    .then(({ calls }) => {
      check('an empty backlog says so plainly', () => {
        assert.match(calls.toasts[0].message, /No clean drafts ready to advance/);
      });
    }),
);

cases.push(
  runSweep(new Error('boom')).then(({ calls, button }) => {
    check('a failed sweep surfaces the error and re-enables the control', () => {
      assert.match(calls.toasts[0].message, /Intake advancement failed: boom/);
      assert.strictEqual(calls.toasts[0].type, 'warning');
      assert.strictEqual(button.disabled, false);
      assert.strictEqual(button.textContent, 'Advance clean');
    });
  }),
);

Promise.all(cases).then(
  () => {
    console.log('\nmake-safe intake sweep is explicit: ' + passed + ' passed, 0 failed.');
  },
  (err) => {
    console.error('\nFAILED: ' + (err && err.message ? err.message : err));
    process.exit(1);
  },
);
