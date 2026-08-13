#!/usr/bin/env node
/**
 * BOUNDED-VIEWER + ZOOM capture for the review pane document stage
 * (fm/makesafe-review-pdf-viewer-zoom, captain feedback 2026-08-13 second
 * pass: "the PDF is now too big. I want that scrollable and
 * magnifiable/smallerizable PDF scroll ... the pdf itself doesnt need to be
 * fixed as big").
 *
 * Like scripts/ses-review-pane-viewport-shot.js this keeps the pane at its
 * real constrained height (the board-overlay mount under ~350px of chrome) and
 * shoots the viewport, not the page. On top of that it loads a REAL 5-page
 * PDF onto the stage and walks the zoom cluster:
 *
 *   <label>-<W>x<H>-fit.png       the pane as it opens (fit-to-page default)
 *   <label>-<W>x<H>-scrolled.png  the document scrolled INSIDE the stage
 *   <label>-<W>x<H>-zoomin.png    two magnify presses (1.5x)
 *   <label>-<W>x<H>-zoomout.png   two shrink presses from fit (0.8x)
 *
 * and prints the measurements that prove the contract: stage height vs its
 * scrollHeight (internal scroll), page canvas width per zoom state, and the
 * approve foot's on-screen position. Against a build without the zoom cluster
 * (SHOT_ROOT at the pre-fix tree) it degrades to fit + metrics, so the same
 * script captures the "before".
 *
 *   SHOT_ROOT=<served repo root> node scripts/ses-review-pane-zoom-shot.js <out-dir> <label>
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fixture = require('../tests/e2e/fixtures/ses-docs-ready-bertram.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'pane';
const PORT = 4194;
const ROOT = process.env.SHOT_ROOT || path.join(__dirname, '..');
const ASSET_BASE = 'docs/evidence/makesafe-review-pdf-viewer-zoom-2026-08-13/assets';
const CHROME_ABOVE = 350;
const VIEWPORTS = [
  { width: 1512, height: 900 },  // typical desktop window
  { width: 1512, height: 760 },  // smaller laptop height
];

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-review-pane-zoom-shot.js <out-dir> [label]');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// The report artifact becomes a REAL 5-page PDF so internal scrolling and the
// zoom raster are exercised on a document shaped like a live pack.
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
    const canvas = stage ? stage.querySelector('canvas.msr-pdf-page') : null;
    const s = stage ? stage.getBoundingClientRect() : null;
    const f = foot ? foot.getBoundingClientRect() : null;
    return {
      stageHeight: s ? Math.round(s.height) : null,
      stageScrollHeight: stage ? stage.scrollHeight : null,
      stageScrollsInternally: stage ? stage.scrollHeight > stage.clientHeight + 4 : false,
      bodyScrollHeight: body ? body.scrollHeight : null,
      canvasCssWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
      pageCount: stage ? stage.querySelectorAll('canvas.msr-pdf-page').length : 0,
      footVisible: f ? f.top < window.innerHeight && f.height > 0 : false,
      footHeight: f ? Math.round(f.height) : null,
      hasZoomCluster: !!(stage && stage.querySelector('.msr-stage-zoom')),
      zoomLevel: stage ? (stage.getAttribute('data-zoom') || 'fit-default') : null,
    };
  });
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
      console.log(`${LABEL} ${tag} fit: stage ${fit.stageHeight}px (content ${fit.stageScrollHeight}px, ` +
        `internal scroll ${fit.stageScrollsInternally}), ${fit.pageCount} pages at ${fit.canvasCssWidth}px, ` +
        `foot visible ${fit.footVisible} (${fit.footHeight}px), zoom cluster ${fit.hasZoomCluster}`);

      // Scroll INSIDE the stage: the document moves, the pane body must not.
      const scrolled = await page.evaluate(() => {
        const host = document.getElementById('shotHost');
        const body = host.querySelector('.msr-body');
        const stage = host.querySelector('.msr-stage');
        const before = body.scrollTop;
        stage.scrollTop = Math.round(stage.scrollHeight / 2);
        return { stageScrollTop: stage.scrollTop, bodyMoved: body.scrollTop !== before };
      });
      await page.waitForTimeout(200);
      await shot('scrolled');
      console.log(`${LABEL} ${tag} scrolled: stage scrollTop ${scrolled.stageScrollTop}px, pane body moved ${scrolled.bodyMoved}`);

      if (fit.hasZoomCluster) {
        const press = async (sel, times) => {
          for (let i = 0; i < times; i++) await page.click('#shotHost .msr-stage-zoom ' + sel);
          await page.waitForTimeout(1200); // re-paint at the new width
        };
        await press('[aria-label="Zoom in"]', 2);
        const zin = await measure(page);
        await shot('zoomin');
        console.log(`${LABEL} ${tag} zoom-in x2: level ${zin.zoomLevel}, page width ${zin.canvasCssWidth}px, ` +
          `stage still ${zin.stageHeight}px, foot visible ${zin.footVisible}`);

        await press('[aria-label="Fit to page"]', 1);
        await press('[aria-label="Zoom out"]', 2);
        const zout = await measure(page);
        await shot('zoomout');
        console.log(`${LABEL} ${tag} zoom-out x2: level ${zout.zoomLevel}, page width ${zout.canvasCssWidth}px`);

        await press('[aria-label="Fit to page"]', 1);
        const back = await measure(page);
        console.log(`${LABEL} ${tag} fit reset: level ${back.zoomLevel}, page width ${back.canvasCssWidth}px ` +
          `(fit width was ${fit.canvasCssWidth}px)`);
      } else {
        console.log(`${LABEL} ${tag}: no zoom cluster in this build (pre-fix tree) — fit shots only`);
      }
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
