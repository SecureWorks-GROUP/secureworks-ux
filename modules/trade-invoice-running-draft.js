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
    var snap = {
      version: VERSION,
      ...(Array.isArray(state.groupIds) && state.groupIds.length ? { groupIds: state.groupIds.map(String) } : {}),
      jobCards: clone(state.jobCards || []) || [],
      invRows: clone(state.invRows || []) || [],
      invLumpLines: clone(state.invLumpLines || []) || [],
      dismissedKeys: (state.dismissedKeys || []).slice(),
      notes: state.notes || '',
      gst_on: !!state.gst_on,
      weekStart: state.weekStart || '',
      weekEnd: state.weekEnd || ''
    };
    // Set once the owner has deleted or edited a line. A later rebuild
    // keeps those cards and does not put a removed line back.
    if (state.manualLock) snap.manualLock = true;
    return snap;
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

  function draftError(message, code) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  // Owner of this draft, or office (admin / ops manager / owner), or the
  // assistant acting for that owner. Submitted and authorised invoices stay locked.
  function mayEditDraft(input) {
    input = input || {};
    var status = String(input.invoice_status || (input.existing && input.existing.status) || 'draft');
    if (status !== 'draft') {
      return {
        ok: false,
        code: 'draft_locked',
        message: 'Only a draft invoice can be changed. A submitted invoice stays as it was sent.'
      };
    }
    var owner = String(input.owner_id || input.user_id || '');
    var caller = String(input.caller_id || '');
    var role = String(input.caller_role || '').toLowerCase();
    var kind = String(input.caller_kind || 'agent');
    var office = kind === 'office' || role === 'admin' || role === 'ops_manager' || role === 'owner';
    if (kind === 'agent' || office) {
      if (!owner) return { ok: false, code: 'not_draft_owner', message: 'Say whose draft this is.' };
      return { ok: true };
    }
    if (owner && caller && owner === caller) return { ok: true };
    return {
      ok: false,
      code: 'not_draft_owner',
      message: 'Only the person whose invoice this is, or the office, can change a draft.'
    };
  }

  var EDIT_FIELDS = ['description', 'hours', 'rate', 'work_date', 'start_time', 'finish_time', 'break_minutes', 'included', 'job_number', 'client_name'];

  function copyEdit(card, edit) {
    EDIT_FIELDS.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(edit, field)) card[field] = edit[field];
    });
    if (!Object.prototype.hasOwnProperty.call(edit, 'rate') && Object.prototype.hasOwnProperty.call(edit, 'amount')) {
      card.rate = edit.amount;
    }
    card.owner_edited = true;
    var key = sourceKey(card);
    if (key) card.source_key = key;
  }

  // Delete and edit lines already on a draft. A line in `lines` is still an
  // add, unless it says remove or update. Adds are returned for mergeApproved,
  // which will not put a dismissed line back and will not replace a line
  // that is already there.
  function applyOwnerCommand(state) {
    state = state || {};
    var cards = clone(state.cards || []) || [];
    var dismissed = (state.dismissed || []).slice();
    var removed = [];
    var edited = [];
    var missing = [];
    var adds = [];

    function drop(ref) {
      var key = typeof ref === 'string' ? String(ref) : sourceKey(ref);
      if (!key) {
        missing.push('');
        return;
      }
      var before = cards.length;
      cards = cards.filter(function (card) { return sourceKey(card) !== key; });
      if (cards.length === before) missing.push(key);
      else removed.push(key);
      dismissed = dismissKey(dismissed, key);
    }

    function change(edit) {
      if (!edit || typeof edit !== 'object') return;
      var key = sourceKey(edit);
      if (!key) {
        missing.push('');
        return;
      }
      var card = null;
      cards.forEach(function (item) { if (sourceKey(item) === key) card = item; });
      if (!card) {
        missing.push(key);
        return;
      }
      copyEdit(card, edit);
      edited.push(key);
    }

    (state.remove || []).forEach(drop);
    (state.edits || []).forEach(change);
    (state.lines || []).forEach(function (line) {
      if (!line || typeof line !== 'object') return;
      if (line.remove === true) {
        drop(line);
        return;
      }
      if (line.update === true) {
        change(line);
        return;
      }
      adds.push(clone(line));
    });

    return {
      cards: cards,
      dismissed: dismissed,
      adds: adds,
      removed: removed,
      edited: edited,
      missing: missing,
      locked: removed.length > 0 || edited.length > 0
    };
  }

  // Rebuild from work orders and hours. Removed keys stay off unless
  // restoreRemoved is set. A line already on the draft is not replaced,
  // so an edit the owner made stays.
  function regenerate(state) {
    state = state || {};
    var dismissed = state.restoreRemoved ? [] : (state.dismissed || []).slice();
    return mergeApproved({
      cards: state.cards || [],
      dismissed: dismissed,
      claimed: state.claimed || [],
      suggested: state.suggested || []
    });
  }

  // Always a draft. Marks the draft as written by an agent.
  // Throws if the caller asks to submit, send, authorise, pay, or touch Xero.
  // The same ownership rule as the screen: the owner, the office, or the
  // assistant for that owner, and only while the invoice is still a draft.
  function agentDraft(input) {
    input = input || {};
    var check = assertDraftOnly(input);
    if (!check.ok) throw agentError('An agent can only save a draft. It cannot submit, send, authorise, pay, or create a Xero bill.');
    var auth = mayEditDraft(input);
    if (!auth.ok) throw draftError(auth.message, auth.code);
    var existing = input.existing || {};
    var command = applyOwnerCommand({
      cards: existing.jobCards || [],
      dismissed: existing.dismissedKeys || input.dismissed || [],
      remove: input.remove,
      edits: input.edits,
      lines: input.lines
    });
    var merged = mergeApproved({
      cards: command.cards,
      dismissed: command.dismissed,
      claimed: input.claimed || [],
      suggested: command.adds
    });
    var snap = snapshot({
      groupIds: existing.groupIds || [],
      jobCards: merged.cards,
      invRows: existing.invRows || [],
      invLumpLines: existing.invLumpLines || [],
      dismissedKeys: merged.dismissed,
      manualLock: !!(existing.manualLock || command.locked),
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
      removed: command.removed,
      edited: command.edited,
      missing: command.missing,
      pay_rules: 'unchanged_until_submit'
    };
  }

  // Owner, 11 Nov 2026: an agent may help draft a trade invoice, and the
  // invoice says so. agent_label is a short machine name (for example 'grok').
  // These three give the words. '' means no agent is named.
  function agentDisplayName(label) {
    var raw = String(label == null ? '' : label).replace(/[^A-Za-z0-9 _.-]/g, '').replace(/[\s_.-]+/g, ' ').trim().slice(0, 40);
    if (!raw) return '';
    var lower = raw.toLowerCase();
    if (lower === 'agent' || lower === 'assistant' || lower === 'ai' || lower === 'bot') return '';
    if (lower === 'grok' || lower === 'grokbot' || lower === 'grok bot') return 'Grokbot';
    return raw.split(' ').map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
  }

  // The banner on an unsent draft. Keeps "Only you can send it."
  function agentDraftBanner(label) {
    var name = agentDisplayName(label);
    if (!name) return 'An assistant drafted lines on this invoice. Only you can send it.';
    return 'Drafted with help from ' + name + '. Check it. Only you can send it.';
  }

  // The line on a sent invoice. '' unless an agent added lines to it.
  function agentInvoiceLine(invoice, tradeName) {
    if (!invoice || invoice.created_by_agent !== true) return '';
    var name = agentDisplayName(invoice.agent_label) || 'an assistant';
    var who = String(tradeName == null ? '' : tradeName).replace(/\s+/g, ' ').trim();
    return 'Prepared with help from ' + name + (who ? ', sent by ' + who : '') + '.';
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
    mayEditDraft: mayEditDraft,
    applyOwnerCommand: applyOwnerCommand,
    regenerate: regenerate,
    agentDraft: agentDraft,
    agentDisplayName: agentDisplayName,
    agentDraftBanner: agentDraftBanner,
    agentInvoiceLine: agentInvoiceLine,
    hashSnapshot: hashSnapshot,
    dismissKey: dismissKey
  };
});
