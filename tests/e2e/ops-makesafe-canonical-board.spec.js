const { test, expect } = require('@playwright/test');

// Regression guards for the ops make-safe board's canonical data source
// (ops-api?action=makesafe_board, contract makesafe-board.v1 / projection ops).
// The board used to render makesafe_pipeline, which is keyed on the raw
// board_stage and therefore never showed a captain display-ledger transition.
// See the <makesafe-board-canonical> block in ops.html.

// A canonical row whose display ledger archived it out of Docs Ready — the exact
// shape of SWMS-261124 on 2026-08-01.
function ledgerArchivedRow() {
  return {
    contract_version: 'makesafe-board.v1',
    id: 'job-ledger-archived',
    job_number: 'SWMS-LEDGER',
    type: 'makesafe',
    job_state: 'invoiced',
    substatus: 'admin_to_send_report',
    declared_stage: 'report_ready',
    canonical_stage: 'archive',
    canonical_stage_label: 'Archive',
    status_application: {
      run_key: 'ses-historical:archive',
      before_status: 'report_ready',
      after_status: 'archive',
      applied_by: 'captain-ruling-2026-08-01',
      duplicate_of_job_number: null,
    },
    makesafe_type: 'MakeSafe',
    builder: { name: 'Builderwest Pty Ltd', external_ref: 'BWCWA-6648' },
    contact: { client_name: 'Test Client', phone: null, address: '1 Test Street, Cottesloe' },
    assignments: [],
    report: { state: 'processed', submitted_at: null, photo_count: 0 },
    pack: { state: 'sent', sent: true, closeout_documents: { report: true, invoice: true, swms: false } },
    lineage: {},
    age: { age_hours: 240, age_days: 10 },
    blockers: { blocked: false, real: [], stale_artifacts: [] },
    cancelled: null,
  };
}

function boardPayload(rows, extra) {
  const columns = { new: [], allocated: [], trade_report_in: [], report_ready: [], completed: [], archive: [], cancelled: [] };
  rows.forEach((r) => { (columns[r.canonical_stage] || columns.new).push(r); });
  return Object.assign({
    contract_version: 'makesafe-board.v1',
    projection: 'ops',
    generated_at: '2026-08-01T10:49:49.846Z',
    columns,
    rows,
    unmapped_stage_job_ids: [],
    parity: { ok: true, checked: rows.length, errors: [] },
  }, extra || {});
}

test('a display-ledger archive lands in Archive, not its declared column', async ({ page }) => {
  await page.goto('/ops.html');
  const placed = await page.evaluate((payload) => {
    const cols = buildMakesafeBoardColumns(payload, {});
    const out = {};
    Object.keys(cols).forEach((stage) => { cols[stage].forEach((c) => { out[c.job_number] = stage; }); });
    return out;
  }, boardPayload([ledgerArchivedRow()]));

  expect(placed['SWMS-LEDGER']).toBe('archive');
});

test('the close-out enrichment join can never move a card back to its declared column', async ({ page }) => {
  await page.goto('/ops.html');
  // The enriched pipeline row still carries the OVERLAY-BLIND declared stage.
  // Placement must ignore it entirely; only presentation fields may cross over.
  const result = await page.evaluate((payload) => {
    const enrichById = {
      'job-ledger-archived': {
        id: 'job-ledger-archived',
        board_stage: 'report_ready',
        board_label: 'Report Ready',
        status: 'invoiced',
        substatus: 'admin_to_send_report',
        has_wo: true,
        invoice_status: 'paid',
        requesting_company_slug: 'bw',
        site_suburb: 'Cottesloe',
      },
    };
    const cols = buildMakesafeBoardColumns(payload, enrichById);
    const card = cols.archive[0];
    return {
      archived: cols.archive.length,
      reportReady: cols.report_ready.length,
      boardStage: card && card.board_stage,
      hasWo: card && card.has_wo,
      invoiceStatus: card && card.invoice_status,
      suburb: card && card.site_suburb,
    };
  }, boardPayload([ledgerArchivedRow()]));

  expect(result.archived).toBe(1);
  expect(result.reportReady).toBe(0);
  // The card's server-stage verdict is the canonical stage, never the declared one.
  expect(result.boardStage).toBe('archive');
  // ...while the presentation-only enrichment still reaches the renderer.
  expect(result.hasWo).toBe(true);
  expect(result.invoiceStatus).toBe('paid');
  expect(result.suburb).toBe('Cottesloe');
});

test('the enrichment whitelist carries no stage, status or column key', async ({ page }) => {
  await page.goto('/ops.html');
  const offenders = await page.evaluate(() =>
    MAKESAFE_ENRICH_FIELDS.filter((f) => /stage|status|column/.test(f) &&
      // invoice_status / pack_status / resume_action are close-out presentation,
      // not the card's board placement.
      !['invoice_status', 'invoice_raw_status', 'pack_status'].includes(f)));
  expect(offenders).toEqual([]);
});

test('a card still renders from the canonical row alone when enrichment is unavailable', async ({ page }) => {
  await page.goto('/ops.html');
  const rendered = await page.evaluate((payload) => {
    const cols = buildMakesafeBoardColumns(payload, {});
    return renderMakesafeCard(cols.archive[0], 'archive');
  }, boardPayload([ledgerArchivedRow()]));

  expect(rendered).toContain('SWMS-LEDGER');
  expect(rendered).toContain('BWCWA-6648');
  expect(rendered).toContain('Builderwest Pty Ltd');
  // Suburb is recovered from the canonical contact address.
  expect(rendered).toContain('Cottesloe');
  expect(rendered).not.toContain('ms-captain-action');
});

test('a degraded intake-exception panel shows a non-blocking board banner', async ({ page }) => {
  await page.goto('/ops.html');
  const html = await page.evaluate((payload) => {
    _makesafeBoardPayload = payload;
    _makesafeBoardEnrichAvailable = true;
    return renderMakesafeFeedNotices();
  }, boardPayload([], {
    intake_exceptions: {
      contract_version: 'makesafe-intake-exception-cards.v1',
      cards: [],
      degraded: { reason: 'projection_read_failed', error: 'intake source issue uniqueness violated', failed_at: new Date().toISOString() },
    },
  }));

  expect(html).toContain('Intake exception panel degraded');
  expect(html).toContain('projection_read_failed');
});

test('a clean intake-exception panel shows no banner', async ({ page }) => {
  await page.goto('/ops.html');
  const html = await page.evaluate((payload) => {
    _makesafeBoardPayload = payload;
    _makesafeBoardEnrichAvailable = true;
    return renderMakesafeFeedNotices();
  }, boardPayload([], { intake_exceptions: { cards: [], degraded: null } }));

  expect(html).toBe('');
});

test('a missing close-out enrichment join is announced rather than silent', async ({ page }) => {
  await page.goto('/ops.html');
  const html = await page.evaluate((payload) => {
    _makesafeBoardPayload = payload;
    _makesafeBoardEnrichAvailable = false;
    return renderMakesafeFeedNotices();
  }, boardPayload([], { intake_exceptions: { cards: [], degraded: null } }));

  expect(html).toContain('Close-out detail unavailable');
});

test('an unsupported board contract fails loudly instead of rendering a partial board', async ({ page }) => {
  await page.goto('/ops.html');
  const message = await page.evaluate(async () => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action) => Promise.resolve(action === 'makesafe_board'
      ? { contract_version: 'makesafe-board.v0', columns: {} }
      : { columns: {} });
    try {
      await fetchMakesafeBoardData();
      return 'NO ERROR';
    } catch (e) {
      return e.message;
    } finally {
      window.opsFetch = realFetch;
    }
  });
  expect(message).toContain('Unsupported make-safe board contract');
});

test('getMakesafeBuilder falls through a nameless company object to requesting_company_name', async ({ page }) => {
  await page.goto('/ops.html');
  const names = await page.evaluate(() => ({
    // The regression: a company object with no usable name used to return '' and
    // strand the card on "Builder TBC".
    namelessObject: getMakesafeBuilder({
      makesafe_details: { makesafe_companies: { id: 'c1' }, requesting_company_name: 'ML Builders' },
    }),
    canonicalRow: getMakesafeBuilder({ builder: { name: 'Builderwest Pty Ltd' } }),
    companyObject: getMakesafeBuilder({ makesafe_details: { makesafe_companies: { name: 'AJ Building & Restoration' } } }),
    topLevel: getMakesafeBuilder({ requesting_company_name: 'KBA Insurance Repairs' }),
    nothing: getMakesafeBuilder({}),
  }));

  expect(names.namelessObject).toBe('ML Builders');
  expect(names.canonicalRow).toBe('Builderwest Pty Ltd');
  expect(names.companyObject).toBe('AJ Building & Restoration');
  expect(names.topLevel).toBe('KBA Insurance Repairs');
  expect(names.nothing).toBe('');
});

test('the card key legend is open by default and the report tile is spelled out', async ({ page }) => {
  await page.goto('/ops.html');
  const legend = await page.evaluate(() => ({
    collapsed: _makesafeLegendCollapsed,
    html: renderMakesafeLegend(),
  }));

  expect(legend.collapsed).toBe(false);
  expect(legend.html).not.toContain('class="ms-legend collapsed"');
  expect(legend.html).toContain('Hide key');
  expect(legend.html).toContain('<b>Report</b>');

  const card = await page.evaluate(() => renderMakesafeCard(
    { id: 'x', job_number: 'SWMS-KEY', board_stage: 'new', site_suburb: 'Perth' }, 'new'));
  expect(card).toContain('<span class="ms-doc-name">Report</span>');
  expect(card).not.toContain('<span class="ms-doc-name">Rep</span>');
});

test('a canonical stage this board does not render keeps its card visible and flagged', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(() => {
    const row = {
      id: 'job-future-stage', job_number: 'SWMS-FUTURE', canonical_stage: 'some_new_stage',
      builder: {}, contact: {}, assignments: [], report: {}, pack: {}, lineage: {}, age: {}, blockers: {},
    };
    const cols = buildMakesafeBoardColumns({
      contract_version: 'makesafe-board.v1', columns: { some_new_stage: [row] },
    }, {});
    return { inNew: cols.new.length, warning: cols.new[0] && cols.new[0].projection_warning };
  });

  expect(result.inNew).toBe(1);
  expect(result.warning).toContain('some_new_stage');
});
