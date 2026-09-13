const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'modules/ops-sales-host-provenance.json'), 'utf8'));
const opsHtml = fs.readFileSync(path.join(root, 'ops.html'), 'utf8');
const hostSource = fs.readFileSync(path.join(root, 'modules/ops-sales-host.js'), 'utf8');
const bookingSource = fs.readFileSync(path.join(root, 'modules/ops-sales-booking.js'), 'utf8');
const performanceSource = fs.readFileSync(path.join(root, 'modules/ops-sales-performance.js'), 'utf8');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'modules', file))).digest('hex');
}

test('copied Booking and Performance bytes match the Patio f048ca5 provenance', () => {
  assert.equal(provenance.source_sha, 'f048ca533e4c9b375b3928710aacdbebd97f4bc9');
  for (const [file, digest] of Object.entries(provenance.files)) {
    assert.equal(sha256(file), digest, file);
  }
});

test('combined host does not wire 4174/4175 preview globals or JSON preview paths', () => {
  assert.match(opsHtml, /modules\/ops-sales-booking\.js/);
  assert.match(opsHtml, /modules\/ops-sales-performance\.js/);
  assert.match(opsHtml, /modules\/ops-sales-host\.js/);
  assert.match(opsHtml, /id="salesBookingRoot"/);
  assert.match(opsHtml, /id="salesPerformanceRoot"/);
  assert.doesNotMatch(opsHtml, /SALES_BOOKING_PREVIEW_URL\s*=|SALES_PERFORMANCE_PREVIEW_URL\s*=|127\.0\.0\.1:4174|127\.0\.0\.1:4175/);
  assert.doesNotMatch(hostSource, /SALES_BOOKING_PREVIEW_URL\s*=/);
  assert.match(hostSource, /4174\/4175 JSON preview is not connected/);
});

test('host strips preview globals and mounts authenticated Booking/Performance', async () => {
  const sales = { id: 'viewSales', classList: { toggle() {} } };
  const bookingRoot = { id: 'salesBookingRoot', parentNode: { insertBefore() {} } };
  const performanceRoot = { id: 'salesPerformanceRoot', parentNode: { insertBefore() {} } };
  const notices = {};
  const shown = [];
  const context = {
    SALES_BOOKING_PREVIEW_URL: 'http://127.0.0.1:4174/sales-booking-read',
    SALES_BOOKING_PREVIEW_API: 'http://127.0.0.1:4174/booking-api',
    SALES_PERFORMANCE_PREVIEW_URL: 'http://127.0.0.1:4174/sales-performance-read',
    document: {
      getElementById(id) {
        if (id === 'viewSales') return sales;
        if (id === 'salesBookingRoot') return bookingRoot;
        if (id === 'salesPerformanceRoot') return performanceRoot;
        return notices[id] || null;
      },
      createElement() {
        const el = { id: '', className: '', textContent: '', setAttribute() {} };
        return el;
      }
    },
    SalesBooking: { show(tab) { shown.push(tab); } },
    SalesPerformance: { load() { shown.push('performance-load'); } }
  };
  context.window = context;
  vm.runInNewContext(hostSource, context);
  context.OpsSalesHost.show('booking');
  assert.equal(!!context.SALES_BOOKING_PREVIEW_URL, false);
  assert.equal(!!context.SALES_BOOKING_PREVIEW_API, false);
  assert.equal(!!context.SALES_PERFORMANCE_PREVIEW_URL, false);
  assert.deepEqual(shown, ['booking']);
});

test('Performance unpublished envelope keeps missing measures missing, not zero', async () => {
  const rootEl = { innerHTML: '', setAttribute() {}, dispatchEvent() {} };
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    document: {
      addEventListener() {},
      getElementById: id => id === 'salesPerformanceRoot' ? rootEl : null
    },
    opsFetch: async action => {
      assert.equal(action, 'sales_performance_read');
      return {
        ok: true,
        unpublished: true,
        storage_provenance: null,
        rows: [],
        week_starts: [],
        available_weeks: [],
        week_start: null,
        fetched_at: '2026-09-13T03:10:38.718631Z'
      };
    }
  };
  context.window = context;
  vm.runInNewContext(performanceSource, context);
  await context.SalesPerformance.load();
  assert.match(rootEl.innerHTML, /No week stored/);
  assert.match(rootEl.innerHTML, /has no report for this week/);
  assert.match(rootEl.innerHTML, /No report/);
  assert.doesNotMatch(rootEl.innerHTML, /class="v">0</);
  assert.doesNotMatch(rootEl.innerHTML, /class="funnel-value">0</);
});

test('Booking authenticated read refuses fixture fallback and does not use preview URLs', async () => {
  const rootEl = { innerHTML: '', setAttribute() {} };
  const context = {
    document: {
      addEventListener() {},
      getElementById: id => id === 'salesBookingRoot' ? rootEl : null
    },
    opsFetch: async action => {
      assert.equal(action, 'sales_booking_read');
      assert.equal(context.SALES_BOOKING_PREVIEW_URL, undefined);
      return { ok: false, error: 'Authenticated Booking handler is Patio-owned. 4174/4175 JSON preview is not connected.' };
    },
    opsPost: async () => { throw new Error('unexpected write'); }
  };
  context.window = context;
  vm.runInNewContext(bookingSource, context);
  await context.SalesBooking.load('nithin', '2026-09-14');
  assert.match(rootEl.innerHTML, /4174\/4175 JSON preview is not connected|Booking read was incomplete|Patio-owned/);
});
