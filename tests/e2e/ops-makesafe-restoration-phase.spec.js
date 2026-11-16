const { test, expect } = require('@playwright/test');

// A restoration card on the ops make-safe board says where its quote is at.
// The server sends `restoration` on the canonical makesafe_board row (mode,
// phase, phase_label, next_step, quote number, when it was sent), worked out by
// the backend's one restoration reader. The card words it and never moves the
// card: the column is still canonical_stage alone. No money is on it.
// See <makesafe-restoration-phase> in ops.html.

function restorationRow(restoration, over) {
  return Object.assign({
    contract_version: 'makesafe-board.v1.2',
    id: 'b94fe335-6047-43eb-bd8c-a6df770eb505',
    job_number: 'SWMS-261709',
    type: 'makesafe',
    job_state: 'scheduled',
    substatus: 'waiting_on_trade_report',
    canonical_stage: 'allocated',
    canonical_stage_label: 'Allocated',
    ses_family: 'restoration',
    ses_family_label: 'Restoration',
    makesafe_type: 'Restoration',
    builder: { name: 'ML Builders', external_ref: 'MLR-41228PO-64545' },
    site_suburb: 'Lynwood',
    contact: { client_name: 'Test Client', phone: null, address: '1 Test Street, Lynwood' },
    assignments: [],
    report: { state: 'waiting', photo_count: 0 },
    pack: null,
    lineage: {},
    age: { age_hours: 20, age_days: 1 },
    blockers: { blocked: false, real: [], stale_artifacts: [] },
    created_at: new Date().toISOString(),
    restoration: restoration,
  }, over || {});
}

const SENT = {
  version: 'restoration-workflow/v1',
  readable: true,
  reason: null,
  stored: true,
  mode: 'assess_and_quote',
  phase: 'awaiting_approval',
  phase_label: 'Quote with builder',
  next_step: 'Quote SWMS-261709-Q1 is with the builder. Do not start the quoted works until their approval is recorded.',
  quote_number: 'SWMS-261709-Q1',
  quote_status: 'sent',
  quote_sent_at: '2026-11-12T03:00:00.000Z',
  approved_quote_number: null,
};

async function renderRow(page, row, status) {
  return page.evaluate(({ row, status }) => {
    const card = mapCanonicalMakesafeRow(row, null, { rememberStage: false });
    return renderMakesafeCard(card, status || card.board_stage);
  }, { row, status });
}

test('a sent restoration quote reads as waiting on the builder', async ({ page }) => {
  await page.goto('/ops.html');
  const html = await renderRow(page, restorationRow(SENT));

  expect(html).toContain('class="ms-resto wait"');
  expect(html).toContain('data-restoration-phase="awaiting_approval"');
  expect(html).toContain('Quote sent · waiting on builder approval');
  expect(html).toContain('SWMS-261709-Q1 sent 12 Nov');
  // The next step is the hover text, word for word from the server.
  expect(html).toContain('Do not start the quoted works until their approval is recorded.');
  expect(html).not.toContain('—');
  expect(html).not.toMatch(/\$\s*\d/);
});

test('the chip uses the server phase label for every other phase', async ({ page }) => {
  await page.goto('/ops.html');
  const phases = await page.evaluate(() => ({
    assess: makesafeRestorationChip({ readable: true, phase: 'assess', phase_label: 'Assess and quote', next_step: 'Attend and inspect.' }),
    doCharge: makesafeRestorationChip({ readable: true, phase: 'attend_and_charge', phase_label: 'Do and charge', next_step: 'Attend.' }),
    drafted: makesafeRestorationChip({ readable: true, phase: 'quote_drafted', phase_label: 'Quote drafted', quote_number: 'SWMS-1-Q1', next_step: 'Send it.' }),
    approved: makesafeRestorationChip({ readable: true, phase: 'approved_works', phase_label: 'Quote approved', quote_number: 'SWMS-1-Q1', next_step: 'Do the works.' }),
    declined: makesafeRestorationChip({ readable: true, phase: 'declined', phase_label: 'Quote declined', quote_number: 'SWMS-1-Q1', next_step: 'Only the attendance.' }),
    future: makesafeRestorationChip({ readable: true, phase: 'some_new_phase', phase_label: 'Something new', next_step: 'x' }),
    unreadable: makesafeRestorationChip({ readable: false, reason: 'restoration_plan_unreadable', phase: null, next_step: 'It needs a person to look at it.' }),
    none: makesafeRestorationChip(null),
  }));

  expect(phases.assess).toMatchObject({ label: 'Assess and quote', tone: '', detail: '' });
  expect(phases.doCharge).toMatchObject({ label: 'Do and charge', detail: '' });
  expect(phases.drafted).toMatchObject({ label: 'Quote drafted · not sent yet', detail: 'SWMS-1-Q1' });
  expect(phases.approved).toMatchObject({ label: 'Quote approved · do the works', tone: 'done' });
  expect(phases.declined).toMatchObject({ label: 'Quote declined', tone: 'stop' });
  expect(phases.future).toMatchObject({ label: 'Something new' });
  expect(phases.unreadable).toMatchObject({ label: 'Restoration plan needs a look', tone: 'stop', title: 'It needs a person to look at it.' });
  expect(phases.none).toBeNull();
});

test('a make-safe card shows no restoration chip, and the plan never moves a card', async ({ page }) => {
  await page.goto('/ops.html');
  const plain = await renderRow(page, restorationRow(null, {
    id: 'job-plain',
    job_number: 'SWMS-PLAIN',
    ses_family: 'general_makesafe',
    ses_family_label: 'MakeSafe',
    makesafe_type: 'MakeSafe',
  }));
  expect(plain).not.toContain('ms-resto');

  const placed = await page.evaluate((row) => {
    const columns = { new: [], allocated: [], trade_report_in: [], report_ready: [], completed: [], archive: [], cancelled: [] };
    columns.allocated.push(row);
    const cols = buildMakesafeBoardColumns({
      contract_version: 'makesafe-board.v1.2',
      projection: 'ops',
      columns,
      rows: [row],
      unmapped_stage_job_ids: [],
      parity: { ok: true, checked: 1, errors: [] },
    }, {});
    const out = {};
    Object.keys(cols).forEach((stage) => { cols[stage].forEach((c) => { out[c.job_number] = { stage, phase: c.restoration && c.restoration.phase }; }); });
    return out;
  }, restorationRow(Object.assign({}, SENT, { phase: 'approved_works', phase_label: 'Quote approved' })));
  expect(placed['SWMS-261709']).toEqual({ stage: 'allocated', phase: 'approved_works' });

  // A cancelled card does not carry a quote call to action.
  const cancelled = await renderRow(page, restorationRow(SENT, { canonical_stage: 'cancelled', job_state: 'cancelled' }), 'cancelled');
  expect(cancelled).not.toContain('ms-resto');
});
