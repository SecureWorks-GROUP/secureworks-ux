const { test, expect } = require('@playwright/test');

// Guards for Archive-on-demand UX (ops board). Backend default is
// column_scope=active: columns.archive is [] but column_counts.archive holds
// the real total. The Captain must never see a fake empty Archive (0 / "No jobs")
// when cards were simply not fetched. See <makesafe-archive-on-demand> in ops.html
// and companion backend fm/makesafe-board-archive-on-demand-v1.

function activeRow(stage, id, jobNumber) {
  return {
    contract_version: 'makesafe-board.v1',
    id: id,
    job_number: jobNumber,
    type: 'makesafe',
    job_state: 'in_progress',
    substatus: null,
    declared_stage: stage,
    canonical_stage: stage,
    canonical_stage_label: stage,
    makesafe_type: 'MakeSafe',
    has_wo: true,
    site_suburb: 'Perth',
    invoice_status: '',
    requesting_company_slug: 'bw',
    builder: { name: 'Builderwest Pty Ltd', external_ref: 'BWCWA-1' },
    contact: { client_name: 'Test Client', phone: null, address: '1 Test Street, Perth' },
    assignments: [],
    report: { state: null, submitted_at: null, photo_count: 0 },
    pack: { state: null, sent: false, closeout_documents: { report: false, invoice: false, swms: false } },
    lineage: {},
    age: { age_hours: 12, age_days: 0 },
    blockers: { blocked: false, real: [], stale_artifacts: [] },
    cancelled: null,
  };
}

function archiveRow(id, jobNumber) {
  const row = activeRow('archive', id, jobNumber);
  row.job_state = 'invoiced';
  row.substatus = 'complete';
  row.pack = { state: 'sent', sent: true, closeout_documents: { report: true, invoice: true, swms: false } };
  row.report = { state: 'processed', submitted_at: null, photo_count: 2 };
  return row;
}

function emptyColumns() {
  return {
    new: [],
    allocated: [],
    trade_report_in: [],
    report_ready: [],
    completed: [],
    archive: [],
    cancelled: [],
  };
}

/** Default active-scope board: archive cards excluded, census honest. */
function activeScopePayload() {
  const columns = emptyColumns();
  columns.new = [activeRow('new', 'job-new-1', 'SWMS-NEW-1')];
  columns.allocated = [
    activeRow('allocated', 'job-alloc-1', 'SWMS-ALLOC-1'),
    activeRow('allocated', 'job-alloc-2', 'SWMS-ALLOC-2'),
  ];
  columns.cancelled = [activeRow('cancelled', 'job-canc-1', 'SWMS-CANC-1')];
  // columns.archive stays [] — not loaded
  return {
    contract_version: 'makesafe-board.v1',
    projection: 'ops',
    fields: 'card',
    shape: 'card',
    column_scope: 'active',
    generated_at: '2026-08-04T00:00:00.000Z',
    columns,
    rows: columns.new.concat(columns.allocated, columns.cancelled),
    unmapped_stage_job_ids: [],
    column_counts: {
      new: 1,
      allocated: 2,
      trade_report_in: 0,
      report_ready: 0,
      completed: 0,
      archive: 301,
      cancelled: 1,
    },
    archive: {
      included: false,
      scope: 'active',
      total: 301,
      returned: 0,
      offset: 0,
      limit: null,
      fetch: {
        include_archive: 'projection=ops&include_archive=1',
        archive_only: 'projection=ops&columns=archive',
      },
    },
    parity: { ok: true, checked: 4, errors: [] },
  };
}

/** Full board after include_archive=1. */
function fullScopePayload() {
  const base = activeScopePayload();
  const arch = [
    archiveRow('job-arch-1', 'SWMS-ARCH-1'),
    archiveRow('job-arch-2', 'SWMS-ARCH-2'),
  ];
  // Two sample cards represent the 301-total census for the test harness.
  base.columns.archive = arch;
  base.rows = base.rows.concat(arch);
  base.column_scope = 'all';
  base.archive = {
    included: true,
    scope: 'all',
    total: 301,
    returned: 2,
    offset: 0,
    limit: null,
    fetch: base.archive.fetch,
  };
  base.parity = { ok: true, checked: 6, errors: [] };
  return base;
}

test('archive count comes from column_counts, never from empty cards while not loaded', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(async (payload) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action) => {
      if (action === 'makesafe_board') return Promise.resolve(payload);
      return Promise.resolve({ columns: {} });
    };
    try {
      const board = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = true;
      const container = document.createElement('div');
      renderMakesafeKanban(container, board.columns);
      const archiveCol = container.querySelector('.kanban-col[data-status="archive"]');
      const countEl = archiveCol && archiveCol.querySelector('.kanban-col-header .count');
      const body = archiveCol && archiveCol.querySelector('.kanban-body');
      return {
        state: JSON.parse(JSON.stringify(_makesafeArchiveState)),
        displayCount: makesafeArchiveDisplayCount(),
        headerCount: countEl ? countEl.textContent : null,
        bodyText: body ? body.textContent : null,
        hasNotLoadedShell: !!(body && body.querySelector('[data-archive-state="not_loaded"]')),
        hasLoadBtn: !!(body && body.querySelector('.ms-archive-load-btn')),
        archiveCards: (board.columns.archive || []).length,
        newCards: (board.columns.new || []).length,
        allocatedCards: (board.columns.allocated || []).length,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, activeScopePayload());

  expect(result.archiveCards).toBe(0);
  expect(result.state.loadState).toBe('not_loaded');
  expect(result.state.count).toBe(301);
  expect(result.displayCount).toBe(301);
  expect(result.headerCount).toBe('301');
  // Must NOT look like data loss.
  expect(result.headerCount).not.toBe('0');
  expect(result.bodyText).toContain('not loaded');
  expect(result.bodyText).not.toMatch(/^No jobs$/);
  expect(result.hasNotLoadedShell).toBe(true);
  expect(result.hasLoadBtn).toBe(true);
  // Active columns untouched.
  expect(result.newCards).toBe(1);
  expect(result.allocatedCards).toBe(2);
});

test('without a trustworthy census the archive badge is unknown, not zero', async ({ page }) => {
  await page.goto('/ops.html');
  const payload = activeScopePayload();
  delete payload.column_counts;
  payload.archive = { included: false, total: undefined, returned: 0 };

  const result = await page.evaluate(async (p) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action) => Promise.resolve(action === 'makesafe_board' ? p : { columns: {} });
    try {
      const board = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = true;
      const container = document.createElement('div');
      renderMakesafeKanban(container, board.columns);
      const countEl = container.querySelector('.kanban-col[data-status="archive"] .kanban-col-header .count');
      return {
        state: JSON.parse(JSON.stringify(_makesafeArchiveState)),
        displayCount: makesafeArchiveDisplayCount(),
        headerCount: countEl ? countEl.textContent : null,
        bodyText: container.querySelector('.kanban-col[data-status="archive"] .kanban-body').textContent,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, payload);

  expect(result.state.loadState).toBe('not_loaded');
  expect(result.displayCount).toBe('?');
  expect(result.headerCount).toBe('?');
  expect(result.headerCount).not.toBe('0');
  expect(result.bodyText).toMatch(/not loaded/i);
  expect(result.bodyText).toMatch(/count unknown/i);
});

test('Load archive requests include_archive=1 and paints cards without zeroing the count', async ({ page }) => {
  await page.goto('/ops.html');
  const active = activeScopePayload();
  const full = fullScopePayload();

  const result = await page.evaluate(async ({ activePayload, fullPayload }) => {
    const realFetch = window.opsFetch;
    const calls = [];
    window.opsFetch = (action, params) => {
      calls.push({ action: action, params: params || null });
      if (action === 'makesafe_board') {
        if (params && (params.include_archive === '1' || params.include_archive === 1)) {
          return Promise.resolve(fullPayload);
        }
        return Promise.resolve(activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      const board = await fetchMakesafeBoardData();
      _pipelineData = board;
      _makesafeArchiveVisible = true;
      const before = document.createElement('div');
      renderMakesafeKanban(before, board.columns);
      const beforeCount = before.querySelector('.kanban-col[data-status="archive"] .count').textContent;
      const beforeState = before.querySelector('[data-archive-state="not_loaded"]');

      await loadMakesafeArchive();

      const after = document.createElement('div');
      renderMakesafeKanban(after, _pipelineData.columns);
      const afterCount = after.querySelector('.kanban-col[data-status="archive"] .count').textContent;
      const cards = after.querySelectorAll('.kanban-col[data-status="archive"] .ms-card, .kanban-col[data-status="archive"] [data-job-id], .kanban-col[data-status="archive"] .kanban-card');
      // Card class may vary — also count by job number text.
      const bodyText = after.querySelector('.kanban-col[data-status="archive"] .kanban-body').textContent;
      const activeNew = (_pipelineData.columns.new || []).map((c) => c.job_number);
      const activeAlloc = (_pipelineData.columns.allocated || []).map((c) => c.job_number);
      return {
        calls: calls,
        beforeCount: beforeCount,
        beforeNotLoaded: !!beforeState,
        afterCount: afterCount,
        afterLoadState: _makesafeArchiveState.loadState,
        archiveLen: (_pipelineData.columns.archive || []).length,
        bodyHasArch1: bodyText.indexOf('SWMS-ARCH-1') !== -1,
        bodyHasArch2: bodyText.indexOf('SWMS-ARCH-2') !== -1,
        bodyNotLoaded: bodyText.indexOf('not loaded') !== -1,
        activeNew: activeNew,
        activeAlloc: activeAlloc,
        cardNodeCount: cards.length,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, { activePayload: active, fullPayload: full });

  expect(result.beforeCount).toBe('301');
  expect(result.beforeNotLoaded).toBe(true);
  const archiveCall = result.calls.find((c) =>
    c.action === 'makesafe_board' && c.params && String(c.params.include_archive) === '1');
  expect(archiveCall).toBeTruthy();
  expect(result.afterLoadState).toBe('loaded');
  expect(result.afterCount).toBe('301');
  expect(result.afterCount).not.toBe('0');
  expect(result.archiveLen).toBe(2);
  expect(result.bodyHasArch1).toBe(true);
  expect(result.bodyHasArch2).toBe(true);
  expect(result.bodyNotLoaded).toBe(false);
  // Active columns membership unchanged.
  expect(result.activeNew).toEqual(['SWMS-NEW-1']);
  expect(result.activeAlloc).toEqual(['SWMS-ALLOC-1', 'SWMS-ALLOC-2']);
});

test('archive load failure keeps the census and says so (never zero)', async ({ page }) => {
  await page.goto('/ops.html');
  const active = activeScopePayload();

  const result = await page.evaluate(async (activePayload) => {
    const realFetch = window.opsFetch;
    const realToast = window.showToast;
    window.showToast = function () {};
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        if (params && String(params.include_archive) === '1') {
          return Promise.reject(new Error('network down'));
        }
        return Promise.resolve(activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      const board = await fetchMakesafeBoardData();
      _pipelineData = board;
      _makesafeArchiveVisible = true;
      await loadMakesafeArchive();
      const container = document.createElement('div');
      renderMakesafeKanban(container, _pipelineData.columns);
      const countEl = container.querySelector('.kanban-col[data-status="archive"] .count');
      const body = container.querySelector('.kanban-col[data-status="archive"] .kanban-body');
      return {
        state: JSON.parse(JSON.stringify(_makesafeArchiveState)),
        headerCount: countEl ? countEl.textContent : null,
        bodyText: body ? body.textContent : null,
        hasErrorShell: !!(body && body.querySelector('[data-archive-state="error"]')),
        archiveCards: (_pipelineData.columns.archive || []).length,
      };
    } finally {
      window.opsFetch = realFetch;
      window.showToast = realToast;
    }
  }, active);

  expect(result.state.loadState).toBe('error');
  expect(result.state.count).toBe(301);
  expect(result.headerCount).toBe('301');
  expect(result.headerCount).not.toBe('0');
  expect(result.hasErrorShell).toBe(true);
  expect(result.bodyText).toMatch(/failed to load/i);
  expect(result.bodyText).toMatch(/network down/i);
  expect(result.archiveCards).toBe(0);
});

test('legacy full board (no column_scope) still treats archive as loaded', async ({ page }) => {
  await page.goto('/ops.html');
  // Pre-on-demand shape: archive rides in the default response, no meta.
  const columns = emptyColumns();
  columns.archive = [archiveRow('job-arch-legacy', 'SWMS-LEGACY')];
  columns.new = [activeRow('new', 'job-new-legacy', 'SWMS-NEW-LEG')];
  const legacy = {
    contract_version: 'makesafe-board.v1',
    projection: 'ops',
    fields: 'card',
    shape: 'card',
    columns,
    rows: columns.new.concat(columns.archive),
    parity: { ok: true, checked: 2, errors: [] },
  };

  const result = await page.evaluate(async (payload) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action) => Promise.resolve(action === 'makesafe_board' ? payload : { columns: {} });
    try {
      const board = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = true;
      const container = document.createElement('div');
      renderMakesafeKanban(container, board.columns);
      const body = container.querySelector('.kanban-col[data-status="archive"] .kanban-body');
      return {
        state: JSON.parse(JSON.stringify(_makesafeArchiveState)),
        displayCount: makesafeArchiveDisplayCount(),
        bodyText: body ? body.textContent : null,
        hasNotLoaded: !!(body && body.querySelector('[data-archive-state="not_loaded"]')),
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, legacy);

  expect(result.state.loadState).toBe('loaded');
  expect(result.displayCount).toBe(1);
  expect(result.hasNotLoaded).toBe(false);
  expect(result.bodyText).toContain('SWMS-LEGACY');
});

test('active column badges still use cards.length (untouched)', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await page.evaluate(async (payload) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action) => Promise.resolve(action === 'makesafe_board' ? payload : { columns: {} });
    try {
      const board = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = false; // archive column hidden — default
      const container = document.createElement('div');
      renderMakesafeKanban(container, board.columns);
      const badges = {};
      container.querySelectorAll('.kanban-col').forEach((col) => {
        const status = col.getAttribute('data-status');
        const count = col.querySelector('.kanban-col-header .count');
        if (status && count) badges[status] = count.textContent;
      });
      return {
        badges: badges,
        hasArchiveCol: !!container.querySelector('.kanban-col[data-status="archive"]'),
        newLen: board.columns.new.length,
        allocLen: board.columns.allocated.length,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, activeScopePayload());

  expect(result.badges.new).toBe(String(result.newLen));
  expect(result.badges.allocated).toBe(String(result.allocLen));
  expect(result.badges.new).toBe('1');
  expect(result.badges.allocated).toBe('2');
  // Archive column not shown until the Captain opens it.
  expect(result.hasArchiveCol).toBe(false);
});
