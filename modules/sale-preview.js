// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Preview) — Renderer (Slice 2 cockpit)
//
// Reads window.SALE_PREVIEW_FIXTURES, calls window.SALE_REDUCER.reduce
// to derive the Today cockpit (performance strip + Book/Send/Call
// lanes), and uses window.SALE_POLICY.evaluate to attach a verdict
// chip + reasons trail to every proposed-action card.
//
// Hard rules (encoded below + reinforced by the inline safety lock at
// the top of sale-preview.html):
//   • No fetch(), no XMLHttpRequest, no Supabase mutating call.
//   • No localStorage write outside sw_sale_preview_* namespace
//     (and Slice 2 writes none).
//   • Every action button is HTML-disabled. Tap fires console.info only.
//
// Defense-in-depth: sale-preview.html ships a v9 safety-lock <script>
// BEFORE shared/cloud.js loads. That block applies path-prefix-driven
// default-deny across fetch / XHR / sendBeacon, masks the offline
// queue, and constrains connect-src via CSP. See evidence README at
// secureworks-docs/cio/evidence/secure-sale-cockpit-2026-04-30/.
//
// Slice 1 amendments (still in force in Slice 2):
//   • Sender identity is unconditional and type-based:
//       patio / combo → Nithin
//       fencing       → Khairo
//     jobs.created_by is metrics/ownership only and never routes sends.
//   • archive_stale renders as an internal-only proposed action; never
//     auto-changes job/pipeline state.
//   • Stop-words behaviour: pause + alert; never auto-write
//     job_context.kind='do_not_chase' from this UI.
//
// Slice 2 additions:
//   • Today tab is reducer-driven. Lane buckets, performance numbers,
//     and verdict chips all come from pure modules. The renderer is a
//     view layer over their outputs.
//   • Mobile lane-chip switcher (<480px): only one lane visible at a
//     time, driven by [data-lane-chip] / .lane-pane[data-active].
//   • Calendar preview ('today only') is rendered under the lanes from
//     the existing F.calendar fixture.
// ════════════════════════════════════════════════════════════

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtCurrency(n) {
    if (typeof n !== 'number' || isNaN(n)) return '';
    return '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });
  }

  // Sender identity is type-based and unconditional. (Slice 1 amendment §3.)
  // Falls back to the policy module if available; otherwise a small inline copy.
  function senderForType(type) {
    if (window.SALE_POLICY && typeof window.SALE_POLICY.senderForJob === 'function') {
      var s = window.SALE_POLICY.senderForJob({ type: type });
      if (s) return s;
    }
    if (type === 'fencing') return { name: 'Khairo', label: 'Khairo (fencing)' };
    if (type === 'patio' || type === 'combo') return { name: 'Nithin', label: 'Nithin (' + type + ')' };
    return { name: 'Unassigned', label: 'Unassigned (' + (type || 'unknown') + ')' };
  }

  function typeBadge(type) {
    var label = (type || 'job').toUpperCase();
    var cls = 'type-badge type-' + (type || 'other');
    return '<span class="' + cls + '">' + esc(label) + '</span>';
  }

  function fixtureChip() {
    return '<span class="fixture-chip" title="Fixture data — not live">FIXTURE</span>';
  }

  function quickQuoteChip() {
    return '<span class="caveat-chip" title="Quick Quote send — quoted_at written outside canonical events. See SALES-DATA-4.">*Quick Quote</span>';
  }

  function angleChip(angle) {
    if (!angle) return '';
    var label = angle.replace(/_/g, ' ');
    return '<span class="angle-chip" data-angle="' + esc(angle) + '">' + esc(label) + '</span>';
  }

  // ════════════════════════════════════════════════════════════
  // Verdict chip — text-only labels (AUTO / APPROVE / BLOCKED / INTERNAL)
  // ════════════════════════════════════════════════════════════

  function verdictDescriptor(verdict) {
    if (!verdict) return { label: 'NO ACTION', cls: 'verdict-internal', short: 'no action proposed' };
    if (verdict.blocked)           return { label: 'BLOCKED',  cls: 'verdict-blocked',  short: 'outbound blocked' };
    if (verdict.internal_only)     return { label: 'INTERNAL', cls: 'verdict-internal', short: 'internal-only' };
    if (verdict.approval_required) return { label: 'APPROVE',  cls: 'verdict-approve',  short: 'approval required' };
    if (verdict.auto_ok)           return { label: 'AUTO',     cls: 'verdict-auto',     short: 'auto-send permitted' };
    return { label: 'REVIEW', cls: 'verdict-approve', short: 'review' };
  }

  function verdictChipHtml(verdict) {
    var d = verdictDescriptor(verdict);
    return '<span class="verdict-chip ' + d.cls + '" title="' + esc(d.short) + '">' + d.label + '</span>';
  }

  function verdictReasonsHtml(verdict) {
    if (!verdict || !Array.isArray(verdict.reasons) || !verdict.reasons.length) return '';
    return [
      '<details class="verdict-reasons">',
        '<summary>Why this verdict</summary>',
        '<ul>', verdict.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join(''), '</ul>',
      '</details>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Playbook (Loop 3) preview — read-only, fixture-only.
  // Surfaces a tone-aware drafted body underneath the legacy
  // proposed-action block so the rep can compare. No buttons,
  // no network. Output rendered when SALE_PLAYBOOK is loaded
  // and produces a non-blocked result.
  // ════════════════════════════════════════════════════════════

  // Map reducer-shape (state.name + bucket) to a synthesized Loop-2
  // action_type so the playbook can pick the right template.
  function mapBucketToActionType(bucket_id, state, lane) {
    if (bucket_id === 'do_not_chase')          return 'snooze_or_dismiss';
    if (bucket_id === 'no_first_contact')      return 'call_client';
    if (bucket_id === 'qualified_no_booking')  return 'book_scope';
    if (bucket_id === 'site_visit_no_scope')   return 'call_client';
    if (bucket_id === 'sent_not_viewed')       return 'send_follow_up';
    if (bucket_id === 'viewed_no_reply')       return lane === 'call' ? 'call_client' : 'send_follow_up';
    if (bucket_id === 'question_unanswered')   return 'reply_needed';
    if (bucket_id === 'stale_quote')           return 'stale_quote_recovery';
    return null;
  }

  // Loop 6 — Stub-tap → dry-run executor preview. Composes the
  // proposed_action + playbook + rep_identity + cadence_position
  // for the given job and runs SALE_DRY_RUN.execute(). NO fetch.
  // Returns the DryRunResult or null if executor unavailable.
  function runDryRunForJob(jobNumber) {
    if (!window.SALE_DRY_RUN || !jobNumber) return null;
    var src = _activeDataSource();
    var jobs = src.jobs || [];
    var job = jobs.find(function (j) { return j && j.job_number === jobNumber; });
    if (!job) return null;
    var pa = (src.proposedActions || []).find(function (p) {
      return p && p.job_id === job.id && p.status === 'proposed';
    });
    if (!pa) return null;
    // Build a minimal proposed_action shape the executor expects.
    var paInput = Object.assign({}, pa, {
      contact_phone: pa.contact_phone || job.client_phone || null,
      contact_email: pa.contact_email || job.client_email || null,
      contact_name:  pa.contact_name  || job.client_name  || '',
      job_number:    job.job_number,
    });
    var playbooks = ensurePlaybooksLoaded() || {};
    var playbook = window.SALE_PLAYBOOK
      && window.SALE_PLAYBOOK._resolvePlaybookForCard
      && window.SALE_PLAYBOOK._resolvePlaybookForCard({
          job_type:   job.type,
          action_type: pa.action_type,
        }, playbooks);
    var senderInfo = senderForType(job.type);
    var repIdentity = senderInfo && senderInfo.user_id ? {
      user_id:    senderInfo.user_id,
      first_name: senderInfo.name,
      sms_from:   senderInfo.sms_from || '+61400000000',  // fixture stand-in
      email_from: senderInfo.email_from || (String(senderInfo.name || '').toLowerCase() + '@secureworksgroup.app'),
    } : null;
    var jobEvents = (src.events || []).filter(function (e) { return e && e.job_id === job.id; });
    var cadencePos = null;
    if (window.SALE_CADENCE && typeof window.SALE_CADENCE.position === 'function') {
      try {
        cadencePos = window.SALE_CADENCE.position({
          card: { job_id: job.id, action_type: pa.action_type, policy_verdict: 'auto_ok' },
          job_brain: { events: jobEvents, facts: (src.jobContext || {})[job.id] || [] },
          playbook: playbook,
          now: new Date(),
        });
      } catch (e) {
        cadencePos = null;
      }
    }
    var recentOutbound = jobEvents
      .filter(function (e) {
        return e && (e.event_type === 'client.sms_out'
                  || e.event_type === 'client.email_out');
      })
      .map(function (e) {
        return {
          contact_id:  pa.contact_id || job.contact_id || job.id,
          cadence:     'auto',
          occurred_at: e.occurred_at,
          body:        (e.payload && e.payload.message) || '',
        };
      });
    return window.SALE_DRY_RUN.execute({
      proposed_action:  paInput,
      playbook:         playbook,
      rep_identity:     repIdentity,
      cadence_position: cadencePos,
      recent_outbound:  recentOutbound,
      facts:            (src.jobContext || {})[job.id] || [],
      now:              new Date(),
    });
  }

  // Loop 5 — cadence position line under why_now on follow-up cards.
  // Reads SALE_CADENCE.position(); returns '' if cadence engine not
  // loaded, card not cadence-governed, or no quote.sent anchor.
  function cadencePositionHtml(card, pa) {
    if (!window.SALE_CADENCE || typeof window.SALE_CADENCE.position !== 'function') return '';
    var actionType = mapBucketToActionType(card.bucket_id, card.state, card.lane);
    if (!actionType) return '';
    var playbooks = ensurePlaybooksLoaded() || {};
    var playbook = window.SALE_PLAYBOOK
      && window.SALE_PLAYBOOK._resolvePlaybookForCard
      && window.SALE_PLAYBOOK._resolvePlaybookForCard({
          job_type:   card.job.type,
          action_type: actionType,
        }, playbooks);
    var pos;
    try {
      pos = window.SALE_CADENCE.position({
        card: { job_id: card.job.id || card.job.job_number, action_type: actionType, policy_verdict: 'auto_ok' },
        job_brain: { events: card._events || [], facts: card._facts || [] },
        playbook: playbook,
        now: new Date(),
      });
    } catch (e) {
      return '';
    }
    if (!pos) return '';
    var label;
    if (pos.terminal) {
      label = 'Ladder complete · ' + pos.attempt_count + '/' + pos.ladder_length + ' rungs done · ' + (pos.nurture_mode ? 'nurture mode' : 'manual escalation');
    } else {
      var dueLabel;
      if (pos.overdue_minutes <= 0) {
        var dueDelta = pos.due_at ? Math.max(0, Math.floor((+new Date(pos.due_at) - +new Date()) / 60000)) : 0;
        dueLabel = dueDelta < 60 ? ('due in ' + dueDelta + 'min')
                  : dueDelta < 1440 ? ('due in ' + Math.floor(dueDelta/60) + 'h')
                  : ('due in ' + Math.floor(dueDelta/1440) + 'd');
      } else {
        dueLabel = pos.overdue_minutes < 60 ? ('overdue ' + pos.overdue_minutes + 'min')
                  : pos.overdue_minutes < 1440 ? ('overdue ' + Math.floor(pos.overdue_minutes/60) + 'h')
                  : ('overdue ' + Math.floor(pos.overdue_minutes/1440) + 'd');
      }
      label = dueLabel
        + ' · attempt ' + (pos.current_rung + 1) + '/' + pos.ladder_length
        + ' · next: ' + (pos.next_template_id || '(unknown)')
        + (pos.nurture_mode ? ' · nurture mode' : '');
    }
    return '<div class="cadence-position" data-cadence-rung="' + pos.current_rung + '">'
      + '<strong>Cadence:</strong> ' + esc(label)
      + '</div>';
  }

  function playbookPreviewHtml(card, pa) {
    if (!window.SALE_PLAYBOOK || typeof window.SALE_PLAYBOOK.draft !== 'function') return '';
    var actionType = mapBucketToActionType(card.bucket_id, card.state, card.lane);
    if (!actionType) return '';

    var sender = (pa && pa.action_payload && pa.action_payload.sender) || senderForType(card.job.type);
    var verdictMap = { auto_ok: 'auto_ok', approval_required: 'approval_required',
                       blocked: 'blocked', internal_only: 'internal' };
    var policyVerdict = card.verdict
      ? (card.verdict.blocked ? 'blocked'
         : card.verdict.internal_only ? 'internal'
         : card.verdict.auto_ok ? 'auto_ok'
         : 'approval_required')
      : 'approval_required';
    var synthCard = {
      id:             'render-' + (card.job.id || card.job.job_number) + '-' + actionType,
      job_id:         card.job.id || card.job.job_number,
      job_number:     card.job.job_number,
      owner_user_id:  sender && sender.user_id || null,
      owner_label:    sender && sender.label || '',
      lane:           card.lane,
      action_type:    actionType,
      priority:       card.urgency || 0,
      due_at:         null,
      customer_name:  card.job.client_name || '',
      suburb:         card.job.site_suburb || card.job.suburb || '',
      job_type:       card.job.type || 'unknown',
      value_inc_gst:  typeof card.job.value_inc_gst === 'number' ? card.job.value_inc_gst : null,
      why_now:        card.reason || '',
      evidence_refs:  [{ type: 'job', source_table: 'jobs', id: card.job.id || null }],
      policy_verdict: policyVerdict,
      created_at:     new Date().toISOString(),
      status:         'proposed',
    };
    var jobBrain = {
      job:            card.job,
      events:         (card._events || []).slice(),
      facts:          (card._facts || []).slice(),
      proposedActions: pa ? [pa] : [],
      conversation:   [],
      coaching:       [],
      calendar:       [],
    };
    var out;
    try {
      out = window.SALE_PLAYBOOK.draft({ card: synthCard, job_brain: jobBrain, now: new Date() });
    } catch (e) {
      return '';
    }
    if (!out) return '';
    if (!out.drafted_message && (!out.talk_track || !out.talk_track.length)) return '';

    var subjLine = out.drafted_subject
      ? '<div class="playbook-pre-subject"><strong>Subject:</strong> ' + esc(out.drafted_subject) + '</div>'
      : '';
    var bodyHtml = '';
    if (out.channel === 'call' && out.talk_track && out.talk_track.length) {
      bodyHtml = '<ul class="playbook-pre-talk">'
        + out.talk_track.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('')
        + '</ul>';
    } else if (out.drafted_message) {
      bodyHtml = '<div class="playbook-pre-body">' + esc(out.drafted_message) + '</div>';
    }
    var caveatsHtml = (out.caveats && out.caveats.length)
      ? '<div class="playbook-pre-caveats">' + out.caveats.map(esc).join(' · ') + '</div>'
      : '';
    var safetyHtml = (out.safety_notes && out.safety_notes.length)
      ? '<div class="playbook-pre-safety">⚠ ' + out.safety_notes.map(esc).join(' · ') + '</div>'
      : '';
    return [
      '<div class="playbook-preview" data-tone="' + esc(out.tone_variant) + '" data-channel="' + esc(out.channel) + '">',
        '<div class="playbook-pre-head">',
          '<span class="playbook-pre-label">PLAYBOOK PREVIEW (Loop 3 · fixture)</span>',
          '<span class="playbook-pre-tone">tone: ' + esc(out.tone_variant) + '</span>',
          '<span class="playbook-pre-channel">channel: ' + esc(out.channel) + '</span>',
          '<span class="playbook-pre-conf">' + Math.round((out.confidence || 0) * 100) + '%</span>',
        '</div>',
        subjLine,
        bodyHtml,
        caveatsHtml,
        safetyHtml,
      '</div>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Stub action card — Approve / Edit / Dismiss / Snooze / Why?
  // All buttons HTML-disabled. Tap fires console.info only.
  // ════════════════════════════════════════════════════════════

  function stubActionCard(card) {
    var pa = card.proposed_action;
    var verdict = card.verdict;
    var verdictBlock = '<div class="action-card-head" style="margin-bottom:6px">'
      + verdictChipHtml(verdict)
      + (pa ? ('<span class="action-type">' + esc(pa.action_type) + '</span>') : '')
      + (pa && pa.action_payload && pa.action_payload.angle ? angleChip(pa.action_payload.angle) : '')
      + '</div>'
      + verdictReasonsHtml(verdict);

    if (!pa) {
      return [
        '<div class="action-card" data-job="' + esc(card.job.job_number) + '">',
          verdictBlock,
          '<div class="action-empty">JARVIS has not proposed an action yet.</div>',
        '</div>',
      ].join('');
    }

    var sender = (pa.action_payload && pa.action_payload.sender) || senderForType(card.job.type);
    var msg = pa.drafted_message || '';
    var hasMsg = msg && msg.length > 0;

    var talk = pa.action_payload && pa.action_payload.talk_track;
    var talkBlock = '';
    if (Array.isArray(talk) && talk.length) {
      talkBlock = '<div class="action-talk"><div class="action-talk-head">What to say</div><ul>'
        + talk.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('')
        + '</ul></div>';
    }

    var note = pa.action_payload && pa.action_payload.note;
    var noteBlock = note ? '<div class="action-note">' + esc(note) + '</div>' : '';

    var why = (pa.action_payload && pa.action_payload.why) || '';
    var senderLabel = sender.label || sender.name || '';

    var playbookBlock = playbookPreviewHtml(card, pa);
    var cadenceBlock = cadencePositionHtml(card, pa);

    // Loop 6 — dry-run preview button. Separate from the HTML-disabled
    // Approve/Edit/Dismiss/Snooze controls (those stay disabled per
    // hard rules). This button is reachable, never fetches, only logs
    // the would-have-been-sent payload via SALE_DRY_RUN.execute().
    var dryRunBtn = window.SALE_DRY_RUN
      ? '<button class="btn-action btn-dryrun" data-dryrun-job="' + esc(card.job.job_number) + '" type="button">Preview dry-run</button>'
      : '';

    return [
      '<div class="action-card" data-job="' + esc(card.job.job_number) + '">',
        verdictBlock,
        '<div class="action-card-head">',
          '<span class="action-sender" title="Sender identity (type-based, unconditional)">From: ' + esc(senderLabel) + '</span>',
        '</div>',
        why ? ('<div class="action-why"><strong>Why now:</strong> ' + esc(why) + '</div>') : '',
        cadenceBlock,
        hasMsg ? ('<div class="action-msg">' + esc(msg) + '</div>') : '',
        talkBlock,
        noteBlock,
        playbookBlock,
        '<div class="action-controls">',
          '<button class="btn-action btn-approve" data-stub-action="approve" data-stub-job="' + esc(card.job.job_number) + '" disabled>Approve & send</button>',
          '<button class="btn-action btn-edit"    data-stub-action="edit"    data-stub-job="' + esc(card.job.job_number) + '" disabled>Edit</button>',
          '<button class="btn-action btn-dismiss" data-stub-action="dismiss" data-stub-job="' + esc(card.job.job_number) + '" disabled>Dismiss</button>',
          '<button class="btn-action btn-snooze"  data-stub-action="snooze"  data-stub-job="' + esc(card.job.job_number) + '" disabled>Snooze</button>',
          '<button class="btn-action btn-why"     data-stub-action="why"     data-stub-job="' + esc(card.job.job_number) + '" disabled>Why?</button>',
          dryRunBtn,
          '<button class="btn-action btn-open-job" data-open-job="' + esc(card.job.job_number) + '">Open job</button>',
        '</div>',
      '</div>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Loop 4 — pre-scope context block + booking proposal card.
  // Inline-only. No Telegram push. No network. Buttons disabled.
  // ════════════════════════════════════════════════════════════

  // Module-level cache for loaded playbooks + per-rep availability.
  // Populated lazily on first laneCard render that needs them.
  var _PLAYBOOKS_CACHE = null;
  var _AVAILABILITY_CACHE = {}; // { [repFirstName]: RepAvailability }

  // Triggers a re-render once an async load lands. Calls the
  // module-level render() if it exists; safe no-op otherwise.
  function rerenderLanes() {
    if (typeof render === 'function') {
      try { render(); } catch (e) { /* swallow render errors */ }
    }
  }

  function ensurePlaybooksLoaded() {
    if (_PLAYBOOKS_CACHE !== null) return _PLAYBOOKS_CACHE;
    if (!window.SALE_PLAYBOOK_LOADER) return null;
    // Kick off async load; render path uses fallback templates until
    // load resolves, then a re-render picks up the playbook path.
    _PLAYBOOKS_CACHE = {}; // sentinel: load in flight
    window.SALE_PLAYBOOK_LOADER.loadAll().then(function (map) {
      _PLAYBOOKS_CACHE = map;
      rerenderLanes();
    }).catch(function (err) {
      console.warn('[sale-preview] playbook loader failed; falling back to inline templates', err);
      _PLAYBOOKS_CACHE = {}; // empty map → fallback path
    });
    return _PLAYBOOKS_CACHE;
  }

  function ensureAvailabilityLoaded(repFirstName) {
    if (!repFirstName) return null;
    var cached = _AVAILABILITY_CACHE[repFirstName];
    if (cached) return cached;
    if (!window.SALE_AVAILABILITY) return null;
    _AVAILABILITY_CACHE[repFirstName] = 'loading';
    window.SALE_AVAILABILITY.load(repFirstName).then(function (avail) {
      _AVAILABILITY_CACHE[repFirstName] = avail;
      rerenderLanes();
    }).catch(function (err) {
      console.warn('[sale-preview] availability load failed for ' + repFirstName, err);
      _AVAILABILITY_CACHE[repFirstName] = null;
    });
    return null;
  }

  // Pre-scope context: lightweight job-context surface on the card.
  // Pulls last-message preview from card._events / job_brain if present;
  // otherwise renders empty placeholder.
  function preScopeContextHtml(card) {
    var job = card.job || {};
    var rows = [];
    rows.push('<div class="pre-scope-row"><span class="pre-scope-label">Customer</span>' + esc(job.client_name || '') + '</div>');
    rows.push('<div class="pre-scope-row"><span class="pre-scope-label">Address</span>' + esc(job.site_address || '') + ', ' + esc(job.site_suburb || '') + '</div>');
    rows.push('<div class="pre-scope-row"><span class="pre-scope-label">Job type</span>' + esc(job.type || 'unknown') + (typeof job.value_inc_gst === 'number' ? ' · ' + fmtCurrency(job.value_inc_gst) + ' inc' : '') + '</div>');
    if (typeof card.urgency === 'number') {
      rows.push('<div class="pre-scope-row"><span class="pre-scope-label">Priority</span>' + esc(String(Math.round(card.urgency))) + '</div>');
    }
    // Last message preview: pull most recent client.* event from card._events if present.
    var events = (card._events || []);
    var lastInbound = null;
    for (var i = events.length - 1; i >= 0; i--) {
      var ev = events[i];
      if (!ev) continue;
      if (ev.event_type === 'client.reply' || ev.event_type === 'client.question') {
        lastInbound = ev; break;
      }
    }
    if (lastInbound) {
      var t = (lastInbound.payload && (lastInbound.payload.message_text || lastInbound.payload.text)) || '';
      if (t) {
        rows.push('<div class="pre-scope-msg">"' + esc(t.length > 140 ? (t.slice(0, 140) + '…') : t) + '"</div>');
      }
    }
    // Access notes / important facts from card._facts (set by Slice 4B
    // live-mode index) — fall through silently if not present.
    var facts = (card._facts || []);
    var importantKinds = ['access_note', 'client_preference', 'availability_window', 'unusual_scope', 'payment_agreement'];
    var factLines = [];
    facts.forEach(function (f) {
      if (!f || importantKinds.indexOf(f.kind) === -1) return;
      var summary = f.value && (f.value.text || f.value.window || f.value.plan)
        || (f.value ? JSON.stringify(f.value) : '');
      factLines.push('<li><strong>' + esc(f.kind) + ':</strong> ' + esc(String(summary).slice(0, 100)) + '</li>');
    });
    if (factLines.length) {
      rows.push('<div class="pre-scope-row"><span class="pre-scope-label">Notes</span><ul style="margin:4px 0 0;padding-left:18px">' + factLines.join('') + '</ul></div>');
    }
    return [
      '<div class="pre-scope-context">',
        '<div class="pre-scope-head">PRE-SCOPE CONTEXT</div>',
        rows.join(''),
        '<div class="pre-scope-actions">',
          '<button class="btn-action" data-stub-action="open_conversation" data-stub-job="' + esc(job.job_number) + '" disabled>Open conversation</button>',
          '<button class="btn-action" data-stub-action="ask_jarvis" data-stub-job="' + esc(job.job_number) + '" disabled>Ask JARVIS</button>',
        '</div>',
      '</div>',
    ].join('');
  }

  // Booking proposal card: top 2-3 ranked candidate windows from
  // SALE_CALENDAR_PROPOSER. Renders as zone-dot rows with Approve/
  // Edit/Reject buttons (all HTML-disabled in Loop 4).
  function bookingProposalsHtml(card) {
    if (!window.SALE_CALENDAR_PROPOSER || !window.SALE_DRIVE_TIME) return '';
    if (!card.job) return '';
    // Resolve rep first name from job type.
    var sender = senderForType(card.job.type);
    var repName = sender && sender.name;
    if (!repName) return '';
    var repAvail = ensureAvailabilityLoaded(repName);
    if (!repAvail) return [
      '<div class="booking-proposals">',
        '<div class="booking-proposals-head">PROPOSED SCOPES</div>',
        '<div class="booking-proposals-empty">Loading availability for ' + esc(repName) + '...</div>',
      '</div>',
    ].join('');
    var playbooks = ensurePlaybooksLoaded() || {};
    var playbook = window.SALE_PLAYBOOK
      && window.SALE_PLAYBOOK._resolvePlaybookForCard
      && window.SALE_PLAYBOOK._resolvePlaybookForCard({
          job_type: card.job.type,
          action_type: 'book_scope',
        }, playbooks);
    var synthCard = {
      id: 'render-' + (card.job.id || card.job.job_number),
      job_id: card.job.id || card.job.job_number,
      job_number: card.job.job_number,
      customer_name: card.job.client_name || '',
      suburb: card.job.site_suburb || card.job.suburb || '',
      job_type: card.job.type || 'unknown',
      value_inc_gst: typeof card.job.value_inc_gst === 'number' ? card.job.value_inc_gst : null,
      priority: typeof card.urgency === 'number' ? card.urgency : 50,
      action_type: 'book_scope',
      evidence_refs: [{ type: 'job', source_table: 'jobs', id: card.job.id || null }],
      policy_verdict: 'approval_required',
    };
    var existingCalendar = (window.SALE_PREVIEW_FIXTURES
      && window.SALE_PREVIEW_FIXTURES.calendar
      && Array.isArray(window.SALE_PREVIEW_FIXTURES.calendar.slots))
      ? window.SALE_PREVIEW_FIXTURES.calendar.slots
      : [];
    var out;
    try {
      out = window.SALE_CALENDAR_PROPOSER.propose({
        card: synthCard,
        job_brain: { job: card.job, events: card._events || [] },
        rep_availability: repAvail,
        existing_calendar: existingCalendar,
        drive_time: window.SALE_DRIVE_TIME,
        playbook: playbook,
        now: new Date(),
      });
    } catch (e) {
      console.warn('[sale-preview] proposer threw', e);
      return '';
    }
    if (!out || !out.candidates) return '';
    if (!out.candidates.length) {
      return [
        '<div class="booking-proposals">',
          '<div class="booking-proposals-head">PROPOSED SCOPES</div>',
          '<div class="booking-proposals-empty">No availability windows fit. Check ' + esc(repName) + "'s availability.</div>",
        '</div>',
      ].join('');
    }
    var rows = out.candidates.map(function (c) {
      var dot = '<span class="availability-zone-dot availability-zone-' + esc(c.zone) + '"></span>';
      var sameDay = c.same_day ? '<span class="booking-same-day-tag">SAME-DAY</span>' : '';
      var when = c.day_name + ' ' + c.date.slice(5) + ' · ' + c.start + '–' + c.end;
      var meta = 'drive ' + c.drive_minutes_in + 'm in / ' + c.drive_minutes_out + 'm out · ' + c.zone + ' zone · ' + c.why + ' · score ' + c.rank_score;
      return [
        '<div class="booking-proposal">',
          dot,
          '<span class="booking-proposal-when">', esc(when), '</span>',
          sameDay,
          '<div class="booking-proposal-actions">',
            '<button class="btn-action" data-stub-action="book_approve" data-stub-job="' + esc(card.job.job_number) + '" disabled>Approve</button>',
            '<button class="btn-action" data-stub-action="book_edit"    data-stub-job="' + esc(card.job.job_number) + '" disabled>Edit</button>',
            '<button class="btn-action" data-stub-action="book_reject"  data-stub-job="' + esc(card.job.job_number) + '" disabled>Reject</button>',
          '</div>',
          '<div class="booking-proposal-meta">', esc(meta), '</div>',
        '</div>',
      ].join('');
    });
    return [
      '<div class="booking-proposals">',
        '<div class="booking-proposals-head">PROPOSED SCOPES (rank-ordered)</div>',
        rows.join(''),
        '<div class="booking-rationale">' + esc(out.rationale || '') + '</div>',
      '</div>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Lane card (Slice 2)
  // ════════════════════════════════════════════════════════════

  function laneCard(card) {
    var job = card.job;
    var meta = [];
    if (typeof job.value_inc_gst === 'number') meta.push(fmtCurrency(job.value_inc_gst) + ' inc');
    var caveat = job.source_caveat === 'quick_quote' ? quickQuoteChip() : '';
    var stateChip = card.state ? ('<span class="state-chip state-' + esc(card.state) + '">' + esc(card.state) + '</span>') : '';
    var dncChip = card.do_not_chase ? '<span class="caveat-chip" title="job_context.do_not_chase set">DO NOT CHASE</span>' : '';

    // Loop 4 — pre-scope context block + booking proposal card surface
    // for book_scope and appointment_confirm bucket cards. Both are
    // inline-only, read-only, no Telegram push, all buttons stubbed.
    var preScopeBlock = '';
    var bookingProposalsBlock = '';
    if (card.bucket_id === 'qualified_no_booking' || card.bucket_id === 'site_visit_no_scope') {
      preScopeBlock = preScopeContextHtml(card);
      bookingProposalsBlock = bookingProposalsHtml(card);
    }

    return [
      '<div class="loop-card" data-lane-card data-job-number="' + esc(job.job_number) + '">',
        '<div class="loop-card-head">',
          '<span class="loop-card-num">', esc(job.job_number), '</span>',
          typeBadge(job.type),
          stateChip,
          fixtureChip(),
          dncChip,
          caveat,
          meta.length ? ('<span class="loop-card-age">' + esc(meta.join(' · ')) + '</span>') : '',
        '</div>',
        '<div class="loop-card-body">',
          '<div class="loop-card-title">', esc(job.client_name), '</div>',
          '<div class="loop-card-suburb">', esc(job.site_suburb || job.suburb || ''), '</div>',
          '<div class="loop-card-reason">', esc(card.reason || ''), '</div>',
        '</div>',
        preScopeBlock,
        bookingProposalsBlock,
        stubActionCard(card),
      '</div>',
    ].join('');
  }

  function laneBucketHtml(bucket) {
    var head = [
      '<div class="bucket-head">',
        '<span class="bucket-title">', esc(bucket.title), '</span>',
        '<span class="bucket-count">', bucket.items.length, '</span>',
      '</div>',
    ].join('');
    var body = bucket.items.length
      ? bucket.items.map(laneCard).join('')
      : '<div class="bucket-empty">No items.</div>';
    return '<div class="bucket">' + head + '<div class="bucket-body">' + body + '</div></div>';
  }

  // ════════════════════════════════════════════════════════════
  // Performance strip (Slice 2)
  // ════════════════════════════════════════════════════════════

  function performanceStripHtml(perf) {
    perf = perf || { week_quoted_value: 0, week_won_value: 0, accepted_count: 0, queue_count: 0 };
    var quoted = fmtCurrency(perf.week_quoted_value || 0);
    var won = fmtCurrency(perf.week_won_value || 0);
    return [
      '<div class="perf-tile">',
        '<div class="perf-tile-label">Open queue</div>',
        '<div class="perf-tile-num">', perf.queue_count || 0, '</div>',
        '<div class="perf-tile-sub">draft + quoted + accepted (system-wide)</div>',
      '</div>',
      '<div class="perf-tile">',
        '<div class="perf-tile-label">Quoted this week</div>',
        '<div class="perf-tile-num">', esc(quoted || '$0'), '</div>',
        '<div class="perf-tile-sub">value of quotes sent in last 7d</div>',
      '</div>',
      '<div class="perf-tile">',
        '<div class="perf-tile-label">Won this week</div>',
        '<div class="perf-tile-num">', esc(won || '$0'), '</div>',
        '<div class="perf-tile-sub">', perf.accepted_count || 0, ' accepted</div>',
      '</div>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Calendar preview (today only)
  // ════════════════════════════════════════════════════════════

  function todayDayId(cal) {
    if (!cal || !Array.isArray(cal.windowDays)) return null;
    var today = cal.windowDays.find(function (d) {
      return d && (d.label === 'Today' || d.short === 'Today');
    });
    return today && today.id ? today.id : null;
  }

  function todaysSlots(cal) {
    if (!cal || !Array.isArray(cal.slots)) return [];
    var dayId = todayDayId(cal);
    return cal.slots
      .filter(function (s) {
        // Slice 4A: windowDays uses ISO ids; Slice 1 used string labels.
        // Match either to keep the renderer tolerant.
        return s.day === dayId || s.day === 'Today';
      })
      .slice()
      .sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
  }

  function calendarPreviewHtml(cal) {
    var slots = todaysSlots(cal);
    if (!slots.length) return '<div class="calprev-empty">No appointments fixture for Today.</div>';
    return slots.map(function (s) {
      var kindLabel = s.kind === 'proposed' ? 'PROPOSED' : 'BOOKED';
      var why = s.why ? ' <span class="calprev-why" style="color:var(--sw-mid);font-style:italic">— ' + esc(s.why) + '</span>' : '';
      return [
        '<div class="calprev-row kind-' + esc(s.kind || 'booked') + '" data-open-job="' + esc(s.job_number || '') + '">',
          '<span class="calprev-time">', esc(s.start), '–', esc(s.end), '</span>',
          '<span class="calprev-rep">', esc(s.rep), ' · ', kindLabel, '</span>',
          '<span class="calprev-meta"><b>', esc(s.client_name || ''), '</b> · ', esc(s.suburb || ''), ' · ', esc(s.job_number || ''), why, '</span>',
        '</div>',
      ].join('');
    }).join('');
  }

  // ════════════════════════════════════════════════════════════
  // Pipeline kanban (unchanged from Slice 1)
  // ════════════════════════════════════════════════════════════

  function renderPipelineCard(item) {
    var meta = [];
    if (typeof item.value_inc_gst === 'number') meta.push(fmtCurrency(item.value_inc_gst));
    if (typeof item.scheduled_in_days === 'number') meta.push('in ' + item.scheduled_in_days + 'd');
    var caveat = item.source_caveat === 'quick_quote' ? quickQuoteChip() : '';

    return [
      '<div class="pipe-card" data-open-job="' + esc(item.job_number) + '">',
        '<div class="pipe-card-head">',
          '<span class="pipe-card-num">', esc(item.job_number), '</span>',
          typeBadge(item.type),
        '</div>',
        '<div class="pipe-card-title">', esc(item.client_name), '</div>',
        '<div class="pipe-card-sub">', esc(item.suburb), meta.length ? (' · ' + esc(meta.join(' · '))) : '', '</div>',
        '<div class="pipe-card-foot">', fixtureChip(), ' ', caveat, '</div>',
      '</div>',
    ].join('');
  }

  function renderPipeline() {
    var pipeline = window.SALE_PREVIEW_FIXTURES.pipeline || {};
    var columns = ['draft', 'quoted', 'accepted', 'scheduled', 'done'];
    var titles = { draft: 'Draft', quoted: 'Quoted', accepted: 'Accepted', scheduled: 'Scheduled', done: 'Done' };

    return columns.map(function (col) {
      var items = pipeline[col] || [];
      return [
        '<div class="pipe-col">',
          '<div class="pipe-col-head">',
            '<span class="pipe-col-title">', titles[col], '</span>',
            '<span class="pipe-col-count">', items.length, '</span>',
          '</div>',
          '<div class="pipe-col-body">',
            items.map(renderPipelineCard).join(''),
          '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  // ════════════════════════════════════════════════════════════
  // Calendar tab — Slice 4A weekly 7-day grid, single rep
  // ════════════════════════════════════════════════════════════

  var CALENDAR_REP = 'Nithin'; // default; flips via .cal-rep-chip click

  function renderCalendar(repFilter) {
    var cal = window.SALE_PREVIEW_FIXTURES.calendar;
    if (!cal || !Array.isArray(cal.windowDays)) return '<div class="cal-empty">Calendar fixture missing.</div>';
    var rep = repFilter || CALENDAR_REP;
    var todayId = todayDayId(cal);

    return [
      '<div class="cal-week-grid">',
        cal.windowDays.map(function (day) {
          var dayId = day.id;
          var label = day.label || day.short || dayId;
          var slots = (cal.slots || []).filter(function (s) {
            return s.rep === rep && s.day === dayId;
          }).sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
          var slotHtml = slots.length
            ? slots.map(function (s) {
                var kindLabel = s.kind === 'proposed' ? 'PROPOSED' : 'BOOKED';
                var jobNum = s.job_number || '';
                var openAttr = jobNum ? (' data-open-job="' + esc(jobNum) + '"') : '';
                return [
                  '<div class="cal-week-slot ' + esc(s.kind || 'booked') + '"' + openAttr + '>',
                    '<div class="cal-week-slot-time">', esc(s.start), '–', esc(s.end), ' · ', kindLabel, '</div>',
                    '<div class="cal-week-slot-meta"><b>', esc(s.client_name || '—'), '</b> · ', esc(s.suburb || ''), '</div>',
                    s.why ? '<div class="cal-week-slot-why">' + esc(s.why) + '</div>' : '',
                  '</div>',
                ].join('');
              }).join('')
            : '<div class="cal-week-day-empty">No slots.</div>';
          return [
            '<div class="cal-week-day' + (dayId === todayId ? ' today' : '') + '">',
              '<div class="cal-week-day-head">', esc(label), day.short && day.short !== label ? ' <span style="font-weight:400">' + esc(day.short) + '</span>' : '', '</div>',
              slotHtml,
            '</div>',
          ].join('');
        }).join(''),
      '</div>',
      '<div class="cal-legend" style="margin-top:12px">',
        '<span class="cal-legend-item"><span class="cal-legend-dot cal-legend-booked"></span> Booked (real GHL appointments — empty in Slice 4A; this is fixture)</span>',
        '<span class="cal-legend-item"><span class="cal-legend-dot cal-legend-proposed"></span> Proposed by JARVIS (preview only — does not write to GHL)</span>',
      '</div>',
    ].join('');
  }

  // ════════════════════════════════════════════════════════════
  // Performance tab (system-wide totals — unchanged from Slice 1)
  // ════════════════════════════════════════════════════════════

  function statCard(label, value, sub) {
    return [
      '<div class="perf-stat">',
        '<div class="perf-stat-label">', esc(label), '</div>',
        '<div class="perf-stat-value">', esc(value), '</div>',
        sub ? '<div class="perf-stat-sub">' + esc(sub) + '</div>' : '',
      '</div>',
    ].join('');
  }

  function renderPerformance() {
    var p = window.SALE_PREVIEW_FIXTURES.performance;
    if (!p) return '<div class="perf-empty">Performance fixture missing.</div>';
    var t = p.totals;
    var html = [];
    html.push('<div class="perf-window">' + esc(p.window) + ' · system-wide totals (fixture)</div>');
    html.push('<div class="perf-grid">');
    html.push(statCard('Leads', t.leads));
    html.push(statCard('Booked scopes', t.booked_scopes));
    html.push(statCard('Quotes sent', t.quotes_sent, fmtCurrency(t.quote_value_sent) + ' total'));
    html.push(statCard('Accepted', t.accepted, fmtCurrency(t.revenue_won) + ' revenue'));
    html.push(statCard('Conversion', t.conversion_pct.toFixed(1) + '%', 'lead → accepted'));
    html.push('</div>');

    html.push('<div class="perf-velocity-head">Funnel velocity (median days, system-wide)</div>');
    html.push('<div class="perf-velocity">');
    (p.velocity || []).forEach(function (v) {
      html.push('<div class="perf-vel-row">'
        + '<span class="perf-vel-label">' + esc(v.from) + ' → ' + esc(v.to) + '</span>'
        + '<span class="perf-vel-bar"><span class="perf-vel-fill" style="width:' + Math.min(100, Math.round(v.median_days * 10)) + '%"></span></span>'
        + '<span class="perf-vel-days">' + esc(v.median_days.toFixed(1)) + 'd</span>'
        + '</div>');
    });
    html.push('</div>');

    if (p.perRep && p.perRep.disabled) {
      html.push('<div class="perf-perrep-disabled">'
        + '<div class="perf-perrep-head"><strong>Per-rep breakdown</strong> <span class="disabled-badge">DISABLED</span></div>'
        + '<div class="perf-perrep-reason">' + esc(p.perRep.reason) + '</div>'
        + '</div>');
    }

    // Loop 5 — outcome attribution snapshot. Read-only.
    html.push(renderOutcomeAttribution());

    return html.join('');
  }

  // Loop 5 — Outcome attribution + leaderboard. Reads
  // SALE_OUTCOMES.attribute() over the JobBrain index. All values
  // are derived; nothing is sent or written.
  function renderOutcomeAttribution() {
    if (!window.SALE_OUTCOMES || typeof window.SALE_OUTCOMES.attribute !== 'function') return '';
    var src = _activeDataSource();
    var jobs = src.jobs || [];
    var events = src.events || [];
    var playbooks = _PLAYBOOKS_CACHE || {};
    var nowIso = (src.generatedAt || src.engineNow || new Date().toISOString());
    var nowDate = new Date(nowIso);
    var attr;
    try {
      attr = window.SALE_OUTCOMES.attribute({
        jobs:      jobs,
        events:    events,
        playbooks: playbooks,
        now:       nowDate,
      });
    } catch (e) {
      console.warn('[sale-preview] outcome attribution threw', e);
      return '';
    }
    if (!attr) return '';
    var html = [];
    html.push('<div class="perf-outcomes-head">Per-rep this week <span class="fixture-chip">LOOP 5</span></div>');
    html.push('<div class="perf-outcomes-grid">');
    var reps = ['Nithin', 'Khairo'];
    reps.forEach(function (rep) {
      var w = attr.per_rep_week[rep];
      if (!w) {
        html.push('<div class="perf-rep-card perf-rep-empty">'
          + '<div class="perf-rep-name">' + esc(rep) + '</div>'
          + '<div class="perf-rep-empty-text">No quotes in window.</div>'
          + '</div>');
        return;
      }
      html.push('<div class="perf-rep-card">');
      html.push('<div class="perf-rep-name">' + esc(rep) + '</div>');
      html.push('<div class="perf-rep-row"><span>Quotes sent</span><strong>' + w.quotes_sent + '</strong></div>');
      html.push('<div class="perf-rep-row"><span>Accepted</span><strong>' + w.quotes_accepted + ' · ' + fmtCurrency(w.$_accepted) + '</strong></div>');
      html.push('<div class="perf-rep-row"><span>Declined</span><strong>' + w.quotes_declined + '</strong></div>');
      html.push('<div class="perf-rep-row"><span>In flight</span><strong>' + w.in_flight + '</strong></div>');
      html.push('<div class="perf-rep-row"><span>Conversion</span><strong>' + w.conversion_pct.toFixed(1) + '%</strong></div>');
      var ttc = w.median_time_to_close_h;
      var ttcLabel = ttc === null ? '–'
        : ttc < 24 ? (ttc.toFixed(1) + 'h')
        : (Math.floor(ttc / 24) + 'd ' + Math.round(ttc % 24) + 'h');
      html.push('<div class="perf-rep-row"><span>Median time-to-close</span><strong>' + esc(ttcLabel) + '</strong></div>');
      var ab = w.attribution_breakdown || {};
      var abKeys = Object.keys(ab);
      if (abKeys.length) {
        html.push('<div class="perf-rep-attribution">');
        html.push('<span class="perf-rep-attribution-head">Attribution rung:</span> ');
        html.push(abKeys.map(function (k) {
          return '<span class="perf-rep-attribution-pill" data-rung="' + esc(k) + '">' + esc(k) + ' · ' + ab[k] + '</span>';
        }).join(' '));
        html.push('</div>');
      }
      html.push('</div>');
    });
    html.push('</div>');

    // Loop 6 — Recent dry-runs expander (Marnin-only).
    if (window.SALE_DRY_RUN && typeof window.SALE_DRY_RUN.recentLog === 'function') {
      var recent = window.SALE_DRY_RUN.recentLog({ limit: 20 });
      html.push('<details class="perf-dryrun">');
      html.push('<summary class="perf-dryrun-head">Recent dry-runs <span class="fixture-chip">marnin-only · ' + recent.length + '</span></summary>');
      if (recent.length === 0) {
        html.push('<div class="perf-dryrun-empty">No dry-runs logged this session. Tap an Approve / Edit button on a follow-up card to log one.</div>');
      } else {
        html.push('<table class="perf-dryrun-table"><thead><tr>'
          + '<th>When</th><th>action_id</th><th>Would send</th><th>Blockers</th>'
          + '</tr></thead><tbody>');
        recent.forEach(function (entry) {
          var when = entry.created_at ? entry.created_at.slice(11, 19) : '–';
          var verdict = entry.would_send
            ? '<span class="dryrun-verdict dryrun-verdict-yes">YES</span>'
            : '<span class="dryrun-verdict dryrun-verdict-no">NO</span>';
          var blockers = (entry.blockers || []).join(', ') || '—';
          html.push('<tr>'
            + '<td>' + esc(when) + '</td>'
            + '<td>' + esc(entry.action_id || '—') + '</td>'
            + '<td>' + verdict + '</td>'
            + '<td>' + esc(blockers) + '</td>'
            + '</tr>');
        });
        html.push('</tbody></table>');
      }
      html.push('</details>');
    }

    if (attr.leaderboard && attr.leaderboard.length) {
      html.push('<div class="perf-leaderboard">');
      html.push('<div class="perf-leaderboard-head">CEO leaderboard <span class="fixture-chip">marnin-only</span></div>');
      html.push('<table class="perf-leaderboard-table"><thead><tr>'
        + '<th>Rank</th><th>Rep</th><th>$ Won</th><th>Conversion</th><th>Δ vs prior week</th>'
        + '</tr></thead><tbody>');
      attr.leaderboard.forEach(function (row) {
        var deltaTxt = row.delta_vs_prior_week === 0 ? '—'
          : (row.delta_vs_prior_week > 0 ? '↑ ' : '↓ ') + fmtCurrency(Math.abs(row.delta_vs_prior_week));
        html.push('<tr>'
          + '<td>' + row.rank + '</td>'
          + '<td>' + esc(row.rep_first_name) + '</td>'
          + '<td>' + fmtCurrency(row.$_accepted_this_week) + '</td>'
          + '<td>' + row.conversion_pct.toFixed(1) + '%</td>'
          + '<td>' + esc(deltaTxt) + '</td>'
          + '</tr>');
      });
      html.push('</tbody></table>');
      html.push('</div>');
    }
    return html.join('');
  }

  // ════════════════════════════════════════════════════════════
  // Lead source / disabled tiles / stream-mismatch chip (legacy footer)
  // ════════════════════════════════════════════════════════════

  function renderLeadSource() {
    var rows = window.SALE_PREVIEW_FIXTURES.leadSource90d || [];
    var max = rows.reduce(function (m, r) { return Math.max(m, r.count); }, 1);
    return rows.map(function (r) {
      var pct = Math.round((r.count / max) * 100);
      return [
        '<div class="ls-row">',
          '<div class="ls-label">', esc(r.source), '</div>',
          '<div class="ls-bar-track"><div class="ls-bar-fill" style="width:', pct, '%"></div></div>',
          '<div class="ls-count">', r.count, '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  function renderDisabledTiles() {
    var tiles = window.SALE_PREVIEW_FIXTURES.disabled || [];
    return tiles.map(function (t) {
      return [
        '<div class="disabled-tile">',
          '<div class="disabled-tile-head">',
            '<span class="disabled-tile-title">', esc(t.title), '</span>',
            '<span class="disabled-badge">DISABLED</span>',
          '</div>',
          '<div class="disabled-tile-reason">', esc(t.reason), '</div>',
          '<div class="disabled-tile-detail">', esc(t.detail), '</div>',
        '</div>',
      ].join('');
    }).join('');
  }

  // ════════════════════════════════════════════════════════════
  // Memory panel (Slice 1, lightly adjusted for Slice 2 fixture shape)
  // ════════════════════════════════════════════════════════════

  function findJobByNumber(jobNumber) {
    var F = window.SALE_PREVIEW_FIXTURES || {};
    var jobs = F.jobs || [];
    var found = jobs.find(function (j) { return j.job_number === jobNumber; });
    if (found) return found;
    var pipeline = F.pipeline || {};
    var pipelineCols = ['draft', 'quoted', 'accepted', 'scheduled', 'done'];
    for (var i = 0; i < pipelineCols.length; i++) {
      var col = pipeline[pipelineCols[i]] || [];
      var hit = col.find(function (j) { return j.job_number === jobNumber; });
      if (hit) return hit;
    }
    return null;
  }

  // Slice 4B Path A — current-render state used by every downstream
  // consumer (verdicts, peek, memory panel) so live-mode lane cards
  // get verdicts computed against LIVE events/facts, not fixture
  // residue. _renderFromIndex updates this on every render.
  var _CURRENT_INDEX = null;
  var _IS_LIVE_MODE = false;

  function _activeDataSource() {
    // When _CURRENT_INDEX is set, prefer it (matches the data the
    // lanes were derived from). Otherwise fall back to fixtures so
    // the legacy memory panel still renders during early init.
    if (_CURRENT_INDEX) return _CURRENT_INDEX;
    return window.SALE_PREVIEW_FIXTURES || {};
  }

  function recentEventsFor(jobId) {
    var src = _activeDataSource();
    var events = src.events || [];
    return events.filter(function (e) { return e && e.job_id === jobId; });
  }

  function proposedActionFor(jobId) {
    var src = _activeDataSource();
    var pas = src.proposedActions || [];
    return pas.find(function (p) { return p && p.job_id === jobId && p.status === 'proposed'; }) || null;
  }

  function factsFor(jobId) {
    var src = _activeDataSource();
    var ctx = src.jobContext || {};
    return ctx[jobId] || [];
  }

  function renderMemoryPanel(jobNumber) {
    var job = findJobByNumber(jobNumber);
    if (!job) {
      return '<div class="memory-empty">Job not found: ' + esc(jobNumber) + '</div>';
    }
    var sender = senderForType(job.type);
    // Slice 4B Path A — read from active data source (live index
    // when present, fixture as fallback) so live-mode reps see
    // their actual context, not fixture residue.
    var ctx = factsFor(job.id);
    var pa = proposedActionFor(job.id);
    var events = recentEventsFor(job.id).slice().sort(function (a, b) {
      return (b.occurred_at || '').localeCompare(a.occurred_at || '');
    }).slice(0, 5);

    var ctxBlock = ctx.length
      ? '<ul class="mem-ctx-list">' + ctx.map(function (f) {
          var prov = f.provenance ? (' <span class="mem-prov">' + esc(f.provenance.source || '') + ' · ' + esc(f.provenance.promoted_at || '') + (f.provenance.untrusted ? ' · untrusted' : '') + '</span>') : '';
          return '<li><span class="mem-kind">' + esc(f.kind) + '</span> ' + esc(JSON.stringify(f.value)) + prov + '</li>';
        }).join('') + '</ul>'
      : '<div class="mem-ctx-empty">No job_context facts on file for this job.</div>';

    var eventsBlock = events.length
      ? '<ul class="mem-events">' + events.map(function (e) {
          var msg = e.payload && (e.payload.message_text || e.payload.text);
          var msgStr = msg ? ' — ' + esc(msg) : '';
          return '<li>' + esc(e.event_type) + ' · ' + esc(e.occurred_at) + msgStr + '</li>';
        }).join('') + '</ul>'
      : '<ul class="mem-events"><li>No events on file for this job.</li></ul>';

    var verdict = null;
    if (pa && window.SALE_POLICY && typeof window.SALE_POLICY.evaluate === 'function') {
      var srcNow = (_CURRENT_INDEX && _CURRENT_INDEX.generatedAt) || (window.SALE_PREVIEW_FIXTURES && window.SALE_PREVIEW_FIXTURES.engineNow);
      verdict = window.SALE_POLICY.evaluate({
        action: pa, job: job, facts: ctx, recentEvents: events,
        now: srcNow ? new Date(srcNow) : new Date(),
      });
    }

    var actionMirror = pa ? [
      '<div class="mem-action-head">Active proposed action</div>',
      '<div class="mem-action-mirror">',
        verdictChipHtml(verdict), ' ',
        '<span class="action-type">' + esc(pa.action_type) + '</span> ',
        angleChip(pa.action_payload && pa.action_payload.angle),
        '<div class="mem-action-msg">' + esc(pa.drafted_message || '(no drafted message — call/internal)') + '</div>',
        verdictReasonsHtml(verdict),
      '</div>',
    ].join('') : '<div class="mem-action-empty">No proposed action right now.</div>';

    return [
      '<div class="mem-head">',
        '<div class="mem-head-num">', esc(job.job_number), '</div>',
        '<div class="mem-head-title">', esc(job.client_name), ' — ', esc(job.site_suburb || job.suburb || ''), '</div>',
        '<button class="mem-close" data-mem-close>×</button>',
      '</div>',
      '<div class="mem-meta">',
        typeBadge(job.type), ' ',
        '<span class="mem-sender" title="Sender identity (type-based, unconditional)">From: ', esc(sender.label), '</span>',
        typeof job.value_inc_gst === 'number' ? (' <span class="mem-value">' + esc(fmtCurrency(job.value_inc_gst)) + ' inc</span>') : '',
      '</div>',
      '<div class="mem-section">',
        '<div class="mem-section-head">job_context (top facts)</div>',
        ctxBlock,
      '</div>',
      '<div class="mem-section">',
        '<div class="mem-section-head">Recent events (fixture-derived)</div>',
        eventsBlock,
      '</div>',
      '<div class="mem-section">',
        actionMirror,
      '</div>',
    ].join('');
  }

  function openMemoryPanel(jobNumber) {
    var panel = $('#memoryPanel');
    var body = $('#memoryPanelBody');
    if (!panel || !body) return;
    body.innerHTML = renderMemoryPanel(jobNumber);
    panel.classList.add('mem-open');
    document.body.classList.add('mem-locked');
    console.info('[sale-preview] memory panel opened', { job: jobNumber, note: 'No fetch fired.' });
  }

  function closeMemoryPanel() {
    var panel = $('#memoryPanel');
    if (!panel) return;
    panel.classList.remove('mem-open');
    document.body.classList.remove('mem-locked');
  }

  // ════════════════════════════════════════════════════════════
  // Product review pass — Lifecycle states preview (display-only)
  // ════════════════════════════════════════════════════════════

  function fmtRelativeFromBaseline(iso, nowMs, dirHint) {
    if (!iso) return '';
    var t = +new Date(iso);
    if (isNaN(t)) return '';
    var diff = dirHint === 'future' ? (t - nowMs) : (nowMs - t);
    if (diff < 0) diff = -diff;
    var hours = Math.round(diff / 3600e3);
    if (hours < 1) {
      var minutes = Math.max(1, Math.round(diff / 60e3));
      return minutes + 'm';
    }
    if (hours < 24) return hours + 'h';
    return Math.round(hours / 24) + 'd';
  }

  function lifecycleStatusLine(state, nowMs) {
    if (state._state === 'edit-open' && state.draft_modified_at) {
      return '<strong>Editing draft</strong> · last touched ' + esc(fmtRelativeFromBaseline(state.draft_modified_at, nowMs)) + ' ago';
    }
    if (state._state === 'approved-pending' && state.approved_at) {
      return '<strong>Approved</strong> · queued for send (' + esc(fmtRelativeFromBaseline(state.approved_at, nowMs)) + ' ago)';
    }
    if (state._state === 'rejected') {
      var when = state.dismissed_at ? esc(fmtRelativeFromBaseline(state.dismissed_at, nowMs)) + ' ago' : 'just now';
      return '<strong>Dismissed</strong> · ' + when + (state.dismiss_reason ? ' — ' + esc(state.dismiss_reason) : '');
    }
    if (state._state === 'snoozed' && state.snooze_until) {
      return '<strong>Snoozed</strong> · re-appears in ' + esc(fmtRelativeFromBaseline(state.snooze_until, nowMs, 'future'));
    }
    if (state._state === 'blocked') {
      return '<strong>Blocked by policy</strong> · SMS action but no <code>client_phone</code> on the job — outbound refuses.';
    }
    return '';
  }

  function lifecycleCardHtml(state, nowMs) {
    var stateName = (state._state || 'unknown');
    var stateLabel = stateName.replace(/-/g, ' ');
    var muted = stateName === 'rejected' ? ' muted' : '';
    var pa = state; // the lifecycle state IS a proposed-action-shaped row
    var sender = (pa.action_payload && pa.action_payload.sender) || senderForType(state.type);
    var why = (pa.action_payload && pa.action_payload.why) || '';
    var statusLine = lifecycleStatusLine(state, nowMs);

    // Synthesise a verdict for the BLOCKED state so the chip renders
    // truthfully via the policy module. Other states get a synthetic
    // chip that reflects their lifecycle status.
    var verdictChip;
    if (stateName === 'blocked' && window.SALE_POLICY && typeof window.SALE_POLICY.evaluate === 'function') {
      var fakeJob = { id: state.job_id, type: state.type, client_phone: null, client_email: 'demo@y.test' };
      var v = window.SALE_POLICY.evaluate({ action: pa, job: fakeJob, facts: [], recentEvents: [], now: new Date(nowMs) });
      verdictChip = verdictChipHtml(v);
    } else if (stateName === 'edit-open') {
      verdictChip = '<span class="verdict-chip verdict-approve" title="approval required (edit in progress)">EDITING</span>';
    } else if (stateName === 'approved-pending') {
      verdictChip = '<span class="verdict-chip verdict-auto" title="approved · queued for send">APPROVED</span>';
    } else if (stateName === 'rejected') {
      verdictChip = '<span class="verdict-chip verdict-internal" title="rep dismissed">DISMISSED</span>';
    } else if (stateName === 'snoozed') {
      verdictChip = '<span class="verdict-chip verdict-approve" title="snoozed">SNOOZED</span>';
    } else {
      verdictChip = '';
    }

    // Edit-open shows the message as an editable textarea (disabled).
    var msgBlock;
    if (stateName === 'edit-open') {
      msgBlock = '<textarea class="lifecycle-card-edit-textarea" disabled>'
        + esc(pa.drafted_message || '') + '</textarea>';
    } else if (stateName === 'blocked' || !pa.drafted_message) {
      msgBlock = pa.drafted_message
        ? '<div class="action-msg">' + esc(pa.drafted_message) + '</div>'
        : '';
    } else {
      msgBlock = '<div class="action-msg">' + esc(pa.drafted_message) + '</div>';
    }

    // Controls — disabled for ALL lifecycle states (display-only).
    var controls;
    if (stateName === 'edit-open') {
      controls = [
        '<button class="btn-action btn-approve" disabled>Send edit</button>',
        '<button class="btn-action btn-snooze" disabled>Cancel</button>',
      ].join('');
    } else if (stateName === 'approved-pending') {
      controls = [
        '<button class="btn-action btn-snooze" disabled>Cancel send</button>',
      ].join('');
    } else if (stateName === 'rejected') {
      controls = [
        '<button class="btn-action btn-edit" disabled>Restore</button>',
      ].join('');
    } else if (stateName === 'snoozed') {
      controls = [
        '<button class="btn-action btn-approve" disabled>Resume now</button>',
        '<button class="btn-action btn-dismiss" disabled>Dismiss</button>',
      ].join('');
    } else if (stateName === 'blocked') {
      controls = [
        '<button class="btn-action btn-dismiss" disabled>Dismiss</button>',
      ].join('');
    } else {
      controls = '';
    }

    return [
      '<div class="lifecycle-card' + muted + '" data-state="' + esc(stateName) + '">',
        '<span class="lifecycle-card-state s-' + esc(stateName) + '">' + esc(stateLabel) + '</span>',
        statusLine ? '<div class="lifecycle-card-status-line">' + statusLine + '</div>' : '',
        '<div class="loop-card-head">',
          '<span class="loop-card-num">', esc(state.job_number || ''), '</span>',
          typeBadge(state.type),
          fixtureChip(),
        '</div>',
        '<div class="loop-card-title">', esc(state.client_name || ''), '</div>',
        '<div class="loop-card-suburb">', esc(state.suburb || ''), '</div>',
        '<div class="action-card-head">',
          verdictChip,
          '<span class="action-type">', esc(pa.action_type || ''), '</span>',
          '<span class="action-sender">From: ', esc(sender.label || sender.name || ''), '</span>',
        '</div>',
        why ? '<div class="action-why"><strong>Why now:</strong> ' + esc(why) + '</div>' : '',
        msgBlock,
        controls ? '<div class="action-controls">' + controls + '</div>' : '',
      '</div>',
    ].join('');
  }

  function renderLifecycleStates(states, nowMs) {
    if (!Array.isArray(states) || !states.length) {
      return '<div class="bucket-empty">No lifecycle states to preview.</div>';
    }
    return states.map(function (s) { return lifecycleCardHtml(s, nowMs); }).join('');
  }

  // ════════════════════════════════════════════════════════════
  // Slice 4A — Coaching strip (lane summaries above the lanes)
  // ════════════════════════════════════════════════════════════

  function renderCoachingStrip(coaching) {
    var lanes = ['book', 'send', 'call'];
    return lanes.map(function (lane) {
      var hint = (coaching || []).find(function (c) {
        return c && c.scope === 'lane' && c.related_lane === lane;
      });
      var laneLabel = lane === 'send' ? 'Follow Ups' : (lane.charAt(0).toUpperCase() + lane.slice(1));
      if (!hint) {
        return [
          '<div class="coaching-card" data-lane="' + esc(lane) + '">',
            '<div class="coaching-card-head">',
              '<span class="coaching-card-lane">', laneLabel, '</span>',
              '<span class="coaching-card-conf">no hint</span>',
            '</div>',
            '<div class="coaching-card-text" style="color:var(--sw-text-sec);font-style:italic">No coaching for this lane right now.</div>',
          '</div>',
        ].join('');
      }
      var conf = typeof hint.confidence === 'number'
        ? Math.round(hint.confidence * 100) + '%'
        : '';
      return [
        '<div class="coaching-card" data-lane="' + esc(lane) + '">',
          '<div class="coaching-card-head">',
            '<span class="coaching-card-lane">', laneLabel, '</span>',
            conf ? '<span class="coaching-card-conf">' + esc(conf) + '</span>' : '',
          '</div>',
          '<div class="coaching-card-text">', esc(hint.text || ''), '</div>',
          (hint.playbook || hint.caveat) ? [
            '<div class="coaching-card-foot">',
              hint.playbook ? '<span class="coaching-card-playbook">' + esc(hint.playbook) + '</span>' : '',
              hint.playbook && hint.caveat ? ' · ' : '',
              hint.caveat ? esc(hint.caveat) : '',
            '</div>',
          ].join('') : '',
        '</div>',
      ].join('');
    }).join('');
  }

  // ════════════════════════════════════════════════════════════
  // Slice 4A — Conversation peek (centred modal, fixture-only)
  // ════════════════════════════════════════════════════════════

  function fmtRelative(iso, nowMs) {
    if (!iso) return '';
    var t = +new Date(iso);
    if (isNaN(t)) return '';
    var diff = nowMs - t;
    var hours = Math.round(diff / (60 * 60 * 1000));
    if (hours < 24) return hours + 'h ago';
    var days = Math.round(hours / 24);
    return days + 'd ago';
  }

  function channelChip(ch) {
    var label = (ch || 'note').toUpperCase();
    return '<span class="msg-channel-chip">' + esc(label) + '</span>';
  }

  function renderConversationPane(conversation, nowMs) {
    if (!conversation || !conversation.length) {
      return '<div class="peek-pane-empty">No conversation history on file for this fixture job.</div>';
    }
    return [
      '<div class="msg-thread">',
        conversation.map(function (m) {
          var dir = m.direction || 'system';
          var meta = [
            channelChip(m.channel),
            esc(m.author || ''),
            esc(fmtRelative(m.occurred_at, nowMs)),
          ].filter(Boolean).join(' · ');
          var subj = m.subject ? '<div class="msg-subject">' + esc(m.subject) + '</div>' : '';
          return [
            '<div class="msg-bubble ' + esc(dir) + '">',
              '<div class="msg-meta">' + meta + '</div>',
              subj,
              '<div class="msg-body">', esc(m.body || ''), '</div>',
            '</div>',
          ].join('');
        }).join(''),
      '</div>',
    ].join('');
  }

  function renderFactsPane(facts) {
    if (!facts || !facts.length) {
      return '<div class="peek-pane-empty">No <code>job_context</code> facts on file.</div>';
    }
    return [
      '<ul class="mem-ctx-list">',
        facts.map(function (f) {
          var prov = f.provenance ? (
            ' <span class="mem-prov" style="color:var(--sw-text-sec);font-size:11px">'
            + esc((f.provenance.source || '') + ' · ' + (f.provenance.promoted_at || ''))
            + (f.provenance.untrusted ? ' · untrusted' : '')
            + '</span>'
          ) : '';
          return '<li><span class="mem-kind"><b>' + esc(f.kind) + '</b></span> ' + esc(JSON.stringify(f.value)) + prov + '</li>';
        }).join(''),
      '</ul>',
    ].join('');
  }

  function renderEventsPane(events, nowMs) {
    if (!events || !events.length) {
      return '<div class="peek-pane-empty">No <code>business_events</code> on file for this job.</div>';
    }
    return [
      '<ul class="mem-events">',
        events.slice(0, 10).map(function (e) {
          var msg = e.payload && (e.payload.message_text || e.payload.text);
          var msgStr = msg ? ' — ' + esc(msg) : '';
          return '<li><b>' + esc(e.event_type) + '</b> · ' + esc(fmtRelative(e.occurred_at, nowMs)) + msgStr + '</li>';
        }).join(''),
      '</ul>',
    ].join('');
  }

  function renderVerdictPane(brain, F, now) {
    var pa = (brain.proposedActions || [])[0];
    if (!pa) {
      // Show only coaching for this job, since there's no active action.
      var jobCoaching = (brain.coaching || []).filter(function (c) {
        return c && c.scope === 'job';
      });
      if (!jobCoaching.length) {
        return '<div class="peek-pane-empty">No active proposed action and no coaching hints for this job.</div>';
      }
      return jobCoaching.map(function (c) {
        return '<div class="verdict-trail-card">'
          + '<b>' + esc(c.playbook || 'pattern') + '</b><br>'
          + esc(c.text || '')
          + '</div>';
      }).join('');
    }
    var verdict = null;
    if (window.SALE_POLICY && typeof window.SALE_POLICY.evaluate === 'function') {
      // Slice 4B Path A — read facts/events from the brain payload
      // we just loaded (which honours forceFixtures), not the
      // fixture global. Verdict matches the data the rep is seeing.
      var facts = brain.facts || [];
      var recent = brain.events || [];
      verdict = window.SALE_POLICY.evaluate({
        action: pa, job: brain.job, facts: facts, recentEvents: recent, now: now,
      });
    }
    var verdictBlock = verdict ? [
      '<div style="margin-bottom:10px">',
        verdictChipHtml(verdict), ' ',
        '<span class="action-type">' + esc(pa.action_type) + '</span>',
      '</div>',
      verdictReasonsHtml(verdict),
    ].join('') : '';
    var actionCoaching = (brain.coaching || []).filter(function (c) {
      return c && c.scope === 'action' && c.related_action_id === pa.id;
    });
    var jobCoaching = (brain.coaching || []).filter(function (c) {
      return c && c.scope === 'job';
    });
    var coachingHtml = (actionCoaching.concat(jobCoaching)).map(function (c) {
      return '<div class="verdict-trail-card"><b>' + esc(c.playbook || 'pattern') + '</b><br>' + esc(c.text || '') + '</div>';
    }).join('');
    return verdictBlock + (coachingHtml || '');
  }

  function renderPeekPane(name, brain, F, now) {
    var nowMs = +(now instanceof Date ? now : new Date(now));
    if (name === 'conversation') return renderConversationPane(brain.conversation, nowMs);
    if (name === 'facts')        return renderFactsPane(brain.facts);
    if (name === 'events')       return renderEventsPane(brain.events, nowMs);
    if (name === 'verdict')      return renderVerdictPane(brain, F, now);
    return '';
  }

  var PEEK_STATE = {
    open: false,
    activeTab: 'conversation',
    brain: null,
  };

  function openConversationPeek(jobNumber) {
    if (!window.SALE_JOB_BRAIN || typeof window.SALE_JOB_BRAIN.loadJobBrainByNumber !== 'function') return;
    var F = window.SALE_PREVIEW_FIXTURES || {};
    var now = resolveEngineNow(F);
    var overlay = $('#conversationPeek');
    if (!overlay) return;
    var headTitle = $('#peekHeadingTitle');
    var headNum = $('#peekHeadingNum');
    if (headNum) headNum.textContent = jobNumber;
    if (headTitle) headTitle.textContent = 'Loading…';

    // Slice 4B Path A — honour the page's live mode. In live mode
    // the peek loads the job brain from real PostgREST reads
    // (per-job fallback to fixture if any source fails). In
    // fixture mode (?fixtures=1), peek stays fixture too.
    var peekForceFixtures = !_IS_LIVE_MODE;
    window.SALE_JOB_BRAIN.loadJobBrainByNumber(jobNumber, { forceFixtures: peekForceFixtures }).then(function (brain) {
      PEEK_STATE.open = true;
      PEEK_STATE.activeTab = 'conversation';
      PEEK_STATE.brain = brain;
      if (headTitle) headTitle.textContent = (brain.job.client_name || '—') + ' — ' + (brain.job.site_suburb || brain.job.suburb || '');
      if (headNum) headNum.textContent = brain.job.job_number || jobNumber;
      // Render every pane (cheap with fixture data, makes tab switching feel instant).
      ['conversation', 'facts', 'events', 'verdict'].forEach(function (tab) {
        var pane = document.querySelector('[data-peek-pane="' + tab + '"]');
        if (pane) pane.innerHTML = renderPeekPane(tab, brain, F, now);
      });
      activatePeekTab('conversation');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('mem-locked');
      console.info('[sale-preview] conversation peek opened', { job: jobNumber, note: 'No fetch fired.' });
    }).catch(function (err) {
      console.warn('[sale-preview] peek load failed:', err && err.message);
      if (headTitle) headTitle.textContent = 'Job not found in fixtures';
    });
  }

  function closeConversationPeek() {
    var overlay = $('#conversationPeek');
    if (!overlay) return;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mem-locked');
    PEEK_STATE.open = false;
    PEEK_STATE.brain = null;
  }

  function activatePeekTab(tab) {
    PEEK_STATE.activeTab = tab;
    $all('.peek-tab').forEach(function (b) {
      var on = b.getAttribute('data-peek-tab') === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $all('.peek-pane').forEach(function (p) {
      var on = p.getAttribute('data-peek-pane') === tab;
      if (on) p.removeAttribute('hidden'); else p.setAttribute('hidden', '');
    });
  }

  // ════════════════════════════════════════════════════════════
  // Reducer + policy bridge
  // ════════════════════════════════════════════════════════════

  // Resolves the engine "now" for the page. Fixtures pin a baseline so
  // the cockpit looks the same every time Marnin opens it.
  function resolveEngineNow(F) {
    if (F && F.engineNow) {
      var d = new Date(F.engineNow);
      if (!isNaN(d.getTime())) return d;
    }
    return new Date();
  }

  // Enrich each lane card with a SALE_POLICY verdict so the renderer
  // can show the AUTO / APPROVE / BLOCKED / INTERNAL chip.
  // Slice 4B Path A — reads from `dataSource` (the index payload)
  // not the fixture global. In live mode the lanes were derived from
  // real PostgREST events/facts; the verdicts must be evaluated
  // against the SAME data, not fixture residue.
  function attachVerdicts(lanes, dataSource, now) {
    var ds = dataSource || {};
    function decorate(bucket) {
      bucket.items = bucket.items.map(function (card) {
        var jobId = card.job && card.job.id;
        var facts = (ds.jobContext && ds.jobContext[jobId]) || [];
        var recent = (ds.events || []).filter(function (e) { return e && e.job_id === jobId; });
        // Loop 4: stash on the card so the pre-scope context block + the
        // booking proposal card can read them without re-querying.
        card._facts = facts;
        card._events = recent;
        if (!card.proposed_action) {
          card.verdict = null;
          return card;
        }
        if (window.SALE_POLICY && typeof window.SALE_POLICY.evaluate === 'function') {
          card.verdict = window.SALE_POLICY.evaluate({
            action: card.proposed_action,
            job: card.job,
            facts: facts,
            recentEvents: recent,
            now: now,
          });
        } else {
          card.verdict = null;
        }
        return card;
      });
      return bucket;
    }
    return {
      book: lanes.book.map(decorate),
      send: lanes.send.map(decorate),
      call: lanes.call.map(decorate),
    };
  }

  function laneCount(buckets) {
    return (buckets || []).reduce(function (s, b) { return s + (b.items ? b.items.length : 0); }, 0);
  }

  // ════════════════════════════════════════════════════════════
  // Tab switching + lane chip switcher
  // ════════════════════════════════════════════════════════════

  function activateTab(tab) {
    $all('.tab-nav a').forEach(function (a) {
      if (a.getAttribute('data-tab') === tab) a.classList.add('active');
      else a.classList.remove('active');
    });
    $all('.tab-pane').forEach(function (p) {
      if (p.getAttribute('data-tab-pane') === tab) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  function activateLaneChip(lane) {
    $all('.lane-chip').forEach(function (chip) {
      var on = chip.getAttribute('data-lane-chip') === lane;
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $all('.lane-pane').forEach(function (pane) {
      var on = pane.getAttribute('data-lane') === lane;
      pane.setAttribute('data-active', on ? 'true' : 'false');
    });
  }

  function wireTabs() {
    document.body.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('.tab-nav a')) {
        e.preventDefault();
        var tab = t.getAttribute('data-tab') || 'today';
        activateTab(tab);
      }
    }, false);
  }

  function wireLaneChips() {
    document.body.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var chip = t.closest('.lane-chip');
      if (!chip) return;
      var lane = chip.getAttribute('data-lane-chip');
      if (!lane) return;
      activateLaneChip(lane);
      console.info('[sale-preview] lane chip', { lane: lane });
    }, false);
  }

  // ════════════════════════════════════════════════════════════
  // Stub button delegation — console.info ONLY
  // ════════════════════════════════════════════════════════════

  function wireStubButtons() {
    document.body.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.matches) return;

      // Peek tab switching
      var peekTab = t.closest && t.closest('.peek-tab');
      if (peekTab) {
        var tab = peekTab.getAttribute('data-peek-tab');
        if (tab) activatePeekTab(tab);
        e.preventDefault();
        return;
      }

      // Peek close (backdrop / × button)
      if (t.matches('[data-peek-close]') || (t.closest && t.closest('[data-peek-close]'))) {
        closeConversationPeek();
        e.preventDefault();
        return;
      }

      // Calendar rep toggle
      var repChip = t.closest && t.closest('.cal-rep-chip');
      if (repChip) {
        var rep = repChip.getAttribute('data-cal-rep');
        if (rep) {
          CALENDAR_REP = rep;
          $all('.cal-rep-chip').forEach(function (c) {
            c.setAttribute('aria-pressed', c.getAttribute('data-cal-rep') === rep ? 'true' : 'false');
          });
          var calBody = $('#calendar-body');
          if (calBody) calBody.innerHTML = renderCalendar(rep);
          console.info('[sale-preview] calendar rep', { rep: rep });
        }
        e.preventDefault();
        return;
      }

      // Action card buttons
      if (t.matches('button.btn-action')) {
        var act = t.getAttribute('data-stub-action');
        var openJob = t.getAttribute('data-open-job');
        if (openJob) {
          // Slice 4A: card-level "Open job" routes to the conversation peek.
          openConversationPeek(openJob);
          e.preventDefault();
          return;
        }
        // Loop 6 — "Preview dry-run" button (reachable; not disabled).
        // Runs SALE_DRY_RUN.execute() and console.info logs the
        // would-have-been-sent payload. NO fetch, NO state mutation.
        var dryRunJob = t.getAttribute('data-dryrun-job');
        if (dryRunJob && window.SALE_DRY_RUN) {
          var dry = runDryRunForJob(dryRunJob);
          if (dry) {
            console.info('[sale-preview] dry-run', {
              job: dryRunJob,
              would_send: dry.would_send,
              blockers: dry.blockers,
              payload: dry.payload,
              via: dry.via,
              dry_run_log_id: dry.dry_run_log_id,
            });
            // Visual ack: flash the verdict chip on this card so Marnin
            // sees the dry-run was logged. No state change.
            try {
              var card = t.closest && t.closest('.action-card');
              var chip = card && card.querySelector && card.querySelector('.verdict-chip');
              if (chip) {
                chip.classList.add('verdict-chip-flash');
                setTimeout(function () { chip.classList.remove('verdict-chip-flash'); }, 600);
              }
            } catch (_) { /* visual ack is best-effort */ }
            e.preventDefault();
            return;
          }
        }
        console.info('[sale-preview] stub tap', {
          job: t.getAttribute('data-stub-job'),
          action: act,
          note: 'Preview only — no network request fired.',
        });
        e.preventDefault();
        return;
      }

      // Lane card body / pipe card / calprev row / calendar slot open-job → peek
      var openTarget = t.closest && (t.closest('[data-open-job]') || t.closest('[data-job-number]'));
      if (openTarget) {
        var jn = openTarget.getAttribute('data-open-job') || openTarget.getAttribute('data-job-number');
        if (jn) {
          openConversationPeek(jn);
          return;
        }
      }

      // Per-rep toggle
      if (t.matches('button.per-rep-toggle')) {
        console.info('[sale-preview] per-rep toggle blocked', {
          reason: 'jobs.created_by null-rate above threshold — pending SALES-DATA-1 + SALES-DATA-3.',
        });
        e.preventDefault();
        return;
      }

      // Memory panel close (legacy — still supported for now)
      if (t.matches('[data-mem-close]')) {
        closeMemoryPanel();
        e.preventDefault();
      }
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (PEEK_STATE.open) closeConversationPeek();
        else closeMemoryPanel();
      }
    });
  }

  // ════════════════════════════════════════════════════════════
  // Main render
  // ════════════════════════════════════════════════════════════

  function render() {
    var F = window.SALE_PREVIEW_FIXTURES;
    if (!F) {
      var err = $('#salePreviewError');
      if (err) err.style.display = 'block';
      return;
    }

    var now = resolveEngineNow(F);

    // Slice 4B Phase 1 — default is LIVE (forceFixtures: false).
    // The scaffold's per-source try/catch falls back to fixture
    // for any source whose PostgREST read errors out (e.g.
    // job_context until T5's RLS migration ships). Override via
    // ?fixtures=1 to force fixture mode entirely; ?live=1 also
    // works as an explicit live toggle.
    var qs = (typeof window !== 'undefined' && window.location && window.location.search) || '';
    var forceFixtures = /[?&]fixtures=1\b/.test(qs);
    var forceLive     = /[?&]live=1\b/.test(qs);
    if (forceLive) forceFixtures = false;

    var indexPromise;
    if (window.SALE_JOB_BRAIN && typeof window.SALE_JOB_BRAIN.loadIndex === 'function') {
      indexPromise = window.SALE_JOB_BRAIN.loadIndex({ forceFixtures: forceFixtures });
    } else {
      // Fallback path keeps Slice 2 behaviour if sale-job-brain.js
      // is not loaded yet (e.g. dev preview without the script tag).
      indexPromise = Promise.resolve({
        jobs: F.jobs || [], events: F.events || [],
        jobContext: F.jobContext || {}, proposedActions: F.proposedActions || [],
        coaching: F.coaching || [], calendar: F.calendar || null,
        generatedAt: F.engineNow || new Date().toISOString(), _brand: F._brand || 'unknown',
      });
    }

    indexPromise.then(function (index) {
      _renderFromIndex(index, F, now);
    }).catch(function (err) {
      console.warn('[sale-preview] Job Brain load failed:', err && err.message);
      var errEl = $('#salePreviewError');
      if (errEl) {
        errEl.textContent = 'Job Brain load failed — see console.';
        errEl.style.display = 'block';
      }
    });
  }

  function _renderFromIndex(index, F, now) {
    var engine = (window.SALE_REDUCER && typeof window.SALE_REDUCER.reduce === 'function')
      ? window.SALE_REDUCER.reduce({
          jobs: index.jobs || [],
          events: index.events || [],
          jobContext: index.jobContext || {},
          proposedActions: index.proposedActions || [],
          now: now,
          calendar: index.calendar || null,
        })
      : { performance: null, lanes: { book: [], send: [], call: [] }, calendar: index.calendar || null };

    // Slice 4B Path A — set module-level state so peek + memory
    // panel + verdicts read from this same payload, not fixtures.
    _CURRENT_INDEX = index;
    _IS_LIVE_MODE = (index && (index._brand === 'real' || index._brand === 'fallback'));

    var lanes = attachVerdicts(engine.lanes, index, now);

    console.info('[sale-preview] engine', {
      jobsConsidered: (engine.diagnostics && engine.diagnostics.jobsConsidered) || 0,
      cardsProduced: (engine.diagnostics && engine.diagnostics.cardsProduced) || 0,
      lanesPopulated: (engine.diagnostics && engine.diagnostics.lanesPopulated) || null,
      brand: index._brand || 'unknown',
      now: now.toISOString(),
    });

    // Performance strip
    var perf = $('#performance-strip');
    if (perf) perf.innerHTML = performanceStripHtml(engine.performance);

    // Coaching strip (Slice 4A — read-only fixture text)
    var coachStrip = $('#coaching-strip');
    if (coachStrip) coachStrip.innerHTML = renderCoachingStrip(index.coaching || []);

    // Lifecycle states preview (Product review pass — display-only)
    var lifeGrid = $('#lifecycle-states-grid');
    if (lifeGrid) {
      var nowMs = +(now instanceof Date ? now : new Date(now));
      lifeGrid.innerHTML = renderLifecycleStates(F.lifecycleStates || [], nowMs);
    }

    // Lanes
    var bookBody = $('[data-lane-body="book"]');
    var sendBody = $('[data-lane-body="send"]');
    var callBody = $('[data-lane-body="call"]');
    if (bookBody) bookBody.innerHTML = lanes.book.map(laneBucketHtml).join('') || '<div class="bucket-empty">Nothing in Book today.</div>';
    if (sendBody) sendBody.innerHTML = lanes.send.map(laneBucketHtml).join('') || '<div class="bucket-empty">Nothing in Follow Ups today.</div>';
    if (callBody) callBody.innerHTML = lanes.call.map(laneBucketHtml).join('') || '<div class="bucket-empty">Nothing in Call today.</div>';

    // Lane counts (header pill + mobile chips)
    var bookN = laneCount(lanes.book), sendN = laneCount(lanes.send), callN = laneCount(lanes.call);
    var setText = function (sel, n) { var el = document.querySelector(sel); if (el) el.textContent = String(n); };
    setText('[data-lane-count="book"]', bookN);
    setText('[data-lane-count="send"]', sendN);
    setText('[data-lane-count="call"]', callN);
    setText('[data-lane-chip-count="book"]', bookN);
    setText('[data-lane-chip-count="send"]', sendN);
    setText('[data-lane-chip-count="call"]', callN);

    // Calendar preview (today only)
    var calPrev = $('#calendar-preview-today');
    if (calPrev) calPrev.innerHTML = calendarPreviewHtml(engine.calendar);

    // Pipeline tab
    var pipe = $('#pipeline-body');
    if (pipe) pipe.innerHTML = renderPipeline();

    // Calendar tab
    var cal = $('#calendar-body');
    if (cal) cal.innerHTML = renderCalendar();

    // Performance tab
    var perfTab = $('#performance-body');
    if (perfTab) perfTab.innerHTML = renderPerformance();

    // Lead source (footer of Today tab)
    var ls = $('#leadsource-body');
    if (ls) ls.innerHTML = renderLeadSource();

    // Disabled tiles (footer of Today tab)
    var dt = $('#disabled-tiles-body');
    if (dt) dt.innerHTML = renderDisabledTiles();

    // Stream-mismatch info chip in trust banner
    var smChip = $('#streamMismatchChip');
    if (smChip) {
      var sm = F.streamMismatch || {};
      smChip.textContent = 'smart_nudges (' + (sm.smart_nudges || 0) + ') ≠ ai_proposed_actions (' + (sm.ai_proposed_actions || 0) + ') — SALES-DATA-6';
    }

    // Slice 4B Path A — sources line in trust banner. Shows
    // live vs fallback per source so the rep can see at a glance
    // which data is real. Visibility logic:
    //   • brand === 'real'     → live mode, real reads succeeded for ≥1 source. Show line.
    //   • brand === 'fallback' → live mode attempted but ALL sources fell back. Show line (all amber).
    //   • brand === '4A'       → pure fixture mode (?fixtures=1). Hide line.
    //   • anything else        → hide.
    var sourcesLine = $('#dataSourcesLine');
    if (sourcesLine) {
      var brand = index && index._brand;
      var srcs = (index && index.sources) || null;
      var isLiveMode = brand === 'real' || brand === 'fallback';

      if (isLiveMode) {
        // Compose per-source dots. If brand === 'fallback' but no
        // sources object (full-failure path), synthesise all-amber.
        if (!srcs) {
          srcs = { jobs: 'fallback', events: 'fallback', jobContext: 'fallback', proposedActions: 'fallback' };
        }
        var labelMap = { jobs: 'jobs', events: 'events', jobContext: 'context', proposedActions: 'actions' };
        var titleMap = {
          real:     'live PostgREST read OK',
          fallback: 'live read failed or empty — falling back to fixture',
          fixture:  'fixture-only mode',
        };
        var anyReal = Object.keys(srcs).some(function (k) { return srcs[k] === 'real'; });
        var prefixLabel = anyReal ? 'Live data:' : 'Live mode (all fallback):';
        var prefixTitle = anyReal
          ? 'Real reads firing for at least one source'
          : 'Live mode is on but every source fell back to fixture (likely unauthenticated session or RLS denial)';
        var html = ['<span class="src-label" title="' + prefixTitle + '">' + prefixLabel + '</span>'];
        ['jobs', 'events', 'jobContext', 'proposedActions'].forEach(function (k) {
          var state = srcs[k] || 'fallback';
          var label = labelMap[k];
          html.push('<span class="src ' + state + '" title="' + state + ' — ' + (titleMap[state] || '') + '"><span class="src-dot"></span><span class="src-name">' + label + '</span></span>');
        });
        sourcesLine.innerHTML = html.join('');
        sourcesLine.removeAttribute('hidden');
      } else {
        // Pure fixture mode (brand === '4A'): hide.
        sourcesLine.setAttribute('hidden', '');
      }
    }
  }

  function init() {
    render();
    wireTabs();
    wireLaneChips();
    wireStubButtons();
    activateTab('today'); // default tab
    activateLaneChip('book'); // default lane on mobile
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
