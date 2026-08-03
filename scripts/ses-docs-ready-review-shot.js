#!/usr/bin/env node
/**
 * Capture the make-safe Docs Ready review pane ("MakeSafe report pack — review
 * & send") for the captain's before/after pair, using the Bertram AJBR-70271
 * proof card.
 *
 * Read-only and offline: it serves ops.html from disk, aborts every network
 * request the page makes, and renders the pane by calling the shipped
 * `_msSesRenderDetail` with the fixture in tests/e2e/fixtures. Nothing is
 * fetched from Supabase and no client personal data is in the fixture.
 *
 *   node scripts/ses-docs-ready-review-shot.js <out-dir> [label]
 *
 * Writes <label>-send-ready.png and <label>-hold.png (full-page).
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-docs-ready-bertram.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'review';
const PORT = 4188;

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-docs-ready-review-shot.js <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
  });
  return proc;
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

/**
 * Mount the review pane in a panel that matches the real board overlay: the
 * overlay gives the panel a fixed viewport-height flex column, and the pane's
 * own scroll body lives inside it. For a full-page capture we let the panel
 * grow to its content instead of clipping it to the viewport.
 */
async function renderPane(page, cockpitName) {
  return page.evaluate(({ row, ctx }) => {
    const jobId = row.job_id;
    // Seed the identity cache the header + shared doc renderers read.
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(row));
    if (window._msActiveDocTab) window._msActiveDocTab[jobId] = 0;
    // showMsReportingDetail normally seeds this; render it here too so the
    // feedback composer's sesMode / docket_revision_id lookup matches reality.
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
    // The live pane populates #msNotesPanel-<id> asynchronously via loadMsNotes
    // (a network fetch). For an offline screenshot, render the same feedback
    // panel component directly so the capture shows the real composer.
    var notesHost = document.getElementById('msNotesPanel-' + jobId);
    if (notesHost && typeof window.renderMsNotesPanel === 'function') {
      notesHost.innerHTML = window.renderMsNotesPanel(jobId, [], { sesMode: true });
    }
    // Hide the app behind the capture so the pane is the whole frame.
    Array.from(document.body.children).forEach((el) => {
      if (el !== host) el.style.display = 'none';
    });
    document.body.style.background = '#fff';
    // The pane's scroll body must expand for a full-page shot.
    host.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll') {
        el.style.overflowY = 'visible';
        el.style.flex = 'none';
      }
    });
    return host.innerText.length;
  }, { row: fixture.identityRow, ctx: fixture.context(fixture[cockpitName]()) });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    browser = await chromium.launch();
    const results = [];

    for (const [cockpitName, suffix] of [
      ['cockpitSendReady', 'send-ready'],
      ['cockpitHold', 'hold'],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
      // Offline: the pane must render from the fixture alone.
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        return route.abort();
      });
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });

      const len = await renderPane(page, cockpitName);
      await page.waitForTimeout(250);
      const out = path.join(OUT_DIR, `${LABEL}-${suffix}.png`);
      await page.screenshot({ path: out, fullPage: true });
      results.push({ out, chars: len });
      console.log(`wrote ${out} (${len} chars of pane text)`);
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
