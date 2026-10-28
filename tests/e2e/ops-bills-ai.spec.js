// AI bill placement panel (modules/ops-bills-ai.js) at the top of Financials > Bill Reconciliation.
// Covers: the status line in words, a failed read never shown as zero, the list views,
// two-press Undo that refreshes Bills to place, and pausing the AI.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

const STATUS = {
  enabled: true, confidence_bar: 0.85, daily_call_cap: 300, calls_today: 12,
  placed: 40, placed_ex: 52340.5, placed_installer: 6, filed_not_job_related: 9, filed_ex: 1200,
  undone: 1, left_for_person_open: 14, second_check: { due: 2, agreed: 5, disagreed: 1 },
  bills_to_place_open: 300, bills_to_place_open_ex: 210000, bar_history: [],
};
const PLACED = [
  { id: '11111111-1111-4111-8111-111111111111', invoice_number: 'INV-900', contact_name: 'Metroll', amount_ex: 9100, installer: false,
    decision: 'job', job_number: 'SWF-26412', confidence: 0.96, reason: 'The bill names PO-1000123, which is on SWF-26412.',
    outcome: 'placed', second_check_status: 'agreed', created_at: '2026-10-28T05:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', invoice_number: 'T-77', contact_name: 'Crew Co', amount_ex: 1800, installer: true,
    decision: 'job', job_number: 'SWP-26044', confidence: 0.92, reason: 'Site address matches.', outcome: 'placed',
    second_check_status: 'disagreed', second_check: { decision: 'job', job_number: 'SWP-26050' }, created_at: '2026-10-28T04:00:00Z' },
];

async function openPanel(page, { refuse = {}, undoFails = null } = {}) {
  await page.goto('/ops.html');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ STATUS, PLACED, refuse, undoFails }) => {
    const main = document.getElementById('mainApp');
    if (main) main.style.display = '';
    window.__baiFetches = []; window.__baiPosts = [];
    const copy = (v) => Promise.resolve(JSON.parse(JSON.stringify(v)));
    const fail = (m) => { const e = new Error(m); e.status = 500; return Promise.reject(e); };
    let undone = false;
    window.opsFetch = (action, params) => {
      window.__baiFetches.push({ action, params: params || {} });
      if (refuse[action]) return fail(refuse[action]);
      if (action === 'materials_ai_status') return copy({ ok: true, status: STATUS });
      if (action === 'materials_ai_placements') {
        const rows = params.view === 'placed' ? PLACED.filter((p) => !(undone && p.id === PLACED[0].id)) : [];
        return copy({ ok: true, placements: rows });
      }
      if (action === 'materials_recon_queue') return copy({ rows: [], stats: { total_rows: 0 } });
      return copy({});
    };
    window.opsPost = (action, body) => {
      window.__baiPosts.push({ action, body });
      if (action === 'materials_ai_undo') {
        if (undoFails) return fail(undoFails);
        undone = true; return copy({ ok: true });
      }
      if (action === 'materials_ai_settings') return copy({ ok: true });
      return fail('Unknown action');
    };
    showView('financials');
    showSubTab('billrecon');
  }, { STATUS, PLACED, refuse, undoFails });
}

test.use({ viewport: { width: 1360, height: 1000 } });

test('the status line says what the AI did, in words', async ({ page }) => {
  await openPanel(page);
  const s = page.locator('[data-bai-summary]');
  await expect(s).toContainText('placed 40 bills ($52,340.50 ex GST)');
  await expect(s).toContainText('6 of them installer bills');
  await expect(s).toContainText('14 left for a person');
  await expect(s).toContainText('sure enough at 85%');
  await expect(s).toContainText('12 of 300 reads today');
  await expect(s).not.toContainText('—');
});

test('a failed status read says so and never shows zero', async ({ page }) => {
  await openPanel(page, { refuse: { materials_ai_status: 'timed out' } });
  const s = page.locator('[data-bai-summary]');
  await expect(s).toContainText('Status could not be read: timed out');
  await expect(s).not.toContainText('placed 0');
});

test('the list shows each placement with its reason and the second check', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Show list' }).click();
  const r1 = page.locator('[data-bai-row="' + PLACED[0].id + '"]');
  await expect(r1).toContainText('Placed on SWF-26412');
  await expect(r1).toContainText('The bill names PO-1000123');
  await expect(r1.locator('[data-bai-check]')).toHaveText('Second check agreed');
  const r2 = page.locator('[data-bai-row="' + PLACED[1].id + '"]');
  await expect(r2).toContainText('Installer');
  await expect(r2.locator('[data-bai-check]')).toHaveText('Second check disagreed: says SWP-26050');
});

test('Undo takes two presses, then the bill goes back to Bills to place', async ({ page }) => {
  await openPanel(page);
  await page.getByRole('button', { name: 'Show list' }).click();
  const btn = page.locator('[data-bai-undo="' + PLACED[0].id + '"]');
  await btn.click();
  await expect(btn).toHaveText('Press again to undo');
  expect(await page.evaluate(() => window.__baiPosts.length)).toBe(0);
  await page.waitForTimeout(800);
  await btn.click();
  await expect(page.locator('[data-bai-row="' + PLACED[0].id + '"]')).toHaveCount(0);
  const posts = await page.evaluate(() => window.__baiPosts);
  expect(posts).toEqual([{ action: 'materials_ai_undo', body: { placement_id: PLACED[0].id } }]);
  const queueReads = await page.evaluate(() => window.__baiFetches.filter((f) => f.action === 'materials_recon_queue').length);
  expect(queueReads).toBeGreaterThan(1);
});

test('a refused Undo says why and keeps the row', async ({ page }) => {
  await openPanel(page, { undoFails: 'bill INV-900 was changed by a person after the AI' });
  await page.getByRole('button', { name: 'Show list' }).click();
  const btn = page.locator('[data-bai-undo="' + PLACED[0].id + '"]');
  await btn.click(); await page.waitForTimeout(800); await btn.click();
  const row = page.locator('[data-bai-row="' + PLACED[0].id + '"]');
  await expect(row.locator('[data-bai-err]')).toHaveText('Not undone: bill INV-900 was changed by a person after the AI');
});

test('Pause AI and the bar are settings posts', async ({ page }) => {
  await openPanel(page);
  await page.locator('[data-bai-toggle]').click();
  await page.locator('[data-bai-bar]').selectOption('0.9');
  await expect.poll(() => page.evaluate(() => window.__baiPosts)).toEqual([
    { action: 'materials_ai_settings', body: { enabled: false } },
    { action: 'materials_ai_settings', body: { confidence_bar: 0.9 } },
  ]);
});
