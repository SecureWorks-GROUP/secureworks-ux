// list_expenses supplies this metadata only with trade_reimbursement_line_v1 on.
// Never infer eligibility or money from a saved draft or a payment method.
export function receiptsEnabled(rows) {
  return Array.isArray(rows) && rows.some((r) => typeof r.reimbursement?.claimable === 'boolean' && r.reimbursement.reason !== 'reimbursement_switch_off');
}

const REASONS = {
  reimbursement_switch_off: 'Reimbursements on an invoice are not switched on yet. Add the receipt under Expenses.',
  reimbursement_not_yours: 'That receipt is not one of yours.',
  reimbursement_not_personal_spend: 'Only something you paid for yourself can be paid back.',
  reimbursement_receipt_required: 'Add a photo of the receipt first. A reimbursement needs its receipt.',
  reimbursement_rejected: 'The office sent this receipt back.',
  reimbursement_already_claimed: 'This receipt is already on an invoice.'
};
export function receiptProblem(row) {
  if (!row || typeof row.reimbursement?.claimable !== 'boolean') return 'This receipt could not be checked. Try again or remove it from this invoice.';
  if (row.reimbursement.claimable !== true) return REASONS[row.reimbursement.reason] || row.reimbursement.reason || 'This receipt cannot be added right now.';
  return Number.isFinite(Number(row.total_amount)) && Number(row.total_amount) > 0 ? '' : 'The receipt amount has not been read. Check it under Expenses first.';
}
export function receiptLine(row) {
  return { key: 'receipt:' + row.id, kind: 'reimbursement', type: 'reimbursement', receiptId: row.id,
    title: 'Reimbursement (receipt)', description: row.vendor_name || 'Receipt', amount: Number(row.total_amount),
    jobNumber: row.jobs?.job_number || '', date: String(row.receipt_date || '').slice(0, 10), status: row.status };
}
export function refreshReceiptLine(line, rows, userId) {
  const row = (rows || []).find((r) => r.id === line.receiptId && r.submitted_by === userId);
  const problem = receiptProblem(row);
  return { ...line, ...(row ? receiptLine(row) : {}), key: line.key, added: true, off: false, receiptProblem: problem, amount: problem ? null : Number(row.total_amount) };
}
// Only the backend's skipped ids are excluded from the accepted receipt list.
export function receiptSendFacts(lines, result) {
  const skipped = Array.isArray(result.skipped_items) ? result.skipped_items : [];
  const ids = new Set(skipped.map((s) => s.expense_receipt_id));
  return { skipped: skipped.map((s) => s.words || REASONS[s.code] || 'A receipt was left off this invoice.'),
    accepted: lines.filter((l) => l.kind === 'reimbursement' && !ids.has(l.receiptId)).map((l) => ({ ...l, waiting: l.status !== 'approved' })) };
}
