// Made-up data for demo mode (?demo). Shapes follow what ops-api really sends,
// so the same screen code runs on it. Dates are built around today so the demo
// never goes stale. Nothing here is a real customer or job.
import { todayISO, addDays, mondayOf, now } from '../lib/dates.js';

const ORG = '00000000-0000-0000-0000-000000000001';
export const PEOPLE = {
  crew: { id: 'u-sam', email: 'sam@example.test', name: 'Sam Tane', role: 'crew', trade_tier: 2, managed_verticals: [], invoice_type: 'hourly', org_id: ORG, phone: '0400 111 222',
    trade_details: { fullName: 'Sam Tane', abn: '51 824 753 556', bsb: '066-000', accountNo: '1234 5678', accountName: 'S Tane', gstRegistered: false, phone: '0400 111 222' } },
  lead: { id: 'u-henry', email: 'henry@example.test', name: 'Henry Fence', role: 'lead_installer', trade_tier: 3, managed_verticals: ['fencing'], invoice_type: 'per_metre', org_id: ORG,
    trade_details: { fullName: 'Henry Fence', abn: '11 222 333 444', bsb: '016-000', accountNo: '9988 7766', accountName: 'H Fence', gstRegistered: true } },
  office: { id: 'u-office', email: 'office@example.test', name: 'Alex Office', role: 'ops_manager', trade_tier: 3, managed_verticals: ['makesafe'], invoice_type: 'hourly', org_id: ORG, trade_details: {} }
};
const OTHERS = [
  { id: 'u-tendo', name: 'Tendo Moyo', role: 'crew', phone: '0400 333 444' },
  { id: 'u-israel', name: 'Israel Vaka', role: 'crew', phone: '0400 555 666' },
  { id: 'u-jo', name: 'Jo Marsh', role: 'crew', phone: '0400 777 888' }
];

/** A flat coloured tile with a caption, as a data URL, standing in for a site photo. */
export function tile(label, hue = 30) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 32% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 28% 36%)"/></linearGradient></defs><rect width="900" height="900" fill="url(#g)"/><path d="M0 640 L240 470 L420 590 L640 380 L900 560 L900 900 L0 900Z" fill="hsl(${hue} 22% 26% / .55)"/><text x="50" y="840" font-family="sans-serif" font-size="46" font-weight="700" fill="rgba(255,255,255,.9)">${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function createDb(persona) {
  const me = PEOPLE[persona] || PEOPLE.crew;
  const today = todayISO();
  const mon = mondayOf(today);
  const at = (date, hm) => new Date(`${date}T${hm}:00+08:00`).toISOString();
  let seq = 100;
  const id = (p) => `${p}-${++seq}`;

  const jobs = [
    { id: 'j-joon', type: 'fencing', status: 'scheduled', job_number: 'SWF-26767', client_name: 'Kelvin Gillies', client_phone: '0412 345 678', client_email: 'kelvin@example.test', site_address: '42 Lakeside Drive', site_suburb: 'Joondalup', ghl_contact_id: 'ghl-kelvin', notes: 'Dog on site, keep the side gate shut. Park on the verge.',
      scope_json: { tool: 'fence-designer', job: { runs: [{ name: 'Left boundary', length: 18.4 }, { name: 'Rear', length: 21 }, { name: 'Right return', length: 6.2 }], sheetHeight: 1800, profile: 'Colorbond Trimclad', colour: 'Monument', gates: [{ type: 'Single gate', width: 900 }], siteNotes: 'Remove existing asbestos-free super six along rear. Neighbour at 44 has agreed to half share. Retaining 300 mm for 6 m on left run.', checklist: { finalNotes: 'Reticulation runs along rear boundary, hand dig the first 3 posts.' }, removal: { notes: 'Old fence to go in the skip on the driveway.' } }, config: { plinths: true, retaining: '300 mm, 6 m' } } },
    { id: 'j-dunc', type: 'patio', status: 'in_progress', job_number: 'SWP-26339', client_name: 'Graham Rees', client_phone: '0423 222 111', site_address: '18 Marri Road', site_suburb: 'Duncraig', ghl_contact_id: 'ghl-graham', notes: '', scope_json: { config: { length: 7.2, projection: 4, height: 2.7, roofStyle: 'Flat', roofing: 'Cooldek 75 mm', sheetColor: 'Surfmist', steelColor: 'Monument', connection: 'Fascia with riser brackets', posts: 3, postSize: '90 x 90 SHS', beams: 1, beamSize: '150 x 50' }, client: { notes: 'Customer works from home, knock before starting loud work.' } } },
    { id: 'j-morl', type: 'makesafe', status: 'in_progress', job_number: 'SWMS-261290', client_name: 'Dana Whitlock', client_phone: '0434 999 000', site_address: '7 Wattle Court', site_suburb: 'Morley', notes: 'Storm damage. Tree through rear fence and patio roof sheet lifted.', metadata: { external_ref: 'MLB-40398', requesting_company_name: 'ML Builders' } },
    { id: 'j-sper', type: 'fencing', status: 'complete', job_number: 'SWF-26168', client_name: 'Priya Nair', client_phone: '0445 121 212', site_address: '3/11 Mill Point Road', site_suburb: 'South Perth', notes: '', scope_json: { job: { runs: [{ length: 9.5 }], sheetHeight: 1800, profile: 'Colorbond Trimclad', colour: 'Basalt' } } },
    { id: 'j-wemb', type: 'decking', status: 'in_progress', job_number: 'SWD-26088', client_name: 'Marcus Lim', client_phone: '0456 343 434', site_address: '29 Jersey Street', site_suburb: 'Wembley', notes: 'Merbau deck, 24 sqm. Second coat of oil on the last day.' },
    { id: 'j-kinr', type: 'patio', status: 'scheduled', job_number: 'SWP-261183', client_name: 'Emma Clarke', client_phone: '0467 565 656', site_address: '5 Edinburgh Avenue', site_suburb: 'Kinross', notes: '', scope_json: { config: { length: 6, projection: 3.6, roofStyle: 'Gable', roofing: 'Trimdek', sheetColor: 'Shale Grey', posts: 4 } } },
    { id: 'j-scar', type: 'repair', status: 'scheduled', job_number: 'SWR-26041', client_name: 'Noel Barker', client_phone: '0478 787 878', site_address: '112 Brighton Road', site_suburb: 'Scarborough', notes: 'Replace 4 fence panels and re-hang gate after vehicle impact.', metadata: { builder_company_name: 'AJ Building & Restoration', builder_work_order_ref: 'AJBR-70487' } },
    { id: 'j-bays', type: 'fencing', status: 'accepted', job_number: 'SWF-26802', client_name: 'Tom Okafor', client_phone: '0489 909 090', site_address: '64 Coode Street', site_suburb: 'Bayswater', notes: '', scope_json: { job: { runs: [{ length: 32 }], sheetHeight: 2100, profile: 'Colorbond Neetascreen', colour: 'Woodland Grey' } } },
    { id: 'j-hill', type: 'makesafe', status: 'scheduled', job_number: 'SWMS-261340', client_name: 'Robyn Ashe', client_phone: '0490 232 323', site_address: '21 Flinders Avenue', site_suburb: 'Hillarys', notes: 'Roof report needed. Tarp front ridge.', metadata: { external_ref: 'AJBR-70991', requesting_company_name: 'AJ Building & Restoration' } }
  ];
  const job = (jid) => jobs.find((j) => j.id === jid);

  // One row per person per job per day, as job_assignments.
  const assignments = [];
  const asg = (jid, uid, date, start, extra = {}) => { const a = { id: id('a'), job_id: jid, user_id: uid, scheduled_date: date, start_time: start, status: 'confirmed', role: 'lead_installer', assignment_type: 'install', is_lead: false, clocked_on_at: null, clocked_off_at: null, started_at: null, completed_at: null, hours_worked: null, break_minutes: 0, job_phase: 'assigned', notes: '', ...extra }; assignments.push(a); return a; };
  const done = (date, on, off, brk, hrs) => ({ status: 'complete', clocked_on_at: at(date, on), started_at: at(date, on), clocked_off_at: at(date, off), completed_at: at(date, off), break_minutes: brk, hours_worked: hrs, job_phase: 'complete' });
  const logged = [];
  const dMon = mon; const dTue = addDays(mon, 1);
  const yesterday = addDays(today, -1);

  if (persona !== 'office') {
    asg('j-joon', me.id, today, '07:00', { is_lead: true });
    asg('j-joon', 'u-tendo', today, '07:00');
    asg('j-joon', me.id, addDays(today, 1), '07:00', { is_lead: true });
    asg('j-joon', 'u-tendo', addDays(today, 1), '07:00');
    asg('j-dunc', me.id, addDays(today, 2), '07:30');
    asg('j-dunc', 'u-israel', addDays(today, 2), '07:30', { is_lead: true });
    asg('j-dunc', me.id, addDays(today, 3), '07:30');
    // Booked by the office, waiting on the trade's OK.
    asg('j-bays', me.id, addDays(today, 6), '07:00', { status: 'scheduled' });
    asg('j-hill', me.id, addDays(today, 4), '09:00', { status: 'scheduled' });
    // earlier this week and last week
    const past = [dMon, dTue, yesterday].filter((d, i, arr) => d < today && arr.indexOf(d) === i);
    if (past[0]) { const a = asg('j-sper', me.id, past[0], '07:00', done(past[0], '07:02', '15:34', 30, 8)); logged.push({ assignment_id: a.id, user_id: me.id, work_date: past[0], start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8 }); }
    if (past[1]) asg('j-wemb', me.id, past[1], '07:00', done(past[1], '07:10', '14:05', 25, 6.5));
    if (past[2]) { const a = asg('j-morl', me.id, past[2], '13:00', done(past[2], '13:05', '15:40', 0, 2.58)); logged.push({ assignment_id: a.id, user_id: me.id, work_date: past[2], start_time: '13:05', finish_time: '15:40', break_minutes: 0, hours: 2.58 }); }
    const lw = addDays(mon, -7);
    [0, 1, 2, 3].forEach((n) => { const d = addDays(lw, n); const a = asg(n < 2 ? 'j-sper' : 'j-wemb', me.id, d, '07:00', { ...done(d, '07:00', '15:30', 30, 8), invoiced_in: 'inv-last' }); logged.push({ assignment_id: a.id, user_id: me.id, work_date: d, start_time: '07:00', finish_time: '15:30', break_minutes: 30, hours: 8 }); });
  }
  asg('j-kinr', 'u-israel', addDays(today, 3), '07:00', { is_lead: true });
  asg('j-kinr', 'u-jo', addDays(today, 3), '07:00');
  asg('j-scar', 'u-jo', addDays(today, 1), '08:00');
  asg('j-hill', 'u-tendo', addDays(today, 4), '09:00');

  const media = [
    { id: id('m'), job_id: 'j-joon', type: 'photo', phase: 'scope', label: 'Rear boundary, existing fence', storage_url: tile('Rear boundary', 95), created_at: at(addDays(today, -9), '10:12') },
    { id: id('m'), job_id: 'j-joon', type: 'photo', phase: 'scope', label: 'Left side, retaining needed', storage_url: tile('Left side', 140), created_at: at(addDays(today, -9), '10:14') },
    { id: id('m'), job_id: 'j-joon', type: 'photo', phase: 'scope', label: 'Gate position', storage_url: tile('Gate position', 28), created_at: at(addDays(today, -9), '10:15') },
    { id: id('m'), job_id: 'j-dunc', type: 'photo', phase: 'in_progress', label: 'Posts set', storage_url: tile('Posts set', 200), created_at: at(addDays(today, -1), '14:02') },
    { id: id('m'), job_id: 'j-sper', type: 'photo', phase: 'completion', label: 'Finished run', storage_url: tile('Finished run', 260), created_at: at(dMon, '15:20') },
    { id: id('m'), job_id: 'j-morl', type: 'photo', phase: 'completion', label: 'Tarp fixed', storage_url: tile('Tarp fixed', 12), created_at: at(yesterday, '15:30') }
  ];
  const notes = [
    { id: id('n'), job_id: 'j-joon', event_type: 'note', created_at: at(addDays(today, -3), '09:40'), users: { name: 'Office' }, detail_json: { text: 'Materials land Thursday arvo, stacked behind the carport. Skip is booked for Friday.', from_ops: true } },
    { id: id('n'), job_id: 'j-joon', event_type: 'site_note', created_at: at(addDays(today, -1), '16:05'), users: { name: 'Tendo Moyo' }, detail_json: { text: 'Dropped the auger and string lines off. Neighbour at 44 wants a knock before we pull the old fence.' } },
    { id: id('n'), job_id: 'j-dunc', event_type: 'site_note', created_at: at(addDays(today, -1), '14:10'), users: { name: 'Israel Vaka' }, detail_json: { text: 'Posts are in and braced. Leave the braces on until Thursday.' } }
  ];
  const purchaseOrders = [
    { id: 'po-1', job_id: 'j-joon', po_number: 'PO-1000412', supplier_name: 'Stratco Joondalup', status: 'authorised', delivery_date: addDays(today, -1), line_items: [{ description: 'Trimclad sheet 1800 Monument', quantity: 46 }, { description: 'Post 2400 Monument', quantity: 21 }, { description: 'Plinth 150 Monument', quantity: 20 }, { description: 'Single gate kit 900', quantity: 1 }] },
    { id: 'po-2', job_id: 'j-joon', po_number: 'PO-1000418', supplier_name: 'Bunnings Joondalup', status: 'draft', line_items: [{ description: 'Rapid set concrete 20 kg', quantity: 30 }] },
    { id: 'po-3', job_id: 'j-dunc', po_number: 'PO-1000390', supplier_name: 'Stratco Osborne Park', status: 'authorised', delivery_date: addDays(today, 1), line_items: [{ description: 'Cooldek 75 mm 4.2 m', quantity: 8 }, { description: 'Beam 150 x 50 Monument 7.4 m', quantity: 1 }] }
  ];
  const documents = [
    { id: id('d'), job_id: 'j-dunc', type: 'council_plans', file_name: 'Approved plans - 18 Marri Rd.pdf', visible_to_trades: true, storage_url: 'https://example.test/plans.pdf' },
    { id: id('d'), job_id: 'j-dunc', type: 'engineering', file_name: 'Engineering - patio.pdf', visible_to_trades: true, storage_url: 'https://example.test/eng.pdf' }
  ];
  const quotePacks = {
    'j-joon': [{ quote_number: 'Q-26767-2', status: 'accepted', accepted: true, sent_at: at(addDays(today, -14), '11:00'), quote_lines: [
      { description: 'Remove and dispose of existing fence, rear and left boundaries', quantity: 39.4, unit: 'm' },
      { description: 'Supply and install Colorbond Trimclad fence 1800 high, Monument, with plinths', quantity: 45.6, unit: 'm' },
      { description: 'Retaining to 300 mm on left boundary', quantity: 6, unit: 'm' },
      { description: 'Single pedestrian gate 900 wide with latch', quantity: 1, unit: 'ea' }],
      quote_notes: ['Fence line as pegged with the customer on site. Any rock or footings hit while digging is a variation.'], notes: '' }],
    'j-kinr': [{ quote_number: 'Q-261183-1', status: 'accepted', accepted: true, quote_lines: [{ description: 'Gable patio 6.0 x 3.6 m, Trimdek, Shale Grey', quantity: 1, unit: 'ea' }, { description: 'Remove existing shade sail posts', quantity: 2, unit: 'ea' }], quote_notes: [] }],
    'j-scar': [{ quote_number: 'Q-26041-1', status: 'sent', quote_lines: [{ description: 'Replace damaged fence panels to match existing', quantity: 4, unit: 'ea' }, { description: 'Re-hang and align gate', quantity: 1, unit: 'ea' }], quote_notes: [] }]
  };
  const jobWorkOrders = {
    'j-joon': { id: 'wo-j1', wo_number: 'WO-26767', status: 'approved', approved_at: at(addDays(today, -5), '12:00'), special_instructions: 'Hand dig the first three posts on the rear run: reticulation main is on the line. Old fence goes in the skip.', scope_items: [
      { description: 'Strip old fence, rear and left', qty: 39.4, unit: 'm', hours: 6 }, { description: 'Set posts and plinths, 45.6 m', qty: 21, unit: 'posts', hours: 12 },
      { description: 'Retaining 300 mm, left run', qty: 6, unit: 'm', hours: 3 }, { description: 'Sheet and cap', qty: 45.6, unit: 'm', hours: 8 }, { description: 'Hang gate and latch', qty: 1, unit: 'ea', hours: 1.5 }], addenda: [] }
  };

  const mondayLast = addDays(mon, -7);
  const invoices = persona === 'office' ? [] : [
    { id: 'inv-last', user_id: me.id, week_start: mondayLast, week_end: addDays(mondayLast, 6), invoice_number: 'SW-INV-ST-0417', status: 'pushed_to_xero', invoice_source: 'hourly', gst_on: false, gross_earned: 1760, super_rate: 0.12, super_amount: 211.2, worker_withhold: 105.6, net_pay: 1654.4, gst: 0, total_inc: 1760, trade_payable: 1654.4, xero_bill_id: 'xb-1', submitted_at: at(addDays(mon, -1), '17:02'), created_at: at(addDays(mon, -1), '17:02'), paid_at: null,
      lines: [0, 1, 2, 3].map((n) => ({ id: 'l' + n, line_date: addDays(mondayLast, n), work_date: addDays(mondayLast, n), start_time: '07:00', finish_time: '15:30', break_minutes: 30, job_number: n < 2 ? 'SWF-26168' : 'SWD-26088', client_name: n < 2 ? 'Priya Nair' : 'Marcus Lim', description: 'Labour', line_type: 'labour', total_hours: 8, hourly_rate: 55, line_total_ex: 440 })) },
    { id: 'inv-prev', user_id: me.id, week_start: addDays(mondayLast, -7), week_end: addDays(mondayLast, -1), invoice_number: 'SW-INV-ST-0409', status: 'paid', invoice_source: 'hourly', gst_on: false, gross_earned: 2145, super_rate: 0.12, super_amount: 257.4, worker_withhold: 128.7, net_pay: 2016.3, gst: 0, total_inc: 2145, trade_payable: 2016.3, xero_bill_id: 'xb-0', submitted_at: at(addDays(mondayLast, -1), '16:40'), created_at: at(addDays(mondayLast, -1), '16:40'), paid_at: at(addDays(mondayLast, 4), '09:00'), amount_paid: 2016.3,
      lines: [{ id: 'p1', line_date: addDays(mondayLast, -7), work_date: addDays(mondayLast, -7), start_time: '07:00', finish_time: '15:30', break_minutes: 30, job_number: 'SWF-26168', client_name: 'Priya Nair', description: 'Labour', line_type: 'labour', total_hours: 39, hourly_rate: 55, line_total_ex: 2145 }] }
  ];
  const expenses = [];
  const availability = [];
  const groups = persona === 'office' ? [] : [{ group_id: 'g-dunc', job_id: 'j-dunc', job_number: 'SWP-26339', client_name: 'Graham Rees', site_suburb: 'Duncraig', job_type: 'patio', pay_basis: 'all_in_12_v2', awaiting: 'needs_hours', pot_total: null, my_share: null, client_signed: false, crew_hours: [{ name: 'Israel Vaka', me: false, hours: 7.5, approved: true }, { name: me.name, me: true, hours: 0, approved: false }], crew_status: [], discovery: { state: 'member' }, entries: [] }];

  return { me, persona, org: ORG, jobs, job, assignments, logged, media, notes, purchaseOrders, documents, quotePacks, jobWorkOrders, invoices, expenses, availability, groups, others: OTHERS, rate: persona === 'lead' ? 0 : 55, id, at, flags: { companyView: true, selfBooking: true, rateEditable: true }, now };
}
