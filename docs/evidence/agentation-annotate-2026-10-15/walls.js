// Run from the repo root with the repo served on 127.0.0.1:4791 (python3 -m http.server 4791 --bind 127.0.0.1)
// and port 4747 free: node docs/evidence/agentation-annotate-2026-10-15/walls.js <output dir>
const { chromium } = require(process.cwd() + '/node_modules/@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const out = [];
  // 1. localhost without ?annotate: nothing from dev/annotate is fetched.
  let ctx = await browser.newContext(); let page = await ctx.newPage(); const reqs = [];
  page.on('request', r => reqs.push(r.url()));
  await page.goto('http://127.0.0.1:4791/ops.html'); await page.waitForTimeout(2000);
  out.push('no ?annotate: dev/annotate requests=' + reqs.filter(u => u.includes('dev/annotate')).length + ', __SW_ANNOTATE=' + await page.evaluate(() => typeof window.__SW_ANNOTATE) + ', supabase stand-in=' + await page.evaluate(() => !!(window.supabase && window.supabase.createClient && String(window.supabase.createClient).includes('auth: auth'))));
  await ctx.close();
  // 2. ?annotate: writes refused, other hosts refused, CSP blocks a raw XHR to Supabase.
  ctx = await browser.newContext(); page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4791/ops.html?annotate'); await page.waitForFunction(() => window.__SW_ANNOTATE && window.__SW_ANNOTATE.toolbar !== 'starting');
  out.push('?annotate: ' + JSON.stringify(await page.evaluate(async () => {
    const post = await fetch(window.SUPABASE_URL + '/functions/v1/ops-api?action=add_note', { method: 'POST', body: '{}' });
    let other; try { await fetch('https://example.com/x'); other = 'reached'; } catch (e) { other = 'refused: ' + e.message; }
    const xhr = await new Promise(ok => { const x = new XMLHttpRequest(); x.open('GET', window.SUPABASE_URL + '/rest/v1/jobs'); x.onerror = () => ok('blocked'); x.onload = () => ok('reached ' + x.status); x.send(); });
    return { write: post.status + ' ' + (await post.json()).error, otherHost: other, rawXhrToSupabase: xhr };
  })));
  await ctx.close();
  // 3. ?annotate on an address holding a real sign-in: toolbar refuses, React never loads.
  ctx = await browser.newContext(); page = await ctx.newPage(); const r3 = [];
  page.on('request', r => r3.push(r.url()));
  await page.goto('http://127.0.0.1:4791/ops.html'); await page.evaluate(() => localStorage.setItem('sb-kevgrhcjxspbxgovpmfl-auth-token', '{}'));
  await page.goto('http://127.0.0.1:4791/ops.html?annotate'); await page.waitForFunction(() => window.__SW_ANNOTATE && window.__SW_ANNOTATE.toolbar !== 'starting');
  out.push('real sign-in held: toolbar=' + await page.evaluate(() => window.__SW_ANNOTATE.toolbar) + ', vendor requests=' + r3.filter(u => u.includes('vendor/')).length + ', banner="' + await page.locator('#swAnnotateBanner').textContent() + '"');
  await ctx.close(); await browser.close();
  console.log(out.join('\n'));
})();
