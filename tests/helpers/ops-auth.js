/**
 * Installs a persisted Supabase operator session before ops.html boots.
 * Use for Ops interaction specs whose real subject is not authentication.
 */
async function installOpsSessionStub(page) {
  await page.addInitScript(() => {
    const user = {
      id: '00000000-0000-4000-8000-000000000099',
      email: 'ops-e2e@example.test',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
    };
    let session = {
      access_token: 'e2e-ops-access-token',
      refresh_token: 'e2e-ops-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    const listeners = [];
    const auth = {
      async getSession() { return { data: { session }, error: null }; },
      async getUser() { return { data: { user: session && session.user }, error: null }; },
      async refreshSession() { return { data: { session }, error: null }; },
      async signInWithPassword() { return { data: { user, session }, error: null }; },
      async signInWithOtp() { return { data: {}, error: null }; },
      async signOut() {
        session = null;
        listeners.forEach((listener) => listener('SIGNED_OUT', null));
        return { error: null };
      },
      onAuthStateChange(listener) {
        listeners.push(listener);
        setTimeout(() => listener('INITIAL_SESSION', session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    };
    const query = {
      select() { return query; }, insert() { return query; }, update() { return query; },
      delete() { return query; }, eq() { return query; }, order() { return query; },
      limit() { return query; }, single() { return Promise.resolve({ data: null, error: null }); },
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    window.supabase = {
      createClient() {
        return {
          auth,
          from() { return query; },
          channel() {
            return { on() { return this; }, subscribe() { return this; } };
          },
        };
      },
    };
  });
}

/**
 * Static renderer specs do not boot or call an API. Remove only the visual gate
 * after proving the page's real functions loaded, so their DOM remains measurable.
 */
async function revealOpsStaticFixture(page) {
  await page.evaluate(() => {
    const gate = document.getElementById('swAuthGate');
    const style = document.getElementById('swAuthGateStyle');
    if (gate) gate.remove();
    if (style) style.remove();
  });
}

module.exports = { installOpsSessionStub, revealOpsStaticFixture };
