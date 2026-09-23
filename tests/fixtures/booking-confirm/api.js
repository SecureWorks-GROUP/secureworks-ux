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
  function create(api, data) {
    var writes = [], reads = [], records = [], approvals = {};
    var actorId = api.RESOURCES.marnin.scoper_user_id;
    async function post(action, body) {
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
