// node --test tests/unit/crew-sees-sealed-scope.test.cjs
// "What the crew sees equals the sealed scope of works" (director's ruling 4, 12 Nov 2026), patio; fence keeps today's view,
// against the shipped code paths: the Trade App's Scope tab build spec (renderEnhancedScope and the
// // <trade-sealed-crew-scope> block, cut out of trade.html as shipped), modules/sealed-crew-scope.js, and the
// Ops scope card (modules/job-scope-record.js). The live screen proof is the walk's step 7.
// Director's ruling, 12 Nov 2026, 8:08 pm: the crew page is the ACCEPTED, released revision's, as the trade view
// (ops-api trade_job_detail crew_scope_of_works) sends it, never the latest saved scope; where the accepted binding
// cannot be proved, one line says why and nothing is shown. The ROOT env var points the check at another copy
// of the code (the before run against 36de77ad).
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ROOT = process.env.ROOT ? resolve(process.env.ROOT) : resolve(__dirname, '..', '..');
const S = require(resolve(ROOT, 'modules/sealed-crew-scope.js'));
const R = require(resolve(ROOT, 'modules/job-scope-record.js'));
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
  return { render: (job, extra) => ctx.renderEnhancedScope(Object.assign({ job }, extra || {}), 'confirmed'), humanise: ctx.humanise, boxes, frames };
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// A crew scope of works page as the Scope Engine seals it (made-up job; shape as patio/scoper/src/docs.ts scopeDoc).
function patioPage(n, widthMm) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>Crew scope of works</title><style>@page{size:A4}</style></head><body>'
    + '<h1>Crew scope of works</h1><p>Rev ' + n + ' &middot; sealed. Skillion on the fascia, insulated panel roof &middot; 2 posts</p>'
    + '<h2>Key dimensions</h2><table><tr><th>Dimension</th><th class="num">Size</th><th class="num">How many</th></tr>'
    + '<tr><td>Roof: width across the fall</td><td class="num">' + widthMm + ' mm</td><td class="num">1</td></tr>'
    + '<tr><td>Roof underside, low side (at the front)</td><td class="num">2,151 mm</td><td class="num">1</td></tr>'
    + '<tr><td>Post height</td><td class="num">2,151 mm</td><td class="num">2</td></tr></table>'
    + '<svg viewBox="0 0 800 600"><rect x="45" y="120" width="710" height="360"/></svg><p>Post &middot; 90 × 90 × 2.0 SHS ×2</p></body></html>';
}
// Rev 1 was sent and accepted; Rev 2 was saved and sealed later, never sent or accepted (money14's case).
const REV1_PAGE = patioPage(1, '6,000');
const REV2_PAGE = patioPage(2, '9,000');
const KEPT_PAGE = REV1_PAGE;

// The page's stamp as the seal makes it: shared/hash.ts canonicalHash of the page, sha256 of it as a JSON string.
// Cross-checked against scope-engine-v2's own canonicalHash on a sample page: b52f4547...61853d06 (see the vector test).
async function stampOf(page) { return S.sha256Hex(JSON.stringify(page)); }

// The job as saved: scope_json holds the LATEST saved revision's seal, correctly stamped (the 36de77ad reader trusted it).
async function walkPatio(over) {
  const o = Object.assign({ n: 1, page: REV1_PAGE }, over || {});
  const frozen = 'frz-walk-000' + o.n;
  const seal = {
    frozen: { id: frozen, schemaVersion: 'frozen-revision/v1' },
    stamps: [
      { frozenRevisionId: frozen, scopeRevisionId: 'rev-' + o.n, kind: 'installer-sow', scopeLineIds: [], contentHash: await stampOf(o.page) },
      { frozenRevisionId: frozen, scopeRevisionId: 'rev-' + o.n, kind: 'customer-quote', scopeLineIds: [], contentHash: 'f'.repeat(64) },
    ],
    documents: { 'installer-sow': o.page },
    check: { ok: true, problems: [] },
  };
  return {
    id: '5e0a0000-0000-4000-8000-000000000721', type: 'patio', status: 'awaiting_deposit',
    scope_json: {
      tool: 'patio-scoper', version: '2.0', family: 'skillion', supported: true, lines: [],
      revision: { n: o.n, scopeRevisionId: 'rev-' + o.n, parentRevisionId: null, frozenId: frozen, catalogueRevisionId: 'cat-1', sealedAt: '2026-11-12T10:43:00.000Z', outputsAgree: true },
      // The tool's starting figures, as the walk's record kept them: 3 posts (postsAuto) and 2,600 mm at the front.
      draft: { site: { storeys: 'single', houseRoof: 'tile', fascia: 'timber', windClass: 'N2', sampleHeights: true },
        design: { shape: 'skillion', fixing: 'fascia', widthMm: 6000, projectionMm: 4000, frontHeightMm: 2600, pitchDeg: 3, posts: 3, postsAuto: true,
          products: { covering: 'panel:solarspan:75', post: 'shs:90x90x2.0:c450l0' }, colours: { frame: 'CB-SURFMIST', roof: 'CB-SURFMIST', trim: 'CB-SURFMIST' }, downpipes: 'both' } },
      earlier: [], savedAt: '2026-11-12T10:44:00.000Z',
      sealed: { seal, build: {}, warnings: 0 },
    },
  };
}

// What the trade view (ops-api trade_job_detail) sends beside the job: the accepted, released revision's page.
async function acceptedView(n, page, over) {
  return { crew_scope_of_works: Object.assign({
    status: 'accepted', page, content_hash: await stampOf(page), revision: { n, frozen_revision_id: 'frz-walk-000' + n },
  }, over || {}) };
}
const NOT_PROVED = { crew_scope_of_works: { status: 'not_proved', reason: 'No accepted quote on this job is bound to a sealed revision.' } };

async function shown(t) { await settle(); return t.frames.map((f) => f.srcdoc); }

test('the stamp is the Scope Engine\'s: same sha256 as scope-engine-v2 shared/hash.ts canonicalHash', async () => {
  const sample = '<!doctype html><html><head><title>Crew scope</title></head><body><h1>Rev 1</h1><p>2 posts, 2,151 mm "check"</p>\n<svg viewBox="0 0 800 600"></svg></body></html>';
  assert.equal(await S.sha256Hex(S.stampedText(sample)), 'b52f45470dd395b7e91506b679b9ad710753869c102c8815c95d209f61853d06');
});

test('patio: the crew sees the accepted revision\'s crew scope of works, the page the trade view sent, byte for byte', async () => {
  const t = tradeScope();
  const html = t.render(await walkPatio(), await acceptedView(1, REV1_PAGE));
  assert.match(html, /<h3>Crew scope of works, Rev 1<\/h3>/);
  const pages = await shown(t);
  assert.equal(pages.length, 1, 'one frame, the kept page');
  assert.equal(t.frames[0].attrs.sandbox, 'allow-same-origin', 'the page runs no script');
  // The frame holds the kept page unchanged; only the Scope Engine's own no-script policy is added to its head.
  assert.equal(pages[0], S.framePage(REV1_PAGE));
  assert.equal(pages[0].replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), REV1_PAGE);
  const box = Object.values(t.boxes)[0];
  assert.equal(box.attrs['data-sealed-crew-scope-status'], 'matches');
  assert.equal(box.note.textContent, 'The revision the customer accepted, as sealed in the Scope Engine. The same page the office sees.');
  // Never the old patio shape and never a figure worked out here: no 3 posts, no 2,600.
  assert.doesNotMatch(html, /Posts|2,?600|Post height:/);
});

test('patio: Rev 1 accepted, Rev 2 saved later: Rev 1\'s page shows, Rev 2\'s never does', async () => {
  const t = tradeScope();
  // The latest save is a correctly stamped Rev 2 (9,000 mm); the customer accepted Rev 1 (6,000 mm).
  const job = await walkPatio({ n: 2, page: REV2_PAGE });
  const html = t.render(job, await acceptedView(1, REV1_PAGE));
  const pages = await shown(t);
  assert.equal(pages.length, 1);
  assert.equal(pages[0], S.framePage(REV1_PAGE), 'the accepted Rev 1 page');
  assert.match(html, /Crew scope of works, Rev 1/);
  for (const seen of [html, ...pages]) {
    assert.doesNotMatch(seen, /9,000|Rev 2/, 'the newer saved Rev 2 is never shown');
  }
});

test('patio: the accepted binding cannot be proved: one line says why, nothing else is shown', async () => {
  const t = tradeScope();
  const html = t.render(await walkPatio({ n: 2, page: REV2_PAGE }), NOT_PROVED);
  const pages = await shown(t);
  assert.equal(pages.length, 0, 'no page');
  assert.equal(text(html), 'Crew scope of works No accepted quote on this job is bound to a sealed revision. So no crew scope of works is shown. Ask the office for it.');
  assert.doesNotMatch(html, /9,000|6,000|Rev \d|Build spec|Posts|2,?600/);
});

test('patio: the trade view sent no crew scope of works (older office system): says so, never the saved scope', async () => {
  const t = tradeScope();
  const html = t.render(await walkPatio({ n: 2, page: REV2_PAGE }));
  assert.equal((await shown(t)).length, 0);
  assert.match(text(html), /has not come through to this phone, so nothing is shown/);
  assert.doesNotMatch(html, /9,000|Rev \d|Build spec|Posts|2,?600/);
});

test('patio: a page changed on its way to the phone, or sent without a page or stamp, is not shown, and says so', async () => {
  const altered = REV1_PAGE.replace(/\b\d{3,}\b/g, ''); // as a money strip that takes out bare numbers would leave it
  const cases = [
    [{ page: altered, content_hash: await stampOf(REV1_PAGE) }, /not the page that was sealed, so it is not shown/],
    [{ page: '' }, /accepted crew scope of works is not on this phone/],
    [{ content_hash: null }, /could not be checked against its seal/],
  ];
  for (const [over, words] of cases) {
    const t = tradeScope();
    const html = t.render(await walkPatio(), await acceptedView(1, REV1_PAGE, over));
    assert.equal((await shown(t)).length, 0);
    const box = Object.values(t.boxes)[0];
    assert.match(box ? box.note.textContent : text(html), words);
    assert.doesNotMatch(html, /Build spec|Posts|2,?600/);
  }
});

test('the 3D model is not offered where the crew scope of works decides the Scope tab (it reads the latest save)', () => {
  const block = cut(TRADE, '    // 3D model button (inside scope flow, not standalone)', '    // Office staff: open this job in the Scope Engine');
  assert.match(block, /SealedCrewScope\.applies\(data\)\) return;/);
});

test('patio from the older patio page: its build spec is unchanged', () => {
  const t = tradeScope();
  const html = t.render({ id: 'old-1', type: 'patio', scope_json: { config: { length: 6, projection: 4, roofStyle: 'skillion', posts: 3, postSize: '90x90' } } });
  assert.match(html, /<h3>Build spec<\/h3>/);
  assert.match(html, /6m × 4m/);
  assert.match(text(html), /Posts 3 × 90×90mm SHS posts/);
  assert.equal(t.frames.length, 0);
});

// A Scope Engine fence job as saved (fence/index.html: the job, its runs and gates, and each sealed revision's pack).
function fenceJob(lengthM, packs) {
  const runs = [{ id: 'r1', name: 'Rear', length: lengthM, sheetHeight: 1800, panels: Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i })) }];
  const gates = [{ id: 'g1', type: 'pedestrian', width: 900, runIndex: 0, afterPanel: 3 }];
  const job = { runs, gates, profile: 'Sameside', colour: 'Monument' };
  if (packs) job.revisionPacks = packs;
  return { id: 'f-1', type: 'fencing', scope_json: { job } };
}
const fencePage = (n, m) => '<!doctype html><html><head><title>Scope of works</title></head><body><h1>Scope of works</h1><p>Rev ' + n + '. Rear run ' + m + ' m, Sameside, Monument, one pedestrian gate 900 mm.</p></body></html>';

// Today's View 3D Model entry, cut out of trade.html as shipped (renderScopeTab's 3D block).
function trade3dEntry(data) {
  const block = cut(TRADE, '    // 3D model button (inside scope flow, not standalone)', '    // Office staff: open this job in the Scope Engine');
  const ctx = { window: { SealedCrewScope: S }, job: data.job, data, h: '' };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  return ctx.h;
}

// Director's ruling, 12 Nov 2026, 9:16 pm: the trade view sends null for every fence job (secureworks-backend
// trade_crew_scope_of_works.ts), so a fence stays on today's Scope tab: its build spec and its 3D entry.
test('fence: a new-tool fence with sealed revisions and a null crew scope of works keeps today\'s build spec and 3D', () => {
  const job = fenceJob(24.5, [{ n: 1, code: '10B4Z4S' }, { n: 2, code: '10B4Z5T' }]);
  const view = { crew_scope_of_works: null };
  assert.equal(S.applies(Object.assign({ job }, view)), false, 'the crew scope route is for a new-tool patio only');
  const t = tradeScope();
  const html = t.render(job, view);
  const seen = text(html);
  // Byte for byte the build spec today's Trade App draws for this job (the same job with no sealed revisions).
  const today = tradeScope().render(fenceJob(24.5), view);
  assert.equal(html, today);
  assert.match(seen, /^Build spec 24\.5m total length/);
  assert.match(seen, /Colour Monument/);
  assert.match(seen, /Gates pedestrian 900mm/);
  assert.doesNotMatch(seen, /has not come through|Crew scope of works/);
  assert.equal(t.frames.length, 0);
  // Today's View 3D Model entry is still offered.
  assert.match(trade3dEntry(Object.assign({ job }, view)), /View 3D Model/);
  assert.equal(trade3dEntry(Object.assign({ job }, view)), trade3dEntry({ job: fenceJob(24.5), crew_scope_of_works: null }));
  // And with no field at all (the trade view left it out), the same.
  assert.equal(tradeScope().render(job), today);
  assert.match(trade3dEntry({ job }), /View 3D Model/);
});

test('patio: a new-tool patio still hides the 3D entry (it reads the latest save)', async () => {
  const job = await walkPatio();
  job.scope_json.length = 6; // so the old 3D rule would offer it, and only the crew scope route holds it back
  assert.equal(trade3dEntry(Object.assign({ job }, await acceptedView(1, REV1_PAGE))), '');
  assert.equal(trade3dEntry({ job, crew_scope_of_works: null }), '');
});

test('fence from the older fence designer (nothing sealed): its build spec is unchanged', () => {
  const t = tradeScope();
  const seen = text(t.render(fenceJob(18.6)));
  assert.match(seen, /^Build spec 18\.6m total length/);
  assert.match(seen, new RegExp('Material ' + t.humanise('material', 'Sameside')));
  assert.match(seen, /Colour Monument/);
  assert.match(seen, /Gates pedestrian 900mm/);
  assert.equal(t.frames.length, 0);
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
