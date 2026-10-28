// Guard for the ops notes badge on a pipeline card (`renderKanbanCard`,
// `setOpsNotesBadge` in ops.html). The badge starts from the board read's
// `ops_notes_count`, which is a snapshot: a note written after that read used
// to show in the Ops Notes popup while the icon stayed blank, and a repaint from
// the cached board (`renderJobs(_pipelineData)`) wiped a badge a save had just
// set. Opening the popup now draws the badge from the notes it read, and every
// badge update is written back into the cached board row.
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { installOpsSessionStub } = require('../helpers/ops-auth');

const OPS_FILE = 'file://' + path.resolve(__dirname, '..', '..', 'ops.html');
const COUNTED = 'job-aaaa-1111';
const STALE = 'job-bbbb-2222';

function card(id, name, count) {
  return {
    id, type: 'fencing', status: 'processing', client_name: name, job_number: 'SWF-' + id.slice(-4),
    site_suburb: 'Perth', assignment_count: 2, ops_notes_count: count, comms_notes_count: 0,
  };
}

async function bootBoard(page, staleNotes) {
  const apiCalls = [];
  await installOpsSessionStub(page);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('file://')) return route.continue();
    const match = url.match(/\/functions\/v1\/ops-api\?action=([a-z_]+)/);
    const action = match && match[1];
    if (action) apiCalls.push(action);
    let body = {};
    if (action === 'pipeline') {
      // The board read says the second card has no notes.
      body = { columns: { processing: [card(COUNTED, 'Counted Client', 1), card(STALE, 'Stale Client', 0)] } };
    }
    if (action === 'list_ops_notes') {
      const jobId = new URL(url).searchParams.get('jobId');
      body = { notes: jobId === STALE ? staleNotes : [{ id: 'note-a', note: 'counted note', created_at: '2026-10-28T02:00:00Z' }] };
    }
    if (action === 'upsert_ops_note') {
      staleNotes.push({ id: 'note-new', note: 'added here', created_at: '2026-10-28T03:00:00Z' });
      body = { note: {} };
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(OPS_FILE);
  await expect(page.locator('#viewJobs')).toHaveClass(/active/);
  await expect(noteButton(page, STALE)).toHaveCount(1);
  return apiCalls;
}

function noteButton(page, jobId) {
  return page.locator('.ops-note-btn[data-job-id="' + jobId + '"]');
}

test('the board draws the badge from the board read count', async ({ page }) => {
  await bootBoard(page, []);
  await expect(noteButton(page, COUNTED).locator('.ops-note-badge')).toHaveText('1');
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveCount(0);
});

test('opening the popup on a note the board read missed lights the badge, and a repaint keeps it', async ({ page }) => {
  const apiCalls = await bootBoard(page, [
    { id: 'note-1', note: 'lead time for Domain is end of November', created_at: '2026-10-28T01:00:00Z' },
  ]);
  await noteButton(page, STALE).click();
  await expect(page.locator('.ops-notes-popup .ops-note-item')).toContainText('lead time for Domain');
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveText('1');
  await expect(noteButton(page, STALE)).toHaveClass(/has-notes/);
  // The badge comes from the popup's own read, not a second one.
  expect(apiCalls.filter((a) => a === 'list_ops_notes')).toHaveLength(1);

  await page.evaluate(() => toggleSalesDrawer());
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveText('1');
});

test('a note added in the popup keeps its badge through repaints from the cached board', async ({ page }) => {
  await bootBoard(page, []);
  await noteButton(page, STALE).click();
  await expect(page.locator('.ops-notes-popup')).toContainText('No notes yet');
  await page.locator('#opsNoteInput').fill('lead time for Domain is end of November');
  await page.locator('.ops-notes-popup-footer button', { hasText: 'Add' }).click();
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveText('1');

  await page.evaluate(() => toggleSalesDrawer());
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveText('1');
  await page.evaluate(() => setJobView('kanban'));
  await expect(noteButton(page, STALE).locator('.ops-note-badge')).toHaveText('1');
});
