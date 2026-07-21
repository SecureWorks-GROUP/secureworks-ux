#!/usr/bin/env node
const fs = require('fs')
const assert = require('assert')

const html = fs.readFileSync('trade.html', 'utf8')

function extractFunction(name) {
  const marker = `function ${name}`
  const start = html.indexOf(marker)
  assert(start !== -1, `${name} exists`)
  const next = html.indexOf('\n  function ', start + marker.length)
  return html.slice(start, next === -1 ? html.length : next)
}

const title = extractFunction('getTradeCardTitle')
const line = extractFunction('getTradeCardLine')
const standardLabel = extractFunction('getTradeStandardTypeLabel')
const summary = extractFunction('renderTradeCardCompactSummary')
const crew = extractFunction('getTradeAssignmentCrewLabel')

assert(title.includes("type === 'makesafe'") && title.includes('getTradeMakesafeTypeLabel'), 'MakeSafe title still starts with MakeSafe type')
assert(title.includes('getTradeStandardTypeLabel') && title.includes('label + \' · \' + place'), 'standard title uses job type plus suburb/site')
assert(line.includes("if (type === 'makesafe') return job.client_name") && line.includes('return job.client_name'), 'secondary line keeps client details')
assert(standardLabel.includes("replace(/\\s+job$/i, '')"), 'standard job type label trims noisy trailing “job” for titles')

assert(summary.includes('renderTradeCardCompactSummary'), 'compact summary renderer exists')
assert(!html.includes('renderTradeCardFacts(job, a, type)'), 'cards no longer render the ugly database fact-chip grid')
assert(!html.includes("renderTradeCardFact('Job type'") && !html.includes("renderTradeCardFact('MakeSafe type'"), 'old chip labels are not rendered into cards')
assert(!html.includes('Builder #') && !html.includes('External #'), 'empty builder/external database labels remain absent')
assert(summary.includes('No time set'), 'time state remains visible for field crews')
assert(summary.includes('status-pill'), 'status pill remains visible')
assert(summary.includes('data-weather-date'), 'weather hook remains visible')
assert(crew.includes('_allCrew') && crew.includes("join(' + ')"), 'multi-person crew display is deduped from assignment crew list')
assert(!summary.includes('No crew'), 'summary does not add noisy No crew text when crew is already shown elsewhere')

const todayIdx = html.indexOf('data-filter="today"')
const allIdx = html.indexOf('data-filter="all"')
assert(todayIdx !== -1 && allIdx !== -1 && todayIdx < allIdx, 'Today tab remains first/default before All')
assert(html.includes("var _jobFilter = 'today'"), 'Jobs view still defaults to Today')
assert(!/html\s*\+=\s*renderRunListControls\(/.test(html), 'runsheet reorder controls are retired (captain ruling); Today is time-ordered cards only')

console.log('PASS trade card field matrix regression checks')
