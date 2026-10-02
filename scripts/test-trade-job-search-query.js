#!/usr/bin/env node
/**
 * Invoice job search (2026-09-30): tradeJobSearchQuery sends a SecureWorks job
 * number in its stored PREFIX-DIGITS form however the trade spaced or dashed
 * it, and leaves every other query (client, suburb, bare number, claim ref) as
 * typed. Asserts against the shipped code between the sentinels in trade.html.
 */
const fs = require('fs')
const assert = require('assert')
const path = require('path')

const html = fs.readFileSync(path.join(__dirname, '..', 'trade.html'), 'utf8')
const OPEN = '// <trade-job-search-query>'
const CLOSE = '// </trade-job-search-query>'
const a = html.indexOf(OPEN)
const b = html.indexOf(CLOSE)
assert(a !== -1 && b > a, 'trade-job-search-query sentinels present in trade.html')
// eslint-disable-next-line no-new-func
const norm = new Function(html.slice(a + OPEN.length, b) + '\n;return tradeJobSearchQuery;')()

const cases = [
  ['SWF - 26168', 'SWF-26168'],
  ['SWF-26168', 'SWF-26168'],
  ['swf 26168', 'SWF-26168'],
  ['SWF26168', 'SWF-26168'],
  ['  SWF – 26168 ', 'SWF-26168'],
  ['SWMS 261319', 'SWMS-261319'],
  ['swp_26339', 'SWP-26339'],
  ['26168', '26168'],
  ['40398', '40398'],
  ['AJBR 70271', 'AJBR 70271'],
  ['Lot 123', 'Lot 123'],
  ['Chris  Stacey', 'Chris Stacey'],
  ['South Perth', 'South Perth'],
  ['SW', 'SW'],
  ['', ''],
  [null, '']
]
for (const [input, expected] of cases) {
  assert.strictEqual(norm(input), expected, `${JSON.stringify(input)} -> ${JSON.stringify(norm(input))}`)
}
console.log(`trade job search query: ${cases.length} cases pass`)
