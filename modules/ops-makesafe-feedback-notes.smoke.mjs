// Standalone smoke test for the MakeSafe feedback-notes module (Wave 3).
//
// Same harness as ops-makesafe-reporting-cockpit.smoke.mjs: eval the module in a
// stubbed browser-ish global scope and assert the wiring WITHOUT a real browser,
// DOM, or network.
//
// Run:  node modules/ops-makesafe-feedback-notes.smoke.mjs
// Exit code 0 == pass, 1 == fail.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, 'ops-makesafe-feedback-notes.js');
const code = readFileSync(SRC, 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log('  ok  - ' + name);
  } else {
    console.log('  FAIL - ' + name);
    failures++;
  }
}

// ── Recording stubs ──
const calls = { opsPost: [], opsFetch: [], toasts: [] };

function makeEl() {
  return {
    _html: '',
    style: {},
    disabled: false,
    textContent: '',
    value: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
}
const elements = {};
const documentStub = {
  getElementById: (id) => (elements[id] ||= makeEl()),
};

const behaviour = {
  fetchResult: { notes: [] },
  postResult: { note: { id: 'n1' } },
};
const sandbox = {
  document: documentStub,
  opsFetch: (action, params) => { calls.opsFetch.push({ action, params }); return Promise.resolve(behaviour.fetchResult); },
  opsPost: (action, body) => { calls.opsPost.push({ action, body }); return Promise.resolve(behaviour.postResult); },
  showToast: (msg, kind) => { calls.toasts.push({ msg, kind }); },
  escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escapeAttr: (s) => String(s == null ? '' : s).replace(/"/g, '&quot;').replace(/&/g, '&amp;'),
  module: undefined,
  console,
};

const exposed = [
  'loadMsNotes',
  'addMsNote',
  'triggerMsRerun',
  'renderMsNotesPanel',
  'renderMsNote',
];
const wrapped = '"use strict";\n' + code + '\nreturn { '
  + exposed.map((n) => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(', ')
  + ', _msNotesCache: typeof _msNotesCache !== "undefined" ? _msNotesCache : undefined };';

const argNames = Object.keys(sandbox);
const argVals = argNames.map((k) => sandbox[k]);
let mod;
try {
  // eslint-disable-next-line no-new-func
  mod = new Function(...argNames, wrapped)(...argVals);
} catch (e) {
  console.log('  FAIL - module evaluates without throwing: ' + e.message);
  process.exit(1);
}

console.log('MakeSafe feedback-notes smoke test');

// ── Functions exist ──
check('defines loadMsNotes', typeof mod.loadMsNotes === 'function');
check('defines addMsNote', typeof mod.addMsNote === 'function');
check('defines triggerMsRerun', typeof mod.triggerMsRerun === 'function');
check('defines renderMsNotesPanel', typeof mod.renderMsNotesPanel === 'function');
check('defines renderMsNote', typeof mod.renderMsNote === 'function');

// ── 1. renderMsNote: different backgrounds for human vs agent ──
const humanNote = { role: 'human', author: 'Marnin', body: 'fix the site address', created_at: '2026-06-17T02:00:00Z' };
const agentNote = { role: 'agent', author: 'MAKESAFE_AGENT', body: 'MAKESAFE_AGENT_REPLY | re-rendered the report', created_at: '2026-06-17T02:05:00Z' };
const humanHtml = mod.renderMsNote(humanNote);
const agentHtml = mod.renderMsNote(agentNote);
// Pull the background-color out of each rendered row.
function bgOf(html) { const m = html.match(/background:(#[0-9A-Fa-f]{3,6})/); return m ? m[1].toLowerCase() : null; }
check('renderMsNote produces different backgrounds for human vs agent',
  bgOf(humanHtml) && bgOf(agentHtml) && bgOf(humanHtml) !== bgOf(agentHtml));

// ── 2. agent reply body renders inline (prefix NOT stripped) ──
check('renderMsNote shows the MAKESAFE_AGENT_REPLY | body inline',
  agentHtml.includes('MAKESAFE_AGENT_REPLY |') && agentHtml.includes('re-rendered the report'));
check('renderMsNote tags agent notes as (agent)', agentHtml.includes('(agent)'));

// ── 3. renderMsNotesPanel produces the Re-run now button when requested ──
const panelWithRerun = mod.renderMsNotesPanel('job-1', [humanNote, agentNote], { showRerunButton: true });
check('renderMsNotesPanel produces a Re-run now button when showRerunButton=true',
  panelWithRerun.includes('Re-run now') && panelWithRerun.includes("triggerMsRerun('job-1')"));
const panelNoRerun = mod.renderMsNotesPanel('job-1', [], { showRerunButton: false });
check('renderMsNotesPanel omits the Re-run now button when showRerunButton=false',
  !panelNoRerun.includes('Re-run now'));

// ── 4. renderMsNotesPanel produces the add-note textarea + button ──
check('renderMsNotesPanel produces an add-note textarea',
  panelWithRerun.includes('<textarea') && panelWithRerun.includes('msNoteInput-job-1'));
check('renderMsNotesPanel produces an Add note button',
  panelWithRerun.includes('Add note') && panelWithRerun.includes("addMsNote('job-1')"));

// ── 5. loadMsNotes calls opsFetch(list_draft_notes) with the job_id param ──
behaviour.fetchResult = { notes: [humanNote, agentNote] };
await mod.loadMsNotes('job-7', 'msNotesPanel-job-7');
const listCall = calls.opsFetch.find((c) => c.action === 'list_draft_notes');
check('loadMsNotes calls opsFetch(list_draft_notes)', !!listCall);
check('loadMsNotes passes the job_id param', listCall && listCall.params && listCall.params.job_id === 'job-7');
check('loadMsNotes renders the thread into the container',
  (elements['msNotesPanel-job-7']._html || '').includes('fix the site address'));

// ── 6. addMsNote calls opsPost(add_draft_note) with the correct fields ──
elements['msNoteInput-job-9'] = makeEl();
elements['msNoteInput-job-9'].value = 'please widen the hire line to 6 weeks';
await mod.addMsNote('job-9');
const addCall = calls.opsPost.find((c) => c.action === 'add_draft_note');
check('addMsNote calls opsPost(add_draft_note)', !!addCall);
if (addCall) {
  check('add_draft_note body carries job_id', addCall.body.job_id === 'job-9');
  check('add_draft_note body carries the note_body from the textarea',
    addCall.body.note_body === 'please widen the hire line to 6 weeks');
  check('add_draft_note body carries role=human', addCall.body.role === 'human');
  check('add_draft_note body carries an author', !!addCall.body.author);
  check('add_draft_note body carries draft_kind=makesafe_report', addCall.body.draft_kind === 'makesafe_report');
}

// ── 7. triggerMsRerun calls opsPost(rerun_draft_report) with the job_id ──
behaviour.postResult = { rerun: true, addressed_count: 1 };
await mod.triggerMsRerun('job-9');
const rerunCall = calls.opsPost.find((c) => c.action === 'rerun_draft_report');
check('triggerMsRerun calls opsPost(rerun_draft_report)', !!rerunCall);
check('rerun_draft_report body carries the job_id', rerunCall && rerunCall.body.job_id === 'job-9');

// ── 8. An agent note body starting with the prefix renders inline (not stripped) ──
const onlyAgent = mod.renderMsNotesPanel('job-1', [agentNote], { showRerunButton: true });
check('agent note body with MAKESAFE_AGENT_REPLY | prefix renders inline in the panel',
  onlyAgent.includes('MAKESAFE_AGENT_REPLY |'));

console.log('');
if (failures) {
  console.log('SMOKE FAILED: ' + failures + ' check(s) failed.');
  process.exit(1);
} else {
  console.log('SMOKE PASSED: all checks ok.');
  process.exit(0);
}
