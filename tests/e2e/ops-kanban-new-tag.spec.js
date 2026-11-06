// Ops Dash NEW tag: a job card shows a small orange NEW tab in its lower-right
// corner for its first 36 hours on the pipeline (search `// <kanban-new-tag>`
// in ops.html). Arrival is accepted_at, else created_at for a job put straight
// onto the pipeline; a job that already holds an earlier later-stage time was
// moved back, not newly arrived. Every time is relative to the test's own
// clock, so the fixtures never date-rot.
//
// Static fixtures (no network): cards are rendered straight through the real
// renderKanbanCard.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

async function renderCard(page, job, hoursAgo) {
  await page.evaluate(({ card, hoursAgo }) => {
    const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
    Object.keys(hoursAgo).forEach((k) => { card[k] = hoursAgo[k] == null ? null : iso(hoursAgo[k]); });
    let host = document.getElementById('new-tag-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'new-tag-host';
      host.style.cssText = 'width:130px;padding:8px;';
      document.body.appendChild(host);
    }
    window._pipelineTab = card.type;
    host.insertAdjacentHTML('beforeend', renderKanbanCard(card, card.column || card.status));
  }, { card: job, hoursAgo });
  return page.locator('.kanban-card[data-job-id="' + job.id + '"]');
}

function job(id, extra) {
  return Object.assign({
    id, type: 'fencing', status: 'accepted', client_name: 'Fixture ' + id,
    value: 6240, days_in_stage: 0,
  }, extra);
}

test.describe('kanban NEW tag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ops.html');
    await page.waitForFunction(() => typeof window.renderKanbanCard === 'function');
    await revealOpsStaticFixture(page);
  });

  test('a quote accepted this morning shows NEW; one accepted 37 hours ago does not', async ({ page }) => {
    const fresh = await renderCard(page, job('n-fresh'), { accepted_at: 3, created_at: 24 * 40 });
    const edge = await renderCard(page, job('n-edge'), { accepted_at: 35.5, created_at: 24 * 40 });
    const old = await renderCard(page, job('n-old'), { accepted_at: 37, created_at: 24 * 40 });

    await expect(fresh.locator('.kanban-new-tag')).toHaveText('NEW');
    await expect(edge.locator('.kanban-new-tag')).toHaveCount(1);
    // A lead that existed for weeks counts from acceptance, not creation.
    await expect(old.locator('.kanban-new-tag')).toHaveCount(0);
  });

  test('a job put straight onto the pipeline counts from creation, in any stage', async ({ page }) => {
    const cli = await renderCard(page, job('n-cli', { status: 'scheduled' }), { accepted_at: null, created_at: 20 });
    const oldCli = await renderCard(page, job('n-oldcli', { status: 'scheduled' }), { accepted_at: null, created_at: 40 });
    await expect(cli.locator('.kanban-new-tag')).toHaveCount(1);
    await expect(oldCli.locator('.kanban-new-tag')).toHaveCount(0);
  });

  test('a later move does not bring the tag back', async ({ page }) => {
    // Accepted weeks ago, deposit paid an hour ago: moved on, not new.
    const moved = await renderCard(page, job('n-moved', { status: 'approvals' }), { accepted_at: 24 * 20, approvals_at: 1, deposit_at: 1 });
    // Dragged back to Accepted: fresh accepted_at, but an earlier approvals time.
    const back = await renderCard(page, job('n-back'), { accepted_at: 2, approvals_at: 24 * 5 });
    // Accepted yesterday and moved on today: still inside its first 36 hours.
    const quick = await renderCard(page, job('n-quick', { status: 'approvals' }), { accepted_at: 20, approvals_at: 2 });
    await expect(moved.locator('.kanban-new-tag')).toHaveCount(0);
    await expect(back.locator('.kanban-new-tag')).toHaveCount(0);
    await expect(quick.locator('.kanban-new-tag')).toHaveCount(1);
  });

  test('sales drawer quotes are not on the pipeline yet; a new repair is', async ({ page }) => {
    const lead = await renderCard(page, job('n-lead', { status: 'quoted' }), { accepted_at: null, created_at: 2 });
    const repair = await renderCard(page, job('n-repair', { type: 'repair', status: 'accepted', column: 'wo_in', job_number: 'SWR-1' }), { accepted_at: null, created_at: 2 });
    await expect(lead.locator('.kanban-new-tag')).toHaveCount(0);
    await expect(repair.locator('.kanban-new-tag')).toHaveCount(1);
  });

  test('the tab sits flush in the lower-right corner and clears the days line', async ({ page }) => {
    const card = await renderCard(page, job('n-look', { days_in_stage: 0 }), { accepted_at: 1 });
    const tag = card.locator('.kanban-new-tag');
    const style = await tag.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position, color: cs.color, background: cs.backgroundColor,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius,
        bl: cs.borderBottomLeftRadius, br: cs.borderBottomRightRadius,
      };
    });
    expect(style).toEqual({
      position: 'absolute', color: 'rgb(255, 255, 255)', background: 'rgb(241, 90, 41)',
      fontSize: '7px', fontWeight: '700', tl: '8px', tr: '0px', bl: '0px', br: '0px',
    });
    const box = await card.boundingBox();
    const tagBox = await tag.boundingBox();
    // Flush with the padding edge: only the card's hairline border is outside it.
    expect(Math.abs((box.x + box.width) - (tagBox.x + tagBox.width))).toBeLessThan(2);
    expect(Math.abs((box.y + box.height) - (tagBox.y + tagBox.height))).toBeLessThan(2);

    // No card content overlaps the tab, the days line included.
    const overlaps = await card.evaluate((el) => {
      const t = el.querySelector('.kanban-new-tag').getBoundingClientRect();
      const hits = [];
      el.querySelectorAll('*').forEach((n) => {
        if (n.closest('.kanban-new-tag') || n.children.length) return;
        const range = document.createRange();
        range.selectNodeContents(n);
        [...range.getClientRects()].forEach((r) => {
          if (r.width && r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top) hits.push(n.className || n.tagName);
        });
      });
      return hits;
    });
    expect(overlaps).toEqual([]);
    await expect(card.locator('.kanban-days')).toHaveText('0 days in stage');
  });
});
