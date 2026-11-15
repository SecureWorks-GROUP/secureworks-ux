// A made-up answer in the shape of ops-api xero_tieout (secureworks-backend
// xero_tieout_monthly, 20261115100000). No real supplier, job or amount.
function month(over) {
  return Object.assign({
    month: '2034-03',
    tie_out_total_ex: 5496.74,
    covers: 'bills only',
    bills: {
      count: 17, total_ex: 5496.74, total_inc: 6001.2, amount_unknown_count: 0,
      on_job_ex: 2970.35, trade_app_labour_ex: 500,
      non_job: {
        overhead_not_job_related_ex: 710.39,
        by_basis: { filed_in_bills_to_place_ex: 259.99, bookkeeping_evidence_ex: 450.4 },
        stock_ex: null, vehicles_ex: null, stock_and_vehicles: 'not_yet_separated',
      },
      unplaced_ex: 1316, unplaced_share: 0.2395,
      unplaced_by_reason: {
        waiting_in_bills_to_place: 500.55, holding_job: 120, installer_awaiting_confirmation: 600,
        not_in_intake: 45.45, rows_short_of_bill: 50,
      },
      over_allocated: { bills: 1, ex: 50, counted: false },
      negative_bill: { bills: 1, ex: -60, inc: -66, counted: false },
      parts_add_up: true,
    },
    not_counted: { draft_or_submitted_bills: 1, draft_or_submitted_ex: 77.77 },
    spend: { status: 'not_yet_read', ticket: 'TP-08', amount_ex: null, counted: false, bank_copy_partial: { rows: 12, ex: 840.5 } },
    credit_notes: { status: 'not_yet_read', ticket: 'TP-07', amount_ex: null, counted: false },
  }, over || {});
}

function answer(over) {
  return {
    ok: true,
    tieout: Object.assign({
      as_of: '2034-03-15',
      as_of_reads: 'as_of picks the months shown and nothing else.',
      on_job_rule: 'on_job_ex is what Job Profit counts for the bill today.',
      months_shown: 3,
      from_month: '2034-01-01',
      basis: 'ex GST, to the cent; supplier bills AUTHORISED or PAID in our copy of Xero, by invoice date',
      covers: 'bills only',
      complete: false,
      copy_synced_at: '2034-03-15T00:00:00Z',
      not_yet_read: [
        { part: 'spend_money', ticket: 'TP-08', why: 'Spend money and card spend are not in the bill intake yet.' },
      ],
      last_6_months: {
        from: '2033-10-01', to: '2034-03-31', bills_total_ex: 9996.74, unplaced_ex: 1316,
        unplaced_share_of_bills: 0.1317, accounted_share_of_bills: 0.8683,
      },
      undated_bills: { count: 0, ex: 0, negative_bills: 0 },
      months: [
        month(),
        month({
          month: '2034-02', tie_out_total_ex: 4500,
          bills: {
            count: 9, total_ex: 4500, total_inc: 4950, amount_unknown_count: 0,
            on_job_ex: 3000, trade_app_labour_ex: 1000,
            non_job: { overhead_not_job_related_ex: 500, by_basis: { filed_in_bills_to_place_ex: 500, bookkeeping_evidence_ex: 0 } },
            unplaced_ex: 0, unplaced_share: 0,
            unplaced_by_reason: { waiting_in_bills_to_place: 0, holding_job: 0, installer_awaiting_confirmation: 0, not_in_intake: 0, rows_short_of_bill: 0 },
            over_allocated: { bills: 0, ex: 0, counted: false },
            negative_bill: { bills: 0, ex: 0, inc: 0, counted: false },
            parts_add_up: true,
          },
          not_counted: { draft_or_submitted_bills: 0, draft_or_submitted_ex: 0 },
          spend: { status: 'not_yet_read', amount_ex: null, bank_copy_partial: { rows: 0, ex: null } },
          credit_notes: {
            status: 'read', notes: 2, total_ex: 300, amount_ex: 300, on_job_ex: { counted_from_credit_note_ex: 250 },
            not_placed_inc: 55, unallocated_inc: 0, parts_add_up: true,
          },
        }),
        month({
          month: '2034-01', tie_out_total_ex: 0,
          bills: {
            count: 0, total_ex: 0, total_inc: 0, amount_unknown_count: 0, on_job_ex: 0, trade_app_labour_ex: 0,
            non_job: { overhead_not_job_related_ex: 0, by_basis: { filed_in_bills_to_place_ex: 0, bookkeeping_evidence_ex: 0 } },
            unplaced_ex: 0, unplaced_share: null,
            unplaced_by_reason: { waiting_in_bills_to_place: 0, holding_job: 0, installer_awaiting_confirmation: 0, not_in_intake: 0, rows_short_of_bill: 0 },
            over_allocated: { bills: 0, ex: 0 }, negative_bill: { bills: 0, ex: 0 }, parts_add_up: true,
          },
          not_counted: { draft_or_submitted_bills: 0, draft_or_submitted_ex: 0 },
          spend: { status: 'not_yet_read', amount_ex: null, bank_copy_partial: { rows: 0, ex: null } },
          credit_notes: { status: 'not_yet_read', amount_ex: null },
        }),
      ],
    }, over || {}),
  };
}

module.exports = { answer, month };
