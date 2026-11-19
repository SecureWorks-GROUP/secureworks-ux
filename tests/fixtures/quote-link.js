/**
 * ZZTEST customer quote-link fixture and Playwright route mock for send-quote/view.
 *
 * All values are synthetic ZZTEST placeholders (no real token, client name,
 * address, amount, or job number). Use with quote-viewer.html or direct
 * navigation to ZZTEST_QUOTE_VIEW_URL in headless e2e tests.
 */

const SUPABASE_ORIGIN = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
const ZZTEST_QUOTE_TOKEN = 'ZZTEST-FIXTURE-TOKEN';
const ZZTEST_QUOTE_VIEW_URL =
  `${SUPABASE_ORIGIN}/functions/v1/send-quote/view?token=${encodeURIComponent(ZZTEST_QUOTE_TOKEN)}`;

const ZZTEST_QUOTE_VIEW_PAYLOAD = Object.freeze({
  token: ZZTEST_QUOTE_TOKEN,
  share_token: ZZTEST_QUOTE_TOKEN,
  quote_id: 'zztest-quote-0001',
  job_id: 'zztest-job-0001',
  job_number: 'ZZTEST-0001',
  client_name: 'ZZTEST Fixture Client',
  client_email: 'zztest-client@example.test',
  client_phone: '0400 000 000',
  site_address: '1 ZZTEST Way, ZZTEST Suburb WA 6000',
  quote_title: 'ZZTEST Patio Supply & Install',
  status: 'sent',
  currency: 'AUD',
  subtotal: 1000,
  gst: 100,
  total: 1100,
  valid_until: '2099-12-31',
  items: Object.freeze([
    Object.freeze({
      code: 'ZZTEST-ITEM-01',
      description: 'ZZTEST Fixture Scope Line',
      qty: 1,
      unit: 'ea',
      unit_price: 1000,
      line_total: 1000,
    }),
  ]),
  notes: 'ZZTEST synthetic quote fixture for automated headless rendering only.',
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAud(amount) {
  const num = Number(amount || 0);
  return '$' + num.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildQuoteViewUrl(token = ZZTEST_QUOTE_TOKEN) {
  return `${SUPABASE_ORIGIN}/functions/v1/send-quote/view?token=${encodeURIComponent(token)}`;
}

function buildQuoteViewerPath(token = ZZTEST_QUOTE_TOKEN) {
  return `/quote-viewer.html?src=${encodeURIComponent(buildQuoteViewUrl(token))}`;
}

/**
 * Renders self-contained HTML for the mocked send-quote/view response.
 * Makes zero external network requests.
 */
function renderQuoteViewHtml(payload = ZZTEST_QUOTE_VIEW_PAYLOAD) {
  const rows = (payload.items || []).map((item) => (
    `<tr>` +
    `<td>${escapeHtml(item.code)}</td>` +
    `<td>${escapeHtml(item.description)}</td>` +
    `<td>${escapeHtml(item.qty)} ${escapeHtml(item.unit)}</td>` +
    `<td>${escapeHtml(formatAud(item.line_total))}</td>` +
    `</tr>`
  )).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quote ${escapeHtml(payload.job_number)} — ZZTEST Fixture</title>
  <style>
    body { margin: 0; padding: 24px; background: #f5f5f7; color: #1a2332; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    .quote-shell { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .quote-badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #edf1f4; color: #293c46; font-size: 12px; font-weight: 600; }
    h1 { margin: 12px 0 6px; font-size: 22px; }
    .meta { color: #4c6a7c; font-size: 14px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 10px 8px; border-bottom: 1px solid #eaedf0; text-align: left; font-size: 14px; }
    .totals { margin-top: 16px; text-align: right; font-size: 15px; }
    .totals .grand { font-size: 18px; font-weight: 700; color: #293c46; margin-top: 6px; }
    .note { margin-top: 16px; font-size: 12px; color: #7c8898; }
  </style>
</head>
<body>
  <main class="quote-shell" data-testid="zztest-quote-view" data-token="${escapeHtml(payload.token)}">
    <span class="quote-badge" data-testid="quote-status">${escapeHtml(payload.status)}</span>
    <h1 data-testid="quote-title">${escapeHtml(payload.quote_title)}</h1>
    <div class="meta">
      <div>Job: <strong data-testid="quote-job-number">${escapeHtml(payload.job_number)}</strong></div>
      <div>Client: <span data-testid="quote-client-name">${escapeHtml(payload.client_name)}</span></div>
      <div>Site: <span data-testid="quote-site-address">${escapeHtml(payload.site_address)}</span></div>
      <div>Valid until: <span data-testid="quote-valid-until">${escapeHtml(payload.valid_until)}</span></div>
    </div>
    <table>
      <thead>
        <tr><th>Code</th><th>Description</th><th>Qty</th><th>Amount</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div>Subtotal: <span data-testid="quote-subtotal">${escapeHtml(formatAud(payload.subtotal))}</span></div>
      <div>GST: <span data-testid="quote-gst">${escapeHtml(formatAud(payload.gst))}</span></div>
      <div class="grand">Total (${escapeHtml(payload.currency)}): <span data-testid="quote-total">${escapeHtml(formatAud(payload.total))}</span></div>
    </div>
    <p class="note" data-testid="quote-notes">${escapeHtml(payload.notes)}</p>
  </main>
</body>
</html>`;
}

function isLocalUrl(url) {
  return /^(https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/|file:\/\/|data:|blob:|about:)/i.test(url);
}

/**
 * Installs a Playwright route mock for the customer quote link (send-quote/view).
 *
 * By default, also blocks any other non-local network requests when used
 * standalone (pass `{ blockExternal: false }` if another helper already
 * installed a catch-all network guard).
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [options]
 * @param {Partial<typeof ZZTEST_QUOTE_VIEW_PAYLOAD>} [options.payload]
 * @param {boolean} [options.blockExternal=true]
 */
async function installQuoteLinkMock(page, options = {}) {
  const payload = {
    ...ZZTEST_QUOTE_VIEW_PAYLOAD,
    ...(options.payload || {}),
  };
  const blockExternal = options.blockExternal !== false;
  const requests = [];

  if (blockExternal) {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (isLocalUrl(url)) return route.continue();
      return route.abort('blockedbyclient');
    });
  }

  await page.route(`${SUPABASE_ORIGIN}/functions/v1/send-quote/view**`, async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    const token = parsed.searchParams.get('token') || '';
    const accept = request.headers().accept || '';
    const wantsJson = parsed.searchParams.get('format') === 'json' || accept.includes('application/json');

    requests.push({
      url: request.url(),
      method: request.method(),
      token,
      wantsJson,
    });

    if (token !== payload.token) {
      return route.fulfill({
        status: 404,
        contentType: wantsJson ? 'application/json' : 'text/html; charset=utf-8',
        headers: { 'access-control-allow-origin': '*' },
        body: wantsJson
          ? JSON.stringify({ error: 'ZZTEST fixture quote token not found' })
          : '<!DOCTYPE html><html><body><h1>Quote not found</h1></body></html>',
      });
    }

    if (wantsJson) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(payload),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: renderQuoteViewHtml(payload),
    });
  });

  return {
    payload,
    requests,
    url: buildQuoteViewUrl(payload.token),
    viewerPath: buildQuoteViewerPath(payload.token),
  };
}

module.exports = {
  SUPABASE_ORIGIN,
  ZZTEST_QUOTE_TOKEN,
  ZZTEST_QUOTE_VIEW_URL,
  ZZTEST_QUOTE_VIEW_PAYLOAD,
  buildQuoteViewUrl,
  buildQuoteViewerPath,
  renderQuoteViewHtml,
  installQuoteLinkMock,
};
