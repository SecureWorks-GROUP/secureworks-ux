#!/usr/bin/env node
const fs = require('fs')
const assert = require('assert')
const vm = require('vm')

const html = fs.readFileSync('trade.html', 'utf8')

function extractFunction(name) {
  const marker = `function ${name}(`
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
    MyMoneyCore: undefined,
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
    _invoiceApiContext: () => ({ gen: 1, userId: 'user-1' }),
    _invoiceApiCurrent: () => true,
    _beginFinancialWrite: () => true,
    _endFinancialWrite: () => {},
    _financialInvoiceApi: async (action, params, body) => {
      apiCalls.push({ action, params, body })
      return { success: true }
    },
  }
  context.global = context

  const startMark = '// <trade-my-money>'
  const endMark = '// </trade-my-money>'
  const start = html.indexOf(startMark)
  const end = html.indexOf(endMark, start + startMark.length)
  assert(start !== -1 && end !== -1 && end > start, 'trade-my-money sentinels exist for super split')

  const dynamicSource = [
    html.slice(start, end + endMark.length),
    extractFunction('_invoiceHasPersistedNumber'),
    extractFunction('_invoiceSubmitSucceeded'),
    extractFunction('_invoiceXeroPushPending'),
    extractFunction('_invoiceSubmitStatusMessage'),
    extractFunction('_invoiceGeneratedStatusMessage'),
    extractFunction('_invoiceBool'),
    extractFunction('_invoiceSuperRate'),
    extractFunction('_invoiceMoney'),
    extractFunction('_invoicePersistedMoney'),
    extractFunction('_invoiceResponseLines'),
    extractFunction('_invoicePersistedPdfRows'),
    extractFunction('_invoicePdfDataFromResponse'),
    extractFunction('_attachInvoicePdfToXero'),
    extractFunction('_invoiceRateLabel'),
    extractFunction('_invoiceMoneySummaryHtml'),
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
      { line_date: '2026-06-01', job_number: 'SWMS-26671', description: 'Persisted zero-value line', division: 'Make Safe', line_type: 'labour', total_hours: 0, hourly_rate: 0, line_total_ex: 300 },
      { line_date: '2026-06-02', job_number: 'SWMS-26672', description: 'Persisted commission', division: 'Fencing', line_type: 'commission', quantity: 1, unit_rate: 175, line_total_ex: 175 },
      { line_date: '2026-06-03', job_number: 'SWMS-26673', description: 'Persisted work order', division: 'Fencing', line_type: 'work_order', quantity: 1, unit_rate: 375, line_total_ex: 375 },
      { line_date: '2026-06-04', job_number: 'SWMS-26674', description: 'Persisted manual labour', division: 'General Labour', line_type: 'labour', total_hours: 2, hourly_rate: 90, line_total_ex: 180 },
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
    ['division'],
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
  assert.strictEqual(
    context._invoiceSubmitStatusMessage({ code: 'XERO_PUSH_FAILED', success: true, invoice_id: 'saved', error: 'Xero unavailable' }, 'Invoice submitted to Xero'),
    'Invoice saved — Xero sync pending. The office will push it manually. Xero unavailable',
    'a saved invoice with failed Xero push always states the durable pending status before backend detail',
  )
  assert.strictEqual(
    context._invoiceSubmitStatusMessage({ success: true, xero_bill_number: 'DRAFT-123' }, 'Invoice submitted to Xero'),
    'Invoice submitted to Xero — DRAFT-123',
    'a confirmed Xero success keeps the success label and persisted bill number',
  )
  const unmigratedMoney = context._invoicePersistedMoney({
    gross_earned: 1000,
    super_rate: 0.12,
    super_amount: 120,
    net_pay: 880,
    gst_on: false,
  })
  assert.strictEqual(unmigratedMoney.complete, true, 'unmigrated GST-off money is still complete')
  assert.strictEqual(unmigratedMoney.super_amount, 120, 'unmigrated fund total stays 12%')
  assert.strictEqual(unmigratedMoney.worker_withhold, 60, 'unmigrated worker withhold is half the rate')
  assert.strictEqual(unmigratedMoney.company_contribution, 60, 'unmigrated company contribution is the remainder')
  assert.strictEqual(unmigratedMoney.amount_payable, 940, 'legacy full-carve-out net_pay is refused as cash')
  assert.strictEqual(unmigratedMoney.net_pay, 880, 'unmigrated net_pay is kept but not used as cash')
  assert.strictEqual(unmigratedMoney.total_inc, 940, 'GST-off total uses cash payable, not old net_pay')

  // Submit/generate responses carry the secureworks-backend #865 money shape.
  const backendSplitMoney = context._invoicePersistedMoney({
    gross_earned: 1000,
    super_rate: 0.12,
    super_amount: 120,
    net_pay: 940,
    amount_payable: 940,
    worker_withhold: 60,
    company_contribution: 60,
    company_total_out: 1060,
    trade_payable: 940,
    gst: 0,
    total_inc: 1000,
    gst_on: false,
  })
  assert.strictEqual(backendSplitMoney.complete, true, 'backend #865 GST-off money is complete')
  assert.strictEqual(backendSplitMoney.worker_withhold, 60, 'backend worker_withhold reaches the screen')
  assert.strictEqual(backendSplitMoney.company_contribution, 60, 'backend company_contribution reaches the screen')
  assert.strictEqual(backendSplitMoney.amount_payable, 940, 'backend amount_payable is cash')
  assert.strictEqual(backendSplitMoney.total_inc, 940, 'GST-off total is the backend cash figure')

  const backendOtherMoney = context._invoicePersistedMoney({
    gross_earned: 1000,
    super_rate: 0.12,
    super_amount: 120,
    net_pay: 950,
    amount_payable: 950,
    worker_withhold: 50,
    company_contribution: 70,
    gst_on: false,
  })
  assert.strictEqual(backendOtherMoney.worker_withhold, 50, 'a backend withhold that differs from gross*rate/2 wins')
  assert.strictEqual(backendOtherMoney.company_contribution, 70, 'a backend company contribution that differs wins')
  assert.strictEqual(backendOtherMoney.amount_payable, 950, 'a backend cash figure that differs wins')
  const backendOtherHtml = context._invoiceMoneySummaryHtml(backendOtherMoney)
  assert(backendOtherHtml.includes('$950.00') && backendOtherHtml.includes('$50.00') && backendOtherHtml.includes('$70.00'), 'summary renders the backend figures, not the derivation')

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
  const gstOnLegacyAmount = context._invoicePersistedMoney({
    gross_earned: 100,
    super_rate: 0.12,
    super_amount: 12,
    net_pay: 88,
    gst_on: true,
    gst: 8.8,
    total_inc: 96.8,
  })
  assert.strictEqual(gstOnLegacyAmount.complete, false, 'GST-on money rejects legacy gst without authoritative gst_amount')
  const generatedPending = context._invoiceGeneratedStatusMessage({
    code: 'XERO_PUSH_FAILED',
    success: true,
    invoice_id: 'saved',
    userMessage: 'Xero unavailable',
  })
  assert(generatedPending.includes('Invoice saved — Xero sync pending.'), 'quick generation always names the pending Xero state')
  assert(generatedPending.includes('confirmed figures unavailable'), 'quick generation names missing persisted money')
  assert(!generatedPending.includes('NaN'), 'quick generation never formats missing money as NaN')
  assert(html.includes('toast(_invoiceGeneratedStatusMessage(result));'), 'generateTradeInvoice routes its toast through persisted money and submit status truth')

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
  assert(pdfText.includes('Super (12%) paid into your super fund'), 'PDF shows the 12% fund total')
  assert(pdfText.includes('Your share of super (6%)'), 'PDF shows the worker share')
  assert(pdfText.includes('Company covers the other 6%'), 'PDF shows the company share')
  assert(pdfText.includes('You get paid'), 'PDF shows cash payable, not Net pay')
  assert(!pdfText.includes('Net pay'), 'PDF never uses the old Net pay label')
  assert(!pdfText.includes('Less super'), 'PDF never uses the old Less super label')
  assert(pdfText.includes('$61.80'), 'PDF worker share is half of $123.60')
  assert(pdfText.includes('$968.20'), 'PDF cash is gross minus worker share, not old net_pay')
  assert(pdfText.includes('GST'), 'PDF shows the persisted GST line')
  assert(pdfText.includes('$997.92'), 'PDF total uses the backend-persisted invoice total')
  assert(pdfText.includes('0.00'), 'PDF renders persisted zero hours instead of a blank')
  assert(pdfText.includes('$0.00'), 'PDF renders persisted zero rates instead of a blank')

  pdfText.length = 0
  context._generateInvoicePDF({
    invoiceNumber: 'SW-INV-TT-260618-003',
    rows,
    notes: '',
    money: backendOtherMoney,
  })
  assert(pdfText.includes('-$50.00'), 'PDF worker line is the backend worker_withhold')
  assert(pdfText.includes('$70.00'), 'PDF company line is the backend company_contribution')
  assert(pdfText.includes('$950.00'), 'PDF cash is the backend amount_payable')
}

runDynamicHelperCheck().then(() => {
  console.log('PASS trade invoice PDF flow regression checks')
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
