// node --test modules/job-scope-record.test.cjs
// The one scope reader (modules/job-scope-record.js) against each saved shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const R = require('./job-scope-record.js');
const { buildEnginePatioDetail, pricingJson } = require('../tests/fixtures/scope-engine-patio.js');

const NOW = Date.parse('2026-10-26T03:00:00Z'); // Mon 26 Oct 2026, 11:00am Perth
const engineJob = () => buildEnginePatioDetail({ now: NOW }).job;

test('the module file holds no long dash and no emoji', () => {
  const src = readFileSync(resolve(__dirname, 'job-scope-record.js'), 'utf8');
  assert.doesNotMatch(src, /[–—]/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
});

test('engine patio: kind, tool, revision and its history', () => {
  const r = R.read(engineJob());
  assert.equal(r.kind, 'engine-patio');
  assert.equal(r.tool, 'Scope Engine');
  assert.equal(r.revision.n, 3);
  assert.equal(r.revision.outputsAgree, true);
  assert.deepEqual(r.revision.earlier.map((e) => e.n), [1, 2]);
  assert.equal(R.revisionWords(r), 'Rev 3 sealed Sun 25 Oct, 2:41pm, saved to this job 2:44pm. 2 earlier revisions kept.');
  assert.equal(R.revisionWords(r, true), 'Sealed Sun 25 Oct, 2:41pm, saved to this job 2:44pm. 2 earlier revisions kept.');
});

test('engine patio: scope inputs in words, in the design and site groups', () => {
  const r = R.read(engineJob());
  const v = (label) => (r.inputs.find((i) => i.label === label) || {}).value;
  assert.equal(v('Roof'), 'Gable, end to the yard');
  assert.equal(v('Fixing'), 'On risers over the gutter');
  assert.equal(v('Size'), '7,200 x 4,500 mm (32.4 m²)');
  assert.equal(v('Posts'), '3, 100x100 SHS');
  assert.equal(v('Roof sheet'), 'Trimdek');
  assert.equal(v('Frame colour'), 'Monument');
  assert.equal(v('Heights'), '6 of 8 measured');
  assert.deepEqual([...new Set(r.inputs.map((i) => i.group))], ['Design', 'Site']);
  assert.equal(R.summaryLine(r), 'Gable, end to the yard, 7,200 x 4,500 mm (32.4 m²), Trimdek');
  assert.equal(r.lines.length, 6);
  assert.deepEqual(r.documents.map((d) => d.name), ['Quote', 'Scope of works', 'Work order', 'Material order', 'Crew guide']);
});

test('engine patio: opens the Scope Engine, from the job or from a job list row', () => {
  const j = engineJob();
  assert.equal(R.openUrl(j), R.ENGINE_PATIO_URL + '?jobId=' + j.id);
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: 'patio-scoper' }), R.ENGINE_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio' }), R.ENGINE_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'fencing' }), R.FENCE_URL);
});

test('old tools retired (T43): new jobs and fence jobs open the Scope Engine, older patio scopes stay put', () => {
  assert.equal(R.FENCE_URL, 'https://marninms98-dotcom.github.io/fence-designer/scope-engine/');
  assert.equal(R.toolUrlFor({ type: 'patio' }), R.ENGINE_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', scope_json: '' }), R.ENGINE_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'fencing', scope_json: { job: { runs: [] } } }), R.FENCE_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', scope_json: { config: { length: 6 } } }), R.OLD_PATIO_URL);
  assert.equal(R.openUrl({ id: 'j1', type: 'fencing' }), R.FENCE_URL + '?jobId=j1');
  // a job list row: no scope_json, only the pricing's tool
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: 'patio-scoper' }), R.ENGINE_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: 'patio-configurator' }), R.OLD_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', pricing_json: { totalIncGST: 9000 } }), R.OLD_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: null, pricing_json: null }), R.ENGINE_PATIO_URL);
  // a Kanban card: the older patio page writes no tool key, only a total
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: null, pj_total_inc: 18500 }), R.OLD_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', pj_total: 0 }), R.OLD_PATIO_URL);
  assert.equal(R.toolUrlFor({ type: 'patio', pj_tool: 'patio-scoper', pj_total_inc: 18500 }), R.ENGINE_PATIO_URL);
});

test('money: unknown stays null, never 0; a partial cost says so', () => {
  const m = R.read(engineJob()).money;
  assert.equal(m.saleIncGst, 15950);
  assert.equal(m.commission, null);
  assert.equal(m.cost, 9020);
  assert.equal(m.costIsPartial, true);
  assert.deepEqual(R.estimatedMargin(R.read(engineJob())), { pct: 37.8, words: 'Estimated margin 37.8% before commission' });

  const unpriced = Object.assign(pricingJson(), { totalExGST: null, gst: null, totalIncGST: null, materialCostEstimate: null, totalCostEstimate: null, pricing_complete: false });
  const u = R.read(Object.assign(engineJob(), { pricing_json: unpriced })).money;
  assert.equal(u.saleIncGst, null);
  assert.equal(u.materials, null);
  assert.equal(R.estimatedMargin({ money: u }), null);
  const card = R.costsCardHtml(R.read(Object.assign(engineJob(), { pricing_json: unpriced })));
  assert.match(card, /Not known yet/);
  assert.doesNotMatch(card, /\$0\.00/);
});

test('money: a string pricing_json and the fence tool totals read the same way', () => {
  assert.equal(R.moneyOf(JSON.stringify({ totalIncGST: 1100 })).saleIncGst, 1100);
  assert.equal(R.moneyOf({ totals: { total_inc_gst: 2200 } }).saleIncGst, 2200);
  assert.equal(R.moneyOf({}).saleIncGst, null);
});

test('fence designer and Scope Engine fence: runs, gates, removal, the four scoper notes', () => {
  const r = R.read({ type: 'fencing', scope_json: { job: {
    profile: 'Ridgeside', sheetColour: 'Wilderness',
    runs: [{ length: 12, sheetHeight: 1800, panels: [{}, {}] }, { length: 11, panels: [{}] }],
    gates: [{ type: 'pedestrian', width: 900 }], removal: { totalMetres: 23, notes: 'Asbestos, wet cut' },
    siteNotes: 'Dog in yard', checklist: { finalNotes: 'Call before' }, supplierNotes: 'Deliver Tuesday',
  } } });
  assert.equal(r.kind, 'fence');
  assert.equal(R.summaryLine(r), '23 m across 2 runs, Ridgeside, Wilderness');
  assert.ok(r.inputs.some((i) => i.label === 'Gates (1)' && i.value === 'pedestrian (900 mm)'));
  assert.deepEqual(r.notes.map((n) => n.label), ['Site notes', 'Final notes', 'Removal notes', 'Supplier notes']);
  assert.equal(r.toolUrl, R.FENCE_URL);
});

test('older patio page: config shape and its notes', () => {
  const r = R.read({ type: 'patio', scope_json: JSON.stringify({ config: { length: 6, projection: 4, roofStyle: 'flat', roofing: 'solarspan75' }, notes: { noteWorkOrder: 'Gate code 1234' } }) });
  assert.equal(r.kind, 'old-patio');
  assert.equal(R.summaryLine(r), '6m x 4m (24.0 m²), flat, solarspan75');
  assert.deepEqual(r.notes, [{ label: 'Work order', text: 'Gate code 1234' }]);
  assert.equal(r.toolUrl, R.OLD_PATIO_URL);
});

test('nothing saved, or a broken scope, reads as none and never throws', () => {
  assert.equal(R.read({ type: 'patio' }).kind, 'none');
  assert.equal(R.read({ type: 'patio', scope_json: '{not json' }).kind, 'none');
  assert.equal(R.read({ type: 'patio', scope_json: { something: 1 } }).kind, 'unknown');
  assert.equal(R.scopeCardHtml(R.read({ type: 'patio' })), '');
});

test('html blocks escape what the scoper typed', () => {
  const j = engineJob();
  j.scope_json.lines = [{ id: 'x', description: '<img src=x onerror=alert(1)>', quantity: 1, unit: 'each', colour: null }];
  const h = R.linesHtml(R.read(j));
  assert.doesNotMatch(h, /<img/);
  assert.match(h, /&lt;img/);
});
