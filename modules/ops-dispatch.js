/* Ops Dispatch workbench. Server records remain authoritative; execution is held. */
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const dateLabel = date => new Date(date + 'T12:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
  const label = value => String(value || 'unknown').replaceAll('_', ' ');
  const array = value => Array.isArray(value) ? value : [];
  const refLabel = ref => typeof ref === 'string' ? ref : ref?.label || ref?.id || 'Source unavailable';
  const safeLink = value => { if (typeof value !== 'string' || !value.trim()) return ''; try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? esc(url.href) : ''; } catch (_) { return ''; } };
  function supplyTotals(record, requirement) {
    const allocations = array(record.allocations).filter(a => a.requirement_id === requirement.id);
    const receipts = array(record.receipts).filter(r => allocations.some(a => a.id === r.allocation_id));
    const usable = receipts.filter(r => r.location === (requirement.destination || 'site')).reduce((sum, r) => sum + Number(r.usable_quantity || 0), 0);
    return { usable, remaining: requirement.quantity == null ? 'Unknown' : Math.max(0, requirement.quantity - usable) };
  }
  function supplyLabel(lot) {
    const source = lot.source_ref || {};
    return [lot.description || source.description || 'Description unrecorded',
      `${lot.quantity} ${lot.unit || 'Unit unverified'} recorded`,
      `Original location: ${source.location || lot.location || 'unrecorded'}`,
      `Original job: ${source.job_number || source.job_id || lot.job_id || 'unrecorded'}`,
      `PO: ${source.po_number || source.po_id || lot.po_id || 'unrecorded'}`].join(' · ');
  }
  function attachmentOptions(record, draft) {
    const options = new Map(array(draft?.attachments).map(item => [item.id, { ...item, unavailable: true }]));
    array(record.media).concat(array(record.documents)).forEach(item => options.set(item.id, { ...(options.get(item.id) || { id: item.id, name: item.name || item.file_name || item.title || item.type, source_ref: '', revision: '' }), unavailable: !item.url && !item.file_url && !item.pdf_url && !item.storage_url }));
    return [...options.values()];
  }
  function sameAttachments(left, right) {
    return left.length === right.length && left.every((item, index) => ['id', 'name', 'source_ref', 'revision'].every(field => item[field] === right[index][field]));
  }
  function plainMail(mail) {
    if (mail.body_text || mail.body) return mail.body_text || mail.body;
    if (mail.body_html) {
      const doc = new DOMParser().parseFromString(mail.body_html, 'text/html');
      doc.querySelectorAll('script,style,iframe,object,noscript').forEach(node => node.remove());
      doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
      doc.querySelectorAll('p,div,li,tr').forEach(node => node.append('\n'));
      const text = doc.body.textContent.trim();
      if (text) return text;
    }
    return mail.snippet || 'Original message body unavailable';
  }
  function structuredSource(value, sourcePath) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch (_) { return `<div class="dp-exact-review">${esc(value)}</div>`; } }
    if (!value || typeof value !== 'object') return `<p class="dp-small">${esc(value ?? 'Unavailable')}</p>`;
    return `<dl class="dp-source-fields">${Object.entries(value).map(([key, item]) => `<dt>${esc(label(key))}</dt><dd>${item && typeof item === 'object' ? `<details data-disclosure="${esc(JSON.stringify([...sourcePath, key]))}"><summary>${Array.isArray(item) ? item.length + ' recorded values' : 'Recorded details'}</summary>${structuredSource(item, [...sourcePath, key])}</details>` : esc(item ?? 'Unknown')}</dd>`).join('')}</dl>`;
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  const identityKey = value => value?.id && value?.org_id ? JSON.stringify([value.id, value.org_id]) : null;
  let shared, identity = identityKey(root.SW_AUTH_GATE?.identity?.()), identityGeneration = 0;
  const mounts = new Set();
  function identityGuard() {
    const generation = identityGeneration, owner = identity;
    return () => {
      if (!owner || generation !== identityGeneration || owner !== identityKey(root.SW_AUTH_GATE?.identity?.())) {
        const error = new Error('Dispatch identity changed. Sign in and read the current workspace.');
        error.code = 'dispatch_identity_changed';
        throw error;
      }
    };
  }
  function controller() {
    if (!shared) {
      const assertIdentity = identityGuard();
      assertIdentity();
      shared = root.DispatchCore.create({
        get: (action, params) => { assertIdentity(); return root.opsFetch(action, params, { assertIdentity }); },
        post: (action, body) => { assertIdentity(); return root.opsPost(action, body, { assertIdentity }); }
      });
    }
    return shared;
  }
  function calendarEventCoversDate(event, date) {
    if (event.layer === 'staff' && root.__SW_CAL_DRAGV2_ENABLED) {
      const end = root.CalOpsCore.spanEnd({ scheduled_date: event.date, scheduled_end: event.end_date });
      return root.CalOpsCore.paintedSpanDates(event.date, end).includes(date);
    }
    return event.date <= date && (event.end_date || event.date) >= date;
  }
  function calendarHTML(core, dates) {
    const { calendar, layers, selectedId } = core.state;
    if (core.state.calendarRange) dates = root.DispatchCore.week(new Date(core.state.calendarRange.from + 'T12:00:00Z'));
    return `<section class="dp-calendar" aria-label="Shared work calendar"><div class="dp-row"><strong class="dp-grow">${esc(dateLabel(dates[0]))} – ${esc(dateLabel(dates[6]))} · Perth</strong><button data-action="week-back" aria-label="Previous week">‹</button><button data-action="week-next" aria-label="Next week">›</button>${Object.keys(layers).map(layer => `<label><input type="checkbox" data-layer="${layer}" ${layers[layer] ? 'checked' : ''}>${label(layer)}</label>`).join('')}</div>
      ${calendar.error ? `<p class="dp-conflict">Calendar unavailable: ${esc(calendar.error)} <button data-action="refresh-calendar">Retry</button></p>` : ''}
      <div class="dp-days">${dates.map(date => `<div class="dp-day"><div class="dp-day-head">${esc(dateLabel(date))}</div><div class="dp-events">${array(calendar.events).filter(event => layers[event.layer] && calendarEventCoversDate(event, date)).map(event => `<button class="dp-event ${event.job_id === selectedId ? 'dp-selected-job' : ''}" data-layer="${esc(event.layer)}" data-action="event" data-job="${esc(event.job_id)}" data-id="${esc(event.id)}"><strong>${esc(event.job_number || '')}</strong>${esc(event.title)}<span>${esc(event.time || 'Date only')} · ${esc(label(event.status))}</span></button>`).join('') || '<span class="dp-event-unknown">No captured events</span>'}</div></div>`).join('')}</div>
      <p class="dp-small dp-muted" style="margin-top:7px">Shared source events · ${calendar.coverage?.complete ? 'Requested range captured' : 'Coverage unconfirmed / partial'} · ${array(calendar.undated).length} undated items. A proposed movement does not change the crew schedule.</p>
      ${array(calendar.undated).length ? `<details data-disclosure="undated"><summary class="dp-small">Undated requirements & movements</summary>${calendar.undated.map(event => `<button class="dp-email-result" data-action="event" data-job="${esc(event.job_id)}" data-id="${esc(event.id)}">${esc(event.job_number)} · ${esc(event.title)}</button>`).join('')}</details>` : ''}</section>`;
  }
  function mount(element, options = {}) {
    const core = options.core || controller();
    let dates = root.DispatchCore.week(options.now), queue = 'current', trade = 'all', query = '', workflow = 'all', tab = 'scope', selectedGroup = 'all';
    let form = null, contextJob = null, message = '', mailResults = null, mailGeneration = 0, selectedMail = null;
    const uiByJob = new Map(), formsByJob = new Map(), editorCustody = new Map();
    let focusOnLoad = null;
    const job = () => core.state.records.get(core.state.selectedId);
    const button = (action, text, attrs = '') => `<button data-action="${action}" ${attrs}>${text}</button>`;
    const busy = () => core.state.pending.get(core.state.selectedId)?.running;
    const evidenceCurrent = record => core.state.evidence.get(record.job.id)?.verified === true;
    const purchaseRequired = draft => !!draft.po_id || draft.purchase_commitment !== false;
    const supplyLots = record => [...new Map(array(record.supply_lots).concat(core.state.supply.lots).map(lot => [lot.id, lot])).values()];
    const unavailableOption = (rows, selected, name) => selected && !rows.some(row => row.id === selected) ? `<option value="${esc(selected)}" selected>Unavailable ${name}: ${esc(selected)} · choose a replacement</option>` : '';
    const normalizeToken = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    const historicalStates = new Set(['complete', 'completed', 'invoiced', 'final_payment', 'get_review']);
    const jobAccepted = job => job?.eligibility?.state === 'accepted';
    const jobHistorical = job => [job?.status, job?.substatus].some(value => historicalStates.has(normalizeToken(value)));
    const queueMatches = job => queue === 'historical' ? jobHistorical(job) : queue === 'acceptance-review' ? !jobAccepted(job) && !jobHistorical(job) : jobAccepted(job) && !jobHistorical(job);
    const coverageCount = (coverage, key) => Number.isFinite(coverage?.[key]) ? coverage[key] : null;
    const queueFooter = state => {
      const coverage = state.coverage || {};
      const universe = coverageCount(coverage, 'universe');
      const accepted = coverageCount(coverage, 'accepted');
      const unresolved = coverageCount(coverage, 'unresolved');
      const totals = universe !== null || accepted !== null || unresolved !== null
        ? `Universe ${universe ?? 'unreported'} · accepted ${accepted ?? 'unreported'} · unresolved ${unresolved ?? 'unreported'}`
        : 'Population totals unavailable · 2026-09-13 04:33:06Z census SNAPSHOT only, not live page counts';
      const coverageText = state.jobsLoading ? 'Reading remaining pages' : state.coverage?.complete ? 'Population scan complete' : 'Coverage incomplete';
      return `${totals} · ${state.jobs.length} rows on this read · ${coverageText}`;
    };
    const selectedRequirementIds = values => array(values.requirement_ids);
    const unresolvedRequirementIds = (record, values, reviewRequired) => selectedRequirementIds(values).filter(requirementId => {
      const requirement = array(record.requirements).find(item => item.id === requirementId);
      return !requirement || (reviewRequired && (requirement.reviewed_source_version !== record.source_version || !evidenceCurrent(record)));
    });
    const removableRequirementSelections = (record, values, reviewRequired) => unresolvedRequirementIds(record, values, reviewRequired).map(requirementId => {
      const requirement = array(record.requirements).find(item => item.id === requirementId);
      return `<div class="dp-source"><strong>${esc(requirement?.description || 'Previous selection unavailable')}</strong><p>${esc(requirement ? 'Selected requirement needs current review before it can be used.' : 'This selected requirement is no longer in the current source set.')}</p>${button('drop-requirement-selection', 'Remove from this draft', `data-id="${esc(requirementId)}"`)}</div>`;
    }).join('');
    let active = true, destroyed = false, refreshTimer = null, refreshing = null;
    const handlers = [];
    function listen(type, handler, capture) {
      const guarded = event => { if (!destroyed) return handler(event); };
      handlers.push([type, guarded, capture]); element.addEventListener(type, guarded, capture);
    }
    const visible = () => active && !destroyed && document.visibilityState !== 'hidden' && element.isConnected !== false && (!element.getClientRects || element.getClientRects().length > 0);
    function scheduleRefresh() {
      if (!root.setTimeout || !root.clearTimeout) return;
      root.clearTimeout(refreshTimer); refreshTimer = null;
      if (visible()) refreshTimer = root.setTimeout(refreshEvidence, options.refreshMs || 60000);
    }
    function refreshEvidence() {
      if (!visible()) { scheduleRefresh(); return Promise.resolve(); }
      if (refreshing) return refreshing;
      const id = core.state.selectedId;
      refreshing = Promise.all([...(id ? [core.load(id).catch(() => {}), core.execution(id)] : []), ...(currentUI().disclosures['assessment-status'] ? [core.tasks().catch(() => {})] : [])])
        .catch(error => { if (!destroyed) throw error; }).finally(() => { refreshing = null; scheduleRefresh(); });
      return refreshing;
    }
    function resumeRefresh() { if (visible()) return refreshEvidence(); scheduleRefresh(); }
    function currentUI() {
      const id = core.state.selectedId;
      if (!uiByJob.has(id)) uiByJob.set(id, { draftId: null, draftReview: null, mailSearch: { scope: 'job', search: '' }, disclosures: {}, focus: null });
      return uiByJob.get(id);
    }
    const binding = record => ({ base: { version: record.version, source_version: record.source_version }, snapshot: copy(record) });
    const matches = (custody, record) => custody?.base.version === record.version && custody?.base.source_version === record.source_version;
    function editorBinding(record, key, value) {
      if (!editorCustody.has(record.job.id)) editorCustody.set(record.job.id, new Map());
      const entries = editorCustody.get(record.job.id);
      if (!entries.has(key)) entries.set(key, { ...binding(record), value: copy(value) });
      return entries.get(key);
    }
    function reconciliationHTML(custody, record, key) {
      if (!custody || matches(custody, record)) return '';
      const fields = [...new Set([...Object.keys(custody.snapshot), ...Object.keys(record)])].filter(field => JSON.stringify(custody.snapshot[field]) !== JSON.stringify(record[field]));
      const changes = Object.fromEntries(fields.map(field => [field, { 'when editing began': custody.snapshot[field] ?? null, 'current evidence': record[field] ?? null }]));
      return `<div class="dp-conflict" role="alert">Evidence changed since this editor opened. Your values are retained; reconcile before saving.<details data-disclosure="reconcile:${esc(key)}"><summary>Review changed evidence</summary>${structuredSource(changes, ['reconcile', key])}${button('reconcile-editor', 'I reviewed changes · keep my edits', `data-id="${esc(key)}" ${evidenceCurrent(record) ? '' : 'disabled'}`)}</details></div>`;
    }
    function draftValue(record) {
      const key = `draft:${currentUI().draftId}`;
      const value = core.editor(record.job.id, key) || array(record.drafts).find(draft => draft.id === currentUI().draftId);
      if (!value) return;
      const custody = editorBinding(record, key, value);
      return core.editor(record.job.id, key) || custody.value;
    }
    function jobDrafts(record) {
      const drafts = new Map(array(record.drafts).map(draft => [draft.id, draft]));
      for (const [key, draft] of core.state.editors.get(record.job.id) || []) {
        if (key.startsWith('draft:')) drafts.set(draft.id, draft);
      }
      return [...drafts.values()];
    }
    function sourceHTML(record) {
      const sources = array(record.documents).concat(array(record.media));
      return `<h3>Scope & quote</h3><p class="dp-small dp-muted">Original evidence, before material decisions.</p>${record.job.scope_json ? `<details open class="dp-source" data-disclosure="scope"><summary>Stored job scope</summary>${structuredSource(record.job.scope_json, ['scope'])}</details>` : '<p class="dp-small dp-muted">Stored scope unavailable.</p>'}${record.job.pricing_json ? `<details class="dp-source" data-disclosure="pricing"><summary>Stored quote / pricing inputs</summary>${structuredSource(record.job.pricing_json, ['pricing'])}</details>` : '<p class="dp-small dp-muted">Stored pricing inputs unavailable.</p>'}${sources.length ? sources.map(source => `<div class="dp-source"><strong>${esc(source.name || source.file_name || source.title || source.type)}</strong><p>${esc(source.source || source.type)} · ${esc(source.revision || source.updated_at || 'Revision unknown')}</p><p>${source.accepted_at ? 'Accepted ' + esc(source.accepted_at) : 'Acceptance unverified'}${source.superseded_at ? ' · Superseded ' + esc(source.superseded_at) : ''}</p>${safeLink(source.url || source.file_url || source.pdf_url || source.storage_url) ? `<a href="${safeLink(source.url || source.file_url || source.pdf_url || source.storage_url)}" target="_blank" rel="noopener noreferrer">Open original</a>` : '<p>Original attachment unavailable</p>'}</div>`).join('') : '<div class="dp-source">No original document or media attachments were returned. Review available stored inputs and establish any missing source before treating requirements as complete.</div>'}
        <details class="dp-divider" data-disclosure="context"><summary>Current system context</summary>${array(record.context_facts).map(fact => `<div class="dp-source"><strong>${esc(fact.fact_type || fact.type || fact.kind)}</strong><p>${esc(fact.content || fact.summary || fact.fact_text || JSON.stringify(fact))}</p></div>`).join('') || '<p class="dp-small">No current context facts returned.</p>'}${button('review-context', 'Review current context evidence')}</details><details class="dp-divider" data-disclosure="coverage"><summary>Source coverage & review</summary><p class="dp-small">${esc(JSON.stringify(record.coverage || {}))}</p><p class="dp-small">Current source: ${esc(record.source_version)}<br>Reviewed source: ${esc(record.reviewed_source_version || 'Not reviewed')}</p></details>`;
    }
    function notesHTML(record) {
      const buffer = core.editor(record.job.id, 'note') || { id: core.uuid(), text: '' };
      if (!core.editor(record.job.id, 'note')) { core.edit(record.job.id, 'note', buffer); editorCustody.get(record.job.id)?.delete('note'); }
      const custody = editorBinding(record, 'note', buffer);
      return `<h3>Working notes</h3><p class="dp-small dp-muted">Scratch notes stay separate from requirements and orders.</p>${reconciliationHTML(custody, record, 'note')}<form data-form="note" class="dp-editor"><label>New working note<textarea name="text" data-editor="note">${esc(buffer.text)}</textarea></label>${button('save-note', 'Save working note', busy() ? 'disabled' : '')}</form>${array(record.notes).map(note => `<div class="dp-source"><p>${esc(note.text)}</p>${button('promote-note', 'Review as a requirement', `data-id="${esc(note.id)}"`)}</div>`).join('')}`;
    }
    function executionHTML(record, draft) {
      const execution = core.state.executions.get(record.job.id), capabilities = execution?.capabilities || {};
      const actions = array(execution?.actions).filter(action => action.draft_id === draft.id || action.approval_id === draft.approval?.id);
      const approval = draft.approval;
      const reviewCurrent = matches(editorBinding(record, `draft:${draft.id}`, draft), record) && evidenceCurrent(record) && draft.review?.content_hash === draft.content_hash && draft.review?.source_version === record.source_version;
      const approvalKey = `${draft.id}:${draft.content_hash}:${record.source_version}`;
      const checks = currentUI().approval?.key === approvalKey ? currentUI().approval : {};
      const approved = reviewCurrent && evidenceCurrent(record) && approval && approval.content_hash === draft.content_hash && approval.source_version === record.source_version && !core.editor(record.job.id, `draft:${draft.id}`);
      return `<div class="dp-divider"><h3>Communications approval & delivery</h3><p class="dp-authority">${capabilities.release_hold !== false ? 'Sending is held by the server. No provider contact is authorised.' : 'Release enabled; exact communications approval is still required.'}${draft.thread_id && !capabilities.captured_thread_send_available ? ' Captured-thread sending is not available on this transport.' : ''}</p>${execution?.uncertain ? '<p class="dp-conflict">The previous send outcome remains uncertain. Sending stays held until authoritative recovery establishes another attempt is safe.</p>' : ''}${execution?.error ? `<p class="dp-conflict">Status unavailable: ${esc(execution.error)}</p>` : ''}
        <form data-form="approval" class="dp-editor"><label><span><input type="checkbox" name="communications_approved" ${checks.communications_approved ? 'checked' : ''}>Approve this exact message and attachments</span></label>${purchaseRequired(draft) ? `<label><span><input type="checkbox" name="purchase_approved" ${checks.purchase_approved ? 'checked' : ''}>Separate purchase approval for this exact ${draft.po_id ? 'PO' : 'message'}</span></label>` : ''}<div class="dp-tools">${button('approve-draft', 'Record exact approval', !capabilities.approval_enabled || !reviewCurrent || core.editor(record.job.id, `draft:${draft.id}`) ? 'disabled' : '')}${button('execute-draft', capabilities.release_hold !== false ? 'Send held' : 'Send approved draft', capabilities.release_hold !== false || execution?.submitting || execution?.uncertain || execution?.coverage?.complete !== true || array(execution?.completedApprovals).includes(approval?.id) || !approved || (draft.thread_id && !capabilities.captured_thread_send_available) || actions.some(action => action.status !== 'held') ? 'disabled' : '')}${button('execution-status', 'Refresh action status')}</div></form>
        ${actions.map(action => `<div class="dp-source"><strong>${esc(label(action.status))}</strong><p>${action.status === 'accepted_not_delivered' ? 'Provider accepted the request; delivery is not established.' : action.status === 'outcome_unknown' ? 'Outcome uncertain. Read back the provider record before any recovery; no blind resend.' : 'Action state from the server.'}</p><details data-disclosure="receipt:${esc(action.id)}"><summary>Action receipt</summary><div class="dp-exact-review">${esc(JSON.stringify(action.receipt || {}, null, 2))}</div></details>${button('execution-readback', 'Read back provider receipt', `data-id="${esc(action.approval_id)}"`)}</div>`).join('')}
      </div>`;
    }
    function emailHTML(record) {
      const draft = draftValue(record), ui = currentUI();
      if (ui.draftReview) {
        const saved = array(record.drafts).find(item => item.id === ui.draftId);
        if (!draft || !matches(editorBinding(record, `draft:${ui.draftId}`, draft), record) || !evidenceCurrent(record) || !saved || saved.review?.content_hash !== saved.content_hash || saved.review?.source_version !== record.source_version || core.editor(record.job.id, `draft:${ui.draftId}`)) ui.draftReview = null;
      }
      const canonicalMail = root.OpsContextMail
        ? root.OpsContextMail.render('dispatch', { job_id: record.job.id, job_number: record.job.job_number, po_id: record.purchase_orders && record.purchase_orders[0] && record.purchase_orders[0].id, po_number: record.purchase_orders && record.purchase_orders[0] && (record.purchase_orders[0].po_number || record.purchase_orders[0].order_number) }, core.state.canonicalMail)
        : '<p class="dp-notice" role="status">Canonical mail reader pending. Captured PO mail below is not the company inbox.</p>';
      const history = `<details data-disclosure="history" ${draft ? '' : 'open'}><summary>History & past-job search</summary>${canonicalMail}<p class="dp-small dp-muted">Captured job/PO mail. This is not the canonical email store. Orders use the existing PO transport; Outlook-wide search is a separate, unverified capability.</p><form data-form="mail-search" class="dp-editor"><label>Search scope<select name="scope"><option value="job" ${ui.mailSearch.scope === 'job' ? 'selected' : ''}>This job</option><option value="all" ${ui.mailSearch.scope === 'all' ? 'selected' : ''}>Search all jobs</option></select></label><label>Search captured correspondence<input name="search" value="${esc(ui.mailSearch.search)}" placeholder="Supplier, job or subject"></label><button type="submit">Search</button></form>${array(record.communication_links).map(link => `<div class="dp-source"><strong>Linked past-job reference</strong><p>Original job ${esc(link.source_job_id)} · message ${esc(link.communication_id)}</p><p>${esc(link.reason)}</p>${button('open-linked-mail', 'Read original reference', `data-id="${esc(link.communication_id)}" data-job="${esc(link.source_job_id)}"`)}</div>`).join('')}${mailResults?.error ? `<p class="dp-conflict">${esc(mailResults.error)}</p>` : ''}${array(mailResults?.communications || record.communications).map(mail => `<button class="dp-email-result" data-action="mail" data-id="${esc(mail.id)}"><strong>${esc(mail.subject || 'Untitled message')}</strong><small>${esc(mail.source_job_number || mail.jobs?.job_number || mail.job_number || mail.job_id)} · ${esc(mail.sender || mail.from_email || mail.from || 'Sender unknown')} · ${esc(mail.source || 'Captured mail')}</small></button>`).join('')}<p class="dp-small dp-muted">${mailResults?.coverage?.complete ? 'Captured search range complete' : 'History coverage limited; absence is not proof of no email.'}</p>${mailResults?.next_cursor ? button('more-mail', 'Load more captured mail') : ''}</details>`;
      const viewed = selectedMail ? `<div class="dp-source"><strong>${esc(selectedMail.subject)}</strong><p>Original job ${esc(selectedMail.source_job_number || selectedMail.jobs?.job_number || selectedMail.job_number || selectedMail.job_id)} · ${esc(selectedMail.mailbox || selectedMail.mailbox_email || 'Mailbox unknown')}</p><div class="dp-exact-review">${esc(plainMail(selectedMail))}</div>${selectedMail.job_id !== record.job.id ? button('link-mail', 'Link as a reference — keep original job') : button('reply-mail', 'Prepare reply draft') }</div>` : '';
      if (!draft) return `<h3>Job email</h3><div class="dp-tools">${button('new-draft', 'Compose email', 'class="dp-primary"')}</div>${jobDrafts(record).map(item => `<button class="dp-email-result" data-action="open-draft" data-id="${esc(item.id)}">${esc(item.subject || 'Untitled draft')}<small>${core.editor(record.job.id, `draft:${item.id}`) ? 'Unsaved Dispatch edits · kept for this session' : 'Saved Dispatch draft'} · ${esc(item.status || 'not sent')}</small></button>`).join('')}<div class="dp-divider">${history}${viewed}</div>`;
      return `<div class="dp-row"><h3 class="dp-grow">Compose · ${esc(record.job.job_number)}</h3>${button('close-draft', 'History')}</div><p class="dp-small dp-muted">Dispatch draft · ${draft.po_id ? 'Linked PO' : 'Job correspondence'} · ${draft.thread_id ? 'Reply thread retained' : 'New conversation'}</p>${reconciliationHTML(editorBinding(record, `draft:${draft.id}`, draft), record, `draft:${draft.id}`)}<form data-form="draft" class="dp-editor">
        <label>Purchase authority<select name="purchase_commitment" data-editor="draft" ${draft.po_id ? 'disabled' : ''}><option value="true" ${purchaseRequired(draft) ? 'selected' : ''}>Requires separate purchase approval</option><option value="false" ${!purchaseRequired(draft) ? 'selected' : ''}>Does not commit to a purchase</option></select></label>${draft.po_id ? '<p class="dp-small">PO-linked correspondence always requires purchase authority.</p>' : ''}
        <label>Sender mailbox<input name="sender" data-editor="draft" value="${esc(draft.sender)}" required></label><label>To<input name="to" data-editor="draft" value="${esc(array(draft.to).join(', '))}" placeholder="supplier@example.com" required></label><label>CC<input name="cc" data-editor="draft" value="${esc(array(draft.cc).join(', '))}"></label><label>Subject<input name="subject" data-editor="draft" value="${esc(draft.subject)}" required></label><label>Exact message<textarea name="body" data-editor="draft" rows="9" required>${esc(draft.body)}</textarea></label><label>Proposed delivery time (Perth)<input type="datetime-local" name="proposed_delivery_at" data-editor="draft" value="${esc(draft.proposed_delivery_at || '')}"></label>
        <details data-disclosure="attachments:${esc(draft.id)}"><summary>Attachments (${array(draft.attachments).length})</summary>${attachmentOptions(record, draft).map(media => `<label><span><input type="checkbox" name="attachment" data-editor="draft" value="${esc(media.id)}" ${array(draft.attachments).some(a => a.id === media.id) ? 'checked' : ''}> ${esc(media.name || media.title)} · ${esc(media.revision || 'Revision unknown')}${media.unavailable ? ' · original unavailable' : ''}</span></label>`).join('') || '<p class="dp-small">No verified attachment available.</p>'}${array(draft.attachments).map(a => `<p class="dp-small">${esc(a.name)} · ${esc(a.revision)} · ${esc(refLabel(a.source_ref))}</p>`).join('')}</details><div class="dp-tools">${button('save-draft', 'Save Dispatch draft', busy() ? 'disabled' : '')}${button('review-draft', 'Review exact draft', `class="dp-primary" ${busy() ? 'disabled' : ''}`)}</div></form>
        <p class="dp-authority">Saving persists in Dispatch, not Outlook. Sending and purchase execution require separate exact approval.</p><div data-review>${ui.draftReview ? `<div class="dp-exact-review">${esc(ui.draftReview)}</div><p class="dp-saved">Exact draft reviewed and persisted. No message sent.</p>` : ''}</div>${executionHTML(record, draft)}<div class="dp-divider">${history}${viewed}</div>`;
    }
    function formHTML(record) {
      if (!form || form.jobId !== record.job.id) return '';
      const values = form.values;
      const transferReceipt = form.kind === 'transfer' ? array(record.receipts).find(receipt => receipt.id === values.id) : null;
      const lots = supplyLots(record);
      if (form.kind === 'requirement') return `<form class="dp-form" data-form="requirement"><h3>${form.noteId ? 'Review note as requirement' : 'Material requirement'}</h3><label>Description<input name="description" value="${esc(values.description)}" required></label><div class="dp-form-row"><label>Quantity (unknown stays blank)<input type="number" name="quantity" min="0" step="any" value="${esc(values.quantity)}"></label><label>Unit<input name="unit" value="${esc(values.unit)}"></label></div><label>Specification<input name="specification" value="${esc(values.specification)}"></label><div class="dp-form-row"><label>Phase<input name="phase" value="${esc(values.phase || 'installation')}"></label><label>Destination<input name="destination" value="${esc(values.destination || 'site')}"></label><label>Needed by<input type="date" name="needed_by" value="${esc(values.needed_by)}"></label><label>Owner<input name="owner" value="${esc(values.owner || 'Shaun')}"></label></div><label>Order group<select name="group_id">${unavailableOption(array(record.groups), values.group_id, 'group')}<option value="">Ungrouped</option>${array(record.groups).map(group => `<option value="${esc(group.id)}" ${values.group_id === group.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select></label>${array(record.allocations).some(a => a.requirement_id === values.id) ? `<label>Reason for any physical scope change<textarea name="reconciliation_reason">${esc(values.reconciliation_reason)}</textarea></label><p class="dp-small">Existing allocations and receipts remain in custody. A physical change needs explicit reconciliation and any applicable scope approval.</p>` : ''}<p class="dp-authority">Manual candidate. Scope/design changes require applicable approval; material review is separate from purchase approval.</p><div class="dp-tools"><button type="submit" class="dp-primary">Save candidate</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'order') return `<form class="dp-form" data-form="order"><h3>Prepare purchase order draft</h3><p class="dp-small">Creates a recoverable purchase-order draft. It does not approve a purchase or send to the supplier.</p><label>Supplier name<input name="supplier_name" value="${esc(values.supplier_name)}" required></label><label>Delivery destination<input name="delivery_address" value="${esc(values.delivery_address)}" required></label><label>Requested delivery date<input name="delivery_date" type="date" value="${esc(values.delivery_date)}"></label><p class="dp-small dp-muted" style="margin-top:10px">Choose reviewed requirements. Unknown prices remain incomplete.</p>${unresolvedRequirementIds(record, values, true).length ? '<p class="dp-conflict">A selected requirement is stale or unavailable. Remove it here or re-review it before preparing this order.</p>' : ''}${removableRequirementSelections(record, values, true)}${array(record.requirements).map(r => `<label><span><input type="checkbox" name="requirement_id" value="${esc(r.id)}" ${selectedRequirementIds(values).includes(r.id) ? 'checked' : ''} ${!evidenceCurrent(record) || r.reviewed_source_version !== record.source_version ? 'disabled' : ''}>${esc(r.description)} · ${esc(r.quantity ?? '?')} ${esc(r.unit)} · ${evidenceCurrent(record) && r.reviewed_source_version === record.source_version ? 'Reviewed' : 'Review first'}</span></label><div class="dp-form-row"><label>Quantity for this order (blank = uncovered)<input type="number" min="0.000001" step="any" name="quantity:${esc(r.id)}" value="${esc(values['quantity:' + r.id])}"></label><label>Unit price (unknown stays blank)<input type="number" min="0" step="any" name="price:${esc(r.id)}" value="${esc(values['price:' + r.id])}"></label></div>`).join('')}<label>Working order notes<textarea name="notes">${esc(values.notes)}</textarea></label><label><span><input type="checkbox" name="existing_supply_reviewed" ${values.existing_supply_reviewed ? 'checked' : ''} required>I checked linked orders and existing supply for duplication.</span></label><div class="dp-tools"><button type="submit" class="dp-primary">Save purchase order draft</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'stock') return `<form class="dp-form" data-form="stock"><h3>Record verified physical stock</h3><label>Description<input name="description" value="${esc(values.description)}" required></label><div class="dp-form-row"><label>Counted quantity<input name="quantity" type="number" min="0.000001" step="any" value="${esc(values.quantity)}" required></label><label>Physical unit<input name="unit" value="${esc(values.unit)}" required></label></div><label>Location<input name="location" value="${esc(values.location)}" required></label><label>Count / ownership evidence<textarea name="evidence" required>${esc(values.evidence)}</textarea></label><p class="dp-authority">An audited physical count. Existing supplier totals and invoices are not stock counts.</p><div class="dp-tools"><button type="submit">Save verified stock record</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'suitability') return `<form class="dp-form" data-form="suitability"><h3>Review allocation compatibility</h3><p class="dp-small">${esc(array(record.requirements).find(requirement => requirement.id === array(record.allocations).find(allocation => allocation.id === values.id)?.requirement_id)?.description || 'Requirement not identified')}</p><label>Reason for this compatibility review<textarea name="reason" required>${esc(values.reason)}</textarea></label><label>Evidence that this supply matches the physical requirement<textarea name="evidence" required>${esc(values.evidence)}</textarea></label><p class="dp-authority">Receipt and quantity do not establish compatibility. Record the evidence for the current physical specification.</p><div class="dp-tools"><button type="submit">Record compatibility evidence</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'allocation') return `<form class="dp-form" data-form="allocation"><h3>Allocate existing supply</h3><p class="dp-small">Cross-job ordered supply: ${core.state.supply.coverage.po ? 'captured' : 'partial / loading'} · Recorded stock: ${core.state.supply.coverage.stock ? 'captured' : 'partial / loading'}</p>${Object.values(core.state.supply.errors).filter(Boolean).map(error => `<p class="dp-conflict">${esc(error)}</p>`).join('')}<label>Requirement<select name="requirement_id" required>${unavailableOption(array(record.requirements), values.requirement_id, 'requirement')}<option value="">Choose a requirement</option>${array(record.requirements).map(r => `<option value="${esc(r.id)}" ${values.requirement_id === r.id ? 'selected' : ''}>${esc(r.description)} · ${esc(r.quantity ?? 'Unknown')} ${esc(r.unit)}</option>`).join('')}</select></label><label>Recorded supply lot<select name="supply_id" required>${unavailableOption(lots, values.supply_id, 'supply lot')}<option value="">Choose a linked supply lot</option>${lots.map(lot => `<option value="${esc(lot.id)}" ${values.supply_id === lot.id ? 'selected' : ''} ${!lot.unit ? 'disabled' : ''}>${esc(supplyLabel(lot))}</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="0.000001" step="any" value="${esc(values.quantity)}" required></label><p class="dp-authority">Server checks the remaining lot across all jobs. Allocation does not prove receipt.</p><div class="dp-tools"><button type="submit">Save allocation</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'receipt' || form.kind === 'transfer') return `<form class="dp-form" data-form="${form.kind}"><h3>${form.kind === 'transfer' ? 'Verify movement of existing receipt' : 'Verify received material'}</h3>${form.kind === 'receipt' ? `<label>Allocation<select name="allocation_id" required>${unavailableOption(array(record.allocations), values.allocation_id, 'allocation')}<option value="">Choose an allocation</option>${array(record.allocations).map(a => `<option value="${esc(a.id)}" ${values.allocation_id === a.id ? 'selected' : ''}>${esc(record.requirements.find(r => r.id === a.requirement_id)?.description)} · ${esc(a.quantity)} ${esc(a.unit)}</option>`).join('')}</select></label><div class="dp-form-row"><label>Usable quantity<input name="usable_quantity" type="number" min="0" step="any" value="${esc(values.usable_quantity)}" required></label><label>Damaged quantity<input name="damaged_quantity" type="number" min="0" step="any" value="${esc(values.damaged_quantity ?? 0)}" required></label></div>` : `<p class="dp-small">${esc(transferReceipt?.usable_quantity ?? 'Unknown')} recorded usable at ${esc(transferReceipt?.location || 'an unrecorded location')}</p><label>Usable quantity to transfer<input name="quantity" type="number" min="0" max="${esc(transferReceipt?.usable_quantity ?? 0)}" step="any" value="${esc(values.quantity)}" required></label>`}<label>${form.kind === 'transfer' ? 'New location' : 'Received location'}<input name="location" value="${esc(values.location)}" required placeholder="site, yard, or exact destination"></label><label>Evidence<textarea name="evidence" required placeholder="Delivery docket / inspection / dated source reference">${esc(values.evidence)}</textarea></label><p class="dp-authority">Record verified evidence only. This changes material custody, not a supplier order or crew booking.</p><div class="dp-tools"><button type="submit">Save verified custody</button>${button('cancel-form', 'Cancel')}</div></form>`;
      if (form.kind === 'movement') return `<form class="dp-form" data-form="movement"><h3>Plan material movement</h3>${unresolvedRequirementIds(record, values, false).length ? '<p class="dp-conflict">A selected requirement is unavailable. Remove it before saving this movement.</p>' : ''}${removableRequirementSelections(record, values, false)}${array(record.requirements).map(r => `<label><span><input type="checkbox" name="requirement_id" value="${esc(r.id)}" ${selectedRequirementIds(values).includes(r.id) ? 'checked' : ''}>${esc(r.description)}</span></label>`).join('')}<label>What needs moving<input name="title" required value="${esc(values.title)}"></label><label>From location<input name="from_location" required value="${esc(values.from_location)}"></label><label>To location<input name="to_location" required value="${esc(values.to_location)}"></label><div class="dp-form-row"><label>Date<input type="date" name="date" value="${esc(values.date)}"></label><label>Time (optional, Perth)<input type="time" name="time" value="${esc(values.time)}"></label></div><p class="dp-small">A proposal only. It does not confirm pickup, delivery or a crew change.</p><div class="dp-tools"><button type="submit">Save movement proposal</button>${button('cancel-form', 'Cancel')}</div></form>`;
      return `<form class="dp-form" data-form="group"><h3>${values.id ? 'Rename order group' : 'Your order group'}</h3><label>Name<input name="name" value="${esc(values.name)}" required autofocus></label><p class="dp-small">Grouping does not rewrite requirement identities or sent PO lines.</p><div class="dp-tools"><button type="submit">Save group</button>${button('cancel-form', 'Cancel')}</div></form>`;
    }
    function assessmentStatusHTML() {
      const tasks = core.state.tasks, ui = currentUI();
      const jobName = id => core.state.jobs.find(item => item.id === id)?.job_number || id;
      const rows = (items, sourceFailure) => items.map(item => `<div class="dp-source"><div class="dp-row">${button('select', esc(jobName(item.job_id)), `data-id="${esc(item.job_id)}"`)}<strong>${esc(label(item.status))}</strong>${button('prepare-assessment-retry', 'Retry assessment', `data-id="${esc(core.taskKey(item, sourceFailure))}" ${tasks.loading || !tasks.loaded ? 'disabled' : ''}`)}</div>${!sourceFailure ? `<p>Source ${esc(item.source_version)} · Plan ${esc(item.plan_version)}</p>` : '<p>Original job source read</p>'}${item.last_error ? `<p>${esc(item.last_error)}</p>` : ''}</div>`).join('');
      const coverage = (items, read) => `${items.length} captured · ${read.loading ? 'Reading' : read.complete ? 'Complete' : 'Coverage unknown / partial'}`;
      const retry = ui.assessmentRetry;
      const retryState = retry && core.state.taskRetries.get(core.taskKey(retry.task, retry.sourceFailure));
      return `<details class="dp-divider" data-disclosure="assessment-status"><summary>Assessment status / Needs attention</summary><p class="dp-small">Assessment recovery only. Messages and orders keep their separate approvals.</p><div class="dp-tools">${button('refresh-assessments', 'Refresh assessment status', tasks.loading ? 'disabled' : '')}${tasks.hasMore || tasks.sourceFailuresHasMore ? button('more-assessments', 'Load more assessment records', tasks.loading ? 'disabled' : '') : ''}</div>${tasks.error ? `<p class="dp-conflict">Assessment status unavailable: ${esc(tasks.error)}</p>` : ''}<h4>Job assessments</h4><p class="dp-small">${esc(coverage(tasks.items, tasks.read.items))}</p>${rows(tasks.items, false)}<h4>Source reads needing attention</h4><p class="dp-small">${esc(coverage(tasks.sourceFailures, tasks.read.sourceFailures))}</p>${rows(tasks.sourceFailures, true)}${retry ? `<form class="dp-editor" data-form="assessment-retry"><h4>Retry assessment · ${esc(jobName(retry.task.job_id))}</h4><label>Reason for retry<textarea name="reason" required>${esc(retry.reason)}</textarea></label><button type="submit" ${retryState?.running || retryState?.uncertain ? 'disabled' : ''}>Request assessment retry</button></form>` : ''}${ui.assessmentError ? `<p class="dp-conflict">${esc(ui.assessmentError)}</p>` : ''}${[...core.state.taskRetries.values()].map(attempt => { const result = attempt.result; return `<div class="dp-source"><strong>Assessment retry · ${esc(jobName(attempt.envelope.job_id))}</strong><p>Requested reason: ${esc(attempt.envelope.reason)}</p>${attempt.running ? '<p>Checking assessment retry…</p>' : ''}${attempt.error ? `<p class="dp-conflict">${esc(attempt.error)}</p>` : ''}${result ? `<p>${result.queued === undefined ? '' : `Queued: ${result.queued ? 'yes' : 'no'} · `}${result.retried === undefined ? '' : `Retried: ${result.retried ? 'yes' : 'no'} · `}Status: ${esc(label(result.task?.status || result.status || 'unreported'))}${result.reason ? ` · ${esc(label(result.reason))}` : ''}</p>${result.error ? `<p class="dp-conflict">${esc(result.error)}</p>` : ''}` : ''}${attempt.uncertain ? `<p>Retry outcome unconfirmed. The exact request is retained.</p>${button('recover-assessment-retry', 'Check same assessment retry request', `data-id="${esc(attempt.key)}" ${attempt.running ? 'disabled' : ''}`)}` : ''}</div>`; }).join('')}</details>`;
    }
    function workspaceHTML(record) {
      const groups = array(record.groups), requirements = array(record.requirements);
      const shown = requirements.filter(requirement => selectedGroup === 'all' || (selectedGroup === 'none' ? !requirement.group_id : requirement.group_id === selectedGroup));
      const stale = !evidenceCurrent(record) || record.reviewed_source_version !== record.source_version;
      return `<div class="dp-workhead"><div class="dp-row"><div class="dp-grow"><h2>${esc(record.job.job_number)} <span class="dp-muted">${esc(record.job.client_name)}</span></h2><p>${esc(record.job.site_address || 'Site address unavailable')} · ${esc(record.job.work_type || record.job.type || 'Work type unknown')}</p></div><span class="dp-tag ${record.job.eligibility?.state !== 'accepted' ? 'dp-tag-held' : ''}">${esc(label(record.job.eligibility?.state || 'Eligibility unresolved'))}</span></div><p>${stale ? 'Requirements review incomplete or sources changed' : 'Current source set reviewed'} · Version ${record.version}</p></div>${calendarHTML(core, dates)}
        <div class="dp-pad"><div class="dp-row"><h3 class="dp-grow">Order groups</h3>${button('add-group', '+ Your group')}</div><p class="dp-small dp-muted">Organise the work in your own terms. Every requirement stays attached to this job.</p><div class="dp-group-list"><button class="dp-group" data-action="group" data-id="all" aria-pressed="${selectedGroup === 'all'}">All requirements<span>${requirements.length} recorded · completeness separate</span></button>${groups.map(group => `<button class="dp-group" data-action="group" data-id="${esc(group.id)}" aria-pressed="${selectedGroup === group.id}">${esc(group.name)}<span>${requirements.filter(r => r.group_id === group.id).length} requirements</span></button>`).join('')}<button class="dp-group" data-action="group" data-id="none" aria-pressed="${selectedGroup === 'none'}">Ungrouped<span>${requirements.filter(r => !r.group_id).length} requirements</span></button></div>
        <div class="dp-tools">${button('add-requirement', '+ Requirement')}${button('review-set', 'Review complete source set')}${groups.some(g => g.id === selectedGroup) ? button('rename-group', 'Rename group') + button('delete-group', 'Remove group · keep requirements') : ''}</div>${form ? reconciliationHTML(form.custody, record, 'form') : ''}${formHTML(record)}
        <div class="dp-tablewrap"><table><thead><tr><th>Requirement / source</th><th>Required</th><th>Group</th><th>Supply & destination</th><th>Review</th></tr></thead><tbody>${shown.map(requirement => `<tr data-requirement="${esc(requirement.id)}"><td><strong>${esc(requirement.description)}</strong><small>${esc(requirement.specification || 'Specification unresolved')}</small><small>${esc(refLabel(requirement.source_ref))}</small></td><td>${requirement.quantity == null ? 'Unknown' : esc(requirement.quantity)} ${esc(requirement.unit)}</td><td><select data-move="${esc(requirement.id)}" aria-label="Group for ${esc(requirement.description)}">${unavailableOption(groups, requirement.group_id, 'group')}<option value="">Ungrouped</option>${groups.map(group => `<option value="${esc(group.id)}" ${requirement.group_id === group.id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select></td><td>${esc(supplyTotals(record, requirement).usable)} recorded usable<small>${esc(supplyTotals(record, requirement).remaining)} remaining</small><small>${esc(requirement.destination || 'Destination unresolved')}</small></td><td>${esc(evidenceCurrent(record) && requirement.reviewed_source_version === record.source_version ? 'Reviewed' : 'Candidate / stale')}<div class="dp-tools">${button('edit-requirement', 'Edit', `data-id="${esc(requirement.id)}"`)}${button('review-requirement', 'Review', `data-id="${esc(requirement.id)}"`)}</div></td></tr>`).join('') || '<tr><td colspan="5">No requirements recorded in this group. This does not establish that materials are complete.</td></tr>'}</tbody></table></div>
        <div class="dp-divider"><div class="dp-row"><h3 class="dp-grow">Purchase orders & movements</h3>${button('prepare-order', 'Prepare purchase order')}${button('add-movement', '+ Movement')}</div>${array(record.purchase_orders).map(po => `<button class="dp-po" data-action="po" data-id="${esc(po.id)}"><strong>${esc(po.po_number || po.order_number || po.id)} · ${esc(po.supplier_name || po.supplier || 'Supplier unknown')}</strong><span>${esc(label(po.status))} · ${esc(po.delivery_date || 'Delivery unconfirmed')} · ${esc(po.delivery_address || 'Destination unknown')}</span>${array(po.items || po.line_items).map(line => `<span>${esc(line.description)} · ${esc(line.quantity ?? '?')} ${esc(line.unit)}</span>`).join('')}</button>`).join('') || '<p class="dp-small dp-muted">No linked purchase orders returned. Check requirements and reusable supply before preparing a new order.</p>'}${array(record.order_drafts).map(order => `<div class="dp-tools">${button('edit-order', 'Edit saved purchase order draft', `data-id="${esc(order.id)}"`)}</div>`).join('')}${array(record.movements).map(move => `<div class="dp-source"><strong>${esc(move.title)}</strong><p>${esc(move.from_location)} → ${esc(move.to_location)} · ${esc(move.date || 'Undated')} ${esc(move.time)} · ${esc(label(move.status || 'proposed'))}</p></div>`).join('')}<details class="dp-divider" data-disclosure="allocations"><summary>Allocations & receipts</summary><div class="dp-tools">${button('add-allocation', 'Allocate supply')}${button('record-stock', 'Record verified stock')}${button('add-receipt', 'Verify receipt')}</div><p class="dp-small">Usable quantity must be verified at its destination. Paid, ordered, acknowledged and received are different facts; the same stock cannot fulfil two jobs.</p>${array(record.allocations).map(item => `<div class="dp-source"><strong>${esc(record.requirements.find(r => r.id === item.requirement_id)?.description)}</strong><p>${esc(item.quantity)} ${esc(item.unit)} allocated · ${esc(item.supply_id)}</p><p>Compatibility: ${evidenceCurrent(record) && ['current', 'stale'].includes(item.suitability_status) ? esc(item.suitability_status) : 'unknown / unavailable'}</p>${item.suitability_obligation && typeof item.suitability_obligation === 'object' ? `<p>Owner: ${esc(item.suitability_obligation.owner || 'unavailable')}</p><p>Next action: ${esc(item.suitability_obligation.next_action || 'unavailable')}</p>` : ''}${button('review-allocation', 'Review compatibility evidence', `data-id="${esc(item.id)}"`)}${button('delete-allocation', 'Release unreceived allocation', `data-id="${esc(item.id)}"`)}</div>`).join('')}${array(record.receipts).map(item => `<div class="dp-source"><strong>${esc(array(record.requirements).find(requirement => requirement.id === array(record.allocations).find(allocation => allocation.id === item.allocation_id)?.requirement_id)?.description || 'Requirement not identified')}</strong><p>${esc(item.usable_quantity)} usable · ${esc(item.damaged_quantity)} damaged · ${esc(item.location)}</p><p>${esc(item.evidence)}</p>${button('transfer-receipt', 'Verify transfer', `data-id="${esc(item.id)}"`)}</div>`).join('') || '<p class="dp-small">No verified receipt returned.</p>'}</details></div></div>
        <section class="dp-assessment"><div class="dp-row"><h3 class="dp-grow">Next action assessment</h3>${button('assess', 'Assess current evidence', busy() ? 'disabled' : '')}</div>${record.assessment ? `<p>${esc(record.assessment.summary || record.assessment.next_action || 'Assessment recorded')}</p><ul>${array(record.assessment.obligations || record.assessment.findings || record.assessment.blockers).map(finding => `<li>${esc(typeof finding === 'string' ? finding : finding.next_action || finding.message || finding.description)} ${esc(finding.owner || '')}</li>`).join('')}</ul><p class="dp-small">Source ${esc(record.assessment.source_version)} ${record.assessment.stale || record.assessment.source_version !== record.source_version ? '· Stale — reassess current evidence' : ''}</p>` : '<p>Reconcile requirements, linked supply and movements against the current source set.</p>'}${assessmentStatusHTML()}</section>`;
    }
    function captureFocus(focused) {
      return element.contains(focused) && (focused.name || focused.dataset.filter || focused.dataset.move || focused.dataset.layer) ? { name: focused.name, form: focused.form?.dataset.form, data: { ...focused.dataset }, type: focused.type, value: focused.value, jobId: contextJob, draftId: uiByJob.get(contextJob)?.draftId, start: focused.selectionStart, end: focused.selectionEnd } : null;
    }
    listen('focusout', event => {
      if (destroyed) return;
      const focus = captureFocus(event.target);
      if (focus?.form && contextJob) uiByJob.get(contextJob).focus = focus;
    });
    function render() {
      if (destroyed) return;
      const liveFocus = captureFocus(document.activeElement);
      if (contextJob) {
        const previous = uiByJob.get(contextJob);
        element.querySelectorAll('details[data-disclosure]').forEach(detail => { previous.disclosures[detail.dataset.disclosure] = detail.open; });
        if (liveFocus?.form) previous.focus = liveFocus;
      }
      const changedJob = contextJob !== core.state.selectedId;
      const state = core.state, record = job();
      if (contextJob !== state.selectedId) { if (form && contextJob) formsByJob.set(contextJob, form); contextJob = state.selectedId; selectedGroup = 'all'; form = formsByJob.get(contextJob) || null; selectedMail = null; mailResults = null; mailGeneration++; message = ''; }
      if (changedJob) focusOnLoad = currentUI().focus;
      const focus = liveFocus?.jobId === state.selectedId ? liveFocus : focusOnLoad;
      const queueJobs = state.jobs.filter(queueMatches);
      const jobs = root.DispatchCore.filteredJobs(queueJobs, { trade, query, workflow });
      const actions = [...new Set(state.jobs.map(item => item.next_action).filter(Boolean).concat(workflow === 'all' ? [] : [workflow]))];
      const types = new Map(state.jobs.filter(item => String(item.work_type || '').trim()).map(item => [String(item.work_type).trim().toLowerCase().replace(/\s+/g, ' '), String(item.work_type).trim()]));
      if (trade !== 'all' && !types.has(trade)) types.set(trade, trade);
      const evidence = state.evidence.get(state.selectedId);
      const evidenceStamp = evidence?.lastSuccessAt ? `Last evidence read: ${new Date(evidence.lastSuccessAt).toLocaleString('en-AU', { timeZone: 'Australia/Perth' })} Perth` : 'Evidence has not been read successfully';
      const evidenceStatus = evidence?.error ? `Refresh failed: ${evidence.error} · Current review and approval unconfirmed` : evidence?.loading ? 'Refreshing evidence…' : evidence?.verified ? 'Evidence read successfully' : 'Current evidence unconfirmed';
      const pending = state.pending.get(state.selectedId), error = state.errors.get(state.selectedId);
      element.classList.add('dispatch-app');
      element.innerHTML = `<header class="dp-header"><div class="dp-row"><div><h1>Dispatch</h1><p>Materials ready for work · accepted work, order groups and movement</p></div>${root.OpsHowItWorks ? root.OpsHowItWorks.iconButton('dispatch') : ''}</div><div class="dp-tools">${button('choose-job', 'Choose job', 'class="dp-mobile-only"')}${button('refresh', 'Refresh evidence')}${root.OpsWorkflowRefresh ? root.OpsWorkflowRefresh.html('dispatch', core.state.workflowRefresh) : ''}</div></header><div class="dp-layout"><aside class="dp-panel dp-queue"><div class="dp-pad"><h3>Dispatch material queue</h3><p class="dp-small dp-muted">Current material shows acceptance-evidenced work that is not complete, invoiced, final payment or review-collection history.</p><div class="dp-trades">${[['current', 'Current material'], ['acceptance-review', 'Acceptance review'], ['historical', 'Historical']].map(([value, name]) => `<button data-action="queue" data-id="${esc(value)}" aria-pressed="${queue === value}">${esc(name)}</button>`).join('')}</div><div class="dp-trades">${[['all', 'All work types'], ...types].map(([value, name]) => `<button data-action="trade" data-id="${esc(value)}" aria-pressed="${trade === value}">${esc(name)}</button>`).join('')}</div><input class="dp-search" data-filter="search" aria-label="Search Dispatch material queue" value="${esc(query)}" placeholder="Job, customer or address"><select class="dp-filter" data-filter="workflow" aria-label="Next action"><option value="all">All next actions</option>${actions.map(value => `<option value="${esc(value)}" ${workflow === value ? 'selected' : ''}>${esc(label(value))}</option>`).join('')}</select></div><div class="dp-job-list">${jobs.map(item => `<button class="dp-job" data-action="select" data-id="${esc(item.id)}" aria-pressed="${item.id === state.selectedId}"><span>${esc(item.job_number)} · ${esc(item.work_type)}</span><strong>${esc(item.client_name || 'Customer unavailable')}</strong><span>${esc(item.site_address)}</span><span>${esc(label(item.next_action || 'Needs assessment'))}</span></button>`).join('') || `<div class="dp-pad dp-muted">${state.jobsLoading ? 'Reading Dispatch work…' : 'No matching captured jobs in this queue.'}</div>`}</div><div class="dp-footer">${esc(queueFooter(state))}${state.error ? `<p class="dp-conflict">${esc(state.error)}</p>` : ''}</div></aside><main class="dp-panel dp-workspace"><p class="dp-notice" role="status">${esc(evidenceStamp)} · ${esc(evidenceStatus)}</p>${state.selectedId && !jobs.some(item => item.id === state.selectedId) ? `<div class="dp-notice">Selected job is outside this filter. ${button('reset-filters', 'Show selected job · reset filters')}</div>` : ''}${error ? `<div class="dp-notice dp-error" role="alert">${esc(error)} ${!pending ? button('reload-job', 'Retry job') : ''}</div>` : ''}${pending && !pending.running ? `<div class="dp-notice dp-error" role="alert">${pending.conflict ? 'Saved sources changed. Reload and review before saving again.' : 'The previous save outcome is unconfirmed. Its exact request remains available for recovery.'} ${button(pending.conflict ? 'resolve-conflict' : 'retry-write', pending.conflict ? 'Reload changed evidence — keep edits' : 'Retry same request')}</div>` : ''}${pending?.running ? '<p class="dp-notice" role="status">Saving and checking this job…</p>' : ''}${message ? `<p class="dp-notice" role="status">${esc(message)}</p>` : ''}${record ? workspaceHTML(record) : `<div class="dp-blank">${state.selectedId ? 'Reading job evidence…' : 'Choose captured work to establish its material requirements.'}</div>${assessmentStatusHTML()}`}</main><aside class="dp-panel dp-context"><div class="dp-tabs" role="tablist" aria-label="Job context">${['scope', 'notes', 'email'].map(value => `<button role="tab" data-action="tab" data-id="${value}" aria-selected="${tab === value}">${{ scope: 'Scope & quote', notes: 'Working notes', email: 'Email' }[value]}</button>`).join('')}</div><div class="dp-pad">${record ? tab === 'scope' ? sourceHTML(record) : tab === 'notes' ? notesHTML(record) : emailHTML(record) : '<p class="dp-muted">Job context appears here.</p>'}</div></aside></div>`;
      element.querySelectorAll('details[data-disclosure]').forEach(detail => { if (Object.hasOwn(currentUI().disclosures, detail.dataset.disclosure)) detail.open = currentUI().disclosures[detail.dataset.disclosure]; });
      if (focus && focus.jobId === state.selectedId && (!['draft', 'approval'].includes(focus.form) || focus.draftId === currentUI().draftId)) {
        const input = [...element.querySelectorAll('[name],[data-filter],[data-move],[data-layer]')].find(node => node.name === focus.name && node.form?.dataset.form === focus.form && Object.entries(focus.data).every(([key, value]) => node.dataset[key] === value) && (!['checkbox', 'radio'].includes(focus.type) || node.value === focus.value));
        input?.focus({ preventScroll: true });
        if (input) focusOnLoad = null;
        try { input?.setSelectionRange(focus.start, focus.end); } catch (_) {}
      }
    }
    function captureDraft(formElement, record) {
      const current = draftValue(record), data = new FormData(formElement);
      const emails = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
      const selected = data.getAll('attachment');
      const value = { ...current, purchase_commitment: !!current.po_id || data.get('purchase_commitment') !== 'false', sender: data.get('sender'), to: emails(data.get('to')), cc: emails(data.get('cc')), subject: data.get('subject'), body: data.get('body'), proposed_delivery_at: data.get('proposed_delivery_at') || null,
        attachments: attachmentOptions(record, current).filter(media => selected.includes(media.id)).map(media => ({ id: media.id, name: media.name || media.title, source_ref: typeof media.source_ref === 'string' ? media.source_ref : media.id, revision: media.revision || media.updated_at || '' })) };
      core.edit(record.job.id, `draft:${value.id}`, value); currentUI().draftReview = null; currentUI().approval = null;
      element.querySelectorAll('[data-action="approve-draft"],[data-action="execute-draft"]').forEach(button => { button.disabled = true; });
      const review = element.querySelector('[data-review]'); if (review) review.innerHTML = '<p class="dp-small dp-muted">Content changed; review required.</p>';
      return value;
    }
    function newDraft(record, extra = {}) {
      const id = core.uuid(); currentUI().draftId = id; currentUI().draftReview = null;
      core.edit(record.job.id, `draft:${id}`, { id, sender: '', to: [], cc: [], subject: `Materials · ${record.job.job_number}`, body: '', attachments: [], purchase_commitment: true, ...extra }); tab = 'email'; render();
      element.querySelector('[data-form="draft"] input')?.focus();
    }
    async function save(command, payload, id = core.state.selectedId, base) { if (destroyed) throw new Error('Dispatch workspace closed.'); const result = await core.command(id, command, payload, 'dispatch_command', base); if (['movement_upsert', 'order_prepare'].includes(command)) { const range = core.state.calendarRange || { from: dates[0], to: dates[6] }; await core.calendar(range.from, range.to); } return result; }
    async function searchMail(params, append = false) {
      const generation = ++mailGeneration, id = core.state.selectedId;
      try { const result = await core.communications({ job_id: id, ...params }); if (generation === mailGeneration && id === core.state.selectedId) { mailResults = { ...result, communications: [...(append ? array(mailResults?.communications) : []), ...array(result.records || result.communications)], params }; render(); } }
      catch (error) { if (generation === mailGeneration) { mailResults = { error: error.message }; render(); } }
    }
    listen('toggle', event => {
      if (destroyed || !element.contains(event.target) || !event.target.dataset.disclosure) return;
      currentUI().disclosures[event.target.dataset.disclosure] = event.target.open;
      if (event.target.dataset.disclosure === 'assessment-status' && event.target.open && !core.state.tasks.loaded && !core.state.tasks.loading && !core.state.tasks.error) core.tasks().catch(() => {});
    }, true);
    listen('input', event => {
      const target = event.target, record = job();
      if (target.dataset.filter === 'search') { query = target.value; const start = target.selectionStart; render(); const input = element.querySelector('[data-filter="search"]'); input.focus(); input.setSelectionRange(start, start); }
      if (target.dataset.editor === 'draft' && record) captureDraft(target.form, record);
      if (target.dataset.editor === 'note' && record) { const note = core.editor(record.job.id, 'note'); core.edit(record.job.id, 'note', { ...note, text: target.value }); }
      const kind = target.closest('[data-form]')?.dataset.form;
      if (kind === 'assessment-retry' && currentUI().assessmentRetry) currentUI().assessmentRetry.reason = new FormData(target.form).get('reason');
      if (kind === 'mail-search') currentUI().mailSearch = Object.fromEntries(new FormData(target.form));
      if (kind === 'approval' && record) {
        const draft = draftValue(record), data = new FormData(target.form);
        currentUI().approval = { key: `${draft.id}:${draft.content_hash}:${record.source_version}`, communications_approved: data.has('communications_approved'), purchase_approved: data.has('purchase_approved') };
      }
      if (target.closest('[data-form]')?.dataset.form === form?.kind && form && !target.dataset.editor) {
        const data = new FormData(target.closest('form'));
        const retainedIds = selectedRequirementIds(form.values);
        Object.assign(form.values, Object.fromEntries(data));
        if (form.kind === 'order' || form.kind === 'movement') {
          if (target.name === 'requirement_id' && !target.disabled) {
            const selected = new Set(retainedIds);
            if (target.checked) selected.add(target.value); else selected.delete(target.value);
            form.values.requirement_ids = [...selected];
          } else {
            form.values.requirement_ids = retainedIds;
          }
        }
        if (form.kind === 'order') form.values.existing_supply_reviewed = data.has('existing_supply_reviewed');
      }
    });
    listen('change', async event => {
      try {
        const target = event.target;
        if (target.dataset.editor === 'draft' && target.name === 'purchase_commitment' && job()) { captureDraft(target.form, job()); render(); }
        if (target.dataset.layer) core.setLayer(target.dataset.layer, target.checked);
        if (target.dataset.filter === 'workflow') { workflow = target.value; render(); }
        if (target.dataset.move) await save('requirement_move', { id: target.dataset.move, group_id: target.value || null });
      } catch (error) { message = error.message; render(); }
    });
    listen('submit', async event => {
      event.preventDefault(); const type = event.target.dataset.form, record = job();
      const id = record?.job.id, data = Object.fromEntries(new FormData(event.target));
      if (type === 'assessment-retry') {
        const ui = currentUI(), retry = ui.assessmentRetry;
        ui.assessmentError = null;
        try {
          if (!retry) throw new Error('Choose an assessment to retry.');
          await core.retryTask(retry.task, data.reason, { sourceFailure: retry.sourceFailure });
        } catch (error) { ui.assessmentError = error.message; }
        render(); return;
      }
      if (!record) return;
      const submittedForm = form;
      if (submittedForm && !submittedForm.values.id) submittedForm.values.id = core.uuid();
      const submittedFields = submittedForm ? JSON.stringify(submittedForm.values) : null;
      const saveForm = (command, payload, jobId) => save(command, payload, jobId, submittedForm?.custody.base);
      try {
        if (type === 'mail-search') return await searchMail(data);
        if (type === 'draft' || type === 'note' || type === 'approval') return;
        const requireSelection = (rows, field, name, optional = false) => {
          const retained = submittedForm?.values[field];
          if ((retained && !rows.some(row => row.id === retained)) || (!optional && !data[field]) || (data[field] && !rows.some(row => row.id === data[field]))) throw new Error(`Choose ${optional ? 'a current ' + name + ' or Ungrouped' : 'a current ' + name}; the previous selection is unavailable or unconfirmed.`);
        };
        if (type === 'receipt') requireSelection(array(record.allocations), 'allocation_id', 'allocation');
        if (type === 'allocation') {
          requireSelection(array(record.requirements), 'requirement_id', 'requirement');
          requireSelection(supplyLots(record).filter(lot => lot.unit), 'supply_id', 'supply lot');
        }
        if (type === 'requirement') requireSelection(array(record.groups), 'group_id', 'group', true);
        if (type === 'group') await saveForm('group_upsert', { id: form.values.id || core.uuid(), name: data.name.trim(), position: form.values.position ?? array(record.groups).length }, id);
        if (type === 'requirement') {
          const requirement = { id: form.values.id || core.uuid(), description: data.description.trim(), quantity: data.quantity === '' ? null : Number(data.quantity), unit: data.unit || null, specification: data.specification || null, group_id: data.group_id || null, phase: data.phase, destination: data.destination, needed_by: data.needed_by || null, owner: data.owner, source_ref: form.values.source_ref || null };
          const previous = record.requirements.find(item => item.id === requirement.id); const reconcile = previous && record.allocations.some(a => a.requirement_id === requirement.id) && ['quantity', 'unit', 'specification', 'description'].some(key => previous[key] !== requirement[key]); if (reconcile && !data.reconciliation_reason?.trim()) throw new Error('Explain the supplied-scope change and establish applicable approval before reconciliation.'); await saveForm(form.noteId ? 'note_promote' : reconcile ? 'requirement_reconcile' : 'requirement_upsert', form.noteId ? { id: form.noteId, requirement } : { ...requirement, ...(reconcile ? { reason: data.reconciliation_reason.trim() } : {}) }, id);
        }
        if (type === 'order') {
          const ids = selectedRequirementIds(submittedForm.values);
          const payload = { id: form.values.id || core.uuid(), supplier_name: data.supplier_name, delivery_address: data.delivery_address, delivery_date: data.delivery_date || null, notes: data.notes, requirement_ids: ids, quantities: Object.fromEntries(ids.filter(key => data['quantity:' + key] !== '').map(key => [key, Number(data['quantity:' + key])])), unit_prices: Object.fromEntries(ids.map(key => [key, data['price:' + key] === '' ? null : Number(data['price:' + key])])), existing_supply_reviewed: data.existing_supply_reviewed === 'on' };
          if (!ids.length) throw new Error('Select at least one reviewed requirement.');
          if (unresolvedRequirementIds(record, submittedForm.values, true).length) throw new Error('Resolve stale or unavailable requirement selections before preparing this order.');
          await saveForm('order_prepare', payload, id);
        }
        if (type === 'stock') { await saveForm('stock_record', { id: form.values.id || core.uuid(), ...data, quantity: Number(data.quantity) }, id); await core.supply('stock'); }
        if (type === 'suitability') {
          if (!data.reason?.trim() || !data.evidence?.trim()) throw new Error('A reason and compatibility evidence are required.');
          await saveForm('allocation_confirm_suitability', { id: submittedForm.values.id, reason: data.reason.trim(), evidence: data.evidence.trim() }, id);
        }
        if (type === 'allocation') await saveForm('allocation_upsert', { id: form.values.id || core.uuid(), requirement_id: data.requirement_id, supply_id: data.supply_id, quantity: Number(data.quantity) }, id);
        if (type === 'receipt') await saveForm('receipt_upsert', { id: form.values.id || core.uuid(), allocation_id: data.allocation_id, usable_quantity: Number(data.usable_quantity), damaged_quantity: Number(data.damaged_quantity), location: data.location, evidence: data.evidence }, id);
        if (type === 'transfer') {
          const receipt = array(record.receipts).find(item => item.id === submittedForm.values.id);
          const quantity = Number(data.quantity), usable = Number(receipt?.usable_quantity);
          if (!receipt || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(usable) || quantity > usable) throw new Error('Enter a positive transfer quantity no greater than the recorded usable amount.');
          await saveForm('receipt_transfer', { id: submittedForm.values.id, new_id: submittedForm.values.new_id, quantity, location: data.location, evidence: data.evidence }, id);
        }
        if (type === 'movement') {
          const ids = selectedRequirementIds(submittedForm.values);
          const payload = { id: form.values.id || core.uuid(), ...data, date: data.date || null, time: data.time || null, requirement_ids: ids };
          if (unresolvedRequirementIds(record, submittedForm.values, false).length) throw new Error('Resolve stale or unavailable requirement selections before saving this movement.');
          await saveForm('movement_upsert', payload, id);
        }
        if (submittedForm && JSON.stringify(submittedForm.values) !== submittedFields) {
          if (submittedForm.noteId) delete submittedForm.noteId;
          if (form === submittedForm) message = 'Earlier values saved. New edits remain for review.';
        } else {
          if (formsByJob.get(id) === submittedForm) formsByJob.delete(id);
          if (form === submittedForm) form = null;
        }
      } catch (error) { if (core.state.selectedId === id) message = error.message; }
      render();
    });
    listen('click', async event => {
      const target = event.target.closest('[data-action]'); if (!target || !element.contains(target)) return;
      if (target.closest('form')) event.preventDefault();
      const action = target.dataset.action, record = job(), id = core.state.selectedId;
      try {
        message = '';
        if (action === 'choose-job') { element.querySelector('.dp-queue').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (action === 'reset-filters') { queue = 'current'; trade = 'all'; workflow = 'all'; query = ''; render(); return; }
        if (action === 'select') { await core.select(target.dataset.id); if (innerWidth <= 700) element.querySelector('.dp-workspace').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        if (action === 'event') { if (target.dataset.job) await core.select(target.dataset.job); return; }
        if (action === 'refresh') { await Promise.all([core.list(), core.calendar(dates[0], dates[6]), refreshEvidence()]); return; }
        if (action === 'workflow-refresh') {
          if (!root.OpsWorkflowRefresh) { message = 'Workflow Refresh control is not installed.'; render(); return; }
          const scope = id ? { job_id: id } : {};
          const run = await root.OpsWorkflowRefresh.start('dispatch', scope);
          core.state.workflowRefresh = run;
          if (run.lease_token) throw new Error('Refresh readback exposed a lease token.');
          message = root.OpsWorkflowRefresh.label(run);
          render();
          return;
        }
        if (action === 'week-back' || action === 'week-next') { dates = (core.state.calendarRange ? root.DispatchCore.week(new Date(core.state.calendarRange.from + 'T12:00:00Z')) : dates).map(date => { const next = new Date(date + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + (action === 'week-next' ? 7 : -7)); return next.toISOString().slice(0, 10); }); await core.calendar(dates[0], dates[6]); return; }
        if (action === 'how-it-works') { root.OpsHowItWorks?.open('dispatch'); return; }
        if (action === 'refresh-calendar') return await core.calendar(dates[0], dates[6]);
        if (action === 'queue') queue = target.dataset.id;
        if (action === 'trade') trade = target.dataset.id;
        if (action === 'tab') {
          tab = target.dataset.id; render();
          if (tab === 'email' && id) {
            await core.execution(id);
            if (root.OpsContextMail) {
              core.state.canonicalMail = await root.OpsContextMail.load('dispatch', { job_id: id });
              render();
            }
          }
        }
        if (action === 'refresh-assessments' || action === 'more-assessments') { await core.tasks({ more: action === 'more-assessments' }).catch(() => {}); render(); return; }
        if (action === 'prepare-assessment-retry') {
          const ui = currentUI(); ui.assessmentError = null;
          try {
            if (!core.state.tasks.loaded || core.state.tasks.loading) throw new Error('Refresh assessment status before preparing a retry.');
            const task = core.state.tasks.items.find(item => core.taskKey(item, false) === target.dataset.id);
            const sourceFailure = !task;
            const selected = task || core.state.tasks.sourceFailures.find(item => core.taskKey(item, true) === target.dataset.id);
            if (!selected) throw new Error('Refresh assessment status to find the original record.');
            ui.assessmentRetry = { task: { ...selected }, sourceFailure, reason: '' };
          } catch (error) { ui.assessmentError = error.message; }
          render(); return;
        }
        if (action === 'recover-assessment-retry') {
          const ui = currentUI(); ui.assessmentError = null;
          try { await core.retryTaskRequest(target.dataset.id); } catch (error) { ui.assessmentError = error.message; }
          render(); return;
        }
        if (!record) return render();
        if (action === 'reconcile-editor') {
          if (!evidenceCurrent(record)) throw new Error('Refresh current evidence before reconciling.');
          const key = target.dataset.id, custody = key === 'form' ? form?.custody : editorCustody.get(id)?.get(key);
          if (!custody) throw new Error('Open the retained editor first.');
          if (key.startsWith('draft:')) { core.edit(id, key, core.editor(id, key) || custody.value); currentUI().draftReview = null; currentUI().approval = null; }
          Object.assign(custody, binding(record));
          message = 'Changed evidence acknowledged. Your exact values remain for review and saving.';
        }
        if (action === 'drop-requirement-selection' && form && ['order', 'movement'].includes(form.kind)) {
          form.values.requirement_ids = selectedRequirementIds(form.values).filter(requirementId => requirementId !== target.dataset.id);
          delete form.values.requirement_id;
          message = 'Removed unavailable requirement from this draft. Other edits remain.';
          render();
          return;
        }
        if (action === 'group') selectedGroup = target.dataset.id;
        if (action === 'add-group') form = { kind: 'group', jobId: id, custody: binding(record), values: {} };
        if (action === 'rename-group') form = { kind: 'group', jobId: id, custody: binding(record), values: { ...record.groups.find(group => group.id === selectedGroup) } };
        if (action === 'delete-group') { await save('group_delete', { id: selectedGroup }); selectedGroup = 'all'; }
        if (action === 'add-requirement') form = { kind: 'requirement', jobId: id, custody: binding(record), values: { group_id: record.groups.some(group => group.id === selectedGroup) ? selectedGroup : null } };
        if (action === 'edit-requirement') form = { kind: 'requirement', jobId: id, custody: binding(record), values: { ...record.requirements.find(item => item.id === target.dataset.id) } };
        if (action === 'review-requirement') await save('requirement_review', { id: target.dataset.id });
        if (action === 'review-set') await save('set_review', {});
        if (action === 'cancel-form') { formsByJob.delete(id); form = null; }
        if (action === 'edit-order') { const order = record.order_drafts.find(item => item.id === target.dataset.id); form = { kind: 'order', jobId: id, custody: binding(record), values: { ...order, delivery_address: Object.hasOwn(order, 'delivery_address') ? order.delivery_address : record.job.site_address ?? '', ...Object.fromEntries(array(order.line_items).flatMap(line => [['quantity:' + line.dispatch_requirement_id, line.quantity], ['price:' + line.dispatch_requirement_id, line.unit_price]])), requirement_ids: array(order.line_items).map(line => line.dispatch_requirement_id) } }; }
        if (action === 'prepare-order') form = { kind: 'order', jobId: id, custody: binding(record), values: { id: core.uuid(), delivery_address: record.job.site_address ?? '' } };
        if (action === 'add-allocation') { form = { kind: 'allocation', jobId: id, custody: binding(record), values: {} }; render(); await Promise.all([core.supply('po'), core.supply('stock')]); }
        if (action === 'record-stock') form = { kind: 'stock', jobId: id, custody: binding(record), values: {} };
        if (action === 'review-context') await save('context_review', {});
        if (action === 'add-receipt') form = { kind: 'receipt', jobId: id, custody: binding(record), values: {} };
        if (action === 'transfer-receipt') form = { kind: 'transfer', jobId: id, custody: binding(record), values: { id: target.dataset.id, new_id: core.uuid() } };
        if (action === 'review-allocation') form = { kind: 'suitability', jobId: id, custody: binding(record), values: { id: target.dataset.id } };
        if (action === 'delete-allocation') await save('allocation_delete', { id: target.dataset.id });
        if (action === 'add-movement') form = { kind: 'movement', jobId: id, custody: binding(record), values: {} };
        if (action === 'assess') await core.assess(id);
        if (action === 'reload-job') await core.load(id);
        if (action === 'retry-write') await core.retry(id);
        if (action === 'resolve-conflict') { await core.resolveConflict(id); message = 'Sources reloaded. Your edits remain; inspect changes before saving again.'; }
        if (action === 'save-note') { const value = core.editor(id, 'note'); if (!value?.text.trim()) throw new Error('Write a note first.'); await save('note_upsert', value, id, editorBinding(record, 'note', value).base); core.clearEditor(id, 'note', value); if (!core.editor(id, 'note')) editorCustody.get(id)?.delete('note'); }
        if (action === 'promote-note') { const note = record.notes.find(item => item.id === target.dataset.id); form = { kind: 'requirement', jobId: id, custody: binding(record), noteId: note.id, values: { description: note.text, source_ref: { type: 'working_note', id: note.id } } }; }
        if (action === 'new-draft') {
          const unsaved = jobDrafts(record).find(draft => !draft.po_id && !draft.thread_id && !array(record.drafts).some(saved => saved.id === draft.id));
          if (!unsaved) return newDraft(record);
          currentUI().draftId = unsaved.id; currentUI().draftReview = null;
        }
        if (action === 'po') { const po = record.purchase_orders.find(item => item.id === target.dataset.id); return newDraft(record, { po_id: po.id, subject: `Purchase order ${po.po_number || po.order_number || ''} · ${record.job.job_number}` }); }
        if (action === 'open-draft') { currentUI().draftId = target.dataset.id; currentUI().draftReview = null; }
        if (action === 'close-draft') currentUI().draftId = null;
        if (action === 'execution-status') await core.execution(id);
        if (action === 'approve-draft') {
          const draft = draftValue(record), data = new FormData(element.querySelector('[data-form="approval"]'));
          if (!matches(editorBinding(record, `draft:${draft.id}`, draft), record) || !evidenceCurrent(record) || core.editor(id, `draft:${draft.id}`) || draft.review?.content_hash !== draft.content_hash || draft.review?.source_version !== record.source_version) throw new Error('Save and review the current exact draft before approving it.');
          if (!data.has('communications_approved') || (purchaseRequired(draft) && !data.has('purchase_approved'))) throw new Error('Explicit communications approval and any separate purchase approval are required.');
          const approvedRecord = await core.approveDraft(id, { id: draft.id, approval_id: core.uuid(), content_hash: draft.content_hash, communications_approved: true, purchase_approved: data.has('purchase_approved') });
          if (!core.editor(id, `draft:${draft.id}`)) editorCustody.get(id).set(`draft:${draft.id}`, { ...binding(approvedRecord), value: copy(array(approvedRecord.drafts).find(item => item.id === draft.id)) });
          await core.execution(id);
        }
        if (action === 'execute-draft') { const draft = draftValue(record); if (!matches(editorBinding(record, `draft:${draft.id}`, draft), record) || !evidenceCurrent(record) || core.editor(id, `draft:${draft.id}`) || !draft.approval || draft.approval.content_hash !== draft.content_hash || draft.approval.source_version !== record.source_version) throw new Error('Current exact approval is required; unsaved changes cannot be sent.'); await core.executeDraft(id, draft.id, draft.approval.id); }
        if (action === 'execution-readback') await core.readbackExecution(id, target.dataset.id);
        if (action === 'save-draft' || action === 'review-draft') {
          if (action === 'review-draft' && !evidenceCurrent(record)) throw new Error('Refresh current evidence before reviewing this draft.');
          const formElement = element.querySelector('[data-form="draft"]'); if (!formElement.reportValidity()) return;
          const value = captureDraft(formElement, record), reviewUI = currentUI();
          const savedRecord = await save('draft_upsert', { ...value, attachments: value.attachments.map(item => ({ id: item.id })) }, id, editorBinding(record, `draft:${value.id}`, value).base);
          const canonicalDraft = array(savedRecord.drafts).find(item => item.id === value.id);
          const savedHash = canonicalDraft?.content_hash;
          const changedDuringSave = core.editor(id, `draft:${value.id}`) && JSON.stringify(core.editor(id, `draft:${value.id}`)) !== JSON.stringify(value);
          core.clearEditor(id, `draft:${value.id}`, value);
          if (!changedDuringSave) editorCustody.get(id).set(`draft:${value.id}`, { ...binding(savedRecord), value: copy(canonicalDraft) });
          if (action === 'review-draft' && changedDuringSave) throw new Error('New edits were preserved. Review the latest content again.');
          if (action === 'review-draft' && !sameAttachments(canonicalDraft?.attachments || [], value.attachments)) { message = 'Attachment bytes resolved. Inspect the returned exact files and hashes, then review the draft again.'; render(); return; }
          if (action === 'review-draft') { const reviewedRecord = await save('draft_review', { id: value.id }, id, { version: savedRecord.version, source_version: savedRecord.source_version });
            const reviewed = array(reviewedRecord.drafts).find(item => item.id === value.id);
            const latestEdit = core.editor(id, `draft:${value.id}`);
            if (latestEdit && JSON.stringify(latestEdit) !== JSON.stringify(value)) throw new Error('New edits were preserved. Review the latest content again.');
            if (!latestEdit) editorCustody.get(id).set(`draft:${value.id}`, { ...binding(reviewedRecord), value: copy(reviewed) });
            if (reviewUI.draftId !== value.id) return;
            if (!savedHash || reviewed?.review?.content_hash !== savedHash || reviewed?.review?.source_version !== reviewedRecord.source_version) throw new Error('Review evidence changed. Reload and review the current draft.');
            reviewUI.draftReview = `From: ${value.sender}\nTo: ${value.to.join(', ')}\nCC: ${value.cc.join(', ')}\nSubject: ${value.subject}\nPurchase authority: ${purchaseRequired(value) ? 'Requires separate purchase approval' : 'Does not commit to a purchase'}\nDelivery: ${value.proposed_delivery_at || 'Not specified'}\nAttachments: ${canonicalDraft.attachments.map(item => item.name + ' [' + item.revision + ']').join(', ') || 'None'}\n\n${value.body}`; }
          if (core.state.selectedId === id && reviewUI.draftId === value.id) message = 'Dispatch draft saved. No message sent.';
        }
        if (action === 'open-linked-mail') {
          const generation = ++mailGeneration, seen = new Set(); let cursor, found, complete = false;
          do { const result = await core.communications({ job_id: target.dataset.job, scope: 'job', ...(cursor ? { cursor } : {}) }); if (generation !== mailGeneration || core.state.selectedId !== id) return;
            found = array(result.records).find(mail => mail.id === target.dataset.id); complete = result.coverage?.complete === true; cursor = result.next_cursor;
            if (cursor && seen.has(cursor)) throw new Error('Repeated message cursor; reference coverage is incomplete.'); if (cursor) seen.add(cursor);
          } while (!found && cursor);
          selectedMail = found; if (!found) message = complete ? 'Original reference is unavailable in captured mail. Its original job and message identity remain linked.' : 'Original reference coverage is incomplete. Retry retrieval; the reference remains linked.';
        }
        if (action === 'mail') selectedMail = array(mailResults?.communications || record.communications).find(mail => mail.id === target.dataset.id);
        if (action === 'more-mail') await searchMail({ ...mailResults.params, cursor: mailResults.next_cursor }, true);
        if (action === 'link-mail') { await save('communication_link', { id: core.uuid(), communication_id: selectedMail.id, source_job_id: selectedMail.job_id, reason: 'Operator selected past-job reference; not adopted as order evidence.' }); message = 'Reference linked with its original job. Recipients and attachments were not copied.'; }
        if (action === 'reply-mail') {
          if (!selectedMail || selectedMail.job_id !== id) throw new Error('Open the original job to reply to this message.');
          const direction = String(selectedMail.direction || '').toLowerCase();
          const replyTo = direction === 'sent' ? selectedMail.to_email : selectedMail.sender || selectedMail.from_email || selectedMail.from;
          const recipients = array(replyTo).length ? array(replyTo) : String(replyTo || '').split(',').map(item => item.trim()).filter(Boolean);
          const cc = array(selectedMail.cc_email).length ? selectedMail.cc_email : array(selectedMail.cc).length ? selectedMail.cc : String(selectedMail.cc_email || selectedMail.cc || '').split(',').map(item => item.trim()).filter(Boolean);
          return newDraft(record, { thread_id: selectedMail.thread_id || null, ...(selectedMail.graph_message_id && selectedMail.graph_change_key ? { graph_message_id: selectedMail.graph_message_id, graph_change_key: selectedMail.graph_change_key, graph_link_reason: 'Operator selected this captured native message as the reply source.' } : {}), sender: selectedMail.mailbox || selectedMail.mailbox_email || '', to: recipients, cc, subject: `Re: ${selectedMail.subject || ''}` });
        }
      } catch (error) { if (core.state.selectedId === id) message = error.message; }
      render();
    });
    const unsubscribe = core.subscribe(render); render();
    document.addEventListener?.('visibilitychange', resumeRefresh);
    root.addEventListener?.('focus', resumeRefresh);
    scheduleRefresh();
    const app = { core, render, refresh: refreshEvidence,
      setActive(value) { const changed = active !== value; active = value; if (changed && visible()) return refreshEvidence(); scheduleRefresh(); },
      load: () => Promise.all([core.list(), core.calendar(dates[0], dates[6]), core.state.selectedId ? refreshEvidence() : null]),
      destroy() { destroyed = true; mailGeneration++; root.clearTimeout?.(refreshTimer); document.removeEventListener?.('visibilitychange', resumeRefresh); root.removeEventListener?.('focus', resumeRefresh); unsubscribe(); handlers.forEach(args => element.removeEventListener?.(...args)); formsByJob.clear(); uiByJob.clear(); editorCustody.clear(); form = null; selectedMail = null; mailResults = null; message = ''; element.innerHTML = ''; mounts.delete(app); }
    };
    mounts.add(app);
    return app;
  }
  let instance, mainCleanup;
  function installationStarts(events) {
    const starts = {};
    array(events).forEach(event => {
      const type = event.assignment_type || 'install';
      if (!event.job_id || type !== 'install') return;
      const date = event.scheduled_date || event.date;
      if (!date || starts[event.job_id] && starts[event.job_id] <= date) return;
      starts[event.job_id] = date;
    });
    return starts;
  }
  function annotateDelivery(row, starts) {
    const start = row.job_id && starts[row.job_id];
    return { ...row, late_material: !!(row.dispatch_layer === 'materials' && start && row.delivery_date && row.delivery_date > start), installation_start_date: start || null };
  }
  function mainDeliveries(deliveries, range, events) {
    const core = controller(), rows = new Map();
    const starts = installationStarts(events);
    if (core.state.layers.materials) array(deliveries).forEach(item => {
      const id = 'po:' + (item.id || item.po_id);
      const deliveryDate = item.confirmed_delivery_date || item.delivery_date;
      const deliveryKind = item.delivery_kind || (item.confirmed_delivery_date || item.status === 'promised' || item.status === 'confirmed' ? 'promised' : 'requested');
      rows.set(id, annotateDelivery({ ...item, delivery_date: deliveryDate, delivery_kind: deliveryKind, dispatch_event_id: id, dispatch_layer: 'materials' }, starts));
    });
    const loaded = core.state.calendar.loadedRange;
    const calendarFresh = core.state.calendar.coverage?.complete === true && core.state.calendar.loading !== true && !core.state.calendar.error && loaded?.from === range.from && loaded?.to === range.to;
    if (calendarFresh) array(core.state.calendar.events).forEach(event => {
        if (event.layer === 'staff' || !core.state.layers[event.layer] || event.date < range.from || event.date > range.to) return;
        // One PO identity, even when both incumbent and Dispatch feeds contain it.
        const previous = rows.get(event.id) || {};
        const deliveryKind = event.delivery_kind || previous.delivery_kind || (event.status === 'promised' || event.status === 'confirmed' ? 'promised' : 'requested');
        rows.set(event.id, annotateDelivery({ ...previous, id: event.id, job_id: event.job_id, job_number: event.job_number, supplier_name: event.title, delivery_date: event.date, delivery_time: event.time, status: event.status, delivery_kind: deliveryKind, dispatch_event_id: event.id, dispatch_layer: event.layer }, starts));
      });
    return [...rows.values()];
  }
  function mainBlock(event) {
    const timing = event.dispatch_layer !== 'materials' ? '' : event.late_material ? `needs review · ${label(event.delivery_kind || 'requested')} delivery after installation starts` : `${label(event.delivery_kind || 'requested')} delivery`;
    const detail = [timing, label(event.dispatch_layer), label(event.status), event.delivery_time].filter(Boolean).join(' · ');
    return `<button type="button" class="cal-delivery-block dispatch-calendar-event${event.late_material ? ' warning' : ''}" data-source-event-id="${esc(event.dispatch_event_id)}" data-dispatch-job="${esc(event.job_id)}" data-layer="${esc(event.dispatch_layer)}" title="${esc([event.job_number || event.po_number, event.supplier_name, detail].filter(Boolean).join(' · '))}"><strong>${esc(event.job_number || event.po_number || '')}</strong> ${esc(event.supplier_name)}${event.late_material ? ' &#9888;' : ''}<small>${esc(detail)}</small></button>`;
  }
  function changeIdentity(event) {
    const next = identityKey(event.detail);
    if (next && next === identity) return;
    identity = next; identityGeneration++;
    const retired = new Set([...mounts].map(app => app.core));
    if (shared) retired.add(shared);
    mounts.forEach(app => app.destroy());
    mainCleanup?.(); mainCleanup = null;
    retired.forEach(core => core.dispose());
    instance = null; shared = null;
    root._calEvents = [];
    root._calDeliveries = [];
    root._calReadiness = {};
    root._calOrgEvents = [];
    root._calLeaveByDate = {};
    root._calAvailability = {};
    root._unschedJobs = [];
    root._crewList = [];
    root._poJobList = [];
    root._editAssignmentId = null;
    root._calPopupAssignment = null;
    root._calDragData = null;
    root._calUnschedOpen = false;
    root._calTruncated = false;
    const confirmProceed = document.getElementById?.('confirmModalProceed');
    if (confirmProceed) confirmProceed.onclick = null;
    const setValue = (id, value) => { const element = document.getElementById?.(id); if (element) element.value = value; };
    const setText = (id, value) => { const element = document.getElementById?.(id); if (element) element.textContent = value; };
    setText('assignModalTitle', 'Schedule Assignment');
    ['assignJobSearch', 'assignJobSelect', 'assignDate', 'assignEndDate', 'assignStartTime', 'assignEndTime', 'assignNotes'].forEach(id => setValue(id, ''));
    const assignType = document.getElementById?.('assignType'); if (assignType) assignType.value = 'install';
    const assignJobType = document.getElementById?.('assignJobType'); if (assignJobType) assignJobType.value = 'fencing';
    const assignDuration = document.getElementById?.('assignDuration'); if (assignDuration) assignDuration.value = '2';
    for (const id of ['assignCrewContainer', 'assignMembersContainer', 'assignJobDropdown']) {
      const element = document.getElementById?.(id); if (element) element.innerHTML = '';
    }
    const assignTypeGroup = document.getElementById?.('assignTypeGroup'); if (assignTypeGroup?.style) assignTypeGroup.style.display = 'none';
    for (const id of ['dispatchRoot', 'dispatchCalendarLayers', 'calendarBody', 'calUnschedSidebar', 'calSidebar', 'calSchedModal', 'calConfirmModal', 'calJobPopup']) {
      const element = document.getElementById?.(id); if (element) element.innerHTML = '';
    }
    for (const id of ['calSchedModal', 'calSchedBackdrop', 'calConfirmBackdrop', 'calJobPopup', 'assignmentModal']) {
      document.getElementById?.(id)?.classList?.remove?.('open', 'active');
    }
  }
  root.addEventListener?.('sw:auth-identity', changeIdentity);
  root.addEventListener?.('sw:auth-locked', () => changeIdentity({ detail: null }));
  root.addEventListener?.('sw:auth-unlocked', () => {
    if (!identity) return;
    if (document.getElementById?.('viewDispatch')?.classList.contains('active')) root.DispatchOps.load().catch(() => {});
    if (document.getElementById?.('viewCalendar')?.classList.contains('active')) root.loadCalendar?.();
  });
  root.DispatchOps = { mount, identityGuard,
    setActive(value) { return instance?.setActive(value); },
    load() { if (!identity) return Promise.resolve(); const element = document.getElementById('dispatchRoot'); if (!element) return; if (!instance) instance = mount(element); return instance.load(); },
    projectMain(events, deliveries, range) { if (!identity) return { events: [], deliveries: [] }; return { events: controller().state.layers.staff ? events : [], deliveries: mainDeliveries(deliveries, range, events) }; },
    mainBlock,
    staffVisible() { return !!identity && controller().state.layers.staff; },
    loadMainCalendar(range) {
      if (!identity) return Promise.resolve();
      const core = controller(), element = document.getElementById('dispatchCalendarLayers');
      if (!element) return;
      if (!mainCleanup) {
        const assertIdentity = identityGuard();
        const render = () => {
          assertIdentity();
          const focusedLayer = element.contains(document.activeElement) ? document.activeElement.dataset.dispatchLayer : null;
          element.innerHTML = '<div class="cal-sidebar-heading">Work layers</div>' + Object.entries(core.state.layers).map(([layer, enabled]) => `<label class="cal-sidebar-item"><input type="checkbox" data-dispatch-layer="${layer}" ${enabled ? 'checked' : ''}>${label(layer)}</label>`).join('') + `<p class="dp-main-coverage">${core.state.calendar.error ? esc(core.state.calendar.error) : core.state.calendar.coverage?.complete ? 'Material / movement range captured' : 'Material / movement coverage partial'}</p>`;
          if (focusedLayer) element.querySelector(`[data-dispatch-layer="${focusedLayer}"]`)?.focus();
          if (document.getElementById('viewCalendar')?.classList.contains('active')) root.renderCalendar();
        };
        const unsubscribe = core.subscribe(render);
        const change = event => { assertIdentity(); if (event.target.dataset.dispatchLayer) core.setLayer(event.target.dataset.dispatchLayer, event.target.checked); };
        const click = async event => { const target = event.target.closest('[data-dispatch-job]'); if (!target?.dataset.dispatchJob) return; assertIdentity(); event.stopPropagation(); root.showView('dispatch'); await core.select(target.dataset.dispatchJob); };
        const body = document.getElementById('calendarBody');
        element.addEventListener('change', change); body?.addEventListener('click', click, true);
        mainCleanup = () => { unsubscribe(); element.removeEventListener?.('change', change); body?.removeEventListener?.('click', click, true); };
        render();
      }
      return core.calendar(range.from, range.to).catch(error => { if (shared === core) throw error; });
    }
  };
})(window);
