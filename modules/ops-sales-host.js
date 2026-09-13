/* Combined Ops host for Patio Booking and Fencing/Patio Performance.
   Copies owner modules; does not own their engines. Never wires 4174/4175
   JSON preview globals. Authenticated opsFetch/opsPost only. */
(function (root) {
  'use strict';
  const PREVIEW_KEYS = [
    'SALES_BOOKING_PREVIEW_URL',
    'SALES_BOOKING_PREVIEW_API',
    'SALES_BOOKING_PREVIEW_CONVERSATION_URL',
    'SALES_PERFORMANCE_PREVIEW_URL'
  ];
  const PERFORMANCE_UNPUBLISHED =
    'Sales Performance weekly table public.sales_performance_weeks is not deployed (production SELECT 2026-09-13 03:10:38 UTC). Empty is missing, not zero. Fencing owns the persisted feed.';
  const BOOKING_AUTH =
    'Booking uses the authenticated sales_booking_* workflow handler. 4174/4175 JSON preview is not connected. The reviewer listener on 4176 is not this host and is not written from here.';

  function stripPreviewGlobals() {
    const stripped = [];
    PREVIEW_KEYS.forEach(key => {
      if (root[key]) {
        stripped.push(key);
        try { delete root[key]; } catch (_) { root[key] = null; }
      }
      if (root.window && root.window[key]) {
        stripped.push('window.' + key);
        try { delete root.window[key]; } catch (_) { root.window[key] = null; }
      }
    });
    return stripped;
  }

  function notice(id, text) {
    let el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      return el;
    }
    el = document.createElement('p');
    el.id = id;
    el.className = 'dp-notice';
    el.setAttribute('role', 'status');
    el.textContent = text;
    return el;
  }

  function ensureNotices() {
    const sales = document.getElementById('viewSales');
    if (!sales) return;
    const bookingRoot = document.getElementById('salesBookingRoot');
    const performanceRoot = document.getElementById('salesPerformanceRoot');
    if (performanceRoot && !document.getElementById('salesPerformanceHostNotice')) {
      performanceRoot.parentNode.insertBefore(notice('salesPerformanceHostNotice', PERFORMANCE_UNPUBLISHED), performanceRoot);
    }
    if (bookingRoot && !document.getElementById('salesBookingHostNotice')) {
      bookingRoot.parentNode.insertBefore(notice('salesBookingHostNotice', BOOKING_AUTH), bookingRoot);
    }
  }

  function show(tab) {
    const stripped = stripPreviewGlobals();
    if (stripped.length) {
      const hostNotice = document.getElementById('salesBookingHostNotice');
      if (hostNotice) hostNotice.textContent = BOOKING_AUTH + ' Preview globals were removed: ' + stripped.join(', ') + '.';
    }
    ensureNotices();
    const selected = tab === 'performance' ? 'performance' : 'booking';
    const view = document.getElementById('viewSales');
    if (view) {
      view.classList.toggle('sales-sub-booking', selected === 'booking');
      view.classList.toggle('sales-sub-performance', selected === 'performance');
    }
    if (root.SalesBooking && typeof root.SalesBooking.show === 'function') {
      root.SalesBooking.show(selected);
      return;
    }
    if (selected === 'performance' && root.SalesPerformance && root.SalesPerformance.load) {
      root.SalesPerformance.load();
    }
  }

  root.OpsSalesHost = {
    show,
    stripPreviewGlobals,
    previewKeys: PREVIEW_KEYS
  };
})(typeof window !== 'undefined' ? window : globalThis);
