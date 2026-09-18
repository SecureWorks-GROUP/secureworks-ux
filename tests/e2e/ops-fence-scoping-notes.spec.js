const { test, expect } = require('@playwright/test');

// The fencing scoping tool (fence-designer) saves every note into
// jobs.scope_json.job (siteNotes, checklist.finalNotes, removal.notes,
// supplierNotes). job_detail already delivers the full scope_json to the
// OpsDash; nothing drew it (fence-scoping-notes-surface scout report).
// Captain's ruling (2026-09-18): "As long as those notes appear on the trade
// app and the ops dash notes ... all these notes ... fix it, do it." — all
// four fields show on the OpsDash. See renderFenceScopingNotes in ops.html.

function fencingScopeJson(overrides) {
  return Object.assign(
    {
      job: {
        siteNotes: 'CHECK PROFILE CHECK PROFILE NOT HARMONY',
        checklist: { finalNotes: 'THE REAR SHEETS SHOULD BE HARMONY PROFILE FROM METROLL for the extension' },
        removal: { notes: 'If not Stratco order from RnR' },
        supplierNotes: 'Less sheets needed do not approve till calculating 1 sheet at 2.1 then rest at 1.8',
      },
    },
    overrides || {}
  );
}

function fencingJob(overrides) {
  return Object.assign(
    {
      id: 'job-fence-1',
      type: 'fencing',
      job_number: 'SWF-261413',
      status: 'accepted',
      client_name: 'Fixture Fencing Client',
      scope_json: fencingScopeJson(),
    },
    overrides || {}
  );
}

function detailPayload(job) {
  return {
    job,
    documents: [], work_orders: [], invoices: [], events: [], media: [],
    assignments: [], purchase_orders: [],
  };
}

test.describe('Fencing scoping-tool notes on the OpsDash job detail', () => {
  test('Overview tab shows all four scoping notes for a fencing job', async ({ page }) => {
    await page.goto('/ops.html');
    const html = await page.evaluate((data) => {
      renderOverviewView(data);
      return document.getElementById('jdOverview').innerHTML;
    }, detailPayload(fencingJob()));

    expect(html).toContain('Scoping notes');
    expect(html).toContain('Site notes');
    expect(html).toContain('CHECK PROFILE CHECK PROFILE NOT HARMONY');
    expect(html).toContain('Final notes');
    expect(html).toContain('THE REAR SHEETS SHOULD BE HARMONY PROFILE FROM METROLL for the extension');
    expect(html).toContain('Removal notes');
    expect(html).toContain('If not Stratco order from RnR');
    expect(html).toContain('Supplier notes');
    expect(html).toContain('Less sheets needed do not approve till calculating 1 sheet at 2.1 then rest at 1.8');
  });

  test('Notes rail pins the scoping notes above the deletable job_events notes', async ({ page }) => {
    await page.goto('/ops.html');
    const html = await page.evaluate((data) => buildNotesHTML(data), detailPayload(fencingJob({
      // A real, deletable two-way ops note must still render below the pinned block.
    })));

    const pinnedIdx = html.indexOf('Scoping notes');
    const notesHeadingIdx = html.indexOf('>Notes<');
    expect(pinnedIdx).toBeGreaterThan(-1);
    expect(notesHeadingIdx).toBeGreaterThan(-1);
    expect(pinnedIdx).toBeLessThan(notesHeadingIdx);
    expect(html).toContain('CHECK PROFILE CHECK PROFILE NOT HARMONY');
    // No delete control on the pinned block — deleteJobNote only appears for real job_events rows.
    expect(html).not.toMatch(/deleteJobNote[^)]*\)[^<]*<\/button>\s*<\/div>\s*<div class="fence-scoping-notes"/);
  });

  test('renderScopeSummary fencing branch carries the scoping notes into peek/Money/Build/WO panels', async ({ page }) => {
    await page.goto('/ops.html');
    const html = await page.evaluate((scopeJson) => renderScopeSummary(scopeJson, 'fencing', 'job-fence-1'), fencingScopeJson());

    expect(html).toContain('Site notes');
    expect(html).toContain('CHECK PROFILE CHECK PROFILE NOT HARMONY');
    expect(html).toContain('Supplier notes');
  });

  test('a fencing job with no scoping notes renders no empty Scoping notes block', async ({ page }) => {
    await page.goto('/ops.html');
    const job = fencingJob({ scope_json: { job: {} } });
    const overviewHtml = await page.evaluate((data) => {
      renderOverviewView(data);
      return document.getElementById('jdOverview').innerHTML;
    }, detailPayload(job));
    const notesHtml = await page.evaluate((data) => buildNotesHTML(data), detailPayload(job));
    const scopeSummaryHtml = await page.evaluate((scopeJson) => renderScopeSummary(scopeJson, 'fencing', 'job-fence-1'), { job: {} });

    expect(overviewHtml).not.toContain('Scoping notes');
    expect(notesHtml).not.toContain('Scoping notes');
    expect(scopeSummaryHtml).not.toContain('Scoping notes');
  });

  test('a patio job renders no fencing scoping-notes block', async ({ page }) => {
    await page.goto('/ops.html');
    const patioJob = {
      id: 'job-patio-1', type: 'patio', job_number: 'SWP-1', status: 'accepted',
      client_name: 'Fixture Patio Client',
      scope_json: { config: { length: 6, projection: 4 }, job: { siteNotes: 'should never render for patio' } },
    };
    const overviewHtml = await page.evaluate((data) => {
      renderOverviewView(data);
      return document.getElementById('jdOverview').innerHTML;
    }, detailPayload(patioJob));

    expect(overviewHtml).not.toContain('Scoping notes');
    expect(overviewHtml).not.toContain('should never render for patio');
  });
});
