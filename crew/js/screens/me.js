// Me: who is signed in, their details, and the app's own settings.
import { html, useEffect, useState } from '../lib/h.js';
import { useStore, local, getState } from '../lib/store.js';
import { signOut, changePassword } from '../lib/auth.js';
import { go } from '../lib/router.js';
import { outboxItems, onOutbox, flushOutbox } from '../lib/outbox.js';
import { fmtTs } from '../lib/dates.js';
import { Icon } from '../ui/icons.js';
import { Avatar, Button, Sheet, Field, Picks, openOverlay, ask, toast } from '../ui/kit.js';

export function Me() {
  const user = useStore((s) => s.user);
  const online = useStore((s) => s.online);
  const [waiting, setWaiting] = useState(outboxItems);
  useEffect(() => onOutbox(() => setWaiting(outboxItems())), []);
  const [theme, setTheme] = useState(() => local.get('theme', 'auto'));
  const pickTheme = (t) => { setTheme(t); if (t === 'auto') { local.del('theme'); delete document.documentElement.dataset.theme; } else { local.set('theme', t); document.documentElement.dataset.theme = t; } };
  const [canInstall, setCanInstall] = useState(Boolean(window.__crewInstall));
  useEffect(() => { const fn = () => setCanInstall(true); window.addEventListener('crew:installable', fn); return () => window.removeEventListener('crew:installable', fn); }, []);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const d = user.details || {};
  const missing = !d.abn && !user.abn || !d.bsb || !d.accountNo;

  return html`<main class="page enter-tab">
    <header class="page-pad" style="padding-top:4px;display:flex;gap:16px;align-items:center">
      <${Avatar} name=${user.name} me lg />
      <div style="min-width:0"><h1 class="t-title clip" style="font-size:30px">${user.name}</h1><p class="t-small">${user.label}${user.perMetre ? ' · paid by work order' : ''}</p></div>
    </header>

    ${waiting.length ? html`<section class="block inset" style="margin-top:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><span><span class="t-strong">${waiting.length} waiting to send</span><span class="t-small" style="display:block">${online ? 'Sending now.' : 'They send by themselves when you have signal.'}</span></span>
        <${Button} kind="line" small onClick=${() => flushOutbox()}>Send now<//></div>
      <ul style="margin:10px 0 0;padding-left:18px;font-size:14.5px;color:var(--ink-2)">${waiting.slice(0, 6).map((w) => html`<li>${w.kind === 'photo' ? 'Photo' : w.label || 'Saved change'} · ${fmtTs(w.ts)}</li>`)}</ul>
    </section>` : null}

    <section class="section"><span class="t-label">Your details</span><div class="list ruled">
      <${Row} icon="file" title="Business and bank details" sub=${missing ? 'Some details are missing' : 'ABN, bank account, GST'} warn=${missing} onClick=${() => go('/me/details')} />
      <${Row} icon="calendar" title="Days you cannot work" sub="Tell the office ahead of time" onClick=${() => go('/me/availability')} />
      <${Row} icon="lock" title="Change password" onClick=${() => openOverlay((close) => html`<${PasswordSheet} onClose=${close} />`)} />
    </div></section>

    <section class="section"><span class="t-label">This app</span>
      <div class="block" style="display:grid;gap:14px;margin-top:8px">
        <${Field} label="Look"><${Picks} value=${theme} options=${[['auto', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']]} onChange=${pickTheme} /><//>
        ${!standalone ? html`<div class="inset"><span class="t-strong">Put it on your home screen</span><p class="t-small" style="margin-top:4px">${canInstall ? 'Opens like a normal app, full screen.' : /iPhone|iPad/.test(navigator.userAgent) ? 'Tap the share button in Safari, then "Add to Home Screen".' : 'Open the browser menu and choose "Add to Home screen" or "Install app".'}</p>
          ${canInstall ? html`<${Button} small style="margin-top:10px" onClick=${async () => { const ev = window.__crewInstall; if (!ev) return; ev.prompt(); await ev.userChoice; window.__crewInstall = null; setCanInstall(false); }}>Install<//>` : null}</div>` : null}
      </div>
      <div class="list ruled" style="margin-top:10px">
        <${Row} icon="swap" title="Open the old Trade app" sub="Same jobs, same login" onClick=${() => { location.href = window.CREW_CONFIG.oldAppUrl; }} />
        <${Row} icon="phone" title="Call the office" onClick=${() => { location.href = 'tel:' + (window.CREW_CONFIG.officePhone || '0489267771'); }} />
      </div>
    </section>

    <div class="block" style="margin-top:28px;display:grid;gap:10px">
      <${Button} kind="line" block icon="signout" onClick=${async () => {
        if (waiting.length && !(await ask({ title: 'Sign out with things waiting to send?', body: `${waiting.length} saved ${waiting.length === 1 ? 'change has' : 'changes have'} not reached the office yet. They stay on this phone and send when you sign back in.`, yes: 'Sign out anyway', danger: true }))) return;
        signOut();
      }}>Sign out<//>
      <p class="t-small t-mute" style="text-align:center">SecureWorks Crew ${window.CREW_CONFIG.version}${getState().demo ? ' · demo' : ''}</p>
    </div>
  </main>`;
}

function Row({ icon, title, sub, warn, onClick }) {
  return html`<button type="button" class="row" onClick=${onClick}>
    <span class="lead" style="width:auto;color:var(--ink-2)"><${Icon} name=${icon} size=${22} /></span>
    <span class="main"><b style="font-size:17px;font-stretch:92%;font-weight:640">${title}</b>${sub ? html`<span style=${warn ? 'color:var(--hi);font-weight:620' : ''}>${sub}</span>` : null}</span>
    <span class="trail"><${Icon} name="right" size=${18} /></span>
  </button>`;
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
