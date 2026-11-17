const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const root = resolve(__dirname, '../..');
const files = ['pay', 'invoice', 'invoices', 'review', 'timesheet', 'group', 'workorders', 'charges', 'receipt']
  .map((name) => `crew/js/screens/${name}.js`).concat(['crew/js/ui/paybits.js', 'crew/js/lib/invoice.js']);

// Read literal text, skipping comments and expressions inside template strings.
function literals(src) {
  let i = 0; const out = [];
  function quoted(q) {
    i++; let text = '';
    while (i < src.length) {
      const c = src[i++];
      if (c === '\\') { text += src[i++] || ''; continue; }
      if (c === q) { out.push(text); return; }
      if (q === '`' && c === '$' && src[i] === '{') { out.push(text); text = ''; i++; code(true); }
      else text += c;
    }
  }
  function code(nested = false) {
    while (i < src.length) {
      const c = src[i];
      if (src.startsWith('//', i)) { const end = src.indexOf('\n', i); i = end < 0 ? src.length : end + 1; }
      else if (src.startsWith('/*', i)) { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; }
      else if (c === '"' || c === "'" || c === '`') quoted(c);
      else if (nested && c === '}') { i++; return; }
      else if (c === '{') { i++; code(true); }
      else i++;
    }
  }
  code(); return out;
}

test('ZZTEST pay screen literals use the approved pay words', () => {
  const bad = [];
  for (const file of files) {
    const source = process.env.PAY_WORDS_BASE
      ? execFileSync('git', ['show', `${process.env.PAY_WORDS_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
      : readFileSync(resolve(root, file), 'utf8');
    for (const text of literals(source)) {
      if (/taken off|take off|withheld|deducted|weekly deduction/i.test(text) && /\s/.test(text)) bad.push(file + ': ' + text.trim());
    }
  }
  assert.deepEqual(bad, []);
});
