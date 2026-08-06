#!/usr/bin/env node
/**
 * SES F5b — do the three landed make-safe display fixes hold TOGETHER?
 *
 * The three have never been seen on one card:
 *   F2 (#228) every work order on the card is listed, each named by its own PO;
 *   F5 (this branch) no branding image, CDN object or SES tracker is offered
 *      as a Builder Portal link, while a genuine share survives even expired;
 *   F3 (#229) the trade portal confirmation stays visible until current-cycle
 *      evidence exists.
 *
 * This census reads the live board through THIS working tree's renderers, scores
 * every make-safe card on all three at once, and reports the cards where more
 * than one of them is actually exercised. The ops half is measured in the
 * browser against the shipped ops.html; the trade half is measured by running
 * the shipped ReportDoneCore module out of trade.html over the SAME job_detail
 * payload, because rendering the trade app live would need an installer JWT.
 *
 *   npm run serve:e2e &                                        # :4173
 *   GIT_HEAD=$(git rev-parse --short HEAD) \
 *     node scripts/ses-f5b-combined-truth-census.js
 *
 * READ-ONLY BY CONSTRUCTION, same as scripts/ses-f2-workorder-identity-census.js:
 * every ops-api request is routed through this script and a non-GET is ABORTED
 * and fails the run. Since 2026-08-06 loading the board POSTs nothing at all (the
 * clean-intake sweep is an explicit control, not a render side effect), so the old
 * `?noAutoIntake=1` opt-out is gone and the abort rule is the only guard needed.
 * Nothing is clicked.
 *
 * PRIVACY BY CONSTRUCTION. Every response body is redacted BEFORE it reaches the
 * browser, so the screenshots are of redacted data. Output keeps job number,
 * suburb, builder ref, PO refs and link HOSTS/paths — work references only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('@playwright/test');

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
const API_HOST = 'kevgrhcjxspbxgovpmfl.supabase.co';
const OUT = arg('--out') || path.join('docs', 'evidence', 'ses-f5b-combined-truth-2026-08-02');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ── Redaction (identical rules to scripts/ses-f2-workorder-identity-census.js) ─
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
// url/file_name are opaque on purpose: they ARE the evidence this census reads
// (the portal path decides F5, the PO in the file name decides F2).
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

// ── The shipped trade module, run out of trade.html (no browser, no JWT) ──────
function loadTradeReportDoneCore() {
  const trade = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
  const start = trade.indexOf('var ReportDoneCore = (function ()');
  const close = trade.indexOf('})();', start);
  if (start < 0 || close < 0) throw new Error('ReportDoneCore not found in trade.html');
  // Export the two internals the census needs without editing the shipped file.
  const block = trade.slice(start, close + '})();'.length)
    .replace(/return\s*\{/, 'return { portalUrl: portalUrl, isMarkedDone: isMarkedDone, ');
  const ctx = { URL };
  vm.createContext(ctx);
  vm.runInContext(block + '\nthis.ReportDoneCore = ReportDoneCore;', ctx);
  const core = ctx.ReportDoneCore;
  if (typeof core.portalUrl !== 'function' || typeof core.isMarkedDone !== 'function') {
    throw new Error('ReportDoneCore did not expose portalUrl/isMarkedDone');
  }
  return core;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tradeCore = loadTradeReportDoneCore();
  const requests = [];
  const violations = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
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
    const cols = (window._pipelineData && window._pipelineData.columns) || {};
    const all = [];
    Object.keys(cols).forEach((s) => (cols[s] || []).forEach((j) => all.push(j)));

    // Only the host + path shape is retained from a URL, never the token.
    function shapeOf(u) {
      try {
        const p = new URL(u);
        return p.hostname + p.pathname.replace(/\/[A-Za-z0-9_-]{12,}/g, '/<token>');
      } catch (e) { return '(unparseable)'; }
    }

    const rows = [];
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
          rows.push({ job_number: card.job_number, error: String(e && e.message).slice(0, 120) });
          continue;
        }
        const md = (data && data.makesafe_details) || {};
        const documents = (data && data.documents) || [];

        // F2 — every work order, each with its own PO.
        const slots = window.buildMakesafeDocList(data)
          .filter((e) => e.slot === 'work_order' && e.doc);
        const wos = documents.filter(window.isMakesafeWorkOrderDoc);

        // F5 — what the shared collector keeps vs what the raw row set offered.
        const rawUrls = [];
        [md.external_links, md.source_links, md.source_email_links, md.portal_links]
          .forEach((raw) => {
            const push = (item) => {
              const u = String((typeof item === 'string' ? item : (item && (item.url || item.href || item.link))) || '').trim();
              if (/^https?:/i.test(u) && rawUrls.indexOf(u) < 0) rawUrls.push(u);
            };
            if (Array.isArray(raw)) raw.forEach(push);
            else if (raw && typeof raw === 'object') Object.keys(raw).forEach((k) => push(raw[k]));
            else if (raw) push(raw);
          });
        const kept = window.collectMakesafeExternalLinks(md);
        const keptUrls = kept.map((l) => l.url);
        const dropped = rawUrls.filter((u) => keptUrls.indexOf(u) < 0);

        rows.push({
          job_id: card.id,
          job_number: card.job_number,
          suburb: (data.job && data.job.site_suburb) || '',
          builder_ref: md.external_ref || card.external_ref || '',
          ses_family: card.ses_family || '',
          canonical_stage: card.canonical_stage || '',
          // F2
          work_order_count: wos.length,
          work_order_pos: slots.map((e) => e.poRef || null),
          all_work_orders_listed: slots.length === wos.length,
          leading_matches_card_po: !!(slots[0] && slots[0].matchesCardPo),
          // F5
          link_rows_offered: rawUrls.length,
          link_rows_kept: keptUrls.length,
          link_rows_dropped: dropped.length,
          dropped_shapes: dropped.map(shapeOf),
          kept_shapes: keptUrls.map(shapeOf),
          // F3 inputs (evaluated node-side by the shipped trade module)
          trade_detail: {
            external_links: md.external_links || null,
            substatus: md.substatus || '',
            report_received_at: md.report_received_at || null,
            report_on_portal: md.report_on_portal === true,
            cycle_number: md.cycle_number == null ? null : md.cycle_number,
            attendance_cycle_id: md.attendance_cycle_id || null,
            portal_verified_at: md.portal_verified_at || null,
            portal_verified_cycle: md.portal_verified_cycle == null ? null : md.portal_verified_cycle,
            portal_captures: md.portal_captures || null,
          },
        });
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    return { cards_on_board: all.length, rows };
  });

  const errors = census.rows.filter((r) => r.error);
  const rows = census.rows.filter((r) => !r.error);

  // F3, from the shipped trade module, over the same live payloads.
  for (const r of rows) {
    const d = r.trade_detail;
    r.trade_confirmation_visible = !tradeCore.isMarkedDone(d);
    const portal = tradeCore.portalUrl(d, {});
    r.trade_portal_cta = portal ? 'genuine share offered' : 'no portal link offered';
    r.trade_portal_is_a_dropped_asset = !!portal && r.dropped_shapes.indexOf(
      (() => { try { const p = new URL(portal); return p.hostname + p.pathname.replace(/\/[A-Za-z0-9_-]{12,}/g, '/<token>'); } catch (e) { return ''; } })()
    ) >= 0;
    // The old trade rule would have hidden the confirmation on lifecycle alone.
    r.trade_legacy_would_hide = d.report_on_portal === true
      || !!String(d.report_received_at || '').trim()
      || ['admin_to_send_report', 'ready_to_invoice', 'complete']
        .indexOf(String(d.substatus || '').toLowerCase().trim()) >= 0;
    delete r.trade_detail; // never persist the raw link rows
  }

  const multiWo = rows.filter((r) => r.work_order_count >= 2);
  const polluted = rows.filter((r) => r.link_rows_dropped > 0);
  const confirmVisible = rows.filter((r) => r.trade_confirmation_visible);
  const twoOfThree = rows.filter((r) =>
    (r.work_order_count >= 2 ? 1 : 0) + (r.link_rows_dropped > 0 ? 1 : 0) + (r.trade_confirmation_visible ? 1 : 0) >= 2);
  const allThree = rows.filter((r) =>
    r.work_order_count >= 2 && r.link_rows_dropped > 0 && r.trade_confirmation_visible);

  const rank = (r) => (r.work_order_count >= 2 ? 4 : 0)
    + (r.link_rows_dropped > 0 ? 2 : 0)
    + (r.trade_confirmation_visible ? 1 : 0);
  const best = (list) => list.slice().sort((a, b) => rank(b) - rank(a)
    || b.link_rows_dropped - a.link_rows_dropped
    || String(a.job_number).localeCompare(String(b.job_number)))[0] || null;

  // THE CENSUS DOES NOT INVENT A CARD. If no live card exercises all three, it
  // says so and proves what the board actually has: the card exercising the most
  // (F5 + F3 live), and the card exercising the F2 multi-work-order path. The
  // three-at-once check is then done on a card COMPOSED from those two real
  // payloads and rendered by the same shipped renderers — labelled as composed.
  // Pick cards that exercise BOTH sides of each fix, so a screenshot can show a
  // rule working rather than a surface that happens to be empty: a link card
  // that both dropped junk AND kept a genuine share, and a work-order card whose
  // two instructions carry two DIFFERENT purchase orders (the F2 defect proper).
  const distinctPos = (r) => new Set(r.work_order_pos.filter(Boolean)).size;
  const linkBoth = rows.filter((r) => r.link_rows_dropped > 0 && r.link_rows_kept > 0);
  const woDistinct = multiWo.filter((r) => distinctPos(r) >= 2);
  const liveProof = best(allThree.length ? allThree
    : (linkBoth.length ? linkBoth : rows.filter((r) => r.link_rows_dropped > 0)));
  const woProof = best(woDistinct.length ? woDistinct : multiWo);

  async function shoot(file, evaluate, argument) {
    await page.evaluate(async ([fn, a]) => {
      const old = document.getElementById('f5bProof');
      if (old) old.remove();
      const host = document.createElement('div');
      host.id = 'f5bProof';
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#F4F6F8;padding:18px;';
      host.innerHTML = await (new Function('return (' + fn + ')')())(a);
      document.body.appendChild(host);
    }, [evaluate.toString(), argument]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  }

  const renderOne = async (jobId) => {
    const data = await window.opsFetch('job_detail', { jobId: jobId });
    return window.renderMakesafeOpsDetail(data);
  };

  if (liveProof) await shoot('ops-live-links-and-confirm-card.png', renderOne, liveProof.job_id);
  if (woProof) await shoot('ops-live-multi-work-order-card.png', renderOne, woProof.job_id);

  // Composed all-three card: the polluted link rows of the F5 card carried onto
  // the two-work-order document set of the F2 card. Both halves are real live
  // payloads; only their combination is composed, because the live board has
  // no card carrying both.
  let composed = null;
  if (liveProof && woProof) {
    composed = await page.evaluate(async ([linksJobId, woJobId]) => {
      const linksData = await window.opsFetch('job_detail', { jobId: linksJobId });
      const woData = await window.opsFetch('job_detail', { jobId: woJobId });
      const data = JSON.parse(JSON.stringify(linksData));
      // Graft the second builder instruction's work orders onto the polluted card.
      const woDocs = (woData.documents || []).filter(window.isMakesafeWorkOrderDoc);
      data.documents = (data.documents || []).filter((d) => !window.isMakesafeWorkOrderDoc(d)).concat(woDocs);
      data.work_orders = woData.work_orders || [];
      const host = document.createElement('div');
      host.id = 'f5bProof';
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#F4F6F8;padding:18px;';
      host.innerHTML = window.renderMakesafeOpsDetail(data);
      document.body.appendChild(host);

      const md = data.makesafe_details || {};
      const slots = window.buildMakesafeDocList(data).filter((e) => e.slot === 'work_order' && e.doc);
      const kept = window.collectMakesafeExternalLinks(md);
      const panel = window.renderMakesafeOpsExternalLinks(md);
      return {
        work_orders_on_card: woDocs.length,
        work_order_slots_rendered: slots.length,
        work_order_pos_rendered: slots.map((e) => e.poRef || null),
        multi_work_order_warning_shown: /work orders<\/strong>/.test(host.innerHTML),
        builder_links_kept: kept.length,
        builder_links_panel_has_asset_or_tracker:
          /awstrack\.me/.test(panel) || /\.(?:png|jpe?g|gif|webp|svg|ico|bmp)(?:\?|#|")/i.test(panel),
        builder_links_labels: kept.map((l) => l.label),
        trade_detail: {
          external_links: md.external_links || null,
          substatus: md.substatus || '',
          report_received_at: md.report_received_at || null,
          report_on_portal: md.report_on_portal === true,
          cycle_number: md.cycle_number == null ? null : md.cycle_number,
          attendance_cycle_id: md.attendance_cycle_id || null,
          portal_verified_at: md.portal_verified_at || null,
          portal_verified_cycle: md.portal_verified_cycle == null ? null : md.portal_verified_cycle,
          portal_captures: md.portal_captures || null,
        },
      };
    }, [liveProof.job_id, woProof.job_id]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'ops-all-three-composed-card.png'), fullPage: false });
    const d = composed.trade_detail;
    composed.trade_confirmation_visible = !tradeCore.isMarkedDone(d);
    composed.trade_portal_cta = tradeCore.portalUrl(d, {}) ? 'genuine share offered' : 'no portal link offered';

    // Trade half, seen rather than computed. trade.html's body script is IIFE
    // wrapped, so the sentinel-delimited ReportDoneCore is evaluated in a
    // harness on the served page (the documented QA route in AGENTS.md) and its
    // pure panelHTML rendered with the page's own stylesheet. No login, no
    // network call, no click — the detail is the composed payload above.
    const tradePage = await context.newPage();
    await tradePage.route(`**://${API_HOST}/**`, (route) => route.abort());
    await tradePage.goto(`${BASE}/trade.html`, { waitUntil: 'domcontentloaded' });
    const tradeSource = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
    const start = tradeSource.indexOf('var ReportDoneCore = (function ()');
    const moduleBlock = tradeSource.slice(start, tradeSource.indexOf('})();', start) + '})();'.length);
    composed.trade_panel = await tradePage.evaluate(([block, detail]) => {
      // eslint-disable-next-line no-new-func
      const core = new Function(block + '\nreturn ReportDoneCore;')();
      // buildViewModel takes the whole job_detail payload, exactly as the trade
      // app hands it over — job + makesafe_details, no reshaping here.
      const vm2 = core.buildViewModel({
        job: { id: 'composed-card', makesafe_job_family: 'roof_report', metadata: {} },
        makesafe_details: detail,
      });
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#fff;padding:20px;max-width:520px;';
      host.innerHTML = core.panelHTML(vm2);
      document.body.appendChild(host);
      return {
        done: vm2.done,
        family_label: vm2.label,
        confirmation_control_present: /id="reportDoneAskBtn"/.test(host.innerHTML)
          && /Report completed on builder portal<\/button>/.test(host.innerHTML),
        portal_cta_present: /Open builder report portal/.test(host.innerHTML),
        expired_link_guidance_present: /aged job rather than an app error/.test(host.innerHTML),
        portal_cta_is_a_share_url: /href="[^"]*\/share\//.test(host.innerHTML),
        portal_cta_is_an_asset_or_tracker:
          /awstrack\.me/.test(host.innerHTML) || /href="[^"]*\.(?:png|jpe?g|gif|webp|svg|ico|bmp)/i.test(host.innerHTML),
      };
    }, [moduleBlock, d]);
    await tradePage.waitForTimeout(400);
    await tradePage.screenshot({ path: path.join(OUT, 'trade-report-panel-composed.png'), clip: { x: 0, y: 0, width: 520, height: 620 } });
    await tradePage.close();

    delete composed.trade_detail;
    composed.composed_from = {
      link_rows_and_trade_state: liveProof.job_number,
      work_order_documents: woProof.job_number,
      why: 'no live card carries both a second builder instruction and a polluted link row',
    };
  }

  const summary = {
    generated_by: 'scripts/ses-f5b-combined-truth-census.js',
    board: 'ops.html#jobs → Make-Safes',
    ui_read_at_commit: process.env.GIT_HEAD || '(set GIT_HEAD to stamp)',
    population: {
      cards_on_board: census.cards_on_board,
      job_detail_read_per_card: census.cards_on_board,
      job_detail_errors: errors.length,
    },
    coexistence: {
      cards_with_two_or_more_work_orders: multiWo.length,
      cards_every_work_order_listed: multiWo.filter((r) => r.all_work_orders_listed).length,
      cards_with_a_link_row_dropped_as_non_portal: polluted.length,
      link_rows_dropped_total: rows.reduce((n, r) => n + r.link_rows_dropped, 0),
      cards_trade_confirmation_visible: confirmVisible.length,
      cards_trade_confirmation_visible_that_legacy_would_have_hidden:
        confirmVisible.filter((r) => r.trade_legacy_would_hide).length,
      cards_exercising_all_three: allThree.length,
      cards_exercising_at_least_two: twoOfThree.length,
      trade_cta_ever_a_dropped_asset: rows.filter((r) => r.trade_portal_is_a_dropped_asset).length,
    },
    live_card_exercising_links_and_confirmation: liveProof,
    live_card_exercising_multi_work_order: woProof,
    composed_all_three_card: composed,
    read_only_proof: {
      non_get_requests_aborted: requests.filter((r) => r.method !== 'GET').length,
      violations,
      clicks_on_the_live_board: 0,
    },
    cards_exercising_all_three: allThree,
    cards_exercising_at_least_two: twoOfThree
      .sort((a, b) => rank(b) - rank(a) || String(a.job_number).localeCompare(String(b.job_number))),
  };

  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(requests, null, 2) + '\n');
  console.log(JSON.stringify({
    ...summary,
    cards_exercising_all_three: `${allThree.length} rows → census.json`,
    cards_exercising_at_least_two: `${twoOfThree.length} rows → census.json`,
  }, null, 2));
  await browser.close();
  if (violations.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
