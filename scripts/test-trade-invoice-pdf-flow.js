#!/usr/bin/env node
const fs = require('fs')
const assert = require('assert')
const vm = require('vm')

const html = fs.readFileSync('trade.html', 'utf8')

function extractFunction(name) {
  const marker = `function ${name}`
  const start = html.indexOf(marker)
  assert(start !== -1, `${name} exists`)
  const next = html.indexOf('\n  function ', start + marker.length)
  return html.slice(start, next === -1 ? html.length : next)
}

const jobCentricSubmit = html.slice(
  html.indexOf('window.submitJobCentricInvoice = function()'),
  html.indexOf('function renderInvoiceBuilder()', html.indexOf('window.submitJobCentricInvoice = function()')),
)
assert(jobCentricSubmit.includes('legacyManualRows'), 'job-centric submit keeps legacy manual rows for PDF generation')
assert(jobCentricSubmit.includes('_jobCentricPdfRows(_jobCards, legacyManualRows)'), 'job-centric submit builds PDF rows before clearing state')
assert(jobCentricSubmit.includes('return _attachInvoicePdfToXero(result, pdfData).then(function(pdfAttach)'), 'job-centric submit waits for PDF attach before clearing state')
assert(jobCentricSubmit.includes('downloadInvoicePDF()'), 'job-centric success screen keeps a PDF download button')

const attachHelper = extractFunction('_attachInvoicePdfToXero')
assert(attachHelper.includes("return api('attach_invoice_pdf'"), 'shared helper returns the attach_invoice_pdf request')
assert(attachHelper.includes('result.xero_bill_id'), 'shared helper uses the Xero bill id from submit result')
assert(attachHelper.includes('non-blocking'), 'shared helper keeps PDF attachment non-blocking')

const pdfRows = extractFunction('_jobCentricPdfRows')
assert(pdfRows.includes('Commission') && pdfRows.includes('Work Order'), 'job-centric PDF rows cover commission and work-order modes')
assert(pdfRows.includes('c.scheduled_date') && pdfRows.includes('c.job_number'), 'job-centric PDF rows include date and job number')

const attachCalls = (html.match(/api\('attach_invoice_pdf'/g) || []).length
assert.strictEqual(attachCalls, 1, 'attach_invoice_pdf is implemented in one shared helper')

async function runDynamicHelperCheck() {
  const apiCalls = []
  const pdfText = []
  class FakeJsPdf {
    setFillColor() {}
    rect() {}
    setTextColor() {}
    setFontSize() {}
    setFont() {}
    text(value) { pdfText.push(value) }
    setDrawColor() {}
    setLineWidth() {}
    line() {}
    addPage() {}
    output(format) {
      assert.strictEqual(format, 'datauristring', 'PDF helper emits a data URI for Xero attachment')
      return 'data:application/pdf;base64,JVBERi1GQUtF'
    }
  }

  const context = {
    window: { jspdf: { jsPDF: FakeJsPdf } },
    console,
    _user: { name: 'Test Trade' },
    loadTradeDetails: () => ({
      fullName: 'Test Trade',
      abn: '12345678901',
      phone: '0400000000',
      email: 'trade@example.com',
      bsb: '123-456',
      accountNo: '12345678',
      accountName: 'Test Trade Pty Ltd',
    }),
    _formatAbn: (abn) => abn,
    toast: (msg) => { throw new Error(msg) },
    _woNet: (c) => Number(c.wo_allocated || 0) - Number(c.wo_labour_deduction || 0),
    _woBreakdownText: (c) => 'WO net $' + (Number(c.wo_allocated || 0) - Number(c.wo_labour_deduction || 0)),
    api: async (action, params, body) => {
      apiCalls.push({ action, params, body })
      return { success: true }
    },
  }
  context.global = context

  const dynamicSource = [
    extractFunction('_jobCardAmount'),
    extractFunction('_jobCentricPdfRows'),
    extractFunction('_invoicePdfTotals'),
    extractFunction('_attachInvoicePdfToXero'),
    extractFunction('_invoiceSuperRate'),
    extractFunction('_invoiceRateLabel'),
    extractFunction('_generateInvoicePDF'),
  ].join('\n')
  vm.runInNewContext(dynamicSource, context)

  const rows = context._jobCentricPdfRows([
    { included: true, job_number: 'SWMS-26671', scheduled_date: '2026-06-01', hours: 3, rate: 100, client_name: 'AJ Building', job_type: 'Make Safe' },
    { included: true, job_number: 'SWMS-26672', scheduled_date: '2026-06-02', commission_mode: true, commission_amount: 175, client_name: 'AJ Building' },
    { included: true, job_number: 'SWMS-26673', scheduled_date: '2026-06-03', wo_mode: true, wo_allocated: 500, wo_labour_deduction: 125, description: 'Temp fence' },
  ], [
    { date: '2026-06-04', job_text: 'SWMS-26674', description: 'Manual labour', division: 'General Labour', hours: 2, rate: 90, amount: 180 },
  ])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows.map((r) => r.amount))), [300, 175, 375, 180], 'job-centric PDF rows preserve normal, commission, work-order and manual amounts')

  const totals = context._invoicePdfTotals(rows, 1030)
  assert.strictEqual(totals.subtotal, 1030, 'PDF subtotal matches row amounts')
  assert.strictEqual(totals.gst, 0, 'PDF GST delta is zero when backend total equals subtotal')
  assert.strictEqual(totals.total, 1030, 'PDF total matches backend total')

  const incompleteAttach = await context._attachInvoicePdfToXero({ xero_bill_id: 'xero-bill-incomplete' }, {
    invoiceNumber: 'SW-INV-INCOMPLETE',
    rows,
    total: totals,
    money: { complete: false },
  })
  assert.strictEqual(incompleteAttach.skipped, true, 'PDF helper refuses incomplete persisted money')
  assert.strictEqual(incompleteAttach.reason, 'money_incomplete', 'PDF helper names the incomplete-money reason')
  assert.strictEqual(apiCalls.length, 0, 'incomplete money never reaches the attachment API')

  const attachResult = await context._attachInvoicePdfToXero({ xero_bill_id: 'xero-bill-123', invoice_number: 'SW-INV-TT-260618-001' }, {
    invoiceNumber: 'SW-INV-TT-260618-001',
    rows,
    notes: 'Test invoice',
    total: totals,
    money: {
      complete: true,
      gross_earned: 1030,
      super_rate: 0.12,
      super_amount: 123.60,
      net_pay: 906.40,
      gst_on: false,
      gst_amount: null,
      total_inc: 906.40,
    },
  })

  assert.strictEqual(attachResult.attached, true, 'PDF helper resolves with attached=true on success')
  assert.strictEqual(apiCalls.length, 1, 'PDF helper attaches exactly once')
  assert.strictEqual(apiCalls[0].action, 'attach_invoice_pdf', 'PDF helper calls attach action')
  assert.strictEqual(apiCalls[0].body.xero_bill_id, 'xero-bill-123', 'PDF helper uses returned Xero bill id')
  assert.strictEqual(apiCalls[0].body.pdf_base64, 'JVBERi1GQUtF', 'PDF helper strips data URI prefix')
  assert.strictEqual(apiCalls[0].body.filename, 'SW-INV-TT-260618-001.pdf', 'PDF helper names file from invoice number')

  pdfText.length = 0
  context._generateInvoicePDF({
    invoiceNumber: 'SW-INV-TT-260618-002',
    rows,
    notes: '',
    total: { subtotal: 1030, gst: 0, total: 997.92 },
    money: {
      complete: true,
      gross_earned: 1030,
      super_rate: 0.12,
      super_amount: 123.60,
      net_pay: 906.40,
      gst_on: true,
      gst_amount: 91.52,
      total_inc: 997.92,
    },
  })
  assert(pdfText.includes('Earned'), 'PDF labels the persisted gross amount as earned')
  assert(pdfText.includes('Less super (12%)'), 'PDF shows super as its own deduction line')
  assert(pdfText.includes('Net pay'), 'PDF shows persisted net pay')
  assert(pdfText.includes('GST'), 'PDF shows the persisted GST line')
  assert(pdfText.includes('$997.92'), 'PDF total uses the backend-persisted invoice total')
}

runDynamicHelperCheck().then(() => {
  console.log('PASS trade invoice PDF flow regression checks')
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
