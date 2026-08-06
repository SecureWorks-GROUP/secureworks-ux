#!/usr/bin/env node
/**
 * Capture the make-safe Docs Ready review pane for the roof-capture proof pair,
 * using the Mindarie SWMS-261081 card.
 *
 *   present  — the portal capture as a first-class document tab, open, with its
 *              provenance stated and the form readable on the stage;
 *   missing  — the same roof card with no capture in its pack, where the gap is
 *              STATED rather than left as an absent tab.
 *
 * Read-only and offline, exactly like scripts/ses-docs-ready-review-shot.js: it
 * serves ops.html from disk, aborts every network request the page makes, and
 * renders the pane by calling the shipped `_msSesRenderDetail` with the fixture
 * in tests/e2e/fixtures. Nothing is fetched from Supabase, and the capture on
 * the stage is a drawn facsimile — the live capture is never committed here.
 *
 *   node scripts/ses-roof-capture-review-shot.js <out-dir> [label]
 *
 * Writes <label>-capture-present.png and <label>-capture-missing.png.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-roof-capture-mindarie.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'roof';
const PORT = 4189;

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-roof-capture-review-shot.js <out-dir> [label]');
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
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start: ' + url);
}

/** Mount the pane in a panel shaped like the real board overlay, expanded. */
async function renderPane(page, ctx) {
  return page.evaluate(({ row, ctx }) => {
    const jobId = row.job_id;
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(row));
    if (window._msActiveDocTab) window._msActiveDocTab[jobId] = 0;
    window._msSesPackCache = window._msSesPackCache || {};
    window._msSesPackCache[jobId] = ctx;

    let host = document.getElementById('shotHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shotHost';
      document.body.appendChild(host);
    }
    host.setAttribute(
      'style',
      'position:absolute;top:0;left:0;width:1180px;background:#fff;display:flex;flex-direction:column;z-index:9999;',
    );
    host.innerHTML = window._msSesRenderDetail(jobId, ctx, 'shotHost');
    const notesHost = document.getElementById('msNotesPanel-' + jobId);
    if (notesHost && typeof window.renderMsNotesPanel === 'function') {
      notesHost.innerHTML = window.renderMsNotesPanel(jobId, [], { sesMode: true });
    }
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
    // The stage is short for density on the live pane; for the proof shot let
    // the CAPTURE render tall enough that the form is actually READABLE. Only
    // the capture stage is stretched — a stretched invoice iframe would just be
    // a tall blank rectangle in the absence shot.
    const stage = host.querySelector('.msr-stage');
    const captureOpen = !!host.querySelector('.msr-tab[aria-selected="true"]') &&
      /Roof Report Capture/.test(host.querySelector('.msr-tab[aria-selected="true"]').textContent || '');
    if (stage && captureOpen) stage.style.height = '620px';
    return {
      chars: host.innerText.length,
      tabs: Array.from(host.querySelectorAll('.msr-tab')).map((b) => b.textContent),
      gap: !!host.querySelector('.msr-evidence-gap'),
    };
  }, { row: fixture.identityRow, ctx });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    browser = await chromium.launch();
    const results = [];

    for (const [suffix, ctx] of [
      ['capture-present', fixture.context({ withCapture: true })],
      ['capture-missing', fixture.context({ withCapture: false })],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
      // Offline: the pane must render from the fixture alone. The facsimile is
      // a data: URI, so the capture still paints with the network shut off.
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        return route.abort();
      });
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });

      const info = await renderPane(page, ctx);
      await page.waitForTimeout(250);
      const out = path.join(OUT_DIR, `${LABEL}-${suffix}.png`);
      await page.screenshot({ path: out, fullPage: true });
      results.push({ out, ...info });
      console.log(`wrote ${out}`);
      console.log(`  tabs: ${JSON.stringify(info.tabs)}  absence stated: ${info.gap}`);
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
