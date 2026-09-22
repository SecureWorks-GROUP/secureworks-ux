/* Synthetic only. Relative dates keep the fake flow usable next week. */
(function (global) {
  function makeRead(api) {
    const week = api.currentPerthWeek();
    const next = api.addDays(week, 7);
    const day = api.addDays(next, 1);
    const start = day + 'T09:00:00+08:00';
    const previousDay = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0,10);
    const lastVisit = previousDay + 'T10:00:00+08:00';
    const model = {
      schema: 'scope-booking-lead.v1', id: 'opp:lead-a', contact_id: 'ghl-demo-a',
      profile: 'fencing-stratco-marnin', pack_revision: 'fixture-pack-v1',
      proposal: { window: {start, end: day + 'T10:30:00+08:00'}, requires_scoper_confirmation: true },
      evidence_quotes: [{ message_id: 'inbound-demo-1', quote: 'Next Tuesday morning works. Please text me the arrival window.' }],
      validation: { ok: true, checked_at: new Date().toISOString(), reasons: [], requires_fresh_read: true,
        checks: [
          { label: 'GHL contact identity', passed: true },
          { label: 'Customer conversation', passed: true },
          { label: 'Future Perth time and scoper hours', passed: true },
          { label: 'GHL calendar and prior offers', passed: true }
        ]
      },
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      calendar_write: { state: 'awaiting_approval', approval: null, receipt: null,
        preview: { provider:'ghl', calendar_id:'ghl-demo-stratco', assigned_user_id:'ghl-user-demo', start, end: day + 'T11:30:00+08:00', title:'Fencing scope · Example lead', site_address:'12 Example Road, Carlisle', content_hash:'fixture-calendar-v1' }
      },
      message: { state: 'awaiting_approval', approval: null, receipt: null,
        template_text: 'Hi Example, your fencing scope is proposed for Tuesday, arriving between 9:00am and 10:30am. Please reply to confirm. SecureWorks Group',
        ai_proposed_text: null, chosen: null, approved_text: null,
        routing: {from_number:'+61000000001',to_number:'+61000000002',message_sha256:'fixture-text-v1'}
      }
    };
    return {
      ok: true, send_hold: true, week_start: next,
      resource: { id: 'marnin', name: 'Marnin', scoper_user_id: api.RESOURCES.marnin.scoper_user_id, calendar: { ok: true, mailbox: 'GHL · Stratco fixture' } },
      coverage: { gaps: [] }, pack: { present: true, week_start: next }, diary: [],
      booking_flow: { version: 'booking-confirm.v1', approval_write: 'separate-v1', visit_outcome_write:'append-only-v1',visit_outcomes_read:'complete', calendar_read: { state: 'read', provider: 'ghl' }, commitments: [
        { id: 'offer-other', contact_id: 'ghl-demo-b', state: 'offered', start_iso: day + 'T12:00:00+08:00', end_iso: day + 'T13:00:00+08:00' },
        { id: 'agreed-other', contact_id: 'ghl-demo-c', state: 'agreed', start_iso: api.addDays(next, 4) + 'T09:00:00+08:00', end_iso: api.addDays(next, 4) + 'T10:00:00+08:00' }
      ] },
      booked_visits: [{booking_key:'demo-booking-completed',appointment_id:'demo-appointment',contact_id:'ghl-demo-visited',opportunity_id:'demo-opp-visited',job_id:null,scoper_user_id:api.RESOURCES.marnin.scoper_user_id,visit_start:lastVisit,display_name:'Example visited lead'}],
      visit_outcomes: [],
      cases: [
        { id: 'lead-a', contact_id: 'ghl-demo-a', display_name: 'Example lead', suburb: 'Carlisle', address: '12 Example Road, Carlisle', job: 'Fencing', stage_id: api.RESOURCES.marnin.pipeline_stages[0].id, booking_read_model: model },
        { id: 'lead-person', contact_id: 'ghl-demo-person', display_name: 'Needs review', suburb: 'Example suburb', job: 'Fencing', stage_id: api.RESOURCES.marnin.pipeline_stages[0].id, booking_read_model: {schema:'scope-booking-lead.v1', id:'opp:lead-person', contact_id:'ghl-demo-person', profile:'fencing-stratco-marnin', pack_revision:'fixture-pack-v1', proposal:null, evidence_quotes:[], validation:{ok:false,checked_at:new Date().toISOString(),reasons:['Customer has not supplied a day or arrival window.'],requires_fresh_read:true}, calendar_write:{state:'awaiting_approval',approval:null,receipt:null}, message:{template_text:'',ai_proposed_text:null,chosen:null,approved_text:null,state:'awaiting_approval',approval:null,receipt:null}} }
      ]
    };
  }
  if (typeof module !== 'undefined') module.exports = makeRead;
  else global.makeBookingConfirmRead = makeRead;
})(typeof window === 'undefined' ? globalThis : window);
