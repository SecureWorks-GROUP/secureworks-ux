// Guard for the dev-only agentation note toolbar gate in ops.html
// (`<ops-annotate-gate>`, dev/annotate/README.md). Runs the shipped gate against
// a set of addresses: it may write the boot script only on localhost or
// 127.0.0.1 with ?annotate, and must write nothing anywhere else.
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('ops.html', 'utf8');
function fail(m) { console.error('FAIL ops-annotate-gate: ' + m); process.exit(1); }

const OPEN = '// <ops-annotate-gate>';
const CLOSE = '// </ops-annotate-gate>';
const a = html.indexOf(OPEN);
const b = html.indexOf(CLOSE);
if (a < 0 || b <= a) fail('ops-annotate-gate sentinels missing from ops.html');
if (a > html.indexOf('supabase-js')) fail('the gate must run before Supabase loads');
const gate = html.slice(a + OPEN.length, b);

function writesFor(href) {
  const u = new URL(href);
  const writes = [];
  const ctx = {
    window: { location: { hostname: u.hostname, search: u.search } },
    document: { write(s) { writes.push(String(s)); } },
  };
  vm.createContext(ctx);
  vm.runInContext(gate, ctx);
  return writes;
}

const BOOT = '<script src="dev/annotate/boot.js"><\/script>';
const on = [
  'http://localhost:4173/ops.html?annotate',
  'http://127.0.0.1:4173/ops.html?annotate=1',
  'http://localhost:8000/ops.html?debt=1&annotate#calendar',
];
const off = [
  'https://secureworks-group.github.io/secureworks-ux/ops.html?annotate',
  'https://ops.secureworkswa.com.au/ops.html?annotate',
  'http://localhost.example.com/ops.html?annotate',
  'http://192.168.1.20:4173/ops.html?annotate',
  'http://localhost:4173/ops.html',
  'http://localhost:4173/ops.html?annotated=1',
  'http://localhost:4173/ops.html?noannotate',
  'http://localhost:4173/ops.html#annotate',
  'file:///Users/someone/ops.html?annotate',
];
for (const href of on) {
  const w = writesFor(href);
  if (w.length !== 1 || w[0] !== BOOT) fail('expected the boot script on ' + href + ', got ' + JSON.stringify(w));
}
for (const href of off) {
  const w = writesFor(href);
  if (w.length) fail('the gate wrote ' + JSON.stringify(w) + ' on ' + href);
}
console.log('PASS ops-annotate-gate: toolbar loads only on localhost/127.0.0.1 with ?annotate (' + on.length + ' on, ' + off.length + ' off)');
