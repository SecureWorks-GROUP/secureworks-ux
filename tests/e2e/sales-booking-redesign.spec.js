// Booking screen redesign: real-browser checks with trusted input only.
//
// Runs the real modules/ops-sales-booking.js against the offline Friday fixture
// (tests/fixtures/booking-confirm/friday.html): synthetic people, CSP
// connect-src 'none', every write a local fake recorded on window.fakeWrites.
// Clicks and typing go through Playwright's trusted input pipeline, never
// element.dispatchEvent, on a desktop and a phone viewport.
const { test, expect } = require('@playwright/test');

const URL = '/tests/fixtures/booking-confirm/friday.html';

const viewports = [
  { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
];

for (const vp of viewports) {
  test.describe(`booking screen on ${vp.name}`, () => {
    test.use(vp.use);

    async function open(page) {
      await page.goto(URL);
      await expect(page.locator('.bk-list .lead').first()).toBeVisible();
    }

    async function choose(page, name) {
      await page.locator('.bk-list .lead', { hasText: name }).click();
      await expect(page.locator('.cardhead h2')).toHaveText(name);
    }

    test('the list opens loudest first and a tap opens one card with the last three messages', async ({ page }) => {
      await open(page);
      await expect(page.locator('.counts')).toContainText('to contact');
      await expect(page.locator('.bk-list .lead .lead-name').first()).toHaveText('Basil L');
      await expect(page.locator('.bk-list .lead').first()).toContainText('“Still waiting to hear back. Are you coming Friday or not?”');
      await choose(page, 'Basil L');
      const bubbles = page.locator('.bk-card .bubble');
      await expect(bubbles).toHaveCount(3);
      await expect(bubbles.last()).toContainText('Still waiting to hear back. Are you coming Friday or not?');
      await expect(page.getByRole('button', { name: 'Show all 4 messages' })).toBeVisible();
      await expect(page.locator('.route')).toContainText('SecureWorks Group Ops 776');
      await expect(page.locator('.route')).toContainText('phone ending 418');
      await expect(page.getByRole('combobox', { name: 'Visit day' })).toBeVisible();
      await expect(page.locator('.visit .fine').first()).toContainText('arrive 12:00 to 1:30pm');
      await expect(page.locator('.targets')).toHaveText("Book it writes: GHL Stratco Fencing calendar and Marnin's Outlook");
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
      const day = page.locator('.bk-day');
      await expect(day.locator('h2')).toContainText('Friday');
      await expect(day.locator('.src-outlook').first()).toBeVisible();
      await expect(day.locator('.ev', { hasText: 'Scope: Jordan W' }).locator('.src')).toHaveText('GHL');
      await expect(day.locator('.ev', { hasText: 'Scope: Melanie N' }).locator('.src')).toHaveText('Outlook');
      if (vp.name === 'phone') {
        await expect(page.locator('.bk-list')).toBeHidden();
        await page.getByRole('button', { name: 'All leads' }).click();
        await expect(page.locator('.bk-list')).toBeVisible();
      }
    });

    test('a clash names the other booking and blocks booking, not the text', async ({ page }) => {
      await open(page);
      await choose(page, 'Kerry P');
      await expect(page.locator('.compose .clash')).toHaveText('Clashes with Scope: Melanie N, Piara Waters at 10:45am (Outlook).');
      await expect(page.getByRole('combobox', { name: 'Visit day' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeEnabled();
      const slot = page.locator('.bk-day .ev.is-clash', { hasText: 'Kerry P' });
      await expect(slot.locator('.ev-clash')).toHaveText('Clashes with Scope: Melanie N, Piara Waters at 10:45am');
      // Overlapping entries show their whole name and time, never cut off.
      for (const ev of await page.locator('.bk-day .ev').all()) {
        for (const part of await ev.locator('.ev-title, .ev-time, .ev-clash').all()) {
          expect(await part.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        }
        expect(await ev.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      }
    });

    test('an edited text is checked by the server, shown exactly, then approved; a missing send action says so', async ({ page }) => {
      await open(page);
      await choose(page, 'Basil L');
      const box = page.getByRole('textbox', { name: 'Text to send' });
      await box.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Marnin');
      await expect(box).toBeFocused();
      await expect(page.locator('.edited')).toContainText('Your approval will cover these exact words');
      const edited = await box.inputValue();
      await page.getByRole('button', { name: 'Send this text' }).click();
      const check = page.locator('[data-owner-preview="message"]');
      await expect(check.locator('.oc-head')).toHaveText('Checked. This exact text goes from SecureWorks Group Ops 776 to the phone ending 418.');
      await expect(check.locator('.oc-text')).toHaveText(edited);
      await expect(check).toContainText('Not already in this conversation (4 messages read).');
      await expect(box).toBeDisabled();
      let writes = await page.evaluate(() => window.fakeWrites);
      expect(writes).toHaveLength(1);
      expect(writes[0].body.dry_run).toBe(true);
      expect(writes[0].body.owner_input.text).toBe(edited);
      await page.getByRole('button', { name: 'Approve and send' }).click();
      await expect(page.locator('.compose .result')).toHaveText('Sending from this screen is not connected yet. Your approval is recorded; nothing was sent.');
      writes = await page.evaluate(() => window.fakeWrites);
      const decide = writes[1];
      expect(decide.body.decision).toBe('approved');
      expect(decide.body.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(decide.body.owner_input.prepared_at).toBeTruthy();
      expect(decide.body.owner_input.text).toBe(edited);
      const send = writes.find((w) => w.action === 'sales_booking_send');
      expect(send.body).toEqual({ approval_id: expect.stringMatching(/^[0-9a-f]{64}$/) });
      await expect(page.locator('.bk-card')).not.toContainText('Text sent');
    });

    test('a lead with no proposed time is booked from a picked day and window', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      await choose(page, 'Priya S');
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
      await expect(page.locator('#why-calendar')).toHaveText('Pick a day and an arrival time first.');
      const friday = await page.evaluate(() => SalesBooking.state.data.booking_flow.owner_rulebook.bookable_dates.filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 5).pop());
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(friday);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await expect(page.locator('.visit .when')).toContainText('arrive 12:30 to 1:30pm');
      await page.getByRole('button', { name: 'Book it' }).click();
      const check = page.locator('[data-owner-preview="calendar"]');
      await expect(check.locator('.oc-head')).toHaveText("Checked. This exact visit goes in GHL Stratco Fencing calendar and Marnin's Outlook.");
      await expect(check).toContainText('Scope visit: Priya S');
      await expect(check).toContainText('Outlook is clear');
      await expect(page.getByRole('combobox', { name: 'Visit day' })).toBeDisabled();
      await page.getByRole('button', { name: 'Approve and book' }).click();
      await expect(page.locator('.visit .result')).toContainText(/Booked Friday \d+ \w+, arrive 12:30 to 1:30pm in GHL Stratco Fencing calendar and Marnin's Outlook/);
      const writes = await page.evaluate(() => window.fakeWrites);
      expect(writes.map((w) => w.action)).toEqual(['sales_booking_approval_write', 'sales_booking_approval_write', 'sales_booking_book']);
      expect(writes[0].body.owner_input.visit).toEqual({ window_start_iso: friday + 'T12:30:00+08:00', window_end_iso: friday + 'T13:30:00+08:00', end_iso: friday + 'T14:30:00+08:00' });
    });

    test('a server refusal on a picked time is one plain sentence and nothing is booked', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      await choose(page, 'Priya S');
      const friday = await page.evaluate(() => SalesBooking.state.data.booking_flow.owner_rulebook.bookable_dates.filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 5).pop());
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(friday);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:00');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await page.getByRole('button', { name: 'Book it' }).click();
      await expect(page.locator('.visit .result')).toHaveText('Not booked: that time clashes with Scope: Melanie N, Piara Waters at 10:45am in Outlook, counting 30 minutes travel either side.');
      await expect(page.locator('[data-owner-preview]')).toHaveCount(0);
      const writes = await page.evaluate(() => window.fakeWrites);
      expect(writes.map((w) => w.action)).toEqual(['sales_booking_approval_write']);
    });

    test('a connected send shows the result in words', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      await choose(page, 'Basil L');
      await page.getByRole('button', { name: 'Send this text' }).click();
      await expect(page.locator('.compose .result')).toContainText(/Text sent at \d{1,2}:\d{2}[ap]m from SecureWorks Group Ops 776 to the phone ending 418\./);
      await expect(page.getByRole('button', { name: 'Send this text' })).toBeDisabled();
      const friday = await page.evaluate(() => SalesBooking.state.data.booking_flow.owner_rulebook.bookable_dates.filter((d) => new Date(d + 'T12:00:00Z').getUTCDay() === 5).pop());
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(friday);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await page.getByRole('button', { name: 'Book it' }).click();
      await page.getByRole('button', { name: 'Approve and book' }).click();
      await expect(page.locator('.visit .result')).toContainText("in GHL Stratco Fencing calendar and Marnin's Outlook");
    });

    test('booking Priya occupies Friday so Basil must pick another time', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      const thisFri = await page.evaluate(() => SalesBooking.addDays(SalesBooking.state.data.week_start, 4));
      await choose(page, 'Priya S');
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(thisFri);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await page.getByRole('button', { name: 'Book it' }).click();
      await page.getByRole('button', { name: 'Approve and book' }).click();
      await expect(page.locator('.visit .result')).toContainText('Booked');
      // The column defaults to a day that already has a proposal (Tuesday in
      // this fixture). Open Friday, the day that was just booked, before
      // asserting the new occupancy is painted.
      await page.locator('[data-booking-day="4"]').click();
      await expect(page.locator('.bk-day h2')).toContainText('Friday');
      await expect(page.locator('.bk-day .ev.is-confirmed', { hasText: 'Priya S' })).toBeVisible();
      if (vp.name === 'phone') await page.getByRole('button', { name: 'All leads' }).click();
      await choose(page, 'Basil L');
      await expect(page.getByRole('combobox', { name: 'Visit day' })).toBeVisible();
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(thisFri);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await expect(page.locator('.visit .clash')).toContainText('Priya');
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
    });

    test('a sent offer does not block that same lead booking the held visit', async ({ page }) => {
      await open(page);
      await page.evaluate(() => { window.fixtureActionMode = 'sent'; });
      const thisFri = await page.evaluate(() => SalesBooking.addDays(SalesBooking.state.data.week_start, 4));
      await choose(page, 'Priya S');
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(thisFri);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await expect(page.locator('.compose .fine', { hasText: 'This text holds' })).toBeVisible();
      await expect(page.locator('[data-owner-offer]')).toHaveCount(0);
      await expect(page.getByText('Hold this', { exact: false })).toHaveCount(0);
      await page.getByRole('button', { name: 'Send this text' }).click();
      await page.getByRole('button', { name: 'Approve and send' }).click();
      await expect(page.locator('.compose .result')).toContainText('Text sent');
      await expect(page.locator('.visit .clash')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Book it' })).toBeEnabled();
      await page.getByRole('button', { name: 'Book it' }).click();
      await page.getByRole('button', { name: 'Approve and book' }).click();
      await expect(page.locator('.visit .result')).toContainText('Booked');
      if (vp.name === 'phone') await page.getByRole('button', { name: 'All leads' }).click();
      await choose(page, 'Basil L');
      await page.getByRole('combobox', { name: 'Visit day' }).selectOption(thisFri);
      await page.getByRole('combobox', { name: 'Arrive from' }).selectOption('12:30');
      await page.getByRole('combobox', { name: 'Arrival window' }).selectOption('60');
      await expect(page.locator('.visit .clash')).toContainText(/Priya|offered/i);
      await expect(page.getByRole('button', { name: 'Book it' })).toBeDisabled();
    });

    test('search keeps focus while typing and Refresh reads again', async ({ page }) => {
      await open(page);
      const search = page.getByRole('searchbox', { name: 'Search' });
      await search.click();
      await page.keyboard.type('aubin', { delay: 30 });
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('aubin');
      await expect(page.locator('.bk-list .lead')).toHaveCount(1);
      await expect(page.locator('.bk-list .lead .lead-name')).toHaveText('Basil L');
      const before = await page.evaluate(() => window.fakeReads.filter((r) => r.action === 'sales_booking_read').length);
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect.poll(() => page.evaluate(() => window.fakeReads.filter((r) => r.action === 'sales_booking_read').length)).toBe(before + 1);
      await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
      await expect(search).toHaveValue('aubin');
    });
  });
}
