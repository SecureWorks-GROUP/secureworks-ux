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
  '$4,000 profit on $15,000 invoiced, 2 jobs with complete costs (2 jobs Unknown, not counted)',
  'profit line uses margin_known_invoiced',
);
let c = ctx.jplCostsCard(fullSummary, fmt);
eq(c.label, 'Placed Costs', 'costs label');
eq(c.value, '$12,500', 'placed costs value');
eq(c.sub, 'Not complete: 2 jobs with costs Unknown', 'costs_complete false shown');
eq(c.complete, false, 'complete flag');
c = ctx.jplCostsCard(Object.assign({}, fullSummary, { costs_complete: true, jobs_margin_unknown: 0 }), fmt);
eq(c.sub, 'Costs complete', 'costs_complete true shown');

// ── new response, basic detail (no margin_known_invoiced) ──
const basicSummary = Object.assign({}, fullSummary);
delete basicSummary.margin_known_invoiced;
eq(
  ctx.jplProfitLine(basicSummary, fmt),
  '$4,000 profit on 2 jobs with complete costs (2 jobs Unknown, not counted)',
  'basic profit line never divides by all invoiced',
);

// ── new response, nothing known ──
const none = { total_invoiced: 8000, total_bills: 0, total_margin: null, avg_margin_pct: null, jobs_margin_known: 0, jobs_margin_unknown: 1, costs_complete: false, total_bills_basis: 'placed_costs_only' };
eq(ctx.jplAvgMarginText(none), 'Unknown', 'avg Unknown, never null% or 0%');
eq(ctx.jplProfitLine(none, fmt), 'No job has complete costs yet (1 job Unknown, not counted)', 'nothing known');

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

console.log('PASS job-pl-money');
