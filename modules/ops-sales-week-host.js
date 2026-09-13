/* Host board for the proposed sales week. Does not replace Patio Booking.
   Tentative overlays stay distinct from existing calendar. Unread leave is not free.
   Needs Scoper never auto-sends to the client. */
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let week = null;

  async function loadWeek() {
    if (week) return week;
    const res = await fetch('modules/nithin-week-proposals.json');
    if (!res.ok) throw new Error('Proposed week could not be read.');
    week = await res.json();
    return week;
  }

  function overlayHTML(data) {
    const leave = data.leave && data.leave.state !== 'complete'
      ? '<p class="dp-notice">Unread or incomplete leave is not free capacity.</p>' : '';
    const travel = data.travel && data.travel.state === 'unavailable'
      ? '<p class="dp-notice">Travel minutes unavailable. Geographic clusters are tentative only.</p>' : '';
    const holes = (data.capacity && data.capacity.holes || []).map(h => '<li>' + esc(h) + '</li>').join('');
    const existing = (data.existing_commitments || []).map(ev =>
      '<li data-kind="existing_calendar">' + esc(ev.date) + ' ' + esc(ev.start) + '–' + esc(ev.end) + ' ' + esc(ev.suburb) + ' · existing</li>'
    ).join('');
    const tentative = (data.tentative_placements || []).map(ev =>
      '<li data-kind="tentative" data-opportunity="' + esc(ev.opportunity_id) + '">' +
      esc(ev.start_iso) + ' ' + esc(ev.suburb) + ' · tentative · ' + esc((ev.holds || []).join(', ')) +
      '<p class="dp-small">' + esc(ev.draft) + '</p></li>'
    ).join('');
    const ns = (data.needs_scoper || []).map(item =>
      '<article data-needs-scoper="' + esc(item.item_id) + '"><strong>Needs Scoper</strong>' +
      '<p>' + esc(item.question) + '</p>' +
      '<p class="dp-small">status ' + esc(item.status) + ' · notify ' + esc(item.notify_state) +
      ' · client_send_approved=' + esc(item.client_send_approved) + '</p>' +
      (item.status === 'open' ? '<label>Answer<textarea data-ns-answer="' + esc(item.item_id) + '"></textarea></label>' +
        '<button type="button" data-ns-submit="' + esc(item.item_id) + '">Record scoper answer (held)</button>' : '') +
      '</article>'
    ).join('');
    return '<section class="sales-week-board" data-week="' + esc(data.week) + '">' +
      '<h3>Proposed week ' + esc(data.week) + ' · ' + esc(data.scoper && data.scoper.id) + '</h3>' +
      '<p class="dp-small">Send and calendar writes held. Tentative overlays are not Ready. Population ' +
      esc((data.eligible_accounted && data.eligible_accounted.isolated_nithin_opportunities) || 495) + ' opps / ' +
      esc((data.eligible_accounted && data.eligible_accounted.customers) || 476) + ' customers / ' +
      esc((data.eligible_accounted && data.eligible_accounted.eligible_unscoped) || 495) + ' eligible unscoped / ' +
      esc((data.eligible_accounted && data.eligible_accounted.waiting_reply) || 1) + ' waiting_reply. 495 opportunities are not 495 jobs. Queue hygiene e26c908e is 4180 author evidence only.</p>' +
      leave + travel +
      '<h4>Existing commitments</h4><ul>' + existing + '</ul>' +
      '<h4>Tentative placements</h4><ul>' + tentative + '</ul>' +
      '<h4>Remaining holes</h4><ul>' + holes + '</ul>' +
      ns + '</section>';
  }

  async function render() {
    const host = document.getElementById('salesWeekBoard');
    if (!host) return;
    try {
      const data = await loadWeek();
      host.innerHTML = overlayHTML(data);
    } catch (error) {
      host.innerHTML = '<p class="dp-notice" role="status">' + esc(error.message) + '</p>';
    }
  }

  async function answer(itemId, text) {
    if (typeof root.opsPost !== 'function') throw new Error('Authenticated Ops write is not available.');
    const result = await root.opsPost('sales_booking_needs_scoper_answer', {
      item_id: itemId,
      answer: text,
      apply_to_client_draft: true,
      fake: true
    });
    if (result && result.forwarded_to_client) throw new Error('Scoper answer must not auto-send to the client.');
    if (result && result.client_send && result.client_send !== 'held') throw new Error('Client send must stay held.');
    return result;
  }

  document.addEventListener('click', async event => {
    const btn = event.target && event.target.closest && event.target.closest('[data-ns-submit]');
    if (!btn) return;
    const id = btn.getAttribute('data-ns-submit');
    const ta = document.querySelector('[data-ns-answer="' + id + '"]');
    try {
      await answer(id, ta && ta.value);
      btn.textContent = 'Answer recorded (held)';
    } catch (error) {
      btn.textContent = error.message;
    }
  });

  root.OpsSalesWeekHost = { loadWeek, render, overlayHTML, answer };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
})(typeof window !== 'undefined' ? window : globalThis);
