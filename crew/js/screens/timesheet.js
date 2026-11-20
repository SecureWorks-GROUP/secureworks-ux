// The timesheet: which job, which day, start and finish. It is the record the
// week's invoice is made from. The week's jobs are already listed with the
// times saved at clock off; fix what is missing, then review the invoice.
// The draft is kept on the trade's account (the same saved weekly draft the
// current Trade App uses) and on this phone for when there is no signal.
import { html, cx, useCallback, useEffect, useMemo, useRef, useState } from '../lib/h.js';
import { api, ApiError, friendly } from '../lib/api.js';
import { useQuery, useStore, local, peekQuery, primeQuery } from '../lib/store.js';
import { go, back } from '../lib/router.js';
import { todayISO, mondayOf, addDays, fmtDay, fmtMoney, hoursBetween, fmtDow, fmtDom } from '../lib/dates.js';
import { verticalOf, jobTitle } from '../lib/model.js';
import {
  buildLines, lineProblem, estimate, pickableDays, invoiceForWeek, sentBackForWeek, invoicePays, readMode,
  draftFromBuilder, builderFromDraft, draftSaveBody, foreignDraftLines, oldAppLines, withoutOldAppLines, UNKNOWN_MODE_WORDS
} from '../lib/invoice.js';
import { receiptsEnabled, receiptProblem, receiptLine } from '../lib/reimbursements.js';
import { bookMyself, useJob } from '../lib/data.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Sheet, StatusBadge, JobLine, KV, Field, Picks, TimeInput, BREAKS, Toggle, SkelRows, Empty, LoadError, toast, openOverlay, buzz, IconButton } from '../ui/kit.js';
import { cash, hrs, plural, weekWords, sheetRows, sheetSummary, DayCell, InvoiceBadge } from '../ui/paybits.js';
import { useInvoices, useHours, loadDraft, useGroupWeek } from './pay.js';

const hasWork = (d) => Object.keys(d.edits || {}).length > 0 || (d.added || []).length > 0 || (d.lumps || []).length > 0 || Boolean(d.notes) || d.gst != null;
const codeOf = (err) => (err && ((err.body && err.body.code) || err.code)) || '';
const draftOff = (err) => { const code = codeOf(err); return err instanceof ApiError && (code === 'running_draft_off' || code === 'operator_access_required' || err.status === 404 || /unknown action|not switched on/i.test(err.message || '')); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AGAIN_WORDS = 'This week changed in another place again, so it was not saved. What you typed is still here. Press Save to try again.';

/**
 * What this person typed, put on top of a fresh copy of the week's draft
 * (first open, a draft replaced elsewhere, agent lines the server put back).
 * Their edits win key by key, lines only one side has are kept, and lines
 * named in `gone` (removed here) stay off.
 */
function onTop(theirs, mine, gone = { added: [], lumps: [] }) {
  const edits = { ...theirs.edits };
  for (const [k, e] of Object.entries(mine.edits || {})) edits[k] = { ...(theirs.edits[k] || {}), ...e };
  const theirKeys = new Set(theirs.added.map((a) => a.key));
  const myLumps = new Set((mine.lumps || []).map((l) => l.id));
  return { ...theirs, edits,
    added: [...theirs.added.filter((a) => !gone.added.includes(a.key)), ...(mine.added || []).filter((a) => !theirKeys.has(a.key))],
    lumps: [...theirs.lumps.filter((l) => !myLumps.has(l.id) && !gone.lumps.includes(l.id)), ...(mine.lumps || [])],
    gst: mine.gst == null ? theirs.gst : mine.gst, notes: mine.notes || theirs.notes };
}
/** What changed on this phone between two copies of its draft: typing done while a save was out. */
function typedSince(was, now) {
  const edits = {};
  for (const [k, e] of Object.entries(now.edits || {})) if (!same(e, (was.edits || {})[k])) edits[k] = e;
  const had = new Set(was.added.map((a) => a.key)); const has = new Set(now.added.map((a) => a.key));
  const hadLumps = new Map(was.lumps.map((l) => [l.id, l])); const hasLumps = new Set(now.lumps.map((l) => l.id));
  return {
    typed: { edits, added: now.added.filter((a) => !had.has(a.key)), lumps: now.lumps.filter((l) => !same(l, hadLumps.get(l.id))), gst: now.gst === was.gst ? null : now.gst, notes: now.notes === was.notes ? '' : now.notes },
    gone: { added: [...had].filter((k) => !has.has(k)), lumps: [...hadLumps.keys()].filter((id) => !hasLumps.has(id)) }
  };
}

/**
 * One pay week: the server's hours, the trade's draft, the lines made from
 * them, and the saved weekly draft kept in step. Shared by the timesheet and
 * the invoice made from it.
 */
export function useWeek(mondayParam, expenses) {
  const user = useStore((s) => s.user);
  const thisMonday = mondayOf(todayISO());
  const monday = mondayParam && /^\d{4}-\d{2}-\d{2}$/.test(mondayParam) ? mondayOf(mondayParam) : thisMonday;
  const hours = useHours(monday);
  const invoices = useInvoices();
  const wos = useQuery(user.perMetre ? 'wos' : null, () => api('my_work_orders', { mode: 'mine' }), { ttl: 60000 });
  const [draft, setDraftState] = useState(() => loadDraft(monday));
  const draftRef = useRef(draft);
  const [sync, setSync] = useState({ state: '', words: '' });
  const stop = useRef(false); const saving = useRef(null); const didRead = useRef(false);
  // Stale: agent lines came back on a save and the re-read failed, so the next
  // save reads the week first. (A held week is `draft.held`: see holdWith.)
  const stale = useRef(false);

  const list = (invoices.data && invoices.data.invoices) || [];
  const live = invoiceForWeek(list, monday);
  const sentBack = sentBackForWeek(list, monday);
  const data = hours.data;
  // The review already reads Expenses. The week only peeks at that cache;
  // opening either screen must add no request with reimbursements off.
  const cachedExpenses = expenses ? (!expenses.error && !expenses.loading && !expenses.refreshing ? expenses.data : null) : peekQuery('expenses');
  const receiptRows = data?.money?.super_basis === 'inclusive_12_112_v1' ? cachedExpenses?.expenses : null;
  const reimbursementsOn = receiptsEnabled(receiptRows);
  const rateEditable = Boolean(data && data.trade_rate_editable === true);
  const serverOn = Boolean(data && data.running_invoice_draft === true);

  // Jobs the trade added themselves: how each is billed is asked of the server, never kept from a draft.
  const addedIds = [...new Set(draft.added.filter((a) => a.kind !== 'other' && a.kind !== 'reimbursement' && a.jobId).map((a) => String(a.jobId)))].sort().join(',');
  const modesQ = useQuery(addedIds ? 'jobmodes:' + addedIds : null, () => api('trade_invoice_job_modes', { job_ids: addedIds }), { ttl: 60000 });
  const jobModes = useMemo(() => {
    if (!addedIds) return {};
    if (!modesQ.data || !Array.isArray(modesQ.data.jobs)) return null;
    return Object.fromEntries(modesQ.data.jobs.map((r) => [String(r.job_id), r]));
  }, [modesQ.data, addedIds]);
  // A save builds its lines from the draft it sends, never from the last render:
  // a draft just merged from a re-read has not been drawn yet.
  const linesFor = (dr) => {
    if (!data) return [];
    const built = buildLines(data, dr, { workOrders: (wos.data && wos.data.work_orders) || [], perMetre: user.perMetre, jobModes, receiptRows, userId: user.id });
    return modesQ.error && !jobModes ? built.map((l) => (l.unknown && l.added ? { ...l, modePending: false, modeFailed: true } : l)) : built;
  };
  const lines = useMemo(() => linesFor(draft), [data, draft, wos.data, jobModes, modesQ.error, receiptRows]);
  const groups = useGroupWeek(data);
  const gstFor = (dr) => (dr.gst == null ? (data && typeof data.gst_on === 'boolean' ? data.gst_on : user.gstDefault) : dr.gst);
  const gstOn = gstFor(draft);
  const deduction = data && data.recurring_deduction_week;
  const est = estimate(lines, { gstOn, deduction, basis: data && data.money && data.money.super_basis });
  const ctx = { monday, rateEditable, userId: user.id };
  const problems = lines.filter((l) => lineProblem(l, ctx));
  const latest = useRef({}); latest.current = { data, serverOn, linesFor, gstFor };

  const commit = (next) => { draftRef.current = next; local.set('week:' + monday, next); setDraftState(next); };
  const setDraft = (fn) => commit({ ...(typeof fn === 'function' ? fn(draftRef.current) : fn), dirty: true, savedAt: Date.now() });

  // ---- the saved weekly draft: read when the week opens ----
  /** The week's draft as the account holds it now, in this app's shape. Throws on a failed read. */
  const fetchWeek = async () => {
    const res = await api('get_running_invoice_draft', { week_start: monday });
    const builder = res && res.draft_builder && Array.isArray(res.draft_builder.jobCards) ? res.draft_builder : null;
    const draftId = (res && (res.current_draft_id || res.draft_id)) || null;
    return { draftId, theirs: builder ? { ...draftFromBuilder(builder, latest.current.data), base: builder, serverHash: JSON.stringify(builder), draftId, foreign: foreignDraftLines(builder), dirty: false } : null };
  };
  const read = useCallback(async () => {
    let got;
    try { got = await fetchWeek(); } catch (err) {
      if (draftOff(err)) { stop.current = true; setSync({ state: 'off', words: '' }); } else if (err instanceof ApiError && err.refused) { stop.current = true; setSync({ state: 'refused', words: friendly(err) }); } else setSync({ state: 'phone', words: '' });
      return;
    }
    const { draftId, theirs } = got;
    const mine = draftRef.current;
    if (!theirs) { commit({ ...mine, base: null, serverHash: '', draftId, foreign: 0, dirty: hasWork(mine) }); return; }
    // Typing that never reached the account's copy: never saved, refused as replaced, or saved
    // while agent lines came back and the week could not be read again. Keep it on top.
    const unsynced = mine.serverHash === undefined || mine.serverHash === 'replaced' || mine.serverHash === 'stale' || mine.held;
    if (unsynced && hasWork(mine)) commit({ ...onTop(theirs, mine), held: mine.held, dirty: true, savedAt: Date.now() });
    else if (mine.serverHash === theirs.serverHash) commit({ ...mine, draftId, foreign: theirs.foreign });
    else {
      // The account's copy is newer than this phone's: it wins.
      if (mine.dirty && hasWork(mine)) toast('This week was changed in another place. Showing the saved version.', { ms: 5000 });
      commit(theirs);
    }
    setSync({ state: 'ok', words: '' });
  }, [monday]);
  useEffect(() => {
    if (!data || !serverOn || live || didRead.current) return;
    didRead.current = true; read();
  }, [Boolean(data), serverOn, Boolean(live)]);

  // ---- and written when the trade changes it ----
  /** Autosave stops until the person presses Save. */
  const holdWith = (words) => {
    commit({ ...draftRef.current, held: true, dirty: true });
    setSync({ state: 'held', words });
    toast(words, { kind: 'bad', ms: 6500 });
  };
  /**
   * The week read again before the next save goes out. `replaced`: this phone's
   * copy was refused as replaced, so all of its typing goes on top of the fresh
   * draft. `was`: the save just made is on the account (with agent lines the
   * server put back), so only typing done since that save goes on top.
   * Returns false when nothing may be saved now.
   */
  const refresh = async ({ replaced = false, was = null, hint = null } = {}) => {
    let got;
    try { got = await fetchWeek(); } catch (err) {
      if (replaced) holdWith('This week was changed in another place and could not be read again. What you typed is still on this phone. Press Save to try again.');
      else { stale.current = true; commit({ ...draftRef.current, serverHash: 'stale' }); setSync({ state: 'phone', words: '' }); }
      return false;
    }
    const draftId = got.draftId || hint || null;
    if (replaced && !draftId) {
      // The week holds no draft now: it may have been sent from another place.
      let list;
      try { list = await api('my_trade_invoices'); } catch (err) { holdWith('This week was changed in another place and could not be checked. What you typed is still on this phone. Press Save to try again.'); return false; }
      if (invoiceForWeek((list && list.invoices) || [], monday)) {
        stop.current = true;
        primeQuery('invoices', list, { persist: true });
        toast('This week was already sent from another place, so these changes were not saved.', { kind: 'bad', ms: 6500 });
        return false;
      }
    }
    const mine = draftRef.current;
    let next;
    if (!got.theirs) next = { ...mine, base: null, serverHash: '', draftId, foreign: 0, dirty: true };
    else if (!was) next = { ...onTop({ ...got.theirs, draftId }, mine), dirty: true, savedAt: Date.now() };
    else if (mine.savedAt === was.savedAt) next = { ...got.theirs, draftId };
    else { const { typed, gone } = typedSince(was, mine); next = { ...onTop({ ...got.theirs, draftId }, typed, gone), dirty: true, savedAt: Date.now() }; }
    stale.current = false;
    commit({ ...next, held: false });
    return true;
  };
  const save = useCallback(async ({ press = false } = {}) => {
    while (saving.current) await saving.current;
    const first = draftRef.current; const { data: d, serverOn: on } = latest.current;
    if (!d || !on || stop.current || first.serverHash === undefined) return !first.dirty;
    if (first.held && !press) return false;
    if (!first.dirty && !first.held && !stale.current) return true;
    const run = (async () => {
      // A pressed Save on a held week reads it again first, and that counts as the one retry.
      let retried = Boolean(first.held);
      if ((first.held || stale.current) && !(await refresh({ replaced: Boolean(first.held) }))) return false;
      for (;;) {
        const cur = draftRef.current; const stamp = cur.savedAt; const L = latest.current;
        const snap = builderFromDraft(L.data, cur, L.linesFor(cur), { monday, gstOn: L.gstFor(cur) });
        let res;
        try { res = await api('save_running_invoice_draft', null, draftSaveBody(snap, cur.draftId)); } catch (err) {
          if (codeOf(err) === 'draft_replaced') {
            // The id this phone holds is no longer the week's draft: drop it here and in the phone copy,
            // read the week again (no other save goes out meanwhile) and save once more under the fresh id.
            commit({ ...draftRef.current, draftId: null, serverHash: 'replaced' });
            if (retried) { holdWith(AGAIN_WORDS); return false; }
            retried = true;
            if (!(await refresh({ replaced: true, hint: (err.body && err.body.current_draft_id) || null }))) return false;
            continue;
          }
          if (draftOff(err)) { stop.current = true; setSync({ state: 'off', words: '' }); return false; }
          if (err instanceof ApiError && err.refused) { stop.current = true; setSync({ state: 'refused', words: friendly(err) }); toast(friendly(err) + ' Your draft is still on this phone.', { kind: 'bad', ms: 6500 }); return false; }
          setSync({ state: 'phone', words: '' });
          return false;
        }
        const now = draftRef.current; const saved = (res && res.draft_builder) || snap;
        commit({ ...now, base: saved, serverHash: JSON.stringify(saved), draftId: (res && res.draft_id) || now.draftId, dirty: now.savedAt !== stamp, held: false });
        // Agent lines the server put back because this phone's copy did not have them. The next
        // save names the draft and would drop them, so read the week before any further save.
        const restored = res && Array.isArray(res.restored_agent_keys) ? res.restored_agent_keys : [];
        if (restored.length && !(await refresh({ was: cur }))) return false;
        setSync({ state: 'ok', words: '' });
        return true;
      }
    })().catch(() => { setSync({ state: 'phone', words: '' }); return false; });
    saving.current = run.finally(() => { saving.current = null; });
    return run;
  }, [monday]);
  useEffect(() => {
    if (!draft.dirty || draft.held || !serverOn || draft.serverHash === undefined) return undefined;
    const t = setTimeout(() => save(), 2500);
    return () => clearTimeout(t);
  }, [draft.savedAt, draft.dirty, draft.held, draft.serverHash, serverOn]);
  // Leaving the screen: send what is not saved yet.
  useEffect(() => () => { save(); }, []);
  useEffect(() => { const fn = () => { if (draftRef.current.dirty) save(); }; window.addEventListener('online', fn); return () => window.removeEventListener('online', fn); }, []);

  const syncWords = !data || live ? '' : !serverOn || sync.state === 'off' ? 'Your draft is kept on this phone.'
    : sync.state === 'refused' ? `${sync.words} Your draft is kept on this phone.`
    : draft.held ? (sync.state === 'held' && sync.words) || AGAIN_WORDS
    : sync.state === 'phone' ? 'No signal. Your draft is kept on this phone and saved when you are back in range.'
    : draft.dirty ? 'Saving your draft.' : draft.serverHash ? 'Draft saved to your account. Not sent.' : '';

  const patch = (key, change) => setDraft((d) => ({ ...d, edits: { ...d.edits, [key]: { ...(d.edits[key] || {}), ...change } } }));
  const addLine = (line) => setDraft((d) => ({ ...d, added: [...d.added, line] }));
  const edit = (line) => {
    if (line.kind === 'reimbursement') {
      openOverlay((close) => html`<${Sheet} title="Reimbursement (receipt)" onClose=${close} foot=${(shut) => html`<${Button} kind="line" block onClick=${() => { setDraft((d) => ({ ...d, added: d.added.filter((a) => a.key !== line.key) })); shut(); }}>Remove from this invoice<//>`}>
        <p>${line.description || 'Receipt'}</p><p>${line.receiptProblem || cash(line.amount)}</p>
        <p class="t-small">The amount comes from the receipt. Check it under Expenses if it needs changing.</p>
        <${Button} kind="line" block onClick=${async () => {
          try {
            const fresh = await api('list_expenses', { limit: 100 });
            primeQuery('expenses', fresh, { persist: true });
            setDraftState({ ...draftRef.current }); close();
          } catch (err) { toast(friendly(err) + ' Try again when you have signal, or remove this receipt.', { kind: 'bad' }); }
        }}>Check receipt again<//>
      <//>`); return;
    }
    if (line.unknown) { openOverlay((close) => html`<${UnknownSheet} line=${line} onClose=${close} onRemove=${line.added ? () => setDraft((d) => ({ ...d, added: d.added.filter((a) => a.key !== line.key) })) : null} />`); return; }
    openOverlay((close) => html`<${LineSheet} line=${line} ctx=${ctx} onClose=${close}
      onSave=${(change) => {
        if (change.remove && line.kind === 'deduction') setDraft((d) => ({ ...d, lumps: d.lumps.filter((x) => x.id !== line.lumpId) }));
        else if (line.kind === 'deduction') setDraft((d) => ({ ...d, lumps: d.lumps.map((x) => (x.id === line.lumpId ? { ...x, amount: change.amount, description: change.description } : x)) }));
        else if (line.added && change.remove) setDraft((d) => ({ ...d, added: d.added.filter((a) => a.key !== line.key) }));
        else patch(change.switchKey || line.key, change);
      }} />`);
  };
  /** After the invoice is sent: the draft is done with, here and on the account. */
  const sent = () => {
    stop.current = true;
    const id = draftRef.current.draftId;
    local.del('week:' + monday);
    if (id && latest.current.serverOn) api('delete_trade_invoice', null, { invoice_id: id }).catch(() => {});
  };
  // Lines typed in the old app that this app cannot bill: taken out of the saved draft on the trade's word.
  const removeOldLines = () => setDraft((d) => ({ ...d, base: withoutOldAppLines(d.base), foreign: 0 }));
  return { user, monday, thisMonday, hours, data, receiptRows, reimbursementsOn, invoices, live, sentBack, draft, setDraft, lines, groups, gstOn, deduction, est, ctx, problems, rateEditable, edit, addLine, flush: () => save({ press: true }), held: Boolean(draft.held), sent, syncWords, foreign: draft.foreign || 0, oldLines: draft.foreign ? oldAppLines(draft.base) : [], removeOldLines };
}

/**
 * Lines on this week that were typed in the old app and cannot be billed from
 * here. Each is said in words, with one press to take them off, so a week is
 * never stuck. The trade adds them again here (Add job, Add another item).
 */
export function OldLinesNote({ w }) {
  if (!w.foreign) return null;
  const many = w.foreign !== 1;
  return html`<div class="block note-banner pay-gap" data-old-lines><div class="stack tight">
    <span><span class="t-strong">${plural(w.foreign, 'line')} from the old app cannot be sent.</span> Add ${many ? 'them' : 'it'} again here with Add job or Add another item, then remove the old ${many ? 'ones' : 'one'}.</span>
    ${(w.oldLines || []).map((l) => html`<span class="t-small" key=${l.where + l.index}>${l.words || 'A line with no details'}</span>`)}
    <div><${Button} kind="line" small onClick=${() => { w.removeOldLines(); toast(many ? 'Old lines removed.' : 'Old line removed.'); }}>Remove the old ${many ? 'lines' : 'line'}<//></div>
  </div></div>`;
}

/** How the week's draft stands on the account, with Save while autosave is held. */
export function SyncNote({ w }) {
  if (!w.syncWords) return null;
  return html`<p class="block t-small pay-note" role="status">${w.syncWords}</p>
    ${w.held ? html`<div class="block"><${Button} kind="line" small onClick=${() => w.flush()}>Save<//></div>` : null}`;
}

export function Timesheet({ monday: mondayParam }) {
  const w = useWeek(mondayParam);
  const { monday, thisMonday, hours, data, live, sentBack, lines, groups, ctx } = w;
  const [leaving, setLeaving] = useState(false);
  const { rows, ahead } = useMemo(() => sheetRows(lines, groups, ctx), [lines, groups, monday, ctx.rateEditable]);
  const sum = sheetSummary(rows);
  const unknown = lines.filter((l) => l.unknown && !l.ahead).length;

  const review = async () => {
    setLeaving(true);
    // The invoice screen reads the saved draft, so save first (never wait long for it).
    await Promise.race([w.flush(), new Promise((r) => setTimeout(r, 4000))]);
    go('/pay/week/' + monday + '/invoice');
  };
  const weekNav = html`<div class="pay-week">
    <${IconButton} name="back" label="Earlier week" size=${20} onClick=${() => go('/pay/week/' + addDays(monday, -7), { replace: true })} />
    <span class="t-num">Pay week ${weekWords(monday)}</span>
    <button type="button" class="iconbtn" aria-label="Later week" disabled=${monday >= thisMonday} onClick=${() => go('/pay/week/' + addDays(monday, 7), { replace: true })}><${Icon} name="right" size=${20} /></button>
  </div>`;

  if (live) {
    return html`<${Page} title="Timesheet" back="Pay" onBack=${() => back('/pay')} right=${html`<${StatusBadge} status="sent" />`} flush
      foot=${html`<${Button} block class="big" onClick=${() => go('/pay/invoice/' + live.id)}>View invoice<//>`}>
      ${weekNav}
      <div class="block card pay-gap">
        <${KV} k="Invoice" v=${live.invoice_number || 'Sent'} />
        <${KV} k="Status" v=${html`<${InvoiceBadge} inv=${live} />`} />
        ${invoicePays(live) != null ? html`<${KV} k="You are paid" v=${cash(invoicePays(live))} />` : null}
      </div>
      <p class="block t-small pay-note">This pay week is sent. One invoice a week. If something is wrong with it, call the office and they can send it back to you.</p>
    <//>`;
  }

  const empty = !rows.length && !ahead;
  return html`<${Page} title="Timesheet" back="Pay" onBack=${() => back('/pay')} right=${html`<${StatusBadge} status=${sentBack ? 'sent_back' : 'draft'} />`} flush
    foot=${html`<${Button} block class="big" busy=${leaving} disabled=${!data || (!lines.length && !groups.length)} onClick=${review}>Review invoice<//>`}>
    ${weekNav}
    ${sentBack ? html`<div class="block note-banner bad pay-gap"><span><span class="t-strong">The office sent this back.</span> ${sentBack.office_note || 'Check each line, fix what is wrong and send it again.'}</span></div>` : null}
    ${hours.loading ? html`<${SkelRows} n=${3} />` : hours.error && !data ? html`<${LoadError} error=${hours.error} onRetry=${hours.refetch} what="this week" />` : html`
      ${data && data.rate_resolved === false && !w.rateEditable ? html`<div class="block note-banner pay-gap"><span>No pay rate is set for you yet. Call the office to have it set before you send.</span></div>` : null}
      <${OldLinesNote} w=${w} />
      <div class="pay-thead" aria-hidden="true"><span>Day</span><span>Job and time</span><span>Hours</span></div>
      <div class="pay-rows">
        ${rows.map((r) => html`<button type="button" class=${cx('pay-row', r.tone)} key=${r.key} onClick=${() => (r.open === 'group' ? go('/pay/group/' + r.jobId) : w.edit(r.line))}>
          <${DayCell} date=${r.date} />
          <span class="main"><b class="clip">${r.title}</b>
            <span class="pay-time clip">${r.timeText}</span>
            <${JobLine} job=${{ job_number: r.jobNumber }}>${r.type}<//></span>
          <span class="pay-hrs">${r.hours != null ? hrs(r.hours) : ''}</span>
        </button>`)}
        ${empty ? html`<p class="pay-empty">Nothing on this pay week yet. Jobs you were booked on show here by themselves. Worked somewhere that is missing? Add it.</p>` : null}
        <button type="button" class="pay-add" onClick=${() => openAddJob({ monday, user: w.user, lines, addLine: w.addLine, refetch: hours.refetch })}>Add a day or a job</button>
        <div class="pay-total"><span><b>Total recorded</b><span class="sub">${sum.needs || (sum.count ? 'Every day has its times' : 'No days recorded yet')}</span></span><span class="t-figure">${hrs(sum.hours)}</span></div>
      </div>
      ${ahead ? html`<p class="block t-small pay-note">${plural(ahead, 'booked day')} later this week ${ahead === 1 ? 'is' : 'are'} not listed yet. ${ahead === 1 ? 'It shows' : 'They show'} here once worked.</p>` : null}
      ${unknown ? html`<p class="block t-small pay-note">${plural(unknown, 'job')} cannot go on the invoice until the office says how ${unknown === 1 ? 'it is' : 'they are'} billed.</p>` : null}
      <${SyncNote} w=${w} />
    `}
  <//>`;
}

// ------------------------------------------------- a job with no known pay type
function UnknownSheet({ line, onClose, onRemove }) {
  return html`<${Sheet} title=${line.title} onClose=${onClose}
    foot=${(shut) => html`${line.viaGroup ? html`<${Button} block onClick=${() => { shut(); go('/pay/group/' + line.jobId); }}>Open the group work order<//>` : html`<${Button} kind="line" block onClick=${shut}>Close<//>`}
      ${onRemove ? html`<${Button} kind="quiet" block onClick=${() => { onRemove(); shut(); }}>Remove this line<//>` : null}`}>
    <div class="stack">
      <${JobLine} job=${{ job_number: line.jobNumber }} vertical=${line.vertical} />
      <p>${line.viaGroup ? 'This job is paid through a group work order. Your hours go on the group work order, not on this invoice.'
        : line.modeFailed ? 'We could not check how this job is billed. Try again when you have signal. Until then it stays off the invoice.'
        : line.modePending ? 'Checking how this job is billed.'
        : `${UNKNOWN_MODE_WORDS}. The app does not know if it is paid by the hour or as a work order, so it stays off the invoice until the office sorts it out.`}</p>
    </div>
  <//>`;
}

// ------------------------------------------------------------ line editor
function LineSheet({ line, ctx, onSave, onClose }) {
  const [f, setF] = useState({ date: line.date, start: line.start || '', finish: line.finish || '', breakMin: line.breakMin, rate: line.rate || '', description: line.description || '', justification: line.justification || '', amount: line.amount == null ? '' : line.amount, helpers: line.helpers || [], chargeIds: line.chargeIds || [], off: line.off });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const days = pickableDays(ctx.monday);
  const brkOther = f.breakMin != null && !BREAKS.some(([v]) => v === f.breakMin);
  const [otherBrk, setOtherBrk] = useState(brkOther);
  const h = hoursBetween(f.start, f.finish, f.breakMin || 0);
  // The job decides how it is billed. A switch is offered only where the server allows it.
  const canSwitchToWo = line.kind === 'hours' && line.mode === 'work_order' && !line.added;
  const canSwitchToHours = (line.kind === 'work_order' || line.kind === 'commission') && !line.added;
  const canCommission = line.kind !== 'commission' && !line.added && line.canCommission === true;
  const firstCard = line.cardKeys ? line.cardKeys : [line.key];
  const switchTo = (kind, shut) => { firstCard.forEach((k) => onSave({ switchKey: k, kind })); shut(); };
  const simple = line.kind === 'other' || line.kind === 'deduction';
  const save = (shut) => {
    if (line.kind === 'hours') onSave({ date: f.date, start: f.start, finish: f.finish, breakMin: f.breakMin, rate: ctx.rateEditable || line.added ? (f.rate === '' ? '' : Number(f.rate)) : undefined, description: f.description, justification: f.justification, off: f.off });
    else if (line.kind === 'work_order') onSave({ amount: f.amount === '' ? null : Number(f.amount), helpers: f.helpers, chargeIds: f.chargeIds, description: f.description, off: f.off });
    else onSave({ amount: f.amount === '' ? null : Number(f.amount), description: f.description, off: f.off });
    buzz(8); shut();
  };
  const helper = (i, k, v) => set('helpers', f.helpers.map((x, idx) => (idx === i ? { ...x, [k]: v } : x)));
  // Helpers are the people booked on this job, never a typed name.
  const jobQ = useJob(line.kind === 'work_order' && line.jobId ? line.jobId : null);
  const crewNames = [...new Set(((jobQ.data && jobQ.data.crew) || [])
    .filter((c) => c && c.name && String(c.status).toLowerCase() !== 'cancelled' && c.role !== 'observer' && c.user_id !== ctx.userId)
    .map((c) => String(c.name).trim()))];
  const crewKnown = Boolean(jobQ.data);
  const recorded = (line.dayCards || []).reduce((s, d) => s + (d.saved ? hoursBetween(d.saved.start, d.saved.finish, d.saved.breakMin) || 0 : d.clocked || 0), 0);

  return html`<${Sheet} title=${line.title} sub=${line.client || ''} onClose=${onClose}
    foot=${(shut) => html`<${Button} block onClick=${() => save(shut)}>Save<//>
      ${line.added ? html`<${Button} kind="quiet" block onClick=${() => { onSave({ remove: true }); shut(); }}>Remove this line<//>` : null}`}>
    ${(shut) => html`<div class="stack">
      ${line.jobNumber ? html`<${JobLine} job=${{ job_number: line.jobNumber }}>${line.kind === 'hours' ? 'Hourly' : line.kind === 'work_order' ? 'Work order' : line.kind === 'commission' ? 'Commission' : line.type || ''}<//>` : null}
      ${line.kind === 'hours' ? html`
        <${Field} label="Day you worked"><div class="picks">${days.map((d) => html`<button type="button" class="pick" aria-pressed=${String(f.date === d)} onClick=${() => set('date', d)}>${fmtDow(d)} ${fmtDom(d)}</button>`)}</div><//>
        <div class="pay-two"><${TimeInput} label="Started" value=${f.start} onInput=${(v) => set('start', v)} /><${TimeInput} label="Finished" value=${f.finish} onInput=${(v) => set('finish', v)} /></div>
        <${Field} label="Break"><${Picks} value=${otherBrk ? 'other' : f.breakMin} options=${[...BREAKS, ['other', 'Other']]} onChange=${(v) => { if (v === 'other') { setOtherBrk(true); set('breakMin', null); } else { setOtherBrk(false); set('breakMin', v); } }} /><//>
        ${otherBrk ? html`<${Field} label="Break in minutes"><input class="input" type="number" inputmode="numeric" min="0" value=${f.breakMin == null ? '' : f.breakMin} onInput=${(e) => set('breakMin', e.currentTarget.value === '' ? null : Math.max(0, Math.round(Number(e.currentTarget.value))))} /><//>` : null}
        <div class="card pay-out"><span class="t-cap">Hours</span><b class="t-figure">${isNaN(h) ? '' : hrs(h)}</b></div>
        ${line.fromSaved ? html`<p class="t-small">These times were saved when you clocked off. Change them if they are not right.</p>` : line.clocked != null ? html`<p class="t-small">The clock had you there for ${hrs(line.clocked)}.</p>` : null}
        ${ctx.rateEditable || line.added ? html`<${Field} label="Your hourly rate" hint=${line.usualRate && Number(f.rate) > line.usualRate ? `Above your office rate of ${fmtMoney(line.usualRate)}. The office checks it before it is paid.` : line.usualRate ? `Your office rate is ${fmtMoney(line.usualRate)}. Change it for this job if you need to.` : ''}>
          <input class="input" type="number" inputmode="decimal" min="0" step="0.5" value=${f.rate} onInput=${(e) => set('rate', e.currentTarget.value)} /><//>`
          : html`<div class="card"><${KV} k="Your rate" v=${line.usualRate ? fmtMoney(line.usualRate) + ' an hour' : 'Not set'} /></div>`}
        <${Field} label=${line.added ? 'What you did' : 'What you did (optional)'}><input class="input" value=${f.description} placeholder="e.g. Set posts, hung gates" onInput=${(e) => set('description', e.currentTarget.value)} /><//>
        ${line.vertical === 'makesafe' && h > 2 ? html`<${Field} label="Why it took over 2 hours (optional)"><input class="input" value=${f.justification} onInput=${(e) => set('justification', e.currentTarget.value)} /><//>` : null}
      ` : line.kind === 'work_order' ? html`
        ${line.amountLocked ? html`<div class="card pay-out"><span class="t-cap">${line.woNumber ? 'Work order ' + line.woNumber : 'Agreed amount'}</span><b class="t-figure">${cash(line.amount)}</b></div><p class="t-small">This amount is set with the office. Add the crew you pay from this job as helpers below.</p>`
          : html`<${Field} label="Work order amount (before GST)"><input class="input big" type="number" inputmode="decimal" min="0" value=${f.amount} onInput=${(e) => set('amount', e.currentTarget.value)} placeholder="$" /><//>`}
        ${recorded > 0 ? html`<p class="t-small">${hrs(recorded)} recorded on this job this week. The hours are a record only. The pay is the work order amount.</p>` : null}
        ${(line.charges || []).length ? html`<${Field} label="Crew already billed on this job">
          <div class="stack tight">${line.charges.map((c) => html`<${Toggle} label=${c.trade_name + ' ' + cash(Math.abs(c.amount_ex))} hint=${c.description || 'Crew paid separately'} checked=${f.chargeIds.includes(c.line_id)} onChange=${(on) => set('chargeIds', on ? [...f.chargeIds, c.line_id] : f.chargeIds.filter((x) => x !== c.line_id))} />`)}</div><//>` : null}
        <${Field} label="Helpers you pay from this job">
          <div class="stack tight">${f.helpers.map((hp, i) => html`<div class="pay-helper">
            <select class="input" aria-label="Helper" value=${hp.name || ''} onChange=${(e) => helper(i, 'name', e.currentTarget.value)}>
              <option value="">Pick who</option>
              ${hp.name && !crewNames.includes(hp.name) ? html`<option value=${hp.name}>${hp.name} (not booked on this job)</option>` : null}
              ${crewNames.map((n) => html`<option value=${n}>${n}</option>`)}
            </select>
            <input class="input" type="number" inputmode="decimal" placeholder="Hours" value=${hp.hours || ''} onInput=${(e) => helper(i, 'hours', e.currentTarget.value)} />
            <input class="input" type="number" inputmode="decimal" placeholder="Rate" value=${hp.rate || ''} onInput=${(e) => helper(i, 'rate', e.currentTarget.value)} />
            <${IconButton} name="trash" label="Remove helper" size=${18} onClick=${() => set('helpers', f.helpers.filter((_, idx) => idx !== i))} /></div>`)}
            ${crewKnown && !crewNames.length ? html`<p class="t-small">Nobody else is booked on this job. Ask the office to book your crew on it, then add them here.</p>`
              : !crewKnown && jobQ.error ? html`<p class="t-small">The crew on this job could not be read. Try again when you have signal.</p>`
              : html`<${Button} kind="line" small disabled=${!crewKnown} onClick=${() => set('helpers', [...f.helpers, { name: '', hours: '', rate: '' }])}>Add a helper<//>`}
            ${f.helpers.some((hp) => hp.name && crewKnown && !crewNames.includes(hp.name)) ? html`<p class="t-small">A helper here is not booked on this job. Pick someone from the crew, or ask the office to book them on.</p>` : null}</div><//>
        <${Field} label="Note (optional)"><input class="input" value=${f.description} onInput=${(e) => set('description', e.currentTarget.value)} /><//>
      ` : line.kind === 'deduction' ? html`
        <div class="card pay-out"><span class="t-cap">${line.title}</span><b class="t-figure">${cash(line.amount)}</b></div>
        <p class="t-small">An amount taken off the whole invoice cannot be sent from this app. Remove it. If money needs to come off your pay, tell the office and they will do it.</p>
      ` : html`
        <${Field} label=${line.kind === 'commission' ? 'Commission amount (before GST)' : line.kind === 'deduction' ? 'Adjustment amount (before GST)' : 'Amount (before GST)'}><input class="input big" type="number" inputmode="decimal" min="0" value=${f.amount} onInput=${(e) => set('amount', e.currentTarget.value)} placeholder="$" /><//>
        ${line.kind !== 'commission' ? html`<${Field} label="What it is for"><input class="input" value=${f.description} onInput=${(e) => set('description', e.currentTarget.value)} /><//>` : null}
      `}
      ${line.added || simple ? null : html`<${Toggle} label="Leave this off the invoice" hint="For a day you were booked but did not work." checked=${f.off} onChange=${(v) => set('off', v)} />`}
      ${canSwitchToWo || canSwitchToHours || canCommission ? html`<div class="stack tight pay-switch">
        <span class="t-cap">Paid a different way on this job?</span>
        ${canSwitchToWo ? html`<${Button} kind="line" small onClick=${() => switchTo('work_order', shut)}>Bill it as a work order<//>` : null}
        ${canSwitchToHours ? html`<${Button} kind="line" small onClick=${() => switchTo('hours', shut)}>Bill by the hour instead<//>` : null}
        ${canCommission ? html`<${Button} kind="line" small onClick=${() => switchTo('commission', shut)}>Claim commission instead<//>` : null}
      </div>` : null}
    </div>`}
  <//>`;
}

// ------------------------------------------------------------- add a job
const MODE_WORDS = { hourly: 'Paid by the hour.', work_order: 'Paid as a work order.', group_work_order: 'Paid through a group work order. Your hours go on the group work order, not on this invoice.' };
export function openAddJob(props) { openOverlay((close) => html`<${AddJobSheet} ...${props} onClose=${close} />`); }
function AddJobSheet({ monday, user, lines, addLine, refetch, onClose }) {
  const [q, setQ] = useState(''); const [term, setTerm] = useState('');
  const [job, setJob] = useState(null); const [day, setDay] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setTimeout(() => setTerm(q.trim()), 280); return () => clearTimeout(id); }, [q]);
  const search = useQuery(term.length >= 2 ? 'search:' + term.toLowerCase() : null, () => api('search_all_jobs', { q: term }), { ttl: 60000 });
  const results = ((search.data && search.data.jobs) || []).slice(0, 12);
  const days = pickableDays(monday);
  const grant = user.details && user.details.invoiceAnyJob === true;
  // How the job is billed is the server's answer, asked before anything is offered.
  const modeQ = useQuery(job ? 'jobmodes:' + job.id : null, () => api('trade_invoice_job_modes', { job_ids: job.id }), { ttl: 60000 });
  const row = job && modeQ.data && Array.isArray(modeQ.data.jobs) ? modeQ.data.jobs.find((r) => String(r.job_id) === String(job.id)) || null : null;
  const settled = Boolean(job && (modeQ.data || modeQ.error));
  const m = readMode(row, false);
  const modeWords = !settled ? 'Checking how this job is billed.' : m.mode === 'work_order' && m.agreed != null ? 'Paid as a work order, at the amount agreed with the office.' : MODE_WORDS[m.mode] || `${UNKNOWN_MODE_WORDS}. You can add the day, but it stays off the invoice until the office sorts it out.`;
  const viaGroup = m.mode === 'group_work_order';

  const add = async (shut) => {
    if (lines.some((l) => l.jobId === job.id && l.date === day && l.kind === 'hours')) { toast('That job is already on that day.'); return; }
    setBusy(true);
    if (grant && !viaGroup) {
      addLine({ key: 'add:' + Date.now(), kind: m.mode === 'work_order' && (m.agreed != null || user.perMetre) ? 'work_order' : 'hours', jobId: job.id, jobNumber: job.job_number || '', title: jobTitle(job), suburb: job.site_suburb || '', client: job.client_name || '', vertical: verticalOf(job), jobType: job.type || '', date: day, start: '', finish: '', breakMin: null, description: '' });
      setBusy(false); shut(); return;
    }
    const r = await bookMyself(job.id, [day]);
    if (!r.ok) { setBusy(false); toast(r.message, { kind: 'bad', ms: 6000 }); return; }
    await refetch();
    setBusy(false); buzz(10);
    toast(viaGroup ? `You are on ${jobTitle(job)} for ${fmtDay(day)}. Add your hours on its group work order.` : `${jobTitle(job)} added for ${fmtDay(day)}. Tap it to put in your times.`, { kind: 'ok', ms: 4500 });
    shut();
  };

  return html`<${Sheet} title=${job ? 'Which day?' : 'Add a day or a job'} sub=${job ? jobTitle(job) : ''} onClose=${onClose} tall=${!job}
    foot=${job ? (shut) => html`<${Button} block busy=${busy} disabled=${!day || !settled} onClick=${() => add(shut)}>Add to this timesheet<//><${Button} kind="quiet" block onClick=${() => { setJob(null); setDay(null); }}>Pick a different job<//>` : null}>
    ${job ? html`<div class="stack">
      <${JobLine} job=${job} vertical=${verticalOf(job)} />
      <div class="daypicks">${days.map((d) => html`<button type="button" class="daypick" aria-pressed=${String(day === d)} onClick=${() => setDay(d)}><span class="dow">${fmtDow(d)}</span><span class="dom">${fmtDom(d)}</span></button>`)}</div>
      <p class="t-small" role="status">${modeWords}</p>
      ${grant && !viaGroup ? null : html`<p class="t-small">This puts you on the job for that day, so the office can see you were there.</p>`}
    </div>` : html`<div class="stack">
      <div class="search"><${Icon} name="jobs" size=${20} /><input class="input" type="search" autofocus placeholder="Suburb, name or job number" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} /></div>
      ${term.length < 2 ? html`<p class="t-small">Search for the job. Finished jobs show too.</p>`
        : search.loading ? html`<${SkelRows} n=${3} />`
        : search.error && !results.length ? html`<${LoadError} error=${search.error} onRetry=${search.refetch} what="the jobs" />`
        : !results.length ? html`<${Empty} title="No job found">Try the suburb or the job number. If it still does not show, ask the office.<//>`
        : html`<div class="pay-sheetlist">${results.map((j) => html`<button type="button" class="item" key=${j.id} onClick=${() => { setJob(j); buzz(6); }}>
            <span class="main"><b>${jobTitle(j)}</b><span class="sub">${j.client_name || ''}</span><${JobLine} job=${j} vertical=${verticalOf(j)} /></span></button>`)}</div>`}
    </div>`}
  <//>`;
}

// ----------------------------------------------------- add another amount
export function openAddOther(props) { openOverlay((close) => html`<${AddOtherSheet} ...${props} onClose=${close} />`); }
function AddOtherSheet({ monday, lines, addLine, onClose, reimbursementsOn = false, userId }) {
  const jobs = useMemo(() => { const m = new Map(); lines.forEach((l) => { if (l.jobId && !l.unknown && !m.has(l.jobId)) m.set(l.jobId, l); }); return [...m.values()]; }, [lines]);
  const [type, setType] = useState('Travel'); const [jobId, setJobId] = useState(jobs[0] ? jobs[0].jobId : null);
  const [amount, setAmount] = useState(''); const [desc, setDesc] = useState('');
  const [receiptMode, setReceiptMode] = useState(false);
  if (receiptMode) return html`<${ReceiptPicker} lines=${lines} addLine=${addLine} userId=${userId} onClose=${onClose} />`;
  const days = pickableDays(monday);
  const ok = jobId && Number(amount) > 0 && desc.trim();
  const add = (shut) => {
    const j = jobs.find((x) => x.jobId === jobId);
    addLine({ key: 'add:' + Date.now(), kind: 'other', type, jobId: j.jobId, jobNumber: j.jobNumber, title: j.title, suburb: j.suburb || '', client: j.client, vertical: j.vertical, jobType: j.jobType, date: j.date <= days[days.length - 1] ? j.date : days[days.length - 1], amount: Number(amount), description: desc.trim() });
    shut();
  };
  return html`<${Sheet} title="Add another item" sub="Travel or another amount agreed with the office." onClose=${onClose} foot=${(shut) => html`<${Button} block disabled=${!ok} onClick=${() => add(shut)}>Add to this invoice<//>`}>
    ${reimbursementsOn ? html`<${Button} kind="line" block onClick=${() => setReceiptMode(true)}>Add a receipt<//>` : null}
    ${!jobs.length ? html`<${Empty} title="Add the job first">An extra amount has to go against a job. Add the job to the timesheet, then add the extra.<//>` : html`<div class="stack">
      <${Field} label="What is it?"><${Picks} value=${type} options=${[['Travel', 'Travel'], ['Materials', 'Materials'], ['Equipment', 'Equipment'], ['Other', 'Other']]} onChange=${setType} /><//>
      <${Field} label="Which job?"><div class="picks">${jobs.map((j) => html`<button type="button" class="pick" aria-pressed=${String(jobId === j.jobId)} onClick=${() => setJobId(j.jobId)}>${j.title}</button>`)}</div><//>
      <${Field} label="Amount (before GST)"><input class="input big" type="number" inputmode="decimal" min="0" value=${amount} onInput=${(e) => setAmount(e.currentTarget.value)} placeholder="$" /><//>
      <${Field} label="What it is for"><input class="input" value=${desc} onInput=${(e) => setDesc(e.currentTarget.value)} placeholder=${type === 'Travel' ? 'e.g. 84 km to site and back' : 'A few words'} /><//>
      <p class="t-small">The office checks extra amounts before they are paid. ${reimbursementsOn ? 'Use Reimbursement (receipt) for something you paid for yourself. Its amount comes from the receipt.' : 'Bought something with a receipt? Add it under Expenses on the Pay screen. It is paid back separately, not on this invoice.'}</p>
    </div>`}
  <//>`;
}


function ReceiptPicker({ lines, addLine, userId, onClose }) {
  const q = useQuery('receipt-picker:' + userId, () => api('list_expenses', { limit: 100 }), { ttl: 0 });
  const rows = (q.data?.expenses || []).filter((r) => r.submitted_by === userId);
  const on = !q.error && !q.loading && !q.refreshing && receiptsEnabled(rows);
  const picked = new Set(lines.filter((l) => l.kind === 'reimbursement').map((l) => l.receiptId));
  const pick = async (row) => {
    try {
      const fresh = await api('list_expenses', { limit: 100 });
      primeQuery('expenses', fresh, { persist: true });
      const receipt = (fresh.expenses || []).find((r) => r.id === row.id && r.submitted_by === userId);
      const problem = receiptProblem(receipt);
      if (problem) { toast(problem, { kind: 'bad' }); q.refetch(); return; }
      addLine(receiptLine(receipt)); onClose();
    } catch (err) { toast(friendly(err) + ' No receipt was added.', { kind: 'bad' }); q.refetch(); }
  };
  return html`<${Sheet} title="Reimbursement (receipt)" sub="The receipt sets the amount. No super or GST is added to it." onClose=${onClose}>
    ${q.loading || q.refreshing ? html`<${SkelRows} n=${3} />` : q.error ? html`<${LoadError} error=${q.error} onRetry=${q.refetch} what="your receipts" />`
      : !on || !rows.length ? html`<${Empty} title="No receipts to pay back. Add one under Expenses first."><${Button} kind="line" onClick=${() => { onClose(); go('/pay/receipt'); }}>Add a receipt<//><//>`
      : html`<div class="pay-sheetlist">${rows.map((r) => {
        const reason = picked.has(r.id) ? 'Already on this invoice' : receiptProblem(r);
        return html`<button type="button" class="item" key=${r.id} disabled=${Boolean(reason)} onClick=${() => pick(r)}>
          <span class="main"><b>${r.vendor_name || 'Receipt'}</b><span class="sub">${r.receipt_date || 'Date not read'}${Number(r.total_amount) > 0 ? ' · ' + cash(r.total_amount) : ''}</span>${reason ? html`<span class="sub">${reason}</span>` : null}</span>
        </button>`;
      })}</div>`}
  <//>`;
}
