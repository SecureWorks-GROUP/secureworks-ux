// Ops Dash calendar: the copy icon beside "Open Job" in a job's pop-up card.
//
// The icon copies the job's number, client, address, phone and email to the
// clipboard. It used to look the job up only in the Jobs board's loaded data
// (_pipelineData), which holds just the board last opened (one job type, any
// search applied). A calendar job outside that board, such as an archived
// fencing job seen from the patio board, answered "Job not found" and copied
// nothing. The pop-up already holds the job's own job_detail record, so the
// copy reads that.
//
// Static-fixture spec, same pattern as ops-calendar-v3.spec.js: it seeds
// window._calEvents, stubs the job_detail read and the clipboard in the page,
// and clicks the real bar and the real copy icon. Every name here is made up.
const { test, expect } = require('@playwright/test');
const { revealOpsStaticFixture } = require('../helpers/ops-auth');

function ev(o) {
  return Object.assign({
    assignment_type: 'install', confirmation_status: 'tentative',
    site_suburb: 'Testville', site_address: '1 Test St, Testville',
    start_time: null, end_time: null, user_id: null, crew_name: null, assigned_to: null,
    label: null, recurrence_group_id: null,
  }, o);
}

// Week of Mon 3 Aug 2026.
const EVENTS = [
  ev({ job_id: 'j-arch', assignment_id: 'a-arch', job_number: 'SWF-27101', client_name: 'Ian Example', job_type: 'fencing',
       scheduled_date: '2026-08-04', scheduled_end: '2026-08-04' }),
  ev({ job_id: 'j-live', assignment_id: 'a-live', job_number: 'SWP-27102', client_name: 'Jo Sample', job_type: 'patio',
       scheduled_date: '2026-08-05', scheduled_end: '2026-08-05' }),
];
const DETAIL = {
  'j-arch': { id: 'j-arch', job_number: 'SWF-27101', client_name: 'Ian Example', type: 'fencing', status: 'archived',
              site_address: '2 Archive Rd, Testville', client_phone: '0400 000 001', client_email: 'ian@example.test' },
  'j-live': { id: 'j-live', job_number: 'SWP-27102', client_name: 'Jo Sample', type: 'patio', status: 'scheduled',
              site_address: '3 Live St, Testville', client_phone: '0400 000 002', client_email: 'jo@example.test' },
};

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ops.html');
  await page.waitForFunction(() => typeof window.renderScheduleView === 'function' && typeof window.openCalJobPopup === 'function');
  await revealOpsStaticFixture(page);
  await page.evaluate(({ EVENTS, DETAIL }) => {
    const container = document.getElementById('calendarBody');
    for (let n = container; n && n !== document.body; n = n.parentElement) {
      if (getComputedStyle(n).display === 'none') n.style.display = 'block';
    }
    document.getElementById('viewCalendar').classList.add('active');
    window._calDate = new Date('2026-08-03T00:00:00');
    window._calRangeMode = '1w';
    window._calViewMode = 'schedule';
    window._calEvents = EVENTS;
    window._calOrgEvents = [];
    window._calDeliveries = [];
    window._calPOs = null;
    window._crewList = [];
    window._calLeaveByDate = {};
    window._calAvailability = {};
    window._calReadiness = {};
    window.applyCalFocus();
    window.renderCalendar();

    // The pop-up's job_detail read answers from the fixture; every other read
    // stays empty so nothing reaches the network.
    window.opsFetch = (action, params) => {
      if (action === 'job_detail') return Promise.resolve({ job: DETAIL[params.jobId], assignments: [] });
      return Promise.resolve({});
    };
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } },
    });
  }, { EVENTS, DETAIL });
});

async function copyFromPopup(page, client) {
  await page.evaluate(() => {
    window.closeCalJobPopup();
    window.__copied = [];
    document.getElementById('toastContainer').innerHTML = '';
  });
  await page.locator('.cal-schedule-bar', { hasText: client }).first().click();
  const copy = page.locator('#calJobPopup .cal-job-popup-title button[title="Copy job info"]');
  await expect(copy).toBeVisible();
  await copy.click();
  await expect.poll(() => page.evaluate(() => document.getElementById('toastContainer').textContent)).not.toBe('');
  return page.evaluate(() => ({
    copied: window.__copied.slice(),
    toasts: document.getElementById('toastContainer').textContent,
  }));
}

test('an archived job on the calendar copies its details, with the Jobs board never loaded', async ({ page }) => {
  await page.evaluate(() => { window._pipelineData = null; });
  const r = await copyFromPopup(page, 'Ian Example');
  expect(r.toasts).not.toContain('Job not found');
  expect(r.toasts).toContain('Copied to clipboard');
  expect(r.copied).toEqual(['SWF-27101\nIan Example\n2 Archive Rd, Testville\n0400 000 001\nian@example.test']);
});

test('a live job outside the loaded Jobs board copies too', async ({ page }) => {
  // The board last opened holds other jobs only (another type, or a search).
  await page.evaluate(() => {
    window._pipelineData = { columns: { scheduled: [{ id: 'j-other', job_number: 'SWF-27199', client_name: 'Someone Else' }] } };
  });
  const r = await copyFromPopup(page, 'Jo Sample');
  expect(r.toasts).not.toContain('Job not found');
  expect(r.copied).toEqual(['SWP-27102\nJo Sample\n3 Live St, Testville\n0400 000 002\njo@example.test']);
});
