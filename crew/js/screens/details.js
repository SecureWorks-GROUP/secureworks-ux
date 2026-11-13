// Business and bank details: who to pay and where. Saved on the trade's own
// profile, which the weekly invoice and the bookkeeper read.
import { html, useMemo, useState } from '../lib/h.js';
import { api, friendly } from '../lib/api.js';
import { useStore, setState, getState } from '../lib/store.js';
import { decorate, refreshProfile } from '../lib/auth.js';
import { back } from '../lib/router.js';
import { todayISO, mondayOf, fmtMoney } from '../lib/dates.js';
import { Icon } from '../ui/icons.js';
import { Page, Button, Field, Toggle, toast, ask, buzz } from '../ui/kit.js';
import { useHours } from './pay.js';

const digits = (v) => String(v || '').replace(/\D/g, '');
/** '51824753556' -> '51 824 753 556' */
export function formatAbn(v) {
  const d = digits(v).slice(0, 11);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 11)].filter(Boolean).join(' ');
}
/** '066000' -> '066-000' */
export function formatBsb(v) {
  const d = digits(v).slice(0, 6);
  return d.length > 3 ? d.slice(0, 3) + '-' + d.slice(3) : d;
}
/** The tax office's own check sum for an ABN. */
export function abnChecks(v) {
  const d = digits(v);
  if (d.length !== 11) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return d.split('').reduce((sum, ch, i) => sum + (Number(ch) - (i === 0 ? 1 : 0)) * w[i], 0) % 89 === 0;
}

function initial(user) {
  const d = user.details || {};
  return {
    fullName: d.fullName || user.full_name || user.name || '',
    phone: d.phone || user.phone || '',
    email: d.email || user.email || '',
    abn: formatAbn(user.abn || d.abn || ''),
    bsb: formatBsb(d.bsb || ''),
    accountNo: String(d.accountNo || ''),
    accountName: d.accountName || '',
    licence: d.licence || '',
    gstRegistered: d.gstRegistered === true
  };
}

export function Details() {
  const user = useStore((s) => s.user);
  const start = useMemo(() => initial(user), [user]);
  const [form, setForm] = useState(start);
  const [base, setBase] = useState(start);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const hours = useHours(mondayOf(todayISO()));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = Object.keys(form).some((k) => form[k] !== base[k]);

  const abnLen = digits(form.abn).length;
  const bsbLen = digits(form.bsb).length;
  const accLen = digits(form.accountNo).length;
  const errors = {
    fullName: form.fullName.trim().length < 2 ? 'Add your name as it should show on invoices.' : '',
    phone: form.phone.trim() && digits(form.phone).length < 8 ? 'That phone number looks too short.' : '',
    email: form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? 'That email does not look right.' : '',
    abn: abnLen > 0 && abnLen !== 11 ? `An ABN has 11 numbers. This has ${abnLen}.` : '',
    bsb: bsbLen > 0 && bsbLen !== 6 ? `A BSB has 6 numbers. This has ${bsbLen}.` : '',
    accountNo: accLen > 0 && (accLen < 5 || accLen > 10) ? 'An account number has 5 to 10 numbers.' : ''
  };
  const firstError = Object.values(errors).find(Boolean) || '';
  const show = (k) => (tried || form[k] !== base[k] ? errors[k] : '');
  const abnOdd = abnLen === 11 && !abnChecks(form.abn);
  const missing = [!abnLen && 'ABN', !bsbLen && 'BSB', !accLen && 'account number'].filter(Boolean);

  const save = async () => {
    setTried(true);
    if (firstError) { toast(firstError, { kind: 'bad' }); return; }
    setBusy(true);
    const body = {
      fullName: form.fullName.trim(), phone: form.phone.trim(), email: form.email.trim(), abn: formatAbn(form.abn), bsb: formatBsb(form.bsb),
      accountNo: form.accountNo.trim(), accountName: form.accountName.trim(), licence: form.licence.trim(), gstRegistered: form.gstRegistered === true
    };
    try {
      const res = await api('update_trade_profile', null, body);
      const p = (res && res.profile) || {};
      // Show what the server kept straight away, then read the whole profile again.
      const cur = getState().user || user;
      const details = p.trade_details && typeof p.trade_details === 'object' ? p.trade_details : { ...cur.details, ...body };
      setState({ user: decorate({ ...cur, trade_details: details, abn: p.abn !== undefined ? p.abn : cur.abn }) });
      const kept = { ...form, abn: formatAbn(form.abn), bsb: formatBsb(form.bsb) };
      setForm(kept); setBase(kept); setTried(false);
      buzz([12, 40, 20]);
      toast('Saved. Your next invoice uses these details.', { kind: 'ok' });
      refreshProfile().catch(() => {});
    } catch (err) {
      toast(err.offline ? 'Not saved. You need signal to change these, so try again in range.' : friendly(err), { kind: 'bad', ms: 6000 });
    }
    setBusy(false);
  };
  const leave = async () => {
    if (dirty && !(await ask({ title: 'Leave without saving?', body: 'The changes you made here have not been saved.', yes: 'Leave', no: 'Keep editing', danger: true }))) return;
    back('/me');
  };

  const h = hours.data;
  const rate = h && h.rate_resolved !== false && Number(h.rate) > 0 ? Number(h.rate) : 0;

  return html`<${Page} title="Your details" onBack=${leave}>
    <header class="page-pad" style="padding-top:2px"><h1 class="t-display">Your details</h1>
      <p class="t-small" style="margin-top:8px;max-width:36ch">${missing.length ? `Still to add: ${missing.join(', ')}. Without them your pay can be held up.` : 'These go on your invoices. Keep them up to date.'}</p></header>

    <form class="form" style="margin-top:22px" onSubmit=${(e) => { e.preventDefault(); save(); }} novalidate>
      <${Group} title="You" why="So the office knows who you are and how to reach you." />
      <${Field} label="Full name" error=${show('fullName')}><input class="input" type="text" autocomplete="name" autocapitalize="words" value=${form.fullName} onInput=${(e) => set('fullName')(e.currentTarget.value)} /><//>
      <${Field} label="Mobile" error=${show('phone')}><input class="input" type="tel" inputmode="tel" autocomplete="tel" value=${form.phone} onInput=${(e) => set('phone')(e.currentTarget.value)} placeholder="04xx xxx xxx" /><//>
      <${Field} label="Email" error=${show('email')}><input class="input" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck=${false} value=${form.email} onInput=${(e) => set('email')(e.currentTarget.value)} /><//>

      <${Group} title="Your business" why="So your invoices are valid and the tax is right." />
      <${Field} label="ABN" error=${show('abn')} hint=${abnOdd ? null : '11 numbers. Spaces are added for you.'}>
        <input class="input num" type="text" inputmode="numeric" autocomplete="off" value=${form.abn} onInput=${(e) => set('abn')(formatAbn(e.currentTarget.value))} placeholder="00 000 000 000" /><//>
      ${abnOdd && !show('abn') ? html`<p class="fieldwarn"><${Icon} name="alert" size=${16} />Check this ABN. The numbers do not add up the way a real one does. You can still save it.</p>` : null}
      <${Field} label="Licence number (if you have one)"><input class="input" type="text" autocomplete="off" autocapitalize="characters" value=${form.licence} onInput=${(e) => set('licence')(e.currentTarget.value)} /><//>
      <div class="inset"><${Toggle} label="Registered for GST" hint="Only switch this on if your ABN is registered for GST. Your invoices then add GST unless you turn it off on the invoice." checked=${form.gstRegistered} onChange=${set('gstRegistered')} /></div>

      <${Group} title="Your bank" why="So the bookkeeper can pay you." />
      <div class="formgrid">
        <${Field} label="BSB" error=${show('bsb')}><input class="input num" type="text" inputmode="numeric" autocomplete="off" value=${form.bsb} onInput=${(e) => set('bsb')(formatBsb(e.currentTarget.value))} placeholder="000-000" /><//>
        <${Field} label="Account number" error=${show('accountNo')}><input class="input num" type="text" inputmode="numeric" autocomplete="off" value=${form.accountNo} onInput=${(e) => set('accountNo')(e.currentTarget.value.replace(/[^\d ]/g, '').slice(0, 13))} placeholder="0000 0000" /><//>
      </div>
      <${Field} label="Account name"><input class="input" type="text" autocomplete="off" autocapitalize="words" value=${form.accountName} onInput=${(e) => set('accountName')(e.currentTarget.value)} placeholder="The name on the account" /><//>

      <${Group} title="Your rate" why="Your rate is set with the office." />
      <div class="inset ratebox">
        ${user.perMetre ? html`<span class="t-head">Paid by work order</span><span class="t-small">Each job has an agreed amount. You see it on the job's work order.</span>`
          : hours.loading ? html`<span class="t-small t-mute">Checking your rate</span>`
          : rate ? html`<span class="money lg">${fmtMoney(rate)}<small> an hour</small></span><span class="t-small">To change it, talk to the office.</span>`
          : hours.error && !h ? html`<span class="t-small">Could not check your rate just now. It shows on your weekly invoice.</span>`
          : html`<span class="t-head">No rate set yet</span><span class="t-small">Ask the office to set your hourly rate before you send an invoice.</span>`}
      </div>
    </form>

    <div class="dock">
      <${Button} block busy=${busy} disabled=${!dirty} onClick=${save}>${dirty ? 'Save details' : 'Saved'}<//>
    </div>
  <//>`;
}

function Group({ title, why }) {
  return html`<div class="formgroup"><h2 class="t-head">${title}</h2><p class="t-small">${why}</p></div>`;
}
