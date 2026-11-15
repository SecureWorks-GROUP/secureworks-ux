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

// A made-up second read in the shape of xero_spend_revenue_monthly (20261115110000), as ops-api returns it
// beside the bills answer: { ok: true, answer } or { ok: false, reason }.
function spendRevenue(over) {
  return {
    ok: true,
    answer: Object.assign({
      as_of: '2034-03-15',
      months_shown: 3,
      from_month: '2034-01-01',
      basis: 'ex GST, to the cent; spend money by transaction date, customer invoices by invoice date',
      spend_copy: { first_transaction_date: '2034-02-03', lines_read_at: '2034-03-14T22:45:00Z', chart_accounts: 7, synced_at: '2034-03-15T00:00:00Z' },
      last_6_months: {
        from: '2033-10', to: '2034-03', revenue_total_ex: 12400, revenue_not_on_job_ex: 850, revenue_on_job_share: 0.9315,
        spend_months_read: 1, spend_total_ex: 575.26, spend_direct_cost_ex: 130,
      },
      months: [
        {
          month: '2034-03',
          spend: {
            status: 'partial', ticket: 'TP-08', counted: false, transactions: 7, with_line_detail: 5, amount_unknown_count: 0,
            amount_ex: 575.26, total_ex: 575.26,
            direct_cost: { ex: 130, on_job_ex: null, on_job: 'no_route_yet', by_tracking: [{ tracking: 'SW - FENCING', lines: 1, ex: 100 }, { tracking: null, lines: 1, ex: 30 }] },
            overhead_ex: 70, not_a_cost_ex: 200, income_account_ex: 30, account_unknown_ex: 50, account_unknown_lines: 1,
            paid_ahead_ex: 0, paid_ahead_lines: 0,
            no_line_detail_ex: 95.25, lines_differ_ex: 0.01, lines_differ_transactions: 0, unread_lines: 0,
            by_account: [
              { code: '800', name: 'Vehicle loan', kind: 'not_a_cost', lines: 1, ex: 200 },
              { code: '305', name: 'Direct Material Cost', kind: 'direct_cost', lines: 1, ex: 100 },
              { code: '302', name: 'Fuel', kind: 'overhead', lines: 1, ex: 50 },
              { code: '999', name: null, kind: 'account_unknown', lines: 1, ex: 50 },
              { code: '200', name: 'Sales', kind: 'income_account', lines: 1, ex: 30 },
              { code: '312', name: 'Materials stock', kind: 'direct_cost', lines: 1, ex: 30 },
              { code: '312', name: 'Tools (old)', kind: 'overhead', lines: 1, ex: 20 },
            ],
            parts_add_up: true,
          },
          revenue: {
            invoices: 5, amount_unknown_count: 0, total_ex: 2400, on_job_ex: 1600, holding_job_ex: 300, not_on_job_ex: 550,
            not_on_job_invoices: 2, not_on_job_share: 0.3542, over_counted: { invoices: 1, ex: 50 },
            not_counted: { draft_or_submitted_invoices: 2, draft_or_submitted_ex: 1110 }, parts_add_up: true,
          },
        },
        {
          month: '2034-02',
          spend: {
            status: 'not_yet_read', counted: false, transactions: 3, with_line_detail: 0, amount_unknown_count: 0, amount_ex: null, total_ex: 410.5,
            direct_cost: null, overhead_ex: null, not_a_cost_ex: null, income_account_ex: null, account_unknown_ex: null, account_unknown_lines: 0,
            no_line_detail_ex: 410.5, lines_differ_ex: null, by_account: null, parts_add_up: null,
          },
          revenue: {
            invoices: 4, amount_unknown_count: 0, total_ex: 10000, on_job_ex: 10000, holding_job_ex: 0, not_on_job_ex: 0,
            not_on_job_invoices: 0, not_on_job_share: 0, over_counted: { invoices: 0, ex: 0 },
            not_counted: { draft_or_submitted_invoices: 0, draft_or_submitted_ex: 0 }, parts_add_up: true,
          },
        },
        {
          month: '2034-01',
          spend: {
            status: 'not_in_copy', counted: false, transactions: 0, with_line_detail: 0, amount_unknown_count: 0, amount_ex: null, total_ex: null,
            direct_cost: null, overhead_ex: null, not_a_cost_ex: null, income_account_ex: null, account_unknown_ex: null, account_unknown_lines: 0,
            no_line_detail_ex: null, lines_differ_ex: null, by_account: null, parts_add_up: null,
          },
          revenue: {
            invoices: 0, amount_unknown_count: 0, total_ex: 0, on_job_ex: 0, holding_job_ex: 0, not_on_job_ex: 0,
            not_on_job_invoices: 0, not_on_job_share: null, over_counted: { invoices: 0, ex: 0 },
            not_counted: { draft_or_submitted_invoices: 0, draft_or_submitted_ex: 0 }, parts_add_up: false,
          },
        },
      ],
    }, over || {}),
  };
}

// The bills answer with the second read beside it.
function answerWithSpendRevenue(over) {
  return Object.assign(answer(), { spend_revenue: spendRevenue(over) });
}

module.exports = { answer, month, spendRevenue, answerWithSpendRevenue };
