// Guard for the index.html Job P&L money words (CFO-01 / R-22). Runs the
// shipped block between the <job-pl-money> sentinels against the new
// reporting-api job_profitability response (full and basic detail) and the old
// one, so an unknown margin never reads "null%" and the old response still
// renders as before.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
function fail(m) { console.error('FAIL job-pl-money: ' + m); process.exit(1); }
function eq(a, b, m) { if (a !== b) fail(m + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

const OPEN = '// <job-pl-money>';
const CLOSE = '// </job-pl-money>';
const a = html.indexOf(OPEN);
const b = html.indexOf(CLOSE);
if (a < 0 || b <= a) fail('job-pl-money sentinels missing from index.html');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(html.slice(a + OPEN.length, b), ctx);
// The page's own fmt$ (index.html), copied: null reads Unknown.
const fmt = (n) => (n == null || n === '' || isNaN(n) || !isFinite(n)) ? 'Unknown' : '$' + Math.round(Number(n)).toLocaleString('en-AU');

// ── margin % cell ──
eq(ctx.jplMarginPctCell({ margin_pct: 30 }), '30%', 'known margin');
eq(ctx.jplMarginPctCell({ margin_pct: 0 }), '0%', 'a real 0% margin stays 0%');
eq(
  ctx.jplMarginPctCell({ margin_pct: null, margin_status: 'unknown', margin_reason: 'Unknown: no cost linked to the job yet' }),
  'Unknown<br><small style="color:var(--sw-text-sec);">no cost linked to the job yet</small>',
  'unknown margin shows its reason',
);
eq(ctx.jplMarginPctCell({ margin_pct: null }), 'Unknown', 'unknown with no reason');
if (ctx.jplMarginPctCell({ margin_pct: null }).includes('null')) fail('null% rendered');
eq(
  ctx.jplMarginPctCell({ margin_pct: null, margin_reason: 'Unknown: <b>x</b>' }),
  'Unknown<br><small style="color:var(--sw-text-sec);">&lt;b&gt;x&lt;/b&gt;</small>',
  'reason is escaped',
);

// ── new response, full detail (staff) ──
const fullSummary = {
  total_jobs: 5, total_invoiced: 29000, total_bills: 12500, total_margin: 4000,
  avg_margin_pct: 26.7, jobs_margin_known: 2, jobs_margin_unknown: 2,
  margin_known_invoiced: 15000, costs_complete: false, total_bills_basis: 'placed_costs_only',
};
eq(ctx.jplAvgMarginText(fullSummary), '26.7%', 'avg margin');
eq(
  ctx.jplProfitLine(fullSummary, fmt),
  '$4,000 profit on $15,000 invoiced, 2 jobs with calculated margins (2 jobs Unknown, not counted)',
  'profit line uses margin_known_invoiced',
);
let c = ctx.jplCostsCard(fullSummary, fmt);
eq(c.label, 'Placed Costs', 'costs label');
eq(c.value, '$12,500', 'placed costs value');
eq(c.sub, 'Not complete: 2 jobs with margin Unknown', 'costs_complete false shown');
eq(c.complete, false, 'complete flag');
c = ctx.jplCostsCard(Object.assign({}, fullSummary, { costs_complete: true, jobs_margin_unknown: 0 }), fmt);
eq(c.sub, 'Placed costs only; cost-close not verified', 'costs_complete true shown');

// ── new response, basic detail (no margin_known_invoiced) ──
const basicSummary = Object.assign({}, fullSummary);
delete basicSummary.margin_known_invoiced;
eq(
  ctx.jplProfitLine(basicSummary, fmt),
  '$4,000 profit on 2 jobs with calculated margins (2 jobs Unknown, not counted)',
  'basic profit line never divides by all invoiced',
);

// ── new response, nothing known ──
const none = { total_invoiced: 8000, total_bills: 0, total_margin: null, avg_margin_pct: null, jobs_margin_known: 0, jobs_margin_unknown: 1, costs_complete: false, total_bills_basis: 'placed_costs_only' };
eq(ctx.jplAvgMarginText(none), 'Unknown', 'avg Unknown, never null% or 0%');
eq(ctx.jplProfitLine(none, fmt), 'No job has a calculated margin yet (1 job Unknown, not counted)', 'nothing known');

// ── old response: renders as before ──
const old = { total_jobs: 3, total_invoiced: 10000, total_bills: 3400, total_margin: 6600, avg_margin_pct: 66, data_sources: {}, xero_projects_matched: 0 };
eq(ctx.jplAvgMarginText(old), '66%', 'old avg');
eq(ctx.jplProfitLine(old, fmt), '$6,600 profit on $10,000 invoiced', 'old profit line');
c = ctx.jplCostsCard(old, fmt);
eq(c.label, 'Total Costs', 'old costs label');
eq(c.value, '$3,400', 'old costs value');
eq(c.sub, '', 'old costs sub');
eq(ctx.jplProfitLine({ total_invoiced: 0, total_margin: 0 }, fmt), '', 'old empty');
eq(ctx.jplMarginPctCell({ margin_pct: 100 }), '100%', 'old row');

// ── screen cases: the shipped scatter and table code in a minimal DOM ──
// (Codex CFO-01 second-model review of #536 at 012c8caf.) These run the real
// renderJobScatter, apexRender and renderJobPLTable from index.html, with the
// chart host markup read from the page, a fake ApexCharts and a fake DOM. They
// do not prove a browser paints the chart, only what the code does to the DOM.
const results = [];
function check(name, fn) {
  try { fn(); results.push([name, null]); } catch (e) { results.push([name, e.message]); }
}
function must(cond, m) { if (!cond) throw new Error(m); }
function same(x, y, m) { if (x !== y) throw new Error(m + ': expected ' + JSON.stringify(y) + ', got ' + JSON.stringify(x)); }
function slice(from, to) {
  const i = html.indexOf(from);
  const j = i < 0 ? -1 : html.indexOf(to, i + from.length);
  if (i < 0 || j < 0) fail('anchor missing from index.html: ' + from);
  return html.slice(i, j);
}
function stripTags(h) { return String(h).replace(/<[^>]*>/g, ''); }
function makeEl(tag, id) {
  const el = { tagName: tag, id: id || '', children: [], parentElement: null, style: {}, _html: '', _text: '' };
  function detach() { el.children.forEach((c) => { c.parentElement = null; }); el.children = []; }
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html + el.children.map((c) => c.innerHTML).join(''); },
    set(v) { detach(); el._html = String(v); el._text = ''; },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text || stripTags(el.innerHTML); },
    set(v) { detach(); el._html = ''; el._text = String(v); },
  });
  el.appendChild = (c) => { c.parentElement = el; el.children.push(c); return c; };
  return el;
}
// The chart wrapper exactly as the page marks it up: every id inside it.
function scatterDom() {
  const start = html.indexOf('<div id="jplScatterChart">');
  if (start < 0) fail('jplScatterChart host missing from index.html markup');
  const open = html.lastIndexOf('<div class="chart-wrapper"', start);
  const close = html.indexOf('</div>\n      </div>', start);
  const ids = [...html.slice(open, close).matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const root = makeEl('div', 'root');
  const wrapper = root.appendChild(makeEl('div', 'wrapper'));
  ids.forEach((id) => wrapper.appendChild(makeEl(id === 'jplScatterChart' ? 'div' : 'p', id)));
  return { root, wrapper };
}
function visibleText(el) {
  return (el._text || stripTags(el._html)) + el.children
    .filter((c) => c.style.display !== 'none').map(visibleText).join('');
}
function screenCtx() {
  const { root, wrapper } = scatterDom();
  const tbody = root.appendChild(makeEl('tbody', 'jplTableBody'));
  const charts = [];
  function find(el, id) {
    if (el.id === id) return el;
    for (const c of el.children) { const f = find(c, id); if (f) return f; }
    return null;
  }
  const sctx = {
    document: { getElementById: (id) => find(root, id), createElement: (t) => makeEl(t) },
    ApexCharts: function (el, options) {
      this.el = el; this.options = options; this.destroyed = false; charts.push(this);
      this.render = () => { el._html = '<svg class="apex"></svg>'; this.rendered = true; };
      this.destroy = () => { this.destroyed = true; };
    },
    apexOpts: (o) => o,
    fmt$: fmt,
    STATUS_LABELS: {},
  };
  sctx.window = sctx;
  vm.createContext(sctx);
  vm.runInContext(html.slice(a + OPEN.length, b), sctx);
  vm.runInContext(slice('function apexRender(', '\n// ═'), sctx);
  vm.runInContext(slice('function marginTdClass(', 'function toggleJobDetail('), sctx);
  vm.runInContext(slice('var _jplScatterChart = null;', '// ── MARKETING TAB'), sctx);
  return { sctx, root, wrapper, tbody, charts };
}
const reason = 'Unknown: no cost linked to the job yet';
const unknownOnly = [
  { job_number: 'TEST-CFO01', client_name: 'Synthetic A', type: 'patio', status: 'invoiced', invoiced: 8000, margin_pct: null, margin_status: 'unknown', margin_reason: reason },
  { job_number: 'TEST-CFO02', client_name: 'Synthetic B', type: 'fencing', status: 'invoiced', invoiced: 3000, margin_pct: null, margin_status: 'unknown', margin_reason: reason },
];
const knownJobs = [
  { job_number: 'TEST-CFO01', client_name: 'Synthetic A', type: 'patio', status: 'invoiced', invoiced: 8000, margin: 2400, margin_pct: 30, margin_status: 'known' },
];
const unknownWords = 'No margins are known yet, so nothing is plotted: 2 invoiced jobs have margin Unknown (no cost linked to the job yet).';

check('control: a fresh page with known margins draws the chart', () => {
  const t = screenCtx();
  t.sctx.renderJobScatter(knownJobs);
  must(t.charts.length === 1 && t.charts[0].rendered, 'no chart rendered');
  must(t.charts[0].el === t.sctx.document.getElementById('jplScatterChart'), 'chart not drawn into the host');
});

check('Unknown-only then a known reload: host stays, chart renders', () => {
  const t = screenCtx();
  t.sctx.renderJobScatter(knownJobs);
  t.sctx.renderJobScatter(unknownOnly);
  const host = t.sctx.document.getElementById('jplScatterChart');
  must(host, 'jplScatterChart host removed by the Unknown-only state');
  must(t.charts[0].destroyed, 'old chart left alive behind the Unknown-only words');
  t.sctx.renderJobScatter(knownJobs);
  must(t.charts.length === 2 && t.charts[1].rendered, 'known reload drew no chart (' + t.charts.length + ' charts)');
  must(t.charts[1].el === host && host.style.display !== 'none', 'known reload chart not in a visible host');
  must(!visibleText(t.wrapper).includes('No margins are known yet'), 'Unknown words still showing over the chart');
});

check('Unknown-only from a fresh page, then known: chart renders', () => {
  const t = screenCtx();
  t.sctx.renderJobScatter(unknownOnly);
  must(t.sctx.document.getElementById('jplScatterChart'), 'host removed');
  t.sctx.renderJobScatter(knownJobs);
  must(t.charts.length === 1 && t.charts[0].rendered, 'known reload after a fresh Unknown-only page drew no chart');
});

check('Unknown-only words say no margin is known yet, with the reason', () => {
  const t = screenCtx();
  t.sctx.renderJobScatter(unknownOnly);
  same(visibleText(t.wrapper), unknownWords, 'Unknown-only words');
  same(typeof t.sctx.jplScatterEmptyText, 'function', 'jplScatterEmptyText exists');
  same(t.sctx.jplScatterEmptyText([unknownOnly[0]]),
    'No margins are known yet, so nothing is plotted: 1 invoiced job has margin Unknown (no cost linked to the job yet).', 'one job');
  same(t.sctx.jplScatterEmptyText([unknownOnly[0], Object.assign({}, unknownOnly[1], { margin_reason: 'Unknown: bills not all placed' })]),
    'No margins are known yet, so nothing is plotted: 2 invoiced jobs have margin Unknown (each reason is shown against the job in the table below).', 'two reasons');
  same(t.sctx.jplScatterEmptyText([]), 'No invoiced jobs to plot yet', 'no jobs at all');
  same(t.sctx.jplScatterEmptyText([{ invoiced: 0, margin_pct: null }]), 'No invoiced jobs to plot yet', 'nothing invoiced');
  const words = visibleText(t.wrapper);
  must(!/\b0%|null|zero/i.test(words), 'Unknown-only words imply zero: ' + words);
});

const hostile = { job_number: 'TEST-CFO01', client_name: 'Smith <b>& Sons</b>', suburb: 'Sub<urb & Co', type: 'patio', status: 'invoiced', invoiced: 5000, quote_value: 6000, bills: 3500, margin: 1500, margin_pct: 30, margin_status: 'known' };
check('table shows job_number and client_name, escaped', () => {
  const t = screenCtx();
  t.sctx.renderJobPLTable([hostile]);
  const body = t.tbody.innerHTML;
  const cell = body.split('<td>')[2] || '';
  must(cell.includes('TEST-CFO01'), 'job_number not shown: ' + cell);
  must(cell.includes('Smith &lt;b&gt;&amp; Sons&lt;/b&gt;'), 'client_name not shown escaped: ' + cell);
  must(cell.includes('Sub&lt;urb &amp; Co'), 'suburb not escaped: ' + cell);
  must(!body.includes('<b>') && !body.includes('<urb'), 'raw markup from the job reached the table');
  must(!cell.startsWith('—'), 'identity fell into a dash');
  // the old response (client, no job_number) still shows its name
  t.sctx.renderJobPLTable([{ client: 'Old Client', type: 'patio', status: 'invoiced', invoiced: 1, margin_pct: 10 }]);
  must((t.tbody.innerHTML.split('<td>')[2] || '').startsWith('Old Client'), 'old response client lost');
});

check('scatter tooltip shows job_number and client_name, escaped', () => {
  const t = screenCtx();
  t.sctx.renderJobScatter([hostile]);
  must(t.charts.length === 1, 'no chart rendered');
  const opts = t.charts[0].options;
  const tip = opts.tooltip.custom({ seriesIndex: 0, dataPointIndex: 0, w: { config: opts } });
  must(tip.includes('TEST-CFO01, Smith &lt;b&gt;&amp; Sons&lt;/b&gt;: $5,000 rev, 30% margin (Sub&lt;urb &amp; Co)'), 'tooltip identity: ' + tip);
  must(!tip.includes('<b>'), 'raw markup in the tooltip');
});

let failed = 0;
results.forEach(([name, err]) => {
  if (err) { failed++; console.error('FAIL job-pl-money screen: ' + name + ': ' + err); }
  else console.log('ok   job-pl-money screen: ' + name);
});
if (failed) process.exit(1);

console.log('PASS job-pl-money');
