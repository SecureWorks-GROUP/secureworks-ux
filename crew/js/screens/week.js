// The weekly invoice. The week's jobs are already listed with the times saved
// at clock off. Fix anything that is missing, then send. One invoice a week.
import { html, cx, useEffect, useMemo, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, local, invalidate } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtWeek, fmtDay, fmtMoney, fmtHours, hoursBetween, fmtDow, fmtDom } from '../lib/dates.js';
import { verticalOf, jobTitle, VERTICAL_LABEL } from '../lib/model.js';
import {
  buildLines, lineHours, lineAmount, lineProblem, lineSummary, estimate, buildSubmit, pickableDays, invoiceForWeek, sentBackForWeek, helpersTotal
} from '../lib/invoice.js';
import { bookMyself } from '../lib/data.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Sheet, Chip, Tag, Field, Picks, TimeInput, BREAKS, Toggle, SkelRows, Empty, LoadError, toast, openOverlay, ask, buzz, IconButton } from '../ui/kit.js';
import { useInvoices, useHours, loadDraft } from './pay.js';

export function Week({ monday: mondayParam }) {
  const user = useStore((s) => s.user);
  const thisMonday = mondayOf(todayISO());
  const monday = mondayParam && /^\d{4}-\d{2}-\d{2}$/.test(mondayParam) ? mondayOf(mondayParam) : thisMonday;
  const hours = useHours(monday);
  const invoices = useInvoices();
  const wos = useQuery(user.perMetre ? 'wos' : null, () => api('my_work_orders', { mode: 'mine' }), { ttl: 60000 });
  const [draft, setDraftState] = useState(() => loadDraft(monday));
  const setDraft = (fn) => setDraftState((d) => { const next = typeof fn === 'function' ? fn(d) : fn; local.set('week:' + monday, next); return next; });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const list = (invoices.data && invoices.data.invoices) || [];
  const live = invoiceForWeek(list, monday);
  const sentBack = sentBackForWeek(list, monday);
  const data = hours.data;
  const rateEditable = Boolean(data && data.trade_rate_editable === true);
  const lines = useMemo(() => (data ? buildLines(data, draft, { workOrders: (wos.data && wos.data.work_orders) || [], perMetre: user.perMetre }) : []), [data, draft, wos.data]);
  const gstOn = draft.gst == null ? (data && typeof data.gst_on === 'boolean' ? data.gst_on : user.gstDefault) : draft.gst;
  const deduction = data && data.recurring_deduction_week;
  const est = estimate(lines, { gstOn, deduction });
  const ctx = { monday, rateEditable };
  const problems = lines.filter((l) => lineProblem(l, ctx));
  const groupJobs = (data && data.group_route_jobs) || [];
  const byDay = useMemo(() => { const m = new Map(); for (const l of lines) { if (!m.has(l.date)) m.set(l.date, []); m.get(l.date).push(l); } return [...m.entries()]; }, [lines]);

  const patch = (key, change) => setDraft((d) => ({ ...d, edits: { ...d.edits, [key]: { ...(d.edits[key] || {}), ...change } } }));
  const edit = (line) => openOverlay((close) => html`<${LineSheet} line=${line} ctx=${ctx} onClose=${close}
      onSave=${(change) => { if (line.added && change.remove) setDraft((d) => ({ ...d, added: d.added.filter((a) => a.key !== line.key) })); else patch(change.switchKey || line.key, change); }} />`);
  const addLine = (line) => setDraft((d) => ({ ...d, added: [...d.added, line] }));

  const send = async () => {
    if (problems.length || !est.count) return;
    const ok = await ask({ title: `Send your invoice for ${fmtWeek(monday)}?`, body: `About ${fmtMoney(est.pay, { cents: true })} to you. You can send one invoice a week, and you cannot change it after it is sent, so check it is all there.${est.ahead ? ` ${est.ahead === 1 ? 'One job later this week is' : est.ahead + ' jobs later this week are'} not on it. If you work ${est.ahead === 1 ? 'it' : 'them'}, send after that instead, or add ${est.ahead === 1 ? 'it' : 'them'} to next week.` : ''}`, yes: 'Send invoice' });
    if (!ok) return;
    setSending(true);
    const body = buildSubmit(lines, { monday, gstOn, notes: draft.notes, rateEditable });
    try {
      const res = await api('generate_trade_invoice', null, body, { timeout: 45000 });
      if (res && res.already_submitted) throw new ApiError(res.userMessage || 'This week already has an invoice.', { status: 409, code: 'WEEK_ALREADY_INVOICED', body: res });
      if (!res || (res.success !== true && res.ok !== true)) throw new ApiError((res && (res.userMessage || res.error)) || 'The invoice was not saved.', { status: 422, code: res && res.code, body: res });
      local.del('week:' + monday);
      invalidate('invoices'); invalidate('hours'); invalidate('money');
      buzz([14, 60, 14, 60, 30]);
      setResult(res);
    } catch (err) { await sendFailed(err, body); }
    setSending(false);
  };
  const sendFailed = async (err, body) => {
    const code = (err.body && err.body.code) || err.code;
    if (!(err instanceof ApiError) || err.offline || !err.status || err.status >= 500 && !err.refused) {
      // We do not know if it landed. Never send twice: look for it.
      try {
        const again = await api('my_trade_invoices');
        const landed = invoiceForWeek(again.invoices || [], monday);
        invalidate('invoices');
        if (landed) { local.del('week:' + monday); toast('It did go through. Here it is.', { kind: 'ok' }); go('/pay/invoice/' + landed.id, { replace: true }); return; }
        toast('It did not send. Check your signal and press Send again.', { kind: 'bad', ms: 6000 });
      } catch { toast('No signal, so we cannot tell if it sent. Check Pay when you are back in range before sending again.', { kind: 'bad', ms: 8000 }); }
      return;
    }
    if (code === 'WEEK_ALREADY_INVOICED') { invalidate('invoices'); toast('This week already has an invoice, so this one was not saved.', { kind: 'bad', ms: 6000 }); return; }
    if (code === 'extra_job_not_allowed') {
      const names = (err.body.jobs || []).join(', ');
      const pairs = body.extra_items.filter((x) => x.job_id && (err.body.jobs || []).some((j) => String(j).toLowerCase() === String(x.job_number || x.job_id).toLowerCase())).map((x) => [x.job_id, x.work_date || x.date]);
      if (pairs.length && await ask({ title: `Add yourself to ${names}?`, body: 'You are not booked on it, so the invoice was not sent. Add yourself for the day you worked and it will send. The office will see you added yourself.', yes: 'Add me and send' })) {
        for (const [jobId, d] of pairs) { const r = await bookMyself(jobId, [d]); if (!r.ok) { toast(r.message, { kind: 'bad' }); return; } }
        await hours.refetch(); toast('You are on it now. Check the invoice and press Send again.');
      } else if (!pairs.length) toast(`You are not booked on ${names}. Ask the office to add you, then send again.`, { kind: 'bad', ms: 7000 });
      return;
    }
    if (code === 'work_order_amount_not_agreed') { await hours.refetch(); toast('A work order amount changed at the office. We have read it again: check and send again.', { kind: 'bad', ms: 7000 }); return; }
    if (code === 'RATE_NOT_CONFIGURED') { toast('No pay rate is set for you yet. Call the office to have it set, then send.', { kind: 'bad', ms: 7000 }); return; }
    toast(friendly(err) + ' Nothing was sent.', { kind: 'bad', ms: 7000 });
  };

  if (result) return html`<${Sent} res=${result} monday=${monday} />`;

  const nav = html`<div class="weekpick">
    <div><span class="t-label">${monday === thisMonday ? 'This week' : monday === addDays(thisMonday, -7) ? 'Last week' : 'Week'}</span><h1 class="t-title" style="font-size:30px;margin-top:2px">${fmtWeek(monday)}</h1></div>
    <span><${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => go('/pay/week/' + addDays(monday, -7), { replace: true })} />
      <button type="button" class="iconbtn" aria-label="Later week" disabled=${monday >= thisMonday} style=${monday >= thisMonday ? 'opacity:.25' : ''} onClick=${() => go('/pay/week/' + addDays(monday, 7), { replace: true })}><${Icon} name="right" size=${20} /></button></span>
  </div>`;

  if (live) {
    return html`<${Page} title="Invoice" onBack=${() => back('/pay')}>${nav}
      <${Empty} title="This week is sent" action=${html`<${Button} kind="line" small onClick=${() => go('/pay/invoice/' + live.id)}>See the invoice<//>`}>One invoice a week. If something is wrong with it, call the office and they can send it back to you.<//><//>`;
  }

  return html`<${Page} title=${'Invoice ' + fmtWeek(monday)} onBack=${() => back('/pay')}>
    ${nav}
    ${sentBack ? html`<div class="block note-banner bad" style="margin-top:12px"><${Icon} name="alert" size=${18} /><span><span class="t-strong">The office sent this back.</span> ${sentBack.office_note || 'Check each line, fix what is wrong and send it again.'}</span></div>` : null}
    ${hours.loading ? html`<${SkelRows} n=${3} />` : hours.error && !data ? html`<${LoadError} error=${hours.error} onRetry=${hours.refetch} what="this week" />` : html`
      ${data && data.rate_resolved === false && !rateEditable ? html`<div class="block note-banner" style="margin-top:12px"><${Icon} name="alert" size=${18} /><span>No pay rate is set for you yet. Call the office to have it set before you send.</span></div>` : null}
      ${!lines.length && !groupJobs.length ? html`<${Empty} title="Nothing on this week yet">Jobs you were booked on show here by themselves. Worked somewhere that is missing? Add the job.<//>` : null}
      <div class="rise">
      ${byDay.map(([day, items]) => { const hrs = items.reduce((s, l) => s + (l.off || l.ahead ? 0 : lineHours(l) || 0), 0); return html`<section class="daygroup" key=${day}>
        <span class="t-label"><span>${fmtDay(day)}</span><span>${hrs ? fmtHours(Math.round(hrs * 100) / 100) : ''}</span></span>
        ${items.map((l) => html`<${LineRow} key=${l.key} line=${l} ctx=${ctx} onOpen=${() => edit(l)} />`)}
      </section>`; })}
      </div>

      ${groupJobs.length ? html`<section class="daygroup"><span class="t-label"><span>Paid as a crew</span></span>
        ${groupJobs.map((g) => html`<button type="button" class="line" key=${g.job_id} onClick=${() => go('/pay/group/' + g.job_id)}>
          <span><b>${g.site_suburb || g.client_name || g.job_number}</b><span class="how">${g.next_step || 'Paid through the crew work order, not by the hour.'}</span></span><span class="amt" style="color:var(--ink-3)"><${Icon} name="right" size=${18} /></span></button>`)}
      </section>` : null}

      <div class="block btnrow" style="margin-top:18px">
        <${Button} kind="line" icon="plus" onClick=${() => openAddJob({ monday, user, lines, addLine, refetch: hours.refetch })}>Add a job<//>
        <${Button} kind="soft" icon="plus" onClick=${() => openAddOther({ monday, lines, addLine })}>Other item<//>
      </div>

      <section class="block" style="margin-top:26px;display:grid;gap:16px">
        <${Toggle} label="Add GST" hint="Only if you are registered for GST." checked=${gstOn} onChange=${(v) => setDraft((d) => ({ ...d, gst: v }))} />
        <${Field} label="Note for the office (optional)"><textarea class="input" style="min-height:64px" value=${draft.notes || ''} onInput=${(e) => { const v = e.currentTarget.value; setDraft((d) => ({ ...d, notes: v })); }} /><//>
      </section>

      ${est.count ? html`<section class="block inset" style="margin-top:22px"><div class="sumrows">
        <div class="sumrow"><span>Earned${est.hours ? ` (${fmtHours(est.hours)})` : ''}</span><span>${fmtMoney(est.gross, { cents: true })}</span></div>
        <div class="sumrow"><span>Super held (6%)</span><span>-${fmtMoney(est.superHeld, { cents: true })}</span></div>
        ${gstOn ? html`<div class="sumrow"><span>GST</span><span>${fmtMoney(est.gst, { cents: true })}</span></div>` : null}
        ${deduction && deduction.amount ? html`<div class="sumrow"><span>${deduction.label || 'Weekly deduction'}</span><span>${est.takeOff ? '-' + fmtMoney(est.takeOff, { cents: true }) : 'Not taken'}</span></div>` : null}
        <div class="sumrow total"><span>You get about</span><span>${fmtMoney(est.pay, { cents: true })}</span></div>
      </div><p class="t-small t-mute" style="margin-top:10px">An estimate. The office system works out the exact figures when you send. The company pays another 6% super on top.</p></section>` : null}
    `}
    <div class="dock">
      ${problems.length ? html`<p class="t-small" style="text-align:center;color:var(--hi);font-weight:650">${problems.length === 1 ? `${problems[0].title}: ${lineProblem(problems[0], ctx).toLowerCase()}` : `${problems.length} lines still need something`}</p>` : null}
      <${Button} block busy=${sending} disabled=${!est.count || problems.length > 0} onClick=${send}>${est.count && !problems.length ? `Send invoice · ${fmtMoney(est.pay, { cents: true })}` : 'Send invoice'}<//>
    </div>
  <//>`;
}

function LineRow({ line, ctx, onOpen }) {
  const problem = lineProblem(line, ctx);
  const amt = lineAmount(line);
  const h = lineHours(line);
  return html`<button type="button" class=${cx('line', problem && 'todo', line.off && 'off', line.ahead && !line.off && 'ahead')} onClick=${onOpen}>
    <span><b>${line.title}</b>
      <span class="how">${line.off ? 'Left off this invoice' : line.ahead ? 'Not worked yet. It joins the invoice once you have.' : problem || lineSummary(line)}${!line.off && !problem && line.fromSaved ? ' · saved at clock off' : ''}</span>
      ${line.jobNumber ? html`<span class="how t-num" style="font-size:13px;color:var(--ink-3)">${line.jobNumber}${line.added ? ' · added by you' : ''}</span>` : null}</span>
    <span class="amt">${line.off || line.ahead ? '' : problem ? html`<${Icon} name="right" size=${18} />` : html`${fmtMoney(amt, { cents: true })}<small>${line.kind === 'hours' ? `${fmtHours(h)} at ${fmtMoney(line.rate)}` : line.kind === 'work_order' && helpersTotal(line) ? 'after crew' : ''}</small>`}</span>
  </button>`;
}

// ------------------------------------------------------------ line editor
function LineSheet({ line, ctx, onSave, onClose }) {
  const [f, setF] = useState({ date: line.date, start: line.start || '', finish: line.finish || '', breakMin: line.breakMin, rate: line.rate || '', description: line.description || '', justification: line.justification || '', amount: line.amount == null ? '' : line.amount, helpers: line.helpers || [], chargeIds: line.chargeIds || [], off: line.off });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const days = pickableDays(ctx.monday);
  const brkOther = f.breakMin != null && !BREAKS.some(([v]) => v === f.breakMin);
  const [otherBrk, setOtherBrk] = useState(brkOther);
  const h = hoursBetween(f.start, f.finish, f.breakMin || 0);
  const canSwitchToWo = line.kind === 'hours' && (line.mode === 'work_order' || line.mode == null) && !line.added;
  const canSwitchToHours = line.kind !== 'hours' && !line.added && line.mode !== 'group_work_order';
  const canCommission = line.kind !== 'commission' && !line.added && (line.canCommission === true || (line.mode == null && line.canCommission == null));
  const firstCard = line.cardKeys ? line.cardKeys : [line.key];
  const switchTo = (kind, shut) => { firstCard.forEach((k) => onSave({ switchKey: k, kind })); shut(); };
  const save = (shut) => {
    if (line.kind === 'hours') onSave({ date: f.date, start: f.start, finish: f.finish, breakMin: f.breakMin, rate: ctx.rateEditable || line.added ? (f.rate === '' ? '' : Number(f.rate)) : undefined, description: f.description, justification: f.justification, off: f.off });
    else if (line.kind === 'work_order') onSave({ amount: f.amount === '' ? null : Number(f.amount), helpers: f.helpers, chargeIds: f.chargeIds, description: f.description, off: f.off });
    else onSave({ amount: f.amount === '' ? null : Number(f.amount), description: f.description, off: f.off });
    buzz(8); shut();
  };
  const helper = (i, k, v) => set('helpers', f.helpers.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));

  return html`<${Sheet} title=${line.title} sub=${[line.jobNumber, line.client].filter(Boolean).join(' · ')} onClose=${onClose}
    foot=${(shut) => html`<${Button} block onClick=${() => save(shut)}>Save<//>
      ${line.added ? html`<${Button} kind="quiet" block onClick=${() => { onSave({ remove: true }); shut(); }}>Remove this line<//>` : null}`}>
    ${(shut) => html`<div class="stack">
      ${line.kind === 'hours' ? html`
        <${Field} label="Day you worked"><div class="picks">${days.map((d) => html`<button type="button" class="pick" aria-pressed=${String(f.date === d)} onClick=${() => set('date', d)}>${fmtDow(d)} ${fmtDom(d)}</button>`)}</div><//>
        <div class="timegrid"><${TimeInput} label="Started" value=${f.start} onInput=${(v) => set('start', v)} /><${TimeInput} label="Finished" value=${f.finish} onInput=${(v) => set('finish', v)} /></div>
        <${Field} label="Break"><${Picks} value=${otherBrk ? 'other' : f.breakMin} options=${[...BREAKS, ['other', 'Other']]} onChange=${(v) => { if (v === 'other') { setOtherBrk(true); set('breakMin', null); } else { setOtherBrk(false); set('breakMin', v); } }} /><//>
        ${otherBrk ? html`<${Field} label="Break in minutes"><input class="input" type="number" inputmode="numeric" min="0" value=${f.breakMin == null ? '' : f.breakMin} onInput=${(e) => set('breakMin', e.currentTarget.value === '' ? null : Math.max(0, Math.round(Number(e.currentTarget.value))))} /><//>` : null}
        <div class="hoursout"><span class="t-label">Hours</span><b>${isNaN(h) ? '' : fmtHours(h)}</b></div>
        ${line.clocked != null && !line.fromSaved ? html`<p class="t-small t-mute">The clock had you there for ${fmtHours(line.clocked)}.</p>` : null}
        ${ctx.rateEditable || line.added ? html`<${Field} label="Your hourly rate" hint=${line.usualRate && Number(f.rate) > line.usualRate ? `Above your usual ${fmtMoney(line.usualRate)}. The office will check this line before it is paid.` : line.usualRate ? `Your usual rate is ${fmtMoney(line.usualRate)}.` : ''}>
          <input class="input" type="number" inputmode="decimal" min="0" step="0.5" value=${f.rate} onInput=${(e) => set('rate', e.currentTarget.value)} /><//>`
          : html`<div class="sumrow"><span class="t-small">Your rate</span><span>${line.usualRate ? fmtMoney(line.usualRate) + ' an hour' : 'Not set'}</span></div>`}
        <${Field} label=${line.added ? 'What you did' : 'What you did (optional)'}><input class="input" value=${f.description} placeholder="e.g. Set posts, hung gates" onInput=${(e) => set('description', e.currentTarget.value)} /><//>
        ${line.vertical === 'makesafe' && h > 2 ? html`<${Field} label="Why it took over 2 hours (optional)"><input class="input" value=${f.justification} onInput=${(e) => set('justification', e.currentTarget.value)} /><//>` : null}
      ` : line.kind === 'work_order' ? html`
        ${line.amountLocked ? html`<div class="hoursout"><span class="t-label">${line.woNumber ? 'Work order ' + line.woNumber : 'Agreed amount'}</span><b>${fmtMoney(line.amount, { cents: true })}</b></div><p class="t-small t-mute">This amount is set with the office. Take off anything you paid other crew out of it.</p>`
          : html`<${Field} label="Work order amount (before GST)"><input class="input big" type="number" inputmode="decimal" min="0" value=${f.amount} onInput=${(e) => set('amount', e.currentTarget.value)} placeholder="$" /><//>`}
        ${(line.charges || []).length ? html`<${Field} label="Crew already billed on this job">
          <div class="stack tight">${line.charges.map((c) => html`<${Toggle} label=${c.trade_name + ' ' + fmtMoney(Math.abs(c.amount_ex), { cents: true })} hint=${c.description || 'Take this off my work order'} checked=${f.chargeIds.includes(c.line_id)} onChange=${(on) => set('chargeIds', on ? [...f.chargeIds, c.line_id] : f.chargeIds.filter((x) => x !== c.line_id))} />`)}</div><//>` : null}
        <${Field} label="Helpers you pay from this job">
          <div class="stack tight">${f.helpers.map((hp, i) => html`<div style="display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:6px;align-items:center">
            <input class="input" placeholder="Name" value=${hp.name || ''} onInput=${(e) => helper(i, 'name', e.currentTarget.value)} />
            <input class="input" type="number" inputmode="decimal" placeholder="Hours" value=${hp.hours || ''} onInput=${(e) => helper(i, 'hours', e.currentTarget.value)} />
            <input class="input" type="number" inputmode="decimal" placeholder="Rate" value=${hp.rate || ''} onInput=${(e) => helper(i, 'rate', e.currentTarget.value)} />
            <${IconButton} name="trash" label="Remove helper" size=${18} onClick=${() => set('helpers', f.helpers.filter((_, idx) => idx !== i))} /></div>`)}
            <${Button} kind="soft" small icon="plus" onClick=${() => set('helpers', [...f.helpers, { name: '', hours: '', rate: '' }])}>Add a helper<//></div><//>
        <${Field} label="Note (optional)"><input class="input" value=${f.description} onInput=${(e) => set('description', e.currentTarget.value)} /><//>
      ` : html`
        <${Field} label=${line.kind === 'commission' ? 'Commission amount (before GST)' : 'Amount (before GST)'}><input class="input big" type="number" inputmode="decimal" min="0" value=${f.amount} onInput=${(e) => set('amount', e.currentTarget.value)} placeholder="$" /><//>
        ${line.kind !== 'commission' ? html`<${Field} label="What it is for"><input class="input" value=${f.description} onInput=${(e) => set('description', e.currentTarget.value)} /><//>` : null}
      `}
      ${line.added ? null : html`<${Toggle} label="Leave this off the invoice" hint="For a day you were booked but did not work." checked=${f.off} onChange=${(v) => set('off', v)} />`}
      ${canSwitchToWo || canSwitchToHours || canCommission ? html`<div class="stack tight" style="padding-top:6px;box-shadow:inset 0 1px 0 var(--line)">
        <span class="t-label" style="padding-top:12px">Paid a different way on this job?</span>
        ${canSwitchToWo ? html`<${Button} kind="soft" small onClick=${() => switchTo('work_order', shut)}>Bill it as a work order<//>` : null}
        ${canSwitchToHours ? html`<${Button} kind="soft" small onClick=${() => switchTo('hours', shut)}>Bill by the hour instead<//>` : null}
        ${canCommission ? html`<${Button} kind="soft" small onClick=${() => switchTo('commission', shut)}>Claim commission instead<//>` : null}
      </div>` : null}
    </div>`}
  <//>`;
}

// ------------------------------------------------------------- add a job
function openAddJob(props) { openOverlay((close) => html`<${AddJobSheet} ...${props} onClose=${close} />`); }
function AddJobSheet({ monday, user, lines, addLine, refetch, onClose }) {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  const [job, setJob] = useState(null); const [day, setDay] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 280); return () => clearTimeout(id); }, [q]);
  const search = useQuery(term.length >= 2 ? 'search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const results = ((search.data && search.data.jobs) || []).slice(0, 12);
  const days = pickableDays(monday);
  const grant = user.details && user.details.invoiceAnyJob === true;

  const add = async (shut) => {
    if (lines.some((l) => l.jobId === job.id && l.date === day && l.kind === 'hours')) { toast('That job is already on that day.'); return; }
    setBusy(true);
    if (grant) {
      addLine({ key: 'add:' + Date.now(), kind: 'hours', jobId: job.id, jobNumber: job.job_number || '', title: jobTitle(job), client: job.client_name || '', vertical: verticalOf(job), jobType: job.type || '', date: day, start: '', finish: '', breakMin: null, description: '', mode: null, canCommission: null });
      setBusy(false); shut(); return;
    }
    const r = await bookMyself(job.id, [day]);
    if (!r.ok) { setBusy(false); toast(r.message, { kind: 'bad', ms: 6000 }); return; }
    await refetch();
    setBusy(false); buzz(10);
    toast(`${jobTitle(job)} added for ${fmtDay(day)}. Tap it to put in your times.`, { kind: 'ok', ms: 4500 });
    shut();
  };

  return html`<${Sheet} title=${job ? 'Which day?' : 'Add a job you worked on'} sub=${job ? jobTitle(job) : ''} onClose=${onClose} tall=${!job}
    foot=${job ? (shut) => html`<${Button} block busy=${busy} disabled=${!day} onClick=${() => add(shut)}>Add to this invoice<//><${Button} kind="quiet" block onClick=${() => { setJob(null); setDay(null); }}>Pick a different job<//>` : null}>
    ${job ? html`<div class="stack">
      <div class="daypicks">${days.map((d) => html`<button type="button" class="daypick" aria-pressed=${String(day === d)} onClick=${() => setDay(d)}><span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span></button>`)}</div>
      ${grant ? null : html`<p class="t-small t-mute">This puts you on the job for that day, so the office can see you were there.</p>`}
    </div>` : html`<div class="stack">
      <div class="search"><${Icon} name="jobs" size=${20} /><input class="input" type="search" autofocus placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${term.length < 2 ? html`<p class="t-small t-mute">Search for the job. Finished jobs show too.</p>`
        : search.loading ? html`<${SkelRows} n=${3} />` : !results.length ? html`<${Empty} title="No job found">Try the suburb or the job number. If it still does not show, ask the office.<//>`
        : html`<div class="list ruled" style="margin:0 calc(-1 * var(--gut))">${results.map((j) => html`<button type="button" class="row" key=${j.id} onClick=${() => { setJob(j); buzz(6); }}>
            <span class="main" style="grid-column:1 / span 2"><b>${jobTitle(j)}</b><span>${[j.client_name, j.job_number].filter(Boolean).join(' · ')}</span><span style="display:block;margin-top:6px"><${Tag} vertical=${verticalOf(j)} /></span></span><span class="trail"><${Icon} name="right" size=${18} /></span></button>`)}</div>`}
    </div>`}
  <//>`;
}

function openAddOther(props) { openOverlay((close) => html`<${AddOtherSheet} ...${props} onClose=${close} />`); }
function AddOtherSheet({ monday, lines, addLine, onClose }) {
  const jobs = useMemo(() => { const m = new Map(); lines.forEach((l) => { if (l.jobId && !m.has(l.jobId)) m.set(l.jobId, l); }); return [...m.values()]; }, [lines]);
  const [type, setType] = useState('Travel'); const [jobId, setJobId] = useState(jobs[0] ? jobs[0].jobId : null);
  const [amount, setAmount] = useState(''); const [desc, setDesc] = useState('');
  const days = pickableDays(monday);
  const ok = jobId && Number(amount) > 0 && desc.trim();
  const add = (shut) => {
    const j = jobs.find((x) => x.jobId === jobId);
    addLine({ key: 'add:' + Date.now(), kind: 'other', type, jobId: j.jobId, jobNumber: j.jobNumber, title: j.title, client: j.client, vertical: j.vertical, jobType: j.jobType, date: j.date <= days[days.length - 1] ? j.date : days[days.length - 1], amount: Number(amount), description: desc.trim() });
    shut();
  };
  return html`<${Sheet} title="Add something else" sub="Travel, materials you paid for, or another agreed amount." onClose=${onClose} foot=${(shut) => html`<${Button} block disabled=${!ok} onClick=${() => add(shut)}>Add to this invoice<//>`}>
    ${!jobs.length ? html`<${Empty} title="Add the job first">An extra amount has to go against a job. Add the job to this week, then add the extra.<//>` : html`<div class="stack">
      <${Field} label="What is it?"><${Picks} value=${type} options=${[['Travel', 'Travel'], ['Materials', 'Materials'], ['Equipment', 'Equipment'], ['Other', 'Other']]} onChange=${setType} /><//>
      <${Field} label="Which job?"><div class="picks">${jobs.map((j) => html`<button type="button" class="pick" aria-pressed=${String(jobId === j.jobId)} onClick=${() => setJobId(j.jobId)}>${j.title}</button>`)}</div><//>
      <${Field} label="Amount (before GST)"><input class="input big" type="number" inputmode="decimal" min="0" value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} placeholder="$" /><//>
      <${Field} label="What it is for"><input class="input" value=${desc} onInput=${(e) => setDesc(e.currentTarget.value)} placeholder=${type === 'Travel' ? 'e.g. 84 km to site and back' : 'A few words'} /><//>
      <p class="t-small t-mute">The office checks extra amounts before they are paid. Got a receipt? Use Add receipt on the Pay screen instead.</p>
    </div>`}
  <//>`;
}

// ------------------------------------------------------------------ sent
function Sent({ res, monday }) {
  const held = res.office_review === 'held' || res.code === 'lines_awaiting_office_review';
  const xeroLater = res.code === 'XERO_PUSH_FAILED';
  const pay = res.trade_payable != null ? res.trade_payable : res.amount_payable != null ? res.amount_payable : res.net_pay;
  const gst = res.gst != null ? res.gst : res.gst_amount;
  const ded = res.recurring_deduction;
  const dedNote = res.recurring_deduction_week && res.recurring_deduction_week.note;
  return html`<main class="page enter-push page-pad" style="display:grid;align-content:start;gap:22px;padding-top:calc(var(--safe-t) + 56px)">
    <div class="done-mark"><${Icon} name="check" size=${44} stroke=${3} /></div>
    <div><h1 class="t-display">Invoice sent</h1>
      <p style="margin-top:10px;color:var(--ink-2)">${held ? 'The office is checking a line on it. You are paid once they approve it.' : xeroLater ? 'It is saved. The office will finish sending it to the bookkeeper. You do not need to do anything.' : 'It is with the bookkeeper. You are paid on the usual pay run.'}</p></div>
    <section class="inset"><div class="sumrows">
      ${res.gross_earned != null ? html`<div class="sumrow"><span>Earned${res.total_hours ? ` (${fmtHours(res.total_hours)})` : ''}</span><span>${fmtMoney(res.gross_earned, { cents: true })}</span></div>` : null}
      ${res.worker_withhold != null ? html`<div class="sumrow"><span>Super held from you</span><span>-${fmtMoney(res.worker_withhold, { cents: true })}</span></div>` : null}
      ${gst ? html`<div class="sumrow"><span>GST</span><span>${fmtMoney(gst, { cents: true })}</span></div>` : null}
      ${ded ? html`<div class="sumrow"><span>${ded.label}</span><span>-${fmtMoney(ded.amount, { cents: true })}</span></div>` : null}
      <div class="sumrow total"><span>You get paid</span><span>${pay != null ? fmtMoney(pay, { cents: true }) : 'See invoice'}</span></div>
    </div>
    ${res.super_amount != null ? html`<p class="t-small t-mute" style="margin-top:10px">${fmtMoney(res.super_amount, { cents: true })} goes to your super in total (yours plus the company's share).</p>` : null}
    ${dedNote ? html`<p class="t-small" style="margin-top:8px">${dedNote}</p>` : null}</section>
    ${(res.wo_labour_payouts || []).map((p) => html`<p class="t-small">${fmtMoney(p.total_ex, { cents: true })} for ${p.name} was taken off your invoice. They bill SecureWorks themselves.</p>`)}
    <p class="t-small t-mute t-num">${res.invoice_number || ''} · ${fmtWeek(monday)}</p>
    <${Button} block onClick=${() => go('/pay', { replace: true })}>Done<//>
  </main>`;
}
