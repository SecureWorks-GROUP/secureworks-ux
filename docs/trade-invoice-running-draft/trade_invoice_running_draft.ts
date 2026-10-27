// Running weekly invoice draft.
//
// Save stores one draft per person per week. It never submits, authorises,
// pays, or creates a Xero bill. GST, super and the weekly deduction stay on
// generate_trade_invoice. Keep the merge rules in step with
// secureworks-ux modules/trade-invoice-running-draft.js.
//
// Screen flag: users.trade_details.runningInvoiceDraft === true.
// my_hours reports that as running_invoice_draft.

export class RunningDraftError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BLOCKED_KEYS = ['submit', 'send', 'authorise', 'authorize', 'pay', 'xero', 'xero_bill_id', 'xero_status', 'create_xero']
const ASSIGNMENT_STATUSES = ['scheduled', 'confirmed', 'in_progress', 'complete']
const WORK_ORDER_STATUSES = ['complete', 'sent', 'accepted']
const RELEASED = ['draft', 'failed', 'ops-reject']

export function runningInvoiceDraftEnabled(tradeDetails: unknown): boolean {
  return !!(tradeDetails && typeof tradeDetails === 'object' && (tradeDetails as { runningInvoiceDraft?: unknown }).runningInvoiceDraft === true)
}

export function sourceKey(line: Record<string, unknown> | null | undefined): string {
  if (!line) return ''
  if (line.source_key) return String(line.source_key)
  if (line.work_order_id) return 'wo:' + line.work_order_id
  if (line.assignment_id) return 'as:' + line.assignment_id
  const day = String(line.work_date || line.scheduled_date || line.line_date || '')
  if (line.job_id && day) return 'job:' + line.job_id + ':' + day.slice(0, 10)
  return ''
}

export function mergeApproved(state: {
  cards?: Array<Record<string, unknown>>
  dismissed?: string[]
  claimed?: string[]
  suggested?: Array<Record<string, unknown>>
}): { cards: Array<Record<string, unknown>>; added: string[]; dismissed: string[] } {
  const cards = JSON.parse(JSON.stringify(state.cards || [])) as Array<Record<string, unknown>>
  const dismissed = new Set((state.dismissed || []).filter(Boolean).map(String))
  const claimed = new Set((state.claimed || []).filter(Boolean).map(String))
  const existing = new Set<string>()
  for (const card of cards) {
    const key = sourceKey(card)
    if (key) existing.add(key)
  }
  const added: string[] = []
  for (const raw of state.suggested || []) {
    const line = JSON.parse(JSON.stringify(raw || {})) as Record<string, unknown>
    const key = sourceKey(line)
    if (!key || existing.has(key) || dismissed.has(key) || claimed.has(key)) continue
    line.source_key = key
    if (line.included == null) line.included = true
    line.auto = true
    cards.push(line)
    existing.add(key)
    added.push(key)
  }
  return { cards, added, dismissed: [...dismissed] }
}

function assertNoSend(body: Record<string, unknown> | null | undefined): void {
  if (!body || typeof body !== 'object') return
  for (const key of BLOCKED_KEYS) {
    if (body[key]) {
      throw new RunningDraftError(
        'An agent can only save a draft. It cannot submit, send, authorise, pay, or create a Xero bill.',
        403,
        'agent_draft_only',
      )
    }
  }
  if (body.status && body.status !== 'draft') {
    throw new RunningDraftError(
      'An agent can only save a draft. It cannot submit, send, authorise, pay, or create a Xero bill.',
      403,
      'agent_draft_only',
    )
  }
  const action = String(body.action || '')
  if (action && !['save_running_invoice_draft', 'get_running_invoice_draft', 'sync_running_invoice_draft', 'agent_save_running_invoice_draft'].includes(action)) {
    throw new RunningDraftError(
      'An agent can only save a draft. It cannot submit, send, authorise, pay, or create a Xero bill.',
      403,
      'agent_draft_only',
    )
  }
}

function roundMoney(value: unknown): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

function uuidOrNull(value: unknown): string | null {
  const text = String(value || '')
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function assertMonday(iso: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new RunningDraftError('week_start must be a Monday.', 422, 'week_start')
  }
  const [year, month, day] = iso.split('-').map(Number)
  if (new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 1) {
    throw new RunningDraftError('week_start must be a Monday.', 422, 'week_start')
  }
}

function perthDay(value: unknown): string {
  if (!value) return ''
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const time = new Date(text).getTime()
  if (Number.isNaN(time)) return ''
  return new Date(time + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function inWeek(day: string, weekStart: string, weekEnd: string): boolean {
  return !!day && day >= weekStart && day <= weekEnd
}

async function loadUser(client: any, userId: string) {
  if (!uuidOrNull(userId)) throw new RunningDraftError('That person was not found.', 404, 'running_draft_user')
  const { data, error } = await client.from('users').select('id, org_id, role, trade_details').eq('id', userId).maybeSingle()
  if (error) throw new RunningDraftError('Could not read this person.', 503, 'running_draft_lookup')
  if (!data?.id || !data.org_id) throw new RunningDraftError('That person was not found.', 404, 'running_draft_user')
  return data
}

function requireFlag(user: { trade_details?: unknown }) {
  if (!runningInvoiceDraftEnabled(user.trade_details)) {
    throw new RunningDraftError('Saving is not switched on for this account yet.', 403, 'running_draft_off')
  }
}

async function loadDraft(client: any, userId: string, orgId: string, weekStart: string) {
  const { data, error } = await client.from('trade_invoices')
    .select('id, created_by_agent, draft_builder, draft_origin, agent_label, dismissed_source_keys, notes, gst_on')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('week_start', weekStart)
    .eq('status', 'draft')
    .eq('invoice_source', 'hourly')
    .order('created_at', { ascending: true })
  if (error) {
    const missing = /draft_builder|column/i.test(String(error.message || ''))
    throw new RunningDraftError(
      missing ? 'Running draft storage is not installed yet.' : 'Could not read the draft.',
      503,
      missing ? 'running_draft_storage' : 'running_draft_lookup',
    )
  }
  const rows = data || []
  if (rows.length > 1) {
    throw new RunningDraftError('Multiple weekly drafts need office review.', 409, 'multiple_drafts')
  }
  return rows[0] || null
}

async function loadClaimed(client: any, userId: string): Promise<string[]> {
  const keys = new Set<string>()
  const { data: invoices, error } = await client.from('trade_invoices')
    .select('id, work_order_id, status')
    .eq('user_id', userId)
    .not('status', 'in', '(draft,failed,ops-reject)')
  if (error) throw new RunningDraftError('Could not read invoices already sent.', 503, 'running_draft_lookup')
  const rows = invoices || []
  const ids: string[] = []
  for (const row of rows) {
    if (RELEASED.includes(String(row.status || ''))) continue
    ids.push(row.id)
    if (row.work_order_id) keys.add('wo:' + row.work_order_id)
  }
  if (ids.length) {
    const { data: lines, error: lineError } = await client.from('trade_invoice_lines')
      .select('job_id, line_date, assignment_ids, source_work_order_id')
      .in('trade_invoice_id', ids)
    if (lineError) throw new RunningDraftError('Could not read invoices already sent.', 503, 'running_draft_lookup')
    for (const line of lines || []) {
      if (line.source_work_order_id) keys.add('wo:' + line.source_work_order_id)
      const day = String(line.line_date || '').slice(0, 10)
      if (line.job_id && day) keys.add('job:' + line.job_id + ':' + day)
      const assignmentIds = Array.isArray(line.assignment_ids) ? line.assignment_ids : []
      for (const id of assignmentIds) if (id) keys.add('as:' + id)
    }
  }
  const { data: locked, error: lockError } = await client.from('job_assignments')
    .select('id, invoiced_in')
    .eq('user_id', userId)
    .not('invoiced_in', 'is', null)
  if (lockError) throw new RunningDraftError('Could not read work already invoiced.', 503, 'running_draft_lookup')
  const sent = new Set(ids)
  for (const row of locked || []) {
    if (row.id && sent.has(row.invoiced_in)) keys.add('as:' + row.id)
  }
  return [...keys]
}

async function loadSuggested(client: any, userId: string, weekStart: string, weekEnd: string): Promise<Array<Record<string, unknown>>> {
  const suggested: Array<Record<string, unknown>> = []
  const { data: assignments, error } = await client.from('job_assignments')
    .select('id, job_id, scheduled_date, status, jobs(id, job_number, client_name, site_suburb, type)')
    .eq('user_id', userId)
    .gte('scheduled_date', weekStart)
    .lte('scheduled_date', weekEnd)
    .in('status', ASSIGNMENT_STATUSES)
    .limit(200)
  if (error) throw new RunningDraftError('Could not read this week\'s jobs.', 503, 'running_draft_lookup')
  for (const row of assignments || []) {
    if (!row.scheduled_date) continue
    const job = row.jobs || {}
    suggested.push({
      assignment_id: row.id,
      job_id: row.job_id || job.id || null,
      job_number: job.job_number || '',
      client_name: job.client_name || '',
      site_suburb: job.site_suburb || '',
      job_type: job.type || '',
      scheduled_date: String(row.scheduled_date).slice(0, 10),
      included: true,
      auto: true,
    })
  }

  const { data: orders, error: orderError } = await client.from('work_orders')
    .select('id, job_id, status, kind, scheduled_date, completed_at, jobs(id, job_number, client_name, site_suburb, type)')
    .eq('assigned_user_id', userId)
    .in('status', WORK_ORDER_STATUSES)
    .limit(200)
  if (orderError) throw new RunningDraftError('Could not read this week\'s work orders.', 503, 'running_draft_lookup')
  for (const order of orders || []) {
    if (String(order.kind || '') === 'job') continue
    const day = perthDay(order.completed_at) || String(order.scheduled_date || '').slice(0, 10)
    if (!inWeek(day, weekStart, weekEnd)) continue
    const job = order.jobs || {}
    suggested.push({
      work_order_id: order.id,
      job_id: order.job_id || job.id || null,
      job_number: job.job_number || '',
      client_name: job.client_name || '',
      site_suburb: job.site_suburb || '',
      job_type: job.type || '',
      scheduled_date: day,
      included: true,
      auto: true,
    })
  }
  return suggested
}

function linesFromCards(cards: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const lines: Array<Record<string, unknown>> = []
  for (const card of cards) {
    if (!card || card.included === false || card.wo_mode || card.commission_mode) continue
    const hours = Number(card.hours)
    if (!(hours > 0)) continue
    const quantity = roundMoney(hours)
    const unitRate = roundMoney(card.rate)
    const lineTotal = roundMoney(quantity * unitRate)
    const day = String(card.work_date || card.scheduled_date || '').slice(0, 10)
    lines.push({
      job_id: uuidOrNull(card.job_id),
      job_number: card.job_number || null,
      client_name: card.client_name || null,
      description: card.description || null,
      line_type: 'labour',
      quantity,
      unit: 'h',
      unit_rate: unitRate,
      line_total_ex: lineTotal,
      total_hours: quantity,
      hourly_rate: unitRate,
      line_date: day || null,
      work_date: day || null,
      start_time: card.start_time || null,
      finish_time: card.finish_time || null,
      break_minutes: Number(card.break_minutes) || 0,
      acknowledgment_status: 'pending',
    })
  }
  return lines
}

function headerFor(user: { id: string; org_id: string }, weekStart: string, weekEnd: string, builder: Record<string, unknown>, lines: Array<Record<string, unknown>>) {
  const sum = roundMoney(lines.reduce((total, line) => total + Number(line.line_total_ex || 0), 0))
  const hours = roundMoney(lines.reduce((total, line) => total + Number(line.total_hours || 0), 0))
  return {
    org_id: user.org_id,
    user_id: user.id,
    week_start: weekStart,
    week_end: weekEnd,
    status: 'draft',
    invoice_source: 'hourly',
    subtotal_ex: sum,
    gross_earned: sum,
    net_pay: sum,
    total_inc: sum,
    gst: 0,
    gst_on: !!builder.gst_on,
    super_rate: 0,
    super_amount: 0,
    total_hours: hours,
    total_breaks_minutes: 0,
    notes: builder.notes || null,
    has_manual_overrides: false,
  }
}

export async function getRunningInvoiceDraft(client: any, userId: string, weekStartRaw: string | null) {
  const user = await loadUser(client, userId)
  requireFlag(user)
  const weekStart = String(weekStartRaw || '').slice(0, 10)
  assertMonday(weekStart)
  const weekEnd = addDays(weekStart, 6)
  const draft = await loadDraft(client, user.id, user.org_id, weekStart)
  const [suggested, claimed] = await Promise.all([
    loadSuggested(client, user.id, weekStart, weekEnd),
    loadClaimed(client, user.id),
  ])
  const builder = draft?.draft_builder && typeof draft.draft_builder === 'object' ? draft.draft_builder : null
  return {
    ok: true,
    draft_id: draft?.id || null,
    status: 'draft',
    created_by_agent: !!draft?.created_by_agent,
    draft_origin: draft?.draft_origin || null,
    agent_label: draft?.agent_label || null,
    xero: false,
    draft_builder: builder,
    suggested,
    claimed,
    dismissed_source_keys: draft?.dismissed_source_keys || builder?.dismissedKeys || [],
    pay_rules: 'unchanged_until_submit',
  }
}

export async function saveRunningInvoiceDraft(
  client: any,
  userId: string,
  body: Record<string, any> | null,
  mode: 'staff' | 'agent' | 'auto',
) {
  assertNoSend(body || {})
  const user = await loadUser(client, userId)
  requireFlag(user)
  const weekStart = String(body?.week_start || body?.draft_builder?.weekStart || '').slice(0, 10)
  assertMonday(weekStart)
  const weekEnd = addDays(weekStart, 6)
  const prior = await loadDraft(client, user.id, user.org_id, weekStart)
  if (body?.draft_id && prior && String(body.draft_id) !== String(prior.id)) {
    throw new RunningDraftError('That draft was replaced. Open the week again.', 409, 'draft_replaced')
  }
  const incoming = body?.draft_builder && typeof body.draft_builder === 'object'
    ? body.draft_builder
    : (prior?.draft_builder && typeof prior.draft_builder === 'object' ? prior.draft_builder : {})
  const [suggested, claimed] = await Promise.all([
    loadSuggested(client, user.id, weekStart, weekEnd),
    loadClaimed(client, user.id),
  ])
  const agentLines = mode === 'agent' && Array.isArray(body?.lines) ? body.lines : []
  const merged = mergeApproved({
    cards: Array.isArray(incoming.jobCards) ? incoming.jobCards : [],
    dismissed: Array.isArray(incoming.dismissedKeys) ? incoming.dismissedKeys : (prior?.dismissed_source_keys || []),
    claimed,
    suggested: suggested.concat(agentLines),
  })
  const builder = {
    version: 1,
    jobCards: merged.cards,
    invRows: Array.isArray(incoming.invRows) ? incoming.invRows : [],
    invLumpLines: Array.isArray(incoming.invLumpLines) ? incoming.invLumpLines : [],
    dismissedKeys: merged.dismissed,
    notes: body?.notes != null ? body.notes : (incoming.notes || ''),
    gst_on: body?.gst_on != null ? !!body.gst_on : !!incoming.gst_on,
    weekStart,
    weekEnd,
  }
  const lines = linesFromCards(merged.cards)
  const createdByAgent = mode === 'agent' ? true : !!prior?.created_by_agent
  const origin = mode === 'agent' ? 'agent' : (prior?.draft_origin || (mode === 'auto' ? 'auto' : 'staff'))
  const agentLabel = mode === 'agent'
    ? String(body?.agent_label || prior?.agent_label || 'agent').slice(0, 80)
    : (prior?.agent_label || null)
  const { data, error } = await client.rpc('persist_running_trade_invoice_draft_v1', {
    p_invoice: headerFor(user, weekStart, weekEnd, builder, lines),
    p_lines: lines,
    p_requested_prior_draft_id: prior?.id || null,
    p_builder: builder,
    p_origin: origin,
    p_agent_label: agentLabel,
    p_dismissed: merged.dismissed,
    p_created_by_agent: createdByAgent,
    p_pay_unconfirmed: true,
  })
  if (error || !data) {
    const message = String(error?.message || 'no invoice id returned')
    if (/not installed|function .* does not exist|draft_builder/i.test(message)) {
      throw new RunningDraftError('Running draft storage is not installed yet.', 503, 'running_draft_storage')
    }
    throw new RunningDraftError('Could not save this draft.', 500, 'running_draft_save')
  }
  return {
    ok: true,
    draft_id: data,
    status: 'draft',
    created_by_agent: createdByAgent,
    draft_origin: origin,
    agent_label: agentLabel,
    xero: false,
    submitted: false,
    added: merged.added,
    pay_rules: 'unchanged_until_submit',
  }
}
