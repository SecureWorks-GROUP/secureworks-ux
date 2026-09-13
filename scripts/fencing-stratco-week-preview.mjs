#!/usr/bin/env node
/**
 * Private preview of the fencing Stratco week of Monday 14 September 2026.
 *
 *   node scripts/fencing-stratco-week-preview.mjs
 *
 * Then open the two printed links. Nothing here needs a credential, a token or
 * a network call: it serves this worktree over http so ops.html can load its
 * modules, and it opens the Sales workspace on the tab you asked for.
 *
 * <fencing-stratco-filed-read>
 * What you are looking at is the FILED read of 20:04 Perth, Sunday 13 September
 * 2026, checked in at
 *   docs/evidence/fencing-stratco-week-2026-09-13/stratco-week-filed-read.json
 * and stated as filed on both surfaces. This preview performs NO live calendar
 * read, so the surfaces say so in as many words rather than dressing a filed
 * figure as a live one. For the live-read version of the Booking surface, run
 * scripts/sales-booking-preview.mjs instead, which goes through sw-mcp.
 *
 * This server reads files and serves them. It sends nothing, writes no
 * calendar, and deploys nothing.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const PORT = Number(process.env.STRATCO_PREVIEW_PORT || 4175);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

/* Opens the Sales workspace on the requested tab without touching ops.html.
   The Ops sign-in gate is lifted so the shell is visible, the same way the
   Playwright shell captures do it. NOTHING is signed in and no token is
   minted, so no live Ops read can succeed. That is the point: the Stratco
   surfaces render from the filed read and say so, and a banner at the top of
   the page repeats it, so nobody mistakes this copy for the live dashboard. */
function inject(html) {
  const boot = `<script>
(function () {
  var BANNER_ID = 'stratcoPreviewBanner';
  function liftGate() {
    var gateStyle = document.getElementById('swAuthGateStyle');
    if (gateStyle) gateStyle.remove();
    var gate = document.getElementById('swAuthGate');
    if (gate) gate.remove();
    var main = document.getElementById('mainApp');
    if (main) main.style.display = '';
  }
  function banner() {
    if (document.getElementById(BANNER_ID)) return;
    var bar = document.createElement('div');
    bar.id = BANNER_ID;
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:sticky;top:0;z-index:99999;background:#293C46;color:#fff;font:600 12px/1.45 Helvetica Neue,Helvetica,Arial,sans-serif;padding:9px 16px;letter-spacing:.01em';
    bar.textContent = 'Private preview. Not live, not signed in, no live Ops read. The Stratco week figures are the filed read of 20:04 Perth, Sunday 13 September 2026.';
    document.body.insertBefore(bar, document.body.firstChild);
  }
  function openSales() {
    var tab = (location.hash || '').replace('#', '') === 'booking' ? 'booking' : 'performance';
    try {
      localStorage.setItem('sw_ops_sales_tab', tab);
      localStorage.setItem('sw_ops_tab', 'sales');
    } catch (e) {}
    liftGate();
    banner();
    if (window.SalesWorkspace) window.SalesWorkspace.show(tab);
    // This preview is the FENCING desk. The Booking module's own default is the
    // patio scoper and stays that way; only this preview opens on Marnin, whose
    // calendar the filed Stratco read covers.
    if (tab === 'booking' && window.SalesBooking && window.SalesBooking.state.resourceId !== 'marnin' && !window.__stratcoResourcePicked) {
      window.__stratcoResourcePicked = true;
      window.SalesBooking.switchResource('marnin');
    }
    else if (typeof window.showView === 'function') window.showView('sales');
    var view = document.getElementById('viewSales');
    if (view) {
      document.querySelectorAll('.view').forEach(function (v) { if (v !== view) { v.classList.remove('active'); v.style.display = 'none'; } });
      view.classList.add('active');
      view.style.cssText = 'display:block;position:static;top:auto;left:auto;right:auto;bottom:auto;z-index:1';
    }
    document.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === 'sales'); });
    document.querySelectorAll('[data-sales-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-sales-tab') === tab)); });
    if (window.FencingStratcoWeek) window.FencingStratcoWeek.mount();
  }
  // ops.html boots asynchronously and paints its auth gate after load, so one
  // shot is not enough. Re-apply for a few seconds, then stop.
  var tries = 0;
  function tick() {
    try { openSales(); } catch (e) { /* the page is still assembling */ }
    if (++tries < 24) setTimeout(tick, 250);
  }
  if (document.readyState === 'complete') tick();
  else window.addEventListener('load', tick);
  window.addEventListener('hashchange', function () { tries = 0; openSales(); });
})();
</script>`;
  // The boot goes in the HEAD, not before </body>. ops.html's markup closes the
  // document early in the parser, so anything appended at the end of the file
  // never reaches the DOM at all. scripts/sales-booking-preview.mjs injects in
  // the head for the same reason.
  const close = html.indexOf('</head>');
  return close === -1 ? boot + html : html.slice(0, close) + boot + html.slice(close);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const target = path.join(ROOT, url.pathname === '/' ? 'ops.html' : decodeURIComponent(url.pathname));
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'ops.html')) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  let body = fs.readFileSync(target);
  if (target.endsWith('ops.html')) body = Buffer.from(inject(body.toString('utf8')), 'utf8');
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  const base = 'http://' + HOST + ':' + PORT + '/ops.html';
  process.stdout.write(
    'Fencing Stratco week, filed read of 20:04 Perth, Sunday 13 September 2026.\n' +
    'Read only. No send, no calendar write, not live.\n\n' +
    '  Performance  ' + base + '#performance\n' +
    '  Booking      ' + base + '#booking\n\n' +
    'Ctrl-C to stop.\n'
  );
});
