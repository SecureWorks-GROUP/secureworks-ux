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
const context = {
  canSeePricing: function () { return pricingOn; },
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

pricingOn = false;
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
const quoteOffice = M.renderQuotePacks(data);
check('office quote pack may show rates', quoteOffice.includes('$8,800') || quoteOffice.includes('$8800'));
const woOffice = M.renderCompactWorkOrderItems(data);
check('office compact WO may show rates', woOffice.includes('$120') || woOffice.includes('$'));

console.log('PASS trade scope media + pricing redaction checks');
