// Profile: who is signed in, their details, and the app's own settings.
import { html, useEffect, useState } from '../lib/h.js';
import { useStore, local, getState } from '../lib/store.js';
import { signOut, changePassword } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { outboxItems, onOutbox, flushOutbox } from '../lib/outbox.js';
import { fmtTs, fmtMoney, todayISO, mondayOf } from '../lib/dates.js';
import { Avatar, Button, Sheet, Field, Picks, Page, Section, KV, openOverlay, ask, toast } from '../ui/kit.js';
import { Logo } from '../ui/logo.js';
import { useHours } from './pay.js';

export function Profile() {
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const [waiting, setWaiting] = useState(outboxItems);
  useEffect(() => onOutbox(() => setWaiting(outboxItems())), []);
  const [canInstall, setCanInstall] = useState(Boolean(window.__crewInstall));
  useEffect(() => { const fn = () => setCanInstall(true); window.addEventListener('crew:installable', fn); return () => window.removeEventListener('crew:installable', fn); }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const hours = useHours(mondayOf(todayISO()));
  const d = user.details || {};
  const abn = user.abn || d.abn;
  const account = String(d.accountNo || '').replace(/\D/g, '');
  const h = hours.data;
  const rate = h && h.rate_resolved !== false && Number(h.rate) > 0 ? Number(h.rate) : 0;
  const cfg = window.CREW_CONFIG;
  const missing = (v, words) => (v ? words : html`<span class="t-bad">Missing</span>`);

  const install = async () => { const ev = window.__crewInstall; if (!ev) return; ev.prompt(); await ev.userChoice; window.__crewInstall = null; setCanInstall(false); };
  const leave = async () => {
    if (waiting.length && !(await ask({ title: 'Sign out with things waiting to send?', body: `${waiting.length} saved ${waiting.length === 1 ? 'change has' : 'changes have'} not reached the office yet. They stay on this phone and send when you sign back in.`, yes: 'Sign out anyway', danger: true }))) return;
    signOut();
  };
  const pickPersona = (p) => {
    local.set('demoPersona', p);
    if (cfg.memoryRoutes) { location.reload(); return; }
    const u = new URL(location.href); if (u.searchParams.has('demo')) u.searchParams.set('demo', p); u.hash = '#/today'; location.href = u.toString(); location.reload();
  };

  return html`<${Page} root title="Profile" right=${html`<span>${user.label}</span>`}>
    <div class="block card who">
      <${Avatar} name=${user.name} lg />
      <div style="min-width:0"><b class="t-head">${user.name}</b><span class="t-small" style="display:block">${user.label}${user.perMetre ? ' · paid by work order' : rate ? ' · paid hourly' : ''}</span></div>
    </div>

    ${waiting.length ? html`<${Section} label=${`Waiting to send · ${waiting.length}`} right=${html`<button type="button" class="link tap" onClick=${() => flushOutbox()}>Send now</button>`}>
      <div class="block card">${waiting.slice(0, 6).map((w) => html`<${KV} k=${w.kind === 'photo' ? 'Photo' : w.label || 'Saved change'} v=${fmtTs(w.ts)} />`)}</div>
      <p class="block t-small" style="margin-top:6px">${online ? 'Sending now.' : 'They send by themselves when you have signal.'}</p>
    <//>` : null}

    <${Section} label="Business details" right=${html`<button type="button" class="link tap" onClick=${() => go('/profile/details')}>Edit</button>`}>
      <div class="block card">
        <${KV} nav k="ABN" v=${missing(abn, 'On file')} onClick=${() => go('/profile/details')} />
        <${KV} nav k="Bank account" v=${missing(account && d.bsb, 'Ending ' + account.slice(-4))} onClick=${() => go('/profile/details')} />
        <${KV} nav k="GST" v=${d.gstRegistered === true ? 'Registered' : 'Not registered'} onClick=${() => go('/profile/details')} />
      </div>
    <//>

    <${Section} label="Pay">
      <div class="block card">
        ${user.perMetre ? html`<${KV} nav k="Pay basis" v="Work order, agreed for each job" />`
          : html`<${KV} nav k="Hourly rate" v=${rate ? `${fmtMoney(rate, { cents: true })} · set by the office` : hours.loading ? 'Checking' : 'Not set yet, ask the office'} />`}
      </div>
    <//>

    <${Section} label="Work">
      <div class="block card">
        <${KV} nav k="Days you cannot work" v="Set in Schedule" onClick=${() => go('/schedule/availability')} />
      </div>
    <//>

    <${Section} label="This app">
      <div class="block card">
        ${!standalone ? (canInstall
          ? html`<${KV} nav k="Put it on your home screen" v="Install" onClick=${install} />`
          : html`<div class="kvrow nav-row" style="display:grid;gap:2px;justify-content:start"><span class="k">Put it on your home screen</span><span class="t-small">${/iPhone|iPad/.test(navigator.userAgent) ? 'Tap the share button in Safari, then "Add to Home Screen".' : 'Open the browser menu and choose "Add to Home screen" or "Install app".'}</span></div>`) : null}
        ${cfg.memoryRoutes ? null : html`<${KV} nav k="The old Trade app" v="Open" onClick=${() => { location.href = cfg.oldAppUrl; }} />`}
        ${cfg.officePhone ? html`<${KV} nav k="The office" v="Call" onClick=${() => { location.href = 'tel:' + cfg.officePhone; }} />` : null}
      </div>
    <//>

    <${Section} label="Account">
      <div class="block card">
        <${KV} nav k="Password" v="Change" onClick=${() => openOverlay((close) => html`<${PasswordSheet} onClose=${close} />`)} />
        <button type="button" class="kvrow nav-row" onClick=${leave}><span class="k t-bad">Sign out</span></button>
      </div>
    <//>

    ${getState().demo ? html`<${Section} label="Demo: look at it as">
      <div class="block"><${Picks} value=${local.get('demoPersona', 'crew')} options=${[['crew', 'A crew member'], ['lead', 'A fencing lead'], ['office', 'The office'], ['new', 'Someone new']]} onChange=${pickPersona} /></div>
    <//>` : null}

    <div class="block signoff"><${Logo} height=${22} /><p class="t-small">Crew app ${cfg.version}${getState().demo ? ' · demo' : ''}</p></div>
  <//>`;
}

function PasswordSheet({ onClose }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [busy, setBusy] = useState(false);
  const bad = a.length > 0 && a.length < 8 ? 'At least 8 characters.' : b && a !== b ? 'The two do not match.' : '';
  const save = async (shut) => {
    setBusy(true);
    try { await changePassword(a); toast('Password changed.', { kind: 'ok' }); shut(); } catch (err) { toast(err.message || 'Could not change it.', { kind: 'bad' }); }
    setBusy(false);
  };
  return html`<${Sheet} title="Change password" sub="This also changes it for the old Trade app." onClose=${onClose} foot=${(shut) => html`<${Button} block busy=${busy} disabled=${a.length < 8 || a !== b} onClick=${() => save(shut)}>Save new password<//>`}>
    <div class="stack">
      <${Field} label="New password"><input class="input" type="password" autocomplete="new-password" value=${a} onInput=${(e) => setA(e.currentTarget.value)} /><//>
      <${Field} label="Type it again" error=${bad}><input class="input" type="password" autocomplete="new-password" value=${b} onInput=${(e) => setB(e.currentTarget.value)} /><//>
    </div>
  <//>`;
}
