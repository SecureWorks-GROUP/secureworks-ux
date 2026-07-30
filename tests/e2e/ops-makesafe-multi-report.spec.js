const { test, expect } = require('@playwright/test');

const PHOTO_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

function multiVisitJobDetail() {
  return {
    job: {
      id: 'job-two-visits',
      job_number: 'SWMS-E2E-2V',
      type: 'makesafe',
      status: 'scheduled',
      client_name: 'Fixture Client',
      site_address: '10 Fixture Street',
      site_suburb: 'Perth',
      created_at: '2026-07-25T00:00:00Z',
      metadata: { makesafe_job_family: 'general_makesafe' }
    },
    makesafe_details: {
      substatus: 'admin_to_send_report',
      cycle_number: 2,
      reattend_count: 1,
      attendance_cycle_id: 'cycle-2',
      cycle_attribution: 'bound',
      report_received_at: '2026-07-28T02:00:00Z',
      external_ref: 'MLB-E2E'
    },
    service_reports: [
      {
        id: 'report-2',
        job_id: 'job-two-visits',
        status: 'submitted',
        cycle_number: 2,
        attendance_cycle_id: 'cycle-2',
        cycle_attribution: 'bound',
        submitted_at: '2026-07-28T02:00:00Z',
        checklist_json: {
          work_done: 'Visit two work',
          labour_hours: 1,
          trade_count: 1
        }
      },
      {
        id: 'report-1',
        job_id: 'job-two-visits',
        status: 'submitted',
        cycle_number: 1,
        attendance_cycle_id: 'cycle-1',
        cycle_attribution: 'bound',
        submitted_at: '2026-07-26T01:00:00Z',
        checklist_json: {
          work_done: 'Visit one work',
          labour_hours: 2,
          trade_count: 2
        }
      }
    ],
    media: [
      {
        id: 'photo-1',
        job_id: 'job-two-visits',
        type: 'photo',
        phase: 'completion',
        attendance_cycle_id: 'cycle-1',
        cycle_attribution: 'bound',
        storage_url: PHOTO_DATA_URL
      },
      {
        id: 'photo-2',
        job_id: 'job-two-visits',
        type: 'photo',
        phase: 'completion',
        attendance_cycle_id: 'cycle-2',
        cycle_attribution: 'bound',
        storage_url: PHOTO_DATA_URL
      }
    ],
    documents: [],
    work_orders: [],
    invoices: [],
    assignments: [],
    events: []
  };
}

test('Ops shows and opens both attendance-cycle reports without duplicating the job', async ({ page }) => {
  const detail = multiVisitJobDetail();
  await page.goto('/ops.html');
  await page.evaluate((fixture) => {
    window._currentJobData = fixture;
    document.body.innerHTML = `<main id="multi-report-proof">${renderMakesafeOpsDetail(fixture)}</main>`;
  }, detail);

  const reports = page.locator('[data-testid="makesafe-visit-reports"] [data-report-cycle]');
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0)).toContainText('Visit 1');
  await expect(reports.nth(1)).toContainText('Visit 2');
  await expect(page.locator('#multi-report-proof')).toContainText('2 visit reports');
  await expect(page.locator('#multi-report-proof')).toHaveCount(1);

  await page.locator('[data-open-report-cycle="1"]').click();
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Trade report · Visit 1');
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Visit one work');
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Visit 1 photos (1)');
  await page.evaluate(() => closeModal('makesafeRawReportModal'));

  await page.locator('[data-open-report-cycle="2"]').click();
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Trade report · Visit 2');
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Visit two work');
  await expect(page.locator('#makesafeRawReportModal')).toContainText('Visit 2 photos (1)');
  await expect(page.locator('#makesafeRawReportModal')).not.toContainText('Visit one work');
});
