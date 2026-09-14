#!/usr/bin/env node
/**
 * Isolated Sales Booking preview.
 * Serves this worktree and, for sales_booking_read only, calls the local
 * sw-mcp calendar read. Product JS never ships a fixture fallback.
 * Does not send SMS, write calendars, or deploy.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { handleLocal } from './sales-booking-local-api.mjs';

const require = createRequire(import.meta.url);
const assess = require('../modules/sales-booking-assess.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SALES_BOOKING_PREVIEW_PORT || 4174);
const MCP = process.env.SW_MCP || path.join(os.homedir(), '.local/bin/sw-mcp');
const HOST = '127.0.0.1';

const RESOURCES = {
  nithin: { id: 'nithin', name: 'Nithin', scoper_user_id: '5862cf1d-0a3b-4836-8fd1-d69f95aa2f73', lane: 'patio', sender: '+61489267774' },
  marnin: { id: 'marnin', name: 'Marnin', scoper_user_id: '706c5258-70dd-483a-b36c-af6864b24498', lane: 'fencing', sender: '+61489267772' },
  khairo: { id: 'khairo', name: 'Khairo', scoper_user_id: 'be6c2188-2b7b-49c7-b6e4-5b0d0deb6415', lane: 'fencing', sender: '+61489267772' }
};

const OPEN_CASES = {
  nithin: [
    { id: 'carlisle', contact_id: 'lzDhp42dobzHkWcobELw', suburb: 'Carlisle', status: 'ready' },
    { id: 'merriwa', contact_id: 'CGKe1K4CGdiyas0O4CF2', suburb: 'Merriwa', status: 'ready' },
    { id: 'mt-hawthorn', contact_id: '4Br9KgbHjzyQSko5mP9O', suburb: 'Mt Hawthorn', status: 'needs_decision' },
    { id: 'fremantle', contact_id: '9WW7WNfh6sl91Syqc2t3', suburb: 'Fremantle', status: 'waiting' },
    { id: 'scarborough', contact_id: 'mfIowxn0WUitsoZ4HG4r', suburb: 'Scarborough', status: 'waiting' },
    { id: 'marangaroo', contact_id: 'G3wHUgxtmdxiDmTef0iQ', suburb: 'Marangaroo', status: 'repair' }
  ]
};

function mime(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function mcpCall(tool, args) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-booking-mcp-'));
    const argsFile = path.join(dir, 'args.json');
    const outFile = path.join(dir, 'out.json');
    fs.writeFileSync(argsFile, JSON.stringify(args));
    const child = spawn(MCP, ['call', tool, '--args-file', argsFile, '--out', outFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('sw-mcp timed out for ' + tool));
    }, 45000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (!fs.existsSync(outFile)) {
          reject(new Error(err || ('sw-mcp exit ' + code + ' with no receipt')));
          return;
        }
        const raw = fs.readFileSync(outFile, 'utf8');
        const parsed = JSON.parse(raw);
        let body = parsed;
        if (parsed && parsed.result && Array.isArray(parsed.result.content) && parsed.result.content[0]) {
          const block = parsed.result.content[0];
          body = block.text ? JSON.parse(block.text) : (block.json || parsed.result);
        } else if (parsed.result && !parsed.events) {
          body = parsed.result;
        }
        resolve(typeof body === 'string' ? JSON.parse(body) : body);
      } catch (e) {
        reject(new Error(e.message + (err ? ' / ' + err.slice(0, 400) : '')));
      }
    });
  });
}

function suburbFromEvent(ev) {
  const loc = ev.location_display_name || '';
  const subj = ev.subject || '';
  const m = loc.match(/,\s*([^,]+?)\s+WA/i) || subj.match(/,\s*([^,]+)$/);
  return m ? m[1].trim() : '';
}

function displayFromEvent(ev) {
  const s = ev.subject || 'Diary';
  return s.replace(/^Scope:\s*/i, '').split(',')[0].trim() || s;
}

function interpretProposal(messages, suburb, resourceId, weekStart, events, coverage) {
  const spec = RESOURCES[resourceId] || RESOURCES.nithin;
  const rules = resourceId === 'nithin'
    ? { monday_from: 12, no_wednesday: true, last_start: 15.5 }
    : { monday_from: 8, no_wednesday: false, last_start: 15.5 };
  return assess.assess({
    week_start: weekStart,
    resource: { name: spec.name, lane: spec.lane, desk_rules: rules },
    suburb,
    messages,
    events,
    pending_offers: [],
    coverage: coverage || { calendar: false, leave: 'not_read', route: false, travel: false }
  });
}

async function salesBookingRead(query) {
  const resourceId = query.get('resource') || 'nithin';
  const weekStart = query.get('week_start') || '2026-09-14';
  const spec = RESOURCES[resourceId];
  if (!spec) {
    return { ok: false, error: 'Unknown resource. Use nithin, marnin or khairo.' };
  }
  const since = weekStart + 'T00:00:00+08:00';
  const untilDate = new Date(Date.UTC(...weekStart.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v))));
  untilDate.setUTCDate(untilDate.getUTCDate() + 5);
  const until = untilDate.toISOString().slice(0, 10) + 'T00:00:00+08:00';
  const cal = await mcpCall('sw_scoper_calendar_events', {
    scoper_user_id: spec.scoper_user_id,
    since,
    until,
    timezone: 'Australia/Perth'
  });
  const events = (cal.events || []).map((ev) => ({
    event_id: ev.event_id,
    subject: ev.subject,
    start_iso: ev.start_iso,
    end_iso: ev.end_iso,
    timezone: ev.timezone || 'Australia/Perth',
    show_as: ev.show_as,
    suburb: suburbFromEvent(ev),
    display_name: displayFromEvent(ev),
    duration_minutes: null,
    layer: 'confirmed',
    case_id: ev.event_id
  }));
  const cases = events.map((ev) => ({
    id: ev.event_id,
    contact_id: null,
    suburb: ev.suburb,
    display_name: ev.display_name,
    status: /jason|marangaroo/i.test(ev.subject || '') ? 'repair' : 'booked',
    reason: /jason|marangaroo/i.test(ev.subject || '')
      ? 'Customer cancelled. Outlook still occupies this slot until authorised deletion is read back.'
      : 'Provider calendar event. Booked visits stay on the workload until scoped.',
    event_id: ev.event_id,
    proposal: null
  }));
  const extra = OPEN_CASES[resourceId] || [];
  for (const row of extra) {
    let proposal = null;
    let display = row.suburb + ' enquiry';
    let status = row.status;
    let reason = 'Open enquiry on the proof-week work list. Conversation is loaded from GHL when selected.';
    try {
      const convo = await mcpCall('sw_get_conversation', { contact_id: row.contact_id });
      const messages = convo.messages || convo.result?.messages || [];
      const coverage = {
        calendar: !!(cal.ok !== false && cal.coverage && cal.coverage.calendar_view_complete),
        leave: (cal.coverage && cal.coverage.operational_leave === 'not_read') ? 'not_read' : false,
        route: false,
        travel: false
      };
      const interp = interpretProposal(messages, row.suburb, resourceId, weekStart, events, coverage);
      if (convo.contact && convo.contact.name) display = convo.contact.name;
      if (interp) {
        status = interp.status;
        reason = interp.reason;
        if (interp.proposal) {
          proposal = Object.assign({ kind: interp.exact_acceptance ? 'offer' : 'proposal' }, interp.proposal);
        }
        if (interp.exact_acceptance) {
          status = 'needs_decision';
        }
      }
    } catch {
      reason = 'GHL conversation was not retrieved in this preview read. Select the case to load the thread through the signed-in GHL path.';
    }
    cases.push({
      id: row.id,
      contact_id: row.contact_id,
      suburb: row.suburb,
      display_name: display,
      status,
      reason,
      event_id: null,
      proposal
    });
  }
  return {
    ok: true,
    send_hold: true,
    fixture: false,
    source: 'sw_scoper_calendar_events via isolated preview',
    resource: {
      id: spec.id,
      name: spec.name,
      scoper_user_id: spec.scoper_user_id,
      lane: spec.lane,
      sender: spec.sender,
      calendar: {
        ok: cal.ok !== false,
        mailbox: cal.work_calendar_email,
        can_edit: !!(cal.primary_calendar && cal.primary_calendar.can_edit),
        leave: 'not_read',
        error: cal.ok === false ? (cal.error || 'calendar read failed') : null
      }
    },
    week_start: weekStart,
    timezone: 'Australia/Perth',
    retrieved_at: cal.retrieved_at,
    coverage: {
      primary_calendar_identity_verified: !!(cal.coverage && cal.coverage.primary_calendar_identity_verified),
      calendar_view_complete: !!(cal.coverage && cal.coverage.calendar_view_complete),
      operational_leave: 'not_read',
      non_primary_calendars: 'not_read',
      full_population: false,
      gaps: [
        'Preview read uses sw-mcp; live ops-api sales_booking_read is not deployed.',
        'Enquiry population outside this scoper/week is not loaded.',
        '152 stage-only unresolved patio rows remain on the audit queue.'
      ]
    },
    events,
    cases
  };
}

function inject(html) {
  const tag = '<script>window.SALES_BOOKING_PREVIEW_URL="http://' + HOST + ':' + PORT + '/sales-booking-read";window.SALES_BOOKING_PREVIEW_API="http://' + HOST + ':' + PORT + '/booking-api";</script>';
  if (html.includes('</head>')) return html.replace('</head>', tag + '</head>');
  return tag + html;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const STORE = path.join(ROOT, '.sales-booking-preview-store.json');
  if (url.pathname === '/sales-booking-read' || url.pathname === '/booking-api') {
    try {
      let payload = {};
      if (req.method === 'POST') {
        payload = JSON.parse(await new Promise((resolve, reject) => {
          let raw = '';
          req.on('data', (c) => { raw += c; });
          req.on('end', () => resolve(raw || '{}'));
          req.on('error', reject);
        }));
      }
      const action = url.searchParams.get('action') || (url.pathname === '/sales-booking-read' ? 'sales_booking_read' : payload.action);
      const params = Object.fromEntries(url.searchParams.entries());
      let body;
      if (action === 'sales_booking_read') {
        const enumerated = await handleLocal('sales_booking_read', params, payload, mcpCall, STORE);
        const calBody = await salesBookingRead(url.searchParams);
        body = Object.assign({}, calBody, enumerated, {
          events: calBody.events,
          cases: [].concat(enumerated.cases || [], (calBody.cases || []).filter((c) => c.event_id)),
          fixture: false
        });
      } else {
        body = await handleLocal(action, params, payload, mcpCall, STORE);
      }
      res.writeHead(body.ok === false ? 400 : 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, fixture: false, error: e.message }));
    }
    return;
  }
  let filePath = path.join(ROOT, url.pathname === '/' ? 'ops.html' : decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let buf = fs.readFileSync(filePath);
  if (filePath.endsWith('ops.html')) buf = Buffer.from(inject(buf.toString('utf8')), 'utf8');
  res.writeHead(200, { 'content-type': mime(filePath), 'cache-control': 'no-store' });
  res.end(buf);
});

server.listen(PORT, HOST, () => {
  process.stdout.write('Sales Booking preview http://' + HOST + ':' + PORT + '/ops.html#booking\n');
});
