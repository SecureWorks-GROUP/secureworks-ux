const { test, expect, PERSONAS } = require('../fixtures/test');
const { signIn } = require('../helpers/auth');

// Repair is a first-class job vertical alongside make-safe/fencing/patio
// (Captain Shaun, 2026-09-17). A repair-family make-safe (job_type still
// 'makesafe', job_family 'repair' — the Hugo/SWMS-261319 motivating case) and
// a plain type=repair job must both show under the calendar's Repair filter,
// never under Make-safe, and both must open to the normal job detail with a
// Documents section — never the make-safe report flow. A plain make-safe must
// keep behaving exactly as before.
test.describe('Trade repair vertical', () => {
  test.use({ persona: 'installer', feedScenario: 'trade-repair-vertical' });

  test('a repair-family make-safe and a plain repair job both file under Repair, never Make-safe, and open to a normal detail with documents', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);

    // This trade's own work is mostly repair, so the calendar opens on Repair
    // (it follows the trade's own work). Pick Make-safe: the plain make-safe
    // board job renders there, and neither repair job leaks onto it.
    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="makesafe"]').click();
    await page.locator('#ncDoneBtn').click();
    await expect(page.locator('#ncCalhost')).toContainText('E2E-MS-002');
    await expect(page.locator('#ncCalhost')).not.toContainText('SWMS-261319');
    await expect(page.locator('#ncCalhost')).not.toContainText('REP-51002');

    // Switch the calendar type filter to Repair.
    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="repair"]').click();
    await expect(page.locator('#ncSheetBody [data-ftype="repair"]')).toHaveClass(/on/);
    await page.locator('#ncDoneBtn').click();

    // Both repair jobs are visible and marked Repair; the make-safe job is not.
    const familyCard = page.locator('#ncCalhost .ncard.rp').filter({ hasText: 'SWMS-261319' });
    const plainCard = page.locator('#ncCalhost .ncard.rp').filter({ hasText: 'REP-51002' });
    await expect(familyCard).toBeVisible();
    await expect(familyCard).toContainText('Repair');
    await expect(plainCard).toBeVisible();
    await expect(plainCard).toContainText('Repair');
    await expect(page.locator('#ncCalhost')).not.toContainText('E2E-MS-002');

    // Tapping the repair-family make-safe opens the normal job detail (never
    // the make-safe report flow) with its two documents.
    await familyCard.click();
    await page.locator('#ncSheetFoot').getByText('Open job', { exact: true }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#viewReport')).not.toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('SWMS-261319');
    await page.locator('.jd-tab[data-tab="files"]').click();
    await expect(page.locator('#jobDetailContent')).toContainText('Approvals & Documents');
    await expect(page.locator('#jobDetailContent')).toContainText('Repair-family-swms.pdf');
    await expect(page.locator('#jobDetailContent')).toContainText('Repair-family-notes.pdf');

    // Back to the calendar (still on the Repair filter) — the plain repair
    // job opens the same way.
    await page.locator('[data-view="schedule"]').click();
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    await plainCard.click();
    await page.locator('#ncSheetFoot').getByText('Open job', { exact: true }).click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#viewReport')).not.toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('REP-51002');
    await page.locator('.jd-tab[data-tab="files"]').click();
    await expect(page.locator('#jobDetailContent')).toContainText('Approvals & Documents');
    await expect(page.locator('#jobDetailContent')).toContainText('Repair-swms.pdf');
    await expect(page.locator('#jobDetailContent')).toContainText('Repair-notes.pdf');
  });

  test('My Jobs repair cards carry the builder WO, claim and PO refs, and a claim ref equal to the WO is drawn once', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await page.locator('[data-view="myJobs"]').click();
    await expect(page.locator('#viewMyJobs')).toHaveClass(/active/);

    // Plain repair: WO, then the PO, then a claim ref that differs from the WO.
    const plainCard = page.locator('#myJobsList .jc.rp').filter({ hasText: 'REP-51002' });
    await expect(plainCard).toBeVisible();
    await expect(plainCard).toContainText('Repair');
    await expect(plainCard.locator('.jc-refs')).toHaveText(/REP-51002.*WO WO-8891.*PO-556701.*CLM-2026-0017/);
    await expect(plainCard).toContainText('Plain Repair Builders');

    // Repair-family make-safe (MLB rapid repair): the claim ref equals the WO
    // number (case aside), so the WO chip stands alone — no duplicate chip,
    // and no make-safe external-ref chip either.
    const familyCard = page.locator('#myJobsList .jc.rp').filter({ hasText: 'SWMS-261319' });
    await expect(familyCard).toBeVisible();
    await expect(familyCard).toContainText('Repair');
    await expect(familyCard.locator('.jc-refs')).toHaveText(/SWMS-261319.*WO MLB-RR-27649.*PO-540001/);
    const familyRefs = await familyCard.locator('.jc-refs').innerText();
    expect(familyRefs.toLowerCase().split('mlb-rr-27649').length - 1).toBe(1);
    await expect(familyCard).toContainText('MLB Builders');

    // The pre-existing patio card is untouched by the repair rows.
    await expect(page.locator('#myJobsList .jc.pt').filter({ hasText: 'E2E-JOB-001' })).toBeVisible();

    // On a 360px phone the four-ref line wraps rather than clipping: every
    // ref, PO and claim included, is painted inside the refs box.
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(plainCard).toBeVisible();
    const refsFit = await plainCard.locator('.jc-refs').evaluate((el, wanted) => {
      const box = el.getBoundingClientRect();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const result = {};
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        wanted.forEach((ref) => {
          const at = node.textContent.indexOf(ref);
          if (at < 0) return;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + ref.length);
          const r = range.getBoundingClientRect();
          result[ref] = r.width > 0 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1;
        });
      }
      return { fits: result, clipped: el.scrollWidth > el.clientWidth + 1 };
    }, ['REP-51002', 'WO WO-8891', 'PO-556701', 'CLM-2026-0017']);
    expect(refsFit.clipped).toBe(false);
    expect(refsFit.fits).toEqual({ 'REP-51002': true, 'WO WO-8891': true, 'PO-556701': true, 'CLM-2026-0017': true });

    // A repair-family make-safe opens the normal job detail from the list too.
    await familyCard.click();
    await expect(page.locator('#viewJob')).toHaveClass(/active/);
    await expect(page.locator('#viewReport')).not.toHaveClass(/active/);
    await expect(page.locator('#jobDetailContent')).toContainText('SWMS-261319');
  });

  test('a plain make-safe still files under Make-safe, not Repair, and behaves as today', async ({ appPage: page }) => {
    await signIn(page, PERSONAS.installer);
    await expect(page.locator('#viewSchedule')).toHaveClass(/active/);
    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="makesafe"]').click();
    await page.locator('#ncDoneBtn').click();
    await expect(page.locator('#ncCalhost .ncard.ms').filter({ hasText: 'E2E-MS-002' })).toBeVisible();

    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="repair"]').click();
    await page.locator('#ncDoneBtn').click();
    await expect(page.locator('#ncCalhost')).not.toContainText('E2E-MS-002');

    await page.locator('#ncFbtn').click();
    await page.locator('#ncSheetBody [data-ftype="makesafe"]').click();
    await page.locator('#ncDoneBtn').click();
    const msCard = page.locator('#ncCalhost .ncard.ms').filter({ hasText: 'E2E-MS-002' });
    await expect(msCard).toBeVisible();
    await msCard.click();
    await page.locator('#ncSheetFoot').getByText('Open job', { exact: true }).click();
    // Make-safe still opens its own quick-look overlay, never the standard job view.
    await expect(page.locator('#msv5DetailOverlay')).toHaveClass(/active/);
    await expect(page.locator('#viewJob')).not.toHaveClass(/active/);
  });
});
