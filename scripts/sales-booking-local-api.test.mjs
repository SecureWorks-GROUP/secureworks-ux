import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleLocal } from './sales-booking-local-api.mjs';

test('stamp write then read is a store round trip, and stage_moves stay empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-stamp-'));
  const storeFile = path.join(dir, 'store.json');
  const mcpCall = async () => ({ opportunities: [], pagination: { has_more: false } });
  const written = await handleLocal('sales_booking_stamp_write', {}, {
    resource: 'marnin',
    week_start: '2026-09-14',
    stamp: {
      captain: 'marnin',
      approved: ['opp-offer'],
      rejected: [],
      decisions: {},
      stage_moves: [{ opportunity_id: 'opp-offer', to: 'Scope Booked' }]
    }
  }, mcpCall, storeFile);
  assert.equal(written.ok, true);
  assert.equal(written.sent, false);
  assert.equal(written.wrote_calendar, false);
  assert.deepEqual(written.stamp.approved, ['opp-offer']);
  assert.deepEqual(written.stamp.stage_moves, []);

  const read = await handleLocal('sales_booking_read', {
    resource: 'marnin',
    week_start: '2026-09-14'
  }, {}, mcpCall, storeFile);
  assert.equal(read.ok, true);
  assert.equal(read.stamp.present, true);
  assert.deepEqual(read.stamp.approved, ['opp-offer']);
  assert.deepEqual(read.stamp.stage_moves, []);
});
