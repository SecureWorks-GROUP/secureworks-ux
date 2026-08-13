#!/usr/bin/env node
/**
 * Visual proof for the LIVE PORTAL READER thumbnail + honest chip on the
 * make-safe board (<makesafe-portal-live-thumb> in ops.html).
 *
 * Read-only and offline, exactly like scripts/ses-roof-capture-review-shot.js:
 * it serves ops.html from disk, aborts every network request the page makes, and
 * renders the SHIPPED renderMakesafeCard with a fixture row. Nothing is fetched
 * from Supabase; the screenshot on the thumb is a drawn facsimile of a locked
 * Prime form — the live capture is never committed here.
 *
 *   node scripts/ses-portal-thumb-shot.js <out-dir> [label]
 *
 * Writes:
 *   <label>-glendalough-locked.png   the real Glendalough card, Locked + thumb
 *   <label>-chip-states.png          all four chip states side by side
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');
const { spawn } = require('child_process');

const glen = require('../tests/e2e/fixtures/ses-portal-thumb-glendalough.js');

const OUT_DIR = process.argv[2];
const LABEL = process.argv[3] || 'portal-thumb';
const PORT = 4191;

if (!OUT_DIR) {
  console.error('usage: node scripts/ses-portal-thumb-shot.js <out-dir> [label]');
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

// A capture with the given result-shape, sharing the Glendalough facsimile shot.
function capRow(over) {
  return Object.assign(glen.glendaloughRow(), over);
}

async function main() {
  const server = startServer();
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitForServer(`${base}/ops.html`, 15000);
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
    // Read-only: abort every network call the page tries to make.
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      return route.abort();
    });
    await page.goto(`${base}/ops.html`, { waitUntil: 'domcontentloaded' });

    // ops.html gates its shell behind operator identity and animates cards in;
    // this is an offline render harness, so force the shot host + cards visible.
    await page.addStyleTag({ content:
      '#shotHost * { visibility: visible !important; }'
      + '#shotHost .kanban-card { display: block !important; opacity: 1 !important; transform: none !important; animation: none !important; }' });

    const shotUrl = glen.SHOT_URL;

    // 1. The real Glendalough card.
    await page.evaluate(({ row }) => {
      const j = mapCanonicalMakesafeRow(row, null);
      let host = document.getElementById('shotHost');
      if (!host) { host = document.createElement('div'); host.id = 'shotHost'; document.body.appendChild(host); }
      host.setAttribute('style', 'position:absolute;top:0;left:0;width:300px;padding:16px;background:#F0ECE8;z-index:99999;display:block !important;visibility:visible !important;');
      host.className = 'kanban-column';
      host.innerHTML = '<div class="kanban-cards">' + renderMakesafeCard(j, 'trade_report_in') + '</div>';
    }, { row: glen.glendaloughRow() });
    await page.waitForTimeout(200);
    const card = await page.$('#shotHost');
    await card.screenshot({ path: path.join(OUT_DIR, `${LABEL}-glendalough-locked.png`) });

    // 2. All four chip states in a row.
    await page.evaluate(({ shotUrl }) => {
      const mk = (pc, tag) => {
        const row = {
          contract_version: 'makesafe-board.v1', id: 'r-' + tag, job_number: 'SWMS-' + tag,
          type: 'makesafe', ses_family: 'ordinary_roof_portal', ses_family_label: 'Roof Report',
          job_state: 'accepted', substatus: 'waiting_on_trade_report',
          canonical_stage: 'trade_report_in', canonical_stage_label: 'Trade Report In',
          makesafe_type: 'Roof Report', builder: { name: 'Prime', external_ref: 'PRIME-' + tag },
          contact: { address: 'Glendalough WA 6016' }, site_suburb: 'Glendalough', assignments: [],
          report: { state: 'not_started' }, pack: { state: 'not_started', closeout_documents: {} },
          age: { age_days: 2 }, portal_capture: pc,
        };
        return renderMakesafeCard(mapCanonicalMakesafeRow(row, null), 'trade_report_in');
      };
      const cards = [
        mk({ role: 'roof_report', screenshot_url: shotUrl, result: 'done', signal: 'form locked/submitted (form-locked banner), 22 of 24 answered' }, 'LOCKED'),
        mk({ role: 'roof_report', screenshot_url: shotUrl, result: 'not_done', signal: 'form is live and NOT locked, 19 of 23 answered' }, 'FILLING'),
        mk({ role: 'roof_report', screenshot_url: shotUrl, shown_result: 'done', shown_signal: 'form locked/submitted (form-locked banner), 21 of 23 answered', latest_result: 'unreachable' }, 'LOCKEDGONE'),
        mk({ role: 'roof_report', screenshot_url: shotUrl, shown_result: 'unreachable', latest_result: 'unreachable', signal: 'builder link is expired or no longer active' }, 'GONE'),
      ];
      let host = document.getElementById('shotHost');
      host.setAttribute('style', 'position:absolute;top:0;left:0;width:1160px;padding:16px;background:#F0ECE8;z-index:99999;display:flex !important;visibility:visible !important;gap:12px;');
      host.className = 'kanban-column';
      host.innerHTML = cards.map((c) => '<div style="width:270px;">' + c + '</div>').join('');
    }, { shotUrl });
    await page.waitForTimeout(150);
    const strip = await page.$('#shotHost');
    await strip.screenshot({ path: path.join(OUT_DIR, `${LABEL}-chip-states.png`) });

    await browser.close();
    console.log('wrote:');
    console.log('  ' + path.join(OUT_DIR, `${LABEL}-glendalough-locked.png`));
    console.log('  ' + path.join(OUT_DIR, `${LABEL}-chip-states.png`));
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
