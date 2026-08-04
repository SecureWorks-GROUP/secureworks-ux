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

/**
 * Full board after include_archive=1. The census and the cards must agree — a
 * response carrying fewer cards than it counts is the PARTIAL case below, not
 * this one.
 */
function fullScopePayload() {
  const base = activeScopePayload();
  const arch = [];
  for (let i = 1; i <= 301; i++) arch.push(archiveRow(`job-arch-${i}`, `SWMS-ARCH-${i}`));
  base.columns.archive = arch;
  base.rows = base.rows.concat(arch);
  base.column_scope = 'all';
  base.archive = {
    included: true,
    scope: 'all',
    total: 301,
    returned: arch.length,
    offset: 0,
    limit: null,
    fetch: base.archive.fetch,
  };
  base.parity = { ok: true, checked: 305, errors: [] };
  return base;
}

/** Server capped the archive page: 2 cards returned against a 301 census. */
function partialScopePayload() {
  const base = activeScopePayload();
  const arch = [
    archiveRow('job-arch-1', 'SWMS-ARCH-1'),
    archiveRow('job-arch-2', 'SWMS-ARCH-2'),
  ];
  base.columns.archive = arch;
  base.rows = base.rows.concat(arch);
  base.column_scope = 'all';
  base.archive = {
    included: true,
    scope: 'all',
    total: 301,
    returned: 2,
    offset: 0,
    limit: 2,
    fetch: base.archive.fetch,
  };
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
  expect(result.archiveLen).toBe(301);
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

test('a capped archive page is partial, never badged as the whole census', async ({ page }) => {
  await page.goto('/ops.html');

  const result = await page.evaluate(async ({ activePayload, partialPayload }) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        return Promise.resolve(params && String(params.include_archive) === '1'
          ? partialPayload : activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      _pipelineTab = 'makesafes';
      _pipelineData = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = true;
      await loadMakesafeArchive();
      const container = document.createElement('div');
      renderMakesafeKanban(container, _pipelineData.columns);
      const col = container.querySelector('.kanban-col[data-status="archive"]');
      const body = col.querySelector('.kanban-body');
      return {
        state: JSON.parse(JSON.stringify(_makesafeArchiveState)),
        headerCount: col.querySelector('.count').textContent,
        displayCount: makesafeArchiveDisplayCount(),
        loadedCount: makesafeArchiveLoadedCount(),
        bodyText: body.textContent,
        hasPartialShell: !!body.querySelector('[data-archive-state="partial"]'),
        hasLoadControl: !!body.querySelector('.ms-archive-load-btn'),
        showsCards: body.textContent.indexOf('SWMS-ARCH-1') !== -1,
        toolbarText: (container.querySelector('[data-archive-total]') || {}).textContent || '',
      };
    } finally {
      window.opsFetch = realFetch;
      _pipelineTab = 'fencing';
    }
  }, { activePayload: activeScopePayload(), partialPayload: partialScopePayload() });

  expect(result.state.loadState).toBe('partial');
  expect(result.state.count).toBe(301);
  expect(result.loadedCount).toBe(2);
  // The badge must not claim 301 cards it does not have, nor hide that 301 exist.
  expect(result.headerCount).toBe('2/301');
  expect(result.displayCount).toBe(301);
  expect(result.hasPartialShell).toBe(true);
  expect(result.hasLoadControl).toBe(true);
  expect(result.showsCards).toBe(true);
  expect(result.bodyText).toMatch(/Showing 2 of 301/i);
  expect(result.toolbarText).toMatch(/only 2 loaded/i);
});

test('a loaded archive survives the next board refresh (sticky include_archive)', async ({ page }) => {
  await page.goto('/ops.html');

  const result = await page.evaluate(async ({ activePayload, fullPayload }) => {
    const realFetch = window.opsFetch;
    const calls = [];
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        calls.push(params && String(params.include_archive) === '1' ? 'with_archive' : 'active_only');
        return Promise.resolve(params && String(params.include_archive) === '1' ? fullPayload : activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      _pipelineTab = 'makesafes';
      _pipelineData = await fetchMakesafeBoardData();
      _makesafeArchiveVisible = true;
      await loadMakesafeArchive();
      const afterLoad = {
        state: _makesafeArchiveState.loadState,
        archiveLen: (_pipelineData.columns.archive || []).length,
      };

      // What the 5-minute auto-refresh / any post-transition loadJobs does.
      const refreshed = await fetchMakesafeBoardData();
      _pipelineData = refreshed;
      const afterRefresh = {
        state: _makesafeArchiveState.loadState,
        archiveLen: (refreshed.columns.archive || []).length,
      };

      // Closing the column is the one way to stop asking for history.
      toggleMakesafeArchive();
      const closed = await fetchMakesafeBoardData();
      _pipelineData = closed;

      return {
        calls,
        afterLoad,
        afterRefresh,
        wantedAfterClose: _makesafeArchiveWanted,
        stateAfterClose: _makesafeArchiveState.loadState,
        archiveLenAfterClose: (closed.columns.archive || []).length,
      };
    } finally {
      window.opsFetch = realFetch;
      _pipelineTab = 'fencing';
    }
  }, { activePayload: activeScopePayload(), fullPayload: fullScopePayload() });

  expect(result.afterLoad.state).toBe('loaded');
  expect(result.afterLoad.archiveLen).toBe(301);
  // The refresh must re-request the archive rather than silently drop it.
  expect(result.afterRefresh.state).toBe('loaded');
  expect(result.afterRefresh.archiveLen).toBe(301);
  expect(result.calls.slice(0, 3)).toEqual(['active_only', 'with_archive', 'with_archive']);
  // …and only an explicit close goes back to the on-demand shell.
  expect(result.wantedAfterClose).toBe(false);
  expect(result.calls[3]).toBe('active_only');
  expect(result.stateAfterClose).toBe('not_loaded');
  expect(result.archiveLenAfterClose).toBe(0);
});

test('a superseded board read does not clobber a newer one', async ({ page }) => {
  await page.goto('/ops.html');

  const result = await page.evaluate(async ({ activePayload, fullPayload }) => {
    const realFetch = window.opsFetch;
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        const withArchive = params && String(params.include_archive) === '1';
        // The active-scope read is the SLOW one, so it would resolve last.
        return withArchive
          ? Promise.resolve(fullPayload)
          : slow.then(() => activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      const stalePromise = fetchMakesafeBoardData({ includeArchive: false });
      const fresh = await fetchMakesafeBoardData({ includeArchive: true });
      releaseSlow();
      const stale = await stalePromise;
      return {
        staleIsNull: stale === null,
        freshArchiveLen: (fresh.columns.archive || []).length,
        state: _makesafeArchiveState.loadState,
        count: _makesafeArchiveState.count,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, { activePayload: activeScopePayload(), fullPayload: fullScopePayload() });

  expect(result.staleIsNull).toBe(true);
  expect(result.freshArchiveLen).toBe(301);
  expect(result.state).toBe('loaded');
  expect(result.count).toBe(301);
});

test('LIST view says the archived rows are missing and offers the same load control', async ({ page }) => {
  await page.goto('/ops.html');

  const result = await page.evaluate(async ({ activePayload, fullPayload }) => {
    const realFetch = window.opsFetch;
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        return Promise.resolve(params && String(params.include_archive) === '1' ? fullPayload : activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      _pipelineTab = 'makesafes';
      _jobView = 'list';
      _pipelineData = await fetchMakesafeBoardData();
      const container = document.createElement('div');
      renderJobList(container, _pipelineData.columns);
      const notice = container.querySelector('.ms-archive-list-notice');
      const before = {
        hasNotice: !!notice,
        state: notice && notice.getAttribute('data-archive-list-state'),
        text: notice ? notice.textContent : '',
        hasLoadBtn: !!(notice && notice.querySelector('.ms-archive-load-btn')),
        rows: container.querySelectorAll('tbody tr').length,
      };

      await loadMakesafeArchive();
      const after = document.createElement('div');
      renderJobList(after, _pipelineData.columns);
      return {
        before,
        afterHasNotice: !!after.querySelector('.ms-archive-list-notice'),
        afterRows: after.querySelectorAll('tbody tr').length,
      };
    } finally {
      window.opsFetch = realFetch;
      _pipelineTab = 'fencing';
      _jobView = 'kanban';
    }
  }, { activePayload: activeScopePayload(), fullPayload: fullScopePayload() });

  expect(result.before.hasNotice).toBe(true);
  expect(result.before.state).toBe('not_loaded');
  expect(result.before.text).toContain('301');
  expect(result.before.text).toMatch(/not loaded/i);
  expect(result.before.text).toMatch(/missing from this table/i);
  expect(result.before.hasLoadBtn).toBe(true);
  // Active rows only until the archive is loaded, then the rows appear and the
  // notice goes away because nothing is hidden any more.
  expect(result.before.rows).toBe(4);
  expect(result.afterHasNotice).toBe(false);
  expect(result.afterRows).toBe(305);
});

test('an archived job detail resolves its stage, not "Stage not confirmed"', async ({ page }) => {
  await page.goto('/ops.html');

  const result = await page.evaluate(async ({ activePayload, fullPayload }) => {
    const realFetch = window.opsFetch;
    const calls = [];
    window.opsFetch = (action, params) => {
      if (action === 'makesafe_board') {
        const withArchive = !!(params && String(params.include_archive) === '1');
        calls.push(withArchive ? 'with_archive' : 'active_only');
        return Promise.resolve(withArchive ? fullPayload : activePayload);
      }
      return Promise.resolve({ columns: {} });
    };
    try {
      // Default board load: active scope, so the archived job is not in the map.
      await fetchMakesafeBoardData();
      const beforeLookup = resolveMakesafeDetailStage({ job: { id: 'job-arch-1', type: 'makesafe' } });

      await ensureMakesafeCanonicalStageForJob('job-arch-1');
      const archived = resolveMakesafeDetailStage({ job: { id: 'job-arch-1', type: 'makesafe' } });

      const callsAfterArchived = calls.length;
      // An ACTIVE job is already covered — no second read for it.
      await ensureMakesafeCanonicalStageForJob('job-alloc-1');
      const active = resolveMakesafeDetailStage({ job: { id: 'job-alloc-1', type: 'makesafe' } });

      return {
        calls,
        beforeLookup,
        archived,
        active,
        extraCallsForActiveJob: calls.length - callsAfterArchived,
      };
    } finally {
      window.opsFetch = realFetch;
    }
  }, { activePayload: activeScopePayload(), fullPayload: fullScopePayload() });

  expect(result.beforeLookup).toEqual({ stage: '', source: 'unknown' });
  expect(result.archived).toEqual({ stage: 'archive', source: 'board_feed' });
  expect(result.calls).toContain('with_archive');
  // Active-column placement semantics untouched: still resolved from the default read.
  expect(result.active).toEqual({ stage: 'allocated', source: 'board_feed' });
  expect(result.extraCallsForActiveJob).toBe(0);
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
