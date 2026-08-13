/**
 * Installs a tiny in-browser implementation of the Supabase auth methods used by
 * SecureWorks static tools. It exercises the app's real login/profile/rendering
 * code while preventing credentials or tokens from reaching Supabase.
 */
async function installSupabaseAuthStub(page, {
  users,
  profileEndpoint
}) {
  const authUsers = Object.fromEntries(Object.entries(users).map(([email, entry]) => [
    email.toLowerCase(),
    {
      password: entry.password,
      user: {
        id: entry.profile.id,
        email,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: {},
        user_metadata: {}
      }
    }
  ]));

  const browserStub = `(() => {
    const USERS = ${JSON.stringify(authUsers)};
    window.supabase = {
      createClient() {
        let session = null;
        const listeners = [];
        const notify = (event) => listeners.forEach((listener) => listener(event, session));
        const auth = {
          onAuthStateChange(listener) {
            listeners.push(listener);
            setTimeout(() => listener('INITIAL_SESSION', session), 0);
            return { data: { subscription: { unsubscribe() {} } } };
          },
          async signInWithPassword({ email, password }) {
            const record = USERS[String(email || '').toLowerCase()];
            if (!record || record.password !== password) {
              return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } };
            }
            session = {
              access_token: 'e2e-access-token',
              refresh_token: 'e2e-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
              user: record.user
            };
            notify('SIGNED_IN');
            return { data: { user: record.user, session }, error: null };
          },
          async getSession() { return { data: { session }, error: null }; },
          async refreshSession() { return { data: { session }, error: null }; },
          async signOut() {
            session = null;
            notify('SIGNED_OUT');
            return { error: null };
          },
          async getUser() { return { data: { user: session && session.user }, error: null }; }
        };
        const query = {
          select() { return query; }, insert() { return query; }, update() { return query; },
          delete() { return query; }, eq() { return query; }, order() { return query; },
          limit() { return query; }, single() { return Promise.resolve({ data: null, error: null }); },
          then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
        };
        return { auth, from() { return query; } };
      }
    };
  })();`;

  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: browserStub
  }));

  await page.route(`${profileEndpoint}**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('action') !== 'get_profile') {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Unstubbed profile action"}' });
      return;
    }
    const requestBody = route.request().postDataJSON() || {};
    const entry = Object.values(users).find((candidate) => candidate.profile.id === requestBody.userId);
    await route.fulfill({
      status: entry ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(entry ? { profile: entry.profile } : { error: 'Unknown E2E profile' })
    });
  });
}

// Two static tools ship two different login surfaces. trade.html carries its OWN
// Trade Login (#loginEmail/#loginPassword/#btnLogin, no shared/auth-gate.js since
// PR 260); ops.html and the other dashboards still boot behind the ops auth-gate
// overlay (#swAuthGate + #swAuthEmail/#swAuthPassword/#swAuthSubmit). Detect the
// trade surface and drive its fields, waiting for the trade post-login UI
// (#bottomNav appears, #viewLogin goes inactive) — the ops #swAuthGate never
// exists on trade.html, so waiting for it to detach would hang forever.
async function signIn(page, { email, password }) {
  const isTradeLogin = await page.locator('#loginEmail').count() > 0;
  if (isTradeLogin) {
    await page.locator('#loginEmail').fill(email);
    await page.locator('#loginPassword').fill(password);
    await page.locator('#btnLogin').click();
    await page.locator('#bottomNav').waitFor({ state: 'visible' });
    await page.locator('#viewLogin').waitFor({ state: 'hidden' });
    return;
  }
  await page.locator('#swAuthEmail').fill(email);
  await page.locator('#swAuthPassword').fill(password);
  await page.locator('#swAuthSubmit').click();
  await page.locator('#swAuthGate').waitFor({ state: 'detached' });
  await page.locator('#bottomNav').waitFor({ state: 'visible' });
}

module.exports = { installSupabaseAuthStub, signIn };
