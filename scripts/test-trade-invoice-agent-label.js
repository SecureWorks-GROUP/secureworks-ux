#!/usr/bin/env node
// Owner, 11 Nov 2026: a trade invoice an agent helped draft says so, on the
// trade's draft, the sent invoice, its PDF and the office Trade Bills list.
// Pure checks on the words and on the wiring. No browser.
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const vm = require('vm')

const root = path.join(__dirname, '..')
const Core = require(path.join(root, 'modules', 'trade-invoice-running-draft.js'))
const trade = fs.readFileSync(path.join(root, 'trade.html'), 'utf8')
const ops = fs.readFileSync(path.join(root, 'ops.html'), 'utf8')

// 1. The agent's name in plain words.
assert.strictEqual(Core.agentDisplayName('grok'), 'Grokbot')
assert.strictEqual(Core.agentDisplayName('Grok-Bot'), 'Grokbot')
assert.strictEqual(Core.agentDisplayName('hugo_helper'), 'Hugo Helper')
assert.strictEqual(Core.agentDisplayName('agent'), '')
assert.strictEqual(Core.agentDisplayName(''), '')
assert.strictEqual(Core.agentDisplayName(null), '')
assert.strictEqual(Core.agentDisplayName('<img src=x onerror=1>'), 'Img Srcx Onerror1')

// 2. The draft banner names the agent and keeps the send rule.
assert.strictEqual(Core.agentDraftBanner('grok'), 'Drafted with help from Grokbot. Check it. Only you can send it.')
assert.strictEqual(Core.agentDraftBanner(''), 'An assistant drafted lines on this invoice. Only you can send it.')
assert.strictEqual(Core.agentDraftBanner('agent'), 'An assistant drafted lines on this invoice. Only you can send it.')

// 3. The line on a sent invoice. Nothing unless an agent added lines.
assert.strictEqual(Core.agentInvoiceLine({ created_by_agent: true, agent_label: 'grok' }, 'Hugo'), 'Prepared with help from Grokbot, sent by Hugo.')
assert.strictEqual(Core.agentInvoiceLine({ created_by_agent: true, agent_label: null }, 'Hugo'), 'Prepared with help from an assistant, sent by Hugo.')
assert.strictEqual(Core.agentInvoiceLine({ created_by_agent: true, agent_label: 'grok' }, ''), 'Prepared with help from Grokbot.')
assert.strictEqual(Core.agentInvoiceLine({ created_by_agent: false, agent_label: 'grok' }, 'Hugo'), '')
assert.strictEqual(Core.agentInvoiceLine({ agent_label: 'grok' }, 'Hugo'), '')
assert.strictEqual(Core.agentInvoiceLine(null, 'Hugo'), '')

// 4. The office list says the same words as the trade app.
function extractBetween(source, open, close) {
  const start = source.indexOf(open)
  const end = source.indexOf(close)
  assert(start !== -1 && end > start, open + ' block exists')
  return source.slice(start + open.length, end)
}
const opsSandbox = { swTradeBillEsc: (v) => String(v == null ? '' : v) }
vm.createContext(opsSandbox)
vm.runInContext(extractBetween(ops, '// <trade-bill-agent-label>', '// </trade-bill-agent-label>'), opsSandbox)
const cases = [
  { created_by_agent: true, agent_label: 'grok', users: { name: 'Hugo' } },
  { created_by_agent: true, agent_label: 'Grok Bot', users: { name: ' Alyx  Smuts ' } },
  { created_by_agent: true, agent_label: null, users: { name: 'Hugo' } },
  { created_by_agent: true, agent_label: 'hugo_helper', users: null },
  { created_by_agent: false, agent_label: 'grok', users: { name: 'Hugo' } },
  { agent_label: 'grok', users: { name: 'Hugo' } },
]
for (const inv of cases) {
  assert.strictEqual(
    opsSandbox.swTradeInvoiceAgentLine(inv),
    Core.agentInvoiceLine(inv, inv.users && inv.users.name),
    'ops and trade agree for ' + JSON.stringify(inv),
  )
}
assert.ok(opsSandbox.swTradeInvoiceAgentHtml(cases[0]).includes('data-trade-bill-agent'))
assert.strictEqual(opsSandbox.swTradeInvoiceAgentHtml(cases[4]), '')
assert.ok(ops.includes("tradeName + swTradeInvoiceAgentHtml(inv) + swTradeInvoiceWhenHtml(inv)"), 'Trade Bills row carries the agent line')

// 5. Trade app wiring: banner, sent invoice, success screen and PDF.
assert.ok(trade.includes("esc(_invoiceAgentCore().agentDraftBanner(_invAgentLabel))"), 'draft banner names the agent')
assert.strictEqual(trade.split('html += _invoiceAgentHelpHtml(inv);').length - 1, 2, 'both sent-invoice views carry the line')
assert.strictEqual(trade.split('_invoicePdfDataFromResponse(result, _invNotes, agentSentLine)').length - 1, 2, 'both submit paths pass the line to the PDF')
assert.strictEqual(trade.split('data-invoice-agent-sent').length - 1, 2, 'both success screens carry the line')
assert.ok(/if \(data\.agentLine\) \{[\s\S]{0,400}doc\.text\(String\(data\.agentLine\)/.test(trade), 'the PDF prints the line')
// The label never becomes a way to send: the agent path stays draft only.
assert.throws(() => Core.agentDraft({ caller_kind: 'agent', submit: true, lines: [] }), (err) => err && err.code === 'agent_draft_only')

console.log('trade invoice agent label: ok')
