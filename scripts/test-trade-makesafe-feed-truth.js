#!/usr/bin/env node
'use strict';

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'trade.html'), 'utf8');

function extractFunction(name) {
  const marker = `function ${name}`;
  const start = html.indexOf(marker);
  assert(start >= 0, `${name} exists`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const context = {
  console,
  _makesafeV5Feed: null,
  MakesafeTradeV5: null
};
vm.createContext(context);
vm.runInContext([
  'var _makesafeV5Feed = null, MakesafeTradeV5 = null;',
  extractFunction('tradeMakesafeTextFromValue'),
  extractFunction('getMakesafeFeedRow'),
  extractFunction('getLegacyTradeMakesafeBuilderName'),
  extractFunction('getTradeMakesafeBuilderName'),
  extractFunction('getLegacyTradeMakesafeTypeLabel'),
  extractFunction('getTradeMakesafeTypeLabel'),
  extractFunction('getMakesafeBuilderCode')
].join('\n'), context);

// Production audit sample IDs. Deliberately conflicting legacy values prove the
// makesafe-board.v1 row wins, rather than documenting another client-side guess.
const samples = [
  {
    id: 'SWMS-26888', client_name: 'Jon Scadd',
    metadata: { requesting_company_name: 'Wrong legacy builder', makesafe_type: 'other' },
    _makesafeFeedRow: { id: 'SWMS-26888', builder: { name: 'AJS Building' }, makesafe_type: 'Ceiling Make Safe' }
  },
  {
    id: 'SWMS-26953', client_name: 'Timothy Botha', notes: 'roof inspection report',
    metadata: { requesting_company_name: 'Wrong legacy builder', makesafe_type: null },
    _makesafeFeedRow: { id: 'SWMS-26953', builder: { name: 'ML Builders' }, makesafe_type: 'Assessment / Quote Report' }
  },
  {
    id: 'SWMS-26919', client_name: 'Gary Wears',
    metadata: { requesting_company_name: 'Wrong legacy builder', makesafe_type: 'other', scope: 'temporary fencing' },
    _makesafeFeedRow: { id: 'SWMS-26919', builder: { name: 'Major Loss Builders' }, makesafe_type: 'Ceiling / water ingress' }
  }
];

for (const job of samples) {
  assert.strictEqual(context.getTradeMakesafeBuilderName(job), job._makesafeFeedRow.builder.name, `${job.id} builder comes from feed`);
  assert.strictEqual(context.getTradeMakesafeTypeLabel(job), job._makesafeFeedRow.makesafe_type, `${job.id} type comes from feed`);
  assert.notStrictEqual(context.getTradeMakesafeBuilderName(job), job.client_name, `${job.id} occupant cannot render as builder`);
}

const feedGap = {
  id: 'feed-gap', client_name: 'Home Owner',
  metadata: { requesting_company_name: 'Legacy Builder', makesafe_type: 'roof report' },
  _makesafeFeedRow: { id: 'feed-gap', builder: { name: '' }, makesafe_type: '' }
};
assert.strictEqual(context.getTradeMakesafeBuilderName(feedGap), '', 'an existing feed row with no builder does not fall back to legacy or occupant');
assert.strictEqual(context.getTradeMakesafeTypeLabel(feedGap), 'MakeSafe', 'an existing feed row with no type does not run regex guessing');

const noFeed = { id: 'legacy-only', client_name: 'Home Owner', metadata: { requesting_company_name: 'Legacy Builder' }, notes: 'roof report' };
assert.strictEqual(context.getTradeMakesafeBuilderName(noFeed), 'Legacy Builder', 'legacy builder derivation remains for a job absent from feed');
assert.strictEqual(context.getTradeMakesafeTypeLabel(noFeed), 'Roof Report', 'labeled regex fallback remains for a job absent from feed');
const occupantOnly = { id: 'occupant-only', client_name: 'Home Owner', notes: 'roof report' };
assert.strictEqual(context.getTradeMakesafeBuilderName(occupantOnly), '', 'homeowner is never a builder fallback');
context._makesafeV5FeedPromise = {};
assert.strictEqual(context.getTradeMakesafeBuilderName(noFeed), '', 'builder derivation does not run while feed truth is in flight');
assert.strictEqual(context.getTradeMakesafeTypeLabel(noFeed), 'MakeSafe', 'type regex does not run while feed truth is in flight');
context._makesafeV5FeedPromise = null;

const surfaces = {
  myJobs: extractFunction('renderMakesafeRunCard'),
  hero: extractFunction('renderHeroCard'),
  detailPanel: extractFunction('renderMakesafeBuilderPanel'),
  reportWorkOrder: extractFunction('renderMakesafeWorkOrderInline')
};
assert(surfaces.myJobs.includes('getMakesafeBuilderCode(job)') && surfaces.myJobs.includes('getTradeMakesafeTypeLabel(job)'), 'My Jobs card resolves feed builder and type');
assert(surfaces.hero.includes('getTradeMakesafeBuilderName(job)') && surfaces.hero.includes('getTradeMakesafeTypeLabel(job)'), 'hero resolves feed builder and type');
assert(surfaces.detailPanel.includes('getTradeMakesafeBuilderName(') && surfaces.detailPanel.includes('getTradeMakesafeTypeLabel('), 'detail panel resolves feed builder and type');
assert(surfaces.reportWorkOrder.includes('getTradeMakesafeBuilderName(') && surfaces.reportWorkOrder.includes('getTradeMakesafeTypeLabel('), 'report work order resolves feed builder and type');
const v5Block = html.slice(html.indexOf('// <makesafe-trade-v5>'), html.indexOf('// </makesafe-trade-v5>'));
assert(v5Block.includes("esc(row.makesafe_type || 'Make-safe')") && v5Block.includes("esc((row.builder || {}).name)"), 'board card continues to consume feed row directly');
assert(!/requesting_company[^;\n]*\|\|\s*job\.client_name/.test(html), 'no requesting-company chain can fall back to the homeowner');
assert(html.includes('fetchMakesafeV5Feed(false).then(function()') && /Promise\.all\(\[\s*api\('trade_job_detail'[\s\S]*fetchMakesafeV5Feed\(false\)/.test(html), 'My Jobs and direct report paths prime the server feed');

console.log('PASS Trade App make-safe builder/type feed truth regressions');
