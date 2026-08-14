#!/usr/bin/env node
/**
 * NATIVE-READER capture for the review pane document stage
 * (fm/makesafe-review-pdf-viewer-zoom, captain supersession 2026-08-14:
 * "the old reader, just tall" — the browser's built-in PDF viewer in a
 * fixed-height TALL stage, no custom canvas viewer).
 *
 * Like scripts/ses-review-pane-viewport-shot.js this keeps the pane at its
 * real constrained height (the board-overlay mount under ~350px of chrome) and
 * shoots the viewport, not the page. The report artifact is a REAL 5-page PDF
 * so the native reader has something substantial to show:
 *
 *   <label>-<W>x<H>-fit.png   the pane as it opens (native iframe, fit page)
 *   <label>-<W>x<H>-foot.png  the pane scrolled to the approve foot
 *
 * and prints the measurements that prove the contract: the stage is a bounded
 * fixed-height box (no page growth to document height), the PDF is embedded in
 * a native <iframe src="...#view=Fit">, the OPEN DOCUMENT hatch and the
 * "fit to page" tag sit on the stage corners, and the compact approve foot is
 * reachable. Against the pre-fix tree (custom canvas viewer) it records the
 * canvas metrics instead, so the same script captures the "before".
 *
 *   SHOT_ROOT=<served repo root> ASSET_ROOT=<repo with assets> \
 *     node scripts/ses-review-pane-native-shot.js <out-dir> <label>
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-docs-ready-bertram.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'pane';
const PORT = 4195;
const ROOT = process.env.SHOT_ROOT || path.join(__dirname, '..');
const ASSET_BASE = 'docs/evidence/makesafe-review-native-reader-2026-08-14/assets';
const CHROME_ABOVE = 350;
const VIEWPORTS = [
  { width: 1512, height: 900 },  // typical desktop window
  { width: 1512, height: 760 },  // smaller laptop height
];

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-review-pane-native-shot.js <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// The report artifact becomes a REAL 5-page PDF so the native reader shows a
// document shaped like a live pack.
const REAL_PDF = {};
REAL_PDF[fixture.REPORT_HASH] = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-report-5p.pdf`;
REAL_PDF[fixture.WO_HASH] = `http://127.0.0.1:${PORT}/docs/evidence/ses-review-pane-qa-v2-2026-08-13/assets/sample-wo.pdf`;
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

// Everything the contract asks for, measured off the live layout.
async function measure(page) {
  return page.evaluate(() => {
    const host = document.getElementById('shotHost');
    const body = host.querySelector('.msr-body');
    const stage = host.querySelector('.msr-stage');
    const foot = host.querySelector('.msr-actions-foot');
    const iframe = stage ? stage.querySelector('iframe') : null;
    const tag = stage ? stage.querySelector('.msr-stage-tag') : null;
    const open = stage ? stage.querySelector('.msr-stage-open') : null;
    const s = stage ? stage.getBoundingClientRect() : null;
    const f = foot ? foot.getBoundingClientRect() : null;
    return {
      stageHeight: s ? Math.round(s.height) : null,
      stageScrollHeight: stage ? stage.scrollHeight : null,
      stageBounded: stage
        ? Math.abs(stage.scrollHeight - stage.clientHeight) <= 4 // fixed box, no growth
        : false,
      bodyScrollHeight: body ? body.scrollHeight : null,
      viewportH: window.innerHeight,
      hasNativeIframe: !!iframe,
      iframeSrc: iframe ? iframe.getAttribute('src') : null,
      canvasPages: stage ? stage.querySelectorAll('canvas.msr-pdf-page').length : 0,
      tagText: tag ? tag.textContent.trim() : null,
      openHatch: open ? open.textContent.trim() : null,
      footVisible: f ? f.top < window.innerHeight && f.height > 0 : false,
      footHeight: f ? Math.round(f.height) : null,
    };
  });
}

(async () => {
  const server = startServer();
  let browser;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    // channel:'chromium' = the full browser in new-headless mode. The default
    // headless SHELL has no PDF viewer, which would blank the native iframe.
    browser = await chromium.launch({ channel: 'chromium' });

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: vp });
      // Intercept ONLY the auth gate and external hosts. A catch-all route
      // (even one that continues) starves the native PDF viewer's stream and
      // leaves the iframe blank, so localhost traffic must stay uninterception.
      await page.route('**/auth-gate.js*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });

      await renderPane(page, CHROME_ABOVE);
      await page.waitForTimeout(6000); // let the reader (or pre-fix canvases) settle
      await page.evaluate(() => {
        const keep = new Set([document.getElementById('shotHost'), document.getElementById('shotChrome')]);
        Array.from(document.querySelectorAll('*')).forEach((el) => {
          for (const k of keep) if (k && (k === el || k.contains(el))) return;
          const s = getComputedStyle(el);
          if (s.position === 'fixed' || Number(s.zIndex) > 1000) el.style.display = 'none';
        });
      });
      // Bring the stage to the top of the pane body so every shot shows it.
      await page.evaluate(() => {
        const host = document.getElementById('shotHost');
        const body = host.querySelector('.msr-body');
        const stage = host.querySelector('.msr-stage');
        if (body && stage) {
          body.scrollTop = stage.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 60;
        }
      });
      await page.waitForTimeout(200);

      const tag = `${vp.width}x${vp.height}`;
      const shot = (name) => page.screenshot({ path: path.join(OUT_DIR, `${LABEL}-${tag}-${name}.png`) });

      const fit = await measure(page);
      await shot('fit');
      console.log(`${LABEL} ${tag} fit: stage ${fit.stageHeight}px of ${fit.viewportH}px viewport ` +
        `(bounded ${fit.stageBounded}, content ${fit.stageScrollHeight}px), ` +
        `native iframe ${fit.hasNativeIframe}${fit.iframeSrc ? ' src ' + fit.iframeSrc.split('/').pop() : ''}, ` +
        `canvas pages ${fit.canvasPages}, tag "${fit.tagText}", hatch "${fit.openHatch}", ` +
        `foot visible ${fit.footVisible} (${fit.footHeight}px)`);

      // Scroll the pane body to the approve foot: with a bounded stage this is
      // one small scroll, not a five-page trek.
      const trek = await page.evaluate(() => {
        const host = document.getElementById('shotHost');
        const body = host.querySelector('.msr-body');
        const before = body.scrollTop;
        body.scrollTop = body.scrollHeight;
        return { from: before, to: body.scrollTop, total: body.scrollHeight, pane: body.clientHeight };
      });
      await page.waitForTimeout(200);
      await shot('foot');
      const after = await measure(page);
      console.log(`${LABEL} ${tag} foot: pane body ${trek.total}px total for a ${trek.pane}px pane ` +
        `(scrolled ${trek.from} -> ${trek.to}), foot visible ${after.footVisible}`);
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
