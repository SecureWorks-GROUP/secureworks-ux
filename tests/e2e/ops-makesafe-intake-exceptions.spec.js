const { test, expect } = require('@playwright/test');

// Intake exceptions become visible to a human.
//
// The backend has always computed these: buildIntakeExceptionProjection builds a
// source-backed review card for every actionable exception — the blocker
// sentence, the missing information, the originating emails and their
// attachments, and the next action — and ships the whole projection in the
// makesafe_board envelope as `intake_exceptions`.
//
// Until now the entire UX repo read exactly ONE key off that object: `.degraded`,
// for the amber "panel failed" banner. `.cards`, `.source_alarms`, `.totals` and
// `.summary` were computed, shipped and thrown away on every load. A parse
// failure, an identity-floor miss, an ambiguous scope or a quote-stage repair
// left no card, no draft and no job, and nothing on any screen said so.
//
// These render directly through renderMakesafeIntakeExceptions with a synthetic
// projection, the same way the sibling canonical-board spec drives
// buildMakesafeBoardColumns. No network, no auth.

function exceptionCard(overrides) {
  return Object.assign({
    id: 'exc-1',
    kind: 'intake_exception',
    status: 'source-backed, no job - needs review',
    case_id: 'case-1',
    case_ids: ['case-1'],
    job_id: null,
    builder: { id: 'b1', slug: 'mlb', name: 'Major Loss Builders' },
    external_ref: 'MLB-27311',
    display_reason_code: 'adapter_parse_failure',
    received_at: '2026-08-25T02:00:00Z',
    source_email_subject: 'NEW WORK ORDER - WO-27311 - 4 Bannister Road',
    blocker_sentence: 'The work-order PDF text never extracted, so the scope and address are unknown.',
    needed_information: ['site_address', 'scope'],
    case_gaps: [],
    evidence_sources: [],
    attachment_pointers: [
      { post_id: 'p1', attachment_id: 'a1', name: 'WO-27311.pdf', content_type: 'application/pdf', status: 'failed', size_bytes: 91234, is_pdf: true },
    ],
    next_action: { verb: 'builder must resend', route: 'builder_resend_request', case_ids: ['case-1'] },
    available_actions: [],
    human_review_required: true,
    human_approval_required: true,
    auto_create_job: false,
    auto_create_draft: false,
  }, overrides || {});
}

function sourceAlarm(overrides) {
  return Object.assign({
    id: 'alarm-1',
    kind: 'intake_source_alarm',
    source_post_id: 'AAMkAGI2THVSAAA=',
    received_at: '2026-08-25T04:00:00Z',
    blocker_sentence: 'This email carried a work-order reference but no readable attachment.',
    next_action: 'review source',
    severity: 'critical',
    subject: 'FW: allocation',
    attachments: [],
  }, overrides || {});
}

function projection(extra) {
  return Object.assign({
    contract_version: 'intake-exception-cards.v1',
    generated_at: '2026-08-26T01:00:00Z',
    org_id: '00000000-0000-0000-0000-000000000001',
    recent_window: { days: 15, from: '2026-08-11', to: '2026-08-26' },
    summary: {
      visible_actionable_cards: 1,
      resolved_from_existing_evidence: 0,
      accounted_silently: 0,
      outside_three: 0,
    },
    totals: {
      exception_case_rows: 1,
      recent_exception_case_rows: 1,
      out_of_window_exception_case_rows: 0,
      recent_accounted_non_work_rows: 0,
      recent_deterministic_non_work_exception_rows: 0,
      actionable_case_rows: 1,
      cards: 1,
      source_alarms: 0,
    },
    disposition_counts: {},
    cards: [exceptionCard()],
    source_alarms: [],
    dispositions: [],
  }, extra || {});
}

// Render the panel from a payload, exactly as the board does.
async function renderExceptions(page, intakeExceptions) {
  return page.evaluate((payload) => {
    window._makesafeBoardPayload = payload;
    window._makesafeExceptionsOpen = true;
    const host = document.createElement('div');
    host.id = 'msExceptionsHost';
    host.innerHTML = renderMakesafeIntakeExceptions();
    document.body.appendChild(host);

    const panel = host.querySelector('.ms-exceptions');
    const cards = Array.prototype.slice.call(host.querySelectorAll('.ms-exception-card'));
    return {
      html: host.innerHTML,
      rendered: !!panel,
      empty: !!host.querySelector('[data-exceptions-empty]'),
      count: panel ? panel.getAttribute('data-exceptions-count') : null,
      refs: cards.map((c) => {
        const el = c.querySelector('.ms-exception-ref');
        return el ? el.textContent.trim() : '';
      }),
      blockers: cards.map((c) => {
        const el = c.querySelector('.ms-exception-blocker');
        return el ? el.textContent.trim() : '';
      }),
      alarms: host.querySelectorAll('.ms-exception-alarm').length,
      note: (host.querySelector('.ms-exceptions-note') || {}).textContent || '',
    };
  }, { intake_exceptions: intakeExceptions });
}

test('an exception the pipeline could not turn into a job is on the screen', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await renderExceptions(page, projection());

  expect(result.rendered).toBe(true);
  expect(result.count).toBe('1');
  expect(result.refs).toEqual(['MLB-27311']);
  // The blocker sentence is the whole point: it says what is missing, in words.
  expect(result.blockers[0]).toContain('never extracted');
  // Builder, next action and attachment count all reach the card.
  expect(result.html).toContain('Major Loss Builders');
  expect(result.html).toContain('builder must resend');
  expect(result.html).toContain('1 attachment');
});

test('an unreadable source is shown too, and marked apart from a review card', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await renderExceptions(page, projection({
    cards: [exceptionCard()],
    source_alarms: [sourceAlarm()],
    totals: Object.assign(projection().totals, { source_alarms: 1 }),
  }));

  expect(result.count).toBe('2');
  expect(result.alarms).toBe(1);
  expect(result.html).toContain('no readable attachment');
  expect(result.html).toContain('unreadable source');
});

test('the two lanes the card list cannot show are stated, not hidden', async ({ page }) => {
  await page.goto('/ops.html');
  // An exception older than the backend's recency window drops out of `cards`
  // and survives only as an integer; and emails accounted as non-work-order
  // never became a case at all. Both must be said out loud or the panel implies
  // the list is everything.
  const result = await renderExceptions(page, projection({
    summary: Object.assign(projection().summary, { accounted_silently: 778 }),
    totals: Object.assign(projection().totals, { out_of_window_exception_case_rows: 12 }),
  }));

  expect(result.note).toContain('12 older exceptions');
  expect(result.note).toContain('15-day window');
  expect(result.note).toContain('778 emails');
});

test('a clean intake says so rather than rendering nothing', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await renderExceptions(page, projection({
    cards: [],
    source_alarms: [],
    summary: { visible_actionable_cards: 0, resolved_from_existing_evidence: 4, accounted_silently: 0, outside_three: 0 },
    totals: Object.assign(projection().totals, { cards: 0, actionable_case_rows: 0 }),
  }));

  expect(result.empty).toBe(true);
  expect(result.html).toContain('Intake clear');
  expect(result.html).toContain('15 days');
  // An empty state is not an exception card.
  expect(result.refs).toEqual([]);
});

test('a degraded projection stays silent — its own banner already owns that case', async ({ page }) => {
  await page.goto('/ops.html');
  // Inventing an empty state for a panel that could not be read would be a lie:
  // renderMakesafeFeedNotices already paints the amber degraded banner.
  const degraded = await renderExceptions(page, projection({
    degraded: { reason: 'projection_read_failed', error: 'timeout', failed_at: '2026-08-26T00:00:00Z' },
  }));
  expect(degraded.rendered).toBe(false);
  expect(degraded.empty).toBe(false);

  // And a board payload with no intake_exceptions key at all renders nothing.
  const missing = await page.evaluate(() => {
    window._makesafeBoardPayload = {};
    return renderMakesafeIntakeExceptions();
  });
  expect(missing).toBe('');
});

test('exception text is escaped, never injected', async ({ page }) => {
  await page.goto('/ops.html');
  const result = await renderExceptions(page, projection({
    cards: [exceptionCard({
      external_ref: '<img src=x onerror=alert(1)>',
      blocker_sentence: 'Scope said "<script>bad()</script>".',
    })],
  }));
  expect(result.html).not.toContain('<img src=x');
  expect(result.html).not.toContain('<script>bad()');
  expect(result.blockers[0]).toContain('<script>bad()</script>');
});

test('the panel collapses and reopens without losing its rows', async ({ page }) => {
  await page.goto('/ops.html');
  await renderExceptions(page, projection());
  const states = await page.evaluate(() => {
    const before = document.getElementById('msExceptionsBody').style.display;
    toggleMakesafeIntakeExceptions();
    const collapsed = document.getElementById('msExceptionsBody').style.display;
    toggleMakesafeIntakeExceptions();
    const reopened = document.getElementById('msExceptionsBody').style.display;
    return {
      before,
      collapsed,
      reopened,
      cards: document.querySelectorAll('.ms-exception-card').length,
    };
  });
  // Open by default: every row here is a work order waiting on a person, and
  // collapsing by default would reproduce the invisibility this panel ends.
  expect(states.before).toBe('');
  expect(states.collapsed).toBe('none');
  expect(states.reopened).toBe('');
  expect(states.cards).toBe(1);
});
