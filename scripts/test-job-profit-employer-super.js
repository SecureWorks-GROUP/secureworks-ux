// Actual synthetic SQL -> backend response capture -> shipped renderer.
// No browser/auth, original-provider, live money or staff acceptance claim.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const baseline = process.argv.includes('--baseline');
const html = baseline ? cp.execFileSync('git', ['show', '962a000a:ops.html'], {encoding:'utf8',maxBuffer:8*1024*1024}) : fs.readFileSync('ops.html','utf8');
const data = require('../tests/fixtures/job-profit-employer-super.json').response;
function slice(a,b) { const start=html.indexOf(a),end=html.indexOf(b,start);assert(start>=0&&end>start);return html.slice(start,end); }
const ctx={};vm.createContext(ctx);
vm.runInContext(slice('function fmt$(n, reason)', 'function fmtDate(d)'),ctx);
vm.runInContext(slice('var JP_PAGE = 100;', '// ── Company view: server rollup only'),ctx);
const output=ctx._jpRenderDetail(data);
assert.equal((output.match(/data-label="Source">Employer super/g)||[]).length,6,'every original employer obligation has the right source label');
assert.equal((output.match(/data-label="Event">Employer super/g)||[]).length,6,'timeline identifies employer super, not supplier bills');
assert(!output.includes('share of super is not added'),'no false blanket super exclusion');
assert(output.includes('Missing super records do not mean zero or verified cost-close'));
assert(output.includes('paying a trade invoice does not prove payment to the super fund'));
assert(output.includes('$2,949.11'),'engine labour figure reaches detail unchanged');
assert(output.includes('Profit and margin unknown.'),'incomplete GP remains Unknown');
const rows=[...output.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>m[1]);
const employer=rows.filter(r=>r.includes('data-label="Source">Employer super'));
assert(employer.every(r=>r.includes('Not paid')&&!r.includes('Paid (Xero)')),'cash bill does not settle employer obligation');
assert(employer.some(r=>r.includes('No date')),'missing work date remains unknown');
assert(employer.some(r=>r.includes('not actual')),'advance super remains visible but not actual');
const original=JSON.stringify(data);
ctx._jpRenderDetail(data);assert.equal(JSON.stringify(data),original,'render does not mutate money');
console.log(JSON.stringify({result:'PASS',baseline,assertions:11,super_rows:employer.length,limits:'local SQL/API capture plus actual renderer in VM; no signed-in browser or visual review'}));
