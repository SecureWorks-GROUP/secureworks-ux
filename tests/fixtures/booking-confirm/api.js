/* Offline backend contract double. No network, calendar writer or send adapter. */
(function (root) {
  function optionalNote(note) {
    if (note === '' || note == null) return null;
    var trimmed = String(note).trim();
    if (!trimmed) throw new Error('400: note must not be empty');
    return trimmed;
  }
  function outcomeResponse(body, actorId) {
    return {visit_outcome: Object.assign({}, body, {
      id: root.crypto.randomUUID(),
      note: optionalNote(body.note),
      visit_start: new Date(body.visit_start).toISOString(),
      recorded_by_user_id: actorId,
      recorded_at: new Date().toISOString(),
      source: 'booking_screen'
    })};
  }
  function refuse(code, detail, status) {
    var e = new Error(code); e.status = status || 409; e.detail = detail || null;
    throw e;
  }
  var perthMs = function (iso) { return Date.parse(iso); };
  var clock = function (hhmm, date) { return Date.parse(date + 'T' + hhmm + ':00+08:00'); };
  // Owner-authored double (owner-authored-v1): the rulebook, the diary with
  // travel either side, other leads' offers, then the exact snapshot. It
  // mirrors the backend contract's refusal names; it is not the backend.
  function ownerVisitRules(rb, v) {
    if (!v || typeof v !== 'object') refuse('owner_visit_required', null, 400);
    var re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/;
    if (![v.window_start_iso, v.window_end_iso, v.end_iso].every(function (x) { return re.test(x || ''); })) refuse('owner_visit_times_invalid', null, 400);
    var date = v.window_start_iso.slice(0, 10), s = perthMs(v.window_start_iso), we = perthMs(v.window_end_iso), e = perthMs(v.end_iso);
    if (!(s > Date.now())) refuse('owner_visit_not_future');
    if (v.end_iso.slice(0, 10) !== date || v.window_end_iso.slice(0, 10) !== date) refuse('owner_visit_spans_days');
    var day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
    if (rb.days.indexOf(day) < 0) refuse('owner_visit_day_not_permitted', {day: day, days: rb.days});
    var mins = (we - s) / 60000;
    if (mins < rb.window_min_minutes || mins > rb.window_max_minutes) refuse('owner_visit_window_length', {minutes: mins});
    if (e - we < rb.visit_minutes * 60000) refuse('owner_visit_too_short');
    if (s < clock(rb.day_start, date) || e > clock(rb.day_end, date)) refuse('owner_visit_outside_hours');
    var gap = rb.travel_buffer_minutes * 60000;
    rb.protected_bands.forEach(function (b) {
      if (b.weekday === day && s - gap < clock(b.end, date) && clock(b.start, date) < e + gap) refuse('owner_visit_protected_band', {band: b});
    });
    return {date: date, start: s - gap, end: e + gap};
  }
  function create(api, data) {
    var writes = [], reads = [], records = [], approvals = {}, ownerOffers = [];
    var actorId = api.RESOURCES.marnin.scoper_user_id;
    function ownerAvailability(occ, contactId) {
      var diary = data.diary || [];
      var busy = diary.filter(function (ev) { return perthMs(ev.start) < occ.end && occ.start < perthMs(ev.end); });
      var ghl = busy.filter(function (ev) { return !/outlook/.test(ev.source || ''); })[0];
      if (ghl) refuse('ghl_calendar_clash', {travel_buffer_minutes: 30, events: [{id: ghl.event_id, title: ghl.title, start: ghl.start, end: ghl.end}]});
      var outlook = busy.filter(function (ev) { return /outlook/.test(ev.source || ''); })[0];
      if (outlook) refuse('outlook_calendar_clash', {mailbox: 'marnin@secureworkswa.com.au', travel_buffer_minutes: 30, events: [{subject: outlook.title, start: outlook.start, end: outlook.end}]});
      var offers = ((data.booking_flow && data.booking_flow.commitments) || []).map(function (o) { return {contact_id: o.contact_id, start_iso: o.start_iso, end_iso: o.end_iso, source: 'system_text'}; }).concat(ownerOffers);
      var hit = offers.filter(function (o) { return o.contact_id !== contactId && perthMs(o.start_iso) < occ.end && occ.start < perthMs(o.end_iso); })[0];
      if (hit) refuse('system_offer_clash', {offers: [hit]});
      var sameDay = diary.filter(function (ev) { return String(ev.start).slice(0, 10) === occ.date; }).length;
      return {ghl: {calendar_id: 'dEQKVKHthsjSYaen1fiE', events_that_day: sameDay, clashes: 0}, outlook: {mailbox: 'marnin@secureworkswa.com.au', clashes: 0},
        occupied: {travel_buffer_minutes: 30}, day_count_with_this_visit: sameDay + 1, offer_clashes: 0};
    }
    function ownerWrite(body) {
      var mode = root.fixtureOwnerMode || 'connected';
      if (mode === 'unknown') { var missing = new Error('Unknown action'); missing.status = 400; throw missing; }
      var input = body.owner_input || {}, dryRun = body.dry_run === true;
      var rb = data.booking_flow && data.booking_flow.owner_rulebook;
      var row = data.cases.filter(function (c) { return c.contact_id === input.contact_id; });
      if (!rb || !['message', 'calendar'].includes(input.step)) refuse('invalid_owner_input', null, 400);
      if (row.length !== 1 || row[0].id !== input.case_id) refuse('booking_case_identity_ambiguous');
      row = row[0];
      if (!dryRun && !input.prepared_at) refuse('owner_prepared_at_required', null, 400);
      var prepared = input.prepared_at || new Date().toISOString();
      if (Date.now() - Date.parse(prepared) >= 15 * 60000) refuse('owner_preview_expired');
      if (root.fixtureOwnerRefusal) refuse(root.fixtureOwnerRefusal, root.fixtureOwnerRefusalDetail || null);
      var checks = {rulebook: 'fixture', hand_sent_texts: 'not_machine_checked',
        hand_sent_texts_note: 'Texts sent by hand outside this system cannot be checked by the machine. Read the lead\'s thread for any time you offered by hand before approving.',
        system_offers: {open_offers: ownerOffers.length, unverified_texts: [], census_days: 21}};
      var content, occ = null;
      if (input.step === 'message') {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1600) refuse('owner_message_text_required', null, 400);
        if (/[\u2013\u2014]/.test(input.text)) refuse('owner_message_text_has_dash', null, 400);
        if (input.offer != null) occ = ownerVisitRules(rb, input.offer);
        var model = row.booking_read_model && row.booking_read_model.message && row.booking_read_model.message.routing;
        content = {text: input.text, sender: rb.sender, recipient: (model && model.to_number) || '+61400000777', variant: 'owner',
          offer: occ ? {window_start_iso: input.offer.window_start_iso, window_end_iso: input.offer.window_end_iso, end_iso: input.offer.end_iso} : null};
        checks.thread = {read: true, messages: ((data.threads || {})[row.contact_id] || []).length};
      } else {
        occ = ownerVisitRules(rb, input.visit);
        content = {provider: 'ghl', calendar_id: rb.calendar.calendar_id, assigned_user_id: rb.calendar.assigned_user_id,
          start_iso: input.visit.window_start_iso, end_iso: input.visit.end_iso, window_start_iso: input.visit.window_start_iso, window_end_iso: input.visit.window_end_iso,
          title: 'Scope visit: ' + row.display_name, address: '8 Example Street, ' + (row.suburb || 'Perth')};
        checks.address_street_source = 'ghl_contact';
      }
      var snapshot = {schema: 'scope-booking-approval.v1', source: 'owner', version: 'owner-authored-v1', step: input.step,
        case_id: row.id, contact_id: row.contact_id, resource: 'marnin', scoper_user_id: actorId, week_start: data.week_start,
        id: 'opp:' + (row.opportunity_id || row.id), profile: 'fencing-stratco-marnin', pack_revision: null, prepared_at: prepared, content_hash: null, content: content};
      snapshot.content_hash = api.bookingContentHash(snapshot);
      if (!dryRun && body.content_hash !== snapshot.content_hash) refuse('owner_snapshot_changed', {snapshot: snapshot});
      if (occ) Object.assign(checks, ownerAvailability(occ, row.contact_id));
      var approvalId = api.sha256Hex(api.canonicalJson(snapshot));
      if (dryRun) return {ok: true, dry_run: true, source: 'owner', snapshot: snapshot, content_hash: snapshot.content_hash, approval_id: approvalId, checks: checks};
      approvals[approvalId] = structuredClone(snapshot);
      if (occ && body.decision === 'approved') ownerOffers.push({contact_id: row.contact_id, start_iso: (input.offer || input.visit).window_start_iso, end_iso: (input.offer || input.visit).end_iso, source: 'owner_approval'});
      return {ok: true, source: 'owner', approval_id: approvalId, checks: checks,
        approval: {binding_hash: approvalId, step: input.step, state: body.decision, reason: body.reason || null, snapshot: structuredClone(snapshot),
          approved_by_email: 'marnin@secureworkswa.com.au', approved_at: new Date().toISOString(), expires_at: new Date(Date.now() + 15 * 60000).toISOString()}};
    }
    async function post(action, body) {
      if (action === 'sales_booking_approval_write' && body && body.owner_input !== undefined) {
        writes.push(structuredClone({action: action, body: body}));
        return structuredClone(ownerWrite(body));
      }
      if (action === 'record_visit_outcome') {
        var fields = ['booking_key','appointment_id','contact_id','opportunity_id','job_id','scoper_user_id','scoper_name','visit_start','outcome','reason','note','quote_owed','supersedes'];
        if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(fields.sort())) throw Error('Flat outcome request required');
        optionalNote(body.note);
        var current = records.filter(function (r) {
          return r.booking_key === body.booking_key && !records.some(function (next) { return next.supersedes === r.id; });
        })[0];
        if ((current && current.id || null) !== body.supersedes) throw Error('409: refresh current outcome');
        writes.push(structuredClone({action:action,body:body}));
        var result = outcomeResponse(body, actorId);
        records.push(result.visit_outcome);
        return structuredClone(result);
      }
      if (action === 'sales_booking_send' || action === 'sales_booking_book') {
        // The executor actions are optional in this double. By default they do
        // not exist, exactly like a backend that has not shipped them yet.
        var mode = root.fixtureActionMode || 'unknown';
        writes.push(structuredClone({action:action,body:body}));
        if (mode === 'unknown') { var missing = new Error('Unknown action'); missing.status = 400; throw missing; }
        if (!approvals[body.approval_id]) return {status:'refused',reason:'approval_not_found'};
        if (mode === 'refused') return {status:'refused',reason:'prior_offer_conflict'};
        if (mode === 'dry_run') return {status:'dry_run',reason:null,would_write:action === 'sales_booking_send' ? {text:approvals[body.approval_id].content.text} : {start:approvals[body.approval_id].content.start_iso,end:approvals[body.approval_id].content.end_iso}};
        return action === 'sales_booking_send'
          ? {status:'sent',reason:null,message_id:'fixture-message-1'}
          : {status:'booked',reason:null,appointment_id:'fixture-appointment-1',written:['GHL Stratco Fencing calendar','Marnin\'s Outlook']};
      }
      if (action !== 'sales_booking_approval_write' || !body.snapshot || !['calendar','message'].includes(body.snapshot.step)) throw Error('Unexpected write refused');
      writes.push(structuredClone({action:action,body:body}));
      var id = 'fixture-approval-' + (writes.length);
      approvals[id] = structuredClone(body.snapshot);
      return {ok:true,approval:{id:id,snapshot:structuredClone(body.snapshot),state:body.decision,reason:body.reason}};
    }
    async function read(action, params) {
      reads.push(structuredClone({action:action,params:params}));
      if (action === 'list_visit_outcomes') {
        var limit = Number(params.limit || 100), offset = Number(params.offset || 0);
        if (!Number.isFinite(Date.parse(params.since)) || !Number.isFinite(Date.parse(params.until))) throw Error('since/until required');
        var current = records.filter(function (r) {
          return !records.some(function (next) { return next.supersedes === r.id; }) &&
            (!params.scoper_user_id || r.scoper_user_id === params.scoper_user_id) &&
            Date.parse(r.visit_start) >= Date.parse(params.since) && Date.parse(r.visit_start) < Date.parse(params.until);
        });
        var outcomes = current.slice(offset, offset + limit);
        var result = {outcomes:outcomes,limit:limit,offset:offset,has_more:current.length > offset + limit};
        if (String(params.include_history) === 'true') result.history = records.filter(function (r) { return outcomes.some(function (c) { return c.booking_key === r.booking_key; }); });
        return structuredClone(result);
      }
      if (action !== 'sales_booking_read') throw Error('Unexpected read refused');
      // The workspace producer composes the list; the browser still has one read.
      var page = await read('list_visit_outcomes', {
        scoper_user_id:params.scoper_user_id,
        since:params.visit_outcomes_from,until:params.visit_outcomes_to,
        include_history:true,limit:500,offset:0
      });
      data.visit_outcomes = page.history;
      return structuredClone(data);
    }
    return {post:post,read:read,writes:writes,reads:reads};
  }
  var fixture = {create:create,outcomeResponse:outcomeResponse};
  if (typeof module === 'object' && module.exports) module.exports = fixture;
  else root.BookingConfirmFixtureAPI = fixture;
})(typeof window !== 'undefined' ? window : globalThis);
