/* Shared communication viewer. Reads CIO canonical message links when the
   authenticated door exists. Does not create a second mailbox. Captured PO mail
   remains labelled captured PO mail. */
(function (root) {
  'use strict';
  const VERSION = 'ops-context-mail/v1';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function pendingHTML(kind, selection) {
    const target = selection && (selection.job_id || selection.po_id || selection.invoice_id)
      ? `Selected ${esc(selection.job_number || selection.job_id || 'work')} · ${selection.po_number ? 'PO ' + esc(selection.po_number) : 'no PO selected'}.`
      : 'No job, order or invoice is selected.';
    return `<section class="ops-context-mail" data-context-mail="${esc(kind)}" data-capability="pending">
      <h3>Original email history</h3>
      <p class="dp-small">Canonical messages live in CIO <code>record_context_mail_occurrence</code> / <code>read_message_work_links</code>. Dispatch captured PO mail is not that store.</p>
      <p class="dp-notice" role="status">Canonical mail reader is pending on the secured CIO overlay. ${target} Partial source coverage stays visible; absence is not proof of no email.</p>
    </section>`;
  }

  async function load(kind, selection) {
    if (!selection || !selection.event_id) {
      return { capability: 'pending', reason: 'No canonical event is linked to this selection yet.', records: [], coverage: { complete: false } };
    }
    if (typeof root.opsFetch !== 'function') {
      return { capability: 'pending', reason: 'Authenticated Ops read is not available.', records: [], coverage: { complete: false } };
    }
    try {
      const result = await root.opsFetch('message_work_links', {
        event_id: selection && selection.event_id || '',
        job_id: selection && selection.job_id || '',
        po_id: selection && selection.po_id || ''
      });
      if (!result || result.ok === false) {
        return {
          capability: result && result.capability === 'unavailable' ? 'unavailable' : 'pending',
          reason: (result && (result.error || result.reason)) || 'Canonical mail reader unread.',
          records: [],
          coverage: { complete: false }
        };
      }
      return {
        capability: 'connected',
        records: result.records || result.occurrences || [],
        coverage: result.coverage || { complete: false },
        unresolved: result.unresolved || []
      };
    } catch (error) {
      const status = error && error.status;
      const pending = status === 404 || /unknown|not connected|not available/i.test(String(error && error.message));
      return {
        capability: pending ? 'pending' : 'failed',
        reason: error && error.message || 'Canonical mail reader unread.',
        records: [],
        coverage: { complete: false }
      };
    }
  }

  function render(kind, selection, state) {
    if (!state || state.capability !== 'connected') {
      const extra = state && state.reason ? ` ${esc(state.reason)}` : '';
      return pendingHTML(kind, selection).replace('Partial source coverage stays visible; absence is not proof of no email.', 'Partial source coverage stays visible; absence is not proof of no email.' + extra);
    }
    const rows = (state.records || []).map(item => `<button type="button" class="dp-email-result" data-action="canonical-mail" data-id="${esc(item.event_id || item.id)}"><strong>${esc(item.subject || 'Untitled message')}</strong><small>${esc(item.direction || item.source || 'occurrence')} · ${esc(item.certainty || 'link certainty unread')}</small></button>`).join('')
      || '<p class="dp-small dp-muted">No canonical occurrences for this selection. Coverage may be partial.</p>';
    const unresolved = (state.unresolved || []).length
      ? `<p class="dp-notice">Unresolved routing: ${(state.unresolved || []).length} message(s) need a human link. Correction keeps this job and unsaved drafts.</p>`
      : '';
    return `<section class="ops-context-mail" data-context-mail="${esc(kind)}" data-capability="connected">
      <h3>Original email history</h3>
      <p class="dp-small">${state.coverage && state.coverage.complete ? 'Canonical coverage complete for this selection.' : 'Canonical coverage partial.'} Attachments use object permission, not only the parent job.</p>
      ${unresolved}${rows}
    </section>`;
  }

  root.OpsContextMail = { version: VERSION, load, render, pendingHTML };
})(typeof window !== 'undefined' ? window : globalThis);
