#!/usr/bin/env node
/**
 * PLAN v2 Batch 2 — reproducible UI-truth census for the ops make-safe board.
 *
 * Every number the evidence README quotes is produced HERE, by this script, from
 * the live canonical feed rendered through this working tree's own renderers.
 * Nothing is counted by eye off a screenshot.
 *
 *   npm run serve:e2e &                                  # serves this tree on :4173
 *   node scripts/makesafe-ui-truth-census.js --shots     # census + capture
 *
 * READ-ONLY BY CONSTRUCTION. Every `ops-api` request the page makes is routed
 * through this script. A non-GET is ABORTED and fails the run, so the session
 * cannot write even if the page tries. Since 2026-08-06 loading the board POSTs
 * nothing at all (the clean-intake sweep is an explicit control, not a render side
 * effect), so the old `?noAutoIntake=1` opt-out is gone.
 *
 * PRIVACY BY CONSTRUCTION. Every response body is redacted BEFORE it reaches the
 * browser: client names, phone numbers, email addresses and street lines never
 * enter the DOM, so they cannot enter a screenshot either. Suburb, builder,
 * builder ref and job number are retained — they are work references, not client
 * identity. After rendering, the DOM is scanned for phone/email/street patterns
 * and the run FAILS if any survive. Embedded document previews (work-order and
 * invoice PDFs, which this script cannot redact inside) are replaced with a
 * placeholder before any capture.
 *
 * Outputs (all privacy-safe, all committed as evidence):
 *   census.json   population identity + every per-check total + the privacy scan
 *   cards.csv     the per-card DOM/feed join the totals are computed from
 *   requests.json every ops-api request of the session: method, action, status
 *   console.json  every console message of the session
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const API_HOST = 'kevgrhcjxspbxgovpmfl.supabase.co';
const OUT = arg('--out') || path.join('docs', 'evidence', 'ses-b2-ui-truth-2026-08-02');
const SHOTS = process.argv.includes('--shots');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ── Redaction ────────────────────────────────────────────────────────────────
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const RE_PHONE = /(?:\+?61[\s-]?|\b0)[2-9](?:[\s-]?\d){8}\b/g;
const STREET_TYPES = 'Street|St|Road|Rd|Avenue|Ave|Way|Court|Ct|Close|Cl|Drive|Dr|Place|Pl|Parade|Pde|Crescent|Cres|Terrace|Tce|Lane|Ln|Loop|Rise|View|Boulevard|Bvd|Highway|Hwy|Grove|Gardens|Gdns|Circuit|Cct|Ramble|Retreat|Green|Mews|Entrance|Vista|Bend|Brace|Approach|Elbow|Gate|Meander|Outlook|Pass|Quay|Quays|Ridge|Square|Sq|Trail|Turn|Walk|Crest|Hollow|Glade|Bay';
const RE_STREET = new RegExp(
  '\\b\\d{1,5}[a-zA-Z]?(?:[ \\t]*[-/][ \\t]*\\d{1,5}[a-zA-Z]?)?[ \\t]+(?:[A-Za-z\'’-]+[ \\t]+){0,3}(?:' + STREET_TYPES + ')\\b\\.?',
  'g'
);
// Keys whose whole value is client identity, whatever it looks like.
const RE_NAME_KEY = /(client_name|contact_name|customer_name|recipient_name|first_name|last_name|full_name)/i;
const RE_PHONE_KEY = /(phone|mobile|telephone)/i;
const RE_EMAIL_KEY = /email/i;
const RE_ADDR_KEY = /address/i;
// Opaque machine values: scrubbing them would corrupt the page without
// protecting anybody.
const RE_OPAQUE_KEY = /^(url|href|src|token|share_token|id|.*_id|contract_version)$/i;

function scrub(text) {
  return String(text).replace(RE_EMAIL, '[email redacted]')
    .replace(RE_PHONE, '[phone redacted]')
    .replace(RE_STREET, '[street redacted]');
}

// An address keeps only its suburb tail: the board reads the suburb off it, and a
// suburb on its own identifies nobody.
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

// ── Session ──────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const requests = [];
  const consoleMessages = [];
  const violations = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on('console', (m) => consoleMessages.push({ type: m.type(), text: m.text().slice(0, 400) }));
  page.on('pageerror', (e) => consoleMessages.push({ type: 'pageerror', text: String(e && e.message).slice(0, 400) }));

  // Every API call of the session passes through here.
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
      // Non-JSON (a PDF, an image): never forwarded, since it cannot be redacted.
      requests.push({ method: 'GET', action, status, note: 'non-JSON body withheld from the page' });
      return route.fulfill({ status: 204, body: '' });
    }
    requests.push({ method: 'GET', action, status });
    return route.fulfill({ status, contentType: 'application/json', body });
  });

  // Storage / document hosts: never loaded. Their contents (work-order and
  // invoice PDFs) carry builder contact details this script cannot redact.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (/supabase\.co\/storage|\.pdf($|\?)/i.test(url)) return route.abort();
    return route.fallback();
  });

  console.log(`opening ${BASE}/ops.html#jobs`);
  await page.goto(`${BASE}/ops.html#jobs`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.setPipelineTab === 'function');

  // The make-safe board, every column expanded, as the census population.
  await page.evaluate(async () => {
    window.setPipelineTab('makesafes');
    if (!window._makesafeArchiveVisible) window.toggleMakesafeArchive();
    if (!window._makesafeCancelledVisible) window.toggleMakesafeCancelled();
  });
  await page.waitForSelector('.kanban-col[data-status="report_ready"] .kanban-card, .kanban-col[data-status="report_ready"] .kanban-empty', { timeout: 30000 });
  await page.waitForTimeout(2500); // let the close-out enrichment join land

  const census = await page.evaluate(() => {
    // The canonical feed as the page itself holds it, joined to what the page
    // actually painted. Both sides come from the running board, not from a
    // separate re-fetch, so the join cannot drift.
    const byId = {};
    const columns = {};
    document.querySelectorAll('.kanban-col[data-status]').forEach((col) => {
      const stage = col.getAttribute('data-status');
      columns[stage] = col.querySelectorAll('.kanban-card').length;
      col.querySelectorAll('.kanban-card[data-job-id]').forEach((card) => {
        byId[card.getAttribute('data-job-id')] = {
          renderedColumn: stage,
          familyTag: (card.querySelector('.ms-ttag') || {}).textContent || '',
          familyTagUnknownClass: !!card.querySelector('.ms-ttag.unknown'),
          noPackChip: !!card.querySelector('.ms-nopack'),
          builderLinks: card.querySelectorAll('a.ms-link').length,
          anchors: card.querySelectorAll('a[href]').length,
        };
      });
    });

    const rows = [];
    const cards = (window._pipelineData && window._pipelineData.columns) || {};
    Object.keys(cards).forEach((stage) => {
      (cards[stage] || []).forEach((j) => {
        const dom = byId[j.id] || {};
        const expectedFamily = getSesFamilyLabel(j) || 'Family not determined';
        // The stage the DETAIL would show for this job, resolved exactly as the
        // detail resolves it, and the stage the pre-change client derivation
        // would have shown instead.
        const detailStage = resolveMakesafeDetailStage({ job: { id: j.id } });
        // What the detail showed BEFORE this change: getMakesafeStage over a
        // `job_detail` payload, which carries no stage of any kind, so the
        // derivation fell through to substatus. Emulated by hiding every stage
        // key from it — that is precisely what job_detail does not send.
        const asDetail = Object.assign({}, j, { board_stage: null, makesafe_stage: null, canonical_stage: null });
        const legacyStage = getMakesafeStage(asDetail, asDetail.status);
        rows.push({
          job_number: j.job_number || '',
          canonical_stage: j.canonical_stage || '',
          declared_stage: j.declared_stage || '',
          rendered_column: dom.renderedColumn || '',
          ses_family: j.ses_family || '',
          expected_family_label: expectedFamily,
          rendered_family_tag: (dom.familyTag || '').trim(),
          family_agrees: (dom.familyTag || '').trim() === expectedFamily,
          detail_stage: detailStage.stage,
          detail_stage_source: detailStage.source,
          detail_contradicts_column: detailStage.stage !== (dom.renderedColumn || ''),
          legacy_detail_stage: legacyStage,
          legacy_contradicts_column: legacyStage !== (dom.renderedColumn || ''),
          canonical_pack_drafted: makesafeHasDraftedPack(j),
          no_pack_chip: !!dom.noPackChip,
          card_builder_links: dom.builderLinks || 0,
          card_anchors: dom.anchors || 0,
          trade_chip: makesafeTradeStageLabel(j, dom.renderedColumn || ''),
        });
      });
    });

    // Privacy scan of everything the page is showing, including link titles.
    const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    const RE_PHONE = /(?:\+?61[\s-]?|\b0)[2-9](?:[\s-]?\d){8}\b/g;
    const RE_STREET = /\b\d{1,5}[a-zA-Z]?(?:[ \t]*[-/][ \t]*\d{1,5}[a-zA-Z]?)?[ \t]+(?:[A-Za-z'’-]+[ \t]+){0,3}(?:Street|St|Road|Rd|Avenue|Ave|Way|Court|Ct|Close|Cl|Drive|Dr|Place|Pl|Parade|Pde|Crescent|Cres|Terrace|Tce|Lane|Ln|Loop|Rise|View|Boulevard|Bvd|Highway|Hwy|Grove|Gardens|Gdns|Circuit|Cct|Ramble|Retreat|Green|Mews|Entrance|Vista|Bend|Brace|Approach|Elbow|Gate|Meander|Outlook|Pass|Quay|Quays|Ridge|Square|Sq|Trail|Turn|Walk|Crest|Hollow|Glade|Bay)\b\.?/g;
    let surface = document.body.innerText;
    document.querySelectorAll('[title],[href]').forEach((el) => {
      surface += '\n' + (el.getAttribute('title') || '') + '\n' + (el.getAttribute('href') || '');
    });
    const hit = (re) => (surface.match(re) || []).filter((s) => !/redacted/.test(s));

    return {
      columns,
      rows,
      privacy: {
        emails: hit(RE_EMAIL).length,
        phones: hit(RE_PHONE).length,
        street_lines: hit(RE_STREET).length,
      },
    };
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const rows = census.rows;
  const docsReady = rows.filter((r) => r.rendered_column === 'report_ready');
  const summary = {
    generated_by: 'scripts/makesafe-ui-truth-census.js',
    board: 'ops.html#jobs → Make-Safes',
    feed: 'ops-api?action=makesafe_board&projection=ops (makesafe-board.v1) + makesafe_pipeline?history=all (presentation join)',
    population: {
      canonical_rows_rendered: rows.length,
      cards_per_rendered_column: census.columns,
      note: 'The `intake` column holds intake DRAFTS, which are not `makesafe-board.v1` rows and are not part of this population.',
    },
    family_tags: {
      cards_with_a_tag: rows.filter((r) => r.rendered_family_tag).length,
      agree_with_canonical_ses_family: rows.filter((r) => r.family_agrees).length,
      disagree: rows.filter((r) => !r.family_agrees).length,
      undetermined_rendered_as_not_determined: rows.filter((r) => r.rendered_family_tag === 'Family not determined').length,
      label_vocabulary: tally(rows.map((r) => r.rendered_family_tag)),
    },
    detail_vs_column: {
      contradictions_now: rows.filter((r) => r.detail_contradicts_column).length,
      contradictions_with_the_pre_change_derivation: rows.filter((r) => r.legacy_contradicts_column).length,
      // The harmful subset: the pre-change detail claimed a LIVE stage for a card
      // the board had put in a terminal column, so it offered a forward move that
      // would have undone an archive / cancellation / completion.
      pre_change_contradictions_offering_a_move_on_a_terminal_card:
        rows.filter((r) => ['archive', 'cancelled', 'completed'].includes(r.rendered_column)
          && ['new', 'allocated', 'trade_report_in', 'report_ready'].includes(r.legacy_detail_stage)).length,
      detail_stage_sources: tally(rows.map((r) => r.detail_stage_source)),
    },
    docs_ready_pack_truth: {
      cards: docsReady.length,
      canonical_pack_drafted: docsReady.filter((r) => r.canonical_pack_drafted).length,
      no_pack_chip_rendered: docsReady.filter((r) => r.no_pack_chip).length,
    },
    card_face_links: {
      builder_link_anchors: rows.reduce((n, r) => n + r.card_builder_links, 0),
      cards_with_at_least_one_builder_link: rows.filter((r) => r.card_builder_links > 0).length,
      anchors_total_including_other_card_links: rows.reduce((n, r) => n + r.card_anchors, 0),
    },
    privacy_scan_of_the_rendered_dom: census.privacy,
  };

  // ── Capture ───────────────────────────────────────────────────────────────
  const shots = [];
  if (SHOTS) {
    // Nothing this script cannot redact may appear in a capture.
    await page.evaluate(() => {
      document.querySelectorAll('iframe,embed,object,img').forEach((el) => {
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        if (!src || /^data:/.test(src)) return;
        const ph = document.createElement('div');
        ph.textContent = 'document preview withheld — contains builder contact details this capture cannot redact';
        ph.setAttribute('style', 'padding:10px;border:1px dashed #B45309;color:#B45309;font:12px system-ui;background:#FEF3E7;');
        el.replaceWith(ph);
      });
    });
    await page.evaluate(() => {
      const col = document.querySelector('.kanban-col[data-status="report_ready"]');
      if (col) col.scrollIntoView({ block: 'start', inline: 'start' });
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '00-board-docs-ready-honesty.png') });
    console.log('  captured 00-board-docs-ready-honesty.png');
    shots.push('00-board-docs-ready-honesty.png');

    // One card per canonical `ses_family` present on the board, named by the feed's
    // family key so each shot maps back to a row in cards.csv.
    const families = await page.evaluate(() => {
      const familyOf = {};
      const cards = (window._pipelineData && window._pipelineData.columns) || {};
      Object.keys(cards).forEach((s) => (cards[s] || []).forEach((j) => { familyOf[j.id] = j.ses_family || 'unknown'; }));
      const seen = {};
      document.querySelectorAll('.kanban-card[data-job-id]').forEach((card) => {
        const id = card.getAttribute('data-job-id');
        const fam = familyOf[id] || 'unknown';
        if (!seen[fam]) seen[fam] = id;
      });
      return seen;
    });
    let i = 1;
    for (const family of Object.keys(families).sort()) {
      const file = String(i).padStart(2, '0') + '-family-' + family.replace(/[^a-z0-9]+/gi, '-') + '.png';
      shots.push(await shoot(page, OUT, file, `.kanban-card[data-job-id="${families[family]}"]`));
      i += 1;
    }

    // The detail the ground truth caught contradicting its own column: SWMS-261099
    // opened as "New · 4 days old" with a forward-move button, over an archive the
    // captain's display ledger had ruled (ses-ui-ground-truth-v1 §3.3).
    const target = arg('--detail') || 'SWMS-261099';
    const archived = rows.find((r) => r.job_number === target)
      || rows.find((r) => r.canonical_stage === 'archive' && r.detail_stage === 'archive');
    if (archived) {
      await page.evaluate((jobNumber) => {
        const card = Array.from(document.querySelectorAll('.kanban-card[data-job-id]'))
          .find((c) => c.textContent.includes(jobNumber));
        if (card) window.openJobDetail(card.getAttribute('data-job-id'));
      }, archived.job_number);
      await page.waitForSelector('#jdOverview .ms-doc-wrap, #jdOverview', { timeout: 20000 });
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        document.querySelectorAll('iframe,embed,object,img').forEach((el) => {
          const src = el.getAttribute('src') || el.getAttribute('data') || '';
          if (!src || /^data:/.test(src)) return;
          const ph = document.createElement('div');
          ph.textContent = 'document preview withheld — contains builder contact details this capture cannot redact';
          ph.setAttribute('style', 'padding:10px;border:1px dashed #B45309;color:#B45309;font:12px system-ui;background:#FEF3E7;');
          el.replaceWith(ph);
        });
      });
      shots.push(await shoot(page, OUT, `10-detail-archived-${archived.job_number}-header.png`, '#jdOverview > div > div:nth-child(1)'));
      const nextStep = await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('#jdOverview div'))
          .find((d) => d.textContent.trim() === 'Next step');
        const panel = label && label.parentElement;
        if (panel) panel.setAttribute('data-census-shot', 'next-step');
        return !!panel;
      });
      if (nextStep) shots.push(await shoot(page, OUT, `11-detail-archived-${archived.job_number}-next-step.png`, '[data-census-shot="next-step"]'));
    }

    // Re-scan after every capture step: the detail loaded a second payload.
    summary.privacy_scan_after_capture = await page.evaluate(() => {
      const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
      const RE_PHONE = /(?:\+?61[\s-]?|\b0)[2-9](?:[\s-]?\d){8}\b/g;
      const surface = document.body.innerText;
      return {
        emails: (surface.match(RE_EMAIL) || []).filter((s) => !/redacted/.test(s)).length,
        phones: (surface.match(RE_PHONE) || []).filter((s) => !/redacted/.test(s)).length,
      };
    });
  }
  summary.screenshots = shots.filter(Boolean);

  // Let anything still in flight settle so the request log records its real
  // outcome rather than a teardown error.
  await page.waitForTimeout(1500);
  await browser.close();

  // Counted last, so they cover the WHOLE session including the captures.
  summary.requests = {
    total: requests.length,
    by_method: tally(requests.map((r) => r.method)),
    non_get: requests.filter((r) => r.method !== 'GET').length,
    actions: tally(requests.map((r) => r.action)),
  };
  summary.console = {
    total: consoleMessages.length,
    errors: consoleMessages.filter((m) => m.type === 'error' || m.type === 'pageerror').length,
  };

  // ── Write ─────────────────────────────────────────────────────────────────
  write(path.join(OUT, 'census.json'), JSON.stringify(summary, null, 2));
  write(path.join(OUT, 'cards.csv'), toCsv(rows));
  write(path.join(OUT, 'requests.json'), JSON.stringify(requests, null, 2));
  write(path.join(OUT, 'console.json'), JSON.stringify(consoleMessages, null, 2));

  console.log(JSON.stringify(summary, null, 2));

  const privacyHits = Object.values(summary.privacy_scan_of_the_rendered_dom).reduce((a, b) => a + b, 0);
  if (privacyHits) violations.push(`privacy scan found ${privacyHits} unredacted client detail(s) in the DOM`);
  if (summary.requests.non_get) violations.push('a non-GET request was attempted');
  if (violations.length) {
    console.error('\nCENSUS FAILED:\n  ' + violations.join('\n  '));
    process.exit(1);
  }
  console.log(`\ncensus written to ${OUT}`);
}

function tally(values) {
  const out = {};
  values.forEach((v) => { const k = v || '(none)'; out[k] = (out[k] || 0) + 1; });
  return out;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return [cols.join(',')].concat(rows.map((r) => cols.map((c) => cell(r[c])).join(','))).join('\n') + '\n';
}

async function shoot(page, dir, file, selector) {
  const el = await page.$(selector);
  if (!el) { console.warn(`  (no element for ${file}: ${selector})`); return null; }
  await el.screenshot({ path: path.join(dir, file) });
  console.log(`  captured ${file}`);
  return file;
}

function write(file, contents) {
  fs.writeFileSync(file, contents);
  console.log(`  wrote ${file} (${contents.length} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
