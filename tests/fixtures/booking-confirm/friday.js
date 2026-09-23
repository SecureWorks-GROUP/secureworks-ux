/* Synthetic only. A Friday Stratco day built on the base confirmation fixture:
   a loud unanswered customer, a clash with an Outlook entry, GHL and Outlook
   events, and canned GHL threads. Dates are relative, so it never date-rots. */
(function (global) {
  function makeFridayRead(api, makeRead) {
    const data = makeRead(api);
    const next = data.week_start;
    const fri = api.addDays(next, 4);
    const at = (day, clock) => day + 'T' + clock + ':00+08:00';
    const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();
    const daysAgoDate = d => new Date(Date.now() + 8 * 3600000 - d * 86400000).toISOString().slice(0, 10);
    const stage = i => api.RESOURCES.marnin.pipeline_stages[i].id;
    const checks = () => [
      { label: 'calendar', passed: true }, { label: 'protected_band', passed: true },
      { label: 'hours', passed: true }, { label: 'travel', passed: true }, { label: 'daily_capacity', passed: true }
    ];
    function model(id, contact, name, start, windowEnd, end, text, quote) {
      return {
        schema: 'scope-booking-lead.v1', id: 'opp:' + id, contact_id: contact,
        profile: 'fencing-stratco-marnin', pack_revision: 'fixture-pack-v1',
        proposal: { window: { start, end: windowEnd }, requires_scoper_confirmation: true },
        evidence_quotes: [{ message_id: 'in-' + id, quote }],
        validation: { ok: true, checked_at: new Date().toISOString(), reasons: [], checks: checks() },
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        calendar_write: { state: 'awaiting_approval', approval: null, receipt: null,
          preview: { provider: 'ghl', calendar_id: 'dEQKVKHthsjSYaen1fiE', assigned_user_id: 'ghl-user-demo', start, end, title: 'Scope: ' + name, site_address: '8 Example Street, ' + name.split(', ')[1], content_hash: 'fixture-calendar-' + id } },
        message: { state: 'awaiting_approval', approval: null, receipt: null, template_text: text, ai_proposed_text: null, chosen: null, approved_text: null,
          routing: { from_number: '+61489267776', to_number: id === 'lead-basil' ? '+61400000418' : '+61400000552', message_sha256: 'fixture-text-' + id } }
      };
    }
    const basil = model('lead-basil', 'ghl-basil', 'Basil L, Aubin Grove', at(fri, '12:00'), at(fri, '13:30'), at(fri, '14:30'),
      'Hi Basil, it is Marnin from SecureWorks Group. Sorry we missed you last week, that was our mistake. I can come to Aubin Grove on Friday between 12:00 and 1:30pm to measure up the fence. Does that suit?',
      'Still waiting to hear back. Are you coming Friday or not?');
    const kerry = model('lead-kerry', 'ghl-kerry', 'Kerry P, Harrisdale', at(fri, '10:30'), at(fri, '12:00'), at(fri, '12:30'),
      'Hi Kerry, it is Marnin from SecureWorks Group. I can come to Harrisdale on Friday between 10:30am and 12:00 to measure up. Does that suit?',
      'Friday late morning is best for me.');
    data.cases.unshift(
      { id: 'lead-basil', contact_id: 'ghl-basil', opportunity_id: 'lead-basil', display_name: 'Basil L', suburb: 'Aubin Grove', job_type: 'fencing', enquiry_at: daysAgoDate(13), stage_id: stage(0), booking_read_model: basil },
      { id: 'lead-kerry', contact_id: 'ghl-kerry', opportunity_id: 'lead-kerry', display_name: 'Kerry P', suburb: 'Harrisdale', job_type: 'fencing', enquiry_at: daysAgoDate(4), stage_id: stage(1), booking_read_model: kerry },
      { id: 'lead-michael', contact_id: 'ghl-demo-c', opportunity_id: 'lead-michael', display_name: 'Michael T', suburb: 'Canning Vale', job_type: 'fencing', enquiry_at: daysAgoDate(9), stage_id: 'cc401467-4743-4dbd-a7d7-e8f2ff023dd2', status: 'waiting' },
      { id: 'lead-priya', contact_id: 'ghl-priya', opportunity_id: 'lead-priya', display_name: 'Priya S', suburb: 'Southern River', job_type: 'fencing', enquiry_at: daysAgoDate(2), stage_id: stage(0), proposal: { draft: 'Hi Priya, it is Marnin from SecureWorks Group. Thanks for the Stratco enquiry. Would Friday suit for a quick measure up?' } }
    );
    const lead = data.cases.find(c => c.id === 'lead-a');
    lead.enquiry_at = daysAgoDate(6); lead.opportunity_id = 'lead-a'; lead.job_type = 'fencing';
    const person = data.cases.find(c => c.id === 'lead-person');
    person.enquiry_at = daysAgoDate(5); person.opportunity_id = 'lead-person';
    data.cases.find(c => c.id === 'lead-michael').status = 'waiting';
    data.thread_facts = {
      'lead-basil': { read_ok: true, last_inbound_at: hoursAgo(50), last_human_outbound_at: hoursAgo(190), classification: 'ready_to_contact', last_inbound_text: 'Still waiting to hear back. Are you coming Friday or not?' },
      'lead-kerry': { read_ok: true, last_inbound_at: hoursAgo(20), last_human_outbound_at: hoursAgo(26), classification: 'ready_to_contact', last_inbound_text: 'Friday late morning is best for me.' },
      'lead-a': { read_ok: true, last_inbound_at: hoursAgo(30), last_human_outbound_at: hoursAgo(40), classification: 'ready_to_contact', last_inbound_text: 'Next Tuesday morning works. Please text me the arrival window.' },
      'lead-michael': { read_ok: true, last_inbound_at: hoursAgo(70), last_human_outbound_at: hoursAgo(28), classification: 'waiting_reply', last_inbound_text: 'Nine on Friday is fine with me.' },
      'lead-priya': { read_ok: true, last_inbound_at: null, last_human_outbound_at: null, classification: 'ready_to_contact' }
    };
    data.diary = [
      { event_id: 'outlook-melanie', start: at(fri, '10:45'), end: at(fri, '11:45'), title: 'Scope: Melanie N, Piara Waters', kind: 'busy', source: 'outlook', blocks_capacity: true },
      { event_id: 'ghl-jordan', start: at(fri, '15:00'), end: at(fri, '16:00'), title: 'Scope: Jordan W, Harrisdale', kind: 'busy', source: 'ghl_calendar', blocks_capacity: true },
      { event_id: 'outlook-school', start: at(fri, '08:00'), end: at(fri, '08:45'), title: 'School drop-off', kind: 'personal', source: 'outlook', blocks_capacity: true }
    ];
    data.threads = {
      'ghl-basil': [
        { direction: 'inbound', body: 'Hi, is someone still coming to measure the fence on Thursday?', timestamp: hoursAgo(214) },
        { direction: 'outbound', body: 'Hi Basil, yes, Thursday between 1:30 and 3:00pm. Marnin, SecureWorks Group', timestamp: hoursAgo(190), sender_name: 'Marnin' },
        { direction: 'inbound', body: 'Nobody turned up today. I took the afternoon off for this.', timestamp: hoursAgo(120) },
        { direction: 'inbound', body: 'Still waiting to hear back. Are you coming Friday or not?', timestamp: hoursAgo(50) }
      ],
      'ghl-kerry': [
        { direction: 'inbound', body: 'Hi, Stratco passed on my details for a Colorbond fence, about 24 metres.', timestamp: hoursAgo(30) },
        { direction: 'outbound', body: 'Thanks Kerry, which day suits you for a measure up?', timestamp: hoursAgo(26), sender_name: 'Marnin' },
        { direction: 'inbound', body: 'Friday late morning is best for me.', timestamp: hoursAgo(20) }
      ]
    };
    // Owner-authored approvals (owner-authored-v1): the read offers the owner's
    // own words and his own picked visit, with the Stratco rulebook.
    const bookable = [];
    for (let i = 0; i < 14; i++) {
      const date = new Date(Date.now() + 8 * 3600000 + i * 86400000).toISOString().slice(0, 10);
      const weekday = new Date(date + 'T12:00:00Z').getUTCDay();
      if ((weekday === 2 || weekday === 5) && Date.parse(date + 'T15:30:00+08:00') > Date.now()) bookable.push(date);
    }
    const rulebook = {
      profile: 'fencing-stratco-marnin', source: 'fixture', timezone: 'Australia/Perth', utc_offset: '+08:00',
      days: ['Tue', 'Fri'], bookable_dates: bookable, day_start: '08:00', day_end: '16:30',
      window_min_minutes: 60, window_max_minutes: 90, visit_minutes: 60, travel_buffer_minutes: 30, max_per_day: 6,
      protected_bands: [{ weekday: 'Tue', start: '13:00', end: '15:30', label: 'Stratco / Canning Vale' }],
      sender: '+61489267776',
      calendar: { provider: 'ghl', calendar_id: 'dEQKVKHthsjSYaen1fiE', calendar_name: 'STRATCO FENCING', assigned_user_id: '3S20LGVTjsVYy9vTJ9wM', scoper_email: 'marnin@secureworkswa.com.au' }
    };
    Object.assign(data.booking_flow, { owner_approval_write: 'owner-authored-v1', owner_rulebook: rulebook, hand_sent_texts: 'not_machine_checked' });
    data.cases.forEach(c => {
      const m = c.booking_read_model;
      const engine = !!(m && m.pack_revision && m.proposal);
      c.owner_booking = { version: 'owner-authored-v1', eligible: !!c.contact_id, reason: null, engine_proposal: engine,
        engine_window: engine ? { start: m.proposal.window.start, end: m.proposal.window.end } : null, rulebook, approvals: [] };
    });
    return data;
  }
  if (typeof module !== 'undefined') module.exports = makeFridayRead;
  else global.makeFridayRead = makeFridayRead;
})(typeof window === 'undefined' ? globalThis : window);
