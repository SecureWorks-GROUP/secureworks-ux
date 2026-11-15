// The one door to the server. Same edge functions the current Trade App
// uses (ops-api and ghl-proxy), called the same way: `?action=<name>`, params
// always in the query string, POST only when there is a body, and exactly two
// headers. In demo mode every call is answered by the in-browser demo server.
import { getState } from './store.js';

const cfg = () => window.CREW_CONFIG || {};
const OPS = () => cfg().supabaseUrl + '/functions/v1/ops-api';
const GHL = () => cfg().supabaseUrl + '/functions/v1/ghl-proxy';
const TIMEOUT_MS = 20000;

let tokenSource = async () => null;
let onAuthLost = () => {};
let demoHandler = null;
export function configureApi({ getToken, authLost }) { tokenSource = getToken; onAuthLost = authLost; }
export function setDemoHandler(fn) { demoHandler = fn; }

// Owner's read-only "view as a trade" (same server feature the Trade App uses,
// secureworks-backend docs/trade-owner-preview.md). Every read carries the
// trade's id; the server allows only these reads and refuses every change.
let previewId = null;
const PREVIEW_READS = new Set(['trade_preview_context', 'trade_calendar', 'my_jobs', 'search_all_jobs', 'trade_job_detail', 'my_work_orders', 'my_job_work_order',
  'group_work_order_my_share', 'my_group_work_orders', 'my_hours', 'my_money', 'my_trade_invoices', 'get_trade_invoice', 'get_running_invoice_draft', 'my_invoices', 'crew_charges_on_my_jobs', 'trade_invoice_job_modes']);
export function setPreview(id) { previewId = id || null; }
export function previewing() { return previewId; }
function readOnly() { return new ApiError('Read only. You are viewing as a trade, so nothing can be changed or sent.', { status: 403, code: 'preview_read_only' }); }

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', body = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; this.code = code; this.body = body || {}; this.offline = offline;
  }
  /** The server understood and said no. Never queue or retry these. */
  get refused() {
    if (this.offline || !this.status) return false;
    if ([401, 408, 425, 429].includes(this.status)) return false;
    if (this.status >= 400 && this.status < 500) return true;
    return this.status === 500 && REFUSAL_500.test(this.message);
  }
}
// ops-api throws plain errors for these, so they arrive as HTTP 500.
const REFUSAL_500 = /not assigned to this job|not your assignment|assignment not found|makesafe job required|jobid required|jobid and text required|invalid status|report already (submitted|approved)|cannot complete a job with status/i;

/** Words a trade can act on, for any failure. */
export function friendly(err) {
  if (!err) return 'Something went wrong.';
  if (err.offline) return 'No signal. Check your connection and try again.';
  if (err.name === 'AbortError') return 'That took too long. Try again.';
  const b = err.body || {};
  const msg = b.userMessage || b.error || b.message || err.message;
  if (/not assigned to this job/i.test(msg || '')) return 'You are not on this job yet. Add yourself to it first.';
  if (/not your assignment/i.test(msg || '')) return 'That booking belongs to someone else.';
  if (err.status === 403 && b.code === 'operator_access_required') return 'That one is for the office. Ask them to do it.';
  return msg || 'Something went wrong. Try again.';
}

function buildUrl(base, action, params) {
  let url = base + '?action=' + action;
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    url += '&' + k + '=' + encodeURIComponent(v);
  }
  return url;
}

async function send(base, action, params, body, token, signal) {
  const init = { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, signal };
  if (body) init.body = JSON.stringify(body);
  let res;
  try { res = await fetch(buildUrl(base, action, params), init); } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new ApiError('No signal', { offline: true });
  }
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  if (!res.ok) {
    const b = parsed || {};
    throw new ApiError(b.userMessage || b.error || b.message || res.statusText || 'Request failed', { status: res.status, code: typeof b.code === 'string' ? b.code : '', body: b });
  }
  return parsed;
}

async function call(base, action, params, body, opts = {}) {
  if (getState().demo && demoHandler) return demoHandler(base === GHL() ? 'ghl' : 'ops', action, params || {}, body || null);
  if (previewId && action !== 'get_profile') {
    if (base !== OPS() || !PREVIEW_READS.has(action) || (body && action !== 'group_work_order_my_share')) throw readOnly();
    params = { ...(params || {}), preview_trade_user_id: previewId };
  }
  let token = await tokenSource();
  if (!token) throw new ApiError('Sign in required', { status: 401, code: 'auth_expired' });
  const attempt = async (tok) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout || TIMEOUT_MS);
    try { return await send(base, action, params, body, tok, ctl.signal); } finally { clearTimeout(timer); }
  };
  try {
    return await attempt(token);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    token = await tokenSource({ refresh: true });
    if (!token) { if (!opts.keepSession) onAuthLost(); throw err; }
    try { return await attempt(token); } catch (err2) {
      if (err2 instanceof ApiError && err2.status === 401 && !opts.keepSession) onAuthLost();
      throw err2;
    }
  }
}

/** ops-api. `body` present means a write (POST). */
export function api(action, params, body, opts) { return call(OPS(), action, params, body, opts); }
/** ghl-proxy (profile, customer text thread). */
export function ghl(action, params, body, opts) { return call(GHL(), action, params, body, opts); }

/** Fetch text (the price-free quote page) with the signed-in token. */
export async function apiText(action, params) {
  if (getState().demo && demoHandler) return demoHandler('ops-text', action, params || {}, null);
  if (previewId) throw readOnly();
  const token = await tokenSource();
  const res = await fetch(buildUrl(OPS(), action, params), { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) throw new ApiError('Could not open that document', { status: res.status });
  return res.text();
}

/** Upload a blob to the signed storage URL from get_upload_url. */
export async function putFile(uploadUrl, token, blob, contentType) {
  if (previewId) throw readOnly();
  if (getState().demo) { (window.__demoUploads = window.__demoUploads || {})[uploadUrl] = URL.createObjectURL(blob); return true; }
  let res;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, Authorization: 'Bearer ' + token }, body: blob });
  } catch { throw new ApiError('No signal', { offline: true }); }
  if (!res.ok) throw new ApiError('Upload failed', { status: res.status });
  return true;
}
