const { test, expect } = require('@playwright/test');

// Regression guard for <makesafe-workorder-identity> in ops.html.
//
// The defect: the make-safe card's inline document carousel filled its single
// "Work Order" slot with pickLatestMakesafeDoc — newest created_at wins, no
// identity check — and the append pass then hid the loser as a duplicate copy.
// On nine live MLB cards the second work order is not a copy, it is a different
// builder instruction, so the operator was shown the wrong job's PDF with no
// chip, no arrow and no warning (audit ses-family-truth-audit-v1 §1b, §4).
//
// The two rows below are the captain's own cards, with their REAL file names and
// created_at values read read-only from production. On SWMS-26759 the two rows
// are 36 ms apart, so before this change the document on screen was decided by a
// race. No client identity appears here: file names carry only the builder claim
// ref and the PO, which are work references.
//
// Everything asserted is client render. These specs perform no write.

function detailPayload(over) {
  return Object.assign({
    job: { id: 'job-wo', type: 'makesafe', job_number: 'SWMS-WO', status: 'accepted' },
    makesafe_details: { external_ref: 'MLB-26183' },
    documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], job_assignments: [],
  }, over || {});
}

function woDoc(over) {
  return Object.assign({
    id: 'doc-' + Math.random().toString(16).slice(2),
    type: 'work_order',
    file_name: 'work_order_MLB-26183PO-54000_Secureworks_Group_Pty_Ltd.pdf',
    url: 'https://example.invalid/wo.pdf',
    created_at: '2026-07-21T11:11:07.028362+00:00',
  }, over || {});
}

// SWMS-26852 as production holds it: recorded assessment_quote, but the NEWER of
// its two work orders is the roof one, and that is the one the old rule showed.
const CARD_26852 = detailPayload({
  job: { id: 'job-26852', type: 'makesafe', job_number: 'SWMS-26852', status: 'accepted' },
  makesafe_details: { external_ref: 'MLB-26183' },
  documents: [
    woDoc({ id: 'doc-54000', file_name: 'work_order_MLB-26183PO-54000_Secureworks_Group_Pty_Ltd.pdf', created_at: '2026-07-21T11:11:07.028362+00:00' }),
    woDoc({ id: 'doc-53995', file_name: 'work_order_MLB-26183PO-53995_Secureworks_Group_Pty_Ltd.pdf', created_at: '2026-07-21T11:11:05.961384+00:00' }),
  ],
});

// SWMS-26759: the same shape, 36 ms apart.
const CARD_26759 = detailPayload({
  job: { id: 'job-26759', type: 'makesafe', job_number: 'SWMS-26759', status: 'accepted' },
  makesafe_details: { external_ref: 'MLB-25765' },
  documents: [
    woDoc({ id: 'doc-54176', file_name: 'work_order_MLB-25765PO-54176_Secureworks_Group_Pty_Ltd.pdf', created_at: '2026-06-23T01:45:16.777804+00:00' }),
    woDoc({ id: 'doc-54177', file_name: 'work_order_MLB-25765PO-54177_Secureworks_Group_Pty_Ltd.pdf', created_at: '2026-06-23T01:45:16.7413+00:00' }),
  ],
});

test.beforeEach(async ({ page }) => {
  await page.goto('/ops.html');
});

test('both of a card\'s work orders are listed, each named by its own PO', async ({ page }) => {
  const result = await page.evaluate((payloads) => payloads.map((p) => ({
    job: p.job.job_number,
    docs: buildMakesafeDocList(p).map((d) => ({ label: d.label, slot: d.slot, poRef: d.poRef, id: d.doc && d.doc.id })),
  })), [CARD_26852, CARD_26759]);

  const c26852 = result[0].docs.filter((d) => d.slot === 'work_order');
  expect(c26852).toHaveLength(2);
  expect(c26852.map((d) => d.poRef).sort()).toEqual(['PO-53995', 'PO-54000']);
  expect(c26852.map((d) => d.label).sort()).toEqual(['Work Order · PO-53995', 'Work Order · PO-54000']);

  const c26759 = result[1].docs.filter((d) => d.slot === 'work_order');
  expect(c26759).toHaveLength(2);
  expect(c26759.map((d) => d.poRef).sort()).toEqual(['PO-54176', 'PO-54177']);
});

test('the viewer warns, by count and by PO, that the card carries two work orders', async ({ page }) => {
  const html = await page.evaluate((p) => renderMakesafeDocViewer(p), CARD_26852);

  expect(html).toContain('2 work orders');
  expect(html).toContain('PO-53995');
  expect(html).toContain('PO-54000');
  // The card declares only a claim ref (MLB-26183), no PO — so the UI must NOT
  // claim it preferred one. This is the honest state for all nine live cards.
  expect(html).toContain('Nothing on this card says which instruction it is');
  expect(html).toContain('none is hidden');
  // Both are reachable as chips in the carousel.
  expect(html).toContain('msafeDocViewerJump(0)');
  expect(html).toContain('msafeDocViewerJump(1)');
  expect(html).toContain('Work Order · PO-53995');
  expect(html).toContain('Work Order · PO-54000');
});

test('the card\'s own PO selects the leading work order when the card declares one', async ({ page }) => {
  // Live refs run the claim straight into the PO ("MLB-27227PO-56922"), which is
  // the only case where the card can tell which instruction it is.
  const payload = detailPayload({
    job: { id: 'job-po', type: 'makesafe', job_number: 'SWMS-PO', status: 'accepted', external_ref: 'MLB-26183PO-53995' },
    documents: CARD_26852.documents,
  });
  const result = await page.evaluate((p) => {
    const docs = buildMakesafeDocList(p);
    return { docs: docs.map((d) => ({ label: d.label, slot: d.slot, poRef: d.poRef, matchesCardPo: d.matchesCardPo })), html: renderMakesafeDocViewer(p) };
  }, payload);

  const wos = result.docs.filter((d) => d.slot === 'work_order');
  // The card's PO leads even though it is the OLDER row — age no longer decides.
  expect(wos[0].poRef).toBe('PO-53995');
  expect(wos[0].matchesCardPo).toBe(true);
  expect(wos[1].poRef).toBe('PO-54000');
  // ...and the other one is still there.
  expect(wos).toHaveLength(2);
  expect(result.html).toContain('it is the one that matches this card');
});

test('a single work order is unchanged: plain label, no warning', async ({ page }) => {
  const payload = detailPayload({ documents: [woDoc({ id: 'doc-only' })] });
  const result = await page.evaluate((p) => ({
    docs: buildMakesafeDocList(p).map((d) => ({ label: d.label, slot: d.slot })),
    html: renderMakesafeDocViewer(p),
  }), payload);

  const wos = result.docs.filter((d) => d.slot === 'work_order');
  expect(wos).toHaveLength(1);
  expect(wos[0].label).toBe('Work Order');
  expect(result.html).not.toContain('work orders');
});

test('a card with no work order still shows the honest missing slot', async ({ page }) => {
  const result = await page.evaluate((p) => buildMakesafeDocList(p).map((d) => ({ label: d.label, slot: d.slot, kind: d.kind })), detailPayload({}));
  expect(result).toEqual([{ label: 'Work Order', slot: 'work_order', kind: 'missing' }]);
});

test('extractPoRef reads the PO out of a live ref and refuses to invent one', async ({ page }) => {
  const out = await page.evaluate(() => ({
    // The claim runs straight into the PO: no word boundary before the P.
    joined: extractPoRef('MLB-27227PO-56922'),
    fileName: extractPoRef('work_order_MLB-26183PO-54000_Secureworks_Group_Pty_Ltd.pdf'),
    plain: extractPoRef('PO-54000'),
    padded: extractPoRef('PO-054000'),
    // A claim ref alone declares no PO — this is why nine live cards get no
    // preferred work order rather than a guessed one.
    claimOnly: extractPoRef('MLB-26183'),
    wordEndingInPo: extractPoRef('REPO-123'),
    empty: extractPoRef(null),
  }));
  expect(out).toEqual({
    joined: 'PO-56922',
    fileName: 'PO-54000',
    plain: 'PO-54000',
    padded: 'PO-54000',
    claimOnly: '',
    wordEndingInPo: '',
    empty: '',
  });
});

// ── Intake draft review screen — the same class of bug ─────────────────────
// intakeFirstPdfUrl returned the FIRST attachment's URL, so a draft whose email
// carried two work orders was reviewed against whichever came first.

function draft(over) {
  return Object.assign({
    id: 'draft-1',
    subject: 'Works order',
    extraction_json: { external_ref: 'MLB-26183' },
    attachments_json: [
      { file_name: 'work_order_MLB-26183PO-54000_Secureworks_Group_Pty_Ltd.pdf', pdf_url: 'https://example.invalid/wo-54000.pdf' },
      { file_name: 'work_order_MLB-26183PO-53995_Secureworks_Group_Pty_Ltd.pdf', pdf_url: 'https://example.invalid/wo-53995.pdf' },
    ],
  }, over || {});
}

test('the intake review screen offers every work order on the draft, not the first', async ({ page }) => {
  const out = await page.evaluate((d) => {
    _makesafeIntakeDraftCache[d.id] = d;
    renderMakesafeIntakeReview(d.id);
    return {
      pdfs: intakeWorkOrderPdfs(d).map((p) => ({ poRef: p.poRef, matchesDraftPo: p.matchesDraftPo })),
      html: document.getElementById('jobsBody').innerHTML,
    };
  }, draft());

  expect(out.pdfs.map((p) => p.poRef)).toEqual(['PO-54000', 'PO-53995']);
  expect(out.pdfs.every((p) => p.matchesDraftPo === false)).toBe(true);
  expect(out.html).toContain('2 work orders');
  expect(out.html).toContain('msiReviewPdfJump(1)');
});

test('the draft\'s own PO selects which work order is reviewed', async ({ page }) => {
  const out = await page.evaluate((d) => {
    _makesafeIntakeDraftCache[d.id] = d;
    renderMakesafeIntakeReview(d.id);
    return {
      first: intakeFirstPdfUrl(d),
      src: document.getElementById('msiPdfFrame').getAttribute('src'),
    };
  }, draft({ extraction_json: { external_ref: 'MLB-26183PO-53995' } }));

  expect(out.first).toContain('wo-53995.pdf');
  expect(out.src).toContain('wo-53995.pdf');
});

test('named work orders exclude unrelated servable attachments from review', async ({ page }) => {
  const d = draft({ attachments_json: [
    { file_name: 'quote_MLB-26183.pdf', pdf_url: 'https://example.invalid/quote.pdf' },
    { file_name: 'work_order_MLB-26183PO-54000.pdf', pdf_url: 'https://example.invalid/wo-54000.pdf' },
  ] });
  const out = await page.evaluate((draftRow) => {
    _makesafeIntakeDraftCache[draftRow.id] = draftRow;
    renderMakesafeIntakeReview(draftRow.id);
    return {
      pdfs: intakeWorkOrderPdfs(draftRow).map((p) => p.name),
      html: document.getElementById('jobsBody').innerHTML,
    };
  }, d);
  expect(out.pdfs).toEqual(['work_order_MLB-26183PO-54000.pdf']);
  expect(out.html).not.toContain('quote_MLB-26183.pdf');
  expect(out.html).not.toContain('work orders');
});

test('unidentified servable attachments remain available as a review fallback', async ({ page }) => {
  const d = draft({ attachments_json: [
    { file_name: 'builder-document.pdf', pdf_url: 'https://example.invalid/builder-document.pdf' },
    { file_name: 'site-plan.pdf', pdf_url: 'https://example.invalid/site-plan.pdf' },
  ] });
  const out = await page.evaluate((draftRow) => ({
    first: intakeFirstPdfUrl(draftRow),
    pdfs: intakeWorkOrderPdfs(draftRow).map((p) => p.identifiedWorkOrder),
    warning: renderIntakeMultiWorkOrderWarning(intakeWorkOrderPdfs(draftRow)),
  }), d);
  expect(out.first).toContain('builder-document.pdf');
  expect(out.pdfs).toEqual([false, false]);
  expect(out.warning).toBe('');
});

test('switching the reviewed work order swaps the frame and the full-screen link', async ({ page }) => {
  const out = await page.evaluate((d) => {
    _makesafeIntakeDraftCache[d.id] = d;
    renderMakesafeIntakeReview(d.id);
    const before = document.getElementById('msiPdfFrame').getAttribute('src');
    msiReviewPdfJump(1);
    return {
      before,
      after: document.getElementById('msiPdfFrame').getAttribute('src'),
      href: document.getElementById('msiPdfOpen').getAttribute('href'),
      activeChips: document.querySelectorAll('.msi-wo-chip.active').length,
    };
  }, draft());

  expect(out.before).toContain('wo-54000.pdf');
  expect(out.after).toContain('wo-53995.pdf');
  expect(out.href).toContain('wo-53995.pdf');
  expect(out.activeChips).toBe(1);
});

test('a draft with one usable work order keeps the plain single-PDF review', async ({ page }) => {
  const d = draft({ attachments_json: [{ file_name: 'work_order_MLB-26183PO-54000.pdf', pdf_url: 'https://example.invalid/wo-54000.pdf' }] });
  const out = await page.evaluate((draftRow) => {
    _makesafeIntakeDraftCache[draftRow.id] = draftRow;
    renderMakesafeIntakeReview(draftRow.id);
    return document.getElementById('jobsBody').innerHTML;
  }, d);
  expect(out).not.toContain('work orders');
  expect(out).not.toContain('msi-wo-chip');
});

test('an unavailable attachment is still skipped (GRACEFUL PDF unchanged)', async ({ page }) => {
  const d = draft({
    attachments_json: [
      { file_name: 'work_order_MLB-26183PO-54000.pdf', pdf_url: 'https://example.invalid/wo-54000.pdf', pdf_unavailable: true },
      { file_name: 'work_order_MLB-26183PO-53995.pdf', pdf_url: 'https://example.invalid/wo-53995.pdf' },
    ],
  });
  const out = await page.evaluate((draftRow) => ({
    pdfs: intakeWorkOrderPdfs(draftRow).map((p) => p.poRef),
    first: intakeFirstPdfUrl(draftRow),
  }), d);
  expect(out.pdfs).toEqual(['PO-53995']);
  expect(out.first).toContain('wo-53995.pdf');
});
