// Run from the repo root with the repo served on 127.0.0.1:4791 (python3 -m http.server 4791 --bind 127.0.0.1)
// and port 4747 free: node docs/evidence/agentation-annotate-2026-10-15/proof.js <output dir>
// Proof for the dev-only agentation toolbar on ops.html: Playwright's own
// Chromium (headless, not Google Chrome), a fresh profile, agentation-mcp 1.3.2
// with the in-memory store, one test note, then agentation_get_all_pending over MCP stdio.
const { spawn } = require('child_process');
const { chromium } = require(process.cwd() + '/node_modules/@playwright/test');
const OUT = process.argv[2];
const PAGE = 'http://127.0.0.1:4791/ops.html?annotate#jobs';
const NOTE = 'TEST NOTE from agentation-ux-20261015 ' + new Date().toISOString().slice(0, 16) + ': toolbar check, please ignore';

function mcpServer() {
  const proc = spawn('npx', ['-y', 'agentation-mcp@1.3.2', 'server'], { env: { ...process.env, AGENTATION_STORE: 'memory' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiters = {}; let id = 0;
  proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && waiters[m.id]) waiters[m.id](m); } catch (e) {} } });
  proc.stderr.on('data', d => process.stderr.write('[mcp] ' + d));
  const call = (method, params) => new Promise(ok => { const n = ++id; waiters[n] = ok; proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
  const notify = (method, params) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { proc, call, notify };
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch('http://localhost:4747/health'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('agentation-mcp did not come up on 4747');
}

(async () => {
  const mcp = mcpServer();
  let browser;
  try {
    await waitHealthy();
    const init = await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'agentation-ux-proof', version: '1' } });
    console.log('mcp server:', JSON.stringify(init.result && init.result.serverInfo));
    mcp.notify('notifications/initialized', {});

    browser = await chromium.launch();
    console.log('browser:', browser.browserType().name(), browser.version(), '(Playwright bundled Chromium, headless, fresh profile)');
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const offsite = [];
    page.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1:4791', 'localhost:4747', '127.0.0.1:4747'].includes(u.host)) offsite.push(r.method() + ' ' + u.origin + u.pathname); });
    await page.goto(PAGE);
    await page.waitForFunction(() => window.__SW_ANNOTATE && window.__SW_ANNOTATE.toolbar === 'on', null, { timeout: 15000 });
    const card = page.locator('.kanban-card', { hasText: 'Sample Client B' }).first();
    await card.waitFor();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Start feedback mode' }).click();
    await page.waitForTimeout(400);
    await card.getByText('Sample Client B').click();
    const box = page.getByPlaceholder('What should change?');
    await box.waitFor();
    await box.fill(NOTE);
    await page.screenshot({ path: OUT + '/1-note-typed.png' });
    await box.press('Enter');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: OUT + '/2-note-placed.png' });

    let res = await mcp.call('tools/call', { name: 'agentation_get_all_pending', arguments: {} });
    let text = res.result && res.result.content && res.result.content.map(c => c.text).join('\n');
    console.log('agentation_get_all_pending ->');
    console.log(text);
    const found = text && text.includes(NOTE);
    console.log(found ? 'PASS: the note reached the agent' : 'FAIL: note not in pending');
    console.log('requests that left this Mac (scripts only expected):\n  ' + (offsite.join('\n  ') || 'none'));
    process.exitCode = found ? 0 : 1;
  } catch (e) {
    console.error('proof failed:', e); process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    mcp.proc.kill();
  }
})();
