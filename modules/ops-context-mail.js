/* Shared communications viewer. CIO canonical store only. Job first, then
   PO/invoice filter. Failed capture never complete. Opening sends nothing. */
(function (root) {
  'use strict';
  const VERSION = 'ops-context-mail/v2';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function coverageHonesty(coverage) {
    if (!coverage) return { complete: false, reason: 'coverage unread' };
    if (coverage.capture_failed || coverage.status === 'failed' || coverage.status === 'partial') {
      return { complete: false, reason: coverage.reason || 'capture failed or partial — not complete' };
    }
    if (coverage.has_more) return { complete: false, reason: 'has_more' };
    if (coverage.complete === true && coverage.capture_failed) return { complete: false, reason: 'failed capture cannot be complete' };
    return coverage;
  }

  function pendingHTML(kind, selection, extra) {
    const job = selection && (selection.job_number || selection.job_id);
    const po = selection && selection.po_number ? 'PO ' + selection.po_number : (selection && selection.po_id ? 'selected order' : 'whole job');
    const inv = selection && selection.invoice_id ? ' · invoice ' + selection.invoice_id : '';
    return `<section class="ops-context-mail" data-context-mail="${esc(kind)}" data-capability="pending">
      <h3>Original email history</h3>
      <p class="dp-small">One canonical store (CIO). Captured PO mail below is not that store. Inbox-only capture is not complete sent history.</p>
      <p class="dp-notice" role="status">${job ? 'Job ' + esc(job) + ' · ' + esc(po) + esc(inv) + '.' : 'Select a job to see all relevant history, then narrow to a PO/group if needed.'} ${esc(extra || 'Canonical reader unread. Absence is not proof of no email.')}</p>
    </section>`;
  }

  async function load(kind, selection) {
    const empty = { capability: 'pending', records: [], unresolved: [], attachments: [], coverage: { complete: false }, capture_cutoff: null, assessment_cutoff: null, stale_proposals: [] };
    if (!selection || !selection.job_id) {
      return { ...empty, reason: 'Select a job first. Dispatch email starts from the job, not a PO.' };
    }
    if (typeof root.opsFetch !== 'function') {
      return { ...empty, reason: 'Authenticated Ops read is not available.' };
    }
    try {
      const result = await root.opsFetch('job_communications', {
        job_id: selection.job_id,
        po_id: selection.po_id || '',
        invoice_id: selection.invoice_id || ''
      });
      if (!result || result.ok === false) {
        const pending = !result || result.capability === 'pending' || result.capability === 'unavailable';
        return {
          ...empty,
          capability: pending ? (result && result.capability) || 'pending' : 'failed',
          reason: (result && (result.error || result.reason)) || 'Canonical mail reader unread.',
          coverage: coverageHonesty(result && result.coverage)
        };
      }
      const coverage = coverageHonesty(result.coverage);
      if (coverage.complete && (result.capture_failed || result.status === 'failed')) {
        coverage.complete = false;
        coverage.reason = 'failed capture cannot be complete';
      }
      return {
        capability: 'connected',
        records: result.records || result.occurrences || result.messages || [],
        unresolved: result.unresolved || result.review_queue || [],
        coverage,
        capture_cutoff: result.capture_cutoff || result.source_cutoff || null,
        assessment_cutoff: result.assessment_cutoff || result.assessed_at || null,
        stale_proposals: result.stale_proposals || result.invalidated || [],
        ghl: result.ghl || null
      };
    } catch (error) {
      const pending = error && (error.status === 404 || /unknown|not connected|not available/i.test(String(error.message)));
      return { ...empty, capability: pending ? 'pending' : 'failed', reason: error && error.message, coverage: { complete: false, reason: 'read failed' } };
    }
  }

  async function openAttachment(item) {
    if (!item || !item.event_id || !item.store || !item.object_id) {
      return { ok: false, reason: 'attachment identity incomplete' };
    }
    if (typeof root.opsFetch !== 'function') return { ok: false, reason: 'Authenticated attachment read is not available.' };
    return root.opsFetch('message_attachment', {
      event_id: item.event_id,
      store: item.store,
      object_id: item.object_id
    });
  }

  async function correctLink(payload) {
    if (typeof root.opsPost !== 'function') return { ok: false, reason: 'Authenticated correction is not available.' };
    return root.opsPost('message_work_link_correct', payload);
  }

  function rowHTML(item) {
    const certainty = item.certainty || item.link_certainty || 'unread';
    const direction = item.direction || item.source || 'occurrence';
    const when = item.occurred_at || item.sent_at || item.received_at || '';
    const links = (item.links || []).map(link => `${esc(link.kind)} ${esc(link.target_id)} · ${esc(link.certainty || '')}`).join('; ');
    const atts = (item.attachments || []).map(att => `<button type="button" data-action="canonical-attachment" data-event="${esc(item.event_id || item.id)}" data-store="${esc(att.store || '')}" data-object="${esc(att.object_id || att.id || '')}">${esc(att.name || att.filename || 'attachment')}</button>`).join('');
    return `<article class="dp-email-result" data-action="canonical-mail" data-id="${esc(item.event_id || item.id)}">
      <strong>${esc(item.subject || 'Untitled message')}</strong>
      <small>${esc(direction)} · ${esc(item.from || item.sender || '')} → ${esc(item.to || item.recipient || '')} · ${esc(when)} · certainty ${esc(certainty)}</small>
      ${links ? `<p class="dp-small">Links: ${links}</p>` : ''}
      ${atts ? `<p class="dp-small">Attachments (object permission): ${atts}</p>` : ''}
    </article>`;
  }

  function render(kind, selection, state) {
    if (!state || state.capability !== 'connected') {
      return pendingHTML(kind, selection, state && state.reason);
    }
    const coverage = coverageHonesty(state.coverage);
    const coverLine = coverage.complete
      ? 'Canonical coverage complete for this selection.'
      : `Canonical coverage partial${coverage.reason ? ' · ' + coverage.reason : ''}.`;
    const cutoffs = `<p class="dp-small">Source check: ${esc(state.capture_cutoff || 'unread')} · Assessment: ${esc(state.assessment_cutoff || 'unread')}. New source after assessment needs reassessment.</p>`;
    const stale = (state.stale_proposals || []).length
      ? `<p class="dp-notice">New mail after a draft/proposal. Reassess before treating the earlier slot or message as current. Drafts are kept.</p>`
      : '';
    const unresolved = (state.unresolved || []).length
      ? `<p class="dp-notice">Review queue: ${(state.unresolved || []).length} uncertain or multi-job message(s). Link/unlink is auditable. Correction advances source version and does not erase drafts.</p>${(state.unresolved || []).map(item => `<button type="button" data-action="canonical-mail-correct" data-id="${esc(item.event_id || item.id)}">Correct link · ${esc(item.subject || item.event_id)}</button>`).join('')}`
      : '';
    const ghl = state.ghl
      ? `<p class="dp-small">GHL thread remains the SMS/chat channel. Email is additional history, not a replacement.</p>`
      : '';
    const rows = (state.records || []).map(rowHTML).join('')
      || '<p class="dp-small dp-muted">No canonical occurrences for this selection. Coverage may be partial.</p>';
    return `<section class="ops-context-mail" data-context-mail="${esc(kind)}" data-capability="connected" data-complete="${coverage.complete ? 'true' : 'false'}">
      <h3>Original email history</h3>
      <p class="dp-small">${coverLine} Whole-job history unless a PO/invoice filter is selected. Attachments use object permission, not only the parent job. Opening this viewer sends nothing.</p>
      ${cutoffs}${stale}${ghl}${unresolved}${rows}
    </section>`;
  }

  root.OpsContextMail = { version: VERSION, load, render, pendingHTML, openAttachment, correctLink, coverageHonesty };
})(typeof window !== 'undefined' ? window : globalThis);
