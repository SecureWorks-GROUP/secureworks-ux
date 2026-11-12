// node --test tests/unit/crew-sees-sealed-scope.test.cjs
// "What the crew sees equals the sealed scope of works" (director's ruling 4, 12 Nov 2026), patio and fence,
// against the shipped code paths: the Trade App's Scope tab build spec (renderEnhancedScope and the
// // <trade-sealed-crew-scope> block, cut out of trade.html as shipped), modules/sealed-crew-scope.js, and the
// Ops scope card (modules/job-scope-record.js). The live screen proof is the walk's step 7.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const S = require('../../modules/sealed-crew-scope.js');
const R = require('../../modules/job-scope-record.js');

const ROOT = resolve(__dirname, '..', '..');
const TRADE = readFileSync(resolve(ROOT, 'trade.html'), 'utf8');

function cut(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  assert.ok(a !== -1 && b !== -1, 'found in trade.html: ' + from);
  return src.slice(a, b);
}

// The Trade App's build spec as shipped, with the helpers it reads cut from the same file.
function tradeScope() {
  const code = [
    cut(TRADE, '  var JOB_TYPE_COLORS = {', '  function deriveJobPhase('),
    cut(TRADE, '  function isJobDone(phase) {', '  function getMyAssignment('),
    cut(TRADE, '  // <trade-sealed-crew-scope>', '  function renderEnhancedPOs('),
  ].join('\n');
  const boxes = {};
  const frames = [];
  const box = (id) => boxes[id] || (boxes[id] = {
    id, attrs: {}, note: { textContent: '' }, children: [],
    querySelector(sel) { return sel === '[data-sealed-crew-scope-note]' ? this.note : null; },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(el) { this.children.push(el); frames.push(el); },
  });
  const ctx = {
    window: { SealedCrewScope: S },
    document: {
      getElementById: box,
      createElement: () => ({ attrs: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, srcdoc: '' }),
    },
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    escSowText: (s) => String(s),
    tradeCanSeeSowPricing: () => false,
  };
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.renderEnhancedScope = renderEnhancedScope; this.humanise = humanise;', ctx);
  return { render: (job) => ctx.renderEnhancedScope({ job }, 'confirmed'), humanise: ctx.humanise, boxes, frames };
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// The crew scope of works page as the Scope Engine seals it (made-up job; shape as patio/scoper/src/docs.ts scopeDoc).
const KEPT_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Crew scope of works</title><style>@page{size:A4}</style></head><body>'
  + '<h1>Crew scope of works</h1><p>Rev 1 &middot; sealed. Skillion on the fascia, insulated panel roof &middot; 2 posts</p>'
  + '<h2>Key dimensions</h2><table><tr><th>Dimension</th><th class="num">Size</th><th class="num">How many</th></tr>'
  + '<tr><td>Roof: width across the fall</td><td class="num">6,000 mm</td><td class="num">1</td></tr>'
  + '<tr><td>Roof underside, low side (at the front)</td><td class="num">2,151 mm</td><td class="num">1</td></tr>'
  + '<tr><td>Post height</td><td class="num">2,151 mm</td><td class="num">2</td></tr></table>'
  + '<svg viewBox="0 0 800 600"><rect x="45" y="120" width="710" height="360"/></svg><p>Post &middot; 90 × 90 × 2.0 SHS ×2</p></body></html>';
const FROZEN = 'frz-walk-0001';

// The page's stamp as the seal makes it: shared/hash.ts canonicalHash of the page, sha256 of it as a JSON string.
// Cross-checked against scope-engine-v2's own canonicalHash on a sample page: b52f4547...61853d06 (see the vector test).
async function stampOf(page) { return S.sha256Hex(JSON.stringify(page)); }

async function walkPatio(over) {
  const o = Object.assign({ keepSeal: true, keepPage: true, page: KEPT_PAGE }, over || {});
  const seal = {
    frozen: { id: FROZEN, schemaVersion: 'frozen-revision/v1' },
    stamps: [
      { frozenRevisionId: FROZEN, scopeRevisionId: 'rev-1', kind: 'installer-sow', scopeLineIds: [], contentHash: await stampOf(KEPT_PAGE) },
      { frozenRevisionId: FROZEN, scopeRevisionId: 'rev-1', kind: 'customer-quote', scopeLineIds: [], contentHash: 'f'.repeat(64) },
    ],
    check: { ok: true, problems: [] },
  };
  if (o.keepPage) seal.documents = { 'installer-sow': o.page };
  return {
    id: '5e0a0000-0000-4000-8000-000000000721', type: 'patio', status: 'awaiting_deposit',
    scope_json: Object.assign({
      tool: 'patio-scoper', version: '2.0', family: 'skillion', supported: true, lines: [],
      revision: { n: 1, scopeRevisionId: 'rev-1', parentRevisionId: null, frozenId: FROZEN, catalogueRevisionId: 'cat-1', sealedAt: '2026-11-12T10:43:00.000Z', outputsAgree: true },
      // The tool's starting figures, as the walk's record kept them: 3 posts (postsAuto) and 2,600 mm at the front.
      draft: { site: { storeys: 'single', houseRoof: 'tile', fascia: 'timber', windClass: 'N2', sampleHeights: true },
        design: { shape: 'skillion', fixing: 'fascia', widthMm: 6000, projectionMm: 4000, frontHeightMm: 2600, pitchDeg: 3, posts: 3, postsAuto: true,
          products: { covering: 'panel:solarspan:75', post: 'shs:90x90x2.0:c450l0' }, colours: { frame: 'CB-SURFMIST', roof: 'CB-SURFMIST', trim: 'CB-SURFMIST' }, downpipes: 'both' } },
      earlier: [], savedAt: '2026-11-12T10:44:00.000Z',
    }, o.keepSeal ? { sealed: { seal, build: {}, warnings: 0 } } : {}),
  };
}

test('the stamp is the Scope Engine\'s: same sha256 as scope-engine-v2 shared/hash.ts canonicalHash', async () => {
  const sample = '<!doctype html><html><head><title>Crew scope</title></head><body><h1>Rev 1</h1><p>2 posts, 2,151 mm "check"</p>\n<svg viewBox="0 0 800 600"></svg></body></html>';
  assert.equal(await S.sha256Hex(S.stampedText(sample)), 'b52f45470dd395b7e91506b679b9ad710753869c102c8815c95d209f61853d06');
});

test('patio: the crew sees the sealed crew scope of works, the kept page byte for byte', async () => {
  const t = tradeScope();
  const job = await walkPatio();
  const html = t.render(job);
  assert.match(html, /<h3>Crew scope of works, Rev 1<\/h3>/);
  await settle();
  assert.equal(t.frames.length, 1, 'one frame, the kept page');
  const f = t.frames[0];
  assert.equal(f.attrs.sandbox, 'allow-same-origin', 'the page runs no script');
  // The frame holds the kept page unchanged; only the Scope Engine's own no-script policy is added to its head.
  assert.equal(f.srcdoc, S.framePage(KEPT_PAGE));
  assert.equal(f.srcdoc.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), KEPT_PAGE);
  const box = Object.values(t.boxes)[0];
  assert.equal(box.attrs['data-sealed-crew-scope-status'], 'matches');
  assert.equal(box.note.textContent, 'As sealed in the Scope Engine. The same page the office sees.');
  // Never the old patio shape and never a figure worked out here: no 3 posts, no 2,600.
  assert.doesNotMatch(html, /Posts|2,?600|Post height:/);
});

test('patio: a page changed on its way to the phone is not shown, and says so', async () => {
  const t = tradeScope();
  const altered = KEPT_PAGE.replace(/\b\d{3,}\b/g, ''); // as a money strip that takes out bare numbers would leave it
  const job = await walkPatio({ page: altered });
  const html = t.render(job);
  await settle();
  assert.equal(t.frames.length, 0);
  const box = Object.values(t.boxes)[0];
  assert.equal(box.attrs['data-sealed-crew-scope-status'], 'differs');
  assert.match(box.note.textContent, /not the page that was sealed, so it is not shown\. Ask the office for it\./);
  assert.doesNotMatch(html, /Posts|2,?600/);
});

test('patio: no seal or no page says so plainly, never an empty or old-shape spec', async () => {
  for (const [over, words] of [[{ keepSeal: false }, /saved without its seal/], [{ keepPage: false }, /not on this phone/]]) {
    const t = tradeScope();
    const html = t.render(await walkPatio(over));
    await settle();
    assert.equal(t.frames.length, 0);
    assert.match(text(html), words);
    assert.match(html, /Crew scope of works, Rev 1/);
    assert.doesNotMatch(html, /Build spec|Posts|2,?600/);
  }
});

test('patio: the 3D model is not offered for a Scope Engine patio (it would work the design out again)', () => {
  const block = cut(TRADE, '    // 3D model button (inside scope flow, not standalone)', '    // Office staff: open this job in the Scope Engine');
  assert.match(block, /SealedCrewScope\.isEnginePatio\(scope3d\)\) return;/);
});

test('patio from the older patio page: its build spec is unchanged', () => {
  const t = tradeScope();
  const html = t.render({ id: 'old-1', type: 'patio', scope_json: { config: { length: 6, projection: 4, roofStyle: 'skillion', posts: 3, postSize: '90x90' } } });
  assert.match(html, /<h3>Build spec<\/h3>/);
  assert.match(html, /6m × 4m/);
  assert.match(text(html), /Posts 3 × 90×90mm SHS posts/);
  assert.equal(t.frames.length, 0);
});

test('fence: what the crew sees equals the sealed revision\'s own summary', () => {
  const t = tradeScope();
  // A Scope Engine fence job as saved (fence/index.html: the job, its runs and gates, and each sealed revision's
  // pack with its summary, _revisionSummary). The build spec reads the job; the pack is what was sealed.
  const runs = [{ id: 'r1', name: 'Rear', length: 18.6, sheetHeight: 1800, panels: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i })) }];
  const gates = [{ id: 'g1', type: 'pedestrian', width: 900, runIndex: 0, afterPanel: 3 }];
  const summary = { runs: [{ id: 'r1', name: 'Rear', length: 18.6, panels: 8, plinths: 0 }], gates: [{ id: 'g1', type: 'pedestrian', width: 900, run: 0, after: 3 }], panels: 8, plinths: 0, colour: 'Monument', profile: 'Sameside' };
  const job = { id: 'f-1', type: 'fencing', scope_json: { job: { runs, gates, profile: 'Sameside', colour: 'Monument', revisionPacks: [{ n: 1, code: '10B4Z4S', summary }] } } };
  const seen = text(t.render(job));
  const sealed = job.scope_json.job.revisionPacks[0].summary;
  const metres = Math.round(sealed.runs.reduce((s, r) => s + r.length, 0) * 10) / 10;
  assert.match(seen, new RegExp('^Build spec ' + String(metres).replace('.', '\\.') + 'm total length'));
  assert.match(seen, new RegExp('Material ' + t.humanise('material', sealed.profile)));
  assert.match(seen, new RegExp('Colour ' + sealed.colour));
  assert.match(seen, new RegExp('Gates ' + sealed.gates.map((g) => g.type + ' ' + g.width + 'mm').join(', ')));
  assert.equal(t.frames.length, 0, 'a fence keeps its own build spec');
});

test('Ops scope card: no posts or height from the draft, a link to the sealed scope of works instead', async () => {
  const job = await walkPatio();
  const rec = R.read(job);
  const v = (label) => rec.inputs.find((i) => i.label === label);
  assert.equal(v('Posts'), undefined, 'the draft\'s starting 3 posts are not shown');
  assert.equal(v('Height under beam'), undefined, 'the draft\'s 2,600 mm is not shown');
  const link = v('Posts and heights');
  assert.equal(link.value, 'On the sealed crew scope of works');
  assert.equal(link.href, R.ENGINE_PATIO_URL + '?jobId=' + job.id);
  const card = R.scopeCardHtml(rec, job.id);
  assert.doesNotMatch(card, /2,600|>3, 90x90/);
  assert.match(card, /data-scope-fact-link[\s\S]*href="https:\/\/marninms98-dotcom\.github\.io\/patio\/scope-engine\/\?jobId=/);
  // The figures the card still shows are the sealed design's own: shape, fixing, size, pitch, sheet, colours.
  assert.equal(v('Size').value, '6,000 x 4,000 mm (24 m²)');
});

test('the module holds no long dash and no emoji', () => {
  const src = readFileSync(resolve(ROOT, 'modules/sealed-crew-scope.js'), 'utf8');
  assert.doesNotMatch(src, /[–—]/);
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u);
});
