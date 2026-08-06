#!/usr/bin/env node
/**
 * SES F2 — board-wide census of the work-order identity defect and its fix.
 *
 * Answers, from the live board rendered through THIS working tree's renderers:
 *   - how many make-safe cards carry more than one work-order document;
 *   - on how many of those the OLD rule (newest created_at wins) would have
 *     hidden a work order of a DIFFERENT purchase order — i.e. a different
 *     builder instruction, not a duplicate copy;
 *   - how many of those cards declare a purchase order of their own, which is
 *     the only thing that lets the viewer prefer one (rule 1) rather than
 *     present all of them unranked (rule 2).
 *
 *   npm run serve:e2e &                                          # :4173
 *   node scripts/ses-f2-workorder-identity-census.js             # census
 *   E2E_BASE_URL=http://127.0.0.1:4271 node scripts/...          # other port
 *
 * READ-ONLY BY CONSTRUCTION, the same way scripts/makesafe-ui-truth-census.js is:
 * every ops-api request is routed through this script and a non-GET is ABORTED
 * and fails the run. Since 2026-08-06 loading the board POSTs nothing at all (the
 * clean-intake sweep is an explicit control, not a render side effect), so the old
 * `?noAutoIntake=1` opt-out is gone and the abort rule is the only guard needed.
 *
 * PRIVACY BY CONSTRUCTION. Every response body is redacted BEFORE it reaches the
 * browser. The output keeps only job number, suburb, builder ref, PO refs and
 * work-order file names — work references, never client identity.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const API_HOST = 'kevgrhcjxspbxgovpmfl.supabase.co';
const OUT = arg('--out') || path.join('docs', 'evidence', 'ses-f2-workorder-viewer-identity-2026-08-02');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ── Redaction (identical rules to makesafe-ui-truth-census.js) ───────────────
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const RE_PHONE = /(?:\+?61[\s-]?|\b0)[2-9](?:[\s-]?\d){8}\b/g;
const STREET_TYPES = 'Street|St|Road|Rd|Avenue|Ave|Way|Court|Ct|Close|Cl|Drive|Dr|Place|Pl|Parade|Pde|Crescent|Cres|Terrace|Tce|Lane|Ln|Loop|Rise|View|Boulevard|Bvd|Highway|Hwy|Grove|Gardens|Gdns|Circuit|Cct|Ramble|Retreat|Green|Mews|Entrance|Vista|Bend|Brace|Approach|Elbow|Gate|Meander|Outlook|Pass|Quay|Quays|Ridge|Square|Sq|Trail|Turn|Walk|Crest|Hollow|Glade|Bay';
const RE_STREET = new RegExp(
  '\\b\\d{1,5}[a-zA-Z]?(?:[ \\t]*[-/][ \\t]*\\d{1,5}[a-zA-Z]?)?[ \\t]+(?:[A-Za-z\'’-]+[ \\t]+){0,3}(?:' + STREET_TYPES + ')\\b\\.?',
  'g'
);
const RE_NAME_KEY = /(client_name|contact_name|customer_name|recipient_name|first_name|last_name|full_name)/i;
const RE_PHONE_KEY = /(phone|mobile|telephone)/i;
const RE_EMAIL_KEY = /email/i;
const RE_ADDR_KEY = /address/i;
// file_name is opaque here on purpose: it is the evidence this census reads, and
// it carries only the builder claim ref and the PO.
const RE_OPAQUE_KEY = /^(url|href|src|token|share_token|id|.*_id|file_name|name|contract_version)$/i;

function scrub(text) {
  return String(text).replace(RE_EMAIL, '[email redacted]')
    .replace(RE_PHONE, '[phone redacted]')
    .replace(RE_STREET, '[street redacted]');
}
function redactAddress(value) {
  const parts = String(value || '').split(',');
  if (parts.length < 2) return value ? '[address redacted]' : value;
  return '[street redacted],' + scrub(parts.slice(1).join(','));
}
function redact(node, key) {
  if (Array.isArray(node)) return node.map((v) => redact(v, key));
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = redact(node[k], k);
    return out;
  }
  if (typeof node !== 'string' || !node) return node;
  if (RE_OPAQUE_KEY.test(key || '')) return node;
  if (RE_ADDR_KEY.test(key || '')) return redactAddress(node);
  if (RE_NAME_KEY.test(key || '')) return 'Client [redacted]';
  if (RE_PHONE_KEY.test(key || '')) return '[phone redacted]';
  if (RE_EMAIL_KEY.test(key || '')) return '[email redacted]';
  return scrub(node);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const requests = [];
  const violations = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await context.newPage();

  await page.route(`**://${API_HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const action = url.searchParams.get('action') || url.pathname.split('/').pop();
    if (req.method() !== 'GET') {
      requests.push({ method: req.method(), action, status: 'ABORTED — census is read-only' });
      violations.push(`refused a ${req.method()} to ${action}`);
      return route.abort();
    }
    let response;
    try {
      response = await route.fetch();
    } catch (e) {
      requests.push({ method: 'GET', action, status: 'network error' });
      return route.abort();
    }
    const status = response.status();
    let body;
    try {
      body = JSON.stringify(redact(await response.json(), null));
    } catch (e) {
      requests.push({ method: 'GET', action, status, note: 'non-JSON body withheld from the page' });
      return route.fulfill({ status: 204, body: '' });
    }
    requests.push({ method: 'GET', action, status });
    return route.fulfill({ status, contentType: 'application/json', body });
  });
  // Documents themselves are never fetched: a PDF cannot be redacted.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/supabase\.co\/storage|\.pdf($|\?)/i.test(url)) return route.abort();
    return route.fallback();
  });

  console.log(`opening ${BASE}/ops.html#jobs`);
  await page.goto(`${BASE}/ops.html#jobs`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.setPipelineTab === 'function');
  await page.evaluate(async () => {
    window.setPipelineTab('makesafes');
    if (!window._makesafeArchiveVisible) window.toggleMakesafeArchive();
    if (!window._makesafeCancelledVisible) window.toggleMakesafeCancelled();
  });
  await page.waitForSelector('.kanban-col[data-status] .kanban-card', { timeout: 40000 });
  await page.waitForTimeout(2500);

  const census = await page.evaluate(async () => {
    const cards = (window._pipelineData && window._pipelineData.columns) || {};
    const all = [];
    Object.keys(cards).forEach((s) => (cards[s] || []).forEach((j) => all.push(j)));

    const counts = { none: 0, single: 0, multi: 0 };
    const results = [];
    let cursor = 0;
    async function worker() {
      for (;;) {
        const i = cursor++;
        if (i >= all.length) return;
        const card = all[i];
        let data;
        try {
          data = await window.opsFetch('job_detail', { jobId: card.id });
        } catch (e) {
          results.push({ job_number: card.job_number, error: String(e && e.message).slice(0, 120) });
          continue;
        }
        const documents = (data && data.documents) || [];
        const wos = documents.filter(window.isMakesafeWorkOrderDoc);
        counts[wos.length >= 2 ? 'multi' : (wos.length === 1 ? 'single' : 'none')]++;
        if (wos.length < 2) continue;

        // What the OLD rule showed, and what it hid.
        const oldPick = window.pickLatestMakesafeDoc(documents, window.isMakesafeWorkOrderDoc);
        const hidden = wos.filter((d) => !oldPick || d.id !== oldPick.id);
        const poOf = (d) => window.extractPoRef(d && (d.file_name || d.name));
        const shownPo = poOf(oldPick);
        // A hidden work order carrying a DIFFERENT PO is a different builder
        // instruction, not the duplicate copy the old comment assumed.
        const hidDifferentInstruction = hidden.some((d) => poOf(d) && poOf(d) !== shownPo);

        const slots = window.buildMakesafeDocList(data).filter((e) => e.slot === 'work_order' && e.doc);
        const cardPoRefs = window.makesafeCardPoRefs(data);
        results.push({
          job_number: card.job_number,
          suburb: (data.job && data.job.site_suburb) || '',
          builder_ref: (data.makesafe_details && data.makesafe_details.external_ref) || card.external_ref || '',
          ses_family: card.ses_family || '',
          work_order_count: wos.length,
          work_order_pos: wos.map(poOf),
          card_po_refs: cardPoRefs,
          old_rule_showed: shownPo || (oldPick && oldPick.file_name) || '',
          old_rule_hid: hidden.map((d) => poOf(d) || d.file_name),
          old_rule_hid_a_different_instruction: hidDifferentInstruction,
          now_slot_labels: slots.map((e) => e.label),
          now_leading_po: slots[0] && slots[0].poRef,
          now_leading_matches_card_po: !!(slots[0] && slots[0].matchesCardPo),
          now_all_listed: slots.length === wos.length,
        });
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    return { cards_on_board: all.length, work_order_counts: counts, rows: results };
  });

  const errors = census.rows.filter((r) => r.error);
  const multi = census.rows.filter((r) => !r.error);
  const summary = {
    generated_by: 'scripts/ses-f2-workorder-identity-census.js',
    board: 'ops.html#jobs → Make-Safes',
    ui_read_at_commit: process.env.GIT_HEAD || '(set GIT_HEAD to stamp)',
    population: {
      cards_on_board: census.cards_on_board,
      job_detail_read_per_card: census.cards_on_board,
      job_detail_errors: errors.length,
      cards_by_work_order_count: census.work_order_counts,
    },
    cards_with_more_than_one_work_order: multi.length,
    of_those: {
      old_rule_hid_a_different_purchase_order: multi.filter((r) => r.old_rule_hid_a_different_instruction).length,
      card_declares_a_purchase_order_of_its_own: multi.filter((r) => r.card_po_refs.length > 0).length,
      now_leading_work_order_matches_the_card_po: multi.filter((r) => r.now_leading_matches_card_po).length,
      now_every_work_order_listed: multi.filter((r) => r.now_all_listed).length,
    },
    read_only_proof: {
      non_get_requests_aborted: requests.filter((r) => r.method !== 'GET').length,
      violations,
    },
    cards: multi.sort((a, b) => String(a.job_number).localeCompare(String(b.job_number))),
  };

  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, cards: `${multi.length} rows → census.json` }, null, 2));
  await browser.close();
  if (violations.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
