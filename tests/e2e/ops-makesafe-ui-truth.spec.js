const { test, expect } = require('@playwright/test');

// Regression guards for PLAN v2 Batch 2 — "stop the board lying".
//   1. the job detail shows the CANONICAL board stage and gates its forward-move
//      buttons on it (<makesafe-detail-canonical-stage> in ops.html);
//   2. the card's family tag comes from the canonical feed's ses_family, never a
//      text/regex guess, and a refused family says so;
//   3. a Docs Ready card with no drafted pack says "No pack drafted";
//   4. the builder links the row already carries render on the card face.
// Ground truth for every number quoted here: data/ses-ui-ground-truth-v1.

// The card the captain's display ledger archived (SWMS-261099 in the report):
// declared report_ready, canonically archived, substatus still pre-allocation.
function ledgerArchivedRow() {
  return {
    id: 'job-archived',
    job_number: 'SWMS-ARCHIVED',
    type: 'makesafe',
    job_state: 'accepted',
    substatus: 'company_contact_required',
    declared_stage: 'new',
    canonical_stage: 'archive',
    canonical_stage_label: 'Archive',
    ses_family: 'temporary_fencing',
    ses_family_label: 'Temporary Fencing',
    makesafe_type: 'MakeSafe',
    builder: { name: 'ML Builders', external_ref: 'MLB-27227PO-56922' },
    contact: { client_name: 'Test Client', phone: null, address: '2 Test Street, Balga' },
    assignments: [], report: {}, pack: {}, lineage: {}, age: { age_days: 4, age_hours: 96 },
    blockers: {}, cancelled: null,
  };
}

function boardPayload(rows) {
  const columns = { new: [], allocated: [], trade_report_in: [], report_ready: [], completed: [], archive: [], cancelled: [] };
  rows.forEach((r) => { (columns[r.canonical_stage] || columns.new).push(r); });
  return { contract_version: 'makesafe-board.v1', projection: 'ops', columns, rows };
}

// Minimal job_detail payload — the shape renderMakesafeOpsDetail is handed.
function detailPayload(job) {
  return {
    job: Object.assign({ type: 'makesafe' }, job),
    documents: [], work_orders: [], invoices: [], events: [], media: [],
    assignments: [], service_reports: [],
  };
}

test('an archived card opens as Archive and offers no forward move', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate((payload) => {
    buildMakesafeBoardColumns(payload, {}); // board load remembers the canonical stage
    const html = renderMakesafeOpsDetail({
      job: { id: 'job-archived', type: 'makesafe', job_number: 'SWMS-ARCHIVED', status: 'accepted', substatus: 'company_contact_required' },
      documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [],
    });
    return { html, stage: resolveMakesafeDetailStage({ job: { id: 'job-archived' } }) };
  }, boardPayload([ledgerArchivedRow()]));

  expect(result.stage).toEqual({ stage: 'archive', source: 'board_feed' });
  // The badge agrees with the column...
  expect(result.html).toContain('>Archive<');
  expect(result.html).not.toContain('>New<');
  // ...and the substatus-derived forward move is gone.
  expect(result.html).not.toContain("advanceMakesafeSubstatus('job-archived','waiting_on_trade_report')");
  expect(result.html).toContain('No forward move is offered here');
});

test('job_detail canonical_stage outranks the remembered board stage', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate((payload) => {
    buildMakesafeBoardColumns(payload, {});
    const data = {
      job: { id: 'job-archived', type: 'makesafe', canonical_stage: 'allocated', status: 'accepted', substatus: 'company_contact_required' },
      documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [],
    };
    return { resolved: resolveMakesafeDetailStage(data), html: renderMakesafeOpsDetail(data) };
  }, boardPayload([ledgerArchivedRow()]));

  expect(result.resolved).toEqual({ stage: 'allocated', source: 'job_detail' });
  expect(result.html).toContain('>Allocated<');
  // A live stage keeps its legitimate next step.
  expect(result.html).toContain("advanceMakesafeSubstatus('job-archived','waiting_on_trade_report')");
});

test('a declared board_stage is never accepted as the detail stage', async ({ page }) => {
  await page.goto('/ops.html');
  // board_stage on a job_detail payload is the OVERLAY-BLIND declared stage.
  const resolved = await page.evaluate(() => resolveMakesafeDetailStage({
    job: { id: 'job-unseen', type: 'makesafe', board_stage: 'report_ready' },
  }));
  expect(resolved).toEqual({ stage: '', source: 'unknown' });
});

test('an unresolvable stage is stated, not guessed, and withholds every move', async ({ page }) => {
  await page.goto('/ops.html');
  const html = await page.evaluate(() => renderMakesafeOpsDetail({
    job: { id: 'job-unseen', type: 'makesafe', status: 'accepted', substatus: 'waiting_on_trade_report' },
    documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [],
  }));

  expect(html).toContain('Stage not confirmed');
  expect(html).toContain('Board stage not confirmed');
  // The substatus would have derived "Allocated" and offered the Docs ready move.
  expect(html).not.toContain('advanceMakesafeSubstatus');
});

test('the card family tag comes from the canonical feed, not the job text', async ({ page }) => {
  await page.goto('/ops.html');
  const labels = await page.evaluate(() => ({
    // SWMS-26853 in the ground-truth report: canonically assessment, tagged Roof Report.
    assessment: getMakesafeTypeLabel({
      ses_family: 'assessment_quote',
      makesafe_details: { scope: 'Roof report required for storm damage' },
      notes: 'roof report',
    }),
    // The feed's own wording wins when it sends one.
    feedLabel: getMakesafeTypeLabel({ ses_family: 'ordinary_roof_portal', ses_family_label: 'Roof Report (Prime portal)' }),
    fencing: getMakesafeTypeLabel({ ses_family: 'temporary_fencing', notes: 'board up window and make safe' }),
    // No canonical family: the pre-existing metadata/regex chain still applies.
    legacy: getMakesafeTypeLabel({ metadata: { makesafe_job_family: 'roof_report' } }),
  }));

  expect(labels.assessment).toBe('Assessment Report & Quote');
  expect(labels.feedLabel).toBe('Roof Report (Prime portal)');
  expect(labels.fencing).toBe('Temporary Fence MakeSafe');
  expect(labels.legacy).toBe('Roof Report');
});

test('a refused family renders as an unresolved state, never a guess', async ({ page }) => {
  await page.goto('/ops.html');
  const card = await page.evaluate(() => renderMakesafeCard({
    id: 'job-unknown-family', job_number: 'SWMS-UNKNOWN', board_stage: 'archive', canonical_stage: 'archive',
    ses_family: 'unknown', site_suburb: 'Perth', notes: 'roof report for storm damage',
  }, 'archive'));

  expect(card).toContain('Family not determined');
  expect(card).toContain('class="ms-ttag unknown"');
  expect(card).not.toContain('>ROOF REPORT<');
});

test('a Docs Ready card with no drafted pack says so', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(() => {
    const base = { id: 'a', job_number: 'SWMS-NOPACK', canonical_stage: 'report_ready', board_stage: 'report_ready', site_suburb: 'Perth', ses_family: 'assessment_quote' };
    const drafted = Object.assign({}, base, { id: 'b', job_number: 'SWMS-PACK', substatus: 'admin_to_send_report' });
    return {
      noPack: renderMakesafeCard(base, 'report_ready'),
      drafted: renderMakesafeCard(drafted, 'report_ready'),
      hasPack: [makesafeHasDraftedPack(base), makesafeHasDraftedPack(drafted)],
    };
  });

  expect(result.hasPack).toEqual([false, true]);
  expect(result.noPack).toContain('No pack drafted');
  expect(result.drafted).not.toContain('No pack drafted');
  expect(result.drafted).toContain('Review job pack');
});

test('the Docs Ready column states how many cards actually have a pack', async ({ page }) => {
  await page.goto('/ops.html');
  const header = await page.evaluate(() => {
    const rows = [0, 1, 2].map((i) => ({
      id: 'p' + i, job_number: 'SWMS-P' + i, canonical_stage: 'report_ready', type: 'makesafe',
      builder: {}, contact: {}, assignments: [], report: {}, pack: {}, lineage: {}, age: {}, blockers: {},
    }));
    const cols = buildMakesafeBoardColumns({ contract_version: 'makesafe-board.v1', columns: { report_ready: rows } }, {});
    const host = document.createElement('div');
    renderMakesafeKanban(host, cols);
    const el = host.querySelector('.kanban-col[data-status="report_ready"] .kanban-col-header');
    return el ? el.textContent : '';
  });

  expect(header).toContain('Docs Ready');
  expect(header).toContain('0 of 3 with a drafted pack');
});

test('builder links the row already carries render on the card face', async ({ page }) => {
  await page.goto('/ops.html');
  const card = await page.evaluate(() => renderMakesafeCard({
    id: 'job-links', job_number: 'SWMS-LINKS', canonical_stage: 'report_ready', board_stage: 'report_ready',
    site_suburb: 'Perth', ses_family: 'assessment_quote',
    makesafe_details: {
      external_links: [
        { kind: 'assessment_report', url: 'https://primeeco.tech/share/report-1' },
        { kind: 'photos', url: 'https://primeeco.tech/share/photos-1' },
        { kind: 'quote', url: 'https://primeeco.tech/share/quote-1' },
        { kind: 'builder_portal', url: 'https://documents.primeeco.tech/asset-1' },
        // duplicate URL: deduped, never counted twice
        { kind: 'quote', url: 'https://primeeco.tech/share/quote-1' },
      ],
    },
  }, 'report_ready'));

  expect(card).toContain('href="https://primeeco.tech/share/report-1"');
  expect(card).toContain('Assessment Report');
  expect(card).toContain('Photo Schedule');
  // Capped at three, remainder counted honestly (4 unique URLs, 3 shown).
  expect(card).toContain('+1 more');
  // The anchors must never trip the card's open-detail click.
  expect(card).toContain('onclick="event.stopPropagation();"');
});

test('a card with no links renders no link row', async ({ page }) => {
  await page.goto('/ops.html');
  const card = await page.evaluate(() => renderMakesafeCard(
    { id: 'x', job_number: 'SWMS-NOLINK', canonical_stage: 'new', board_stage: 'new', site_suburb: 'Perth' }, 'new'));
  expect(card).not.toContain('ms-links');
});

test('the card Trade chip never contradicts the canonical column', async ({ page }) => {
  await page.goto('/ops.html');
  const labels = await page.evaluate(() => ({
    // substatus says "ready to invoice" while the feed says the card is New.
    newColumn: makesafeTradeStageLabel({ canonical_stage: 'new', board_stage: 'new', substatus: 'ready_to_invoice' }, 'new'),
    reportIn: makesafeTradeStageLabel({ canonical_stage: 'trade_report_in', board_stage: 'trade_report_in' }, 'trade_report_in'),
    archived: makesafeTradeStageLabel({ canonical_stage: 'archive', board_stage: 'archive' }, 'archive'),
  }));

  expect(labels.newColumn).toBe('New');
  expect(labels.reportIn).toBe('Trade Report In');
  expect(labels.archived).toBe('');
});
