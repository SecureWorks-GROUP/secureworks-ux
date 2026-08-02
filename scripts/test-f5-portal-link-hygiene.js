// F5 — display-path portal link hygiene.
// Extracts the pure filter helpers from shipped ops.html + trade.html and
// proves image/tracker URLs are hidden while a genuine (even "expired") share
// is still offered.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
const trade = fs.readFileSync(path.join(root, 'trade.html'), 'utf8');

const F5_LOGO =
  'https://documents.primeeco.tech/15276239-d244-11ee-8228-0a39957d26b4/mlb_new_logo.png';
const F5_TRACKER =
  'https://xw2vdtj6.r.ap-southeast-2.awstrack.me/I0/0108019eabcdef/1/1';
const F5_SHARE =
  'https://primeeco.tech/share/7d74ea48-89bc-4e6e-b7b4-8a1e433b7d7c';
const F5_EXPIRED =
  'https://primeeco.tech/share/expired-token-still-a-portal';

function extractBetween(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('start marker not found: ' + startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error('end marker not found: ' + endMarker);
  return src.slice(start, end);
}

// ── ops.html: pure helpers + collector + renderMakesafeOpsExternalLinks ──
// Start at the kind-label table: since #227 the hygiene predicates live above
// the SHARED collectMakesafeExternalLinks, which both the job-detail Builder
// links panel and the board card link row call, so the whole region has to be
// extracted together for the render checks below to exercise the real path.
const opsHelpers = extractBetween(
  ops,
  'var MAKESAFE_LINK_KIND_LABELS = {',
  'function renderMakesafeOpsDetail',
);
// Provide a minimal escapeHtml + browser globals so the renderer can run offline.
const opsCtx = {
  URL,
  escapeHtml: function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
vm.createContext(opsCtx);
vm.runInContext(opsHelpers, opsCtx);

let failed = 0;
function check(name, cond) {
  if (!cond) {
    console.error('FAIL:', name);
    failed++;
  }
}

check('ops urlIsBuilderPortalLink keeps share', opsCtx.urlIsBuilderPortalLink(F5_SHARE));
check('ops urlIsBuilderPortalLink keeps expired share', opsCtx.urlIsBuilderPortalLink(F5_EXPIRED));
check('ops rejects logo', !opsCtx.urlIsBuilderPortalLink(F5_LOGO));
check('ops rejects tracker', !opsCtx.urlIsBuilderPortalLink(F5_TRACKER));
check('ops asset helper flags logo', opsCtx.urlLooksLikeAssetOrTracking(F5_LOGO));
check('ops asset helper flags tracker', opsCtx.urlLooksLikeAssetOrTracking(F5_TRACKER));

const pollutedMd = {
  external_links: [
    { label: 'Builder Portal', url: F5_LOGO, kind: 'builder_portal' },
    { label: 'Builder Portal', url: F5_TRACKER, kind: 'builder_portal' },
    { label: 'Roof Report', url: F5_EXPIRED, kind: 'roof_report' },
    { label: 'Roof Report', url: F5_SHARE, kind: 'roof_report' },
  ],
};
const html = opsCtx.renderMakesafeOpsExternalLinks(pollutedMd);
check('ops render hides logo', !html.includes(F5_LOGO));
check('ops render hides tracker', !html.includes(F5_TRACKER));
check('ops render shows expired share', html.includes(F5_EXPIRED));
check('ops render shows live share', html.includes(F5_SHARE));
check('ops render still builds Builder links section', html.includes('Builder links'));

// Image-only card → no section (empty return)
const imageOnly = opsCtx.renderMakesafeOpsExternalLinks({
  external_links: [
    { label: 'Builder Portal', url: F5_LOGO, kind: 'builder_portal' },
  ],
});
check('ops image-only card yields no panel', imageOnly === '');

// ── trade.html ReportDoneCore portalUrl ──────────────────────────────────
// Extract the self-contained sentinel (same boundary CP2 smoke uses).
const sentinelStart = trade.indexOf('// <trade-reportdone>');
const sentinelEnd = trade.indexOf('// </trade-reportdone>');
if (sentinelStart < 0 || sentinelEnd < 0) {
  console.error('FAIL: trade-reportdone sentinel not found');
  process.exit(1);
}
// The sentinel ends with ReportDoneCore assignment; grab through the IIFE close.
let block = trade.slice(sentinelStart, sentinelEnd);
// Ensure we include the full IIFE if the end marker sits after it.
if (!block.includes('ReportDoneCore')) {
  console.error('FAIL: ReportDoneCore missing from sentinel slice');
  process.exit(1);
}
// The shipped file has: var ReportDoneCore = (function () { ... })();
// End marker is after the IIFE. Re-slice to a runnable form.
const iifeStart = trade.indexOf('var ReportDoneCore = (function ()', sentinelStart);
const iifeClose = trade.indexOf('})();', iifeStart);
if (iifeStart < 0 || iifeClose < 0) {
  console.error('FAIL: ReportDoneCore IIFE bounds not found');
  process.exit(1);
}
block = trade.slice(iifeStart, iifeClose + '})();'.length);

const tradeCtx = { URL };
vm.createContext(tradeCtx);
vm.runInContext(block + '\nthis.ReportDoneCore = ReportDoneCore;', tradeCtx);

const core = tradeCtx.ReportDoneCore;
if (!core || typeof core.portalUrl !== 'function') {
  // portalUrl may not be exported — fall back to evaluating via panel helpers.
  // Probe exports:
  const exportKeys = core ? Object.keys(core) : [];
  // If portalUrl is not exported, extract and eval a thin wrapper using the
  // same pure helpers defined inside the IIFE by re-running with an export hook.
  const patched = block.replace(
    /return\s*\{/,
    'return { portalUrl: portalUrl, urlIsBuilderPortalLink: urlIsBuilderPortalLink, urlLooksLikeAssetOrTracking: urlLooksLikeAssetOrTracking, ',
  );
  const tradeCtx2 = { URL };
  vm.createContext(tradeCtx2);
  vm.runInContext(patched + '\nthis.ReportDoneCore = ReportDoneCore;', tradeCtx2);
  const core2 = tradeCtx2.ReportDoneCore;
  check('trade portalUrl exportable', typeof core2.portalUrl === 'function');
  runTradeChecks(core2, exportKeys);
} else {
  runTradeChecks(core, Object.keys(core));
}

function runTradeChecks(coreApi, exportKeys) {
  const portalUrl = coreApi.portalUrl;
  const polluted = {
    external_links: [
      { label: 'Builder Portal', url: F5_LOGO, kind: 'builder_portal' },
      { label: 'Builder Portal', url: F5_TRACKER, kind: 'builder_portal' },
      { label: 'Roof Report', url: F5_EXPIRED, kind: 'roof_report' },
    ],
  };
  const got = portalUrl(polluted, {});
  check('trade portalUrl skips image-first, returns share', got === F5_EXPIRED);
  check(
    'trade portalUrl image-only is empty',
    portalUrl({
      external_links: [
        { label: 'Builder Portal', url: F5_LOGO, kind: 'builder_portal' },
      ],
    }, {}) === '',
  );
  check(
    'trade portalUrl keeps genuine share alone',
    portalUrl({
      external_links: [
        { label: 'Builder Portal', url: F5_SHARE, kind: 'builder_portal' },
      ],
    }, {}) === F5_SHARE,
  );
  if (typeof coreApi.urlIsBuilderPortalLink === 'function') {
    check('trade urlIsBuilderPortalLink rejects logo', !coreApi.urlIsBuilderPortalLink(F5_LOGO));
    check('trade urlIsBuilderPortalLink rejects tracker', !coreApi.urlIsBuilderPortalLink(F5_TRACKER));
    check('trade urlIsBuilderPortalLink keeps expired', coreApi.urlIsBuilderPortalLink(F5_EXPIRED));
  }
  void exportKeys;
}

// Also prove the outer trade link normaliser drops assets (link list path).
const tradeNormStart = trade.indexOf(
  '// F5 portal-link hygiene — mirror of ops-api urlIsBuilderPortalLink',
);
const tradeNormEnd = trade.indexOf('function mergeTradeExternalLinks', tradeNormStart);
if (tradeNormStart < 0 || tradeNormEnd < 0) {
  console.error('FAIL: trade outer hygiene block not found');
  failed++;
} else {
  const normBlock = trade.slice(tradeNormStart, tradeNormEnd + 'function mergeTradeExternalLinks'.length);
  // Complete mergeTradeExternalLinks body from source so we can call it.
  const mergeEnd = trade.indexOf('function linkifyTradeBodyText', tradeNormEnd);
  const full = trade.slice(tradeNormStart, mergeEnd);
  const tctx = { URL };
  vm.createContext(tctx);
  vm.runInContext(full, tctx);
  const links = tctx.mergeTradeExternalLinks([
    { label: 'Builder Portal', url: F5_LOGO, kind: 'builder_portal' },
    { label: 'Track', url: F5_TRACKER },
    { label: 'Share', url: F5_SHARE },
  ]);
  check('trade merge hides logo', !links.some((l) => l.url === F5_LOGO));
  check('trade merge hides tracker', !links.some((l) => l.url === F5_TRACKER));
  check('trade merge keeps share', links.some((l) => l.url === F5_SHARE));
}

if (failed) {
  console.error(`F5 portal link hygiene: ${failed} failure(s)`);
  process.exit(1);
}
console.log('F5 portal link hygiene display fixtures passed');
