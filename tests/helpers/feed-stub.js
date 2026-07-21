const fs = require('node:fs');
const path = require('node:path');

function perthDate() {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function loadJsonFixture(fileName, replacements = {}) {
  const fixturePath = path.resolve(__dirname, '..', 'fixtures', fileName);
  const values = {
    TODAY: perthDate(),
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
  allowedWriteActions = []
}) {
  const unexpectedWrites = [];
  const allowed = new Set(allowedWriteActions);

  await page.route(`${endpoint}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.searchParams.get('action') || '';
    const isWrite = request.method() !== 'GET';

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

  return { unexpectedWrites };
}

module.exports = { installFeedStubs, loadJsonFixture, perthDate };
