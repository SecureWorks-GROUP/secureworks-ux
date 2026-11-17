// The group work order for one job: the job pays the crew one amount, and it is
// shared by the hours each person worked. One screen that always says what
// happens next. Only your own share is ever shown, as the server works it out.
import { html, cx, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, local, invalidate, primeQuery } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { todayISO, mondayOf, addDays, weekDays, fmtDay, fmtDow, fmtDom, hoursBetween, tsToDate } from '../lib/dates.js';
import { jobTitle, jobAddress } from '../lib/model.js';
import { useJob, jobStub } from '../lib/data.js';
import { Page, Section, KV, JobLine, Button, Sheet, Field, Picks, Toggle, TimeInput, BREAKS, SkelRows, Empty, LoadError, IconButton, toast, ask, openOverlay, buzz } from '../ui/kit.js';
import { DoneScreen, PayRows, SigPad, Stars, superNote, whenWords, cash, hrs, num, uuid } from '../ui/paybits.js';

const HOURS_STATES = ['needs_join', 'needs_hours', 'awaiting_others', 'awaiting_rate', 'awaiting_office', 'awaiting_crew_approval'];
const CREW_STATE = {
  not_invoiced: 'Not invoiced yet', submitted: 'Invoiced', approved: 'Approved', queried: 'Office has a question', rejected: 'Sent back',
  released: 'Sent for payment', no_share: 'No share', duplicate: 'Office is checking', mismatch: 'Office is checking'
};
const RATINGS = [['sales_process', 'Quote and sale'], ['communication', 'Keeping you informed'], ['cleanliness', 'Clean and tidy'], ['punctuality', 'On time'], ['crew', 'The crew']];
const isOff = (err) => err instanceof ApiError && ((err.body && err.body.code) || err.code) === 'group_work_order_disabled';

export function Group({ jobId }) {
  const user = useStore((s) => s.user);
  const shareQ = useQuery('group:' + jobId, () => api('group_work_order_my_share', null, { job_id: jobId }), { ttl: 20000 });
  const listQ = useQuery('groups', () => api('my_group_work_orders', null, null, { keepSession: true }), { ttl: 120000 });
  const jobQ = useJob(jobId);
  const daysKey = `group-days:${user.id}:${jobId}`;
  const unsureKey = `group-unsure:${user.id}:${jobId}`;
  const [busy, setBusy] = useState('');
  const [gst, setGst] = useState(user.gstDefault);
  const [result, setResult] = useState(null);
  const [unsure, setUnsure] = useState(() => local.get(unsureKey, null));
  const [savedDays, setSavedDays] = useState(() => local.get(daysKey, []));

  const share = shareQ.data || null;
  const row = ((listQ.data && listQ.data.groups) || []).find((x) => x.job_id === jobId) || null;
  const g = { ...(row || {}), ...(share || {}) };
  const job = (jobQ.data && jobQ.data.job) || jobStub(jobId) || {};
  const title = g.site_suburb || (jobTitle(job) !== 'Job' ? jobTitle(job) : g.client_name || g.job_number || 'Group job');
  const jobNumber = g.job_number || job.job_number || '';
  const client = g.client_name || job.client_name || '';
  const off = (share && share.enabled === false) || (listQ.data && listQ.data.enabled === false) || isOff(shareQ.error);

  const refresh = (fresh) => {
    // Hours and lock-in answer with the whole of my share, so it can be shown at once. Anything else is read again.
    if (fresh && typeof fresh === 'object' && fresh.awaiting) primeQuery('group:' + jobId, { enabled: true, participant: true, ...fresh });
    else shareQ.refetch();
    invalidate('groups'); invalidate('hours');
  };
  const write = async (name, action, body, { expect, done } = {}) => {
    setBusy(name);
    try {
      const res = await api(action, null, body);
      if (res && res.ok === false) throw new ApiError(res.userMessage || res.error || 'Not saved', { status: 409, code: res.code, body: res });
      if (expect && !expect(res || {})) throw new ApiError('That did not go through. Check the screen and try again.', { status: 409, body: res || {} });
      refresh(res);
      buzz(10);
      if (done) toast(done, { kind: 'ok' });
      setBusy('');
      return res || {};
    } catch (err) {
      setBusy('');
      const code = (err.body && err.body.code) || err.code || '';
      toast(/removed/.test(code) ? 'The office took you off this group work order. Ask them if that is wrong.' : friendly(err), { kind: 'bad', ms: 6500 });
      shareQ.refetch();
      return null;
    }
  };

  const head = html`<div class="block card pad pay-ghead"><b class="t-head">${title}</b><${JobLine} job=${{ job_number: jobNumber }}>${client}<//></div>`;
  const page = (body, foot) => html`<${Page} title="Group work order" back="Pay" onBack=${() => back('/pay')} foot=${foot || null}>${head}${body}<//>`;

  if (result) return html`<${ShareSent} result=${result} title=${title} onDone=${() => { setResult(null); shareQ.refetch(); }} />`;

  if (off) {
    return page(html`<${Empty} title="Group work orders are not switched on" action=${html`<${Button} kind="line" small onClick=${() => go('/pay/week/' + mondayOf(todayISO()))}>Open this week's timesheet<//>`}>Record your hours for this job on your timesheet, the same as any other job.<//>`);
  }
  if (!share) {
    return page(shareQ.loading ? html`<div class="pay-gap"><${SkelRows} n=${3} /></div>` : html`<${LoadError} error=${shareQ.error} onRetry=${shareQ.refetch} what="the group work order" />`);
  }

  const disc = g.discovery || {};
  const member = share.participant !== false && Boolean(g.awaiting || disc.state === 'member' || g.needs_hours != null);

  // ---------------------------------------------------- not in the crew yet
  if (!member) {
    const canCreate = disc.state === 'create';
    const canJoin = disc.state === 'join' || g.awaiting === 'needs_join' || (Boolean(g.group_id) && !disc.state);
    return page(html`
      <${Section} label=${canCreate || canJoin ? 'Next' : 'Where it is up to'}>
        <div class="block card pad pay-next">
          <b>${canCreate ? 'Start the group work order' : canJoin ? 'Join the group work order' : 'Nothing for you to do here'}</b>
          <p class="t-small">${disc.message || (canCreate ? 'This job is paid as a group, not by the hour. Start the group work order so everyone can add their hours.' : canJoin ? 'The group work order for this job is open. Join it to add your hours and get your share.' : 'You are not part of the group work order for this job. If you worked on it, ask the office to book you on.')}</p>
        </div>
      <//>
      ${canCreate || canJoin ? html`<p class="block t-small pay-note"><span class="t-strong">How it works.</span> The job pays the crew one agreed amount. Everyone adds the days they worked, the customer signs the job off, and the amount is shared by hours. Then each person invoices their own share.</p>`
        : html`<div class="block pay-gap"><${Button} kind="line" block onClick=${() => go('/pay/week/' + mondayOf(todayISO()))}>Open this week's timesheet<//></div>`}`,
    canCreate ? html`<${Button} block class="big" busy=${busy === 'create'} onClick=${() => write('create', 'create_group_work_order', { job_id: jobId }, { done: 'Group work order started. Add your hours.' })}>Start the group work order<//>`
      : canJoin ? html`<${Button} block class="big" busy=${busy === 'join'} onClick=${() => write('join', 'join_group_work_order', g.group_id ? { group_id: g.group_id } : { job_id: jobId }, { done: 'You are in. Add your hours.' })}>Join the group work order<//>` : null);
  }

  // -------------------------------------------------------------- in the crew
  const gid = g.group_id;
  const idBody = gid ? { group_id: gid } : { job_id: jobId };
  const awaiting = g.awaiting || (g.needs_hours ? 'needs_hours' : '');
  const submitted = g.submitted || null;
  const frozen = awaiting === 'frozen' || Boolean(submitted);
  const signed = g.client_signed === true;
  const hoursDone = !HOURS_STATES.includes(awaiting);
  const crew = g.crew_hours || [];
  const meRow = crew.find((c) => c.me) || null;
  const myHours = meRow ? Number(meRow.hours) || 0 : null;
  const serverDays = g.my_entries || g.entries || g.time_entries || null;
  const myDays = (Array.isArray(serverDays) ? serverDays : myHours === 0 ? [] : savedDays).slice().sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
  const signoff = g.client_signoff || null;
  const release = g.release || {};
  const step = submitted ? 4 : frozen ? 3 : awaiting === 'ready' ? 2 : hoursDone && !signed ? 1 : hoursDone ? 2 : 0;
  const blocked = unsure && !submitted;
  if (unsure && submitted) { local.del(unsureKey); }

  const keepDay = (d) => { const next = [...savedDays.filter((x) => x.work_date !== d.work_date), d]; local.set(daysKey, next); setSavedDays(next); };
  const dropDay = (date) => { const next = savedDays.filter((x) => x.work_date !== date); local.set(daysKey, next); setSavedDays(next); };
  const addDay = () => openOverlay((close) => html`<${DaySheet} idBody=${idBody} taken=${myDays} onClose=${close} onSaved=${(day, res) => { keepDay(day); refresh(res); }} />`);
  const removeDay = async (d) => {
    if (!(await ask({ title: `Remove ${fmtDay(d.work_date)}?`, body: 'Your hours for that day come off the group work order.', yes: 'Remove the day', danger: true }))) return;
    const res = await write('day:' + d.work_date, 'delete_group_work_order_hours', { ...idBody, work_date: d.work_date }, { done: 'Day removed.' });
    if (res) dropDay(d.work_date);
  };
  const sign = () => openOverlay((close) => html`<${SignSheet} idBody=${idBody} job=${job} title=${title} onClose=${close} onDone=${(res) => { if (res) toast(res.happy === false ? 'Saved. The office will follow up what needs fixing.' : 'Signed. Thank the customer for us.', { kind: 'ok' }); refresh(); listQ.refetch(); }} />`);
  const lock = async () => {
    if (!(await ask({ title: 'Lock in the shares?', body: 'This splits the job between the crew by the hours entered. Nobody can change their hours after this, so check the hours are right first.', yes: 'Lock in the shares' }))) return;
    await write('lock', 'freeze_group_work_order', idBody, { expect: (r) => r.awaiting === 'frozen', done: 'Shares are locked in.' });
  };
  const invoice = async () => {
    if (!navigator.onLine) { toast('No signal. Send your share when you are back in range.', { kind: 'bad' }); return; }
    const words = num(g.my_cash_pay) != null ? `${cash(g.my_cash_pay)} is paid to you${num(g.my_super) ? ` and ${cash(g.my_super)} goes into your super` : ''}.` : `Your share is ${cash(g.my_share)}.`;
    if (!(await ask({ title: `Invoice your share for ${title}?`, body: `${words} You send this once and cannot change it after.`, yes: 'Invoice my share' }))) return;
    setBusy('invoice');
    let res = null; let err = null;
    // Sent alone, exactly once. Whatever comes back, this is never sent again by itself.
    try { res = await api('generate_trade_invoice', null, { extra_items: [{ type: 'group share', group_id: gid }], gst_on: Boolean(gst) }, { timeout: 45000 }); } catch (e) { err = e; }
    invalidate('invoices'); invalidate('money'); invalidate('hours'); invalidate('groups');
    setBusy('');
    if (err instanceof ApiError && err.refused) { toast(friendly(err) + ' Nothing was sent.', { kind: 'bad', ms: 7000 }); shareQ.refetch(); return; }
    let outcome = 'unsure';
    if (res && res.success === true && res.invoice_id) {
      if (g.pay_basis === 'all_in_12_v2') outcome = res.group_release && res.group_release.released === true ? 'released' : 'saved';
      else if (res.office_review === 'held' && !res.xero_bill_id) outcome = 'review';
    }
    if (outcome === 'unsure') { const at = new Date().toISOString(); local.set(unsureKey, at); setUnsure(at); } else buzz([14, 60, 14, 60, 30]);
    setResult({ outcome, res: res || {} });
  };
  const sendAgainAnyway = async () => {
    if (!(await ask({ title: 'Did the office say to send it again?', body: 'Only do this if the office has checked and told you your share did not come through.', yes: 'Yes, they told me', danger: true }))) return;
    local.del(unsureKey); setUnsure(null);
  };

  const paidDiffers = num(g.my_cash_pay) != null && num(g.my_share) != null && Math.abs(g.my_cash_pay - g.my_share) > 0.005;
  const notHappy = !signed && (g.client_not_happy === true || (signoff && signoff.happy === false));
  const next = nextWords({ awaiting, signed, submitted, release, blocked, myHours, notHappy });
  const serverSays = g.next_step || (disc.state !== 'member' ? disc.message : '') || '';
  const primary = blocked || submitted ? null
    : step === 0 && (awaiting === 'needs_hours' || !myHours) ? html`<${Button} block class="big" onClick=${addDay}>Add a day you worked<//>`
    : step === 1 ? html`<${Button} block class="big" onClick=${sign}>${notHappy ? 'All fixed? Get the customer to sign' : 'Get the customer to sign'}<//>`
    : step === 2 && awaiting === 'ready' ? html`<${Button} block class="big" busy=${busy === 'lock'} onClick=${lock}>Lock in the shares<//>`
    : step === 3 && num(g.my_share) > 0 ? html`<${Button} block class="big" busy=${busy === 'invoice'} onClick=${invoice}>Invoice my share<//>` : null;
  const stepNo = (i, done) => html`<span class=${cx('pay-stepno', done ? 'done' : i === step ? 'now' : '')}>${i + 1}</span>`;

  return page(html`
    <${Section} label=${submitted ? 'Where it is up to' : 'Next'}>
      <div class="block card pad pay-next">
        <b>${next[0]}</b>
        <p class="t-small">${serverSays || next[1]}</p>
      </div>
      ${frozen && num(g.my_share) != null ? html`<div class="block card pay-gap">
        <${KV} k="Your share" v=${html`<span class="t-figure">${cash(g.my_share)}</span>`} />
        ${paidDiffers ? html`<${KV} k="Paid to you" v=${cash(g.my_cash_pay)} />` : null}
        ${num(g.my_super) ? html`<${KV} k="Into your super" v=${cash(g.my_super)} />` : null}
      </div>` : null}
    <//>

    ${blocked ? html`<div class="block note-banner pay-gap"><span><span class="t-strong">Do not send your share again.</span> We could not tell if it went through. The office needs to check first.
        <span class="pay-linkpair"><button type="button" class="link tap" onClick=${() => { shareQ.refetch(); listQ.refetch(); toast('Checked again.'); }}>Check again</button><button type="button" class="link tap" onClick=${sendAgainAnyway}>The office said to resend</button></span></span></div>` : null}

    ${!frozen && (num(g.pot_total) != null || num(g.projected_my_share) != null) ? html`<div class="block card pay-gap">
      ${num(g.pot_total) != null ? html`<${KV} k="The job pays the crew" v=${cash(g.pot_total)} />` : null}
      ${num(g.projected_my_share) != null ? html`<${KV} k="Your share so far" v=${cash(g.projected_my_share)} />` : null}
    </div>${num(g.projected_my_share) != null ? html`<p class="block t-small pay-note">Your share moves as hours come in. It is set when the shares are locked in.</p>` : null}` : null}
    ${frozen && !submitted && num(g.my_budget) != null && g.budget_includes_super ? html`<p class="block t-small pay-note">Your part of the job is ${cash(g.my_budget)}, with your super inside it. The company pays the super, so nothing is held from your pay.</p>` : null}

    ${step === 3 && !blocked ? html`<div class="block card pad pay-gap"><${Toggle} label="Add GST" hint="Only if you are registered for GST." checked=${gst} onChange=${setGst} /></div>` : null}

    <${Section} label="Steps">
      <div class="block card pay-gsteps">
        <div class="pay-gstep">${stepNo(0, hoursDone)}
          <div class="main"><b>Hours</b>
            <span class="how">${myHours == null ? 'Add the days you worked.' : myHours ? `You have ${hrs(myHours)} in.` : 'You have not added any yet.'}${frozen ? '' : ' Saving a day again replaces it.'}</span>
            ${myDays.length ? html`<div class="pay-gdays">${myDays.map((d) => html`<div class="pay-gday" key=${d.work_date}>
              <span class="main"><b>${fmtDay(d.work_date)}</b><span class="how t-num">${[whenWords(d), d.hours != null ? hrs(d.hours) : ''].filter(Boolean).join(' · ')}</span></span>
              ${frozen ? null : html`<${IconButton} name="trash" label=${'Remove ' + fmtDay(d.work_date)} size=${20} disabled=${busy === 'day:' + d.work_date} onClick=${() => removeDay(d)} />`}</div>`)}</div>` : null}
            ${!frozen && (primary == null || step !== 0 || myHours > 0) ? html`<div><${Button} kind="line" small onClick=${addDay}>${myDays.length || myHours ? 'Add another day' : 'Add a day'}<//></div>` : null}
            ${crew.length ? html`<div class="pay-gcrew">${crew.map((c) => html`<div class="pay-gcrewrow" key=${c.name + (c.me ? ':me' : '')}>
              <span>${c.me ? 'You' : c.name}</span><span class=${Number(c.hours) > 0 ? 't-num' : 't-mute'}>${Number(c.hours) > 0 ? hrs(c.hours) : 'No hours yet'}</span></div>`)}</div>` : null}
          </div>
        </div>
        <div class="pay-gstep">${stepNo(1, signed)}
          <div class="main"><b>Customer signs off</b>
            <span class="how">${signed ? `Signed${signoff && signoff.name ? ' by ' + signoff.name : ''}${signoff && signoff.at ? ', ' + fmtDay(tsToDate(signoff.at)) : ''}.` : notHappy ? `${signoff && signoff.name ? signoff.name : 'The customer'} listed things to fix${signoff && signoff.at ? ' on ' + fmtDay(tsToDate(signoff.at)) : ''}. They sign again once those are done.` : hoursDone ? 'Hand them your phone, or the office can send them a link.' : 'Once everyone has their hours in.'}</span>
            ${signed && signoff && signoff.happy === false ? html`<span class="how t-bad">They listed things to fix. The office will be in touch about them.</span>` : null}
            ${signed && !frozen ? html`<span class="how">If anyone changes their hours now, the customer has to sign again.</span>` : null}
          </div>
        </div>
        <div class="pay-gstep">${stepNo(2, frozen)}
          <div class="main"><b>Shares locked in</b>
            <span class="how">${frozen ? 'Done. Hours can no longer change.' : awaiting === 'ready' ? 'Everything is in. Anyone in the crew can do this.' : 'After the hours and the signature.'}</span></div>
        </div>
        <div class="pay-gstep">${stepNo(3, Boolean(submitted))}
          <div class="main"><b>Invoice your share</b>
            <span class="how">${submitted ? `Sent${submitted.invoice_number ? ', ' + submitted.invoice_number : ''}.` : frozen ? 'One tap. It goes in by itself, not on your weekly invoice.' : 'Each person sends their own.'}</span>
            ${submitted && submitted.invoice_id ? html`<div><${Button} kind="line" small onClick=${() => go('/pay/invoice/' + submitted.invoice_id)}>View invoice<//></div>` : null}
            ${submitted ? html`<div class="pay-gcrew">
              ${(g.crew_status || []).map((c) => html`<div class="pay-gcrewrow" key=${c.name + (c.me ? ':me' : '')}><span>${c.me ? 'You' : c.name}</span><span class=${c.state === 'not_invoiced' ? 't-mute' : ''}>${CREW_STATE[c.state] || 'With the office'}</span></div>`)}
            </div>` : null}
            ${submitted && Array.isArray(release.hold) && release.hold.length ? release.hold.map((h) => html`<span class="how">${typeof h === 'string' ? h : h.message || h.reason || ''}</span>`) : null}
          </div>
        </div>
      </div>
    <//>`, primary);
}

function nextWords({ awaiting, signed, submitted, release, blocked, myHours, notHappy }) {
  if (blocked) return ['Waiting on the office', 'Your share may already be in. The office needs to check before anything else happens.'];
  if (submitted) {
    if (release.released === true || submitted.status === 'paid') return ['Sent for payment', 'Your share went for payment with the whole crew.'];
    if (submitted.review === 'queried' || submitted.status === 'queried') return ['The office has a question', 'Give the office a call about your share.'];
    if (submitted.status === 'ops-reject' || submitted.review === 'rejected') return ['Your share was sent back', 'Call the office to sort out what is wrong.'];
    const n = num(release.total) != null && num(release.invoiced) != null ? `${release.invoiced} of ${release.total} in the crew have invoiced. ` : '';
    return ['Your share is invoiced', `${n}The whole crew is paid together, once everyone has invoiced and the office has checked it.`];
  }
  if (awaiting === 'needs_hours' || awaiting === 'needs_join') return ['Add your hours', 'Put in each day you worked on this job, with your start and finish times.'];
  if (awaiting === 'awaiting_others') return ['Waiting on the rest of the crew', myHours ? 'Your hours are in. The others still need to add theirs. Give them a nudge.' : 'The others still need to add their hours.'];
  if (awaiting === 'awaiting_rate' || awaiting === 'awaiting_office') return ['Waiting on the office', 'The office has to finish setting up pay for someone in the crew. Nothing for you to do.'];
  if (awaiting === 'awaiting_crew_approval') return ['Waiting on the crew', 'The crew still has to confirm the hours.'];
  if (notHappy && awaiting !== 'ready' && awaiting !== 'frozen') return ['Fix what the customer listed', 'The customer was not happy to sign the job off yet. Fix what they listed, then get them to sign again.'];
  if (awaiting === 'awaiting_signoff' || (!signed && awaiting !== 'ready' && awaiting !== 'frozen')) return ['Get the customer to sign', 'All the hours are in. The customer signs the job off on your phone, then the shares can be locked in.'];
  if (awaiting === 'ready') return ['Lock in the shares', 'Hours are in and the customer has signed. Lock it in to set your share.'];
  if (awaiting === 'frozen') return ['Invoice your share', 'The shares are set. Send yours and you are done.'];
  return ['Group work order', 'Open each step below to see where it is up to.'];
}

// ------------------------------------------------------------- add a day
function DaySheet({ idBody, taken, onSaved, onClose }) {
  const today = todayISO();
  const [week, setWeek] = useState(mondayOf(today));
  const [date, setDate] = useState(null);
  const [start, setStart] = useState(''); const [finish, setFinish] = useState('');
  const [brk, setBrk] = useState(null); const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const breakMin = brk === 'other' ? Math.max(0, Math.round(Number(other) || 0)) : brk;
  const hours = brk == null ? NaN : hoursBetween(start, finish, breakMin);
  const ok = date && !isNaN(hours) && hours > 0 && hours <= 24;
  const has = (d) => taken.some((t) => t.work_date === d);
  const pick = (d) => {
    setDate(d);
    const t = taken.find((x) => x.work_date === d);
    if (t && t.start_time) { setStart(String(t.start_time).slice(0, 5)); setFinish(String(t.finish_time || '').slice(0, 5)); const b = Number(t.break_minutes) || 0; if (BREAKS.some(([v]) => v === b)) setBrk(b); else { setBrk('other'); setOther(String(b)); } }
  };
  const save = async (shut) => {
    setBusy(true);
    const body = { ...idBody, work_date: date, start_time: start, finish_time: finish };
    if (breakMin) body.break_minutes = breakMin;
    try {
      const res = await api('submit_group_work_order_hours', null, body);
      if (res && res.ok === false) throw new ApiError(res.userMessage || res.error || 'Not saved', { status: 409, code: res.code, body: res });
      buzz(10);
      toast(`${fmtDay(date)} saved, ${hrs(hours)}.`, { kind: 'ok' });
      onSaved({ work_date: date, start_time: start, finish_time: finish, break_minutes: breakMin || 0, hours }, res);
      shut();
    } catch (err) { setBusy(false); toast(friendly(err), { kind: 'bad', ms: 6500 }); }
  };
  return html`<${Sheet} title="Add a day you worked" sub="Hours are worked out from your start, finish and break." onClose=${onClose}
    foot=${(shut) => html`<${Button} block busy=${busy} disabled=${!ok} onClick=${() => save(shut)}>${ok ? `Save ${fmtDay(date)} · ${hrs(hours)}` : 'Save the day'}<//>`}>
    <div class="stack">
      <${Field} label=${week === mondayOf(today) ? 'This week' : 'Last week'}>
        <div class="daypicks">${weekDays(week).map((d) => html`<button type="button" class=${cx('daypick', d === today && 'today')} disabled=${d > today} aria-pressed=${String(date === d)} onClick=${() => pick(d)}>
          <span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span>${has(d) ? html`<span class="t-small">in</span>` : null}</button>`)}</div>
        <button type="button" class="link tap pay-linkrow" onClick=${() => { setWeek(week === mondayOf(today) ? addDays(week, -7) : mondayOf(today)); setDate(null); }}>${week === mondayOf(today) ? 'It was last week' : 'Back to this week'}</button>
      <//>
      <div class="pay-two"><${TimeInput} label="Started" value=${start} onInput=${setStart} /><${TimeInput} label="Finished" value=${finish} onInput=${setFinish} /></div>
      <${Field} label="Break"><${Picks} value=${brk} options=${[...BREAKS, ['other', 'Other']]} onChange=${setBrk} /><//>
      ${brk === 'other' ? html`<${Field} label="Break in minutes"><input class="input" type="number" inputmode="numeric" min="0" max="600" value=${other} onInput=${(e) => setOther(e.currentTarget.value)} /><//>` : null}
      <div class="card pay-out"><span class="t-cap">Hours</span>${!isNaN(hours) && hours > 0 ? html`<b class="t-figure">${hrs(hours)}</b>` : html`<span class="t-small">${!date ? 'Pick the day' : brk == null ? 'Pick a break' : 'Check the times'}</span>`}</div>
    </div>
  <//>`;
}

// ------------------------------------------------------- customer sign-off
function SignSheet({ idBody, job, title, onDone, onClose }) {
  const [captureId] = useState(uuid);
  const [name, setName] = useState(job.client_name || '');
  const [happy, setHappy] = useState(null);
  const [ratings, setRatings] = useState({});
  const [note, setNote] = useState(''); const [items, setItems] = useState('');
  const [sig, setSig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  const rated = RATINGS.every(([k]) => ratings[k] >= 1);
  const missing = !name.trim() ? 'Add the customer name' : happy == null ? 'Answer the question' : happy && !rated ? 'Tap a star for each line' : !happy && items.trim().length < 3 ? 'List what needs fixing' : !sig ? 'Sign in the box' : '';
  const save = async (shut) => {
    setBusy(true);
    const body = happy
      ? { ...idBody, signer_name: name.trim(), signature_png: sig, happy: true, capture_id: captureId, satisfaction_rating: ratings.crew, ratings, note: note.trim() }
      : { ...idBody, signer_name: name.trim(), signature_png: sig, happy: false, capture_id: captureId, outstanding_items: items.trim() };
    try {
      const res = await api('capture_group_client_signoff', null, body, { timeout: 30000 });
      if (!res || res.ok !== true) throw new ApiError((res && (res.userMessage || res.error)) || 'The sign-off was not saved.', { status: 409, code: res && res.code, body: res || {} });
      buzz([14, 60, 30]);
      onDone(res); shut();
    } catch (err) {
      setBusy(false);
      const refused = err instanceof ApiError && err.refused;
      // An unhappy sign-off that may or may not have saved is never sent a second time from here.
      if (!happy && !refused) { setStuck(true); return; }
      toast(refused ? friendly(err) : 'That did not save. Check your signal and press Save again.', { kind: 'bad', ms: 6500 });
    }
  };
  return html`<${Sheet} title="Customer sign-off" sub=${[title, jobAddress(job)].filter(Boolean).join(' · ')} onClose=${onClose} tall
    foot=${(shut) => (stuck ? html`<${Button} block kind="ink" onClick=${() => { onDone(null); shut(); }}>Close and check<//>` : html`
      ${missing ? html`<p class="t-small pay-center">${missing}</p>` : null}
      <${Button} block busy=${busy} disabled=${Boolean(missing)} onClick=${() => save(shut)}>Save sign-off<//>`)}>
    ${stuck ? html`<div class="stack"><div class="note-banner"><span><span class="t-strong">We could not tell if that saved.</span> Do not fill it in again. Close this, then check the job in a minute. If it still says not signed, call the office.</span></div></div>` : html`<div class="stack loose">
      <p>Hand the phone to the customer. They confirm the work is done, then sign.</p>
      <${Field} label="Your name"><input class="input" autocomplete="off" value=${name} onInput=${(e) => setName(e.currentTarget.value)} /><//>
      <${Field} label="Are you happy with the job?"><${Picks} value=${happy} options=${[[true, 'Yes, all done'], [false, 'No, something needs fixing']]} onChange=${setHappy} /><//>
      ${happy === true ? html`<div class="stack tight">
        <span class="t-cap">How did we go?</span>
        ${RATINGS.map(([k, label]) => html`<${Stars} key=${k} label=${label} value=${ratings[k] || 0} onChange=${(n) => setRatings((r) => ({ ...r, [k]: n }))} />`)}
        <${Field} label="Anything you want to say (optional)"><textarea class="input pay-notebox" value=${note} onInput=${(e) => setNote(e.currentTarget.value)} /><//>
      </div>` : null}
      ${happy === false ? html`<${Field} label="What needs fixing?"><textarea class="input" placeholder="List each thing" value=${items} onInput=${(e) => setItems(e.currentTarget.value)} /><//>` : null}
      ${happy != null ? html`<${Field} label="Sign here with your finger"><${SigPad} onChange=${setSig} /><//>` : null}
    </div>`}
  <//>`;
}

// --------------------------------------------------- after invoicing a share
function ShareSent({ result, title, onDone }) {
  const { outcome, res } = result;
  const good = outcome !== 'unsure';
  const lead = outcome === 'released' ? 'Sent for payment with the whole crew.'
    : outcome === 'saved' ? 'Saved. The crew is paid together, once the whole crew is in.'
    : outcome === 'review' ? 'Your share is saved for the office to check.'
    : 'We could not tell if your share went through. The office needs to check. Do not send it again.';
  return html`<${DoneScreen} bar="Group work order" title=${good ? 'Share invoiced' : 'Do not send it again'} lead=${lead} wait=${!good}
    foot=${html`<${Button} block class="big" onClick=${() => go('/pay', { replace: true })}>Done<//>
      <${Button} kind="line" block onClick=${onDone}>Back to the group work order<//>`}>
    ${good && (res.pay_view || num(res.trade_payable) != null || num(res.gross_earned) != null) ? html`<div class="card"><${PayRows} m=${res} workOrder /></div>
      ${superNote(res) ? html`<p class="t-small">${superNote(res)}</p>` : null}` : null}
    ${good ? html`<p class="t-small t-num">${[res.invoice_number, title].filter(Boolean).join(' · ')}</p>` : html`<p class="t-small">Call the office and tell them your share for ${title} may not have saved. They can see it from their side.</p>`}
  <//>`;
}
