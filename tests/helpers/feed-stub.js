const fs = require('node:fs');
const path = require('node:path');

function perthDate() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function addIsoDays(iso, amount) {
  const [year, month, day] = iso.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function perthWeekMonday() {
  const today = perthDate();
  const [year, month, day] = today.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekDay = value.getUTCDay();
  return addIsoDays(today, -(weekDay === 0 ? 6 : weekDay - 1));
}

function loadJsonFixture(fileName, replacements = {}) {
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', fileName);
  const monday = perthWeekMonday();
  const values = {
    TODAY: perthDate(),
    CURRENT_MONDAY: monday,
    CURRENT_TUESDAY: addIsoDays(monday, 1),
    CURRENT_WEDNESDAY: addIsoDays(monday, 2),
    CURRENT_THURSDAY: addIsoDays(monday, 3),
    PREVIOUS_MONDAY: addIsoDays(monday, -7),
    HISTORICAL_MONDAY: addIsoDays(monday, -84),
    FUTURE_MONDAY: addIsoDays(monday, 182),
    NOW: new Date().toISOString(),
    ...replacements
  };
  let source = fs.readFileSync(fixturePath, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    source = source.replaceAll(`{{${key}}}`, String(value));
  }
  return JSON.parse(source);
}

/**
 * Generic edge-function router for static-app tests.
 * Every action is explicit. Unknown reads receive 404 and every unapproved write
 * is recorded and rejected before it can leave the browser.
 */
async function installFeedStubs(page, {
  endpoint,
  actions,
  allowedWriteActions = [],
  requestLog = []
}) {
  const unexpectedWrites = [];
  const allowed = new Set(allowedWriteActions);

  await page.route(`${endpoint}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action') || '';
    const isWrite = request.method() !== 'GET';
    requestLog.push({
      method: request.method(),
      action,
      url: request.url(),
      authorization: request.headers().authorization || '',
      body: isWrite ? request.postDataJSON() : null
    });

    if (isWrite && !allowed.has(action)) {
      unexpectedWrites.push(`${request.method()} ${action || url.pathname}`);
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: `E2E blocked unapproved write: ${action}` })
      });
      return;
    }

    const handler = actions[action];
    if (handler === undefined) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `No E2E fixture registered for ${action || 'unknown action'}` })
      });
      return;
    }

    const result = typeof handler === 'function'
      ? await handler({ request, url, action })
      : handler;
    const response = result && Number.isInteger(result.status) && Object.hasOwn(result, 'body')
      ? result
      : { status: 200, body: result };
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body)
    });
  });

  return { unexpectedWrites, requestLog };
}

/**
 * Catch-all safety net. Registered before every other route so it resolves last.
 * Same-origin app assets (served by the local static server or an approved
 * E2E_BASE_URL deployment) fall through to their handlers; any other outbound
 * request is recorded and aborted so a mocked run can never reach a real
 * production or third-party endpoint that lacks an explicit stub.
 */
async function installExternalRequestGuard(page, { allowedOrigins = [] } = {}) {
  const allowed = new Set(allowedOrigins);
  const blockedRequests = [];

  await page.route('**/*', async (route) => {
    const request = route.request();
    let origin = null;
    try { origin = new URL(request.url()).origin; } catch { origin = null; }

    if (origin && allowed.has(origin)) {
      await route.fallback();
      return;
    }

    blockedRequests.push(`${request.method()} ${request.url()}`);
    await route.abort();
  });

  return { blockedRequests };
}

module.exports = { installFeedStubs, installExternalRequestGuard, loadJsonFixture, perthDate, perthWeekMonday, addIsoDays };
