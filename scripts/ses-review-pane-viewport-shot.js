#!/usr/bin/env node
/**
 * VIEWPORT-REALISTIC capture for the review pane layout fix
 * (fm/makesafe-review-pane-layout).
 *
 * scripts/ses-review-pane-proof-shot.js flattens every scroll container and
 * shoots full-page — perfect for content proofs, but it hides the one thing the
 * captain reported (2026-08-13): at a real window height the pinned APPROVE
 * AND SEND foot ate the pane and the document preview collapsed to a sliver.
 *
 * This script keeps the pane at its real constrained height: the render host
 * mimics the board overlay (a flex column pinned below ~350px of board chrome,
 * exactly how openMakesafeReviewOverlay mounts it), scrolling stays live, and
 * the screenshot is the viewport, not the page. It also prints the measured
 * stage height, foot height, and how many pixels of the document stage are
 * actually visible once the captain scrolls the stage into view.
 *
 *   SHOT_ROOT=<served repo root> node scripts/ses-review-pane-viewport-shot.js <out-dir> <label>
 *
 * SHOT_ROOT defaults to this worktree; point it at a `git archive HEAD` tree to
 * capture the "before". Writes <label>-<W>x<H>-top.png (pane as it opens) and
 * <label>-<W>x<H>-stage.png (document stage scrolled into view) per viewport.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-docs-ready-bertram.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'pane';
const PORT = 4193;
const ROOT = process.env.SHOT_ROOT || path.join(__dirname, '..');
const ASSET_BASE = 'docs/evidence/ses-review-pane-fix-2026-08-13/assets';
// Board chrome above the overlay pane at the captain's desktop: top nav +
// board filter chips (~290px) plus the overlay's own command header (~60px).
const CHROME_ABOVE = 350;
const VIEWPORTS = [
  { width: 1512, height: 900 },  // typical desktop window
  { width: 1512, height: 760 },  // smaller laptop height
];

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-review-pane-viewport-shot.js <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const REAL_PDF = {};
REAL_PDF[fixture.REPORT_HASH] = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-report.pdf`;
REAL_PDF[fixture.WO_HASH] = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-wo.pdf`;
fixture.artifacts.forEach((a) => {
  if (a.content_hash && REAL_PDF[a.content_hash]) a.signed_url = REAL_PDF[a.content_hash];
});

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: ROOT,
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

async function renderPane(page, chromeAbove) {
  return page.evaluate(({ row, ctx, chromeAbove }) => {
    const jobId = row.job_id;
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(row));
    if (window._msActiveDocTab) window._msActiveDocTab[jobId] = 0;
    window._msSesPackCache = window._msSesPackCache || {};
    window._msSesPackCache[jobId] = ctx;

    // Stand-in for the board chrome the overlay sits under (nav + chips +
    // command header) so the pane gets exactly the height it gets in prod.
    let chrome = document.getElementById('shotChrome');
    if (!chrome) {
      chrome = document.createElement('div');
      chrome.id = 'shotChrome';
      document.body.appendChild(chrome);
    }
    chrome.setAttribute(
      'style',
      'position:fixed;top:0;left:0;right:0;height:' + chromeAbove + 'px;' +
      'background:#F4F1EC;border-bottom:1px solid #D5E0E7;z-index:9998;' +
      'display:flex;align-items:flex-end;padding:0 24px 14px;color:#6C808E;' +
      'font:600 13px system-ui;',
    );
    chrome.textContent = '(board chrome above the review pane: nav, filters, pane header)';

    let host = document.getElementById('shotHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'shotHost';
      document.body.appendChild(host);
    }
    // Same mount as openMakesafeReviewOverlay's inner panel: flex column,
    // overflow hidden, pinned to the viewport below the chrome.
    host.setAttribute(
      'style',
      'position:fixed;top:' + chromeAbove + 'px;left:0;right:0;bottom:0;' +
      'background:#fff;display:flex;flex-direction:column;overflow:hidden;min-width:0;z-index:9999;',
    );
    host.innerHTML = window._msSesRenderDetail(jobId, ctx, 'shotHost');
    if (typeof window._msHydratePdfSurfaces === 'function') window._msHydratePdfSurfaces(host);
    const notesHost = document.getElementById('msNotesPanel-' + jobId);
    if (notesHost && typeof window.renderMsNotesPanel === 'function') {
      notesHost.innerHTML = window.renderMsNotesPanel(jobId, [], { sesMode: true });
    }
    Array.from(document.body.children).forEach((el) => {
      if (el !== host && el !== chrome) el.style.display = 'none';
    });
    document.body.style.background = '#fff';
    return host.innerText.length;
  }, { row: fixture.identityRow, ctx: fixture.context(fixture.cockpitSendReady()), chromeAbove });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    browser = await chromium.launch();

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: vp });
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
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });

      await renderPane(page, CHROME_ABOVE);
      await page.waitForTimeout(2500); // lazy-load pdf.js + paint canvases
      // Hide anything fixed that is not our chrome band or capture host (the
      // offline auth-gate injects a login overlay when its network is aborted).
      await page.evaluate(() => {
        const keep = new Set([document.getElementById('shotHost'), document.getElementById('shotChrome')]);
        Array.from(document.querySelectorAll('*')).forEach((el) => {
          for (const k of keep) if (k && (k === el || k.contains(el))) return;
          const s = getComputedStyle(el);
          if (s.position === 'fixed' || Number(s.zIndex) > 1000) el.style.display = 'none';
        });
      });
      await page.waitForTimeout(150);

      const tag = `${vp.width}x${vp.height}`;
      await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-${tag}-top.png`) });

      // The captain's read: scroll the document stage to the top of the body,
      // measure how much of it is actually visible, then shoot.
      const metrics = await page.evaluate(() => {
        const host = document.getElementById('shotHost');
        const body = host.querySelector('.msr-body');
        const stage = host.querySelector('.msr-stage');
        const foot = host.querySelector('.msr-actions-foot');
        if (body && stage) {
          body.scrollTop = stage.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 6;
        }
        const b = body.getBoundingClientRect();
        const s = stage ? stage.getBoundingClientRect() : null;
        const visibleStage = s ? Math.max(0, Math.min(s.bottom, b.bottom) - Math.max(s.top, b.top)) : 0;
        return {
          bodyViewport: Math.round(b.height),
          stageHeight: s ? Math.round(s.height) : null,
          visibleStage: Math.round(visibleStage),
          footHeight: foot ? Math.round(foot.getBoundingClientRect().height) : null,
        };
      });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-${tag}-stage.png`) });
      console.log(`${LABEL} ${tag}: body viewport ${metrics.bodyViewport}px, stage ${metrics.stageHeight}px ` +
        `(${metrics.visibleStage}px visible when scrolled to it), approve foot ${metrics.footHeight}px`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
