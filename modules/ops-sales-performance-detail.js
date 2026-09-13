/* Evidence detail for the existing sales-performance:drill presentation seam. */
(function (global) {
  'use strict';
  let active = null;
  const json = value => JSON.stringify(value, null, 2);
  function evidence(detail) {
    const value = detail?.row?.queues?.[detail.queueKey];
    if (detail.lane === 'fencing' && detail.measure === 'C1') {
      if (!Array.isArray(value) || !value.length) {
        return {rows: [], available: false, scope: 'No document-evidenced send queue was retained. The follow-up stage queue is a different population and is opened from Quote follow-up, not from C1.'};
      }
    }
    if (!Array.isArray(value)) return {rows: [], available: false, scope: 'No named queue retained'};
    const period = detail.row.metrics?.period;
    const start = Date.parse(Array.isArray(period) ? period[0] : period?.since);
    const end = Date.parse(Array.isArray(period) ? period[1] : period?.until_exclusive);
    if (detail.queueKey === 'quote_followup_queue') {
      return {rows: value, available: true, scope: 'Open Following up Quote Sent stage. This is the current-stage follow-up queue, not C1 document-proven quote sends this week.'};
    }
    if (detail.lane === 'fencing' && detail.measure === 'C1' && detail.queueKey === 'quotes' && Number.isFinite(start) && Number.isFinite(end)) {
      const rows = value.filter(item => item.documents_read === true && item.quote_docs > 0 && item.sent_to_client === true && Date.parse(item.first_sent_at) >= start && Date.parse(item.first_sent_at) < end);
      return {rows, available: true, scope: 'Retained quotes with document evidence and first_sent_at inside the original report period. Not the follow-up stage queue.'};
    }
    return {rows: value, available: true, scope: 'Related retained collector queue; these records may use a different unit or population from the aggregate'};
  }
  function readableTime(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return 'Unknown';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    return new Intl.DateTimeFormat('en-AU', {timeZone: 'Australia/Perth', day: 'numeric', month: 'short', ...(dateOnly ? {} : {hour: 'numeric', minute: '2-digit', hour12: true})}).format(new Date(dateOnly ? value + 'T12:00:00+08:00' : value));
  }
  function sourceLabel(row) {
    if (row?.source_mode === 'collector_capture') {
      const partial = row.capture?.partial_week === true || row.capture?.period?.kind === 'partial';
      return 'Unpublished report · captured ' + readableTime(row.capture?.as_of) + ' · ' + (partial ? 'partial week' : row.capture?.partial_week === false || row.capture?.period?.kind === 'closed' ? 'closed week' : 'period status unknown');
    }
    return row ? 'Stored weekly report' : 'Report unavailable';
  }
  function close() { if (active) { const dialog = active; active = null; dialog.close(); dialog.remove(); } }
  function open(detail) {
    if (!global.document || !detail) return;
    close();
    const doc = global.document, row = detail.row, retained = evidence(detail);
    const el = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
    const dialog = el('dialog', undefined, 'sp-detail'); active = dialog;
    dialog.setAttribute('aria-labelledby', 'salesPerformanceDetailTitle');
    const heading = el('div', undefined, 'sp-detail-heading');
    const title = el('h2', (detail.lane || 'Lane') + ' · ' + (detail.label || detail.measure || 'Evidence')); title.id = 'salesPerformanceDetailTitle'; heading.append(title);
    const dismiss = el('button', 'Close'); dismiss.type = 'button'; dismiss.addEventListener('click', close); heading.append(dismiss); dialog.append(heading);
    dialog.append(el('p', sourceLabel(row) + ' · week of ' + detail.week_start, 'sp-detail-mode'));
    const metric = row && global.SalesPerformance?.adapt(row)?.measures?.[detail.measure];
    dialog.append(el('p', (typeof metric?.value === 'number' ? String(metric.value) : 'No reading') + ' · ' + (metric?.sub || 'Measure unavailable for this lane and week'), 'sp-detail-measure'));
    const provenance = row?.source_mode === 'collector_capture'
      ? 'Original collector evidence. Publication is not established; exact source and calculation details are retained below.'
      : 'Calculated ' + readableTime(row?.computed_at) + ' Perth. Exact report provenance is retained below.';
    dialog.append(el('p', provenance, 'sp-detail-muted'));
    const searchLabel = el('label', 'Filter retained evidence'); const search = el('input'); search.type = 'search'; search.placeholder = 'Name, reference or evidence text'; searchLabel.append(search); dialog.append(searchLabel);
    const count = el('p', '', 'sp-detail-muted'), list = el('div', undefined, 'sp-detail-list'), more = el('button', 'Show more retained rows'); more.type = 'button'; dialog.append(count, list, more);
    let limit = 25;
    function renderRows() {
      const query = search.value.trim().toLocaleLowerCase();
      const rows = retained.rows.filter(item => json(item).toLocaleLowerCase().includes(query));
      count.textContent = retained.available ? Math.min(rows.length, limit) + ' of ' + rows.length + ' matching retained rows · ' + retained.rows.length + ' in this queue. ' + retained.scope + '. Coverage limits still apply.' : 'Named evidence is unavailable for this measure. The displayed aggregate does not invent individual cases.';
      list.replaceChildren();
      rows.slice(0, limit).forEach((item, index) => {
        const card = el('article', undefined, 'sp-detail-row');
        const name = item && typeof item === 'object' ? item.name || item.contact_name || item.client_name || item.job_number || item.subject || item.id : null;
        card.append(el('h3', name ? String(name) : 'Retained evidence ' + (index + 1)));
        if (item && typeof item === 'object') card.append(el('p', [item.client, item.suburb, item.quote_status, item.first_sent_at ? 'First sent ' + readableTime(item.first_sent_at) + ' Perth' : null].filter(Boolean).join(' · '), 'sp-detail-muted'));
        const details = el('details'), summary = el('summary', 'Original retained record'), pre = el('pre', json(item)); details.append(summary, pre); card.append(details); list.append(card);
      });
      more.hidden = rows.length <= limit;
    }
    search.addEventListener('input', () => { limit = 25; renderRows(); });
    more.addEventListener('click', () => { limit += 25; renderRows(); });
    const coverage = el('details'), summary = el('summary', 'Original coverage, source and measure payload');
    coverage.append(summary, el('pre', json({storage: {computed_at: row?.computed_at ?? null, run_id: row?.run_id ?? null, definition_version: row?.definition_version ?? null}, coverage: row?.coverage ?? null, source: row?.capture ?? null, metrics: row?.metrics ?? null}))); dialog.append(coverage);
    dialog.addEventListener('close', () => { if (active === dialog) active = null; dialog.remove(); if (detail.trigger?.isConnected) detail.trigger.focus(); });
    doc.body.append(dialog); renderRows(); dialog.showModal(); search.focus();
  }
  if (global.document) {
    global.document.addEventListener('sales-performance:drill', event => open(event.detail));
    global.document.addEventListener('sales-performance:render', close);
    global.addEventListener('hashchange', close);
    global.addEventListener('sw:auth-identity', close);
    const cloud = global.SECUREWORKS_CLOUD;
    if (cloud?.on) { cloud.on('auth:logout', close); cloud.on('auth:login', close); }
  }
  const api = {open, close, evidence, sourceLabel, readableTime}; global.SalesPerformanceDetail = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
