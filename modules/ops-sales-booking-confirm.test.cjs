const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./ops-sales-booking.js');
const fixture = require('../tests/fixtures/booking-confirm/read.js');
const backendFixture = require('../tests/fixtures/booking-confirm/api.js');
const outcomeResponse = body => backendFixture.outcomeResponse(body, api.RESOURCES.marnin.scoper_user_id);
let data, row, writes;
beforeEach(() => {
  data = fixture(api); row = data.cases[0]; writes = [];
  Object.assign(api.state, { resourceId: 'marnin', weekStart: data.week_start, data, selectedId: row.id,
    loading: false, stale: false, error: null, filter: 'all', search: '', cache: {}, textChoices: {},
    visitForms: {}, visitPending: {}, visitUncertain: {}, visitRecorded: {}, visitErrors: {}, shownVisits: {}, approvalPending: {}, approvalErrors: {}, shownApprovals: {}, opened: true,
    drafts: {}, approvalIds: {}, pressResults: {}, pressPending: {}, showDetails: false, dayIndex: null });
  global.SECUREWORKS_CLOUD = {auth:{getUser:()=>({id:api.RESOURCES.marnin.scoper_user_id})}};
  global.opsPost = async (action, body) => {
    writes.push(structuredClone({action, body}));
    return {ok:true, approval:{state:body.decision, reason:body.reason, snapshot:structuredClone(body.snapshot)}};
  };
  api.renderHTML();
});
test('Perth Monday switches at local midnight, regardless of UTC day', () => {
  assert.equal(api.currentPerthWeek(Date.parse('2026-09-20T15:59:59Z')), '2026-09-14');
  assert.equal(api.currentPerthWeek(Date.parse('2026-09-20T16:00:00Z')), '2026-09-21');
});
test('signed-in scoper UUID selects their profile; names never guess identity', () => {
  assert.equal(api.signedInResource({id:api.RESOURCES.marnin.scoper_user_id}), 'marnin');
  assert.equal(api.signedInResource({scoper_user_id:api.RESOURCES.khairo.scoper_user_id}), 'khairo');
  assert.equal(api.signedInResource({name:'Marnin'}), null);
});
test('first open resets stale week and stale scoper to signed-in profile', async () => {
  global.SECUREWORKS_CLOUD = {auth:{getUser:()=>({id:api.RESOURCES.marnin.scoper_user_id})}};
  let read;
  global.opsFetch = async (path, params) => { read = {path, params}; return {...data, week_start:api.currentPerthWeek()}; };
  Object.assign(api.state, {opened:false, resourceId:'nithin', weekStart:'2020-01-06'});
  api.show('booking');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(api.state.weekStart, api.currentPerthWeek());
  assert.equal(api.state.resourceId, 'marnin');
  assert.equal(read.path, 'sales_booking_read');
  assert.equal(read.params.resource, 'marnin');
});
test('previous week cannot navigate into the past', async () => {
  global.opsFetch = async () => ({...data, week_start:api.currentPerthWeek()});
  api.state.weekStart = api.currentPerthWeek();
  await api.switchWeek(-7);
  assert.equal(api.state.weekStart, api.currentPerthWeek());
});
test('calendar approval records only exact GHL calendar snapshot, never text approval', async () => {
  assert.equal(api.approvalBlock(row, 'calendar'), '');
  const result = await api.recordApproval(row.id, 'calendar', 'approved');
  assert.equal(result.ok, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].action, 'sales_booking_approval_write');
  assert.equal(writes[0].body.snapshot.step, 'calendar');
  assert.equal(writes[0].body.snapshot.content.provider, 'ghl');
  assert.equal(writes[0].body.snapshot.content.text, undefined);
  assert.equal(row.booking_read_model.message.state, 'awaiting_approval');
  assert.equal(result.sent, false);
  assert.match(api.renderHTML(), /Send this text/);
});
test('exact template approval persists independently during send hold', async () => {
  row.booking_read_model.message.template_text += '\n  Exact spacing stays.  ';
  api.renderHTML();
  const result = await api.recordApproval(row.id, 'message', 'approved');
  assert.equal(result.ok, true);
  assert.equal(writes[0].body.snapshot.content.text, row.booking_read_model.message.template_text);
  assert.equal(writes[0].body.snapshot.content.variant, 'template');
  assert.equal(row.booking_read_model.calendar_write.state, 'awaiting_approval');
  assert.equal(result.sent, false);
  assert.match(api.renderHTML(), /You approved this exact text\. Not sent yet\./);
});
test('changed displayed text, recipient, slot or revision needs a fresh review', async () => {
  for (const field of ['template_text','recipient']) {
    if (field === 'recipient') row.booking_read_model.message.routing.to_number += ' changed';
    else row.booking_read_model.message[field] += ' changed';
    assert.equal((await api.recordApproval(row.id, 'message', 'approved')).ok, false);
    api.renderHTML();
  }
  row.booking_read_model.calendar_write.preview.end = row.booking_read_model.calendar_write.preview.end.replace('11:30','11:45');
  assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
  api.renderHTML();
  row.booking_read_model.pack_revision += '-changed';
  assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
  assert.equal(writes.length, 0);
});
test('repeat clicks while pending and after approval cannot duplicate approval', async () => {
  let finish;
  global.opsPost = async (action, body) => { writes.push({action,body}); return new Promise(resolve => { finish = () => resolve({ok:true,approval:{snapshot:body.snapshot,state:body.decision}}); }); };
  const first = api.recordApproval(row.id, 'calendar', 'approved');
  assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
  finish(); await first;
  assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
  assert.equal(writes.length, 1);
});
test('failed, missing and not-configured calendars never permit booking', async () => {
  for (const state of ['could_not_read','not_configured',undefined]) {
    data.booking_flow.calendar_read = state ? {state,provider:'ghl',reason:'Provider unavailable'} : null;
    data.resource.calendar = null;
    api.renderHTML();
    assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
    assert.equal(api.approvalBlock(row, 'message'), '');
    assert.doesNotMatch(api.renderHTML(), /class="daycol/);
  }
  assert.equal(writes.length, 0);
});
test('legacy data and stamps cannot become separate authority', async () => {
  delete data.booking_flow;
  row.stamp_state = 'approved';
  api.renderHTML();
  assert.equal((await api.recordApproval(row.id,'calendar','approved')).ok, false);
  assert.equal((await api.writeStamp(row.id,'keep')).ok, false);
  assert.equal((await api.postStamp({approved:[row.id]})).ok, false);
  assert.equal(writes.length, 0);
  assert.doesNotMatch(api.renderHTML(), /data-booking-stamp|>Send message</);
});
test('expired, unvalidated, uncertain or mismatched evidence fails closed', async () => {
  const m = row.booking_read_model;
  for (const mutate of [
    () => { m.expires_at = new Date(Date.now()-1).toISOString(); },
    () => { m.validation.ok = false; },
    () => { m.validation.checks[0].passed = false; m.validation.checks[0].reason = 'Contact unresolved'; },
    () => { m.contact_id = 'another-contact'; }
  ]) {
    const original = structuredClone(m);
    mutate(); api.renderHTML();
    assert.equal((await api.recordApproval(row.id,'calendar','approved')).ok, false);
    Object.assign(m, original);
  }
  assert.equal(writes.length, 0);
});
test('prior offers and agreements reserve slots by contact id', async () => {
  const p = row.booking_read_model.calendar_write.preview;
  data.booking_flow.commitments.push({id:'hold-a',contact_id:'another-contact',state:'agreed',start_iso:p.start,end_iso:p.end});
  api.renderHTML();
  assert.match(api.approvalBlock(row,'calendar'), /Slot taken/);
  row.booking_read_model.proposal.commitment_id = 'hold-a'; // Cannot steal another contact's hold.
  assert.match(api.approvalBlock(row,'calendar'), /Slot taken/);
  data.booking_flow.commitments.at(-1).contact_id = row.contact_id;
  assert.equal(api.approvalBlock(row,'calendar'), '');
  assert.match(api.renderHTML(), /Customer agreed/);
  assert.equal(api.diaryEventMatchesCase({display_name:row.display_name, suburb:row.suburb}, row), false);
});
test('busy diary and protected band block a proposal even if validation claims pass', () => {
  const p = row.booking_read_model.calendar_write.preview;
  data.diary.push({event_id:'busy',start:p.start,end:p.end,kind:'busy',blocks_capacity:true});
  assert.match(api.approvalBlock(row,'calendar'), /Clashes with Busy at 9:00am \(GHL\)/);
  assert.equal(api.approvalBlock(row,'message'), '');
  data.diary = [];
  p.start = p.start.replace('09:00','13:00'); p.end = p.end.replace('11:30','14:00');
  assert.match(api.approvalBlock(row,'calendar'), /protected Canning Vale/);
  assert.equal(api.approvalBlock(row,'message'), '');
});
test('refusal requires a reason and records only that channel', async () => {
  assert.equal((await api.recordApproval(row.id,'calendar','refused','')).ok, false);
  api.renderHTML();
  assert.equal((await api.recordApproval(row.id,'calendar','refused','I am unavailable')).ok, true);
  assert.equal(row.booking_read_model.calendar_write.reason, 'I am unavailable');
  assert.equal(row.booking_read_model.message.state, 'awaiting_approval');
  assert.match(api.renderHTML(), /Refused/);
  assert.equal((await api.recordApproval(row.id,'calendar','approved')).ok, false);
});
test('bad receipt and transport errors never paint success', async () => {
  global.opsPost = async () => ({ok:true,approval:{state:'approved',snapshot:{}}});
  assert.equal((await api.recordApproval(row.id,'message','approved')).ok, false);
  assert.equal(row.booking_read_model.message.state, 'awaiting_approval');
  global.opsPost = async () => { throw Error('Connection lost'); };
  assert.equal((await api.recordApproval(row.id,'message','approved')).ok, false);
  assert.match(api.renderHTML(), /Connection lost/);
});
test('read-back approval survives reload only for its bound content, done stays producer-owned', async () => {
  await api.recordApproval(row.id,'calendar','approved');
  const receipt = structuredClone(row.booking_read_model.calendar_write);
  api.state.data = structuredClone(data);
  assert.match(api.renderHTML(), /<strong>Approved<\/strong>/);
  api.state.data.cases[0].booking_read_model.calendar_write.state = 'succeeded';
  assert.match(api.renderHTML(), /<strong>Done<\/strong>/);
  api.state.data.cases[0].booking_read_model.pack_revision += '-changed';
  assert.doesNotMatch(api.renderHTML(), /<strong>Done<\/strong>/);
  assert.equal(receipt.state, 'approved');
});
test('launch schema never selects AI wording or unrecognized approved bytes', () => {
  const msg = row.booking_read_model.message;
  assert.equal(msg.ai_proposed_text, null);
  msg.ai_proposed_text = 'Unreleased optional wording';
  msg.chosen = 'unrecognized'; msg.approved_text = 'Old arbitrary draft';
  assert.doesNotMatch(api.renderHTML(), /Unreleased optional wording|Old arbitrary draft|Choose AI text/);
  assert.equal(api.approvalSnapshot(row,'message').content.text, msg.template_text);
});
test('proposal, exact quotes, checks and needs-a-person reason are visible and escaped', () => {
  row.booking_read_model.evidence_quotes[0].quote = '<img src=x> Saturday?';
  row.booking_read_model.validation.checks[0] = {label:'Customer day',passed:false,reason:'Day is ambiguous'};
  const html = api.renderHTML();
  assert.match(html,/&lt;img src=x&gt; Saturday/);
  assert.match(html,/Failed: Customer day · Day is ambiguous/);
  assert.match(html,/This is when the AI thinks we should book/);
  api.state.selectedId = 'lead-person';
  assert.match(api.renderHTML(),/Needs a person[\s\S]*Customer has not supplied a day or arrival window/);
});
test('visit happened records exact append-only fields with quote owed and no message', async () => {
  global.opsPost = async (action, body) => { writes.push({action,body}); return outcomeResponse(body); };
  const result = await api.recordVisitOutcome('demo-booking-completed','happened',null,'Measured both sides');
  assert.equal(result.ok,true);
  assert.equal(result.sent,false);
  assert.equal(writes[0].action,'record_visit_outcome');
  const r = result.visit_outcome;
  assert.deepEqual(Object.keys(r).sort(), ['id','booking_key','appointment_id','contact_id','opportunity_id','job_id','scoper_user_id','scoper_name','visit_start','outcome','reason','note','quote_owed','recorded_by_user_id','recorded_at','source','supersedes'].sort());
  assert.match(r.id,/^[0-9a-f-]{36}$/);
  assert.equal(r.quote_owed,true);
  assert.equal(r.reason,null);
  assert.equal(r.source,'booking_screen');
  assert.equal(r.supersedes,null);
  assert.equal(data.visit_outcomes.length,1);
  assert.doesNotMatch(api.renderHTML(),/visit needs an outcome/);
});
test('did-not-happen requires one of three reasons and records no quote obligation', async () => {
  global.opsPost = async (action,body) => { writes.push({action,body}); return outcomeResponse(body); };
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','did_not_happen',null,'')).ok,false);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','did_not_happen','wrong','')).ok,false);
  const result = await api.recordVisitOutcome('demo-booking-completed','did_not_happen','customer_not_home','Gate locked');
  assert.equal(result.ok,true);
  assert.equal(result.visit_outcome.reason,'customer_not_home');
  assert.equal(result.visit_outcome.quote_owed,false);
  assert.equal(writes.length,1);
});
test('outcome correction appends with supersedes, quote owed can be unticked', async () => {
  global.opsPost = async (_,body) => (outcomeResponse(body));
  const first = await api.recordVisitOutcome('demo-booking-completed','happened',null,'',true);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'',false)).ok,false);
  api.state.visitForms['marnin|demo-booking-completed'] = {};
  api.renderHTML();
  const correction = await api.recordVisitOutcome('demo-booking-completed','happened',null,'Quote already sent',false);
  assert.equal(correction.ok,true);
  assert.equal(correction.visit_outcome.supersedes,first.visit_outcome.id);
  assert.equal(correction.visit_outcome.quote_owed,false);
  assert.equal(data.visit_outcomes.length,2);
  assert.equal(data.visit_outcomes[0].quote_owed,true);
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id,correction.visit_outcome.id);
});
test('only last-seven-day unresolved visits enter the amber list', () => {
  data.booked_visits[0].visit_start = new Date(Date.now()-86400000).toISOString();
  api.state.showDetails = true;
  assert.match(api.renderHTML(),/1 visit to close out/);
  data.booked_visits[0].visit_start = new Date(Date.now()-8*86400000).toISOString();
  assert.doesNotMatch(api.renderHTML(),/aria-label="Visits missing an outcome"/);
  data.booked_visits[0].visit_start = new Date(Date.now()+86400000).toISOString();
  assert.doesNotMatch(api.renderHTML(),/aria-label="Visits missing an outcome"/);
  assert.match(api.renderHTML(),/This visit has not started/);
});
test('missing visit outcome support stays a calm line in its section', () => {
  delete data.booking_flow;
  api.state.showDetails = true;
  const html = api.renderHTML();
  assert.match(html, /<section class="bk-details"[^>]*>[\s\S]*Visit outcomes are not connected yet/);
  assert.doesNotMatch(html, /role="alert"[^>]*>[^<]*Visit outcomes|to close out/);
  assert.doesNotMatch(html, /Visit outcomes have not been read|Missing outcomes cannot be checked yet/);
  assert.doesNotMatch(html, /class="notice warn"[^>]*>[\s\S]*Visit outcomes/);
  data.booking_flow = { version: 'booking-confirm.v1', approval_write: 'separate-v1', visit_outcomes_read: 'missing' };
  const incomplete = api.renderHTML();
  assert.match(incomplete, /<section class="bk-details"[^>]*>[\s\S]*Visit outcomes are not connected yet/);
  assert.doesNotMatch(incomplete, /Visit outcomes have not been read|class="notice warn"[^>]*>[\s\S]*Visit outcomes/);
});
test('verified visit insert after load replaces state cannot root-insert on reopen', async () => {
  let finish;
  api.state.showDetails = true;
  global.opsPost = async (action, body) => {
    writes.push({action, body});
    return new Promise((resolve) => { finish = () => resolve(outcomeResponse(structuredClone(body))); });
  };
  const inflight = api.recordVisitOutcome('demo-booking-completed','happened',null,'Measured both sides');
  const pendingHtml = api.renderHTML();
  assert.match(pendingHtml, /Recording outcome/);
  assert.match(pendingHtml, /data-visit-outcome="happened"[^>]* disabled/);
  const emptyOutcomes = () => {
    const next = structuredClone(data);
    next.visit_outcomes = [];
    return next;
  };
  global.opsFetch = async () => emptyOutcomes();
  await api.load('marnin', api.state.weekStart);
  assert.equal((api.state.data.visit_outcomes || []).length, 0);
  finish();
  const result = await inflight;
  assert.equal(result.ok, true);
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id, result.visit_outcome.id);
  assert.equal(api.state.data.visit_outcomes.some((row) => row.id === result.visit_outcome.id), true);
  global.opsPost = async (action, body) => {
    writes.push({action, body});
    return outcomeResponse(body);
  };
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'again')).ok, false);
  assert.match(api.renderHTML(), /Correct outcome/);
  assert.doesNotMatch(api.renderHTML(), /data-visit-outcome="happened"/);
  await api.load('marnin', api.state.weekStart);
  assert.equal((api.state.data.visit_outcomes || []).length, 0);
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id, result.visit_outcome.id);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'reopen')).ok, false);
  assert.match(api.renderHTML(), /Correct outcome/);
  assert.doesNotMatch(api.renderHTML(), /data-visit-outcome="happened"/);
  api.state.visitForms['marnin|demo-booking-completed'] = {};
  api.renderHTML();
  const correction = await api.recordVisitOutcome('demo-booking-completed','did_not_happen','rescheduled','Moved',false);
  assert.equal(correction.ok, true);
  assert.equal(correction.visit_outcome.supersedes, result.visit_outcome.id);
  assert.equal(writes.filter((w) => w.action === 'record_visit_outcome').length, 2);
});
test('outcome note validation, unknown persistence and stale booking prevent extra inserts', async () => {
  global.opsPost = async () => { writes.push(1); throw Error('Connection lost'); };
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'x'.repeat(201))).ok,false);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'two\nlines')).ok,false);
  assert.equal(writes.length,0);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'')).ok,false);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'')).ok,false);
  assert.equal(writes.length,1);
  assert.equal(data.visit_outcomes.length,0);
});
test('the producer schema maps checks, unknown receipts and missing additions honestly', () => {
  const raw = row.booking_read_model;
  delete raw.calendar_write.preview;
  delete raw.validation.checks;
  assert.match(api.approvalBlock(row,'calendar'),/could not be pinned down/);
  assert.equal(api.decisionModel(row).validation.length,0);
  raw.calendar_write.approval = {ui_snapshot:api.approvalSnapshot(row,'calendar')};
  raw.calendar_write.state = 'unknown';
  raw.calendar_write.receipt = {error:'Provider outcome unconfirmed'};
  assert.match(api.renderHTML(),/Result unknown<\/strong> Check GHL before trying again/);
});
test('arrival label uses the promised window, not the longer calendar occupancy', () => {
  const c = api.cases()[0];
  assert.match(api.proposalSlotLabel(c),/9:00am to 10:30am/);
  assert.doesNotMatch(api.proposalSlotLabel(c),/11:30/);
  assert.equal(api.approvalSnapshot(c,'calendar').content.end_iso.slice(11,16),'11:30');
});
test('read-back JSON key ordering does not invalidate an exact approval', async () => {
  global.opsPost = async (_,body) => ({ok:true,approval:{state:body.decision,snapshot:Object.fromEntries(Object.entries(body.snapshot).reverse())}});
  assert.equal((await api.recordApproval(row.id,'calendar','approved')).ok,true);
  row.booking_read_model.calendar_write.approval.ui_snapshot.content = Object.fromEntries(Object.entries(row.booking_read_model.calendar_write.approval.ui_snapshot.content).reverse());
  assert.match(api.renderHTML(), /<strong>Approved<\/strong>/);
});
test('backend fixture accepts flat outcome body and server-normalized response without ok', async () => {
  const backend = backendFixture.create(api, data);
  global.opsPost = backend.post;
  data.booked_visits[0].visit_start = new Date(Date.now()-86400000).toISOString().replace('Z', '+00:00');
  api.renderHTML();
  const result = await api.recordVisitOutcome('demo-booking-completed','happened',null,'  Measured both sides  ');
  assert.equal(result.ok,true);
  assert.equal(result.visit_outcome.note,'Measured both sides');
  assert.equal(result.visit_outcome.visit_start,new Date(data.booked_visits[0].visit_start).toISOString());
  const request = backend.writes[0];
  assert.equal(request.action,'record_visit_outcome');
  for (const field of ['visit_outcome','id','recorded_by_user_id','recorded_at','source']) assert.equal(Object.hasOwn(request.body,field),false);
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id,result.visit_outcome.id);
});
test('whitespace-only optional note records as null against the live empty-note rule', async () => {
  const backend = backendFixture.create(api, data);
  const visit = data.booked_visits[0];
  await assert.rejects(() => backend.post('record_visit_outcome', {
    booking_key:visit.booking_key, appointment_id:visit.appointment_id, contact_id:visit.contact_id,
    opportunity_id:visit.opportunity_id, job_id:visit.job_id, scoper_user_id:visit.scoper_user_id,
    scoper_name:api.RESOURCES.marnin.name, visit_start:visit.visit_start, outcome:'happened',
    reason:null, note:'   ', quote_owed:true, supersedes:null
  }), /400/);
  assert.equal(backend.writes.length,0);
  global.opsPost = backend.post;
  const result = await api.recordVisitOutcome('demo-booking-completed','happened',null,'   ');
  assert.equal(result.ok,true);
  assert.equal(result.sent,false);
  assert.equal(result.visit_outcome.note,null);
  assert.equal(backend.writes[0].body.note,null);
  assert.match(result.visit_outcome.id,/^[0-9a-f-]{36}$/);
  assert.equal(result.visit_outcome.source,'booking_screen');
  assert.equal(result.visit_outcome.recorded_by_user_id,api.RESOURCES.marnin.scoper_user_id);
  assert.equal(data.visit_outcomes.length,1);
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id,result.visit_outcome.id);
  assert.equal(api.state.visitUncertain['marnin|demo-booking-completed'],undefined);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'   ')).ok,false);
  assert.equal(backend.writes.length,1);
});
test('wrong facts or missing server provenance never verify an outcome or enable a retry', async () => {
  for (const patch of [
    {id:undefined}, {id:'not-a-uuid'}, {recorded_by_user_id:'someone-else'},
    {recorded_at:'yesterday'}, {source:'other'}, {booking_key:'another-booking'},
    {contact_id:'another-contact'}, {visit_start:new Date().toISOString()},
    {outcome:'did_not_happen'}, {quote_owed:false}, {note:'Changed'}, {supersedes:'another-record'}
  ]) {
    api.state.visitUncertain = {}; api.state.visitErrors = {};
    global.opsPost = async (action,body) => {
      writes.push({action,body});
      const result = outcomeResponse(body);
      Object.assign(result.visit_outcome,patch);
      return result;
    };
    const count = writes.length;
    assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'')).ok,false);
    assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'')).ok,false);
    assert.equal(writes.length,count+1);
    assert.equal(api.latestVisitOutcome('demo-booking-completed'),null);
  }
});
test('fixture composes canonical list history and keeps both approval calls independent', async () => {
  const backend = backendFixture.create(api,data);
  global.opsPost = backend.post;
  global.opsFetch = backend.read;
  assert.equal((await api.recordApproval(row.id,'calendar','approved')).ok,true);
  assert.equal(row.booking_read_model.message.state,'awaiting_approval');
  assert.equal((await api.recordApproval(row.id,'message','approved')).ok,true);
  assert.deepEqual(backend.writes.map(w => [w.action,w.body.snapshot.step]), [
    ['sales_booking_approval_write','calendar'],['sales_booking_approval_write','message']
  ]);
  const first = await api.recordVisitOutcome('demo-booking-completed','happened',null,'');
  api.state.visitForms['marnin|demo-booking-completed'] = {};
  api.renderHTML();
  const correction = await api.recordVisitOutcome('demo-booking-completed','did_not_happen','rescheduled','Moved',false);
  await api.load('marnin',api.state.weekStart);
  api.state.visitRecorded = {}; // Fresh-session truth must come from the read.
  assert.equal(api.latestVisitOutcome('demo-booking-completed').id,correction.visit_outcome.id);
  assert.equal(api.state.data.visit_outcomes.length,2);
  assert.equal(api.state.data.visit_outcomes[0].id,first.visit_outcome.id);
  const list = backend.reads.find(r => r.action === 'list_visit_outcomes');
  assert.equal(list.params.include_history,true);
  assert.ok(list.params.since && list.params.until);
  assert.equal(Object.hasOwn(list.params,'start'),false);
  assert.equal(Object.hasOwn(list.params,'end'),false);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','happened',null,'')).ok,false);
});

// ---- Redesign: one press = approval of the exact words, then the action ----
const nodeCrypto = require('node:crypto');
function backendCanonical(value) { // copy of ops-api canonicalBookingJson
  if (Array.isArray(value)) return `[${value.map(backendCanonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${backendCanonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function editDraft(text) {
  const d = api.draftFor(row);
  d.text = text; d.humanEdited = true; d.revision += 1;
  api.renderHTML();
}
function actionPost(results) {
  global.opsPost = async (action, body) => {
    writes.push(structuredClone({action, body}));
    if (action === 'sales_booking_approval_write') return {ok:true, approval:{id:'appr-' + writes.length, state:body.decision, reason:body.reason, snapshot:structuredClone(body.snapshot)}};
    const next = results[action];
    if (next instanceof Error) throw next;
    return next;
  };
}
test('an edited text is approved as the edited words, bound by the backend hash', async () => {
  actionPost({sales_booking_send:{status:'sent',message_id:'m-1'}});
  editDraft('Hi Example, Tuesday between 9 and 10:30 suits. Marnin');
  const snap = api.approvalSnapshot(row, 'message');
  assert.equal(snap.content.text, 'Hi Example, Tuesday between 9 and 10:30 suits. Marnin');
  assert.equal(snap.content.variant, 'edited');
  const {content_hash, ...binding} = snap;
  assert.equal(content_hash, nodeCrypto.createHash('sha256').update(backendCanonical(binding)).digest('hex'));
  const result = await api.press(row.id, 'message');
  assert.equal(result.ok, true);
  assert.equal(writes[0].action, 'sales_booking_approval_write');
  assert.equal(writes[0].body.snapshot.content.text, snap.content.text);
  assert.deepEqual(writes[1], {action:'sales_booking_send', body:{approval_id:'appr-1'}});
  const html = api.renderHTML();
  assert.match(html, /Text sent at [0-9:]+[ap]m from line 001 to the phone ending 002\./);
  assert.match(html, /data-booking-press="message"[^>]* disabled/);
  // Typing the proposed words back returns to the producer's own template and hash.
  editDraft(row.booking_read_model.message.template_text);
  assert.equal(api.approvalSnapshot(row,'message').content_hash, 'fixture-text-v1');
  assert.equal(api.approvalSnapshot(row,'message').content.variant, 'template');
});
test('a missing send action says not connected and never claims a send', async () => {
  const missing = new Error('Unknown action'); missing.status = 400;
  actionPost({sales_booking_send: missing, sales_booking_book: missing});
  const sent = await api.press(row.id, 'message');
  assert.equal(sent.ok, false);
  const booked = await api.press(row.id, 'calendar');
  assert.equal(booked.ok, false);
  const html = api.renderHTML();
  assert.match(html, /Sending from this screen is not connected yet\. Your approval is recorded; nothing was sent\./);
  assert.match(html, /Booking from this screen is not connected yet\. Your approval is recorded; nothing was booked\./);
  assert.doesNotMatch(html, /Text sent|Booked Tuesday/);
  // A second press reuses the recorded approval instead of writing another one.
  await api.press(row.id, 'message');
  assert.equal(writes.filter((w) => w.action === 'sales_booking_approval_write').length, 2);
  assert.equal(writes.filter((w) => w.action === 'sales_booking_send').length, 2);
});
test('refused, trial and unclear answers are stated in words; unclear blocks a blind retry', async () => {
  actionPost({sales_booking_book:{status:'refused',reason:'prior_offer_conflict'}});
  await api.press(row.id, 'calendar');
  assert.match(api.renderHTML(), /Not booked: that time is already offered to someone else\./);
  actionPost({sales_booking_book:{status:'dry_run',would_write:{start:row.booking_read_model.calendar_write.preview.start,end:row.booking_read_model.calendar_write.preview.end}}});
  await api.press(row.id, 'calendar');
  assert.match(api.renderHTML(), /Checked only, nothing was booked\. The server is in trial mode\. It would have booked 9:00 to 11:30am/);
  actionPost({sales_booking_book:{status:'booked',appointment_id:'apt-9',written:['GHL Stratco Fencing calendar',"Marnin's Outlook"]}});
  await api.press(row.id, 'calendar');
  assert.match(api.renderHTML(), /Booked Tuesday [0-9]+ [A-Z][a-z]+, arrive 9:00 to 10:30am in GHL Stratco Fencing calendar and Marnin&#39;s Outlook|Booked Tuesday [0-9]+ [A-Z][a-z]+, arrive 9:00 to 10:30am in GHL Stratco Fencing calendar and Marnin's Outlook/);
  assert.match(api.renderHTML(), /GHL appointment apt-9/);
  actionPost({sales_booking_send:{weird:true}});
  await api.press(row.id, 'message');
  assert.match(api.renderHTML(), /The server answered without a clear result\. Check GHL before pressing again\./);
  const before = writes.length;
  assert.equal((await api.press(row.id, 'message')).ok, false);
  assert.equal(writes.length, before);
});
test('book it names the calendars it writes and a clash names the other booking', () => {
  const html = api.renderHTML();
  assert.match(html, /Book it writes: <b>GHL calendar<\/b> and <b>Marnin's Outlook<\/b>/);
  const p = row.booking_read_model.calendar_write.preview;
  data.diary.push({event_id:'mel',start:p.start.replace('09:00','10:00'),end:p.end,title:'Scope: Melanie N, Piara Waters',kind:'busy',source:'outlook',blocks_capacity:true});
  assert.equal(api.approvalBlock(row,'calendar'), 'Clashes with Scope: Melanie N, Piara Waters at 10:00am (Outlook).');
  assert.equal(api.approvalBlock(row,'message'), '');
  const card = api.renderCard();
  assert.match(card, /data-booking-compose-foot[\s\S]*?class="clash">Clashes with Scope: Melanie N, Piara Waters at 10:00am \(Outlook\)\./);
  assert.match(card, /class="visit"[\s\S]*class="clash">Clashes with Scope: Melanie N, Piara Waters at 10:00am \(Outlook\)\./);
  assert.equal(api.sourceLabel({source:'ghl_calendar'}), 'GHL');
  assert.equal(api.sourceLabel({}), 'GHL');
  assert.equal(api.sourceLabel({source:'outlook'}), 'Outlook');
});
test('a booked result without a written list names the calendars Book it promised', () => {
  const snap = api.approvalSnapshot(row, 'calendar');
  const r = api.describeResult('calendar', {status:'booked', appointment_id:'apt-x'}, row, snap);
  assert.match(r.text, /in GHL calendar and Marnin's Outlook at /);
});
test('use the proposed text cannot change words while a press is in flight', async () => {
  editDraft('Edited words for Kerry');
  assert.match(api.renderHTML(), /Use the proposed text/);
  let finishApproval;
  global.opsPost = async (action, body) => {
    writes.push(structuredClone({action, body}));
    if (action === 'sales_booking_approval_write') {
      return new Promise((resolve) => {
        finishApproval = () => resolve({ok:true, approval:{id:'appr-reset', state:body.decision, snapshot:structuredClone(body.snapshot)}});
      });
    }
    return {status:'sent', message_id:'m-reset'};
  };
  const pending = api.press(row.id, 'message');
  const html = api.renderHTML();
  assert.doesNotMatch(html, /Use the proposed text/);
  assert.match(html, /Edited words for Kerry/);
  assert.equal(api.editedText(row), 'Edited words for Kerry');
  finishApproval();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(api.editedText(row), 'Edited words for Kerry');
});
test('an in-flight edit cannot send words that are no longer on screen', async () => {
  let finishApproval;
  global.opsPost = async (action, body) => {
    writes.push(structuredClone({action, body}));
    if (action === 'sales_booking_approval_write') {
      return new Promise((resolve) => {
        finishApproval = () => resolve({ok:true, approval:{id:'appr-late', state:body.decision, snapshot:structuredClone(body.snapshot)}});
      });
    }
    return {status:'sent', message_id:'m-late'};
  };
  const pending = api.press(row.id, 'message');
  assert.match(api.renderHTML(), /<textarea id="bk-draft"[^>]* disabled/);
  const d = api.draftFor(row);
  d.text = 'Different words now';
  d.humanEdited = true;
  d.revision = (d.revision || 0) + 1;
  finishApproval();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(writes.filter((w) => w.action === 'sales_booking_send').length, 0);
  assert.match(api.renderHTML(), /This changed after it was shown\. Check it again before pressing\./);
});
test('the to-contact count matches the week-wide list, not the search filter', () => {
  const stray = {id:'stray', contact_id:'ghl-s', display_name:'Stray lead', suburb:'Midland', reason:'Assessed', enquiry_at:'2026-01-01'};
  data.cases.push(stray);
  const n = api.listGroups().contact.length;
  assert.ok(n >= 2);
  assert.ok(api.listGroups().contact.some((c) => c.id === 'stray'));
  assert.match(api.renderHTML(), new RegExp('<b>' + n + '</b> to contact'));
  api.state.search = 'nobody-matches-this';
  assert.equal(api.listGroups().contact.length, 0);
  assert.match(api.renderHTML(), new RegExp('<b>' + n + '</b> to contact'));
});
test('the list puts the loudest customer first and quotes their last words', () => {
  const quiet = {id:'quiet', contact_id:'ghl-q', display_name:'Quiet lead', suburb:'Bassendean', stage_id:api.RESOURCES.marnin.pipeline_stages[0].id, reason:'Assessed', enquiry_at:'2026-01-01'};
  const loud = {id:'loud', contact_id:'ghl-l', display_name:'Loud lead', suburb:'Byford', stage_id:api.RESOURCES.marnin.pipeline_stages[0].id, reason:'Assessed', enquiry_at:new Date().toISOString()};
  data.cases.push(quiet, loud);
  data.thread_facts = {loud:{read_ok:true,last_inbound_at:new Date(Date.now()-3*86400000).toISOString(),last_human_outbound_at:null,last_inbound_text:'Is anyone <coming>?'}};
  const order = api.listGroups().contact.map((c) => c.id);
  assert.equal(order[0], 'loud');
  assert.ok(order.indexOf('loud') < order.indexOf('quiet'));
  const html = api.renderHTML();
  assert.match(html, /“Is anyone &lt;coming&gt;\?”/);
  assert.match(html, /No answer yet/);
});
test('the screen keeps its words plain and gives the owner a Refresh button', () => {
  api.state.showDetails = false;
  const html = api.renderHTML().replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(html, /census|\bpack\b|coverage|enumerated|not a completed audit|Approved · held|—/i);
  assert.match(api.renderHTML(), /data-booking-refresh/);
});
test('an edited text the server will not take is said plainly, and nothing is sent', async () => {
  const d = api.draftFor(row); d.text = 'Edited words'; d.humanEdited = true; api.renderHTML();
  global.opsPost = async (action, body) => { writes.push({action, body}); const e = new Error('approval_snapshot_changed'); e.status = 409; throw e; };
  const r = await api.press(row.id, 'message');
  assert.equal(r.ok, false);
  assert.equal(writes.length, 1);
  assert.match(api.renderHTML(), /The server only accepts the proposed text for now, so your edited text was not approved\. Nothing was sent\./);
});
test('a proposed slot on the day names the booking it clashes with, in full', () => {
  const p = row.booking_read_model.calendar_write.preview;
  data.diary.push({event_id:'mel',start:p.start.replace('09:00','10:00'),end:p.end,title:'Scope: Melanie N, Piara Waters',kind:'busy',source:'outlook',blocks_capacity:true});
  const html = api.renderWeek();
  assert.match(html, /class="ev is-proposal is-clash[^"]*"[^>]*data-booking-case="lead-a"[\s\S]*?<span class="ev-clash">Clashes with Scope: Melanie N, Piara Waters at 10:00am<\/span>/);
  assert.match(html, /<span class="ev-title">Scope: Melanie N, Piara Waters<\/span>/);
});

// ---- The owner's own text or picked visit (owner-authored-v1) ----
// Runs against the Friday fixture, whose read offers owner-authored-v1, and the
// offline backend double (tests/fixtures/booking-confirm/api.js).
const makeFridayRead = require('../tests/fixtures/booking-confirm/friday.js');
function ownerSetup(actionMode) {
  data = makeFridayRead(api, fixture);
  const backend = backendFixture.create(api, data);
  globalThis.fixtureActionMode = actionMode || 'unknown';
  delete globalThis.fixtureOwnerMode; delete globalThis.fixtureOwnerRefusal;
  global.opsPost = backend.post;
  global.opsFetch = backend.read;
  Object.assign(api.state, { data, weekStart: data.week_start, cache: {}, loading: false, stale: false, error: null, ownerPickOpen: {}, ownerOccupancy: [], drafts: {}, ownerVisits: {}, ownerPreviews: {}, approvalIds: {}, pressResults: {}, pressPending: {}, approvalPending: {}, approvalErrors: {}, dayIndex: null, selectedId: null });
  return backend;
}
function fridayOf(d) {
  return d.booking_flow.owner_rulebook.bookable_dates.filter((x) => new Date(x + 'T12:00:00Z').getUTCDay() === 5).pop();
}
function thisFriday() {
  return api.addDays(data.week_start, 4);
}
function nextFriday() {
  const thisFri = thisFriday();
  return data.booking_flow.owner_rulebook.bookable_dates.filter((x) => new Date(x + 'T12:00:00Z').getUTCDay() === 5 && x !== thisFri).pop();
}
function pickVisit(c, start, minutes, date) {
  api.state.selectedId = c.id;
  api.state.ownerPickOpen[c.id] = true; // what Pick a different time does

  Object.assign(api.ownerPick(c), { date: date || fridayOf(data), start, minutes });
}
const caseById = (id) => data.cases.find((c) => c.id === id);

test('an edited text is checked by the server, shown exactly, then approved and sent', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-basil'); api.state.selectedId = row.id; api.renderHTML();
  editDraft(row.booking_read_model.message.template_text + ' Marnin');
  assert.equal(api.messagePath(row), 'owner');
  const checked = await api.press(row.id, 'message');
  assert.equal(checked.ok, true);
  assert.equal(backend.writes.length, 1);
  assert.deepEqual(backend.writes[0].body, { owner_input: { step: 'message', case_id: 'lead-basil', contact_id: 'ghl-basil', week_start: data.week_start, resource: 'marnin', text: api.draftFor(row).text }, dry_run: true });
  let html = api.renderCard();
  assert.match(html, /<strong>Checked\.<\/strong> This exact text goes from SecureWorks Group Ops 776 to the phone ending 418\./);
  assert.match(html, /class="oc-text">Hi Basil,[^<]*Marnin<\/blockquote>/);
  assert.match(html, /Not already in this conversation \(4 messages read\)\./);
  assert.match(html, /Texts sent by hand outside this system cannot be checked/);
  assert.match(html, /<textarea id="bk-draft"[^>]* disabled/);
  assert.doesNotMatch(html, /data-booking-press="message"/);
  const sent = await api.ownerApprove(row.id, 'message');
  assert.equal(sent.ok, true);
  const decide = backend.writes[1];
  assert.equal(decide.action, 'sales_booking_approval_write');
  assert.equal(decide.body.decision, 'approved');
  assert.equal(decide.body.owner_input.prepared_at, checked.preview.snapshot.prepared_at);
  assert.equal(decide.body.content_hash, checked.preview.content_hash);
  assert.equal(decide.body.snapshot, undefined);
  assert.equal(backend.writes[2].action, 'sales_booking_send');
  assert.match(backend.writes[2].body.approval_id, /^[0-9a-f]{64}$/);
  html = api.renderCard();
  assert.match(html, /Text sent at [0-9:]+[ap]m from SecureWorks Group Ops 776 to the phone ending 418\./);
  assert.match(html, /data-booking-press="message"[^>]* disabled/);
});

test('every Stratco card can pick a different time; a proposed time stays the default shown first', () => {
  ownerSetup();
  data.cases.filter((c) => c.owner_booking && c.owner_booking.eligible).forEach((c) => {
    api.state.selectedId = c.id;
    const m = api.decisionModel(c);
    if (m && m.proposal) {
      assert.equal(api.calendarPath(c), 'engine');
      const html = api.renderCard();
      assert.match(html, m.confident ? /Proposed visit/ : /Needs a person/);
      assert.doesNotMatch(html, /Pick a visit/);
      assert.match(html, /data-owner-pick-open[^>]*>Pick a different time<\/button>/);
      api.state.ownerPickOpen[c.id] = true;
      assert.equal(api.calendarPath(c), 'owner');
      assert.match(api.renderCard(), /Pick a visit[\s\S]*data-owner-pick-close[^>]*>Use the proposed time<\/button>/);
    } else {
      assert.equal(api.calendarPath(c), 'owner');
      assert.match(api.renderCard(), /Pick a visit/);
      assert.doesNotMatch(api.renderCard(), /Use the proposed time/);
    }
  });
});

test('the proposed time keeps its one-press Book it, evidence and checks', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-basil'); api.state.selectedId = row.id;
  const html = api.renderCard();
  assert.match(html, /Proposed visit[\s\S]*arrive 12:00 to 1:30pm/);
  assert.match(html, /“Still waiting to hear back\. Are you coming Friday or not\?”/);
  assert.match(html, /All 5 checks passed/);
  assert.equal(api.pressBlock(row, 'calendar'), '');
  const r = await api.press(row.id, 'calendar');
  assert.equal(r.ok, true);
  assert.equal(backend.writes[0].body.snapshot.step, 'calendar');
  assert.equal(backend.writes[0].body.owner_input, undefined);
  assert.equal(backend.writes[1].action, 'sales_booking_book');
});

// ---- Free times on every day (step 2) ----
test('every server arrival window is drawn on its day and none is made up', () => {
  ownerSetup('sent');
  const ft = data.booking_flow.free_times;
  const html = api.renderWeek();
  for (const day of ft.days) {
    const i = (Date.parse(day.date + 'T12:00:00Z') - Date.parse(data.week_start + 'T12:00:00Z')) / 86400000;
    const col = html.slice(html.indexOf('data-week-day="' + i + '"'), html.indexOf('data-week-day="' + (i + 1) + '"') > 0 ? html.indexOf('data-week-day="' + (i + 1) + '"') : undefined);
    const bands = col.match(/class="ev-free is-static"/g) || [];
    assert.equal(bands.length, 1, day.date + ' has one run of windows, so one band');
    const first = day.arrival_windows[0].from_iso, last = day.arrival_windows[day.arrival_windows.length - 1].from_iso;
    const clock = (iso) => { const [h, m] = iso.slice(11, 16).split(':').map(Number); return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h >= 12 ? 'pm' : 'am'); };
    assert.match(col, new RegExp('Free, arrive from ' + clock(first) + ' to ' + clock(last)));
  }
  // Days the server sent no windows for (Mon, Wed, Thu) show none.
  assert.equal((html.match(/class="ev-free[ "]/g) || []).length, ft.days.length);
  // A day with no windows left shows no band, and says so.
  ft.days[1].arrival_windows = [];
  ft.days[1].state = 'no_time_left';
  const after = api.renderWeek();
  assert.equal((after.match(/class="ev-free[ "]/g) || []).length, 1);
  assert.match(after, /<em class="wkstate is-no_time_left">No time left<\/em>/);
  // No free times in the read: no bands at all, and a line says why.
  data.booking_flow.free_times = null;
  const none = api.renderWeek();
  assert.doesNotMatch(none, /class="ev-free/);
  assert.match(none, /Free times did not come with this read, so none are shown\./);
});

test('each day header says its state, a full day with the count, and a lead\'s own day wins', () => {
  ownerSetup('sent');
  const tue = api.addDays(data.week_start, 1), fri = thisFriday();
  assert.deepEqual(api.dayStateWords(tue), { state: 'open', words: 'Open', count: '1 of 6' });
  let html = api.renderWeek();
  assert.match(html, /<em class="wkstate is-open">Open · 1 of 6<\/em>/);
  assert.match(html, /<em class="wkstate is-open">Open · 2 of 6<\/em>/);
  const day = data.booking_flow.free_times.days[1];
  Object.assign(day, { state: 'full', booked: 6, arrival_windows: [] });
  assert.match(api.renderWeek(), /<em class="wkstate is-full">Full · 6 of 6<\/em>/);
  day.state = 'past';
  assert.match(api.renderWeek(), /<em class="wkstate is-past">Past<\/em>/);
  day.state = 'travel_unknown';
  assert.match(api.renderWeek(), /<em class="wkstate is-travel_unknown">Travel unknown<\/em>/);
  // With a lead chosen, their own state for the day is shown.
  api.state.selectedId = 'lead-basil';
  caseById('lead-basil').free_times.days[1] = { date: fri, state: 'already_booked', already_booked_that_day: true, arrival_windows: [] };
  assert.match(api.renderWeek(), /<em class="wkstate is-already_booked">Booked that day<\/em>/);
});

test('the week says what the live read counted busy, paints GHL time off, and explains unconfirmed Outlook', () => {
  ownerSetup('sent');
  const html = api.renderWeek();
  assert.match(html, /Read live from GHL: 1 booking in GHL, 2 entries in Marnin's Outlook, 1 block of time off in GHL, all counted as busy\. Free times allow 30 minutes on site plus travel between visits\./);
  assert.match(html, /class="ev is-busy[^"]*"[^>]*>(?:(?!<\/button>).)*Blocked off in GHL: Admin/);
  assert.match(html, /<summary>2 Outlook entries are not confirmed in GHL\. They still count as busy here\.<\/summary>/);
  assert.match(html, /connect Microsoft 365 with marnin@secureworkswa\.com\.au; set it as the conflict calendar for STRATCO FENCING/);
  data.booking_flow.calendar_read.caveats = ['outlook_malformed_dropped: 3'];
  data.booking_flow.free_times = null;
  assert.match(api.renderWeek(), /Marnin's Outlook had 3 entries with times that could not be read, so free times are not shown\. Booking still checks Outlook\./);
});

test('a calendar the live read could not read names why, in plain words, and shows no free time', () => {
  ownerSetup('sent');
  Object.assign(data.booking_flow, { calendar_read: { state: 'could_not_read', source: 'server_live_read', reason: 'ghl_events_unreadable: http_502' }, free_times: null });
  const html = api.renderHTML();
  assert.match(html, /GHL did not return Marnin's bookings for this week \(GHL said: http 502\)\. Free times are unknown, so nothing can be booked\./);
  assert.doesNotMatch(html, /class="ev-free/);
  assert.equal(api.calendarReasonWords({ state: 'not_configured', reason: 'person_has_no_ghl_calendar' }, 'Nithin'), 'Nithin is not on any GHL calendar yet. Add them to one in GHL, then press Refresh.');
  assert.equal(api.calendarReasonWords({ state: 'could_not_read', reason: 'something_new' }, 'Nithin'), "Could not read Nithin's calendar (something_new).");
});

// ---- Tap a free time to pick the visit (step 4) ----
function tapFree(c, date, bandIndex, fraction) {
  api.state.selectedId = c.id;
  const w = api.freeWindowAt(api.freeBands(c, date)[bandIndex], fraction);
  api.pickFreeWindow(c, w);
  return w;
}
function arrivalWords(w) {
  const h = (iso) => { const [hh, mm] = iso.slice(11, 16).split(':').map(Number); return hh + mm / 60; };
  const label = (x, mer) => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return (hh % 12 || 12) + ':' + String(mm).padStart(2, '0') + (mer ? (hh >= 12 ? 'pm' : 'am') : ''); };
  const s = h(w.from_iso), e = h(w.to_iso);
  return 'arriving between ' + label(s, (s >= 12) !== (e >= 12)) + ' and ' + label(e, true);
}

test('a tapped free time picks the server window exactly and the text follows it, 20 of 20', async () => {
  ownerSetup('sent');
  const tue = api.addDays(data.week_start, 1), fri = thisFriday();
  assert.ok(data.booking_flow.owner_rulebook.bookable_dates.includes(fri), 'the fixture Friday is bookable');
  let taps = 0;
  for (const id of ['lead-basil', 'lead-kerry', 'lead-priya']) {
    const c = caseById(id);
    for (const [date, fractions] of [[fri, [0, 0.2, 0.45, 0.7]], [tue, [0, 0.3, 0.6]]]) {
      if (!data.booking_flow.owner_rulebook.bookable_dates.includes(date)) continue;
      for (const f of fractions) {
        if (taps === 20) break;
        const w = tapFree(c, date, 0, f);
        taps++;
        // The visit is the server's window, unchanged: 60-minute arrival, 30 minutes on site.
        assert.deepEqual(api.ownerVisit(c), { window_start_iso: w.from_iso, window_end_iso: w.to_iso, end_iso: w.end_iso });
        assert.equal(api.messagePath(c), 'owner');
        const text = api.composeText(c);
        assert.ok(text.includes(api.longDate(w.from_iso) + ', ' + arrivalWords(w)), text);
        assert.deepEqual(api.ownerInput(c, 'message').offer, api.ownerVisit(c));
        assert.deepEqual(api.ownerInput(c, 'calendar').visit, api.ownerVisit(c));
      }
    }
  }
  assert.equal(taps, 20);
  // Top of Basil's Friday band is its first window, the bottom its last.
  const band = api.freeBands(caseById('lead-basil'), fri)[0];
  assert.equal(api.freeWindowAt(band, 0).from_iso, fri + 'T12:20:00+08:00');
  assert.equal(api.freeWindowAt(band, 1).from_iso, fri + 'T13:00:00+08:00');
});

test('a tapped time goes to the server check, and a refusal is said in words with nothing booked', async () => {
  const backend = ownerSetup('sent');
  const c = caseById('lead-kerry');
  const w = tapFree(c, thisFriday(), 0, 0);
  let r = await api.press(c.id, 'calendar');
  assert.equal(r.ok, true);
  assert.deepEqual(backend.writes[0].body.owner_input.visit, { window_start_iso: w.from_iso, window_end_iso: w.to_iso, end_iso: w.end_iso });
  assert.equal(backend.writes[0].body.dry_run, true);
  assert.match(api.renderCard(), /Checked\./);
  api.state.ownerPreviews = {};
  globalThis.fixtureOwnerRefusal = 'owner_visit_too_short';
  r = await api.press(c.id, 'calendar');
  assert.equal(r.ok, false);
  assert.match(api.renderCard(), /class="result is-bad" role="alert">Not booked: /);
  assert.ok(backend.writes.every((x) => x.action === 'sales_booking_approval_write'));
  delete globalThis.fixtureOwnerRefusal;
});

test('a pick never overwrites words the owner typed; it offers the rewrite instead', () => {
  ownerSetup('sent');
  const c = caseById('lead-priya');
  api.state.selectedId = c.id;
  const d = api.draftFor(c);
  d.text = 'Hi Priya, my own words here.'; d.humanEdited = true;
  const w = tapFree(c, thisFriday(), 0, 0);
  assert.equal(api.composeText(c), 'Hi Priya, my own words here.');
  assert.match(api.renderCard(), /Your text may not match the time you picked\. <button type="button" class="linklike" data-owner-rewrite data-case-id="lead-priya">Rewrite it for /);
  // A second tap after the screen wrote the text simply rewrites it.
  d.text = d.autoText = 'x'; d.rewrite = null;
  const w2 = tapFree(c, thisFriday(), 0, 1);
  assert.ok(api.composeText(c).includes(arrivalWords(w2)));
  assert.notEqual(w.from_iso, w2.from_iso);
  assert.match(api.renderCard(), /Rewritten for the time you picked\./);
});

test('a pick changed after the text was typed keeps the words but holds Send until the text names the new time', () => {
  ownerSetup('sent');
  const c = caseById('lead-kerry');
  const w = tapFree(c, thisFriday(), 0, 0);
  const d = api.draftFor(c);
  d.text = d.text.replace('Does that suit?', 'Does that work for you?');
  const typed = d.text;
  // Move to a later window on the same band: the owner's words stay, Send is held.
  const w2 = tapFree(c, thisFriday(), 0, 1);
  assert.notEqual(w.from_iso, w2.from_iso);
  assert.equal(api.composeText(c), typed);
  assert.match(api.ownerPressBlock(c, 'message'), /does not name the time you picked/);
  assert.match(api.renderCard(), /data-booking-press="message" data-case-id="lead-kerry" disabled/);
  assert.match(api.renderCard(), /data-owner-rewrite data-case-id="lead-kerry">Rewrite it for /);
  assert.ok(api.draftFor(c).rewrite.includes(arrivalWords(w2)));
});

test('a text the owner edits to name the new time is sendable without a rewrite', () => {
  ownerSetup('sent');
  const c = caseById('lead-kerry');
  tapFree(c, thisFriday(), 0, 0);
  const d = api.draftFor(c);
  d.text = 'Kerry, my own words.';
  const w2 = tapFree(c, thisFriday(), 0, 1);
  assert.match(api.ownerPressBlock(c, 'message'), /does not name the time you picked/);
  d.text = 'Kerry, my own words: ' + api.longDate(w2.from_iso) + ', ' + arrivalWords(w2) + '.';
  assert.equal(api.ownerPressBlock(c, 'message'), '');
});

test('a dropdown change that leaves the pick unfinished never keeps sendable text naming the old time', () => {
  ownerSetup('sent');
  const c = caseById('lead-kerry');
  const engine = api.composeText(c);
  const w = tapFree(c, thisFriday(), 0, 0);
  assert.equal(w.from_iso.slice(11, 16), '12:15');
  assert.ok(api.composeText(c).includes(arrivalWords(w)));
  // 12:15 is not on the 90-minute grid: the start clears and nothing is held.
  api.changeOwnerPick(c, 'minutes', '90');
  assert.equal(api.ownerVisit(c), null);
  assert.ok(!api.composeText(c).includes(arrivalWords(w)), api.composeText(c));
  assert.equal(api.composeText(c), engine);
  assert.equal(api.ownerInput(c, 'message').offer, undefined);
});

test('an unfinished pick holds Send when the owner had edited the screen\'s text', () => {
  ownerSetup('sent');
  const c = caseById('lead-kerry');
  const w = tapFree(c, thisFriday(), 0, 0);
  const d = api.draftFor(c);
  d.text = d.text.replace('Does that suit?', 'Does that work?');
  api.changeOwnerPick(c, 'minutes', '90');
  assert.equal(api.ownerVisit(c), null);
  assert.ok(api.composeText(c).includes(arrivalWords(w)));
  assert.match(api.ownerPressBlock(c, 'message'), /written for an earlier pick/);
  // Finishing the pick offers the rewrite; the dropdown start then fills.
  api.changeOwnerPick(c, 'start', '12:30');
  assert.ok(api.ownerVisit(c));
  assert.match(api.ownerPressBlock(c, 'message'), /does not name the time you picked/);
});

test('the chosen lead\'s free times are green bands on the week, and only theirs', () => {
  ownerSetup('sent');
  const fri = thisFriday();
  let html = api.renderWeek();
  assert.doesNotMatch(html, /data-free-band/, 'no lead chosen, no bands');
  api.state.selectedId = 'lead-basil';
  html = api.renderWeek();
  assert.match(html, new RegExp('class="ev-free" data-free-band="0" data-case-id="lead-basil" data-date="' + fri + '"'));
  assert.match(html, /Free, arrive from 12:20pm to 1:00pm/);
  assert.doesNotMatch(html, /data-case-id="lead-kerry"[^>]*data-free-band|data-free-band="\d+" data-case-id="lead-kerry"/);
  tapFree(caseById('lead-basil'), fri, 0, 0.5);
  html = api.renderWeek();
  assert.match(html, /class="ev-free is-on"[^>]*>.*Picked: arrive /);
  // A lead booked with someone else offers no free time to tap.
  caseById('lead-basil').scope_appointment = { start_iso: fri + 'T09:00:00+08:00', owner_name: 'Khairo', owner_resource_id: 'khairo' };
  assert.doesNotMatch(api.renderWeek(), /data-free-band/);
  delete caseById('lead-basil').scope_appointment;
});

test('a lead with no proposed time gets a day and window picker that books through the check', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-priya');
  api.state.selectedId = row.id;
  assert.equal(api.calendarPath(row), 'owner');
  let html = api.renderCard();
  assert.match(html, /Pick a visit/);
  assert.match(html, /aria-label="Visit day"/);
  assert.match(html, /Pick a day and an arrival time first\./);
  pickVisit(row, '12:30', 60);
  const fri = fridayOf(data);
  assert.deepEqual(api.ownerVisit(row), { window_start_iso: fri + 'T12:30:00+08:00', window_end_iso: fri + 'T13:30:00+08:00', end_iso: fri + 'T14:00:00+08:00' });
  html = api.renderCard();
  assert.match(html, /Book it writes: <b>GHL Stratco Fencing calendar<\/b> and <b>Marnin's Outlook<\/b>/);
  assert.match(html, /This text holds Fri [0-9]+ [A-Z][a-z]+, arrive 12:30 to 1:30pm for them\./);
  assert.doesNotMatch(html, /data-owner-offer|Hold .* with this text/);
  const checked = await api.press(row.id, 'calendar');
  assert.equal(checked.ok, true);
  assert.deepEqual(backend.writes[0].body.owner_input.visit, api.ownerVisit(row));
  html = api.renderCard();
  assert.match(html, /This exact visit goes in GHL Stratco Fencing calendar and Marnin's Outlook\./);
  assert.match(html, /Scope visit: Priya S · 8 Example Street, Southern River · on site until 2:00pm/);
  assert.match(html, /GHL is clear, with 30 minutes travel either side/);
  assert.match(html, /Outlook is clear/);
  assert.match(html, /data-owner-visit="date"[^>]* disabled/);
  const booked = await api.ownerApprove(row.id, 'calendar');
  assert.equal(booked.ok, true);
  assert.equal(backend.writes[2].action, 'sales_booking_book');
  assert.match(api.renderCard(), /Booked Friday [0-9]+ [A-Z][a-z]+, arrive 12:30 to 1:30pm in GHL Stratco Fencing calendar and Marnin's Outlook at /);
});

test('a text sent with a picked time always holds that visit', async () => {
  const backend = ownerSetup();
  row = caseById('lead-priya');
  pickVisit(row, '12:30', 60);
  assert.deepEqual(api.ownerInput(row, 'message').offer, api.ownerVisit(row));
  await api.press(row.id, 'message');
  assert.deepEqual(backend.writes[0].body.owner_input.offer, api.ownerVisit(row));
  assert.match(api.renderCard(), /It holds Fri [0-9]+ [A-Z][a-z]+, arrive 12:30 to 1:30pm for them\./);
  assert.doesNotMatch(api.renderCard(), /data-owner-offer/);
});

test('an owner book occupies the day so the next lead must pick another time', async () => {
  const backend = ownerSetup('sent');
  const priya = caseById('lead-priya');
  const basil = caseById('lead-basil');
  const thisFri = thisFriday();
  api.state.dayIndex = 4;
  pickVisit(priya, '12:30', 60, thisFri);
  assert.equal((await api.press(priya.id, 'calendar')).ok, true);
  assert.equal((await api.ownerApprove(priya.id, 'calendar')).ok, true);
  assert.match(api.renderWeek(), /Priya S/);
  assert.match(api.renderWeek(), /12:30/);
  assert.match(api.clashFor(basil).label, /Priya/);
  api.state.selectedId = basil.id;
  assert.equal(api.calendarPath(basil), 'engine');
  assert.match(api.pressBlock(basil, 'calendar'), /Priya/);
  assert.match(api.renderCard(), /Pick a different time/);
  pickVisit(basil, '12:30', 60, thisFri);
  assert.equal(api.calendarPath(basil), 'owner');
  assert.match(api.ownerBlock(basil, 'calendar'), /Priya/);
  const later = nextFriday();
  assert.ok(later);
  pickVisit(basil, '12:30', 60, later);
  assert.equal(api.ownerBlock(basil, 'calendar'), '');
  assert.equal((await api.press(basil.id, 'calendar')).ok, true);
  assert.equal(backend.writes.filter((w) => w.action === 'sales_booking_book').length, 1);
});

test('a sent offer occupies the slot so another lead cannot take it', async () => {
  ownerSetup('sent');
  const priya = caseById('lead-priya');
  const basil = caseById('lead-basil');
  const thisFri = thisFriday();
  pickVisit(priya, '12:30', 60, thisFri);
  assert.equal((await api.press(priya.id, 'message')).ok, true);
  assert.equal((await api.ownerApprove(priya.id, 'message')).ok, true);
  pickVisit(basil, '12:30', 60, thisFri);
  assert.match(api.ownerBlock(basil, 'calendar'), /Priya|offered/i);
});

test('a lead can book the visit they already held with a sent text', async () => {
  const backend = ownerSetup('sent');
  const priya = caseById('lead-priya');
  const basil = caseById('lead-basil');
  const thisFri = thisFriday();
  pickVisit(priya, '12:30', 60, thisFri);
  assert.equal((await api.press(priya.id, 'message')).ok, true);
  assert.equal((await api.ownerApprove(priya.id, 'message')).ok, true);
  assert.equal(api.ownerBlock(priya, 'calendar'), '');
  assert.doesNotMatch(api.renderCard(), /Slot taken by a prior offer: Priya/);
  pickVisit(basil, '12:30', 60, thisFri);
  assert.match(api.ownerBlock(basil, 'calendar'), /Priya|offered/i);
  pickVisit(priya, '12:30', 60, thisFri);
  assert.equal((await api.press(priya.id, 'calendar')).ok, true);
  assert.equal((await api.ownerApprove(priya.id, 'calendar')).ok, true);
  assert.equal(backend.writes.filter((w) => w.action === 'sales_booking_book').length, 1);
  assert.match(api.renderCard(), /Booked /);
});

test('a named server refusal shows as one plain sentence and nothing is approved or booked', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-priya');
  // Clear on screen, but Melanie's Outlook visit ends 11:45, inside the 30 minutes travel.
  pickVisit(row, '12:00', 60);
  assert.equal(api.ownerBlock(row, 'calendar'), '');
  const r = await api.press(row.id, 'calendar');
  assert.equal(r.ok, false);
  const html = api.renderCard();
  assert.match(html, /class="result is-bad" role="alert">Not booked: that time clashes with Scope: Melanie N, Piara Waters at 10:45am in Outlook, counting 30 minutes travel either side\.<\/p>/);
  assert.doesNotMatch(html, /Checked\.|Booked /);
  assert.deepEqual(backend.writes.map((w) => w.action), ['sales_booking_approval_write']);
  globalThis.fixtureOwnerRefusal = 'text_already_in_thread';
  await api.press(row.id, 'message');
  assert.match(api.renderCard(), /Not sent: this exact text is already in the conversation\./);
  assert.equal(api.refusalWords('owner_visit_day_not_permitted'), 'Stratco visits are Tuesday and Friday only.');
  delete globalThis.fixtureOwnerRefusal;
});

test('the unedited engine text still takes the engine path until a time is picked', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-basil'); api.state.selectedId = row.id; api.renderHTML();
  assert.equal(api.messagePath(row), 'engine');
  assert.equal(api.calendarPath(row), 'engine');
  const r = await api.press(row.id, 'message');
  assert.equal(r.ok, true);
  assert.equal(backend.writes[0].body.owner_input, undefined);
  assert.equal(backend.writes[0].body.snapshot.content.variant, 'template');
  assert.equal(backend.writes[1].action, 'sales_booking_send');
  assert.match(api.renderCard(), /Pick a different time/);
  pickVisit(row, '12:30', 60);
  assert.equal(api.messagePath(row), 'owner');
  assert.deepEqual(api.ownerInput(row, 'message').offer, api.ownerVisit(row));
});

test('an owner path the server does not have yet says not connected and sends nothing', async () => {
  const backend = ownerSetup('sent');
  globalThis.fixtureOwnerMode = 'unknown';
  row = caseById('lead-priya'); api.state.selectedId = row.id;
  await api.press(row.id, 'message');
  assert.match(api.renderCard(), /Sending your own text is not connected on the server yet, so nothing was sent\./);
  assert.equal(backend.writes.filter((w) => w.action === 'sales_booking_send').length, 0);
  delete globalThis.fixtureOwnerMode;
  delete data.booking_flow.owner_approval_write;
  assert.equal(api.messagePath(row), 'engine');
  assert.match(api.renderCard(), /No checked proposal for this lead yet, so nothing can be sent from here\./);
});

test('the owner path blocks long dashes, respects the protected band and stops on a changed text', async () => {
  const backend = ownerSetup('sent');
  row = caseById('lead-priya'); api.state.selectedId = row.id;
  const d = api.draftFor(row); d.text = 'Hi Priya — Friday?'; d.humanEdited = true;
  assert.equal(api.ownerBlock(row, 'message'), 'Take out the long dash. Texts to clients never use one.');
  const rb = data.booking_flow.owner_rulebook;
  const tue = '2026-09-29';
  assert.ok(!api.ownerStarts(rb, tue, 60).some((t) => t >= '11:30' && t <= '15:30'));
  assert.ok(api.ownerStarts(rb, tue, 60).includes('10:00'));
  assert.equal(api.ownerStarts(rb, fridayOf(data), 90).pop(), '14:30');
  d.text = 'Hi Priya, would Friday suit?';
  await api.press(row.id, 'message');
  d.text = 'Different words now';
  const r = await api.ownerApprove(row.id, 'message');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'This changed after it was checked. Check it again.');
  assert.equal(backend.writes.length, 1);
});

test('a quiet re-read after a book keeps the booked visit on the day until the read carries it', async () => {
  const backend = ownerSetup('sent');
  const priya = caseById('lead-priya');
  const thisFri = thisFriday();
  api.state.dayIndex = 4;
  pickVisit(priya, '12:30', 60, thisFri);
  await api.press(priya.id, 'calendar');
  await api.ownerApprove(priya.id, 'calendar');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  // The fixture's read does not carry the new booking, as a lagging read would not.
  assert.equal(backend.reads.filter((r) => r.action === 'sales_booking_read').length, 1);
  assert.notEqual(api.state.data, data);
  assert.equal(api.state.loading, false);
  assert.ok(api.state.data.diary.some((ev) => ev.contact_id === 'ghl-priya' && ev.start === thisFri + 'T12:30:00+08:00'));
  assert.match(api.renderWeek(), /Priya S/);
  await api.load('marnin', api.state.weekStart);
  assert.ok(api.state.data.diary.some((ev) => ev.contact_id === 'ghl-priya'));
});
test('a lead booked with another scoper offers no new time: Book it and Send this text are both shut', async () => {
  assert.equal(api.approvalBlock(row, 'calendar'), '');
  assert.equal(api.approvalBlock(row, 'message'), '');
  row.scope_appointment = {start_iso:'2026-09-29T10:00:00+08:00', owner_name:'Khairo', owner_resource_id:'khairo', status:'confirmed'};
  const html = api.renderHTML();
  const card = html.slice(html.indexOf('class="bk-card"'));
  assert.match(card, /<section class="visit"><h3>[\s\S]*?Booked visit<\/h3><p class="when">Booked with Khairo, Tue 29 Sep 10:00am<\/p><\/section>/);
  assert.doesNotMatch(card, /Proposed visit|Book it/);
  assert.match(card, /data-booking-press="message"[^>]* disabled[^>]*>[\s\S]*?Send this text[\s\S]*?Booked with Khairo, Tue 29 Sep 10:00am\. No new time can be offered or booked from here\./);
  assert.equal((await api.recordApproval(row.id, 'message', 'approved')).ok, false);
  assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
  assert.equal(writes.length, 0);
});
test('a lead with a live visit in this scoper\'s own calendar paints no stale proposal card', () => {
  assert.match(api.renderWeek(), /data-booking-case="lead-a"/);
  row.scope_appointment = {start_iso:'2026-09-29T10:00:00+08:00', owner_name:'Marnin', owner_resource_id:'marnin', status:'confirmed'};
  assert.doesNotMatch(api.renderWeek(), /data-booking-case="lead-a"/);
  delete row.scope_appointment.owner_resource_id;
  assert.doesNotMatch(api.renderWeek(), /data-booking-case="lead-a"/);
});
