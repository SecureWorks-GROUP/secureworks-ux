#!/usr/bin/env node
/**
 * Offline proof shots for the SES loop overlay ship: three sample cards
 * (261237, 261241, 261243) plus the review/send overlay after a hours/wording
 * edit. No network, no send, no invoice approve.
 *
 *   node scripts/ses-loop-overlay-shot.js <out-dir>
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');
const fixture = require('../tests/e2e/fixtures/ses-loop-overlay-cards.js');

const OUT_DIR = process.argv[2];
const PORT = 4191;

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-loop-overlay-shot.js <out-dir>');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start: ' + url);
}

async function paintCards(page) {
  return page.evaluate((fx) => {
    window._msSesReviewQueue = {};
    window._makesafeCanonicalPackById = {};
    window._makesafeCanonicalPackMetaById = {};
    window._makesafePackChipById = {};
    let host = document.getElementById('shotHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shotHost';
      document.body.appendChild(host);
    }
    host.setAttribute('style',
      'position:absolute;top:0;left:0;width:1180px;padding:24px;background:#F4F1EA;display:flex;gap:16px;align-items:flex-start;z-index:100000;');
    let html = '';
    fx.cards.forEach((c) => {
      if (c.pack && c.pack.drafted) {
        window._makesafeCanonicalPackById[c.id] = true;
        window._makesafeCanonicalPackMetaById[c.id] = {
          drafted: true,
          docket_revision_id: c.pack.docket_revision_id || null,
        };
      }
      if (c.packFacts) window._makesafePackChipById[c.id] = c.packFacts;
      html += '<div style="width:360px;max-width:360px;">'
        + '<div style="font:700 11px/1.2 ui-sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#4C6A7C;margin:0 0 8px;">'
        + c.job_number + '</div>'
        + renderMakesafeCard(c.row, 'report_ready')
        + '</div>';
    });
    host.innerHTML = html;
    var gate = document.getElementById('swAuthGate');
    if (gate) gate.style.display = 'none';
    Array.from(document.body.children).forEach((el) => {
      if (el !== host) el.style.display = 'none';
    });
    document.body.style.background = '#F4F1EA';
    return host.innerText.length;
  }, fixture);
}

async function paintOverlay(page, edited) {
  return page.evaluate(({ fx, edited }) => {
    const jobId = fx.overlay.jobId;
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(fx.overlay.row));
    window._msSesPackCache = window._msSesPackCache || {};
    window._msSesPackCache[jobId] = fx.overlay.ctx;
    window._msSesSendPreview = edited
      ? { [jobId]: { hours: 5, routes: { report: { subject: 'Edited subject — MLB-261241', body: 'Edited wording. This is what would send.' } } } }
      : {};
    let host = document.getElementById('shotHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shotHost';
      document.body.appendChild(host);
    }
    host.setAttribute('style',
      'position:absolute;top:0;left:0;width:1180px;background:#fff;display:flex;flex-direction:column;z-index:100000;');
    host.innerHTML = window._msSesRenderDetail(jobId, fx.overlay.ctx, 'shotHost');
    var gate = document.getElementById('swAuthGate');
    if (gate) gate.style.display = 'none';
    Array.from(document.body.children).forEach((el) => {
      if (el !== host) el.style.display = 'none';
    });
    document.body.style.background = '#fff';
    host.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        el.style.overflowY = 'visible';
        el.style.flex = 'none';
      }
    });
    return host.innerText.length;
  }, { fx: fixture, edited });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    browser = await chromium.launch();
    const results = [];

    const shots = [
      ['cards', false],
      ['overlay-before', false],
      ['overlay-after-edit', true],
    ];
    for (const [label, edited] of shots) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/auth-gate\.js/.test(url)) {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        }
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        return route.abort();
      });
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.renderMakesafeCard === 'function'
        && typeof window._msSesRenderDetail === 'function', { timeout: 10000 });
      const len = label === 'cards'
        ? await paintCards(page)
        : await paintOverlay(page, edited);
      await page.evaluate(() => {
        var style = document.getElementById('swAuthGateStyle');
        if (style) style.remove();
        var gate = document.getElementById('swAuthGate');
        if (gate) gate.remove();
      });
      await page.waitForTimeout(250);
      const out = path.join(OUT_DIR, `ses-loop-${label}.png`);
      const host = page.locator('#shotHost');
      await host.screenshot({ path: out });
      results.push({ out, chars: len });
      console.log(`wrote ${out} (${len} chars)`);
      await page.close();
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
