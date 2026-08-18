const { test, expect } = require('@playwright/test');
const fixture = require('./fixtures/ses-loop-overlay-cards.js');

test('Docs Ready cards: drafted pack opens review/send; chips match pack; no invented pack', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate((fx) => {
    window._msSesReviewQueue = {};
    window._makesafeCanonicalPackById = {};
    window._makesafeCanonicalPackMetaById = {};
    window._makesafePackChipById = {};

    const cards = {};
    fx.cards.forEach((c) => {
      if (c.pack && c.pack.drafted) {
        window._makesafeCanonicalPackById[c.id] = true;
        window._makesafeCanonicalPackMetaById[c.id] = {
          drafted: true,
          docket_revision_id: c.pack.docket_revision_id || null,
        };
      }
      if (c.packFacts) window._makesafePackChipById[c.id] = c.packFacts;
      cards[c.job_number] = renderMakesafeCard(c.row, 'report_ready');
    });

    return {
      cards,
      affordance: {
        'SWMS-261237': makesafeCardHasReviewAffordance(fx.cards[0].row, 'report_ready'),
        'SWMS-261241': makesafeCardHasReviewAffordance(fx.cards[1].row, 'report_ready'),
        'SWMS-261243': makesafeCardHasReviewAffordance(fx.cards[2].row, 'report_ready'),
      },
    };
  }, fixture);

  expect(result.affordance['SWMS-261237']).toBe(true);
  expect(result.cards['SWMS-261237']).toMatch(/ms-btn-alloc[^>]*>Review job pack/);

  expect(result.affordance['SWMS-261241']).toBe(true);
  expect(result.cards['SWMS-261241']).toContain('Work order: attached');
  expect(result.cards['SWMS-261241']).not.toContain('Work order: missing (expected)');
  expect(result.cards['SWMS-261241']).toMatch(/4\s*\/\s*5/);

  expect(result.affordance['SWMS-261243']).toBe(false);
  expect(result.cards['SWMS-261243']).toContain('No pack drafted');
  expect(result.cards['SWMS-261243']).not.toMatch(/ms-btn-alloc[^>]*>Review job pack/);
});

test('hours and wording edits preview on the pane, lock the press, and die with the docket revision', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate((fx) => {
    const jobId = fx.overlay.jobId;
    window._msReportingCache = window._msReportingCache || {};
    window._msReportingCache[jobId] = JSON.parse(JSON.stringify(fx.overlay.row));
    window._msSesPackCache = window._msSesPackCache || {};
    window._msSesPackCache[jobId] = fx.overlay.ctx;
    window._msSesSendPreview = {};
    const before = window._msSesRenderDetail(jobId, fx.overlay.ctx, 'msReportingDetailPanel');
    window._msSesSendPreview[jobId] = {
      docketRevisionId: fx.overlay.ctx.docketRevisionId,
      outputHash: fx.overlay.ctx.outputHash || null,
      hours: 5,
      routes: { report: { subject: 'Edited subject', body: 'Edited wording for the builder.' } },
    };
    const after = window._msSesRenderDetail(jobId, fx.overlay.ctx, 'msReportingDetailPanel');
    // A revised pack lands as a NEW docket revision: the stale edit must not
    // overlay it, and the resolver clears the dead preview.
    const revisedCtx = Object.assign({}, fx.overlay.ctx, { docketRevisionId: 'revised-docket-rev' });
    const revised = window._msSesRenderDetail(jobId, revisedCtx, 'msReportingDetailPanel');
    return { before, after, revised, previewCleared: !window._msSesSendPreview[jobId] };
  }, fixture);

  expect(result.before).toContain('Hours &amp; wording');
  expect(result.before).toContain('Update send pack');
  expect(result.after).toContain('Edited subject');
  expect(result.after).toContain('Edited wording for the builder.');
  expect(result.after).toContain('Your edits are recorded on this docket');
  expect(result.after).toContain('does not carry them yet');
  expect(result.after).not.toContain('approve_ses_invoice_revision');
  expect(result.after).not.toContain('execute_ses_release_revision');
  expect(result.revised).not.toContain('Edited subject');
  expect(result.revised).not.toContain('Edited wording for the builder.');
  expect(result.previewCleared).toBe(true);
});
