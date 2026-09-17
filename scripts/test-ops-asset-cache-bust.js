// Guard for ops.html module cache-bust. Pages deploys from main with no rewrite
// step, so frozen ?v= tags used to leave a signed-in browser on the previous
// module after a merge. This runs the shipped __swOpsStampAssets helper and
// checks a second stamp writes a different URL.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('ops.html', 'utf8');
function fail(m) { console.error('FAIL ops-asset-cache-bust: ' + m); process.exit(1); }

const OPEN = '// <ops-asset-cache-bust>';
const CLOSE = '// </ops-asset-cache-bust>';
const a = html.indexOf(OPEN);
const b = html.indexOf(CLOSE);
if (a < 0 || b <= a) fail('ops-asset-cache-bust sentinels missing from ops.html');

let tick = 1700000000000;
const writes = [];
const ctx = {
  window: {},
  document: { write(s) { writes.push(String(s)); } },
  Date: { now() { return tick++; } },
};
vm.createContext(ctx);
vm.runInContext(html.slice(a + OPEN.length, b), ctx);
const stamp = ctx.window.__swOpsStampAssets;
if (typeof stamp !== 'function') fail('__swOpsStampAssets was not defined');

writes.length = 0;
stamp([{ t: 'js', u: 'modules/ops-sales-booking.js?v=1' }]);
stamp([{ t: 'css', u: 'modules/ops-sales-booking.css?v=1' }]);
if (writes.length !== 2) fail('expected 2 stamped tags, got ' + writes.length);
if (writes[0] !== '<script src="modules/ops-sales-booking.js?v=1700000000000"><\/script>') {
  fail('js stamp mismatch: ' + writes[0]);
}
if (writes[1] !== '<link rel="stylesheet" href="modules/ops-sales-booking.css?v=1700000000001">') {
  fail('css stamp mismatch: ' + writes[1]);
}

writes.length = 0;
stamp([{ t: 'js', u: 'modules/ops-sales-booking.js?v=1' }]);
if (writes[0] !== '<script src="modules/ops-sales-booking.js?v=1700000000002"><\/script>') {
  fail('second load must use a new query, got ' + writes[0]);
}

console.log('PASS ops-asset-cache-bust: loader restamps booking js/css, second load gets a new query');
