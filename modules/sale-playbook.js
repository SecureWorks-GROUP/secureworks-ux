// ════════════════════════════════════════════════════════════
// SecureWorks — Secure Sale (Loop 3) — Tone-aware Playbook
//
// Pure module. Takes a Loop-2 SalesActionCard + matching JobBrain
// + rep profile; produces a tone-aware PlaybookOutput.
//
// Hard rules (enforced inline + by harness):
//   • No fetch, no XHR, no sendBeacon — pure derivation.
//   • No LLM call. v1 is templates + variable substitution only.
//   • Sender identity stays type-based (Slice 1 amendment §3).
//     Loop 3 may NOT override.
//   • SMS body ≤ 160 chars. Email subject ≤ 80, body ≤ 350.
//     If both primary and fallback templates blow the budget,
//     return null with safety_notes set.
//   • Forbidden phrases (em dash, "as per", "leverage", AI tells)
//     are scrubbed; if scrub fails, fall back; if fallback fails,
//     return null.
//   • Blocked policy verdicts (DNC, stop-word, no-channel, decking)
//     short-circuit to null with safety_notes.
//   • Approve-required only — no auto-send tier in Loop 3.
//
// Public API:
//   SALE_PLAYBOOK.draft({
//     card:        SalesActionCard,
//     job_brain:   JobBrain,
//     rep_profile?: RepProfile,
//     now?:        Date | ISO string,
//   }) → PlaybookOutput | null
//
// PlaybookOutput contract (matches loop-3-playbook-spec.md):
//   {
//     playbook_id:     string,
//     rep_profile_id:  string,
//     tone_variant:    string,
//     channel:         'sms' | 'email' | 'call',
//     drafted_subject: string | undefined,
//     drafted_message: string,
//     talk_track:      string[],
//     rationale:       string,
//     confidence:      number,
//     caveats:         string[],
//     safety_notes:    string[],
//     evidence_refs:   EvidenceRef[],
//   }
// ════════════════════════════════════════════════════════════

(function (root, factory) {
  'use strict';
  var exports = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports;
  } else {
    root.SALE_PLAYBOOK = exports;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ── Budgets ────────────────────────────────────────────────

  var BUDGETS = Object.freeze({
    sms_body:           160,
    email_subject:       80,
    email_body:         350,
    talk_track_bullet:   80,
    talk_track_min:       3,
    talk_track_max:       5,
  });

  // ── Rep profile registry ───────────────────────────────────

  // Loop 4 (Marnin direction): Nithin owns patio + combo + decking + general.
  // Khairo owns fencing. Single Nithin profile covers all four types in v1.
  var REP_PROFILES = Object.freeze({
    'nithin.patio.calm-tradie.v1': Object.freeze({
      id: 'nithin.patio.calm-tradie.v1',
      rep_first_name: 'Nithin',
      job_type_match: ['patio', 'combo', 'decking', 'general'],
      voice_label: 'calm-tradie',
      signature_line: '— Nithin',
    }),
    'khairo.fencing.calm-tradie.v1': Object.freeze({
      id: 'khairo.fencing.calm-tradie.v1',
      rep_first_name: 'Khairo',
      job_type_match: ['fencing'],
      voice_label: 'calm-tradie',
      signature_line: '— Khairo',
    }),
  });

  function resolveRepProfile(jobType, override) {
    var t = (jobType || '').toLowerCase();
    if (override && REP_PROFILES[override.id || override]) {
      var op = REP_PROFILES[override.id || override];
      if (op.job_type_match.indexOf(t) !== -1) return op;
      return null; // mismatch → caller treats as null
    }
    if (t === 'fencing') return REP_PROFILES['khairo.fencing.calm-tradie.v1'];
    if (t === 'patio' || t === 'combo' || t === 'decking' || t === 'general') {
      return REP_PROFILES['nithin.patio.calm-tradie.v1'];
    }
    return null;
  }

  // ── Tone variant defaults (per action_type) ────────────────

  var DEFAULT_TONE = Object.freeze({
    book_scope:           'helpful_service',
    send_follow_up:       'helpful_service',
    call_client:          'internal',
    deposit_follow_up:    'helpful_service',
    reply_needed:         'helpful_service', // upgraded to objection_response if source is client.question
    stale_quote_recovery: 'nurture',          // upgraded to value_frame for high-value
    appointment_confirm:  'helpful_service',
    snooze_or_dismiss:    'internal',
  });

  var HIGH_VALUE_THRESHOLD = 20000;
  var STALE_DAYS = 14;

  // ── Forbidden phrases (anti-AI tells) ──────────────────────

  var FORBIDDEN_REWRITES = [
    [/—/g,                      ' - '],          // em dash → spaced hyphen
    [/\bas per\b/gi,                 'per'],
    [/\bdelve\b/gi,                  'look'],
    [/\btapestry\b/gi,               'mix'],
    [/\bleverage\b/gi,               'use'],
    [/\bsynergy\b/gi,                'fit'],
    [/\bI hope this finds you well\b/gi, 'Hope you\'re well'],
    [/!{2,}/g,                       '!'],            // multiple bangs
  ];
  var FORBIDDEN_HARDFAIL = [
    /\bSent from my iPhone\b/i,
    /\bbest regards\b/i,
    /\bkind regards\b/i,
  ];

  function scrubForbidden(text) {
    if (!text) return { text: text, hits: [], hardfail: null };
    var out = text;
    var hits = [];
    FORBIDDEN_REWRITES.forEach(function (pair) {
      if (pair[0].test(out)) { hits.push(pair[0].toString()); out = out.replace(pair[0], pair[1]); }
    });
    var hardfail = null;
    for (var i = 0; i < FORBIDDEN_HARDFAIL.length; i++) {
      if (FORBIDDEN_HARDFAIL[i].test(out)) { hardfail = FORBIDDEN_HARDFAIL[i].toString(); break; }
    }
    return { text: out, hits: hits, hardfail: hardfail };
  }

  // ── Helpers ────────────────────────────────────────────────

  function toDate(v) {
    if (v instanceof Date) return v;
    if (typeof v === 'string' || typeof v === 'number') {
      var d = new Date(v);
      if (!isNaN(d.getTime())) return d;
    }
    return null;
  }
  function firstName(full) { return ((full || '').split(/\s+/)[0]) || ''; }
  function fmtMoney(v) {
    if (typeof v !== 'number' || isNaN(v)) return '';
    return '$' + Math.round(v).toLocaleString('en-AU');
  }
  function hoursAgo(now, iso) {
    var n = +toDate(now); var t = +new Date(iso);
    if (isNaN(n) || isNaN(t)) return null;
    return Math.round((n - t) / 3600e3);
  }
  function daysAgo(now, iso) {
    var h = hoursAgo(now, iso);
    return h === null ? null : Math.round(h / 24);
  }
  function fmtAge(now, iso) {
    var h = hoursAgo(now, iso);
    if (h === null) return '';
    if (h < 24) return h + 'h';
    var d = Math.round(h / 24);
    return d + 'd';
  }
  function fmtSlot(due_at) {
    var d = toDate(due_at);
    if (!d) return '';
    var dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var hour = d.getHours();
    var ampm = hour >= 12 ? 'pm' : 'am';
    var h12 = hour % 12 === 0 ? 12 : hour % 12;
    var mins = d.getMinutes();
    var mm = mins === 0 ? '' : ':' + (mins < 10 ? '0' : '') + mins;
    return dows[d.getDay()] + ' ' + h12 + mm + ampm;
  }
  function lastEvent(events, eventType) {
    if (!Array.isArray(events)) return null;
    var matches = events.filter(function (e) { return e && e.event_type === eventType; });
    if (!matches.length) return null;
    matches.sort(function (a, b) { return +new Date(b.occurred_at || 0) - +new Date(a.occurred_at || 0); });
    return matches[0];
  }
  function lastInbound(events) {
    return lastEvent(events, 'client.question') || lastEvent(events, 'client.reply');
  }

  // ── Substitution ───────────────────────────────────────────

  function substitute(template, ctx) {
    return template.replace(/\{(\w+)\}/g, function (m, key) {
      if (Object.prototype.hasOwnProperty.call(ctx, key) && ctx[key] !== null && ctx[key] !== undefined) {
        return String(ctx[key]);
      }
      return ''; // missing variable → empty (caller checks for unsubstituted patterns)
    }).replace(/\s{2,}/g, ' ').trim();
  }

  function buildContext(card, jobBrain, repProfile, now) {
    var events = (jobBrain && jobBrain.events) || [];
    var sentEv = lastEvent(events, 'quote.sent');
    var viewedEv = lastEvent(events, 'quote.viewed');
    var acceptedEv = lastEvent(events, 'quote.accepted');
    var inboundEv = lastInbound(events);
    return {
      first_name: firstName(card.customer_name),
      suburb: card.suburb || '',
      job_number: card.job_number || '',
      value: fmtMoney(card.value_inc_gst),
      rep_first_name: repProfile ? repProfile.rep_first_name : '',
      hours_since_created: card.job_id ? fmtAge(now, jobBrain && jobBrain.job && jobBrain.job.created_at) : '',
      days_since_sent:    sentEv     ? fmtAge(now, sentEv.occurred_at)     : '',
      days_since_viewed:  viewedEv   ? fmtAge(now, viewedEv.occurred_at)   : '',
      hours_since_accepted: acceptedEv ? fmtAge(now, acceptedEv.occurred_at) : '',
      hours_since_inbound:  inboundEv  ? fmtAge(now, inboundEv.occurred_at)  : '',
      site_visit_window:  card.due_at ? fmtSlot(card.due_at)               : '',
    };
  }

  // ── Templates ──────────────────────────────────────────────
  //
  // FALLBACK templates. The Loop-4 architecture loads templates
  // from rep-specific markdown playbooks (see sale-playbook-loader.js
  // and securedash/playbooks/*.md). When draft() is called without
  // a `playbooks` map, OR the resolver can't find a playbook for
  // the given card, these inline fallbacks are used so the module
  // works headless in tests + offline.
  //
  // To override, pass `playbooks` to draft() — its templates win.

  var FALLBACK_TEMPLATES = {
    book_scope: {
      sms_primary:  'Hey {first_name}, {rep_first_name} here. Got a couple of windows for the site visit - Tue 10:30am or Thu 9am. Which suits?',
      sms_fallback: 'Hey {first_name}, {rep_first_name}. 2 site-visit windows: Tue 10:30 or Thu 9. Reply with one and I\'ll lock it in.',
      email_subject:'Site visit for your {suburb} job - two options',
      email_body:   'Hey {first_name},\n\n{rep_first_name} from SecureWorks. Got a couple of windows for the site visit on {job_number}: Tue 10:30am or Thu 9am.\n\nReply with whichever suits and I\'ll lock it in.\n\n{signature}',
    },
    send_follow_up: {
      sms_primary:        'Hey {first_name}, {rep_first_name} - quote landed OK? Happy to walk you through anything that\'s not clear.',
      sms_fallback:       'Hey {first_name}, quote OK? Any questions?  {signature}',
      sms_primary_nurture:'Hey {first_name}, {rep_first_name}. No rush on the {job_number} quote - happy to keep it on file. Ping me if anything changes.',
      sms_fallback_nurture:'Hey {first_name}, no rush on {job_number}. Ping me if anything changes.  {signature}',
      email_subject:      '{job_number} - quick check-in',
      email_body:         'Hey {first_name},\n\nJust a quick check that the quote landed OK. Happy to walk you through any of it on a call.\n\n{signature}',
    },
    deposit_follow_up: {
      sms_primary:  'Hey {first_name}, {rep_first_name} here. Quote accepted {hours_since_accepted} ago - when works for the deposit so I can lock in materials?',
      sms_fallback: 'Hey {first_name}, deposit when? Need to lock in materials.  {signature}',
      email_subject:'Deposit for {job_number} - materials lock-in',
      email_body:   'Hey {first_name},\n\nThanks again for accepting the {job_number} quote. To lock in materials we need the deposit (50% standard).\n\nReply OK and I\'ll send a payment link.\n\n{signature}',
    },
    reply_needed: {
      sms_primary_objection: 'Hey {first_name}, {rep_first_name}. Good question on {job_number} - I\'ll send a proper answer in the next hour.',
      sms_fallback_objection:'Hey {first_name}, got your question - reply incoming shortly.  {signature}',
      sms_primary_helpful:   'Hey {first_name}, got your message - {rep_first_name} on it. Reply incoming shortly.',
      sms_fallback_helpful:  'Hey {first_name}, on it. Reply shortly.  {signature}',
      email_subject:         'Re: {job_number}',
      email_body:            'Hey {first_name},\n\nThanks for the message. {rep_first_name} here - I\'ll get back to you with a proper answer in the next hour.\n\n{signature}',
    },
    stale_quote_recovery: {
      sms_primary_nurture:  'Hey {first_name}, no pressure - happy to keep {job_number} on file. Ping me if anything changes.  {signature}',
      sms_fallback_nurture: 'Hey {first_name}, no pressure on {job_number}. Ping me anytime.  {signature}',
      sms_primary_value:    'Hey {first_name}, on the {value} {job_number} - that\'s certified engineering + insulated SolarSpan, not a kit. Worth a 5-min call?',
      sms_fallback_value:   'Hey {first_name}, {value} covers engineering + insulated panels. 5-min call?  {signature}',
      email_subject_value:  '{job_number} - what {value} actually covers',
      email_body_value:     'Hey {first_name},\n\nQuick one on {job_number}. The {value} covers SolarSpan insulated panels (roof + ceiling + insulation in one), engineering certification, and full council submission - not a flat-pack kit.\n\nWorth a 5-min call to walk through what makes the difference?\n\n{signature}',
      email_subject_nurture:'{job_number} - keeping it on file',
      email_body_nurture:   'Hey {first_name},\n\nNo pressure on {job_number} - happy to keep it on file. If anything changes, ping me.\n\n{signature}',
    },
    appointment_confirm: {
      sms_primary:  'Hey {first_name}, {rep_first_name} confirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access?',
      sms_fallback: 'Confirming site visit {site_visit_window}, {suburb}. Reply OK or update.  {signature}',
      email_subject:'Site visit confirmed - {site_visit_window}',
      email_body:   'Hey {first_name},\n\nConfirming the site visit at {suburb} on {site_visit_window}. Anything I should know about access (gate code, dog, parking)?\n\n{signature}',
    },
  };

  // Talk-track FALLBACKS per call_client trigger sub-type. Same
  // override rule: if `playbooks` is passed to draft() and the
  // resolved playbook has talk_tracks, those win.
  var FALLBACK_TALK_TRACKS = {
    no_first_contact: [
      'First contact: introduce yourself, reference the enquiry source.',
      'Confirm site address + suburb, get a feel for what they want.',
      'Lock in a site visit window before hanging up.',
      'If they prefer SMS, follow up within the hour.',
    ],
    viewed_no_reply: [
      'Reference the total ({value}) + what they liked at the visit.',
      'Ask: "does anything in the quote not sit right?"',
      'Don\'t push price - offer to walk through panel choice.',
      'If they say wait, get a date and lock it in.',
    ],
    site_visit_no_scope: [
      'Coaching call: ask if they hit a blocker on the scoping tool.',
      'Offer to walk through pricing on a call rather than typed scope.',
      'If decision delayed, agree on a follow-up date.',
    ],
    default: [
      'Open: warm hello, reference job number {job_number}.',
      'Ask: "anything in the quote not sit right?"',
      'Don\'t push - listen for hesitation cues.',
      'Close: agree on next step + date.',
    ],
  };

  // ── Tone selection ─────────────────────────────────────────

  function selectToneAndChannel(card, jobBrain) {
    var action = card.action_type;
    var tone = DEFAULT_TONE[action] || 'helpful_service';
    var channel = 'sms';
    var hadHighValueOverride = false;
    var events = (jobBrain && jobBrain.events) || [];

    if (action === 'send_follow_up') {
      var sentEv = lastEvent(events, 'quote.sent');
      if (sentEv) {
        var d = daysAgo(card.created_at, sentEv.occurred_at);
        if (d !== null && d >= STALE_DAYS) tone = 'nurture';
      }
    }

    if (action === 'reply_needed') {
      var inboundEv = lastInbound(events);
      if (inboundEv && inboundEv.event_type === 'client.question') {
        tone = 'objection_response';
      }
    }

    if (action === 'stale_quote_recovery') {
      if (typeof card.value_inc_gst === 'number' && card.value_inc_gst >= HIGH_VALUE_THRESHOLD) {
        tone = 'value_frame';
        channel = 'email';
        hadHighValueOverride = true;
      }
    }

    if (action === 'call_client') {
      channel = 'call';
      tone = 'internal';
    }

    if (action === 'snooze_or_dismiss') {
      channel = 'call'; // signals "no client message"
      tone = 'internal';
    }

    // Channel fallback when default channel missing.
    var job = (jobBrain && jobBrain.job) || {};
    if (channel === 'sms' && !job.client_phone && job.client_email) channel = 'email';
    if (channel === 'email' && !job.client_email && job.client_phone) channel = 'sms';

    return { tone: tone, channel: channel, hadHighValueOverride: hadHighValueOverride };
  }

  // ── Playbook resolver helper ───────────────────────────────
  //
  // Browser path: the cockpit loads the loader module + 4 playbooks
  // and passes the loaded map into draft({playbooks: ...}). This
  // helper picks the matching playbook by (rep_profile_id implied
  // by job_type) AND (covers_action_types includes card.action_type).
  // No dependency on the loader module itself (keeps sale-playbook.js
  // standalone for Node tests).

  function resolvePlaybookForCard(card, playbooks) {
    if (!card || !playbooks) return null;
    var jt = (card.job_type || '').toLowerCase();
    var expectedRep =
      jt === 'fencing'
        ? 'khairo.fencing.calm-tradie.v1'
        : (jt === 'patio' || jt === 'combo' || jt === 'decking' || jt === 'general'
            ? 'nithin.patio.calm-tradie.v1'
            : null);
    if (!expectedRep) return null;
    var ids = Object.keys(playbooks);
    for (var i = 0; i < ids.length; i++) {
      var pb = playbooks[ids[i]];
      if (!pb) continue;
      if (pb.rep_profile_id !== expectedRep) continue;
      var covers = pb.covers_action_types || [];
      if (covers.indexOf(card.action_type) === -1) continue;
      return pb;
    }
    return null;
  }

  // ── Template resolution ────────────────────────────────────
  //
  // Returns the templates + talk_tracks dicts to use for this draft.
  // Loop-4 path: a ParsedPlaybook from sale-playbook-loader (its
  // .templates and .talk_tracks dicts win wholesale). Fallback:
  // FALLBACK_TEMPLATES + FALLBACK_TALK_TRACKS.

  function resolveTemplates(playbook) {
    if (playbook && playbook.templates && Object.keys(playbook.templates).length > 0) {
      return {
        templates: playbook.templates,
        talkTracks: (playbook.talk_tracks && Object.keys(playbook.talk_tracks).length > 0)
          ? playbook.talk_tracks
          : FALLBACK_TALK_TRACKS,
        source: 'playbook',
        playbook_id: playbook.playbook_id || null,
      };
    }
    return {
      templates: FALLBACK_TEMPLATES,
      talkTracks: FALLBACK_TALK_TRACKS,
      source: 'fallback',
      playbook_id: null,
    };
  }

  // ── Body builders ──────────────────────────────────────────

  function buildSmsBody(card, ctx, tone, repProfile, channelMissing, templates) {
    templates = templates || FALLBACK_TEMPLATES;
    var t = templates[card.action_type];
    if (!t) return null;
    var primaryKey, fallbackKey;
    if (card.action_type === 'send_follow_up') {
      primaryKey = tone === 'nurture' ? 'sms_primary_nurture' : 'sms_primary';
      fallbackKey = tone === 'nurture' ? 'sms_fallback_nurture' : 'sms_fallback';
    } else if (card.action_type === 'reply_needed') {
      primaryKey = tone === 'objection_response' ? 'sms_primary_objection' : 'sms_primary_helpful';
      fallbackKey = tone === 'objection_response' ? 'sms_fallback_objection' : 'sms_fallback_helpful';
    } else if (card.action_type === 'stale_quote_recovery') {
      primaryKey = tone === 'value_frame' ? 'sms_primary_value' : 'sms_primary_nurture';
      fallbackKey = tone === 'value_frame' ? 'sms_fallback_value' : 'sms_fallback_nurture';
    } else {
      primaryKey = 'sms_primary';
      fallbackKey = 'sms_fallback';
    }
    var ctx2 = Object.assign({}, ctx, { signature: repProfile.signature_line });
    var primary = substitute(t[primaryKey], ctx2);
    var primaryScrub = scrubForbidden(primary);
    var notes = [];
    if (primaryScrub.hardfail) notes.push('forbidden phrase: ' + primaryScrub.hardfail);
    var bodyA = primaryScrub.text;
    if (bodyA.length <= BUDGETS.sms_body && !primaryScrub.hardfail) {
      return { text: bodyA, fellBack: false, safety_notes: notes };
    }
    var fallback = substitute(t[fallbackKey], ctx2);
    var fbScrub = scrubForbidden(fallback);
    if (fbScrub.hardfail) notes.push('forbidden phrase fallback: ' + fbScrub.hardfail);
    var bodyB = fbScrub.text;
    if (bodyB.length <= BUDGETS.sms_body && !fbScrub.hardfail) {
      notes.push(primaryScrub.hardfail ? 'forbidden_phrase_recovered' : 'over_budget_recovered');
      return { text: bodyB, fellBack: true, safety_notes: notes };
    }
    return { text: null, fellBack: true, safety_notes: notes.concat(['recovery_failed_sms']) };
  }

  function buildEmailBody(card, ctx, tone, repProfile, templates) {
    templates = templates || FALLBACK_TEMPLATES;
    var t = templates[card.action_type];
    if (!t) return null;
    var subjectKey = 'email_subject';
    var bodyKey = 'email_body';
    if (card.action_type === 'stale_quote_recovery') {
      subjectKey = tone === 'value_frame' ? 'email_subject_value' : 'email_subject_nurture';
      bodyKey    = tone === 'value_frame' ? 'email_body_value'    : 'email_body_nurture';
    }
    var ctx2 = Object.assign({}, ctx, { signature: repProfile.signature_line });
    var subject = substitute(t[subjectKey], ctx2);
    var body    = substitute(t[bodyKey], ctx2);
    var sScrub = scrubForbidden(subject);
    var bScrub = scrubForbidden(body);
    var notes = [];
    if (sScrub.hardfail) notes.push('forbidden phrase (subject): ' + sScrub.hardfail);
    if (bScrub.hardfail) notes.push('forbidden phrase (body): ' + bScrub.hardfail);
    if (sScrub.hardfail || bScrub.hardfail) {
      return { subject: null, body: null, safety_notes: notes.concat(['recovery_failed_email']) };
    }
    if (sScrub.text.length > BUDGETS.email_subject) notes.push('email_subject_over_budget');
    if (bScrub.text.length > BUDGETS.email_body)    notes.push('email_body_over_budget');
    if (sScrub.text.length > BUDGETS.email_subject || bScrub.text.length > BUDGETS.email_body) {
      return { subject: null, body: null, safety_notes: notes.concat(['recovery_failed_email']) };
    }
    return { subject: sScrub.text, body: bScrub.text, safety_notes: notes };
  }

  function buildTalkTrack(card, ctx, talkTracks) {
    talkTracks = talkTracks || FALLBACK_TALK_TRACKS;
    var key = 'default';
    var id = card.id || '';
    if (id.indexOf('no_first_contact') !== -1)    key = 'no_first_contact';
    else if (id.indexOf('viewed_no_reply') !== -1) key = 'viewed_no_reply';
    else if (id.indexOf('site_visit_no_scope') !== -1) key = 'site_visit_no_scope';
    var pool = (talkTracks[key] && talkTracks[key].length)
      ? talkTracks[key]
      : (talkTracks.default || FALLBACK_TALK_TRACKS.default);
    var bullets = pool.slice().map(function (b) { return substitute(b, ctx); });
    bullets = bullets.filter(function (b) { return b.length <= BUDGETS.talk_track_bullet; });
    if (bullets.length < BUDGETS.talk_track_min) {
      var dpool = talkTracks.default || FALLBACK_TALK_TRACKS.default;
      bullets = dpool.map(function (b) { return substitute(b, ctx); });
    }
    return bullets.slice(0, BUDGETS.talk_track_max);
  }

  // ── Confidence ─────────────────────────────────────────────

  function scoreConfidence(card, ctx, fellBack, hadHighValueOverride, hasMissingVariables) {
    if (fellBack && hasMissingVariables) return 0.55;
    if (fellBack) return 0.55;
    if (hasMissingVariables) return 0.65;
    if (hadHighValueOverride) return 0.75;
    return 0.85;
  }

  function detectMissingVariables(template, ctx) {
    var vars = (template.match(/\{(\w+)\}/g) || []).map(function (m) { return m.slice(1, -1); });
    return vars.some(function (k) {
      return !ctx[k] && k !== 'signature';
    });
  }

  // ── Public: draft ──────────────────────────────────────────

  function draft(input) {
    if (!input || !input.card) return null;
    var card = input.card;
    var jobBrain = input.job_brain || {};
    var now = toDate(input.now) || new Date();

    // Hard short-circuits.
    if (card.policy_verdict === 'blocked') {
      return {
        playbook_id:     'blocked.v1',
        rep_profile_id:  null,
        tone_variant:    'internal',
        channel:         'call',
        drafted_subject: undefined,
        drafted_message: '',
        talk_track:      [],
        rationale:       card.why_now || 'Blocked by Loop 2 policy.',
        confidence:      1.0,
        caveats:         ['no client-facing draft'],
        safety_notes:    ['blocked: ' + (card.why_now || 'unknown')],
        evidence_refs:   (card.evidence_refs || []).slice(),
      };
    }

    var repProfile = resolveRepProfile(card.job_type, input.rep_profile);
    if (!repProfile) {
      return null;
    }
    if (input.rep_profile && repProfile.id !== (input.rep_profile.id || input.rep_profile)) {
      // Override that didn't match the job type → null with safety note.
      return null;
    }

    var pick = selectToneAndChannel(card, jobBrain);
    var ctx = buildContext(card, jobBrain, repProfile, now);
    var caveats = ['fixture data — not live'];
    var safety_notes = [];
    var evidence_refs = (card.evidence_refs || []).slice();

    // Loop 4: resolve templates from rep-specific playbook if provided.
    // Falls back to inline FALLBACK_TEMPLATES when input.playbooks is
    // absent or no playbook covers this card. The 25/25 Loop 3 smoke
    // tests pass no playbooks → fallback path stays unchanged.
    var resolved = resolveTemplates(
      input.playbooks
        ? resolvePlaybookForCard(card, input.playbooks)
        : null
    );
    if (resolved.source === 'playbook') {
      caveats.push('source=playbook:' + (resolved.playbook_id || ''));
    }

    // Snooze_or_dismiss → no client-facing draft.
    if (card.action_type === 'snooze_or_dismiss') {
      return {
        playbook_id:     'snooze_or_dismiss.v1',
        rep_profile_id:  repProfile.id,
        tone_variant:    'internal',
        channel:         'call',
        drafted_subject: undefined,
        drafted_message: '',
        talk_track:      [],
        rationale:       card.why_now || '',
        confidence:      1.0,
        caveats:         caveats.concat(['no client-facing draft']),
        safety_notes:    safety_notes,
        evidence_refs:   evidence_refs,
      };
    }

    // Call lane → talk_track only.
    if (pick.channel === 'call') {
      var talk = buildTalkTrack(card, ctx, resolved.talkTracks);
      evidence_refs.push({
        type: 'computed', source_table: null, id: null,
        reason: 'tone=' + pick.tone + ' channel=call (talk-track only)',
      });
      return {
        playbook_id:     'call.' + (card.action_type) + '.v1',
        rep_profile_id:  repProfile.id,
        tone_variant:    pick.tone,
        channel:         'call',
        drafted_subject: undefined,
        drafted_message: '',
        talk_track:      talk,
        rationale:       card.why_now || '',
        confidence:      0.85,
        caveats:         caveats,
        safety_notes:    safety_notes,
        evidence_refs:   evidence_refs,
      };
    }

    // SMS or email path.
    var fellBack = false;
    var hasMissingVars = false;

    var output = {
      playbook_id:     pick.tone + '.' + card.action_type + '.v1',
      rep_profile_id:  repProfile.id,
      tone_variant:    pick.tone,
      channel:         pick.channel,
      drafted_subject: undefined,
      drafted_message: '',
      talk_track:      [],
      rationale:       card.why_now || '',
      confidence:      0.85,
      caveats:         caveats,
      safety_notes:    safety_notes,
      evidence_refs:   evidence_refs,
    };

    if (pick.channel === 'sms') {
      var sms = buildSmsBody(card, ctx, pick.tone, repProfile, false, resolved.templates);
      if (!sms || sms.text === null) {
        return null;
      }
      output.drafted_message = sms.text;
      fellBack = sms.fellBack;
      safety_notes = safety_notes.concat(sms.safety_notes || []);
      var t = (resolved.templates && resolved.templates[card.action_type]) || {};
      hasMissingVars = detectMissingVariables(t.sms_primary || '', ctx);
    } else {
      var em = buildEmailBody(card, ctx, pick.tone, repProfile, resolved.templates);
      if (!em || em.subject === null) {
        return null;
      }
      output.drafted_subject = em.subject;
      output.drafted_message = em.body;
      safety_notes = safety_notes.concat(em.safety_notes || []);
      var te = (resolved.templates && resolved.templates[card.action_type]) || {};
      hasMissingVars = detectMissingVariables(te.email_body || '', ctx);
    }

    // Caveats from upstream context.
    if (card.action_type === 'reply_needed') {
      caveats.push('acknowledgement only — manual answer required');
    }
    if (pick.channel === 'sms' && !(jobBrain.job && jobBrain.job.client_phone) && (jobBrain.job && jobBrain.job.client_email)) {
      caveats.push('no phone on file — sent as email');
    }

    output.confidence = scoreConfidence(card, ctx, fellBack, pick.hadHighValueOverride, hasMissingVars);
    output.caveats = caveats;
    output.safety_notes = safety_notes;

    // Append decision evidence ref.
    evidence_refs.push({
      type: 'computed', source_table: null, id: null,
      reason: 'tone=' + pick.tone + ' channel=' + pick.channel
        + (pick.hadHighValueOverride ? ' (high-value override)' : ''),
    });
    output.evidence_refs = evidence_refs;

    return output;
  }

  return {
    draft: draft,
    BUDGETS: BUDGETS,
    REP_PROFILES: REP_PROFILES,
    DEFAULT_TONE: DEFAULT_TONE,
    HIGH_VALUE_THRESHOLD: HIGH_VALUE_THRESHOLD,
    // Internals exposed for tests:
    _resolveRepProfile: resolveRepProfile,
    _selectToneAndChannel: selectToneAndChannel,
    _scrubForbidden: scrubForbidden,
    _substitute: substitute,
    _resolvePlaybookForCard: resolvePlaybookForCard,
    _resolveTemplates: resolveTemplates,
  };
});
