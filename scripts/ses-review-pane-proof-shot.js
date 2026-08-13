#!/usr/bin/env node
/**
 * Proof capture for the Docs Ready review pane fix (fm/ses-review-pane-fix-v1).
 *
 * Same offline pattern as scripts/ses-docs-ready-review-shot.js (serve ops.html
 * from disk, render the shipped `_msSesRenderDetail` against the Bertram
 * AJBR-70271 fixture) — but it points the two PDF artifacts at REAL sample PDFs
 * served over the same localhost origin, so the document tiles show real
 * first-page previews and the inline stage renders the selected PDF. Only
 * localhost requests are allowed; everything external is aborted. No client
 * personal data is in the fixture (suburb only).
 *
 *   node scripts/ses-review-pane-proof-shot.js <out-dir> [label]
 *
 * Writes <label>-send-ready.png and <label>-hold.png (full-page) plus
 * <label>-documents.png (the Documents section cropped).
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-docs-ready-bertram.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'review';
const PORT = 4191;
const ASSET_BASE = 'docs/evidence/ses-review-pane-fix-2026-08-13/assets';

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-review-pane-proof-shot.js <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// Point the two PDF artifacts at the real sample PDFs on this origin so the
// tiles and stage render real bytes. Photos keep their inline data-URL pixels.
const REAL_PDF = {};
REAL_PDF[fixture.REPORT_HASH] = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-report.pdf`;
REAL_PDF[fixture.WO_HASH] = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-wo.pdf`;
fixture.artifacts.forEach((a) => {
  if (a.content_hash && REAL_PDF[a.content_hash]) a.signed_url = REAL_PDF[a.content_hash];
});

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

async function renderPane(page, cockpitName) {
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
    // showMsReportingDetail does this after mount; do it here for the offline
    // render so the PDF tiles and inline viewer paint.
    if (typeof window._msHydratePdfSurfaces === 'function') window._msHydratePdfSurfaces(host);
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
      ['cockpitDraftOnlyHold', 'draft-only-hold'],
    ]) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
      await page.route('**/*', (route) => {
        const url = route.request().url();
        // Neutralise the auth gate so it never overlays the captured pane —
        // this is an offline render of _msSesRenderDetail, no login involved.
        if (/auth-gate\.js/.test(url)) {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        }
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        return route.abort();
      });
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });

      const len = await renderPane(page, cockpitName);
      await page.waitForTimeout(2200); // lazy-load pdf.js + paint canvases
      // The offline auth-gate injects a fixed login overlay when its Supabase
      // check is aborted; hide anything that is not our capture host.
      await page.evaluate(() => {
        const host = document.getElementById('shotHost');
        host.style.zIndex = '2147483647';
        Array.from(document.querySelectorAll('body > *')).forEach((el) => {
          if (el !== host) el.style.display = 'none';
        });
        Array.from(document.querySelectorAll('*')).forEach((el) => {
          if (host.contains(el) || el === host) return;
          const s = getComputedStyle(el);
          if (s.position === 'fixed' || Number(s.zIndex) > 1000) el.style.display = 'none';
        });
      });
      await page.waitForTimeout(150);
      const out = path.join(OUT_DIR, `${LABEL}-${suffix}.png`);
      await page.screenshot({ path: out, fullPage: true });
      results.push({ out, chars: len });
      console.log(`wrote ${out} (${len} chars of pane text)`);

      if (suffix === 'send-ready') {
        // Crop the Documents section (tiles + stage) for a focused proof.
        const docs = await page.evaluate(() => {
          const wrap = document.querySelector('[id^="msDocTabs_"]');
          if (!wrap) return null;
          const tabs = wrap.getBoundingClientRect();
          const stage = document.querySelector('[id^="msDocStage_"]');
          const s = stage ? stage.getBoundingClientRect() : tabs;
          return {
            x: Math.max(0, tabs.left - 12),
            y: Math.max(0, tabs.top - 40),
            w: 1180 - Math.max(0, tabs.left - 12) - 12,
            h: (s.bottom - tabs.top) + 60,
          };
        });
        if (docs) {
          const dout = path.join(OUT_DIR, `${LABEL}-documents.png`);
          await page.screenshot({ path: dout, clip: { x: docs.x, y: docs.y, width: docs.w, height: docs.h } });
          console.log(`wrote ${dout}`);
        }
      }
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
