// Sign in. Same email and password as the current Trade App.
import { html, useState } from '../lib/h.js';
import { signIn, sendReset } from '../lib/auth.js';
import { getState, local } from '../lib/store.js';
import { Button, Field } from '../ui/kit.js';
import { Logo } from '../ui/logo.js';

export function Login() {
  const [mode, setMode] = useState('in'); // in | forgot | sent
  const [email, setEmail] = useState(local.get('email', ''));
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bootError = getState().bootError;

  const submit = async (e) => {
    e.preventDefault();
    if (getState().demo) { window.__crewDemoSignIn(); return; }
    setError(''); setBusy(true);
    try {
      if (mode === 'forgot') { await sendReset(email); setMode('sent'); } else { local.set('email', email.trim()); await signIn(email, password); }
    } catch (err) { setError(err.message || 'Could not sign in. Try again.'); }
    setBusy(false);
  };

  return html`<div class="login">
    <div class="login-top">
      <${Logo} height=${30} />
      <div style="display:grid;gap:8px"><h1 class="login-hello">Crew sign in</h1><i class="login-accent" aria-hidden="true" /></div>
      <p class="login-sub">Your jobs, your hours, your pay. Same email and password as the Trade app.</p>
    </div>
    <form class="login-form" onSubmit=${submit}>
      ${mode === 'sent' ? html`
        <h2 class="t-head">Check your email</h2>
        <p class="t-small">If that email has an account, a reset link is on its way. Open it, set a new password, then come back here and sign in.</p>
        <${Button} kind="line" block onClick=${() => setMode('in')}>Back to sign in<//>
      ` : html`
        <${Field} label="Email" error=${mode === 'forgot' ? error : ''}>
          <input class="input" type="email" autocomplete="username" inputmode="email" autocapitalize="none" required value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} placeholder="you@email.com" />
        <//>
        ${mode === 'in' ? html`<${Field} label="Password" error=${error}>
          <input class="input" type="password" autocomplete="current-password" required value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} />
        <//>` : html`<p class="t-small">We will email you a link to set a new password.</p>`}
        ${bootError ? html`<div class="note-banner bad">No signal. Sign in needs a connection the first time.</div>` : null}
        <${Button} type="submit" block class="big" busy=${busy}>${mode === 'in' ? 'Sign in' : 'Send reset link'}<//>
        <${Button} kind="quiet" block onClick=${() => { setError(''); setMode(mode === 'in' ? 'forgot' : 'in'); }}>${mode === 'in' ? 'Forgot password?' : 'Back to sign in'}<//>
      `}
    </form>
  </div>`;
}
