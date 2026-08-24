const { test, expect } = require('@playwright/test');

// Regression guards for PLAN v2 Batch 2 — "stop the board lying".
//   1. the job detail shows the CANONICAL board stage and gates its forward-move
//      buttons on it (<makesafe-detail-canonical-stage> in ops.html);
//   2. the card's family tag comes from the canonical feed's ses_family, never a
//      text/regex guess, and a refused family says so;
//   3. a Docs Ready card with no drafted pack says "No pack drafted";
//   4. the builder links the row already carries render on the card face.
// Ground truth for every number quoted here: data/ses-ui-ground-truth-v1.

// A `makesafe-board.v1` row in the shape the LIVE feed actually sends. Every
// block here exists on every live row (verified against the production feed by
// scripts/makesafe-ui-truth-census.js) — in particular `pack`, which is the only
// admissible evidence that a document pack exists.
function canonicalRow(over) {
  return Object.assign({
    contract_version: 'makesafe-board.v1',
    id: 'job-row',
    job_number: 'SWMS-ROW',
    type: 'makesafe',
    ses_family: 'physical_makesafe',
    ses_family_label: 'MakeSafe',
    ses_recipe_state: null,
    job_state: 'accepted',
    substatus: 'company_contact_required',
    declared_stage: 'new',
    canonical_stage: 'new',
    canonical_stage_label: 'New',
    status_application: null,
    makesafe_type: 'MakeSafe',
    builder: { name: 'ML Builders', external_ref: 'MLB-27227PO-56922' },
    contact: { client_name: 'Test Client', phone: null, address: '2 Test Street, Balga' },
    assignments: [],
    report: { state: 'not_started', submitted_at: null, photo_count: 0, cycle_number: 1 },
    pack: {
      state: 'not_started', sent: false, sent_at: null, drafted: false,
      docket_revision_id: null, pre_xero_docs_ready: false,
      closeout_documents: { report: false, invoice: false, swms: false },
    },
    notes: null,
    lineage: {},
    age: { age_days: 4, age_hours: 96 },
    blockers: {},
    cancelled: null,
  }, over || {});
}

// The card the captain's display ledger archived (SWMS-261099 in the report):
// declared report_ready, canonically archived, substatus still pre-allocation.
function ledgerArchivedRow() {
  return canonicalRow({
    id: 'job-archived',
    job_number: 'SWMS-ARCHIVED',
    declared_stage: 'new',
    canonical_stage: 'archive',
    canonical_stage_label: 'Archive',
    ses_family: 'temporary_fencing',
    ses_family_label: 'Temporary Fencing',
  });
}

function boardPayload(rows) {
  const columns = { new: [], allocated: [], trade_report_in: [], report_ready: [], completed: [], archive: [], cancelled: [] };
  rows.forEach((r) => { (columns[r.canonical_stage] || columns.new).push(r); });
  return { contract_version: 'makesafe-board.v1', projection: 'ops', columns };
}

// A `job_detail` payload in the shape the LIVE endpoint sends: it carries NO
// canonical_stage and NO canonical pack block, which is exactly why the detail
// has to read the canonical board feed for both.
function detailPayload(job) {
  return {
    job: Object.assign({ type: 'makesafe' }, job),
    documents: [], work_orders: [], invoices: [], events: [], media: [],
    assignments: [], service_reports: [], job_assignments: [],
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

test('a transition repaints the open detail from a CURRENT canonical response', async ({ page }) => {
  // The whole point of the durable-stage contract: the detail must never keep
  // showing the stage it was painted with. `job_detail` carries no canonical
  // stage, so after a write the page re-reads the canonical feed and repaints
  // from that response. Both feeds here are stubbed with their REAL shapes.
  await page.goto('/ops.html');
  const result = await page.evaluate(async (payloads) => {
    const requests = [];
    const detail = {
      job: { id: 'job-move', type: 'makesafe', job_number: 'SWMS-MOVE', status: 'accepted', substatus: 'waiting_on_trade_report' },
      documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], job_assignments: [],
    };
    let boardCall = 0;
    window.opsFetch = function (action) {
      requests.push({ method: 'GET', action });
      if (action === 'makesafe_board') return Promise.resolve(payloads[Math.min(boardCall++, 1)]);
      if (action === 'job_detail') return Promise.resolve(detail);
      return Promise.resolve({});
    };
    window.opsPost = function (action) { requests.push({ method: 'POST', action }); return Promise.resolve({ ok: true }); };
    window.loadJobs = function () {};

    // 1. the board loads: the job is canonically Allocated, and the detail paints it.
    await ensureMakesafeCanonicalStages();
    const before = resolveMakesafeDetailStage(detail);
    _currentJobId = 'job-move';
    _currentJobData = detail;
    showJobSubView('overview');
    const beforeHtml = document.getElementById('jdOverview').innerHTML;

    // 2. an operator advances it. The second canonical read answers Docs Ready.
    await advanceMakesafeSubstatus('job-move', 'admin_to_send_report');

    return {
      requests,
      before,
      after: resolveMakesafeDetailStage(detail),
      beforeHtml,
      afterHtml: document.getElementById('jdOverview').innerHTML,
    };
  }, [
    boardPayload([canonicalRow({ id: 'job-move', job_number: 'SWMS-MOVE', canonical_stage: 'allocated', canonical_stage_label: 'Allocated', substatus: 'waiting_on_trade_report' })]),
    boardPayload([canonicalRow({ id: 'job-move', job_number: 'SWMS-MOVE', canonical_stage: 'report_ready', canonical_stage_label: 'Docs Ready', substatus: 'admin_to_send_report' })]),
  ]);

  expect(result.before).toEqual({ stage: 'allocated', source: 'board_feed' });
  expect(result.beforeHtml).toContain('>Allocated<');
  // The write is followed by a fresh canonical GET, then the detail refresh.
  expect(result.requests).toEqual([
    { method: 'GET', action: 'makesafe_board' },
    { method: 'POST', action: 'update_makesafe_substatus' },
    { method: 'GET', action: 'makesafe_board' },
    { method: 'GET', action: 'job_detail' },
  ]);
  expect(result.after).toEqual({ stage: 'report_ready', source: 'board_feed' });
  // ...and the ALREADY-RENDERED detail now shows the new stage, not the old one.
  expect(result.afterHtml).toContain('>Docs Ready<');
  expect(result.afterHtml).not.toContain('>Allocated<');
});

// Harness for the three fail-closed paths below: paint a make-safe detail whose
// canonical stage is Allocated, then transition it with the canonical and/or the
// detail read failing. `fail` picks which read breaks.
async function paintThenTransition(page, fail) {
  return page.evaluate(async ({ payload, fail }) => {
    const detail = {
      job: { id: 'job-move', type: 'makesafe', job_number: 'SWMS-MOVE', status: 'accepted', substatus: 'waiting_on_trade_report' },
      documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], job_assignments: [],
    };
    let transitioned = false;
    window.opsFetch = function (action) {
      if (action === 'makesafe_board') {
        return (transitioned && fail.canonical) ? Promise.reject(new Error('feed down')) : Promise.resolve(payload);
      }
      if (action === 'job_detail') {
        return (transitioned && fail.detail) ? Promise.reject(new Error('detail down')) : Promise.resolve(detail);
      }
      return Promise.resolve({});
    };
    window.opsPost = function () { return Promise.resolve({ ok: true }); };
    window.loadJobs = function () {};

    await ensureMakesafeCanonicalStages();
    _currentJobId = 'job-move';
    _currentJobData = detail;
    showJobSubView('overview');
    const beforeHtml = document.getElementById('jdOverview').innerHTML;

    transitioned = true;
    await advanceMakesafeSubstatus('job-move', 'admin_to_send_report');

    return { detail, beforeHtml, afterHtml: document.getElementById('jdOverview').innerHTML };
  }, { payload: boardPayload([canonicalRow({ id: 'job-move', job_number: 'SWMS-MOVE', canonical_stage: 'allocated', substatus: 'waiting_on_trade_report' })]), fail });
}

test('a failed canonical read after a transition repaints the detail as unconfirmed', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await paintThenTransition(page, { canonical: true, detail: false });

  expect(result.beforeHtml).toContain('>Allocated<');
  // The pre-transition paint is gone, and no forward move survives it.
  expect(result.afterHtml).toContain('Stage not confirmed');
  expect(result.afterHtml).toContain('Board stage not confirmed');
  expect(result.afterHtml).not.toContain('>Allocated<');
  expect(result.afterHtml).not.toContain('advanceMakesafeSubstatus');
});

test('a failed DETAIL read after a transition also fails closed', async ({ page }) => {
  // The path that slipped: refreshJobDetail() swallowed its error, so nothing
  // repainted and the pre-transition stage stayed on screen.
  await page.goto('/ops.html');
  const result = await paintThenTransition(page, { canonical: false, detail: true });

  expect(result.beforeHtml).toContain('>Allocated<');
  expect(result.afterHtml).toContain('Stage not confirmed');
  expect(result.afterHtml).not.toContain('>Allocated<');
  expect(result.afterHtml).not.toContain('advanceMakesafeSubstatus');
});

test('the not-confirmed stage survives a tab switch and a plain detail refresh', async ({ page }) => {
  // The two ways the previous fix leaked: the marker lived on one rendered copy,
  // so any later repaint — a sub-view switch, or one of the ~10 no-argument
  // refreshJobDetail() callers — restored a stage no canonical read confirmed.
  await page.goto('/ops.html');
  const failed = await paintThenTransition(page, { canonical: true, detail: false });
  expect(failed.afterHtml).toContain('Stage not confirmed');

  const after = await page.evaluate(async () => {
    // 1. leave the overview and come back.
    showJobSubView('history');
    showJobSubView('overview');
    const afterTabSwitch = document.getElementById('jdOverview').innerHTML;

    // 2. a plain refresh, exactly as every other caller in the page makes it —
    //    it succeeds, and a successful job_detail is NOT evidence about the
    //    board's stage, so it must not clear the not-confirmed state.
    window.opsFetch = function (action) {
      if (action === 'job_detail') {
        return Promise.resolve({
          job: { id: 'job-move', type: 'makesafe', job_number: 'SWMS-MOVE', status: 'accepted', substatus: 'waiting_on_trade_report', canonical_stage: 'allocated' },
          documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [], job_assignments: [],
        });
      }
      return Promise.resolve({});
    };
    const refreshed = await refreshJobDetail();
    return { afterTabSwitch, refreshed, afterPlainRefresh: document.getElementById('jdOverview').innerHTML };
  });

  expect(after.afterTabSwitch).toContain('Stage not confirmed');
  expect(after.afterTabSwitch).not.toContain('advanceMakesafeSubstatus');
  expect(after.refreshed).toBe(true);
  // Even a payload carrying canonical_stage cannot lift the mark.
  expect(after.afterPlainRefresh).toContain('Stage not confirmed');
  expect(after.afterPlainRefresh).not.toContain('>Allocated<');
  expect(after.afterPlainRefresh).not.toContain('advanceMakesafeSubstatus');
});

test('only a successful canonical read clears the not-confirmed stage', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await paintThenTransition(page, { canonical: true, detail: false });
  expect(result.afterHtml).toContain('Stage not confirmed');

  const recovered = await page.evaluate(async (payload) => {
    window.opsFetch = function (action) {
      if (action === 'makesafe_board') return Promise.resolve(payload);
      return Promise.resolve({});
    };
    const ok = await refreshMakesafeCanonicalStages();
    return { ok, stage: resolveMakesafeDetailStage({ job: { id: 'job-move' } }) };
  }, boardPayload([canonicalRow({ id: 'job-move', canonical_stage: 'report_ready' })]));

  expect(recovered.ok).toBe(true);
  expect(recovered.stage).toEqual({ stage: 'report_ready', source: 'board_feed' });
});

test('a stale canonical answer is dropped rather than shown after a transition', async ({ page }) => {
  // If the post-transition canonical read fails, the detail must fall back to
  // "Stage not confirmed" — never to the stage it held before the write.
  await page.goto('/ops.html');
  const result = await page.evaluate(async (payload) => {
    window.opsFetch = function (action) {
      if (action === 'makesafe_board') {
        return window.__boardFails ? Promise.reject(new Error('feed down')) : Promise.resolve(payload);
      }
      return Promise.resolve({});
    };
    await ensureMakesafeCanonicalStages();
    const before = resolveMakesafeDetailStage({ job: { id: 'job-move' } });
    window.__boardFails = true;
    await refreshMakesafeCanonicalStages();
    return { before, after: resolveMakesafeDetailStage({ job: { id: 'job-move' } }) };
  }, boardPayload([canonicalRow({ id: 'job-move', canonical_stage: 'allocated' })]));

  expect(result.before).toEqual({ stage: 'allocated', source: 'board_feed' });
  expect(result.after).toEqual({ stage: '', source: 'unknown' });
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
  }));

  expect(labels.assessment).toBe('Assessment Report & Quote');
  expect(labels.feedLabel).toBe('Roof Report (Prime portal)');
  expect(labels.fencing).toBe('Temporary Fence MakeSafe');
});

test('a board card with no canonical family refuses to guess one', async ({ page }) => {
  // A degraded feed must not be able to resume the text/regex guessing that
  // mislabelled 74 of 407 cards. There is no path from a board card to it.
  await page.goto('/ops.html');
  const result = await page.evaluate(() => {
    // Everything the old fallback chain used to read, and nothing canonical.
    const degraded = {
      id: 'job-no-family', job_number: 'SWMS-NOFAMILY', canonical_stage: 'new', board_stage: 'new',
      site_suburb: 'Perth',
      makesafe_job_family: 'roof_report',
      metadata: { makesafe_job_family: 'roof_report', makesafe_job_family_label: 'Roof Report' },
      makesafe_details: { scope: 'Roof report required for storm damage' },
      notes: 'roof report for storm damage',
    };
    return {
      label: getMakesafeCardFamilyLabel(degraded),
      card: renderMakesafeCard(degraded, 'new'),
    };
  });

  expect(result.label).toBe('Family not determined');
  expect(result.card).toContain('Family not determined');
  expect(result.card).toContain('class="ms-ttag unknown"');
  expect(result.card).not.toContain('Roof Report');
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

test('pack existence is canonical-row truth, never stage plus substatus', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate((payload) => {
    const cols = buildMakesafeBoardColumns(payload, {
      // The enrichment join offers its own pack opinion. It is a side-channel and
      // must not be consulted: the canonical row for this job says not_started.
      'job-inferred': { resume_action: 'send', pack_status: { status: 'drafted' } },
    });
    const byId = {};
    Object.keys(cols).forEach((s) => cols[s].forEach((c) => { byId[c.id] = c; }));
    return {
      hasPack: {
        none: makesafeHasDraftedPack(byId['job-nopack']),
        inferred: makesafeHasDraftedPack(byId['job-inferred']),
        drafted: makesafeHasDraftedPack(byId['job-drafted']),
        sent: makesafeHasDraftedPack(byId['job-sent']),
      },
      cards: {
        none: renderMakesafeCard(byId['job-nopack'], 'report_ready'),
        inferred: renderMakesafeCard(byId['job-inferred'], 'report_ready'),
        drafted: renderMakesafeCard(byId['job-drafted'], 'report_ready'),
      },
    };
  }, boardPayload([
    canonicalRow({ id: 'job-nopack', job_number: 'SWMS-NOPACK', canonical_stage: 'report_ready', substatus: 'ready_to_invoice' }),
    // report_ready + admin_to_send_report, the old inference — and no pack record.
    canonicalRow({ id: 'job-inferred', job_number: 'SWMS-INFER', canonical_stage: 'report_ready', substatus: 'admin_to_send_report' }),
    canonicalRow({
      id: 'job-drafted', job_number: 'SWMS-PACK', canonical_stage: 'report_ready', substatus: 'admin_to_send_report',
      // Live read-model shape: closeout truth is supplied, but there is no
      // required_documents producer field. The card must stay reviewable while
      // refusing to invent a complete/ready claim.
      report: { state: 'submitted', submitted_at: '2026-07-30T01:00:00Z', cycle_number: 1 },
      pack: {
        state: 'drafted', sent: false, sent_at: null, drafted: true,
        docket_revision_id: null, pre_xero_docs_ready: false,
        report_doc_id: 'report-doc-job-drafted',
        closeout_documents: { report: true, invoice: true, swms: true },
      },
    }),
    canonicalRow({
      id: 'job-sent', job_number: 'SWMS-SENT', canonical_stage: 'report_ready', substatus: 'complete',
      pack: { state: 'sent', sent: true, sent_at: '2026-07-30T02:00:00Z', drafted: false, docket_revision_id: null, pre_xero_docs_ready: false, closeout_documents: {} },
    }),
  ]));

  // A pack the canonical row cannot prove does not exist — whatever the column,
  // the substatus, or the enrichment join say.
  expect(result.hasPack).toEqual({ none: false, inferred: false, drafted: true, sent: true });
  expect(result.cards.none).toContain('No pack drafted');
  expect(result.cards.inferred).toContain('No pack drafted');
  expect(result.cards.inferred).not.toMatch(/ms-btn-alloc[^>]*>Review job pack/);
  expect(result.cards.drafted).not.toContain('No pack drafted');
  expect(result.cards.drafted).toContain('REQUIREMENTS UNKNOWN');
  expect(result.cards.drafted).not.toContain('Ready to send');
  expect(result.cards.drafted).toMatch(/ms-btn-alloc[^>]*>Review job pack/);
});

test('the Docs Ready column states how many cards actually have a pack', async ({ page }) => {
  await page.goto('/ops.html');
  const header = await page.evaluate((payload) => {
    const cols = buildMakesafeBoardColumns(payload, {});
    const host = document.createElement('div');
    renderMakesafeKanban(host, cols);
    const el = host.querySelector('.kanban-col[data-status="report_ready"] .kanban-col-header');
    return el ? el.textContent : '';
  }, boardPayload([0, 1, 2].map((i) => canonicalRow({ id: 'p' + i, job_number: 'SWMS-P' + i, canonical_stage: 'report_ready' }))));

  expect(header).toContain('Docs Ready');
  expect(header).toContain('0 of 3 with a drafted pack');
});

test('the detail states an unconfirmed pack rather than claiming one', async ({ page }) => {
  // job_detail carries no canonical pack block. Without a canonical answer for
  // this job the detail says so; with one it repeats it.
  await page.goto('/ops.html');
  const result = await page.evaluate((payload) => {
    const unknown = resolveMakesafeDetailPack(detailFor('job-unseen'));
    buildMakesafeBoardColumns(payload, {});
    return {
      unknown,
      known: resolveMakesafeDetailPack(detailFor('job-nopack')),
      html: renderMakesafeOpsDetail(detailFor('job-unseen')),
    };
    function detailFor(id) {
      return {
        job: { id: id, type: 'makesafe', status: 'accepted', substatus: 'ready_to_invoice' },
        documents: [], work_orders: [], invoices: [], events: [], media: [], assignments: [],
      };
    }
  }, boardPayload([canonicalRow({ id: 'job-nopack', canonical_stage: 'report_ready', substatus: 'ready_to_invoice' })]));

  expect(result.unknown).toEqual({ known: false, drafted: false });
  expect(result.known).toEqual({ known: true, drafted: false });
  expect(result.html).not.toContain('Docs ready for admin/reporting skill');
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
        { kind: 'builder_portal', url: 'https://primeeco.tech/share/portal-1' },
        // F5: a portal-kind row whose URL is a CDN object with no share path is
        // not a portal. It is never offered, and never counted in "+N more".
        { kind: 'builder_portal', url: 'https://documents.primeeco.tech/asset-1' },
        // ...nor is a branding image or an SES open/click tracker.
        { kind: 'builder_portal', url: 'https://documents.primeeco.tech/x/mlb_new_logo.png' },
        { kind: 'builder_portal', url: 'https://xw2vdtj6.r.ap-southeast-2.awstrack.me/I0/0108/1/1' },
        // duplicate URL: deduped, never counted twice
        { kind: 'quote', url: 'https://primeeco.tech/share/quote-1' },
      ],
    },
  }, 'report_ready'));

  expect(card).toContain('href="https://primeeco.tech/share/report-1"');
  expect(card).toContain('Assessment Report');
  expect(card).toContain('Photo Schedule');
  // Capped at three, remainder counted honestly (4 genuine URLs, 3 shown).
  expect(card).toContain('+1 more');
  // The three non-portal rows are gone from the card face entirely — not
  // rendered, and not inflating the remainder count.
  expect(card).not.toContain('documents.primeeco.tech/asset-1');
  expect(card).not.toContain('mlb_new_logo.png');
  expect(card).not.toContain('awstrack.me');
  // The anchors must never trip the card's open-detail click.
  expect(card).toContain('onclick="event.stopPropagation();"');
});

test('a card with no links renders no link row', async ({ page }) => {
  await page.goto('/ops.html');
  const card = await page.evaluate(() => renderMakesafeCard(
    { id: 'x', job_number: 'SWMS-NOLINK', canonical_stage: 'new', board_stage: 'new', site_suburb: 'Perth' }, 'new'));
  expect(card).not.toContain('ms-links');
});

test('card chips follow the pack, not a stale WO-missing enrichment join', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(() => {
    const pack = {
      drafted: true, state: 'drafted', sent: false,
      presentation_kind: 'ready',
      report_doc_id: 'report-doc-job-241',
      invoice_doc_id: 'invoice-doc-job-241',
      swms_doc_id: 'swms-doc-job-241',
      required_documents: { report: true, invoice: true, swms: true },
      closeout_documents: { report: true, invoice: true, swms: true },
      artifacts: [
        { role: 'work_order', object_key: 'wo/work_order_MLB-26183PO-54000.pdf', media_type: 'application/pdf' },
        { role: 'supporting_report_pdf', object_key: 'r/Make Safe Report.pdf', media_type: 'application/pdf' },
        { role: 'swms_artifact', object_key: 's/SWMS.pdf', media_type: 'application/pdf' },
        { role: 'xero_invoice_pdf', object_key: 'i/invoice.pdf', media_type: 'application/pdf', signed_url: 'about:blank#inv' },
        { role: 'site_photo', object_key: 'p/site.jpg', media_type: 'image/jpeg' },
      ],
    };
    window._makesafePackChipById = window._makesafePackChipById || {};
    window._makesafePackChipById['job-241'] = makesafeChipFactsFromSesPack(pack);
    const stale = {
      id: 'job-241', job_number: 'SWMS-261241', canonical_stage: 'report_ready', board_stage: 'report_ready',
      substatus: 'admin_to_send_report', site_suburb: 'Perth', ses_family: 'physical_makesafe',
      requesting_company_slug: 'mlb',
      has_wo: false, missing_docs: ['wo'], has_report_doc: false, has_swms_doc: false,
      invoice_status: 'not_ready',
      report: { state: 'submitted', cycle_number: 1 },
      report_pack: pack,
    };
    const html = renderMakesafeCard(stale, 'report_ready');
    return {
      facts: makesafeChipFactsFromSesPack(pack),
      html,
      count: (html.match(/(\d+)\s*\/\s*(\d+)/) || []).slice(1),
    };
  });

  expect(result.facts).toMatchObject({ wo: true, report: true, swms: true, invoice: true, fromPack: true });
  expect(result.html).toContain('Work order: attached');
  expect(result.html).not.toContain('Work order: missing (expected)');
  expect(result.html).toMatch(/ms-btn-alloc[^>]*>Review job pack/);
  expect(Number(result.count[0])).toBeGreaterThanOrEqual(4);
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
