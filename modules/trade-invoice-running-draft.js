// Running weekly invoice draft.
// Pure rules for the Trade App Pay > Weekly Invoice screen.
// Save stores a draft. It never submits, and it never creates a Xero bill.
// One open draft per person per week. Approved work is added once.
// An agent may add lines. Only the person, or an admin on the normal submit
// path, can send the invoice.
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TradeInvoiceRunningDraft = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var VERSION = 1;
  var BLOCKED_KEYS = {
    submit: 1,
    send: 1,
    authorise: 1,
    authorize: 1,
    pay: 1,
    xero: 1,
    xero_bill_id: 1,
    xero_status: 1,
    create_xero: 1
  };

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  // Default off. The server flag is the one that may persist a draft.
  // ?invdraft=1 or localStorage sw_inv_running_draft=1 shows the button.
  // ?invdraft=0 or stored 0 hides it even when the server flag is on.
  function flagOn(opts) {
    opts = opts || {};
    var query = opts.query == null || opts.query === '' ? null : String(opts.query);
    var stored = opts.stored == null || opts.stored === '' ? null : String(opts.stored);
    if (query === '0' || stored === '0') return false;
    if (opts.server === true || query === '1' || stored === '1') return true;
    return false;
  }

  function sourceKey(line) {
    if (!line || typeof line !== 'object') return '';
    if (line.source_key) return String(line.source_key);
    if (line.work_order_id) return 'wo:' + line.work_order_id;
    if (line.assignment_id) return 'as:' + line.assignment_id;
    var day = line.work_date || line.scheduled_date || line.line_date || '';
    if (line.job_id && day) return 'job:' + line.job_id + ':' + String(day).slice(0, 10);
    return '';
  }

  // Add suggested lines that are not already on the draft, not dismissed,
  // and not already on another week's sent invoice (claimed).
  function mergeApproved(state) {
    state = state || {};
    var cards = clone(state.cards || []);
    var dismissed = {};
    (state.dismissed || []).forEach(function (key) { if (key) dismissed[String(key)] = 1; });
    var claimed = {};
    (state.claimed || []).forEach(function (key) { if (key) claimed[String(key)] = 1; });
    var existing = {};
    cards.forEach(function (card) {
      var key = sourceKey(card);
      if (key) existing[key] = 1;
    });
    var added = [];
    (state.suggested || []).forEach(function (raw) {
      var line = clone(raw) || {};
      var key = sourceKey(line);
      if (!key) return;
      if (existing[key] || dismissed[key] || claimed[key]) return;
      line.source_key = key;
      if (line.included == null) line.included = true;
      line.auto = true;
      cards.push(line);
      existing[key] = 1;
      added.push(key);
    });
    var dismissedList = Object.keys(dismissed);
    return { cards: cards, added: added, dismissed: dismissedList };
  }

  function snapshot(state) {
    state = state || {};
    return {
      version: VERSION,
      jobCards: clone(state.jobCards || []) || [],
      invRows: clone(state.invRows || []) || [],
      invLumpLines: clone(state.invLumpLines || []) || [],
      dismissedKeys: (state.dismissedKeys || []).slice(),
      notes: state.notes || '',
      gst_on: !!state.gst_on,
      weekStart: state.weekStart || '',
      weekEnd: state.weekEnd || ''
    };
  }

  function saveBody(snap, extra) {
    extra = extra || {};
    var body = {
      week_start: snap.weekStart || '',
      notes: snap.notes || '',
      gst_on: !!snap.gst_on,
      draft_builder: snap,
      dismissed_source_keys: (snap && snap.dismissedKeys) || []
    };
    if (extra.draft_id) body.draft_id = extra.draft_id;
    return body;
  }

  function assertDraftOnly(body) {
    var refused = [];
    if (!body || typeof body !== 'object') return { ok: false, refused: ['body'] };
    Object.keys(body).forEach(function (key) {
      if (BLOCKED_KEYS[key] && body[key]) refused.push(key);
    });
    if (body.status && body.status !== 'draft') refused.push('status');
    if (body.action && body.action !== 'save_running_invoice_draft' && body.action !== 'agent_save_running_invoice_draft' && body.action !== 'get_running_invoice_draft' && body.action !== 'sync_running_invoice_draft') {
      refused.push('action');
    }
    return { ok: refused.length === 0, refused: refused };
  }

  function agentError(message) {
    var err = new Error(message);
    err.code = 'agent_draft_only';
    return err;
  }

  // Always a draft. Marks the draft as written by an agent.
  // Throws if the caller asks to submit, send, authorise, pay, or touch Xero.
  function agentDraft(input) {
    input = input || {};
    var check = assertDraftOnly(input);
    if (!check.ok) throw agentError('An agent can only save a draft. It cannot submit, send, authorise, pay, or create a Xero bill.');
    var existing = input.existing || {};
    var merged = mergeApproved({
      cards: existing.jobCards || [],
      dismissed: existing.dismissedKeys || input.dismissed || [],
      claimed: input.claimed || [],
      suggested: input.lines || []
    });
    var snap = snapshot({
      jobCards: merged.cards,
      invRows: existing.invRows || [],
      invLumpLines: existing.invLumpLines || [],
      dismissedKeys: merged.dismissed,
      notes: input.notes != null ? input.notes : (existing.notes || ''),
      gst_on: input.gst_on != null ? input.gst_on : !!existing.gst_on,
      weekStart: input.week_start || existing.weekStart || '',
      weekEnd: input.week_end || existing.weekEnd || ''
    });
    return {
      ok: true,
      status: 'draft',
      created_by_agent: true,
      draft_origin: 'agent',
      agent_label: String(input.agent_label || 'agent').slice(0, 80),
      xero: false,
      submitted: false,
      draft_builder: snap,
      added: merged.added,
      pay_rules: 'unchanged_until_submit'
    };
  }

  function hashSnapshot(snap) {
    return JSON.stringify(snap);
  }

  function dismissKey(keys, key) {
    var next = (keys || []).slice();
    if (key && next.indexOf(key) === -1) next.push(key);
    return next;
  }

  return {
    VERSION: VERSION,
    flagOn: flagOn,
    sourceKey: sourceKey,
    mergeApproved: mergeApproved,
    snapshot: snapshot,
    saveBody: saveBody,
    assertDraftOnly: assertDraftOnly,
    agentDraft: agentDraft,
    hashSnapshot: hashSnapshot,
    dismissKey: dismissKey
  };
});
