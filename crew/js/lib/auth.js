// Sign-in and "who am I". Uses the same Supabase project and the same saved
// session as the current Trade App, so a trade signed in there is signed in
// here (and signing out of one signs out of both).
import { getState, setState, local, clearQueries } from './store.js';
import { configureApi, ghl } from './api.js';

let sb = null;
let session = null;
let profileFor = null;

export function supabaseClient() { return sb; }

async function getToken({ refresh = false } = {}) {
  if (!sb) return null;
  try {
    if (refresh) {
      const { data } = await sb.auth.refreshSession();
      session = data && data.session ? data.session : null;
      return session ? session.access_token : null;
    }
    const soon = Math.floor(Date.now() / 1000) + 300;
    if (session && session.expires_at && session.expires_at < soon) {
      const { data } = await sb.auth.refreshSession();
      if (data && data.session) session = data.session;
    }
    if (!session) {
      const { data } = await sb.auth.getSession();
      session = data ? data.session : null;
    }
    return session ? session.access_token : null;
  } catch { return session ? session.access_token : null; }
}

async function loadProfile(authUser) {
  if (!authUser) return;
  if (profileFor === authUser.id && getState().user) return;
  profileFor = authUser.id;
  const saved = local.get('profile');
  if (saved && saved.id === authUser.id && !getState().user) setState({ user: decorate(saved), ready: true });
  try {
    const res = await ghl('get_profile', null, { userId: authUser.id, email: authUser.email || '' });
    if (res && res.profile) {
      local.set('profile', res.profile);
      setState({ user: decorate(res.profile), ready: true });
      return;
    }
  } catch { /* keep the saved one */ }
  if (!getState().user) {
    setState({ user: decorate({ id: authUser.id, email: authUser.email, name: (authUser.email || '').split('@')[0] }), ready: true });
  }
}

/** Add the handful of derived answers every screen asks. */
export function decorate(p) {
  const managed = Array.isArray(p.managed_verticals) ? [...new Set(p.managed_verticals.map((v) => String(v).toLowerCase()).filter(Boolean))] : [];
  const office = p.role === 'admin' || p.role === 'ops_manager' || p.role === 'owner';
  const details = p.trade_details && typeof p.trade_details === 'object' ? p.trade_details : {};
  let label = 'Crew';
  if (office) label = 'Office';
  else if (managed.length) label = managed.map((v) => v[0].toUpperCase() + v.slice(1)).join(' and ') + ' manager';
  else if (p.role === 'lead_installer') label = 'Lead installer';
  else if (p.invoice_type === 'per_metre') label = 'Work order trade';
  return {
    ...p,
    name: p.name || p.full_name || details.fullName || (p.email || '').split('@')[0] || 'You',
    managed,
    office,
    manager: office || managed.length > 0,
    seesMoney: office,
    perMetre: p.invoice_type === 'per_metre',
    gstDefault: details.gstRegistered === true,
    details,
    label
  };
}
export function manages(user, vertical) { return Boolean(user && (user.office || user.managed.includes(vertical))); }

export async function initAuth() {
  configureApi({ getToken, authLost: () => signOut() });
  if (getState().demo) return;
  const { supabaseUrl, supabaseKey } = window.CREW_CONFIG;
  if (!window.supabase || !window.supabase.createClient) { setState({ ready: true, bootError: 'offline' }); return; }
  sb = window.supabase.createClient(supabaseUrl, supabaseKey);
  sb.auth.onAuthStateChange((event, next) => {
    session = next || null;
    if (event === 'SIGNED_OUT' || !next) {
      profileFor = null;
      if (event === 'SIGNED_OUT') { local.del('profile'); clearQueries(); }
      setState({ user: null, ready: true, clock: null });
      return;
    }
    if (event === 'PASSWORD_RECOVERY') setState({ recovery: true });
    // Never await inside this callback: supabase-js holds a lock while it runs.
    setTimeout(() => loadProfile(next.user), 0);
  });
  const { data } = await sb.auth.getSession();
  session = data ? data.session : null;
  if (!session) setState({ ready: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) getToken(); });
}

export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
}
export async function signOut() {
  if (getState().demo) { setState({ user: null }); return; }
  try { await sb.auth.signOut(); } catch { /* already out */ }
}
/** Sends the reset email. The link opens the existing Trade App page, which is
 *  the address the sign-in service allows; the new password works here too. */
export async function sendReset(email) {
  const redirectTo = (window.CREW_CONFIG.resetRedirect) || 'https://secureworks-group.github.io/secureworks-ux/trade.html';
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error && !/not.?found/i.test(error.message)) throw new Error(error.message);
}
export async function changePassword(password) {
  if (getState().demo) return;
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
export async function refreshProfile() {
  if (getState().demo || !session) return;
  profileFor = null;
  await loadProfile(session.user);
}
