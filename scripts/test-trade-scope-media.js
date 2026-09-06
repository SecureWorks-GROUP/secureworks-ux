#!/usr/bin/env node
// TRD-5 — trades see every job video + quote/job writing, never sell pricing.
// Extracts the shipped // <trade-scope-media> block from trade.html so the
// assertions cannot drift from what the Scope tab, Files/Photos, and the
// make-safe report header actually render.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8');
const startMark = '// <trade-scope-media>';
const endMark = '// </trade-scope-media>';
const start = html.indexOf(startMark);
const end = html.indexOf(endMark, start + startMark.length);
assert(start !== -1 && end !== -1 && end > start, 'trade-scope-media sentinels exist');
const block = html.slice(start, end + endMark.length);

let pricingOn = false;
let fullPricingOn = false;
const context = {
  canSeePricing: function () { return pricingOn; },
  canSeeFullPricing: function () { return fullPricingOn; },
  getTradeDocOpenUrl: function (doc) {
    if (!doc) return '';
    var candidates = [doc.pdf_url, doc.public_url, doc.signed_url, doc.download_url, doc.url, doc.file_url, doc.storage_url];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && /^https?:\/\//i.test(String(candidates[i]))) return String(candidates[i]);
    }
    return '';
  },
  esc: function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
vm.createContext(context);
vm.runInContext(block, context);
const M = context.TradeScopeMedia;
assert(M, 'TradeScopeMedia namespace is exported from the shipped block');

function check(name, cond) {
  assert(cond, name);
}

const walkthrough = {
  id: 'vid-walk',
  type: 'video',
  label: 'Site walkthrough',
  playable_url: 'https://storage.example.test/walkthrough.mp4',
};
const otherVideo = {
  id: 'vid-other',
  type: 'video',
  label: 'Install recap',
  phase: 'in_progress',
  signed_url: 'https://storage.example.test/recap.mp4',
};
const scopePhoto = {
  id: 'pic-1',
  type: 'photo',
  phase: 'scope',
  storage_url: 'https://storage.example.test/scope.jpg',
};
const quotePack = {
  quote_number: 'Q-4412',
  status: 'accepted',
  sent_at: '2026-09-01',
  summary: 'Build the patio as drawn',
  items: [
    { description: 'Install 6m x 4m insulated patio', quantity: 1, unit: 'job', unit_price: 8800 },
    { kind: 'note', description: 'Match existing fascia. Quote total $8,800.' },
  ],
};
const workOrder = {
  wo_number: 'WO-99',
  scope_items: [
    { description: 'Posts and beams', quantity: 8, unit: 'ea', unit_price: 120, total: 960 },
    { description: 'Roof sheets', qty: 12, unit: 'sheet', rate: 45, total: 540 },
  ],
};

const data = {
  job: {
    id: 'job-1',
    job_number: 'SWP-1',
    type: 'patio',
    scope_json: { length: 6, projection: 4, walkthrough: true },
  },
  media: [walkthrough, otherVideo, scopePhoto],
  quote_packs: [quotePack],
  workOrder: workOrder,
};

check('lists walkthrough and other job videos', M.listJobVideos(data).length === 2);
check('walkthrough sorts first', M.listJobVideos(data)[0].id === 'vid-walk');
check('pickScopeVideo prefers walkthrough', M.pickScopeVideo(data).id === 'vid-walk');
check('photo is not a job video', !M.isJobVideo(scopePhoto));
check('signed_url is playable (TRD-4)', M.mediaPlayableUrl(otherVideo) === otherVideo.signed_url);
check('scope_json.walkthrough is flagged', M.scopeJsonFlagsWalkthrough(data.job.scope_json));

const videoHtml = M.renderScopeVideoCard(data);
check('player renders both videos', videoHtml.includes(walkthrough.playable_url) && videoHtml.includes(otherVideo.signed_url));
check('player labels both videos', videoHtml.includes('Site walkthrough') && videoHtml.includes('Install recap'));
check('player does not show missing state when walkthrough URL exists', !videoHtml.includes(M.walkthroughMissingCopy()));

const flaggedNoUrl = M.renderScopeVideoCard({
  job: { scope_json: { walkthrough_recorded: true } },
  media: [],
});
check('honest empty when walkthrough flagged and no URL', flaggedNoUrl.includes(M.walkthroughMissingCopy()));
check('empty omitted when no video and no flag', M.renderScopeVideoCard({ job: { scope_json: {} }, media: [] }) === '');

const flaggedPlusOther = M.renderScopeVideoCard({
  job: { scope_json: { has_walkthrough: true } },
  media: [otherVideo],
});
check('other videos still play when walkthrough file is missing', flaggedPlusOther.includes(otherVideo.signed_url));
check('missing walkthrough named beside other videos', flaggedPlusOther.includes(M.walkthroughMissingCopy()));

const tradeDocVideo = {
  id: 'doc-trade-vid',
  type: 'video',
  file_name: 'crew-walkthrough.mp4',
  storage_url: 'https://storage.example.test/crew-walkthrough.mp4',
  visible_to_trades: true,
};
const internalDocVideo = {
  id: 'doc-internal-vid',
  type: 'video',
  file_name: 'office-only.mp4',
  storage_url: 'https://storage.example.test/office-only.mp4',
  visible_to_trades: false,
};
const untaggedDocVideo = {
  id: 'doc-untagged-vid',
  type: 'video',
  file_name: 'untagged.mp4',
  storage_url: 'https://storage.example.test/untagged.mp4',
};
const docsOnly = {
  job: { scope_json: {} },
  media: [],
  documents: [tradeDocVideo, internalDocVideo, untaggedDocVideo],
};
check('trade-visible document video is collected', M.isTradeVisibleDocument(tradeDocVideo));
check('internal document video is not trade-visible', !M.isTradeVisibleDocument(internalDocVideo));
check('untagged document is not trade-visible', !M.isTradeVisibleDocument(untaggedDocVideo));
const listedDocs = M.listJobVideos(docsOnly);
check('only trade-visible document videos are listed', listedDocs.length === 1 && listedDocs[0].id === 'doc-trade-vid');
const docHtml = M.renderScopeVideoCard(docsOnly);
check('player shows the trade-visible document video', docHtml.includes(tradeDocVideo.storage_url));
check('player hides internal document videos', !docHtml.includes('office-only.mp4') && !docHtml.includes('untagged.mp4'));

const legacySameId = {
  id: 'vid-1',
  type: 'video',
  label: 'Site walkthrough',
  storage_url: 'https://storage.example.test/legacy/walk.mp4',
};
const enrichedSameId = {
  id: 'vid-1',
  type: 'video',
  label: 'Site walkthrough',
  playable_url: 'https://storage.example.test/signed/walk.mp4?token=abc',
};
const sameIdDupes = {
  job: { scope_json: {} },
  media: [legacySameId],
  videos: [enrichedSameId],
};
const mergedById = M.listJobVideos(sameIdDupes);
check('same id with different URLs is one video', mergedById.length === 1);
check('merged id keeps the enriched playable URL', M.mediaPlayableUrl(mergedById[0]) === enrichedSameId.playable_url);
check('stable key prefers id over URL', M.mediaStableKey(legacySameId) === 'id:vid-1' && M.mediaStableKey(enrichedSameId) === 'id:vid-1');

const legacyByPath = {
  type: 'video',
  storage_path: 'jobs/x/recap.mp4',
  storage_url: 'https://storage.example.test/legacy/recap.mp4',
};
const enrichedByPath = {
  type: 'video',
  storage_path: 'jobs/x/recap.mp4',
  signed_url: 'https://storage.example.test/signed/recap.mp4?token=xyz',
};
const mergedByPath = M.listJobVideos({ job: { scope_json: {} }, media: [legacyByPath], videos: [enrichedByPath] });
check('same storage_path with different URLs is one video', mergedByPath.length === 1);
check('merged path keeps the signed URL', M.mediaPlayableUrl(mergedByPath[0]) === enrichedByPath.signed_url);

const differentIdsSamePath = M.listJobVideos({
  job: { scope_json: {} },
  media: [{
    id: 'legacy-row',
    type: 'video',
    storage_path: 'jobs/x/walk.mp4',
    storage_url: 'https://storage.example.test/legacy/walk.mp4',
  }],
  videos: [{
    id: 'enriched-row',
    type: 'video',
    storage_path: 'jobs/x/walk.mp4',
    playable_url: 'https://storage.example.test/signed/walk.mp4?token=abc',
  }],
});
check('different ids sharing storage_path collapse to one video', differentIdsSamePath.length === 1);
check('path-aliased merge keeps the enriched URL', M.mediaPlayableUrl(differentIdsSamePath[0]) === 'https://storage.example.test/signed/walk.mp4?token=abc');

const missingIdSameHash = M.listJobVideos({
  job: { scope_json: {} },
  media: [{
    id: 'hashed-legacy',
    type: 'video',
    content_hash: 'sha-walk',
    storage_url: 'https://storage.example.test/legacy/hash-walk.mp4',
  }],
  videos: [{
    type: 'video',
    content_hash: 'sha-walk',
    playable_url: 'https://storage.example.test/signed/hash-walk.mp4?token=def',
  }],
});
check('missing id sharing content_hash collapses to one video', missingIdSameHash.length === 1);
check('hash-aliased merge keeps the enriched URL', M.mediaPlayableUrl(missingIdSameHash[0]) === 'https://storage.example.test/signed/hash-walk.mp4?token=def');

const bridgeAliases = M.listJobVideos({
  job: { scope_json: {} },
  media: [
    { id: 'only-id', type: 'video', storage_path: 'jobs/x/bridge.mp4', storage_url: 'https://storage.example.test/a.mp4' },
    { id: 'only-hash', type: 'video', content_hash: 'sha-bridge', storage_url: 'https://storage.example.test/b.mp4' },
    { id: 'both', type: 'video', storage_path: 'jobs/x/bridge.mp4', content_hash: 'sha-bridge', playable_url: 'https://storage.example.test/signed/bridge.mp4' },
  ],
});
check('id/path and hash rows merge when a later row shares both aliases', bridgeAliases.length === 1);
check('bridged merge keeps the enriched URL', M.mediaPlayableUrl(bridgeAliases[0]) === 'https://storage.example.test/signed/bridge.mp4');

const twoDistinct = M.listJobVideos({
  job: { scope_json: {} },
  media: [walkthrough, otherVideo],
});
check('distinct videos still list separately', twoDistinct.length === 2);

pricingOn = false;
fullPricingOn = false;
check('suffix AUD is stripped', M.redactTradePriceText('Quote total 8,800 AUD.') === 'Quote total.');
check('suffix dollars is stripped', M.redactTradePriceText('Price is 8,800 dollars today') === 'Price is today');
check('suffix AUD$ is stripped', M.redactTradePriceText('Allow 8800 AUD$ extra') === 'Allow extra');
check('prefix AUD$ amount is stripped', M.redactTradePriceText('Allow AUD$8,800 extra') === 'Allow extra');
check('qty without currency is kept', M.redactTradePriceText('Install 8 posts') === 'Install 8 posts');
check('bare total after cue is stripped', M.redactTradePriceText('Quote total 8,800.') === 'Quote total.');
check('compact 8.8k total is stripped', M.redactTradePriceText('Quote total 8.8k') === 'Quote total');
check('standalone 8.8k is stripped', M.redactTradePriceText('Allow 8.8k extra') === 'Allow extra');
check('day rate shorthand is stripped', M.redactTradePriceText('Labour 120/day on site') === 'Labour on site');
check('measurements stay when not a price', M.redactTradePriceText('Install 6m x 4m insulated patio') === 'Install 6m x 4m insulated patio');

const suffixNotePack = {
  job: data.job,
  quote_packs: [{
    quote_number: 'Q-4413',
    status: 'sent',
    items: [{ kind: 'note', description: 'Match existing fascia. Quote total 8,800 AUD.' }],
  }],
};
const suffixHtml = M.renderQuotePacks(suffixNotePack);
check('quote prose hides trailing AUD amount', suffixHtml.includes('Match existing fascia') && !suffixHtml.includes('8,800') && !suffixHtml.includes('AUD'));

const quoteHtml = M.renderQuotePacks(data);
check('quote number visible to trades', quoteHtml.includes('Q-4412'));
check('quote writing visible to trades', quoteHtml.includes('Install 6m x 4m insulated patio'));
check('trade quote pack hides unit_price', !quoteHtml.includes('8800') && !quoteHtml.includes('$'));
check('slipped $ in a quote note is redacted', !quoteHtml.includes('8,800') && quoteHtml.includes('Match existing fascia'));

const woHtml = M.renderCompactWorkOrderItems(data);
check('compact WO items on Scope', woHtml.includes('Posts and beams') && woHtml.includes('Roof sheets'));
check('compact WO qty without price', woHtml.includes('× 8') && woHtml.includes('ea'));
check('compact WO hides unit_price and totals', !woHtml.includes('$') && !woHtml.includes('120') && !woHtml.includes('960'));

pricingOn = true;
fullPricingOn = false;
check('senior installer canSeePricing is not the SOW office gate', M.tradeCanSeeSowPricing() === false);
const quoteSenior = M.renderQuotePacks(data);
check('senior installer quote pack hides rates', !quoteSenior.includes('$') && !quoteSenior.includes('8800'));
const woSenior = M.renderCompactWorkOrderItems(data);
check('senior installer compact WO hides rates', !woSenior.includes('$') && !woSenior.includes('120'));

fullPricingOn = true;
check('office canSeeFullPricing unlocks SOW rates', M.tradeCanSeeSowPricing() === true);
const quoteOffice = M.renderQuotePacks(data);
check('office quote pack may show rates', quoteOffice.includes('$8,800') || quoteOffice.includes('$8800'));
const woOffice = M.renderCompactWorkOrderItems(data);
check('office compact WO may show rates', woOffice.includes('$120') || woOffice.includes('$'));

check(
  'shipped Scope labour budget uses office SOW gate (sync)',
  /if \(tradeCanSeeSowPricing\(\) && job\.scope_json\.pricing && job\.scope_json\.pricing\.labour\)/.test(html)
);
check(
  'shipped Scope labour budget uses office SOW gate (async)',
  /if \(isJobDone\(phase\) && tradeCanSeeSowPricing\(\)\)/.test(html)
);
check(
  'shipped Work Order tab rates use office SOW gate',
  /var showWoPrices = tradeCanSeeSowPricing\(\);/.test(html)
);
check(
  'Work Order tab no longer uses canSeePricing for rates',
  !/var showWoPrices = canSeePricing\(\);/.test(html)
);
check(
  'shipped MakeSafe WO PDF helper is office-gated',
  /function getMakesafeWorkOrderUrl\(data\) \{\s*return tradeWorkOrderPdfUrl\(data\);/.test(html)
);
check(
  'shipped Files list hides priced WO PDFs from trades',
  /tradeCanSeeSowPricing\(\) \|\| !isPricedWorkOrderDocument\(d\)/.test(html)
);
check(
  'shipped Files otherDocs uses priced-WO predicate',
  /otherDocs = docs\.filter\(function\(d\) \{\s*return d\.visible_to_trades && d\.type !== 'site_photo' && !isPricedWorkOrderDocument\(d\);/.test(html)
);
check(
  'shipped video collection drops priced WO documents from every source',
  /if \(!item \|\| !isTradeVisibleMedia\(item\) \|\| isPricedWorkOrderDocument\(item\)\) continue;/.test(html)
);
check(
  'shipped isJobVideo refuses priced WO documents unconditionally',
  /if \(isPricedWorkOrderDocument\(m\)\) return false;/.test(html)
);
check(
  'shipped collectJobMedia filters every media source',
  /function pushVisibleMedia\(arr\)/.test(html) && /pushVisibleMedia\(data && data\.media\)/.test(html) && /pushVisibleMedia\(data && data\.videos\)/.test(html)
);
check(
  'shipped video labels are price-redacted',
  /var label = redactTradePriceText\(video\.label \|\| video\.file_name \|\| video\.name/.test(html)
);
check(
  'shipped WO instructions use sow redaction',
  /escSowText\(wo\.special_instructions\)/.test(html)
);
check(
  'shipped leftover Work Order PDF card is office-gated',
  /var workOrderUrl = tradeCanSeeSowPricing\(\) \? getTradeDocOpenUrl\(workOrderDoc\) : '';/.test(html)
);
check(
  'shipped photo/gallery renderers filter priced WO + visibility (TRD5-R10-001/004)',
  /var media = filterTradeGalleryMedia\(data\.media\);/.test(html) &&
    /function renderJobTab_photos\(data, phase, container\) \{\s*var media = filterTradeGalleryMedia\(data\.media\);/.test(html)
);
check(
  'shipped mergeTradeExternalLinks applies office-only WO gate (TRD5-R10-002)',
  /function mergeTradeExternalLinks\(\) \{[\s\S]*return filterTradeSowLinks\(out\);/.test(html)
);
check(
  'shipped Work Order tab Cost Breakdown uses office SOW gate (TRD5-R10-003)',
  /if \(wo && wo.id && tradeCanSeeSowPricing\(\)\) \{\s*h \+= '<div class="detail-section" id="woJobCostBreakdown">/.test(html)
);
check(
  'shipped Work Order tab Crew Charges uses office SOW gate (TRD5-R10-003)',
  /if \(tradeCanSeeSowPricing\(\)\) \{\s*h \+= '<div class="detail-section" id="woJobCrewCharges">/.test(html)
);
check(
  'Work Order tab cost sections no longer use _userTier >= 2',
  !/if \(_userTier >= 2\) \{\s*h \+= '<div class="detail-section" id="woJob(CostBreakdown|CrewCharges)">/.test(html)
);
check(
  'shipped bottom Notes use sow redaction (TRD5-R10-005)',
  /escSowText\(\(n\.detail_json && n\.detail_json\.text\) \|\| ''\)/.test(html)
);
check(
  'shipped Log note bodies use sow redaction (TRD5-R10-005)',
  /if \(entry\.text\) h \+= '<div style="font-size:13px;color:var\(--sw-text\);white-space:pre-wrap">' \+ escSowText\(entry\.text\)/.test(html)
);
check(
  'shipped renderNote uses sow redaction',
  /<div class="note-text">' \+ escSowText\(text\) \+ '<\/div>/.test(html)
);
check(
  'shipped Quick Notes body uses sow redaction (TRD5-R11-001)',
  /<div class="note-text">' \+ escSowText\(dj\.text \|\| dj\.note \|\| dj\.note_text \|\| ''\) \+ '<\/div>/.test(html)
);
check(
  'Quick Notes no longer uses bare esc() for note bodies',
  !/<div class="note-text">' \+ esc\(dj\.text \|\| dj\.note \|\| ''\) \+ '<\/div>/.test(html)
);
check(
  'shipped external-link normalise preserves WO kind/type/file metadata (TRD5-R11-002)',
  /function add\(item, fallbackLabel\) \{\s*var link = tradeSowLinkFromItem\(item, fallbackLabel\);/.test(html)
);

const woPdfData = {
  documents: [{
    type: 'work_order',
    file_name: 'Builder-WO.pdf',
    pdf_url: 'https://storage.example.test/wo.pdf',
    visible_to_trades: true,
  }],
  workOrder: { wo_number: 'MS-WO-1' },
};
const supplierPdfData = {
  documents: [{
    type: 'supplier_work_order',
    file_name: 'Supplier-WO.pdf',
    pdf_url: 'https://storage.example.test/supplier-wo.pdf',
    visible_to_trades: true,
  }],
};

const aliasWoDoc = {
  type: 'builder_pack',
  file_name: 'Site-WO.pdf',
  pdf_url: 'https://storage.example.test/site-wo.pdf',
  storage_url: 'https://storage.example.test/site-wo.pdf',
  visible_to_trades: true,
};
const walkthroughNamedWoPdf = {
  type: 'document',
  file_name: 'work-order-walkthrough.pdf',
  title: 'Work order walkthrough',
  pdf_url: 'https://storage.example.test/wo-walkthrough.pdf',
  storage_url: 'https://storage.example.test/wo-walkthrough.pdf',
  visible_to_trades: true,
};

pricingOn = true;
fullPricingOn = false;
check('priced WO document is recognised', M.isPricedWorkOrderDocument(woPdfData.documents[0]) === true);
check('supplier WO document is recognised', M.isPricedWorkOrderDocument(supplierPdfData.documents[0]) === true);
check('filename WO alias is a priced WO document', M.isPricedWorkOrderDocument(aliasWoDoc) === true);
check('senior installer cannot open MakeSafe WO PDF', M.tradeWorkOrderPdfUrl(woPdfData) === '');
check('senior installer cannot open supplier WO PDF', M.tradeWorkOrderPdfUrl(supplierPdfData) === '');
const woClaimingVideo = {
  type: 'work_order',
  is_video: true,
  kind: 'video',
  file_name: 'Builder-WO.pdf',
  playable_url: 'https://storage.example.test/signed-wo.pdf?token=abc',
  visible_to_trades: true,
};
const realWoNamedVideo = {
  id: 'vid-wo-name',
  type: 'video',
  file_name: 'WO-site.mp4',
  storage_url: 'https://storage.example.test/wo-site.mp4',
};
const hiddenOfficeVideo = {
  id: 'vid-office',
  type: 'video',
  label: 'Office recap $8,800',
  playable_url: 'https://storage.example.test/office-recap.mp4',
  visible_to_trades: false,
};
const pricedLabelVideo = {
  id: 'vid-priced-label',
  type: 'video',
  label: 'Walkthrough quote total $8,800',
  playable_url: 'https://storage.example.test/walk-price.mp4',
};

check('priced WO PDF is not a job video', M.isJobVideo(woPdfData.documents[0]) === false);
check('walkthrough-named WO PDF is not a job video', M.isJobVideo(walkthroughNamedWoPdf) === false);
check('work_order row claiming to be video is still a priced WO', M.isPricedWorkOrderDocument(woClaimingVideo) === true);
check('work_order row claiming to be video is not a job video', M.isJobVideo(woClaimingVideo) === false);
check('real video named WO-site.mp4 is still a job video', M.isJobVideo(realWoNamedVideo) === true);
check('explicit office-internal media is hidden', M.isTradeVisibleMedia(hiddenOfficeVideo) === false);
check('untagged job media stays visible', M.isTradeVisibleMedia(walkthrough) === true);
check('explicit false document stays hidden', M.isTradeVisibleMedia(internalDocVideo) === false);

const mixedMedia = M.listJobVideos({
  job: { scope_json: {}, media: [hiddenOfficeVideo] },
  media: [walkthrough, woClaimingVideo, hiddenOfficeVideo],
  videos: [realWoNamedVideo],
  documents: [woPdfData.documents[0]],
});
check('hidden and priced WO media never list as videos', mixedMedia.every(function (v) {
  return v.id === 'vid-walk' || v.id === 'vid-wo-name';
}) && mixedMedia.length === 2);

fullPricingOn = false;
const pricedLabelHtml = M.renderScopeVideoCard({ job: { scope_json: {} }, media: [pricedLabelVideo] });
check('video still plays when label has a price', pricedLabelHtml.includes(pricedLabelVideo.playable_url));
check('video label price is redacted for trades', pricedLabelHtml.includes('Walkthrough quote total') && !pricedLabelHtml.includes('8,800') && !pricedLabelHtml.includes('$'));

check('escSowText redacts WO instructions for trades', M.escSowText('Match fascia. Quote total $8,800.') === 'Match fascia. Quote total.');
fullPricingOn = true;
check('escSowText keeps prices for office', M.escSowText('Quote total $8,800.') === 'Quote total $8,800.');
fullPricingOn = false;
const woAsMedia = M.listJobVideos({
  job: { scope_json: {} },
  media: [],
  documents: [woPdfData.documents[0], aliasWoDoc, walkthroughNamedWoPdf, tradeDocVideo],
});
check('listJobVideos keeps real videos and drops WO PDFs', woAsMedia.length === 1 && woAsMedia[0].id === 'doc-trade-vid');
check('WO PDF url never enters the video player', !M.renderScopeVideoCard({
  job: { scope_json: {} },
  documents: [woPdfData.documents[0], aliasWoDoc, walkthroughNamedWoPdf],
}).includes('storage.example.test/wo'));

fullPricingOn = true;
check('office can open MakeSafe WO PDF', M.tradeWorkOrderPdfUrl(woPdfData) === 'https://storage.example.test/wo.pdf');
check('office can open supplier WO PDF', M.tradeWorkOrderPdfUrl(supplierPdfData) === 'https://storage.example.test/supplier-wo.pdf');

fullPricingOn = false;
const woAsPhoto = {
  type: 'photo',
  file_name: 'Builder-WO.pdf',
  storage_url: 'https://storage.example.test/wo-as-photo.pdf',
  visible_to_trades: true,
};
const woPhotoUrlOnly = {
  type: 'photo',
  storage_url: 'https://storage.example.test/work_order_MLB-26183.pdf',
};
const hiddenOfficePhoto = {
  type: 'photo',
  storage_url: 'https://storage.example.test/office-receipt.jpg',
  visible_to_trades: false,
};
check('photo-typed WO PDF is a priced WO document', M.isPricedWorkOrderDocument(woAsPhoto) === true);
check('photo whose URL is a WO PDF is a priced WO document', M.isPricedWorkOrderDocument(woPhotoUrlOnly) === true);
check('gallery filter drops priced WO photos', M.filterTradeGalleryMedia([woAsPhoto, woPhotoUrlOnly, scopePhoto]).length === 1);
check('gallery filter drops explicit office-internal media', M.filterTradeGalleryMedia([hiddenOfficePhoto, scopePhoto]).every(function (m) { return m.id === 'pic-1'; }));
check('untagged scope photo stays in the gallery', M.isTradeGalleryMedia(scopePhoto) === true);

const woPortalLink = { label: 'Builder portal', url: 'https://prime.example.test/share/abc123' };
const woPdfLink = { label: 'Open work order', url: 'https://storage.example.test/signed-wo.pdf?token=abc' };
const woUrlOnlyLink = { label: 'Open link', url: 'https://storage.example.test/work_order_MLB-26183.pdf' };
const opaqueTypedWo = {
  label: 'Open link',
  kind: 'work_order',
  url: 'https://storage.example.test/storage/v1/object/sign/docs/abc123?token=xyz',
};
const opaqueSupplierWo = {
  label: 'Document',
  type: 'supplier_work_order',
  file_name: 'pack.pdf',
  pdf_url: 'https://storage.example.test/storage/v1/object/sign/docs/supplier-pack?token=xyz',
};
check('portal share is not a priced WO link', M.isPricedWorkOrderLink(woPortalLink) === false);
check('labelled work-order link is priced', M.isPricedWorkOrderLink(woPdfLink) === true);
check('URL-only work_order PDF is priced', M.isPricedWorkOrderLink(woUrlOnlyLink) === true);
check('typed opaque signed WO link is priced', M.isPricedWorkOrderLink(opaqueTypedWo) === true);
const stampedOpaque = M.tradeSowLinkFromItem({
  kind: 'work_order',
  label: 'Open link',
  url: opaqueTypedWo.url,
  file_name: 'pack.pdf',
  mime_type: 'application/pdf',
});
check('normalise helper keeps kind/type/file on opaque WO', stampedOpaque.kind === 'work_order' && stampedOpaque.file_name === 'pack.pdf' && stampedOpaque.mime_type === 'application/pdf');
check('stamped opaque WO still classifies as priced', M.isPricedWorkOrderLink(stampedOpaque) === true);
const stampedSupplier = M.tradeSowLinkFromItem(opaqueSupplierWo);
check('pdf_url-only supplier WO keeps type and signed URL', stampedSupplier.type === 'supplier_work_order' && stampedSupplier.url === opaqueSupplierWo.pdf_url);
check('pdf_url-only supplier WO is priced', M.isPricedWorkOrderLink(stampedSupplier) === true);
const tradeLinks = M.filterTradeSowLinks([woPortalLink, woPdfLink, woUrlOnlyLink, stampedOpaque, stampedSupplier]);
check('trades keep portal links and drop typed/opaque WO PDFs', tradeLinks.length === 1 && tradeLinks[0].url === woPortalLink.url);
fullPricingOn = true;
check('office keeps WO PDF links', M.filterTradeSowLinks([woPortalLink, woPdfLink, stampedOpaque]).length === 3);
fullPricingOn = false;

console.log('PASS trade scope media + pricing redaction checks');
