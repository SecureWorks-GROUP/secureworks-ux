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
  const initialBooking = JSON.stringify(root.SalesBooking.state);
  const initialPerformance = JSON.stringify(root.SalesPerformance.state);
  const identityKey = value => value && value.id && value.org_id ? JSON.stringify([value.org_id, value.id]) : null;
  let identity = identityKey(root.SW_AUTH_GATE?.identity());
  let generation = 0;
  let detailTrigger = null;

  function identityGuard() {
    const started = generation, actor = identity;
    return function () {
      if (!actor || started !== generation || actor !== identity || actor !== identityKey(root.SW_AUTH_GATE?.identity())) {
        const error = new Error('Sales auth identity changed; reload Sales before retrying.');
        error.code = 'sales_identity_changed';
        throw error;
      }
    };
  }

  function changeIdentity(event) {
    const next = identityKey(event.detail);
    if (next && next === identity) return;
    identity = next;
    generation++;
    const booking = root.SalesBooking.state, performance = root.SalesPerformance.state;
    Object.values(booking.drafts).forEach(draft => {
      draft.saveGeneration = (draft.saveGeneration || 0) + 1;
      draft.saveQueue = false;
      draft.savePending = false;
    });
    const request = booking.request + 1, conversationGeneration = booking.conversation.generation + 1;
    Object.assign(booking, JSON.parse(initialBooking), { request, subtab: booking.subtab });
    booking.conversation.generation = conversationGeneration;
    root.SalesBooking.selectCase(null);
    Object.assign(performance, JSON.parse(initialPerformance), { request: performance.request + 1 });
    detailTrigger = null;
    for (const id of ['salesBookingRoot', 'salesPerformanceRoot']) {
      const element = document.getElementById(id);
      if (element) { element.innerHTML = ''; element.setAttribute('aria-busy', 'false'); }
    }
  }

  function showPerformanceDetail(event) {
    if (!identity) return;
    const api = root.SalesPerformance, state = api.state, detail = event.detail || {};
    if (state.loading || state.error || !state.data || state.week !== detail.week_start) return;
    const spec = api.specs.find(item => item[0] === detail.measure);
    if (!spec || !['patio', 'fencing'].includes(detail.lane)) return;
    const host = document.getElementById('salesPerformanceNotes');
    if (!host) return;
    const row = state.data.rows.find(item => item.lane === detail.lane && item.week_start === state.week);
    const measure = api.adapt(row || { lane: detail.lane }).measures[detail.measure];
    const reason = !row ? 'No report is published for this lane and week. This measure and its evidence are unavailable.'
      : measure.value === null ? measure.sub
        : 'The stored measure is published, but its detailed evidence reader is not connected in this host.';
    const gaps = row?.coverage?.gaps || [];
    host.innerHTML = '<section class="notice" role="region" tabindex="-1" aria-labelledby="salesPerformanceDetailTitle">'
      + '<h2 id="salesPerformanceDetailTitle">' + api.escape((detail.lane === 'patio' ? 'Patio' : 'Fencing') + ' · ' + spec[1]) + '</h2>'
      + '<p>' + api.escape(reason) + '</p>'
      + (gaps.length ? '<ul>' + gaps.map(gap => '<li>' + api.escape(typeof gap === 'string' ? gap : JSON.stringify(gap)) + '</li>').join('') + '</ul>' : '')
      + '<button type="button" data-performance-detail-close>Close explanation</button></section>';
    detailTrigger = detail.trigger;
    host.firstElementChild?.focus();
  }

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
    if (!identity) return;
    identityGuard()();
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
    identityGuard,
    stripPreviewGlobals,
    previewKeys: PREVIEW_KEYS
  };
  root.addEventListener('sw:auth-identity', changeIdentity);
  root.addEventListener('sw:auth-locked', () => changeIdentity({ detail: null }));
  root.addEventListener('sw:auth-unlocked', () => {
    if (identity && document.getElementById('viewSales')?.classList.contains('active')) {
      show(document.getElementById('viewSales').classList.contains('sales-sub-performance') ? 'performance' : 'booking');
    }
  });
  document.addEventListener('sales-performance:drill', showPerformanceDetail);
  document.addEventListener('sales-performance:render', () => { detailTrigger = null; });
  document.addEventListener('click', event => {
    if (!event.target.closest?.('[data-performance-detail-close]')) return;
    const host = document.getElementById('salesPerformanceNotes');
    if (host) host.innerHTML = '';
    if (detailTrigger?.isConnected) detailTrigger.focus();
    detailTrigger = null;
  });
  if (!identity) changeIdentity({ detail: null });
})(typeof window !== 'undefined' ? window : globalThis);
