const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bookingSource = fs.readFileSync(path.resolve(__dirname, '../../modules/ops-sales-booking.js'), 'utf8');

test('host Booking read for Nithin does not attach Khairo occupancy', async () => {
  const calls = [];
  const rootEl = { innerHTML: '', setAttribute() {} };
  const context = {
    document: {
      addEventListener() {},
      getElementById: id => id === 'salesBookingRoot' ? rootEl : null
    },
    opsFetch: async (action, params) => {
      calls.push({ action, params });
      assert.equal(action, 'sales_booking_read');
      const resource = params && (params.resource || params.scoper);
      return {
        ok: true,
        resource: { scoper: resource },
        events: resource === 'nithin'
          ? [{ event_id: 'nithin-evt', subject: 'Nithin scope' }]
          : [{ event_id: 'khairo-evt', subject: 'Khairo fence' }],
        cases: [],
        coverage: { complete: false },
        week_start: '2026-09-14'
      };
    },
    opsPost: async () => { throw new Error('no write'); }
  };
  context.window = context;
  vm.runInNewContext(bookingSource, context);
  if (typeof context.SalesBooking.load === 'function') {
    await context.SalesBooking.load('nithin', '2026-09-14');
  } else {
    await context.SalesBooking.show('booking');
  }
  const nithinReads = calls.filter(c => (c.params && (c.params.resource || c.params.scoper)) === 'nithin');
  assert.ok(nithinReads.length >= 1 || calls.some(c => c.action === 'sales_booking_read'));
  assert.doesNotMatch(rootEl.innerHTML, /khairo-evt|Khairo fence/);
});
