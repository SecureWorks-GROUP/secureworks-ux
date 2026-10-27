#!/usr/bin/env node
/**
 * Trade app opens the Scope Engine (T42): scoperJobUrl in the shipped trade.html
 * gives each job its live Scope Engine page by ?jobId=, fence to the fence page,
 * patio to the patio page, and no link for a patio job scoped in the older patio page.
 */
const fs = require('fs')
const assert = require('assert')
const path = require('path')

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8')
const src = html.match(/function scoperJobUrl\(job\) \{[\s\S]*?\n  \}/)[0]
const scoperJobUrl = new Function(src + '; return scoperJobUrl;')()
const FENCE = 'https://marninms98-dotcom.github.io/fence-designer/scope-engine/'
const PATIO = 'https://marninms98-dotcom.github.io/patio/scope-engine/'

assert.equal(scoperJobUrl({ id: 'j1', type: 'fencing', scope_json: { job: { runs: [] } } }), FENCE + '?jobId=j1')
assert.equal(scoperJobUrl({ id: 'j2', type: 'patio' }), PATIO + '?jobId=j2')
assert.equal(scoperJobUrl({ id: 'j3', type: 'patio', scope_json: '{"config":{"length":6}}' }), '')
assert.equal(scoperJobUrl({ id: 'j4', type: 'patio', scope_json: { tool: 'patio-scoper', draft: {}, revision: {} } }), PATIO + '?jobId=j4')
assert.equal(scoperJobUrl({ id: 'j 5', type: 'fencing' }), FENCE + '?jobId=j%205')
assert.equal(scoperJobUrl({ id: 'j6', type: 'makesafe' }), '')
assert.equal(scoperJobUrl({ type: 'patio' }), '')
assert.ok(/var SCOPER_LINK_ENABLED = true;/.test(html), 'the office link is switched on')
console.log('trade scoper link: 8 checks pass')
