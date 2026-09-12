const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('@playwright/test');

let browser;

before(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(error && error.message))) throw error;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
  }
});

after(async () => {
  if (browser) await browser.close();
});

async function bookingPage(t) {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } });
  t.after(async () => page.close());
  await page.setContent('<!doctype html><html><body><main id="viewSales"><div id="salesBookingRoot"></div></main></body></html>');
  await page.addScriptTag({ path: path.resolve(process.cwd(), 'modules/ops-sales-booking.js') });
  await page.evaluate(() => {
    const api = window.SalesBooking;
    api.state.resourceId = 'nithin';
    api.state.weekStart = '2026-09-14';
    api.state.search = '';
    api.state.filter = 'all';
    api.state.selectedId = null;
    api.state.layers = { confirmed: true, proposal: true, offer: true, availability: true };
    api.state.data = {
      ok: true,
      fixture: false,
      resource: {
        id: 'nithin',
        name: 'Nithin',
        calendar: { ok: true, mailbox: 'nithin@secureworkswa.com.au', leave: 'read' }
      },
      coverage: { full_population: true, gaps: [] },
      events: [{
        event_id: 'evt-1',
        case_id: 'evt-1',
        subject: 'Provider diary',
        display_name: 'Diary visit',
        suburb: 'City Beach',
        start_iso: '2026-09-15T09:00:00',
        end_iso: '2026-09-15T10:00:00',
        layer: 'confirmed'
      }],
      cases: [{
        id: 'ready-1',
        contact_id: 'contact-ready',
        display_name: 'Ready proposal',
        suburb: 'Carlisle',
        status: 'ready',
        proposal: {
          start_iso: '2026-09-17T13:00:00',
          end_iso: '2026-09-17T14:00:00',
          window_start_iso: '2026-09-17T13:00:00',
          window_end_iso: '2026-09-17T16:30:00',
          offer_id: 'off-ready'
        }
      }, {
        id: 'stale-1',
        contact_id: 'contact-stale',
        display_name: 'Stale proposal',
        suburb: 'Fremantle',
        status: 'ready',
        proposal_stale: true,
        proposal: {
          start_iso: '2026-09-18T11:00:00',
          end_iso: '2026-09-18T12:00:00',
          offer_id: 'off-stale'
        }
      }, {
        id: 'future-1',
        contact_id: 'contact-future',
        display_name: 'Future proposal',
        suburb: 'Osborne Park',
        status: 'ready',
        proposal: {
          start_iso: '2026-09-21T09:00:00',
          end_iso: '2026-09-21T10:00:00',
          offer_id: 'off-future'
        }
      }, {
        id: 'held-1',
        contact_id: 'contact-held',
        display_name: 'Held offer',
        suburb: 'Subiaco',
        status: 'waiting',
        proposal_stale: true,
        proposal: {
          start_iso: '2026-09-16T14:00:00',
          end_iso: '2026-09-16T15:00:00',
          offer_id: 'off-held'
        }
      }]
    };
    api.render();
  });
  return page;
}

test('mobile agenda follows calendar visibility and labels dates', async (t) => {
  const page = await bookingPage(t);
  const agenda = page.locator('.dayagenda');

  assert.deepEqual(await visibleIds(page), {
    grid: ['evt-1', 'held-1', 'ready-1'],
    agenda: ['evt-1', 'held-1', 'ready-1']
  });
  await expectText(agenda, '2026-09-15 09:00');
  await expectText(agenda, '2026-09-16 14:00');
  await expectText(agenda, '2026-09-17 13:00');
  await expectText(agenda, 'Held offer');
  await expectText(agenda, 'Ready proposal');
  await expectNoText(agenda, 'Stale proposal');
  await expectNoText(agenda, 'Future proposal');

  await page.locator('input[data-booking-layer="proposal"]').uncheck();
  assert.deepEqual(await visibleIds(page), {
    grid: ['evt-1', 'held-1'],
    agenda: ['evt-1', 'held-1']
  });
  await expectNoText(agenda, 'Ready proposal');
  await expectText(agenda, 'Held offer');

  await page.locator('input[data-booking-layer="offer"]').uncheck();
  assert.deepEqual(await visibleIds(page), {
    grid: ['evt-1'],
    agenda: ['evt-1']
  });
  await expectNoText(agenda, 'Held offer');
  await expectText(agenda, 'Diary visit');

  await page.locator('input[data-booking-layer="confirmed"]').uncheck();
  assert.deepEqual(await visibleIds(page), {
    grid: [],
    agenda: []
  });
  await expectNoText(agenda, 'Diary visit');
  await expectText(agenda, 'No provider events or proposals in this week.');
});

test('queue search keeps focus while multiple characters update results', async (t) => {
  const page = await bookingPage(t);
  const search = page.locator('[data-booking-search]');

  await search.click();
  await search.pressSequentially('reedy');
  await page.evaluate(() => {
    const input = document.querySelector('[data-booking-search]');
    input.setSelectionRange(2, 3);
  });
  await search.pressSequentially('a');

  assert.equal(await search.inputValue(), 'ready');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.matches('[data-booking-search]')), true);
  assert.deepEqual(await page.evaluate(() => {
    const input = document.querySelector('[data-booking-search]');
    return [input.selectionStart, input.selectionEnd];
  }), [3, 3]);
  await expectText(page.locator('.queuelist'), 'Ready proposal');
  await expectNoText(page.locator('.queuelist'), 'Held offer');
  assert.equal(await page.locator('.queue .count').textContent(), '1');
});

async function expectText(locator, text) {
  assert.match(await locator.textContent(), new RegExp(escapeRe(text)));
}

async function expectNoText(locator, text) {
  assert.doesNotMatch(await locator.textContent(), new RegExp(escapeRe(text)));
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function visibleIds(page) {
  return page.evaluate(() => {
    const ids = (selector) => Array.from(document.querySelectorAll(selector))
      .map((el) => el.getAttribute('data-booking-case'))
      .filter(Boolean)
      .sort();
    return {
      grid: ids('.calendarbody [data-booking-case]'),
      agenda: ids('.dayagenda [data-booking-case]')
    };
  });
}
