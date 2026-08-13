#!/usr/bin/env node
/**
 * QA proof capture for the Docs Ready review-pane fix (fm/review-pane-qa-v2).
 *
 * Live operator auth is not available to the background agent, so this uses the
 * documented OFFLINE pattern (scripts/ses-review-pane-proof-shot.js): serve
 * ops.html from disk and render the SHIPPED `_msSesRenderDetail` against
 * family-shaped fixtures whose signed URLs point at real localhost sample bytes.
 *
 * Unlike the older proof shot, it does NOT neutralise the stage overflow — it
 * mounts the pane into a real-height panel so the stage's readable page-width /
 * scroll behaviour is captured as the captain would see it.
 *
 *   node scripts/ses-review-pane-qa-v2-shot.js <out-dir>
 *
 * Proves, one screenshot per family:
 *   mlb-ellenbrook.png    Report + SWMS + Invoice(DRAFT) + WO tiles; report PDF
 *                         paints readable in the stage.
 *   mlb-report-unminted.png  Report artifact present but signed URL not minted:
 *                         a Report tile still EXISTS (honest "link unavailable"),
 *                         never the old silent drop that read as "no report".
 *   ajs-heathridge.png    Temp fence: NO SWMS tile / NO SWMS X; SEND ARMED on an
 *                         email-draft-only hold ("no draft on current docket").
 *   roof-mosman.png       Prime capture renders as a readable page-width image
 *                         (not a toothpick sliver); no MakeSafe report PDF demanded.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const fam = require('../tests/e2e/fixtures/ses-review-pane-families.js');

const OUT_DIR = process.argv[2];
const PORT = 4192;
const ASSET_BASE = 'docs/evidence/ses-review-pane-qa-v2-2026-08-13/assets';

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-review-pane-qa-v2-shot.js <out-dir>');
  process.exit(2);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const REPORT_PDF = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-report.pdf`;
const WO_PDF = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-wo.pdf`;
const INVOICE_PDF = `http://127.0.0.1:${PORT}/${ASSET_BASE}/sample-invoice.pdf`;
const ROOF_IMG = `http://127.0.0.1:${PORT}/${ASSET_BASE}/roof-capture.svg`;

// Map fixture asset hashes to real served bytes.
function bind(artifacts) {
  artifacts.forEach((a) => {
    if (a.content_hash === fam.MLB.INVOICE_ASSET) a.signed_url = INVOICE_PDF;
    else if (a.content_hash === fam.MLB.REPORT_ASSET && a.signed_url === fam.MLB.REPORT_ASSET) a.signed_url = REPORT_PDF;
    else if (a.content_hash === fam.MLB.WO_ASSET) a.signed_url = WO_PDF;
    else if (a.content_hash === fam.AJS.REPORT_ASSET && a.signed_url === fam.AJS.REPORT_ASSET) a.signed_url = REPORT_PDF;
    else if (a.content_hash === fam.AJS.WO_ASSET) a.signed_url = WO_PDF;
    else if (a.content_hash === fam.ROOF.CAPTURE_ASSET) a.signed_url = ROOF_IMG;
    else if (a.content_hash === fam.ROOF.WO_ASSET) a.signed_url = WO_PDF;
    // The MLB SWMS artifact reuses the report sample bytes so its tile paints too.
    else if (a.role === 'swms_artifact' && a.signed_url === fam.MLB.REPORT_ASSET) a.signed_url = REPORT_PDF;
  });
  return artifacts;
}

function scenarios() {
  return [
    { name: 'mlb-ellenbrook', row: fam.MLB.identityRow, cockpit: fam.MLB.cockpit(), artifacts: bind(fam.MLB.artifacts(true)) },
    { name: 'mlb-invoice-selected', row: fam.MLB.identityRow, cockpit: fam.MLB.cockpit(), artifacts: bind(fam.MLB.artifacts(true)), tab: 'Invoice' },
    { name: 'mlb-report-unminted', row: fam.MLB.identityRow, cockpit: fam.MLB.cockpit(), artifacts: bind(fam.MLB.artifacts(false)) },
    { name: 'ajs-heathridge', row: fam.AJS.identityRow, cockpit: fam.AJS.cockpitDraftOnlyHold(), artifacts: bind(fam.AJS.artifacts()) },
    { name: 'roof-mosman', row: fam.ROOF.identityRow, cockpit: fam.ROOF.cockpit(), artifacts: bind(fam.ROOF.artifacts()) },
  ];
}

function startServer() {
  return spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
    cwd: path.join(__dirname, '..'), stdio: 'ignore',
  });
}
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(url); if (res.ok) return; } catch (_) { /* not up */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start: ' + url);
}

async function renderPane(page, sc) {
  return page.evaluate(({ row, cockpit, artifacts, tab }) => {
    const jobId = row.job_id;
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(row));
    if (window._msActiveDocTab) window._msActiveDocTab[jobId] = 0;
    const ctx = {
      jobId, cockpit,
      queueEntry: { job_id: jobId, docket_revision_id: jobId + '-docket', review_state: 'needs_review' },
      pack: {
        review: { docket_revision_id: jobId + '-docket' },
        docket: { id: jobId + '-docket', local_invoice_proposal: (cockpit.sections.money || {}).local_invoice_proposal || null, xero_binding: (cockpit.sections.money || {}).xero || null },
        artifacts,
      },
      docketRevisionId: jobId + '-docket', reviewState: 'needs_review', fetchedAt: 0,
    };
    window._msSesPackCache = window._msSesPackCache || {};
    window._msSesPackCache[jobId] = ctx;

    let host = document.getElementById('shotHost');
    if (!host) { host = document.createElement('div'); host.id = 'shotHost'; document.body.appendChild(host); }
    // A real-height panel: fixed viewport, flex column, so .msr-body scrolls and
    // .msr-stage keeps its true page-width / scroll behaviour (NOT neutralised).
    host.setAttribute('style', 'position:absolute;top:0;left:0;width:1180px;height:1600px;background:#fff;display:flex;flex-direction:column;z-index:2147483647;overflow:hidden;');
    host.innerHTML = window._msSesRenderDetail(jobId, ctx, 'shotHost');
    if (typeof window._msHydratePdfSurfaces === 'function') window._msHydratePdfSurfaces(host);
    // Select a named tab (e.g. Invoice) to prove the SELECTED PDF paints, not blank.
    if (tab) {
      const btns = Array.from(host.querySelectorAll('[id^="msDocTabs_"] button[data-tabidx]'));
      const match = btns.find((b) => (b.textContent || '').toLowerCase().indexOf(tab.toLowerCase()) !== -1);
      if (match && typeof window._msSwitchDocTab === 'function') {
        window._msSwitchDocTab(jobId, Number(match.getAttribute('data-tabidx')), 'shotHost');
      }
    }
    const notesHost = document.getElementById('msNotesPanel-' + jobId);
    if (notesHost && typeof window.renderMsNotesPanel === 'function') {
      notesHost.innerHTML = window.renderMsNotesPanel(jobId, [], { sesMode: true });
    }
    Array.from(document.querySelectorAll('body > *')).forEach((el) => { if (el !== host) el.style.display = 'none'; });
    Array.from(document.querySelectorAll('*')).forEach((el) => {
      if (host.contains(el) || el === host) return;
      const s = getComputedStyle(el);
      if (s.position === 'fixed' || Number(s.zIndex) > 1000) el.style.display = 'none';
    });
    document.body.style.background = '#fff';

    // Report what the pane decided, for the run log (asserted below).
    const armed = !!document.getElementById('msSesApproveAndSendBtn');
    const tabs = Array.from(host.querySelectorAll('[id^="msDocTabs_"] button .msr-tile-file, [id^="msDocTabs_"] .msr-tab')).map((el) => (el.textContent || '').trim()).filter(Boolean);
    const doneItems = Array.from(host.querySelectorAll('.msr-done-item')).map((el) => (el.textContent || '').trim());
    return { text: host.innerText.length, armed, tabs, doneItems };
  }, { row: sc.row, cockpit: sc.cockpit, artifacts: sc.artifacts, tab: sc.tab || null });
}

(async () => {
  const server = startServer();
  let browser;
  const summary = [];
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/ops.html`, 15000);
    browser = await chromium.launch();
    for (const sc of scenarios()) {
      const page = await browser.newPage({ viewport: { width: 1180, height: 1600 } });
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (/auth-gate\.js/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        if (url.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
        return route.abort();
      });
      page.on('pageerror', (e) => console.error('  page error:', e.message));
      await page.goto(`http://127.0.0.1:${PORT}/ops.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window._msSesRenderDetail === 'function', { timeout: 10000 });
      const info = await renderPane(page, sc);
      await page.waitForTimeout(2400); // lazy pdf.js + paint
      const out = path.join(OUT_DIR, `${sc.name}.png`);
      await page.screenshot({ path: out, fullPage: true });
      summary.push({ name: sc.name, armed: info.armed, doneItems: info.doneItems });
      console.log(`wrote ${out}  armed=${info.armed}  done=${JSON.stringify(info.doneItems)}`);
      await page.close();
    }
    fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

    // Assertion guard: the fixes must hold, or this run fails (not just paints).
    const by = {};
    summary.forEach((s) => { by[s.name] = s; });
    const failures = [];
    const doneHas = (name, label) => (by[name].doneItems || []).some((d) => d.indexOf(label) !== -1);
    // AJS temp fence: NO SWMS item (no tile, no X) and SEND armed on the soft hold.
    if (doneHas('ajs-heathridge', 'SWMS')) failures.push('AJS temp fence still shows a SWMS item (family lie)');
    if (!by['ajs-heathridge'].armed) failures.push('AJS email-draft-only hold did NOT arm SEND');
    // MLB with the report signed URL unminted: the Report item still EXISTS.
    if (!doneHas('mlb-report-unminted', 'Report')) failures.push('report tile dropped when signed URL unminted');
    // MLB well-formed: Report + SWMS both present and armed.
    if (!doneHas('mlb-ellenbrook', 'SWMS') || !doneHas('mlb-ellenbrook', 'Report')) failures.push('MLB missing Report/SWMS tile');
    if (failures.length) {
      console.error('QA GUARD FAILED:\n  - ' + failures.join('\n  - '));
      process.exitCode = 1;
    } else {
      console.log('QA GUARD PASSED: family tiles + soft SEND behave as ruled.');
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
