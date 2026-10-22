// Ops Dash asbestos marker: every job card of an asbestos job carries a small
// red "A" (search `// <asbestos-card-badge>` in ops.html). The pipeline and
// calendar rows carry existing_fence_type; a fencing job whose value is
// 'asbestos' draws the A, the same check the hover pop-up's Asbestos tag runs.
// It is a marker only: pressing it opens the card as before.
//
// Static fixtures (no network): the kanban card is rendered straight through
// renderKanbanCard, and the calendar is seeded through window._calEvents and
// renderCalendar(), so the real production renderers decide what is drawn.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

async function renderCard(page, job) {
  await page.evaluate((card) => {
    let host = document.getElementById('asbestos-card-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'asbestos-card-host';
      document.body.appendChild(host);
    }
    window._pipelineTab = card.type;
    host.insertAdjacentHTML('beforeend', renderKanbanCard(card, card.status));
  }, job);
  return page.locator('.kanban-card[data-job-id="' + job.id + '"]');
}

function ev(o) {
  return Object.assign({
    assignment_type: 'install',
    confirmation_status: 'tentative',
    site_suburb: 'Carlisle',
    site_address: '1 Test St',
    start_time: null, end_time: null,
    user_id: 'u1', crew_name: 'Hugo', assigned_to: null,
    label: null, recurrence_group_id: null,
    job_type: 'fencing',
    scheduled_date: '2026-09-14', scheduled_end: '2026-09-14',
  }, o);
}

const EVENTS = [
  ev({ job_id: 'j-asb', assignment_id: 'a-asb', job_number: 'SWF-261387', client_name: 'Asbestos Fixture', existing_fence_type: 'asbestos' }),
  ev({ job_id: 'j-clean', assignment_id: 'a-clean', job_number: 'SWF-27002', client_name: 'Clean Fixture', existing_fence_type: 'hardie' }),
  // Field absent (backend not deployed yet): no A.
  ev({ job_id: 'j-none', assignment_id: 'a-none', job_number: 'SWF-27003', client_name: 'Absent Fixture' }),
];

async function seedCalendar(page, viewMode) {
  await page.evaluate(({ EVENTS, viewMode }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    window._calDate = new Date('2026-09-14T00:00:00');
    window._calRangeMode = '1w';
    window._calViewMode = viewMode;
    window._calEvents = EVENTS;
    window._crewList = [{ id: 'u1', name: 'Hugo', role: 'crew', division: 'fencing' }];
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window._calDeliveries = [];
    window.renderCalendar();
  }, { EVENTS, viewMode });
}

function badgeByJob(page, selector) {
  return page.evaluate((sel) => Object.fromEntries([...document.querySelectorAll(sel)]
    .filter((el) => /SWF-|Fixture/.test(el.textContent))
    .map((el) => {
      const a = el.querySelector('.asbestos-a');
      const key = (el.textContent.match(/Asbestos Fixture|Clean Fixture|Absent Fixture/) || [''])[0];
      return [key, a ? { text: a.textContent, title: a.getAttribute('title'), onclick: a.getAttribute('onclick') } : null];
    })), selector);
}

test.describe('kanban job card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ops.html');
    await page.waitForFunction(() => typeof window.renderKanbanCard === 'function');
    await revealOpsStaticFixture(page);
  });

  test('an asbestos job shows the red A beside the name; others do not', async ({ page }) => {
    const asb = await renderCard(page, { id: 'k-asb', type: 'fencing', status: 'accepted', client_name: 'Ged Fixture', existing_fence_type: 'asbestos' });
    const clean = await renderCard(page, { id: 'k-clean', type: 'fencing', status: 'accepted', client_name: 'Clean Fixture', existing_fence_type: 'hardie' });
    const absent = await renderCard(page, { id: 'k-none', type: 'fencing', status: 'accepted', client_name: 'Absent Fixture' });
    const patio = await renderCard(page, { id: 'k-patio', type: 'patio', status: 'accepted', client_name: 'Patio Fixture', existing_fence_type: 'asbestos' });

    const a = asb.locator('.kanban-client .asbestos-a');
    await expect(a).toHaveText('A');
    expect(await a.getAttribute('title')).toBeNull();
    await expect(a).toBeVisible();
    expect(await a.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(153, 27, 27)');
    await expect(asb.locator('.kanban-client')).toContainText('Ged Fixture');

    await expect(clean.locator('.asbestos-a')).toHaveCount(0);
    await expect(absent.locator('.asbestos-a')).toHaveCount(0);
    // Fencing only, as in the pop-up's renderRunBreakdown.
    await expect(patio.locator('.asbestos-a')).toHaveCount(0);
  });

  test('pressing the A opens the job exactly as pressing the card does', async ({ page }) => {
    const card = await renderCard(page, { id: 'k-click', type: 'fencing', status: 'accepted', client_name: 'Click Fixture', existing_fence_type: 'asbestos' });
    await page.evaluate(() => {
      window.__opened = [];
      window.openJobDetail = (id) => window.__opened.push(id);
    });
    const a = card.locator('.asbestos-a');
    expect(await a.getAttribute('onclick')).toBeNull();
    await a.click();
    expect(await page.evaluate(() => window.__opened)).toEqual(['k-click']);
  });
});

for (const v3 of [true, false]) {
  test.describe('calendar cards, v3 ' + (v3 ? 'on' : 'off'), () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((v3on) => {
        try {
          localStorage.setItem('sw_cal_v3_intro', '1');
          if (!v3on) localStorage.setItem('sw_cal_v3', '0');
        } catch (e) { /* storage unavailable */ }
      }, v3);
      await page.goto('/ops.html');
      await page.waitForFunction(() => typeof window.renderCalendar === 'function');
      await revealOpsStaticFixture(page);
    });

    test('Crew view: only the asbestos job block carries the A', async ({ page }) => {
      await seedCalendar(page, 'crew');
      const got = await badgeByJob(page, '.cal-job-block');
      expect(got['Asbestos Fixture']).toEqual({ text: 'A', title: null, onclick: null });
      expect(got['Clean Fixture']).toBeNull();
      expect(got['Absent Fixture']).toBeNull();
    });

    test('Schedule view: only the asbestos job bar carries the A', async ({ page }) => {
      await seedCalendar(page, 'schedule');
      const got = await badgeByJob(page, '.cal-schedule-bar');
      expect(got['Asbestos Fixture']).toEqual({ text: 'A', title: null, onclick: null });
      expect(got['Clean Fixture']).toBeNull();
      expect(got['Absent Fixture']).toBeNull();
      await expect(page.locator('.cal-schedule-bar .asbestos-a').first()).toBeVisible();
    });
  });
}
