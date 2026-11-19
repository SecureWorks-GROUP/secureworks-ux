// What the trade sees of their own lines that wait on the office (rules in
// lib/held.js). Each piece draws nothing unless the server sent held facts,
// so with trade_line_hold_v1 off every pay screen is exactly as before.
import { html } from '../lib/h.js';
import { api, ApiError } from '../lib/api.js';
import { useQuery, local } from '../lib/store.js';
import { go } from '../lib/router.js';
import { now, fmtWeek } from '../lib/dates.js';
import { Section, Badge, Button } from './kit.js';
import { cash, PayGroup, PayLine, plural } from './paybits.js';
import { sendSplit, sendHeldLines, heldKey, addPointer, livePointers, heldCounts } from '../lib/held.js';

/** Keep this send's holding invoice on the phone so Pay can open it again. */
export function rememberHeldSend(userId, res, monday) {
  if (!userId || !res || typeof res.held_invoice_id !== 'string' || !res.held_invoice_id) return;
  local.set(heldKey(userId), addPointer(local.get(heldKey(userId), []), res.held_invoice_id, monday, now().getTime()));
}

function forgetHeld(userId, id) {
  local.set(heldKey(userId), (local.get(heldKey(userId), []) || []).filter((p) => p && p.id !== id));
}

/** The three parts of a send: in pay, waiting on the office, not approved. The server's figures. */
export function SendSplit({ res }) {
  const s = sendSplit(res);
  if (!s) return null;
  return html`<div class="card pay-sum" data-held-split>
    <div class="pay-sumrow"><span>In pay</span><span class="t-num">${cash(s.inPay)}</span></div>
    <div class="pay-sumrow"><span>Waiting on office</span><span class="t-num">${cash(s.waiting)}</span></div>
    ${s.notApproved > 0 ? html`<div class="pay-sumrow"><span>Not approved</span><span class="t-num">${cash(s.notApproved)}</span></div>` : null}
  </div>
  <p class="t-small">Before GST and super. A line waiting on the office is paid once they approve it.</p>`;
}

/** The send's held lines, each with why it waits, and the way back to them. */
export function SendHeldLines({ res }) {
  const lines = sendHeldLines(res);
  if (!lines.length) return null;
  return html`<div class="pay-rows" data-held-lines>
    <${PayGroup} label="Waiting on office">
      ${lines.map((l) => html`<${PayLine} key=${l.key} title=${l.jobNumber ? 'Held line' : 'No job'} number=${l.jobNumber} note=${l.words}
        amount=${l.amount != null ? cash(l.amount) : ''} badge=${html`<span class="pay-linebadge"><${Badge} kind="warn">Waiting on office<//></span>`} />`)}
    <//>
  </div>
  ${res.held_invoice_id ? html`<${Button} kind="line" block onClick=${() => go('/pay/invoice/' + res.held_invoice_id, { replace: true })}>See the lines with the office<//>` : null}`;
}

/** Pay: the trade's own sends that still have lines with the office. Nothing when there are none. */
export function HeldOnPay({ userId }) {
  const list = userId ? livePointers(local.get(heldKey(userId), []), now().getTime()).slice(0, 3) : [];
  const ids = list.map((p) => p.id);
  // One read of each kept holding invoice (the trade's own, filtered by the server).
  const q = useQuery(ids.length ? 'held:pay:' + ids.join(',') : null, () => Promise.all(ids.map((id) => api('get_trade_invoice', { invoice_id: id })
    .then((r) => [id, (r && r.invoice) || null])
    .catch((err) => {
      if (err instanceof ApiError && err.status === 404) { forgetHeld(userId, id); return [id, 'gone']; }
      return [id, 'unread'];
    }))).then(Object.fromEntries), { persist: true, ttl: 60000 });
  if (!ids.length || !q.data) return null;
  const rows = list.map((p) => {
    const inv = q.data[p.id];
    const title = p.monday ? fmtWeek(p.monday) : 'Lines with the office';
    if (inv === 'unread') return { p, title, words: 'Could not check these lines. Open to try again.', badge: null };
    if (!inv || inv === 'gone') return null;
    const c = heldCounts(inv);
    if (!c.waiting && !c.notApproved) return null;
    return {
      p, title,
      words: [c.waiting ? plural(c.waiting, 'line') + ' waiting on office' : '', c.notApproved ? plural(c.notApproved, 'line') + ' not approved' : ''].filter(Boolean).join(' · '),
      badge: c.waiting ? ['warn', 'Waiting on office'] : ['bad', 'Not approved']
    };
  }).filter(Boolean);
  if (!rows.length) return null;
  return html`<${Section} label="With the office">
    <div class="block card" data-held-pay>${rows.map((r) => html`<button type="button" class="item" key=${r.p.id} data-held-row onClick=${() => go('/pay/invoice/' + r.p.id)}>
      <span class="main"><b>${r.title}</b><span class="sub">${r.words}</span></span>
      ${r.badge ? html`<span class="side"><${Badge} kind=${r.badge[0]}>${r.badge[1]}<//></span>` : null}
    </button>`)}</div>
  <//>`;
}
