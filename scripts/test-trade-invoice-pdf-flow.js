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
    extractFunction('_invoiceHasPersistedNumber'),
    extractFunction('_invoiceSubmitSucceeded'),
    extractFunction('_invoiceBool'),
    extractFunction('_invoiceSuperRate'),
    extractFunction('_invoicePersistedMoney'),
    extractFunction('_invoicePersistedPdfRows'),
    extractFunction('_invoicePdfDataFromResponse'),
    extractFunction('_attachInvoicePdfToXero'),
    extractFunction('_invoiceRateLabel'),
    extractFunction('_generateInvoicePDF'),
  ].join('\n')
  vm.runInNewContext(dynamicSource, context)

  const persistedResult = {
    invoice_number: 'SW-INV-TT-260618-001',
    gross_earned: 1030,
    super_rate: 0.12,
    super_amount: 123.60,
    net_pay: 906.40,
    gst_on: false,
    total_inc: 906.40,
    lines: [
      { line_date: '2026-06-01', job_number: 'SWMS-26671', description: 'Persisted normal line', line_type: 'labour', total_hours: 3, hourly_rate: 100, line_total_ex: 300 },
      { line_date: '2026-06-02', job_number: 'SWMS-26672', description: 'Persisted commission', line_type: 'commission', quantity: 1, unit_rate: 175, line_total_ex: 175 },
      { line_date: '2026-06-03', job_number: 'SWMS-26673', description: 'Persisted work order', line_type: 'work_order', quantity: 1, unit_rate: 375, line_total_ex: 375 },
      { line_date: '2026-06-04', job_number: 'SWMS-26674', description: 'Persisted manual labour', line_type: 'labour', total_hours: 2, hourly_rate: 90, line_total_ex: 180 },
    ],
  }
  const rows = context._invoicePersistedPdfRows(persistedResult)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows.map((r) => r.amount))), [300, 175, 375, 180], 'PDF rows use persisted response line amounts')
  assert.strictEqual(context._invoicePersistedPdfRows({ lines: [] }), null, 'missing persisted response lines suppress the PDF')
  assert.strictEqual(context._invoicePersistedPdfRows({ lines: [{ description: 'No persisted amount' }] }), null, 'an incomplete persisted line suppresses the PDF')
  ;[
    ['line_date'],
    ['job_number'],
    ['description'],
    ['line_type'],
    ['total_hours', 'quantity'],
    ['hourly_rate', 'unit_rate'],
    ['line_total_ex'],
  ].forEach((fields) => {
    const incompleteLine = { ...persistedResult.lines[0] }
    fields.forEach((field) => delete incompleteLine[field])
    assert.strictEqual(
      context._invoicePersistedPdfRows({ lines: [incompleteLine] }),
      null,
      `missing persisted ${fields.join('/')} suppresses the PDF`,
    )
  })
  assert.strictEqual(context._invoiceSubmitSucceeded({}), false, 'an unknown response does not imply invoice success')
  assert.strictEqual(context._invoiceSubmitSucceeded({ ok: true }), true, 'explicit ok confirms invoice success')
  assert.strictEqual(context._invoiceSubmitSucceeded({ invoice_number: 'SW-INV-PERSISTED' }), true, 'durable invoice identity confirms persisted success')
  assert.strictEqual(context._invoiceSubmitSucceeded({ ok: false, invoice_number: 'SW-INV-CONFLICT' }), false, 'an explicit failure overrides invoice identity')
  assert.strictEqual(
    context._invoiceSubmitSucceeded({ code: 'XERO_PUSH_FAILED', success: true, invoice_id: 'invoice-saved' }),
    true,
    'a failed Xero push is successful only when the saved invoice is identified',
  )
  assert.strictEqual(
    context._invoiceSubmitSucceeded({ code: 'XERO_PUSH_FAILED', success: true }),
    false,
    'a failed Xero push without durable invoice identity does not imply success',
  )
  const gstOnLegacyTotal = context._invoicePersistedMoney({
    gross_earned: 100,
    super_rate: 0.12,
    super_amount: 12,
    net_pay: 88,
    gst_on: true,
    gst_amount: 8.8,
    total: 96.8,
  })
  assert.strictEqual(gstOnLegacyTotal.complete, false, 'GST-on money rejects legacy total without authoritative total_inc')

  const incompleteAttach = await context._attachInvoicePdfToXero({ xero_bill_id: 'xero-bill-incomplete' }, null)
  assert.strictEqual(incompleteAttach.skipped, true, 'PDF helper refuses an incomplete persisted response')
  assert.strictEqual(incompleteAttach.reason, 'persisted_response_incomplete', 'PDF helper names the persisted-response reason')
  assert.strictEqual(apiCalls.length, 0, 'an incomplete persisted response never reaches the attachment API')

  const pdfData = context._invoicePdfDataFromResponse(persistedResult, 'Test invoice')
  assert(pdfData, 'complete persisted money and lines enable the PDF')
  const attachResult = await context._attachInvoicePdfToXero({ xero_bill_id: 'xero-bill-123', invoice_number: 'SW-INV-TT-260618-001' }, pdfData)

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
