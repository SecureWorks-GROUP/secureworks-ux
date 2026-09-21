const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const api = require('./ops-sales-booking.js');
const fixture = require('../tests/fixtures/booking-confirm/read.js');
let data, row, writes;
beforeEach(() => {
  data = fixture(api); row = data.cases[0]; writes = [];
  Object.assign(api.state, { resourceId: 'marnin', weekStart: data.week_start, data, selectedId: row.id,
    loading: false, stale: false, error: null, filter: 'all', search: '', cache: {}, textChoices: {},
    visitForms: {}, visitPending: {}, visitUncertain: {}, visitErrors: {}, shownVisits: {}, approvalPending: {}, approvalErrors: {}, shownApprovals: {}, opened: true });
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
  assert.match(api.renderHTML(), /Approve this exact text/);
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
  assert.match(api.renderHTML(), /nothing will be sent/);
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
test('failed, missing and not-configured calendars never permit confirmation', async () => {
  for (const state of ['could_not_read','not_configured',undefined]) {
    data.booking_flow.calendar_read = state ? {state,provider:'ghl',reason:'Provider unavailable'} : null;
    data.resource.calendar = null;
    api.renderHTML();
    assert.equal((await api.recordApproval(row.id, 'calendar', 'approved')).ok, false);
    assert.equal((await api.recordApproval(row.id, 'message', 'approved')).ok, false);
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
  assert.match(api.renderHTML(), /Taken · customer agreed/);
  assert.equal(api.diaryEventMatchesCase({display_name:row.display_name, suburb:row.suburb}, row), false);
});
test('busy diary and protected band block a proposal even if validation claims pass', () => {
  const p = row.booking_read_model.calendar_write.preview;
  data.diary.push({event_id:'busy',start:p.start,end:p.end,kind:'busy',blocks_capacity:true});
  assert.match(api.approvalBlock(row,'calendar'), /occupied calendar/);
  data.diary = [];
  p.start = p.start.replace('09:00','13:00'); p.end = p.end.replace('11:30','14:00');
  assert.match(api.approvalBlock(row,'calendar'), /protected Canning Vale/);
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
  assert.match(html,/Customer has not supplied a day or arrival window/);
  assert.match(html,/This is when the AI thinks we should book/);
});
test('visit happened records exact append-only fields with quote owed and no message', async () => {
  global.opsPost = async (action, body) => { writes.push({action,body}); return {ok:true,visit_outcome:body.visit_outcome}; };
  const result = await api.recordVisitOutcome('demo-booking-completed','happened',null,'Measured both sides');
  assert.equal(result.ok,true);
  assert.equal(result.sent,false);
  assert.equal(writes[0].action,'sales_booking_visit_outcome_insert');
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
  global.opsPost = async (action,body) => { writes.push({action,body}); return {ok:true,visit_outcome:body.visit_outcome}; };
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','did_not_happen',null,'')).ok,false);
  assert.equal((await api.recordVisitOutcome('demo-booking-completed','did_not_happen','wrong','')).ok,false);
  const result = await api.recordVisitOutcome('demo-booking-completed','did_not_happen','customer_not_home','Gate locked');
  assert.equal(result.ok,true);
  assert.equal(result.visit_outcome.reason,'customer_not_home');
  assert.equal(result.visit_outcome.quote_owed,false);
  assert.equal(writes.length,1);
});
test('outcome correction appends with supersedes, quote owed can be unticked', async () => {
  global.opsPost = async (_,body) => ({ok:true,visit_outcome:body.visit_outcome});
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
  assert.match(api.renderHTML(),/1 visit needs an outcome/);
  data.booked_visits[0].visit_start = new Date(Date.now()-8*86400000).toISOString();
  assert.doesNotMatch(api.renderHTML(),/aria-label="Visits missing an outcome"/);
  data.booked_visits[0].visit_start = new Date(Date.now()+86400000).toISOString();
  assert.doesNotMatch(api.renderHTML(),/aria-label="Visits missing an outcome"/);
  assert.match(api.renderHTML(),/This visit has not started/);
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
  assert.match(api.approvalBlock(row,'calendar'),/binding is missing/);
  assert.equal(api.decisionModel(row).validation.length,0);
  raw.calendar_write.approval = {ui_snapshot:api.approvalSnapshot(row,'calendar')};
  raw.calendar_write.state = 'unknown';
  raw.calendar_write.receipt = {error:'Provider outcome unconfirmed'};
  assert.match(api.renderHTML(),/Outcome unknown. Reconcile before retrying/);
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
