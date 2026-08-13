const { test, expect } = require('@playwright/test');
const path = require('path');

// Regression guards for the LIVE PORTAL READER thumbnail + honest chip on the
// make-safe board (<makesafe-portal-live-thumb> in ops.html). The board keeps a
// headless reader screenshotting the Prime/PrimeEco share page; the card shows
// that STORED shot and an honest state — Locked / Filling n-of-n / Link gone /
// Locked (link gone) — without a human opening the portal, and the thumb opens
// the stored screenshot, never the dead Prime URL.
//
// Ground truth for the Locked case: Glendalough SWMS-261171, latest reader
// capture `done` ("form locked/submitted, 22 of 24 answered"), 2026-08-13.

const glenFixture = require('./fixtures/ses-portal-thumb-glendalough.js');

// A minimal board row carrying a portal_capture, in the live feed's shape.
function rowWithCapture(portalCapture, over) {
  return Object.assign({
    contract_version: 'makesafe-board.v1',
    id: 'job-cap',
    job_number: 'SWMS-CAP',
    type: 'makesafe',
    ses_family: 'ordinary_roof_portal',
    ses_family_label: 'Roof Report',
    job_state: 'accepted',
    substatus: 'waiting_on_trade_report',
    declared_stage: 'trade_report_in',
    canonical_stage: 'trade_report_in',
    canonical_stage_label: 'Trade Report In',
    makesafe_type: 'Roof Report',
    builder: { name: 'Prime', external_ref: 'PRIME-CAP' },
    contact: { client_name: null, phone: null, address: 'Glendalough WA 6016' },
    site_suburb: 'Glendalough',
    assignments: [],
    report: { state: 'not_started' },
    pack: { state: 'not_started', sent: false, drafted: false, closeout_documents: {} },
    age: { age_days: 2, age_hours: 48 },
    portal_capture: portalCapture,
  }, over || {});
}

async function renderCard(page, row, status) {
  return page.evaluate(({ row, status }) => {
    const j = mapCanonicalMakesafeRow(row, null);
    return renderMakesafeCard(j, status || 'trade_report_in');
  }, { row, status });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
});

test('Glendalough locked capture shows the thumb and a Locked chip', async ({ page }) => {
  const html = await renderCard(page, glenFixture.glendaloughRow(), 'trade_report_in');
  // the stored screenshot renders as an <img> in the thumb button
  expect(html).toContain('class="ms-portal-thumb"');
  expect(html).toContain('<img src="data:image/svg+xml');
  // the honest chip reads Locked (the latest capture is `done`)
  expect(html).toContain('ms-portal-chip locked');
  expect(html).toContain('>Locked<');
  // it does NOT read as waiting / filling / gone
  expect(html).not.toContain('Filling');
  expect(html).not.toContain('Link gone');
});

test('the thumb opens the STORED screenshot, never the Prime share URL', async ({ page }) => {
  const primeUrl = 'https://primeeco.tech/share/2693b47f-e2cb-4be4-8097-e8bd14755f98';
  const html = await renderCard(page, rowWithCapture({
    role: 'roof_report',
    // A backend that leaks the live share URL onto a URL-ish field must not turn
    // into a clickable Prime link: we only ever carry the signed screenshot read.
    screenshot_url: 'https://sign.example/shot.png',
    source_url: primeUrl,
    result: 'done',
    signal: 'form locked/submitted (form-locked banner), 22 of 24 answered',
  }));
  expect(html).toContain("openMakesafePortalShot('https://sign.example/shot.png')");
  expect(html).not.toContain(primeUrl);
  // the click is stopped from opening the job card
  expect(html).toContain('event.stopPropagation();openMakesafePortalShot');
});

test('chip states: filling n-of-n, link gone, and locked-then-link-gone', async ({ page }) => {
  const filling = await renderCard(page, rowWithCapture({
    role: 'roof_report', screenshot_url: 'https://sign.example/a.png',
    result: 'not_done', signal: 'form is live and NOT locked, 19 of 23 answered - the trade has not submitted',
  }));
  expect(filling).toContain('ms-portal-chip filling');
  expect(filling).toContain('Filling 19/23');

  // latest unreachable with a prior done shown -> Locked, link gone (not waiting)
  const lockedGone = await renderCard(page, rowWithCapture({
    role: 'roof_report', screenshot_url: 'https://sign.example/b.png',
    shown_result: 'done', shown_signal: 'form locked/submitted (form-locked banner), 21 of 23 answered',
    latest_result: 'unreachable',
  }));
  expect(lockedGone).toContain('ms-portal-chip locked-gone');
  expect(lockedGone).toContain('Locked · link gone');

  // never locked, link now gone -> plain Link gone
  const gone = await renderCard(page, rowWithCapture({
    role: 'roof_report', screenshot_url: 'https://sign.example/c.png',
    shown_result: 'unreachable', latest_result: 'unreachable',
    signal: 'builder link is expired or no longer active - the trade cannot submit',
  }));
  expect(gone).toContain('ms-portal-chip gone');
  expect(gone).toContain('>Link gone<');
});

test('no capture, a bad url, or a non-portal role renders no thumb', async ({ page }) => {
  const none = await renderCard(page, rowWithCapture(null));
  expect(none).not.toContain('ms-portal-thumb');

  // a storage key / non-http value is not a showable signed read
  const badUrl = await renderCard(page, rowWithCapture({
    role: 'roof_report', screenshot_url: 'makesafe-docket-artifacts/portal-captures/x.png', result: 'done',
  }));
  expect(badUrl).not.toContain('ms-portal-thumb');

  // an unexpected role is refused (backend only attaches roof/assessment)
  const wrongRole = await renderCard(page, rowWithCapture({
    role: 'photos', screenshot_url: 'https://sign.example/d.png', result: 'done',
  }));
  expect(wrongRole).not.toContain('ms-portal-thumb');
});
